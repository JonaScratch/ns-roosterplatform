import {
  type DutyMeasurement,
  type DutyOccurrence,
  crossesMinute,
  isHardNightService,
  isNightServiceByTime,
  measureDuty,
  startsWithin,
} from "@/domain/duty-window";
import type { Range } from "../bounds";
import { type AssignmentSubject, isRidingStaff } from "../subject";

/**
 * De grootheden van één dienst, klaar om aan grenzen te toetsen.
 *
 * Eén keer meten, overal hetzelfde antwoord. Zonder dit rekent de ene controle
 * met de dienstlengte volgens de klok en de andere met werkelijk verstreken
 * tijd, en dan verschilt de uitkomst twee keer per jaar zonder dat iemand weet
 * waarom.
 */

export interface DutyMetrics {
  readonly measurement: DutyMeasurement;
  /** Arbeidstijd zonder overwerk, als bandbreedte. */
  readonly work: Range;
  /** Arbeidstijd inclusief overwerk. */
  readonly workInclOvertime: Range;
  /** Dienstlengte in werkelijk verstreken minuten. */
  readonly duty: Range;
  /** Dienstlengte volgens de klok; wijkt alleen af rond een zomertijdovergang. */
  readonly dutyWallClockMinutes: number;
  /** Verschil tussen klok en werkelijkheid. Positief bij het ingaan van de wintertijd. */
  readonly dstShiftMinutes: number;
  readonly isNight: boolean;
  readonly isHardNight: boolean;
  /** Start 04:00 tot en met 05:00. */
  readonly startsVeryEarly: boolean;
  /** Start 05:01 tot en met 05:59. */
  readonly startsEarly: boolean;
  /** Start vóór 02:30 en eindigt erna. */
  readonly crossesHalfPastTwo: boolean;
  /** Is de werkonderbreking aantoonbaar langer dan een half uur? */
  readonly breakExceedsHalfHour: boolean;
}

/**
 * De twee startbanden uit de bron, op de minuut.
 *
 * De bron zegt "vanaf 04:00 en vóór 05:01" en "ná 05:00 en vóór 06:00". Dat zijn
 * bij minuutprecisie twee aaneensluitende banden zonder overlap: 05:00 hoort bij
 * de eerste, 05:01 bij de tweede.
 *
 * Hier stond eerder `[05:00, 06:00)` voor de tweede band. Daardoor viel 05:00 in
 * beide en gold voor elke dienst die om precies 05:00 begint ook de ruimere
 * grens van 8,5 uur — die vervolgens door de strengere werd overstemd, zodat het
 * verschil onzichtbaar bleef. Twee bepalingen die elkaar overlappen zijn geen
 * detail: ze maken elke uitspraak over de grens tussen 05:00 en 05:01 onjuist.
 *
 * De brondata is minuutprecies (`startMinute` is een geheel aantal minuten). Er
 * worden hier dus geen seconden weggerond; kan de bron in de toekomst seconden
 * bevatten, dan is dat een bron- en beleidsvraag en geen implementatiedetail.
 */
const VERY_EARLY = { from: 4 * 60, until: 5 * 60 + 1 } as const;
const EARLY = { from: 5 * 60 + 1, until: 6 * 60 } as const;

/** De band waarin een dienst met deze starttijd valt, voor uitleg in bevindingen. */
export function startBandOf(startMinuteOfDay: number): "VOOR_04" | "04_0500" | "0501_0559" | "NA_06" {
  if (startMinuteOfDay < VERY_EARLY.from) {
    return "VOOR_04";
  }
  if (startMinuteOfDay < VERY_EARLY.until) {
    return "04_0500";
  }
  return startMinuteOfDay < EARLY.until ? "0501_0559" : "NA_06";
}

export function metricsOf(occurrence: DutyOccurrence, subject: AssignmentSubject): DutyMetrics {
  const ridingStaff = isRidingStaff(subject);
  const measurement = measureDuty(occurrence, { assumeRidingStaffBreak: ridingStaff });
  const shape = occurrence.shape;

  const work: Range = { min: measurement.workMinutesMin, max: measurement.workMinutesMax };
  const overtime = measurement.overtimeMinutes;

  return {
    measurement,
    work,
    workInclOvertime: { min: work.min + overtime, max: work.max + overtime },
    duty: { min: measurement.dutyMinutes, max: measurement.dutyMinutes },
    dutyWallClockMinutes: measurement.dutyMinutesWallClock,
    dstShiftMinutes: measurement.dutyMinutes - measurement.dutyMinutesWallClock,
    isNight: isNightServiceByTime(shape),
    isHardNight: isHardNightService(shape),
    startsVeryEarly: startsWithin(shape, VERY_EARLY.from, VERY_EARLY.until),
    startsEarly: startsWithin(shape, EARLY.from, EARLY.until),
    crossesHalfPastTwo: crossesMinute(shape, 150),
    // Bij een vastgelegde pauze is dit een feit. Is de pauze onbekend, dan geldt
    // voor rijdend personeel de bandbreedte 32–40 minuten uit de bron; die ligt
    // in zijn geheel boven het half uur, dus ook dan staat het vast.
    breakExceedsHalfHour:
      shape.breakMinutes !== null ? shape.breakMinutes > 30 : ridingStaff,
  };
}

/** De arbeidstijd van een willekeurige dienst in een venster. */
export function workRangeFor(subject: AssignmentSubject) {
  const ridingStaff = isRidingStaff(subject);
  return (occurrence: DutyOccurrence): Range => {
    const measured = measureDuty(occurrence, { assumeRidingStaffBreak: ridingStaff });
    return {
      min: measured.workMinutesMin + measured.overtimeMinutes,
      max: measured.workMinutesMax + measured.overtimeMinutes,
    };
  };
}
