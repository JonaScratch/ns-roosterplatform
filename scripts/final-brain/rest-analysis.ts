import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { flowDays, workedPairs } from "@/domain/roster-flow";
import { prisma } from "@/server/data/prisma";
import { evaluateAssignmentsCore, evaluateOfficialCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Waar de rust vandaan komt, en waarom hij zakt als blokken samenhangender worden.
 *
 * Het onderdeel rust bestaat uit het overschot boven de geplande dagelijkse
 * rust (tussen diensten op opeenvolgende dagen), het herstel na nachtreeksen
 * en het aantal zware overgangen. Een overschot van meer dan zes uur ontstaat
 * vooral bij een wissel vroeg → laat op de volgende dag (14:00 → 14:00 is 24
 * uur); een samenhangend vroeg blok (14:00 → 06:00) geeft 16 uur, dus 3–6 uur
 * overschot. Meer samenhang betekent daardoor minder "rust" in deze maat. Dit
 * script maakt dat zichtbaar per band en per soort overgang.
 *
 *   npm run final-brain:rest-analysis -- after human-final
 */

async function main() {
  const fasen = process.argv.slice(2);
  const context = await loadEvaluationContextCore("DDR");
  const meet = (sets: { rosters: ReturnType<typeof candidateRosterInputs>; report: ReturnType<typeof evaluateOfficialCore> }[]) => {
    const n = sets.length || 1;
    const banden: Record<string, number> = {};
    const perOvergang: Record<string, { count: number; surplusMinutes: number }> = {};
    let overschot = 0;
    let herstel = 0;
    let zwaar = 0;
    let rust = 0;
    for (const s of sets) {
      rust += (s.report.components.rest.score ?? 0) / n;
      overschot += (s.report.components.rest.parts.surplus ?? 0) / n;
      herstel += (s.report.components.rest.parts.recovery ?? 0) / n;
      zwaar += (s.report.components.rest.parts.heavy ?? 0) / n;
      for (const [k, v] of Object.entries(s.report.metrics.rest.bands)) banden[k] = (banden[k] ?? 0) + v / n;
      for (const r of s.rosters) {
        for (const p of workedPairs(flowDays(r, context.quality.duties))) {
          if (p.offDaysBetween + p.resDaysBetween !== 0 || p.restMinutes === null) continue;
          const sleutel = `${p.from}→${p.to}`;
          const x = (perOvergang[sleutel] ??= { count: 0, surplusMinutes: 0 });
          x.count += 1 / n;
          x.surplusMinutes += (p.restMinutes - context.rules.minDailyRestMinutes) / n;
        }
      }
    }
    return {
      rest: rust,
      surplus: overschot,
      recovery: herstel,
      heavy: zwaar,
      bands: banden,
      adjacentByTransition: Object.fromEntries(Object.entries(perOvergang).map(([k, v]) => [k, { count: v.count, meanSurplusHours: v.count ? v.surplusMinutes / v.count / 60 : null }])),
    };
  };
  const uit: Record<string, unknown> = {
    official: meet([{ rosters: context.quality.official, report: evaluateOfficialCore(context, QUALITY_MODEL_V2) }]),
  };
  for (const fase of fasen) {
    uit[fase] = meet(
      readRuns(fase)
        .filter((r) => r.strategy !== "REPRODUCE")
        .flatMap((r) =>
          r.candidates.map((k) => {
            const a = decodeAssignments(k.roster);
            return { rosters: candidateRosterInputs(a, context.quality), report: evaluateAssignmentsCore(a, context, QUALITY_MODEL_V2) };
          }),
        ),
    );
  }
  writeFileSync(path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "rest-analysis.json"), `${JSON.stringify(uit, null, 2)}\n`);
  for (const [naam, x] of Object.entries(uit) as [string, ReturnType<typeof meet>][]) {
    const t = (v: { count: number; meanSurplusHours: number | null } | undefined) => (v ? `${v.count.toFixed(1)}× (${v.meanSurplusHours?.toFixed(1)} u)` : "—");
    console.log(`${naam.padEnd(12)} rust ${x.rest.toFixed(1)} · overschot ${x.surplus.toFixed(1)} · herstel ${x.recovery.toFixed(1)} · V→V ${t(x.adjacentByTransition["E→E"])} · V→L ${t(x.adjacentByTransition["E→L"])} · L→L ${t(x.adjacentByTransition["L→L"])}`);
  }
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
