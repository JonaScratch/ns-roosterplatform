import { profileAllowsDuty } from "./roster-profiles";
import { type RosterPositionType } from "@/lib/generated/prisma/enums";
import { rosterHours, TARGET_WEEKLY_MINUTES } from "./roster-hours";
import {
  type CycleSlot,
  type QualityDuty,
  type QualityRosterInput,
  dutyKey,
  rotationCycle,
} from "./roster-quality";
import {
  ADJACENT_TRANSITION_PENALTY,
  HEAVY_TRANSITION_PENALTY,
  OFF_POSITION_TYPES,
  OVER_ONE_OFF_DAY_PENALTY,
  type TransitionCategory,
} from "./roster-quality-config";
import {
  type ComponentKey,
  CURRENT_QUALITY_MODEL,
  QUALITY_MODEL_V1,
  QUALITY_MODEL_V2,
  QUALITY_MODEL_V3,
  type QualityModel,
  componentWeight,
} from "./quality-model";
import { type PreferenceMetrics, preferenceMetrics } from "./machinist-preference";
import { nightBlockWorth } from "./night-rhythm";
import type { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
import { klokAfstand } from "./roster-flow";
import { type RhythmMetrics, jitterPenalty, nightBlockValue, rhythmMetrics } from "./rhythm-metrics";
import { type WorstCase, worstCase, worstCasePenalty } from "./worst-case";
import { type OperationalCheck, checkOperationalRequirements } from "./operational-requirements";

/**
 * De RosterQualityEvaluator: hoe menselijk rijdt dit rooster?
 *
 * ## Plaats in de keten
 *
 *   generator → harde validatie → deze evaluator → rangschikking
 *
 * De evaluator weet niets van de CP-SAT-doelfunctie en niets van de
 * eindvalidatie. Hij krijgt een rooster, de diensten, het huidige rooster als
 * referentie en een paar waarden uit het regelbestand, en rekent daar met één
 * vast model (`quality-model.ts`) een kwaliteit uit. Dezelfde functie beoordeelt
 * het officiële rooster, een v1.0.3-kandidaat en een v1.0.4-kandidaat.
 *
 * ## Harde geldigheid staat los
 *
 * Dekking en profielgrenzen worden hier wel gemeten, maar niet gewogen: een
 * kandidaat met een lege dienstdag of een dienst buiten zijn profiel is
 * `hardValid: false`. De score die er dan nog bij staat, mag nergens voor een
 * rangschikking worden gebruikt; de engine wijst zo'n kandidaat af.
 *
 * ## Geen verzonnen drempels
 *
 * Rust, herstel na nachten en de grens van een lange dienst komen uit het
 * regelbestand en worden als parameter meegegeven. Alles wat een oordeel over
 * comfort is, staat met schaal en reden in het model.
 */

export interface QualityRuleParameters {
  /** RP_DAILY_REST_PLANNED */
  readonly minDailyRestMinutes: number;
  /** NIGHT_SEQUENCE_RECOVERY */
  readonly nightRecoveryMinutes: number;
  /** RP_LONG_DUTY_THRESHOLD */
  readonly longDutyMinutes: number;
}

export interface EvaluationInput {
  readonly rosters: readonly QualityRosterInput[];
  readonly reference: readonly QualityRosterInput[];
  readonly duties: ReadonlyMap<string, QualityDuty>;
  /** Alle dienstinstanties die geplaatst moeten worden: nummer|weekdag. */
  readonly requiredDutyKeys: readonly string[];
  readonly nightRosterCodes: readonly string[];
  readonly rules: QualityRuleParameters;
  readonly model?: QualityModel;
}

export interface Stat {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly variance: number;
  readonly min: number;
  readonly max: number;
  readonly maxMin: number;
  readonly cv: number | null;
  readonly gini: number | null;
}

export interface ComponentScore {
  readonly score: number | null;
  readonly parts: Readonly<Record<string, number | null>>;
}

export interface LineQuality {
  readonly roster: string;
  readonly lineNumber: number;
  readonly score: number | null;
  readonly parts: Readonly<Record<string, number | null>>;
  readonly counts: { readonly worked: number; readonly pairs: number; readonly stable: number; readonly heavy: number; readonly penalty: number };
  readonly facts: readonly string[];
}

type Category = TransitionCategory | "OFF" | "RES";

export interface HumanQualityReport {
  readonly modelVersion: string;
  readonly hardValidity: {
    readonly hardValid: boolean;
    readonly coverage: {
      readonly required: number;
      readonly assigned: number;
      readonly unassigned: number;
      readonly duplicates: number;
      readonly invalid: number;
      readonly emptyDutyDays: number;
    };
    readonly profileBreaches: readonly { roster: string; lineNumber: number; weekday: number; dutyCode: string }[];
    readonly reasons: readonly string[];
  };
  readonly components: Readonly<Record<ComponentKey, ComponentScore>>;
  readonly overall: number | null;
  /**
   * Hetzelfde totaal zonder continuïteit. Het huidige rooster is zijn eigen
   * referentie en scoort daar altijd 100; voor een vergelijking van comfort en
   * regelmaat met het officiële rooster is dit het eerlijkere getal.
   */
  readonly overallWithoutContinuity: number | null;
  readonly robust: number | null;
  readonly lines: {
    readonly worst: LineQuality | null;
    readonly best: LineQuality | null;
    readonly median: number | null;
    readonly all: readonly LineQuality[];
  };
  readonly metrics: {
    readonly hours: {
      readonly rosters: readonly { code: string; averageWeeklyMinutes: number; deviationMinutes: number }[];
      readonly rosterStats: Stat;
      readonly lines: readonly {
        roster: string;
        lineNumber: number;
        dutyMinutes: number;
        wtvCreditMinutes: number;
        otherCreditMinutes: number;
        totalCreditMinutes: number;
        weeklyMinutes: number;
        deviationMinutes: number;
      }[];
      readonly lineStats: Stat & {
        readonly within5: number;
        readonly within10: number;
        readonly within20: number;
        readonly outside30: number;
      };
    };
    readonly nights: {
      readonly total: number;
      readonly blocks: number;
      readonly singletons: number;
      readonly blocks2: number;
      readonly blocks3: number;
      readonly blocks4: number;
      readonly blocks5plus: number;
      readonly averageBlockLength: number | null;
      readonly longestBlock: number;
      readonly outsideNightRosters: number;
      readonly perRoster: readonly { code: string; nights: number; lines: number; perLine: number; blocks: readonly number[] }[];
      readonly perEligibleLine: Stat;
      readonly lineCounts: Stat;
    };
    readonly transitions: {
      readonly matrix: Readonly<Record<Category, Readonly<Record<Category, number>>>>;
      readonly workedDays: number;
      readonly adjacentWorkedPairs: number;
      readonly stablePairs: number;
      readonly switches: number;
      readonly switchesPerWorkedDay: number;
      readonly penaltyTotal: number;
      readonly heavy: number;
      readonly nightToEarly: number;
      readonly lateToEarly: number;
      readonly earlyToNight: number;
      readonly averageStreak: number | null;
      readonly streakLengths: Readonly<Record<string, number>>;
    };
    readonly rest: {
      readonly nextDayIntervals: number;
      readonly bands: Readonly<Record<string, number>>;
      readonly shortestSurplusMinutes: number | null;
      readonly recovery: readonly { roster: string; lineNumber: number; weekday: number; blockLength: number; minutes: number }[];
    };
    readonly fairness: {
      readonly shuntingPerLine: Stat;
      readonly weekendDaysPerLine: Stat;
      readonly fullWeekendsPerLine: Stat;
      readonly weekendNightsPerLine: Stat;
      readonly longDutiesPerLine: Stat;
      readonly averageDutyMinutesPerRoster: readonly { code: string; average: number | null }[];
    };
    readonly change: {
      readonly dutyDays: number;
      readonly sameDuty: number;
      readonly changedDuty: number;
      readonly sameDutyShare: number | null;
      readonly changedDaypart: number;
      readonly sameDaypartShare: number | null;
    };
  };
  readonly patternDistance: { readonly total: number; readonly parts: Readonly<Record<string, number>> } | null;
  /**
   * Het slechtste geval in het pakket (model v2, H10): nachtuitgang, overgang
   * en werkblok, en wat dat in de robuuste score kost. Null in model v1.
   */
  readonly worstCase: (WorstCase & { readonly penalty: ReturnType<typeof worstCasePenalty> }) | null;
  /**
   * De operationele ontwerpeisen van de gebruiker (roostergemiddelde ≤ 40:00,
   * vrijdag vóór een vrij weekend, RUST + RUST), in elk model gemeten. Alleen in
   * een model met `hard.operational` maken ze een kandidaat hard ongeldig.
   */
  readonly operational: OperationalCheck;
  /**
   * De voorkeurslaag (machinistenvoorkeur, pakketeerlijkheid), in elk model
   * gemeten; alleen model v3 telt hem in de score.
   */
  readonly preference: Omit<PreferenceMetrics, "lineAffinity">;
  readonly diagnosis: readonly string[];
}

// ── Hulpfuncties ─────────────────────────────────────────────────────────────

export function stat(values: readonly number[]): Stat {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: 0, sd: 0, variance: 0, min: 0, max: 0, maxMin: 0, cv: null, gini: null };
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((som, v) => som + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  let gini: number | null = null;
  if (mean > 0) {
    let som = 0;
    for (const a of values) for (const b of values) som += Math.abs(a - b);
    gini = som / (2 * n * n * mean);
  }
  return { n, mean, sd, variance, min, max, maxMin: max - min, cv: mean > 0 ? sd / mean : null, gini };
}

const r1 = (value: number) => Math.round(value * 10) / 10;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function weighted(parts: readonly { value: number | null; weight: number }[]): number | null {
  const bruikbaar = parts.filter((part) => part.value !== null);
  const gewicht = bruikbaar.reduce((som, part) => som + part.weight, 0);
  if (gewicht === 0) {
    return null;
  }
  return bruikbaar.reduce((som, part) => som + (part.value as number) * part.weight, 0) / gewicht;
}

function categorie(slot: CycleSlot): Category {
  if (slot.category) return slot.category;
  if (slot.positionType === "RES") return "RES";
  return "OFF";
}

function fairnessScore(values: readonly number[]): number | null {
  const s = stat(values);
  if (s.n < 2 || s.mean === 0 || s.cv === null) {
    return null;
  }
  return 100 * clamp01(1 - s.cv);
}

function bandValue(bands: readonly { readonly value: number; readonly [key: string]: number | null }[], key: string, x: number): number {
  for (const band of bands) {
    const grens = band[key];
    if (grens === null || x <= (grens as number)) {
      return band.value;
    }
  }
  return bands[bands.length - 1].value;
}

function tvDistance(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  const sleutels = new Set([...Object.keys(a), ...Object.keys(b)]);
  const somA = [...sleutels].reduce((som, k) => som + (a[k] ?? 0), 0);
  const somB = [...sleutels].reduce((som, k) => som + (b[k] ?? 0), 0);
  if (somA === 0 && somB === 0) return 0;
  if (somA === 0 || somB === 0) return 1;
  let afstand = 0;
  for (const k of sleutels) {
    afstand += Math.abs((a[k] ?? 0) / somA - (b[k] ?? 0) / somB);
  }
  return afstand / 2;
}

// ── Eén pakket meten ─────────────────────────────────────────────────────────

interface Profiel {
  readonly cycles: readonly { roster: QualityRosterInput; cycle: readonly CycleSlot[] }[];
  readonly nightBlocks: readonly { roster: string; startIndex: number; length: number; startLine: number; endSlot: CycleSlot; endIndex: number; cycleLength: number }[];
  readonly streaks: Record<string, number>;
  readonly matrix: Record<Category, Record<Category, number>>;
  readonly restBands: Record<string, number>;
  readonly weekendBurden: Record<string, number>;
  readonly switchesPerWorkedDay: number;
}

const CATEGORIEEN: readonly Category[] = ["EARLY", "LATE", "NIGHT", "OFF", "RES"];

function leegMatrix(): Record<Category, Record<Category, number>> {
  return Object.fromEntries(
    CATEGORIEEN.map((van) => [van, Object.fromEntries(CATEGORIEEN.map((naar) => [naar, 0]))]),
  ) as Record<Category, Record<Category, number>>;
}

function profileer(rosters: readonly QualityRosterInput[], duties: ReadonlyMap<string, QualityDuty>, rules: QualityRuleParameters): Profiel {
  const cycles = rosters.map((roster) => ({ roster, cycle: rotationCycle(roster, duties) }));
  const matrix = leegMatrix();
  const streaks: Record<string, number> = {};
  const restBands: Record<string, number> = {};
  const weekendBurden: Record<string, number> = {};
  const nightBlocks: Profiel["nightBlocks"][number][] = [];
  let switches = 0;
  let workedDays = 0;

  for (const { roster, cycle } of cycles) {
    const n = cycle.length;
    if (n === 0) continue;
    for (let i = 0; i < n; i += 1) {
      const slot = cycle[i];
      const volgend = cycle[(i + 1) % n];
      matrix[categorie(slot)][categorie(volgend)] += 1;
      if (slot.category) {
        workedDays += 1;
        if (volgend.category && volgend.category !== slot.category) switches += 1;
        if (volgend.category && slot.duty && volgend.duty) {
          const surplus = 1440 + volgend.duty.startMinute - slot.duty.endMinute - rules.minDailyRestMinutes;
          const band = surplus < 0 ? "below" : surplus <= 60 ? "0-1h" : surplus <= 180 ? "1-3h" : surplus <= 360 ? "3-6h" : ">6h";
          restBands[band] = (restBands[band] ?? 0) + 1;
        }
      }
    }
    // Reeksen in hetzelfde dagdeel, rond de cyclus.
    const alleGewerkt = cycle.every((slot) => slot.category);
    if (alleGewerkt && new Set(cycle.map((slot) => slot.category)).size === 1) {
      streaks[String(Math.min(n, 7))] = (streaks[String(Math.min(n, 7))] ?? 0) + 1;
    } else {
      for (let i = 0; i < n; i += 1) {
        const slot = cycle[i];
        const vorig = cycle[(i - 1 + n) % n];
        if (!slot.category || vorig.category === slot.category) continue;
        let lengte = 0;
        while (lengte < n && cycle[(i + lengte) % n].category === slot.category) lengte += 1;
        const sleutel = lengte >= 7 ? "7+" : String(lengte);
        streaks[sleutel] = (streaks[sleutel] ?? 0) + 1;
      }
    }
    // Nachtreeksen.
    const isNacht = (index: number) => cycle[((index % n) + n) % n].category === "NIGHT";
    const nachten = cycle.filter((slot) => slot.category === "NIGHT").length;
    if (nachten === n && n > 0) {
      nightBlocks.push({ roster: roster.code, startIndex: 0, length: n, startLine: cycle[0].lineNumber, endSlot: cycle[n - 1], endIndex: n - 1, cycleLength: n });
    } else if (nachten > 0) {
      for (let i = 0; i < n; i += 1) {
        if (!isNacht(i) || isNacht(i - 1)) continue;
        let lengte = 0;
        while (lengte < n && isNacht(i + lengte)) lengte += 1;
        const eind = (i + lengte - 1) % n;
        nightBlocks.push({ roster: roster.code, startIndex: i, length: lengte, startLine: cycle[i].lineNumber, endSlot: cycle[eind], endIndex: eind, cycleLength: n });
      }
    }
    // Weekendbelasting per regel.
    const regels = [...new Set(cycle.map((slot) => `${slot.lineNumber}|${slot.weekIndex}`))];
    for (const regel of regels) {
      const dagen = cycle.filter((slot) => `${slot.lineNumber}|${slot.weekIndex}` === regel && slot.weekday >= 6 && slot.category);
      weekendBurden[String(dagen.length)] = (weekendBurden[String(dagen.length)] ?? 0) + 1;
    }
  }

  return {
    cycles,
    nightBlocks,
    streaks,
    matrix,
    restBands,
    weekendBurden,
    switchesPerWorkedDay: workedDays > 0 ? switches / workedDays : 0,
  };
}

function reeksLengtes(profiel: Profiel): Record<string, number> {
  const uit: Record<string, number> = {};
  for (const blok of profiel.nightBlocks) {
    const sleutel = blok.length >= 5 ? "5+" : String(blok.length);
    uit[sleutel] = (uit[sleutel] ?? 0) + blok.length;
  }
  return uit;
}

function overgangsFrequenties(profiel: Profiel): Record<string, number> {
  const uit: Record<string, number> = {};
  for (const van of CATEGORIEEN) for (const naar of CATEGORIEEN) uit[`${van}>${naar}`] = profiel.matrix[van][naar];
  return uit;
}

export function evaluateQuality(input: EvaluationInput): HumanQualityReport {
  const model = input.model ?? CURRENT_QUALITY_MODEL;
  const c = model.components;
  // Versie 2 meet ritme met dezelfde code als de menselijke benchmark. Versie 1
  // blijft volledig reken­baar: opgeslagen kandidaten dragen hun modelversie en
  // moeten later met dezelfde maat na te rekenen zijn.
  // v2 en alles daarna (v3 rekent het ritme als v2 en voegt eisen toe).
  const v2 = model.version !== QUALITY_MODEL_V1.version;
  // v3: voorkeur, nachten op ritme min belasting, affiniteit in de regelscore.
  const v3 = model.version === QUALITY_MODEL_V3.version;
  const voorkeur = preferenceMetrics(input.rosters, input.duties);
  /** De waarde van een nachtreeks naar lengte, per modelversie. */
  const blokWaarde = (lengte: number) =>
    v3 ? nightBlockWorth(lengte) : v2 ? nightBlockValue(lengte) : lengte >= 3 ? 1 : lengte === 2 ? 0.5 : 0;
  const c2 = QUALITY_MODEL_V2.components;
  const profiel = profileer(input.rosters, input.duties, input.rules);
  const ritme: RhythmMetrics | null = v2 ? rhythmMetrics(input.rosters, input.duties, input.rules) : null;
  const nachtRoosters = new Set(input.nightRosterCodes);
  /**
   * Strafpunten voor een wissel, op het etiket (v1) of op de klok (v2): een
   * wissel die de begintijd hooguit een uur verschuift (H09; eerst drie uur) is geen zware
   * overgang, ook al heet het ene dagdeel vroeg en het andere laat.
   */
  const overgangsStraf = (etiket: number, vanStart: number, naarStart: number) =>
    v2 && klokAfstand(vanStart, naarStart) <= c2.flow.parts.penalty.minClockShiftMinutes ? Math.min(etiket, 1) : etiket;

  // ── Harde geldigheid ──────────────────────────────────────────────────────
  const geplaatst = new Map<string, number>();
  let invalid = 0;
  let emptyDutyDays = 0;
  const profileBreaches: HumanQualityReport["hardValidity"]["profileBreaches"][number][] = [];
  for (const roster of input.rosters) {
    for (const dag of roster.days) {
      if (dag.positionType !== "DUTY") continue;
      if (!dag.dutyCode) {
        emptyDutyDays += 1;
        continue;
      }
      const sleutel = dutyKey(dag.dutyCode, dag.weekday);
      const dienst = input.duties.get(sleutel);
      if (!dienst) {
        invalid += 1;
        continue;
      }
      geplaatst.set(sleutel, (geplaatst.get(sleutel) ?? 0) + 1);
      if (!profileAllowsDuty(roster.profile as RosterProfile, dienst.kinds as DutyKind[])) {
        profileBreaches.push({ roster: roster.code, lineNumber: dag.lineNumber, weekday: dag.weekday, dutyCode: dag.dutyCode });
      }
    }
  }
  const required = input.requiredDutyKeys.length;
  const assigned = input.requiredDutyKeys.filter((sleutel) => geplaatst.has(sleutel)).length;
  const duplicates = [...geplaatst.values()].reduce((som, aantal) => som + Math.max(0, aantal - 1), 0);
  const hardReasons: string[] = [];
  if (assigned < required) hardReasons.push(`${required - assigned} dienst(en) niet geplaatst`);
  if (duplicates > 0) hardReasons.push(`${duplicates} dienst(en) dubbel geplaatst`);
  if (invalid > 0) hardReasons.push(`${invalid} plaatsing(en) van een dienst die op die weekdag niet bestaat`);
  if (emptyDutyDays > 0) hardReasons.push(`${emptyDutyDays} dienstdag(en) zonder dienstnummer`);
  if (profileBreaches.length > 0) hardReasons.push(`${profileBreaches.length} dienst(en) buiten het roosterprofiel`);
  const operationeel = checkOperationalRequirements(input.rosters, input.duties);
  if ("hard" in model && model.hard.operational) hardReasons.push(...operationeel.violations);

  // ── Uren ──────────────────────────────────────────────────────────────────
  const urenRoosters = profiel.cycles.map(({ roster, cycle }) => {
    const regels = new Set(cycle.map((slot) => slot.lineNumber)).size;
    const uren = rosterHours({
      days: cycle.map((slot) => ({
        positionType: slot.positionType as RosterPositionType,
        startMinute: slot.duty?.startMinute ?? null,
        endMinute: slot.duty?.endMinute ?? null,
      })),
      lineCount: regels,
      weeksPerLine: roster.weeksPerLine,
    });
    return { code: roster.code, averageWeeklyMinutes: uren.averageWeeklyCreditMinutes, deviationMinutes: uren.deviationFromTargetMinutes };
  });
  const urenRegels = profiel.cycles.flatMap(({ roster, cycle }) => {
    const nummers = [...new Set(cycle.map((slot) => slot.lineNumber))];
    return nummers.map((regel) => {
      const dagen = cycle.filter((slot) => slot.lineNumber === regel);
      const dutyMinutes = dagen.reduce((som, slot) => som + (slot.duty ? slot.duty.endMinute - slot.duty.startMinute : 0), 0);
      const wtv = dagen.filter((slot) => slot.positionType === "WR").length * 480;
      const other = dagen.filter((slot) => slot.positionType === "RES" || slot.positionType === "CO").length * 480;
      const total = dutyMinutes + wtv + other;
      const weekly = total / roster.weeksPerLine;
      return {
        roster: roster.code,
        lineNumber: regel,
        dutyMinutes,
        wtvCreditMinutes: wtv,
        otherCreditMinutes: other,
        totalCreditMinutes: total,
        weeklyMinutes: weekly,
        deviationMinutes: weekly - TARGET_WEEKLY_MINUTES,
      };
    });
  });
  const regelAfwijking = urenRegels.map((regel) => Math.abs(regel.deviationMinutes));
  const lineStats = {
    ...stat(regelAfwijking),
    within5: regelAfwijking.filter((d) => d <= 5).length,
    within10: regelAfwijking.filter((d) => d <= 10).length,
    within20: regelAfwijking.filter((d) => d <= 20).length,
    outside30: regelAfwijking.filter((d) => d > 30).length,
  };
  const contractScores = urenRoosters.map((r) => 100 * clamp01(1 - Math.abs(r.deviationMinutes) / c.hours.parts.contract.zeroAtMinutes));
  // Per regel: v1 straft elke afwijking van 40:00; v2 alleen wat buiten de band
  // valt die de menselijke roosters zelf laten zien.
  const regelUrenWaarde = (afwijking: number) =>
    v2
      ? clamp01(
          1 -
            Math.max(0, Math.abs(afwijking) - c2.hours.parts.outliers.naturalBandMinutes) /
              c2.hours.parts.outliers.zeroBeyondBandMinutes,
        )
      : clamp01(1 - Math.abs(afwijking) / QUALITY_MODEL_V1.components.hours.parts.week.zeroAtMinutes);
  const weekScores = urenRegels.map((r) => 100 * regelUrenWaarde(r.deviationMinutes));
  const hoursContract = contractScores.length > 0 ? contractScores.reduce((a, b) => a + b, 0) / contractScores.length : null;
  const hoursWeek = weekScores.length > 0 ? weekScores.reduce((a, b) => a + b, 0) / weekScores.length : null;

  // ── Overgangen, reeksen, rust ──────────────────────────────────────────────
  let adjacentWorkedPairs = 0;
  let stablePairs = 0;
  let penaltyTotal = 0;
  let heavy = 0;
  let nightToEarly = 0;
  let lateToEarly = 0;
  let earlyToNight = 0;
  let workedDays = 0;
  let switches = 0;
  let restIntervals = 0;
  let surplusSom = 0;
  let shortestSurplus: number | null = null;
  const perRegel = new Map<string, { pairs: number; stable: number; penalty: number; heavy: number; rest: number[]; nights: number[]; jitter: number[]; worked: number }>();
  const regelData = (roster: string, regel: number) => {
    const sleutel = `${roster}|${regel}`;
    let data = perRegel.get(sleutel);
    if (!data) {
      data = { pairs: 0, stable: 0, penalty: 0, heavy: 0, rest: [], nights: [], jitter: [], worked: 0 };
      perRegel.set(sleutel, data);
    }
    return data;
  };
  let jitterSom = 0;
  let jitterAantal = 0;
  for (const { roster, cycle } of profiel.cycles) {
    const n = cycle.length;
    for (let i = 0; i < n; i += 1) {
      const slot = cycle[i];
      const data = regelData(roster.code, slot.lineNumber);
      if (!slot.category || !slot.duty) continue;
      workedDays += 1;
      data.worked += 1;
      const volgend = cycle[(i + 1) % n];
      if (volgend.category && volgend.duty) {
        adjacentWorkedPairs += 1;
        data.pairs += 1;
        if (volgend.category !== slot.category) switches += 1;
        const straf = overgangsStraf(
          ADJACENT_TRANSITION_PENALTY[slot.category][volgend.category],
          slot.duty.startMinute,
          volgend.duty.startMinute,
        );
        if (v2 && volgend.category === slot.category) {
          const sprong = jitterPenalty(klokAfstand(slot.duty.startMinute, volgend.duty.startMinute));
          jitterSom += sprong;
          jitterAantal += 1;
          data.jitter.push(sprong);
        }
        // v2: stabiel is hetzelfde dagdeel óf nauwelijks verschuiving op de klok.
        // Een wissel van etiket met een begintijd die 19 of 41 minuten opschuift, zoals
        // in 50+ Mix, is geen breuk in het ritme van die regel.
        const stabiel = v2
          ? volgend.category === slot.category ||
            klokAfstand(slot.duty.startMinute, volgend.duty.startMinute) <= c2.flow.parts.penalty.minClockShiftMinutes
          : straf === 0;
        if (straf === 0) stablePairs += 1;
        if (stabiel) data.stable += 1;
        penaltyTotal += straf;
        data.penalty += straf;
        if (straf >= HEAVY_TRANSITION_PENALTY) {
          heavy += 1;
          data.heavy += 1;
        }
        // Alleen wat ook op de klok zwaar is. In v1 geldt dat voor elk van deze
        // drie paren; in v2 valt een wissel met weinig verschuiving er buiten.
        if (straf >= HEAVY_TRANSITION_PENALTY) {
          if (slot.category === "NIGHT" && volgend.category === "EARLY") nightToEarly += 1;
          if (slot.category === "LATE" && volgend.category === "EARLY") lateToEarly += 1;
          if (slot.category === "EARLY" && volgend.category === "NIGHT") earlyToNight += 1;
        }
        const surplus = 1440 + volgend.duty.startMinute - slot.duty.endMinute - input.rules.minDailyRestMinutes;
        const waarde = bandValue(c.rest.parts.surplus.bands as never, "upToMinutes", surplus < 0 ? -1 : surplus);
        restIntervals += 1;
        surplusSom += surplus < 0 ? 0 : waarde;
        data.rest.push(surplus < 0 ? 0 : waarde);
        shortestSurplus = shortestSurplus === null ? surplus : Math.min(shortestSurplus, surplus);
        continue;
      }
      const daarna = cycle[(i + 2) % n];
      if (n > 2 && OFF_POSITION_TYPES.includes(volgend.positionType) && daarna.category && daarna.duty) {
        const straf = overgangsStraf(
          OVER_ONE_OFF_DAY_PENALTY[slot.category][daarna.category],
          slot.duty.startMinute,
          daarna.duty.startMinute,
        );
        penaltyTotal += straf;
        data.penalty += straf;
        if (straf >= HEAVY_TRANSITION_PENALTY) {
          heavy += 1;
          data.heavy += 1;
        }
      }
    }
  }
  const streakWaarden = Object.entries(profiel.streaks).flatMap(([lengte, aantal]) =>
    Array.from({ length: aantal }, () => (lengte === "7+" ? 7 : Number(lengte))),
  );
  const averageStreak = streakWaarden.length > 0 ? streakWaarden.reduce((a, b) => a + b, 0) / streakWaarden.length : null;
  const flowStable = adjacentWorkedPairs > 0 ? stablePairs / adjacentWorkedPairs : null;
  const flowPenalty = workedDays > 0 ? clamp01(1 - penaltyTotal / workedDays / c.flow.parts.penalty.zeroAtPointsPerWorkedDay) : null;
  const flowStreak =
    averageStreak !== null
      ? clamp01((averageStreak - 1) / (QUALITY_MODEL_V1.components.flow.parts.streak.fullAtAverageStreak - 1))
      : null;
  // v2: de onderdelen die uit de menselijke roosters komen.
  const flowCoherence = ritme?.coherence ?? null;
  const flowThroughRest = ritme?.changesThroughRest ?? null;
  const flowOscillation = ritme
    ? clamp01(1 - ritme.oscillationsPer100WorkedDays / c2.flow.parts.oscillation.zeroAtPer100WorkedDays)
    : null;
  const flowJitter = jitterAantal > 0 ? 1 - jitterSom / jitterAantal : null;

  // Herstel na nachtreeksen.
  const herstel: HumanQualityReport["metrics"]["rest"]["recovery"][number][] = [];
  for (const blok of profiel.nightBlocks) {
    const cyclus = profiel.cycles.find((entry) => entry.roster.code === blok.roster)!.cycle;
    const n = cyclus.length;
    if (blok.length >= n) continue;
    for (let stap = 1; stap < n; stap += 1) {
      const volgend = cyclus[(blok.endIndex + stap) % n];
      if (volgend.duty && blok.endSlot.duty) {
        herstel.push({
          roster: blok.roster,
          lineNumber: blok.endSlot.lineNumber,
          weekday: blok.endSlot.weekday,
          blockLength: blok.length,
          minutes: stap * 1440 + volgend.duty.startMinute - blok.endSlot.duty.endMinute,
        });
        break;
      }
    }
  }
  const herstelWaarden = herstel.map((entry) =>
    bandValue(c.rest.parts.recovery.bands as never, "upToMinutesAboveRule", entry.minutes - input.rules.nightRecoveryMinutes),
  );
  const restSurplus = restIntervals > 0 ? surplusSom / restIntervals : null;
  const restRecovery = herstelWaarden.length > 0 ? herstelWaarden.reduce((a, b) => a + b, 0) / herstelWaarden.length : null;
  const restHeavy = workedDays > 0 ? clamp01(1 - (heavy / workedDays) * 100 / c.rest.parts.heavy.zeroAtPer100WorkedDays) : null;

  // ── Nachten ───────────────────────────────────────────────────────────────
  const blokken = profiel.nightBlocks;
  const totaalNachten = blokken.reduce((som, blok) => som + blok.length, 0);
  const nachtenIn3 = blokken.filter((b) => b.length >= 3).reduce((som, b) => som + b.length, 0);
  const nachtenIn2 = blokken.filter((b) => b.length === 2).reduce((som, b) => som + b.length, 0);
  const nightsClustering = totaalNachten > 0 ? (nachtenIn3 + 0.5 * nachtenIn2) / totaalNachten : null;
  for (const blok of blokken) {
    const waarde = blokWaarde(blok.length);
    // De reeks telt bij de regel waar hij begint.
    regelData(blok.roster, blok.startLine).nights.push(waarde);
  }
  const nachtWaardeV2 =
    totaalNachten > 0 ? blokken.reduce((som, b) => som + blokWaarde(b.length) * b.length, 0) / totaalNachten : null;
  const nachtUitgang = ritme?.nights.exitValue ?? null;
  const perRoosterNachten = profiel.cycles.map(({ roster, cycle }) => {
    const regels = new Set(cycle.map((slot) => slot.lineNumber)).size;
    const nights = cycle.filter((slot) => slot.category === "NIGHT").length;
    return {
      code: roster.code,
      nights,
      lines: regels,
      perLine: regels > 0 ? nights / regels : 0,
      blocks: blokken.filter((b) => b.roster === roster.code).map((b) => b.length),
    };
  });
  const nachtRegelTellingen = profiel.cycles
    .filter(({ roster }) => nachtRoosters.has(roster.code))
    .flatMap(({ cycle }) =>
      [...new Set(cycle.map((slot) => slot.lineNumber))].map(
        (regel) => cycle.filter((slot) => slot.lineNumber === regel && slot.category === "NIGHT").length,
      ),
    );

  // ── Eerlijkheid ───────────────────────────────────────────────────────────
  const perRegelTellen = (test: (slot: CycleSlot) => boolean) =>
    profiel.cycles.map(({ cycle }) => {
      const regels = new Set(cycle.map((slot) => slot.lineNumber)).size;
      return regels > 0 ? cycle.filter(test).length / regels : 0;
    });
  const shuntingRates = perRegelTellen((slot) => (slot.duty?.kinds.includes("RANGEER") ?? false));
  const weekendRates = perRegelTellen((slot) => slot.weekday >= 6 && slot.category !== null);
  const longRates = perRegelTellen((slot) => (slot.duty ? slot.duty.endMinute - slot.duty.startMinute > input.rules.longDutyMinutes : false));
  const nightRates = perRoosterNachten.filter((r) => nachtRoosters.has(r.code)).map((r) => r.perLine);
  const fullWeekendRates = profiel.cycles.map(({ cycle }) => {
    const regels = [...new Set(cycle.map((slot) => slot.lineNumber))];
    const vol = regels.filter((regel) => {
      const za = cycle.find((slot) => slot.lineNumber === regel && slot.weekday === 6);
      const zo = cycle.find((slot) => slot.lineNumber === regel && slot.weekday === 7);
      return Boolean(za?.category && zo?.category);
    }).length;
    return regels.length > 0 ? vol / regels.length : 0;
  });
  const weekendNightRates = perRegelTellen((slot) => slot.weekday >= 6 && slot.category === "NIGHT");

  // ── Continuïteit ──────────────────────────────────────────────────────────
  const referentie = new Map<string, string | null>();
  for (const roster of input.reference) {
    for (const dag of roster.days) {
      if (dag.positionType === "DUTY") referentie.set(`${roster.code}|${dag.lineNumber}|${dag.weekIndex}|${dag.weekday}`, dag.dutyCode);
    }
  }
  let dutyDays = 0;
  let sameDuty = 0;
  let sameDaypart = 0;
  for (const roster of input.rosters) {
    for (const dag of roster.days) {
      if (dag.positionType !== "DUTY") continue;
      const was = referentie.get(`${roster.code}|${dag.lineNumber}|${dag.weekIndex}|${dag.weekday}`);
      if (was === undefined) continue;
      dutyDays += 1;
      if (was === dag.dutyCode) sameDuty += 1;
      const nu = dag.dutyCode ? input.duties.get(dutyKey(dag.dutyCode, dag.weekday)) : undefined;
      const toen = was ? input.duties.get(dutyKey(was, dag.weekday)) : undefined;
      const cat = (d: QualityDuty | undefined) =>
        d ? (d.kinds.includes("NACHT") ? "NIGHT" : d.kinds.includes("LAAT") ? "LATE" : d.kinds.includes("VROEG") ? "EARLY" : null) : null;
      if (cat(nu) === cat(toen)) sameDaypart += 1;
    }
  }

  // ── Componenten ───────────────────────────────────────────────────────────
  const pct = (value: number | null) => (value === null ? null : 100 * value);
  const components: Record<ComponentKey, ComponentScore> = {
    hours: v2
      ? {
          score: weighted([
            { value: hoursContract, weight: c2.hours.parts.contract.weight },
            { value: hoursWeek, weight: c2.hours.parts.outliers.weight },
          ]),
          parts: { contract: hoursContract, outliers: hoursWeek },
        }
      : {
          score: weighted([
            { value: hoursContract, weight: QUALITY_MODEL_V1.components.hours.parts.contract.weight },
            { value: hoursWeek, weight: QUALITY_MODEL_V1.components.hours.parts.week.weight },
          ]),
          parts: { contract: hoursContract, week: hoursWeek },
        },
    flow: v2
      ? {
          score: weighted([
            { value: pct(flowCoherence), weight: c2.flow.parts.coherence.weight },
            { value: pct(flowThroughRest), weight: c2.flow.parts.throughRest.weight },
            { value: pct(flowOscillation), weight: c2.flow.parts.oscillation.weight },
            { value: pct(flowPenalty), weight: c2.flow.parts.penalty.weight },
            { value: pct(flowJitter), weight: c2.flow.parts.startJitter.weight },
          ]),
          parts: {
            coherence: pct(flowCoherence),
            throughRest: pct(flowThroughRest),
            oscillation: pct(flowOscillation),
            penalty: pct(flowPenalty),
            startJitter: pct(flowJitter),
          },
        }
      : {
          score: weighted([
            { value: pct(flowStable), weight: QUALITY_MODEL_V1.components.flow.parts.stable.weight },
            { value: pct(flowPenalty), weight: QUALITY_MODEL_V1.components.flow.parts.penalty.weight },
            { value: pct(flowStreak), weight: QUALITY_MODEL_V1.components.flow.parts.streak.weight },
          ]),
          parts: { stable: pct(flowStable), penalty: pct(flowPenalty), streak: pct(flowStreak) },
        },
    rest: {
      score: weighted([
        { value: pct(restSurplus), weight: c.rest.parts.surplus.weight },
        { value: pct(restRecovery), weight: c.rest.parts.recovery.weight },
        { value: pct(restHeavy), weight: c.rest.parts.heavy.weight },
      ]),
      parts: { surplus: pct(restSurplus), recovery: pct(restRecovery), heavy: pct(restHeavy) },
    },
    nights: v2
      ? {
          score: weighted([
            { value: pct(nachtWaardeV2), weight: c2.nights.parts.blocks.weight },
            { value: pct(nachtUitgang), weight: c2.nights.parts.exit.weight },
          ]),
          parts: { blocks: pct(nachtWaardeV2), exit: pct(nachtUitgang) },
        }
      : {
          score: pct(nightsClustering),
          parts: { clustering: pct(nightsClustering) },
        },
    fairness: (() => {
      const parts = {
        nights: fairnessScore(nightRates),
        shunting: fairnessScore(shuntingRates),
        weekend: fairnessScore(weekendRates),
        longDuties: fairnessScore(longRates),
      };
      return {
        score: weighted([
          { value: parts.nights, weight: c.fairness.parts.nights.weight },
          { value: parts.shunting, weight: c.fairness.parts.shunting.weight },
          { value: parts.weekend, weight: c.fairness.parts.weekend.weight },
          { value: parts.longDuties, weight: c.fairness.parts.longDuties.weight },
        ]),
        parts,
      };
    })(),
    preference: (() => {
      if (!v3) return { score: null, parts: {} as Record<string, number | null> };
      const cp = QUALITY_MODEL_V3.components.preference.parts;
      const d = voorkeur.parts;
      return {
        score: weighted([
          { value: pct(d.affinity), weight: cp.affinity.weight },
          { value: pct(d.restDuties), weight: cp.restDuties.weight },
          { value: pct(d.dayDuties), weight: cp.dayDuties.weight },
          { value: pct(d.popularFairness), weight: cp.popularFairness.weight },
          { value: pct(d.weekendStart), weight: cp.weekendStart.weight },
        ]),
        parts: {
          affinity: pct(d.affinity),
          restDuties: pct(d.restDuties),
          dayDuties: pct(d.dayDuties),
          popularFairness: pct(d.popularFairness),
          weekendStart: pct(d.weekendStart),
        },
      };
    })(),
    stability: {
      score: weighted([
        { value: dutyDays > 0 ? (100 * sameDuty) / dutyDays : null, weight: c.stability.parts.sameDuty.weight },
        { value: dutyDays > 0 ? (100 * sameDaypart) / dutyDays : null, weight: c.stability.parts.sameDaypart.weight },
      ]),
      parts: {
        sameDuty: dutyDays > 0 ? (100 * sameDuty) / dutyDays : null,
        sameDaypart: dutyDays > 0 ? (100 * sameDaypart) / dutyDays : null,
      },
    },
  };
  const overall = weighted(
    (Object.keys(components) as ComponentKey[]).map((key) => ({ value: components[key].score, weight: componentWeight(model, key) })),
  );
  const overallWithoutContinuity = weighted(
    (Object.keys(components) as ComponentKey[])
      .filter((key) => key !== "stability")
      .map((key) => ({ value: components[key].score, weight: componentWeight(model, key) })),
  );

  // ── Regels ────────────────────────────────────────────────────────────────
  const lw = model.lineScore.weights;
  const lines: LineQuality[] = urenRegels.map((regel) => {
    const data = perRegel.get(`${regel.roster}|${regel.lineNumber}`);
    const uren = 100 * regelUrenWaarde(regel.deviationMinutes);
    const stabielDeel = data && data.pairs > 0 ? data.stable / data.pairs : 1;
    const strafDeel = data && data.worked > 0 ? clamp01(1 - data.penalty / data.worked / c.flow.parts.penalty.zeroAtPointsPerWorkedDay) : 1;
    const flow =
      data && data.worked > 0
        ? v2
          ? // v2: ook de sprong in begintijd telt per regel mee.
            100 *
            (weighted([
              { value: stabielDeel, weight: 0.4 },
              { value: strafDeel, weight: 0.35 },
              { value: data.jitter.length > 0 ? 1 - data.jitter.reduce((a, b) => a + b, 0) / data.jitter.length : null, weight: 0.25 },
            ]) as number)
          : 100 * (0.5 * stabielDeel + 0.5 * strafDeel)
        : null;
    const rust = data && data.rest.length > 0 ? (100 * data.rest.reduce((a, b) => a + b, 0)) / data.rest.length : null;
    const nachten = data && data.nights.length > 0 ? (100 * data.nights.reduce((a, b) => a + b, 0)) / data.nights.length : null;
    const facts: string[] = [];
    if (Math.abs(regel.deviationMinutes) > 240) facts.push(`week ${fmt(regel.weeklyMinutes)}`);
    if (data && data.heavy > 0) facts.push(`${data.heavy} zware overgang(en)`);
    const paarWaarde = blokWaarde(2);
    if (data && data.nights.some((waarde) => waarde === 0)) facts.push("losse nacht");
    if (data && data.nights.some((waarde) => waarde === paarWaarde)) facts.push("reeks van twee nachten");
    if (v2 && data && data.jitter.some((waarde) => waarde >= 0.5)) facts.push("grote sprong in begintijd");
    return {
      roster: regel.roster,
      lineNumber: regel.lineNumber,
      // Een regel zonder één gewerkte dienst (alleen rust, reserve of WTV) ligt
      // helemaal vast in de structuur. Die krijgt geen score: anders is de
      // "slechtste regel" altijd een reserveweek die geen engine kan veranderen.
      score:
        !data || data.worked === 0
          ? null
          : weighted([
              { value: uren, weight: lw.hours },
              { value: flow, weight: lw.flow },
              { value: rust, weight: lw.rest },
              { value: nachten, weight: lw.nights },
              // v3: een regel vol restdiensten is een slechte regel.
              {
                value: v3 ? 100 * (voorkeur.lineAffinity.get(`${regel.roster}|${regel.lineNumber}`) ?? 0) : null,
                weight: "preference" in lw ? lw.preference : 0,
              },
            ]),
      parts: { hours: uren, flow, rest: rust, nights: nachten },
      counts: { worked: data?.worked ?? 0, pairs: data?.pairs ?? 0, stable: data?.stable ?? 0, heavy: data?.heavy ?? 0, penalty: data?.penalty ?? 0 },
      facts,
    };
  });
  const gescoord = lines.filter((line) => line.score !== null).sort((a, b) => (a.score as number) - (b.score as number));
  const worst = gescoord[0] ?? null;
  const best = gescoord.at(-1) ?? null;
  const median = gescoord.length > 0 ? (gescoord[Math.floor((gescoord.length - 1) / 2)].score as number) : null;
  // Het slechtste geval (v2): een extreme uitgang, overgang of werkblok mag niet
  // achter het gemiddelde verdwijnen.
  const slechtste = v2
    ? (() => {
        const w = worstCase(input.rosters, input.duties, {
          nightRecoveryMinutes: input.rules.nightRecoveryMinutes,
          labelOnlyMinutes: c2.flow.parts.penalty.minClockShiftMinutes,
        });
        return { ...w, penalty: worstCasePenalty(w, QUALITY_MODEL_V2.robust.worstCase) };
      })()
    : null;
  const robust =
    overall === null || worst === null || median === null
      ? overall
      : model.robust.overallWeight * overall +
        model.robust.worstLineWeight * (worst.score as number) -
        model.robust.outlierPenaltyPerPoint * Math.max(0, median - (worst.score as number) - model.robust.outlierGapPoints) -
        (slechtste?.penalty.total ?? 0);

  // ── Patroonafstand tot het huidige rooster ─────────────────────────────────
  let patternDistance: HumanQualityReport["patternDistance"] = null;
  if (input.reference.length > 0) {
    const ref = profileer(input.reference, input.duties, input.rules);
    const wisselAfstand =
      Math.max(profiel.switchesPerWorkedDay, ref.switchesPerWorkedDay) > 0
        ? Math.abs(profiel.switchesPerWorkedDay - ref.switchesPerWorkedDay) /
          Math.max(profiel.switchesPerWorkedDay, ref.switchesPerWorkedDay)
        : 0;
    const refRitme = ritme ? rhythmMetrics(input.reference, input.duties, input.rules) : null;
    // v2 vergelijkt vorm, niet dienstnummers: reekslengte telt niet meer mee
    // (die ligt in de structuur), samenhang, begintijdsprongen en wat er na
    // nachten komt wel.
    const parts: Record<string, number> =
      ritme && refRitme
        ? {
            nightBlocks: tvDistance(reeksLengtes(profiel), reeksLengtes(ref)),
            transitions: tvDistance(overgangsFrequenties(profiel), overgangsFrequenties(ref)),
            restBands: tvDistance(profiel.restBands, ref.restBands),
            weekendBurden: tvDistance(profiel.weekendBurden, ref.weekendBurden),
            switches: wisselAfstand,
            coherence: Math.abs((ritme.coherence ?? 1) - (refRitme.coherence ?? 1)),
            startJitterBands: tvDistance(ritme.startJitterBands, refRitme.startJitterBands),
            nightExits: tvDistance(ritme.nights.exitStates, refRitme.nights.exitStates),
          }
        : {
            nightBlocks: tvDistance(reeksLengtes(profiel), reeksLengtes(ref)),
            transitions: tvDistance(overgangsFrequenties(profiel), overgangsFrequenties(ref)),
            streaks: tvDistance(profiel.streaks, ref.streaks),
            restBands: tvDistance(profiel.restBands, ref.restBands),
            weekendBurden: tvDistance(profiel.weekendBurden, ref.weekendBurden),
            switches: wisselAfstand,
          };
    const waarden = Object.values(parts);
    patternDistance = {
      total: r1((100 * waarden.reduce((a, b) => a + b, 0)) / waarden.length),
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r1(100 * v)])),
    };
  }

  // ── Diagnose: alleen berekende feiten ──────────────────────────────────────
  const diagnosis: string[] = [];
  diagnosis.push(`${assigned}/${required} diensten geplaatst`);
  if (hardReasons.length > 0) diagnosis.push(...hardReasons.map((reden) => `HARD: ${reden}`));
  const singletons = blokken.filter((b) => b.length === 1).length;
  const blocks2 = blokken.filter((b) => b.length === 2).length;
  if (singletons > 0) diagnosis.push(`${singletons} losse nacht(en)`);
  if (blocks2 > 0) diagnosis.push(`${blocks2} reeks(en) van twee nachten`);
  if (heavy > 0) diagnosis.push(`${heavy} zware overgang(en)`);
  if (nightToEarly > 0) diagnosis.push(`${nightToEarly}× nacht → vroeg op de volgende dag`);
  if (lateToEarly > 0) diagnosis.push(`${lateToEarly}× laat → vroeg op de volgende dag`);
  const maxDev = urenRoosters.reduce((max, r) => Math.max(max, Math.abs(r.deviationMinutes)), 0);
  const maxRoster = urenRoosters.find((r) => Math.abs(r.deviationMinutes) === maxDev);
  if (maxRoster) diagnosis.push(`grootste afwijking van 40:00: ${Math.round(maxDev)} min (${maxRoster.code})`);
  if (worst) diagnosis.push(`slechtste regel: ${worst.roster} regel ${worst.lineNumber} (${r1(worst.score as number)})${worst.facts.length ? ` — ${worst.facts.join(", ")}` : ""}`);
  const rangeer = stat(shuntingRates);
  diagnosis.push(`rangeer per regel ${r1(rangeer.min)}–${r1(rangeer.max)}`);

  return {
    modelVersion: model.version,
    hardValidity: {
      hardValid: hardReasons.length === 0,
      coverage: { required, assigned, unassigned: required - assigned, duplicates, invalid, emptyDutyDays },
      profileBreaches,
      reasons: hardReasons,
    },
    components: Object.fromEntries(
      (Object.keys(components) as ComponentKey[]).map((key) => [
        key,
        {
          score: components[key].score === null ? null : r1(components[key].score as number),
          parts: Object.fromEntries(Object.entries(components[key].parts).map(([k, v]) => [k, v === null ? null : r1(v)])),
        },
      ]),
    ) as Record<ComponentKey, ComponentScore>,
    overall: overall === null ? null : r1(overall),
    overallWithoutContinuity: overallWithoutContinuity === null ? null : r1(overallWithoutContinuity),
    robust: robust === null ? null : r1(robust),
    lines: { worst, best, median, all: lines },
    metrics: {
      hours: { rosters: urenRoosters, rosterStats: stat(urenRoosters.map((r) => Math.abs(r.deviationMinutes))), lines: urenRegels, lineStats },
      nights: {
        total: totaalNachten,
        blocks: blokken.length,
        singletons,
        blocks2,
        blocks3: blokken.filter((b) => b.length === 3).length,
        blocks4: blokken.filter((b) => b.length === 4).length,
        blocks5plus: blokken.filter((b) => b.length >= 5).length,
        averageBlockLength: blokken.length > 0 ? totaalNachten / blokken.length : null,
        longestBlock: blokken.reduce((max, b) => Math.max(max, b.length), 0),
        outsideNightRosters: perRoosterNachten.filter((r) => !nachtRoosters.has(r.code)).reduce((som, r) => som + r.nights, 0),
        perRoster: perRoosterNachten,
        perEligibleLine: stat(nightRates),
        lineCounts: stat(nachtRegelTellingen),
      },
      transitions: {
        matrix: profiel.matrix,
        workedDays,
        adjacentWorkedPairs,
        stablePairs,
        switches,
        switchesPerWorkedDay: workedDays > 0 ? switches / workedDays : 0,
        penaltyTotal,
        heavy,
        nightToEarly,
        lateToEarly,
        earlyToNight,
        averageStreak,
        streakLengths: profiel.streaks,
      },
      rest: { nextDayIntervals: restIntervals, bands: profiel.restBands, shortestSurplusMinutes: shortestSurplus, recovery: herstel },
      fairness: {
        shuntingPerLine: rangeer,
        weekendDaysPerLine: stat(weekendRates),
        fullWeekendsPerLine: stat(fullWeekendRates),
        weekendNightsPerLine: stat(weekendNightRates),
        longDutiesPerLine: stat(longRates),
        averageDutyMinutesPerRoster: profiel.cycles.map(({ roster, cycle }) => {
          const duren = cycle.filter((slot) => slot.duty).map((slot) => slot.duty!.endMinute - slot.duty!.startMinute);
          return { code: roster.code, average: duren.length > 0 ? duren.reduce((a, b) => a + b, 0) / duren.length : null };
        }),
      },
      change: {
        dutyDays,
        sameDuty,
        changedDuty: dutyDays - sameDuty,
        sameDutyShare: dutyDays > 0 ? sameDuty / dutyDays : null,
        changedDaypart: dutyDays - sameDaypart,
        sameDaypartShare: dutyDays > 0 ? sameDaypart / dutyDays : null,
      },
    },
    patternDistance,
    worstCase: slechtste,
    operational: operationeel,
    preference: { parts: voorkeur.parts, perRoster: voorkeur.perRoster, dayDuties: voorkeur.dayDuties, popular: voorkeur.popular, worstRestRoster: voorkeur.worstRestRoster },
    diagnosis,
  };
}

function fmt(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
}
