import { createHash } from "node:crypto";
import type { RosterPositionType, RosterProfile } from "@/lib/generated/prisma/enums";

/**
 * Een roosterkandidaat.
 *
 * ## Waarom dit in `domain/` staat en niet bij de optimizer
 *
 * De optimizer maakt kandidaten; de validator beoordeelt ze. Zou het type bij de
 * optimizer wonen, dan moest de validator daaruit importeren — en dan is de
 * scheiding tussen "wie stelt voor" en "wie keurt goed" alleen nog een afspraak.
 * Nu is zij een eigenschap van de code: de validator kent de optimizer niet, en
 * een fout in de vertaling van constraints kan dus niet door de validator worden
 * meegenomen.
 *
 * ## Waarom een kandidaat niet kan zeggen dat hij geldig is
 *
 * Het enige wat de optimizer over een kandidaat mag beweren, is dat hij hem
 * gegenereerd heeft: `status: "CANDIDATE_GENERATED"`. Juridische geldigheid is
 * geen veld dat de maker invult. Zij is de uitkomst van een aparte, onafhankelijke
 * beoordeling, en die staat in `ReviewableRoster`.
 */

/** De enige modus die op dit moment bestaat. */
export type OptimizerMode = "SIMULATION";

/**
 * De juridische status van een kandidaat.
 *
 * Zolang de regelverzameling niet door NS is gevalideerd, kan hier niets anders
 * staan dan `SIMULATION_ONLY`. Dat is geen tijdelijke instelling maar een
 * afgeleide van de bronstatus.
 */
export type CandidateLegalStatus = "SIMULATION_ONLY" | "LEGALLY_VALIDATED";

/** Het enige wat een optimizer over zijn eigen uitkomst mag zeggen. */
export type CandidateStatus = "CANDIDATE_GENERATED";

export interface CandidateAssignment {
  readonly baseRosterCode: string;
  readonly lineNumber: number;
  readonly weekIndex: number;
  /** 1 = maandag tot en met 7 = zondag (ISO-8601). */
  readonly weekday: number;
  readonly positionType: RosterPositionType;
  /** Dienstnummer wanneer positionType DUTY is. */
  readonly dutyCode: string | null;
}

/**
 * De kwaliteitsscore.
 *
 * Elk onderdeel loopt van 0 tot 100 en drukt uitsluitend wenselijkheid uit.
 * `overallQualityScore` van 100 betekent "zo goed als dit model kan meten" en
 * uitdrukkelijk niet "juridisch in orde". Die twee zijn hier bewust niet op één
 * as gezet: zodra ze dat wel zijn, is er een wisselkoers tussen kwaliteit en
 * rechtmatigheid, en dan is een overtreding te koop.
 */
export interface ScoreBreakdown {
  readonly restQuality: number;
  readonly weekendBalance: number;
  readonly nightBalance: number;
  readonly earlyBalance: number;
  readonly lateBalance: number;
  readonly shuntingBalance: number;
  readonly reserveBalance: number;
  readonly patternQuality: number;
  readonly feedbackAlignment: number;
  readonly overallQualityScore: number;
}

/**
 * De versies waaraan een kandidaat vastzit.
 *
 * Alle drie moeten bij beoordeling nog hetzelfde zijn. Verandert er één, dan is
 * de kandidaat gemaakt voor een werkelijkheid die niet meer bestaat.
 */
export interface CandidateProvenance {
  /** De basisroosters en lijnen waarop gegenereerd is. */
  readonly sourceScheduleVersion: string;
  /** De versie van het regelbestand. */
  readonly rulesetVersion: string;
  /** Diensten, medewerkers, contracturen en beperkingen. */
  readonly inputDataVersion: string;
}

export interface CandidateRoster extends CandidateProvenance {
  readonly id: string;
  readonly status: CandidateStatus;
  readonly optimizerName: string;
  readonly optimizerVersion: string;
  readonly generatedAt: string;
  readonly mode: OptimizerMode;
  readonly legalStatus: CandidateLegalStatus;
  readonly scenarioLabel: string;
  readonly assignments: readonly CandidateAssignment[];
  readonly scoreBreakdown: ScoreBreakdown;
  /** Vingerafdruk over alles hierboven behalve zichzelf. */
  readonly hash: string;
}

/** De profielen waarop een kandidaat betrekking heeft. */
export interface CandidateScope {
  readonly profiles: readonly RosterProfile[];
  readonly depot: string;
}

// ── Onveranderlijkheid ───────────────────────────────────────────────────────

