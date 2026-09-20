import "dotenv/config";
import { prisma } from "@/server/data/prisma";

/** Welke opdracht per strategie de nieuwste is in de database (wat verify-kwaliteit toetst). */
async function main() {
  const opdrachten = await prisma.generationRun.findMany({
    where: { locationCode: "DDR", kind: "GENERATE", status: { in: ["COMPLETED", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, strategy: true, createdAt: true, searchMode: true, ablation: true, candidates: { select: { candidateNumber: true, optimizerModelVersion: true }, where: { archivedAt: null } } },
  });
  for (const o of opdrachten) console.log(o.createdAt.toISOString(), o.strategy.padEnd(13), o.searchMode, o.candidates.length, o.candidates[0]?.optimizerModelVersion ?? "-");
  await prisma.$disconnect();
}
main();
