import type {
  DutyEligibilityRequest,
  ReserveFillRequest,
  RosterChangeRequest,
  RosterGenerationRequest,
  RosterGenerationResult,
  RuleDefinition,
  RuleEvaluationResult,
  RulesEngine,
  SwapProposalRequest,
} from "./types";

/**
 * Aansluiting op de toekomstige centrale Rules Engine van NS.
 *
 * Dit is een placeholder met een echte vorm: de klasse bestaat, implementeert
 * hetzelfde contract als de lokale engine en wordt gekozen door dezelfde
 * configuratie. Wat ontbreekt is uitsluitend het HTTP-gesprek, omdat de dienst
 * er nog niet is.
 *
 * ## Waarom hij faalt in plaats van terug te vallen op lokaal
 *
 * Stil terugvallen op de lokale engine zou betekenen dat het platform een
 * ander regelbestand gebruikt dan de organisatie denkt, zonder dat iemand het
 * merkt. Bij roosterregels is dat geen degradatie maar een stilzwijgend andere
 * uitkomst. Wie `RULES_ENGINE_MODE=remote` zet zonder werkende dienst, hoort
 * dat te merken bij de eerste aanroep.
 *
 * ## Wat er nog moet gebeuren bij het aansluiten
 *
 *  1. Authenticatie tegen de dienst (mTLS of service-token via `RULES_ENGINE_TOKEN`).
 *  2. Time-out en circuit breaker: een trage engine mag het platform niet ophouden.
 *  3. Versiecontrole: de engineversie hoort in elke `RuleEvaluation` vastgelegd
 *     te worden, zodat oude besluiten uitlegbaar blijven na een upgrade.
 *  4. Vertaling van de bevindingen naar `RuleFinding`, met behoud van regel-id's.
 */
export class RemoteRulesEngine implements RulesEngine {
  readonly name = "ns-rules-engine-remote";
  readonly version = "onbekend";

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  describeRules(): readonly RuleDefinition[] {
    return [];
  }

  async evaluateDutyEligibility(_request: DutyEligibilityRequest): Promise<RuleEvaluationResult> {
    return this.notAvailable("evaluateDutyEligibility");
  }

  async evaluateSwap(_request: SwapProposalRequest): Promise<RuleEvaluationResult> {
    return this.notAvailable("evaluateSwap");
  }

  async evaluateReserveFill(_request: ReserveFillRequest): Promise<RuleEvaluationResult> {
    return this.notAvailable("evaluateReserveFill");
  }

  async evaluateRosterChange(_request: RosterChangeRequest): Promise<RuleEvaluationResult> {
    return this.notAvailable("evaluateRosterChange");
  }

  async generateRoster(_request: RosterGenerationRequest): Promise<RosterGenerationResult> {
    throw new RulesEngineUnavailableError(this.baseUrl, "generateRoster");
  }

  private notAvailable(operation: string): never {
    // `token` bestaat al zodat de vorm van de configuratie klopt; hij wordt pas
    // gebruikt wanneer het HTTP-gesprek er is.
    void this.token;
    throw new RulesEngineUnavailableError(this.baseUrl, operation);
  }
}

export class RulesEngineUnavailableError extends Error {
  constructor(baseUrl: string, operation: string) {
    super(
      `De centrale Rules Engine op ${baseUrl || "(geen URL geconfigureerd)"} is nog niet ` +
        `aangesloten; ${operation} kan niet worden uitgevoerd. Zet RULES_ENGINE_MODE=local ` +
        "om de lokale referentie-implementatie te gebruiken.",
    );
    this.name = "RulesEngineUnavailableError";
  }
}
