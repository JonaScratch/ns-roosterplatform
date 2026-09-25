import "dotenv/config";
import "server-only";
import { randomUUID } from "node:crypto";
import { CHALLENGES, findChallenge } from "./challenges/catalogue";
import { runChatbotChallenge } from "./challenges/engine";
import { startAutonomousRun, awaitAutonomousRun } from "./research/autonomousRun";
import type { RebuildGoal } from "@/server/optimizer/objective-weights";
import { runSuite, runSuiteWithVariance } from "./benchmark/run";
import { writeHandoff } from "./store/handoff";
import { readAllExperiments } from "./store/runlog";
import { writeJournalEntry } from "./store/journal";
import { vindDuplicaat } from "./store/experimentMemory";
import type { ExperimentRecord, JournalEntry } from "./types";

/**
 * De Demo Room-CLI (zie demo-room/README.md voor de exacte commando's).
 *
 *   npx tsx --conditions=react-server demo-room/src/cli.ts <commando> [opties]
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
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

  const runId = `DR-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;

  if (challenge.track === "CHATBOT") {
    console.log(`Challenge ${challenge.id} (${challenge.name}) — spoor A, run ${runId}`);
    const result = await runChatbotChallenge(challenge, runId);
    console.log(JSON.stringify(result, null, 2));
    console.log(result.allHiddenInvariantsPassed ? "GESLAAGD (alle verborgen criteria gehaald)" : "NIET GESLAAGD — zie hiddenInvariantResults");
    return;
  }

  console.log(`Challenge ${challenge.id} (${challenge.name}) — spoor B, run ${runId}, budget ${challenge.computeBudgetMinutes} min`);
  const { loopId, budget, duplicateWarning } = await startAutonomousRun({
    minutes: challenge.computeBudgetMinutes,
    goal: challenge.researchGoal?.goal ?? challenge.name,
    goals: (challenge.researchGoal?.goals ?? []) as RebuildGoal[],
    searchMode: challenge.researchGoal?.searchMode ?? "NORMAL",
  });
  if (duplicateWarning) console.log(`Let op: ${duplicateWarning}`);
  console.log(`Onderzoekslus gestart: ${loopId}. Wachten tot budget op is of de lus zelf stopt...`);
  const uitkomst = await awaitAutonomousRun(runId, loopId, budget);
  console.log(JSON.stringify(uitkomst, null, 2));
}

async function cmdAutonomous(): Promise<void> {
  const minutes = Number(arg("minutes", "10"));
  const goal = arg("goal", "Zelfgekozen verbetering van het volledige pakket")!;
  const goalsArg = arg("goals", "KEEP_GOOD_PARTS")!;
  const searchMode = (arg("search-mode", "NORMAL") as "FAST" | "NORMAL" | "DEEP" | "EXTENSIVE")!;
  const runId = `DR-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;

  console.log(`Autonome run gestart (${minutes} minuten): "${goal}"`);
  const { loopId, budget, duplicateWarning } = await startAutonomousRun({
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
}

async function cmdBenchmark(): Promise<void> {
  const suite = (arg("suite", "dev") as "dev" | "holdout" | "hidden")!;
  const runs = Number(arg("runs", "1"));
  const label = arg("label", `DR-BENCH-${Date.now()}`)!;
  console.log(`Benchmark ${suite}, ${runs} run(s), label ${label}...`);
  if (runs > 1) {
    const variance = await runSuiteWithVariance(suite, { runLabel: label, modelName: "lokaal" }, runs);
    console.log(JSON.stringify(variance, null, 2));
    console.log(`min ${variance.min.toFixed(1)} · max ${variance.max.toFixed(1)} · gemiddeld ${variance.mean.toFixed(1)} · sd ${variance.stddev.toFixed(2)}`);
  } else {
    const result = await runSuite(suite, { runLabel: label, modelName: "lokaal" });
    console.log(JSON.stringify(result, null, 2));
  }
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
    productionVariant: "lokaal:qwen3 (productie-instructie, ongewijzigd — zie model/local.ts)",
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
