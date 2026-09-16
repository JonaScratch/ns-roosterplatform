import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { isAllowedInReserveBase, isStructuralAnchor } from "@/domain/roster-structure";

/**
 * De controles die niemand hoort te hoeven doen.
 *
 * ## Waarom dit bestaat
 *
 * Elke controle hieronder toetst iets dat volgens de code onmogelijk is. Een
 * roosterdag die naar een dienst verwijst die niet bestaat. Een operationele
 * invulling zonder reservedag eronder. Een dienst die in twee roosterlijnen
 * tegelijk wordt gereden. Een medewerker van de ene standplaats in het rooster
 * van de andere.
 *
 * Precies daarom staan ze hier. Fouten die "niet kunnen", worden niet opgemerkt
 * wanneer ze toch gebeuren: er is geen scherm dat ze toont en geen gebruiker die
 * ze verwacht. Ze komen aan het licht op de dag dat iemand voor een dienst staat
 * die niet bestaat.
 *
 * Draaien met:
 *   npm run verify:integriteit   alle controles
 *   npm run verify:diensten      alleen de dienstboekhouding
 *   npm run verify:reserve       alleen het reserverooster
 *   npm run verify:wijzigingsblad  alleen de ankervergrendeling
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

// ── Dienstboekhouding ────────────────────────────────────────────────────────

async function dienstboekhouding(): Promise<void> {
  kop("Dienstboekhouding");

  const pakketten = await prisma.dutyPackage.findMany({
    where: { status: { in: ["ACTIVE", "CONFIRMED", "VALIDATED"] } },
    include: { duties: { select: { id: true, code: true, weekday: true, depot: true } } },
  });

  for (const pakket of pakketten) {
    const label = pakket.label ?? `${pakket.name} v${pakket.version}`;
    // De identiteit van een dienst is nummer + weekdag. Dit script toetste
    // eerder op het nummer alleen en meldde daarom 177 "duplicaten" die geen
    // duplicaten zijn: dienst 101 rijdt op zes weekdagen, met zes verschillende
    // begintijden. Op het nummer toetsen zou juist afdwingen dat er van die zes
    // maar één overblijft.
    const identiteiten = pakket.duties.map((duty) => `${duty.code}|${duty.weekday}`);
    const uniek = new Set(identiteiten);
    const codes = new Set(pakket.duties.map((duty) => duty.code));
    toets(
      `${label}: geen dienst twee keer op dezelfde weekdag`,
      uniek.size === identiteiten.length,
      `${identiteiten.length - uniek.size} dubbele`,
    );

    const vreemd = pakket.duties.filter((duty) => duty.depot !== pakket.depot);
    toets(
      `${label}: alle diensten horen bij standplaats ${pakket.depot}`,
      vreemd.length === 0,
      `${vreemd.length} diensten van een andere standplaats`,
    );

    // Elke dienst uit het pakket moet ergens verantwoord zijn: in een
    // roosterlijn, of aantoonbaar niet geplaatst. Verdwenen mag niet.
    const inLijnen = await prisma.rosterLineDay.findMany({
      where: { positionType: "DUTY", rosterLine: { baseRoster: { depot: pakket.depot } } },
      select: { dutyCode: true, weekday: true },
    });
    const gebruikt = new Set(
      inLijnen
        .filter((dag) => dag.dutyCode)
        .map((dag) => `${dag.dutyCode}|${dag.weekday}`),
    );
    const onbekend = [...gebruikt].filter((identiteit) => !uniek.has(identiteit));
    toets(
      `${label}: roosterlijnen verwijzen alleen naar diensten uit het pakket`,
      onbekend.length === 0,
      `onbekende diensten in roosters: ${onbekend.slice(0, 8).join(", ")}`,
    );

    const nietGeplaatst = [...uniek].filter((identiteit) => !gebruikt.has(identiteit));
    console.log(
      `    ${uniek.size} diensten (${codes.size} nummers) · ${gebruikt.size} in vaste roosters · ` +
        `${nietGeplaatst.length} niet in een vaste roosterlijn`,
    );
  }

  if (pakketten.length === 0) {
    console.log("    Geen actief dienstenpakket gevonden.");
  }
}

// ── Reserverooster ───────────────────────────────────────────────────────────

async function reserverooster(): Promise<void> {
  kop("Reserverooster");

  const reserveLijnen = await prisma.rosterLineDay.findMany({
    where: { rosterLine: { baseRoster: { profile: "RESERVE" } } },
    select: {
      positionType: true,
      dutyCode: true,
      rosterLine: { select: { lineNumber: true, baseRoster: { select: { code: true } } } },
    },
  });

  const fout = reserveLijnen.filter(
    (dag) => !isAllowedInReserveBase(dag.positionType) || dag.dutyCode !== null,
  );
  if (reserveLijnen.length === 0) {
    console.log("    Er is nog geen reserverooster ingericht; niets te controleren.");
  } else {
    toets(
      "het basisreserverooster bevat geen dienstnummers",
      fout.length === 0,
      `${fout.length} slots met een dienst`,
    );
  }

  // Elke operationele invulling hoort boven een niet-dienstslot te liggen.
  const lagen = await prisma.operationalAssignment.findMany({
    select: {
      id: true,
      underlyingSlotType: true,
      scheduledDuty: { select: { positionType: true, employee: { select: { depot: true } } } },
    },
  });
  toets(
    "elke operationele invulling bewaart een onderliggend slottype",
    lagen.every((laag) => laag.underlyingSlotType.length > 0),
    "een laag zonder onderliggend slot is niet meer terug te draaien",
  );
  toets(
    "geen operationele laag bovenop een dienstdag",
    lagen.every((laag) => laag.underlyingSlotType !== "DUTY"),
    "een dienstdag heeft geen anker om naar terug te vallen",
  );
  console.log(`    ${lagen.length} operationele invullingen gecontroleerd`);
}

// ── Wijzigingsblad ───────────────────────────────────────────────────────────

async function wijzigingsblad(): Promise<void> {
  kop("Wijzigingsblad tegen de vastgelegde structuur");

  const periodes = await prisma.rosterPeriod.findMany({
    where: { changeType: "AMENDMENT" },
    include: { baseVersion: { include: { baselineSlots: true } } },
  });

  if (periodes.length === 0) {
    console.log("    Er is nog geen wijzigingsblad aangemaakt; niets te vergelijken.");
    return;
  }

  for (const periode of periodes) {
    const baseline = periode.baseVersion?.baselineSlots ?? [];
    toets(
      `${periode.label}: heeft een vastgelegde baseline`,
      baseline.length > 0,
      "zonder baseline is een ankerverschuiving niet vast te stellen",
    );

    const huidig = await prisma.rosterLineDay.findMany({
      where: { rosterLine: { baseRoster: { depot: periode.locationId } } },
      select: {
        weekIndex: true,
        weekday: true,
        positionType: true,
        rosterLine: { select: { lineNumber: true, baseRoster: { select: { code: true } } } },
      },
    });
    const stand = new Map(
      huidig.map((dag) => [
        `${dag.rosterLine.baseRoster.code}|${dag.rosterLine.lineNumber}|${dag.weekIndex}|${dag.weekday}`,
        dag.positionType as string,
      ]),
    );

    const verschoven = baseline.filter((slot) => {
      if (!slot.structuralAnchor) {
        return false;
      }
      const nu = stand.get(
        `${slot.baseRosterCode}|${slot.lineNumber}|${slot.weekIndex}|${slot.weekday}`,
      );
      return nu !== undefined && nu !== slot.slotType;
    });

    toets(
      `${periode.label}: geen enkel structureel anker verschoven`,
      verschoven.length === 0,
      `${verschoven.length} ankers wijken af van de baseline`,
    );
    console.log(
      `    ${baseline.filter((slot) => slot.structuralAnchor).length} ankers vergeleken`,
    );
  }
}

// ── Verwijzingen ─────────────────────────────────────────────────────────────

async function verwijzingen(): Promise<void> {
  kop("Verwijzingen en standplaatsen");

  const dienstDagen = await prisma.scheduledDuty.findMany({
    where: { positionType: "DUTY" },
    select: {
      id: true,
      dutyId: true,
      duty: { select: { depot: true } },
      employee: { select: { depot: true } },
    },
  });

  toets(
    "elke dienstdag verwijst naar een bestaande dienst",
    dienstDagen.every((dag) => dag.dutyId !== null && dag.duty !== null),
    `${dienstDagen.filter((dag) => !dag.duty).length} dagen zonder dienst`,
  );

  const kruislings = dienstDagen.filter(
    (dag) => dag.duty && dag.duty.depot !== dag.employee.depot,
  );
  toets(
    "geen medewerker rijdt een dienst van een andere standplaats",
    kruislings.length === 0,
    `${kruislings.length} dienstdagen met een vreemde standplaats`,
  );

  const dubbel = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT "dutyId", "date", COUNT(*) AS n
      FROM "ScheduledDuty"
      WHERE "positionType" = 'DUTY' AND "dutyId" IS NOT NULL
      GROUP BY "dutyId", "date"
      HAVING COUNT(*) > 1
    ) AS dubbel`;
  const aantalDubbel = Number(dubbel[0]?.count ?? 0);
  const dienstenTeller = await prisma.duty.count({ where: { depot: "DDR" } });
  const lijnenTeller = await prisma.rosterLine.count({
    where: { baseRoster: { depot: "DDR" } },
  });
  toets(
    "geen dienst wordt op dezelfde dag door twee mensen gereden",
    aantalDubbel === 0,
    `${aantalDubbel} combinaties dubbel bezet. Met ${dienstenTeller} diensten en ` +
      `${lijnenTeller} roosterlijnen kan dat niet anders: er zijn te weinig dienstnummers ` +
      "om elke lijn elke dag iets eigens te geven. Dit is een gegevensprobleem en geen " +
      "codeprobleem — het volledige dienstenpakket lost het op.",
  );

  const ankers = await prisma.rosterLineDay.findMany({
    where: { positionType: { not: "DUTY" } },
    select: { positionType: true, dutyCode: true },
  });
  toets(
    "geen ankerdag draagt een dienstnummer",
    ankers.every((dag) => dag.dutyCode === null || !isStructuralAnchor(dag.positionType)),
    "een rustdag met een dienstnummer erop is dubbelzinnig",
  );

  const zonderStandplaats = await prisma.employee.count({ where: { depot: "" } });
  toets("elke medewerker heeft een standplaats", zonderStandplaats === 0);
}


// ── Dienstindeling ───────────────────────────────────────────────────────────

async function dienstindeling(): Promise<void> {
  kop("Operationele invulling door de dienstindeling");

  const lagen = await prisma.operationalAssignment.findMany({
    include: {
      duty: { select: { code: true, depot: true } },
      scheduledDuty: {
        select: {
          id: true,
          date: true,
          positionType: true,
          employee: { select: { depot: true, employeeNumber: true } },
        },
      },
    },
  });

  if (lagen.length === 0) {
    console.log("    Er zijn nu geen operationele invullingen.");
  }

  toets(
    "elke invulling ligt op een dag die daarvoor bedoeld is",
    lagen.every((laag) => isAllowedInReserveBase(laag.underlyingSlotType)),
    "een invulling boven een dienstdag heeft geen anker om naar terug te vallen",
  );
  toets(
    "de dienst hoort bij de standplaats van de medewerker",
    lagen.every((laag) => laag.duty.depot === laag.scheduledDuty.employee.depot),
    "een operationele dienst van een andere standplaats",
  );

  const perDienstDag = new Map<string, number>();
  for (const laag of lagen) {
    const sleutel = `${laag.dutyId}|${laag.scheduledDuty.date.toISOString().slice(0, 10)}`;
    perDienstDag.set(sleutel, (perDienstDag.get(sleutel) ?? 0) + 1);
  }
  const dubbel = [...perDienstDag.values()].filter((aantal) => aantal > 1).length;
  toets(
    "geen dienst is op dezelfde dag twee keer operationeel ingevuld",
    dubbel === 0,
    `${dubbel} combinaties dubbel`,
  );

  console.log(`    ${lagen.length} operationele invullingen gecontroleerd`);
}

// ── Standplaatsen ────────────────────────────────────────────────────────────

async function standplaatsen(): Promise<void> {
  kop("Standplaatsen");

  const locaties = await prisma.stationLocation.findMany({
    select: {
      code: true,
      planningEnabled: true,
      dutiesConfigured: true,
      rostersConfigured: true,
      rulesConfigured: true,
      didContactEmail: true,
    },
  });

  toets("alle 41 standplaatsen staan geregistreerd", locaties.length === 41, `${locaties.length} gevonden`);

  const ingericht = locaties.filter((locatie) => locatie.planningEnabled);
  toets(
    "alleen Dordrecht is functioneel ingericht",
    ingericht.length === 1 && ingericht[0]?.code === "DDR",
    `ingericht: ${ingericht.map((locatie) => locatie.code).join(", ") || "geen"}`,
  );

  // Geen andere standplaats mag diensten, roosters of medewerkers hebben.
  const dienstenElders = await prisma.duty.findMany({
    where: { depot: { not: "DDR" } },
    select: { depot: true },
    distinct: ["depot"],
  });
  const roostersElders = await prisma.baseRoster.findMany({
    where: { depot: { not: "DDR" } },
    select: { depot: true },
    distinct: ["depot"],
  });
  toets(
    "geen andere standplaats heeft diensten of roosters",
    dienstenElders.length === 0 && roostersElders.length === 0,
    `diensten bij ${dienstenElders.map((rij) => rij.depot).join(", ")}, roosters bij ` +
      `${roostersElders.map((rij) => rij.depot).join(", ")}`,
  );

  const metContact = locaties.filter((locatie) => locatie.didContactEmail);
  toets(
    "alleen waar een adres is aangeleverd, staat er een",
    metContact.length === 1 && metContact[0]?.code === "DDR",
    `${metContact.length} standplaatsen met adres`,
  );
  toets(
    "het Dordrechtse adres is exact het aangeleverde",
    metContact[0]?.didContactEmail === "nsr.ddr-did-mcn@ns.nl",
    `gevonden: ${metContact[0]?.didContactEmail}`,
  );

  // Geen standplaats mag de inrichting van Dordrecht erven.
  const overgeërfd = locaties.filter(
    (locatie) =>
      locatie.code !== "DDR" &&
      (locatie.dutiesConfigured || locatie.rostersConfigured || locatie.rulesConfigured),
  );
  toets(
    "geen enkele standplaats erft de inrichting van Dordrecht",
    overgeërfd.length === 0,
    `${overgeërfd.length} standplaatsen met overgenomen inrichting`,
  );

  const eenheden = await prisma.planningUnit.count();
  console.log(`    ${locaties.length} standplaatsen, ${eenheden} planeenheden`);
}

async function main(): Promise<void> {
  console.log("GEGEVENSINTEGRITEIT");
  console.log("════════════════════════════════════════════════════════════");

  if (ONDERDEEL === "alles" || ONDERDEEL === "diensten") {
    await dienstboekhouding();
  }
  if (ONDERDEEL === "alles" || ONDERDEEL === "reserve") {
    await reserverooster();
  }
  if (ONDERDEEL === "alles" || ONDERDEEL === "wijzigingsblad") {
    await wijzigingsblad();
  }
  if (ONDERDEEL === "alles" || ONDERDEEL === "verwijzingen") {
    await verwijzingen();
  }
  if (ONDERDEEL === "alles" || ONDERDEEL === "dienstindeling") {
    await dienstindeling();
  }
  if (ONDERDEEL === "alles" || ONDERDEEL === "standplaatsen") {
    await standplaatsen();
  }

  console.log("\n════════════════════════════════════════════════════════════");
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
