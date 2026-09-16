/**
 * Het regelbestand: metadata, bron en versiebeheer.
 *
 * ## Waarom een regel meer is dan een getal
 *
 * `const MIN_REST = 12` is in een roosterapplicatie geen constante maar een
 * juridische bewering. Wie hem later tegenkomt weet niet uit welke bron hij
 * komt, voor welke functiegroep hij geldt, sinds wanneer, en of hij nog
 * actueel is. Elke regel hier draagt daarom zijn herkomst mee: document,
 * artikel, laag, geldigheidsperiode, reikwijdte en validatiestatus.
 *
 * ## Fail-closed
 *
 * Een regel waarvan de waarde niet is aangeleverd, krijgt `value: null` en een
 * status die dat benoemt. De validator behandelt dat niet als "geen beperking"
 * maar als "niet veilig te beoordelen". Zie `src/server/rules-engine/assignment.ts`.
 */

/**
 * De lagen uit de bronhiërarchie, van hoog naar laag.
 *
 * `PRODUCT_POLICY` staat onderaan, ná de keuze van de medewerker zelf, en dat
 * is geen ordeningsdetail. Een regel die dit platform zelf stelt — hoe een
 * ruilvoorstel eruit hoort te zien, wanneer een anker vaststaat — is geen
 * NS-bron. Zou hij ergens hoger staan, dan kan hij bij gelijke naam een
 * CAO-regel overstemmen, en dan bepaalt onze eigen aanname wat een machinist
 * mag. `LOCAL` is bedoeld voor een echte lokale NS-afspraak en niet hiervoor.
 */
export const RULE_LAYERS = [
  "LAW_ATW",
  "LAW_ATB",
  "CAO",
  "CAO_COMPANY",
  "REGIONAL",
  "LOCAL",
  "INDIVIDUAL",
  "EMPLOYEE_CHOICE",
  "PRODUCT_POLICY",
] as const;

export type RuleLayer = (typeof RULE_LAYERS)[number];

/** Hoe hoog een laag staat. Lager getal = hogere bron. */
export function layerRank(layer: RuleLayer): number {
  return RULE_LAYERS.indexOf(layer);
}

export type RuleCategory = "HARD_CONSTRAINT" | "SOFT_CONSTRAINT" | "OPTIMIZATION_OBJECTIVE";

/**
 * De validatiestatus van een regel.
 *
 * Alleen `VALIDATED` betekent: door de bevoegde partij bevestigd als actueel en
 * juist. Alle andere statussen betekenen dat de regel niet zonder meer als
 * juridische waarheid gebruikt mag worden, en dat de validator daar iets mee
 * moet doen in plaats van hem stil toe te passen of stil over te slaan.
 */
export type RuleStatus =
  /** Door NS bevestigd als actueel en juist. */
  | "VALIDATED"
  /** Letterlijk overgenomen uit de aangeleverde bron, nog niet formeel bevestigd. */
  | "SOURCE_TRANSCRIBED"
  /** De regel bestaat, maar de waarde voor deze standplaats is niet aangeleverd. */
  | "UNVALIDATED_LOCAL_PARAMETER"
  /** De juridische status (hard of prioriteit) moet nog door NS worden vastgesteld. */
  | "NEEDS_POLICY_VALIDATION"
  /** De regel is aangekondigd maar inhoudelijk nog niet uitgewerkt. */
  | "POLICY_PENDING"
  /** De bron laat meerdere lezingen toe; de juiste is niet vast te stellen. */
  | "UNRESOLVED"
  /** De regel hoort te bestaan maar is helemaal niet aangeleverd. */
  | "NOT_SUPPLIED";

/**
 * Statussen waarbij de waarde niet gebruikt mag worden om iets goed te keuren.
 *
 * `NEEDS_POLICY_VALIDATION` staat hier bewust bij. De controle op het
 * regelbestand wees uit dat die status als enige een waarde zou laten
 * doorwerken terwijl NS de juridische status nog moet vaststellen — een regel
 * waarvan onduidelijk is óf hij hard is, mag geen plaatsing goedkeuren en ook
 * niet stilzwijgend worden overgeslagen.
 */
