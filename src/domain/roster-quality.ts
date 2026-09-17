import {
  ADJACENT_TRANSITION_PENALTY,
  COMFORTABLE_REST_MINUTES,
  HEAVY_TRANSITION_PENALTY,
  HOURS_SCORE_ZERO_AT_MINUTES,
  OFF_POSITION_TYPES,
  OVER_ONE_OFF_DAY_PENALTY,
  PREFERRED_NIGHT_BLOCK_LENGTH,
  TIGHT_REST_MINUTES,
  type TransitionCategory,
} from "./roster-quality-config";
import { type CycleDay as HoursCycleDay, type RosterHours, rosterHours } from "./roster-hours";

/**
 * Roosterkwaliteit: hoe logisch is dit rooster om te rijden?
 *
 * ## Geen juridisch oordeel
 *
 * Wat hier gemeten wordt, zegt niets over of een rooster mag. Dat beslist de
 * eindvalidator. Twee roosters die allebei mogen, kunnen voor een machinist heel
 * verschillend zijn: losse nachten tussen dagdiensten, of nachten in één reeks
 * met daarna echte rust. Dat verschil is wat hier zichtbaar wordt.
 *
 * ## Waarom alles in rotatievolgorde
 *
 * Een basisrooster van N regels is één cyclus van N weken: wie deze week regel 2
 * rijdt, rijdt volgende week regel 3. Zondag van regel 2 grenst dus aan maandag
 * van regel 3, en de laatste regel aan de eerste. Een nachtreeks van vrijdag tot
 * en met woensdag loopt over de regelgrens heen en is één reeks van zes — zo
 * staat hij ook in het officiële Laat/Nacht-rooster. Per regel meten zou hem als
 * twee reeksen van drie tellen, en een overgang van zondag naar maandag nooit
 * zien.
 *
 * ## Deelscores, geen totaalgetal
 *
 * Elke deelscore loopt van 0 tot 100 en heeft een uitleg die zegt hoe hij is
 * berekend. Er is bewust geen gewogen totaal: welke maat zwaarder weegt, is een
 * afweging van de Roostercommissie en niet van deze module.
 */

// ── Invoer ───────────────────────────────────────────────────────────────────

export interface QualityDuty {
  readonly code: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly kinds: readonly string[];
}

export interface QualityDay {
  readonly lineNumber: number;
  /** Vanaf 1, zoals in de database. */
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: string;
  readonly dutyCode: string | null;
}

export interface QualityRosterInput {
  readonly code: string;
  readonly name: string;
  readonly profile: string;
  readonly weeksPerLine: number;
  readonly days: readonly QualityDay[];
}

// ── Uitkomst per rooster ─────────────────────────────────────────────────────

export interface CycleSlot {
  readonly index: number;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: string;
  readonly duty: QualityDuty | null;
  readonly category: TransitionCategory | null;
}

export interface NightBlock {
  /** Index in de cyclus van de eerste nacht. */
  readonly startIndex: number;
  readonly length: number;
  readonly startLine: number;
  readonly startWeekday: number;
}

export interface NightQuality {
  readonly total: number;
  readonly blocks: readonly NightBlock[];
  readonly singletons: number;
  readonly pairs: number;
  readonly threeOrMore: number;
  readonly longest: number;
  readonly averageLength: number | null;
  readonly weekendNights: number;
  readonly perLine: readonly number[];
  /** Nachten in reeksen van drie of meer, als deel van alle nachten. */
  readonly clusteredShare: number | null;
}

export interface TransitionFinding {
  readonly lineNumber: number;
  readonly weekday: number;
  readonly fromCode: string;
  readonly toCode: string;
  readonly from: TransitionCategory;
  readonly to: TransitionCategory;
  readonly overOffDay: boolean;
  readonly penalty: number;
}

export interface TransitionQuality {
  readonly adjacentPairs: number;
  readonly stablePairs: number;
  readonly penaltyTotal: number;
  readonly heavy: readonly TransitionFinding[];
  /** Alle overgangen met strafpunten, voor de uitsplitsing. */
  readonly findings: readonly TransitionFinding[];
  readonly stableShare: number | null;
}

export interface RestQuality {
  /** Rustperiodes tussen diensten op opeenvolgende dagen. */
  readonly nextDayIntervals: number;
  readonly comfortable: number;
  readonly tight: number;
  readonly belowTight: number;
  readonly shortestMinutes: number | null;
  /** Rust na het laatste nacht van elke reeks, tot de volgende dienst. */
  readonly recoveryAfterNightBlocks: readonly number[];
}

