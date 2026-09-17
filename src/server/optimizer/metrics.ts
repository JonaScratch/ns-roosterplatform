import { DutyKind } from "@/lib/generated/prisma/enums";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import { isHardNightService, isNightServiceByTime } from "@/domain/duty-window";
import type { CandidateAssignment } from "@/domain/candidate";
import type { OptimizerDuty, OptimizerLine } from "./contract";

/**
 * Meten aan een basisrooster.
 *
 * ## Waarom hier met de klok wordt gerekend en niet met werkelijke tijd
 *
 * Een basisrooster is een cyclus, geen kalender. Er zit geen zomertijdovergang
 * in een cyclus van vier weken; die ontstaat pas wanneer de cyclus op concrete
 * data wordt uitgerold. Voor de kwaliteitsmaten hieronder is de klok dus het
 * juiste meetinstrument. Voor de juridische toetsing niet — en die gebeurt dan
 * ook ergens anders, op echte data, met zomertijd verrekend.
 *
 * ## Deze getallen zijn geen normen
 *
 * Niets in dit bestand blokkeert iets. Het meet verdeling, rust en patronen om
 * twee roosters te kunnen vergelijken. Zodra een van deze maten een grens zou
 * krijgen, zou er een tweede regelboek ontstaan naast de CAO — precies wat dit
 * project eerder al een keer heeft moeten opruimen.
 */

/** Eén dag in de uitgerolde cyclus van een lijn. */
export interface CycleDay {
  readonly index: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: string;
  readonly duty: OptimizerDuty | null;
}

export interface RestInterval {
  /** Index van de dag waarop de eerdere dienst valt. */
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly minutes: number;
  readonly afterNight: boolean;
}

export interface LineMetrics {
  readonly baseRosterCode: string;
  readonly profile: RosterProfile;
  readonly lineNumber: number;
  readonly cycleDays: number;

  readonly duties: number;
  readonly early: number;
  readonly late: number;
  readonly night: number;
  readonly hardNight: number;
  readonly shunting: number;
  /** De diensten 760 en 761: nacht én rangeer. */
  readonly nightShunting: number;
  readonly weekendDuties: number;
  readonly longDuties: number;
  readonly reserveDays: number;
  readonly wtvDays: number;
  readonly compensationDays: number;
  readonly restDays: number;

  readonly restIntervals: readonly RestInterval[];
  readonly minimumRestMinutes: number | null;
  readonly averageRestMinutes: number | null;
  readonly restDistribution: RestDistribution;
  readonly nightRecoveryMinutes: readonly number[];

  readonly workMinutes: number;
  readonly contractHours: number | null;
}

/**
 * De verdeling van rustperioden.
 *
 * Vier bakken, want het verschil tussen twaalf en veertien uur is voor een
 * machinist iets heel anders dan het verschil tussen twintig en tweeëntwintig.
 * Alleen de minimumrust rapporteren verbergt precies dat.
 */
export interface RestDistribution {
  readonly under12h: number;
  readonly from12to14h: number;
  readonly from14to16h: number;
  readonly from16to24h: number;
  readonly over24h: number;
}

const LONG_DUTY_THRESHOLD_MINUTES = 9 * 60;

// ── Diensten opzoeken ────────────────────────────────────────────────────────

/**
 * De diensten, opzoekbaar op de sleutel die een dienst werkelijk aanwijst.
 *
 * Niet op dienstnummer. Dienst 101 van maandag en dienst 101 van donderdag zijn
 * twee diensten met andere tijden; een map op nummer hield er daarvan één over
 * en gaf die terug voor beide dagen. Alles wat daarna werd gemeten — rusttijd,
 * nachtdiensten, weekendbelasting, de uren per rooster — rekende dus deels met
 * de verkeerde dienst. De eindvalidator zoekt al op nummer én weekdag; deze
 * kant deed dat niet, en dat verschil was nergens te zien omdat er gewoon een
 * getal uit kwam.
 */
export function dutyIndex(
  duties: readonly OptimizerDuty[],
): ReadonlyMap<string, OptimizerDuty> {
  const index = new Map<string, OptimizerDuty>();
  for (const duty of duties) {
    for (const weekday of duty.weekdays) {
      index.set(dutyKeyOf(duty.code, weekday), duty);
    }
  }
  return index;
}

/** De sleutel waarop een dienst wordt opgezocht: nummer én weekdag. */
export function dutyKeyOf(code: string, weekday: number): string {
  return `${code}|${weekday}`;
}

// ── De cyclus uitrollen ──────────────────────────────────────────────────────

