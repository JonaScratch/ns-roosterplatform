import { DutyKind } from "@/lib/generated/prisma/enums";
import type { ScoreBreakdown } from "@/domain/candidate";
import type { AggregatedFeedback, OptimizerDuty, OptimizerLine } from "./contract";
import {
  type CycleDay,
  type LineMetrics,
  type Spread,
  cycleOf,
  measureLine,
  round,
  spreadOf,
} from "./metrics";

/**
 * Het kwaliteitsmodel.
 *
 * ## Wat een score hier wel en niet betekent
 *
 * Honderd punten betekent: zo goed als dit model kan meten. Het betekent
 * uitdrukkelijk niet dat het rooster mag. Juridische geldigheid is geen getal op
 * dezelfde as als rustkwaliteit, want zodra dat wel zo is, bestaat er een
 * wisselkoers — en dan is een overtreding te koop voor genoeg kwaliteitspunten.
 * Die twee blijven daarom gescheiden tot in de rangschikking toe.
 *
 * ## Waarom elke formule hier uitgeschreven staat
 *
 * Een planner moet aan een collega kunnen uitleggen waarom scenario A hoger
 * staat dan B. Dat kan niet met een gewicht dat ergens in een solver zit. Elke
 * deelscore hieronder is één regel rekenwerk over getallen die zelf ook worden
 * getoond.
 */

// ── Deelscores ───────────────────────────────────────────────────────────────

/**
 * Rustkwaliteit.
 *
 * Elke rustperiode krijgt een waardering naar zijn lengte; de score is het
 * gemiddelde daarvan. Onder twaalf uur telt als nul — niet als straf, maar omdat
 * zo'n rust in een basisrooster niet hoort voor te komen en de CAO-toets hem
 * elders al blokkeert.
 *
 *   < 12 u → 0 · 12–14 u → 50 · 14–16 u → 75 · 16–24 u → 100 · > 24 u → 100
 */
export function restQualityScore(metrics: readonly LineMetrics[]): number {
  const values: number[] = [];
  for (const line of metrics) {
    for (const interval of line.restIntervals) {
      values.push(restValue(interval.minutes));
    }
  }
  return values.length === 0 ? 100 : round(average(values), 1);
}

function restValue(minutes: number): number {
  if (minutes < 12 * 60) {
    return 0;
  }
  if (minutes < 14 * 60) {
    return 50;
  }
  if (minutes < 16 * 60) {
    return 75;
  }
  return 100;
}

/**
 * Een verdelingsscore.
 *
 * Honderd bij een gelijke verdeling over de lijnen, aflopend met het verschil
 * tussen de zwaarste en de lichtste lijn:
 *
 *   score = 100 − min(100, verschil zwaarste/lichtste als percentage van het gemiddelde)
 *
 * Bewust die maat en niet de standaarddeviatie: het verschil tussen de zwaarste
 * en de lichtste lijn is wat mensen aan elkaar uitleggen.
 */
export function balanceScore(spread: Spread): number {
  return round(Math.max(0, 100 - Math.min(100, spread.rangePercentage)), 1);
}

/** De maten waarover verdeling wordt gemeten, met hun label voor de interface. */
export const DIMENSIONS: readonly {
  readonly label: string;
  readonly pick: (line: LineMetrics) => number;
}[] = [
  { label: "Weekendbelasting", pick: (line) => line.weekendDuties },
  { label: "Nachtdiensten", pick: (line) => line.night },
  { label: "Vroege diensten", pick: (line) => line.early },
  { label: "Late diensten", pick: (line) => line.late },
  { label: "Rangeerdiensten", pick: (line) => line.shunting },
  { label: "Reservedagen", pick: (line) => line.reserveDays },
];

/**
 * Verdeling binnen een basisrooster, niet erover heen.
 *
 * Dit is een correctie op een eerdere versie die alle lijnen van alle profielen
 * op één hoop gooide. Dat gaf een vernietigend oordeel over een rooster dat
 * niets mankeerde: een lijn in het profiel Vroeg heeft nul nachtdiensten en een
 * lijn in Laat/Nacht een stuk of tien, en dat verschil is de bedoeling — het is
 * precies waarvoor die profielen bestaan. Scheefheid meten heeft alleen zin
 * tussen lijnen die vergelijkbaar zijn, dus binnen hetzelfde basisrooster.
 *
 * De deelscores worden daarna gewogen naar het aantal lijnen: een scheef
 * rooster met acht lijnen weegt zwaarder dan een scheef rooster met twee.
 */
export function balanceWithinRosters(
  metrics: readonly LineMetrics[],
  pick: (line: LineMetrics) => number,
): number {
  const groups = new Map<string, LineMetrics[]>();
  for (const line of metrics) {
    const existing = groups.get(line.baseRosterCode);
    if (existing) {
      existing.push(line);
    } else {
      groups.set(line.baseRosterCode, [line]);
    }
  }

  let weighted = 0;
  let weight = 0;
  for (const group of groups.values()) {
    // Een basisrooster met één lijn kent geen scheefheid; die telt niet mee.
    if (group.length < 2) {
      continue;
    }
    weighted += balanceScore(spreadOf("", group.map(pick))) * group.length;
    weight += group.length;
  }

  return weight === 0 ? 100 : round(weighted / weight, 1);
}

