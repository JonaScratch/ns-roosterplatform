/**
 * Gedeelde datavormen van de Demo Room.
 *
 * Bewust een apart, dependency-vrij bestand: deze types worden zowel door
 * schrijvende modules (die Prisma/askAgent aanroepen) als door pure,
 * dependency-vrije modules (journal, pareto, budget) gebruikt, en die laatste
 * groep moet zonder "server-only" en zonder database te testen zijn.
 */

export type ExperimentSoort = "PROMPT_VARIANT" | "TOOL_HINT_VARIANT" | "CONTEXT_POLICY_VARIANT" | "ENGINE_VARIANT" | "CHALLENGE";

export type ExperimentBesluit = "REJECTED" | "KEEP_TESTING" | "PROMOTION_CANDIDATE";

/** Eén regel in het experimentgeheugen van de Demo Room — zie §13 van de opdracht. */
export interface ExperimentRecord {
  readonly id: string;
  readonly runId: string;
  readonly timestamp: string;
  readonly soort: ExperimentSoort;
  readonly hypothesis: string;
  readonly reason: string;
  readonly configuration: Record<string, unknown>;
  /** Verwijzing naar een echte kandidaat/sessie/experiment-ID in de hoofdapp, indien van toepassing. */
  readonly candidateProduced: string | null;
  readonly validatorResult: "VALID" | "INVALID" | "NIET_VAN_TOEPASSING" | null;
  readonly qualityMetrics: Record<string, number> | null;
  readonly baselineMetrics: Record<string, number> | null;
  readonly comparisonWithBaseline: Record<string, number> | null;
  readonly outcome: "SUCCESS" | "FAILURE" | "INCONCLUSIVE";
  readonly failureReason: string | null;
  readonly nextRecommendation: string | null;
  readonly decision: ExperimentBesluit;
}

export interface MetricSample {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly higherIsBetter: boolean | null;
  readonly unit: string;
}

export interface BenchmarkRunResult {
  readonly runLabel: string;
  readonly measuredAt: string;
  readonly suite: "dev" | "holdout" | "hidden";
  readonly model: string;
  readonly itemCount: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly unratedCount: number;
  readonly passRate: number;
  readonly byCategory: Record<string, { readonly pass: number; readonly total: number }>;
}

/** Herhaalde metingen van dezelfde suite — voor run-variance (§17). */
export interface BenchmarkVariance {
  readonly suite: "dev" | "holdout" | "hidden";
  readonly runs: readonly BenchmarkRunResult[];
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly stddev: number;
  readonly flippedItemIds: readonly string[];
}

export interface CandidatePoint {
  readonly id: string;
  readonly label: string;
  readonly metrics: Record<string, number>;
}

export interface ParetoResult {
  readonly front: readonly string[];
  readonly dominated: readonly string[];
  readonly wins: Readonly<Record<string, readonly string[]>>;
}

/** Eén ontwikkeljournaal-entry — de 10 verplichte secties uit de aanvullende opdracht. */
export interface JournalEntry {
  readonly experimentId: string;
  readonly timestamp: string;
  readonly parentVersion: string | null;
  readonly runId: string;
  /** 1. Wat was het probleem? */
  readonly problem: string;
  /** 2. Wat dacht Lyra dat de oorzaak was? (hypothese, geen feit) */
  readonly hypothesis: string;
  /** 3. Wat is er veranderd? (bestanden/configuraties/prompts/tools/gewichten) */
  readonly whatChanged: string;
  /** 4. Waarom is dat veranderd? */
  readonly whyChanged: string;
  /** git diff of equivalente patchreferentie */
  readonly diffReference: string | null;
  /** 5. Benchmark vóór wijziging */
  readonly benchmarkBefore: Record<string, number>;
  /** 6. Benchmark na wijziging */
  readonly benchmarkAfter: Record<string, number>;
  /** 7. Verbetering of regressie, per categorie */
  readonly changePerCategory: Record<string, "BETER" | "SLECHTER" | "ONVERANDERD">;
  /** 8. Nieuwe fouten */
  readonly newErrors: readonly string[];
  /** 9. Besluit */
  readonly decision: ExperimentBesluit;
  /** Rollbackinformatie: hoe deze wijziging ongedaan te maken is. */
  readonly rollback: string;
  /** 10. Wat moet Jonathan/ChatGPT/Claude weten? */
  readonly humanSummary: string;
}

/**
 * De negen dimensies van "Lyra als chatbot"-kwaliteit (v0.2, §1 van de
 * aanvullende opdracht). Elke waarde is een percentage (0-100) van geslaagde
 * items in die categorie, behalve `latencyMs`.
 */
