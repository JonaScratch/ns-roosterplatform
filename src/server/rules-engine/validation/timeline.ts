import type { RosterPositionType } from "@/lib/generated/prisma/enums";
import { type CalendarDate, addDays, dayNumber, fromDayNumber, isoWeekday } from "@/domain/time";
import {
  type DutyOccurrence,
  type DutyShape,
  isNightServiceByTime,
  restBetween,
} from "@/domain/duty-window";
import { zonedInstant } from "@/domain/amsterdam-time";

/**
 * Het rooster van één medewerker rond een kandidaatplaatsing.
 *
 * ## Waarom de tijdlijn de kandidaat al bevat
 *
 * Elke regel stelt dezelfde vraag: hoe ziet het rooster eruit *als deze
 * plaatsing doorgaat*. Door die situatie één keer op te bouwen, rekenen alle
 * regels over dezelfde werkelijkheid. De klasse fouten waarbij de ene controle
 * de oude toestand ziet en de andere de nieuwe, kan daarmee niet ontstaan.
 */

export interface TimelineDay {
  readonly date: CalendarDate;
  readonly positionType: RosterPositionType;
  readonly duty: {
    readonly dutyId: string;
    readonly code: string;
    readonly shape: DutyShape;
  } | null;
  /**
   * Wat er op deze dag stond vóór de kandidaatplaatsing.
   *
   * Alleen gevuld op de dag die de plaatsing raakt. Verlof of een opleidingsdag
   * die door een dienst wordt overschreven, is geen vrije keuze van de planner.
   */
  readonly replacedPosition?: RosterPositionType | null;
}

export interface Timeline {
  readonly days: readonly TimelineDay[];
  /** De periode waarover daadwerkelijk gegevens beschikbaar zijn. */
  readonly coverage: { readonly from: CalendarDate; readonly to: CalendarDate };
}

/**
 * Posities die als werkdag tellen.
 *
 * WTV- en RO-dagen tellen voor de reeksregel uitdrukkelijk niet als dienst; een
 * RES-positie wél, want de medewerker is die dag beschikbaar. Kalenderdagen met
 * een roosterrecord tellen is dus niet hetzelfde als diensten tellen.
 */
const WORKING_POSITIONS: readonly RosterPositionType[] = ["DUTY", "RES"];

/** Posities die vrije tijd zijn en een dienstreeks onderbreken. */
const FREE_POSITIONS: readonly RosterPositionType[] = ["RUST", "VERLOF", "WR", "CO"];

export function isWorkingDay(day: TimelineDay): boolean {
  return WORKING_POSITIONS.includes(day.positionType);
}

export function isFreeDay(day: TimelineDay): boolean {
  return FREE_POSITIONS.includes(day.positionType);
}

/**
 * Opleiding is arbeidstijd en geen vrije dag.
 *
 * Een opleidingsdag als vrije dag behandelen zou een dienstreeks ten onrechte
 * onderbreken en de rust eromheen verkeerd berekenen.
 */
export function isTrainingDay(day: TimelineDay): boolean {
  return day.positionType === "OPLEIDING";
}

/** Telt deze dag mee in een reeks aaneengesloten diensten? */
export function countsInServiceRun(day: TimelineDay): boolean {
  return isWorkingDay(day) || isTrainingDay(day);
}

export function toOccurrence(day: TimelineDay): DutyOccurrence | null {
  return day.duty ? { date: day.date, shape: day.duty.shape } : null;
}

/** De dag op deze datum, of null wanneer hij niet in de tijdlijn zit. */
export function dayAt(timeline: Timeline, date: CalendarDate): TimelineDay | null {
  return timeline.days.find((day) => day.date === date) ?? null;
}

/** De dichtstbijzijnde dienst vóór deze datum. */
export function previousDuty(timeline: Timeline, date: CalendarDate): TimelineDay | null {
  const target = dayNumber(date);
  for (let index = timeline.days.length - 1; index >= 0; index -= 1) {
    const day = timeline.days[index];
    if (dayNumber(day.date) < target && day.duty) {
      return day;
    }
  }
  return null;
}

/** De dichtstbijzijnde dienst ná deze datum. */
export function nextDuty(timeline: Timeline, date: CalendarDate): TimelineDay | null {
  const target = dayNumber(date);
  for (const day of timeline.days) {
    if (dayNumber(day.date) > target && day.duty) {
      return day;
    }
  }
  return null;
}

/** De rust tussen twee opeenvolgende diensten, in werkelijke minuten. */
export function restMinutesBetween(earlier: TimelineDay, later: TimelineDay): number | null {
  const from = toOccurrence(earlier);
  const to = toOccurrence(later);
  return from && to ? restBetween(from, to) : null;
}

// ── Reeksen ──────────────────────────────────────────────────────────────────

export interface ServiceRun {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly length: number;
  readonly nightCount: number;
}

/**
 * De aaneengesloten dienstreeks waar deze dag deel van uitmaakt.
 *
 * Een gat in de tijdlijn breekt de reeks: liever onderschatten dan een reeks
 * verzinnen die er misschien niet is. Dat de teller daardoor te laag kan
 * uitvallen wordt afgevangen door de dekkingscontrole, die meldt dat het
 * venster niet volledig beschikbaar was.
 */
