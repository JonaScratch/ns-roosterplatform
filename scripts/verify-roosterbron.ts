import "dotenv/config";
import { prisma } from "@/server/data/prisma";
import {
  type DordrechtSource,
  classificationConflicts,
  conservation,
  minutenNaarTijd,
  readDordrechtSource,
} from "@/server/import/dordrecht-source";

/**
 * Staat er in de database precies wat er op de bladen staat?
 *
 * ## Waarom dit los staat van de import
 *
 * De import kan zichzelf niet controleren. Wie de bron inleest en meteen zegt
 * dat het gelukt is, toetst alleen of de code doet wat de code doet. Dit script
 * leest de bladen opnieuw, leest de database opnieuw, en legt de twee naast
 * elkaar. Elk verschil is een bevinding — ook wanneer het verschil klein is en
 * er een goede verklaring voor lijkt te bestaan.
 *
 * ## Wat "nul onverklaarde verschillen" betekent
 *
 * Niet: er zijn geen verschillen. Wel: elk verschil dat er is, staat hier met
 * naam en toenaam, en er is er geen dat dit script niet had zien aankomen. Een
 * verschil dat pas in productie opvalt, is een verschil dat hier had moeten
 * staan.
 *
 * Draaien met: npm run verify:roosterbron
 */

const WEEKDAG = ["", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

let geslaagd = 0;
let mislukt = 0;
const verschillen: string[] = [];

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function verschil(regel: string): void {
  verschillen.push(regel);
}

async function main(): Promise<void> {
  console.log("ROOSTERS EN DIENSTEN TEGEN DE BRON");
  console.log("═".repeat(74));

  const bron = readDordrechtSource();

  // ── 1. Het dienstenpakket ────────────────────────────────────────────────
  console.log("\n1. Het dienstenpakket");
  const pakket = await prisma.dutyPackage.findFirst({
    where: { depot: "DDR", status: "ACTIVE" },
    orderBy: { version: "desc" },
    include: { duties: true },
  });

  if (!pakket) {
    console.log("  ✗ er is geen actief Dordrechts dienstenpakket. Draai eerst npm run db:seed.");
    process.exitCode = 1;
    return;
  }

  console.log(`  pakket ${pakket.label ?? pakket.name} · dienstregeling ${pakket.timetableId}`);
  toets(
    "het pakket draagt de checksum van de aangeleverde bladen",
    pakket.sourceChecksum === bron.checksum,
    `database ${pakket.sourceChecksum.slice(0, 16)}… tegenover bron ${bron.checksum.slice(0, 16)}…`,
  );
  toets(
    `het pakket bevat evenveel diensten als de bron (${bron.duties.length})`,
    pakket.duties.length === bron.duties.length,
    `${pakket.duties.length} in de database`,
  );

  // Elke dienst uit de bron één op één terugzoeken op zijn identiteit.
  const inDatabase = new Map(pakket.duties.map((duty) => [`${duty.code}|${duty.weekday}`, duty]));
  let afwijkendeDiensten = 0;
  for (const dienst of bron.duties) {
    const sleutel = `${dienst.code}|${dienst.weekday}`;
    const rij = inDatabase.get(sleutel);
    if (!rij) {
      afwijkendeDiensten += 1;
      verschil(`Dienst ${dienst.code} van ${WEEKDAG[dienst.weekday]} staat niet in de database.`);
      continue;
    }
    if (rij.startMinute !== dienst.startMinute || rij.endMinute !== dienst.endMinute) {
      afwijkendeDiensten += 1;
      verschil(
        `Dienst ${dienst.code} van ${WEEKDAG[dienst.weekday]}: bron ` +
          `${minutenNaarTijd(dienst.startMinute)}–${minutenNaarTijd(dienst.endMinute % 1440)}, ` +
          `database ${minutenNaarTijd(rij.startMinute)}–${minutenNaarTijd(rij.endMinute % 1440)}.`,
      );
    }
    inDatabase.delete(sleutel);
  }
  for (const overig of inDatabase.keys()) {
    afwijkendeDiensten += 1;
    verschil(`Dienst ${overig} staat in de database maar op geen enkel blad.`);
  }
  toets(
    "elke dienst staat met dezelfde tijden in de database als op het blad",
    afwijkendeDiensten === 0,
    `${afwijkendeDiensten} afwijkingen`,
  );

  // ── 2. De verdeling over de week ─────────────────────────────────────────
  console.log("\n2. De verdeling over de week");
  let afwijkendeDagen = 0;
  for (let weekdag = 1; weekdag <= 7; weekdag += 1) {
    const uitBron = bron.duties.filter((dienst) => dienst.weekday === weekdag).length;
    const uitDatabase = pakket.duties.filter((duty) => duty.weekday === weekdag).length;
    if (uitBron !== uitDatabase) {
      afwijkendeDagen += 1;
    }
    console.log(
      `  ${WEEKDAG[weekdag].padEnd(10)} blad ${String(uitBron).padStart(3)} · ` +
        `database ${String(uitDatabase).padStart(3)} ${uitBron === uitDatabase ? "✓" : "✗"}`,
    );
  }
  toets("de weekverdeling in de database is die van de bladen", afwijkendeDagen === 0);

  // ── 3. De roosters ───────────────────────────────────────────────────────
  console.log("\n3. De roosters");
  const roosters = await prisma.baseRoster.findMany({
    where: { depot: "DDR" },
    include: { lines: { include: { days: true }, orderBy: { lineNumber: "asc" } } },
    orderBy: { code: "asc" },
  });

  toets(
    `er staan evenveel roosters in de database als er bladen zijn (${bron.rosters.length})`,
    roosters.length === bron.rosters.length,
    `${roosters.length} in de database`,
  );

  let afwijkendeCellen = 0;
  let vergelekenCellen = 0;
  for (const bronRooster of bron.rosters) {
    const rooster = roosters.find((kandidaat) => kandidaat.code === bronRooster.code);
    if (!rooster) {
      verschil(`Rooster ${bronRooster.code} (${bronRooster.sheet}) staat niet in de database.`);
      afwijkendeCellen += bronRooster.cellCount;
      continue;
    }

    const gelijkeNaam = rooster.name === bronRooster.name;
    const gelijkProfiel = rooster.profile === bronRooster.profile;
    const gelijkAantal = rooster.lines.length === bronRooster.lines.length;
    console.log(
      `  ${bronRooster.code.padEnd(10)} "${bronRooster.name}" · ` +
        `${bronRooster.lines.length} regels ${gelijkeNaam && gelijkProfiel && gelijkAantal ? "✓" : "✗"}`,
    );
    if (!gelijkeNaam) {
      verschil(`Rooster ${rooster.code}: naam "${rooster.name}" tegenover "${bronRooster.name}".`);
    }
    if (!gelijkProfiel) {
      verschil(
        `Rooster ${rooster.code}: profiel ${rooster.profile} tegenover ${bronRooster.profile}.`,
      );
    }
    if (!gelijkAantal) {
      verschil(
        `Rooster ${rooster.code}: ${rooster.lines.length} regels tegenover ` +
          `${bronRooster.lines.length} op het blad.`,
      );
    }

    for (const bronRegel of bronRooster.lines) {
      const regel = rooster.lines.find((kandidaat) => kandidaat.lineNumber === bronRegel.lineNumber);
      if (!regel) {
        verschil(`Rooster ${rooster.code} mist regel ${bronRegel.lineNumber}.`);
        afwijkendeCellen += bronRegel.days.length;
        continue;
      }
      for (const bronDag of bronRegel.days) {
        vergelekenCellen += 1;
        const dag = regel.days.find((kandidaat) => kandidaat.weekday === bronDag.weekday);
        if (!dag) {
          afwijkendeCellen += 1;
          verschil(
            `${rooster.code} regel ${bronRegel.lineNumber}: ${WEEKDAG[bronDag.weekday]} ontbreekt.`,
          );
          continue;
        }
        if (dag.positionType !== bronDag.positionType || dag.dutyCode !== bronDag.dutyCode) {
          afwijkendeCellen += 1;
          verschil(
            `${rooster.code} regel ${bronRegel.lineNumber} ${WEEKDAG[bronDag.weekday]}: ` +
              `blad ${bronDag.positionType}${bronDag.dutyCode ? ` ${bronDag.dutyCode}` : ""}, ` +
              `database ${dag.positionType}${dag.dutyCode ? ` ${dag.dutyCode}` : ""}.`,
          );
        }
      }
    }
  }
  console.log(`  ${vergelekenCellen} dagcellen vergeleken`);
  toets(
    "elke dagcel in de database is de dagcel van het blad",
    afwijkendeCellen === 0,
    `${afwijkendeCellen} afwijkingen`,
  );

  // ── 4. Elke roosterdag wijst naar een bestaande dienst ───────────────────
  console.log("\n4. Verwijzingen");
  const dienstCodes = new Set(bron.duties.map((dienst) => `${dienst.code}|${dienst.weekday}`));
  let losseVerwijzingen = 0;
  for (const rooster of roosters) {
    for (const regel of rooster.lines) {
      for (const dag of regel.days) {
        if (dag.positionType === "DUTY") {
          if (!dag.dutyCode) {
            losseVerwijzingen += 1;
            verschil(`${rooster.code} regel ${regel.lineNumber}: dienstdag zonder dienstnummer.`);
          } else if (!dienstCodes.has(`${dag.dutyCode}|${dag.weekday}`)) {
            losseVerwijzingen += 1;
            verschil(
              `${rooster.code} regel ${regel.lineNumber}: dienst ${dag.dutyCode} bestaat niet ` +
                `op ${WEEKDAG[dag.weekday]}.`,
            );
          }
        }
      }
    }
  }
  toets(
    "elke dienstdag wijst naar een dienst die op die weekdag bestaat",
    losseVerwijzingen === 0,
    `${losseVerwijzingen} verwijzingen zonder dienst`,
  );

  // ── 5. Het behoud ────────────────────────────────────────────────────────
  console.log("\n5. Behoud");
  const behoud = conservation(bron);
  console.log(
    `  ${behoud.invoer} cellen = ${behoud.vastRooster} vast rooster + ` +
      `${behoud.operationelePool} operationele pool + ${behoud.nietToewijsbaar} niet-toewijsbaar + ` +
      `${behoud.uitgeslotenMetReden} uitgesloten met reden`,
  );
  toets("de som klopt", behoud.sluitend, `verdwenen ${behoud.verdwenen}, dubbel ${behoud.dubbel}`);
  toets("er is geen dienst verdwenen", behoud.verdwenen === 0);
  toets("er is geen dienst dubbel geteld", behoud.dubbel === 0);

  // ── 6. Wat de bron zelf tegenspreekt ─────────────────────────────────────
  console.log("\n6. Conflicten in de bron");
  const tegenspraken = classificationConflicts(bron);
  console.log(`  bronconflicten: ${bron.conflicts.length}`);
  console.log(`  nummerindeling tegen de tijden in: ${tegenspraken.length}`);
  for (const conflict of [...bron.conflicts, ...tegenspraken.map((t) => ({ kind: "CLASSIFICATION", detail: t.detail }))].slice(0, 10)) {
    console.log(`    [${conflict.kind}] ${conflict.detail}`);
  }
  // Deze twee zijn geen toets die moet slagen: een conflict in de bron is geen
  // fout in de code. Het moet alleen zichtbaar zijn en in het pakket staan.
  const opgeslagenProblemen = Array.isArray(pakket.problems) ? pakket.problems.length : 0;
  toets(
    "elk conflict is bij het pakket vastgelegd en niet alleen hier getoond",
    opgeslagenProblemen === bron.conflicts.length + tegenspraken.length,
    `${opgeslagenProblemen} vastgelegd tegenover ${bron.conflicts.length + tegenspraken.length} gevonden`,
  );

  // ── Uitkomst ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(74)}`);
  if (verschillen.length > 0) {
    console.log(`${verschillen.length} verschil(len) tussen bron en database:`);
    for (const regel of verschillen.slice(0, 40)) {
      console.log(`  · ${regel}`);
    }
    if (verschillen.length > 40) {
      console.log(`  … en nog ${verschillen.length - 40}.`);
    }
  } else {
    console.log("Nul verschillen tussen de bladen en de database.");
  }
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/** Alleen om de import van het type te bewaren voor lezers van dit bestand. */
export type { DordrechtSource };
