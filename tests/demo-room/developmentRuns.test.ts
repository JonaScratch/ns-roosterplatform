import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentQualityCategory, DualQualityMeasurement, ProofOfValueResult, RosterQualityCategory } from "../../demo-room/src/types";
import type { AutonomousDevelopmentRunResult } from "../../demo-room/src/develop/autonomousDevelopmentRun";
import type { DevelopmentCycleResult } from "../../demo-room/src/develop/developmentCycle";

/**
 * Regressietests voor de persistentielaag van Development Run-resultaten
 * (§ UI/UX REBUILD — Dashboard/Development Runs/Candidates lezen hier hun
 * data uit). Vóór dit bestand bestond er geen manier om een afgeronde
 * `AutonomousDevelopmentRunResult` na afloop van het CLI-proces terug te
 * vinden — deze test bewijst dat `writeDevelopmentRunResult()`/
 * `listDevelopmentRunResults()`/`getDevelopmentRunResult()`/`listAllCandidates()`
 * dat nu wel kunnen, geïsoleerd via `DEMO_ROOM_STATE_ROOT_OVERRIDE`.
 */

let tmpRoot: string;
let store: typeof import("../../demo-room/src/store/developmentRuns");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-developmentruns-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;
  store = await import("../../demo-room/src/store/developmentRuns");
});

afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function agentCategory(overrides: Partial<AgentQualityCategory> = {}): AgentQualityCategory {
  return {
    contextResolution: 80,
    multiTurnContext: 80,
    machinistTaal: 80,
    toolChoice: 80,
    falsePremiseCorrection: 80,
    grounding: 80,
    causalClaims: 80,
    unnecessaryClarifications: 80,
    latencyMs: { p50: 500, p95: 900 },
    ...overrides,
  };
}
function rosterStub(): RosterQualityCategory {
  return {
    validity: null, packageQuality: null, profileFit: null, restRecovery: null, fairness: null,
    weekends: null, nightBlocks: null, rangeerDistribution: null, worstLineQuality: null, paretoResult: null,
    notApplicableReason: "Test — geen roosterkwaliteit gemeten.",
  };
}
function measurement(agent: AgentQualityCategory): DualQualityMeasurement {
  return { agent, roster: rosterStub(), measuredAt: new Date().toISOString() };
}

function fakeCycle(input: { runId: string; candidateId: string; decision: ProofOfValueResult["decision"]; postToolChoice: number; versionId: string | null }): DevelopmentCycleResult {
  const pre = measurement(agentCategory());
  const post = measurement(agentCategory({ toolChoice: input.postToolChoice }));
  const proof: ProofOfValueResult = {
    id: `fake-${input.candidateId}`,
    runId: input.runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    executed: true,
    notExecutedReason: null,
    variantId: input.candidateId,
    variantLabel: input.candidateId,
    variantCategory: "TOOL_ROUTING",
    frozenSetId: "test-frozen",
    pre,
    postRuns: [post],
    post,
    postVariance: {} as ProofOfValueResult["postVariance"],
    preHoldout: pre,
    holdout: post,
    regressions: input.decision === "REJECTED" ? ["toolChoice regresseerde"] : [],
    improvements: input.decision === "PROMOTION_CANDIDATE" ? ["toolChoice verbeterde"] : [],
    decision: input.decision,
    reasoning: `Testreden voor ${input.decision}.`,
    knownWeaknesses: [],
  };
  return {
    runId: input.runId,
    weakness: { executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 },
    candidate: { id: input.candidateId, label: input.candidateId, description: "test", category: "TOOL_ROUTING", productionText: "test", transform: (b) => b },
    proof,
    decision: input.decision,
    version: input.versionId ? { id: input.versionId, createdAt: new Date().toISOString(), status: "SUPERSEDED", sourceExperimentId: proof.id, variantId: input.candidateId, promptOverrideText: "test", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "test" } : null,
  };
}

