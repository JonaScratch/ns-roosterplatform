import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { type CalendarDate, addDays, isoWeekday, toCalendarDate } from "@/domain/time";
import { zonedInstant } from "@/domain/amsterdam-time";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import type { AssignmentRequest } from "@/server/rules-engine/validation/subject";
import type { TimelineDay } from "@/server/rules-engine/validation/timeline";

/**
 * Onafhankelijke natelling van de rood-weekendbevindingen.
 *
 * ## Waarom dit los van de engine staat
 *
 * Een steekproef die met dezelfde code wordt gecontroleerd als de code die de
 * bevinding maakte, bewijst alleen dat de code met zichzelf overeenstemt. Dit
 * script leest de roosterrijen rechtstreeks uit de database en beantwoordt de
 * twee vragen van CAO art. 102 lid 3 met een eigen, opzettelijk domme
 * berekening: staat er een dienst in het venster zaterdag 00:00 – maandag 04:00,
 * en hoe lang is de aaneengesloten rust eromheen?
 *
 * Wat het níét doet: oordelen. Of een overschrijding een overtreding is, hangt
 * af van vrijstellingen en collectieve afwijkingen die niet zijn aangeleverd.
 * Dit script laat alleen zien of de rekenkundige bewering klopt.
 *
 * Draaien met: npx tsx --conditions=react-server scripts/audit-rood-weekend.ts
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const MINIMUM_REST_MINUTES = 60 * 60;
const WINDOW_END_MINUTE = 2 * 1440 + 4 * 60;

interface Duty {
  readonly date: CalendarDate;
  readonly code: string;
  readonly start: number;
  readonly end: number;
}

interface WeekendFacts {
  readonly saturday: CalendarDate;
  readonly dutiesInWindow: readonly string[];
  readonly restMinutes: number;
  readonly restFrom: string;
  readonly restTo: string;
  readonly saturday00Included: boolean;
  readonly monday04Included: boolean;
  readonly qualifies: boolean;
}

async function main(): Promise<void> {
  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE", rosterAssignments: { some: {} } },
    select: { id: true, employeeNumber: true },
    orderBy: { employeeNumber: "asc" },
  });

  let examined = 0;
  let breaches = 0;
  let atLeastOneQualifying = 0;
  // Reeksen waarin de medewerker geen enkele dienst heeft. De engine beoordeelt
  // per dienstdag en komt zo'n reeks dus nooit tegen.
  let withoutDuty = 0;
  const printed: string[] = [];
  /** De reeksen die deze onafhankelijke telling als tekortkoming aanmerkt. */
  const independentKeys = new Set<string>();
  /** De reeksen die de engine meldt, verzameld over dezelfde roosterdagen. */
  const engineKeys = new Set<string>();

  for (const employee of employees) {
    const rows = await prisma.scheduledDuty.findMany({
      where: { employeeId: employee.id, duty: { isNot: null } },
      orderBy: { date: "asc" },
      select: { date: true, duty: { select: { code: true, startMinute: true, endMinute: true } } },
    });
    if (rows.length === 0) {
      continue;
    }

    const duties: Duty[] = rows.map((row) => ({
      date: toCalendarDate(row.date),
      code: row.duty!.code,
      start: zonedInstant(toCalendarDate(row.date), row.duty!.startMinute),
      end: zonedInstant(toCalendarDate(row.date), row.duty!.endMinute),
    }));

    const first = duties[0].date;
    const last = duties[duties.length - 1].date;

    // Alleen weekenden met vier dagen marge aan weerszijden: anders kan de rust
    // eromheen niet worden gemeten en is het antwoord onbekend.
    const saturdays: CalendarDate[] = [];
    for (let day = addDays(first, 4); day <= addDays(last, -4); day = addDays(day, 1)) {
      if (isoWeekday(day) === 6) {
        saturdays.push(day);
      }
    }

    const facts = saturdays.map((saturday) => weekendFacts(duties, saturday));

    for (let index = 0; index + 3 <= facts.length; index += 1) {
      const run = facts.slice(index, index + 3);
      examined += 1;
      if (run.some((entry) => entry.qualifies)) {
        atLeastOneQualifying += 1;
        continue;
      }
      breaches += 1;
      const from = run[0].saturday;
      const to = addDays(run[2].saturday, 2);
      if (!duties.some((duty) => duty.date >= from && duty.date <= to)) {
        withoutDuty += 1;
      }

      independentKeys.add(`${employee.employeeNumber}|${from}..${to}`);

      if (printed.length < 20) {
        printed.push(describe(employee.employeeNumber, run));
      }
    }
  }

  await collectEngineKeys(engineKeys);

  console.log("ONAFHANKELIJKE NATELLING — CAO art. 102 lid 3");
  console.log("════════════════════════════════════════════════════════════");
  console.log("Eis 1: een aaneengesloten rustperiode van minimaal 60 uur.");
  console.log("Eis 2: die rustperiode omvat zaterdag 00:00 tot en met maandag 04:00.");
  console.log("Beoordeeld wordt elke reeks van drie opeenvolgende weekenden waarvoor");
  console.log("het rooster vier dagen aan weerszijden bekend is.\n");
  console.log(`Beoordeelde reeksen van drie weekenden   ${examined}`);
  console.log(`  met ten minste één voldoend weekend    ${atLeastOneQualifying}`);
  console.log(`  zonder enig voldoend weekend           ${breaches}`);
  console.log(`    waarvan zonder dienst in de reeks    ${withoutDuty}`);
  console.log(`    dus zichtbaar voor de engine         ${breaches - withoutDuty}`);
  const onlyIndependent = [...independentKeys].filter((key) => !engineKeys.has(key)).sort();
  const onlyEngine = [...engineKeys].filter((key) => !independentKeys.has(key)).sort();

  console.log("\nVergelijking met de engine:");
  console.log(`  reeksen gemeld door de engine          ${engineKeys.size}`);
  console.log(`  reeksen gemeld door deze natelling     ${independentKeys.size}`);
  console.log(`  in beide                               ${independentKeys.size - onlyIndependent.length}`);
  console.log(`  alleen door de natelling               ${onlyIndependent.length}`);
  console.log(`  alleen door de engine                  ${onlyEngine.length}`);
  for (const key of onlyIndependent.slice(0, 20)) {
    console.log(`    alleen natelling: ${key}`);
  }
  for (const key of onlyEngine.slice(0, 20)) {
    console.log(`    alleen engine:    ${key}`);
  }

  console.log(`\nEerste ${printed.length} gevallen, uitgeschreven:\n`);
  for (const block of printed) {
    console.log(block);
  }
  console.log("Dit toont dat de berekening klopt. Of het ook een overtreding ís,");
  console.log("hangt af van vrijstellingen, OR-afwijkingen en Bijlage IV — geen");
  console.log("van die bronnen is aangeleverd.");
}

