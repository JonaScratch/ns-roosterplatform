import "dotenv/config";
import { prisma } from "@/server/data/prisma";

/** Wat betekent "RET" in het Dordrechtse dienstenpakket? Feiten vóór interpretatie. */
async function main() {
  const pakket = await prisma.dutyPackage.findFirst({ where: { status: "ACTIVE" }, orderBy: { validFrom: "desc" } });
  if (!pakket) throw new Error("geen actief pakket");
  const diensten = await prisma.duty.findMany({ where: { packageId: pakket.id }, select: { code: true, kinds: true, startMinute: true, endMinute: true, description: true, depot: true, workType: true, period: true } });
  console.log(`pakket ${pakket.label ?? pakket.id} · ${diensten.length} diensten`);
  const metRet = diensten.filter((d) => /ret/i.test(d.code) || /ret/i.test(d.description ?? ""));
  console.log(`bevat "RET" in code of omschrijving: ${metRet.length}`);
  for (const d of metRet.slice(0, 10)) console.log(`  ${d.code} ${d.description ?? ""} ${d.kinds.join("/")} ${d.startMinute}-${d.endMinute}`);
  const soorten = new Map<string, number>();
  for (const d of diensten) for (const k of d.kinds) soorten.set(k, (soorten.get(k) ?? 0) + 1);
  console.log("dienstsoorten:", [...soorten].map(([k, n]) => `${k}=${n}`).join(" · "));
  const omschrijvingen = new Map<string, number>();
  for (const d of diensten) { const w = (d.description ?? "").trim(); if (w) omschrijvingen.set(w, (omschrijvingen.get(w) ?? 0) + 1); }
  console.log("omschrijvingen (top 12):", [...omschrijvingen].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} (${n})`).join(" · ") || "geen");
  console.log("voorbeeldcodes:", diensten.slice(0, 20).map((d) => d.code).join(" "));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
