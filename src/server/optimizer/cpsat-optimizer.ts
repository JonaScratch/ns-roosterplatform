import { randomUUID } from "node:crypto";
import { allowedKindsForProfile } from "@/domain/roster-profiles";
import { isHardNightService } from "@/domain/duty-window";
import { type CandidateAssignment, sealCandidate } from "@/domain/candidate";
import type {
  OptimizerDuty,
  OptimizerInput,
  OptimizerLine,
  OptimizerOutcome,
  RosterOptimizer,
} from "./contract";
import { dutyIndex, linesFromAssignments, measureLine } from "./metrics";
import { scoreRoster } from "./scoring";
import {
  type SolverDuty,
  type SolverLine,
  type SolverResult,
  runSolver,
} from "./cpsat-solver";

/**
 * De globale roosteroptimizer.
 *
 * ## Eén vraagstuk, niet vijf
 *
 * Alle roosterlijnen van alle profielen gaan in één model. Dat is geen
 * technische voorkeur maar de kern van de opdracht: wie Vroeg eerst vult en
 * daarna Laat, geeft het eerste profiel de beste diensten en laat het laatste
 * opruimen. De solver ziet alle lijnen tegelijk en weegt de gevolgen van een
 * verschuiving in het ene rooster tegen het andere.
 *
 * ## Wat hier hard is en wat kost
 *
 * Hard, en dus onmogelijk: profielgrenzen, weekdagen, een dienst hooguit één
 * keer, één dienst per dag, de rusttijd tussen opeenvolgende dagen, het maximum
 * aantal aaneengesloten dienstdagen, en de structurele ankers — die staan niet
 * eens als variabele in het model.
 *
 * Kosten, en dus afweegbaar: dekking, minimale verandering, eerlijke verdeling
 * van zware diensten binnen hetzelfde profiel, en de draairichting.
 *
 * Er is geen kostenpost waarmee een harde grens kan worden afgekocht. Dat is te
 * zien aan de code: harde eisen worden als `model.Add(...)` uitgesloten en
 * komen nergens in de doelfunctie voor.
 *
 * ## Deze optimizer zegt nooit "geldig"
 *
 * Wat hij oplevert is een voorstel. De rusttijd die hij toepast, is één getal
 * uit de regelcatalogus; de catalogus bevat tientallen regels die hij niet kan
 * vertalen. Daarom telt alleen wat de onafhankelijke validator er daarna van
 * zegt — en die leest deze klasse niet.
 */

/** De weegprofielen. Alleen zachte doelen verschillen; hard blijft hard. */
export type ScenarioProfile =
  | "BALANCED"
  | "REST_QUALITY"
  | "FAIR_BURDEN"
  | "MINIMAL_CHANGE"
  | "COVERAGE";

export interface ScenarioDefinition {
  readonly key: ScenarioProfile;
  readonly label: string;
  readonly description: string;
  readonly weights: Record<string, number>;
  readonly seed: number;
}

export const SCENARIO_PROFILES: readonly ScenarioDefinition[] = [
  {
    key: "BALANCED",
    label: "Scenario A — beste totale balans",
    description: "Weegt dekking, verdeling en ritme ongeveer even zwaar.",
    weights: { coverage: 100, fairness: 30, rotation: 10, keepExisting: 20 },
    seed: 1,
  },
  {
    key: "REST_QUALITY",
    label: "Scenario B — beste rustkwaliteit",
    description:
      "Laat de draairichting zwaarder wegen, zodat opeenvolgende dagen rustiger in " +
      "elkaar overlopen. Kan ten koste gaan van het aantal geplaatste diensten.",
    weights: { coverage: 80, fairness: 20, rotation: 40, keepExisting: 10 },
    seed: 2,
  },
  {
    key: "FAIR_BURDEN",
    label: "Scenario C — eerlijkste lastenverdeling",
    description:
      "Legt het meeste gewicht op een gelijke verdeling van nacht-, rangeer- en " +
      "weekenddiensten binnen hetzelfde roosterprofiel.",
    weights: { coverage: 90, fairness: 70, rotation: 10, keepExisting: 5 },
    seed: 3,
  },
  {
    key: "MINIMAL_CHANGE",
    label: "Scenario D — minste verschil met het huidige rooster",
    description:
      "Houdt zoveel mogelijk dienstnummers op hun huidige plek. Voor een " +
      "wijzigingsblad meestal het uitgangspunt: minder verandering is minder " +
      "verstoring voor medewerkers.",
    weights: { coverage: 100, fairness: 10, rotation: 5, keepExisting: 120 },
    seed: 4,
  },
  {
    key: "COVERAGE",
    label: "Scenario E — maximale plaatsing in vaste roosters",
    description:
      "Plaatst zoveel mogelijk diensten in vaste roosterlijnen, zodat de " +
      "dienstindeling er zo min mogelijk operationeel hoeft in te vullen.",
    weights: { coverage: 200, fairness: 15, rotation: 5, keepExisting: 10 },
    seed: 5,
  },
];

