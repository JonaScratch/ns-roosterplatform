import type { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
import type { CalendarDate } from "@/domain/time";
import type { DutyShape } from "@/domain/duty-window";
import type { BaselineSlot, RosterChangeType } from "@/domain/roster-structure";
import type { Company, EmployeeGroup } from "../ruleset/types";
import type { Timeline } from "./timeline";

/**
 * Wat de engine over een plaatsing te weten krijgt.
 *
 * ## Wat er bewust niet in zit
 *
 * Geen naam, geen e-mailadres, geen leeftijd, geen medische of privéreden.
 * Waar de CAO een ontziemaatregel aan een leeftijd koppelt, bereikt die
 * leeftijd de engine niet: er komt een abstracte beperking binnen die zegt
 * wát er niet mag, niet waarom. De engine hoeft het waarom niet te weten om te
 * kunnen rekenen, en wat zij niet weet kan zij niet lekken.
 */

/** Een abstracte beschermingsconstraint uit een geautoriseerde bron. */
export type Protection =
  | {
      readonly type: "SCHEDULING_RESTRICTION";
      /** Vroegste toegestane starttijd, minuten na middernacht. */
      readonly earliestStartMinute?: number;
      /** Laatste toegestane eindtijd, minuten na middernacht. */
      readonly latestEndMinute?: number;
      readonly maxConsecutiveServices?: number;
      readonly overtimeAllowed?: boolean;
    }
  /** Vrijstelling van harde nachtdiensten, op verzoek van de werknemer. */
  | { readonly type: "HARD_NIGHT_EXEMPTION" }
  /** Vrijstelling van zeer vroege starts, op verzoek van de werknemer. */
  | { readonly type: "VERY_EARLY_START_EXEMPTION" }
  /** Geregistreerde afwijking van het driewekelijkse vrije weekend. */
  | { readonly type: "RED_WEEKEND_WAIVER"; readonly validUntil: string }
  /** Instemming met afwijking van de rusttijd bij het ingaan van de zomertijd. */
  | { readonly type: "DST_CONSENT"; readonly validUntil: string };

/** De medewerker, zoals de engine hem kent. */
export interface AssignmentSubject {
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly employeeGroup: EmployeeGroup;
  readonly company: Company;
  readonly depot: string;
  readonly rosterProfile: RosterProfile;
  readonly qualifications: readonly string[];
  /** Uren per week. Null betekent onbekend en blokkeert contractafhankelijke checks. */
  readonly contractHours: number | null;
  /** Uitdrukkelijk vastgelegd; wordt nooit afgeleid uit gedrag. */
  readonly earlyStartProtectionWaived: boolean;
  readonly protections: readonly Protection[];
}

/** De dienst die geplaatst zou worden. */
export interface CandidateDuty {
  readonly dutyId: string;
  readonly code: string;
  readonly kinds: readonly DutyKind[];
  readonly depot: string;
  readonly requiredQualifications: readonly string[];
  readonly weight: number;
  readonly shape: DutyShape;
}

/**
 * De planningsfase waarin de wijziging valt.
 *
 * Dit onderscheid is niet cosmetisch. De CAO staat een verkorte dagelijkse rust
 * toe die uitdrukkelijk **niet planmatig** mag zijn. In `BASE_ROSTER` mag die
 * uitzondering dus niet bestaan; in de operationele fase alleen met een
 * vastgelegde, geautoriseerde afwijking.
 */
export type PlanningStage =
  | "BASE_ROSTER"
  | "PLAN_28_DAY"
  | "DW_LOCK"
  | "POST_DW_OPERATIONAL";

/** Waarvoor de validatie wordt gevraagd. */
export type AssignmentReason =
  | "BASE_ROSTER_GENERATION"
  | "PUBLICATION_CHECK"
  | "RESERVE_FILL"
  | "AVAILABLE_DUTY"
  | "SWAP"
  | "MANUAL_DID"
  | "REGRESSION_CHECK";

/**
 * Een formeel geautoriseerde uitzondering.
 *
 * Bestaat alleen wanneer de bron er een toestaat, en draagt altijd wie hem
 * heeft verleend en waarom. Zonder autorisatie is een uitzondering geen
 * uitzondering maar een overtreding.
 */
export interface AuthorisedException {
  readonly ruleId: string;
  readonly grantedByUserId: string;
  readonly reason: string;
  readonly grantedAt: string;
}

export interface AssignmentRequest {
  readonly subject: AssignmentSubject;
  readonly date: CalendarDate;
  readonly candidate: CandidateDuty;
  readonly planningStage: PlanningStage;
  readonly reason: AssignmentReason;
  readonly timeline: Timeline;
  /** Uitzonderingen die voor deze plaatsing formeel zijn verleend. */
  readonly exceptions: readonly AuthorisedException[];
  /**
   * Wat voor roosterronde dit is. Bij een wijzigingsblad staan de structurele
   * ankers vast; bij een nieuwe dienstregeling mogen ze opnieuw worden bepaald.
   * Ontbreekt de waarde, dan wordt uitgegaan van een nieuwe dienstregeling —
   * dat is de ronde waarin de structuur hoort te worden vastgesteld.
   */
  readonly changeType?: RosterChangeType;
  /**
   * De bevroren baseline voor deze cyclusdag. Bij een wijzigingsblad verplicht;
   * zonder deze snapshot is niet vast te stellen of een anker verschuift.
   */
  readonly baselineSlot?: BaselineSlot | null;
}

/** Behoort deze medewerker tot het rijdend personeel? */
export function isRidingStaff(subject: AssignmentSubject): boolean {
  return subject.employeeGroup === "MACHINIST" || subject.employeeGroup === "HOOFDCONDUCTEUR";
}

/** Is er een geldige, geautoriseerde uitzondering voor deze regel? */
export function hasException(
  request: AssignmentRequest,
  ruleId: string,
): AuthorisedException | null {
  return request.exceptions.find((exception) => exception.ruleId === ruleId) ?? null;
}

/** Is deze bescherming actief voor deze medewerker? */
export function protection<T extends Protection["type"]>(
  subject: AssignmentSubject,
  type: T,
): Extract<Protection, { type: T }> | null {
  return (
    (subject.protections.find((entry) => entry.type === type) as
      | Extract<Protection, { type: T }>
      | undefined) ?? null
  );
}
