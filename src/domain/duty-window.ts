import type { CalendarDate } from "./time";
import { actualMinutesBetween, zonedInstant } from "./amsterdam-time";

/**
 * Wat een dienst in de tijd is.
 *
 * ## Vier grootheden, geen één
 *
 * `dienstlengte`, `arbeidstijd`, `pauze` en `overwerk` zijn vier verschillende
 * dingen met vier verschillende grenzen in de CAO. Een controle die alleen naar
 * de dienstlengte kijkt, laat een te lange arbeidstijd door; een controle die
 * alleen naar arbeidstijd kijkt, laat een te lange dienst door. Ze worden hier
 * dus apart gemodelleerd en apart getoetst.
 *
 * ## Rekenen met een onbekende pauze
 *
 * Voor rijdend personeel is de duur van de werkonderbreking standplaats-
 * afhankelijk en die waarde is niet aangeleverd. In plaats van een getal te
 * verzinnen levert dit model een **bandbreedte**: de arbeidstijd ligt tussen
 * een onder- en een bovengrens. Een maximumcontrole gebruikt de bovengrens, een
 * minimumcontrole de ondergrens — allebei de veilige kant. Blokkeren gebeurt
 * pas wanneer de bandbreedte het oordeel daadwerkelijk bepaalt; dat is het
 * verschil tussen fail-closed en onbruikbaar.
 */

/** De bandbreedte van de werkonderbreking bij rijdend personeel, uit de bron. */
export const RP_WORK_INTERRUPTION_RANGE_MINUTES = { min: 32, max: 40 } as const;

export interface DutyShape {
  /** Minuten na lokale middernacht van de dienstdag. */
  readonly startMinute: number;
  /** Idem; groter dan 1440 wanneer de dienst over middernacht loopt. */
  readonly endMinute: number;
  /** Geplande pauze in minuten, of null wanneer onbekend. */
  readonly breakMinutes: number | null;
  readonly overtimeMinutes: number;
}

export interface DutyOccurrence {
  readonly date: CalendarDate;
  readonly shape: DutyShape;
}

export interface DutyMeasurement {
  /** Werkelijk verstreken dienstlengte, dus met zomertijd verrekend. */
  readonly dutyMinutes: number;
  /** Dienstlengte volgens de klok. Verschilt alleen rond een zomertijdovergang. */
  readonly dutyMinutesWallClock: number;
  readonly breakMinutes: number | null;
  /** Ondergrens van de arbeidstijd, exclusief overwerk. */
  readonly workMinutesMin: number;
  /** Bovengrens van de arbeidstijd, exclusief overwerk. */
  readonly workMinutesMax: number;
  readonly overtimeMinutes: number;
  /** Is de arbeidstijd exact bekend? */
  readonly workMinutesExact: boolean;
  readonly startInstant: number;
  readonly endInstant: number;
}

/**
 * De gemeten grootheden van één dienst op één dag.
 *
 * `assumeRidingStaffBreak` zet de bandbreedte uit de bron in wanneer de pauze
 * niet is vastgelegd. Dat is geen aanname over de waarde maar een weergave van
 * wat de bron zelf als bereik noemt.
 */
export function measureDuty(
  occurrence: DutyOccurrence,
  options: { readonly assumeRidingStaffBreak?: boolean } = {},
): DutyMeasurement {
  const startInstant = zonedInstant(occurrence.date, occurrence.shape.startMinute);
  const endInstant = zonedInstant(occurrence.date, occurrence.shape.endMinute);

  const dutyMinutes = actualMinutesBetween(startInstant, endInstant);
  const dutyMinutesWallClock = occurrence.shape.endMinute - occurrence.shape.startMinute;
  const breakMinutes = occurrence.shape.breakMinutes;

  if (breakMinutes !== null) {
    const work = dutyMinutes - breakMinutes;
    return {
      dutyMinutes,
      dutyMinutesWallClock,
      breakMinutes,
      workMinutesMin: work,
      workMinutesMax: work,
      overtimeMinutes: occurrence.shape.overtimeMinutes,
      workMinutesExact: true,
      startInstant,
      endInstant,
    };
  }

  // Pauze onbekend. Voor rijdend personeel noemt de bron een bereik; buiten die
  // groep is er geen enkel houvast en is de bovengrens de hele dienstlengte.
  const range = options.assumeRidingStaffBreak
    ? RP_WORK_INTERRUPTION_RANGE_MINUTES
    : { min: 0, max: 0 };

  return {
    dutyMinutes,
    dutyMinutesWallClock,
    breakMinutes: null,
    workMinutesMin: dutyMinutes - range.max,
    workMinutesMax: dutyMinutes - range.min,
    overtimeMinutes: occurrence.shape.overtimeMinutes,
    workMinutesExact: false,
    startInstant,
    endInstant,
  };
}

