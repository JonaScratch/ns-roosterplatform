import "server-only";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type ScoredItem, scoreSuiteItems } from "../benchmark/agentQuality";
import { loadSuite } from "../benchmark/run";
import { REPO_ROOT } from "../config";
import { writeHandoff } from "../store/handoff";
import { writeJournalEntry } from "../store/journal";
import * as logbook from "../store/logbook";
import { appendExperiment, readAllExperiments } from "../store/runlog";
import type { ExperimentRecord, JournalEntry, PublishResult, PublishStepResult } from "../types";
import { findPromptVariant } from "../variants/promptVariants";
import { activateVersion, createVersion, currentVersionId, getVersion, listVersions, markVersionStatus } from "./versions";

/**
 * Injecteerbare stappen — uitsluitend voor tests (§ aanvulling "Bewijs
 * rollback met een gecontroleerde failure-test"). De echte implementaties
 * (`echteTypecheck`/`echteSmokeBenchmark`) zijn de standaardwaarden; een test
 * kan een gecontroleerd falende stub meegeven zonder tsc of een lokaal
 * model/database nodig te hebben.
 */
export interface PublishSteps {
  readonly typecheck: () => void;
  readonly smokeBenchmark: () => Promise<readonly ScoredItem[]>;
}

function echteTypecheck(): void {
  execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], { cwd: REPO_ROOT, stdio: "pipe", timeout: 240_000 });
}

async function echteSmokeBenchmark(): Promise<readonly ScoredItem[]> {
  const { items } = loadSuite("dev");
  const smokeItems = items.filter((i) => SMOKE_ITEM_IDS.includes(String(i.id)));
  return scoreSuiteItems(smokeItems.length > 0 ? smokeItems : items.slice(0, 3), undefined);
}

export const DEFAULT_PUBLISH_STEPS: PublishSteps = { typecheck: echteTypecheck, smokeBenchmark: echteSmokeBenchmark };

/**
 * De veilige publicatiepijplijn (§ aanvulling "SAFE PUBLISH FLOW"):
 *
 *   promotion candidate → preflight → backup → productiewijziging toepassen
 *   → typecheck/tests → smoke benchmark → grondings-/veiligheidscontrole
 *   → succes (nieuwe Production Lyra) of automatische rollback.
 *
 * Wordt uitsluitend aangeroepen ná een expliciete `Publiceren`-bevestiging
 * van een mens (UI/CLI) — nooit door de Demo Room op eigen initiatief. Zie
 * `demo-room/docs/SAFETY-BOUNDARIES.md`.
 */

const SMOKE_ITEM_IDS = ["DR-DEV-04", "DR-DEV-05", "DR-DEV-06"]; // klein, vast, bevat een grounding- en een false-premise-item

function stap(step: PublishStepResult["step"], status: PublishStepResult["status"], detail: string): PublishStepResult {
  return { step, status, detail, at: new Date().toISOString() };
}

export interface PublishOptions {
  /** Voor logboek-continuïteit met de CLI/dashboard-run die dit aanriep. Zonder dit: een eigen ID. */
  readonly runId?: string;
  /** Uitsluitend voor tests — zie `PublishSteps`. */
  readonly steps?: PublishSteps;
}

