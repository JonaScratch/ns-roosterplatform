import "dotenv/config";
import "server-only";
import { randomUUID } from "node:crypto";
import { CHALLENGES, findChallenge } from "./challenges/catalogue";
import { runChatbotChallenge } from "./challenges/engine";
import { startAutonomousRun, awaitAutonomousRun } from "./research/autonomousRun";
import type { RebuildGoal } from "@/server/optimizer/objective-weights";
import { runSuite, runSuiteWithVariance } from "./benchmark/run";
import { runProofOfValue } from "./proof/proofOfValue";
import { runAutonomyCapabilityTest } from "./autonomy/capabilityTest";
import { currentProductionVersionLabel, publishExperiment, rollbackTo } from "./publish/safePublish";
import { listVersions } from "./publish/versions";
import { writeHandoff } from "./store/handoff";
import * as logbook from "./store/logbook";
import { readAllExperiments } from "./store/runlog";
import { writeJournalEntry } from "./store/journal";
import { vindDuplicaat } from "./store/experimentMemory";
import type { ExperimentRecord, JournalEntry, RunEndSummary, RunOutcome } from "./types";

/**
 * De Demo Room-CLI (zie demo-room/README.md voor de exacte commando's).
 *
 *   npx tsx --conditions=react-server demo-room/src/cli.ts <commando> [opties] [--run-id <id>]
 *
 * Elke "echte run" (run-challenge/autonomous/proof-of-value/benchmark/
 * publish/rollback) schrijft het volledige logboek (§ aanvulling "VERPLICHT
 * VOLLEDIG DEMO ROOM LOGBOEK"): een RUN_START-header, elke betekenisvolle
 * stap onderweg (in de aangeroepen modules zelf), en een afsluitend
 * RUN_COMPLETED/RUN_FAILED/RUN_INTERRUPTED-blok — ook bij een crash of een
 * Stop-klik (SIGTERM/SIGINT hieronder).
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function nieuwRunId(prefix: string): string {
  return arg("run-id") ?? `DR-${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${randomUUID().slice(0, 4)}`;
}

/**
 * Best-effort, uit echte vastgelegde data — nooit een verzonnen teller (§
 * "GEEN STILLE ACTIES" / §33 van de hoofdopdracht, en § flight recorder-
 * aanvulling "MODEL CALL COUNTER IS NU FOUT": eerder telde dit
 * benchmarkblokken (BENCHMARK_RESULT/TEST_RESULT), niet echte modelcalls.
 * Nu telt dit de daadwerkelijke granulaire events die `scoreSuiteItems()`/
 * `runContextResolutionCheck()` per item/beurt loggen — en toont "niet
 * gemeten" (null) wanneer een run geen enkele granulaire event had (bijv. een
 * publish/rollback-run, die geen benchmarkitems uitvoert).
 */
