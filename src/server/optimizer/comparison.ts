import type { CandidateAssignment } from "@/domain/candidate";
import { formatSpan } from "@/domain/amsterdam-time";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import type { AggregatedFeedback, OptimizerDuty, OptimizerLine } from "./contract";
import {
  type LineMetrics,
  type Spread,
  dutyKeyOf,
  linesFromAssignments,
  measureLine,
  round,
  spreadOf,
} from "./metrics";
import { type ScoredRoster, scoreRoster } from "./scoring";

/**
 * Huidig rooster naast een kandidaat.
 *
 * ## Waarom per profiel én in totaal
 *
 * Een kandidaat kan het totaal verbeteren door één profiel te ontzien en een
 * ander te belasten. Dat is precies de verschuiving die een planner wil zien en
 * die in een totaalcijfer verdwijnt. Beide niveaus staan er daarom naast elkaar.
 *
 * ## Waarom hier geen oordeel staat
 *
 * Dit bestand vergelijkt en rangschikt niet. Rangschikken gebeurt in
 * `ranking.ts`, waar de uitkomst van de onafhankelijke validatie meedoet — want
 * een kwaliteitsverschil zegt niets zolang niet vaststaat of beide voorstellen
 * überhaupt mogen.
 */

export interface RosterFigures {
  readonly lines: number;
  readonly duties: number;
  readonly early: number;
  readonly late: number;
  readonly night: number;
  readonly hardNight: number;
  readonly shunting: number;
  readonly nightShunting: number;
  readonly weekendDuties: number;
  readonly longDuties: number;
  readonly reserveDays: number;
  readonly wtvDays: number;
  readonly compensationDays: number;
  readonly averageRestMinutes: number | null;
  readonly minimumRestMinutes: number | null;
  readonly restDistribution: LineMetrics["restDistribution"];
  readonly nightRecoveryMinimum: number | null;
  readonly spreads: readonly Spread[];
}

export interface SideBySide {
  readonly label: string;
  readonly current: RosterFigures;
  readonly candidate: RosterFigures;
}

export interface FairnessImprovement {
  readonly label: string;
  readonly currentRangePercentage: number;
  readonly candidateRangePercentage: number;
  /** Positief betekent gelijkmatiger geworden. */
  readonly improvementPercentage: number;
  readonly sentence: string;
}

export interface RosterComparison {
  readonly perBaseRoster: readonly SideBySide[];
  readonly total: SideBySide;
  readonly currentScore: ScoredRoster;
  readonly candidateScore: ScoredRoster;
  readonly fairness: readonly FairnessImprovement[];
  readonly changes: readonly ChangeExplanation[];
}

export interface ChangeExplanation {
  readonly headline: string;
  readonly reasons: readonly string[];
}

export function compareRosters(input: {
  readonly currentLines: readonly OptimizerLine[];
  readonly candidateAssignments: readonly CandidateAssignment[];
  readonly duties: ReadonlyMap<string, OptimizerDuty>;
  readonly feedback: readonly AggregatedFeedback[];
}): RosterComparison {
  const candidateLines = linesFromAssignments(input.candidateAssignments, input.currentLines);

  const currentMetrics = input.currentLines.map((line) => measureLine(line, input.duties));
  const candidateMetrics = candidateLines.map((line) => measureLine(line, input.duties));

  const currentScore = scoreRoster(input.currentLines, input.duties, input.feedback, null);
  const candidateScore = scoreRoster(
    candidateLines,
    input.duties,
    input.feedback,
    currentMetrics,
  );

  const codes = [...new Set(input.currentLines.map((line) => line.baseRosterCode))].sort();
  const perBaseRoster = codes.map((code) => ({
    label: labelFor(code, input.currentLines),
    current: figuresOf(currentMetrics.filter((line) => line.baseRosterCode === code)),
    candidate: figuresOf(candidateMetrics.filter((line) => line.baseRosterCode === code)),
  }));

  return {
    perBaseRoster,
    total: {
      label: "Dordrecht, alle profielen",
      current: figuresOf(currentMetrics),
      candidate: figuresOf(candidateMetrics),
    },
    currentScore,
    candidateScore,
    fairness: fairnessImprovements(currentScore.spreads, candidateScore.spreads),
    changes: explainChanges(input.currentLines, input.candidateAssignments, input.duties, {
      currentSpreads: currentScore.spreads,
      candidateSpreads: candidateScore.spreads,
      currentRest: currentScore.breakdown.restQuality,
      candidateRest: candidateScore.breakdown.restQuality,
    }),
  };
}

