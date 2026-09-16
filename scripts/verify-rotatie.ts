import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { toCalendarDate } from "@/domain/time";
import { anchorOf, effectiveMembershipOn } from "@/server/services/roster-membership-service";
import { isoWeekOfDate, ruleForDate, rotationSeries } from "@/domain/roster-rotation";

/**
 * De weekrotatie, nagerekend door een tweede implementatie.
 *
 * ## Waarom hier bewust dubbel werk staat
 *
 * De rotatieformule is één regel code. Precies daarom is hij gevaarlijk: een
 * fout erin geeft een rooster dat er volstrekt normaal uitziet en één week
 * verschoven is. Een test die dezelfde formule gebruikt om die formule te
 * controleren, bewijst niets.
 *
 * Dit script telt daarom domweg: het loopt week voor week vooruit en hoogt de
 * regel met één op, met wikkeling. Geen modulo, geen weekindex, geen ISO-jaar.
 * Waar die stomme telling en de productieformule uit elkaar lopen, zit een
 * fout — en dan is de vraag welke van de twee gelijk heeft.
 *
 * Dezelfde aanpak wees bij het rode weekend een toets aan die stil werd
 * overgeslagen. Zie docs/rule-interpretation-audit.md.
 *
 * Draaien met: npm run verify:rotatie
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

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

/**
 * De onafhankelijke telling.
 *
 * Begint op de ankerregel en telt week voor week door. Verder niets: geen
 * deling, geen rest, geen weeknummers. Alleen "de volgende week is de volgende
 * regel, en na de laatste komt de eerste".
 */
function tellendeRotatie(
  anchorRuleIndex: number,
  lineCount: number,
  weken: number,
): readonly number[] {
  const reeks: number[] = [];
  let regel = anchorRuleIndex;
  for (let week = 0; week < weken; week += 1) {
    reeks.push(regel);
    regel = regel === lineCount ? 1 : regel + 1;
  }
  return reeks;
}

/** Weken tussen twee ISO-weken, geteld via de maandagen. Eigen rekenwerk. */
function wekenTussen(van: string, tot: string): number {
  const maandag = (week: string) => {
    const [jaar, weekDeel] = week.split("-W");
    const vierJan = new Date(Date.UTC(Number(jaar), 0, 4, 12));
    const dag = vierJan.getUTCDay() === 0 ? 7 : vierJan.getUTCDay();
    const maandagWeek1 = new Date(vierJan);
    maandagWeek1.setUTCDate(vierJan.getUTCDate() - (dag - 1));
    const doel = new Date(maandagWeek1);
    doel.setUTCDate(maandagWeek1.getUTCDate() + (Number(weekDeel) - 1) * 7);
    return doel.getTime();
  };
  return Math.round((maandag(tot) - maandag(van)) / (7 * 86_400_000));
}