export const BLOCKING_STATUSES: readonly RuleStatus[] = [
  "UNVALIDATED_LOCAL_PARAMETER",
  "NEEDS_POLICY_VALIDATION",
  "POLICY_PENDING",
  "UNRESOLVED",
  "NOT_SUPPLIED",
];

/**
 * Hoe een bron zich gedraagt na zijn contractuele einddatum.
 *
 * Dit is geen detail. Een CAO die op papier tot 1 maart 2025 loopt, is op
 * 2 maart 2025 niet verdwenen: bij stilzwijgende verlenging loopt hij door, en
 * ook ná opzegging blijven de bepalingen vaak gelden tot een opvolger in werking
 * treedt (nawerking). Wie dat niet modelleert, kiest tussen twee fouten — de
 * bepalingen laten vervallen die nog gelden, of doen alsof niets is veranderd.
 * Beide zijn erger dan zeggen dat de actuele status niet is geverifieerd.
 */
export type RenewalRule =
  /** Loopt af op de contractuele einddatum; geen verlenging afgesproken. */
  | { readonly kind: "ENDS_ON_CONTRACTUAL_END" }
  /** Wordt behoudens opzegging telkens verlengd. */
  | {
      readonly kind: "TACIT_RENEWAL";
      readonly termMonths: number;
      /** Blijven de bepalingen na opzegging gelden tot een opvolger er is? */
      readonly survivesUntilSuccessor: boolean;
    }
  /** Geen einddatum afgesproken. */
  | { readonly kind: "OPEN_ENDED" };

/**
 * Is er opgezegd?
 *
 * `UNKNOWN` is uitdrukkelijk geen synoniem van `NO_TERMINATION_KNOWN`. Het
 * eerste betekent dat wij het niet weten; het tweede dat er in onze bron geen
 * opzegging voorkomt. Alleen het tweede is een bewering.
 */
export type TerminationStatus = "NO_TERMINATION_KNOWN" | "TERMINATED" | "UNKNOWN";

/** De juridische status van een bron op een concrete datum. */
export type SourceLegalStatus =
  /** De bron gaat pas later in. */
  | "NOT_YET_IN_FORCE"
  /** Binnen de oorspronkelijke, afgesproken looptijd. */
  | "IN_ORIGINAL_TERM"
  /**
   * Na de contractuele einddatum, zonder bekende opvolger. De bepalingen zijn
   * niet vervallen, maar of ze in deze vorm nog gelden is niet vastgesteld.
   */
  | "CURRENT_LEGAL_STATUS_NOT_VERIFIED"
  /** Vervangen door een bekende opvolger. */
  | "SUPERSEDED";

export interface RuleSource {
  readonly layer: RuleLayer;
  /** Korte code, bijvoorbeeld "CAO-NS-2024-2025". */
  readonly document: string;
  readonly documentTitle: string;
  readonly article?: string;
  readonly paragraph?: string;
  /**
   * Wie deze regel stelt.
   *
   * `PRODUCT` is uitdrukkelijk geen juridische bron: het is beleid van dit
   * platform. Het staat in dezelfde opsomming zodat het nergens per ongeluk
   * voor een NS-bron kan doorgaan.
   */
  readonly legalAuthority:
    | "WET"
    | "CAO"
    | "BEDRIJF"
    | "REGIO"
    | "LOKAAL"
    | "INDIVIDUEEL"
    | "PRODUCT";
  /** ISO-datum waarop de bron in werking trad. */
  readonly effectiveFrom: string;
  /**
   * Het einde van de oorspronkelijke looptijd zoals de bron dat zelf noemt.
   *
   * Uitdrukkelijk niet "de datum waarop de regels vervallen": wat er ná deze
   * datum gebeurt, staat in `renewalRule`.
   */
  readonly contractualEnd: string | null;
  readonly renewalRule: RenewalRule;
  readonly terminationKnown: TerminationStatus;
  /** De opvolger, wanneer die bekend is. */
  readonly supersededBy: string | null;
}

