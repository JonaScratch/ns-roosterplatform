import "server-only";
import { askAgent } from "@/server/agent/agent";
import type { ChatModel } from "@/server/agent/model/types";
import { benchAnswer } from "@/server/agent/bench-adapter";
import { demoRoomActor } from "../actor";
import { requireReadAccess } from "../safety";
import { AGENT_CATEGORY_KEYS } from "../proof/decision";
import * as logbook from "../store/logbook";
import type { AgentQualityCategory, AgentQualityVariance, CategoryVariance } from "../types";

/**
 * De negen Lyra-agentkwaliteitsdimensies (§1 van v0.2). Bewust generiek
 * berekend over de bestaande dev/holdout/hidden-items in plaats van een
 * starre "één item = één categorie"-indeling: de meeste dimensies zijn
 * eigenschappen die over de hele suite gelden (grounding, causale claims,
 * latency), niet van één specifiek testgeval.
 */

type Json = Record<string, unknown>;

export interface ScoredItem {
  readonly id: string;
  readonly status: string;
  readonly text: string;
  readonly sources: readonly string[];
  readonly tools: readonly string[];
  readonly ms: number;
  readonly behaviour: string | null;
  readonly graded: "GOED" | "FOUT" | "ONBEOORDEELD" | "NIET_GEIMPLEMENTEERD";
}

/**
 * Loggingcontext voor de flight-recorder-granulariteit (§ aanvulling "FULL
 * FLIGHT RECORDER"). Optioneel: callers zonder logboekbehoefte (bijvoorbeeld
 * de smoke-benchmark in `publish/safePublish.ts`) blijven ongewijzigd werken.
 */
export interface BenchmarkLogContext {
  readonly runId: string;
  readonly suite: string;
  /** Menselijk label van de fase, bijvoorbeeld "PRE (dev, controle)" of "POST-run 2/2 (variant, dev)". */
  readonly phase: string;
}

function itemPromptKort(item: Json): string {
  return String(item.prompt ?? "").slice(0, 300);
}

/**
 * Draait één suite via `benchAnswer()` en meet de wandkloktijd per item —
 * nodig voor latency, die `benchAnswer()` zelf niet teruggeeft.
 *
 * Met `logCtx` schrijft dit voor élk item de volledige, reconstrueerbare
 * keten naar het logboek: welke input/context het kreeg, welk model
 * antwoordde, welke tools met welke argumenten werden aangeroepen (en met
 * welk resultaat/duur), het uiteindelijke antwoord, en waarom het GOED/FOUT/
 * ONBEOORDEELD werd gegradeerd — nooit ruwe modelredenering, wel elke
 * operationele stap. Geen enkel item slaat hierdoor nog stil over.
 */