// ── Patronen ─────────────────────────────────────────────────────────────────

export interface PatternFindings {
  readonly isolatedLate: number;
  readonly backwardShift: number;
  readonly largeShift: number;
  readonly heavyCluster: number;
  readonly dutyDays: number;
}

/**
 * Ongewenste patronen.
 *
 * Vier stuks, elk met een formule die te controleren is:
 *
 *  - **geïsoleerde late dienst** — een late dienst met aan beide kanten een
 *    vroege dienst als naaste dienstdag;
 *  - **achterwaartse verschuiving** — de volgende dienst begint vier uur of meer
 *    eerder dan de vorige, met minder dan zestien uur rust ertussen;
 *  - **grote verschuiving** — de starttijd verspringt zes uur of meer tussen twee
 *    opeenvolgende dienstdagen;
 *  - **zware cluster** — drie of meer opeenvolgende dienstdagen die alle nacht
 *    of alle rangeer zijn.
 *
 * Alle vier zijn zacht. Ze meten vermoeidheid en werkbaarheid, geen
 * rechtmatigheid, en er wordt hier dus geen enkele grens van gemaakt.
 */
export function patternsOf(
  line: OptimizerLine,
  duties: ReadonlyMap<string, OptimizerDuty>,
): PatternFindings {
  const cycle = cycleOf(line, duties);
  const dutyDays = cycle.filter((day) => day.duty !== null);
  if (dutyDays.length < 2) {
    return { isolatedLate: 0, backwardShift: 0, largeShift: 0, heavyCluster: 0, dutyDays: dutyDays.length };
  }

  let isolatedLate = 0;
  let backwardShift = 0;
  let largeShift = 0;

  for (let index = 0; index < dutyDays.length; index += 1) {
    const previous = dutyDays[(index - 1 + dutyDays.length) % dutyDays.length];
    const current = dutyDays[index];
    const next = dutyDays[(index + 1) % dutyDays.length];

    if (
      isKind(current, DutyKind.LAAT) &&
      isKind(previous, DutyKind.VROEG) &&
      isKind(next, DutyKind.VROEG)
    ) {
      isolatedLate += 1;
    }

    const gapDays = ((next.index - current.index) + cycle.length) % cycle.length || cycle.length;
    const restMinutes = gapDays * 1440 + next.duty!.startMinute - current.duty!.endMinute;
    const shift = current.duty!.startMinute - next.duty!.startMinute;

    if (shift >= 4 * 60 && restMinutes < 16 * 60) {
      backwardShift += 1;
    }
    if (Math.abs(shift) >= 6 * 60) {
      largeShift += 1;
    }
  }

  return {
    isolatedLate,
    backwardShift,
    largeShift,
    heavyCluster: countHeavyClusters(dutyDays),
    dutyDays: dutyDays.length,
  };
}

function isKind(day: CycleDay, kind: DutyKind): boolean {
  return day.duty?.kinds.includes(kind) ?? false;
}

/** Drie of meer opeenvolgende dienstdagen die alle nacht of alle rangeer zijn. */
function countHeavyClusters(dutyDays: readonly CycleDay[]): number {
  let clusters = 0;
  for (const kind of [DutyKind.NACHT, DutyKind.RANGEER]) {
    let run = 0;
    for (const day of [...dutyDays, ...dutyDays.slice(0, 2)]) {
      if (isKind(day, kind)) {
        run += 1;
        if (run === 3) {
          clusters += 1;
        }
      } else {
        run = 0;
      }
    }
  }
  return clusters;
}

/**
 * De patroonscore.
 *
 * Elk patroon kost punten naar rato van het aantal dienstdagen, met gewichten
 * die de zwaarte weerspiegelen: een achterwaartse verschuiving met korte rust
 * kost het meest, een grote verschuiving met ruime rust het minst.
 *
 *   straf = (2·geïsoleerd + 3·achterwaarts + 1·groot + 2·cluster) / dienstdagen
 *   score = 100 · (1 − min(1, straf))
 */
export function patternScore(findings: readonly PatternFindings[]): number {
  const dutyDays = findings.reduce((sum, entry) => sum + entry.dutyDays, 0);
  if (dutyDays === 0) {
    return 100;
  }
  const weighted = findings.reduce(
    (sum, entry) =>
      sum +
      2 * entry.isolatedLate +
      3 * entry.backwardShift +
      1 * entry.largeShift +
      2 * entry.heavyCluster,
    0,
  );
  return round(100 * (1 - Math.min(1, weighted / dutyDays)), 1);
}

// ── Feedback ─────────────────────────────────────────────────────────────────

