import "server-only";
import { type CalendarDate, addDays, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { cache } from "react";
import { DEFAULT_PRODUCT_PARAMETERS } from "@/server/rules-engine";
import type {
  AssignmentCheck,
  AuthorisedException,
  DutyContext,
  PlanningStage,
  ScheduleWindow,
} from "@/server/rules-engine";
import type { RosterPositionType } from "@/lib/generated/prisma/enums";
import { prisma } from "../prisma";
import { DUTY_SELECT, EMPLOYEE_SELECT, toEmployeeContext, toScheduleDayContext } from "../mappers";

/**
 * Roostergegevens ophalen.
 *
 * De belangrijkste taak van dit bestand is het bouwen van het venster dat de
 * Rules Engine nodig heeft. Dat is meer werk dan het lijkt, en juist daarom
 * staat het op één plek: elke aanroeper die zijn eigen venster in elkaar zet,
 * bouwt vroeg of laat een venster dat net iets te smal is, en dan keurt de
 * engine dingen goed op grond van gegevens die er niet waren.
 */

const WINDOW_BACK = DEFAULT_PRODUCT_PARAMETERS.windowDaysBack;
const WINDOW_FORWARD = DEFAULT_PRODUCT_PARAMETERS.windowDaysForward;

export interface ScheduleDayView {
  readonly id: string;
  readonly date: CalendarDate;
  readonly positionType: string;
  readonly source: string;
  readonly duty: {
    readonly id: string;
    readonly code: string;
    readonly kinds: readonly string[];
    readonly startMinute: number;
    readonly endMinute: number;
    readonly weight: number;
    readonly description: string | null;
  } | null;
}

/** Het rooster van één medewerker over een periode. */
export async function scheduleForEmployee(
  employeeId: string,
  from: CalendarDate,
  to: CalendarDate,
): Promise<readonly ScheduleDayView[]> {
  const rows = await prisma.scheduledDuty.findMany({
    where: {
      employeeId,
      date: { gte: toDatabaseDate(from), lte: toDatabaseDate(to) },
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      positionType: true,
      source: true,
      duty: { select: { ...DUTY_SELECT, description: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    date: toCalendarDate(row.date),
    positionType: row.positionType,
    source: row.source,
    duty: row.duty
      ? {
          id: row.duty.id,
          code: row.duty.code,
          kinds: row.duty.kinds,
          startMinute: row.duty.startMinute,
          endMinute: row.duty.endMinute,
          weight: row.duty.weight,
          description: row.duty.description,
        }
      : null,
  }));
}

/**
 * Het venster rond een datum, klaar voor de engine.
 *
 * `excludeDutyIds` haalt de dienst weg die wordt ingeleverd. Zonder dat zou een
 * ruil altijd op zichzelf stuklopen: de eigen dienst zou als bezetting van de
 * dag gelden en als naburige dienst meetellen in de rustberekening.
 */
export async function windowForEmployee(
  employeeId: string,
  date: CalendarDate,
  options: { readonly excludeScheduledDutyIds?: readonly string[] } = {},
): Promise<ScheduleWindow> {
  const from = addDays(date, -WINDOW_BACK);
  const to = addDays(date, WINDOW_FORWARD);
  const excluded = new Set(options.excludeScheduledDutyIds ?? []);
  const rows = await windowRows(employeeId, from, to);

  return {
    from,
    to,
    days: rows.filter((row) => !excluded.has(row.id)).map(toScheduleDayContext),
  };
}

/**
 * De ruwe roosterrijen, één keer per verzoek opgehaald.
 *
 * Beschikbare diensten toetst tientallen diensten op dezelfde dag voor dezelfde
 * medewerker. Zonder deze cache is dat evenzoveel keer hetzelfde jaar rooster
 * uit de database halen. `cache` van React geldt per verzoek en houdt dus geen
 * gegevens vast tussen gebruikers of aanvragen door.
 */
const windowRows = cache(
  async (employeeId: string, from: CalendarDate, to: CalendarDate) =>
    prisma.scheduledDuty.findMany({
      where: {
        employeeId,
        date: { gte: toDatabaseDate(from), lte: toDatabaseDate(to) },
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        positionType: true,
        duty: { select: DUTY_SELECT },
      },
    }),
);

/** De medewerkercontext voor de engine. Bevat geen persoonsgegevens. */
export async function employeeContext(employeeId: string) {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: EMPLOYEE_SELECT,
  });
  return row ? toEmployeeContext(row) : null;
}

/**
 * Bouwt de vraag "mag deze medewerker op deze dag deze dienst rijden?".
 *
 * De helper bestaat zodat elke aanroeper — beschikbare diensten, ruil,
 * reserve-invulling — dezelfde vraag op dezelfde manier stelt.
 */
export async function buildAssignmentCheck(options: {
  readonly employeeId: string;
  readonly date: CalendarDate;
  readonly duty: DutyContext;
  readonly surrenderScheduledDutyId?: string | null;
  readonly surrendering?: DutyContext | null;
  /**
   * De planningsfase. Standaard de operationele fase, want elke aanroeper in
   * deze applicatie wijzigt een lopend rooster; het genereren van een
   * basisrooster geeft `BASE_ROSTER` uitdrukkelijk mee.
   */
  readonly planningStage?: PlanningStage;
  readonly exceptions?: readonly AuthorisedException[];
}): Promise<AssignmentCheck> {
  const employee = await employeeContext(options.employeeId);
  if (!employee) {
    throw new Error(`Onbekende medewerker: ${options.employeeId}`);
  }
  const window = await windowForEmployee(options.employeeId, options.date, {
    excludeScheduledDutyIds: options.surrenderScheduledDutyId
      ? [options.surrenderScheduledDutyId]
      : [],
  });
  return {
    employee,
    date: options.date,
    duty: options.duty,
    window,
    surrendering: options.surrendering ?? null,
    planningStage: options.planningStage ?? "POST_DW_OPERATIONAL",
    exceptions: options.exceptions ?? [],
    replacedPosition: replacedPositionOn(window, options.date),
  };
}

/** Wat er op de betrokken dag stond vóór deze plaatsing. */
function replacedPositionOn(
  window: ScheduleWindow,
  date: CalendarDate,
): RosterPositionType | null {
  return window.days.find((day) => day.date === date)?.positionType ?? null;
}

/** De concrete roosterdag van een medewerker, inclusief dienst. */
export async function scheduledDuty(scheduledDutyId: string) {
  return prisma.scheduledDuty.findUnique({
    where: { id: scheduledDutyId },
    select: {
      id: true,
      employeeId: true,
      date: true,
      positionType: true,
      duty: { select: DUTY_SELECT },
    },
  });
}
