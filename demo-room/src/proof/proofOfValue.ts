import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeAgentQualityCategory, runContextResolutionCheck, scoreSuiteItems } from "../benchmark/agentQuality";
import { loadSuite } from "../benchmark/run";
import { rosterNotApplicableReason, rosterQualityFromMetrics } from "../benchmark/rosterQuality";
import { REPORTS_DIR, locationCode as defaultLocationCode } from "../config";
import { buildImprovementReportJson, renderForClaude, renderForJonathan } from "../report/improvementReport";
import { appendBenchmarkHistory } from "../store/benchmarkHistory";
import { appendExperiment } from "../store/runlog";
import { writeJournalEntry } from "../store/journal";
import { getVersion, currentVersionId } from "../publish/versions";
import { CONTROL, chatModelForVariant, findPromptVariant, type PromptVariant } from "../variants/promptVariants";
import { beoordeelProofOfValue } from "./decision";
import type { DualQualityMeasurement, ExperimentRecord, JournalEntry, ProofOfValueResult } from "../types";

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

async function measure(items: readonly Record<string, unknown>[], modelOverride: Parameters<typeof scoreSuiteItems>[1], locationCode: string, rosterMetrics: Record<string, number> | null, variantCategory: ProofOfValueResult["variantCategory"]): Promise<DualQualityMeasurement> {
  const results = await scoreSuiteItems(items, modelOverride);
  const contextCheck = await runContextResolutionCheck(locationCode, modelOverride);
  return {
    agent: computeAgentQualityCategory(items, results, contextCheck),
    roster: rosterQualityFromMetrics(rosterMetrics, rosterNotApplicableReason(variantCategory)),
    measuredAt: new Date().toISOString(),
  };
}

export interface RunProofOfValueOptions {
  readonly variantId?: string;
  readonly locationCode?: string;
}

export async function runProofOfValue(options: RunProofOfValueOptions = {}): Promise<ProofOfValueResult> {
  const runId = `DR-POV-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;
  const startedAt = new Date().toISOString();
  const locationCode = options.locationCode ?? defaultLocationCode();
  const variant: PromptVariant = (options.variantId ? findPromptVariant(options.variantId) : null) ?? findPromptVariant("variant-a-tool-hint")!;
  const variantCategory: ProofOfValueResult["variantCategory"] = variant.category;

  const dev = loadSuite("dev");
  const holdout = loadSuite("holdout");

  let executed = true;
  let notExecutedReason: string | null = null;
  let pre: DualQualityMeasurement;
  let post: DualQualityMeasurement;
  let preHoldout: DualQualityMeasurement;
  let holdoutMeasurement: DualQualityMeasurement;

  try {
    // 1. PRE: production Lyra (control, geen override) op de bevroren dev-set én op holdout.
    pre = await measure(dev.items, undefined, locationCode, null, variantCategory);
    preHoldout = await measure(holdout.items, undefined, locationCode, null, variantCategory);

    // 2. Sandboxvariant maken (§14 hoofdapp-koppeling: systemPromptOverride, nooit productie).
    const variantModel = chatModelForVariant(variant);

    // 3. POST: dezelfde bevroren dev-set, nu met de variant.
    post = await measure(dev.items, variantModel, locationCode, null, variantCategory);

    // 4. Holdout: nooit gebruikt tijdens het maken van de variant.
    holdoutMeasurement = await measure(holdout.items, variantModel, locationCode, null, variantCategory);
  } catch (fout) {
    executed = false;
    notExecutedReason =
      `Niet uitgevoerd: ${fout instanceof Error ? fout.message : String(fout)}. ` +
      "Waarschijnlijk ontbreekt een lokaal taalmodel (NS_LOCAL_LLM_URL/NS_LOCAL_LLM_MODEL) of de database. Zie demo-room/README.md.";
    const leeg = await legeDualQualityMeasurement(variantCategory);
    pre = leeg;
    post = leeg;
    preHoldout = leeg;
    holdoutMeasurement = leeg;
  }

  const oordeel = beoordeelProofOfValue({ pre, post, preHoldout, holdout: holdoutMeasurement, executed });

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
    post,
    preHoldout,
    holdout: holdoutMeasurement,
    regressions: oordeel.regressions,
    improvements: oordeel.improvements,
    decision: oordeel.decision,
    reasoning: oordeel.reasoning,
  };

  await persist(result, dev.items.length, holdout.items.length);
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

function flatten(agent: DualQualityMeasurement["agent"]): Record<string, number> {
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

async function persist(result: ProofOfValueResult, devCount: number, holdoutCount: number): Promise<void> {
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
        ? `Bekijk het verbeteringsrapport en publiceer desgewenst via 'Publish naar Lyra' in het dashboard (of: npm run demo-room -- publish --experiment-id ${result.id} --confirm).`
        : result.decision === "KEEP_TESTING"
          ? "Probeer een andere variant of grotere wijziging; deze liet geen aantoonbaar effect zien."
          : null,
    decision: result.decision,
  };
  appendExperiment(experiment);
  if (experiment.decision === "PROMOTION_CANDIDATE") writeImprovementReport(experiment, result);

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
    hypothesis: `${result.variantLabel}: ${findPromptVariant(result.variantId)?.description ?? ""}`,
    whatChanged: `Systeeminstructie-variant "${result.variantId}" (${result.variantCategory}), via LocalModelConfig.systemPromptOverride.`,
    whyChanged: "Om te testen of een gecontroleerde sandboxwijziging meetbaar effect heeft, in beide richtingen — verbetering en regressie tellen allebei als geldig resultaat.",
    diffReference: `demo-room/src/variants/promptVariants.ts#${result.variantId}`,
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
    humanSummary: result.reasoning,
  };
  writeJournalEntry(journal);
}

/**
 * Iedere `PROMOTION_CANDIDATE` krijgt automatisch een Verbeteringsrapport in
 * drie leesniveaus (§ aanvulling "VERPLICHT — UITLEGBARE VERBETERINGEN").
 */
function writeImprovementReport(experiment: ExperimentRecord, result: ProofOfValueResult): void {
  const dir = path.join(REPORTS_DIR, "improvements");
  mkdirSync(dir, { recursive: true });
  const preVersion = getVersion(currentVersionId());
  const input = {
    experiment,
    variantLabel: result.variantLabel,
    variantDescription: findPromptVariant(result.variantId)?.description ?? "",
    preVersion,
    candidateChanges: [`Systeeminstructie-toevoeging "${result.variantId}" (${result.variantCategory}) — nog niet gepubliceerd, alleen sandbox-gemeten.`],
  };
  writeFileSync(path.join(dir, `${experiment.id}-jonathan.md`), renderForJonathan(input), "utf8");
  writeFileSync(path.join(dir, `${experiment.id}-technisch.md`), renderForClaude(input), "utf8");
  writeFileSync(path.join(dir, `${experiment.id}-machine.json`), `${JSON.stringify(buildImprovementReportJson(input), null, 2)}\n`, "utf8");
}

function averageOf(o: Record<string, number>): number {
  const waarden = Object.values(o).filter((v) => Number.isFinite(v));
  return waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : 0;
}