/** Waar elke dienstinstantie is gebleven. De som moet altijd kloppen. */
export interface DutyAccounting {
  readonly sourceInstances: number;
  readonly fixedRoster: number;
  readonly operationalPool: readonly string[];
  readonly unassignable: readonly { readonly key: string; readonly reason: string }[];
  readonly excluded: readonly { readonly key: string; readonly reason: string }[];
  readonly balanced: boolean;
}

export interface CpSatOutcomeExtras {
  /** Dienstdagen in de roosterlijnen die leeg zijn gebleven. */
  readonly emptyDutySlots: number;
  readonly dutySlots: number;
  readonly solverStatus: string;
  readonly optimal: boolean;
  readonly wallTimeSeconds: number;
  readonly variables: number;
  readonly constraints: number;
  readonly diagnostics: readonly string[];
  readonly accounting: DutyAccounting;
  readonly seed: number;
  readonly weights: Record<string, number>;
}

/** Eén dienstinstantie: een dienstnummer op een concrete weekdag. */
interface DutyInstance {
  readonly key: string;
  readonly code: string;
  readonly weekday: number;
  readonly duty: OptimizerDuty;
}

export class CpSatOptimizer implements RosterOptimizer {
  readonly name = "cp-sat";
  readonly version = "1.0.0";
  readonly describe =
    "Constraint-optimalisatie over alle roosterlijnen en profielen tegelijk, met " +
    "harde grenzen als uitsluiting en de overige doelen als kosten.";

  /** Beschikbaar na `generate`, voor het rapport en het scherm. */
  lastExtras: CpSatOutcomeExtras | null = null;

  constructor(
    private readonly scenario: ScenarioDefinition = SCENARIO_PROFILES[0],
    private readonly timeLimitSeconds = 30,
    /** Bij een wijzigingsblad blijven bestaande dienstnummers zoveel mogelijk staan. */
    private readonly keepExisting = false,
  ) {}

