import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/lib/generated/prisma/client";
import { Role } from "../src/lib/generated/prisma/enums";
import type { DutyKind, RosterPositionType, RosterProfile } from "../src/lib/generated/prisma/enums";
import { classifyDuty } from "../src/domain/duty-classification";
import { isoWeekOfDate, ruleForWeek } from "../src/domain/roster-rotation";
import { addDays, toCalendarDate, toDatabaseDate } from "../src/domain/time";
import {
  type DordrechtSource,
  classificationConflicts,
  conservation,
  readDordrechtSource,
} from "../src/server/import/dordrecht-source";

/**
 * Vulling van de ontwikkeldatabase.
 *
 * ## Uitsluitend voor ontwikkeling en test
 *
 * Dit script maakt accounts met een bekend wachtwoord aan en wist bestaande
 * gegevens. Het weigert daarom te draaien wanneer `APP_ENV` op `production`
 * staat. Persoonsnamen hieronder zijn verzonnen.
 *
 * ## Wat echt is en wat verzonnen
 *
 * Het onderscheid is belangrijk genoeg om bovenaan te staan.
 *
 * **Echt**, ingelezen uit de aangeleverde bladen in
 * `tests/fixtures/dordrecht-bronnen/`: het dienstenpakket (223 diensten), de
 * zeven basisroosters met hun 64 regels, en elke dienstcode, tijd, reservedag
 * en rustdag daarin. Er wordt hier geen dienst bedacht en geen roosterregel
 * ingevuld die niet op een blad staat.
 *
 * **Verzonnen**, omdat het niet is aangeleverd en ook niet aangeleverd hoort te
 * worden: de medewerkers, hun namen, hun accounts en hun plaatsing op een
 * roosterregel. Wie op welke regel staat, is in Dordrecht een personeelsgegeven;
 * dat hoort niet in een ontwikkeldatabase.
 *
 * ## Wat er ontstaat
 *
 *  - het echte dienstenpakket uit de zeven roosterbladen
 *  - de zeven echte basisroosters met hun eigen aantal regels
 *  - medewerkers met verzonnen namen, elk op een roosterregel, plus een planner
 *    en een beveiligingsbeheerder
 *  - een concreet rooster van dertig dagen terug tot zestig dagen vooruit
 *  - roulatielijsten per weekdag
 *  - een handvol beschikbare diensten, waaronder één die nog bij reserve ligt
 *  - kwartaalfeedback die groot genoeg is om te tonen, en één profiel dat
 *    onder de privacydrempel valt
 */

const DEV_PASSWORD = "Ontwikkel!2026";
// De standplaats waar dit project over gaat. Stond aanvankelijk op UT, van
// vóór het moment dat Dordrecht werd vastgesteld; de lokale Dordrechtregels
// waren daardoor op deze gegevens nooit van toepassing.
const DEPOT = "DDR";
const HISTORY_DAYS = 30;
const FUTURE_DAYS = 60;

/** Maandag als ankerpunt: de patronen beginnen op maandag van week 1. */
const CYCLE_ANCHOR = "2026-01-05";

