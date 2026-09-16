import "server-only";
import { RosterPositionType, SwapStatus } from "@/lib/generated/prisma/enums";
import {
  type CalendarDate,
  addDays,
  isoWeekKey,
  isoWeekday,
  toCalendarDate,
  toDatabaseDate,
} from "@/domain/time";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";
import { scheduleForEmployee } from "@/server/data/repositories/schedule-repository";
import type { ScheduleDayView } from "@/server/data/repositories/schedule-repository";
import { feedbackEligibility } from "./feedback-service";

/**
 * Het medewerkerdashboard.
 *
 * Eén service die de startpagina van een medewerker vult. Alles wat hij ophaalt
 * gaat over de medewerker zelf; er is geen parameter waarmee je een ander kunt
 * opgeven, en dus ook niets om mee te manipuleren.
 *
 * ## Berichten zijn afgeleid, niet opgeslagen
 *
 * Er is geen berichtenmodel. Wat de medewerker als "berichten" ziet, wordt
 * afgeleid uit wat er feitelijk is gebeurd: een ruilvoorstel dat op antwoord
 * wacht, een dienst die is opengesteld, feedback die nog openstaat. Dat is
 * bewust: een berichtentabel die naast de werkelijkheid kan gaan lopen, levert
 * meldingen op over dingen die niet meer bestaan.
 */

export interface EmployeeProfileView {
  readonly employeeNumber: string;
  readonly rosterProfileLabel: string;
  readonly depot: string;
  readonly baseRosterCode: string | null;
  readonly lineNumber: number | null;
}

export interface WeekDayView {
  readonly date: CalendarDate;
  readonly weekday: number;
  readonly positionType: RosterPositionType;
  readonly dutyCode: string | null;
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly kinds: readonly string[];
}

export interface MessageView {
  readonly id: string;
  readonly tone: "info" | "ok" | "warn";
  readonly title: string;
  readonly body: string;
  readonly at: Date;
}

export interface BalanceView {
  readonly plannedMinutesThisMonth: number;
  readonly workedMinutesSoFar: number;
  readonly nightDutiesThisMonth: number;
  readonly shuntingDutiesThisMonth: number;
  readonly restDaysThisMonth: number;
}

export interface EmployeeDashboard {
  readonly today: CalendarDate;
  readonly profile: EmployeeProfileView;
  readonly upcoming: readonly ScheduleDayView[];
  readonly week: {
    readonly key: string;
    readonly from: CalendarDate;
    readonly to: CalendarDate;
    readonly days: readonly WeekDayView[];
  };
  readonly messages: readonly MessageView[];
  readonly balance: BalanceView;
  readonly incomingSwaps: readonly {
    readonly id: string;
    readonly fromEmployeeNumber: string;
    readonly theirDutyCode: string;
    readonly theirDate: CalendarDate;
    readonly yourDutyCode: string;
    readonly yourDate: CalendarDate;
    readonly expiresAt: Date;
  }[];
  readonly outgoingSwaps: readonly {
    readonly id: string;
    readonly toEmployeeNumber: string;
    readonly ownDutyCode: string;
    readonly ownDate: CalendarDate;
    readonly status: SwapStatus;
  }[];
  readonly waitlists: readonly {
    readonly code: string;
    readonly profileLabel: string;
    readonly enrolledAt: Date;
    readonly position: number;
  }[];
  readonly feedback: { readonly quarterKey: string; readonly alreadySubmitted: boolean };
}