/**
 * De juridische status van deze bron op deze datum.
 *
 * Levert nooit "verlopen" op grond van een einddatum alleen. Dat oordeel vraagt
 * kennis die wij niet hebben — of er is opgezegd, en of er een opvolger is — en
 * die onwetendheid hoort in de uitkomst te staan in plaats van te worden
 * ingevuld.
 */
export function currentLegalStatus(source: RuleSource, onDate: string): SourceLegalStatus {
  if (onDate < source.effectiveFrom) {
    return "NOT_YET_IN_FORCE";
  }
  if (source.supersededBy !== null) {
    return "SUPERSEDED";
  }
  if (source.contractualEnd === null || onDate <= source.contractualEnd) {
    return "IN_ORIGINAL_TERM";
  }
  if (source.renewalRule.kind === "OPEN_ENDED") {
    return "IN_ORIGINAL_TERM";
  }
  return "CURRENT_LEGAL_STATUS_NOT_VERIFIED";
}

/** Geldt deze bron op deze datum, ongeacht of de actuele status is bevestigd? */
export function sourceApplies(source: RuleSource, onDate: string): boolean {
  const status = currentLegalStatus(source, onDate);
  return status === "IN_ORIGINAL_TERM" || status === "CURRENT_LEGAL_STATUS_NOT_VERIFIED";
}

/** Functiegroepen. Uitzonderingen zijn nooit automatisch overdraagbaar. */
export const EMPLOYEE_GROUPS = [
  "MACHINIST",
  "HOOFDCONDUCTEUR",
  "RANGEERDER",
  "NEDTRAIN",
  "TICKETS_SERVICE",
  "OVERIG",
] as const;
export type EmployeeGroup = (typeof EMPLOYEE_GROUPS)[number];

export const COMPANIES = ["NSR", "NS_INTERNATIONAL", "NEDTRAIN", "OVERIG"] as const;
export type Company = (typeof COMPANIES)[number];

/**
 * Waar een regel op van toepassing is.
 *
 * Een uitzondering voor NedTrain geldt niet voor machinisten in Dordrecht, ook
 * niet als hij toevallig in hetzelfde document staat. Dat afdwingen is de reden
 * dat dit veld verplicht is.
 */
export interface RuleScope {
  readonly employeeGroups: readonly EmployeeGroup[] | "ALL";
  readonly companies: readonly Company[] | "ALL";
  /** Standplaatscodes, of ALL. */
  readonly locations: readonly string[] | "ALL";
}

/** De vensters die een regel nodig heeft om beoordeeld te kunnen worden. */
export const CONTEXT_WINDOWS = [
  "ADJACENT_DUTIES",
  "DAYS_7",
  "DAYS_14",
  "WEEKS_4",
  "WEEKS_5",
  "WEEKS_16",
  "WEEKS_52",
  "CALENDAR_QUARTER",
  "CALENDAR_YEAR",
] as const;
export type ContextWindow = (typeof CONTEXT_WINDOWS)[number];

/** Hoeveel dagen terug en vooruit een venster minimaal vraagt. */
export const CONTEXT_SPAN_DAYS: Record<ContextWindow, { back: number; forward: number }> = {
  // Aangrenzende diensten: één dag is te weinig, want de dienst ervoor kan een
  // rustdag verderop liggen. Drie dagen aan weerszijden dekt elke reële
  // dienstafstand binnen een basisrooster.
  ADJACENT_DUTIES: { back: 3, forward: 3 },
  DAYS_7: { back: 7, forward: 7 },
  DAYS_14: { back: 14, forward: 14 },
  WEEKS_4: { back: 28, forward: 0 },
  WEEKS_5: { back: 35, forward: 0 },
  WEEKS_16: { back: 112, forward: 0 },
  WEEKS_52: { back: 364, forward: 0 },
  CALENDAR_QUARTER: { back: 92, forward: 92 },
  CALENDAR_YEAR: { back: 366, forward: 366 },
};

