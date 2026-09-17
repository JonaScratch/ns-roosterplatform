/**
 * Kalender- en tijdrekenen voor roosterlogica.
 *
 * ## Waarom kalenderdatums hier tekst zijn
 *
 * Een dienstdag is een kalenderbegrip, geen tijdstip. Zodra je hem als `Date`
 * door de applicatie stuurt, hangt de uitkomst van rusttijdberekeningen af van
 * de tijdzone van het proces, en verschuift een nachtdienst rond de zomertijd
 * een dag. Daarom is de dienstdag in de domeinlaag een `YYYY-MM-DD`-string en
 * is de tijd binnen die dag een aantal minuten na middernacht. Omrekenen naar
 * `Date` gebeurt uitsluitend op de grens met de database.
 *
 * `endMinute` mag groter zijn dan 1440: een dienst die om 23:10 begint en om
 * 07:20 eindigt heeft `startMinute` 1390 en `endMinute` 1880. Dat maakt het
 * rekenen aan rust een aftrekking en geen gevalsonderscheiding.
 */

/** Een kalenderdatum in `YYYY-MM-DD`. */
export type CalendarDate = string;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Rust- en roostertoetsen controleren dezelfde paar honderd datums honderd-
// duizenden keren. Het antwoord per tekst verandert nooit, dus het wordt
// onthouden; de begrenzing voorkomt dat een langlopend proces blijft groeien.
const DATUM_GELDIG = new Map<string, boolean>();
const DAGNUMMER = new Map<string, number>();
const GEHEUGEN_MAX = 50_000;

export function isCalendarDate(value: string): value is CalendarDate {
  const bekend = DATUM_GELDIG.get(value);
  if (bekend !== undefined) {
    return bekend;
  }
  const geldig = DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (DATUM_GELDIG.size > GEHEUGEN_MAX) {
    DATUM_GELDIG.clear();
  }
  DATUM_GELDIG.set(value, geldig);
  return geldig;
}

export function assertCalendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) {
    throw new Error(`Ongeldige kalenderdatum: ${value}`);
  }
  return value;
}

/** Kalenderdatum uit een databasewaarde (`@db.Date`, UTC-middernacht). */
export function toCalendarDate(value: Date): CalendarDate {
  return value.toISOString().slice(0, 10);
}

/** Databasewaarde uit een kalenderdatum. Altijd UTC-middernacht. */
export function toDatabaseDate(value: CalendarDate): Date {
  return new Date(`${assertCalendarDate(value)}T00:00:00.000Z`);
}

/** Dagnummer sinds epoch. Basis voor alle datumrekenkunde hier. */
export function dayNumber(date: CalendarDate): number {
  const bekend = DAGNUMMER.get(date);
  if (bekend !== undefined) {
    return bekend;
  }
  const dag = Math.round(Date.parse(`${assertCalendarDate(date)}T00:00:00Z`) / 86_400_000);
  if (DAGNUMMER.size > GEHEUGEN_MAX) {
    DAGNUMMER.clear();
  }
  DAGNUMMER.set(date, dag);
  return dag;
}

export function fromDayNumber(day: number): CalendarDate {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(dayNumber(date) + days);
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** ISO-weekdag: 1 = maandag tot en met 7 = zondag. */
export function isoWeekday(date: CalendarDate): number {
  const jsDay = new Date(`${assertCalendarDate(date)}T00:00:00Z`).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function isWeekend(date: CalendarDate): boolean {
  return isoWeekday(date) >= 6;
}

/** ISO-weeksleutel, bijvoorbeeld "2026-W36". */
export function isoWeekKey(date: CalendarDate): string {
  const d = new Date(`${assertCalendarDate(date)}T00:00:00Z`);
  // Naar de donderdag van deze ISO-week: die bepaalt per definitie het jaar.
  const day = isoWeekday(date);
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstThursdayDay = firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstThursdayDay);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Kwartaalsleutel, bijvoorbeeld "2026-Q3". */
export function quarterKey(date: CalendarDate): string {
  const [year, month] = assertCalendarDate(date).split("-");
  const quarter = Math.floor((Number(month) - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

/** De kwartaalsleutel van vandaag, in de opgegeven referentietijd. */
export function currentQuarterKey(now: Date = new Date()): string {
  return quarterKey(toCalendarDate(now));
}

// ── Diensten in de tijd ──────────────────────────────────────────────────────

/** Een dienst op een concrete dag: het minimum dat rusttijdrekenen nodig heeft. */
export interface DutyOccurrence {
  readonly date: CalendarDate;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** Absolute begintijd in minuten sinds epoch. */
export function absoluteStart(occurrence: DutyOccurrence): number {
  return dayNumber(occurrence.date) * 1440 + occurrence.startMinute;
}

/** Absolute eindtijd in minuten sinds epoch. Verwerkt diensten over middernacht. */
export function absoluteEnd(occurrence: DutyOccurrence): number {
  return dayNumber(occurrence.date) * 1440 + occurrence.endMinute;
}

export function durationMinutes(occurrence: DutyOccurrence): number {
  return occurrence.endMinute - occurrence.startMinute;
}

/**
 * Rust tussen twee diensten, in minuten.
 *
 * Negatief betekent overlap: de tweede dienst begint voordat de eerste voorbij
 * is. Dat is een aparte uitkomst en geen "te weinig rust" — de aanroeper moet
 * het verschil kunnen zien.
 */
export function restBetween(earlier: DutyOccurrence, later: DutyOccurrence): number {
  return absoluteStart(later) - absoluteEnd(earlier);
}

/** Overlappen twee diensten elkaar in de tijd? */
export function overlaps(a: DutyOccurrence, b: DutyOccurrence): boolean {
  return absoluteStart(a) < absoluteEnd(b) && absoluteStart(b) < absoluteEnd(a);
}

/** "07:30" uit 450, en "07:20 (+1)" uit 1880. */
export function formatMinuteOfDay(minute: number): string {
  const dayOffset = Math.floor(minute / 1440);
  const withinDay = ((minute % 1440) + 1440) % 1440;
  const hours = String(Math.floor(withinDay / 60)).padStart(2, "0");
  const minutes = String(withinDay % 60).padStart(2, "0");
  return dayOffset === 0 ? `${hours}:${minutes}` : `${hours}:${minutes} (+${dayOffset})`;
}

/** "9 u 45 m" uit 585. Voor rusttijden in de interface. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${sign}${hours} u` : `${sign}${hours} u ${rest} m`;
}

/** Nederlandse weergave van een kalenderdatum, bijvoorbeeld "ma 1 sep 2026". */
export function formatCalendarDate(date: CalendarDate): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${assertCalendarDate(date)}T00:00:00Z`));
}

export const WEEKDAY_LABELS: readonly string[] = [
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
  "zondag",
];

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday - 1] ?? `dag ${weekday}`;
}