function client(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL ontbreekt.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const prisma = client();

async function main(): Promise<void> {
  if (process.env.APP_ENV === "production") {
    throw new Error("De seed draait niet in productie: hij wist gegevens en zet testwachtwoorden.");
  }

  console.log("Aangeleverde bronbladen inlezen ...");
  const bron = readDordrechtSource();
  const behoud = conservation(bron);
  console.log(
    `  ${bron.duties.length} diensten en ${bron.rosters.length} roosters uit ` +
      `${bron.sheetChecksums.length} bladen (${bron.timetableId}).`,
  );
  console.log(
    `  behoud: ${behoud.invoer} cellen = ${behoud.vastRooster} dienst + ` +
      `${behoud.operationelePool} reserve + ${behoud.nietToewijsbaar} vrij + ` +
      `${behoud.uitgeslotenMetReden} uitgesloten.`,
  );
  if (!behoud.sluitend) {
    // Doorgaan zou een database opleveren waarin diensten ontbreken of dubbel
    // staan, zonder dat er verderop nog iets over klaagt.
    throw new Error(
      `Het behoud sluit niet: ${behoud.verdwenen} verdwenen, ${behoud.dubbel} dubbel. ` +
        "De seed stopt; er wordt niets weggeschreven.",
    );
  }
  if (bron.conflicts.length > 0) {
    console.log(`  ${bron.conflicts.length} conflict(en) in de bron:`);
    for (const conflict of bron.conflicts) {
      console.log(`    [${conflict.kind}] ${conflict.detail}`);
    }
  }


  console.log("Bestaande gegevens verwijderen ...");
  await wipe();

  console.log("Dienstenpakket aanmaken ...");
  const dutyIdByCode = await createDutyPackage(bron);

  console.log("Basisroosters aanmaken ...");
  const lines = await createBaseRosters(bron);

  console.log("Roosterperiode vastleggen ...");
  await createPeriod(bron);

  console.log("Medewerkers en accounts aanmaken ...");
  const employees = await createEmployees(lines);

  console.log("Roosterplaatsingen vastleggen ...");
  await createMemberships(employees);

  console.log("Concreet rooster genereren ...");
  await materialiseSchedule(employees, dutyIdByCode);

  console.log("Roulatielijsten aanmaken ...");
  await createRotationLists(employees);

  console.log("Beschikbare diensten aanmaken ...");
  await createAvailableDuties(employees);

  console.log("Kwartaalfeedback aanmaken ...");
  await createFeedback(employees);

  console.log("\nKlaar. Aanmelden kan met:");
  console.log(`  medewerker            100001 / ${DEV_PASSWORD}`);
  console.log(`  medewerker (mix)      100026 / ${DEV_PASSWORD}`);
  console.log(`  rooster commissie     900001 / ${DEV_PASSWORD}`);
  console.log(`  dienstindeling        910001 / ${DEV_PASSWORD}`);
  console.log(`  admin                 990001 / ${DEV_PASSWORD}`);
}

/**
 * Alles weggooien in de volgorde die de foreign keys toelaten.
 *
 * `deleteMany` per model en niet `TRUNCATE ... CASCADE`: dat laatste zou ook
 * tabellen leegmaken die er nu nog niet zijn maar er later bij komen.
 */
async function wipe(): Promise<void> {
  await prisma.availableDutyInterest.deleteMany();
  await prisma.reserveFillAttempt.deleteMany();
  await prisma.availableDuty.deleteMany();
  await prisma.swapProposal.deleteMany();
  await prisma.rotationLog.deleteMany();
  await prisma.rotationEntry.deleteMany();
  await prisma.rotationList.deleteMany();
  await prisma.quarterlyFeedback.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.scheduledDuty.deleteMany();
  await prisma.rosterAssignment.deleteMany();
  await prisma.rosterWarning.deleteMany();
  await prisma.rosterVersionDay.deleteMany();
  await prisma.rosterVersion.deleteMany();
  await prisma.rosterStructureBaselineSlot.deleteMany();
  await prisma.rosterPeriod.deleteMany();
  await prisma.rosterLineDay.deleteMany();
  await prisma.rosterLine.deleteMany();
  // Plaatsingen en meldingen wijzen naar roosters en medewerkers; zonder deze
  // twee regels loopt de wipe stuk op de foreign key in plaats van door te
  // gaan met een half geleegde database.
  await prisma.rosterMembership.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.baseRoster.deleteMany();
  await prisma.duty.deleteMany();
  await prisma.dutyPackage.deleteMany();
  await prisma.auditLogEntry.deleteMany();
  await prisma.securityEvent.deleteMany();
  await prisma.ruleEvaluation.deleteMany();
  await prisma.session.deleteMany();
  await prisma.userAccount.deleteMany();
  await prisma.employeeIdentity.deleteMany();
  await prisma.employee.deleteMany();
}

/** De sleutel waarmee een dienst uniek is: nummer én weekdag. */
function dutyKey(code: string, weekday: number): string {
  return `${code}|${weekday}`;
}

/**
 * Het dienstenpakket uit de aangeleverde bladen.
 *
 * Elke rij draagt mee waar zij vandaan komt: welk blad, welke regel, en wat er
 * letterlijk in de cel stond. Samen met de checksum van het pakket is daarmee
 * na te gaan waar dienst 101 van donderdag vandaan kwam — en of het bestand
 * waaruit hij kwam sindsdien is veranderd.
 */
async function createDutyPackage(bron: DordrechtSource): Promise<ReadonlyMap<string, string>> {
  const tegenspraken = classificationConflicts(bron);

  const pkg = await prisma.dutyPackage.create({
    data: {
      name: `DDR-${bron.timetableId}`,
      label: `DDR-${bron.timetableId}-V1`,
      version: 1,
      status: "ACTIVE",
      depot: DEPOT,
      timetableId: bron.timetableId,
      validFrom: bron.validFrom,
      validUntil: bron.validUntil,
      sourceChecksum: bron.checksum,
      sourceFilename: bron.sheetChecksums.map((blad) => blad.sheet).join(", "),
      totals: {
        diensten: bron.duties.length,
        perWeekdag: Array.from({ length: 7 }, (_, index) =>
          bron.duties.filter((duty) => duty.weekday === index + 1).length,
        ),
        bladen: bron.sheetChecksums,
      },
      // De problemen gaan mee de database in. Een conflict dat alleen in een
      // logregel staat, is een conflict dat niemand meer terugvindt.
      problems: [
        ...bron.conflicts.map((conflict) => ({ soort: conflict.kind, detail: conflict.detail })),
        ...tegenspraken.map((tegenspraak) => ({
          soort: "CLASSIFICATION_CONTRADICTS_SOURCE",
          detail: tegenspraak.detail,
        })),
      ],
      duties: {
        create: bron.duties.map((duty) => {
          const classificatie = classifyDuty(duty.code);
          return {
            code: duty.code,
            numericCode: duty.numericCode,
            weekday: duty.weekday,
            period: classificatie.period,
            workType: classificatie.workType,
            kinds: [...classificatie.kinds] as DutyKind[],
            startMinute: duty.startMinute,
            endMinute: duty.endMinute,
            depot: DEPOT,
            // Niet aangeleverd, en daarom leeg gelaten in plaats van bedacht.
            // Zie QUALIFICATION_DATA_NOT_AVAILABLE in docs/rule-coverage.md.
            requiredQualifications: [],
            sourceRow: duty.sourceLine,
            sourceValues: {
              blad: duty.sourceSheet,
              regel: duty.sourceLine,
              cel: duty.sourceCell,
              duur: duty.durationLabel,
            },
            description: `${duty.sourceSheet} regel ${duty.sourceLine}`,
          };
        }),
      },
    },
    select: { id: true },
  });

  const duties = await prisma.duty.findMany({
    where: { packageId: pkg.id },
    select: { id: true, code: true, weekday: true },
  });
  if (duties.length !== bron.duties.length) {
    throw new Error(
      `Er zijn ${bron.duties.length} diensten aangeboden en ${duties.length} weggeschreven.`,
    );
  }
  console.log(`  ${duties.length} diensten weggeschreven, ${tegenspraken.length} tegenspraak/-spraken.`);
  return new Map(duties.map((duty) => [dutyKey(duty.code, duty.weekday), duty.id]));
}

/**
 * De roosterperiode waar dit alles bij hoort.
 *
 * ## Waarom dit geen bijzaak is
 *
 * Zonder periode weet het platform niet in welke ronde het zit, en dan valt de
 * helft van de beslissingen stil: het roosterblad zegt "geen roosterperiode
 * vastgelegd", de structuurgenerator weigert, en de vergelijking met een
 * wijzigingsblad heeft geen baseline om tegen te toetsen. Dat is precies één
 * ontbrekende rij ver van "alles werkt" af, en dat is te veel om aan een los
 * script over te laten.
 *
 * De datums komen uit de bladen zelf: 5 oktober tot en met 12 december 2026, de
 * geldigheidsduur die op alle zeven staat.
 */
async function createPeriod(bron: DordrechtSource): Promise<void> {
  const location = await prisma.stationLocation.findUnique({
    where: { code: DEPOT },
    select: { id: true },
  });
  if (!location) {
    throw new Error(`Standplaats ${DEPOT} bestaat niet; draai eerst npm run sync:locations.`);
  }

  await prisma.rosterPeriod.create({
    data: {
      locationId: location.id,
      timetableId: bron.timetableId,
      year: bron.validFrom.getUTCFullYear(),
      // De aangeleverde bladen zijn de eerste vaststelling van deze
      // dienstregeling, geen wijziging daarop.
      changeType: "NEW_TIMETABLE",
      version: 1,
      label: `${DEPOT} ${bron.timetableId}`,
      validFrom: bron.validFrom,
      validUntil: bron.validUntil,
      status: "CONCEPT",
      // De structuur staat nog open: dit is de ronde waarin zij bepaald wordt.
      // Zij gaat pas op slot wanneer iemand de baseline bevriest, en dat is een
      // handeling van een mens en niet van de seed.
      structureState: "STRUCTURE_EDITABLE",
    },
  });
  console.log(
    `  ${DEPOT} ${bron.timetableId}: ${bron.validFrom.toISOString().slice(0, 10)} t/m ` +
      `${bron.validUntil.toISOString().slice(0, 10)}, NEW_TIMETABLE, structuur bewerkbaar.`,
  );
}

interface SeedLineDay {
  readonly weekday: number;
  readonly positionType: RosterPositionType;
  readonly dutyCode: string | null;
}

interface SeedLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly rosterCode: string;
  readonly profile: RosterProfile;
  /** Het aantal regels van dít rooster: de lengte van de rotatiecyclus. */
  readonly lineCount: number;
  readonly days: readonly SeedLineDay[];
}

