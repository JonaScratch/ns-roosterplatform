import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeAgentQualityBreakdown, computeAgentQualityCategory, computeAgentQualityVariance, runContextResolutionCheck, scoreSuiteItems } from "../benchmark/agentQuality";
import { loadSuite } from "../benchmark/run";
import { rosterNotApplicableReason, rosterQualityFromMetrics } from "../benchmark/rosterQuality";
import { REPORTS_DIR, locationCode as defaultLocationCode } from "../config";
import { buildImprovementReportJson, renderForClaude, renderForJonathan } from "../report/improvementReport";
import { appendBenchmarkHistory } from "../store/benchmarkHistory";
import { appendExperiment } from "../store/runlog";
import { writeJournalEntry } from "../store/journal";
import { getVersion, currentVersionId } from "../publish/versions";
import * as logbook from "../store/logbook";
import { CONTROL, chatModelForVariant, findPromptVariant, type PromptVariant } from "../variants/promptVariants";
import { MIN_POST_RUNS, beoordeelProofOfValue } from "./decision";
import type { AgentQualityCategory, DualQualityMeasurement, ExperimentRecord, JournalEntry, ProofOfValueResult } from "../types";

/**
 * De proof-of-value-test (v0.2, §1/§3 van de aanvullende opdracht):
 *
 *   production Lyra → PRE (dev) → sandboxvariant → POST (zelfde dev-set)
 *   → PRE-holdout (controle) → holdout (variant) → regressiecontrole → besluit
 *
 * Dit is de test die moet bewijzen dat de verbeterlus zelf werkt, vóórdat een
 * lange autonome run wordt aanbevolen. Geen enkel cijfer hier is verzonnen:
 * `executed: false` (zie `run()`) markeert eerlijk wanneer er geen lokaal
 * model/database beschikbaar was.
 */

const FROZEN_SET_ID = "dev-v0.2-frozen-1"; // dev.json's inhoud is de bevroren set; wijzig deze ID als dev.json ooit inhoudelijk verandert.

/**
 * Geëxporteerd zodat de Zelfstandigheidstest (`autonomy/capabilityTest.ts`)
 * dezelfde, echte meetweg kan gebruiken om een reële zwakte te identificeren
 * vóórdat er een hypothese gekozen wordt — geen tweede, losse metingsroute.
 */
export async function measure(
  runId: string,
  label: string,
  items: readonly Record<string, unknown>[],
  modelOverride: Parameters<typeof scoreSuiteItems>[1],
  locationCode: string,
  rosterMetrics: Record<string, number> | null,
  variantCategory: ProofOfValueResult["variantCategory"],
  suite: string = "dev",
): Promise<DualQualityMeasurement> {
  logbook.log(runId, { kind: "BENCHMARK_START", experimentId: null, message: `${label} gestart (${items.length} items).` });
  const results = await scoreSuiteItems(items, modelOverride, { runId, suite, phase: label });
  const contextCheck = await runContextResolutionCheck(locationCode, modelOverride, runId);
  const agent = computeAgentQualityCategory(items, results, contextCheck);
  const breakdown = computeAgentQualityBreakdown(items, results);
  // §"BENCHMARK IS NU TE KLEIN VOOR STERKE CLAIMS": nooit alleen een
  // percentage — altijd ook pass/total en de item-ID's die de score bepalen,
  // zodat een percentage nooit misleidt over hoe weinig items erachter zitten.
  const samenvatting = Object.entries(agent)
    .filter(([k, v]) => k !== "latencyMs" && typeof v === "number")
    .map(([k, v]) => {
      const b = breakdown[k as keyof typeof breakdown];
      return b ? `${k}=${b.pass}/${b.total} (${(v as number).toFixed(0)}%, items: ${b.itemIds.join(",")})` : `${k}=${(v as number).toFixed(0)}%`;
    })
    .join(" | ");
  logbook.log(runId, { kind: "BENCHMARK_RESULT", experimentId: null, message: `${label} voltooid. ${samenvatting}` });
  return {
    agent,
    roster: rosterQualityFromMetrics(rosterMetrics, rosterNotApplicableReason(variantCategory)),
    measuredAt: new Date().toISOString(),
  };
}