export async function scoreSuiteItems(items: readonly Json[], modelOverride?: ChatModel, logCtx?: BenchmarkLogContext): Promise<readonly ScoredItem[]> {
  const resultaten: ScoredItem[] = [];
  for (const item of items) {
    const t0 = Date.now();
    const itemId = String(item.id);
    if (logCtx) {
      const expect = (item.expect as Json | undefined) ?? {};
      logbook.log(logCtx.runId, {
        kind: "BENCHMARK_ITEM_START",
        experimentId: null,
        message: `${logCtx.phase} · item ${itemId}: "${itemPromptKort(item)}"`,
        data: { suite: logCtx.suite, phase: logCtx.phase, itemId, expectKind: String(expect.kind ?? "onbekend"), expectBehaviour: expect.behaviour ? String(expect.behaviour) : null },
      });
      logbook.log(logCtx.runId, {
        kind: "CONTEXT_BEFORE",
        experimentId: null,
        message: `Context vóór item ${itemId}: ${JSON.stringify(item.context ?? {})}${Array.isArray(item.expectedTools) ? ` · verwachte tool(s): ${(item.expectedTools as string[]).join(", ")}` : ""}`,
        data: { itemId },
      });
    }

    const oordeel = (await benchAnswer(item, { modelOverride })) as Json;

    if (logCtx) {
      const toolCalls = (oordeel.toolCalls as { tool: string; input: unknown; ok: boolean; ms: number; note?: string }[] | undefined) ?? [];
      logbook.log(logCtx.runId, {
        kind: "AGENT_EXECUTION_START",
        experimentId: null,
        message: `Item ${itemId}: model=${oordeel.model ?? "onbekend"} (taalmodel: ${oordeel.isLanguageModel ? "ja" : "nee"}), ${oordeel.turnsExecuted ?? "onbekend aantal"} beurt(en) uitgevoerd.`,
        data: { itemId, turnsExecuted: typeof oordeel.turnsExecuted === "number" ? oordeel.turnsExecuted : null },
      });
      logbook.log(logCtx.runId, {
        kind: "TOOL_DECISION",
        experimentId: null,
        message: `Item ${itemId}: intentie=${oordeel.intent ?? "onbekend"}; ${toolCalls.length} tool(len) aangeroepen: ${toolCalls.map((c) => c.tool).join(", ") || "(geen)"}.`,
        data: { itemId, toolCount: toolCalls.length },
      });
      for (const call of toolCalls) {
        logbook.log(logCtx.runId, { kind: "TOOL_CALL", experimentId: null, message: `Item ${itemId}: tool ${call.tool} aangeroepen met input ${JSON.stringify(call.input)}.`, data: { itemId } });
        logbook.log(logCtx.runId, {
          kind: "TOOL_RESULT",
          experimentId: null,
          message: `Item ${itemId}: tool ${call.tool} → ${call.ok ? "OK" : "FOUT"} in ${call.ms}ms.${call.note ? ` (${call.note})` : ""}`,
          data: { itemId, tool: call.tool, ok: call.ok, ms: call.ms },
        });
      }
      logbook.log(logCtx.runId, {
        kind: "AGENT_RESPONSE",
        experimentId: null,
        message: `Item ${itemId}: antwoord="${String(oordeel.text ?? "").slice(0, 500)}" · bronnen: ${((oordeel.sources as string[] | undefined) ?? []).join(", ") || "(geen)"} · status=${oordeel.answered ?? oordeel.status}.`,
        data: { itemId },
      });
    }

    const graded = (oordeel.status as ScoredItem["graded"]) ?? "ONBEOORDEELD";
    if (logCtx) {
      logbook.log(logCtx.runId, {
        kind: "BENCHMARK_ITEM_GRADE",
        experimentId: null,
        message: `Item ${itemId}: verwacht=${JSON.stringify(item.expect)} · gegradeerd=${graded} · reden: ${oordeel.detail || "(geen toelichting)"}.`,
        data: { itemId, graded },
      });
    }

    resultaten.push({
      id: itemId,
      status: String(oordeel.answered ?? oordeel.status ?? "ONBEKEND"),
      text: String(oordeel.text ?? ""),
      sources: (oordeel.sources as string[] | undefined) ?? [],
      tools: (oordeel.tools as string[] | undefined) ?? [],
      ms: Date.now() - t0,
      behaviour: ((item.expect as Json | undefined)?.behaviour as string | undefined) ?? null,
      graded,
    });

    if (logCtx) {
      logbook.log(logCtx.runId, { kind: "BENCHMARK_ITEM_END", experimentId: null, message: `Item ${itemId} afgerond in ${Date.now() - t0}ms.`, data: { itemId, ms: Date.now() - t0 } });
    }
  }
  return resultaten;
}

const CAUSALE_CLAIM_ZONDER_BRON = /waarschijnlijk (ge|)baseerd op|komt (waarschijnlijk |vermoedelijk )?door|de oorzaak (hiervan )?is|dit komt vermoedelijk/i;

function percentage(pass: number, total: number): number | null {
  return total > 0 ? (pass / total) * 100 : null;
}