  async generate(input: OptimizerInput, scenarioLabel: string): Promise<OptimizerOutcome> {
    if (input.rosterLines.length === 0) {
      return { status: "REFUSED", reason: "Er zijn geen roosterlijnen om mee te werken." };
    }
    if (input.duties.length === 0) {
      return { status: "REFUSED", reason: "Er zijn geen diensten om te verdelen." };
    }

    const { instances, excluded } = instancesFrom(input);
    if (instances.length === 0) {
      return {
        status: "REFUSED",
        reason:
          "Geen enkele dienst heeft een weekdag waarop hij gereden wordt. Zonder weekdag " +
          "is niet te bepalen op welke roosterdag een dienst hoort.",
      };
    }

    const solverDuties = instances.map(toSolverDuty);
    const solverLines = input.rosterLines.map(toSolverLine);

    const result = await runSolver({
      duties: solverDuties,
      lines: solverLines,
      options: {
        minRestMinutes: constraintValue(input, "RP_DAILY_REST_PLANNED", 0),
        maxConsecutiveDuties: constraintValue(input, "MAX_CONSECUTIVE_SERVICES", 0),
        timeLimitSeconds: this.timeLimitSeconds,
        seed: this.scenario.seed,
        keepExisting: this.keepExisting,
        weights: this.scenario.weights,
      },
    });

    if (result.status !== "OPTIMAL" && result.status !== "FEASIBLE") {
      this.lastExtras = extras(result, this.scenario, {
        sourceInstances: instances.length,
        fixedRoster: 0,
        operationalPool: [],
        unassignable: instances.map((instance) => ({
          key: instance.key,
          reason: "Er is geen oplossing gevonden voor het hele vraagstuk.",
        })),
        excluded,
        balanced: true,
      });
      return {
        status: "REFUSED",
        reason: refusalReason(result),
      };
    }

    // ── De boekhouding ────────────────────────────────────────────────────────
    const geplaatst = new Set(result.assignments.map((assignment) => assignment.dutyKey));
    const nietGeplaatst = instances.filter((instance) => !geplaatst.has(instance.key));

    // Geen enkel slot beschikbaar betekent iets anders dan "past er nu niet bij":
    // het eerste is een structureel probleem, het tweede een verdeling.
    const zonderSlot = new Set(
      nietGeplaatst
        .filter((instance) => !hasAnySlot(instance, solverLines))
        .map((instance) => instance.key),
    );

    const accounting: DutyAccounting = {
      sourceInstances: instances.length,
      fixedRoster: result.assignments.length,
      operationalPool: nietGeplaatst
        .filter((instance) => !zonderSlot.has(instance.key))
        .map((instance) => instance.key),
      unassignable: [...zonderSlot].map((key) => ({
        key,
        reason:
          "Geen enkele roosterlijn heeft op deze weekdag een dienstslot dat dit " +
          "dagdeel toestaat.",
      })),
      excluded,
      balanced: true,
    };
    const som =
      accounting.fixedRoster +
      accounting.operationalPool.length +
      accounting.unassignable.length;
    const sluitend = som === accounting.sourceInstances;

    const dienstdagen = input.rosterLines.reduce(
      (som, line) => som + line.days.filter((day) => day.positionType === "DUTY").length,
      0,
    );
    this.lastExtras = extras(result, this.scenario, { ...accounting, balanced: sluitend }, {
      total: dienstdagen,
      empty: dienstdagen - result.assignments.length,
    });

    if (!sluitend) {
      // Dit hoort onmogelijk te zijn. Gebeurt het toch, dan is er een dienst
      // zoekgeraakt of dubbel geteld, en dat is geen kandidaat waard.
      return {
        status: "REFUSED",
        reason:
          `De boekhouding klopt niet: ${accounting.sourceInstances} dienstinstanties in, ` +
          `${som} verantwoord. Er is geen kandidaat gemaakt.`,
      };
    }

    // Elke dienstdag in een roosterlijn moet een dienstnummer krijgen.
    //
    // Constraint 1 in de solver zegt "hooguit één dienst per slot", niet
    // "precies één": een slot zonder kandidaat, of een slot dat de solver om
    // gewichtsredenen leeg liet, wordt daar niet geweigerd maar stil
    // doorgelaten. `mergeAssignments` zette daar voorheen `dutyCode: null` neer
    // met `positionType` nog altijd `DUTY` — een concrete dienstdag zonder
    // dienstnummer, die alleen de onafhankelijke eindvalidatie nog ving.
    //
    // Dat is precies de fout die hier niet meer mag ontstaan: een dienstdag
    // zonder dienstnummer bestaat niet. Wordt hij toch gevonden, dan is dit
    // geen kandidaat maar een geweigerde opdracht, met de exacte lege sloten
    // erbij — niet pas na het genereren, maar vóórdat er iets wordt opgeslagen.
    const legeSloten = emptyDutySlots(input.rosterLines, result);
    if (legeSloten.length > 0) {
      const voorbeelden = legeSloten
        .slice(0, 5)
        .map(
          (slot) =>
            `${slot.baseRosterCode}/lijn ${slot.lineNumber}/week ${slot.weekIndex}/dag ${slot.weekday}`,
        );
      this.lastExtras = {
        ...this.lastExtras!,
        diagnostics: [
          `${legeSloten.length} dienstdag(en) in het vaste rooster kregen geen dienstnummer: ` +
            `${voorbeelden.join(", ")}${legeSloten.length > 5 ? ", …" : ""}.`,
          ...this.lastExtras!.diagnostics,
        ],
      };
      return {
        status: "REFUSED",
        reason:
          `${legeSloten.length} dienstdag(en) in de roosterstructuur zouden zonder ` +
          `dienstnummer blijven, bijvoorbeeld ${voorbeelden[0]}. Een concrete dienstdag ` +
          "zonder dienstnummer is geen rooster; er is geen kandidaat gemaakt. Meestal " +
          "betekent dit dat de roosterstructuur voor dit profiel meer dienstslots op deze " +
          "weekdag verwacht dan het dienstenpakket op die weekdag aanbiedt.",
      };
    }

    const assignments = mergeAssignments(input.rosterLines, result);
    const duties = dutyIndex(input.duties);
    const reference = input.rosterLines.map((line) => measureLine(line, duties));
    const scored = scoreRoster(
      linesFromAssignments(assignments, input.rosterLines),
      duties,
      input.aggregatedFeedback,
      reference,
    );

    return {
      status: "CANDIDATE_GENERATED",
      candidate: sealCandidate({
        id: randomUUID(),
        status: "CANDIDATE_GENERATED",
        optimizerName: this.name,
        optimizerVersion: `${this.version}+${this.scenario.key}`,
        generatedAt: new Date().toISOString(),
        mode: input.mode,
        legalStatus: "SIMULATION_ONLY",
        scenarioLabel,
        sourceScheduleVersion: input.sourceScheduleVersion,
        rulesetVersion: input.rulesetVersion,
        inputDataVersion: input.inputDataVersion,
        assignments,
        scoreBreakdown: scored.breakdown,
      }),
    };
  }
}

