import "server-only";
import { createHash } from "node:crypto";
import {
  type CandidateAssignment,
  type CandidateRoster,
  type ReviewableRoster,
  sealCandidate,
} from "@/domain/candidate";
import { candidateRejection } from "@/domain/candidate-acceptance";
import {
  type ComponentScores,
  type GateFacts,
  type PoolCandidate,
  type QualityGate,
  type RepairTarget,
  acceptRepair,
  adaptPressure,
  assignmentDistance,
  diagnoseRepair,
  gateFromOfficial,
  offerToPool,
  paretoFront,
  plateauReached,
  rankingScore,
  selectFinal,
} from "@/domain/adaptive-search";
import type { HumanQualityReport } from "@/domain/quality-evaluator";
import { OPERATIONAL_REQUIREMENTS_V1 } from "@/domain/operational-requirements";
import { COMPONENT_KEYS, type ComponentKey, componentWeight } from "@/domain/quality-model";
import { allowedKindsForProfile } from "@/domain/roster-profiles";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import type { OptimizerInput } from "@/server/optimizer/contract";
import { CpSatOptimizer, type CpSatOutcomeExtras, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { dutyIndex, linesFromAssignments, measureLine } from "@/server/optimizer/metrics";
import { scoreRoster } from "@/server/optimizer/scoring";
import type { ObjectiveWeights } from "@/server/optimizer/objective-weights";
import { type CandidateValidationContext, validateCandidate } from "@/server/rules-engine/final-validator";
import { prismaCandidateData } from "@/server/rules-engine/final-validator-data";
import {
  type EvaluationContext,
  evaluateAssignmentsCore,
  evaluateOfficialCore,
  polishAssignmentsCore,
} from "@/server/services/quality-evaluation-service";
import { ADAPTIVE_CONFIG, type SearchMode } from "./config";
import { describeVariant, engineVariant } from "./variant";

/**
 * De adaptieve roosterzoekmachine.
 *
 * ## Waarom niet één solverrun
 *
 * CP-SAT met een tijdslimiet en meerdere zoekdraden levert bij dezelfde invoer
 * elke keer een iets ander rooster op. In de v1.0.3-meting scheelde dat op
 * eerlijke nachtverdeling meer dan twintig punten tussen twee runs. Eén run is
 * dus een loterij. Deze machine doet daarom:
 *
 *   genereren → hard valideren → beoordelen → rangschikken
 *   → gericht repareren → diversifiëren → de besten bewaren
 *
 * met een vaste tijdsbudget per modus, en stopt eerder bij een plateau.
 *
 * ## Wat nooit verandert
 *
 * Dekking, profielen, standplaats, bevoegdheden en de harde regels zitten in het
 * CP-SAT-model en in de eindvalidatie. De machine varieert alleen zaadwaarden,
 * zachte gewichten, vertrekpunten en welke delen van een kandidaat vast blijven
 * staan tijdens een reparatie. Een kandidaat komt pas in de pool nadat de
 * eindvalidatie hem heeft doorgelaten.
 *
 * ## Reparatie als klein vraagstuk
 *
 * Een reparatie legt de roosters vast die niet met de zwakte te maken hebben en
 * laat de solver alleen de overige opnieuw indelen, met de kandidaat als
 * vertrekpunt en een kostenpost op elke afwijking daarvan. Dat is een veel
 * kleiner model, dat de solver in seconden tot op de bodem kan doorzoeken.
 */

export interface AdaptiveSearchInput {
  readonly optimizerInput: OptimizerInput;
  readonly evaluation: EvaluationContext;
  readonly validation: CandidateValidationContext;
  readonly strategy: string;
  readonly strategyLabel: string;
  readonly mode: SearchMode;
  readonly baseWeights: ObjectiveWeights;
  readonly workers: number;
  readonly baseSeed: number;
  readonly feedbackPenalties: ConstructorParameters<typeof CpSatOptimizer>[2] extends infer O
    ? O extends { feedbackPenalties?: infer F }
      ? F
      : never
    : never;
  /** Een herbouw: de ouder is het vertrekpunt en mag niet terugkomen. */
  readonly parent: { readonly id: string; readonly assignments: readonly CandidateAssignment[] } | null;
  readonly requested: number;
  readonly signal: AbortSignal;
  readonly ablation: AblationFlag | null;
  readonly onProgress: (update: ProgressUpdate) => Promise<void>;
}

export type AblationFlag = "no-night-clustering" | "no-transitions" | "no-adaptive-repair";

export type SearchPhase = "SEARCH" | "REPAIR" | "DIVERSIFY" | "VALIDATE";

export interface ProgressUpdate {
  readonly phase: SearchPhase;
  readonly message: string;
  readonly counters: SearchCounters;
  readonly journal: readonly JournalEntry[];
}

export interface SearchCounters {
  attempts: number;
  starts: number;
  repairs: number;
  diversifyStarts: number;
  validCandidates: number;
  rejected: number;
  duplicates: number;
  lowQuality: number;
  elite: number;
  repairsImprovedTarget: number;
  repairsAccepted: number;
  repairsRejectedRegression: number;
  repairsFailed: number;
  /** Bijschaven: hoeveel keer, hoeveel alternatieven, hoeveel ruilen, hoeveel winst. */
  polishRuns: number;
  polishVariants: number;
  polishSwaps: number;
  polishGainTotal: number;
  polishImproved: number;
  bestRobust: number | null;
  bestRanking: number | null;
  evaluationMsTotal: number;
  validationMsTotal: number;
  solverSecondsTotal: number;
  elapsedSeconds: number;
  budgetSeconds: number;
}

export interface JournalEntry {
  readonly attempt: number;
  readonly phase: SearchPhase;
  readonly kind: "START" | "REPAIR" | "DIVERSIFY";
  readonly at: string;
  readonly seed: number;
  readonly workers: number;
  readonly timeLimitSeconds: number;
  readonly weights: ObjectiveWeights;
  readonly pressure: Readonly<Record<string, number>>;
  readonly parentAttempt: number | null;
  readonly target: RepairTarget | null;
  readonly freeRosters: readonly string[] | null;
  readonly fixedSlots: number;
  readonly excludedCandidates: number;
  /** Welke eerdere pogingen zijn uitgesloten en welke was het vertrekpunt: nodig om te herhalen. */
  readonly excludedAttempts: readonly number[];
  readonly hintAttempt: number | null;
  readonly minDifferentSlots: number;
  readonly solver: {
    readonly status: string;
    readonly fullCoverageStatus: string;
    readonly wallTimeSeconds: number;
    readonly optimal: boolean;
  } | null;
  readonly verdict: string;
  readonly reason: string;
  readonly quality: {
    readonly overall: number | null;
    readonly robust: number | null;
    readonly ranking: number | null;
    readonly components: ComponentScores;
    readonly worstLine: number | null;
  } | null;
  readonly deltaToParent: Readonly<Record<string, number | null>> | null;
  readonly diagnosis: readonly string[];
  readonly validation: { readonly status: string; readonly confirmed: number; readonly rejection: string | null } | null;
  readonly evaluationMs: number | null;
  readonly validationMs: number | null;
  /** Wat het bijschaven met ruildiensten aan deze kandidaat heeft gedaan. */
  readonly polish: {
    readonly startRanking: number;
    readonly ranking: number;
    readonly gain: number;
    readonly swaps: number;
    readonly variants: number;
    readonly climbs: number;
    readonly kicks: number;
    readonly seconds: number;
    readonly stopReason: string;
    readonly moves: readonly { a: string; b: string; dutyA: string; dutyB: string; gain: number }[];
  } | null;
  readonly distanceToNearest: number | null;
  /** Alleen voor kandidaten in de pool: nodig om een reparatie te kunnen herhalen. */
  readonly assignments: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> | null;
}

export interface FinalCandidate {
  readonly candidate: CandidateRoster;
  readonly review: ReviewableRoster;
  readonly report: HumanQualityReport;
  readonly ranking: number;
  readonly extras: CpSatOutcomeExtras | null;
  readonly provenance: Record<string, unknown>;
}

export interface AdaptiveSearchResult {
  readonly final: readonly FinalCandidate[];
  readonly journal: readonly JournalEntry[];
  readonly counters: SearchCounters;
  readonly stopReason: string;
  readonly gate: QualityGate;
  readonly cancelled: boolean;
}

interface Lid extends PoolCandidate {
  readonly candidate: CandidateRoster;
  readonly review: ReviewableRoster;
  readonly report: HumanQualityReport;
  readonly extras: CpSatOutcomeExtras | null;
  readonly entry: JournalEntry;
}

// ── Hulpjes ──────────────────────────────────────────────────────────────────

const PRESSURE_FIELDS: Readonly<Record<string, readonly (keyof ObjectiveWeights)[]>> = {
  hours: ["hoursBalance", "hoursWorst"],
  flow: ["transitions"],
  rest: ["restComfort"],
  nights: ["nightSingleton", "nightPair"],
  fairness: ["nightFairness", "shuntingFairness", "weekendFairness"],
};

const TARGET_FIELDS: Readonly<Record<RepairTarget, readonly (keyof ObjectiveWeights)[]>> = {
  NIGHTS: ["nightSingleton", "nightPair"],
  // De nachtrij zelf wordt apart versterkt (nightExitScale × targetBoost); de
  // reeksgewichten gaan mee omhoog, zodat een verplaatste reeks heel blijft.
  // Rust ook: in v1.0.4 en de eerste metingen werd élke nachtreparatie (9 van 9)
  // afgewezen omdat rust 2,8–5,5 punt zakte — een minuut rustcomfort kost de
  // solver 1, een minuut per week urenbalans 900 (repair-analysis.json).
  NIGHT_EXIT: ["nightSingleton", "nightPair", "restComfort"],
  TRANSITIONS: ["transitions"],
  HOURS: ["hoursBalance", "hoursWorst"],
  FAIRNESS: ["nightFairness", "shuntingFairness", "weekendFairness"],
  REST: ["restComfort", "transitions"],
};

function slotSleutel(entry: CandidateAssignment): string {
  return `${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|${entry.weekday}`;
}

function slotKaart(assignments: readonly CandidateAssignment[]): Map<string, string | null> {
  return new Map(assignments.filter((entry) => entry.positionType === "DUTY").map((entry) => [slotSleutel(entry), entry.dutyCode]));
}

export function compact(assignments: readonly CandidateAssignment[]): Record<string, Record<string, string[]>> {
  const uit: Record<string, Record<string, string[]>> = {};
  for (const entry of assignments) {
    const rooster = (uit[entry.baseRosterCode] ??= {});
    const cellen = (rooster[`${entry.lineNumber}|${entry.weekIndex}`] ??= Array.from({ length: 7 }, () => "~RUST"));
    cellen[entry.weekday - 1] = entry.positionType === "DUTY" ? (entry.dutyCode ?? "~LEEG") : `~${entry.positionType}`;
  }
  return uit;
}

/** Een deterministische pseudo-willekeur uit een zaadwaarde (mulberry32). */
function willekeur(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function componenten(report: HumanQualityReport): ComponentScores {
  return Object.fromEntries(COMPONENT_KEYS.map((key) => [key, report.components[key].score])) as ComponentScores;
}

function feiten(report: HumanQualityReport): GateFacts & { twoNightBlocks: number; nightExitsBelowRule: number } {
  return {
    singletonNights: report.metrics.nights.singletons,
    twoNightBlocks: report.metrics.nights.blocks2,
    nightExitsBelowRule: Object.values(report.worstCase?.exitsBelowRule ?? {}).reduce((som, n) => som + n, 0),
    heavyTransitions: report.metrics.transitions.heavy,
    maxRosterHoursDeviation: report.metrics.hours.rosterStats.max,
    worstLine: report.lines.worst?.score ?? null,
  };
}

// ── De machine ───────────────────────────────────────────────────────────────

export async function runAdaptiveSearch(input: AdaptiveSearchInput): Promise<AdaptiveSearchResult> {
  // Het gedrag van deze run: profiel "rhythm", of de bevroren v1.0.4 (variant.ts).
  const variant = engineVariant();
  const model = variant.qualityModel;
  const modus = ADAPTIVE_CONFIG.modes[input.mode];
  const begin = Date.now();
  const deadline = begin + modus.budgetSeconds * 1000;
  const verstreken = () => (Date.now() - begin) / 1000;
  const resterend = () => (deadline - Date.now()) / 1000;
  const profiel = SCENARIO_PROFILES.find((entry) => entry.key === input.strategy) ?? SCENARIO_PROFILES[0];
  const tilt = ADAPTIVE_CONFIG.rankingTilt[input.strategy] ?? {};
  const modelGewichten = Object.fromEntries(COMPONENT_KEYS.map((key) => [key, componentWeight(model, key)])) as Record<ComponentKey, number>;

  const officieel = evaluateOfficialCore(input.evaluation, model);
  const officieelScores = componenten(officieel);
  const poort = gateFromOfficial(
    { robust: officieel.robust ?? 0, facts: feiten(officieel) },
    ADAPTIVE_CONFIG.gateTolerance,
  );

  const dienstdagen = input.optimizerInput.rosterLines.reduce(
    (som, line) => som + line.days.filter((day) => day.positionType === "DUTY").length,
    0,
  );
  const dubbelAfstand = Math.max(1, Math.ceil(dienstdagen * ADAPTIVE_CONFIG.diversity.duplicateShare));
  const eindAfstand = Math.max(1, Math.ceil(dienstdagen * ADAPTIVE_CONFIG.diversity.finalMinShare));
  const profielPerRooster = new Map(input.optimizerInput.rosterLines.map((line) => [line.baseRosterCode, line.profile]));

  const counters: SearchCounters = {
    attempts: 0,
    starts: 0,
    repairs: 0,
    diversifyStarts: 0,
    validCandidates: 0,
    rejected: 0,
    duplicates: 0,
    lowQuality: 0,
    elite: 0,
    repairsImprovedTarget: 0,
    repairsAccepted: 0,
    repairsRejectedRegression: 0,
    repairsFailed: 0,
    polishRuns: 0,
    polishVariants: 0,
    polishSwaps: 0,
    polishGainTotal: 0,
    polishImproved: 0,
    bestRobust: null,
    bestRanking: null,
    evaluationMsTotal: 0,
    validationMsTotal: 0,
    solverSecondsTotal: 0,
    elapsedSeconds: 0,
    budgetSeconds: modus.budgetSeconds,
  };
  // Wat een kandidaat naast de solvertijd kost: bijschaven, beoordelen,
  // valideren, opslaan. Zonder die reservering begint de machine aan een start
  // waar het budget niet meer voor is, en dan valt de kandidaat halverwege af.
  const kandidaatOverhead = modus.polishSeconds + ADAPTIVE_CONFIG.overheadSecondsPerCandidate;

  // Na het bijschaven hoort de scoreopbouw bij de nieuwe toewijzingen. Opnieuw
  // verzegelen ook: de vingerafdruk van een kandidaat moet over zijn eigen
  // inhoud gaan, anders herkent `isUnmodified` hem later als gewijzigd.
  const dienstenIndex = dutyIndex(input.optimizerInput.duties);
  const referentieRegels = input.optimizerInput.rosterLines.map((line) => measureLine(line, dienstenIndex));
  const hergescoord = (kandidaat: CandidateRoster, assignments: readonly CandidateAssignment[]): CandidateRoster => {
    const scored = scoreRoster(
      linesFromAssignments(assignments, input.optimizerInput.rosterLines),
      dienstenIndex,
      input.optimizerInput.aggregatedFeedback,
      referentieRegels,
    );
    const { hash: _oud, ...rest } = kandidaat;
    return sealCandidate({ ...rest, assignments, scoreBreakdown: scored.breakdown });
  };

  const journal: JournalEntry[] = [];
  let pool: Lid[] = [];
  let druk: Record<string, number> = { hours: 1, flow: 1, rest: 1, nights: 1, fairness: 1 };
  const besteGeschiedenis: number[] = [];
  const gerepareerd = new Map<string, Set<RepairTarget>>();

  const meld = async (phase: SearchPhase, message: string) => {
    counters.elapsedSeconds = Math.round(verstreken());
    counters.elite = pool.length;
    await input.onProgress({ phase, message, counters: { ...counters }, journal });
  };

  const gewichtenVoorStart = (poging: number): ObjectiveWeights => {
    const kans = willekeur(input.baseSeed * 7919 + poging);
    const gewichten: Record<string, number> = { ...input.baseWeights };
    for (const [groep, velden] of Object.entries(PRESSURE_FIELDS)) {
      for (const veld of velden) {
        // De eerste start gebruikt de strategie zoals hij is; latere starts
        // variëren ±20% en volgen de druk uit de pool.
        const variatie = poging === 1 ? 1 : 0.8 + 0.4 * kans();
        gewichten[veld] = Math.round((gewichten[veld] ?? 0) * (druk[groep] ?? 1) * variatie);
      }
    }
    // De ritmevoorkeur uit de menselijke roosters: alleen in de adaptieve
    // zoekmachine, zodat de klassieke ongewijzigd terug te zetten blijft.
    if (variant.humanRhythm && !gewichten.startJitter) {
      gewichten.startJitter = ADAPTIVE_CONFIG.humanRhythm.startJitterWeight;
    }
    return ablatie(gewichten as unknown as ObjectiveWeights, input.ablation);
  };

  // Eén poging: oplossen, beoordelen, valideren, aanbieden aan de pool.
  const probeer = async (opdracht: {
    phase: SearchPhase;
    kind: JournalEntry["kind"];
    seed: number;
    seconds: number;
    weights: ObjectiveWeights;
    parent: Lid | null;
    target: RepairTarget | null;
    freeRosters: readonly string[] | null;
    exclude: readonly Lid[];
    excludeParentRun: boolean;
    minDifferentSlots: number;
    hint: Lid | null;
    hintParentRun: boolean;
  }): Promise<{ lid: Lid | null; entry: JournalEntry }> => {
    counters.attempts += 1;
    const poging = counters.attempts;
    const vast = opdracht.freeRosters && opdracht.parent
      ? opdracht.parent.candidate.assignments.filter(
          (entry) => entry.positionType === "DUTY" && entry.dutyCode && !opdracht.freeRosters!.includes(entry.baseRosterCode),
        )
      : [];
    const optimizer = new CpSatOptimizer(profiel, opdracht.seconds, {
      workers: input.workers,
      seed: opdracht.seed,
      objective: opdracht.weights,
      nightRosterCodes: input.evaluation.quality.nightRosterCodes,
      hint: opdracht.hint?.candidate.assignments ?? (opdracht.hintParentRun ? input.parent?.assignments : undefined),
      exclude: [
        ...opdracht.exclude.map((lid) => lid.candidate.assignments),
        ...(opdracht.excludeParentRun && input.parent ? [input.parent.assignments] : []),
      ],
      minDifferentSlots: opdracht.minDifferentSlots,
      explainShortfall: false,
      fixedAssignments: vast,
      feedbackPenalties: input.feedbackPenalties,
      signal: input.signal,
      humanRhythm: variant.humanRhythm,
      // Een gerichte reparatie van een nachtuitgang maakt de nachtrij extra zwaar.
      nightExitScale: variant.nightExitScale * (opdracht.target === "NIGHT_EXIT" ? ADAPTIVE_CONFIG.repair.targetBoost : 1),
      operational: variant.operational ? OPERATIONAL_REQUIREMENTS_V1 : undefined,
      preference:
        variant.preferenceScale > 0
          ? {
              affinityWeight: variant.preferenceScale * ADAPTIVE_CONFIG.preferenceParity.affinityPerTenth,
              dayDutyWeight: variant.preferenceScale * ADAPTIVE_CONFIG.preferenceParity.dayDutyPerTenth,
            }
          : undefined,
    });
    const label = `${input.strategyLabel} — zoekpoging ${poging}`;
    const uitkomst = await optimizer.generate(input.optimizerInput, label);
    const extras = optimizer.lastExtras;
    counters.solverSecondsTotal += extras?.wallTimeSeconds ?? 0;
    const basis = {
      attempt: poging,
      phase: opdracht.phase,
      kind: opdracht.kind,
      at: new Date().toISOString(),
      seed: opdracht.seed,
      workers: input.workers,
      timeLimitSeconds: opdracht.seconds,
      weights: opdracht.weights,
      pressure: { ...druk },
      parentAttempt: opdracht.parent?.attempt ?? null,
      target: opdracht.target,
      freeRosters: opdracht.freeRosters,
      fixedSlots: vast.length,
      excludedCandidates: opdracht.exclude.length + (opdracht.excludeParentRun && input.parent ? 1 : 0),
      excludedAttempts: opdracht.exclude.map((lid) => lid.attempt),
      hintAttempt: opdracht.hint?.attempt ?? null,
      minDifferentSlots: opdracht.minDifferentSlots,
      solver: extras
        ? {
            status: extras.solverStatus,
            fullCoverageStatus: extras.fullCoverageStatus,
            wallTimeSeconds: extras.wallTimeSeconds,
            optimal: extras.optimal,
          }
        : null,
    };

    if (uitkomst.status !== "CANDIDATE_GENERATED") {
      counters.rejected += 1;
      if (opdracht.kind === "REPAIR") counters.repairsFailed += 1;
      const verdict =
        input.signal.aborted
          ? "CANCELLED"
          : extras?.fullCoverageStatus === "UNKNOWN"
            ? "TIMEOUT"
            : opdracht.kind === "REPAIR"
              ? "REPAIR_FAILED"
              : "COVERAGE_INCOMPLETE";
      const entry: JournalEntry = {
        ...basis,
        verdict,
        reason: uitkomst.reason,
        quality: null,
        deltaToParent: null,
        diagnosis: [],
        validation: null,
        evaluationMs: null,
        polish: null,
        validationMs: null,
        distanceToNearest: null,
        assignments: null,
      };
      journal.push(entry);
      return { lid: null, entry };
    }

    let kandidaat = uitkomst.candidate;
    const t0 = Date.now();
    let rapport = evaluateAssignmentsCore(kandidaat.assignments, input.evaluation, model);
    const evaluatieMs = Date.now() - t0;
    counters.evaluationMsTotal += evaluatieMs;
    const rangschikking = (report: HumanQualityReport) =>
      rankingScore(
        componenten(report),
        report.lines.worst?.score ?? null,
        modelGewichten,
        tilt,
        model.robust,
        report.lines.median,
        variant.worstCase ? (report.worstCase?.penalty.total ?? 0) : 0,
      );

    // Bijschaven met ruildiensten. Alleen zinvol als het rooster al klopt: een
    // ruil repareert geen ontbrekende dekking, en de dure beoordeling van
    // duizenden varianten is weggegooid werk aan een kandidaat die toch afvalt.
    let bijschaven: JournalEntry["polish"] = null;
    if (rapport.hardValidity.hardValid && !input.signal.aborted) {
      const gunnen = Math.min(modus.polishSeconds, Math.max(0, resterend() - ADAPTIVE_CONFIG.overheadSecondsPerCandidate));
      if (gunnen >= 2) {
        const p0 = Date.now();
        // Bewaakt bijschaven: winst op regelmaat en nachten mag niet ten koste
        // gaan van eerlijkheid, uren of rust. Wat een onderdeel meer zakt dan
        // zijn marge ten opzichte van het begin, kost zwaar in de score.
        const beginScores = componenten(rapport);
        const bewaakt = (report: HumanQualityReport) => {
          const nu = componenten(report);
          let straf = 0;
          for (const [sleutel, marge] of Object.entries(variant.guards) as [ComponentKey, number][]) {
            const was = beginScores[sleutel] ?? null;
            const is = nu[sleutel] ?? null;
            if (was !== null && is !== null) straf += Math.max(0, was - is - marge) * ADAPTIVE_CONFIG.guards.penaltyPerPoint;
          }
          return rangschikking(report) - straf;
        };
        const uit = polishAssignmentsCore(kandidaat.assignments, input.evaluation, {
          score: bewaakt,
          deadline: p0 + gunnen * 1000,
          seed: opdracht.seed,
          signal: input.signal,
          model,
          operational: variant.operational ? OPERATIONAL_REQUIREMENTS_V1 : undefined,
        });
        const seconden = (Date.now() - p0) / 1000;
        counters.polishRuns += 1;
        counters.polishVariants += uit.polish.evaluated;
        counters.polishSwaps += uit.polish.moves.length;
        counters.evaluationMsTotal += Date.now() - p0;
        const winst = uit.polish.score - uit.polish.startScore;
        bijschaven = {
          startRanking: Math.round(uit.polish.startScore * 100) / 100,
          ranking: Math.round(uit.polish.score * 100) / 100,
          gain: Math.round(winst * 100) / 100,
          swaps: uit.polish.moves.length,
          variants: uit.polish.evaluated,
          climbs: uit.polish.climbs,
          kicks: uit.polish.kicks,
          seconds: Math.round(seconden * 10) / 10,
          stopReason: uit.polish.stopReason,
          moves: uit.polish.moves.map(({ a, b, dutyA, dutyB, gain }) => ({ a, b, dutyA, dutyB, gain })),
        };
        if (uit.polish.moves.length > 0 && winst > 0) {
          counters.polishImproved += 1;
          counters.polishGainTotal = Math.round((counters.polishGainTotal + winst) * 100) / 100;
          kandidaat = hergescoord(kandidaat, uit.assignments);
          rapport = uit.report;
        }
      }
    }

    const scores = componenten(rapport);
    const ranking = rangschikking(rapport);
    const kwaliteit = {
      overall: rapport.overall,
      robust: rapport.robust,
      ranking: Math.round(ranking * 10) / 10,
      components: scores,
      worstLine: rapport.lines.worst?.score ?? null,
    };
    const delta = opdracht.parent
      ? acceptRepair(opdracht.parent, { ranking, components: scores }, { ...ADAPTIVE_CONFIG.repair, componentTolerances: variant.guards }).deltas
      : null;

    const afwijzing = (verdict: string, reason: string, extra: Partial<JournalEntry> = {}) => {
      counters.rejected += 1;
      const entry: JournalEntry = {
        ...basis,
        verdict,
        reason,
        quality: kwaliteit,
        deltaToParent: delta,
        diagnosis: rapport.diagnosis,
        validation: null,
        evaluationMs: evaluatieMs,
        polish: bijschaven,
        validationMs: null,
        distanceToNearest: null,
        assignments: null,
        ...extra,
      };
      journal.push(entry);
      return { lid: null, entry };
    };

    if (!rapport.hardValidity.hardValid) {
      const verdict = rapport.hardValidity.profileBreaches.length > 0
        ? "PROFILE_INVALID"
        : rapport.hardValidity.coverage.unassigned > 0 || rapport.hardValidity.coverage.emptyDutyDays > 0
          ? "COVERAGE_INCOMPLETE"
          : "HARD_INVALID";
      return afwijzing(verdict, rapport.hardValidity.reasons.join("; "));
    }

    // De operationele eisen van de gebruiker: CP-SAT en het bijschaven houden
    // zich eraan, maar een kandidaat die ze toch breekt, gaat hier alsnog uit.
    if (variant.operational && rapport.operational.violations.length > 0) {
      return afwijzing("HARD_INVALID", rapport.operational.violations.join("; "));
    }

    // Een reparatie moet zichzelf eerst waarmaken, vóór de dure validatie.
    if (opdracht.kind === "REPAIR" && opdracht.parent) {
      const aanvaard = acceptRepair(opdracht.parent, { ranking, components: scores }, { ...ADAPTIVE_CONFIG.repair, componentTolerances: variant.guards });
      const doelVelden = opdracht.target ? doelComponent(opdracht.target) : null;
      const doelBeter = doelVelden
        ? (scores[doelVelden] ?? 0) > (opdracht.parent.components[doelVelden] ?? 0)
        : false;
      if (doelBeter) counters.repairsImprovedTarget += 1;
      if (!aanvaard.accepted) {
        if (aanvaard.reason.startsWith("verslechtert")) counters.repairsRejectedRegression += 1;
        return afwijzing("REPAIR_REJECTED", aanvaard.reason);
      }
    }

    const lid: Lid = {
      key: `poging-${poging}`,
      attempt: poging,
      robust: rapport.robust ?? 0,
      overall: rapport.overall ?? 0,
      ranking,
      components: scores,
      slots: slotKaart(kandidaat.assignments),
      facts: feiten(rapport),
      candidate: kandidaat,
      review: undefined as unknown as ReviewableRoster,
      report: rapport,
      extras,
      entry: undefined as unknown as JournalEntry,
    };
    const proef = offerToPool(pool, lid, { maxSize: modus.eliteSize, duplicateDistance: dubbelAfstand, gate: poort });
    if (proef.verdict !== "VALID_ELITE") {
      if (proef.verdict === "DUPLICATE") counters.duplicates += 1;
      if (proef.verdict === "LOW_QUALITY") counters.lowQuality += 1;
      return afwijzing(proef.verdict, proef.reason, { distanceToNearest: proef.nearest?.distance ?? null });
    }

    const t1 = Date.now();
    const review = await validateCandidate(kandidaat, input.validation, prismaCandidateData);
    const validatieMs = Date.now() - t1;
    counters.validationMsTotal += validatieMs;
    const reden = candidateRejection(review);
    const validatie = { status: review.status, confirmed: review.tally.confirmedHardViolations, rejection: reden };
    if (reden) {
      return afwijzing(reden.includes("roosterprofiel") ? "PROFILE_INVALID" : "HARD_INVALID", reden, {
        validation: validatie,
        validationMs: validatieMs,
      });
    }

    counters.validCandidates += 1;
    if (opdracht.kind === "REPAIR") counters.repairsAccepted += 1;
    const entry: JournalEntry = {
      ...basis,
      verdict: "VALID_ELITE",
      reason: proef.reason,
      quality: kwaliteit,
      deltaToParent: delta,
      diagnosis: rapport.diagnosis,
      validation: validatie,
      evaluationMs: evaluatieMs,
      polish: bijschaven,
      validationMs: validatieMs,
      distanceToNearest: proef.nearest?.distance ?? null,
      assignments: compact(kandidaat.assignments),
    };
    journal.push(entry);
    const volledig: Lid = { ...lid, review, entry };
    const opnieuw = offerToPool(pool, volledig, { maxSize: modus.eliteSize, duplicateDistance: dubbelAfstand, gate: poort });
    pool = opnieuw.pool as Lid[];
    counters.bestRobust = Math.max(counters.bestRobust ?? -Infinity, rapport.robust ?? -Infinity);
    counters.bestRanking = Math.round(Math.max(counters.bestRanking ?? -Infinity, ranking) * 10) / 10;
    return { lid: volledig, entry };
  };

  let gestopt = "";

  // ── Fase 1: starts ──────────────────────────────────────────────────────────
  const startGrens = begin + modus.budgetSeconds * modus.startShare * 1000;
  for (let start = 1; start <= modus.maxStarts; start += 1) {
    if (input.signal.aborted) break;
    const nodig = modus.startSeconds + kandidaatOverhead;
    if (start > modus.minStarts && (Date.now() + nodig * 1000 > startGrens || pool.length >= modus.eliteSize)) break;
    if (resterend() < nodig) break;
    counters.starts += 1;
    const seed = input.baseSeed * 100 + start;
    const gewichten = gewichtenVoorStart(start);
    await meld("SEARCH", `Kandidaat zoeken: start ${start} van ${modus.maxStarts} (zaadwaarde ${seed}).`);
    const beste = pool[0] ?? null;
    // Na de eerste starts afwisselend: vrij zoeken, en zoeken in de buurt van de
    // beste met een verplicht verschil — zo levert elke start iets nieuws op.
    const inDeBuurt = start >= 3 && start % 2 === 1 && beste !== null;
    await probeer({
      phase: "SEARCH",
      kind: "START",
      seed,
      seconds: modus.startSeconds,
      weights: gewichten,
      parent: null,
      target: null,
      freeRosters: null,
      exclude: [...pool],
      excludeParentRun: true,
      minDifferentSlots: pool.length > 0 || input.parent ? dubbelAfstand : 0,
      hint: inDeBuurt ? beste : null,
      hintParentRun: !inDeBuurt,
    });
    await meld("SEARCH", `Roosterkwaliteit beoordelen: ${counters.validCandidates} geldige kandidaten na ${counters.attempts} pogingen.`);
    if (pool[0] && input.ablation !== "no-adaptive-repair") {
      druk = adaptPressure(pool[0].components, officieelScores, druk, ADAPTIVE_CONFIG.pressure);
    }
    besteGeschiedenis.push(pool[0]?.ranking ?? 0);
  }

  // ── Fase 2: gerichte reparatie ──────────────────────────────────────────────
  let reparatiesZonderWinst = 0;
  const repareerGeschiedenis: number[] = [pool[0]?.ranking ?? 0];
  while (input.ablation !== "no-adaptive-repair" && !input.signal.aborted && pool.length > 0) {
    const nodig = modus.repairSeconds + kandidaatOverhead;
    // Reserveer tijd voor diversificatie en eindvalidatie.
    const reserve = (input.requested - Math.min(input.requested, selectFinal(pool, { count: input.requested, minDistance: eindAfstand }).selected.length)) *
      (modus.startSeconds + kandidaatOverhead) + input.requested * 5;
    if (resterend() < nodig + reserve) {
      gestopt = "tijdsbudget voor reparatie op";
      break;
    }
    if (plateauReached(repareerGeschiedenis, modus.plateauWindow, ADAPTIVE_CONFIG.plateauMinGain)) {
      gestopt = `plateau: ${modus.plateauWindow} reparaties zonder ${ADAPTIVE_CONFIG.plateauMinGain} winst`;
      break;
    }
    // De best gerangschikte kandidaat met een reparatiedoel dat nog niet is geprobeerd.
    let gekozen: { lid: Lid; doel: RepairTarget; reden: string } | null = null;
    for (const lid of pool) {
      const gedaan = gerepareerd.get(lid.key) ?? new Set<RepairTarget>();
      const skip = new Set<RepairTarget>(gedaan);
      if (input.ablation === "no-night-clustering") skip.add("NIGHTS");
      if (input.ablation === "no-transitions") skip.add("TRANSITIONS");
      const diagnose = diagnoseRepair(lid.components, officieelScores, feiten(lid.report), skip, {
        nightExitRepair: variant.nightExitRepair,
        nightFirst: variant.nightFirst,
      });
      if (diagnose.length > 0) {
        gekozen = { lid, doel: diagnose[0].target, reden: diagnose[0].reason };
        break;
      }
    }
    if (!gekozen) {
      gestopt = "geen reparatiedoelen meer in de pool";
      break;
    }
    const gedaan = gerepareerd.get(gekozen.lid.key) ?? new Set<RepairTarget>();
    gedaan.add(gekozen.doel);
    gerepareerd.set(gekozen.lid.key, gedaan);
    const vrij = vrijeRoosters(gekozen.doel, gekozen.lid.report, profielPerRooster, input.evaluation.quality.nightRosterCodes);
    counters.repairs += 1;
    await meld("REPAIR", `${doelTekst(gekozen.doel)} in ${vrij.join(", ")} (poging ${gekozen.lid.attempt}: ${gekozen.reden}).`);
    const gewichten = ablatie(versterk(gewichtenVoorStart(1), gekozen.doel), input.ablation);
    const voor = pool[0]?.ranking ?? 0;
    await probeer({
      phase: "REPAIR",
      kind: "REPAIR",
      seed: input.baseSeed * 1000 + counters.attempts,
      seconds: modus.repairSeconds,
      weights: gewichten,
      parent: gekozen.lid,
      target: gekozen.doel,
      freeRosters: vrij,
      exclude: [gekozen.lid],
      excludeParentRun: false,
      minDifferentSlots: 1,
      hint: gekozen.lid,
      hintParentRun: false,
    });
    const na = pool[0]?.ranking ?? 0;
    repareerGeschiedenis.push(na);
    reparatiesZonderWinst = na - voor >= ADAPTIVE_CONFIG.plateauMinGain ? 0 : reparatiesZonderWinst + 1;
  }
  void reparatiesZonderWinst;

  // ── Fase 3: diversificatie ──────────────────────────────────────────────────
  let keuze = selectFinal(pool, { count: input.requested, minDistance: eindAfstand });
  let diversificatie = 0;
  while (!input.signal.aborted && keuze.selected.length < input.requested && pool.length > 0) {
    const nodig = modus.startSeconds + kandidaatOverhead + input.requested * 5;
    if (resterend() < nodig || diversificatie >= 3) break;
    diversificatie += 1;
    counters.diversifyStarts += 1;
    await meld("DIVERSIFY", `Verschillende topkandidaten zoeken: ${keuze.selected.length} van ${input.requested} gevonden.`);
    await probeer({
      phase: "DIVERSIFY",
      kind: "DIVERSIFY",
      seed: input.baseSeed * 100 + 50 + diversificatie,
      seconds: modus.startSeconds,
      weights: gewichtenVoorStart(10 + diversificatie),
      parent: null,
      target: null,
      freeRosters: null,
      exclude: keuze.selected as Lid[],
      excludeParentRun: true,
      minDifferentSlots: Math.ceil(dienstdagen * ADAPTIVE_CONFIG.diversity.diversifyStartShare),
      hint: null,
      hintParentRun: false,
    });
    keuze = selectFinal(pool, { count: input.requested, minDistance: eindAfstand });
  }
  if (!gestopt) {
    gestopt = input.signal.aborted ? "op verzoek gestopt" : "starts en reparaties afgerond binnen het budget";
  }

  // ── Fase 4: eindvalidatie van de gekozen kandidaten ─────────────────────────
  await meld("VALIDATE", `Eindvalidatie van ${keuze.selected.length} topkandidaat/kandidaten.`);
  const front = new Set(paretoFront(pool).map((lid) => lid.key));
  const final: FinalCandidate[] = [];
  for (const [index, gekozen] of (keuze.selected as Lid[]).entries()) {
    const nummer = index + 1;
    const label = input.parent
      ? `${input.strategyLabel} — herbouw`
      : input.requested > 1
        ? `${input.strategyLabel} — kandidaat ${nummer}`
        : input.strategyLabel;
    // Het label hoort bij de vingerafdruk: de kandidaat wordt met zijn definitieve
    // naam opnieuw verzegeld en daarna opnieuw nagerekend.
    const { hash: _oud, ...inhoud } = gekozen.candidate;
    void _oud;
    const verzegeld = sealCandidate({ ...inhoud, scenarioLabel: label });
    const review = await validateCandidate(verzegeld, input.validation, prismaCandidateData);
    const reden = candidateRejection(review);
    if (reden) {
      journal.push({ ...gekozen.entry, at: new Date().toISOString(), verdict: "HARD_INVALID", reason: `eindvalidatie: ${reden}`, assignments: null });
      continue;
    }
    const waarom = [
      `${review.tally.confirmedHardViolations} bevestigde harde overtredingen`,
      `${gekozen.report.hardValidity.coverage.assigned}/${gekozen.report.hardValidity.coverage.required} diensten geplaatst, 0 buiten het roosterprofiel`,
      `${gekozen.report.metrics.nights.singletons} losse nachten, ${gekozen.report.metrics.nights.blocks2} reeksen van twee`,
      `${gekozen.report.metrics.transitions.heavy} zware overgangen`,
      `grootste urenafwijking ${Math.round(gekozen.report.metrics.hours.rosterStats.max)} min`,
      `robuuste kwaliteit ${gekozen.report.robust} (slechtste regel ${gekozen.report.lines.worst?.score?.toFixed(1) ?? "—"})`,
      front.has(gekozen.key) ? "niet gedomineerd in de pool" : "gedomineerd, gekozen om het verschil met de andere kandidaten",
      ...(index > 0
        ? [`verschilt op ${Math.min(...final.map((f) => assignmentDistance(slotKaart(f.candidate.assignments), gekozen.slots)))} dienstdagen van de eerdere kandidaten`]
        : []),
    ];
    final.push({
      candidate: verzegeld,
      review,
      report: gekozen.report,
      ranking: gekozen.ranking,
      extras: gekozen.extras,
      provenance: {
        engine: "adaptive",
        optimizerModelVersion: `${variant.engineVersion}/${gekozen.candidate.optimizerName}@${gekozen.candidate.optimizerVersion}`,
        qualityModelVersion: model.version,
        variant: describeVariant(variant),
        mode: input.mode,
        strategy: input.strategy,
        attempt: gekozen.attempt,
        lineage: afkomst(gekozen.entry, journal),
        seed: gekozen.entry.seed,
        workers: gekozen.entry.workers,
        timeLimitSeconds: gekozen.entry.timeLimitSeconds,
        weights: gekozen.entry.weights,
        freeRosters: gekozen.entry.freeRosters,
        fixedSlots: gekozen.entry.fixedSlots,
        ranking: Math.round(gekozen.ranking * 10) / 10,
        paretoFront: front.has(gekozen.key),
        whySurvived: waarom,
        explanations: verklaringen(gekozen, input),
        versions: {
          sourceScheduleVersion: input.validation.sourceScheduleVersion,
          rulesetVersion: input.validation.rulesetVersion,
          inputDataVersion: input.validation.inputDataVersion,
          configHash: createHash("sha256").update(JSON.stringify({ config: ADAPTIVE_CONFIG, variant: describeVariant(variant) })).digest("hex"),
        },
      },
    });
  }
  counters.elapsedSeconds = Math.round(verstreken());
  counters.elite = pool.length;
  await input.onProgress({ phase: "VALIDATE", message: `Klaar: ${final.length} topkandidaat/kandidaten.`, counters: { ...counters }, journal });

  return { final, journal, counters, stopReason: gestopt, gate: poort, cancelled: input.signal.aborted };
}

function doelComponent(doel: RepairTarget): ComponentKey {
  return { NIGHTS: "nights", NIGHT_EXIT: "nights", TRANSITIONS: "flow", HOURS: "hours", FAIRNESS: "fairness", REST: "rest" }[doel] as ComponentKey;
}

function doelTekst(doel: RepairTarget): string {
  return {
    NIGHTS: "Nachtreeksen verbeteren",
    NIGHT_EXIT: "Herstel na een nachtreeks verbeteren",
    TRANSITIONS: "Overgangen tussen dagdelen verbeteren",
    HOURS: "Uren dichter bij 40:00 brengen",
    FAIRNESS: "Belasting eerlijker verdelen",
    REST: "Rust tussen diensten verbeteren",
  }[doel];
}

function versterk(gewichten: ObjectiveWeights, doel: RepairTarget): ObjectiveWeights {
  const uit: Record<string, number> = { ...gewichten };
  for (const veld of TARGET_FIELDS[doel]) {
    uit[veld] = Math.round((uit[veld] ?? 0) * ADAPTIVE_CONFIG.repair.targetBoost);
  }
  uit.preserveHint = Math.max(uit.preserveHint ?? 0, ADAPTIVE_CONFIG.repair.keepGoodPartsWeight);
  return uit as unknown as ObjectiveWeights;
}

function ablatie(gewichten: ObjectiveWeights, vlag: AblationFlag | null): ObjectiveWeights {
  if (vlag === "no-night-clustering") return { ...gewichten, nightSingleton: 0, nightPair: 0 };
  if (vlag === "no-transitions") return { ...gewichten, transitions: 0 };
  return gewichten;
}

/**
 * Welke roosters een reparatie opnieuw mag indelen; de rest blijft staan.
 *
 * Altijd ten minste twee roosters met overlappende dagdelen, zodat diensten
 * echt kunnen wisselen en niet alleen binnen één rooster schuiven.
 */
export function vrijeRoosters(
  doel: RepairTarget,
  report: HumanQualityReport,
  profielPerRooster: ReadonlyMap<string, string>,
  nightRosterCodes: readonly string[],
): string[] {
  const perRooster = report.metrics.hours.rosters.map((r) => {
    const regels = report.lines.all.filter((line) => line.roster === r.code);
    const paren = regels.reduce((som, line) => som + line.counts.pairs, 0);
    const stabiel = regels.reduce((som, line) => som + line.counts.stable, 0);
    return {
      code: r.code,
      afwijking: r.deviationMinutes,
      zwaar: regels.reduce((som, line) => som + line.counts.heavy, 0),
      stabiel: paren > 0 ? stabiel / paren : 1,
      nachtBlokken: report.metrics.nights.perRoster.find((n) => n.code === r.code)?.blocks ?? [],
      rustRegels: regels.map((line) => line.parts.rest ?? 100),
    };
  });
  const overlap = (a: string, b: string) => {
    const x = allowedKindsForProfile((profielPerRooster.get(a) ?? "MIX") as RosterProfile);
    const y = allowedKindsForProfile((profielPerRooster.get(b) ?? "MIX") as RosterProfile);
    return x.filter((kind) => y.includes(kind)).length;
  };
  const metPartner = (kern: string[]) => {
    const set = new Set(kern);
    for (const code of kern) {
      const partner = perRooster
        .filter((r) => !set.has(r.code))
        .sort((a, b) => overlap(code, b.code) - overlap(code, a.code) || Math.abs(b.afwijking) - Math.abs(a.afwijking))[0];
      if (partner && set.size < kern.length + 1) set.add(partner.code);
    }
    return [...set];
  };

  switch (doel) {
    case "NIGHTS":
      return [...new Set([...nightRosterCodes, ...perRooster.filter((r) => r.nachtBlokken.some((b) => b < 3)).map((r) => r.code)])];
    case "NIGHT_EXIT":
      // De roosters met een te korte uitgang, en de andere nachtroosters: een
      // reeks verplaatsen kan betekenen dat nachtdiensten van rooster wisselen.
      return [...new Set([...nightRosterCodes, ...Object.keys(report.worstCase?.exitsBelowRule ?? {})])];
    case "TRANSITIONS":
      return metPartner([...perRooster].sort((a, b) => b.zwaar - a.zwaar || a.stabiel - b.stabiel).slice(0, 2).map((r) => r.code));
    case "HOURS": {
      const gesorteerd = [...perRooster].sort((a, b) => Math.abs(b.afwijking) - Math.abs(a.afwijking));
      const ergste = gesorteerd[0];
      const tegenpool = gesorteerd
        .filter((r) => r.code !== ergste.code && Math.sign(r.afwijking) !== Math.sign(ergste.afwijking))
        .sort((a, b) => overlap(ergste.code, b.code) - overlap(ergste.code, a.code))[0];
      return metPartner([ergste.code, ...(tegenpool ? [tegenpool.code] : [])]);
    }
    case "FAIRNESS": {
      const nachten = report.metrics.nights.perRoster.filter((r) => nightRosterCodes.includes(r.code)).sort((a, b) => a.perLine - b.perLine);
      const kern = nachten.length >= 2 ? [nachten[0].code, nachten[nachten.length - 1].code] : [];
      return metPartner(kern.length > 0 ? kern : perRooster.slice(0, 2).map((r) => r.code));
    }
    case "REST":
      return metPartner(
        [...perRooster]
          .sort((a, b) => Math.min(...a.rustRegels) - Math.min(...b.rustRegels))
          .slice(0, 2)
          .map((r) => r.code),
      );
  }
}

function afkomst(entry: JournalEntry, journal: readonly JournalEntry[]): readonly { attempt: number; kind: string; target: string | null }[] {
  const keten: { attempt: number; kind: string; target: string | null }[] = [];
  let huidig: JournalEntry | undefined = entry;
  while (huidig) {
    keten.push({ attempt: huidig.attempt, kind: huidig.kind, target: huidig.target });
    const ouder: number | null = huidig.parentAttempt;
    huidig = ouder === null ? undefined : journal.find((e) => e.attempt === ouder && e.verdict === "VALID_ELITE");
  }
  return keten;
}

/**
 * Per opvallende plaatsing: de feiten en welke kostenposten erop werken.
 *
 * Geen verzonnen reden. Wat hier staat, is uit de kandidaat en de gewichten af
 * te lezen: welke overgang zwaar is en hoeveel punten die kost, welke nachtreeks
 * kort is, welke andere diensten op die weekdag in dat profiel hadden gepast en
 * waar die nu staan.
 */
function verklaringen(lid: Lid, input: AdaptiveSearchInput): readonly Record<string, unknown>[] {
  const uit: Record<string, unknown>[] = [];
  const weights = lid.entry.weights;
  const plaatsVan = new Map<string, string>();
  for (const entry of lid.candidate.assignments) {
    if (entry.dutyCode) plaatsVan.set(`${entry.dutyCode}|${entry.weekday}`, `${entry.baseRosterCode} regel ${entry.lineNumber}`);
  }
  const concurrenten = (roster: string, weekday: number, eigen: string | null) => {
    const profiel = input.optimizerInput.rosterLines.find((line) => line.baseRosterCode === roster)?.profile;
    if (!profiel) return [];
    const toegestaan = allowedKindsForProfile(profiel as RosterProfile);
    return input.optimizerInput.duties
      .filter((duty) => duty.weekdays.includes(weekday) && duty.code !== eigen)
      .filter((duty) => duty.kinds.filter((k) => ["VROEG", "LAAT", "NACHT"].includes(k)).every((k) => toegestaan.includes(k as never)))
      .slice(0, 6)
      .map((duty) => ({ duty: duty.code, placedIn: plaatsVan.get(`${duty.code}|${weekday}`) ?? "niet in een vast rooster" }));
  };
  for (const line of lid.report.lines.all.filter((l) => l.counts.heavy > 0).slice(0, 8)) {
    uit.push({
      kind: "HEAVY_TRANSITION",
      roster: line.roster,
      lineNumber: line.lineNumber,
      facts: line.facts,
      activeSoftTerms: [`transitions × ${weights.transitions} per strafpunt`],
    });
  }
  for (const roster of lid.report.metrics.nights.perRoster) {
    for (const lengte of roster.blocks.filter((b) => b < 3)) {
      uit.push({
        kind: lengte === 1 ? "SINGLETON_NIGHT" : "TWO_NIGHT_BLOCK",
        roster: roster.code,
        facts: [`nachtreeks van ${lengte}`],
        activeSoftTerms: [lengte === 1 ? `nightSingleton × ${weights.nightSingleton}` : `nightPair × ${weights.nightPair}`],
      });
    }
  }
  const ergste = [...lid.report.metrics.hours.rosters].sort((a, b) => Math.abs(b.deviationMinutes) - Math.abs(a.deviationMinutes))[0];
  if (ergste && Math.abs(ergste.deviationMinutes) > 10) {
    const regel = input.optimizerInput.rosterLines.find((line) => line.baseRosterCode === ergste.code);
    const dag = regel?.days.find((d) => d.positionType === "DUTY");
    const eigen = lid.candidate.assignments.find(
      (entry) => entry.baseRosterCode === ergste.code && entry.lineNumber === regel?.lineNumber && entry.weekday === dag?.weekday,
    )?.dutyCode ?? null;
    uit.push({
      kind: "HOURS_DEVIATION",
      roster: ergste.code,
      facts: [`gemiddeld ${Math.round(ergste.averageWeeklyMinutes / 60)}u, afwijking ${Math.round(ergste.deviationMinutes)} min`],
      activeSoftTerms: [`hoursBalance × ${weights.hoursBalance}`, `hoursWorst × ${weights.hoursWorst}`],
      competitorsExample: dag ? { weekday: dag.weekday, current: eigen, alternatives: concurrenten(ergste.code, dag.weekday, eigen) } : null,
    });
  }
  return uit;
}
