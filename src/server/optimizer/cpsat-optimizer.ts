import { randomUUID } from "node:crypto";
import { allowedKindsForProfile, profileAllowsDuty } from "@/domain/roster-profiles";
import type { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
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
  type SlotAssignment,
  type SolverDuty,
  type SolverLine,
  type SolverOptions,
  type SolverResult,
  runSolver,
} from "./cpsat-solver";
import { type ObjectiveWeights, STRATEGY_WEIGHTS } from "./objective-weights";
import {
  ADJACENT_TRANSITION_PENALTY,
  COMFORTABLE_REST_MINUTES,
  OFF_POSITION_TYPES,
  OVER_ONE_OFF_DAY_PENALTY,
  OVER_TWO_OFF_DAYS_PENALTY,
  HUMAN_OVER_ONE_OFF_DAY_PENALTY,
  HUMAN_ADJACENT_TRANSITION_PENALTY,
} from "@/domain/roster-quality-config";
import { ANCHOR_CREDIT_MINUTES, TARGET_WEEKLY_MINUTES } from "@/domain/roster-hours";
import type { OperationalRequirements } from "@/domain/operational-requirements";
import { type DutyClass, dutyClass } from "@/domain/duty-class";
import { DAY_DUTY_CLASSES, DAY_DUTY_WEIGHTS, affinityValue } from "@/domain/profile-affinity";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { humanNightExitTables } from "./night-exit-tables";

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
  /** De gewichten van de zachte doelen. Zie objective-weights.ts. */
  readonly objective: ObjectiveWeights;
  readonly seed: number;
  /** Op de hoofdtegels, of onder "Meer strategieën". */
  readonly primary: boolean;
}