export async function employeeDashboard(weekStart?: CalendarDate): Promise<EmployeeDashboard> {
  const actor = await requirePermission(PERMISSIONS.SCHEDULE_READ_OWN);
  const today = toCalendarDate(new Date());
  const monday = weekStart ?? addDays(today, 1 - isoWeekday(today));

  const [employee, assignment, upcoming, weekRows, incoming, outgoing, waitlistRows, feedback] =
    await Promise.all([
      prisma.employee.findUniqueOrThrow({
        where: { id: actor.employeeId },
        select: { employeeNumber: true, rosterProfile: true, depot: true },
      }),
      currentAssignment(actor.employeeId),
      scheduleForEmployee(actor.employeeId, today, addDays(today, 13)),
      scheduleForEmployee(actor.employeeId, monday, addDays(monday, 6)),
      incomingSwapProposals(actor.employeeId),
      outgoingSwapProposals(actor.employeeId),
      waitlistPositions(actor.employeeId),
      feedbackEligibility(),
    ]);

  const balance = await monthlyBalance(actor.employeeId, today);

  return {
    today,
    profile: {
      employeeNumber: employee.employeeNumber,
      rosterProfileLabel: rosterProfileLabel(employee.rosterProfile),
      depot: employee.depot,
      baseRosterCode: assignment?.baseRosterCode ?? null,
      lineNumber: assignment?.lineNumber ?? null,
    },
    upcoming: upcoming.filter((day) => day.positionType !== RosterPositionType.RUST).slice(0, 5),
    week: {
      key: isoWeekKey(monday),
      from: monday,
      to: addDays(monday, 6),
      days: buildWeek(monday, weekRows),
    },
    messages: buildMessages({ incoming, feedback, today }),
    balance,
    incomingSwaps: incoming,
    outgoingSwaps: outgoing,
    waitlists: waitlistRows,
    feedback: { quarterKey: feedback.quarterKey, alreadySubmitted: feedback.alreadySubmitted },
  };
}

/**
 * De week als zeven vakjes.
 *
 * Dagen zonder roosterrij krijgen expliciet RUST in plaats van te ontbreken:
 * een weekstrook met gaten leest als ontbrekende gegevens, terwijl het gewoon
 * een vrije dag is.
 */
function buildWeek(monday: CalendarDate, rows: readonly ScheduleDayView[]): readonly WeekDayView[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(monday, offset);
    const row = byDate.get(date);
    return {
      date,
      weekday: offset + 1,
      positionType: (row?.positionType as RosterPositionType) ?? RosterPositionType.RUST,
      dutyCode: row?.duty?.code ?? null,
      startMinute: row?.duty?.startMinute ?? null,
      endMinute: row?.duty?.endMinute ?? null,
      kinds: row?.duty?.kinds ?? [],
    };
  });
}

async function currentAssignment(employeeId: string) {
  const row = await prisma.rosterAssignment.findFirst({
    where: {
      employeeId,
      validFrom: { lte: new Date() },
      OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
    },
    orderBy: { validFrom: "desc" },
    select: {
      rosterLine: { select: { lineNumber: true, baseRoster: { select: { code: true } } } },
    },
  });
  return row
    ? { baseRosterCode: row.rosterLine.baseRoster.code, lineNumber: row.rosterLine.lineNumber }
    : null;
}