export async function publishExperiment(experimentId: string, options: PublishOptions = {}): Promise<PublishResult> {
  const publishId = randomUUID();
  const runId = options.runId ?? `DR-PUBLISH-${publishId.slice(0, 8)}`;
  const uitvoering = options.steps ?? DEFAULT_PUBLISH_STEPS;
  const startedAt = new Date().toISOString();
  const steps: PublishStepResult[] = [];
  const log: string[] = [];
  const noteer = (regel: string) => log.push(`[${new Date().toISOString()}] ${regel}`);

  const fromVersionId = currentVersionId();
  logbook.log(runId, { kind: "PUBLISH_ATTEMPT", experimentId, message: `Publicatiepoging voor experiment ${experimentId}, huidige versie ${fromVersionId}.` });

  const stapEnLog = (step: PublishStepResult["step"], status: PublishStepResult["status"], detail: string): void => {
    steps.push(stap(step, status, detail));
    logbook.log(runId, { kind: status === "OK" ? "TEST_RESULT" : "ERROR", experimentId, message: `[${step}] ${status}: ${detail}` });
  };

  // 1. PREFLIGHT
  const experiment = readAllExperiments().find((e) => e.id === experimentId);
  if (!experiment) {
    stapEnLog("PREFLIGHT", "FAILED", `Experiment ${experimentId} niet gevonden.`);
    return afgekeurd(runId, publishId, startedAt, fromVersionId, steps, log, noteer, "Onbekend experiment.");
  }
  if (experiment.decision !== "PROMOTION_CANDIDATE") {
    stapEnLog("PREFLIGHT", "FAILED", `Experiment ${experimentId} heeft besluit ${experiment.decision}, geen PROMOTION_CANDIDATE.`);
    return afgekeurd(runId, publishId, startedAt, fromVersionId, steps, log, noteer, "Geen geldige promotion candidate.");
  }
  if (experiment.soort === "ENGINE_VARIANT") {
    stapEnLog("PREFLIGHT", "FAILED", "ENGINE_VARIANT-experimenten publiceren via NS_ENGINE_PROFILE/NS_ENGINE_VARIANT (zie promotieStappen() in de hoofdapp), niet via deze pijplijn.");
    return afgekeurd(runId, publishId, startedAt, fromVersionId, steps, log, noteer, "Verkeerde publicatieroute voor dit experimenttype.");
  }
  const variantId = (experiment.configuration as { variantId?: string }).variantId;
  const variant = variantId ? findPromptVariant(variantId) : null;
  if (!variant || variant.productionText === null) {
    stapEnLog("PREFLIGHT", "FAILED", `Kan de exacte, gebenchmarkte variant niet terugvinden voor experiment ${experimentId} (variantId: ${variantId ?? "onbekend"}).`);
    return afgekeurd(runId, publishId, startedAt, fromVersionId, steps, log, noteer, "Kandidaattekst niet reproduceerbaar — nooit publiceren wat niet exact is teruggevonden.");
  }
  if (listVersions().some((v) => v.sourceExperimentId === experimentId && v.status === "ACTIVE")) {
    stapEnLog("PREFLIGHT", "FAILED", "Dit experiment is al de actieve productieversie.");
    return afgekeurd(runId, publishId, startedAt, fromVersionId, steps, log, noteer, "Al gepubliceerd.");
  }
  stapEnLog("PREFLIGHT", "OK", `Experiment ${experimentId} (${variant.label}) is een geldige, exact reproduceerbare promotion candidate.`);
  noteer(`Preflight geslaagd voor ${experimentId} (${variant.label}).`);

  // 2. BACKUP (het herstelpunt is de huidige actieve versie zelf — al onveranderlijk vastgelegd)
  const backupVersion = getVersion(fromVersionId);
  if (!backupVersion) {
    stapEnLog("BACKUP", "FAILED", `Kan de huidige actieve versie (${fromVersionId}) niet terugvinden — publicatie geblokkeerd zonder herstelpunt.`);
    return afgekeurd(runId, publishId, startedAt, fromVersionId, steps, log, noteer, "Geen herstelpunt beschikbaar.");
  }
  stapEnLog("BACKUP", "OK", `Herstelpunt: ${backupVersion.id} (status ${backupVersion.status}).`);
  logbook.log(runId, { kind: "BACKUP", experimentId, message: `Herstelpunt bevestigd: ${backupVersion.id}.` });
  noteer(`Backup bevestigd: ${backupVersion.id}.`);

  // De nieuwe versie wordt eerst als SUPERSEDED vastgelegd (createVersion()) en
  // pas hierna geactiveerd — zo bestaat het bestand ook als APPLY of later faalt.
  const nieuweVersie = createVersion({
    sourceExperimentId: experimentId,
    variantId: variant.id,
    promptOverrideText: variant.productionText,
    benchmarkReference: {
      pre: experiment.baselineMetrics ?? {},
      post: experiment.qualityMetrics ?? {},
      holdout: {},
    },
    changedFiles: ["NS_PRODUCTION_PROMPT_FILE (systeeminstructie-toevoeging)"],
    knownIssues: [],
    reasonForPromotion: experiment.nextRecommendation ?? experiment.reason,
  });

  // 3. APPLY
  try {
    activateVersion(nieuweVersie.id);
    stapEnLog("APPLY", "OK", `${nieuweVersie.id} is nu de actieve productieversie.`);
    logbook.log(runId, {
      kind: "CHANGE_APPLIED",
      experimentId,
      message: `Systeeminstructie bijgewerkt.`,
      change: { beforeVersion: fromVersionId, afterVersion: nieuweVersie.id, affectedFiles: ["NS_PRODUCTION_PROMPT_FILE"], causedByExperimentId: experimentId, rollbackReference: fromVersionId, diffReference: null },
    });
    noteer(`Toegepast: ${fromVersionId} → ${nieuweVersie.id}.`);
  } catch (fout) {
    stapEnLog("APPLY", "FAILED", fout instanceof Error ? fout.message : String(fout));
    return terugdraaien(runId, publishId, startedAt, fromVersionId, nieuweVersie.id, steps, log, noteer, "Kon de wijziging niet toepassen.");
  }

  // 4. TYPECHECK
  logbook.log(runId, { kind: "TEST_START", experimentId, message: "Typecheck gestart (npx tsc --noEmit)." });
  try {
    uitvoering.typecheck();
    stapEnLog("TYPECHECK", "OK", "Typecheck geslaagd.");
    noteer("Typecheck geslaagd.");
  } catch (fout) {
    const detail = fout instanceof Error ? fout.message.slice(0, 2000) : String(fout);
    stapEnLog("TYPECHECK", "FAILED", detail);
    return terugdraaien(runId, publishId, startedAt, fromVersionId, nieuweVersie.id, steps, log, noteer, "Typecheck faalde na publicatie.");
  }

  // 5. SMOKE BENCHMARK — via de productiepad (geen modelOverride): dit toetst
  // dat NS_PRODUCTION_PROMPT_FILE daadwerkelijk gelezen wordt en het model
  // bereikbaar is, niet alleen dat het bestand goed geschreven is.
  logbook.log(runId, { kind: "BENCHMARK_START", experimentId, message: "Smoke-benchmark gestart op de nieuwe productieversie." });
  let smokeResultaten: readonly ScoredItem[];
  try {
    smokeResultaten = await uitvoering.smokeBenchmark();
    const mislukt = smokeResultaten.filter((r) => r.graded === "FOUT");
    if (mislukt.length > 0) {
      stapEnLog("SMOKE_BENCHMARK", "FAILED", `${mislukt.length}/${smokeResultaten.length} smoke-items mislukten: ${mislukt.map((m) => m.id).join(", ")}.`);
      return terugdraaien(runId, publishId, startedAt, fromVersionId, nieuweVersie.id, steps, log, noteer, "Smoke-benchmark op de nieuwe productieversie mislukte.");
    }
    stapEnLog("SMOKE_BENCHMARK", "OK", `${smokeResultaten.length}/${smokeResultaten.length} smoke-items geslaagd.`);
    noteer("Smoke-benchmark geslaagd.");
  } catch (fout) {
    stapEnLog("SMOKE_BENCHMARK", "FAILED", `Kon niet uitvoeren: ${fout instanceof Error ? fout.message : String(fout)} (waarschijnlijk geen lokaal model/database bereikbaar — LOCAL REQUIRED).`);
    return terugdraaien(runId, publishId, startedAt, fromVersionId, nieuweVersie.id, steps, log, noteer, "Smoke-benchmark kon niet draaien.");
  }

  // 6. GROUNDING/VEILIGHEIDSCONTROLE
  const veiligheidsitems = smokeResultaten.filter((r) => r.behaviour === "missing_source" || r.behaviour === "cannot_determine" || r.behaviour === "correct_false_premise");
  const veiligheidsregressie = veiligheidsitems.some((r) => r.graded !== "GOED");
  if (veiligheidsregressie) {
    stapEnLog("GROUNDING_CHECK", "FAILED", "Eén of meer veiligheids-/groundingitems in de smoke-set faalden op de nieuwe versie.");
    logbook.log(runId, { kind: "REGRESSION_FOUND", experimentId, message: "Kritieke grondings-/veiligheidsregressie op de nieuwe versie." });
    return terugdraaien(runId, publishId, startedAt, fromVersionId, nieuweVersie.id, steps, log, noteer, "Kritieke grondings-/veiligheidsregressie.");
  }
  stapEnLog("GROUNDING_CHECK", "OK", "Geen regressie op grounding/false-premise in de smoke-set.");
  noteer("Grondingscontrole geslaagd.");

  // 7. SUCCES
  stapEnLog("CONFIRM", "OK", `Production Lyra bijgewerkt: ${fromVersionId} → ${nieuweVersie.id}.`);
  logbook.log(runId, { kind: "PUBLISH_RESULT", experimentId, message: `Publish geslaagd: ${fromVersionId} → ${nieuweVersie.id}.`, data: { outcome: "PUBLISHED" } });
  noteer(`Publish geslaagd: ${fromVersionId} → ${nieuweVersie.id}.`);
  await naPublicatie(experiment, nieuweVersie.id, fromVersionId, true);

  return { publishId, startedAt, finishedAt: new Date().toISOString(), fromVersionId, toVersionId: nieuweVersie.id, steps, outcome: "PUBLISHED", log };
}

