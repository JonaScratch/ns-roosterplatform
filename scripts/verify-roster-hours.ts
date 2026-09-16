import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type CycleDay, formatHoursMinutes, rosterHours } from "@/domain/roster-hours";
import { prisma } from "@/server/data/prisma";
import { parseRosterPdf } from "@/server/import/roster-pdf";

/**
 * De roosteruren, twee keer berekend.
 *
 * ## Waarom twee keer
 *
 * De productieberekening leest de database: roosterregels, positietypes,
 * dienstinstanties. Deze meting leest de aangeleverde PDF-bladen rechtstreeks —
 * andere invoer, andere weg, dezelfde vraag. Komen ze op hetzelfde uit, dan is
 * dat een echte bevestiging; komen ze uit elkaar, dan is er onderweg iets
 * gebeurd tussen het blad en de database.
 *
 * Dat is dezelfde opzet als bij de dienstentelling en de weekrotatie, en om
 * dezelfde reden: één berekening die op het verwachte getal uitkomt, bewijst
 * vooral dat de berekening en de verwachting uit dezelfde pen komen.
 *
 * ## De derde controle
 *
 * De bladen noemen zelf hun gemiddelde weeklengte, bovenaan links. Dat getal is
 * door NS berekend en niet door ons. Het staat hier als derde vergelijking naast
 * de twee eigen berekeningen — en dat is de enige van de drie die werkelijk van
 * buiten komt.
 *
 * Draaien met: npm run verify:roster-hours
 */

const WORTEL = resolve(__dirname, "..");
const BRONMAP = join(WORTEL, "tests", "fixtures", "dordrecht-bronnen");

/** Welk blad hoort bij welke roostercode. */
const BLAD_PER_ROOSTER: Readonly<Record<string, string>> = {
  "DDR-V": "Vroeg 1 VA.pdf",
  "DDR-VL": "Vroeg Laat 1 B.pdf",
  "DDR-L": "Laat 1 LA.pdf",
  "DDR-LN": "Laat Nacht 1 C.pdf",
  "DDR-MIX": "Mix 1 A.pdf",
  "DDR-50MIX": "50+ mix 1.pdf",
  "DDR-BLM": "BLM 1.pdf",
};

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function minuten(waarde: string | null): number {
  if (!waarde) {
    return 0;
  }
  const treffer = /^(\d+):(\d{2})$/.exec(waarde.trim());
  return treffer ? Number(treffer[1]) * 60 + Number(treffer[2]) : Number.NaN;
}

/**
 * De uren zoals het aangeleverde blad ze zelf opschrijft.
 *
 * Er wordt hier niets uit de database gehaald. De celduren staan op het blad
 * gedrukt en worden letterlijk overgenomen; er wordt niet gerekend met begin-
 * en eindtijden. Dat is precies wat deze meting onafhankelijk maakt: de
 * productieberekening doet het andersom.
 */
function urenUitBlad(bestand: string): {
  readonly lineCount: number;
  readonly dutyMinutes: number;
  readonly wtvDays: number;
  readonly reserveDays: number;
  readonly compensationDays: number;
  readonly restDays: number;
  readonly totalMinutes: number;
  readonly average: number;
  readonly sourceAverage: string;
} {
  const document = parseRosterPdf(readFileSync(join(BRONMAP, bestand)));

  let dutyMinutes = 0;
  let wtvDays = 0;
  let reserveDays = 0;
  let compensationDays = 0;
  let restDays = 0;
  let totalMinutes = 0;

  for (const regel of document.lines) {
    for (const cel of regel.cells) {
      totalMinutes += minuten(cel.duration);
      switch (cel.kind) {
        case "DUTY":
          dutyMinutes += minuten(cel.duration);
          break;
        case "WR":
          wtvDays += 1;
          break;
        case "RES":
          reserveDays += 1;
          break;
        case "CO":
          compensationDays += 1;
          break;
        case "R":
          restDays += 1;
          break;
        default:
          break;
      }
    }
  }

  const lineCount = document.lines.length;
  return {
    lineCount,
    dutyMinutes,
    wtvDays,
    reserveDays,
    compensationDays,
    restDays,
    totalMinutes,
    average: lineCount > 0 ? Math.floor(totalMinutes / lineCount) : 0,
    sourceAverage: document.meta.gemiddeldeWeeklengteInclusiefPauze,
  };
}