function fakeRun(runId: string, cycles: readonly DevelopmentCycleResult[]): AutonomousDevelopmentRunResult {
  return {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    startVersionId: "lyra-prod-baseline",
    endVersionId: "lyra-prod-baseline",
    cycles,
    acceptedCount: cycles.filter((c) => c.decision === "PROMOTION_CANDIDATE").length,
    rejectedCount: cycles.filter((c) => c.decision === "REJECTED" || c.decision === "KEEP_TESTING").length,
    bestCandidateVersionId: cycles.find((c) => c.version)?.version?.id ?? null,
    stopReason: "MAX_MINUTES_REACHED",
    inProgress: false,
    timeline: [],
  };
}

describe("store/developmentRuns", () => {
  it("schrijft en leest een run-resultaat terug, en vindt het terug in de lijst", () => {
    const run = fakeRun("TEST-DEV-001", [fakeCycle({ runId: "TEST-DEV-001", candidateId: "experiment-toolChoice-1", decision: "PROMOTION_CANDIDATE", postToolChoice: 92, versionId: "lyra-prod-2026-09-27-01" })]);
    store.writeDevelopmentRunResult(run);

    // JSON.parse(JSON.stringify(run)) is de eerlijke verwachting hier: `candidate.transform`
    // is een functie en overleeft persistentie naar schijf net zomin als bij elk ander
    // JSON-bestand in deze store — dat is geen bug, alleen iets waar deze vergelijking
    // rekening mee moet houden.
    expect(store.getDevelopmentRunResult("TEST-DEV-001")).toEqual(JSON.parse(JSON.stringify(run)));
    expect(store.getDevelopmentRunResult("ONBEKEND")).toBeNull();
    expect(store.listDevelopmentRunResults().some((r) => r.runId === "TEST-DEV-001")).toBe(true);
  });

  it("listAllCandidates() geeft alle kandidaten uit alle runs, ook verworpen/in-test — niet alleen gepromoveerde", () => {
    const run = fakeRun("TEST-DEV-002", [
      fakeCycle({ runId: "TEST-DEV-002", candidateId: "experiment-grounding-1", decision: "REJECTED", postToolChoice: 60, versionId: null }),
      fakeCycle({ runId: "TEST-DEV-002", candidateId: "experiment-grounding-2", decision: "PROMOTION_CANDIDATE", postToolChoice: 95, versionId: "lyra-prod-2026-09-27-02" }),
    ]);
    store.writeDevelopmentRunResult(run);

    const kandidaten = store.listAllCandidates();
    const rejected = kandidaten.find((c) => c.candidateId === "experiment-grounding-1");
    const promoted = kandidaten.find((c) => c.candidateId === "experiment-grounding-2");

    expect(rejected).toBeDefined();
    expect(rejected!.decision).toBe("REJECTED");
    expect(rejected!.versionId).toBeNull();
    expect(rejected!.validator).toBe("FAIL");

    expect(promoted).toBeDefined();
    expect(promoted!.decision).toBe("PROMOTION_CANDIDATE");
    expect(promoted!.versionId).toBe("lyra-prod-2026-09-27-02");
    expect(promoted!.validator).toBe("PASS");
    expect(promoted!.benchmarkDelta).toBeGreaterThan(0);
  });

  it("negeert cycli zonder kandidaat/meting (NOT_EXECUTED) in listAllCandidates()", () => {
    const cycleZonderKandidaat: DevelopmentCycleResult = {
      runId: "TEST-DEV-003",
      weakness: { executed: false, notExecutedReason: "geen lokaal model", weakestDimension: null, weakestScore: null },
      candidate: null,
      proof: null,
      decision: "NOT_EXECUTED",
      version: null,
    };
    store.writeDevelopmentRunResult(fakeRun("TEST-DEV-003", [cycleZonderKandidaat]));
    expect(store.listAllCandidates().some((c) => c.runId === "TEST-DEV-003")).toBe(false);
  });
});