async function incomingSwapProposals(employeeId: string) {
  const rows = await prisma.swapProposal.findMany({
    where: {
      counterpartyEmployeeId: employeeId,
      status: SwapStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      expiresAt: true,
      initiatorEmployee: { select: { employeeNumber: true } },
      initiatorDuty: { select: { date: true, duty: { select: { code: true } } } },
      counterpartyDuty: { select: { date: true, duty: { select: { code: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fromEmployeeNumber: row.initiatorEmployee.employeeNumber,
    theirDutyCode: row.initiatorDuty.duty?.code ?? "?",
    theirDate: toCalendarDate(row.initiatorDuty.date),
    yourDutyCode: row.counterpartyDuty.duty?.code ?? "?",
    yourDate: toCalendarDate(row.counterpartyDuty.date),
    expiresAt: row.expiresAt,
  }));
}

async function outgoingSwapProposals(employeeId: string) {
  const rows = await prisma.swapProposal.findMany({
    where: { initiatorEmployeeId: employeeId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      counterpartyEmployee: { select: { employeeNumber: true } },
      initiatorDuty: { select: { date: true, duty: { select: { code: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    toEmployeeNumber: row.counterpartyEmployee.employeeNumber,
    ownDutyCode: row.initiatorDuty.duty?.code ?? "?",
    ownDate: toCalendarDate(row.initiatorDuty.date),
    status: row.status,
  }));
}

async function waitlistPositions(employeeId: string) {
  const entries = await prisma.waitlistEntry.findMany({
    where: { employeeId, status: "ACTIVE" },
    select: {
      enrolledAt: true,
      baseRoster: { select: { id: true, code: true, profile: true } },
    },
  });

  const result = [];
  for (const entry of entries) {
    // De positie volgt uitsluitend uit de inschrijfdatum; hij wordt hier
    // geteld en niet opgeslagen, zodat er geen tweede waarheid kan ontstaan.
    const ahead = await prisma.waitlistEntry.count({
      where: {
        baseRosterId: entry.baseRoster.id,
        status: "ACTIVE",
        enrolledAt: { lt: entry.enrolledAt },
      },
    });
    result.push({
      code: entry.baseRoster.code,
      profileLabel: rosterProfileLabel(entry.baseRoster.profile),
      enrolledAt: entry.enrolledAt,
      position: ahead + 1,
    });
  }
  return result;
}

/**
 * De maandbalans.
 *
 * Uren worden berekend uit de daadwerkelijke dienstduren, niet uit een
 * urenregistratie: die zit in een ander systeem. Wat hier staat is dus "wat het
 * rooster zegt", en dat is precies wat een medewerker op zijn roosterportaal
 * verwacht. Een WTV- of verlofsaldo staat er bewust niet bij; dat komt uit de
 * personeelsadministratie en wordt niet geraden.
 */
async function monthlyBalance(employeeId: string, today: CalendarDate): Promise<BalanceView> {
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = addDays(`${today.slice(0, 7)}-28`, 7);
  const monthEnd = addDays(`${nextMonth.slice(0, 7)}-01`, -1);

  const rows = await prisma.scheduledDuty.findMany({
    where: {
      employeeId,
      date: { gte: toDatabaseDate(monthStart), lte: toDatabaseDate(monthEnd) },
    },
    select: {
      date: true,
      positionType: true,
      duty: { select: { startMinute: true, endMinute: true, kinds: true } },
    },
  });

  let planned = 0;
  let worked = 0;
  let nights = 0;
  let shunting = 0;
  let restDays = 0;

  for (const row of rows) {
    if (row.positionType === RosterPositionType.RUST) {
      restDays += 1;
    }
    if (!row.duty) {
      continue;
    }
    const minutes = row.duty.endMinute - row.duty.startMinute;
    planned += minutes;
    if (toCalendarDate(row.date) <= today) {
      worked += minutes;
    }
    if (row.duty.kinds.includes("NACHT")) {
      nights += 1;
    }
    if (row.duty.kinds.includes("RANGEER")) {
      shunting += 1;
    }
  }

  return {
    plannedMinutesThisMonth: planned,
    workedMinutesSoFar: worked,
    nightDutiesThisMonth: nights,
    shuntingDutiesThisMonth: shunting,
    restDaysThisMonth: restDays,
  };
}

function buildMessages(input: {
  incoming: readonly { fromEmployeeNumber: string; expiresAt: Date }[];
  feedback: { quarterKey: string; alreadySubmitted: boolean };
  today: CalendarDate;
}): readonly MessageView[] {
  const messages: MessageView[] = [];

  for (const [index, swap] of input.incoming.entries()) {
    messages.push({
      id: `ruil-${index}`,
      tone: "warn",
      title: "Ruilvoorstel ontvangen",
      body: `Medewerker ${swap.fromEmployeeNumber} heeft u een ruilvoorstel gestuurd.`,
      at: swap.expiresAt,
    });
  }

  if (!input.feedback.alreadySubmitted) {
    messages.push({
      id: "feedback",
      tone: "info",
      title: `Kwartaalfeedback ${input.feedback.quarterKey}`,
      body: "U kunt dit kwartaal feedback geven over uw eigen basisrooster.",
      at: new Date(),
    });
  }

  return messages.slice(0, 5);
}

/** Eigen diensten die aangeboden kunnen worden voor ruil. */
export async function ownSwappableDuties(): Promise<
  readonly { id: string; date: CalendarDate; dutyCode: string }[]
> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  const today = toCalendarDate(new Date());

  const rows = await prisma.scheduledDuty.findMany({
    where: {
      employeeId: actor.employeeId,
      positionType: RosterPositionType.DUTY,
      dutyId: { not: null },
      // Ruilen kan alleen vooruit. Een dienst van gisteren ruilen heeft geen
      // betekenis en zou het rooster met terugwerkende kracht wijzigen.
      date: { gte: toDatabaseDate(today) },
    },
    orderBy: { date: "asc" },
    take: 60,
    select: { id: true, date: true, duty: { select: { code: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    date: toCalendarDate(row.date),
    dutyCode: row.duty?.code ?? "?",
  }));
}
