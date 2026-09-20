import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/server/data/prisma";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { rhythmMetrics } from "@/domain/rhythm-metrics";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";
import { evaluateAssignmentsCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { buildOptimizerInput } from "@/server/services/simulation-service";
import { solverWorkers } from "@/server/generation/generation-job";

/**
 * Wat doen de nieuwe ritmetermen met de ruwe CP-SAT-uitkomst?
 *
 * Een gecontroleerde vergelijking: dezelfde zaadwaarden, dezelfde rekentijd,
 * alleen de termen uit de menselijke roosters aan of uit. Gemeten vóór het
 * bijschaven, want daar zit het effect van de solver zelf. Zo is te zien of een
 * extra term de solver helpt, niets doet, of hem binnen de tijd slechter laat
 * zoeken — dat laatste leek in de eerste rookproef te gebeuren.
 *
 *   npm run human-benchmark:solver-ab -- --seconds 40 --seeds 101,102,103
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

async function main() {
  const seconden = Number(argument("seconds") ?? 40);
  const zaden = (argument("seeds") ?? "101,102,103").split(",").map(Number);
  const opstellingen = (argument("variants") ?? "uit,aan").split(",");
  const input = await buildOptimizerInput("DDR");
  const context = await loadEvaluationContextCore("DDR");
  const profiel = SCENARIO_PROFILES.find((p) => p.key === "BALANCED")!;
  const rijen: Record<string, unknown>[] = [];

  for (const opstelling of opstellingen) {
    for (const seed of zaden) {
      // uit: zoals v1.0.4. nacht: alleen de nachtuitgang uit de menselijke
      // roosters. aan: nachtuitgang plus de begintijdsterm.
      const aan = opstelling !== "uit";
      const sprong = opstelling === "aan";
      const optimizer = new CpSatOptimizer(profiel, seconden, {
        workers: solverWorkers(),
        seed,
        objective: { ...STRATEGY_WEIGHTS.BALANCED, startJitter: sprong ? 1 : 0 },
        nightRosterCodes: context.quality.nightRosterCodes,
        explainShortfall: false,
        humanRhythm: aan,
      });
      const t0 = Date.now();
      const uitkomst = await optimizer.generate(input, `A/B ${opstelling} ${seed}`);
      const tijd = (Date.now() - t0) / 1000;
      if (uitkomst.status !== "CANDIDATE_GENERATED") {
        rijen.push({ opstelling, seed, status: uitkomst.status });
        console.log(`${opstelling} ${seed}: geen kandidaat (${uitkomst.status})`);
        continue;
      }
      const r = evaluateAssignmentsCore(uitkomst.candidate.assignments, context, QUALITY_MODEL_V2);
      const m = rhythmMetrics(candidateRosterInputs(uitkomst.candidate.assignments, context.quality), context.quality.duties, context.rules);
      const rij = {
        opstelling,
        seed,
        seconds: Math.round(tijd),
        solver: optimizer.lastExtras?.solverStatus ?? null,
        robust: r.robust,
        nights: r.components.nights.score,
        flow: r.components.flow.score,
        fairness: r.components.fairness.score,
        singletons: r.metrics.nights.singletons,
        pairs: r.metrics.nights.blocks2,
        exitsToEarly: m.nights.exitsToEarly,
        minRecoveryHours: m.nights.minRecoveryHours === null ? null : Math.round(m.nights.minRecoveryHours * 10) / 10,
        jitterMean: m.startJitter.mean === null ? null : Math.round(m.startJitter.mean),
        jitterP90: m.startJitter.p90,
      };
      rijen.push(rij);
      console.log(JSON.stringify(rij));
    }
  }
  const doel = path.resolve(__dirname, "..", "..", "docs", "human-roster-benchmark", `solver-ab-${opstellingen.join("-")}.json`);
  writeFileSync(doel, `${JSON.stringify({ measuredAt: new Date().toISOString(), seconds: seconden, seeds: zaden, rows: rijen }, null, 2)}\n`);
  console.log(`Geschreven: ${doel}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
