import "dotenv/config";
import { prisma } from "@/server/data/prisma";

/** Feitelijke stand van de gegevens, voor de v1.0.5-fase-0-analyse. */
async function main() {
  const locaties = await prisma.stationLocation.findMany({ select: { code: true, name: true, planningEnabled: true, optimizerMode: true, region: { select: { code: true } } } });
  const roosters = await prisma.baseRoster.findMany({ select: { code: true, profile: true, depot: true, status: true, cycleWeeks: true, _count: { select: { lines: true } } } });
  const pakketten = await prisma.dutyPackage.findMany({ select: { id: true, depot: true, status: true, validFrom: true, label: true, _count: { select: { duties: true } } }, orderBy: { validFrom: "desc" }, take: 5 });
  const kandidaten = await prisma.candidateRoster.count();
  const runs = await prisma.generationRun.groupBy({ by: ["status"], _count: true });
  const reviews = await prisma.humanLineReview.count();
  const paren = await prisma.humanPairwisePreference.count();
  const feedback = await prisma.quarterlyFeedback.count();
  const perioden = await prisma.rosterPeriod.count();
  const gebruikers = await prisma.userAccount.count();
  console.log("locaties:", locaties.map((l) => `${l.code} (${l.name}, regio ${l.region.code}, planning ${l.planningEnabled}, optimizer ${l.optimizerMode})`).join(" · "));
  console.log("basisroosters:", roosters.map((r) => `${r.code}/${r.profile}/${r.depot}/${r.status}:${r._count.lines}regels`).join(" · "));
  console.log("dienstpakketten:", pakketten.map((p) => `${p.label ?? p.id.slice(0, 8)} ${p.depot} ${p.status} ${p.validFrom.toISOString().slice(0, 10)} (${p._count.duties} diensten)`).join(" · "));
  console.log(`kandidaten ${kandidaten} · generatieopdrachten ${JSON.stringify(runs.map((r) => [r.status, r._count]))} · regeloordelen ${reviews} · paarvergelijkingen ${paren} · kwartaalfeedback ${feedback} · roosterperioden ${perioden} · gebruikers ${gebruikers}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
