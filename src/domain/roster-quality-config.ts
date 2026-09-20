import { DEFAULT_SUITABILITY_POLICY } from "./suitability";

/**
 * De instellingen van roosterkwaliteit, op één plek.
 *
 * ## Wat dit wél en niet is
 *
 * Alles in dit bestand is een **productkeuze** over comfort en regelmaat. Niets
 * hier is een regel uit de CAO of de Arbeidstijdenwet; die staan in de
 * regelcatalogus en worden hard afgedwongen. Een overgang van nacht naar vroeg
 * die de wettelijke rust haalt, mag. Deze tabel zegt alleen dat een medewerker
 * hem liever niet rijdt — en daarmee dat een generator hem liever niet kiest.
 *
 * ## Waarom één plek
 *
 * Dezelfde tabel stuurt de optimizer (als kostenpost) én meet het resultaat
 * (als deelscore). Staan de getallen op twee plekken, dan stuurt de optimizer
 * op iets anders dan wat het scherm vervolgens meet, en kan een herbouw "beter"
 * uitkomen op een maat die de solver nooit zag.
 *
 * ## Waar de getallen vandaan komen
 *
 * De relatieve zwaarte volgt de richting waarin een dienstreeks draait: met de
 * klok mee (vroeg → laat → nacht) is de natuurlijke richting, terug (nacht →
 * vroeg) de zware. De officiële Dordrechtse roosters zijn als toets gebruikt:
 * `verify:kwaliteit` telt hoe vaak elke overgang daar voorkomt, en de overgangen
 * die hier zwaar heten, zijn daar zeldzaam.
 */

export type TransitionCategory = "EARLY" | "LATE" | "NIGHT";

export const TRANSITION_CATEGORY_LABELS: Readonly<Record<TransitionCategory, string>> = {
  EARLY: "vroeg",
  LATE: "laat",
  NIGHT: "nacht",
};

/**
 * Strafpunten per overgang tussen twee dienstdagen die direct op elkaar volgen.
 *
 * Rij = de eerste dag, kolom = de dag erna.
 */
export const ADJACENT_TRANSITION_PENALTY: Readonly<
  Record<TransitionCategory, Readonly<Record<TransitionCategory, number>>>
> = {
  EARLY: { EARLY: 0, LATE: 1, NIGHT: 3 },
  LATE: { EARLY: 4, LATE: 0, NIGHT: 1 },
  NIGHT: { EARLY: 6, LATE: 3, NIGHT: 0 },
};

/**
 * Strafpunten per overgang over precies één vrije dag heen (R, WR of CO).
 *
 * Eén vrije dag na een nacht is nauwelijks herstel; een losse nacht, dan vrij,
 * dan weer een nacht is precies de versnippering die medewerkers niet willen.
 */
export const OVER_ONE_OFF_DAY_PENALTY: Readonly<
  Record<TransitionCategory, Readonly<Record<TransitionCategory, number>>>
> = {
  EARLY: { EARLY: 0, LATE: 0, NIGHT: 1 },
  LATE: { EARLY: 1, LATE: 0, NIGHT: 0 },
  NIGHT: { EARLY: 3, LATE: 1, NIGHT: 2 },
};

/**
 * Strafpunten per overgang over precies twee vrije dagen heen.
 *
 * Alleen nacht → vroeg. In de menselijke Dordrechtse roosters gaat elke
 * nachtreeks via twee of drie vrije dagen naar een late dienst, nooit naar een
 * vroege (`docs/human-roster-benchmark/`). Alle andere overgangen zijn na twee
 * vrije dagen gewoon.
 */
export const OVER_TWO_OFF_DAYS_PENALTY: Readonly<
  Record<TransitionCategory, Readonly<Record<TransitionCategory, number>>>
> = {
  EARLY: { EARLY: 0, LATE: 0, NIGHT: 0 },
  LATE: { EARLY: 0, LATE: 0, NIGHT: 0 },
  NIGHT: { EARLY: 2, LATE: 0, NIGHT: 0 },
};

/**
 * De uitgang van een nachtreeks zoals in de menselijke roosters.
 *
 * Alle vier de menselijke nachtreeksen gaan via twee of drie vrije dagen naar
 * een late dienst (56–80 uur herstel). Nacht, één vrije dag, laat geeft
 * ongeveer 33 uur, nacht direct gevolgd door laat ongeveer 13 — allebei minder
 * dan de 46 uur die de regel na drie of meer nachten vraagt.
 *
 * De strafpunten dalen strikt met de rust ertussen, voor laat én voor vroeg:
 *
 *   na nachten   direct   1 vrij   2 vrij
 *   → vroeg        6        4        2
 *   → laat         5        3        0
 *
 * Die volgorde is belangrijk. Een eerdere versie zette alleen "1 vrij → laat"
 * op 3, gelijk aan "direct → laat"; de solver koos daarop in een meting een
 * nachtreeks met 13 uur herstel (`docs/human-roster-benchmark/solver-ab-nacht.json`).
 * Alleen nachten zijn aangepast; de andere overgangen blijven zoals in v1.0.4.
 */
export const HUMAN_ADJACENT_TRANSITION_PENALTY: Readonly<
  Record<TransitionCategory, Readonly<Record<TransitionCategory, number>>>
> = {
  ...ADJACENT_TRANSITION_PENALTY,
  NIGHT: { ...ADJACENT_TRANSITION_PENALTY.NIGHT, LATE: 5 },
};

export const HUMAN_OVER_ONE_OFF_DAY_PENALTY: Readonly<
  Record<TransitionCategory, Readonly<Record<TransitionCategory, number>>>
> = {
  ...OVER_ONE_OFF_DAY_PENALTY,
  NIGHT: { ...OVER_ONE_OFF_DAY_PENALTY.NIGHT, EARLY: 4, LATE: 3 },
};

/** Vanaf dit aantal strafpunten heet een overgang zwaar. */
export const HEAVY_TRANSITION_PENALTY = 3;

/** Roosterposities die als vrije dag gelden tussen twee diensten. */
export const OFF_POSITION_TYPES: readonly string[] = ["RUST", "WR", "CO"];

/**
 * Rust tussen diensten op opeenvolgende dagen.
 *
 * Overgenomen uit het bestaande geschiktheidsbeleid, dat dezelfde vraag al
 * beantwoordde voor ruilingen: vanaf 14 uur comfortabel, onder 13 uur krap.
 */
export const COMFORTABLE_REST_MINUTES = DEFAULT_SUITABILITY_POLICY.comfortableRestMinutes;
export const TIGHT_REST_MINUTES = DEFAULT_SUITABILITY_POLICY.tightRestMinutes;

/** Een nachtreeks van deze lengte of langer heet geclusterd. */
export const PREFERRED_NIGHT_BLOCK_LENGTH = 3;

/**
 * Bij deze afwijking van 40:00 per week scoort de urenbalans van een rooster 0.
 *
 * Lineair: 0 minuten = 100, een half uur = 50, een uur of meer = 0.
 */
export const HOURS_SCORE_ZERO_AT_MINUTES = 60;