export interface RunProofOfValueOptions {
  /**
   * Een kant-en-klare variant (bv. door `develop/generateCandidate.ts`
   * autonoom gegenereerd, dus niet in `PROMPT_VARIANTS` geregistreerd).
   * Heeft voorrang boven `variantId` wanneer beide gegeven zijn.
   */
  readonly variant?: PromptVariant;
  readonly variantId?: string;
  readonly locationCode?: string;
  /** §3: minimaal twee onafhankelijke POST-runs wanneer modelgedrag onderdeel is van de wijziging. */
  readonly postRuns?: number;
  /** Extern run-ID (van de CLI/dashboard) zodat het logboek van start tot eind hetzelfde ID gebruikt. Zonder dit genereert deze functie er zelf een — handig voor losse tests/scripts. */
  readonly runId?: string;
}

function meanMeasurement(runs: readonly DualQualityMeasurement[]): DualQualityMeasurement {
  const keys = Object.keys(runs[0].agent).filter((k) => k !== "latencyMs") as (keyof AgentQualityCategory)[];
  const mean = {} as Record<keyof AgentQualityCategory, number | null>;
  for (const k of keys) {
    const waarden = runs.map((r) => r.agent[k]).filter((v): v is number => typeof v === "number");
    mean[k] = waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : null;
  }
  const agent: AgentQualityCategory = { ...(mean as Omit<AgentQualityCategory, "latencyMs">), latencyMs: runs.find((r) => r.agent.latencyMs)?.agent.latencyMs ?? null };
  return { agent, roster: runs[0].roster, measuredAt: runs[runs.length - 1].measuredAt };
}

