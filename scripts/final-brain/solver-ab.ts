import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { prisma } from "@/server/data/prisma";
import { solverWorkers } from "@/server/generation/generation-job";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { buildOptimizerInput } from "@/server/services/simulation-service";
import { STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { measureAssignments } from "./metrics";

/**
 * De nachtrij in CP-SAT: A/B op de ruwe solveruitkomst.
 *
 * ## Wat hier wordt gemeten
 *
 * Alleen de solver, zonder bijschaven, reparatie of rangschikking: waar legt
 * CP-SAT de nachtreeksen bij welke tabel? Opstellingen:
 *
 * - `klassiek`: de tabel van v1.0.4 (bevroren);
 * - `mens1`: de menselijke tabel van H05;
 * - `mens3`, `mens5`, `mens8`: die tabel met de nachtrij × 3, × 5, × 8.
 *
 * Elke opstelling met dezelfde zaadwaarden en rekentijd. CP-SAT met acht
 * zoekdraden is niet deterministisch; vijf zaden tonen een richting.
 *
 *   npm run final-brain:solver-ab -- --seconds 40 --seeds 101,102,103,104,105 --variants klassiek,mens1,mens3,mens5,mens8
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

function opstelling(naam: string): { humanRhythm: boolean; nightExitScale: number } {
  if (naam === "klassiek") return { humanRhythm: false, nightExitScale: 1 };
  const schaal = Number(naam.replace(/^mens/, ""));
  if (!naam.startsWith("mens") || !Number.isFinite(schaal) || schaal < 1) throw new Error(`Onbekende opstelling ${naam}`);
  return { humanRhythm: true, nightExitScale: schaal };
}

async function main() {
  const seconden = Number(argument("seconds") ?? 40);
  const zaden = (argument("seeds") ?? "101,102,103,104,105").split(",").map(Number);
  const opstellingen = (argument("variants") ?? "klassiek,mens1,mens3,mens5,mens8").split(",");
  const input = await buildOptimizerInput("DDR");
  const context = await loadEvaluationContextCore("DDR");
  const profiel = SCENARIO_PROFILES.find((p) => p.key === "BALANCED")!;
  const rijen: Record<string, unknown>[] = [];

  for (const zaad of zaden) {
    // Per zaad alle opstellingen na elkaar: dan ligt een drukke machine niet
    // steeds op dezelfde opstelling.
    for (const naam of opstellingen) {
      const o = opstelling(naam);
      const optimizer = new CpSatOptimizer(profiel, seconden, {
        workers: solverWorkers(),
        seed: zaad,
        objective: { ...STRATEGY_WEIGHTS.BALANCED, startJitter: 0 },
        nightRosterCodes: context.quality.nightRosterCodes,
        explainShortfall: false,
        humanRhythm: o.humanRhythm,
        nightExitScale: o.nightExitScale,
      });
      const t0 = Date.now();
      const uitkomst = await optimizer.generate(input, `A/B ${naam} ${zaad}`);
      if (uitkomst.status !== "CANDIDATE_GENERATED") {
        rijen.push({ variant: naam, seed: zaad, status: uitkomst.status });
        console.log(`${naam} ${zaad}: geen kandidaat (${uitkomst.status})`);
        continue;
      }
      const m = measureAssignments(uitkomst.candidate.assignments, context);
      const rij = {
        variant: naam,
        seed: zaad,
        seconds: Math.round((Date.now() - t0) / 1000),
        solver: optimizer.lastExtras?.solverStatus ?? null,
        robust: m.quality.robust,
        nights: m.quality.components.nights,
        hours: m.quality.components.hours,
        fairness: m.quality.components.fairness,
        rest: m.quality.components.rest,
        flow: m.quality.components.flow,
        worstLine: m.quality.worstLine.score,
        singletons: m.nights.singletons,
        pairs: m.nights.pairs,
        exitsBelowRule: m.nights.exitsBelowRule,
        exitsToEarly: m.nights.exitsToEarly,
        worstExitValue: m.nights.worstExitValue,
        minRecoveryHours: m.nights.minRecoveryHours,
        worstExit: m.nights.worstExit,
        maxRosterHoursDeviation: m.hours.maxRosterDeviation,
        meanRosterHoursDeviation: m.hours.meanRosterDeviation,
      };
      rijen.push(rij);
      console.log(
        `${naam.padEnd(8)} ${zaad}: robuust ${rij.robust} · nachten ${rij.nights} · uren ${rij.hours} (max ${rij.maxRosterHoursDeviation} min/w) · eerlijk ${rij.fairness} · onder 46 u ${rij.exitsBelowRule} · kortste ${rij.minRecoveryHours?.toFixed(1)} u · los ${rij.singletons} · twee ${rij.pairs}`,
      );
    }
  }
  const doel = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", `solver-ab-${argument("label") ?? "nightrow"}.json`);
  writeFileSync(doel, `${JSON.stringify({ measuredAt: new Date().toISOString(), qualityModel: QUALITY_MODEL_V2.version, seconds: seconden, seeds: zaden, variants: opstellingen, rows: rijen }, null, 2)}\n`);
  console.log(`Geschreven: ${doel}`);
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
