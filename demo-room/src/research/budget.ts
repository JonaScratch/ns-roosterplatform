import type { ComputeBudget } from "../config";

/**
 * De compute-budgetbewaker (§23 van de opdracht).
 *
 * Een zuivere, van tijd losgekoppelde teller: `now` wordt meegegeven in plaats
 * van intern `Date.now()` aan te roepen, zodat dit bestand zonder een klok te
 * hoeven simuleren te testen is.
 */

export interface BudgetUsage {
  readonly modelCalls: number;
  readonly optimizerRuns: number;
  readonly candidates: number;
  readonly failedExperiments: number;
}

export const ZERO_USAGE: BudgetUsage = { modelCalls: 0, optimizerRuns: 0, candidates: 0, failedExperiments: 0 };

export type BudgetExceededReason =
  | "WANDKLOK"
  | "MODEL_CALLS"
  | "OPTIMIZER_RUNS"
  | "CANDIDATES"
  | "FAILED_EXPERIMENTS";

export interface BudgetCheck {
  readonly withinBudget: boolean;
  readonly reason: BudgetExceededReason | null;
  readonly detail: string | null;
}

export function checkBudget(budget: ComputeBudget, usage: BudgetUsage, startedAt: number, now: number): BudgetCheck {
  const elapsedMinutes = (now - startedAt) / 60_000;
  if (elapsedMinutes >= budget.maxWallClockMinutes) {
    return { withinBudget: false, reason: "WANDKLOK", detail: `${elapsedMinutes.toFixed(1)} van ${budget.maxWallClockMinutes} minuten verstreken` };
  }
  if (usage.modelCalls >= budget.maxModelCalls) {
    return { withinBudget: false, reason: "MODEL_CALLS", detail: `${usage.modelCalls}/${budget.maxModelCalls} modelaanroepen bereikt` };
  }
  if (usage.optimizerRuns >= budget.maxOptimizerRuns) {
    return { withinBudget: false, reason: "OPTIMIZER_RUNS", detail: `${usage.optimizerRuns}/${budget.maxOptimizerRuns} optimizerruns bereikt` };
  }
  if (usage.candidates >= budget.maxCandidates) {
    return { withinBudget: false, reason: "CANDIDATES", detail: `${usage.candidates}/${budget.maxCandidates} kandidaten bereikt` };
  }
  if (usage.failedExperiments >= budget.maxFailedExperiments) {
    return { withinBudget: false, reason: "FAILED_EXPERIMENTS", detail: `${usage.failedExperiments}/${budget.maxFailedExperiments} mislukte experimenten bereikt` };
  }
  return { withinBudget: true, reason: null, detail: null };
}

export function addUsage(a: BudgetUsage, b: Partial<BudgetUsage>): BudgetUsage {
  return {
    modelCalls: a.modelCalls + (b.modelCalls ?? 0),
    optimizerRuns: a.optimizerRuns + (b.optimizerRuns ?? 0),
    candidates: a.candidates + (b.candidates ?? 0),
    failedExperiments: a.failedExperiments + (b.failedExperiments ?? 0),
  };
}