/**
 * Elke dimensie is uiteindelijk "hoeveel van de relevante items slaagden" —
 * `pass`/`total`/`itemIds` blijven bewaard (niet alleen het percentage), zodat
 * het logboek altijd `grounding: 1/2 (item DR-DEV-05) → 2/2` kan tonen in
 * plaats van een percentage zonder noemer (§ flight recorder-aanvulling,
 * "BENCHMARK IS NU TE KLEIN VOOR STERKE CLAIMS").
 */
export interface DimensionBreakdown {
  readonly pass: number;
  readonly total: number;
  readonly itemIds: readonly string[];
}

function breakdown(relevant: readonly ScoredItem[], passPred: (r: ScoredItem) => boolean): DimensionBreakdown {
  return { pass: relevant.filter(passPred).length, total: relevant.length, itemIds: relevant.map((r) => r.id) };
}

/** Toolkeuze: alleen voor items met een `expectedTools`-veld (Demo Room-eigen, genegeerd door bench-adapter). */
function toolChoiceBreakdown(items: readonly Json[], results: readonly ScoredItem[]): DimensionBreakdown | null {
  const relevant = items
    .map((item) => ({ item, result: results.find((r) => r.id === item.id) }))
    .filter((x): x is { item: Json; result: ScoredItem } => Array.isArray(x.item.expectedTools) && x.result !== undefined);
  if (relevant.length === 0) return null;
  return {
    pass: relevant.filter(({ item, result }) => (item.expectedTools as string[]).some((t) => result.tools.includes(t))).length,
    total: relevant.length,
    itemIds: relevant.map(({ item }) => String(item.id)),
  };
}

/** Onnodige verduidelijkingsvragen: items met `expectUnambiguous: true` horen NOOIT als VERDUIDELIJKING terug te komen. */
function unnecessaryClarificationBreakdown(items: readonly Json[], results: readonly ScoredItem[]): DimensionBreakdown | null {
  const relevant = items
    .map((item) => ({ item, result: results.find((r) => r.id === item.id) }))
    .filter((x): x is { item: Json; result: ScoredItem } => x.item.expectUnambiguous === true && x.result !== undefined);
  if (relevant.length === 0) return null;
  return { pass: relevant.filter(({ result }) => result.status !== "VERDUIDELIJKING").length, total: relevant.length, itemIds: relevant.map(({ item }) => String(item.id)) };
}

/** Grounding: hergebruikt de bestaande "missing_source"/"cannot_determine"-items — precies de vraag of Lyra geen bron verzint. */
function groundingBreakdown(results: readonly ScoredItem[]): DimensionBreakdown | null {
  const relevant = results.filter((r) => r.behaviour === "missing_source" || r.behaviour === "cannot_determine");
  return relevant.length > 0 ? breakdown(relevant, (r) => r.graded === "GOED") : null;
}

function falsePremiseBreakdown(results: readonly ScoredItem[]): DimensionBreakdown | null {
  const relevant = results.filter((r) => r.behaviour === "correct_false_premise");
  return relevant.length > 0 ? breakdown(relevant, (r) => r.graded === "GOED") : null;
}

function machinistTaalBreakdown(results: readonly ScoredItem[]): DimensionBreakdown | null {
  const relevant = results.filter((r) => r.behaviour === "explains_absence" || r.behaviour === "scope_isolation");
  return relevant.length > 0 ? breakdown(relevant, (r) => r.graded === "GOED") : null;
}

/**
 * Causale claims: over ALLE items — maakt het antwoord een causale bewering
 * zonder dat er een bron bij staat? Geïnspireerd op casus C uit het R2-PRE-
 * spoor van de hoofdapp (`docs/v1.0.6`), maar een eigen, kleinere heuristiek:
 * dit vervangt de hoofdapp-grondingscontrole niet, het is een extra,
 * Demo Room-eigen signaal.
 */