function deriveRunEndStats(runId: string, outcome: RunOutcome, startedAtMs: number): RunEndSummary {
  const events = logbook.readRunEvents(runId);
  const experimenten = readAllExperiments().filter((e) => e.runId === runId);
  const variantIds = new Set(
    experimenten.map((e) => (e.configuration as { variantId?: string }).variantId).filter((v): v is string => Boolean(v)),
  );
  const geaccepteerd = experimenten.filter((e) => e.decision === "PROMOTION_CANDIDATE");

  const benchAnswerCalls = events.filter((e) => e.kind === "BENCHMARK_ITEM_START").length;
  const askAgentDirectCalls = events.filter((e) => e.kind === "CONTEXT_TURN").length;
  const modelInferenceTurns = events
    .filter((e) => e.kind === "AGENT_EXECUTION_START")
    .reduce((som, e) => som + (typeof (e.data as { turnsExecuted?: number } | undefined)?.turnsExecuted === "number" ? (e.data as { turnsExecuted: number }).turnsExecuted : 1), 0);
  const toolCalls = events.filter((e) => e.kind === "TOOL_CALL").length;
  const retries = events.filter((e) => e.kind === "AUTO_RETRY").length;
  const failures = events.filter((e) => e.kind === "ERROR" || e.kind === "MODEL_RESPONSE_UNUSABLE" || e.kind === "VALIDATOR_ERROR").length;
  const heeftGranulaireData = benchAnswerCalls > 0 || askAgentDirectCalls > 0;

  const laatsteKnownWeaknesses = [...events].reverse().find((e) => e.kind === "KNOWN_WEAKNESSES");
  const knownWeaknessesAfterRun = laatsteKnownWeaknesses ? laatsteKnownWeaknesses.message.replace(/^Blijft zwak ondanks dit besluit: /, "").replace(/\.$/, "").split(", ").filter(Boolean) : [];

  return {
    outcome,
    totalDurationMs: Date.now() - startedAtMs,
    modelCalls: heeftGranulaireData ? modelInferenceTurns + askAgentDirectCalls : null,
    experiments: experimenten.length,
    optimizerJobs: events.filter((e) => e.kind === "OPTIMIZER_ACTION").length,
    variantsTested: variantIds.size,
    accepted: geaccepteerd.length,
    rejected: experimenten.filter((e) => e.decision === "REJECTED").length,
    bestVariant: geaccepteerd[0] ? ((geaccepteerd[0].configuration as { variantId?: string }).variantId ?? geaccepteerd[0].id) : null,
    productionChanged: events.some((e) => e.kind === "PUBLISH_RESULT" && (e.data as { outcome?: string } | undefined)?.outcome === "PUBLISHED"),
    openHypotheses: events.filter((e) => e.kind === "HYPOTHESIS").map((e) => e.message),
    lessonsLearned: experimenten.map((e) => e.nextRecommendation).filter((x): x is string => Boolean(x)),
    detailedCounters: {
      benchAnswerCalls: heeftGranulaireData ? benchAnswerCalls : null,
      askAgentDirectCalls: heeftGranulaireData ? askAgentDirectCalls : null,
      modelInferenceTurns: heeftGranulaireData ? modelInferenceTurns : null,
      toolCalls: heeftGranulaireData ? toolCalls : null,
      retries,
      failures,
    },
    knownWeaknessesAfterRun,
  };
}

interface RunMeta {
  readonly kind: string;
  readonly sandboxParent?: string | null;
  readonly challengeOrGoal?: string | null;
}

/**
 * Omhult één commando met het verplichte begin-/eindblok van het logboek.
 * Vangt zowel een gewone fout (RUN_FAILED) als een Stop-signaal
 * (SIGINT/SIGTERM → RUN_INTERRUPTED) af — een crash zonder dit blok laat
 * hooguit de laatst onvoltooide regel onvolledig, nooit de rest van de run.
 */
async function withRunLogbook(runId: string, meta: RunMeta, fn: () => Promise<void>): Promise<void> {
  const begin = Date.now();
  let afgehandeld = false;
  const opSignaal = (signaal: string) => {
    if (afgehandeld) return;
    afgehandeld = true;
    logbook.log(runId, { kind: "CRASH_RECOVERY", experimentId: null, message: `Stopsignaal ontvangen (${signaal}).` });
    logbook.endRun(runId, deriveRunEndStats(runId, "RUN_INTERRUPTED", begin));
    process.exit(130);
  };
  process.once("SIGINT", () => opSignaal("SIGINT"));
  process.once("SIGTERM", () => opSignaal("SIGTERM"));

  logbook.startRun(runId, {
    kind: meta.kind,
    productionVersion: currentProductionVersionLabel(),
    sandboxParent: meta.sandboxParent ?? null,
    modelConfig: process.env.NS_LOCAL_LLM_MODEL ? `lokaal:${process.env.NS_LOCAL_LLM_MODEL}` : null,
    challengeOrGoal: meta.challengeOrGoal ?? null,
  });
  console.log(`Logboek: demo-room/logs/${runId}.txt`);

  try {
    await fn();
    if (!afgehandeld) {
      afgehandeld = true;
      logbook.endRun(runId, deriveRunEndStats(runId, "RUN_COMPLETED", begin));
    }
  } catch (fout) {
    if (!afgehandeld) {
      afgehandeld = true;
      logbook.log(runId, { kind: "ERROR", experimentId: null, message: fout instanceof Error ? fout.message : String(fout) });
      logbook.endRun(runId, deriveRunEndStats(runId, "RUN_FAILED", begin));
    }
    throw fout;
  }
}

async function cmdListChallenges(): Promise<void> {
  for (const c of CHALLENGES) {
    console.log(`${c.id}\t[L${c.difficulty} ${c.track}]\t${c.name}`);
  }
}

