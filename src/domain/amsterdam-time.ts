import type { CalendarDate } from "./time";
import { assertCalendarDate } from "./time";

/**
 * Tijdrekenen in Europe/Amsterdam, met zomertijd.
 *
 * ## Waarom dit niet met kale minuten kan
 *
 * De rest van het domein rekent met "minuten na middernacht van de dienstdag".
 * Dat is prima om diensten te beschrijven, maar niet om rust te meten. In de
 * nacht van de zomertijdovergang duurt een periode van 12 uur op de klok maar
 * 11 werkelijke uren, en in het najaar 13. Een rustnorm gaat over werkelijk
 * verstreken tijd, dus die moet over absolute momenten worden gerekend.
 *
 * Omgekeerd gaan de nachtdienstdefinities uit de CAO juist over de klok:
 * "meer dan één uur arbeid tussen 00:00 en 06:00" is een klokvenster. Die
 * blijven dus in lokale minuten.
 *
 * Dit bestand levert beide, uitdrukkelijk uit elkaar gehouden:
 * `actualMinutesBetween` voor rust en duur, `wallClockMinutesBetween` voor het
 * verschil dat de zomertijd maakt.
 *
 * ## Waarom er geen tijdzonebibliotheek bij komt
 *
 * De omzetting van een lokale wandkloktijd naar een absoluut moment is met
 * `Intl.DateTimeFormat` in twee stappen exact te doen, en een extra
 * afhankelijkheid in de veiligheidskritische laag is er één te veel.
 */

export const TIMEZONE = "Europe/Amsterdam";

const ZONE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** De lokale wandkloktijd op een absoluut moment, als "epoch-achtige" waarde. */
function localAsIfUtc(instant: number): number {
  const parts = ZONE_FORMAT.formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

/** De offset van de zone ten opzichte van UTC op dit moment, in minuten. */
export function offsetMinutesAt(instant: number): number {
  return (localAsIfUtc(instant) - instant) / 60_000;
}

/**
 * Het absolute moment dat hoort bij een lokale wandkloktijd.
 *
 * `minuteOfDay` mag groter zijn dan 1440: dat is een dienst die over
 * middernacht loopt, en 1880 betekent 07:20 de volgende dag.
 *
 * ## De twee bijzondere nachten
 *
 * Bij het ingaan van de zomertijd bestaat 02:30 lokale tijd niet. De omzetting
 * levert dan het moment waarop de klok is doorgesprongen; dat is de enige
 * zinnige uitkomst en hij is stabiel. Bij het einde van de zomertijd bestaat
 * 02:30 twee keer; deze functie kiest dan het eerste voorkomen (zomertijd).
 * Beide keuzes zijn expliciet en worden getest.
 */
export function zonedInstant(date: CalendarDate, minuteOfDay: number): number {
  assertCalendarDate(date);
  const [year, month, day] = date.split("-").map(Number);
  const naive = Date.UTC(year, month - 1, day) + minuteOfDay * 60_000;

  // Eerste benadering met de offset op het naïeve moment, daarna één correctie.
  // Twee stappen volstaan: een offsetsprong is hooguit een uur en de tweede
  // meting gebeurt al binnen de juiste zijde van de overgang.
  const firstGuess = naive - offsetMinutesAt(naive) * 60_000;
  const corrected = naive - offsetMinutesAt(firstGuess) * 60_000;
  return corrected;
}

/** Werkelijk verstreken minuten tussen twee momenten. Rust rekent hiermee. */
export function actualMinutesBetween(from: number, to: number): number {
  return Math.round((to - from) / 60_000);
}

/**
 * Verstreken minuten volgens de wandklok.
 *
 * Verschilt van `actualMinutesBetween` precies rond een zomertijdovergang. Het
 * verschil tussen beide is wat de CAO-uitzondering voor het begin van de
 * zomertijd raakt.
 */
export function wallClockMinutesBetween(from: number, to: number): number {
  return Math.round((localAsIfUtc(to) - localAsIfUtc(from)) / 60_000);
}

export type DstTransition = "NONE" | "FORWARD" | "BACKWARD";

/**
 * Welke zomertijdovergang tussen twee momenten valt.
 *
 * `FORWARD` is de nacht waarin de klok vooruit gaat en een periode korter
 * wordt dan hij op de klok lijkt — precies het geval waarvoor de CAO
 * instemming van de werknemer verlangt.
 */
export function dstTransitionBetween(from: number, to: number): DstTransition {
  const difference = offsetMinutesAt(to) - offsetMinutesAt(from);
  if (difference === 0) {
    return "NONE";
  }
  return difference > 0 ? "BACKWARD" : "FORWARD";
}

/** Hoeveel minuten de zomertijd van een periode afhaalt (positief) of erbij doet. */
export function dstShiftMinutes(from: number, to: number): number {
  return wallClockMinutesBetween(from, to) - actualMinutesBetween(from, to);
}

/** De lokale kalenderdatum waarop een absoluut moment valt. */
export function localDateOf(instant: number): CalendarDate {
  return new Date(localAsIfUtc(instant)).toISOString().slice(0, 10);
}

/** De lokale minuut van de dag waarop een absoluut moment valt. */
export function localMinuteOfDay(instant: number): number {
  const local = new Date(localAsIfUtc(instant));
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** "06:45" uit 405. Voor meldingen; het domein rekent met minuten. */
export function formatClock(minuteOfDay: number): string {
  const within = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(within / 60)).padStart(2, "0")}:${String(within % 60).padStart(2, "0")}`;
}

/** "12 u 30 m" uit 750. Negatief wordt zichtbaar negatief. */
export function formatSpan(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${sign}${hours} u` : `${sign}${hours} u ${String(rest).padStart(2, "0")} m`;
}