/**
 * De dagen van een lijn op volgorde, met de dienst erbij gezocht.
 *
 * De weekindex in de gegevens telt vanaf 1: zo staat hij in de database, in de
 * kandidaten en in de eindvalidator. Hier werd vanaf 0 gezocht, dus vond elke
 * opzoeking niets en telde elke lijn nul diensten. Alle deelscores kwamen
 * daardoor op 100 uit en elk scenario scoorde exact hetzelfde. De tests merkten
 * het niet, omdat hun fixtures óók vanaf 0 telden — twee fouten die elkaar
 * precies ophieven.
 */
export function cycleOf(
  line: OptimizerLine,
  duties: ReadonlyMap<string, OptimizerDuty>,
): readonly CycleDay[] {
  const byKey = new Map(line.days.map((day) => [`${day.weekIndex}|${day.weekday}`, day]));
  const days: CycleDay[] = [];

  for (let week = 0; week < line.cycleWeeks; week += 1) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const entry = byKey.get(`${week + 1}|${weekday}`);
      days.push({
        index: week * 7 + (weekday - 1),
        weekIndex: week + 1,
        weekday,
        positionType: entry?.positionType ?? "RUST",
        duty: entry?.dutyCode ? (duties.get(dutyKeyOf(entry.dutyCode, weekday)) ?? null) : null,
      });
    }
  }
  return days;
}

/**
 * De rustperioden tussen opeenvolgende diensten in de cyclus.
 *
 * De cyclus is rond: na de laatste dag komt de eerste weer. Zonder die
 * afsluiting zou de overgang van week vier naar week één nooit worden gemeten,
 * en dat is nu juist de plek waar een roosterpatroon stukgaat.
 */
export function restIntervalsOf(cycle: readonly CycleDay[]): readonly RestInterval[] {
  const withDuty = cycle.filter((day) => day.duty !== null);
  // Eén dienst per cyclus levert wél een rustperiode op: van het einde van die
  // dienst tot zijn eigen begin een cyclus later. Die overslaan zou een lijn met
  // weinig diensten ten onrechte als "geen rustgegevens" laten gelden.
  if (withDuty.length === 0) {
    return [];
  }

  const intervals: RestInterval[] = [];
  const total = cycle.length;

  for (let position = 0; position < withDuty.length; position += 1) {
    const current = withDuty[position];
    const next = withDuty[(position + 1) % withDuty.length];
    const wrapped = position + 1 >= withDuty.length;
    const dayGap = wrapped ? next.index + total - current.index : next.index - current.index;

    intervals.push({
      fromIndex: current.index,
      toIndex: next.index,
      minutes: dayGap * 1440 + next.duty!.startMinute - current.duty!.endMinute,
      afterNight: isNightServiceByTime(shapeOf(current.duty!)),
    });
  }

  return intervals;
}

function shapeOf(duty: OptimizerDuty) {
  return {
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    breakMinutes: duty.breakMinutes,
    overtimeMinutes: duty.overtimeMinutes,
  };
}

// ── Meten ────────────────────────────────────────────────────────────────────