export function serviceRunAround(timeline: Timeline, date: CalendarDate): ServiceRun | null {
  const byDay = new Map(timeline.days.map((day) => [dayNumber(day.date), day]));
  const target = dayNumber(date);
  const centre = byDay.get(target);
  if (!centre || !countsInServiceRun(centre)) {
    return null;
  }

  let first = target;
  for (let offset = 1; ; offset += 1) {
    const day = byDay.get(target - offset);
    if (!day || !countsInServiceRun(day)) {
      break;
    }
    first = target - offset;
  }

  let last = target;
  for (let offset = 1; ; offset += 1) {
    const day = byDay.get(target + offset);
    if (!day || !countsInServiceRun(day)) {
      break;
    }
    last = target + offset;
  }

  let nights = 0;
  for (let day = first; day <= last; day += 1) {
    const entry = byDay.get(day);
    if (entry?.duty && isNightServiceByTime(entry.duty.shape)) {
      nights += 1;
    }
  }

  return {
    from: fromDayNumber(first),
    to: fromDayNumber(last),
    length: last - first + 1,
    nightCount: nights,
  };
}

/** De aaneengesloten reeks nachtdiensten die direct aan deze dag voorafgaat. */
export function nightRunEndingBefore(timeline: Timeline, date: CalendarDate): {
  readonly length: number;
  readonly lastDay: TimelineDay | null;
} {
  const byDay = new Map(timeline.days.map((day) => [dayNumber(day.date), day]));
  const target = dayNumber(date);

  let cursor = target - 1;
  let length = 0;
  let lastDay: TimelineDay | null = null;

  // Rustdagen tussen de nachtreeks en vandaag breken de reeks niet op — de
  // herstelrust wordt juist gemeten vanaf het einde van de laatste nachtdienst.
  while (byDay.has(cursor)) {
    const day = byDay.get(cursor)!;
    if (day.duty && isNightServiceByTime(day.duty.shape)) {
      if (lastDay === null) {
        lastDay = day;
      }
      length += 1;
      cursor -= 1;
      continue;
    }
    if (length === 0 && (isFreeDay(day) || !day.duty)) {
      // Nog geen nachtreeks gevonden; blijf terugkijken over de vrije dagen.
      cursor -= 1;
      continue;
    }
    break;
  }

  return { length, lastDay };
}

// ── Vensters ─────────────────────────────────────────────────────────────────

/** De dagen in een venster, grenzen inclusief. */
export function daysBetween(
  timeline: Timeline,
  from: CalendarDate,
  to: CalendarDate,
): readonly TimelineDay[] {
  return timeline.days.filter((day) => day.date >= from && day.date <= to);
}

/**
 * De totale arbeidstijd in een venster, met boven- en ondergrens.
 *
 * De meetfunctie krijgt de hele voorkomst en niet alleen de vorm, omdat de
 * werkelijke duur van een dienst afhangt van de datum: rond een
 * zomertijdovergang duurt dezelfde kloktijd een uur langer of korter.
 */
export function workMinutesIn(
  days: readonly TimelineDay[],
  measure: (occurrence: DutyOccurrence) => { min: number; max: number },
): { readonly min: number; readonly max: number } {
  let min = 0;
  let max = 0;
  for (const day of days) {
    const occurrence = toOccurrence(day);
    if (!occurrence) {
      continue;
    }
    const measured = measure(occurrence);
    min += measured.min;
    max += measured.max;
  }
  return { min, max };
}

/** Het aantal nachtdiensten dat na een bepaald kloktijdstip eindigt. */
export function countNightServices(
  days: readonly TimelineDay[],
  endsAfterMinuteOfDay: number,
): number {
  return days.filter((day) => {
    if (!day.duty) {
      return false;
    }
    const shape = day.duty.shape;
    return isNightServiceByTime(shape) && shape.endMinute % 1440 > endsAfterMinuteOfDay;
  }).length;
}

/**
 * De langste onafgebroken rustperiode binnen een venster.
 *
 * Gemeten tussen het einde van de ene dienst en het begin van de volgende, over
 * werkelijke tijd. Een venster zonder diensten telt als volledig rust.
 */
export function longestRestMinutes(
  days: readonly TimelineDay[],
  window: { from: CalendarDate; to: CalendarDate },
): number {
  const duties = days
    .filter((day) => day.duty !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const windowStart = zonedInstant(window.from, 0);
  const windowEnd = zonedInstant(addDays(window.to, 1), 0);

  if (duties.length === 0) {
    return Math.round((windowEnd - windowStart) / 60_000);
  }

  let longest = 0;
  let cursor = windowStart;

  for (const day of duties) {
    const start = zonedInstant(day.date, day.duty!.shape.startMinute);
    const end = zonedInstant(day.date, day.duty!.shape.endMinute);
    longest = Math.max(longest, Math.round((start - cursor) / 60_000));
    cursor = Math.max(cursor, end);
  }
  longest = Math.max(longest, Math.round((windowEnd - cursor) / 60_000));

  return longest;
}

/** Alle onafgebroken rustperioden in een venster, van lang naar kort. */
export function restPeriodsIn(
  days: readonly TimelineDay[],
  window: { from: CalendarDate; to: CalendarDate },
): readonly number[] {
  const duties = days
    .filter((day) => day.duty !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const windowStart = zonedInstant(window.from, 0);
  const windowEnd = zonedInstant(addDays(window.to, 1), 0);

  const periods: number[] = [];
  let cursor = windowStart;
  for (const day of duties) {
    const start = zonedInstant(day.date, day.duty!.shape.startMinute);
    const end = zonedInstant(day.date, day.duty!.shape.endMinute);
    periods.push(Math.round((start - cursor) / 60_000));
    cursor = Math.max(cursor, end);
  }
  periods.push(Math.round((windowEnd - cursor) / 60_000));

  return periods.filter((minutes) => minutes > 0).sort((a, b) => b - a);
}

/** De zondagen in een venster die volledig vrij zijn. */
export function freeSundaysIn(days: readonly TimelineDay[]): number {
  return days.filter((day) => isoWeekday(day.date) === 7 && !countsInServiceRun(day)).length;
}
