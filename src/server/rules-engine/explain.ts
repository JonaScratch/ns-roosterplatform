import type { RuleEvaluationResult, RuleFinding } from "./types";

/**
 * Uitleg van een beslissing, in gewone taal.
 *
 * ## Waarom dit bestaat
 *
 * Een systeem dat diensten toewijst en ruilingen tegenhoudt, moet kunnen
 * uitleggen waarom. Niet omdat het aardig is, maar omdat een medewerker die een
 * dienst misloopt recht heeft op een antwoord, en omdat een planner die een
 * automatische keuze overneemt moet weten waar hij voor tekent.
 *
 * Zonder zo'n laag krijgt de gebruiker ofwel niets ("niet beschikbaar"), ofwel
 * de volledige bevindingenlijst — dertig regels waarvan er één relevant is. Dit
 * bestand kiest de zin die er toe doet.
 *
 * ## De vorm
 *
 * Elke uitleg bestaat uit een uitkomst en een reden, en wordt bewaard bij de
 * evaluatie (`RuleEvaluation.summary`). Zo blijft ook maanden later leesbaar
 * waarom iets gebeurde, ook als de regels intussen zijn aangepast.
 *
 * Uitleg bevat nooit een naam: hij wordt opgebouwd uit bevindingen van de rules
 * engine, en die kent alleen personeelsnummers.
 */

export interface Explanation {
  /** Wat er is besloten, in één woord voor de interface. */
  readonly outcome: "toegestaan" | "let op" | "geweigerd";
  /** Eén zin: de reden die het meest bepalend was. */
  readonly reason: string;
  /** De overige redenen, voor wie wil doorlezen. */
  readonly details: readonly string[];
}

/** De uitleg bij een evaluatie van de rules engine. */
export function explain(
  result: RuleEvaluationResult,
  context: {
    /** Bijvoorbeeld "Dienst 760 op 12 mei". Verschijnt vóór de reden. */
    readonly subject?: string;
    /** Wat er gebeurt als niets in de weg staat, bijvoorbeeld "Toewijzing mogelijk". */
    readonly positive?: string;
  } = {},
): Explanation {
  const violations = result.findings.filter((finding) => finding.severity === "VIOLATION");
  const warnings = result.findings.filter((finding) => finding.severity === "WARNING");
  const notes = result.findings.filter((finding) => finding.severity === "INFO");

  if (violations.length > 0) {
    return {
      outcome: "geweigerd",
      reason: prefix(context.subject, mostTelling(violations)),
      details: violations.slice(1).map((finding) => finding.message),
    };
  }

  if (warnings.length > 0) {
    return {
      outcome: "let op",
      reason: prefix(context.subject, mostTelling(warnings)),
      details: [...warnings.slice(1), ...notes].map((finding) => finding.message),
    };
  }

  return {
    outcome: "toegestaan",
    reason: prefix(
      context.subject,
      context.positive ?? "Voldoet aan alle harde regels en aan de gewenste rustkwaliteit.",
    ),
    details: notes.map((finding) => finding.message),
  };
}

/**
 * De bevinding die het beste uitlegt wat er aan de hand is.
 *
 * Rust en roosterprofiel gaan voor op reeksen en verdeling: als een dienst
 * tegelijk te weinig rust geeft én de weekendverdeling scheeftrekt, is het
 * eerste de reden waarom hij niet kan en het tweede een bijkomstigheid.
 */
function mostTelling(findings: readonly RuleFinding[]): string {
  const priority = [
    "hard.roosterprofiel",
    "hard.bevoegdheden",
    "hard.minimum-rust",
    "hard.dag-beschikbaar",
    "hard.reserve-positie",
    "hard.standplaats",
  ];
  for (const ruleId of priority) {
    const match = findings.find((finding) => finding.ruleId === ruleId);
    if (match) {
      return match.message;
    }
  }
  return findings[0]?.message ?? "Geen nadere toelichting beschikbaar.";
}

function prefix(subject: string | undefined, reason: string): string {
  return subject ? `${subject}: ${reason}` : reason;
}

/** Compacte weergave voor opslag bij de evaluatie. */
export function explanationSummary(explanation: Explanation): string {
  return `${explanation.outcome} — ${explanation.reason}`.slice(0, 500);
}