// ── Vertalen heen ────────────────────────────────────────────────────────────

/**
 * De dienstinstanties.
 *
 * Een dienstnummer is geen instantie: 101 op maandag en 101 op dinsdag zijn twee
 * keer werk. Waar de bron weekdagen vermeldt, worden die gebruikt. Waar zij dat
 * niet doet, wordt gekeken op welke weekdagen de dienst nu in de roosterlijnen
 * staat — dat is een waarneming en geen aanname. Levert ook dat niets op, dan
 * wordt de dienst uitgesloten mét reden en niet stilzwijgend genegeerd.
 */
function instancesFrom(input: OptimizerInput): {
  instances: DutyInstance[];
  excluded: { key: string; reason: string }[];
} {
  const waargenomen = new Map<string, Set<number>>();
  for (const line of input.rosterLines) {
    for (const day of line.days) {
      if (day.positionType === "DUTY" && day.dutyCode) {
        const set = waargenomen.get(day.dutyCode) ?? new Set<number>();
        set.add(day.weekday);
        waargenomen.set(day.dutyCode, set);
      }
    }
  }

  const instances: DutyInstance[] = [];
  const excluded: { key: string; reason: string }[] = [];

  for (const duty of input.duties) {
    const weekdagen =
      duty.weekdays.length > 0
        ? [...duty.weekdays]
        : [...(waargenomen.get(duty.code) ?? new Set<number>())];

    if (weekdagen.length === 0) {
      excluded.push({
        key: `${duty.code}|?`,
        reason:
          "Het dienstenpakket vermeldt geen weekdagen voor deze dienst en hij komt in " +
          "geen enkele roosterlijn voor. Zonder weekdag is er geen roosterdag om hem op " +
          "te plaatsen.",
      });
      continue;
    }
    for (const weekday of [...new Set(weekdagen)].sort()) {
      instances.push({ key: `${duty.code}|${weekday}`, code: duty.code, weekday, duty });
    }
  }

  return { instances, excluded };
}

const TIME_OF_DAY = ["VROEG", "LAAT", "NACHT"] as const;

function toSolverDuty(instance: DutyInstance): SolverDuty {
  const duty = instance.duty;
  const shape = {
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    breakMinutes: duty.breakMinutes,
    overtimeMinutes: duty.overtimeMinutes,
  };
  return {
    code: duty.code,
    weekday: instance.weekday,
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    timeOfDayKinds: duty.kinds.filter((kind) =>
      (TIME_OF_DAY as readonly string[]).includes(kind),
    ),
    isNight: duty.kinds.includes("NACHT"),
    isShunting: duty.kinds.includes("RANGEER"),
    isWeekend: instance.weekday >= 6,
    isLong: duty.endMinute - duty.startMinute >= 9 * 60 || isHardNightService(shape),
  };
}

function toSolverLine(line: OptimizerLine): SolverLine {
  return {
    baseRosterCode: line.baseRosterCode,
    lineNumber: line.lineNumber,
    profile: line.profile,
    cycleWeeks: line.cycleWeeks,
    allowedKinds: allowedKindsForProfile(line.profile),
    days: line.days.map((day) => ({
      weekIndex: day.weekIndex,
      weekday: day.weekday,
      // Alleen dienstdagen zijn te vullen. Rust, reserve, WTV en compensatie
      // komen niet als variabele in het model voor en kunnen dus door geen
      // enkele oplossing worden verplaatst.
      assignable: day.positionType === "DUTY",
      dutyCode: day.dutyCode,
    })),
  };
}

function constraintValue(input: OptimizerInput, ruleId: string, fallback: number): number {
  const constraint = input.hardConstraints.find((item) => item.ruleId === ruleId);
  if (!constraint || !constraint.translatable || constraint.value === null) {
    return fallback;
  }
  return constraint.unit === "HOURS" ? constraint.value * 60 : constraint.value;
}

function hasAnySlot(instance: DutyInstance, lines: readonly SolverLine[]): boolean {
  const soorten = new Set(
    instance.duty.kinds.filter((kind) => (TIME_OF_DAY as readonly string[]).includes(kind)),
  );
  return lines.some(
    (line) =>
      [...soorten].every((kind) => line.allowedKinds.includes(kind)) &&
      line.days.some((day) => day.assignable && day.weekday === instance.weekday),
  );
}