export interface LineLoad {
  readonly lineNumber: number;
  readonly creditMinutes: number;
  readonly duties: number;
  readonly early: number;
  readonly late: number;
  readonly night: number;
  readonly shunting: number;
  readonly weekendDuties: number;
  readonly weekendMinutes: number;
}

export interface RosterQuality {
  readonly code: string;
  readonly name: string;
  readonly profile: string;
  readonly lineCount: number;
  readonly hours: RosterHours;
  readonly lines: readonly LineLoad[];
  readonly totals: {
    readonly duties: number;
    readonly early: number;
    readonly late: number;
    readonly night: number;
    readonly shunting: number;
    readonly weekendDuties: number;
    readonly weekendMinutes: number;
    readonly reserveDays: number;
  };
  readonly nights: NightQuality;
  readonly transitions: TransitionQuality;
  readonly rest: RestQuality;
  /** Dienstdagen zonder dienst die er wél een hoort te hebben. */
  readonly unresolvedDutyDays: number;
}

// ── De cyclus ────────────────────────────────────────────────────────────────

export function dutyKey(code: string, weekday: number): string {
  return `${code}|${weekday}`;
}

export function categoryOf(duty: QualityDuty): TransitionCategory | null {
  if (duty.kinds.includes("NACHT")) {
    return "NIGHT";
  }
  if (duty.kinds.includes("LAAT")) {
    return "LATE";
  }
  if (duty.kinds.includes("VROEG")) {
    return "EARLY";
  }
  return null;
}

/** De dagen van een basisrooster in de volgorde waarin een medewerker ze rijdt. */
export function rotationCycle(
  roster: QualityRosterInput,
  duties: ReadonlyMap<string, QualityDuty>,
): readonly CycleSlot[] {
  const gesorteerd = [...roster.days].sort(
    (a, b) => a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday,
  );
  return gesorteerd.map((dag, index) => {
    const duty =
      dag.positionType === "DUTY" && dag.dutyCode
        ? (duties.get(dutyKey(dag.dutyCode, dag.weekday)) ?? null)
        : null;
    return {
      index,
      lineNumber: dag.lineNumber,
      weekIndex: dag.weekIndex,
      weekday: dag.weekday,
      positionType: dag.positionType,
      duty,
      category: duty ? categoryOf(duty) : null,
    };
  });
}

// ── Meten ────────────────────────────────────────────────────────────────────

export function measureRoster(
  roster: QualityRosterInput,
  duties: ReadonlyMap<string, QualityDuty>,
): RosterQuality {
  const cycle = rotationCycle(roster, duties);
  const regels = [...new Set(cycle.map((slot) => slot.lineNumber))].sort((a, b) => a - b);

  const uren = rosterHours({
    days: cycle.map<HoursCycleDay>((slot) => ({
      positionType: slot.positionType as HoursCycleDay["positionType"],
      startMinute: slot.duty?.startMinute ?? null,
      endMinute: slot.duty?.endMinute ?? null,
    })),
    lineCount: regels.length,
    weeksPerLine: roster.weeksPerLine,
  });

  const lines: LineLoad[] = regels.map((regel) => {
    const dagen = cycle.filter((slot) => slot.lineNumber === regel);
    return lineLoadOf(regel, dagen);
  });

  const totals = {
    duties: sum(lines, (line) => line.duties),
    early: sum(lines, (line) => line.early),
    late: sum(lines, (line) => line.late),
    night: sum(lines, (line) => line.night),
    shunting: sum(lines, (line) => line.shunting),
    weekendDuties: sum(lines, (line) => line.weekendDuties),
    weekendMinutes: sum(lines, (line) => line.weekendMinutes),
    reserveDays: cycle.filter((slot) => slot.positionType === "RES").length,
  };

  return {
    code: roster.code,
    name: roster.name,
    profile: roster.profile,
    lineCount: regels.length,
    hours: uren,
    lines,
    totals,
    nights: nightQualityOf(cycle, regels),
    transitions: transitionQualityOf(cycle),
    rest: restQualityOf(cycle),
    unresolvedDutyDays: cycle.filter((slot) => slot.positionType === "DUTY" && slot.duty === null)
      .length,
  };
}

