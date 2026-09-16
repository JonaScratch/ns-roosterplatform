import { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
import { type CandidateAssignment, type CandidateRoster, sealCandidate } from "@/domain/candidate";
import type {
  CandidateDataPort,
  CandidateValidationContext,
  ValidatorDuty,
  ValidatorEmployee,
} from "@/server/rules-engine/final-validator";

/**
 * Bouwstenen voor de kandidaattoetsen.
 *
 * Een basisrooster is hier een rijtje tekens per lijn: één teken per cyclusdag,
 * te lezen als een roosterblad. `VVVVVVV RRRRRRR` is een week werken en een week
 * rust. Dat leest sneller dan twintig regels objectliteral, en het maakt in de
 * test meteen zichtbaar wát er aan de hand is — juist bij mutanten waarvan het
 * de bedoeling is dat ze worden afgewezen.
 */

/** De diensten waarmee de tests werken, met expres precieze tijden. */
export const DUTIES: Readonly<Record<string, ValidatorDuty>> = {
  // Vroege dienst 05:30–13:00.
  V: duty("041", [DutyKind.VROEG], 5 * 60 + 30, 13 * 60),
  // Late dienst 13:00–21:30.
  L: duty("141", [DutyKind.LAAT], 13 * 60, 21 * 60 + 30),
  // Nachtdienst 22:00–06:00 (eindigt de volgende dag).
  N: duty("241", [DutyKind.NACHT], 22 * 60, 30 * 60),
  // Late dienst die om 20:01 eindigt: samen met A geeft dat 11 u 59 rust.
  P: duty("142", [DutyKind.LAAT], 13 * 60, 20 * 60 + 1),
  // Dienst die om 08:00 begint.
  A: duty("042", [DutyKind.VROEG], 8 * 60, 15 * 60),
  // Dienst die om 19:59 begint: na een nacht die om 06:00 eindigt is dat 13 u 59.
  B: duty("143", [DutyKind.LAAT], 19 * 60 + 59, 23 * 60 + 30),
  // Dienst die om 03:59 begint: na een nachtreeks die om 06:00 eindigt 45 u 59.
  C: duty("044", [DutyKind.VROEG], 3 * 60 + 59, 10 * 60),
};

function duty(
  code: string,
  kinds: readonly DutyKind[],
  startMinute: number,
  endMinute: number,
): ValidatorDuty {
  return {
    id: `duty-${code}`,
    code,
    // In deze fixture rijdt een dienstnummer elke weekdag met dezelfde tijden.
    // In de echte Dordrechtse gegevens is dat juist niet zo; daar heeft 39 van
    // de 46 nummers per dag andere tijden. Hier is de gelijkheid bewust: de
    // tests gaan over de regels, niet over het verschil tussen weekdagen.
    weekday: 1,
    kinds,
    depot: "DDR",
    requiredQualifications: [],
    weight: 3,
    startMinute,
    endMinute,
    // Vastgelegde pauze: houdt de arbeidstijd exact, zodat een test niet op de
    // onbekende werkonderbreking stukloopt in plaats van op de bedoelde regel.
    breakMinutes: 40,
    overtimeMinutes: 0,
  };
}

const POSITION_BY_TOKEN: Readonly<Record<string, "RUST" | "RES" | "WR" | "CO">> = {
  R: "RUST",
  S: "RES",
  W: "WR",
  O: "CO",
};

export const EMPLOYEE: ValidatorEmployee = {
  id: "emp-1",
  employeeNumber: "100001",
  employeeGroup: "MACHINIST",
  company: "NSR",
  depot: "DDR",
  rosterProfile: RosterProfile.VROEG_LAAT,
  qualifications: [],
  contractHours: 40,
  earlyStartProtectionWaived: false,
  protections: [],
};

export interface LineSpec {
  /** Eén teken per cyclusdag. Zie `DUTIES` en `POSITION_BY_TOKEN`. */
  readonly pattern: string;
  readonly employee?: ValidatorEmployee;
}

export interface CandidateSpec {
  readonly rosterCode?: string;
  readonly lines: readonly LineSpec[];
  readonly sourceScheduleVersion?: string;
  readonly rulesetVersion?: string;
  readonly inputDataVersion?: string;
  /** Extra toewijzingen, bijvoorbeeld om een dubbele te maken. */
  readonly extraAssignments?: readonly CandidateAssignment[];
}

export function buildCandidate(spec: CandidateSpec): CandidateRoster {
  const rosterCode = spec.rosterCode ?? "DDR-VL";
  const assignments: CandidateAssignment[] = [];

  spec.lines.forEach((line, index) => {
    const tokens = line.pattern.replace(/\s+/g, "").split("");
    tokens.forEach((token, day) => {
      const dutyDefinition = DUTIES[token];
      assignments.push({
        baseRosterCode: rosterCode,
        lineNumber: index + 1,
        // 1-gebaseerd, net als `RosterLineDay.weekIndex` in de database. Hier
        // stond `Math.floor(day / 7)`, dus vanaf nul — en de validator telde
        // óók vanaf nul. Twee fouten die elkaar opheffen, en daardoor testte
        // dit bestand jarenlang een validator die op echte gegevens niets zag.
        weekIndex: Math.floor(day / 7) + 1,
        weekday: (day % 7) + 1,
        positionType: dutyDefinition ? "DUTY" : (POSITION_BY_TOKEN[token] ?? "RUST"),
        dutyCode: dutyDefinition?.code ?? null,
      });
    });
  });

  return sealCandidate({
    id: "kandidaat-test",
    status: "CANDIDATE_GENERATED",
    optimizerName: "test",
    optimizerVersion: "1.0.0",
    generatedAt: "2025-03-01T00:00:00.000Z",
    mode: "SIMULATION",
    legalStatus: "SIMULATION_ONLY",
    scenarioLabel: "Test",
    sourceScheduleVersion: spec.sourceScheduleVersion ?? "schedule-v1",
    rulesetVersion: spec.rulesetVersion ?? "ruleset-v1",
    inputDataVersion: spec.inputDataVersion ?? "input-v1",
    assignments: [...assignments, ...(spec.extraAssignments ?? [])],
    scoreBreakdown: {
      restQuality: 100,
      weekendBalance: 100,
      nightBalance: 100,
      earlyBalance: 100,
      lateBalance: 100,
      shuntingBalance: 100,
      reserveBalance: 100,
      patternQuality: 100,
      feedbackAlignment: 100,
      overallQualityScore: 100,
    },
  });
}

/** Een gegevenspoort die precies past bij de opgegeven kandidaat. */
export function portFor(spec: CandidateSpec): CandidateDataPort {
  const rosterCode = spec.rosterCode ?? "DDR-VL";
  const cycleWeeks = Math.ceil(spec.lines[0].pattern.replace(/\s+/g, "").length / 7);

  return {
    async rosters() {
      return [
        {
          code: rosterCode,
          cycleWeeks,
          lines: spec.lines.map((line, index) => ({
            lineNumber: index + 1,
            occupant: line.employee ?? EMPLOYEE,
          })),
        },
      ];
    },
    async duties(codes: readonly string[]) {
      // Elke weekdag krijgt zijn eigen rij, want de validator zoekt op nummer
      // én weekdag. Zeven rijen met dezelfde tijden is precies wat deze fixture
      // bedoelt: het nummer rijdt elke dag hetzelfde.
      return Object.values(DUTIES)
        .filter((entry) => codes.includes(entry.code))
        .flatMap((entry) =>
          [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ ...entry, weekday })),
        );
    },
  };
}

export function contextFor(spec: CandidateSpec = { lines: [] }): CandidateValidationContext {
  return {
    sourceScheduleVersion: spec.sourceScheduleVersion ?? "schedule-v1",
    rulesetVersion: spec.rulesetVersion ?? "ruleset-v1",
    inputDataVersion: spec.inputDataVersion ?? "input-v1",
    // Een maandag binnen de geldigheidsperiode van de aangeleverde CAO.
    anchorMonday: "2025-03-03",
  };
}

/** De regels die in de beoordeling zijn afgegaan. */
export function firedRules(review: { perRule: readonly { ruleId: string }[] }): string[] {
  return review.perRule.map((entry) => entry.ruleId);
}
