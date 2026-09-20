import "dotenv/config";
import { QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { prisma } from "@/server/data/prisma";
import { evaluateAssignmentsCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { decodeAssignments, readRuns } from "../benchmark/io";
async function main() {
  const fase = process.argv[2] ?? "mp-smoke";
  const context = await loadEvaluationContextCore("DDR");
  for (const run of readRuns(fase)) {
    console.log(run.strategy, JSON.stringify((run as unknown as { variant?: unknown }).variant));
    for (const k of run.candidates) {
      const r = evaluateAssignmentsCore(decodeAssignments(k.roster), context, QUALITY_MODEL_V3);
      console.log(`  hard ${r.hardValidity.hardValid} ops ${r.operational.violations.length} uren ${r.operational.hours.map((h) => h.averageWeeklyMinutes).join("/")} robust ${r.robust} voorkeur ${r.components.preference.score} nachten ${r.components.nights.score} losse ${r.metrics.nights.singletons}`);
    }
  }
  await prisma.$disconnect();
}
main();
