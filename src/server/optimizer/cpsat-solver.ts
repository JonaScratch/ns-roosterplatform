import { spawn } from "node:child_process";
import path from "node:path";

/**
 * De brug naar de constraint solver.
 *
 * ## Waarom een apart proces
 *
 * De solver draait als los proces met JSON erin en JSON eruit. Dat is geen
 * omweg maar de kern van de afscherming: het proces heeft geen
 * databaseverbinding, geen sessie en geen kennis van medewerkers. "De optimizer
 * mag niets schrijven" is daarmee geen belofte in een code review maar een
 * eigenschap van waar hij draait.
 *
 * ## Wat hier misgaan kan, en wat er dan gebeurt
 *
 * Python ontbreekt, ortools ontbreekt, het proces valt om, het duurt te lang,
 * of er komt onzin uit. Alle vijf leveren hier hetzelfde op: een duidelijke
 * weigering met reden. Geen half rooster, geen lege lijst die op "niets te doen"
 * lijkt.
 */

export interface SolverDuty {
  readonly code: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly timeOfDayKinds: readonly string[];
  /** Het dagdeel voor overgangen en nachtreeksen: EARLY, LATE of NIGHT. */
  readonly category: "EARLY" | "LATE" | "NIGHT" | null;
  readonly isNight: boolean;
  readonly isShunting: boolean;
  readonly isWeekend: boolean;
  readonly isLong: boolean;
  /** Klasse op de klok (duty-class.ts), voor de voorkeurstermen. */
  readonly preferenceClass?: string;
  /** Dagachtige dienst (dagachtig vroeg of vroege late). */
  readonly isDayDuty?: boolean;
}

export interface SolverLineDay {
  readonly weekIndex: number;
  readonly weekday: number;
  /** Mag de solver dit slot vullen? Ankerdagen staan hier op false. */
  readonly assignable: boolean;
  readonly dutyCode: string | null;
  /** DUTY, RUST, RES, WR of CO: nodig om een vrije dag tussen twee diensten te herkennen. */
  readonly positionType?: string;
}

export interface SolverLine {
  readonly baseRosterCode: string;
  readonly lineNumber: number;
  readonly profile: string;
  readonly cycleWeeks: number;
  readonly allowedKinds: readonly string[];
  readonly days: readonly SolverLineDay[];
}

/** Een dienst op een dienstdag, voor warme start, behoud en diversiteit. */
export interface SlotAssignment {
  /** `rooster|regel|week|weekdag` */
  readonly slotKey: string;
  /** `nummer|weekdag` */
  readonly dutyKey: string;
}

