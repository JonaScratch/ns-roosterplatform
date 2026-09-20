import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { type RhythmMetrics, rhythmMetrics } from "@/domain/rhythm-metrics";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Menselijk ritme tegenover gegenereerd ritme.
 *
 * Meet de officiële roosters en een set gegenereerde kandidaten met precies
 * dezelfde code (`rhythm-metrics.ts`) en zet ze naast elkaar. De gegenereerde
 * kandidaten komen uit de ruwe runs van de optimizerbenchmark, dus deze
 * vergelijking kan op elk moment opnieuw worden gedraaid zonder solver.
 *
 *   npm run human-benchmark:compare -- --phase after --label v1.0.4
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

type Vlak = Record<string, number | null>;

/** De getallen die ertoe doen, plat, zodat ze te middelen zijn. */
export function plat(m: RhythmMetrics): Vlak {
  return {
    coherencePct: m.coherence === null ? null : m.coherence * 100,
    changesThroughRestPct: m.changesThroughRest === null ? null : m.changesThroughRest * 100,
    directDaypartChanges: m.directDaypartChanges,
    oscillations: m.oscillations,
    labelOnlyOscillations: m.labelOnlyOscillations,
    startJitterMean: m.startJitter.mean,
    startJitterMedian: m.startJitter.median,
    startJitterP90: m.startJitter.p90,
    startJitterOver120: m.startJitter.over120,
    startJitterPenaltyPct: m.startJitter.penalty === null ? null : m.startJitter.penalty * 100,
    nightBlocks: m.nights.blocks,
    nightValuePct: m.nights.value === null ? null : m.nights.value * 100,
    nightExitsToEarly: m.nights.exitsToEarly,
    nightMinRecoveryHours: m.nights.minRecoveryHours,
    boundaryDaypartChanges: m.boundaries.daypartChangeAcross,
    boundaryHeavy: m.boundaries.heavyAcross,
    worstTransition: m.worstTransition,
    linesWithHeavyTransition: m.worstTransitionPerLine.filter((r) => r.penalty >= 3).length,
    worstBlockSwitches: m.worstWorkBlock?.switches ?? 0,
  };
}

async function main() {
  const phase = (argument("phase") ?? "after") as "before" | "after";
  const label = argument("label") ?? phase;
  const context = await loadEvaluationContextCore(argument("location") ?? "DDR");

  const officieel = plat(rhythmMetrics(context.quality.official, context.quality.duties, context.rules));
  const kandidaten = readRuns(phase)
    .filter((run) => run.strategy !== "REPRODUCE")
    .flatMap((run) =>
      run.candidates.map((kandidaat) => ({
        run: run.runNumber,
        strategy: run.strategy,
        candidate: kandidaat.number,
        metrics: plat(rhythmMetrics(candidateRosterInputs(decodeAssignments(kandidaat.roster), context.quality), context.quality.duties, context.rules)),
      })),
    );

  const sleutels = Object.keys(officieel);
  const gemiddeld: Vlak = {};
  const slechtste: Vlak = {};
  for (const sleutel of sleutels) {
    const waarden = kandidaten.map((k) => k.metrics[sleutel]).filter((w): w is number => w !== null);
    gemiddeld[sleutel] = waarden.length ? waarden.reduce((a, b) => a + b, 0) / waarden.length : null;
    slechtste[sleutel] = waarden.length ? Math.max(...waarden) : null;
  }

  const doel = path.resolve(__dirname, "..", "..", "docs", "human-roster-benchmark", `generated-vs-official-${label}.json`);
  writeFileSync(
    doel,
    `${JSON.stringify({ schema: "ns-human-rhythm-comparison/1", label, phase, measuredAt: new Date().toISOString(), candidates: kandidaten.length, official: officieel, generatedMean: gemiddeld, generatedMax: slechtste, perCandidate: kandidaten }, null, 2)}\n`,
  );

  const t = (w: number | null | undefined, d = 1) => (w === null || w === undefined ? "—" : w.toFixed(d));
  console.log(`${label}: ${kandidaten.length} kandidaten tegen de 7 officiële roosters\n`);
  console.log("maat                              officieel   gegenereerd gem.   hoogste");
  for (const sleutel of sleutels) {
    console.log(`${sleutel.padEnd(32)} ${t(officieel[sleutel]).padStart(9)} ${t(gemiddeld[sleutel]).padStart(18)} ${t(slechtste[sleutel]).padStart(9)}`);
  }
  console.log(`\nGeschreven: ${doel}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