/**
 * De basisroosters, precies zoals ze op de bladen staan.
 *
 * ## Waarom `cycleWeeks` hier 1 is
 *
 * Een NS-roosterblad toont per regel één week. De cyclus zit niet in de regel
 * maar tússen de regels: wie deze week op regel 6 staat, staat volgende week op
 * regel 7, en na de laatste regel weer op regel 1. De cycluslengte is dus het
 * aantal regels, en die staat in `RosterMembership.lineCount` — niet hier.
 *
 * Eerder stond hier 4, uit een tijd dat de patronen verzonnen waren en 28 dagen
 * besloegen. Dat getal hier laten staan zou betekenen dat het roosterblad vier
 * weken per regel toont, wat het niet doet.
 */
async function createBaseRosters(bron: DordrechtSource): Promise<readonly SeedLine[]> {
  const lines: SeedLine[] = [];

  for (const roster of bron.rosters) {
    const created = await prisma.baseRoster.create({
      data: {
        code: roster.code,
        name: roster.name,
        profile: roster.profile,
        depot: DEPOT,
        cycleWeeks: 1,
        status: "ACTIVE",
        lines: {
          create: roster.lines.map((regel) => ({
            lineNumber: regel.lineNumber,
            days: {
              create: regel.days.map((dag) => ({
                weekIndex: 1,
                weekday: dag.weekday,
                positionType: dag.positionType,
                dutyCode: dag.dutyCode,
              })),
            },
          })),
        },
      },
      select: { lines: { select: { id: true, lineNumber: true } } },
    });

    for (const line of created.lines) {
      const bronregel = roster.lines.find((regel) => regel.lineNumber === line.lineNumber);
      if (!bronregel) {
        throw new Error(`Regel ${line.lineNumber} van ${roster.code} is niet terug te vinden.`);
      }
      lines.push({
        id: line.id,
        lineNumber: line.lineNumber,
        rosterCode: roster.code,
        profile: roster.profile,
        lineCount: roster.lines.length,
        days: bronregel.days,
      });
    }
  }

  console.log(
    `  ${bron.rosters.length} roosters met ${lines.length} regels weggeschreven.`,
  );
  return lines;
}