export interface SolverOptions {
  readonly minRestMinutes: number;
  readonly maxConsecutiveDuties: number;
  readonly timeLimitSeconds: number;
  readonly seed: number;
  /** Zoekdraden. Eén is herhaalbaar; meer vindt binnen dezelfde tijd betere roosters. */
  readonly workers?: number;
  /** Gewichten van de zachte doelen; zie objective-weights.ts. */
  readonly objective?: Readonly<Record<string, number>>;
  readonly transitionPenalties?: {
    readonly adjacent: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly overOffDay: Readonly<Record<string, Readonly<Record<string, number>>>>;
    /** Alleen bij de menselijke ritmevoorkeuren: nacht → vroeg over twee vrije dagen. */
    readonly overTwoOffDays?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  };
  /** Sprong in begintijd binnen een dagdeel: tot hier gratis, vanaf `startJitterFullMinutes` vol. */
  readonly startJitterFreeMinutes?: number;
  readonly startJitterFullMinutes?: number;
  readonly offPositionTypes?: readonly string[];
  readonly comfortableRestMinutes?: number;
  readonly targetWeeklyMinutes?: number;
  readonly anchorCreditMinutes?: Readonly<Record<string, number>>;
  readonly nightRosterCodes?: readonly string[];
  readonly referenceAssignments?: readonly SlotAssignment[];
  readonly hintAssignments?: readonly SlotAssignment[];
  readonly excludeSolutions?: readonly (readonly SlotAssignment[])[];
  /** Plaatsingen die tijdens een gerichte reparatie blijven staan. */
  readonly fixedAssignments?: readonly SlotAssignment[];
  /** Zoekopzet van CP-SAT; varieert het zoekpad, niet wat is toegestaan. */
  readonly linearizationLevel?: number;
  readonly minDifferentSlots?: number;
  /** Na een mislukte poging mét volledige dekking uitleggen wat leeg blijft. Standaard aan. */
  readonly explainShortfall?: boolean;
  readonly feedbackPenalties?: readonly {
    readonly rosterCode: string;
    readonly burden: "NIGHT" | "EARLY" | "SHUNTING" | "WEEKEND";
    readonly weight: number;
  }[];
  /**
   * Operationele ontwerpeisen van de gebruiker (USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT),
   * hard in het model: het roostergemiddelde en de vrijdag vóór een vrij weekend.
   * Zie `operational-requirements.ts`. Zonder dit veld gelden ze niet.
   */
  readonly operationalRequirements?: {
    readonly maxAverageWeeklyMinutes: number;
    readonly fridayLatestEndMinute: number;
    readonly fridayExemptKinds: readonly string[];
    readonly freeWeekendTypes: readonly string[];
  };
  /**
   * Profielaffiniteit per profiel en dienstklasse (0–1), voor de kostenpost
   * `profileAffinity`: (1 − affiniteit) × 10 × gewicht per plaatsing.
   * MACHINIST_PREFERENCE; zie profile-affinity.ts.
   */
  readonly profileAffinityTable?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * Verwacht aantal dagachtige diensten per basisrooster (relatieve gewichten,
   * per profiel genormaliseerd; machinist-preference.ts). Kostenpost
   * `dayDutyTarget` per tiende dienst afwijking.
   */
  readonly dayDutyTargets?: Readonly<Record<string, number>>;
  /** Verouderd: stond voor minimale verandering. Wordt genegeerd. */
  readonly keepExisting?: boolean;
  /** Verouderd: de gewichten van vóór v1.0.3. Wordt genegeerd. */
  readonly weights?: Record<string, number>;
}

export interface SolverRequest {
  readonly duties: readonly SolverDuty[];
  readonly lines: readonly SolverLine[];
  readonly options: SolverOptions;
}

export interface SolverAssignment {
  readonly baseRosterCode: string;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly dutyCode: string;
  readonly dutyKey: string;
}

export interface SolverStatistics {
  readonly status: string;
  readonly optimal: boolean;
  readonly wallTimeSeconds: number;
  readonly objectiveValue: number;
  readonly bestObjectiveBound: number;
  readonly variables: number;
  readonly constraints: number;
  readonly branches: number;
  readonly workers?: number;
}

export type SolverStatus =
  | "OPTIMAL"
  | "FEASIBLE"
  | "INFEASIBLE"
  | "MODEL_INVALID"
  | "UNKNOWN"
  | "ERROR"
  | "UNAVAILABLE";

export interface SolverResult {
  readonly status: SolverStatus;
  readonly assignments: readonly SolverAssignment[];
  /** Dienstinstanties die nergens in een vast rooster pasten. */
  readonly unplacedDuties: readonly string[];
  /** Aanwijzingen bij een onoplosbaar model. Nooit een juridische conclusie. */
  readonly diagnostics: readonly string[];
  readonly statistics: SolverStatistics | null;
  readonly error?: string;
  /**
   * Hoe de poging mét volledige dekking afliep. Wijkt af van `status` wanneer
   * het antwoord uit de toelichtende tweede poging komt.
   */
  readonly fullCoverageStatus?: SolverStatus;
}

/** Het commando waarmee Python wordt gestart. Op Windows is dat `py`. */
const PYTHON = process.env.NS_PYTHON ?? (process.platform === "win32" ? "py" : "python3");

const SCRIPT = path.join(process.cwd(), "python", "cpsat_roster.py");