export interface AgentQualityCategory {
  readonly contextResolution: number | null;
  readonly multiTurnContext: number | null;
  readonly machinistTaal: number | null;
  readonly toolChoice: number | null;
  readonly falsePremiseCorrection: number | null;
  readonly grounding: number | null;
  readonly causalClaims: number | null;
  readonly unnecessaryClarifications: number | null;
  readonly latencyMs: { readonly p50: number; readonly p95: number } | null;
}

/**
 * De tien dimensies van roosteronderzoekskwaliteit (v0.2, §1). `null` bij een
 * dimensie betekent: niet gemeten voor deze variantcategorie (bijvoorbeeld
 * een systeemprompt-variant raakt de optimizer niet) — nooit een verzonnen 0.
 */
export interface RosterQualityCategory {
  readonly validity: number | null;
  readonly packageQuality: number | null;
  readonly profileFit: number | null;
  readonly restRecovery: number | null;
  readonly fairness: number | null;
  readonly weekends: number | null;
  readonly nightBlocks: number | null;
  readonly rangeerDistribution: number | null;
  readonly worstLineQuality: number | null;
  readonly paretoResult: ParetoResult | null;
  /** Waarom roosterkwaliteit hier niet (volledig) gemeten is, indien van toepassing. */
  readonly notApplicableReason: string | null;
}

export interface DualQualityMeasurement {
  readonly agent: AgentQualityCategory;
  readonly roster: RosterQualityCategory;
  readonly measuredAt: string;
}

export type PromotionDecision = "PROMOTION_CANDIDATE" | "REJECTED" | "KEEP_TESTING";

/**
 * Variantie van een agentkwaliteitsdimensie over meerdere onafhankelijke
 * runs op dezelfde bevroren set (§3 van de aanvullende opdracht: "geen
 * promotie op één toevallige modelrun"). `values` bevat élke run, in
 * volgorde — nooit ingekort tot alleen de beste.
 */
export interface CategoryVariance {
  readonly values: readonly number[];
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly stddev: number;
}

/** Dezelfde negen dimensies als `AgentQualityCategory`, maar elk als variantie over N runs. */
export type AgentQualityVariance = { readonly [K in keyof AgentQualityCategory]: CategoryVariance | null };

/**
 * Eén proof-of-value-run: production Lyra → PRE → sandboxvariant → N
 * onafhankelijke POST-runs → holdout → regressiecontrole → besluit (§1-§3
 * van de aanvullende opdracht).
 */
export interface ProofOfValueResult {
  readonly id: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly executed: boolean;
  readonly notExecutedReason: string | null;
  readonly variantId: string;
  readonly variantLabel: string;
  readonly variantCategory: "PROMPT" | "TOOL_ROUTING" | "CONTEXT_POLICY" | "ENGINE";
  readonly frozenSetId: string;
  /** Productie-Lyra (control) op de bevroren dev-set — de meetlat voor POST. */
  readonly pre: DualQualityMeasurement;
  /**
   * Alle onafhankelijke POST-runs, ongewijzigd — nooit ingekort tot de beste
   * run. Minimaal 2 wanneer modelgedrag onderdeel is van de wijziging.
   */
  readonly postRuns: readonly DualQualityMeasurement[];
  /** Gemiddelde over `postRuns`, per dimensie — het cijfer dat in de UI als "POST" getoond wordt. */
  readonly post: DualQualityMeasurement;
  /** Variantie per dimensie over `postRuns` — altijd expliciet gerapporteerd, ook bij grote spreiding. */
  readonly postVariance: AgentQualityVariance;
  /** Productie-Lyra (control) op de holdout-set — de meetlat voor de holdoutvergelijking. */
  readonly preHoldout: DualQualityMeasurement;
  /** Sandboxvariant op de holdout-set. */
  readonly holdout: DualQualityMeasurement;
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
  readonly decision: PromotionDecision;
  readonly reasoning: string;
  /** §"KNOWN WEAKNESSES AFTER RUN": dimensies die ondanks dit besluit zwak blijven — nooit verborgen door een verbetering elders. */
  readonly knownWeaknesses: readonly string[];
}

export type LyraVersionStatus = "ACTIVE" | "SUPERSEDED" | "ROLLED_BACK" | "FAILED";

/**
 * Eén gepubliceerde (of ooit-actieve) Lyra-versie (§ aanvulling "VERPLICHT —
 * UITLEGBARE VERBETERINGEN + SAFE PUBLISH + ROLLBACK"). `promptOverrideText:
 * null` betekent: de kale hardcoded productie-instructie, zonder enige
 * gepubliceerde variant — dat is versie 0, het vertrekpunt.
 */
