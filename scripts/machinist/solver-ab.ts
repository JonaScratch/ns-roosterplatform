import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { OPERATIONAL_REQUIREMENTS_V1 } from "@/domain/operational-requirements";
import { prisma } from "@/server/data/prisma";
import { ADAPTIVE_CONFIG } from "@/server/generation/adaptive/config";
import { solverWorkers } from "@/server/generation/generation-job";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { buildOptimizerInput } from "@/server/services/simulation-service";
import { MACHINIST_METRICS, measureMachinist } from "./metrics";

/**
 * Beslisregel M2: de schaal van de voorkeurstermen in CP-SAT, op de ruwe
 * solveruitkomst (geen bijschaven, reparatie of rangschikking).
 *
 * Opstelling zoals de zoekmachine hem nu gebruikt: menselijke overgangstabel,
 * nachtrij × 5, harde operationele eisen. Alleen de voorkeursschaal verschilt:
 * 0, 1/3, 1 en 3 × pariteit met model v3. Zelfde zaden en rekentijd per schaal;
 * per zaad alle schalen na elkaar, zodat een drukke machine niet steeds dezelfde
 * schaal treft.
 *
 *   npx tsx --conditions=react-server scripts/machinist/solver-ab.ts --seconds 40 --seeds 101,102,103,104,105 --scales 0,0.333,1,3
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

async function main() {
  const seconden = Number(argument("seconds") ?? 40);
  const zaden = (argument("seeds") ?? "101,102,103,104,105").split(",").map(Number);
  const schalen = (argument("scales") ?? "0,0.333,1,3").split(",").map(Number);
  const input = await buildOptimizerInput("DDR");
  const context = await loadEvaluationContextCore("DDR");
  const profiel = SCENARIO_PROFILES.find((p) => p.key === "BALANCED")!;
  const rijen: Record<string, unknown>[] = [];
  for (const zaad of zaden) {
    for (const schaal of schalen) {
      const optimizer = new CpSatOptimizer(profiel, seconden, {
        workers: solverWorkers(),
        seed: zaad,
        objective: { ...STRATEGY_WEIGHTS.BALANCED, startJitter: 0 },
        nightRosterCodes: context.quality.nightRosterCodes,
        explainShortfall: false,
        humanRhythm: true,
        nightExitScale: ADAPTIVE_CONFIG.humanRhythm.nightExitScale,
        operational: OPERATIONAL_REQUIREMENTS_V1,
        preference:
          schaal > 0
            ? {
                affinityWeight: schaal * ADAPTIVE_CONFIG.preferenceParity.affinityPerTenth,
                dayDutyWeight: schaal * ADAPTIVE_CONFIG.preferenceParity.dayDutyPerTenth,
              }
            : undefined,
      });
      const t0 = Date.now();
      const uitkomst = await optimizer.generate(input, `M2 schaal ${schaal} zaad ${zaad}`);
      if (uitkomst.status !== "CANDIDATE_GENERATED") {
        rijen.push({ scale: schaal, seed: zaad, status: uitkomst.status });
        console.log(`schaal ${schaal} zaad ${zaad}: geen kandidaat (${uitkomst.status})`);
        continue;
      }
      const m = measureMachinist(uitkomst.candidate.assignments, context);
      const rij: Record<string, unknown> = {
        scale: schaal,
        seed: zaad,
        seconds: Math.round((Date.now() - t0) / 1000),
        solver: optimizer.lastExtras?.solverStatus ?? null,
        operationalCompliant: m.operational.compliant,
        ...Object.fromEntries(MACHINIST_METRICS.map((x) => [x.key, x.get(m)])),
        profiles: m.profiles,
      };
      rijen.push(rij);
      console.log(
        `schaal ${String(schaal).padEnd(5)} zaad ${zaad}: voorkeur ${rij.preference} (aff ${rij.affinity}, dag ${rij.dayDuties}, rest ${rij.restDuties}) · losse ${rij.singletons} · paren ${rij.pairs} · rust ${rij.rest} · uren ${rij.hours} · eerlijk ${rij.fairness} · operationeel ${rij.operationalCompliant ? "ja" : "NEE"}`,
      );
    }
  }
  const doel = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences", "solver-ab-preference.json");
  writeFileSync(
    doel,
    `${JSON.stringify({ schema: "ns-machinist-solver-ab/1", rule: "M2", measuredAt: new Date().toISOString(), seconds: seconden, seeds: zaden, scales: schalen, parity: ADAPTIVE_CONFIG.preferenceParity, rows: rijen }, null, 2)}\n`,
  );
  console.log(`Geschreven: ${doel}`);
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
