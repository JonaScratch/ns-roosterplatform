import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AgentQualityCategory, AutonomyCycleResult, DualQualityMeasurement, ProofOfValueResult, RosterQualityCategory } from "../../demo-room/src/types";

/**
 * De Zelfstandigheidstest-orkestratie (§7-§13 van de finale integratieronde)
 * getest zonder een echt lokaal model/database nodig te hebben — precies het
 * DI-patroon van `PublishSteps` in `publish/safePublish.ts`: de echte
 * meetfuncties (`identifyWeakness`/`runProofOfValue`) zijn injecteerbaar, dus
 * deze test bewijst de orkestratielogica zelf (zwakte→hypothese→variantkeuze,
 * afwijzing→andere hypothese, gate/scorecard-afleiding) met gecontroleerde,
 * neppe maar structureel geldige `ProofOfValueResult`-objecten.
 *
 * Isolatie: `DEMO_ROOM_STATE_ROOT_OVERRIDE` + dynamische import, zoals
 * `safePublishRollback.test.ts` — deze test schrijft een logboek en een
 * autonomy-resultaatbestand, maar nooit naar de echte installatie.
 */

let tmpRoot: string;
let capabilityMod: typeof import("../../demo-room/src/autonomy/capabilityTest");
let versionsMod: typeof import("../../demo-room/src/publish/versions");
let autonomyResultsMod: typeof import("../../demo-room/src/store/autonomyResults");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-autonomy-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;
  capabilityMod = await import("../../demo-room/src/autonomy/capabilityTest");
  versionsMod = await import("../../demo-room/src/publish/versions");
  autonomyResultsMod = await import("../../demo-room/src/store/autonomyResults");
});

afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

const runIds: string[] = [];
afterEach(() => {
  runIds.length = 0;
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
    validity: null,
    packageQuality: null,
    profileFit: null,
    restRecovery: null,
    fairness: null,
    weekends: null,
    nightBlocks: null,
    rangeerDistribution: null,
    worstLineQuality: null,
    paretoResult: null,
    notApplicableReason: "Test — geen roosterkwaliteit gemeten.",
  };
}

function measurement(agent: AgentQualityCategory): DualQualityMeasurement {
  return { agent, roster: rosterStub(), measuredAt: new Date().toISOString() };
}

function fakeProof(input: {
  readonly runId: string;
  readonly variantId: string;
  readonly variantLabel: string;
  readonly decision: ProofOfValueResult["decision"];
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
  readonly reasoning: string;
  readonly executed?: boolean;
}): ProofOfValueResult {
  const preAgent = agentCategory();
  const postAgent = agentCategory(input.decision === "PROMOTION_CANDIDATE" ? { toolChoice: 92 } : { toolChoice: 60 });
  return {
    id: `fake-${input.variantId}`,
    runId: input.runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    executed: input.executed ?? true,
    notExecutedReason: null,
    variantId: input.variantId,
    variantLabel: input.variantLabel,
    variantCategory: "TOOL_ROUTING",
    frozenSetId: "test-frozen",
    pre: measurement(preAgent),
    postRuns: [measurement(postAgent), measurement(postAgent)],
    post: measurement(postAgent),
    postVariance: {} as ProofOfValueResult["postVariance"],
    preHoldout: measurement(preAgent),
    holdout: measurement(postAgent),
    regressions: input.regressions,
    improvements: input.improvements,
    decision: input.decision,
    reasoning: input.reasoning,
    knownWeaknesses: [],
  };
}

