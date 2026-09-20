import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { dayDutyDistribution, popularFairness } from "@/domain/machinist-preference";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Gevoeligheid van de aannames in de voorkeurslaag (design.md), op het
 * officiële rooster en de baseline:
 * - dagdiensten per profiel (gekozen) of per regel genormaliseerd;
 * - het ontbrekende gewicht van Vroeg: 0, 10 (aanname) of 20;
 * - de vloer van "populair eerlijk": 0,33, 0,5 (aanname) of 0,67.
 *
 *   npx tsx --conditions=react-server scripts/machinist/sensitivity.ts
 */
async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const duties = context.quality.duties;
  const pakketten = {
    official: [context.quality.official],
    baseline: readRuns("brain-after")
      .filter((r) => r.strategy !== "REPRODUCE")
      .flatMap((r) => r.candidates.map((k) => candidateRosterInputs(decodeAssignments(k.roster), context.quality))),
  };
  const gem = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const uit: Record<string, Record<string, number>> = {};
  for (const [naam, lijst] of Object.entries(pakketten)) {
    const r: Record<string, number> = {};
    r["dayDutyDistance.perProfile.V10"] = gem(lijst.map((p) => dayDutyDistribution(p, duties).distance ?? 0));
    r["dayDutyDistance.perLine.V10"] = gem(lijst.map((p) => dayDutyDistribution(p, duties, { perLine: true }).distance ?? 0));
    r["dayDutyDistance.perProfile.V0"] = gem(lijst.map((p) => dayDutyDistribution(p, duties, { weights: { VROEG: 0 } }).distance ?? 0));
    r["dayDutyDistance.perProfile.V20"] = gem(lijst.map((p) => dayDutyDistribution(p, duties, { weights: { VROEG: 20 } }).distance ?? 0));
    for (const vloer of [0.33, 0.5, 0.67]) r[`popularFairness.floor${vloer}`] = gem(lijst.map((p) => popularFairness(p, duties, vloer).score ?? 0));
    uit[naam] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v.toFixed(4))]));
  }
  const doel = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences", "assumption-sensitivity.json");
  writeFileSync(doel, `${JSON.stringify({ schema: "ns-machinist-sensitivity/1", measuredAt: new Date().toISOString(), baseline: "brain-after (60 kandidaten)", results: uit }, null, 2)}\n`);
  console.log(JSON.stringify(uit, null, 2));
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