function lineLoadOf(lineNumber: number, dagen: readonly CycleSlot[]): LineLoad {
  let creditMinutes = 0;
  let duties = 0;
  let early = 0;
  let late = 0;
  let night = 0;
  let shunting = 0;
  let weekendDuties = 0;
  let weekendMinutes = 0;
  for (const slot of dagen) {
    if (slot.duty) {
      const duur = slot.duty.endMinute - slot.duty.startMinute;
      creditMinutes += duur;
      duties += 1;
      if (slot.category === "EARLY") early += 1;
      if (slot.category === "LATE") late += 1;
      if (slot.category === "NIGHT") night += 1;
      if (slot.duty.kinds.includes("RANGEER")) shunting += 1;
      if (slot.weekday >= 6) {
        weekendDuties += 1;
        weekendMinutes += duur;
      }
    } else if (["RES", "WR", "CO"].includes(slot.positionType)) {
      creditMinutes += 8 * 60;
    }
  }
  return { lineNumber, creditMinutes, duties, early, late, night, shunting, weekendDuties, weekendMinutes };
}

function nightQualityOf(cycle: readonly CycleSlot[], regels: readonly number[]): NightQuality {
  const n = cycle.length;
  const isNacht = (index: number) => cycle[((index % n) + n) % n].category === "NIGHT";
  const total = cycle.filter((slot) => slot.category === "NIGHT").length;
  const perLine = regels.map(
    (regel) => cycle.filter((slot) => slot.lineNumber === regel && slot.category === "NIGHT").length,
  );
  const weekendNights = cycle.filter((slot) => slot.category === "NIGHT" && slot.weekday >= 6).length;

  const blocks: NightBlock[] = [];
  if (total === n && n > 0) {
    blocks.push({ startIndex: 0, length: n, startLine: cycle[0].lineNumber, startWeekday: cycle[0].weekday });
  } else if (total > 0) {
    for (let i = 0; i < n; i += 1) {
      // Een reeks begint waar een nacht niet door een nacht wordt voorafgegaan,
      // de cyclusgrens meegerekend.
      if (!isNacht(i) || isNacht(i - 1)) {
        continue;
      }
      let lengte = 0;
      while (lengte < n && isNacht(i + lengte)) {
        lengte += 1;
      }
      blocks.push({
        startIndex: i,
        length: lengte,
        startLine: cycle[i].lineNumber,
        startWeekday: cycle[i].weekday,
      });
    }
  }

  const singletons = blocks.filter((block) => block.length === 1).length;
  const pairs = blocks.filter((block) => block.length === 2).length;
  const threeOrMore = blocks.filter((block) => block.length >= PREFERRED_NIGHT_BLOCK_LENGTH).length;
  const inClusters = blocks
    .filter((block) => block.length >= PREFERRED_NIGHT_BLOCK_LENGTH)
    .reduce((som, block) => som + block.length, 0);

  return {
    total,
    blocks,
    singletons,
    pairs,
    threeOrMore,
    longest: blocks.reduce((max, block) => Math.max(max, block.length), 0),
    averageLength: blocks.length > 0 ? total / blocks.length : null,
    weekendNights,
    perLine,
    clusteredShare: total > 0 ? inClusters / total : null,
  };
}

function transitionQualityOf(cycle: readonly CycleSlot[]): TransitionQuality {
  const n = cycle.length;
  const findings: TransitionFinding[] = [];
  let adjacentPairs = 0;
  let stablePairs = 0;
  let penaltyTotal = 0;

  for (let i = 0; i < n; i += 1) {
    const huidig = cycle[i];
    if (!huidig.duty || !huidig.category) {
      continue;
    }
    const volgend = cycle[(i + 1) % n];
    if (volgend.duty && volgend.category) {
      adjacentPairs += 1;
      const straf = ADJACENT_TRANSITION_PENALTY[huidig.category][volgend.category];
      if (straf === 0) {
        stablePairs += 1;
      } else {
        penaltyTotal += straf;
        findings.push(bevinding(huidig, volgend, straf, false));
      }
      continue;
    }
    // Over precies één vrije dag heen.
    const daarna = cycle[(i + 2) % n];
    if (
      n > 2 &&
      OFF_POSITION_TYPES.includes(volgend.positionType) &&
      daarna.duty &&
      daarna.category
    ) {
      const straf = OVER_ONE_OFF_DAY_PENALTY[huidig.category][daarna.category];
      if (straf > 0) {
        penaltyTotal += straf;
        findings.push(bevinding(huidig, daarna, straf, true));
      }
    }
  }

  return {
    adjacentPairs,
    stablePairs,
    penaltyTotal,
    heavy: findings.filter((finding) => finding.penalty >= HEAVY_TRANSITION_PENALTY),
    findings,
    stableShare: adjacentPairs > 0 ? stablePairs / adjacentPairs : null,
  };
}