describe("Demo Room v0.4 — Zelfstandigheidstest (Autonomy Capability Test)", () => {
  it("leert van een afwijzing: cyclus 1 REJECTED → cyclus 2 kiest een ANDERE variant en vindt een verbetering (AUTONOMY_GATE_PASSED)", async () => {
    const runId = `TEST-AUTONOMY-${Date.now()}`;
    let call = 0;
    const proof1 = fakeProof({
      runId,
      variantId: "variant-a-tool-hint",
      variantLabel: "Variant A — dringender toolgebruik vóór oordeel",
      decision: "REJECTED",
      regressions: ["toolChoice: 80.0 → 60.0"],
      improvements: [],
      reasoning: "Afgewezen: toolChoice regresseerde.",
    });
    const proof2 = fakeProof({
      runId,
      variantId: "variant-b-uncertainty",
      variantLabel: "Variant B — expliciete onzekerheidsformulering",
      decision: "PROMOTION_CANDIDATE",
      regressions: [],
      improvements: ["falsePremiseCorrection: 80.0 → 92.0 (+12.0pp)"],
      reasoning: "Verbetert aantoonbaar.",
    });

    const result = await capabilityMod.runAutonomyCapabilityTest(
      { runId, maxMinutes: 10 },
      {
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        runProofOfValue: async () => {
          call += 1;
          return call === 1 ? proof1 : proof2;
        },
      },
    );

    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[0].variantId).toBe("variant-a-tool-hint");
    expect(result.cycles[1].variantId).toBe("variant-b-uncertainty"); // andere variant dan cyclus 1 — geen herhaling van dezelfde mislukte poging
    expect(result.gate).toBe("AUTONOMY_GATE_PASSED");

    const learnEntry = result.scorecard.find((s) => s.key === "learnFromPrevious");
    expect(learnEntry?.verdict).toBe("JA");
    const rejectEntry = result.scorecard.find((s) => s.key === "rejectBadVariant");
    expect(rejectEntry?.verdict).toBe("JA");
    const holdoutEntry = result.scorecard.find((s) => s.key === "generalizeToHoldout");
    expect(holdoutEntry?.verdict).toBe("JA");
    const productionEntry = result.scorecard.find((s) => s.key === "protectProduction");
    expect(productionEntry?.verdict).toBe("JA");

    // §10: mag "training"/"fine-tuning" noemen om het uit te sluiten, maar nooit claimen dat het gebeurd is.
    expect(result.agentImprovementNote).toMatch(/geen model-weight training/i);
    expect(result.agentImprovementNote).not.toMatch(/is (getraind|gefinetuned)/i);

    // §6/§16: geen enkele publicatie-/activatiecall — productieversie blijft ongewijzigd.
    expect(versionsMod.currentVersionId()).toBe(versionsMod.BASELINE_VERSION_ID);

    // Persistentie + logboek.
    expect(autonomyResultsMod.getAutonomyResult(result.id)).toEqual(result);
  });

  it("stopt zonder een gok te loggen wanneer er geen lokaal model/database bereikbaar is (PARTIAL, geen valse hypothese)", async () => {
    const runId = `TEST-AUTONOMY-PARTIAL-${Date.now()}`;
    const result = await capabilityMod.runAutonomyCapabilityTest(
      { runId, maxMinutes: 10 },
      {
        identifyWeakness: async () => ({ executed: false, notExecutedReason: "Niet uitgevoerd: geen lokaal model (LOCAL REQUIRED).", weakestDimension: null, weakestScore: null }),
        runProofOfValue: async () => {
          throw new Error("mag niet aangeroepen worden zonder een geïdentificeerde zwakte");
        },
      },
    );

    expect(result.cycles).toHaveLength(0);
    expect(result.gate).toBe("PARTIAL");
    expect(result.gateReasons.join(" ")).toMatch(/LOCAL REQUIRED|lokaal model/i);
    expect(result.scorecard.find((s) => s.key === "identifyWeakness")?.verdict).toBe("NEE");
    expect(result.scorecard.find((s) => s.key === "protectProduction")?.verdict).toBe("JA");
  });

  it("stopt op het budget: geen tweede cyclus ná het wandklokbudget, ook al zou er nog een variant over zijn", async () => {
    const runId = `TEST-AUTONOMY-BUDGET-${Date.now()}`;
    const proof1 = fakeProof({
      runId,
      variantId: "variant-a-tool-hint",
      variantLabel: "Variant A",
      decision: "KEEP_TESTING",
      regressions: [],
      improvements: [],
      reasoning: "Geen aantoonbare winst.",
    });
    const result = await capabilityMod.runAutonomyCapabilityTest(
      { runId, maxMinutes: 0 }, // budget al op vóór de eerste cyclus
      {
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        runProofOfValue: async () => proof1,
      },
    );
    expect(result.cycles).toHaveLength(0);
    expect(result.gate).toBe("PARTIAL");
  });
});
