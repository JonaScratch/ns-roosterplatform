import type { BenchmarkRunResult, ExperimentRecord, PromotionProposal } from "../types";
import type { HumanReportInput } from "./humanReport";

/** Het machineleesbare rapport (§19 van de opdracht) — dezelfde run, als JSON. */

export interface MachineReport {
  readonly runId: string;
  readonly generatedAt: string;
  readonly baseline: { readonly candidateLabel: string; readonly benchmarks: readonly BenchmarkRunResult[] };
  readonly final: { readonly benchmarks: readonly BenchmarkRunResult[] };
  readonly experiments: readonly ExperimentRecord[];
  readonly metrics: { readonly candidatesGenerated: number; readonly hardValidCandidates: number; readonly paretoCandidates: number };
  readonly regressions: readonly string[];
  readonly lessons: readonly string[];
  readonly promotionRecommendation: Pick<PromotionProposal, "recommendation"> & { readonly proposals: readonly PromotionProposal[] };
}

export function buildMachineReport(input: HumanReportInput, proposals: readonly PromotionProposal[]): MachineReport {
  return {
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    baseline: { candidateLabel: input.baselineCandidateLabel, benchmarks: input.benchmarksBefore },
    final: { benchmarks: input.benchmarksAfter },
    experiments: input.experiments,
    metrics: {
      candidatesGenerated: input.candidatesGenerated,
      hardValidCandidates: input.hardValidCandidates,
      paretoCandidates: input.paretoCandidates,
    },
    regressions: input.regressions,
    lessons: input.lessonsLearned,
    promotionRecommendation: { recommendation: input.recommendation, proposals },
  };
}