export async function runProofOfValue(options: RunProofOfValueOptions = {}): Promise<ProofOfValueResult> {
  const runId = options.runId ?? `DR-POV-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;
  const startedAt = new Date().toISOString();
  const locationCode = options.locationCode ?? defaultLocationCode();
  const variant: PromptVariant = options.variant ?? (options.variantId ? findPromptVariant(options.variantId) : null) ?? findPromptVariant("variant-a-tool-hint")!;
  const variantCategory: ProofOfValueResult["variantCategory"] = variant.category;
  const aantalPostRuns = Math.max(1, options.postRuns ?? MIN_POST_RUNS);

  // §"config geladen/DB/model/actor checks": expliciet, vóórdat er iets gemeten wordt — zodat een
  // ontbrekende dependency traceerbaar is als een eigen stap, niet alleen als een generieke ERROR verderop.
  logbook.log(runId, {
    kind: "PRECHECK",
    experimentId: null,
    message: `Configuratie gecontroleerd voor run ${runId}: lokaal model=${process.env.NS_LOCAL_LLM_URL && process.env.NS_LOCAL_LLM_MODEL ? "geconfigureerd" : "ontbreekt"}, database=${process.env.DATABASE_URL ? "geconfigureerd" : "ontbreekt"}, actor=${process.env.DEMO_ROOM_ACTOR_EMPLOYEE_NUMBER ? "geconfigureerd" : "ontbreekt"}.`,
  });

  const dev = loadSuite("dev");
  const holdout = loadSuite("holdout");
  logbook.log(runId, { kind: "SANDBOX_VARIANT", experimentId: null, message: `Sandboxvariant gekozen: ${variant.label} (${variant.category}).`, data: { variantId: variant.id } });
  logbook.log(runId, { kind: "HYPOTHESIS", experimentId: null, message: variant.description });

  let executed = true;
  let notExecutedReason: string | null = null;
  let pre: DualQualityMeasurement;
  let postRuns: DualQualityMeasurement[];
  let preHoldout: DualQualityMeasurement;
  let holdoutMeasurement: DualQualityMeasurement;

  try {
    // 1. PRE: production Lyra (control, geen override) op de bevroren dev-set én op holdout.
    pre = await measure(runId, "PRE (dev, controle)", dev.items, undefined, locationCode, null, variantCategory, "dev");
    preHoldout = await measure(runId, "PRE-holdout (controle)", holdout.items, undefined, locationCode, null, variantCategory, "holdout");

    // 2. Sandboxvariant maken (§14 hoofdapp-koppeling: systemPromptOverride, nooit productie).
    const variantModel = chatModelForVariant(variant);
    logbook.log(runId, { kind: "VARIANT_CREATED", experimentId: null, message: `Sandbox-ChatModel gebouwd via systemPromptOverride (nooit productie).` });

    // 3. POST: dezelfde bevroren dev-set, N onafhankelijke keren — nooit maar
    // één keer wanneer modelgedrag onderdeel is van de wijziging (§3). Elke
    // run wordt bewaard; er wordt hier nergens de beste uitgekozen.
    postRuns = [];
    for (let i = 0; i < aantalPostRuns; i += 1) {
      postRuns.push(await measure(runId, `POST-run ${i + 1}/${aantalPostRuns} (variant, dev)`, dev.items, variantModel, locationCode, null, variantCategory, "dev"));
    }

    // 4. Holdout: nooit gebruikt tijdens het maken van de variant.
    holdoutMeasurement = await measure(runId, "Holdout (variant)", holdout.items, variantModel, locationCode, null, variantCategory, "holdout");
  } catch (fout) {
    executed = false;
    notExecutedReason =
      `Niet uitgevoerd: ${fout instanceof Error ? fout.message : String(fout)}. ` +
      "Waarschijnlijk ontbreekt een lokaal taalmodel (NS_LOCAL_LLM_URL/NS_LOCAL_LLM_MODEL) of de database. Zie demo-room/README.md.";
    logbook.log(runId, { kind: "ERROR", experimentId: null, message: notExecutedReason });
    const leeg = await legeDualQualityMeasurement(variantCategory);
    pre = leeg;
    postRuns = [leeg];
    preHoldout = leeg;
    holdoutMeasurement = leeg;
  }

  const oordeel = beoordeelProofOfValue({ pre, postRuns, preHoldout, holdout: holdoutMeasurement, executed, variantCategory });
  const postMean = meanMeasurement(postRuns);
  logbook.log(runId, { kind: "COMPARISON", experimentId: null, message: `PRE vs. POST (gemiddeld over ${postRuns.length} run(s)) vergeleken.` });
  if (oordeel.regressions.length > 0) {
    for (const r of oordeel.regressions) logbook.log(runId, { kind: "REGRESSION_FOUND", experimentId: null, message: r });
  }
  logbook.log(runId, { kind: "PROMOTION_DECISION", experimentId: null, message: oordeel.reasoning, data: { decision: oordeel.decision } });
  if (oordeel.knownWeaknesses.length > 0) {
    logbook.log(runId, { kind: "KNOWN_WEAKNESSES", experimentId: null, message: `Blijft zwak ondanks dit besluit: ${oordeel.knownWeaknesses.join(", ")}.` });
  }
  const postVariance = computeAgentQualityVariance(postRuns.map((r) => r.agent));

  const result: ProofOfValueResult = {
    id: randomUUID(),
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    executed,
    notExecutedReason,
    variantId: variant.id,
    variantLabel: variant.label,
    variantCategory,
    frozenSetId: FROZEN_SET_ID,
    pre,
    postRuns,
    post: postMean,
    postVariance,
    preHoldout,
    holdout: holdoutMeasurement,
    regressions: oordeel.regressions,
    improvements: oordeel.improvements,
    decision: oordeel.decision,
    reasoning: oordeel.reasoning,
    knownWeaknesses: oordeel.knownWeaknesses,
  };

  await persist(result, variant, dev.items.length, holdout.items.length);
  return result;
}

async function legeDualQualityMeasurement(variantCategory: ProofOfValueResult["variantCategory"]): Promise<DualQualityMeasurement> {
  return {
    agent: {
      contextResolution: null,
      multiTurnContext: null,
      machinistTaal: null,
      toolChoice: null,
      falsePremiseCorrection: null,
      grounding: null,
      causalClaims: null,
      unnecessaryClarifications: null,
      latencyMs: null,
    },
    roster: rosterQualityFromMetrics(null, rosterNotApplicableReason(variantCategory)),
    measuredAt: new Date().toISOString(),
  };
}

/** Herbruikt door `develop/developmentCycle.ts` om `LyraVersion.benchmarkReference` te vullen. */
export function flatten(agent: DualQualityMeasurement["agent"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(agent)) {
    if (k === "latencyMs") continue;
    if (typeof v === "number") out[k] = v;
  }
  if (agent.latencyMs) {
    out.latencyP50 = agent.latencyMs.p50;
    out.latencyP95 = agent.latencyMs.p95;
  }
  return out;
}

async function persist(result: ProofOfValueResult, variant: PromptVariant, devCount: number, holdoutCount: number): Promise<void> {
  const experiment: ExperimentRecord = {
    id: result.id,
    runId: result.runId,
    timestamp: result.finishedAt,
    soort: "PROMPT_VARIANT",
    hypothesis: `Proof-of-value: ${result.variantLabel}`,
    reason: result.executed ? "Gecontroleerde PRE/POST/holdout-test van een sandboxvariant tegen productie-Lyra." : result.notExecutedReason ?? "niet uitgevoerd",
    configuration: { variantId: result.variantId, frozenSetId: result.frozenSetId, devCount, holdoutCount },
    candidateProduced: null,
    validatorResult: "NIET_VAN_TOEPASSING",
    qualityMetrics: flatten(result.post.agent),
    baselineMetrics: flatten(result.pre.agent),
    comparisonWithBaseline: Object.fromEntries(
      Object.entries(flatten(result.post.agent)).map(([k, v]) => [k, v - (flatten(result.pre.agent)[k] ?? v)]),
    ),
    outcome: !result.executed ? "INCONCLUSIVE" : result.decision === "PROMOTION_CANDIDATE" ? "SUCCESS" : result.decision === "REJECTED" ? "FAILURE" : "INCONCLUSIVE",
    failureReason: result.decision === "REJECTED" ? result.regressions.join("; ") : null,
    nextRecommendation:
      result.decision === "PROMOTION_CANDIDATE"
        ? `Bekijk het verbeteringsrapport en publiceer desgewenst via 'Publish naar Lyra' in het dashboard (of: npm run demo-room -- publish --experiment-id ${result.id} --confirm --door <naam> --rol <rol> --reden <waarom>).`
        : result.decision === "KEEP_TESTING"
          ? "Probeer een andere variant of grotere wijziging; deze liet geen aantoonbaar effect zien."
          : null,
    decision: result.decision,
  };
  appendExperiment(experiment);
  if (experiment.decision === "PROMOTION_CANDIDATE") writeImprovementReport(experiment, result, variant);

  appendBenchmarkHistory({
    timestamp: result.finishedAt,
    runLabel: result.runId,
    label: `Proof-of-value — ${result.variantLabel}`,
    benchmark: {
      runLabel: result.runId,
      measuredAt: result.finishedAt,
      suite: "dev",
      model: result.executed ? "control-vs-variant" : "niet uitgevoerd",
      itemCount: devCount,
      passCount: 0,
      failCount: 0,
      unratedCount: 0,
      passRate: averageOf(flatten(result.post.agent)),
      byCategory: {},
    },
    preDualQuality: result.pre,
    dualQuality: result.post,
    holdoutDualQuality: result.holdout,
  });

  const journal: JournalEntry = {
    experimentId: result.id,
    timestamp: result.finishedAt,
    parentVersion: CONTROL.id,
    runId: result.runId,
    problem: "Bewijs vóór een lange autonome run: werkt de meet-wijzig-hermeet-lus van de Demo Room daadwerkelijk?",
    hypothesis: `${result.variantLabel}: ${variant.description}`,
    whatChanged: `Systeeminstructie-variant "${result.variantId}" (${result.variantCategory}), via LocalModelConfig.systemPromptOverride.`,
    whyChanged: "Om te testen of een gecontroleerde sandboxwijziging meetbaar effect heeft, in beide richtingen — verbetering en regressie tellen allebei als geldig resultaat.",
    // Statische, hand-geschreven varianten staan echt in promptVariants.ts; een
    // autonoom gegenereerde kandidaat (develop/generateCandidate.ts) staat daar
    // NIET — findPromptVariant() zou die dus nooit terugvinden. Verwijs dan
    // naar de letterlijke tekst zelf (die al in whatChanged/productionText
    // staat), niet naar een bestandslocatie die de wijziging niet bevat.
    diffReference: findPromptVariant(variant.id) ? `demo-room/src/variants/promptVariants.ts#${variant.id}` : `gegenereerde kandidaat "${variant.id}" — zie whatChanged/promptOverrideText, niet in promptVariants.ts geregistreerd`,
    benchmarkBefore: flatten(result.pre.agent),
    benchmarkAfter: flatten(result.post.agent),
    changePerCategory: Object.fromEntries(
      Object.entries(flatten(result.post.agent)).map(([k, v]) => {
        const voor = flatten(result.pre.agent)[k];
        if (voor === undefined) return [k, "ONVERANDERD"];
        return [k, v > voor + 3 ? "BETER" : v < voor - 3 ? "SLECHTER" : "ONVERANDERD"];
      }),
    ),
    newErrors: result.executed ? [] : [result.notExecutedReason ?? "onbekende fout"],
    decision: result.decision,
    rollback: "Geen productiecode gewijzigd — de variant leeft alleen in het geheugen van dit testproces (systemPromptOverride, nooit gezet door localConfigFromEnv()).",
    humanSummary: `${result.reasoning} (${result.postRuns.length} onafhankelijke POST-run(s); ${varianceSummary(result)})${result.knownWeaknesses.length > 0 ? ` KNOWN WEAKNESSES AFTER RUN: ${result.knownWeaknesses.join(", ")}.` : ""}`,
  };
  writeJournalEntry(journal);
}

