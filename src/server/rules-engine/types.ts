import type {
  DutyKind,
  ReservePreferenceKind,
  RosterPositionType,
  RosterProfile,
} from "@/lib/generated/prisma/enums";
import type { CalendarDate } from "@/domain/time";
import type { BaselineSlot, RosterChangeType } from "@/domain/roster-structure";
import type { Company, EmployeeGroup } from "./ruleset/types";
import type {
  AuthorisedException,
  PlanningStage,
  Protection,
} from "./validation/subject";
import type {
  ContextGap,
  MissingRule,
  RuleCoverage,
  ValidationOutcome,
} from "./validation/result";

/**
 * De contracten van de Rules Engine.
 *
 * Dit bestand is met opzet het enige dat de rest van de applicatie van de
 * rules engine hoeft te kennen. Services praten tegen `RulesEngine`, nooit
 * tegen een concrete implementatie. Wanneer de centrale Rules Engine van NS
 * beschikbaar komt, wordt een tweede implementatie van dit contract
 * aangesloten en verandert er verder niets.
 *
 * ## Waarom alle vier de gebruiksmomenten dezelfde primitieve gebruiken
 *
 * Roosters genereren, een ruil toetsen, beschikbare diensten tonen en een
 * reservedienst invullen zijn op het oog vier vraagstukken. Ze zijn het niet:
 * ze vragen alle vier of het houdbaar is dat medewerker E op dag D dienst X
 * rijdt, gegeven wat er direct voor en na staat. Die vraag heet hier
 * `AssignmentCheck`, en elke regel is een functie daarover.
 *
 * Een ruil is daarmee twee controles — een per medewerker, elk met de dienst
 * die hij inlevert weggehaald en de dienst die hij krijgt ingevuld. Dat is
 * precies waarom de dienst voor én na de ruildag bij beide medewerkers wordt
 * meegenomen: dat volgt uit het model in plaats van uit een losse regel die
 * iemand kan vergeten.
 *
 * ## Geen persoonsgegevens
 *
 * Geen enkel type hier kent een naam of e-mailadres. De engine werkt op
 * `employeeId` en `employeeNumber`. Dat is geen toeval maar een ontwerpeis: een
 * engine die geen namen kan ontvangen, kan ze ook niet lekken in uitleg,
 * logregels of exports.
 */

// ── Regels ───────────────────────────────────────────────────────────────────

/**
 * De drie soorten regels, strikt gescheiden.
 *
 *  - `HARD_CONSTRAINT`   mag nooit worden overtreden. Blokkeert.
 *  - `SOFT_CONSTRAINT`   liefst niet overtreden. Waarschuwt en telt mee in de
 *                        weging, maar houdt niets tegen.
 *  - `OPTIMIZATION_OBJECTIVE` een doel om op te sturen bij het genereren van
 *                        roosters. Levert een score, geen oordeel.
 */
export type RuleCategory = "HARD_CONSTRAINT" | "SOFT_CONSTRAINT" | "OPTIMIZATION_OBJECTIVE";

export type RuleSeverity = "INFO" | "WARNING" | "VIOLATION";

/** De momenten waarop de engine bevraagd wordt. */
export type RuleRequestType =
  | "DUTY_ELIGIBILITY"
  | "SWAP_PROPOSAL"
  | "RESERVE_FILL"
  | "ROSTER_CHANGE"
  | "ROSTER_GENERATION";

/** Beschrijving van een regel, voor uitleg aan planners en medewerkers. */
export interface RuleDefinition {
  /** Stabiele identificatie, bijvoorbeeld "hard.minimum-rust". */
  readonly id: string;
  readonly category: RuleCategory;
  readonly title: string;
  /** Waarom de regel bestaat. Verschijnt letterlijk in de interface. */
  readonly rationale: string;
  /** Bij welke vragen deze regel meedoet. */
  readonly appliesTo: readonly RuleRequestType[];
}