/**
 * Draait de engine over alle dienstdagen en verzamelt de rood-weekendsleutels.
 *
 * Dezelfde invoer als `verify:rooster`, zodat het verschil met de natelling
 * alleen aan de regel-implementatie kan liggen en niet aan de gegevens.
 */
async function collectEngineKeys(into: Set<string>): Promise<void> {
  const ruleset = activeRuleset();
  const bounds = await prisma.scheduledDuty.aggregate({
    _min: { date: true },
    _max: { date: true },
  });
  const coverage = {
    from: toCalendarDate(bounds._min.date!),
    to: toCalendarDate(bounds._max.date!),
  };

  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE", rosterAssignments: { some: {} } },
    select: {
      id: true,
      employeeNumber: true,
      rosterProfile: true,
      depot: true,
      qualifications: true,
      employeeGroup: true,
      company: true,
      contractHours: true,
      earlyStartProtectionWaived: true,
      protections: true,
    },
    orderBy: { employeeNumber: "asc" },
  });

  for (const employee of employees) {
    const rows = await prisma.scheduledDuty.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: "asc" },
      select: {
        date: true,
        positionType: true,
        duty: {
          select: {
            id: true,
            code: true,
            kinds: true,
            startMinute: true,
            endMinute: true,
            depot: true,
            requiredQualifications: true,
            weight: true,
            breakMinutes: true,
            overtimeMinutes: true,
          },
        },
      },
    });

    const days: TimelineDay[] = rows.map((row) => ({
      date: toCalendarDate(row.date),
      positionType: row.positionType,
      duty: row.duty
        ? {
            dutyId: row.duty.id,
            code: row.duty.code,
            shape: {
              startMinute: row.duty.startMinute,
              endMinute: row.duty.endMinute,
              breakMinutes: row.duty.breakMinutes,
              overtimeMinutes: row.duty.overtimeMinutes,
            },
          }
        : null,
    }));

    for (const row of rows) {
      if (!row.duty) {
        continue;
      }
      const request: AssignmentRequest = {
        subject: {
          employeeId: employee.id,
          employeeNumber: employee.employeeNumber,
          employeeGroup: employee.employeeGroup,
          company: "NSR",
          depot: employee.depot,
          rosterProfile: employee.rosterProfile,
          qualifications: employee.qualifications,
          contractHours: employee.contractHours ? Number(employee.contractHours) : null,
          earlyStartProtectionWaived: employee.earlyStartProtectionWaived,
          protections: [],
        },
        date: toCalendarDate(row.date),
        candidate: {
          dutyId: row.duty.id,
          code: row.duty.code,
          kinds: row.duty.kinds as AssignmentRequest["candidate"]["kinds"],
          depot: row.duty.depot,
          requiredQualifications: [...row.duty.requiredQualifications],
          weight: row.duty.weight,
          shape: {
            startMinute: row.duty.startMinute,
            endMinute: row.duty.endMinute,
            breakMinutes: row.duty.breakMinutes,
            overtimeMinutes: row.duty.overtimeMinutes,
          },
        },
        planningStage: "BASE_ROSTER",
        reason: "REGRESSION_CHECK",
        timeline: { days, coverage },
        exceptions: [],
      };

      for (const violation of evaluateAssignment(request, ruleset).hardViolations) {
        if (violation.ruleId !== "RED_WEEKEND_MIN_REST") {
          continue;
        }
        const span = violation.occurrenceKey.split("weekendreeks:")[1];
        into.add(`${employee.employeeNumber}|${span}`);
      }
    }
  }
}

