import "dotenv/config";
import { COMPONENT_KEYS, type ComponentKey, CURRENT_QUALITY_MODEL, componentWeight } from "@/domain/quality-model";
import { type ComponentScores, rankingScore } from "@/domain/adaptive-search";
import type { HumanQualityReport } from "@/domain/quality-evaluator";
import { prisma } from "@/server/data/prisma";
import {
  type EvaluationContext,
  evaluateAssignmentsCore,
  polishAssignmentsCore,
} from "@/server/services/quality-evaluation-service";
import { decodeAssignments, readRuns, writeJson } from "./benchmark/io";
import { BENCHMARK_ROOT } from "./benchmark/io";
import path from "node:path";

/**
 * Hoeveel levert bijschaven op, en vanaf wanneer niet meer?
 *
 * Het bijschaven met ruildiensten krijgt per kandidaat een vast aantal
 * seconden. Dat getal mag geen gok zijn: deze meting neemt kandidaten uit de
 * BEFORE-meting, schaaft ze bij met oplopende budgetten en schrijft op wat elke
 * stap nog toevoegt. De uitkomst onderbouwt `polishSeconds` per modus en levert
 * de cijfers voor het hoofdstuk over afnemende meeropbrengst.
 *
 *   npm run measure:polish-budget -- --budgets 5,10,20,40,80 --candidates 4
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const modelGewichten = Object.fromEntries(
  COMPONENT_KEYS.map((key) => [key, componentWeight(CURRENT_QUALITY_MODEL, key)]),
) as Record<ComponentKey, number>;

function componenten(report: HumanQualityReport): ComponentScores {
  return Object.fromEntries(COMPONENT_KEYS.map((key) => [key, report.components[key].score])) as ComponentScores;
}

const rangschikking = (report: HumanQualityReport) =>
  rankingScore(
    componenten(report),
    report.lines.worst?.score ?? null,
    modelGewichten,
    {},
    CURRENT_QUALITY_MODEL.robust,
    report.lines.median,
  );

function feiten(report: HumanQualityReport) {
  return {
    ranking: Math.round(rangschikking(report) * 100) / 100,
    robust: report.robust,
    overall: report.overall,
    worstLine: report.lines.worst?.score ?? null,
    components: componenten(report),
    singletonNights: report.metrics.nights.singletons,
    twoNightBlocks: report.metrics.nights.blocks2,
    heavyTransitions: report.metrics.transitions.heavy,
    hoursOutside30: report.metrics.hours.lineStats.outside30,
    hoursWithin10: report.metrics.hours.lineStats.within10,
    patternDistance: report.patternDistance?.total ?? null,
    hardValid: report.hardValidity.hardValid,
  };
}

async function main() {
  const budgetten = (argument("budgets") ?? "5,10,20,40,80").split(",").map((x) => Number(x.trim()));
  const aantal = Number(argument("candidates") ?? 4);
  const context: EvaluationContext = await (
    await import("@/server/services/quality-evaluation-service")
  ).loadEvaluationContextCore(argument("location") ?? "DDR");

  // Kandidaten uit de BEFORE-meting: het beste wat de v1.0.3-engine opleverde
  // plus een paar middenmoters, zodat de winst niet alleen van uitschieters komt.
  const runs = readRuns("before").filter((run) => run.strategy === "BALANCED");
  const bronnen = runs.slice(0, aantal).map((run, index) => ({
    label: `BEFORE BALANCED run ${index + 1} kandidaat 1`,
    assignments: decodeAssignments(run.candidates[0].roster),
  }));

  const resultaten: Record<string, unknown>[] = [];
  for (const bron of bronnen) {
    const start = evaluateAssignmentsCore(bron.assignments, context);
    const rij: Record<string, unknown> = { candidate: bron.label, start: feiten(start), budgets: [] as unknown[] };
    for (const seconden of budgetten) {
      const t0 = Date.now();
      const uit = polishAssignmentsCore(bron.assignments, context, {
        score: rangschikking,
        deadline: t0 + seconden * 1000,
        seed: 4242,
      });
      (rij.budgets as unknown[]).push({
        seconds: seconden,
        wallSeconds: Math.round(((Date.now() - t0) / 1000) * 10) / 10,
        variants: uit.polish.evaluated,
        swaps: uit.polish.moves.length,
        climbs: uit.polish.climbs,
        kicks: uit.polish.kicks,
        stopReason: uit.polish.stopReason,
        gain: Math.round((uit.polish.score - uit.polish.startScore) * 100) / 100,
        after: feiten(uit.report),
      });
      const laatste = (rij.budgets as { gain: number; variants: number }[]).at(-1)!;
      console.log(
        `${bron.label} — ${String(seconden).padStart(3)} s: +${laatste.gain.toFixed(2)} rang, ` +
          `${laatste.variants} varianten, ${uit.polish.moves.length} ruilen (${uit.polish.stopReason})`,
      );
    }
    resultaten.push(rij);
  }

  const doel = path.join(BENCHMARK_ROOT, "polish-budget.json");
  writeJson(doel, {
    schema: "ns-polish-budget/1",
    measuredAt: new Date().toISOString(),
    qualityModelVersion: CURRENT_QUALITY_MODEL.version,
    budgets: budgetten,
    results: resultaten,
  });
  console.log(`\nGeschreven: ${doel}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