/**
 * De vingerafdruk van een kandidaat.
 *
 * Bewust over de inhoud én de herkomst: twee kandidaten met dezelfde
 * toewijzingen maar een ander regelbestand zijn niet hetzelfde voorstel.
 */
export function candidateHash(candidate: Omit<CandidateRoster, "hash">): string {
  const normalised = {
    optimizer: `${candidate.optimizerName}@${candidate.optimizerVersion}`,
    mode: candidate.mode,
    scenario: candidate.scenarioLabel,
    sourceScheduleVersion: candidate.sourceScheduleVersion,
    rulesetVersion: candidate.rulesetVersion,
    inputDataVersion: candidate.inputDataVersion,
    assignments: [...candidate.assignments]
      .map(
        (entry) =>
          `${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|` +
          `${entry.weekday}|${entry.positionType}|${entry.dutyCode ?? ""}`,
      )
      .sort(),
  };
  return createHash("sha256").update(JSON.stringify(normalised)).digest("hex");
}

/**
 * Bevriest een kandidaat en zet zijn vingerafdruk erop.
 *
 * Een wijziging maakt een nieuwe kandidaat; dit object verandert niet meer.
 * `Object.freeze` is geen sluitende garantie tegen kwaadwillendheid, maar wel
 * tegen de veel waarschijnlijkere fout: code die "even" een toewijzing aanpast
 * nadat de score al is berekend.
 */
export function sealCandidate(candidate: Omit<CandidateRoster, "hash">): CandidateRoster {
  const sealed: CandidateRoster = {
    ...candidate,
    assignments: Object.freeze([...candidate.assignments].map((entry) => Object.freeze(entry))),
    scoreBreakdown: Object.freeze({ ...candidate.scoreBreakdown }),
    hash: candidateHash(candidate),
  };
  return Object.freeze(sealed);
}

/** Klopt de vingerafdruk nog met de inhoud? */
export function isUnmodified(candidate: CandidateRoster): boolean {
  const { hash, ...rest } = candidate;
  return candidateHash(rest) === hash;
}

// ── Beoordeling ──────────────────────────────────────────────────────────────

export type CandidateValidationStatus =
  /** Nog niet door de onafhankelijke validator geweest. */
  | "NOT_VALIDATED"
  /**
   * Door de validator heen: geen bevestigde overtreding, geen mogelijke
   * overtreding, geen ontbrekende regel, geen ontbrekende kritieke context.
   * Zegt niets over juridische vrijgave — zie `legalStatus`.
   */
  | "TECHNICALLY_VALIDATED"
  /**
   * Geen bevestigde overtreding, maar er zijn regels waarvan de bron of de
   * toepasselijkheid nog niet formeel is bevestigd — of een regel die wel
   * bestaat maar waarvan een parameter ontbreekt.
   *
   * Dit is nadrukkelijk géén bewezen fout in het rooster. Het scenario is
   * bruikbaar om te analyseren en te vergelijken; publiceren blijft dicht.
   */
  | "TECHNICALLY_VALID_UNVERIFIED_RULES"
  /**
   * Geen bevestigde overtreding, maar een deel van de regels kon niet volledig
   * worden nagerekend omdat de benodigde roosterhistorie buiten het
   * beschikbare venster valt. Ook dit is onzekerheid, geen overtreding.
   */
  | "TECHNICALLY_VALID_INCOMPLETE_CONTEXT"
  /**
   * Een daadwerkelijk bewezen overtreding van een geldige, toepasbare harde
   * regel. Dit is het enige inhoudelijke "nee" van de validator.
   */
  | "CONFIRMED_HARD_VIOLATION"
  /**
   * De kandidaat zelf deugt niet: dubbele toewijzingen op dezelfde cyclusdag,
   * een lijn zonder bezetter, of toewijzingen die de validator niet heeft
   * kunnen beoordelen. Een rooster waarvan een deel ongetoetst bleef, is geen
   * bruikbare simulatie — hier telt "onbekend" wél als blokkade.
   */
  | "INVALID_STRUCTURE"
  /**
   * Historische verzamelbak. Wordt niet meer geproduceerd; bestaat alleen nog
   * voor kandidaten die vóór de splitsing van technische en formele beoordeling
   * zijn opgeslagen. Zie `technicalStatusOf`.
   */
  | "REJECTED"
  /** Het bronrooster is gewijzigd sinds de generatie. */
  | "STALE_SCHEDULE"
  /** Het regelbestand is gewijzigd sinds de generatie. */
  | "STALE_RULESET"
  /** Diensten, medewerkers of contractgegevens zijn gewijzigd. */
  | "STALE_INPUT"
  /** De inhoud komt niet meer overeen met de vingerafdruk. */
  | "TAMPERED";