function bevinding(van: CycleSlot, naar: CycleSlot, straf: number, overOffDay: boolean): TransitionFinding {
  return {
    lineNumber: van.lineNumber,
    weekday: van.weekday,
    fromCode: van.duty!.code,
    toCode: naar.duty!.code,
    from: van.category!,
    to: naar.category!,
    overOffDay,
    penalty: straf,
  };
}

function restQualityOf(cycle: readonly CycleSlot[]): RestQuality {
  const n = cycle.length;
  let nextDayIntervals = 0;
  let comfortable = 0;
  let tight = 0;
  let belowTight = 0;
  let shortest: number | null = null;

  const metDienst = cycle.filter((slot) => slot.duty !== null);
  for (let p = 0; p < metDienst.length; p += 1) {
    const huidig = metDienst[p];
    const volgend = metDienst[(p + 1) % metDienst.length];
    if (metDienst.length < 2 && p > 0) break;
    let dagen = volgend.index - huidig.index;
    if (dagen <= 0) dagen += n;
    if (dagen !== 1) continue;
    const rust = 1440 + volgend.duty!.startMinute - huidig.duty!.endMinute;
    nextDayIntervals += 1;
    shortest = shortest === null ? rust : Math.min(shortest, rust);
    if (rust >= COMFORTABLE_REST_MINUTES) comfortable += 1;
    else if (rust >= TIGHT_REST_MINUTES) tight += 1;
    else belowTight += 1;
  }

  // Herstel na een nachtreeks: van het einde van de laatste nacht tot het
  // begin van de volgende dienst, hoe ver die ook weg ligt.
  const recovery: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const slot = cycle[i];
    if (slot.category !== "NIGHT" || cycle[(i + 1) % n].category === "NIGHT") {
      continue;
    }
    for (let stap = 1; stap < n; stap += 1) {
      const volgend = cycle[(i + stap) % n];
      if (volgend.duty) {
        recovery.push(stap * 1440 + volgend.duty.startMinute - slot.duty!.endMinute);
        break;
      }
    }
  }

  return {
    nextDayIntervals,
    comfortable,
    tight,
    belowTight,
    shortestMinutes: shortest,
    recoveryAfterNightBlocks: recovery,
  };
}

// ── Een pakket: alle basisroosters samen ─────────────────────────────────────

export interface Subscore {
  readonly key: SubscoreKey;
  readonly label: string;
  /** 0–100, of null wanneer de maat hier niet van toepassing is. */
  readonly score: number | null;
  readonly explanation: string;
}

export type SubscoreKey =
  | "coverage"
  | "hoursBalance"
  | "restQuality"
  | "transitionQuality"
  | "nightClustering"
  | "nightFairness"
  | "shuntingFairness"
  | "weekendFairness"
  | "changeImpact";

export interface PackageQuality {
  readonly rosters: readonly RosterQuality[];
  readonly coverage: { readonly placed: number; readonly required: number };
  readonly subscores: readonly Subscore[];
  readonly hours: {
    readonly maxAbsDeviationMinutes: number;
    readonly averageAbsDeviationMinutes: number;
  };
  readonly nights: {
    readonly total: number;
    readonly singletons: number;
    readonly pairs: number;
    readonly threeOrMore: number;
    readonly blocks: number;
  };
  readonly transitions: { readonly heavy: number; readonly penaltyTotal: number };
  /** Dienstdagen met een ander dienstnummer dan in de referentie. */
  readonly changedDutyDays: number | null;
}

export interface PackageQualityOptions {
  /** Het aantal diensten dat geplaatst moet worden (het dienstenpakket). */
  readonly requiredDuties: number;
  /**
   * De roosters waar nachten horen: profiel staat nacht toe én het huidige
   * rooster heeft er nachten. Alleen tussen deze roosters wordt de
   * nachtbelasting vergeleken.
   */
  readonly nightRosterCodes: readonly string[];
  /** Het huidige rooster, om de wijzigingsimpact tegen af te zetten. */
  readonly reference?: readonly QualityRosterInput[];
}