// ── Vertalen terug ───────────────────────────────────────────────────────────

/**
 * Welke dienstdagen van de roosterlijnen geen dienstnummer kregen.
 *
 * Dit wordt vóór `mergeAssignments` aangeroepen: een lege dienstdag mag de
 * kandidaat niet eens bereiken. Zie de toelichting bij de aanroep in
 * `generate()`.
 */
function emptyDutySlots(
  lines: readonly OptimizerLine[],
  result: SolverResult,
): readonly { baseRosterCode: string; lineNumber: number; weekIndex: number; weekday: number }[] {
  const gevuld = new Set(
    result.assignments.map(
      (assignment) =>
        `${assignment.baseRosterCode}|${assignment.lineNumber}|${assignment.weekIndex}|${assignment.weekday}`,
    ),
  );
  return lines.flatMap((line) =>
    line.days
      .filter((day) => day.positionType === "DUTY")
      .filter(
        (day) => !gevuld.has(`${line.baseRosterCode}|${line.lineNumber}|${day.weekIndex}|${day.weekday}`),
      )
      .map((day) => ({
        baseRosterCode: line.baseRosterCode,
        lineNumber: line.lineNumber,
        weekIndex: day.weekIndex,
        weekday: day.weekday,
      })),
  );
}

/**
 * Zet de oplossing terug in een volledige roosterafdruk.
 *
 * De ankerdagen komen ongewijzigd uit de invoer; de dienstdagen krijgen wat de
 * solver heeft gekozen. Op het moment dat deze functie draait, is al
 * vastgesteld dat elke dienstdag een dienstnummer heeft — `generate()` weigert
 * de opdracht anders vóórdat deze functie wordt aangeroepen.
 */
function mergeAssignments(
  lines: readonly OptimizerLine[],
  result: SolverResult,
): readonly CandidateAssignment[] {
  const gekozen = new Map<string, string>();
  for (const assignment of result.assignments) {
    gekozen.set(
      `${assignment.baseRosterCode}|${assignment.lineNumber}|${assignment.weekIndex}|${assignment.weekday}`,
      assignment.dutyCode,
    );
  }

  return lines.flatMap((line) =>
    line.days.map((day) => {
      const sleutel = `${line.baseRosterCode}|${line.lineNumber}|${day.weekIndex}|${day.weekday}`;
      const isDienstdag = day.positionType === "DUTY";
      return {
        baseRosterCode: line.baseRosterCode,
        lineNumber: line.lineNumber,
        weekIndex: day.weekIndex,
        weekday: day.weekday,
        positionType: day.positionType,
        dutyCode: isDienstdag ? (gekozen.get(sleutel) ?? null) : day.dutyCode,
      };
    }),
  );
}

function refusalReason(result: SolverResult): string {
  if (result.status === "INFEASIBLE") {
    return (
      "Er bestaat geen rooster dat aan alle harde eisen voldoet. " +
      (result.diagnostics.length > 0
        ? `Waarschijnlijk knelpunt: ${result.diagnostics.join("; ")}.`
        : "Er is geen aanwijsbaar knelpunt gevonden.")
    );
  }
  if (result.status === "UNAVAILABLE") {
    return `De optimizer is niet beschikbaar. ${result.diagnostics[0] ?? ""}`.trim();
  }
  if (result.error === "TIMEOUT" || result.status === "UNKNOWN") {
    return (
      "Binnen de ingestelde rekentijd is geen afgerond scenario gevonden. Er is geen " +
      "gedeeltelijk rooster bewaard."
    );
  }
  return `De solver gaf status ${result.status}. ${result.error ?? ""}`.trim();
}

function extras(
  result: SolverResult,
  scenario: ScenarioDefinition,
  accounting: DutyAccounting,
  slots: { readonly total: number; readonly empty: number } = { total: 0, empty: 0 },
): CpSatOutcomeExtras {
  return {
    dutySlots: slots.total,
    emptyDutySlots: slots.empty,
    solverStatus: result.status,
    optimal: result.statistics?.optimal ?? false,
    wallTimeSeconds: result.statistics?.wallTimeSeconds ?? 0,
    variables: result.statistics?.variables ?? 0,
    constraints: result.statistics?.constraints ?? 0,
    diagnostics: result.diagnostics,
    accounting,
    seed: scenario.seed,
    weights: scenario.weights,
  };
}