async function terugdraaien(
  runId: string,
  publishId: string,
  startedAt: string,
  fromVersionId: string,
  toVersionId: string,
  steps: PublishStepResult[],
  log: string[],
  noteer: (regel: string) => void,
  reden: string,
): Promise<PublishResult> {
  noteer(`Publish failed: ${reden}`);
  logbook.log(runId, { kind: "PUBLISH_RESULT", experimentId: null, message: `Publish failed: ${reden}`, data: { outcome: "FAILED" } });
  noteer("Rollback started");
  logbook.log(runId, { kind: "ROLLBACK", experimentId: null, message: "Rollback started", change: { beforeVersion: toVersionId, afterVersion: fromVersionId, affectedFiles: ["NS_PRODUCTION_PROMPT_FILE"], causedByExperimentId: null, rollbackReference: fromVersionId, diffReference: null } });
  try {
    activateVersion(fromVersionId);
    // De mislukte versie blijft bestaan (voor nader onderzoek) maar wordt nooit meer als actief beschouwd.
    const mislukte = getVersion(toVersionId);
    if (mislukte) markVersionStatus(toVersionId, "FAILED");
    noteer("Rollback completed");
    logbook.log(runId, { kind: "ROLLBACK", experimentId: null, message: `Rollback completed: ${fromVersionId} is weer actief.` });
    await naPublicatie(null, fromVersionId, fromVersionId, false, reden);
    return { publishId, startedAt, finishedAt: new Date().toISOString(), fromVersionId, toVersionId, steps, outcome: "ROLLED_BACK", log };
  } catch (fout) {
    const detail = fout instanceof Error ? fout.message : String(fout);
    noteer(`Rollback failed — manual intervention required: ${detail}`);
    logbook.log(runId, { kind: "ERROR", experimentId: null, message: `Rollback failed — manual intervention required: ${detail}` });
    return { publishId, startedAt, finishedAt: new Date().toISOString(), fromVersionId, toVersionId, steps, outcome: "ROLLBACK_FAILED", log };
  }
}