export function measureLine(
  line: OptimizerLine,
  duties: ReadonlyMap<string, OptimizerDuty>,
): LineMetrics {
  const cycle = cycleOf(line, duties);
  const intervals = restIntervalsOf(cycle);
  const dutyDays = cycle.filter((day) => day.duty !== null);

  let early = 0;
  let late = 0;
  let night = 0;
  let hardNight = 0;
  let shunting = 0;
  let nightShunting = 0;
  let weekendDuties = 0;
  let longDuties = 0;
  let workMinutes = 0;

  for (const day of dutyDays) {
    const duty = day.duty!;
    const shape = shapeOf(duty);
    const kinds = duty.kinds;

    if (kinds.includes(DutyKind.VROEG)) {
      early += 1;
    }
    if (kinds.includes(DutyKind.LAAT)) {
      late += 1;
    }
    if (kinds.includes(DutyKind.NACHT) || isNightServiceByTime(shape)) {
      night += 1;
    }
    if (isHardNightService(shape)) {
      hardNight += 1;
    }
    if (kinds.includes(DutyKind.RANGEER)) {
      shunting += 1;
      if (kinds.includes(DutyKind.NACHT)) {
        nightShunting += 1;
      }
    }
    if (day.weekday === 6 || day.weekday === 7) {
      weekendDuties += 1;
    }

    const length = duty.endMinute - duty.startMinute;
    if (length > LONG_DUTY_THRESHOLD_MINUTES) {
      longDuties += 1;
    }
    // Arbeidstijd bij benadering: dienstlengte minus vastgelegde pauze. Is de
    // pauze niet vastgelegd, dan telt de hele dienstlengte mee — voor een
    // kwaliteitsmaat is dat de veilige kant, en het is geen juridisch getal.
    workMinutes += length - (duty.breakMinutes ?? 0);
  }

  const restMinutes = intervals.map((interval) => interval.minutes);

  return {
    baseRosterCode: line.baseRosterCode,
    profile: line.profile,
    lineNumber: line.lineNumber,
    cycleDays: cycle.length,

    duties: dutyDays.length,
    early,
    late,
    night,
    hardNight,
    shunting,
    nightShunting,
    weekendDuties,
    longDuties,
    reserveDays: cycle.filter((day) => day.positionType === "RES").length,
    wtvDays: cycle.filter((day) => day.positionType === "WR").length,
    compensationDays: cycle.filter((day) => day.positionType === "CO").length,
    restDays: cycle.filter((day) => day.positionType === "RUST").length,

    restIntervals: intervals,
    minimumRestMinutes: restMinutes.length > 0 ? Math.min(...restMinutes) : null,
    averageRestMinutes:
      restMinutes.length > 0
        ? Math.round(restMinutes.reduce((sum, value) => sum + value, 0) / restMinutes.length)
        : null,
    restDistribution: distributionOf(restMinutes),
    nightRecoveryMinutes: intervals
      .filter((interval) => interval.afterNight)
      .map((interval) => interval.minutes),

    workMinutes,
    contractHours: line.contractHours,
  };
}

export function distributionOf(restMinutes: readonly number[]): RestDistribution {
  const bucket = { under12h: 0, from12to14h: 0, from14to16h: 0, from16to24h: 0, over24h: 0 };
  for (const minutes of restMinutes) {
    if (minutes < 12 * 60) {
      bucket.under12h += 1;
    } else if (minutes < 14 * 60) {
      bucket.from12to14h += 1;
    } else if (minutes < 16 * 60) {
      bucket.from14to16h += 1;
    } else if (minutes < 24 * 60) {
      bucket.from16to24h += 1;
    } else {
      bucket.over24h += 1;
    }
  }
  return bucket;
}

// ── Eerlijkheid tussen lijnen ────────────────────────────────────────────────

/**
 * Hoe scheef iets over de lijnen verdeeld is.
 *
 * Twee maten naast elkaar. De variatiecoëfficiënt is statistisch netjes maar
 * zegt een planner niets; het verschil tussen de zwaarste en de lichtste lijn
 * als percentage van het gemiddelde is precies wat er in de wandelgangen
 * besproken wordt. Beide rapporteren kost niets en voorkomt dat een
 * verbeteringspercentage uit een zwarte doos komt.
 */
export interface Spread {
  readonly label: string;
  readonly total: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  /** (max − min) / gemiddelde, in procenten. Nul bij een gelijke verdeling. */
  readonly rangePercentage: number;
  /** Standaarddeviatie gedeeld door het gemiddelde, in procenten. */
  readonly coefficientOfVariation: number;
}

export function spreadOf(label: string, values: readonly number[]): Spread {
  if (values.length === 0) {
    return {
      label,
      total: 0,
      mean: 0,
      min: 0,
      max: 0,
      rangePercentage: 0,
      coefficientOfVariation: 0,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const mean = total / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return {
    label,
    total,
    mean: round(mean, 2),
    min,
    max,
    rangePercentage: mean === 0 ? 0 : round(((max - min) / mean) * 100, 1),
    coefficientOfVariation: mean === 0 ? 0 : round((Math.sqrt(variance) / mean) * 100, 1),
  };
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Alle lijnen van een kandidaat, teruggerekend naar `OptimizerLine`s. */
export function linesFromAssignments(
  assignments: readonly CandidateAssignment[],
  template: readonly OptimizerLine[],
): readonly OptimizerLine[] {
  const byLine = new Map<string, CandidateAssignment[]>();
  for (const assignment of assignments) {
    const key = `${assignment.baseRosterCode}|${assignment.lineNumber}`;
    const existing = byLine.get(key);
    if (existing) {
      existing.push(assignment);
    } else {
      byLine.set(key, [assignment]);
    }
  }

  return template.map((line) => ({
    ...line,
    days: (byLine.get(`${line.baseRosterCode}|${line.lineNumber}`) ?? []).map((assignment) => ({
      weekIndex: assignment.weekIndex,
      weekday: assignment.weekday,
      positionType: assignment.positionType,
      dutyCode: assignment.dutyCode,
    })),
  }));
}
