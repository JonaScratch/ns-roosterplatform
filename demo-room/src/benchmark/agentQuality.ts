import "server-only";
import { askAgent } from "@/server/agent/agent";
import type { ChatModel } from "@/server/agent/model/types";
import { benchAnswer } from "@/server/agent/bench-adapter";
import { demoRoomActor } from "../actor";
import { requireReadAccess } from "../safety";
import type { AgentQualityCategory } from "../types";

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

/** Draait één suite via `benchAnswer()` en meet de wandkloktijd per item — nodig voor latency, die `benchAnswer()` zelf niet teruggeeft. */
export async function scoreSuiteItems(items: readonly Json[], modelOverride?: ChatModel): Promise<readonly ScoredItem[]> {
  const resultaten: ScoredItem[] = [];
  for (const item of items) {
    const t0 = Date.now();
    const oordeel = (await benchAnswer(item, { modelOverride })) as Json;
    resultaten.push({
      id: String(item.id),
      status: String(oordeel.answered ?? oordeel.status ?? "ONBEKEND"),
      text: String(oordeel.text ?? ""),
      sources: (oordeel.sources as string[] | undefined) ?? [],
      tools: (oordeel.tools as string[] | undefined) ?? [],
      ms: Date.now() - t0,
      behaviour: ((item.expect as Json | undefined)?.behaviour as string | undefined) ?? null,
      graded: (oordeel.status as ScoredItem["graded"]) ?? "ONBEOORDEELD",
    });
  }
  return resultaten;
}

const CAUSALE_CLAIM_ZONDER_BRON = /waarschijnlijk (ge|)baseerd op|komt (waarschijnlijk |vermoedelijk )?door|de oorzaak (hiervan )?is|dit komt vermoedelijk/i;

function percentage(pass: number, total: number): number | null {
  return total > 0 ? (pass / total) * 100 : null;
}

/** Toolkeuze: alleen voor items met een `expectedTools`-veld (Demo Room-eigen, genegeerd door bench-adapter). */
function toolChoiceScore(items: readonly Json[], results: readonly ScoredItem[]): number | null {
  const relevant = items
    .map((item) => ({ item, result: results.find((r) => r.id === item.id) }))
    .filter((x): x is { item: Json; result: ScoredItem } => Array.isArray(x.item.expectedTools) && x.result !== undefined);
  if (relevant.length === 0) return null;
  const pass = relevant.filter(({ item, result }) => (item.expectedTools as string[]).some((t) => result.tools.includes(t))).length;
  return percentage(pass, relevant.length);
}

/** Onnodige verduidelijkingsvragen: items met `expectUnambiguous: true` horen NOOIT als VERDUIDELIJKING terug te komen. */
function unnecessaryClarificationScore(items: readonly Json[], results: readonly ScoredItem[]): number | null {
  const relevant = items
    .map((item) => ({ item, result: results.find((r) => r.id === item.id) }))
    .filter((x): x is { item: Json; result: ScoredItem } => x.item.expectUnambiguous === true && x.result !== undefined);
  if (relevant.length === 0) return null;
  const pass = relevant.filter(({ result }) => result.status !== "VERDUIDELIJKING").length;
  return percentage(pass, relevant.length);
}

/** Grounding: hergebruikt de bestaande "missing_source"/"cannot_determine"-items — precies de vraag of Lyra geen bron verzint. */
function groundingScore(results: readonly ScoredItem[]): number | null {
  const relevant = results.filter((r) => r.behaviour === "missing_source" || r.behaviour === "cannot_determine");
  if (relevant.length === 0) return null;
  return percentage(relevant.filter((r) => r.graded === "GOED").length, relevant.length);
}

function falsePremiseScore(results: readonly ScoredItem[]): number | null {
  const relevant = results.filter((r) => r.behaviour === "correct_false_premise");
  if (relevant.length === 0) return null;
  return percentage(relevant.filter((r) => r.graded === "GOED").length, relevant.length);
}

function machinistTaalScore(results: readonly ScoredItem[]): number | null {
  const relevant = results.filter((r) => r.behaviour === "explains_absence" || r.behaviour === "scope_isolation");
  if (relevant.length === 0) return null;
  return percentage(relevant.filter((r) => r.graded === "GOED").length, relevant.length);
}

/**
 * Causale claims: over ALLE items — maakt het antwoord een causale bewering
 * zonder dat er een bron bij staat? Geïnspireerd op casus C uit het R2-PRE-
 * spoor van de hoofdapp (`docs/v1.0.6`), maar een eigen, kleinere heuristiek:
 * dit vervangt de hoofdapp-grondingscontrole niet, het is een extra,
 * Demo Room-eigen signaal.
 */
function causalClaimScore(results: readonly ScoredItem[]): number | null {
  if (results.length === 0) return null;
  const pass = results.filter((r) => !(CAUSALE_CLAIM_ZONDER_BRON.test(r.text) && r.sources.length === 0)).length;
  return percentage(pass, results.length);
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
export async function runContextResolutionCheck(locationCode: string, modelOverride?: ChatModel): Promise<{ readonly contextResolution: number | null; readonly multiTurnContext: number | null }> {
  const { actor } = await requireReadAccess(await demoRoomActor(), locationCode);
  const scenarios = [
    { eerste: "Hoeveel vroege diensten staan er in DDR-50MIX?", tweede: "En hoe zit dat bij kandidaat 2?" },
    { eerste: "Wat is de gemiddelde werkweek van DDR-VL?", tweede: "En bij de andere kandidaat?" },
  ];

  let geslaagd = 0;
  for (const scenario of scenarios) {
    const eerste = await askAgent({
      actor,
      text: scenario.eerste,
      persist: false,
      modelOverride,
      uiContext: { source: "official", candidateId: null, candidateLabel: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, locationCode },
    });
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
    if ((tweede.contextUsed as { source?: string }).source === "candidate") geslaagd += 1;
  }
  const score = percentage(geslaagd, scenarios.length);
  // v0.2: één gecombineerd scenario meet beide dimensies tegelijk (het is
  // dezelfde context-switch die zowel "resolutie binnen deze beurt" als
  // "vasthouden over beurten heen" toetst). Apart uitsplitsen is vervolgwerk.
  return { contextResolution: score, multiTurnContext: score };
}

export function computeAgentQualityCategory(items: readonly Json[], results: readonly ScoredItem[], contextCheck: { contextResolution: number | null; multiTurnContext: number | null }): AgentQualityCategory {
  return {
    contextResolution: contextCheck.contextResolution,
    multiTurnContext: contextCheck.multiTurnContext,
    machinistTaal: machinistTaalScore(results),
    toolChoice: toolChoiceScore(items, results),
    falsePremiseCorrection: falsePremiseScore(results),
    grounding: groundingScore(results),
    causalClaims: causalClaimScore(results),
    unnecessaryClarifications: unnecessaryClarificationScore(items, results),
    latencyMs: latencyStats(results),
  };
}
