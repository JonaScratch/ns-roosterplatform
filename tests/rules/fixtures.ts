import { addDays } from "@/domain/time";
import type {
  AssignmentCheck,
  DutyContext,
  EmployeeContext,
  ScheduleDayContext,
  ScheduleWindow,
} from "@/server/rules-engine";
import { DEFAULT_PRODUCT_PARAMETERS } from "@/server/rules-engine";

/**
 * Bouwstenen voor de tests van de rules engine.
 *
 * Het venster wordt hier altijd zo breed gemaakt als de applicatie het in
 * productie laadt. Dat is geen detail: een smaller venster levert bij de
 * validator "niet te beoordelen" op, en dan zou een test slagen om een reden
 * die niets met de regel te maken heeft.
 *
 * De datums liggen binnen de geldigheidsperiode van de aangeleverde CAO. Een
 * test die daarbuiten valt, meet de omgang met een verlopen bron in plaats van
 * de regel die hij zegt te toetsen; dat gedrag heeft zijn eigen tests.
 */

export const VROEG_DIENST: DutyContext = {
  dutyId: "duty-vroeg",
  code: "043",
  kinds: ["VROEG"],
  // 05:10, niet 05:00: op precies 05:00 vallen twee CAO-bepalingen samen (de
  // band 04:00–05:01 met een maximum van 7 uur en de band 05:00–06:00 met 8,5
  // uur). Dat is een openstaande vraag over de bron, geen eigenschap van deze
  // dienst — en een fixture hoort niet stilzwijgend op zo'n randgeval te staan.
  startMinute: 310,
  endMinute: 805,
  depot: "DDR",
  requiredQualifications: [],
  weight: 3,
  breakMinutes: 40,
  overtimeMinutes: 0,
};

export const LATE_DIENST: DutyContext = {
  dutyId: "duty-laat",
  code: "141",
  kinds: ["LAAT"],
  startMinute: 780,
  endMinute: 1290,
  depot: "DDR",
  requiredQualifications: [],
  weight: 3,
  breakMinutes: 40,
  overtimeMinutes: 0,
};

export const NACHT_DIENST: DutyContext = {
  dutyId: "duty-nacht",
  code: "241",
  kinds: ["NACHT"],
  startMinute: 1350,
  endMinute: 1845,
  depot: "DDR",
  requiredQualifications: [],
  weight: 5,
  breakMinutes: 40,
  overtimeMinutes: 0,
};

/** Nacht én rangeer: de dienst waarop de classificatie zich bewijst. */
export const NACHTRANGEER_DIENST: DutyContext = {
  dutyId: "duty-760",
  code: "760",
  kinds: ["NACHT", "RANGEER"],
  startMinute: 1370,
  endMinute: 1860,
  depot: "DDR",
  requiredQualifications: ["RANGEER"],
  weight: 5,
  breakMinutes: 40,
  overtimeMinutes: 0,
};

export function medewerker(overrides: Partial<EmployeeContext> = {}): EmployeeContext {
  return {
    employeeId: "emp-1",
    employeeNumber: "100001",
    // Niet Mix: voor dat profiel zijn de bijzondere regels niet aangeleverd,
    // en dan blokkeert elke plaatsing terecht op een onvolledig regelbestand.
    // Dat gedrag heeft zijn eigen test; hier zou het alles overschaduwen.
    rosterProfile: "VROEG_LAAT",
    depot: "DDR",
    qualifications: ["RANGEER", "WISSELBEDIENING"],
    reservePreference: "GEEN_VOORKEUR",
    employeeGroup: "MACHINIST",
    company: "NSR",
    contractHours: 36,
    earlyStartProtectionWaived: false,
    protections: [],
    ...overrides,
  };
}

/** Een venster met uitsluitend rustdagen, plus de dagen die de test toevoegt. */
export function venster(
  centrum: string,
  dagen: readonly ScheduleDayContext[] = [],
): ScheduleWindow {
  const terug = DEFAULT_PRODUCT_PARAMETERS.windowDaysBack;
  const vooruit = DEFAULT_PRODUCT_PARAMETERS.windowDaysForward;
  const ingevuld = new Map(dagen.map((dag) => [dag.date, dag]));

  const alle: ScheduleDayContext[] = [];
  for (let offset = -terug; offset <= vooruit; offset += 1) {
    const datum = addDays(centrum, offset);
    alle.push(ingevuld.get(datum) ?? { date: datum, positionType: "RUST", duty: null });
  }

  return { from: addDays(centrum, -terug), to: addDays(centrum, vooruit), days: alle };
}

export function dienstDag(datum: string, duty: DutyContext): ScheduleDayContext {
  return { date: datum, positionType: "DUTY", duty };
}

export function resDag(datum: string): ScheduleDayContext {
  return { date: datum, positionType: "RES", duty: null };
}

export function toets(overrides: Partial<AssignmentCheck> = {}): AssignmentCheck {
  const datum = overrides.date ?? "2025-09-09";
  return {
    employee: medewerker(),
    date: datum,
    duty: VROEG_DIENST,
    window: venster(datum),
    surrendering: null,
    planningStage: "POST_DW_OPERATIONAL",
    exceptions: [],
    replacedPosition: null,
    ...overrides,
  };
}

/** De regel-id's van alle overtredingen in een uitkomst. */
export function overtredingen(findings: readonly { severity: string; ruleId: string }[]): string[] {
  return findings.filter((item) => item.severity === "VIOLATION").map((item) => item.ruleId);
}
