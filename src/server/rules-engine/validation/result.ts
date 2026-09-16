import type { ContextWindow, RuleSource, RuleStatus } from "../ruleset/types";

/**
 * Wat een validatie oplevert.
 *
 * ## Waarom dit geen boolean is
 *
 * "Ongeldig" en "niet te beoordelen" zijn twee verschillende antwoorden met
 * twee verschillende vervolgacties. Het eerste betekent: dit mag niet. Het
 * tweede betekent: dit weet ik niet, en daarom mag het ook niet — maar de
 * oplossing is een ontbrekende regel of ontbrekende gegevens aanleveren, niet
 * het rooster aanpassen. Een boolean gooit die twee op één hoop.
 *
 * ## Waarom "overtreding" in twee smaken bestaat
 *
 * Een validator die streng maar onjuist is, is gevaarlijker dan een die niets
 * doet: hij laat mensen roosters aanpassen die misschien niets mankeren. Een
 * berekening die op een overschrijding wijst, is daarom pas een *bevestigde*
 * overtreding wanneer drie dingen vaststaan: de regel is door de bevoegde
 * partij gevalideerd, de bron is op deze datum aantoonbaar actueel, en er is
 * geen toepasselijkheidsvraag open (vrijstelling, afwijking, ontbrekend
 * venster). Ontbreekt één daarvan, dan luidt het antwoord
 * `POTENTIAL_HARD_VIOLATION` — blokkerend, maar niet als bewijs te gebruiken.
 */

/** De zes uitkomsten. */
export type ValidationOutcome =
  /** 🟢 Alles wat voor deze beslissing aanwezig én gevalideerd is, klopt. */
  | "VALID_WITHIN_VALIDATED_RULESET"
  /** 🟡 Toegestaan, met zachte signalen. */
  | "VALID_WITH_WARNINGS"
  /** 🟠 Onvoldoende roosterhistorie om te kunnen oordelen. */
  | "CONTEXT_INCOMPLETE"
  /** ⚫ Een benodigde regel ontbreekt of is niet bruikbaar. */
  | "RULESET_INCOMPLETE"
  /** 🟤 De berekening wijst op een overtreding; bron of toepasselijkheid staat niet vast. */
  | "POTENTIAL_HARD_VIOLATION"
  /** 🔴 Bewezen overtreding van een gevalideerde, actuele regel. */
  | "CONFIRMED_HARD_VIOLATION";

export const OUTCOME_SYMBOLS: Record<ValidationOutcome, string> = {
  VALID_WITHIN_VALIDATED_RULESET: "🟢",
  VALID_WITH_WARNINGS: "🟡",
  CONTEXT_INCOMPLETE: "🟠",
  RULESET_INCOMPLETE: "⚫",
  POTENTIAL_HARD_VIOLATION: "🟤",
  CONFIRMED_HARD_VIOLATION: "🔴",
};

export const OUTCOME_LABELS: Record<ValidationOutcome, string> = {
  VALID_WITHIN_VALIDATED_RULESET: "Geldig binnen gevalideerde regels",
  VALID_WITH_WARNINGS: "Geldig met aandachtspunten",
  CONTEXT_INCOMPLETE: "Onvoldoende roosterhistorie",
  RULESET_INCOMPLETE: "Regelbestand onvolledig",
  POTENTIAL_HARD_VIOLATION: "Mogelijke overtreding",
  CONFIRMED_HARD_VIOLATION: "Bevestigde overtreding",
};

/** Alleen deze uitkomsten mogen een plaatsing doorlaten. */
export function allowsPlacement(outcome: ValidationOutcome): boolean {
  return (
    outcome === "VALID_WITHIN_VALIDATED_RULESET" || outcome === "VALID_WITH_WARNINGS"
  );
}

/**
 * Wat er aan een bevinding onbevestigd is.
 *
 * Zonder deze lijst zou "mogelijk" een stemming zijn in plaats van een
 * vaststelling. Elke bevinding draagt exact bij welke vraag zij niet kan
 * beantwoorden, en dat is precies de lijst die iemand moet afwerken om haar
 * bevestigd te krijgen.
 */
export interface UnverifiedFact {
  readonly kind: "RULE_STATUS" | "SOURCE_STATUS" | "APPLICABILITY" | "CONTEXT";
  readonly detail: string;
}

export type ViolationConfidence = "CONFIRMED" | "POTENTIAL";

