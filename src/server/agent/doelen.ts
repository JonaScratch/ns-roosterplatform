import { SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";

/**
 * Welke strategie hoort bij welk doel.
 *
 * Stond in de stub, als onderdeel van de woordherkenning. Toen de lokale
 * modeladapter ook voorstellen moest kunnen doen, bleek dat de verkeerde plek:
 * twee adapters die elk hun eigen koppeling doel → strategie bijhouden, lopen
 * vroeg of laat uiteen, en dan stuurt dezelfde vraag een andere zoekmachine aan
 * afhankelijk van welk model er die dag draait.
 */
export const STRATEGIE_VOOR_DOEL: Readonly<Record<RebuildGoal, string>> = {
  NIGHT_CLUSTERING: "REST_QUALITY",
  NIGHT_FAIRNESS: "FAIR_BURDEN",
  REST: "REST_QUALITY",
  TRANSITIONS: "REST_QUALITY",
  HOURS: "BALANCED",
  SHUNTING_FAIRNESS: "FAIR_BURDEN",
  WEEKEND_FAIRNESS: "FAIR_BURDEN",
  LESS_CHANGE: "BALANCED",
  KEEP_GOOD_PARTS: "BALANCED",
};

/**
 * Het label van een strategie, uit de scenariodefinities.
 *
 * Niet overschrijven met een eigen lijstje: dan staat er in het ene scherm een
 * andere naam voor dezelfde strategie dan in het andere.
 */
export function strategieLabel(key: string): string {
  return SCENARIO_PROFILES.find((p) => p.key === key)?.label ?? key;
}

/** Is dit een doel dat de zoekmachine kent? Een verzonnen doel stuurt niets. */
export function isDoel(waarde: unknown): waarde is RebuildGoal {
  return typeof waarde === "string" && waarde in REBUILD_GOAL_LABELS;
}

/**
 * De doelen die een model mag noemen, met hun label.
 *
 * Gaat mee in de systeeminstructie. Een model dat de lijst niet kent, verzint
 * een doel, en een verzonnen doel wordt hier weggefilterd — dan blijft er een
 * voorstel zonder doel over, en dat is een voorstel zonder betekenis.
 */
export function doelenLijst(): string {
  return Object.entries(REBUILD_GOAL_LABELS)
    .map(([code, label]) => `${code} (${label.toLowerCase()})`)
    .join(", ");
}