export interface LyraVersion {
  readonly id: string; // lyra-prod-YYYY-MM-DD-NN
  readonly createdAt: string;
  readonly status: LyraVersionStatus;
  readonly sourceExperimentId: string | null;
  readonly variantId: string | null;
  readonly promptOverrideText: string | null;
  readonly benchmarkReference: {
    readonly pre: Record<string, number>;
    readonly post: Record<string, number>;
    readonly holdout: Record<string, number>;
  } | null;
  readonly changedFiles: readonly string[];
  readonly knownIssues: readonly string[];
  readonly reasonForPromotion: string;
}

/**
 * De volledige gebeurtenistaxonomie van het Demo Room-logboek (§ aanvulling
 * "VERPLICHT VOLLEDIG DEMO ROOM LOGBOEK"). Eén regel per betekenisvolle
 * operationele stap — nooit stil overslaan, ook niet bij afwijzen/overslaan/
 * budget/ongeldige kandidaat/mislukking (zie "GEEN STILLE ACTIES").
 */
export type LogEventKind =
  | "RUN_START_REQUESTED"
  | "PRECHECK"
  | "RUN_START"
  | "RUN_END"
  | "PRODUCTION_VERSION"
  | "SANDBOX_VARIANT"
  | "MODEL_CONFIG"
  | "CHALLENGE_OR_GOAL"
  | "BENCHMARK_START"
  | "BENCHMARK_RESULT"
  // Flight-recorder-granulariteit (§ aanvulling "FULL FLIGHT RECORDER"): één
  // reeks van deze events per afzonderlijk benchmarkitem, zodat een run
  // achteraf reconstrueerbaar is zonder de code te hoeven lezen — zie
  // `benchmark/agentQuality.ts#scoreSuiteItems`.
  | "BENCHMARK_ITEM_START"
  | "CONTEXT_BEFORE"
  | "AGENT_EXECUTION_START"
  | "TOOL_DECISION"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "AGENT_RESPONSE"
  | "BENCHMARK_ITEM_GRADE"
  | "BENCHMARK_ITEM_END"
  /** Per beurt van de contextresolutietest — zie `runContextResolutionCheck`. */
  | "CONTEXT_TURN"
  /** Expliciet, aan het eind van een run: welke zwaktes blijven ondanks deze verbetering (§ "KNOWN WEAKNESSES AFTER RUN"). */
  | "KNOWN_WEAKNESSES"
  | "HYPOTHESIS"
  | "VARIANT_CREATED"
  | "CHANGE_APPLIED"
  | "TOOL_ACTION"
  | "OPTIMIZER_ACTION"
  | "VALIDATOR_ACTION"
  | "TEST_START"
  | "TEST_RESULT"
  | "ERROR"
  | "CANDIDATE_GENERATED"
  | "VALIDATOR_RESULT"
  | "COMPARISON"
  | "REGRESSION_FOUND"
  | "ROLLBACK"
  | "PROMOTION_DECISION"
  | "PUBLISH_ATTEMPT"
  | "BACKUP"
  | "PUBLISH_RESULT"
  | "VARIANT_REJECTED"
  | "EXPERIMENT_SKIPPED"
  | "BUDGET_REACHED"
  | "CANDIDATE_INVALID"
  | "MODEL_RESPONSE_UNUSABLE"
  | "VALIDATOR_ERROR"
  | "AUTO_RETRY"
  | "CRASH_RECOVERY"
  | "INFO";

/** Eén logregel. `message` is altijd een korte, menselijke, operationele omschrijving — nooit ruwe modelredenering. */
export interface LogEvent {
  readonly timestamp: string;
  readonly runId: string;
  readonly experimentId: string | null;
  readonly kind: LogEventKind;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly change?: {
    readonly beforeVersion: string | null;
    readonly afterVersion: string | null;
    readonly affectedFiles: readonly string[];
    readonly causedByExperimentId: string | null;
    readonly rollbackReference: string | null;
    readonly diffReference: string | null;
  };
}

export type RunOutcome = "RUN_COMPLETED" | "RUN_FAILED" | "RUN_INTERRUPTED";

