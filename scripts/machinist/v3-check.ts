import "dotenv/config";
import { QUALITY_MODEL_V2, QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { prisma } from "@/server/data/prisma";
import { evaluateAssignmentsCore, evaluateOfficialCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Snelle controle van model v3 op de echte Dordrechtse gegevens: het officiële
 * rooster en de baseline (brain-after), met de rekentijd per evaluatie.
 *
 *   npx tsx --conditions=react-server scripts/machinist/v3-check.ts
 */
async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const off2 = evaluateOfficialCore(context, QUALITY_MODEL_V2);
  const off3 = evaluateOfficialCore(context, QUALITY_MODEL_V3);
  const toon = (naam: string, r: typeof off3) =>
    console.log(
      naam.padEnd(14),
      `hard ${r.hardValidity.hardValid ? "ja" : "NEE"}`,
      `robust ${r.robust}`,
      `overall ${r.overall}`,
      `nachten ${r.components.nights.score}`,
      `voorkeur ${r.components.preference.score}`,
      JSON.stringify(r.components.preference.parts),
      `slechtste regel ${r.lines.worst?.score}`,
    );
  toon("officieel v2", off2);
  toon("officieel v3", off3);
  console.log("dagdiensten verwacht/werkelijk:", JSON.stringify(Object.fromEntries(Object.keys(off3.preference.dayDuties.actual).map((k) => [k, [Number(off3.preference.dayDuties.expected[k].toFixed(2)), off3.preference.dayDuties.actual[k]]]))));
  console.log("populair:", JSON.stringify(Object.fromEntries(Object.entries(off3.preference.popular.perClass).map(([k, v]) => [k, { score: v.score, perLine: v.perLine }]))));
  console.log("restdiensten per rooster:", JSON.stringify(Object.fromEntries(Object.entries(off3.preference.perRoster).map(([k, v]) => [k, v.lessShare === null ? null : Number(v.lessShare.toFixed(3))]))));

  const runs = readRuns("brain-after").filter((r) => r.strategy !== "REPRODUCE");
  const kandidaten = runs.flatMap((r) => r.candidates.map((k) => decodeAssignments(k.roster)));
  const t0 = Date.now();
  const r3 = kandidaten.map((a) => evaluateAssignmentsCore(a, context, QUALITY_MODEL_V3));
  const ms3 = (Date.now() - t0) / kandidaten.length;
  const t1 = Date.now();
  const r2 = kandidaten.map((a) => evaluateAssignmentsCore(a, context, QUALITY_MODEL_V2));
  const ms2 = (Date.now() - t1) / kandidaten.length;
  const gem = (xs: (number | null)[]) => xs.reduce((s: number, x) => s + (x ?? 0), 0) / xs.length;
  console.log(`\nbaseline (${kandidaten.length} kandidaten): hard onder v3 ${r3.filter((r) => r.hardValidity.hardValid).length}/${r3.length}`);
  console.log(`  v2 robust ${gem(r2.map((r) => r.robust)).toFixed(2)} · v3 robust ${gem(r3.map((r) => r.robust)).toFixed(2)} · voorkeur ${gem(r3.map((r) => r.components.preference.score)).toFixed(2)}`);
  for (const deel of ["affinity", "restDuties", "dayDuties", "popularFairness", "weekendStart"] as const) {
    console.log(`  ${deel.padEnd(16)} ${gem(r3.map((r) => r.components.preference.parts[deel] ?? null)).toFixed(2)}  (officieel ${off3.components.preference.parts[deel]})`);
  }
  console.log(`  rekentijd per evaluatie: v2 ${ms2.toFixed(1)} ms, v3 ${ms3.toFixed(1)} ms`);
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