async function cmdRunChallenge(): Promise<void> {
  const id = arg("id");
  if (!id) throw new Error("--id ontbreekt. Gebruik: run-challenge --id <challenge-id>");
  const challenge = findChallenge(id);
  if (!challenge) throw new Error(`Onbekende challenge: ${id}. Zie 'list-challenges'.`);
  const runId = nieuwRunId("CHALLENGE");

  await withRunLogbook(runId, { kind: "challenge", challengeOrGoal: `${challenge.id}: ${challenge.name}` }, async () => {
    if (challenge.track === "CHATBOT") {
      console.log(`Challenge ${challenge.id} (${challenge.name}) — spoor A, run ${runId}`);
      const result = await runChatbotChallenge(challenge, runId);
      console.log(JSON.stringify(result, null, 2));
      console.log(result.allHiddenInvariantsPassed ? "GESLAAGD (alle verborgen criteria gehaald)" : "NIET GESLAAGD — zie hiddenInvariantResults");
      return;
    }

    console.log(`Challenge ${challenge.id} (${challenge.name}) — spoor B, run ${runId}, budget ${challenge.computeBudgetMinutes} min`);
    const { loopId, budget, duplicateWarning } = await startAutonomousRun({
      runId,
      minutes: challenge.computeBudgetMinutes,
      goal: challenge.researchGoal?.goal ?? challenge.name,
      goals: (challenge.researchGoal?.goals ?? []) as RebuildGoal[],
      searchMode: challenge.researchGoal?.searchMode ?? "NORMAL",
    });
    if (duplicateWarning) console.log(`Let op: ${duplicateWarning}`);
    console.log(`Onderzoekslus gestart: ${loopId}. Wachten tot budget op is of de lus zelf stopt...`);
    const uitkomst = await awaitAutonomousRun(runId, loopId, budget);
    console.log(JSON.stringify(uitkomst, null, 2));
  });
}

async function cmdAutonomous(): Promise<void> {
  const minutes = Number(arg("minutes", "10"));
  const goal = arg("goal", "Zelfgekozen verbetering van het volledige pakket")!;
  const goalsArg = arg("goals", "KEEP_GOOD_PARTS")!;
  const searchMode = (arg("search-mode", "NORMAL") as "FAST" | "NORMAL" | "DEEP" | "EXTENSIVE")!;
  const runId = nieuwRunId("AUTONOMOUS");

  await withRunLogbook(runId, { kind: "autonomous", challengeOrGoal: goal }, async () => {
    console.log(`Autonome run gestart (${minutes} minuten): "${goal}"`);
    const { loopId, budget, duplicateWarning } = await startAutonomousRun({
      runId,
      minutes,
      goal,
      goals: goalsArg.split(",").map((g) => g.trim()) as RebuildGoal[],
      searchMode,
    });
    if (duplicateWarning) console.log(`Let op: ${duplicateWarning}`);
    console.log(`Onderzoekslus: ${loopId}. Live volgen kan via /roostercommissie/agent in de hoofdapp, of het lokale dashboard.`);
    const uitkomst = await awaitAutonomousRun(runId, loopId, budget);
    console.log(JSON.stringify(uitkomst, null, 2));
    console.log(uitkomst.status === "DONE" ? "Run afgerond." : `Run gestopt met status ${uitkomst.status} (mogelijk wandklokbudget bereikt — de lus zelf loopt door tot haar eigen maxRounds/noodrem).`);
  });
}

async function cmdBenchmark(): Promise<void> {
  const suite = (arg("suite", "dev") as "dev" | "holdout" | "hidden")!;
  const runs = Number(arg("runs", "1"));
  const label = arg("label", `DR-BENCH-${Date.now()}`)!;
  const runId = nieuwRunId("BENCH");
  await withRunLogbook(runId, { kind: "benchmark", challengeOrGoal: `benchmark:${suite}` }, async () => {
    console.log(`Benchmark ${suite}, ${runs} run(s), label ${label}...`);
    logbook.log(runId, { kind: "BENCHMARK_START", experimentId: null, message: `Benchmark ${suite} gestart, ${runs} run(s).` });
    if (runs > 1) {
      const variance = await runSuiteWithVariance(suite, { runLabel: label, modelName: "lokaal" }, runs);
      console.log(JSON.stringify(variance, null, 2));
      console.log(`min ${variance.min.toFixed(1)} · max ${variance.max.toFixed(1)} · gemiddeld ${variance.mean.toFixed(1)} · sd ${variance.stddev.toFixed(2)}`);
      logbook.log(runId, { kind: "BENCHMARK_RESULT", experimentId: null, message: `Benchmark ${suite} voltooid: gemiddeld ${variance.mean.toFixed(1)} (sd ${variance.stddev.toFixed(2)}, min ${variance.min.toFixed(1)}, max ${variance.max.toFixed(1)}).` });
    } else {
      const result = await runSuite(suite, { runLabel: label, modelName: "lokaal" });
      console.log(JSON.stringify(result, null, 2));
      logbook.log(runId, { kind: "BENCHMARK_RESULT", experimentId: null, message: `Benchmark ${suite} voltooid: ${result.passRate.toFixed(1)}%.` });
    }
  });
}