export interface RuleDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: RuleCategory;
  /** Waarom de regel bestaat. Verschijnt letterlijk in de regelcatalogus. */
  readonly rationale: string;
  readonly source: RuleSource;
  readonly scope: RuleScope;
  readonly status: RuleStatus;
  /**
   * De waarde. `null` betekent uitdrukkelijk "niet aangeleverd" en nooit
   * "geen beperking".
   */
  readonly value: number | null;
  readonly unit: "MINUTES" | "HOURS" | "COUNT" | "RATIO" | "NONE";
  readonly contextWindows: readonly ContextWindow[];
  readonly validatedBy: string | null;
  readonly validatedAt: string | null;
  /** Toelichting bij een status die niet VALIDATED is. */
  readonly note?: string;
}

/** Een heel regelpakket dat ontbreekt, niet één losse waarde. */
export interface MissingRulePackage {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
  /** Welke beslissingen hierdoor niet veilig te nemen zijn. */
  readonly blocks: readonly string[];
}

export type RulesetMode = "SOURCE_RULESET_SIMULATION" | "PRODUCTION";

export type LegalStatus =
  | "LEGAL_RULESET_NOT_CURRENTLY_VERIFIED"
  | "LEGAL_RULESET_VERIFIED";

export interface Ruleset {
  readonly version: string;
  readonly mode: RulesetMode;
  readonly legalStatus: LegalStatus;
  readonly compiledAt: string;
  readonly rules: readonly RuleDefinition[];
  readonly missingPackages: readonly MissingRulePackage[];
}

// ── Opzoeken met reikwijdte ──────────────────────────────────────────────────

/** Waarvoor een regel wordt opgezocht. */
export interface RuleContext {
  readonly employeeGroup: EmployeeGroup;
  readonly company: Company;
  readonly location: string;
  /** ISO-datum van de dag waarop de regel moet gelden. */
  readonly onDate: string;
}

function scopeMatches(scope: RuleScope, context: RuleContext): boolean {
  const groupOk =
    scope.employeeGroups === "ALL" || scope.employeeGroups.includes(context.employeeGroup);
  const companyOk = scope.companies === "ALL" || scope.companies.includes(context.company);
  const locationOk = scope.locations === "ALL" || scope.locations.includes(context.location);
  return groupOk && companyOk && locationOk;
}



/**
 * De regels met dit id die op deze situatie van toepassing zijn.
 *
 * Meerdere treffers zijn normaal: een algemene CAO-norm en een strengere
 * uitzondering voor rijdend personeel kunnen naast elkaar bestaan. Welke wint,
 * beslist `resolveRule` — niet een toevallige `Math.max`.
 */
export function applicableRules(
  ruleset: Ruleset,
  id: string,
  context: RuleContext,
): readonly RuleDefinition[] {
  return ruleset.rules.filter(
    (rule) =>
      rule.id === id && scopeMatches(rule.scope, context) && sourceApplies(rule.source, context.onDate),
  );
}

export type RuleResolution =
  | {
      readonly kind: "RESOLVED";
      readonly rule: RuleDefinition;
      /** De juridische status van de bron op de gevraagde datum. */
      readonly sourceStatus: SourceLegalStatus;
    }
  /** De regel bestaat, maar de waarde is niet bruikbaar. */
  | { readonly kind: "UNUSABLE"; readonly rule: RuleDefinition }
  /**
   * De regel geldt voor deze medewerker, maar geen enkele versie ervan is
   * geldig op deze datum.
   */
  | { readonly kind: "OUT_OF_PERIOD"; readonly rule: RuleDefinition }
  /** Deze regel gaat niet over deze medewerker. */
  | { readonly kind: "NOT_APPLICABLE" }
  /** De regel hoort te bestaan maar staat niet in het pakket. */
  | { readonly kind: "UNKNOWN" };