export function measurePackage(
  rosters: readonly QualityRosterInput[],
  duties: ReadonlyMap<string, QualityDuty>,
  options: PackageQualityOptions,
): PackageQuality {
  const gemeten = rosters.map((roster) => measureRoster(roster, duties));
  const placed = sum(gemeten, (roster) => roster.totals.duties);

  const afwijkingen = gemeten.map((roster) => Math.abs(roster.hours.deviationFromTargetMinutes));
  const nachtRoosters = gemeten.filter((roster) => options.nightRosterCodes.includes(roster.code));
  const nachten = sum(nachtRoosters, (roster) => roster.nights.total);
  const geclusterd = sum(nachtRoosters, (roster) =>
    roster.nights.blocks
      .filter((block) => block.length >= PREFERRED_NIGHT_BLOCK_LENGTH)
      .reduce((som, block) => som + block.length, 0),
  );
  const paren = sum(gemeten, (roster) => roster.transitions.adjacentPairs);
  const stabiel = sum(gemeten, (roster) => roster.transitions.stablePairs);
  const rustTotaal = sum(gemeten, (roster) => roster.rest.nextDayIntervals);
  const rustScore = sum(gemeten, (roster) => roster.rest.comfortable + roster.rest.tight * 0.5);

  const changed = options.reference ? changedDutyDays(rosters, options.reference) : null;
  const dienstdagen = sum(
    rosters,
    (roster) => roster.days.filter((day) => day.positionType === "DUTY").length,
  );

  const subscores: Subscore[] = [
    {
      key: "coverage",
      label: "Dekking",
      score: options.requiredDuties > 0 ? pct(placed / options.requiredDuties) : null,
      explanation: `${placed} van de ${options.requiredDuties} diensten staan in een vast rooster.`,
    },
    {
      key: "hoursBalance",
      label: "Urenbalans",
      score:
        gemeten.length > 0
          ? round1(
              gemeten.reduce(
                (som, roster) =>
                  som +
                  Math.max(
                    0,
                    100 -
                      (Math.abs(roster.hours.deviationFromTargetMinutes) * 100) /
                        HOURS_SCORE_ZERO_AT_MINUTES,
                  ),
                0,
              ) / gemeten.length,
            )
          : null,
      explanation:
        `Per basisrooster de gemiddelde weekomvang tegen 40:00: precies 40:00 is 100, ` +
        `${HOURS_SCORE_ZERO_AT_MINUTES} minuten of meer afwijking is 0. Het gemiddelde over ` +
        "alle roosters.",
    },
    {
      key: "restQuality",
      label: "Rustkwaliteit",
      score: rustTotaal > 0 ? pct(rustScore / rustTotaal) : null,
      explanation:
        `Rust tussen diensten op opeenvolgende dagen: ${fmt(COMFORTABLE_REST_MINUTES)} of meer ` +
        `telt volledig, ${fmt(TIGHT_REST_MINUTES)} tot ${fmt(COMFORTABLE_REST_MINUTES)} half, ` +
        "minder telt niet. De wettelijke minimumrust wordt apart hard getoetst.",
    },
    {
      key: "transitionQuality",
      label: "Overgangskwaliteit",
      score: paren > 0 ? pct(stabiel / paren) : null,
      explanation:
        "Het deel van de overgangen tussen dienstdagen dat in hetzelfde dagdeel blijft. Met " +
        "de klok mee (vroeg → laat → nacht) kost weinig, terug (nacht → vroeg) veel.",
    },
    {
      key: "nightClustering",
      label: "Nachtclustering",
      score: nachten > 0 ? pct(geclusterd / nachten) : null,
      explanation:
        `Het deel van de nachtdiensten dat in een reeks van ${PREFERRED_NIGHT_BLOCK_LENGTH} of ` +
        "meer nachten achter elkaar staat, in de volgorde waarin een medewerker het rooster rijdt.",
    },
    {
      key: "nightFairness",
      label: "Eerlijke nachtverdeling",
      score: eerlijkheid(nachtRoosters.map((roster) => roster.nights.total / roster.lineCount)),
      explanation:
        "Nachten per regel, vergeleken tussen de roosters waar nachten horen. 100 is overal " +
        "evenveel per week; lager naarmate de spreiding t.o.v. het gemiddelde groter is.",
    },
    {
      key: "shuntingFairness",
      label: "Eerlijke rangeerverdeling",
      score: eerlijkheid(
        gemeten.map((roster) => roster.totals.shunting / roster.lineCount),
      ),
      explanation:
        "Rangeerdiensten per regel, vergeleken tussen alle basisroosters. Genormaliseerd op " +
        "het aantal regels, zodat een rooster van zes weken niet oneerlijk lijkt naast een van twaalf.",
    },
    {
      key: "weekendFairness",
      label: "Eerlijke weekendbelasting",
      score: eerlijkheid(gemeten.map((roster) => roster.totals.weekendMinutes / roster.lineCount)),
      explanation:
        "Gewerkte weekenduren per regel, vergeleken tussen alle basisroosters. Welke dagen " +
        "dienstdagen zijn ligt vast in de structuur; welke diensten erop vallen niet.",
    },
    {
      key: "changeImpact",
      label: "Wijzigingsimpact",
      score: changed !== null && dienstdagen > 0 ? pct(1 - changed / dienstdagen) : null,
      explanation:
        "Het deel van de dienstdagen dat hetzelfde dienstnummer houdt als in het huidige " +
        "rooster. 100 is geen enkele wijziging.",
    },
  ];

  return {
    rosters: gemeten,
    coverage: { placed, required: options.requiredDuties },
    subscores,
    hours: {
      maxAbsDeviationMinutes: afwijkingen.length > 0 ? Math.max(...afwijkingen) : 0,
      averageAbsDeviationMinutes:
        afwijkingen.length > 0 ? Math.round(afwijkingen.reduce((a, b) => a + b, 0) / afwijkingen.length) : 0,
    },
    nights: {
      total: nachten,
      singletons: sum(nachtRoosters, (roster) => roster.nights.singletons),
      pairs: sum(nachtRoosters, (roster) => roster.nights.pairs),
      threeOrMore: sum(nachtRoosters, (roster) => roster.nights.threeOrMore),
      blocks: sum(nachtRoosters, (roster) => roster.nights.blocks.length),
    },
    transitions: {
      heavy: sum(gemeten, (roster) => roster.transitions.heavy.length),
      penaltyTotal: sum(gemeten, (roster) => roster.transitions.penaltyTotal),
    },
    changedDutyDays: changed,
  };
}