export interface RuleViolation {
  readonly ruleId: string;
  readonly title: string;
  readonly source: RuleSource;
  readonly severity: "HARD" | "SOFT";
  readonly confidence: ViolationConfidence;
  /** Leeg bij CONFIRMED; anders precies wat er nog niet vaststaat. */
  readonly unverified: readonly UnverifiedFact[];
  /**
   * Het onderliggende feit, niet de aanroep.
   *
   * Eén te lange dienstreeks raakt zeven roosterdagen en levert bij validatie
   * van elk van die dagen dezelfde bevinding op. Zonder deze sleutel telt een
   * rapport dat als zeven problemen. Alles met dezelfde sleutel is één
   * probleem.
   */
  readonly occurrenceKey: string;
  /** Op wie de bevinding slaat: een personeelsnummer, nooit een naam. */
  readonly employeeScope: string;
  /** De gemeten waarde, in de eenheid van de regel. */
  readonly calculatedValue: number;
  readonly limit: number;
  readonly unit: "MINUTES" | "HOURS" | "COUNT" | "RATIO" | "NONE";
  readonly message: string;
  /** Regelspecifieke onderbouwing, bedoeld om met de hand na te rekenen. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface MissingRule {
  readonly ruleId: string;
  readonly title: string;
  readonly status: RuleStatus;
  readonly reason: string;
  /** Het ontbrekende regelpakket waar dit onder valt, indien van toepassing. */
  readonly packageId?: string;
}

/**
 * Hoeveel roosterhistorie een regel nodig had en hoeveel er was.
 *
 * Wordt vastgelegd of het venster nu volledig was of niet. Een regel die zijn
 * venster wél haalde, hoort dat te kunnen laten zien; anders is "gevalideerd"
 * een bewering zonder onderbouwing.
 */
export interface RuleCoverage {
  readonly ruleId: string;
  readonly window: ContextWindow;
  readonly requiredHistoryDays: number;
  readonly availableHistoryDays: number;
  readonly requiredFutureDays: number;
  readonly availableFutureDays: number;
  /** 0 tot 100, afgerond. */
  readonly coveragePercentage: number;
  readonly validationPossible: boolean;
}

export interface ContextGap {
  readonly window: ContextWindow;
  readonly requiredFrom: string;
  readonly requiredTo: string;
  readonly availableFrom: string;
  readonly availableTo: string;
  /** De regels die hierdoor niet beoordeeld konden worden. */
  readonly affectedRules: readonly string[];
}

export interface OptimizationImpact {
  readonly ruleId: string;
  readonly title: string;
  /** Van 0 tot 1; hoger is wenselijker. */
  readonly score: number;
  readonly message: string;
}

export interface ExplanationLine {
  readonly outcome: ValidationOutcome;
  readonly headline: string;
  readonly detail?: string;
  readonly source?: string;
}

export interface ValidationResult {
  readonly outcome: ValidationOutcome;
  /** Alleen waar bij een uitkomst die doorlaat. */
  readonly valid: boolean;
  /** Alle harde bevindingen, bevestigd en mogelijk. */
  readonly hardViolations: readonly RuleViolation[];
  readonly warnings: readonly RuleViolation[];
  readonly optimizationImpacts: readonly OptimizationImpact[];
  readonly missingRules: readonly MissingRule[];
  readonly contextGaps: readonly ContextGap[];
  /** Per regel en venster: wat er nodig was en wat er beschikbaar was. */
  readonly contextCoverage: readonly RuleCoverage[];
  readonly explanation: readonly ExplanationLine[];
  /** De regels die daadwerkelijk zijn doorgerekend. */
  readonly evaluatedRules: readonly string[];
  /**
   * Regels waarvan de bron voorbij zijn contractuele einddatum loopt zonder
   * bekende opvolger. Ze zijn toegepast; hun actuele status is niet bevestigd.
   */
  readonly rulesWithUnverifiedCurrency: readonly string[];
  readonly rulesetVersion: string;
  readonly rulesetMode: string;
  readonly legalStatus: string;
  /** Wenselijkheid van 0 tot 1. Nul zodra er iets blokkeert. */
  readonly score: number;
  /** SHA-256 van de genormaliseerde invoer. */
  readonly inputDigest: string;
}

/** De harde bevindingen met deze zekerheid. */
export function violationsWith(
  violations: readonly RuleViolation[],
  confidence: ViolationConfidence,
): readonly RuleViolation[] {
  return violations.filter((violation) => violation.confidence === confidence);
}

/**
 * De uitkomst uit de bevindingen.
 *
 * De volgorde is niet willekeurig. Een bewezen overtreding is het zwaarste
 * antwoord. Daarna komt een mogelijke overtreding: die blokkeert net zo goed,
 * maar mag niet als bewijs worden gepresenteerd. Pas daarna de gaten in het
 * regelbestand en in de gegevens.
 */
export function outcomeOf(input: {
  readonly hardViolations: readonly RuleViolation[];
  readonly missingRules: readonly MissingRule[];
  readonly contextGaps: readonly ContextGap[];
  readonly warnings: readonly RuleViolation[];
}): ValidationOutcome {
  if (violationsWith(input.hardViolations, "CONFIRMED").length > 0) {
    return "CONFIRMED_HARD_VIOLATION";
  }
  if (violationsWith(input.hardViolations, "POTENTIAL").length > 0) {
    return "POTENTIAL_HARD_VIOLATION";
  }
  if (input.missingRules.length > 0) {
    return "RULESET_INCOMPLETE";
  }
  if (input.contextGaps.length > 0) {
    return "CONTEXT_INCOMPLETE";
  }
  return input.warnings.length > 0 ? "VALID_WITH_WARNINGS" : "VALID_WITHIN_VALIDATED_RULESET";
}
