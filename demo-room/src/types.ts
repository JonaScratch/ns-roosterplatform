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
