import type { DutyKind, RosterPositionType, RosterProfile } from "@/lib/generated/prisma/enums";
import type { CandidateRoster, OptimizerMode } from "@/domain/candidate";

/**
 * Het contract van de rooster-optimizer.
 *
 * ## Wat een optimizer is en niet is
 *
 * Een optimizer stelt voor. Hij beslist niet. Alles in dit bestand is daarop
 * gebouwd: de invoer bevat geen middel om iets te schrijven, de uitvoer bevat
 * geen veld waarin geldigheid kan worden beweerd, en er zit geen
 * databaseverbinding in de buurt. Een fout in een optimizer kan daardoor een
 * verkeerd vóórstel opleveren en nooit een verkeerd rooster.
 *
 * ## Waarom alle profielen in één invoer zitten
 *
 * Vroeg, Laat, Mix en de rest zijn geen losse problemen. Wie ze na elkaar
 * oplost, geeft het eerste profiel de beste diensten en laat het laatste
 * opruimen. De invoer beschrijft daarom het hele vraagstuk in één keer, ook nu
 * de eerste implementatie er nog niet globaal over optimaliseert: het contract
 * hoeft later niet te veranderen.
 */

// ── Invoer ───────────────────────────────────────────────────────────────────

export interface OptimizerDuty {
  readonly code: string;
  readonly kinds: readonly DutyKind[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly breakMinutes: number | null;
  readonly overtimeMinutes: number;
  readonly depot: string;
  readonly requiredQualifications: readonly string[];
  readonly weight: number;
  /** Op welke weekdagen deze dienst gereden wordt (1–7). */
  readonly weekdays: readonly number[];
}

export interface OptimizerLineDay {
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: RosterPositionType;
  readonly dutyCode: string | null;
}

export interface OptimizerLine {
  readonly baseRosterCode: string;
  readonly profile: RosterProfile;
  readonly lineNumber: number;
  readonly cycleWeeks: number;
  readonly days: readonly OptimizerLineDay[];
  /**
   * De contractomvang van de medewerker die deze lijn bezet, in uren per week.
   * Null wanneer de lijn onbezet is of de omvang niet is vastgelegd — er wordt
   * niets aangenomen.
   */
  readonly contractHours: number | null;
  /** Personeelsnummer van de bezetter. Nooit een naam. */
  readonly occupiedBy: string | null;
}

/**
 * Een harde constraint zoals de optimizer hem kan gebruiken.
 *
 * Afgeleid uit de centrale regelcatalogus, nooit zelf geformuleerd. Kan een
 * regel niet naar een optimizerconstraint worden vertaald, dan staat dat er met
 * zoveel woorden bij en mag de optimizer alsnog kandidaten maken — de
 * onafhankelijke validator blijft beslissend.
 */
export interface OptimizerConstraint {
  readonly ruleId: string;
  readonly title: string;
  readonly unit: "MINUTES" | "HOURS" | "COUNT" | "RATIO" | "NONE";
  readonly value: number | null;
  readonly translatable: boolean;
  /** Waarom hij niet te vertalen is, wanneer dat zo is. */
  readonly untranslatableReason?: string;
}

export interface OptimizerObjective {
  readonly id: string;
  readonly weight: number;
}

/** Geaggregeerd feedbacksignaal. Aantallen, nooit individuen. */
export interface AggregatedFeedback {
  readonly rosterProfile: RosterProfile;
  readonly category: string;
  /** Aandeel van 0 tot 1. */
  readonly share: number;
  readonly respondents: number;
}

/**
 * Historische belasting per roosterlijn.
 *
 * Voorbereid en bewust leeg gelaten. Eerlijkheid over één roosterperiode is
 * makkelijker dan eerlijkheid over jaren, en met 91 dagen historie zou elke
 * uitspraak hierover ruis zijn. Zodra er betrouwbare historie is, komt zij
 * hierlangs binnen zonder dat het contract verandert.
 */
export interface HistoricalBurden {
  readonly baseRosterCode: string;
  readonly lineNumber: number;
  readonly historicalNightBurden: number;
  readonly historicalWeekendBurden: number;
  readonly historicalShuntingBurden: number;
  /** Over hoeveel dagen historie dit is gemeten. Nul betekent: niet bruikbaar. */
  readonly observedDays: number;
}

export interface OptimizerInput {
  readonly depot: string;
  readonly duties: readonly OptimizerDuty[];
  readonly rosterProfiles: readonly RosterProfile[];
  readonly rosterLines: readonly OptimizerLine[];
  readonly contractualHours: readonly {
    readonly baseRosterCode: string;
    readonly lineNumber: number;
    readonly hours: number | null;
  }[];
  readonly hardConstraints: readonly OptimizerConstraint[];
  readonly softObjectives: readonly OptimizerObjective[];
  readonly aggregatedFeedback: readonly AggregatedFeedback[];
  readonly historicalBurden: readonly HistoricalBurden[];

  readonly sourceScheduleVersion: string;
  readonly rulesetVersion: string;
  readonly inputDataVersion: string;
  readonly mode: OptimizerMode;
}

// ── Uitvoer ──────────────────────────────────────────────────────────────────

/**
 * Waarom een optimizer niets heeft opgeleverd.
 *
 * Een optimizer die bij problemen een half rooster teruggeeft, is gevaarlijker
 * dan een die weigert: het halve rooster ziet eruit als een resultaat.
 */
export interface OptimizerRefusal {
  readonly status: "REFUSED";
  readonly reason: string;
}

export type OptimizerOutcome =
  | { readonly status: "CANDIDATE_GENERATED"; readonly candidate: CandidateRoster }
  | OptimizerRefusal;

export interface RosterOptimizer {
  readonly name: string;
  readonly version: string;
  /** Korte uitleg van wat deze implementatie doet, voor de planner. */
  readonly describe: string;
  generate(input: OptimizerInput, scenario: string): Promise<OptimizerOutcome>;
}