export async function runSolver(
  request: SolverRequest,
  signal?: AbortSignal,
): Promise<SolverResult> {
  const invoer = JSON.stringify(request);
  // Een ruime marge boven de eigen tijdslimiet van de solver: loopt het proces
  // vast vóórdat hij zelf afrondt, dan hakken wij de knoop door.
  const hardeLimiet = Math.max(request.options.timeLimitSeconds * 1000 + 15_000, 20_000);

  return new Promise<SolverResult>((resolve) => {
    let kind: ReturnType<typeof spawn>;
    try {
      kind = spawn(PYTHON, [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve(unavailable(`De solver kon niet worden gestart: ${String(error)}`));
      return;
    }

    let uit = "";
    let fout = "";
    let afgerond = false;

    const klaar = (result: SolverResult) => {
      if (!afgerond) {
        afgerond = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      kind.kill();
      klaar({
        status: "UNKNOWN",
        assignments: [],
        unplacedDuties: [],
        diagnostics: [
          `De solver is na ${Math.round(hardeLimiet / 1000)} seconden afgebroken zonder ` +
            "afgerond antwoord.",
        ],
        statistics: null,
        error: "TIMEOUT",
      });
    }, hardeLimiet);

    // Stoppen op verzoek: de generatie is geannuleerd. Het proces wordt
    // beëindigd en er komt geen half antwoord terug.
    const bijAfbreken = () => {
      kind.kill();
      klaar({
        status: "UNKNOWN",
        assignments: [],
        unplacedDuties: [],
        diagnostics: ["De berekening is op verzoek gestopt."],
        statistics: null,
        error: "CANCELLED",
      });
    };
    if (signal?.aborted) {
      bijAfbreken();
      return;
    }
    signal?.addEventListener("abort", bijAfbreken, { once: true });


    kind.stdout?.on("data", (chunk) => {
      uit += String(chunk);
    });
    kind.stderr?.on("data", (chunk) => {
      fout += String(chunk);
    });

    kind.on("error", (error) => {
      klaar(
        unavailable(
          `De solver kon niet worden gestart (${PYTHON}). Is Python met ortools ` +
            `geïnstalleerd? ${error.message}`,
        ),
      );
    });

    kind.on("close", (code) => {
      if (code !== 0) {
        klaar(
          unavailable(
            `De solver stopte met code ${code}. ${fout.trim().slice(0, 400)}`.trim(),
          ),
        );
        return;
      }
      try {
        const antwoord = JSON.parse(uit) as SolverResult;
        klaar({
          status: (antwoord.status as SolverStatus) ?? "UNKNOWN",
          assignments: antwoord.assignments ?? [],
          unplacedDuties: antwoord.unplacedDuties ?? [],
          diagnostics: antwoord.diagnostics ?? [],
          statistics: antwoord.statistics ?? null,
          error: antwoord.error,
          fullCoverageStatus: antwoord.fullCoverageStatus,
        });
      } catch (error) {
        klaar(
          unavailable(
            `Het antwoord van de solver was niet te lezen: ${String(error)}. ` +
              uit.slice(0, 200),
          ),
        );
      }
    });

    kind.stdin?.write(invoer);
    kind.stdin?.end();
  });
}

function unavailable(reden: string): SolverResult {
  return {
    status: "UNAVAILABLE",
    assignments: [],
    unplacedDuties: [],
    diagnostics: [reden],
    statistics: null,
    error: reden,
  };
}

/** Draait de solver en meldt of hij bruikbaar is. Voor de systeemstatus. */
export async function solverHealth(): Promise<{
  readonly available: boolean;
  readonly detail: string;
}> {
  const proef = await runSolver({
    duties: [
      {
        code: "TEST",
        weekday: 1,
        startMinute: 480,
        endMinute: 960,
        timeOfDayKinds: ["VROEG"],
        category: "EARLY",
        isNight: false,
        isShunting: false,
        isWeekend: false,
        isLong: false,
      },
    ],
    lines: [
      {
        baseRosterCode: "PROEF",
        lineNumber: 1,
        profile: "VROEG",
        cycleWeeks: 1,
        allowedKinds: ["VROEG"],
        days: [{ weekIndex: 1, weekday: 1, assignable: true, dutyCode: null }],
      },
    ],
    options: {
      minRestMinutes: 0,
      maxConsecutiveDuties: 0,
      timeLimitSeconds: 5,
      seed: 1,
      keepExisting: false,
      weights: {},
    },
  });

  const goed = proef.status === "OPTIMAL" || proef.status === "FEASIBLE";
  return {
    available: goed,
    detail: goed
      ? `Solver bereikbaar; proefmodel opgelost in ${proef.statistics?.wallTimeSeconds ?? 0}s.`
      : (proef.diagnostics[0] ?? proef.error ?? "Solver niet bereikbaar."),
  };
}
