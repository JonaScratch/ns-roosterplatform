import { DutyKind, RosterProfile, type RosterPositionType } from "@/lib/generated/prisma/enums";
import { type CalendarDate, addDays, dayNumber } from "@/domain/time";
import type { DutyShape } from "@/domain/duty-window";
import type { Timeline, TimelineDay } from "@/server/rules-engine/validation/timeline";
import type {
  AssignmentRequest,
  AssignmentSubject,
  AuthorisedException,
  PlanningStage,
  Protection,
} from "@/server/rules-engine/validation/subject";

/**
 * Roosters bouwen voor tests.
 *
 * De vorm die getest wordt is bijna altijd "deze dienst, met dit eromheen".
 * Zonder hulpmiddel kost elke test twintig regels opbouw en verdwijnt waar het
 * werkelijk om gaat tussen de vulling. Hier staat de vulling los: alles wat niet
 * genoemd wordt, is een rustdag, en de dekking is ruim genoeg om elk venster te
 * kunnen beoordelen — zodat een test die iets over een grens beweert, niet stil
 * op een contexthiaat stukloopt.
 */

/** Een dienst als "05:30-13:00", eventueel met "+45" voor de pauze. */
export function shape(text: string, overtimeMinutes = 0): DutyShape {
  const [times, breakText] = text.split("+");
  const [startText, endText] = times.split("-");
  const start = minuteOf(startText);
  const end = minuteOf(endText);
  return {
    startMinute: start,
    endMinute: end <= start ? end + 1440 : end,
    breakMinutes: breakText === undefined ? null : Number(breakText),
    overtimeMinutes,
  };
}

function minuteOf(text: string): number {
  const [hours, minutes] = text.trim().split(":").map(Number);
  return hours * 60 + minutes;
}

export interface DayPlan {
  readonly date: CalendarDate;
  /** Een dienst als "05:30-13:00", of niets voor een niet-werkdag. */
  readonly duty?: string;
  readonly code?: string;
  readonly position?: RosterPositionType;
  readonly overtimeMinutes?: number;
}

export const FULL_TIME_SUBJECT: AssignmentSubject = {
  employeeId: "emp-1",
  employeeNumber: "10001",
  employeeGroup: "MACHINIST",
  company: "NSR",
  depot: "DDR",
  rosterProfile: RosterProfile.VROEG_LAAT,
  qualifications: [],
  contractHours: 36,
  earlyStartProtectionWaived: false,
  protections: [],
};

export interface RequestSpec {
  readonly date: CalendarDate;
  /** De kandidaatdienst, als "05:30-13:00". */
  readonly duty: string;
  readonly code?: string;
  readonly kinds?: readonly DutyKind[];
  readonly overtimeMinutes?: number;
  readonly requiredQualifications?: readonly string[];
  /** Het rooster eromheen. Alles wat hier niet staat, is een rustdag. */
  readonly around?: readonly DayPlan[];
  readonly subject?: Partial<AssignmentSubject>;
  readonly protections?: readonly Protection[];
  readonly stage?: PlanningStage;
  readonly exceptions?: readonly AuthorisedException[];
  /** Hoeveel dagen rooster er aan weerszijden beschikbaar is. */
  readonly coverageDays?: number;
  /** De positie die de kandidaatdag had vóór de plaatsing. */
  readonly replacedPosition?: RosterPositionType;
}

export function buildRequest(spec: RequestSpec): AssignmentRequest {
  const coverageDays = spec.coverageDays ?? 400;
  const from = addDays(spec.date, -coverageDays);
  const to = addDays(spec.date, coverageDays);

  const planned = new Map<CalendarDate, DayPlan>();
  for (const day of spec.around ?? []) {
    planned.set(day.date, day);
  }

  const days: TimelineDay[] = [];
  for (let day = dayNumber(from); day <= dayNumber(to); day += 1) {
    const date = addDays(from, day - dayNumber(from));

    if (date === spec.date) {
      days.push({
        date,
        positionType: "DUTY",
        duty: {
          dutyId: "kandidaat",
          code: spec.code ?? "0001",
          shape: shape(spec.duty, spec.overtimeMinutes ?? 0),
        },
        replacedPosition: spec.replacedPosition ?? "RUST",
      });
      continue;
    }

    const plan = planned.get(date);
    if (!plan) {
      days.push({ date, positionType: "RUST", duty: null });
      continue;
    }

    days.push({
      date,
      positionType: plan.position ?? (plan.duty ? "DUTY" : "RUST"),
      duty: plan.duty
        ? {
            dutyId: `dienst-${date}`,
            code: plan.code ?? "0002",
            shape: shape(plan.duty, plan.overtimeMinutes ?? 0),
          }
        : null,
    });
  }

  const timeline: Timeline = { days, coverage: { from, to } };

  return {
    subject: {
      ...FULL_TIME_SUBJECT,
      ...spec.subject,
      protections: spec.protections ?? spec.subject?.protections ?? [],
    },
    date: spec.date,
    candidate: {
      dutyId: "kandidaat",
      code: spec.code ?? "0001",
      kinds: spec.kinds ?? [DutyKind.VROEG],
      depot: spec.subject?.depot ?? FULL_TIME_SUBJECT.depot,
      requiredQualifications: spec.requiredQualifications ?? [],
      weight: 1,
      shape: shape(spec.duty, spec.overtimeMinutes ?? 0),
    },
    planningStage: spec.stage ?? "BASE_ROSTER",
    reason: "BASE_ROSTER_GENERATION",
    timeline,
    exceptions: spec.exceptions ?? [],
  };
}

/** Een reeks werkdagen met dezelfde dienst, handig voor reeks- en tellerregels. */
export function run(
  firstDate: CalendarDate,
  count: number,
  duty: string,
  code = "0002",
): readonly DayPlan[] {
  return Array.from({ length: count }, (_unused, index) => ({
    date: addDays(firstDate, index),
    duty,
    code,
  }));
}

/** Alle harde overtredingen met dit regel-id. */
export function violationsOf(
  result: { hardViolations: readonly { ruleId: string }[] },
  ruleId: string,
): readonly { ruleId: string }[] {
  return result.hardViolations.filter((violation) => violation.ruleId === ruleId);
}