export const SCENARIO_PROFILES: readonly ScenarioDefinition[] = [
  {
    key: "BALANCED",
    label: "Optimale totaalbalans",
    description:
      "Maakt het rooster als geheel zo goed mogelijk: uren rond 40:00 per rooster, rust, " +
      "nachten in reeksen, rustige overgangen tussen dagdelen en een eerlijke verdeling " +
      "van nacht, rangeer en weekend — tegelijk, binnen alle harde regels.",
    objective: STRATEGY_WEIGHTS.BALANCED,
    seed: 1,
    primary: true,
  },
  {
    key: "REST_QUALITY",
    label: "Rust & regelmaat",
    description:
      "Legt extra gewicht op ruime rust, stabiele dienstreeksen, zo weinig mogelijk " +
      "heen-en-weer tussen dagdelen en herstel na een nachtreeks.",
    objective: STRATEGY_WEIGHTS.REST_QUALITY,
    seed: 2,
    primary: true,
  },
  {
    key: "FAIR_BURDEN",
    label: "Eerlijkste lastenverdeling",
    description:
      "Legt extra gewicht op een gelijke verdeling van nachten, rangeerdiensten en " +
      "weekenduren over de roosters die ze dragen, per regel gerekend.",
    objective: STRATEGY_WEIGHTS.FAIR_BURDEN,
    seed: 3,
    primary: true,
  },
  {
    key: "MINIMAL_CHANGE",
    label: "Minste verschil met huidig rooster",
    description:
      "Houdt zoveel mogelijk dienstnummers op hun huidige plek en verbetert alleen waar " +
      "dat weinig verandering kost. Voor een wijzigingsblad meestal het uitgangspunt.",
    objective: STRATEGY_WEIGHTS.MINIMAL_CHANGE,
    seed: 4,
    primary: false,
  },
  {
    key: "COVERAGE",
    label: "Maximale plaatsing in vaste roosters",
    description:
      "Plaatst alle diensten in vaste roosterlijnen. Omdat volledige dekking inmiddels voor " +
      "elke strategie een harde eis is, weegt deze variant verder als de totaalbalans.",
    objective: STRATEGY_WEIGHTS.COVERAGE,
    seed: 5,
    primary: false,
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
  /**
   * De uitkomst van de poging mét volledige dekking. INFEASIBLE betekent: er
   * bestaat binnen de harde eisen geen rooster meer — bij een diversiteitseis
   * dus geen afwijkende kandidaat.
   */
  readonly fullCoverageStatus: string;
  readonly optimal: boolean;
  readonly wallTimeSeconds: number;
  readonly variables: number;
  readonly constraints: number;
  readonly diagnostics: readonly string[];
  readonly accounting: DutyAccounting;
  readonly seed: number;
  readonly weights: Readonly<Record<string, number>>;
  /** Hoeveel zoekdraden er werden gebruikt. */
  readonly workers: number;
}

/** Wat een aanroeper per run kan meegeven bovenop de strategie. */
export interface CpSatRunOptions {
  /** Andere gewichten dan die van de strategie, bijvoorbeeld bij een herbouw. */
  readonly objective?: ObjectiveWeights;
  readonly workers?: number;
  readonly seed?: number;
  /** Roosters waar nachten horen; alleen daartussen wordt de nachtbelasting vergeleken. */
  readonly nightRosterCodes?: readonly string[];
  /** Een eerdere oplossing als vertrekpunt, en voor preserveHint. */
  readonly hint?: readonly CandidateAssignment[];
  /** Eerdere kandidaten waarvan deze moet verschillen. */
  readonly exclude?: readonly (readonly CandidateAssignment[])[];
  /** Zie SolverOptions.explainShortfall. */
  readonly explainShortfall?: boolean;
  /** Plaatsingen die blijven staan; de rest wordt opnieuw ingedeeld. */
  readonly fixedAssignments?: readonly CandidateAssignment[];
  readonly linearizationLevel?: number;
  /** Op ten minste zoveel dienstdagen anders dan elke uitgesloten kandidaat. */
  readonly minDifferentSlots?: number;
  readonly feedbackPenalties?: SolverOptions["feedbackPenalties"];
  readonly signal?: AbortSignal;
  /**
   * De geijkte nachtuitgang uit de menselijke roosters: na een nachtreeks eerst
   * twee vrije dagen, dan liever laat dan vroeg (zie HUMAN_ADJACENT_TRANSITION_PENALTY).
   * De begintijdsterm `startJitter` staat hier los van en hoort bij de gewichten.
   * Uit voor de klassieke zoekmachine.
   */
  readonly humanRhythm?: boolean;
  /**
   * Factor op de nachtrij van die menselijke tabel (standaard 1); zie
   * `night-exit-tables.ts`. Alleen met `humanRhythm`.
   */
  readonly nightExitScale?: number;
  /** Operationele ontwerpeisen die hard in het model gaan; zie `operational-requirements.ts`. */
  readonly operational?: OperationalRequirements;
  /**
   * Voorkeurstermen (machinistenvoorkeur): gewicht per stap van 0,1 affiniteit
   * per plaatsing, en per tiende dienst afwijking van het dagdienstdoel per
   * rooster. Nul of afwezig: uit. Gewichten uit de wisselkoersen × schaal.
   */
  readonly preference?: { readonly affinityWeight: number; readonly dayDutyWeight: number };
}

const DUTY_CLASSES: readonly DutyClass[] = ["EXTREME_EARLY", "EARLY", "DAYLIKE_EARLY", "EARLY_LATE", "LATE", "PREMIUM_LATE", "NIGHT", "OTHER"];

/** Affiniteit per profiel en klasse, voor de oplosser. */
function affinityTable(profiles: readonly string[]): Record<string, Record<string, number>> {
  return Object.fromEntries(
    [...new Set(profiles)].map((profiel) => [profiel, Object.fromEntries(DUTY_CLASSES.map((k) => [k, affinityValue(profiel, k)]))]),
  );
}

/**
 * Verwacht aantal dagachtige diensten per basisrooster: elke dagachtige dienst
 * verdeelt zich over de roosters die hem mogen rijden, naar hun relatieve
 * gewicht (per profiel genormaliseerd), zoals `dayDutyDistribution` meet.
 */
function dayDutyTargets(input: OptimizerInput, instances: readonly DutyInstance[]): Record<string, number> {
  const roosters = new Map<string, string>();
  for (const line of input.rosterLines) roosters.set(line.baseRosterCode, line.profile);
  const doel: Record<string, number> = Object.fromEntries([...roosters.keys()].map((code) => [code, 0]));
  for (const instance of instances) {
    const d = instance.duty;
    if (!DAY_DUTY_CLASSES.includes(dutyClass({ startMinute: d.startMinute, endMinute: d.endMinute, kinds: d.kinds }))) continue;
    const geschikt = [...roosters].filter(([, profiel]) => profileAllowsDuty(profiel as RosterProfile, d.kinds as DutyKind[]));
    const noemer = geschikt.reduce((s, [, profiel]) => s + (DAY_DUTY_WEIGHTS[profiel]?.weight ?? 20), 0);
    if (noemer === 0) continue;
    for (const [code, profiel] of geschikt) doel[code] += (DAY_DUTY_WEIGHTS[profiel]?.weight ?? 20) / noemer;
  }
  return doel;
}

function slotKeyOf(entry: {
  readonly baseRosterCode: string;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
}): string {
  return `${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|${entry.weekday}`;
}

function slotAssignmentsOf(assignments: readonly CandidateAssignment[]): readonly SlotAssignment[] {
  return assignments
    .filter((entry) => entry.positionType === "DUTY" && entry.dutyCode)
    .map((entry) => ({ slotKey: slotKeyOf(entry), dutyKey: `${entry.dutyCode}|${entry.weekday}` }));
}

function slotAssignmentsOfLines(lines: readonly OptimizerLine[]): readonly SlotAssignment[] {
  return lines.flatMap((line) =>
    line.days
      .filter((day) => day.positionType === "DUTY" && day.dutyCode)
      .map((day) => ({
        slotKey: slotKeyOf({
          baseRosterCode: line.baseRosterCode,
          lineNumber: line.lineNumber,
          weekIndex: day.weekIndex,
          weekday: day.weekday,
        }),
        dutyKey: `${day.dutyCode}|${day.weekday}`,
      })),
  );
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
  // 2.0.0 sinds platformversie 1.0.3: cyclus in rotatievolgorde, nachtreeksen,
  // overgangen en diversiteit. Een kandidaat van 1.0.0 is met een ander model
  // gemaakt, en dat hoort aan de stempel te zien zijn.
  readonly version = "2.1.0";
  readonly describe =
    "Constraint-optimalisatie over alle roosterlijnen en profielen tegelijk, met " +
    "harde grenzen als uitsluiting en de overige doelen als kosten.";

  /** Beschikbaar na `generate`, voor het rapport en het scherm. */
  lastExtras: CpSatOutcomeExtras | null = null;

  constructor(
    private readonly scenario: ScenarioDefinition = SCENARIO_PROFILES[0],
    private readonly timeLimitSeconds = 30,
    private readonly options: CpSatRunOptions = {},
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
        seed: this.options.seed ?? this.scenario.seed,
        workers: this.options.workers ?? 1,
        objective: {
          ...(this.options.objective ?? this.scenario.objective),
          ...(this.options.preference
            ? { profileAffinity: this.options.preference.affinityWeight, dayDutyTarget: this.options.preference.dayDutyWeight }
            : {}),
        },
        transitionPenalties: {
          ...(this.options.humanRhythm
            ? humanNightExitTables(this.options.nightExitScale ?? 1)
            : { adjacent: ADJACENT_TRANSITION_PENALTY, overOffDay: OVER_ONE_OFF_DAY_PENALTY }),
        },
        ...(this.options.humanRhythm
          ? {
              startJitterFreeMinutes: QUALITY_MODEL_V2.components.flow.parts.startJitter.freeMinutes,
              startJitterFullMinutes: QUALITY_MODEL_V2.components.flow.parts.startJitter.fullMinutes,
            }
          : {}),
        offPositionTypes: OFF_POSITION_TYPES,
        comfortableRestMinutes: COMFORTABLE_REST_MINUTES,
        targetWeeklyMinutes: TARGET_WEEKLY_MINUTES,
        anchorCreditMinutes: ANCHOR_CREDIT_MINUTES as Record<string, number>,
        nightRosterCodes: this.options.nightRosterCodes ?? [],
        referenceAssignments: slotAssignmentsOfLines(input.rosterLines),
        hintAssignments: this.options.hint ? slotAssignmentsOf(this.options.hint) : [],
        excludeSolutions: (this.options.exclude ?? []).map(slotAssignmentsOf),
        minDifferentSlots: this.options.minDifferentSlots ?? 0,
        explainShortfall: this.options.explainShortfall ?? true,
        fixedAssignments: slotAssignmentsOf(this.options.fixedAssignments ?? []),
        ...(this.options.linearizationLevel === undefined ? {} : { linearizationLevel: this.options.linearizationLevel }),
        feedbackPenalties: this.options.feedbackPenalties ?? [],
        ...(this.options.preference && (this.options.preference.affinityWeight > 0 || this.options.preference.dayDutyWeight > 0)
          ? {
              profileAffinityTable: affinityTable(input.rosterLines.map((line) => line.profile)),
              dayDutyTargets: dayDutyTargets(input, instances),
            }
          : {}),
        ...(this.options.operational
          ? {
              operationalRequirements: {
                maxAverageWeeklyMinutes: this.options.operational.rosterAverageHours.maxAverageWeeklyMinutes,
                fridayLatestEndMinute: this.options.operational.freeWeekendFriday.latestEndMinute,
                fridayExemptKinds: this.options.operational.freeWeekendFriday.exemptKinds,
                freeWeekendTypes: this.options.operational.freeWeekend.freeTypes,
              },
            }
          : {}),
      },
    }, this.options.signal);

    if (result.status !== "OPTIMAL" && result.status !== "FEASIBLE") {
      this.lastExtras = extras(result, this.scenario, this.options.seed ?? this.scenario.seed, {
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
    this.lastExtras = extras(result, this.scenario, this.options.seed ?? this.scenario.seed, { ...accounting, balanced: sluitend }, {
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
    category: duty.kinds.includes("NACHT")
      ? "NIGHT"
      : duty.kinds.includes("LAAT")
        ? "LATE"
        : duty.kinds.includes("VROEG")
          ? "EARLY"
          : null,
    isNight: duty.kinds.includes("NACHT"),
    isShunting: duty.kinds.includes("RANGEER"),
    isWeekend: instance.weekday >= 6,
    isLong: duty.endMinute - duty.startMinute >= 9 * 60 || isHardNightService(shape),
    preferenceClass: dutyClass({ startMinute: duty.startMinute, endMinute: duty.endMinute, kinds: duty.kinds }),
    isDayDuty: DAY_DUTY_CLASSES.includes(dutyClass({ startMinute: duty.startMinute, endMinute: duty.endMinute, kinds: duty.kinds })),
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
      positionType: day.positionType,
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
  // De zaadwaarde die werkelijk is gebruikt. Stond eerder als die van de
  // strategie in de statistiek, terwijl de generatie per poging een andere
  // meegeeft: een kandidaat was daardoor niet naar zijn zoekpoging te herleiden.
  seed: number,
  accounting: DutyAccounting,
  slots: { readonly total: number; readonly empty: number } = { total: 0, empty: 0 },
): CpSatOutcomeExtras {
  return {
    dutySlots: slots.total,
    emptyDutySlots: slots.empty,
    solverStatus: result.status,
    fullCoverageStatus: result.fullCoverageStatus ?? result.status,
    optimal: result.statistics?.optimal ?? false,
    wallTimeSeconds: result.statistics?.wallTimeSeconds ?? 0,
    variables: result.statistics?.variables ?? 0,
    constraints: result.statistics?.constraints ?? 0,
    diagnostics: result.diagnostics,
    accounting,
    seed,
    weights: { ...scenario.objective },
    workers: result.statistics?.workers ?? 1,
  };
}
