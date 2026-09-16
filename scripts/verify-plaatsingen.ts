import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { addDays, toCalendarDate } from "@/domain/time";
import { anchorOf } from "@/server/services/roster-membership-service";
import { projectPersonalRoster } from "@/server/services/personal-roster-projection-service";
import { ruleForDate } from "@/domain/roster-rotation";

/**
 * Roosterplaatsingen en de persoonlijke projectie.
 *
 * ## Wat hier wordt uitgesloten
 *
 * Twee permanente plaatsingen tegelijk — dan weet niemand welk rooster geldt.
 * Twee overlappende tijdelijke plaatsingen — idem. Een ankerregel die niet in
 * het rooster bestaat. Een plaatsing bij een rooster van een andere
 * standplaats. En het ergste geval: een projectie die stil een lege week toont
 * terwijl er in werkelijkheid iets misging.
 *
 * Draaien met:
 *   npm run verify:plaatsingen   alles
 *   npm run verify:projectie     alleen de projectie
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const ONDERDEEL = process.argv[2] ?? "alles";

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

function kop(titel: string): void {
  console.log(`\n${titel}`);
  console.log("─".repeat(60));
}

async function plaatsingen(): Promise<void> {
  kop("Roosterplaatsingen");

  const alle = await prisma.rosterMembership.findMany({
    include: {
      employee: { select: { employeeNumber: true, depot: true } },
      baseRoster: {
        select: { code: true, depot: true, status: true, _count: { select: { lines: true } } },
      },
    },
  });
  console.log(`    ${alle.length} plaatsingen in de gegevens`);

  // Hooguit één actieve permanente plaatsing per medewerker.
  const permanentPerMedewerker = new Map<string, number>();
  for (const plaatsing of alle) {
    if (plaatsing.placementType === "PERMANENT" && plaatsing.status === "ACTIVE") {
      const aantal = (permanentPerMedewerker.get(plaatsing.employeeId) ?? 0) + 1;
      permanentPerMedewerker.set(plaatsing.employeeId, aantal);
    }
  }
  const dubbelPermanent = [...permanentPerMedewerker.values()].filter((aantal) => aantal > 1);
  toets(
    "geen medewerker heeft twee actieve permanente plaatsingen",
    dubbelPermanent.length === 0,
    `${dubbelPermanent.length} medewerkers met meer dan één`,
  );

  // Overlappende tijdelijke plaatsingen.
  const tijdelijkPerMedewerker = new Map<string, { van: number; tot: number }[]>();
  for (const plaatsing of alle) {
    if (plaatsing.placementType !== "TEMPORARY" || plaatsing.status !== "ACTIVE") {
      continue;
    }
    const lijst = tijdelijkPerMedewerker.get(plaatsing.employeeId) ?? [];
    lijst.push({
      van: plaatsing.validFrom.getTime(),
      tot: plaatsing.validUntil?.getTime() ?? Number.MAX_SAFE_INTEGER,
    });
    tijdelijkPerMedewerker.set(plaatsing.employeeId, lijst);
  }
  let overlap = 0;
  for (const perioden of tijdelijkPerMedewerker.values()) {
    const gesorteerd = [...perioden].sort((a, b) => a.van - b.van);
    for (let index = 1; index < gesorteerd.length; index += 1) {
      if (gesorteerd[index].van <= gesorteerd[index - 1].tot) {
        overlap += 1;
      }
    }
  }
  toets(
    "geen overlappende tijdelijke plaatsingen",
    overlap === 0,
    `${overlap} overlappende paren`,
  );

  // Ankerregel bestaat in het rooster.
  const buitenBereik = alle.filter(
    (plaatsing) =>
      plaatsing.anchorRuleIndex < 1 ||
      plaatsing.anchorRuleIndex > plaatsing.baseRoster._count.lines,
  );
  toets(
    "elke ankerregel bestaat in het bijbehorende rooster",
    buitenBereik.length === 0,
    buitenBereik
      .slice(0, 3)
      .map(
        (plaatsing) =>
          `${plaatsing.employee.employeeNumber}: regel ${plaatsing.anchorRuleIndex} van ` +
          `${plaatsing.baseRoster._count.lines}`,
      )
      .join("; "),
  );

  // Het bewaarde aantal regels klopt nog met het rooster.
  const verschoven = alle.filter(
    (plaatsing) => plaatsing.lineCount !== plaatsing.baseRoster._count.lines,
  );
  toets(
    "het vastgelegde aantal regels klopt met het rooster",
    verschoven.length === 0,
    `${verschoven.length} plaatsingen verwijzen naar een rooster dat inmiddels een ander ` +
      "aantal regels heeft; die vragen om een nieuwe plaatsing",
  );

  // Standplaats.
  const kruislings = alle.filter(
    (plaatsing) => plaatsing.employee.depot !== plaatsing.baseRoster.depot,
  );
  toets(
    "niemand staat in het rooster van een andere standplaats",
    kruislings.length === 0,
    `${kruislings.length} plaatsingen over standplaatsen heen`,
  );

  const gearchiveerd = alle.filter(
    (plaatsing) => plaatsing.status === "ACTIVE" && plaatsing.baseRoster.status === "ARCHIVED",
  );
  toets(
    "geen actieve plaatsing in een gearchiveerd rooster",
    gearchiveerd.length === 0,
    `${gearchiveerd.length} plaatsingen`,
  );

  // Een tijdelijke plaatsing hoort een basis te hebben om naar terug te keren.
  const tijdelijkZonderBasis = alle.filter(
    (plaatsing) => plaatsing.placementType === "TEMPORARY" && !plaatsing.basePlacementId,
  );
  toets(
    "elke tijdelijke plaatsing verwijst naar een permanente basis",
    tijdelijkZonderBasis.length === 0,
    `${tijdelijkZonderBasis.length} zonder basis; na afloop is dan niet te zeggen waarheen`,
  );
}

async function projectie(): Promise<void> {
  kop("Persoonlijke projectie");

  const medewerkers = await prisma.employee.findMany({
    where: { depot: "DDR", status: "ACTIVE", memberships: { some: { status: "ACTIVE" } } },
    select: { id: true, employeeNumber: true },
    take: 8,
  });

  if (medewerkers.length === 0) {
    console.log("    Geen medewerkers met een roosterplaatsing.");
    return;
  }

  const vandaag = toCalendarDate(new Date());
  let onbepaald = 0;
  let dagen = 0;
  let afwijkingen = 0;

  for (const medewerker of medewerkers) {
    const projectie = await projectPersonalRoster({
      employeeId: medewerker.id,
      from: vandaag,
      to: addDays(vandaag, 55),
    });
    dagen += projectie.days.length;
    onbepaald += projectie.days.filter((dag) => !dag.determinate).length;

    // Onafhankelijke controle: de regel per dag moet volgen uit de plaatsing.
    for (const dag of projectie.days) {
      if (!dag.determinate || dag.sourceRule === null) {
        continue;
      }
      const plaatsing = await prisma.rosterMembership.findFirst({
        where: {
          employeeId: medewerker.id,
          status: "ACTIVE",
          validFrom: { lte: new Date(`${dag.date}T00:00:00Z`) },
          OR: [{ validUntil: null }, { validUntil: { gte: new Date(`${dag.date}T00:00:00Z`) } }],
        },
        orderBy: { placementType: "asc" },
      });
      if (!plaatsing) {
        continue;
      }
      const verwacht = ruleForDate(anchorOf(plaatsing), dag.date);
      if (verwacht !== dag.sourceRule) {
        afwijkingen += 1;
      }
    }
  }

  console.log(`    ${medewerkers.length} medewerkers, ${dagen} dagen geprojecteerd`);
  toets(
    "elke geprojecteerde dag draagt de regel die uit de plaatsing volgt",
    afwijkingen === 0,
    `${afwijkingen} dagen wijken af`,
  );
  toets(
    "geen enkele dag is stil leeg gebleven",
    onbepaald === 0,
    `${onbepaald} dagen konden niet worden bepaald; die tonen dat ook, maar het is een ` +
      "signaal dat er gegevens ontbreken",
  );

  // Elke dag draagt een herkomst.
  const eerste = await projectPersonalRoster({
    employeeId: medewerkers[0].id,
    from: vandaag,
    to: addDays(vandaag, 13),
  });
  toets(
    "elke dag noemt zijn herkomst",
    eerste.days.every((dag) => dag.sourceType !== "ONBEKEND" || !dag.determinate),
    "een dienst zonder herkomst is een dienst waar niemand verantwoordelijk voor is",
  );

  const metRooster = eerste.days.filter((dag) => dag.sourceRoster !== null).length;
  console.log(
    `    Voorbeeld ${eerste.employeeNumber}: rooster ${eerste.membership?.rosterCode ?? "?"}, ` +
      `regel ${eerste.membership?.ruleIndex ?? "?"}, ${metRooster} van ${eerste.days.length} ` +
      "dagen met een roosterbron",
  );
}

async function main(): Promise<void> {
  console.log("ROOSTERPLAATSING EN PROJECTIE");
  console.log("═".repeat(60));

  if (ONDERDEEL === "alles" || ONDERDEEL === "plaatsingen") {
    await plaatsingen();
  }
  if (ONDERDEEL === "alles" || ONDERDEEL === "projectie") {
    await projectie();
  }

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
