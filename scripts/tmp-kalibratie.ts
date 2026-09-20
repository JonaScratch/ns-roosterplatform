import "dotenv/config";
import { prisma } from "@/server/data/prisma";
import { decodeAssignments, readRuns } from "./benchmark/io";
import { evaluateAssignmentsCore, evaluateOfficialCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import type { HumanQualityReport } from "@/domain/quality-evaluator";
function toon(naam: string, r: HumanQualityReport) {
  console.log(`\n== ${naam}: overall ${r.overall} robust ${r.robust} hard ${r.hardValidity.hardValid} pattern ${r.patternDistance?.total}`);
  console.log("  ", Object.entries(r.components).map(([k, v]) => `${k} ${v.score} ${JSON.stringify(v.parts)}`).join("\n   "));
  const t = r.metrics.transitions, n = r.metrics.nights, h = r.metrics.hours;
  console.log(`   nachten ${n.total} blokken ${n.blocks} los ${n.singletons} 2:${n.blocks2} 3:${n.blocks3} 4:${n.blocks4} 5+:${n.blocks5plus} buiten ${n.outsideNightRosters}`);
  console.log(`   overgangen: gewerkt ${t.workedDays} paren ${t.adjacentWorkedPairs} stabiel ${t.stablePairs} straf ${t.penaltyTotal} zwaar ${t.heavy} N>V ${t.nightToEarly} L>V ${t.lateToEarly} streak ${t.averageStreak?.toFixed(2)} wissel/dag ${t.switchesPerWorkedDay.toFixed(3)}`);
  console.log(`   rust banden ${JSON.stringify(r.metrics.rest.bands)} kortste ${r.metrics.rest.shortestSurplusMinutes} herstel ${r.metrics.rest.recovery.map((x) => Math.round(x.minutes / 60)).join(",")}`);
  console.log(`   uren rooster ${h.rosters.map((x) => `${x.code}:${x.deviationMinutes}`).join(" ")} | regels mad ${h.lineStats.mean.toFixed(0)} max ${h.lineStats.max.toFixed(0)} ±30 buiten ${h.lineStats.outside30}/${h.lineStats.n}`);
  console.log(`   regels: slechtste ${r.lines.worst?.roster} ${r.lines.worst?.lineNumber} ${r.lines.worst?.score?.toFixed(1)} ${JSON.stringify(r.lines.worst?.parts)} mediaan ${r.lines.median?.toFixed(1)}`);
  console.log(`   diagnose: ${r.diagnosis.join(" | ")}`);
}
async function main() {
  const ctx = await loadEvaluationContextCore("DDR");
  console.log("regels", ctx.rules, "vereist", ctx.requiredDutyKeys.length);
  toon("OFFICIEEL", evaluateOfficialCore(ctx));
  for (const run of readRuns("before")) {
    for (const k of run.candidates) toon(`${run.strategy} run ${run.runNumber} kandidaat ${k.number}`, evaluateAssignmentsCore(decodeAssignments(k.roster), ctx));
  }
  await prisma.$disconnect();
}
main();
