import { describe, expect, it } from "vitest";
import { renderHandoff } from "../../demo-room/src/store/handoff";
import type { ExperimentRecord } from "../../demo-room/src/types";

function exp(overrides: Partial<ExperimentRecord>): ExperimentRecord {
  return {
    id: "exp-1",
    runId: "run-1",
    timestamp: "2026-09-25T12:00:00.000Z",
    soort: "PROMPT_VARIANT",
    hypothesis: "hyp",
    reason: "",
    configuration: {},
    candidateProduced: null,
    validatorResult: null,
    qualityMetrics: null,
    baselineMetrics: null,
    comparisonWithBaseline: null,
    outcome: "SUCCESS",
    failureReason: null,
    nextRecommendation: null,
    decision: "PROMOTION_CANDIDATE",
    ...overrides,
  };
}

describe("Demo Room — HANDOFF.md", () => {
  it("een lege staat blijft leesbaar en verzint niets", () => {
    const md = renderHandoff({
      generatedAt: "2026-09-25T12:00:00.000Z",
      bestSandboxVariant: null,
      productionVariant: "lokaal:qwen3",
      unpromotedExperiments: [],
      bestBenchmarkScore: null,
      knownWeaknesses: [],
      recentExperiments: [],
      openHypotheses: [],
      regressions: [],
      recommendedNextSteps: [],
    });
    expect(md).toContain("HANDOFF");
    expect(md).not.toContain("undefined");
    expect(md).not.toContain("NaN");
  });

  it("toont promotion candidates apart van de rest", () => {
    const kandidaat = exp({ id: "exp-cand", decision: "PROMOTION_CANDIDATE", hypothesis: "duidelijkere toolhint" });
    const afgewezen = exp({ id: "exp-rej", decision: "REJECTED", hypothesis: "iets anders" });
    const md = renderHandoff({
      generatedAt: "2026-09-25T12:00:00.000Z",
      bestSandboxVariant: "exp-cand",
      productionVariant: "lokaal:qwen3",
      unpromotedExperiments: [kandidaat],
      bestBenchmarkScore: 84.2,
      knownWeaknesses: [],
      recentExperiments: [kandidaat, afgewezen],
      openHypotheses: [],
      regressions: [],
      recommendedNextSteps: ["test op holdout"],
    });
    expect(md).toContain("exp-cand");
    expect(md).toContain("duidelijkere toolhint");
    expect(md).toContain("84.2");
  });

  it("laat maximaal 10 recente experimenten zien", () => {
    const veel = Array.from({ length: 15 }, (_, i) => exp({ id: `exp-${i}`, decision: "KEEP_TESTING" }));
    const md = renderHandoff({
      generatedAt: "2026-09-25T12:00:00.000Z",
      bestSandboxVariant: null,
      productionVariant: "lokaal:qwen3",
      unpromotedExperiments: [],
      bestBenchmarkScore: null,
      knownWeaknesses: [],
      recentExperiments: veel,
      openHypotheses: [],
      regressions: [],
      recommendedNextSteps: [],
    });
    expect(md).toContain("exp-9");
    expect(md).not.toContain("exp-14");
  });
});