function labelFor(code: string, lines: readonly OptimizerLine[]): string {
  const profile = lines.find((line) => line.baseRosterCode === code)?.profile;
  return profile ? `${code} — ${rosterProfileLabel(profile)}` : code;
}

function figuresOf(metrics: readonly LineMetrics[]): RosterFigures {
  const sum = (pick: (line: LineMetrics) => number): number =>
    metrics.reduce((total, line) => total + pick(line), 0);

  const averages = metrics
    .map((line) => line.averageRestMinutes)
    .filter((value): value is number => value !== null);
  const minima = metrics
    .map((line) => line.minimumRestMinutes)
    .filter((value): value is number => value !== null);
  const nightRecovery = metrics.flatMap((line) => line.nightRecoveryMinutes);

  return {
    lines: metrics.length,
    duties: sum((line) => line.duties),
    early: sum((line) => line.early),
    late: sum((line) => line.late),
    night: sum((line) => line.night),
    hardNight: sum((line) => line.hardNight),
    shunting: sum((line) => line.shunting),
    nightShunting: sum((line) => line.nightShunting),
    weekendDuties: sum((line) => line.weekendDuties),
    longDuties: sum((line) => line.longDuties),
    reserveDays: sum((line) => line.reserveDays),
    wtvDays: sum((line) => line.wtvDays),
    compensationDays: sum((line) => line.compensationDays),
    averageRestMinutes:
      averages.length === 0
        ? null
        : Math.round(averages.reduce((total, value) => total + value, 0) / averages.length),
    minimumRestMinutes: minima.length === 0 ? null : Math.min(...minima),
    restDistribution: metrics.reduce(
      (total, line) => ({
        under12h: total.under12h + line.restDistribution.under12h,
        from12to14h: total.from12to14h + line.restDistribution.from12to14h,
        from14to16h: total.from14to16h + line.restDistribution.from14to16h,
        from16to24h: total.from16to24h + line.restDistribution.from16to24h,
        over24h: total.over24h + line.restDistribution.over24h,
      }),
      { under12h: 0, from12to14h: 0, from14to16h: 0, from16to24h: 0, over24h: 0 },
    ),
    nightRecoveryMinimum: nightRecovery.length === 0 ? null : Math.min(...nightRecovery),
    spreads: [
      spreadOf("Weekendbelasting", metrics.map((line) => line.weekendDuties)),
      spreadOf("Nachtdiensten", metrics.map((line) => line.night)),
      spreadOf("Vroege diensten", metrics.map((line) => line.early)),
      spreadOf("Late diensten", metrics.map((line) => line.late)),
      spreadOf("Rangeerdiensten", metrics.map((line) => line.shunting)),
      spreadOf("Reservedagen", metrics.map((line) => line.reserveDays)),
    ],
  };
}

/**
 * Eerlijkheid in een zin die een planner kan navertellen.
 *
 * Niet "fairness index 0,82" maar "het verschil tussen de zwaarste en de
 * lichtste lijn daalt van 18% naar 9%". Wie de uitkomst betwist, moet hem kunnen
 * narekenen met de getallen die er zelf naast staan.
 */
export function fairnessImprovements(
  current: readonly Spread[],
  candidate: readonly Spread[],
): readonly FairnessImprovement[] {
  return current.map((entry, index) => {
    const proposed = candidate[index];
    const improvement =
      entry.rangePercentage === 0
        ? 0
        : round(((entry.rangePercentage - proposed.rangePercentage) / entry.rangePercentage) * 100, 0);

    return {
      label: entry.label,
      currentRangePercentage: entry.rangePercentage,
      candidateRangePercentage: proposed.rangePercentage,
      improvementPercentage: improvement,
      sentence:
        `${entry.label}: verschil zwaarste/lichtste rooster ` +
        `${entry.rangePercentage}% → ${proposed.rangePercentage}%` +
        (improvement === 0
          ? " (ongewijzigd)"
          : improvement > 0
            ? ` (${improvement}% gelijkmatiger)`
            : ` (${Math.abs(improvement)}% schever)`),
    };
  });
}

