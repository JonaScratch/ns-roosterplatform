import { type CalendarDate, addDays, dayNumber } from "@/domain/time";
import { type Timeline, type TimelineDay, daysBetween } from "../timeline";

/**
 * Voortschrijdende vensters.
 *
 * ## Waarom niet één venster terugkijken
 *
 * "Maximaal tien vroege starts per vier weken" is geen uitspraak over de vier
 * weken vóór vandaag. Het is een uitspraak over elk aaneengesloten blok van vier
 * weken. Wie alleen terugkijkt, keurt een plaatsing goed die het elfde geval
 * wordt van een venster dat morgen begint — en ontdekt dat pas wanneer die
 * elfde dienst zelf ter validatie langskomt, als het rooster al staat.
 *
 * Daarom wordt elk venster beoordeeld dat de kandidaatdag bevat en volledig
 * binnen de geladen gegevens valt, en telt de ongunstigste uitkomst. Vensters
 * die deels buiten de gegevens vallen worden overgeslagen; dat het venster
 * terug altijd volledig beschikbaar is, bewaakt `hasContext` afzonderlijk.
 *
 * ## Waarom er een prefixsom in zit
 *
 * Een venster van 52 weken bevat 364 dagen, en er zijn 364 zulke vensters die
 * dezelfde dag bevatten. Naïef optellen is dan honderdduizenden bewerkingen per
 * plaatsing — bij een regressie over een heel jaarrooster het verschil tussen
 * seconden en uren. Alles wat als som per dag te schrijven is, loopt daarom via
 * `summariser`: één keer optellen, daarna per venster één aftrekking. Metingen
 * die niet per dag optelbaar zijn, zoals de langste onafgebroken rust, gebruiken
 * `worstWindow`, en die wordt alleen op korte vensters ingezet.
 */

export interface WindowSpan {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

export interface WindowResult<T> extends WindowSpan {
  readonly value: T;
}

export type Direction = "MAX" | "MIN";

/** Alle vensters van deze lengte die de ankerdag bevatten en volledig geladen zijn. */
export function windowsContaining(
  timeline: Timeline,
  anchor: CalendarDate,
  spanDays: number,
): readonly WindowSpan[] {
  const coverageFrom = dayNumber(timeline.coverage.from);
  const coverageTo = dayNumber(timeline.coverage.to);
  const anchorDay = dayNumber(anchor);

  const spans: WindowSpan[] = [];
  for (let offset = 0; offset < spanDays; offset += 1) {
    const startDay = anchorDay - spanDays + 1 + offset;
    const endDay = startDay + spanDays - 1;
    if (startDay < coverageFrom || endDay > coverageTo) {
      continue;
    }
    spans.push({
      from: addDays(anchor, startDay - anchorDay),
      to: addDays(anchor, endDay - anchorDay),
    });
  }
  return spans;
}

/**
 * Een optelfunctie over vensters, met de dagwaarden één keer voorberekend.
 *
 * Aanroepen kost daarna één aftrekking, ongeacht de lengte van het venster.
 */
export function summariser(
  timeline: Timeline,
  perDay: (day: TimelineDay) => number,
): (span: WindowSpan) => number {
  const coverageFrom = dayNumber(timeline.coverage.from);
  const length = dayNumber(timeline.coverage.to) - coverageFrom + 1;

  const values = new Float64Array(Math.max(0, length));
  for (const day of timeline.days) {
    const index = dayNumber(day.date) - coverageFrom;
    if (index >= 0 && index < length) {
      values[index] = perDay(day);
    }
  }

  const sums = new Float64Array(Math.max(0, length) + 1);
  for (let index = 0; index < length; index += 1) {
    sums[index + 1] = sums[index] + values[index];
  }

  return (span) => {
    const from = Math.max(0, dayNumber(span.from) - coverageFrom);
    const to = Math.min(length, dayNumber(span.to) - coverageFrom + 1);
    return to <= from ? 0 : sums[to] - sums[from];
  };
}

/** De ongunstigste som over alle vensters die de ankerdag bevatten. */
export function worstSumWindow(
  timeline: Timeline,
  anchor: CalendarDate,
  spanDays: number,
  perDay: (day: TimelineDay) => number,
  direction: Direction,
): WindowResult<number> | null {
  const total = summariser(timeline, perDay);
  let best: WindowResult<number> | null = null;

  for (const span of windowsContaining(timeline, anchor, spanDays)) {
    const value = total(span);
    if (best === null || isWorse(value, best.value, direction)) {
      best = { ...span, value };
    }
  }
  return best;
}

/**
 * De ongunstigste uitkomst van een meting die niet per dag optelbaar is.
 *
 * Kost `spanDays` metingen over `spanDays` dagen; alleen gebruiken op korte
 * vensters.
 */
export function worstWindow<T>(
  timeline: Timeline,
  anchor: CalendarDate,
  spanDays: number,
  measure: (days: readonly TimelineDay[], span: WindowSpan) => T,
  isWorseThan: (candidate: T, current: T) => boolean,
): WindowResult<T> | null {
  let best: WindowResult<T> | null = null;

  for (const span of windowsContaining(timeline, anchor, spanDays)) {
    const value = measure(daysBetween(timeline, span.from, span.to), span);
    if (best === null || isWorseThan(value, best.value)) {
      best = { ...span, value };
    }
  }
  return best;
}

export function isWorse(candidate: number, current: number, direction: Direction): boolean {
  return direction === "MAX" ? candidate > current : candidate < current;
}

/** Het kalenderjaar waarin een datum valt. */
export function calendarYearSpan(date: CalendarDate): WindowSpan {
  const year = date.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Valt dit venster volledig binnen de geladen gegevens? */
export function coversSpan(timeline: Timeline, span: WindowSpan): boolean {
  return timeline.coverage.from <= span.from && timeline.coverage.to >= span.to;
}