interface SeedEmployee {
  readonly id: string;
  readonly employeeNumber: string;
  readonly line: SeedLine | null;
  readonly profile: RosterProfile;
}

const FIRST_NAMES = [
  "Sanne", "Daan", "Fatima", "Joris", "Emma", "Youssef", "Lieke", "Bram",
  "Noor", "Sem", "Amira", "Thijs", "Iris", "Kees", "Maryam", "Ruben",
  "Femke", "Jelle", "Anouk", "Bas", "Hanna", "Tim", "Sofie", "Wouter",
  "Nadia", "Stijn", "Elin", "Rik", "Julia", "Mees",
];
const LAST_NAMES = [
  "de Vries", "Jansen", "El Amrani", "Bakker", "Visser", "Yilmaz", "Smit",
  "Meijer", "de Boer", "Mulder", "Hendriks", "van Dijk", "Kok", "Peters",
  "Bos", "Vos", "Willems", "van Leeuwen", "Dekker", "Verhoeven",
];

async function createEmployees(lines: readonly SeedLine[]): Promise<readonly SeedEmployee[]> {
  const passwordHash = await hash(DEV_PASSWORD, 12);
  const employees: SeedEmployee[] = [];

  for (const [index, line] of lines.entries()) {
    const employeeNumber = String(100001 + index);
    const needsShunting = line.profile === "MIX" || line.profile === "LAAT_NACHT";

    const employee = await prisma.employee.create({
      data: {
        employeeNumber,
        rosterProfile: line.profile,
        depot: DEPOT,
        qualifications: needsShunting ? ["RANGEER", "WISSELBEDIENING"] : [],
        reservePreference: reservePreferenceFor(index),
        employeeGroup: "MACHINIST",
        company: "NSR",
        // De Dordrechtse basisroosters zijn aangeleverd als 40-uursroosters.
        // Dat is een gegeven over deze roosterlijnen en geen aanname over de
        // medewerker. Contractomvang wordt nooit afgeleid uit gemiddeld
        // werkelijk gewerkte uren: dan zou een te vol rooster zichzelf tot norm
        // verheffen.
        contractHours: 40,
        preferences: {
          voorkeurVrijeDagen: index % 3 === 0 ? [3] : [],
          liefstAaneengeslotenDiensten: index % 2 === 0,
          liefstGeenLosseWerkdagen: false,
          openVoorExtraDiensten: index % 4 !== 0,
          liefstHeleWeekendenVrij: index % 5 === 0,
        },
        hiredOn: new Date(2015 + (index % 10), index % 12, 1 + (index % 27)),
        identity: {
          create: {
            displayName: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[index % LAST_NAMES.length]}`,
            email: `medewerker${employeeNumber}@voorbeeld.intern`,
          },
        },
        account: {
          create: {
            roles: [Role.EMPLOYEE],
            provider: "LOCAL",
            passwordHash,
            passwordSetAt: new Date(),
          },
        },
        rosterAssignments: {
          create: { rosterLineId: line.id, validFrom: new Date("2026-01-01T00:00:00.000Z") },
        },
      },
      select: { id: true, employeeNumber: true },
    });

    employees.push({
      id: employee.id,
      employeeNumber: employee.employeeNumber,
      line,
      profile: line.profile,
    });
  }

  // De planner en de beveiligingsbeheerder hebben wel een medewerkerrecord —
  // `employee_id` is de sleutel van elk account — maar geen roosterlijn.
  for (const staff of [
    {
      number: "900001",
      roles: [Role.EMPLOYEE, Role.ROSTER_COMMITTEE],
      name: "Rooster Commissie Dordrecht",
    },
    {
      number: "910001",
      roles: [Role.EMPLOYEE, Role.DUTY_ASSIGNMENT],
      name: "Dienstindeling Dordrecht",
    },
    { number: "990001", roles: [Role.EMPLOYEE, Role.ADMIN], name: "Systeembeheerder" },
  ]) {
    await prisma.employee.create({
      data: {
        employeeNumber: staff.number,
        rosterProfile: "MIX",
        depot: DEPOT,
        qualifications: [],
        employeeGroup: "MACHINIST",
        company: "NSR",
        contractHours: 40,
        identity: {
          create: {
            displayName: staff.name,
            email: `${staff.number}@voorbeeld.intern`,
          },
        },
        account: {
          create: {
            roles: staff.roles,
            provider: "LOCAL",
            passwordHash,
            passwordSetAt: new Date(),
          },
        },
      },
    });
  }

  return employees;
}

function reservePreferenceFor(index: number) {
  const options = ["VROEG", "LAAT", "VROEG_LAAT", "VROEG_LAAT_NACHT", "GEEN_VOORKEUR"] as const;
  return options[index % options.length];
}

/**
 * Het concrete rooster uitschrijven.
 *
 * De positie in de cyclus volgt uit het aantal dagen sinds het ankerpunt plus
 * een verschuiving per lijn. Daardoor zit elke lijn in een andere week van de
 * cyclus, precies zoals bij een echt cyclisch rooster.
 */
/**
 * De roosterplaatsing van elke medewerker.
 *
 * ## Waarom dit in de seed hoort en niet in een los script
 *
 * Een medewerker zonder plaatsing heeft geen rooster. Niet "een leeg rooster" —
 * geen. De projectie kan dan niets zeggen, de rotatie heeft geen anker, en de
 * schermen tonen een lege week zonder uit te leggen waarom. Zolang dit een
 * apart script was dat je ná de seed nog moest draaien, was een half gevulde
 * database de normale toestand na `npm run db:seed`.
 *
 * Het anker is de regel waarop iemand in de ankerweek staat. Van daaruit volgt
 * elke andere week uit de formule; er wordt niets per week bijgewerkt.
 */
async function createMemberships(employees: readonly SeedEmployee[]): Promise<void> {
  const ankerWeek = isoWeekOfDate(CYCLE_ANCHOR);
  let gemaakt = 0;

  for (const employee of employees) {
    if (!employee.line) {
      continue;
    }
    const roster = await prisma.baseRoster.findUnique({
      where: { code: employee.line.rosterCode },
      select: { id: true },
    });
    if (!roster) {
      throw new Error(`Rooster ${employee.line.rosterCode} bestaat niet.`);
    }

    await prisma.rosterMembership.create({
      data: {
        employeeId: employee.id,
        locationCode: DEPOT,
        baseRosterId: roster.id,
        lineCount: employee.line.lineCount,
        anchorRuleIndex: employee.line.lineNumber,
        anchorWeek: ankerWeek,
        validFrom: toDatabaseDate(CYCLE_ANCHOR),
        validUntil: null,
        placementType: "PERMANENT",
        status: "ACTIVE",
        reason: "Ontwikkelgegevens: verzonnen plaatsing op een echte roosterregel.",
      },
    });
    gemaakt += 1;
  }

  console.log(`  ${gemaakt} permanente roosterplaatsingen vastgelegd.`);
}

/**
 * Het concrete rooster per datum.
 *
 * ## Waarom dit dezelfde formule gebruikt als de rest van de applicatie
 *
 * Welke regel iemand een bepaalde week rijdt, volgt uit het anker:
 *
 *     regel = ((anker - 1 + verstrekenWeken) mod N) + 1
 *
 * Die formule staat in `src/domain/roster-rotation.ts` en wordt hier aangeroepen
 * in plaats van nagerekend. Een seed met een eigen rotatie is een seed die de
 * projectie kan tegenspreken zonder dat een test dat merkt — en dan is de vraag
 * "klopt het scherm?" niet meer te beantwoorden.
 */
async function materialiseSchedule(
  employees: readonly SeedEmployee[],
  dutyIdByCode: ReadonlyMap<string, string>,
): Promise<void> {
  const today = toCalendarDate(new Date());
  const ankerWeek = isoWeekOfDate(CYCLE_ANCHOR);

  // Per rooster de regels, zodat de rotatie de juiste regel kan opzoeken.
  const regelsPerRooster = new Map<string, Map<number, SeedLine>>();
  for (const line of employees.flatMap((employee) => (employee.line ? [employee.line] : []))) {
    const rooster = regelsPerRooster.get(line.rosterCode) ?? new Map<number, SeedLine>();
    rooster.set(line.lineNumber, line);
    regelsPerRooster.set(line.rosterCode, rooster);
  }

  const rows: {
    employeeId: string;
    date: Date;
    positionType: "DUTY" | "RES" | "RUST";
    dutyId: string | null;
  }[] = [];
  let zonderDienst = 0;

  for (const employee of employees) {
    if (!employee.line) {
      continue;
    }
    const rooster = regelsPerRooster.get(employee.line.rosterCode);
    if (!rooster) {
      continue;
    }
    const anker = {
      anchorRuleIndex: employee.line.lineNumber,
      anchorWeek: ankerWeek,
      lineCount: employee.line.lineCount,
    };

    for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset += 1) {
      const date = addDays(today, offset);
      const regelNummer = ruleForWeek(anker, isoWeekOfDate(date));
      const regel = rooster.get(regelNummer);
      if (!regel) {
        continue;
      }

      // ISO-weekdag: maandag 1 tot en met zondag 7.
      const weekdag = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
      const dag = regel.days.find((kandidaat) => kandidaat.weekday === weekdag);
      if (!dag) {
        continue;
      }

      // WR en CO zijn vrije dagen; het concrete rooster kent daar (nog) geen
      // eigen soort voor en zet ze als rust. Dat staat ook zo in
      // docs/rule-coverage.md: hun eigen regels zijn niet aangeleverd.
      const positionType =
        dag.positionType === "DUTY" ? "DUTY" : dag.positionType === "RES" ? "RES" : "RUST";

      let dutyId: string | null = null;
      if (dag.positionType === "DUTY" && dag.dutyCode) {
        dutyId = dutyIdByCode.get(dutyKey(dag.dutyCode, weekdag)) ?? null;
        if (dutyId === null) {
          // Een roosterregel die naar een dienst wijst die niet bestaat, is een
          // gat dat je later niet meer terugvindt. Hier hoort het niet voor te
          // komen: beide komen uit dezelfde bladen.
          zonderDienst += 1;
        }
      }

      rows.push({
        employeeId: employee.id,
        date: toDatabaseDate(date),
        positionType,
        dutyId,
      });
    }
  }

  if (zonderDienst > 0) {
    throw new Error(
      `${zonderDienst} roosterdagen verwijzen naar een dienst die niet in het pakket staat. ` +
        "De seed stopt in plaats van lege dienstdagen weg te schrijven.",
    );
  }

  // In blokken wegschrijven: één createMany met tienduizenden rijen loopt tegen
  // de parametergrens van de driver aan.
  const chunkSize = 1000;
  for (let index = 0; index < rows.length; index += chunkSize) {
    await prisma.scheduledDuty.createMany({ data: rows.slice(index, index + chunkSize) });
  }
  console.log(`  ${rows.length} roosterdagen weggeschreven.`);
}

async function createRotationLists(employees: readonly SeedEmployee[]): Promise<void> {
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    // Per weekdag een andere basisvolgorde: dat is het hele punt van aparte
    // lijsten. De verschuiving is deterministisch, zodat de seed herhaalbaar is.
    const ordered = employees.map((employee, index) => ({
      employee,
      baseIndex: (index + weekday * 7) % employees.length,
    }));

    await prisma.rotationList.create({
      data: {
        weekday,
        depot: DEPOT,
        offset: 0,
        entries: {
          create: ordered.map((entry) => ({
            employeeId: entry.employee.id,
            baseIndex: entry.baseIndex,
          })),
        },
      },
    });
  }
}

/**
 * Een handvol beschikbare diensten.
 *
 * Eén ervan blijft op `RESERVE_PENDING`: die staat nog bij het reserve-rooster
 * en hoort in geen enkele medewerkerslijst te verschijnen. Dat is het verschil
 * dat het scherm moet laten zien.
 */
async function createAvailableDuties(employees: readonly SeedEmployee[]): Promise<void> {
  const today = toCalendarDate(new Date());

  // De diensten worden uit de echte set gekozen, en per datum wordt de dienst
  // van díe weekdag genomen. Een openstaande dienst van maandag op een
  // donderdag zetten zou een aanbod opleveren dat in werkelijkheid niet bestaat.
  const beschikbaar = await prisma.duty.findMany({
    select: { id: true, code: true, weekday: true, kinds: true, startMinute: true },
    orderBy: [{ weekday: "asc" }, { numericCode: "asc" }],
  });

  const kiesVoor = (
    dayOffset: number,
    past: (duty: (typeof beschikbaar)[number]) => boolean,
  ): { dutyId: string; dayOffset: number } | null => {
    const weekdag = ((new Date(`${addDays(today, dayOffset)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const gevonden = beschikbaar.find((duty) => duty.weekday === weekdag && past(duty));
    return gevonden ? { dutyId: gevonden.id, dayOffset } : null;
  };

  const wanted = [
    { keuze: kiesVoor(3, (d) => d.kinds.includes("VROEG")), status: "OPEN" as const },
    { keuze: kiesVoor(4, (d) => d.kinds.includes("LAAT")), status: "OPEN" as const },
    { keuze: kiesVoor(6, (d) => d.kinds.includes("VROEG")), status: "OPEN" as const },
    { keuze: kiesVoor(8, (d) => d.kinds.includes("LAAT")), status: "OPEN" as const },
    // Nacht én rangeer: alleen zichtbaar voor wie nacht in zijn profiel heeft
    // én de rangeerbevoegdheid bezit.
    {
      keuze: kiesVoor(9, (d) => d.kinds.includes("NACHT") && d.kinds.includes("RANGEER")),
      status: "OPEN" as const,
    },
    { keuze: kiesVoor(2, (d) => d.kinds.includes("VROEG")), status: "RESERVE_PENDING" as const },
  ].flatMap((item) => (item.keuze ? [{ ...item.keuze, status: item.status }] : []));

  if (wanted.length === 0) {
    throw new Error("Er is geen enkele beschikbare dienst te kiezen uit de echte dienstenset.");
  }

  for (const [index, item] of wanted.entries()) {
    const dutyId = item.dutyId;
    const date = addDays(today, item.dayOffset);

    await prisma.availableDuty.create({
      data: {
        dutyId,
        date: toDatabaseDate(date),
        status: item.status,
        // De oorspronkelijke houder van de dienst; leeg bij de laatste, om ook
        // die situatie te tonen.
        originEmployeeId: index < wanted.length - 1 ? employees[index % employees.length].id : null,
        openedAt: item.status === "OPEN" ? new Date() : null,
        // Inschrijven kan tot de avond voor de dienst.
        closesAt: new Date(`${addDays(date, -1)}T20:00:00.000Z`),
      },
    });
  }

  // Voor de dienst die nog bij reserve ligt, wordt de poging vastgelegd. Zonder
  // dat spoor is niet aantoonbaar dat reserve eerst aan bod kwam.
  const pending = await prisma.availableDuty.findFirst({
    where: { status: "RESERVE_PENDING" },
    select: { id: true },
  });
  if (pending) {
    await prisma.reserveFillAttempt.create({
      data: {
        availableDutyId: pending.id,
        outcome: "SKIPPED",
        candidatesConsidered: 0,
        details: { toelichting: "Nog niet aangeboden aan het reserve-rooster." },
      },
    });
  }
}

/**
 * Kwartaalfeedback.
 *
 * Bewust ongelijk verdeeld: twee profielen krijgen genoeg antwoorden om te
 * tonen, en één profiel blijft onder de drempel. Zo is in het plannerscherm te
 * zien dat onderdrukking werkt, in plaats van dat je het moet geloven.
 */
async function createFeedback(employees: readonly SeedEmployee[]): Promise<void> {
  const now = new Date();
  const quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;

  const answers: Record<string, string[][]> = {
    VROEG_LAAT: [
      ["TE_VEEL_VROEG"],
      ["TE_VEEL_VROEG", "BETERE_WEEKENDVERDELING"],
      ["TE_VEEL_VROEG"],
      ["TEVREDEN"],
      ["TE_VEEL_VROEG", "ONVOLDOENDE_AFWISSELING"],
      ["BETERE_WEEKENDVERDELING"],
      ["TE_VEEL_VROEG"],
      ["TEVREDEN"],
    ],
    MIX: [
      ["TE_VEEL_NACHT"],
      ["TE_VEEL_NACHT", "TE_VEEL_RANGEER"],
      ["ONVOLDOENDE_AFWISSELING"],
      ["TE_VEEL_NACHT"],
      ["TEVREDEN"],
      ["TE_VEEL_RANGEER"],
    ],
    // Te weinig antwoorden: dit profiel hoort onderdrukt te worden.
    LAAT_NACHT: [["TE_VEEL_NACHT"], ["TEVREDEN"]],
  };

  for (const [profile, sets] of Object.entries(answers)) {
    const candidates = employees.filter((employee) => employee.profile === profile);
    for (const [index, categories] of sets.entries()) {
      const employee = candidates[index];
      if (!employee?.line) {
        continue;
      }
      await prisma.quarterlyFeedback.create({
        data: {
          employeeId: employee.id,
          quarterKey: quarter,
          baseRosterCode: employee.line.rosterCode,
          rosterProfile: profile as RosterProfile,
          categories: categories as never,
          satisfaction: categories.includes("TEVREDEN") ? 4 : 2 + (index % 2),
        },
      });
    }
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