// ── Klokvensters: de CAO-definities van nachtarbeid ──────────────────────────

/** Overlap in minuten tussen de dienst en een klokvenster op de dienstas. */
function overlapMinutes(
  shape: DutyShape,
  windowStart: number,
  windowEnd: number,
): number {
  return Math.max(0, Math.min(shape.endMinute, windowEnd) - Math.max(shape.startMinute, windowStart));
}

/**
 * Overlap met het nachtvenster 00:00–06:00, over beide betrokken kalenderdagen.
 *
 * Op de dienstas is dat [0, 360] voor de dienstdag zelf en [1440, 1800] voor de
 * dag erna. Een dienst van 22:30 tot 06:45 raakt alleen de tweede.
 */
export function nightWindowMinutes(shape: DutyShape): number {
  return overlapMinutes(shape, 0, 360) + overlapMinutes(shape, 1440, 1800);
}

/**
 * Is dit een nachtdienst volgens de CAO?
 *
 * Meer dan één uur arbeid tussen 00:00 en 06:00. Uitdrukkelijk op werkelijke
 * tijden en niet op het dienstnummer: de lokale nummerreeksen zijn een
 * operationele indeling en geen juridische definitie.
 */
export function isNightServiceByTime(shape: DutyShape): boolean {
  return nightWindowMinutes(shape) > 60;
}

/** Overlap met het venster 02:00–04:00, over beide betrokken kalenderdagen. */
export function hardNightWindowMinutes(shape: DutyShape): number {
  return overlapMinutes(shape, 120, 240) + overlapMinutes(shape, 1560, 1680);
}

/**
 * Is dit een harde nachtdienst?
 *
 * Een dienst die geheel of gedeeltelijk de periode 02:00–04:00 omvat.
 */
export function isHardNightService(shape: DutyShape): boolean {
  return hardNightWindowMinutes(shape) > 0;
}

/** Omvat de dienst de volledige periode 02:00–04:00? */
export function coversFullHardNight(shape: DutyShape): boolean {
  return hardNightWindowMinutes(shape) >= 120;
}

/** De lokale kloktijd waarop de dienst eindigt, in minuten na middernacht. */
export function endMinuteOfDay(shape: DutyShape): number {
  return shape.endMinute % 1440;
}

/** De lokale kloktijd waarop de dienst begint. */
export function startMinuteOfDay(shape: DutyShape): number {
  return shape.startMinute % 1440;
}

/**
 * Eindigt de dienst na 02:00 uur?
 *
 * Alleen zinvol in combinatie met `isNightServiceByTime`: een gewone dagdienst
 * eindigt ook "na 02:00" op de klok, maar dat is niet wat de bron bedoelt.
 */
export function endsAfterMinute(shape: DutyShape, minuteOfDay: number): boolean {
  return endMinuteOfDay(shape) > minuteOfDay;
}

/** Start de dienst binnen dit klokvenster? Ondergrens inclusief, bovengrens exclusief. */
export function startsWithin(shape: DutyShape, fromMinute: number, toMinute: number): boolean {
  const start = startMinuteOfDay(shape);
  return start >= fromMinute && start < toMinute;
}

/** Loopt de dienst dwars door een klokmoment heen? */
export function crossesMinute(shape: DutyShape, minuteOfDay: number): boolean {
  return (
    (shape.startMinute < minuteOfDay && shape.endMinute > minuteOfDay) ||
    (shape.startMinute < minuteOfDay + 1440 && shape.endMinute > minuteOfDay + 1440)
  );
}

/**
 * Werkelijke rust tussen twee diensten, in minuten.
 *
 * Negatief betekent overlap. Rond een zomertijdovergang wijkt dit af van de
 * klok, en dat is de bedoeling: rust is werkelijk verstreken tijd.
 */
export function restBetween(earlier: DutyOccurrence, later: DutyOccurrence): number {
  const end = zonedInstant(earlier.date, earlier.shape.endMinute);
  const start = zonedInstant(later.date, later.shape.startMinute);
  return actualMinutesBetween(end, start);
}

/** Overlappen twee diensten elkaar in de tijd? */
export function overlaps(a: DutyOccurrence, b: DutyOccurrence): boolean {
  const aStart = zonedInstant(a.date, a.shape.startMinute);
  const aEnd = zonedInstant(a.date, a.shape.endMinute);
  const bStart = zonedInstant(b.date, b.shape.startMinute);
  const bEnd = zonedInstant(b.date, b.shape.endMinute);
  return aStart < bEnd && bStart < aEnd;
}