export interface RunEndSummary {
  readonly outcome: RunOutcome;
  readonly totalDurationMs: number;
  /**
   * Totaal aantal echte modelaanroepen (askAgent-beurten), niet het aantal
   * benchmarkblokken — `null` wanneer dit niet betrouwbaar te tellen is
   * (§ "MODEL CALL COUNTER IS NU FOUT": nooit een fout getal tonen, liever
   * expliciet "niet gemeten").
   */
  readonly modelCalls: number | null;
  readonly experiments: number;
  readonly optimizerJobs: number;
  readonly variantsTested: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly bestVariant: string | null;
  readonly productionChanged: boolean;
  readonly openHypotheses: readonly string[];
  readonly lessonsLearned: readonly string[];
  /** Losse, betrouwbaar geteld per bron — zie `deriveRunEndStats` in `cli.ts`. `null` per veld = niet betrouwbaar gemeten. */
  readonly detailedCounters?: {
    readonly benchAnswerCalls: number | null;
    readonly askAgentDirectCalls: number | null;
    readonly modelInferenceTurns: number | null;
    readonly toolCalls: number | null;
    readonly retries: number | null;
    readonly failures: number | null;
  };
  /** §"KNOWN WEAKNESSES AFTER RUN": welke dimensies ondanks deze run zwak blijven — een verbetering mag dit nooit verbergen. */
  readonly knownWeaknessesAfterRun?: readonly string[];
}

export type PublishStepName = "PREFLIGHT" | "BACKUP" | "TYPECHECK" | "APPLY" | "SMOKE_BENCHMARK" | "GROUNDING_CHECK" | "CONFIRM";
export type PublishStepStatus = "OK" | "FAILED" | "SKIPPED";

export interface PublishStepResult {
  readonly step: PublishStepName;
  readonly status: PublishStepStatus;
  readonly detail: string;
  readonly at: string;
}

export interface PublishResult {
  readonly publishId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly steps: readonly PublishStepResult[];
  readonly outcome: "PUBLISHED" | "ROLLED_BACK" | "ROLLBACK_FAILED";
  readonly log: readonly string[];
}

/**
 * De Zelfstandigheidstest / Autonomy Capability Test (finale integratieronde,
 * §7-§13): bewijst — of ontkracht — dat de Demo Room zonder menselijke hints
 * over de oplossing zelf een zwakte bij Lyra kan vinden, een hypothese kan
 * formuleren, een sandboxvariant kan bouwen en testen (via dezelfde
 * proof-of-value-pijplijn, dus dezelfde PRE/POST(≥2)/holdout/regressieregels),
 * en daarvan kan leren. Nooit een gok: elke waarde hieronder komt uit een
 * echte meting of een echt afgeleide teller, nooit een aanname.
 */
export type CapabilityVerdict = "JA" | "NEE" | "NIET_GETEST" | "NIET_GEVONDEN";

export interface CapabilityScorecardEntry {
  readonly key: string;
  readonly label: string;
  readonly verdict: CapabilityVerdict;
  readonly detail: string;
}

/** §12: nooit "heeft toegang tot alles" alleen omdat een import bestaat — expliciet onderscheid. */
export type ComponentUsage = "AVAILABLE" | "ACTUALLY_USED" | "NOT_USED" | "FAILED";

export interface ComponentUsageEntry {
  readonly component: string;
  readonly usage: ComponentUsage;
  readonly detail: string;
}

export type AutonomyGate = "AUTONOMY_GATE_PASSED" | "PARTIAL" | "FAILED";

/** Eén onderzoekscyclus binnen de zelfstandigheidstest: één hypothese, één geteste variant. */
export interface AutonomyCycleResult {
  readonly cycleIndex: number;
  readonly targetedWeakness: string;
  readonly hypothesis: string;
  readonly variantId: string;
  readonly variantLabel: string;
  readonly proof: ProofOfValueResult;
}

export interface AutonomyCapabilityTestResult {
  readonly id: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly maxMinutes: number;
  readonly cycles: readonly AutonomyCycleResult[];
  readonly gate: AutonomyGate;
  readonly gateReasons: readonly string[];
  readonly scorecard: readonly CapabilityScorecardEntry[];
  readonly componentUsage: readonly ComponentUsageEntry[];
  /** §10: expliciet onderscheid tussen agentverbetering (prompt/context/config) en model-weight training/fine-tuning — nooit het laatste claimen. */
  readonly agentImprovementNote: string;
  readonly humanSummary: string;
}

export interface PromotionProposal {
  readonly id: string;
  readonly createdAt: string;
  readonly change: string;
  readonly reason: string;
  readonly pre: Record<string, number>;
  readonly post: Record<string, number>;
  readonly holdout: Record<string, number> | null;
  readonly regressions: readonly string[];
  readonly recommendation: "PROMOTE" | "DO_NOT_PROMOTE" | "MORE_TESTING_REQUIRED";
}
