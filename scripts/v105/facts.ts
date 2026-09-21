import "dotenv/config";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";

/** Echte feiten om testitems op te baseren (v1.0.5 intelligentiebenchmark). */
async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const kandidaat = await prisma.candidateRoster.findFirst({ where: { validationState: "TECHNICALLY_VALIDATED" }, orderBy: { generatedAt: "desc" }, select: { id: true, scenarioLabel: true, generatedAt: true, optimizerVersion: true, generationRunId: true } });
  console.log("nieuwste geldige kandidaat:", kandidaat?.id.slice(0, 8), kandidaat?.scenarioLabel, kandidaat?.generatedAt.toISOString().slice(0, 16));
  const off = context.quality.official;
  const laat = off.find((r) => r.code === "DDR-L")!;
  const regel4 = laat.days.filter((d) => d.lineNumber === 4).sort((a, b) => a.weekday - b.weekday);
  console.log("DDR-L regel 4 (officieel):");
  for (const d of regel4) {
    const duty = d.dutyCode ? context.quality.duties.get(`${d.dutyCode}|${d.weekday}`) : null;
    const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    console.log(`  dag ${d.weekday} ${d.positionType} ${d.dutyCode ?? ""} ${duty ? `${hm(duty.startMinute)}-${hm(duty.endMinute)} ${duty.kinds.join("/")}` : ""}`);
  }
  // Rangeerdiensten per rooster in het officiële rooster.
  const rangeer: Record<string, number> = {};
  for (const r of off) {
    let n = 0;
    for (const d of r.days) { const duty = d.dutyCode ? context.quality.duties.get(`${d.dutyCode}|${d.weekday}`) : null; if (duty?.kinds.includes("RANGEER")) n += 1; }
    rangeer[r.code] = n;
  }
  console.log("rangeer per rooster (officieel):", JSON.stringify(rangeer));
  // Een nachtreeks en een vrijdag vóór een vrij weekend.
  const mix = off.find((r) => r.code === "DDR-MIX")!;
  const nachten = mix.days.filter((d) => { const duty = d.dutyCode ? context.quality.duties.get(`${d.dutyCode}|${d.weekday}`) : null; return duty?.kinds.includes("NACHT"); }).map((d) => `${d.lineNumber}/${d.weekday}:${d.dutyCode}`);
  console.log("DDR-MIX nachten:", nachten.join(" "));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