function causalClaimBreakdown(results: readonly ScoredItem[]): DimensionBreakdown | null {
  if (results.length === 0) return null;
  return breakdown(results, (r) => !(CAUSALE_CLAIM_ZONDER_BRON.test(r.text) && r.sources.length === 0));
}

function scoreVan(b: DimensionBreakdown | null): number | null {
  return b ? percentage(b.pass, b.total) : null;
}

/**
 * Dezelfde negen dimensies, maar als volledige pass/total/item-ID-breakdown
 * in plaats van een kaal percentage — voor het logboek (§ flight recorder-
 * aanvulling). `computeAgentQualityCategory` hieronder gebruikt intern
 * dezelfde breakdowns, dus dit kan nooit uit de pas lopen met het percentage
 * dat in het besluit wordt gebruikt.
 */
export function computeAgentQualityBreakdown(items: readonly Json[], results: readonly ScoredItem[]): Partial<Record<Exclude<keyof AgentQualityCategory, "latencyMs">, DimensionBreakdown>> {
  const out: Partial<Record<Exclude<keyof AgentQualityCategory, "latencyMs">, DimensionBreakdown>> = {};
  const machinistTaal = machinistTaalBreakdown(results);
  const toolChoice = toolChoiceBreakdown(items, results);
  const falsePremiseCorrection = falsePremiseBreakdown(results);
  const grounding = groundingBreakdown(results);
  const causalClaims = causalClaimBreakdown(results);
  const unnecessaryClarifications = unnecessaryClarificationBreakdown(items, results);
  if (machinistTaal) out.machinistTaal = machinistTaal;
  if (toolChoice) out.toolChoice = toolChoice;
  if (falsePremiseCorrection) out.falsePremiseCorrection = falsePremiseCorrection;
  if (grounding) out.grounding = grounding;
  if (causalClaims) out.causalClaims = causalClaims;
  if (unnecessaryClarifications) out.unnecessaryClarifications = unnecessaryClarifications;
  return out;
}

function latencyStats(results: readonly ScoredItem[]): { readonly p50: number; readonly p95: number } | null {
  if (results.length === 0) return null;
  const sorted = [...results.map((r) => r.ms)].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { p50: at(0.5), p95: at(0.95) };
}

/**
 * Contextresolutie / multi-turn context: `benchAnswer()` geeft alleen de
 * laatste beurt terug, dus dit loopt bewust rechtstreeks via `askAgent()` —
 * dezelfde functie, alleen zonder de laatste-beurt-beperking. Twee vaste,
 * kleine scenario's op het echte DDR-pakket: "en kandidaat 2?" moet de
 * context laten wisselen naar een candidate-bron met een gevonden ID.
 */