function weekendFacts(duties: readonly Duty[], saturday: CalendarDate): WeekendFacts {
  const windowStart = zonedInstant(saturday, 0);
  const windowEnd = zonedInstant(saturday, WINDOW_END_MINUTE);

  const inWindow = duties.filter((duty) => duty.start < windowEnd && duty.end > windowStart);

  // De rust rond het venster: van het einde van de laatste dienst die vóór het
  // venster afloopt tot het begin van de eerste dienst die erna begint.
  const before = duties.filter((duty) => duty.end <= windowStart).at(-1);
  const after = duties.find((duty) => duty.start >= windowEnd);

  const restFrom = before ? before.end : windowStart;
  const restTo = after ? after.start : windowEnd;
  const restMinutes = inWindow.length > 0 ? 0 : Math.round((restTo - restFrom) / 60_000);

  return {
    saturday,
    dutiesInWindow: inWindow.map((duty) => `${duty.date} ${duty.code}`),
    restMinutes,
    restFrom: stamp(restFrom),
    restTo: stamp(restTo),
    saturday00Included: inWindow.length === 0 && restFrom <= windowStart,
    monday04Included: inWindow.length === 0 && restTo >= windowEnd,
    qualifies:
      inWindow.length === 0 &&
      restFrom <= windowStart &&
      restTo >= windowEnd &&
      restMinutes >= MINIMUM_REST_MINUTES,
  };
}

function describe(employeeNumber: string, run: readonly WeekendFacts[]): string {
  const lines = [
    `medewerker ${employeeNumber} — weekenden ${run.map((entry) => entry.saturday).join(", ")}`,
  ];
  for (const entry of run) {
    if (entry.dutiesInWindow.length > 0) {
      lines.push(
        `  ${entry.saturday}  dienst in het venster: ${entry.dutiesInWindow.join(", ")}` +
          "  → geen rood weekend",
      );
      continue;
    }
    const reason = !entry.saturday00Included
      ? "rust begint ná zaterdag 00:00"
      : !entry.monday04Included
        ? "rust eindigt vóór maandag 04:00"
        : `rust is ${Math.floor(entry.restMinutes / 60)} u, minder dan 60 u`;
    lines.push(
      `  ${entry.saturday}  vrij van dienst, rust ${entry.restFrom} — ${entry.restTo} ` +
        `(${Math.floor(entry.restMinutes / 60)} u ${entry.restMinutes % 60} m)  → ${reason}`,
    );
  }
  return lines.join("\n") + "\n";
}

function stamp(instant: number): string {
  const iso = new Date(instant).toISOString();
  const date = iso.slice(0, 10) as CalendarDate;
  const offset = Math.round((instant - zonedInstant(date, 0)) / 60_000);
  // Terugrekenen naar lokale tijd via de eigen hulpfunctie, zodat de uitvoer
  // dezelfde klok toont als het roosterblad.
  const local = offset >= 0 && offset < 1440 ? { date, minutes: offset } : localise(instant);
  const hh = String(Math.floor(local.minutes / 60)).padStart(2, "0");
  const mm = String(local.minutes % 60).padStart(2, "0");
  return `${local.date} ${hh}:${mm}`;
}

function localise(instant: number): { date: CalendarDate; minutes: number } {
  const date = new Date(instant).toISOString().slice(0, 10) as CalendarDate;
  for (const candidate of [date, addDays(date, -1), addDays(date, 1)]) {
    const minutes = Math.round((instant - zonedInstant(candidate, 0)) / 60_000);
    if (minutes >= 0 && minutes < 1440) {
      return { date: candidate, minutes };
    }
  }
  return { date, minutes: 0 };
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