/** Welke roosters nachten horen te dragen: profiel staat het toe én ze hebben er nu. */
export function nightRosterCodesOf(
  reference: readonly QualityRosterInput[],
  duties: ReadonlyMap<string, QualityDuty>,
  profileAllowsNight: (profile: string) => boolean,
): readonly string[] {
  return reference
    .filter((roster) => profileAllowsNight(roster.profile))
    .filter((roster) =>
      roster.days.some((day) => {
        const duty = day.dutyCode ? duties.get(dutyKey(day.dutyCode, day.weekday)) : undefined;
        return duty?.kinds.includes("NACHT") ?? false;
      }),
    )
    .map((roster) => roster.code);
}

function changedDutyDays(
  rosters: readonly QualityRosterInput[],
  reference: readonly QualityRosterInput[],
): number {
  const referentie = new Map<string, string | null>();
  for (const roster of reference) {
    for (const day of roster.days) {
      if (day.positionType === "DUTY") {
        referentie.set(`${roster.code}|${day.lineNumber}|${day.weekIndex}|${day.weekday}`, day.dutyCode);
      }
    }
  }
  let changed = 0;
  for (const roster of rosters) {
    for (const day of roster.days) {
      if (day.positionType !== "DUTY") continue;
      const was = referentie.get(`${roster.code}|${day.lineNumber}|${day.weekIndex}|${day.weekday}`);
      if (was !== undefined && was !== day.dutyCode) changed += 1;
    }
  }
  return changed;
}

/**
 * Hoe gelijk een belasting is verdeeld, als 0–100.
 *
 * 100 min de variatiecoëfficiënt (standaardafwijking gedeeld door het
 * gemiddelde) in procenten. Een rooster dat nergens iets van deze belasting
 * draagt en ook geen gemiddelde heeft, telt als gelijk.
 */
function eerlijkheid(waarden: readonly number[]): number | null {
  if (waarden.length < 2) {
    return null;
  }
  const gemiddelde = waarden.reduce((a, b) => a + b, 0) / waarden.length;
  if (gemiddelde === 0) {
    return 100;
  }
  const variantie = waarden.reduce((som, waarde) => som + (waarde - gemiddelde) ** 2, 0) / waarden.length;
  return round1(Math.max(0, 100 - (Math.sqrt(variantie) / gemiddelde) * 100));
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((som, item) => som + pick(item), 0);
}

function pct(fraction: number): number {
  return round1(Math.max(0, Math.min(1, fraction)) * 100);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function fmt(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
