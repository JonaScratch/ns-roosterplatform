/**
 * De gewichten van de zachte doelen, per strategie.
 *
 * ## Waarom hier en nergens anders
 *
 * De solver bevat geen enkel gewicht; hij krijgt ze van hier. Een strategie is
 * daarmee niets anders dan een regel in deze tabel, en wie wil weten waarom
 * "Rust & regelmaat" iets anders oplevert dan "Optimale totaalbalans", leest het
 * verschil op één plek af.
 *
 * ## Wat de eenheden zijn
 *
 * Strafpunten, relatief ten opzichte van elkaar. Eén losse nacht kost
 * `nightSingleton` punten; één minuut weekafwijking van 40:00 in een rooster kost
 * `hoursBalance`; één overgangspunt uit de overgangstabel kost `transitions`.
 * Absolute grootte zegt niets — alleen de verhouding.
 *
 * ## Wat hier níet in staat
 *
 * Dekking, profielgrenzen, minimale rust en aaneengesloten diensten. Die zijn
 * hard en hebben geen gewicht: ze kunnen door geen enkele combinatie van de
 * getallen hieronder worden afgekocht.
 */

export interface ObjectiveWeights {
  /** Per minuut weekafwijking van 40:00, per basisrooster. */
  readonly hoursBalance: number;
  /** Per minuut weekafwijking van het slechtste basisrooster. */
  readonly hoursWorst: number;
  /** Per minuut rust onder de comfortabele rust, tussen opeenvolgende dagen. */
  readonly restComfort: number;
  /** Per punt uit de overgangstabel. */
  readonly transitions: number;
  /** Per losse nacht (een nacht zonder nacht ervoor of erna). */
  readonly nightSingleton: number;
  /** Per reeks van precies twee nachten. */
  readonly nightPair: number;
  /** Per nacht in een rooster dat nu geen nachten heeft. */
  readonly nightOutsideReference: number;
  /** Per eenheid spreiding van nachten per regel tussen nachtroosters. */
  readonly nightFairness: number;
  /** Per eenheid spreiding van rangeerdiensten per regel tussen roosters. */
  readonly shuntingFairness: number;
  /** Per eenheid spreiding van weekendkwartieren per regel tussen roosters. */
  readonly weekendFairness: number;
  /** Per dienstdag die afwijkt van het huidige rooster. */
  readonly preserveReference: number;
  /** Per dienstdag die afwijkt van de kandidaat die wordt verbeterd. */
  readonly preserveHint: number;
}

/** De evenwichtige basis waar de andere strategieën van afwijken. */
export const BALANCED_WEIGHTS: ObjectiveWeights = {
  hoursBalance: 15,
  hoursWorst: 40,
  restComfort: 1,
  transitions: 40,
  nightSingleton: 900,
  nightPair: 300,
  nightOutsideReference: 400,
  nightFairness: 12,
  shuntingFairness: 6,
  weekendFairness: 1,
  // Een tiebreaker, geen doel: waar twee keuzes even goed zijn, blijft het
  // huidige dienstnummer staan. Dat maakt het verschil met het huidige rooster
  // kleiner zonder dat er kwaliteit voor wordt ingeleverd.
  preserveReference: 1,
  preserveHint: 0,
};

export type SolverStrategyKey =
  | "BALANCED"
  | "REST_QUALITY"
  | "FAIR_BURDEN"
  | "MINIMAL_CHANGE"
  | "COVERAGE";

export const STRATEGY_WEIGHTS: Readonly<Record<SolverStrategyKey, ObjectiveWeights>> = {
  BALANCED: BALANCED_WEIGHTS,
  REST_QUALITY: {
    ...BALANCED_WEIGHTS,
    hoursBalance: 10,
    hoursWorst: 25,
    restComfort: 3,
    transitions: 100,
    nightSingleton: 1100,
    nightPair: 400,
  },
  FAIR_BURDEN: {
    ...BALANCED_WEIGHTS,
    transitions: 25,
    nightFairness: 60,
    shuntingFairness: 35,
    weekendFairness: 5,
  },
  MINIMAL_CHANGE: {
    ...BALANCED_WEIGHTS,
    transitions: 20,
    nightSingleton: 400,
    nightPair: 140,
    preserveReference: 120,
  },
  // Sinds dekking een harde eis is, plaatst elke strategie alle diensten. Deze
  // variant bestaat nog voor bestaande kandidaten en valt terug op de basis.
  COVERAGE: BALANCED_WEIGHTS,
};

/**
 * Waar een herbouw op kan sturen, en welk gewicht dat versterkt.
 *
 * Een keuze van de Roostercommissie vermenigvuldigt het bijbehorende gewicht.
 * Het blijft een kostenpost: een herbouw "met betere nachtclustering" mag nog
 * steeds geen harde grens raken.
 */
export type RebuildGoal =
  | "HOURS"
  | "REST"
  | "TRANSITIONS"
  | "NIGHT_CLUSTERING"
  | "NIGHT_FAIRNESS"
  | "SHUNTING_FAIRNESS"
  | "WEEKEND_FAIRNESS"
  | "LESS_CHANGE"
  | "KEEP_GOOD_PARTS";

export const REBUILD_GOAL_LABELS: Readonly<Record<RebuildGoal, string>> = {
  HOURS: "Uren dichter bij 40:00",
  REST: "Meer rust tussen diensten",
  TRANSITIONS: "Minder vreemde overgangen",
  NIGHT_CLUSTERING: "Nachten beter clusteren",
  NIGHT_FAIRNESS: "Nachten eerlijker verdelen",
  SHUNTING_FAIRNESS: "Rangeerdiensten eerlijker verdelen",
  WEEKEND_FAIRNESS: "Weekendbelasting eerlijker verdelen",
  LESS_CHANGE: "Minder verandering t.o.v. huidig rooster",
  KEEP_GOOD_PARTS: "Goede delen zoveel mogelijk behouden",
};

const VERSTERKING = 4;

export function weightsForRebuild(
  basis: ObjectiveWeights,
  goals: readonly RebuildGoal[],
): ObjectiveWeights {
  const w: { -readonly [K in keyof ObjectiveWeights]: number } = { ...basis };
  for (const goal of goals) {
    switch (goal) {
      case "HOURS":
        w.hoursBalance *= VERSTERKING;
        w.hoursWorst *= VERSTERKING;
        break;
      case "REST":
        w.restComfort *= VERSTERKING;
        break;
      case "TRANSITIONS":
        w.transitions *= VERSTERKING;
        break;
      case "NIGHT_CLUSTERING":
        w.nightSingleton *= VERSTERKING;
        w.nightPair *= VERSTERKING;
        break;
      case "NIGHT_FAIRNESS":
        w.nightFairness *= VERSTERKING;
        break;
      case "SHUNTING_FAIRNESS":
        w.shuntingFairness *= VERSTERKING;
        break;
      case "WEEKEND_FAIRNESS":
        w.weekendFairness *= VERSTERKING;
        break;
      case "LESS_CHANGE":
        w.preserveReference = Math.max(w.preserveReference, 60) * 2;
        break;
      case "KEEP_GOOD_PARTS":
        w.preserveHint = Math.max(w.preserveHint, 40);
        break;
    }
  }
  return w;
}