/**
 * Wat er is veranderd, in bedrijfstaal.
 *
 * Geen solverinternals — die zijn voor een planner niet te controleren en
 * wekken bovendien de indruk dat het systeem het beter weet. Wel: welke dienst
 * van welke lijn naar welke ging, dat beide profielen die dienst toestaan, en
 * wat het met de verdeling en de rustkwaliteit deed.
 */
export function explainChanges(
  currentLines: readonly OptimizerLine[],
  candidateAssignments: readonly CandidateAssignment[],
  duties: ReadonlyMap<string, OptimizerDuty>,
  effects: {
    readonly currentSpreads: readonly Spread[];
    readonly candidateSpreads: readonly Spread[];
    readonly currentRest: number;
    readonly candidateRest: number;
  },
): readonly ChangeExplanation[] {
  const before = new Map<string, string | null>();
  for (const line of currentLines) {
    for (const day of line.days) {
      before.set(
        `${line.baseRosterCode}|${line.lineNumber}|${day.weekIndex}|${day.weekday}`,
        day.dutyCode,
      );
    }
  }

  const moves = candidateAssignments.filter((entry) => {
    const key = `${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|${entry.weekday}`;
    return before.has(key) && before.get(key) !== entry.dutyCode;
  });

  if (moves.length === 0) {
    return [
      {
        headline: "Geen wijzigingen ten opzichte van het huidige rooster.",
        reasons: [
          "Dit scenario reproduceert het bestaande rooster. Het dient als nulmeting: " +
            "wat de validator hierover zegt, geldt ook voor het rooster dat nu draait.",
        ],
      },
    ];
  }

  const shunting = findSpread(effects.currentSpreads, effects.candidateSpreads, "Rangeerdiensten");
  const byDuty = new Map<string, number>();
  // De weekdag van de eerste verplaatsing per dienstnummer, om de dienstsoort
  // bij het juiste exemplaar te kunnen opzoeken. De opsomming zelf telt per
  // nummer — "dienst 101 is zes keer verplaatst" leest beter dan zes regels —
  // maar een nummer alleen wijst geen dienst aan, dus de kenmerken komen van de
  // dienst die hier werkelijk is verschoven.
  const weekdagVan = new Map<string, number>();
  for (const move of moves) {
    const code = move.dutyCode ?? "leeg";
    byDuty.set(code, (byDuty.get(code) ?? 0) + 1);
    if (!weekdagVan.has(code)) {
      weekdagVan.set(code, move.weekday);
    }
  }

  const notable = [...byDuty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return notable.map(([code, count]) => {
    const weekdag = weekdagVan.get(code);
    const duty = weekdag === undefined ? undefined : duties.get(dutyKeyOf(code, weekdag));
    const reasons: string[] = [];

    if (duty) {
      reasons.push(
        `Dienst ${code} (${duty.kinds.join(", ").toLowerCase()}) is op ${count} cyclusdagen ` +
          "naar een andere lijn verplaatst.",
      );
      reasons.push(
        "Beide betrokken roosterprofielen staan deze dienstsoort toe; dat is met dezelfde " +
          "profielfunctie gecontroleerd die de rules engine gebruikt.",
      );
    } else {
      reasons.push(`Op ${count} cyclusdagen is de dienst van deze lijn gehaald.`);
    }

    if (shunting) {
      reasons.push(
        `Rangeerbelasting: verschil zwaarste/lichtste rooster ${shunting.before}% → ` +
          `${shunting.after}%.`,
      );
    }
    reasons.push(
      `Rustkwaliteit: ${effects.currentRest} → ${effects.candidateRest} punten` +
        (effects.currentRest === effects.candidateRest ? " (gelijk)" : "") +
        ".",
    );
    reasons.push(
      "Of deze verplaatsing rechtmatig is, staat hier niet: dat stelt de onafhankelijke " +
        "eindvalidatie vast.",
    );

    return { headline: `Dienst ${code} verplaatst (${count}×)`, reasons };
  });
}

function findSpread(
  current: readonly Spread[],
  candidate: readonly Spread[],
  label: string,
): { before: number; after: number } | null {
  const index = current.findIndex((entry) => entry.label === label);
  if (index < 0) {
    return null;
  }
  return {
    before: current[index].rangePercentage,
    after: candidate[index].rangePercentage,
  };
}

/** Rusttijd voor de interface, met de eenheid erbij. */
export function formatRest(minutes: number | null): string {
  return minutes === null ? "—" : formatSpan(minutes);
}