async function afgekeurd(
  runId: string,
  publishId: string,
  startedAt: string,
  fromVersionId: string,
  steps: PublishStepResult[],
  log: string[],
  noteer: (regel: string) => void,
  reden: string,
): Promise<PublishResult> {
  noteer(`Publish failed vóór enige wijziging: ${reden}`);
  logbook.log(runId, { kind: "PUBLISH_RESULT", experimentId: null, message: `Publish failed vóór enige wijziging: ${reden}`, data: { outcome: "REFUSED" } });
  return { publishId, startedAt, finishedAt: new Date().toISOString(), fromVersionId, toVersionId: fromVersionId, steps, outcome: "ROLLED_BACK", log };
}

async function naPublicatie(experiment: ExperimentRecord | null, activeVersionId: string, previousVersionId: string, success: boolean, faalreden?: string): Promise<void> {
  const alleVersies = listVersions();
  const actief = alleVersies.find((v) => v.id === activeVersionId);
  const journal: JournalEntry = {
    experimentId: experiment?.id ?? randomUUID(),
    timestamp: new Date().toISOString(),
    parentVersion: previousVersionId,
    runId: experiment?.runId ?? "publish",
    problem: success ? "Een gemeten promotion candidate moest gecontroleerd naar productie." : `Publicatiepoging mislukte: ${faalreden}`,
    hypothesis: experiment?.hypothesis ?? "(rollback, geen nieuwe hypothese)",
    whatChanged: success ? `NS_PRODUCTION_PROMPT_FILE bijgewerkt naar versie ${activeVersionId}.` : `Teruggedraaid naar ${activeVersionId} na een mislukte publish.`,
    whyChanged: success ? (actief?.reasonForPromotion ?? "") : (faalreden ?? ""),
    diffReference: `demo-room/data/lyra-versions/${activeVersionId}.json`,
    benchmarkBefore: experiment?.baselineMetrics ?? {},
    benchmarkAfter: experiment?.qualityMetrics ?? {},
    changePerCategory: {},
    newErrors: success ? [] : [faalreden ?? "onbekend"],
    decision: success ? "PROMOTION_CANDIDATE" : "REJECTED",
    rollback: `Vorige versie: ${previousVersionId}. Herstellen via 'Lyra-versies' in het dashboard of \`npm run demo-room -- rollback --version-id ${previousVersionId}\`.`,
    humanSummary: success
      ? `Production Lyra bijgewerkt: ${previousVersionId} → ${activeVersionId}.`
      : `Publicatie van ${activeVersionId === previousVersionId ? "een kandidaat" : activeVersionId} is mislukt en teruggedraaid naar ${previousVersionId}. Reden: ${faalreden}.`,
  };
  writeJournalEntry(journal);

  if (experiment) {
    appendExperiment({ ...experiment, id: randomUUID(), timestamp: new Date().toISOString(), decision: success ? "PROMOTION_CANDIDATE" : "REJECTED", outcome: success ? "SUCCESS" : "FAILURE", failureReason: success ? null : (faalreden ?? null) });
  }

  const kandidaten = readAllExperiments().filter((e) => e.decision === "PROMOTION_CANDIDATE");
  writeHandoff({
    generatedAt: new Date().toISOString(),
    bestSandboxVariant: kandidaten[0]?.id ?? null,
    productionVariant: `${activeVersionId}${actief?.variantId ? ` (${actief.variantId})` : ""}`,
    bestSandboxDiff: kandidaten[0]?.comparisonWithBaseline ?? null,
    bestSandboxWhyBetter: kandidaten[0]?.nextRecommendation ?? null,
    unpromotedExperiments: kandidaten,
    bestBenchmarkScore: null,
    knownWeaknesses: actief?.knownIssues ?? [],
    recentExperiments: [...readAllExperiments()].reverse().slice(0, 10),
    openHypotheses: [],
    regressions: success ? [] : [faalreden ?? ""],
    recommendedNextSteps: success ? ["Volg de nieuwe productieversie een tijdje via het activiteitenpaneel."] : ["Onderzoek waarom de publicatie mislukte vóór een nieuwe poging."],
  });
}

