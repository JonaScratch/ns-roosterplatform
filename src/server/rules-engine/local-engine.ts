import { dayNumber } from "@/domain/time";
import { evaluateCheck, evaluateChecks } from "./adapter";
import { DEFAULT_PRODUCT_PARAMETERS, type ProductParameters } from "./parameters";
import { activeRuleset } from "./ruleset/index";
import type { AssignmentReason } from "./validation/subject";
import type {
  AssignmentCheck,
  DutyEligibilityRequest,
  ReserveFillRequest,
  RosterChangeRequest,
  RosterGenerationRequest,
  RosterGenerationResult,
  RuleDefinition,
  RuleEvaluationResult,
  RuleFinding,
  RulesEngine,
  SwapProposalRequest,
} from "./types";

/**
 * De Rules Engine in dit proces.
 *
 * ## Wat deze klasse sinds de centrale regelverzameling nog doet
 *
 * Bijna niets, en dat is het punt. Zij vertaalt de vier gebruiksmomenten naar
 * dezelfde aanroep van dezelfde validator. Er staat hier geen enkele
 * roosterregel meer: geen minimumrust, geen maximum aantal werkdagen, geen
 * drempel voor een nachtreeks. Die stonden hier vroeger wél, als losse
 * parameters, en dat was een tweede regelboek naast de CAO — met andere
 * getallen. Een systeem met twee regelboeken geeft twee antwoorden, en niemand
 * weet welk van de twee gold toen het misging.
 *
 * ## Waarom lokaal en toch achter een interface
 *
 * Zodra de centrale Rules Engine van NS beschikbaar komt, wordt
 * `RemoteRulesEngine` aangesloten en verandert er in de services niets — die
 * kennen alleen `RulesEngine`.
 */
export class LocalRulesEngine implements RulesEngine {
  readonly name = "ns-roosterplatform-local";
  readonly version = "2.0.0";

  constructor(private readonly parameters: ProductParameters = DEFAULT_PRODUCT_PARAMETERS) {}

  /**
   * De regels die deze engine kent, rechtstreeks uit het regelbestand.
   *
   * Bewust een afgeleide en geen tweede lijst: een handgeschreven catalogus
   * naast de regelverzameling raakt achter zodra iemand een regel toevoegt, en
   * dan liegt het scherm dat verantwoording moet afleggen.
   */
  describeRules(): readonly RuleDefinition[] {
    return activeRuleset().rules.map((rule) => ({
      id: rule.id,
      category: rule.category,
      title: rule.title,
      rationale: rule.rationale,
      appliesTo: [
        "DUTY_ELIGIBILITY",
        "SWAP_PROPOSAL",
        "RESERVE_FILL",
        "ROSTER_CHANGE",
        "ROSTER_GENERATION",
      ],
    }));
  }

  async evaluateDutyEligibility(
    request: DutyEligibilityRequest,
  ): Promise<RuleEvaluationResult> {
    return this.run([request.check], "AVAILABLE_DUTY");
  }

  /**
   * Een ruil is twee controles, niet één.
   *
   * Beide medewerkers worden volledig doorgerekend met de dienst die zij
   * krijgen en zonder de dienst die zij inleveren. Dat de dienst vóór en ná de
   * ruildag bij allebei wordt bekeken, komt uit de regels over rust en reeksen
   * die over het hele venster kijken — het is geen extra stap die iemand kan
   * overslaan.
   */
  async evaluateSwap(request: SwapProposalRequest): Promise<RuleEvaluationResult> {
    return this.run([request.initiator, request.counterparty], "SWAP");
  }