/**
 * Iedere `PROMOTION_CANDIDATE` krijgt automatisch een Verbeteringsrapport in
 * drie leesniveaus (§ aanvulling "VERPLICHT — UITLEGBARE VERBETERINGEN").
 */
function writeImprovementReport(experiment: ExperimentRecord, result: ProofOfValueResult, variant: PromptVariant): void {
  const dir = path.join(REPORTS_DIR, "improvements");
  mkdirSync(dir, { recursive: true });
  const preVersion = getVersion(currentVersionId());
  const input = {
    experiment,
    variantLabel: result.variantLabel,
    variantDescription: variant.description,
    preVersion,
    candidateChanges: [`Systeeminstructie-toevoeging "${result.variantId}" (${result.variantCategory}) — nog niet gepubliceerd, alleen sandbox-gemeten.`],
  };
  writeFileSync(path.join(dir, `${experiment.id}-jonathan.md`), renderForJonathan(input), "utf8");
  writeFileSync(path.join(dir, `${experiment.id}-technisch.md`), renderForClaude(input), "utf8");
  writeFileSync(path.join(dir, `${experiment.id}-machine.json`), `${JSON.stringify(buildImprovementReportJson(input), null, 2)}\n`, "utf8");
}

/** §3: variantie altijd expliciet noemen, nooit alleen het gemiddelde tonen alsof het één zekere meting was. */
function varianceSummary(result: ProofOfValueResult): string {
  if (result.postRuns.length <= 1) return "geen spreiding te melden bij één run";
  const relevante = Object.entries(result.postVariance).filter(([k, v]) => k !== "latencyMs" && v !== null) as [string, { min: number; max: number; stddev: number }][];
  if (relevante.length === 0) return "geen variantie berekend";
  const grootste = relevante.reduce((a, b) => (b[1].stddev > a[1].stddev ? b : a));
  return `grootste spreiding: ${grootste[0]} (${grootste[1].min.toFixed(1)}–${grootste[1].max.toFixed(1)}, sd ${grootste[1].stddev.toFixed(2)})`;
}

function averageOf(o: Record<string, number>): number {
  const waarden = Object.values(o).filter((v) => Number.isFinite(v));
  return waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : 0;
}