export function currentProductionVersionLabel(): string {
  const id = currentVersionId();
  const v = getVersion(id);
  return v ? `${v.id}${v.variantId ? ` (${v.variantId})` : ""}` : id;
}

/**
 * Handmatig herstel naar een eerdere versie (§ aanvulling "HANDMATIGE
 * ROLLBACK IN DE UI"). De bevestiging hoort bij de aanroeper (UI/CLI); deze
 * functie voert het pas uit. De "backup vóór herstel" is structureel al
 * gedekt: `activateVersion()` verandert nooit een bestaand versiebestand,
 * alleen de wijzer — de huidige versie blijft dus gewoon bestaan, met status
 * SUPERSEDED, en is zelf weer met deze functie terug te halen.
 */
export async function rollbackTo(versionId: string, runId?: string): Promise<{ readonly fromVersionId: string; readonly toVersionId: string }> {
  const from = currentVersionId();
  const doel = getVersion(versionId);
  const effectiefRunId = runId ?? `DR-ROLLBACK-${randomUUID().slice(0, 8)}`;
  if (!doel) {
    logbook.log(effectiefRunId, { kind: "ERROR", experimentId: null, message: `Herstel geweigerd: onbekende versie ${versionId}.` });
    throw new Error(`Onbekende versie: ${versionId}`);
  }
  logbook.log(effectiefRunId, { kind: "ROLLBACK", experimentId: null, message: `Handmatig herstel: ${from} → ${versionId}.`, change: { beforeVersion: from, afterVersion: versionId, affectedFiles: ["NS_PRODUCTION_PROMPT_FILE"], causedByExperimentId: null, rollbackReference: from, diffReference: null } });
  activateVersion(versionId);
  await naPublicatie(null, versionId, from, true);
  logbook.log(effectiefRunId, { kind: "ROLLBACK", experimentId: null, message: "Rollback completed (handmatig)." });
  return { fromVersionId: from, toVersionId: versionId };
}