export async function runContextResolutionCheck(
  locationCode: string,
  modelOverride?: ChatModel,
  runId?: string,
): Promise<{ readonly contextResolution: number | null; readonly multiTurnContext: number | null }> {
  const { actor } = await requireReadAccess(await demoRoomActor(), locationCode);
  const scenarios = [
    { eerste: "Hoeveel vroege diensten staan er in DDR-50MIX?", tweede: "En hoe zit dat bij kandidaat 2?" },
    { eerste: "Wat is de gemiddelde werkweek van DDR-VL?", tweede: "En bij de andere kandidaat?" },
  ];

  let geslaagd = 0;
  for (const [i, scenario] of scenarios.entries()) {
    const eerste = await askAgent({
      actor,
      text: scenario.eerste,
      persist: false,
      modelOverride,
      uiContext: { source: "official", candidateId: null, candidateLabel: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, locationCode },
    });
    if (runId) {
      logbook.log(runId, {
        kind: "CONTEXT_TURN",
        experimentId: null,
        message: `Contextscenario ${i + 1}, beurt 1: "${scenario.eerste}" → contextUsed=${JSON.stringify(eerste.contextUsed)} · sessionId=${eerste.sessionId ?? "geen"} · antwoord="${eerste.text.slice(0, 300)}".`,
        data: { scenario: i + 1, turn: 1 },
      });
    }
    const tweede = await askAgent({
      actor,
      text: scenario.tweede,
      persist: false,
      sessionId: eerste.sessionId,
      modelOverride,
      uiContext: { source: "official", candidateId: null, candidateLabel: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, locationCode },
    });
    // Geslaagd: de tweede beurt herkende dat er een andere bron werd bedoeld
    // (source wisselde naar candidate) — ongeacht of er daadwerkelijk een
    // kandidaat in de database bestond; "missing" mag, gokken niet.
    const geslaagdDezeKeer = (tweede.contextUsed as { source?: string }).source === "candidate";
    if (geslaagdDezeKeer) geslaagd += 1;
    if (runId) {
      logbook.log(runId, {
        kind: "CONTEXT_TURN",
        experimentId: null,
        message:
          `Contextscenario ${i + 1}, beurt 2: "${scenario.tweede}" → contextUsed=${JSON.stringify(tweede.contextUsed)} · ` +
          `tools=${tweede.toolCalls.map((c) => c.tool).join(",") || "geen"} · antwoord="${tweede.text.slice(0, 300)}" · ` +
          `verwacht: source wisselt naar "candidate" · werkelijk: ${(tweede.contextUsed as { source?: string }).source ?? "onbekend"} · ${geslaagdDezeKeer ? "PASS" : "FAIL"}.`,
        data: { scenario: i + 1, turn: 2, pass: geslaagdDezeKeer },
      });
    }
  }
  const score = percentage(geslaagd, scenarios.length);
  // v0.2: één gecombineerd scenario meet beide dimensies tegelijk (het is
  // dezelfde context-switch die zowel "resolutie binnen deze beurt" als
  // "vasthouden over beurten heen" toetst). Apart uitsplitsen is vervolgwerk.
  return { contextResolution: score, multiTurnContext: score };
}

/**
 * Variantie per dimensie over N onafhankelijke runs (§3 van de aanvullende
 * opdracht: "rapporteer variantie expliciet, cherry-pick nooit de beste
 * run"). `values` bewaart élke run in volgorde — niets wordt ingekort.
 */
export function computeAgentQualityVariance(runs: readonly AgentQualityCategory[]): AgentQualityVariance {
  const perDimensie = (k: keyof AgentQualityCategory): CategoryVariance | null => {
    const waarden = runs.map((r) => r[k]).filter((v): v is number => typeof v === "number");
    if (waarden.length === 0) return null;
    const mean = waarden.reduce((a, b) => a + b, 0) / waarden.length;
    const variantie = waarden.reduce((a, b) => a + (b - mean) ** 2, 0) / waarden.length;
    return { values: waarden, mean, min: Math.min(...waarden), max: Math.max(...waarden), stddev: Math.sqrt(variantie) };
  };
  const out = {} as Record<keyof AgentQualityCategory, CategoryVariance | null>;
  for (const k of AGENT_CATEGORY_KEYS) out[k] = perDimensie(k);
  out.latencyMs = null; // latency heeft een eigen p50/p95-vorm, geen simpele numerieke variantie
  return out as AgentQualityVariance;
}

export function computeAgentQualityCategory(items: readonly Json[], results: readonly ScoredItem[], contextCheck: { contextResolution: number | null; multiTurnContext: number | null }): AgentQualityCategory {
  return {
    contextResolution: contextCheck.contextResolution,
    multiTurnContext: contextCheck.multiTurnContext,
    machinistTaal: scoreVan(machinistTaalBreakdown(results)),
    toolChoice: scoreVan(toolChoiceBreakdown(items, results)),
    falsePremiseCorrection: scoreVan(falsePremiseBreakdown(results)),
    grounding: scoreVan(groundingBreakdown(results)),
    causalClaims: scoreVan(causalClaimBreakdown(results)),
    unnecessaryClarifications: scoreVan(unnecessaryClarificationBreakdown(items, results)),
    latencyMs: latencyStats(results),
  };
}
