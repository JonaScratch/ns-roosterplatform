import "server-only";
import type { DutyKind, RosterPositionType } from "@/lib/generated/prisma/enums";
import { toCalendarDate } from "@/domain/time";
import type { DutyContext, EmployeeContext, ScheduleDayContext } from "@/server/rules-engine";
import { parseProtections } from "@/server/validation/protections";

/**
 * Vertaling van databaserijen naar de contextobjecten van de Rules Engine.
 *
 * Dit bestand is de grens. Aan de ene kant staan Prisma-modellen met alles wat
 * erin zit; aan de andere kant staan de naamloze contexten waar de engine mee
 * werkt. Doordat de vertaling hier gebeurt en de mappers exact opsommen welke
 * velden meegaan, kan er geen persoonsgegeven de engine in lekken doordat
 * iemand ergens een object doorgaf in plaats van velden.
 *
 * De invoertypen zijn met opzet minimaal beschreven en niet de volledige
 * Prisma-modellen: zo dwingt de aanroeper zichzelf tot een `select` die alleen
 * ophaalt wat nodig is.
 */

export interface EmployeeRow {
  readonly id: string;
  readonly employeeNumber: string;
  readonly rosterProfile: EmployeeContext["rosterProfile"];
  readonly depot: string;
  readonly qualifications: readonly string[];
  readonly reservePreference: EmployeeContext["reservePreference"];
  readonly employeeGroup: EmployeeContext["employeeGroup"];
  readonly company: string;
  readonly contractHours: { toNumber(): number } | number | null;
  readonly earlyStartProtectionWaived: boolean;
  readonly protections: unknown;
}

export function toEmployeeContext(row: EmployeeRow): EmployeeContext {
  return {
    employeeId: row.id,
    employeeNumber: row.employeeNumber,
    rosterProfile: row.rosterProfile,
    depot: row.depot,
    qualifications: [...row.qualifications],
    reservePreference: row.reservePreference,
    employeeGroup: row.employeeGroup,
    company: toCompany(row.company),
    contractHours: toContractHours(row.contractHours),
    earlyStartProtectionWaived: row.earlyStartProtectionWaived,
    protections: parseProtections(row.protections, row.employeeNumber),
  };
}

/**
 * De contractomvang als getal, of null.
 *
 * Prisma levert een `Decimal`. Die met `Number()` benaderen zou werken, maar
 * een niet-ingevulde waarde wordt dan 0 — en nul uur contract is iets heel
 * anders dan een onbekende contractomvang. Het eerste is een grens, het tweede
 * een blokkade.
 */
function toContractHours(value: EmployeeRow["contractHours"]): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" ? value : value.toNumber();
}

/** Een onbekende vennootschap wordt OVERIG en nooit stilzwijgend NSR. */
function toCompany(value: string): EmployeeContext["company"] {
  const known: readonly EmployeeContext["company"][] = [
    "NSR",
    "NS_INTERNATIONAL",
    "NEDTRAIN",
    "OVERIG",
  ];
  return known.find((entry) => entry === value) ?? "OVERIG";
}

export interface DutyRow {
  readonly id: string;
  readonly code: string;
  readonly kinds: readonly DutyKind[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly requiredQualifications: readonly string[];
  readonly weight: number;
  readonly breakMinutes: number | null;
  readonly overtimeMinutes: number;
}

export function toDutyContext(row: DutyRow): DutyContext {
  return {
    dutyId: row.id,
    code: row.code,
    kinds: [...row.kinds],
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    depot: row.depot,
    requiredQualifications: [...row.requiredQualifications],
    weight: row.weight,
    // Null blijft null. Een niet vastgelegde pauze invullen als nul zou de
    // arbeidstijd gelijkstellen aan de dienstlengte, en dat is een stille
    // aanname met een grens van negen uur erachter.
    breakMinutes: row.breakMinutes,
    overtimeMinutes: row.overtimeMinutes,
  };
}

export interface ScheduledDutyRow {
  readonly date: Date;
  readonly positionType: RosterPositionType;
  readonly duty: DutyRow | null;
}

export function toScheduleDayContext(row: ScheduledDutyRow): ScheduleDayContext {
  return {
    date: toCalendarDate(row.date),
    positionType: row.positionType,
    duty: row.duty ? toDutyContext(row.duty) : null,
  };
}

/** De `select` die een dienst compleet genoeg ophaalt voor de engine. */
export const DUTY_SELECT = {
  id: true,
  code: true,
  kinds: true,
  startMinute: true,
  endMinute: true,
  depot: true,
  requiredQualifications: true,
  weight: true,
  breakMinutes: true,
  overtimeMinutes: true,
} as const;

/**
 * De `select` voor een medewerker, zoals de engine hem mag zien.
 *
 * `identity` staat er niet in. Dat is geen vergeetachtigheid maar de kern van
 * de opzet: wie deze constante gebruikt, kán geen naam ophalen.
 */
export const EMPLOYEE_SELECT = {
  id: true,
  employeeNumber: true,
  rosterProfile: true,
  depot: true,
  qualifications: true,
  reservePreference: true,
  employeeGroup: true,
  company: true,
  contractHours: true,
  earlyStartProtectionWaived: true,
  protections: true,
} as const;