async function main(): Promise<void> {
  console.log("ROOSTERUREN — TWEE ONAFHANKELIJKE BEREKENINGEN");
  console.log("═".repeat(96));

  const bladen = readdirSync(BRONMAP);
  const roosters = await prisma.baseRoster.findMany({
    where: { depot: "DDR" },
    include: {
      lines: { orderBy: { lineNumber: "asc" }, include: { days: true } },
    },
    orderBy: { code: "asc" },
  });

  if (roosters.length === 0) {
    console.log("\nGeen basisroosters voor DDR. Draai eerst npm run db:seed.");
    process.exitCode = 1;
    return;
  }

  const diensten = await prisma.duty.findMany({
    where: { depot: "DDR" },
    select: { code: true, weekday: true, startMinute: true, endMinute: true },
  });
  const perIdentiteit = new Map(diensten.map((duty) => [`${duty.code}|${duty.weekday}`, duty]));

  console.log(
    "\nrooster      regels  werkuren     WTV   overig    totaal   gem/week  " +
      "blad zegt  verschil   R-dagen    rusturen",
  );
  console.log("─".repeat(96));

  let afwijkendeUren = 0;
  let afwijkendeGemiddelden = 0;
  let onderDeVeertig = 0;
  const buitenTolerantie: string[] = [];

  for (const rooster of roosters) {
    // ── Berekening 1: uit de database, via de productiecode ─────────────
    const days: CycleDay[] = [];
    for (const regel of rooster.lines) {
      for (let weekdag = 1; weekdag <= 7; weekdag += 1) {
        const dag = regel.days.find(
          (kandidaat) => kandidaat.weekIndex === 1 && kandidaat.weekday === weekdag,
        );
        const dienst =
          dag && dag.positionType === "DUTY" && dag.dutyCode
            ? perIdentiteit.get(`${dag.dutyCode}|${weekdag}`)
            : undefined;
        days.push({
          positionType: (dag?.positionType ?? "OPLEIDING") as CycleDay["positionType"],
          startMinute: dienst?.startMinute ?? null,
          endMinute: dienst?.endMinute ?? null,
        });
      }
    }
    const uit = rosterHours({
      days,
      lineCount: rooster.lines.length,
      weeksPerLine: rooster.cycleWeeks,
    });

    // ── Berekening 2: uit het aangeleverde blad ─────────────────────────
    const bestand = BLAD_PER_ROOSTER[rooster.code];
    const blad = bestand && bladen.includes(bestand) ? urenUitBlad(bestand) : null;

    const verschil = blad ? uit.totalCreditMinutes - blad.totalMinutes : 0;
    if (blad && verschil !== 0) {
      afwijkendeUren += 1;
    }
    const bladGemiddelde = blad ? minuten(blad.sourceAverage) : Number.NaN;
    if (blad && uit.averageWeeklyCreditMinutes !== bladGemiddelde) {
      afwijkendeGemiddelden += 1;
    }
    if (uit.deviationFromTargetMinutes < 0) {
      onderDeVeertig += 1;
    }
    if (Math.abs(uit.deviationFromTargetMinutes) > 60) {
      buitenTolerantie.push(
        `${rooster.code}: ${formatHoursMinutes(uit.averageWeeklyCreditMinutes)}`,
      );
    }

    console.log(
      `${rooster.code.padEnd(12)} ${String(rooster.lines.length).padStart(4)}  ` +
        `${formatHoursMinutes(uit.actualDutyMinutes).padStart(8)} ` +
        `${formatHoursMinutes(uit.wtvCreditMinutes).padStart(7)} ` +
        `${formatHoursMinutes(uit.otherCreditedMinutes).padStart(8)} ` +
        `${formatHoursMinutes(uit.totalCreditMinutes).padStart(9)} ` +
        `${formatHoursMinutes(uit.averageWeeklyCreditMinutes).padStart(10)} ` +
        `${(blad?.sourceAverage ?? "—").padStart(10)} ` +
        `${formatHoursMinutes(uit.deviationFromTargetMinutes).padStart(9)} ` +
        `${String(uit.restDays).padStart(9)} ` +
        `${formatHoursMinutes(uit.restIntervalMinutes).padStart(11)}`,
    );

    if (blad && verschil !== 0) {
      console.log(
        `             database ${formatHoursMinutes(uit.totalCreditMinutes)} tegenover blad ` +
          `${formatHoursMinutes(blad.totalMinutes)} (${formatHoursMinutes(verschil)})`,
      );
    }
  }

  // ── De toetsen ───────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(96)}`);
  toets(
    "de urensom uit de database komt overeen met die van het aangeleverde blad",
    afwijkendeUren === 0,
    `${afwijkendeUren} roosters wijken af`,
  );
  toets(
    "de gemiddelde weekomvang komt overeen met wat het blad zelf noemt",
    afwijkendeGemiddelden === 0,
    `${afwijkendeGemiddelden} roosters wijken af`,
  );

  // ── De 40-uursbalans, per rooster ────────────────────────────────────────
  console.log("\nDe 40-uursbalans, per rooster afzonderlijk");
  console.log(
    "  Er is geen aangeleverde bron die zegt hoeveel afwijking aanvaardbaar is. Er staat\n" +
      "  hieronder daarom geen goedkeuring, alleen het verschil. Wat wél een bevinding is:\n" +
      "  een rooster dat meer dan een uur per week afwijkt van de andere.",
  );
  toets(
    "geen enkel rooster wijkt meer dan een uur per week af van de beoogde 40:00",
    buitenTolerantie.length === 0,
    buitenTolerantie.join(", "),
  );
  console.log(
    `  ${onderDeVeertig} van de ${roosters.length} roosters komt onder de 40:00 uit; ` +
      `${roosters.length - onderDeVeertig} erboven of precies erop.`,
  );

  // De spreiding tussen de roosters onderling: dát is waar het misgaat wanneer
  // het ene profiel structureel licht is en het andere zwaar.
  const gemiddelden = roosters.map((rooster) => {
    const bestand = BLAD_PER_ROOSTER[rooster.code];
    return bestand ? urenUitBlad(bestand).average : 0;
  });
  const laagste = Math.min(...gemiddelden);
  const hoogste = Math.max(...gemiddelden);
  console.log(
    `\n  Spreiding tussen de roosters: ${formatHoursMinutes(laagste)} tot ` +
      `${formatHoursMinutes(hoogste)} (${formatHoursMinutes(hoogste - laagste)} verschil).`,
  );
  toets(
    "geen enkel rooster is structureel lichter of zwaarder dan de andere",
    hoogste - laagste <= 60,
    `${formatHoursMinutes(hoogste - laagste)} verschil tussen het lichtste en het zwaarste`,
  );

  console.log(`\n${"═".repeat(96)}`);
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
