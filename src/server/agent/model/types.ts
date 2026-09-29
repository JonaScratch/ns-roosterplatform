import "server-only";

/**
 * De modeladapter: het enige punt waar een taalmodel het platform raakt.
 *
 * ## Waarom deze scheiding
 *
 * Het geheugen, de regels, de kandidaten en de beslissingen horen in de eigen
 * database, niet in een taalmodel. Een model dat wegvalt mag niet betekenen dat
 * het platform stilvalt; een model dat wisselt mag geen herbouw betekenen. Alles
 * wat het model doet, loopt daarom door deze twee functies:
 *
 * - `plan`: wat wil de gebruiker, en welke tools moeten daarvoor worden
 *   aangeroepen? (Of: hier moet ik doorvragen, dit mag ik niet, dit kan ik niet
 *   vaststellen.)
 * - `compose`: gegeven de uitkomsten van die tools, wat is het antwoord?
 *
 * Het model kiest dus wél de weg, maar levert nooit de feiten. Elk getal in een
 * antwoord komt uit een toolresultaat.
 *
 * ## De stub
 *
 * Zolang er geen besluit is over een externe AI-dienst draait hier een lokale,
 * deterministische stub. Die meet de kéten — contextherkenning, toolkeuze,
 * rechten, gegevens — maar zegt niets over taalvaardigheid. Zo staat het ook in
 * de benchmarkmethodiek: een stub is geen bewijs van begrip.
 */

export interface PlanContext {
  readonly locationCode: string;
  readonly source: "official" | "candidate";
  readonly candidateId: string | null;
  readonly rosterCode: string | null;
  readonly lineNumber: number | null;
  readonly weekday: number | null;
  readonly dutyCode: string | null;
  readonly missing: readonly string[];
}

export interface PlanTool {
  readonly name: string;
  readonly description: string;
  readonly permission: string;
  readonly allowed: boolean;
  /** Wat het model zelf moet invullen; de schermcontext zet de server erbij. */
  readonly requires: readonly string[];
}

export interface PlanRequest {
  readonly text: string;
  readonly context: PlanContext;
  readonly tools: readonly PlanTool[];
  readonly history: readonly { readonly role: "USER" | "AGENT"; readonly text: string }[];
  /**
   * Wat de agent hier en nu werkelijk mag.
   *
   * Niet de ruwe toekenning: het recht van de vrager en de noodrem zijn er al
   * uit gerekend. Het model hoort geen mogelijkheid te zien die er niet is —
   * anders belooft het iets wat de rechtencontrole daarna weigert.
   */
  readonly capabilities: readonly string[];
  /** Staat de agent stil? Dan is dat de reden, en niet "de bevoegdheid staat uit". */
  readonly suspended: boolean;
}

export type AgentIntent =
  | "ROOSTERVRAAG"
  | "REGELVRAAG"
  | "VERDELINGSVRAAG"
  | "UITLEGVRAAG"
  | "FEEDBACK"
  | "OPTIMALISATIEVERZOEK"
  | "VERDUIDELIJKING_NODIG"
  | "NIET_VAST_TE_STELLEN"
  | "GEWEIGERD"
  | "ONBEKEND";

export interface AgentPlan {
  readonly intent: AgentIntent;
  /** Welke tools, in volgorde. Leeg bij weigeren of doorvragen. */
  readonly toolCalls: readonly { readonly tool: string; readonly input: Record<string, unknown> }[];
  /** Wat de agent wil vragen als de vraag niet scherp genoeg is. */
  readonly clarification?: string;
  /** Waarom dit niet uit de gegevens is af te leiden. */
  readonly cannotDetermine?: string;
  /** Waarom dit niet mag, in gewone taal. */
  readonly refusal?: string;
  /**
   * Een voorgestelde rekenopdracht (niveau B).
   *
   * Een voorstel is geen opdracht: het scherm laat het zien met wat het gaat
   * doen en hoe lang het duurt, en pas als een mens bevestigt, gebeurt er iets.
   * De grenzen worden daarna server-side gecontroleerd tegen de toekenning.
   */
  readonly proposal?: Record<string, unknown>;
  /**
   * Iets dat de agent wil onthouden.
   *
   * Ook dit is een voorstel: het scherm laat het zien met een knop, en pas als
   * een mens die indrukt komt het in het leergeheugen te staan — en dan nog
   * als voorstel, dat een commissielid goedkeurt.
   */
  readonly memoryProposal?: Record<string, unknown>;
  /** Wat de agent van plan is, voor het activiteitenpaneel. */
  readonly reasoning: string;
  /**
   * Het model leverde geen leesbaar plan; de clarification is dan een
   * noodantwoord en geen echte wedervraag. De plancontrole in agent.ts
   * (`plan-guard.ts`) zoekt in dat geval eerst de bekende context op.
   */
  readonly onleesbaar?: boolean;
}

export interface ComposeRequest extends PlanRequest {
  readonly plan: AgentPlan;
  readonly results: readonly {
    readonly tool: string;
    readonly ok: boolean;
    readonly data: unknown;
    readonly sources: readonly string[];
    readonly error?: string;
    /**
     * Waarom een tool niets opleverde: "geen recht", "ongeldige invoer", "fout".
     * Een weigering is iets anders dan een storing, en de gebruiker hoort het
     * verschil te lezen.
     */
    readonly note?: string;
  }[];
}

export interface AgentAnswer {
  readonly text: string;
  /** Gestructureerd antwoord waar dat kan: hiermee wordt de agent afgerekend. */
  readonly data: Record<string, unknown> | null;
  readonly sources: readonly string[];
  readonly status: "BEANTWOORD" | "VERDUIDELIJKING" | "NIET_VAST_TE_STELLEN" | "GEWEIGERD" | "FOUT" | "VOORSTEL";
}

/**
 * Onder welke naam het resultaat van een tool in het antwoord terechtkomt.
 *
 * ## Waarom dit vastligt en niet per model verschilt
 *
 * `data` is waarop de agent wordt afgerekend: de benchmark kijkt daarin of het
 * juiste dienstnummer, de juiste regel en de juiste uren zijn teruggegeven. Zou
 * elk model zijn eigen veldnamen kiezen, dan meet je bij het ene model iets
 * anders dan bij het andere — en dat is precies wat er bij de eerste lokale
 * meting gebeurde: acht feitelijke vragen kwamen terug als "onbeoordeeld",
 * omdat het lokale model zijn gegevens onder de toolnaam wegschreef.
 */
export const DATA_SLEUTEL: Readonly<Record<string, string>> = {
  rosterLine: "line",
  dutyInstance: "duty",
  dutyKindCounts: "counts",
  dutyKindPerLine: "kindPerLine",
  rosterHours: "hours",
  ruleLookup: "rules",
  ruleSearch: "rules",
  nightStructure: "nights",
  qualityReport: "quality",
  rosterProject: "project",
  knowledgeSearch: "memory",
  experimentHistory: "experiments",
};

export interface ChatModel {
  readonly name: string;
  /** Kan dit model echte taal? Een stub niet; dat mag nooit als taalvaardigheid tellen. */
  readonly isLanguageModel: boolean;
  plan(request: PlanRequest): Promise<AgentPlan>;
  compose(request: ComposeRequest): Promise<AgentAnswer>;
}