/**
 * Welke regel geldt, en of hij bruikbaar is.
 *
 * ## Hoe een conflict wordt beslecht
 *
 * Niet met `Math.max` op de waarde: dat werkt toevallig bij minimumrust en
 * precies verkeerd bij een maximum. De volgorde is:
 *
 *  1. de meest specifieke reikwijdte wint — een regel voor machinisten in
 *     Dordrecht gaat vóór een algemene CAO-regel;
 *  2. bij gelijke specificiteit wint de hogere bronlaag (wet vóór CAO vóór
 *     regio vóór lokaal);
 *  3. bij gelijke laag wint de meest recente ingangsdatum.
 *
 * Dat een uitzondering strenger uitpakt, is een gevolg — geen aanname.
 *
 * ## Drie dingen die niet hetzelfde zijn
 *
 * "Gaat niet over deze medewerker", "geldt op deze datum niet meer" en "geldt
 * wel, maar of hij nog actueel is staat niet vast" zijn drie verschillende
 * antwoorden. Ze zijn hier eerder één keer op één hoop gegaan, met als gevolg
 * een systeem dat na de contractuele einddatum van de CAO elke plaatsing zonder
 * één bevinding goedkeurde.
 *
 * De contractuele einddatum alléén levert nooit "niet van toepassing" op. Een
 * CAO met stilzwijgende verlenging en nawerking loopt door; wat wij niet weten
 * is of hij inmiddels is opgezegd of vervangen. Dat levert
 * `CURRENT_LEGAL_STATUS_NOT_VERIFIED` op de resolutie op: de regel wordt
 * toegepast, en de onzekerheid reist mee tot in de uitkomst.
 */
export function resolveRule(
  ruleset: Ruleset,
  id: string,
  context: RuleContext,
): RuleResolution {
  const known = ruleset.rules.some((rule) => rule.id === id);
  if (!known) {
    return { kind: "UNKNOWN" };
  }

  const inScope = ruleset.rules.filter(
    (rule) => rule.id === id && scopeMatches(rule.scope, context),
  );
  if (inScope.length === 0) {
    return { kind: "NOT_APPLICABLE" };
  }

  const candidates = inScope.filter((rule) => sourceApplies(rule.source, context.onDate));
  if (candidates.length === 0) {
    // De bron gaat pas later in, of is aantoonbaar vervangen. Alleen dán is een
    // regel buiten zijn periode; niet omdat een contractuele einddatum is
    // gepasseerd.
    const mostRecent = [...inScope].sort((a, b) =>
      b.source.effectiveFrom.localeCompare(a.source.effectiveFrom),
    )[0];
    return { kind: "OUT_OF_PERIOD", rule: mostRecent };
  }

  const winner = [...candidates].sort((a, b) => {
    const specificity = specificityOf(b.scope) - specificityOf(a.scope);
    if (specificity !== 0) {
      return specificity;
    }
    const layer = layerRank(a.source.layer) - layerRank(b.source.layer);
    if (layer !== 0) {
      return layer;
    }
    return b.source.effectiveFrom.localeCompare(a.source.effectiveFrom);
  })[0];

  if (winner.value === null || BLOCKING_STATUSES.includes(winner.status)) {
    return { kind: "UNUSABLE", rule: winner };
  }
  return {
    kind: "RESOLVED",
    rule: winner,
    sourceStatus: currentLegalStatus(winner.source, context.onDate),
  };
}

/** Hoe specifiek een reikwijdte is. Meer beperkingen = specifieker. */
function specificityOf(scope: RuleScope): number {
  return (
    (scope.employeeGroups === "ALL" ? 0 : 1) +
    (scope.companies === "ALL" ? 0 : 1) +
    (scope.locations === "ALL" ? 0 : 1)
  );
}

/** Minuten uit een regelwaarde, ongeacht de opgegeven eenheid. */
export function ruleMinutes(rule: RuleDefinition): number {
  if (rule.value === null) {
    throw new Error(`Regel ${rule.id} heeft geen waarde.`);
  }
  return rule.unit === "HOURS" ? rule.value * 60 : rule.value;
}