async function cmdProofOfValue(): Promise<void> {
  const variantId = arg("variant");
  const postRuns = Number(arg("post-runs", "2"));
  const runId = nieuwRunId("POV");
  await withRunLogbook(runId, { kind: "proof-of-value", sandboxParent: variantId ?? null, challengeOrGoal: "proof-of-value" }, async () => {
    console.log(`Proof-of-value gestart: production Lyra → PRE → sandboxvariant → ${postRuns}× POST (zelfde bevroren set) → holdout → regressiecontrole → besluit.`);
    const result = await runProofOfValue({ variantId, postRuns, runId });
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nBesluit: ${result.decision}\n${result.reasoning}`);
    if (!result.executed) console.log(`\nLOCAL REQUIRED: ${result.notExecutedReason}`);
  });
}

async function cmdAutonomyTest(): Promise<void> {
  const minutes = Number(arg("minutes", "10"));
  const runId = nieuwRunId("AUTONOMY");
  await withRunLogbook(runId, { kind: "autonomy-test", challengeOrGoal: "Zelfstandigheidstest: zwakte vinden, hypothese vormen, sandboxvariant testen, ervan leren." }, async () => {
    console.log(`Zelfstandigheidstest gestart (max. ${minutes} minuten): production Lyra → zelfstandige zwakteanalyse → hypothese → sandboxvariant → PRE/POST(≥2)/holdout → besluit → (indien budget over) tweede hypothese.`);
    const result = await runAutonomyCapabilityTest({ runId, maxMinutes: minutes });
    console.log(JSON.stringify({ gate: result.gate, gateReasons: result.gateReasons, cycles: result.cycles.length }, null, 2));
    console.log(`\nUitkomst: ${result.gate}\n${result.humanSummary}`);
    if (result.gate !== "AUTONOMY_GATE_PASSED") console.log(`\nLOCAL REQUIRED / let op: ${result.gateReasons.join(" ")}`);
  });
}

async function cmdVersions(): Promise<void> {
  const huidig = currentProductionVersionLabel();
  console.log(`Huidige productieversie: ${huidig}\n`);
  for (const v of listVersions()) {
    console.log(`${v.id}\t${v.status}\t${v.variantId ?? "(baseline)"}\t${v.createdAt}`);
  }
}

async function cmdPublish(): Promise<void> {
  const experimentId = arg("experiment-id");
  if (!experimentId) throw new Error("publish heeft --experiment-id nodig (zie 'demo-room report' of het dashboard voor promotion candidates).");
  if (!process.argv.includes("--confirm")) {
    console.log("Geannuleerd: geen --confirm. Demo Room publiceert nooit zonder expliciete bevestiging.");
    return;
  }
  const runId = nieuwRunId("PUBLISH");
  await withRunLogbook(runId, { kind: "publish", sandboxParent: experimentId }, async () => {
    console.log(`Publiceren van experiment ${experimentId}...`);
    console.log("Voert de veilige publicatiepijplijn uit (preflight → backup → toepassen → typecheck → smoke benchmark → grondingscontrole).");
    const result = await publishExperiment(experimentId, { runId });
    for (const stap of result.steps) console.log(`[${stap.step}] ${stap.status} — ${stap.detail}`);
    console.log(`\nUitkomst: ${result.outcome} (${result.fromVersionId} → ${result.toVersionId})`);
  });
}

async function cmdRollback(): Promise<void> {
  const versionId = arg("version-id");
  if (!versionId) throw new Error("rollback heeft --version-id nodig (zie 'demo-room versions').");
  if (!process.argv.includes("--confirm")) {
    console.log("Geannuleerd: geen --confirm. Herstel vereist expliciete bevestiging (zie demo-room/README.md).");
    return;
  }
  const runId = nieuwRunId("ROLLBACK");
  await withRunLogbook(runId, { kind: "rollback", sandboxParent: versionId }, async () => {
    const { fromVersionId, toVersionId } = await rollbackTo(versionId, runId);
    console.log(`Hersteld: ${fromVersionId} → ${toVersionId}.`);
  });
}

async function cmdJournal(): Promise<void> {
  const runId = arg("run-id");
  const problem = arg("problem");
  const hypothesis = arg("hypothesis");
  const decision = arg("decision", "KEEP_TESTING") as ExperimentRecord["decision"];
  if (!runId || !problem || !hypothesis) {
    throw new Error("journal heeft --run-id, --problem en --hypothesis nodig. Zie demo-room/README.md voor een voorbeeld.");
  }
  const entry: JournalEntry = {
    experimentId: randomUUID(),
    timestamp: new Date().toISOString(),
    parentVersion: arg("parent-version") ?? null,
    runId,
    problem,
    hypothesis,
    whatChanged: arg("what-changed", "(handmatig ingevoerd, geen automatische wijziging)")!,
    whyChanged: arg("why-changed", "(zie problem/hypothesis)")!,
    diffReference: arg("diff") ?? null,
    benchmarkBefore: {},
    benchmarkAfter: {},
    changePerCategory: {},
    newErrors: [],
    decision,
    rollback: arg("rollback", "geen codewijziging om terug te draaien — dit was een sandboxmeting")!,
    humanSummary: arg("summary", hypothesis)!,
  };
  const paden = writeJournalEntry(entry);
  console.log(`Journaalentry geschreven:\n  ${paden.historyPath}\n  ${paden.latestMdPath}\n  ${paden.latestJsonPath}`);
}

async function cmdReport(): Promise<void> {
  const alles = readAllExperiments();
  const kandidaten = alles.filter((e) => e.decision === "PROMOTION_CANDIDATE");
  const zwaktes = [...new Set(alles.filter((e) => e.outcome === "FAILURE" && e.failureReason).map((e) => e.failureReason!))];
  const open = [...new Set(alles.filter((e) => e.decision === "KEEP_TESTING").map((e) => e.hypothesis))];
  const regressies = [...new Set(alles.filter((e) => e.outcome === "FAILURE").flatMap((e) => (e.failureReason ? [e.failureReason] : [])))];

  writeHandoff({
    generatedAt: new Date().toISOString(),
    bestSandboxVariant: kandidaten[0]?.id ?? null,
    productionVariant: currentProductionVersionLabel(),
    bestSandboxDiff: kandidaten[0]?.comparisonWithBaseline ?? null,
    bestSandboxWhyBetter: kandidaten[0]?.nextRecommendation ?? null,
    unpromotedExperiments: alles.filter((e) => e.decision !== "REJECTED"),
    bestBenchmarkScore: null,
    knownWeaknesses: zwaktes,
    recentExperiments: [...alles].reverse().slice(0, 10),
    openHypotheses: open,
    regressions: regressies,
    recommendedNextSteps: kandidaten.length > 0 ? [`Beoordeel promotion candidate ${kandidaten[0].id} en zet die op de holdout-suite.`] : ["Start een korte gecontroleerde run (10 min) als er nog geen experimenten zijn."],
  });
  console.log("HANDOFF.md bijgewerkt.");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const commandos: Record<string, () => Promise<void>> = {
    "list-challenges": cmdListChallenges,
    "run-challenge": cmdRunChallenge,
    autonomous: cmdAutonomous,
    "proof-of-value": cmdProofOfValue,
    "autonomy-test": cmdAutonomyTest,
    versions: cmdVersions,
    publish: cmdPublish,
    rollback: cmdRollback,
    benchmark: cmdBenchmark,
    journal: cmdJournal,
    report: cmdReport,
  };
  const fn = cmd ? commandos[cmd] : undefined;
  if (!fn) {
    console.log(`Onbekend commando "${cmd ?? ""}". Beschikbaar: ${Object.keys(commandos).join(", ")}, server (zie server.ts).`);
    process.exitCode = 1;
    return;
  }
  await fn();
}

main().catch((fout) => {
  console.error(fout instanceof Error ? fout.message : fout);
  process.exitCode = 1;
});
