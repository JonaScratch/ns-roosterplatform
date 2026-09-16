import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { buildTemplate, readDutySheet } from "@/server/import/duty-package-sheet";
import { runPdfImport, runSheetImport } from "@/server/import/duty-import";
import { readXlsx, writeXlsx } from "@/server/import/xlsx";

/**
 * De aanleverroutes van een dienstenpakket, op de echte Dordrechtse diensten.
 *
 * ## Wat dit meet dat een unittest niet meet
 *
 * De unittests werken met een handvol verzonnen diensten. Dit script haalt alle
 * 223 dienstinstanties uit de database, schrijft ze naar het sjabloon, leest het
 * sjabloon terug, en legt de uitkomst regel voor regel naast wat erin ging.
 *
 * Dat is de enige manier om te zien of er onderweg iets wegvalt. Een dienst die
 * op donderdag andere tijden heeft dan op maandag, een nummer met een
 * voorloopnul, een dienst over middernacht — het zijn juist die gevallen die in
 * een verzonnen voorbeeld ontbreken en in de echte bron de meerderheid vormen.
 *
 * Draaien met: npm run verify:pakketimport
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

let geslaagd = 0;
let mislukt = 0;
let geblokkeerd = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function blokkade(naam: string, toelichting: string): void {
  geblokkeerd += 1;
  console.log(`  ⊘ ${naam} — ${toelichting}`);
}

async function main(): Promise<void> {
  console.log("DIENSTENPAKKET — AANLEVERROUTES");
  console.log("═".repeat(66));

  const diensten = await prisma.duty.findMany({
    where: { depot: "DDR" },
    select: {
      code: true,
      weekday: true,
      startMinute: true,
      endMinute: true,
      depot: true,
      weight: true,
      requiredQualifications: true,
      description: true,
    },
    orderBy: [{ code: "asc" }, { weekday: "asc" }],
  });

  if (diensten.length === 0) {
    blokkade(
      "de echte diensten van Dordrecht",
      "BLOCKED_BY_MISSING_DATA. Geen diensten in de database; draai eerst npm run db:seed.",
    );
    afsluiten();
    return;
  }

  console.log(`\n${diensten.length} dienstinstanties op DDR.`);

  // ── 1. Het sjabloon ─────────────────────────────────────────────────────
  console.log("\n1. Het sjabloon met de echte diensten");

  const sjabloon = buildTemplate({
    locationCode: "DDR",
    timetable: "HUIDIG",
    duties: diensten,
  });
  toets("het sjabloon wordt gemaakt", sjabloon.length > 0);

  const werkmap = readXlsx(sjabloon);
  toets("het is een leesbare werkmap", werkmap.problems.length === 0, werkmap.problems.join("; "));
  toets(
    "met een blad Diensten en een blad Toelichting",
    werkmap.sheets.map((blad) => blad.name).join(",") === "Diensten,Toelichting",
    werkmap.sheets.map((blad) => blad.name).join(","),
  );

  // Sinds deze fase: één rij per dienst per weekdag, niet één rij per
  // dienstnummer. Hetzelfde nummer op een andere dag is een eigen rij — dat is
  // precies het punt van het lange formaat.
  const uniekeCodes = new Set(diensten.map((dienst) => dienst.code));
  toets(
    `er staat één rij per dienst per weekdag (${diensten.length} instanties, ${uniekeCodes.size} nummers)`,
    werkmap.sheets[0].rows.length === diensten.length + 1,
    `${werkmap.sheets[0].rows.length - 1} rijen`,
  );

  // ── 2. Heen en terug ────────────────────────────────────────────────────
  console.log("\n2. Heen en terug zonder verlies");

  const terug = readDutySheet(sjabloon, "DDR");
  toets(
    "het sjabloon leest zonder bevindingen terug",
    terug.problems.length === 0,
    terug.problems
      .slice(0, 3)
      .map((probleem) => `rij ${probleem.row}: ${probleem.message}`)
      .join(" | "),
  );
  toets(
    `alle ${diensten.length} dienstinstanties komen terug`,
    terug.duties.length === diensten.length,
    `${terug.duties.length} teruggelezen`,
  );

  // Regel voor regel vergelijken. Een telling die klopt terwijl de inhoud
  // verschoven is, is precies de fout die dit moet vinden.
  const heen = new Map(
    diensten.map((dienst) => [
      `${dienst.code}|${dienst.weekday}`,
      `${dienst.startMinute}-${dienst.endMinute}`,
    ]),
  );
  const afwijkingen: string[] = [];
  for (const dienst of terug.duties) {
    const sleutel = `${dienst.code}|${dienst.weekday}`;
    const verwacht = heen.get(sleutel);
    const gevonden = `${dienst.startMinute}-${dienst.endMinute}`;
    if (verwacht === undefined) {
      afwijkingen.push(`${sleutel} bestond niet in de bron`);
    } else if (verwacht !== gevonden) {
      afwijkingen.push(`${sleutel}: ${verwacht} werd ${gevonden}`);
    }
  }
  toets(
    "elke dienst komt terug op dezelfde weekdag met dezelfde tijden",
    afwijkingen.length === 0,
    afwijkingen.slice(0, 5).join(" | "),
  );

  const ontbrekend = [...heen.keys()].filter(
    (sleutel) => !terug.duties.some((dienst) => `${dienst.code}|${dienst.weekday}` === sleutel),
  );
  toets(
    "er is geen dienst weggevallen",
    ontbrekend.length === 0,
    `ontbreekt: ${ontbrekend.slice(0, 5).join(", ")}`,
  );

  // ── 3. De gevallen die er echt in zitten ────────────────────────────────
  console.log("\n3. De lastige gevallen uit de echte bron");

  const perNummer = new Map<string, Set<string>>();
  for (const dienst of diensten) {
    const tijden = perNummer.get(dienst.code) ?? new Set<string>();
    tijden.add(`${dienst.startMinute}-${dienst.endMinute}`);
    perNummer.set(dienst.code, tijden);
  }
  const wisselend = [...perNummer.entries()].filter(([, tijden]) => tijden.size > 1);
  if (wisselend.length === 0) {
    blokkade(
      "een dienstnummer met verschillende tijden per weekdag",
      "BLOCKED_BY_MISSING_DATA. In deze database heeft elk nummer overal dezelfde tijden.",
    );
  } else {
    const [nummer] = wisselend[0];
    const heenTijden = diensten
      .filter((dienst) => dienst.code === nummer)
      .map((dienst) => `${dienst.weekday}:${dienst.startMinute}`)
      .join(",");
    const terugTijden = terug.duties
      .filter((dienst) => dienst.code === nummer)
      .map((dienst) => `${dienst.weekday}:${dienst.startMinute}`)
      .join(",");
    toets(
      `dienst ${nummer} heeft per weekdag eigen tijden en houdt die (${wisselend.length} nummers zo)`,
      heenTijden === terugTijden,
      `${heenTijden} werd ${terugTijden}`,
    );
  }

  const overMiddernacht = diensten.filter((dienst) => dienst.endMinute > 1440);
  if (overMiddernacht.length === 0) {
    blokkade("een dienst over middernacht", "BLOCKED_BY_MISSING_DATA. Die staat er niet in.");
  } else {
    const nacht = overMiddernacht[0];
    const teruggevonden = terug.duties.find(
      (dienst) => dienst.code === nacht.code && dienst.weekday === nacht.weekday,
    );
    toets(
      `dienst ${nacht.code} loopt over middernacht en blijft dat (${overMiddernacht.length} diensten)`,
      teruggevonden?.endMinute === nacht.endMinute && teruggevonden.endMinute > 1440,
      `${nacht.endMinute} werd ${teruggevonden?.endMinute}`,
    );
  }

  const metNul = diensten.filter((dienst) => dienst.code.startsWith("0"));
  if (metNul.length === 0) {
    blokkade("een dienstnummer met voorloopnul", "BLOCKED_BY_MISSING_DATA. Die staan er niet in.");
  } else {
    toets(
      `dienstnummers met een voorloopnul houden die (${metNul.length} nummers)`,
      metNul.every((dienst) => terug.duties.some((rij) => rij.code === dienst.code)),
    );
  }

  // ── 4. De hele importstraat ─────────────────────────────────────────────
  console.log("\n4. De importstraat over het sjabloon");

  const straat = runSheetImport({
    filename: "dienstenpakket-DDR.xlsx",
    bytes: sjabloon,
    locationCode: "DDR",
  });
  toets(
    "het pakket komt door de controle",
    straat.importable,
    straat.problems
      .filter((probleem) => probleem.severity === "BLOCKING")
      .slice(0, 3)
      .map((probleem) => probleem.message)
      .join(" | "),
  );
  toets(
    `de telling klopt met de bron (${straat.totals.duties} diensten)`,
    straat.totals.duties === diensten.length,
    `${straat.totals.duties} tegenover ${diensten.length}`,
  );
  toets(
    "diensten over middernacht worden geteld en gemeld",
    straat.totals.overMidnight === overMiddernacht.length,
    `${straat.totals.overMidnight} tegenover ${overMiddernacht.length}`,
  );

  // ── 5. Wat er niet doorheen komt ────────────────────────────────────────
  console.log("\n5. Wat er niet doorheen komt");

  const hernoemd = runSheetImport({
    filename: "pakket.xlsx",
    bytes: Buffer.from("%PDF-1.7 dit is een pdf met een xlsx-naam"),
    locationCode: "DDR",
  });
  toets(
    "een hernoemde PDF gaat niet door als werkmap",
    !hernoemd.importable,
    "het bestand werd op zijn naam geloofd",
  );

  // De standplaats staat sinds deze fase niet meer per rij in het sjabloon —
  // hij komt uit de opdracht (`locationCode`), niet uit een kolom. Een dienst
  // "van een andere standplaats" kan in dit lange formaat dus niet meer per
  // ongeluk in het bestand zelf staan; die eigenschap is nu een gevolg van de
  // vorm en hoeft niet meer los getoetst te worden. Wat nog wél los getoetst
  // hoort te worden: dezelfde dienst op dezelfde dag twee keer in het bestand.
  const eersteRij = readXlsx(sjabloon).sheets[0].rows[1].map((cel) => cel.text);
  const metDubbeleRij = readXlsx(sjabloon).sheets[0].rows.map((rij) => rij.map((cel) => cel.text));
  metDubbeleRij.push(eersteRij);
  const dubbel = runSheetImport({
    filename: "pakket.xlsx",
    bytes: writeXlsx([{ name: "Diensten", rows: metDubbeleRij }]),
    locationCode: "DDR",
  });
  toets(
    "dezelfde dienst op dezelfde dag, twee keer aangeleverd, blokkeert het pakket",
    !dubbel.importable && dubbel.problems.some((probleem) => probleem.code === "DUBBEL"),
    dubbel.problems.map((probleem) => probleem.code).join(","),
  );

  const geenPdf = runPdfImport({
    filename: "pakket.pdf",
    bytes: Buffer.from("gewoon tekst, geen pdf"),
    locationCode: "DDR",
  });
  toets("iets wat geen PDF is wordt geweigerd", !geenPdf.importable);

  // ── 6. De PDF-route ─────────────────────────────────────────────────────
  console.log("\n6. De PDF-route");

  const pdfBestand = process.env.VERIFY_PAKKET_PDF;
  if (!pdfBestand) {
    blokkade(
      "een echt PDF-dienstenpakket inlezen",
      "BLOCKED_BY_MISSING_SOURCE. Er is geen PDF-dienstenpakket aangeleverd. Zet " +
        "VERIFY_PAKKET_PDF op het pad van zo'n document om deze route te meten.",
    );
  } else {
    const { readFileSync } = await import("node:fs");
    const uitkomst = runPdfImport({
      filename: pdfBestand,
      bytes: readFileSync(pdfBestand),
      locationCode: "DDR",
    });
    toets(
      "er komen diensten uit het document",
      uitkomst.duties.length > 0,
      uitkomst.problems.map((probleem) => probleem.message).join(" | "),
    );
    toets(
      "en de uitkomst vraagt altijd om nalopen",
      uitkomst.stage === "REVIEW_REQUIRED" || !uitkomst.importable,
      uitkomst.stage,
    );
  }

  afsluiten();
}

function afsluiten(): void {
  console.log(`\n${"═".repeat(66)}`);
  console.log(
    `${geslaagd} controles geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd door ` +
      "ontbrekende gegevens of bronnen.",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