  /**
   * Reserve-invulling.
   *
   * Wat hier bovenop de gewone toetsing komt: een medewerker die die dag niet
   * op een RES-positie staat, is geen reserve-invulling. Dat is een andere
   * route (beschikbare dienst) met een ander besluit erachter.
   */
  async evaluateReserveFill(request: ReserveFillRequest): Promise<RuleEvaluationResult> {
    const base = await this.run([request.check], "RESERVE_FILL");
    if (request.onReservePosition) {
      return base;
    }
    const extra: RuleFinding = {
      ruleId: "PRODUCT_RESERVE_POSITION",
      category: "HARD_CONSTRAINT",
      severity: "VIOLATION",
      message:
        `Medewerker ${request.check.employee.employeeNumber} staat op ${request.check.date} ` +
        "niet op een RES-positie en komt daarom niet in aanmerking voor reserve-invulling.",
      employeeNumber: request.check.employee.employeeNumber,
    };
    return {
      ...base,
      decision: "BLOCK",
      // Dit is een productregel van het platform zelf, geen CAO-bepaling: dat
      // iemand niet op een RES-positie staat, is een feit uit ons eigen rooster
      // en geen interpretatiekwestie. Vandaar bevestigd.
      outcome:
        base.outcome === "VALID_WITHIN_VALIDATED_RULESET" ||
        base.outcome === "VALID_WITH_WARNINGS"
          ? "CONFIRMED_HARD_VIOLATION"
          : base.outcome,
      findings: [...base.findings, extra],
      score: 0,
    };
  }

  async evaluateRosterChange(request: RosterChangeRequest): Promise<RuleEvaluationResult> {
    return this.run(request.checks, "MANUAL_DID");
  }

  /**
   * Roosters genereren — nog niet geïmplementeerd, en met opzet niet.
   *
   * De opdracht is uitdrukkelijk om de definitieve optimizer nog niet te
   * bouwen. Wat er wel is: het volledige verzoek- en antwoordcontract, en een
   * validator die elke voorgestelde plaatsing kan afkeuren. Een optimizer die
   * hierop wordt aangesloten hoeft niets nieuws te leren — en kan niets
   * doordrukken, want zijn uitkomst wordt onafhankelijk nagerekend.
   *
   * De methode faalt zichtbaar in plaats van een leeg rooster terug te geven.
   * Een placeholder die iets teruggeeft wat op een resultaat lijkt, is de reden
   * dat placeholders in productie belanden.
   */
  async generateRoster(request: RosterGenerationRequest): Promise<RosterGenerationResult> {
    return {
      status: "NOT_IMPLEMENTED",
      message:
        "De rooster-optimizer is nog niet geïmplementeerd. Het contract ligt vast: " +
        `${request.baseRosterIds.length} basisrooster(s), ${request.employees.length} ` +
        `medewerkers en ${request.duties.length} diensten zouden gezamenlijk worden ` +
        "geoptimaliseerd. Zie README, hoofdstuk 'Toekomstige rooster-engine'.",
      findings: [],
      engine: { name: this.name, version: this.version },
    };
  }

  // ── Intern ─────────────────────────────────────────────────────────────────

  private async run(
    checks: readonly AssignmentCheck[],
    reason: AssignmentReason,
  ): Promise<RuleEvaluationResult> {
    for (const check of checks) {
      assertWindowContainsDay(check);
    }
    return checks.length === 1
      ? evaluateCheck(checks[0], reason)
      : evaluateChecks(checks, reason);
  }
}

/**
 * Het meegegeven venster moet de betrokken dag omvatten.
 *
 * Alleen die ene voorwaarde nog. Vroeger eiste deze functie ook een minimale
 * breedte, omdat een te smal venster stilzwijgend een gunstig oordeel opleverde.
 * Dat kan niet meer: de validator meldt zelf welk venster hij nodig had en wat
 * er beschikbaar was, per regel. Een te smal venster levert nu "niet te
 * beoordelen" op in plaats van een uitzondering — informatiever, en het
 * blokkeert net zo goed.
 */
function assertWindowContainsDay(check: AssignmentCheck): void {
  const target = dayNumber(check.date);
  if (target < dayNumber(check.window.from) || target > dayNumber(check.window.to)) {
    throw new Error(
      `Het venster (${check.window.from} t/m ${check.window.to}) bevat de te toetsen ` +
        `dag ${check.date} niet.`,
    );
  }
}