/**
 * Aansluiting bij de geaggregeerde feedback.
 *
 * Feedback is zacht en komt uitsluitend als aandeel per profiel binnen; er gaat
 * geen personeelsnummer langs. Een signaal telt pas mee wanneer een meerderheid
 * het deelt en er genoeg respondenten zijn — anders zou één ontevreden
 * medewerker het rooster van een heel profiel kunnen sturen, en dat is precies
 * het tegenovergestelde van eerlijk.
 *
 * Zonder vergelijkingsrooster is er niets uit te spreken: dan is de score
 * neutraal 50 en staat erbij dat er geen referentie was.
 */
export function feedbackAlignmentScore(
  metrics: readonly LineMetrics[],
  feedback: readonly AggregatedFeedback[],
  reference: readonly LineMetrics[] | null,
): { readonly score: number; readonly note: string } {
  const meaningful = feedback.filter((signal) => signal.share >= 0.5 && signal.respondents >= 5);
  if (meaningful.length === 0) {
    return { score: 100, note: "Geen meerderheidssignaal in de feedback; niets om op te sturen." };
  }
  if (!reference) {
    return {
      score: 50,
      note: "Zonder vergelijkingsrooster is niet vast te stellen of een signaal beter wordt bediend.",
    };
  }

  const deltas = meaningful.map((signal) => {
    const now = burdenFor(reference, signal);
    const proposed = burdenFor(metrics, signal);
    if (now === 0) {
      return 0;
    }
    // Een daling van de belasting waarover geklaagd wordt, telt positief.
    return (now - proposed) / now;
  });

  return {
    score: round(Math.max(0, Math.min(100, 50 + average(deltas) * 100)), 1),
    note: `${meaningful.length} meerderheidssignalen meegewogen ten opzichte van het huidige rooster.`,
  };
}

function burdenFor(metrics: readonly LineMetrics[], signal: AggregatedFeedback): number {
  const inProfile = metrics.filter((line) => line.profile === signal.rosterProfile);
  const sum = (pick: (line: LineMetrics) => number): number =>
    inProfile.reduce((total, line) => total + pick(line), 0);

  switch (signal.category) {
    case "VROEGE_DIENSTEN":
      return sum((line) => line.early);
    case "NACHTDIENSTEN":
      return sum((line) => line.night);
    case "WEEKENDBELASTING":
      return sum((line) => line.weekendDuties);
    case "RANGEERDIENSTEN":
      return sum((line) => line.shunting);
    default:
      return 0;
  }
}

// ── Het geheel ───────────────────────────────────────────────────────────────

export interface ScoredRoster {
  readonly breakdown: ScoreBreakdown;
  readonly lineMetrics: readonly LineMetrics[];
  readonly spreads: readonly Spread[];
  readonly patterns: readonly PatternFindings[];
  readonly feedbackNote: string;
}

/**
 * De gewichten waarmee de deelscores tot één getal komen.
 *
 * Ze staan hier zichtbaar en niet in een solver: wie de rangschikking betwist,
 * moet kunnen zien waarom.
 */
const WEIGHTS: Readonly<Record<keyof Omit<ScoreBreakdown, "overallQualityScore">, number>> = {
  restQuality: 1.0,
  weekendBalance: 0.9,
  nightBalance: 0.9,
  earlyBalance: 0.8,
  lateBalance: 0.7,
  shuntingBalance: 0.8,
  reserveBalance: 0.5,
  patternQuality: 0.9,
  feedbackAlignment: 0.6,
};

export function scoreRoster(
  lines: readonly OptimizerLine[],
  duties: ReadonlyMap<string, OptimizerDuty>,
  feedback: readonly AggregatedFeedback[],
  reference: readonly LineMetrics[] | null = null,
): ScoredRoster {
  const lineMetrics = lines.map((line) => measureLine(line, duties));
  const patterns = lines.map((line) => patternsOf(line, duties));

  const spreads = DIMENSIONS.map((dimension) =>
    spreadOf(dimension.label, lineMetrics.map(dimension.pick)),
  );
  const feedbackResult = feedbackAlignmentScore(lineMetrics, feedback, reference);

  const parts = {
    restQuality: restQualityScore(lineMetrics),
    weekendBalance: balanceWithinRosters(lineMetrics, (line) => line.weekendDuties),
    nightBalance: balanceWithinRosters(lineMetrics, (line) => line.night),
    earlyBalance: balanceWithinRosters(lineMetrics, (line) => line.early),
    lateBalance: balanceWithinRosters(lineMetrics, (line) => line.late),
    shuntingBalance: balanceWithinRosters(lineMetrics, (line) => line.shunting),
    reserveBalance: balanceWithinRosters(lineMetrics, (line) => line.reserveDays),
    patternQuality: patternScore(patterns),
    feedbackAlignment: feedbackResult.score,
  };

  const totalWeight = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const weighted = (Object.keys(parts) as (keyof typeof parts)[]).reduce(
    (sum, key) => sum + parts[key] * WEIGHTS[key],
    0,
  );

  return {
    breakdown: { ...parts, overallQualityScore: round(weighted / totalWeight, 1) },
    lineMetrics,
    spreads,
    patterns,
    feedbackNote: feedbackResult.note,
  };
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