export const STALE_STATUSES: readonly CandidateValidationStatus[] = [
  "STALE_SCHEDULE",
  "STALE_RULESET",
  "STALE_INPUT",
];

export interface ValidationTally {
  readonly checkedAssignments: number;
  readonly confirmedHardViolations: number;
  readonly potentialHardViolations: number;
  readonly rulesetIncomplete: number;
  readonly missingCriticalContext: number;
  /** Ontdubbeld op het onderliggende feit, niet op de aanroep. */
  readonly uniqueViolations: number;
  readonly affectedEmployees: number;
  /**
   * Toewijzingen die helemaal niet beoordeeld konden worden — een lijn zonder
   * bezetter bijvoorbeeld. Bewust apart geteld en meegewogen: een kandidaat die
   * technisch gevalideerd heet terwijl een deel ongetoetst bleef, is de
   * gevaarlijkste uitkomst die dit systeem kan geven.
   */
  readonly unvalidatableAssignments: number;
}

/** Waarom een regel niet volledig kon worden nagerekend. */
export type UncertaintyKind =
  /** De regel bestaat, maar bron of toepasselijkheid is niet formeel bevestigd. */
  | "UNVERIFIED_RULE_SOURCE"
  /** De regel bestaat, maar een benodigde parameter of bron ontbreekt. */
  | "MISSING_RULE_CONTEXT"
  /** De regel vraagt meer roosterhistorie dan beschikbaar is. */
  | "INSUFFICIENT_HISTORY";

/**
 * Eén regel die niet volledig beoordeeld kon worden, met hoeveel toewijzingen
 * het raakte.
 *
 * ## Waarom per regel en niet per toewijzing
 *
 * Eén ontbrekende parameter raakt elke toewijzing waarop die regel van
 * toepassing is. Dat leverde meldingen als "2194 toewijzingen konden niet
 * worden beoordeeld" — een getal dat groot klinkt en niets zegt, want het is
 * één oorzaak die duizenden keren wordt geteld. Wie wil weten wat er moet
 * gebeuren, heeft de regel nodig, niet het aantal.
 *
 * Het aantal blijft staan: het zegt wél iets over de reikwijdte.
 */
export interface ValidationUncertainty {
  readonly kind: UncertaintyKind;
  readonly ruleId: string;
  readonly title: string;
  /** Hoeveel beoordeelde toewijzingen deze onzekerheid raakt. */
  readonly affectedAssignments: number;
  readonly explanation: string;
}

/**
 * De blokkades, uit elkaar gehaald naar wat ze werkelijk zijn.
 *
 * Eerder stonden ze in één lijst: structurele problemen, telresultaten en het
 * ontbreken van formele bronvalidatie door elkaar, onder één kop. Daardoor las
 * "de Arbeidstijdenwet is niet aangeleverd" als een verwijt aan het rooster.
 */
export interface ValidationReasons {
  /** De kandidaat zelf deugt niet. Blokkeert ook de simulatie. */
  readonly structural: readonly string[];
  /** Bewezen overtredingen van geldige, toepasbare regels. */
  readonly violations: readonly string[];
  /** Onzekerheid over regels, bronnen of historie. Blokkeert alleen publicatie. */
  readonly uncertainty: readonly string[];
  /** Formele bronvalidatie. Blokkeert uitsluitend publicatie. */
  readonly formal: readonly string[];
}

export interface ReviewableRoster {
  readonly candidate: CandidateRoster;
  readonly status: CandidateValidationStatus;
  readonly legalStatus: CandidateLegalStatus;
  readonly validatedAt: string;
  readonly rulesetVersionAtValidation: string;
  readonly tally: ValidationTally;
  /** Per regel: hoeveel unieke feiten en welke zekerheid. */
  readonly perRule: readonly {
    readonly ruleId: string;
    readonly title: string;
    readonly uniqueViolations: number;
    readonly confidence: "CONFIRMED" | "POTENTIAL";
  }[];
  /** Per regel gegroepeerd: wat niet beoordeeld kon worden, en hoe breed. */
  readonly uncertainties: readonly ValidationUncertainty[];
  /** De blokkades, gescheiden naar soort. */
  readonly reasons: ValidationReasons;
  /**
   * Alle blokkades achter elkaar. Blijft bestaan voor bestaande aanroepers en
   * voor het auditspoor; nieuwe schermen gebruiken `reasons`.
   */
  readonly blockingReasons: readonly string[];
  /** Mag dit scenario worden geanalyseerd en vergeleken? */
  readonly simulationEligible: boolean;
  /**
   * Altijd `false` zolang de juridische status niet is bevestigd. Er is geen
   * pad in deze code dat hier `true` van maakt zonder een gevalideerd
   * regelbestand.
   */
  readonly publishable: boolean;
}

