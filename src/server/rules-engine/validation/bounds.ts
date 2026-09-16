import type { Evaluation, UsableRule } from "./evaluation";
import type { MissingRule } from "./result";

/**
 * Vergelijken met onzekerheid.
 *
 * ## Het probleem
 *
 * Twee dingen in dit domein zijn soms niet exact bekend. De arbeidstijd, omdat
 * de duur van de werkonderbreking standplaatsafhankelijk is en die waarde niet
 * is aangeleverd. En de grens zelf, omdat de CAO bij een lange werkonderbreking
 * een standplaatsafhankelijke verlaging van 2 tot 10 minuten kent.
 *
 * De verleiding is dan om een aannemelijk getal in te vullen. Dat is precies de
 * fout die dit hele systeem moet voorkomen: een verzonnen 36 minuten wordt
 * binnen een maand als de echte waarde gelezen.
 *
 * ## De oplossing
 *
 * Rekenen met een boven- en een ondergrens, en pas een oordeel vellen wanneer
 * de onzekerheid het antwoord niet meer kan veranderen:
 *
 *  - de gunstigste lezing overschrijdt de ruimste grens → bewezen overtreding;
 *  - de ongunstigste lezing haalt de strengste grens → bewezen in orde;
 *  - daartussenin → niet te beoordelen, en dat is een blokkade met een
 *    aanwijsbare oorzaak, geen goedkeuring.
 *
 * Zo blokkeert een ontbrekende parameter alleen de gevallen waarin hij er
 * werkelijk toe doet. Een dienst van zes uur wordt niet tegengehouden door een
 * onbekende correctie van hooguit tien minuten op een grens van negen uur.
 */

export interface Range {
  readonly min: number;
  readonly max: number;
}

export function exact(value: number): Range {
  return { min: value, max: value };
}

export type Comparison = "VIOLATION" | "INDETERMINATE" | "WITHIN";

/** Toetst een waarde aan een bovengrens. */
export function compareToMaximum(value: Range, limit: Range): Comparison {
  if (value.min > limit.max) {
    return "VIOLATION";
  }
  return value.max > limit.min ? "INDETERMINATE" : "WITHIN";
}

/** Toetst een waarde aan een ondergrens. */
export function compareToMinimum(value: Range, limit: Range): Comparison {
  if (value.max < limit.min) {
    return "VIOLATION";
  }
  return value.min < limit.max ? "INDETERMINATE" : "WITHIN";
}

export interface BoundedCheck {
  readonly rule: UsableRule;
  readonly value: Range;
  readonly limit: Range;
  /** Het onderliggende feit, voor het uniek tellen van bevindingen. */
  readonly occurrenceKey: string;
  /** Wordt gebruikt bij een bewezen overtreding. */
  readonly violationMessage: (value: Range, limit: Range) => string;
  /**
   * Waarom het antwoord niet vaststaat, en welke regels daarvoor ontbreken.
   *
   * Meervoud, want twee onzekerheden kunnen tegelijk spelen: een grens die
   * standplaatsafhankelijk lager ligt, en een arbeidstijd die door een
   * onbekende werkonderbreking zelf al een bandbreedte is. Wie er dan één
   * meldt, stuurt degene die het gat moet dichten naar de helft van het werk.
   */
  readonly indeterminate: MissingRule | readonly MissingRule[];
}

/** Voert een maximumtoets uit en boekt de uitkomst. */
export function assertMaximum(evaluation: Evaluation, check: BoundedCheck): Comparison {
  const outcome = compareToMaximum(check.value, check.limit);
  record(evaluation, check, outcome);
  return outcome;
}

/** Voert een minimumtoets uit en boekt de uitkomst. */
export function assertMinimum(evaluation: Evaluation, check: BoundedCheck): Comparison {
  const outcome = compareToMinimum(check.value, check.limit);
  record(evaluation, check, outcome);
  return outcome;
}

function record(evaluation: Evaluation, check: BoundedCheck, outcome: Comparison): void {
  if (outcome === "VIOLATION") {
    evaluation.violate(check.rule, {
      // Bij een bewezen overtreding is de gunstigste lezing al te hoog; die
      // waarde rapporteren is het eerlijkst.
      calculatedValue: check.value.min,
      limit: check.limit.max,
      message: check.violationMessage(check.value, check.limit),
      occurrenceKey: check.occurrenceKey,
    });
    return;
  }
  if (outcome !== "INDETERMINATE") {
    return;
  }

  const causes = Array.isArray(check.indeterminate)
    ? check.indeterminate
    : [check.indeterminate as MissingRule];

  // Een onbeslisbare uitkomst zonder opgegeven oorzaak zou hier stil doorlopen,
  // en dat is precies de fout die dit bestand moet uitsluiten. Dan liever een
  // blokkade die zegt dat de oorzaak zelf niet is vastgelegd.
  if (causes.length === 0) {
    evaluation.blockOnMissing({
      ruleId: check.rule.definition.id,
      title: check.rule.definition.title,
      status: "UNRESOLVED",
      reason:
        "Deze toets kon niet eenduidig worden uitgevoerd en er is geen oorzaak " +
        "vastgelegd. De uitkomst wordt daarom niet als goedkeuring behandeld.",
    });
    return;
  }

  for (const cause of causes) {
    evaluation.blockOnMissing(cause);
  }
}