async function main(): Promise<void> {
  console.log("WEEKROTATIE — TWEE ONAFHANKELIJKE BEREKENINGEN");
  console.log("═".repeat(60));

  const plaatsingen = await prisma.rosterMembership.findMany({
    where: { status: "ACTIVE", placementType: "PERMANENT" },
    include: {
      employee: { select: { employeeNumber: true } },
      baseRoster: { select: { code: true } },
    },
    orderBy: { anchorRuleIndex: "asc" },
  });

  console.log(`\n${plaatsingen.length} permanente plaatsingen gevonden.\n`);
  if (plaatsingen.length === 0) {
    console.log("Niets te vergelijken. Draai eerst scripts/backfill-memberships.ts.");
    return;
  }

  // 1. Elke plaatsing, 52 weken vooruit.
  console.log("1. Vergelijking over 52 weken");
  let afwijkingen = 0;
  let vergeleken = 0;

  for (const plaatsing of plaatsingen) {
    const productie = rotationSeries(anchorOf(plaatsing), plaatsing.anchorWeek, 52).map(
      (week) => week.ruleIndex,
    );
    const onafhankelijk = tellendeRotatie(plaatsing.anchorRuleIndex, plaatsing.lineCount, 52);
    vergeleken += 52;

    for (let index = 0; index < 52; index += 1) {
      if (productie[index] !== onafhankelijk[index]) {
        afwijkingen += 1;
        if (afwijkingen <= 5) {
          console.log(
            `    ${plaatsing.employee.employeeNumber} (${plaatsing.baseRoster.code}) week ` +
              `+${index}: formule ${productie[index]}, telling ${onafhankelijk[index]}`,
          );
        }
      }
    }
  }
  toets(
    `${vergeleken} weekposities komen exact overeen`,
    afwijkingen === 0,
    `${afwijkingen} afwijkingen`,
  );

  // 2. Over de jaargrens heen.
  console.log("\n2. Over de jaargrens en week 53");
  const voorbeeld = plaatsingen[0];
  const overJaargrens = rotationSeries(anchorOf(voorbeeld), "2026-W50", 10);
  // De maandag van W50 zelf, niet die van W51: anders begint de telling een
  // week later dan de reeks waarmee zij wordt vergeleken.
  const tellingJaargrens = tellendeRotatie(
    ruleForDate(anchorOf(voorbeeld), overJaargrens[0].monday),
    voorbeeld.lineCount,
    10,
  );
  toets(
    "de jaarwisseling levert dezelfde reeks",
    overJaargrens.every((week, index) => week.ruleIndex === tellingJaargrens[index]),
    overJaargrens.map((week) => `${week.week}=${week.ruleIndex}`).join(" "),
  );
  toets(
    "week 53 van 2026 zit in de reeks",
    overJaargrens.some((week) => week.week === "2026-W53"),
    overJaargrens.map((week) => week.week).join(" "),
  );

  // 3. Wikkeling.
  console.log("\n3. Wikkeling na de laatste regel");
  for (const plaatsing of plaatsingen.slice(0, 5)) {
    const reeks = rotationSeries(
      anchorOf(plaatsing),
      plaatsing.anchorWeek,
      plaatsing.lineCount + 1,
    );
    const eerste = reeks[0].ruleIndex;
    const naEenCyclus = reeks[plaatsing.lineCount].ruleIndex;
    toets(
      `${plaatsing.employee.employeeNumber}: na ${plaatsing.lineCount} weken weer op regel ${eerste}`,
      eerste === naEenCyclus,
      `staat op ${naEenCyclus}`,
    );
  }

  // 4. Elke regel precies één keer per cyclus.
  console.log("\n4. Volledige cyclus");
  for (const plaatsing of plaatsingen.slice(0, 5)) {
    const reeks = rotationSeries(anchorOf(plaatsing), plaatsing.anchorWeek, plaatsing.lineCount);
    const uniek = new Set(reeks.map((week) => week.ruleIndex));
    toets(
      `${plaatsing.employee.employeeNumber}: alle ${plaatsing.lineCount} regels precies één keer`,
      uniek.size === plaatsing.lineCount,
      `${uniek.size} verschillende regels`,
    );
  }

  // 5. De service en de telling.
  console.log("\n5. De service en de telling");
  const vandaag = toCalendarDate(new Date());
  let serviceAfwijkingen = 0;
  let serviceVergeleken = 0;

  for (const plaatsing of plaatsingen.slice(0, 10)) {
    for (let weekOffset = 0; weekOffset < 12; weekOffset += 1) {
      const datum = toCalendarDate(
        new Date(new Date(`${vandaag}T12:00:00Z`).getTime() + weekOffset * 7 * 86_400_000),
      );
      const viaService = await effectiveMembershipOn(plaatsing.employeeId, datum);
      if (!viaService) {
        continue;
      }
      const viaFormule = ruleForDate(anchorOf(viaService), datum);
      const wekenVanaf = wekenTussen(viaService.anchorWeek, isoWeekOfDate(datum));
      if (wekenVanaf < 0) {
        continue;
      }
      const viaTelling = tellendeRotatie(
        viaService.anchorRuleIndex,
        viaService.lineCount,
        wekenVanaf + 1,
      )[wekenVanaf];
      serviceVergeleken += 1;

      if (viaFormule !== viaTelling) {
        serviceAfwijkingen += 1;
        if (serviceAfwijkingen <= 5) {
          console.log(
            `    ${plaatsing.employee.employeeNumber} op ${datum}: service ${viaFormule}, ` +
              `telling ${viaTelling}`,
          );
        }
      }
    }
  }
  toets(
    `${serviceVergeleken} servicebepalingen komen overeen met de telling`,
    serviceAfwijkingen === 0,
    `${serviceAfwijkingen} afwijkingen`,
  );

  console.log(`\n${"═".repeat(60)}`);
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
  .finally(async () => {
    await prisma.$disconnect();
  });