/**
 * De technische uitkomst van de beoordeling.
 *
 * ## Waarom dit niet één ja/nee meer is
 *
 * Deze functie gaf eerder `REJECTED` zodra één van vijf tellers boven nul
 * stond. Daarmee kregen vier fundamenteel verschillende situaties hetzelfde
 * etiket: een bewezen overtreding, een regel waarvan de bron niet is bevestigd,
 * een regel die niet volledig kon worden nagerekend, en een kandidaat die
 * structureel niet deugt. Alleen de eerste en de laatste zeggen iets over de
 * kwaliteit van het rooster; de twee middelste zeggen iets over de staat van
 * ons regelbestand.
 *
 * Het gevolg was dat een compleet, correct doorgerekend scenario onbruikbaar
 * werd voor analyse en vergelijking, terwijl er niets mis mee was — de
 * Arbeidstijdenwet was alleen nog niet formeel aangeleverd.
 *
 * ## Wat hier níet is gebeurd
 *
 * Geen enkele controle is uitgezet en geen enkele onzekerheid is als "goed"
 * geteld. Onzekerheid blijft zichtbaar, blijft meetellen, en blijft publicatie
 * blokkeren — zie `publicationEligible`. Wat verandert, is dat onzekerheid niet
 * langer hetzelfde woord krijgt als een bewezen fout.
 *
 * ## De volgorde
 *
 * Van zwaar naar licht: een bewezen overtreding weegt zwaarder dan een
 * onbeoordeelbare kandidaat, en die weegt zwaarder dan onzekerheid over de
 * regels of over de historie.
 */
export function technicalStatusOf(tally: ValidationTally): CandidateValidationStatus {
  if (tally.confirmedHardViolations > 0) {
    return "CONFIRMED_HARD_VIOLATION";
  }
  // Ongetoetst is hier wél blokkerend: een kandidaat waarvan een deel niet is
  // nagerekend, mag niet als bruikbare simulatie gelden. Dat was de reden dat
  // deze teller ooit is toegevoegd en die reden staat nog steeds.
  if (tally.unvalidatableAssignments > 0) {
    return "INVALID_STRUCTURE";
  }
  if (tally.potentialHardViolations > 0 || tally.rulesetIncomplete > 0) {
    return "TECHNICALLY_VALID_UNVERIFIED_RULES";
  }
  if (tally.missingCriticalContext > 0) {
    return "TECHNICALLY_VALID_INCOMPLETE_CONTEXT";
  }
  return "TECHNICALLY_VALIDATED";
}

/**
 * De statussen waarbij het scenario inhoudelijk bruikbaar is als simulatie:
 * genereren, opslaan, analyseren, vergelijken, exporteren met stempel.
 *
 * Bewust géén `REJECTED`: die oude verzamelbak kan een bewezen overtreding
 * bevatten, en dat valt achteraf niet meer uit elkaar te halen.
 */
export const SIMULATION_ELIGIBLE_STATUSES: readonly CandidateValidationStatus[] = [
  "TECHNICALLY_VALIDATED",
  "TECHNICALLY_VALID_UNVERIFIED_RULES",
  "TECHNICALLY_VALID_INCOMPLETE_CONTEXT",
];

/** Mag dit scenario worden geanalyseerd en vergeleken? */
export function simulationEligible(status: CandidateValidationStatus): boolean {
  return SIMULATION_ELIGIBLE_STATUSES.includes(status);
}

/**
 * Mag dit scenario formeel worden gepubliceerd?
 *
 * Twee voorwaarden, en ze staan los van elkaar: de kandidaat moet volledig
 * schoon door de validator zijn gekomen, én het regelbestand moet formeel
 * bevestigd zijn. De tweede voorwaarde is nu nooit waar — en dat hoort zo
 * zolang de aangeleverde bronnen niet compleet zijn bevestigd.
 */
export function publicationEligible(input: {
  readonly status: CandidateValidationStatus;
  readonly rulesetLegallyVerified: boolean;
  readonly missingRulePackages: number;
}): boolean {
  return (
    input.status === "TECHNICALLY_VALIDATED" &&
    input.rulesetLegallyVerified &&
    input.missingRulePackages === 0
  );
}
