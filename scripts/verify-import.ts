import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { runImport } from "@/server/import/duty-import";
import { toDutyCsv } from "@/server/export/duty-csv";

/**
 * De import gemeten tegen de diensten die er echt staan.
 *
 * ## De aanpak
 *
 * Het dienstenpakket van Dordrecht wordt teruggeschreven naar het aanleverformaat
 * en opnieuw ingelezen. Wat eruit komt, hoort dienst voor dienst gelijk te zijn
 * aan wat erin zat. Verschilt er iets, dan verliest of verandert de verwerking
 * gegevens — en dat is precies het soort fout dat in de applicatie niet opvalt,
 * omdat alles er nog steeds uitziet als een dienstenpakket.
 *
 * Dit toetst de heenweg en de terugweg tegelijk. Een fout in één van beide valt
 * hier op; een fout in allebei op dezelfde manier niet. Daarom staan de
 * randgevallen (middernacht, dubbele nummers, formulecellen) apart in
 * `tests/import/dienstenpakket.test.ts`, waar de verwachte waarden met de hand
 * zijn opgeschreven.
 *
 * Draaien met: npm run verify:import
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const STANDPLAATS = "DDR";

async function main(): Promise<void> {
  const pakket = await prisma.dutyPackage.findFirst({
    where: { depot: STANDPLAATS },
    orderBy: { version: "desc" },
    include: { duties: { orderBy: { code: "asc" } } },
  });
  if (!pakket) {
    throw new Error(`Geen dienstenpakket gevonden voor ${STANDPLAATS}.`);
  }

  console.log(
    `Pakket ${pakket.label ?? pakket.name} v${pakket.version}: ${pakket.duties.length} diensten.`,
  );

  const csv = toDutyCsv(pakket.duties);
  const uitkomst = runImport({
    filename: "reconciliatie.csv",
    content: csv,
    locationCode: STANDPLAATS,
  });

  let mislukt = 0;
  const meld = (naam: string, goed: boolean, toelichting = "") => {
    console.log(goed ? `  ✓ ${naam}` : `  ✗ ${naam} — ${toelichting}`);
    if (!goed) {
      mislukt += 1;
    }
  };

  meld(
    "de terugweg komt door de importcontrole",
    uitkomst.importable,
    uitkomst.problems
      .filter((probleem) => probleem.severity === "BLOCKING")
      .map((probleem) => probleem.message)
      .slice(0, 3)
      .join(" | "),
  );
  meld(
    `alle ${pakket.duties.length} diensten komen terug`,
    uitkomst.duties.length === pakket.duties.length,
    `${uitkomst.duties.length} gelezen`,
  );

  // De sleutel is nummer + weekdag: op alleen het nummer zouden 223 diensten
  // op 46 sleutels terechtkomen en zou de terugweg altijd lijken te kloppen.
  const opnieuw = new Map(uitkomst.duties.map((duty) => [`${duty.code}|${duty.weekday}`, duty]));
  const verschillen: string[] = [];
  for (const origineel of pakket.duties) {
    const naam = `${origineel.code} (weekdag ${origineel.weekday})`;
    const na = opnieuw.get(`${origineel.code}|${origineel.weekday}`);
    if (!na) {
      verschillen.push(`${naam} ontbreekt na de terugweg`);
      continue;
    }
    const velden: [string, unknown, unknown][] = [
      ["weekdag", origineel.weekday, na.weekday],
      ["begintijd", origineel.startMinute, na.startMinute],
      ["eindtijd", origineel.endMinute, na.endMinute],
      ["standplaats", origineel.depot, na.depot],
      ["zwaarte", origineel.weight, na.weight],
      ["dagdeel", origineel.period, na.period],
      ["werksoort", origineel.workType, na.workType],
      ["soorten", [...origineel.kinds].sort().join(","), [...na.kinds].sort().join(",")],
      [
        "bevoegdheden",
        [...origineel.requiredQualifications].sort().join(","),
        [...na.requiredQualifications].sort().join(","),
      ],
    ];
    for (const [veld, voor, nu] of velden) {
      if (String(voor) !== String(nu)) {
        verschillen.push(`${naam}: ${veld} ${String(voor)} → ${String(nu)}`);
      }
    }
  }
  meld(
    "geen enkel veld verandert onderweg",
    verschillen.length === 0,
    verschillen.slice(0, 5).join(" | "),
  );

  // Tweede keer lezen hoort exact hetzelfde op te leveren.
  const nogmaals = runImport({
    filename: "reconciliatie.csv",
    content: csv,
    locationCode: STANDPLAATS,
  });
  meld(
    "twee keer lezen geeft hetzelfde resultaat",
    JSON.stringify(nogmaals.duties) === JSON.stringify(uitkomst.duties) &&
      JSON.stringify(nogmaals.totals) === JSON.stringify(uitkomst.totals),
    "de tweede lezing week af",
  );

  const nacht = pakket.duties.filter((duty) => duty.endMinute > 1440);
  console.log(
    `\nDiensten over middernacht: ${nacht.length}` +
      (nacht.length > 0
        ? ` (${nacht.slice(0, 5).map((duty) => `${duty.code}/wd${duty.weekday}`).join(", ")})`
        : " — geen; het middernachtgeval is hier dus niet gemeten."),
  );
  if (nacht.length > 0) {
    const fout = nacht.filter((duty) => {
      const na = opnieuw.get(`${duty.code}|${duty.weekday}`);
      return !na || na.endMinute !== duty.endMinute;
    });
    meld(
      "de nachtdiensten houden hun eindtijd voorbij middernacht",
      fout.length === 0,
      `${fout.length} nachtdiensten veranderden`,
    );
  }

  console.log(`\nTellingen: ${JSON.stringify(uitkomst.totals)}`);
  console.log(mislukt === 0 ? "\nAlles klopt." : `\n${mislukt} controles mislukt.`);
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
