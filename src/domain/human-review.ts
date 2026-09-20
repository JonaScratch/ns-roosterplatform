/**
 * De woorden waarmee een mens een rooster beoordeelt.
 *
 * ## Waarvoor
 *
 * Het kwaliteitsmodel is geijkt op zeven menselijke roosters. Of het ook meet
 * wat mensen belangrijk vinden, kan alleen een mens zeggen, over concrete
 * kandidaten. Deze codes maken dat oordeel telbaar: een regel is goed, twijfel
 * of slecht, met redenen die aansluiten op de maten van het model. Zo is later
 * na te gaan of "slecht door heen-en-weer" samenvalt met een lage score op
 * heen-en-weer — of juist niet, en dan klopt de maat niet.
 *
 * ## Wat hier niet gebeurt
 *
 * Er wordt niets automatisch aangepast. Een oordeel verandert geen gewicht en
 * geen model. De volgorde is: verzamelen, analyseren, een voorstel doen,
 * BEFORE en AFTER meten, en dan pas besluiten.
 */

export const HUMAN_REVIEW_VERDICTS = ["GOOD", "DOUBT", "BAD"] as const;
export type HumanReviewVerdictKey = (typeof HUMAN_REVIEW_VERDICTS)[number];

export const HUMAN_REVIEW_VERDICT_LABELS: Readonly<Record<HumanReviewVerdictKey, string>> = {
  GOOD: "Goed",
  DOUBT: "Twijfel",
  BAD: "Slecht",
};

export const HUMAN_REVIEW_REASONS = {
  GOOD_FLOW: { label: "Rustig verloop van dagdelen", tone: "good" },
  GOOD_NIGHT_BLOCK: { label: "Nachten mooi in een blok", tone: "good" },
  GOOD_RECOVERY: { label: "Goed herstel na nachten of zware diensten", tone: "good" },
  GOOD_HOURS: { label: "Uren kloppen", tone: "good" },
  BAD_OSCILLATION: { label: "Heen-en-weer tussen dagdelen", tone: "bad" },
  BAD_SINGLE_NIGHT: { label: "Losse nacht", tone: "bad" },
  BAD_TWO_NIGHT_BLOCK: { label: "Reeks van maar twee nachten", tone: "bad" },
  BAD_RECOVERY: { label: "Te weinig herstel", tone: "bad" },
  BAD_START_TIME_JUMP: { label: "Begintijden springen te veel", tone: "bad" },
  BAD_HOURS_OUTLIER: { label: "Uren uitschieter", tone: "bad" },
  BAD_FAIRNESS: { label: "Oneerlijke verdeling", tone: "bad" },
  BAD_WEEKEND_LOAD: { label: "Weekendbelasting te zwaar", tone: "bad" },
} as const;
export type HumanReviewReason = keyof typeof HUMAN_REVIEW_REASONS;

export const PAIRWISE_REASONS = {
  BETTER_FLOW: "Beter verloop van dagdelen",
  BETTER_NIGHT_BLOCKS: "Betere nachtblokken",
  BETTER_RECOVERY: "Beter herstel",
  BETTER_HOURS: "Betere uren",
  FAIRER: "Eerlijker",
  FEWER_WEIRD_TRANSITIONS: "Minder vreemde overgangen",
} as const;
export type PairwiseReason = keyof typeof PAIRWISE_REASONS;

export const PAIRWISE_CHOICES = ["FIRST", "SECOND", "EQUAL"] as const;
export type PairwiseChoiceKey = (typeof PAIRWISE_CHOICES)[number];

export function isHumanReviewReason(value: string): value is HumanReviewReason {
  return value in HUMAN_REVIEW_REASONS;
}

export function isPairwiseReason(value: string): value is PairwiseReason {
  return value in PAIRWISE_REASONS;
}