/** Een uitkomst van een regel op een concrete situatie. */
export interface RuleFinding {
  readonly ruleId: string;
  readonly category: RuleCategory;
  readonly severity: RuleSeverity;
  /** Uitlegbare tekst voor de gebruiker. Bevat nooit een naam. */
  readonly message: string;
  /** Op wie de bevinding slaat. Bij een ruil zijn dat er twee. */
  readonly employeeNumber?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type RuleDecision = "ALLOW" | "WARN" | "BLOCK";

/** Wat een evaluatie oplevert. */
export interface RuleEvaluationResult {
  readonly decision: RuleDecision;
  /**
   * De uitkomst in vijf smaken.
   *
   * `decision` kent er maar drie en gooit "verboden" en "niet te beoordelen" op
   * één hoop. Voor blokkeren maakt dat niet uit — beide blokkeren — maar voor
   * wat een gebruiker eraan moet doen wél: het ene los je op met een ander
   * rooster, het andere met een ontbrekende regel.
   */
  readonly outcome: ValidationOutcome;
  readonly findings: readonly RuleFinding[];
  /** Regels of parameters die nodig waren en ontbraken. */
  readonly missingRules: readonly MissingRule[];
  /** Vensters waarvoor onvoldoende roosterhistorie beschikbaar was. */
  readonly contextGaps: readonly ContextGap[];
  /**
   * Regels waarvan de bron voorbij zijn contractuele einddatum loopt zonder
   * bekende opvolger. Toegepast, maar met onbevestigde actuele status.
   */
  readonly rulesWithUnverifiedCurrency: readonly string[];
  /** Per regel en venster: hoeveel historie er nodig was en hoeveel er was. */
  readonly contextCoverage: readonly RuleCoverage[];
  readonly rulesetVersion: string;
  readonly rulesetMode: string;
  readonly legalStatus: string;
  /**
   * Wenselijkheid van 0 tot 1, afgeleid uit de soft constraints. Ordent
   * kandidaten; bepaalt nooit of iets is toegestaan.
   */
  readonly score: number;
  readonly engine: { readonly name: string; readonly version: string };
  /** SHA-256 van de genormaliseerde invoer, zodat de uitkomst herleidbaar is. */
  readonly inputDigest: string;
}

// ── Contextobjecten (naamloos) ───────────────────────────────────────────────

/** Wat de engine van een medewerker weet. Geen persoonsgegevens. */
export interface EmployeeContext {
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly rosterProfile: RosterProfile;
  readonly depot: string;
  readonly qualifications: readonly string[];
  readonly reservePreference: ReservePreferenceKind;
  /** Functiegroep. Een uitzondering voor de ene groep geldt nooit voor de andere. */
  readonly employeeGroup: EmployeeGroup;
  readonly company: Company;
  /** Uren per week. Null blokkeert elke urenregel; er wordt niets aangenomen. */
  readonly contractHours: number | null;
  /** Uitdrukkelijk vastgelegd, nooit afgeleid uit gedrag. */
  readonly earlyStartProtectionWaived: boolean;
  /** Abstracte beschermingsconstraints. Nooit de reden erachter. */
  readonly protections: readonly Protection[];
}

/** Wat de engine van een dienst weet. */
export interface DutyContext {
  readonly dutyId: string;
  readonly code: string;
  readonly kinds: readonly DutyKind[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly requiredQualifications: readonly string[];
  /** Dienstzwaarte 1 tot en met 5. */
  readonly weight: number;
  /** Geplande pauze in minuten, of null wanneer die niet is vastgelegd. */
  readonly breakMinutes: number | null;
  readonly overtimeMinutes: number;
}

/** Een dag in het rooster van een medewerker. */
export interface ScheduleDayContext {
  readonly date: CalendarDate;
  readonly positionType: RosterPositionType;
  /** Gevuld wanneer positionType DUTY is, of wanneer een RES-dag is ingevuld. */
  readonly duty: DutyContext | null;
}

/**
 * De historie die de engine nodig heeft voor regels over reeksen: opeenvolgende
 * werkdagen, opeenvolgende weekenden, verdeling over dienstsoorten.
 *
 * Bewust een apart object en niet een oneindig rooster: de aanroeper bepaalt
 * hoe ver hij terugkijkt, en die keuze staat in de evaluatie vastgelegd.
 */
export interface ScheduleWindow {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly days: readonly ScheduleDayContext[];
}

/**
 * De centrale vraag: mag medewerker E op datum D dienst X rijden?
 *
 * `window` bevat het rooster van deze medewerker rond die datum, waarin de
 * dienst die hij eventueel inlevert al is verwijderd. De regel over rust vóór
 * en na kijkt daarin naar de dichtstbijzijnde dienst aan beide kanten.
 */
export interface AssignmentCheck {
  readonly employee: EmployeeContext;
  readonly date: CalendarDate;
  readonly duty: DutyContext;
  readonly window: ScheduleWindow;
  /** De dienst die deze medewerker inlevert. Null bij een extra dienst. */
  readonly surrendering: DutyContext | null;
  /**
   * De planningsfase. Bepaalt of een niet-planmatige uitzondering überhaupt kan
   * bestaan: in een basisrooster kan zij dat per definitie niet.
   */
  readonly planningStage: PlanningStage;
  /** Formeel verleende uitzonderingen voor deze plaatsing. */
  readonly exceptions: readonly AuthorisedException[];
  /** Wat er op deze dag stond vóór de plaatsing. */
  readonly replacedPosition: RosterPositionType | null;
  /**
   * Nieuwe dienstregeling of wijzigingsblad. Ontbreekt de waarde, dan geldt
   * `NEW_TIMETABLE`: de ronde waarin de structuur hoort te worden bepaald.
   */
  readonly changeType?: RosterChangeType;
  /**
   * Wat er in het vastgestelde jaarrooster op deze cyclusdag staat. Bij een
   * wijzigingsblad de enige bron waartegen een ankerverschuiving zichtbaar
   * wordt; `replacedPosition` is de huidige stand en kan zelf al verschoven
   * zijn.
   */
  readonly baselineSlot?: BaselineSlot | null;
}

// ── Verzoeken ────────────────────────────────────────────────────────────────

export interface DutyEligibilityRequest {
  readonly type: "DUTY_ELIGIBILITY";
  readonly check: AssignmentCheck;
}

/**
 * Een ruilvoorstel: twee medewerkers, twee concrete diensten, twee data.
 * Beide kanten worden volledig doorgerekend; een ruil die voor een van beiden
 * niet kan, kan niet.
 */
export interface SwapProposalRequest {
  readonly type: "SWAP_PROPOSAL";
  readonly initiator: AssignmentCheck;
  readonly counterparty: AssignmentCheck;
}

export interface ReserveFillRequest {
  readonly type: "RESERVE_FILL";
  readonly check: AssignmentCheck;
  /** Stond deze medewerker die dag daadwerkelijk op een RES-positie? */
  readonly onReservePosition: boolean;
}

export interface RosterChangeRequest {
  readonly type: "ROSTER_CHANGE";
  readonly checks: readonly AssignmentCheck[];
  readonly reason: string;
}

/**
 * Het genereren van roosters. Het verzoek is volledig uitgewerkt zodat de
 * latere optimizer niets nieuws hoeft te leren; de implementatie in dit
 * project is een placeholder.
 */
export interface RosterGenerationRequest {
  readonly type: "ROSTER_GENERATION";
  /**
   * Alle basisroosters tegelijk. Bewust een lijst en geen enkel rooster: de
   * opdracht is expliciet dat roosters gezamenlijk geoptimaliseerd worden en
   * niet het ene na het andere.
   */
  readonly baseRosterIds: readonly string[];
  readonly employees: readonly EmployeeContext[];
  readonly duties: readonly DutyContext[];
  readonly horizon: { readonly from: CalendarDate; readonly to: CalendarDate };
  /** Geaggregeerde feedback per roosterprofiel. Nooit per persoon. */
  readonly aggregatedFeedback: readonly AggregatedFeedbackSignal[];
  /** Gewichten per doelstelling; sturen de optimizer, niet de toelaatbaarheid. */
  readonly objectiveWeights: Readonly<Record<string, number>>;
}

/** Geaggregeerd feedbacksignaal. Bevat aantallen, geen individuen. */
export interface AggregatedFeedbackSignal {
  readonly rosterProfile: RosterProfile;
  readonly category: string;
  readonly share: number;
  readonly respondents: number;
}

export interface RosterGenerationResult {
  readonly status: "NOT_IMPLEMENTED" | "GENERATED" | "FAILED";
  readonly message: string;
  readonly versionId?: string;
  readonly findings: readonly RuleFinding[];
  readonly engine: { readonly name: string; readonly version: string };
}

// ── Het contract ─────────────────────────────────────────────────────────────

/**
 * De Rules Engine.
 *
 * Elke roosterbeslissing in de applicatie loopt hierlangs. Er staan geen
 * roosterregels in componenten, in route handlers of in repositories; wie daar
 * een regel tegenkomt, heeft een bug gevonden.
 */
export interface RulesEngine {
  readonly name: string;
  readonly version: string;

  /** Alle regels die deze engine kent, voor uitleg en verantwoording. */
  describeRules(): readonly RuleDefinition[];

  /** Mag deze medewerker deze beschikbare dienst zien en oppakken? */
  evaluateDutyEligibility(request: DutyEligibilityRequest): Promise<RuleEvaluationResult>;

  /** Is deze ruil geldig voor beide medewerkers? */
  evaluateSwap(request: SwapProposalRequest): Promise<RuleEvaluationResult>;

  /** Kan deze reservemedewerker deze dienst opvangen? */
  evaluateReserveFill(request: ReserveFillRequest): Promise<RuleEvaluationResult>;

  /** Houdt een roosterwijziging van de planner stand? */
  evaluateRosterChange(request: RosterChangeRequest): Promise<RuleEvaluationResult>;

  /** Genereer roosters. In dit project een placeholder. */
  generateRoster(request: RosterGenerationRequest): Promise<RosterGenerationResult>;
}
