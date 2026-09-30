import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentQualityCategory, DualQualityMeasurement, ProofOfValueResult, RosterQualityCategory } from "../../demo-room/src/types";

/**
 * De tijdgebonden autonome ontwikkelrun (§ SCOPE CORRECTION —
 * "Develop Lyra for: 1 hour / 6 hours / 24 hours / unlimited/manual stop").
 *
 * Deze tests vermijden opzettelijk elke afhankelijkheid van de echte
 * wandklok voor hun PASS/FAIL-uitkomst (behalve het ene expliciete
 * budget-edge-case, `maxMinutes: 0`): sinds de canonieke lange run
 * (incident DR-UI-202609301449) stopt een run met ruim budget pas bij
 * globale uitputting — elke zwakte met elke strategie geprobeerd — en dat
 * gebeurt met synthetische cycli deterministisch en snel.
 *
 * Isolatie: `DEMO_ROOM_STATE_ROOT_OVERRIDE`, zelfde patroon als
 * `developmentCycle.test.ts`/`autonomyCapabilityTest.test.ts`.
 */

let tmpRoot: string;
let autoRunMod: typeof import("../../demo-room/src/develop/autonomousDevelopmentRun");
let generateCandidateMod: typeof import("../../demo-room/src/develop/generateCandidate");
let versionsMod: typeof import("../../demo-room/src/publish/versions");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-autodev-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;
  autoRunMod = await import("../../demo-room/src/develop/autonomousDevelopmentRun");
  generateCandidateMod = await import("../../demo-room/src/develop/generateCandidate");
  versionsMod = await import("../../demo-room/src/publish/versions");
});

/**
 * Het leergeheugen (develop/lessons.ts) blijft over cycli én runs heen
 * bestaan — dat is de bedoeling. Tussen twee onafhankelijke testscenario's
 * hoort het leeg te zijn, anders leert het ene scenario van het andere.
 */
beforeEach(() => {
  rmSync(path.join(tmpRoot, "data", "learning"), { recursive: true, force: true });
});

/** Adversarial meting gelijk voor basis en kandidaat: geen veiligheidsdaling, wel volledig beoordeeld. */
const ADVERSARIAL_GELIJK = { runAdversarial: async () => ({ basis: 80, kandidaat: 80 }) };

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

function fakeProof(input: { runId: string; variantId: string; decision: ProofOfValueResult["decision"]; postAgent: AgentQualityCategory; reasoning: string }): ProofOfValueResult {
  const preAgent = agentCategory();
  return {
    id: `fake-${input.variantId}-${Math.random().toString(36).slice(2, 8)}`,
    runId: input.runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    executed: true,
    notExecutedReason: null,
    variantId: input.variantId,
    variantLabel: input.variantId,
    variantCategory: "TOOL_ROUTING",
    frozenSetId: "test-frozen",
    pre: measurement(preAgent),
    postRuns: [measurement(input.postAgent)],
    post: measurement(input.postAgent),
    postVariance: {} as ProofOfValueResult["postVariance"],
    preHoldout: measurement(preAgent),
    holdout: measurement(input.postAgent),
    regressions: input.decision === "REJECTED" ? ["toolChoice (veiligheid/grounding): 80.0 -> 60.0 (marge 0)"] : [],
    improvements: input.decision === "PROMOTION_CANDIDATE" ? ["toolChoice: 80.0 -> 95.0 (+15.0pp)"] : [],
    decision: input.decision,
    reasoning: input.reasoning,
    knownWeaknesses: [],
  };
}

describe("runAutonomousDevelopmentRun", () => {
  it("weigert een ontbrekend/ongeldig budget — een open-eindige lus mag nooit een verborgen default hebben", async () => {
    await expect(
      autoRunMod.runAutonomousDevelopmentRun(
        { maxMinutes: 0 },
        {
          ...ADVERSARIAL_GELIJK,
          identifyWeakness: async () => {
            throw new Error("mag niet aangeroepen worden");
          },
          generateCandidate: () => {
            throw new Error("mag niet aangeroepen worden");
          },
          runProofOfValue: async () => {
            throw new Error("mag niet aangeroepen worden");
          },
          createVersion: () => {
            throw new Error("mag niet aangeroepen worden");
          },
        },
      ),
    ).resolves.toBeDefined(); // 0 is geldig (zie volgende test) — dit bewijst alleen dat 0 niet gooit.
    await expect(autoRunMod.runAutonomousDevelopmentRun({ maxMinutes: -1 })).rejects.toThrow(/niet-negatief getal/);
    await expect(autoRunMod.runAutonomousDevelopmentRun({ maxMinutes: Number.NaN })).rejects.toThrow(/niet-negatief getal/);
  });

  it("budget al op vóór de eerste cyclus: 0 cycli, MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE, actieve versie ongewijzigd", async () => {
    const runId = `TEST-AUTODEV-BUDGET0-${Date.now()}`;
    const startVersionId = versionsMod.currentVersionId();
    const result = await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 0 },
      {
        ...ADVERSARIAL_GELIJK,
        identifyWeakness: async () => {
          throw new Error("mag niet aangeroepen worden als het budget al op is");
        },
        generateCandidate: () => {
          throw new Error("mag niet aangeroepen worden");
        },
        runProofOfValue: async () => {
          throw new Error("mag niet aangeroepen worden");
        },
        createVersion: () => {
          throw new Error("mag niet aangeroepen worden");
        },
      },
    );
    expect(result.cycles).toHaveLength(0);
    expect(result.stopReason).toBe("MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE");
    expect(result.startVersionId).toBe(startVersionId);
    expect(result.endVersionId).toBe(startVersionId);
  });

  it("stopt eerlijk zonder gok wanneer er geen echte diagnose mogelijk is (LOCAL REQUIRED)", async () => {
    const runId = `TEST-AUTODEV-NOTEXEC-${Date.now()}`;
    const result = await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 10 },
      {
        ...ADVERSARIAL_GELIJK,
        identifyWeakness: async () => ({ executed: false, notExecutedReason: "Niet uitgevoerd: geen lokaal model (LOCAL REQUIRED).", weakestDimension: null, weakestScore: null }),
        generateCandidate: () => {
          throw new Error("mag niet aangeroepen worden zonder een geïdentificeerde zwakte");
        },
        runProofOfValue: async () => {
          throw new Error("mag niet aangeroepen worden");
        },
        createVersion: () => {
          throw new Error("mag niet aangeroepen worden");
        },
      },
    );
    expect(result.cycles).toHaveLength(1);
    expect(result.stopReason).toBe("NOT_EXECUTED");
    expect(result.acceptedCount).toBe(0);
    expect(result.endVersionId).toBe(result.startVersionId);
  });

  it("twee verworpen kandidaten op dezelfde zwakte beëindigen de run NIET (incident DR-UI-202609301449): elke volgende cyclus een andere strategie, stop pas bij globale uitputting", async () => {
    const runId = `TEST-AUTODEV-GEENSTOP-${Date.now()}`;
    const startVersionId = versionsMod.currentVersionId();

    const result = await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 360 },
      {
        ...ADVERSARIAL_GELIJK,
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        generateCandidate: generateCandidateMod.generateCandidateFromWeakness,
        runProofOfValue: async (options) =>
          fakeProof({ runId, variantId: options.variant!.id, decision: "REJECTED", postAgent: agentCategory({ toolChoice: 60 }), reasoning: "Afgewezen: toolChoice regresseerde." }),
        createVersion: () => {
          throw new Error("mag niet aangeroepen worden — geen enkele cyclus promoveert in deze test");
        },
      },
    );

    // Drie strategieën op de enige gemeten zwakte, elk verworpen; de vierde cyclus meldt globale uitputting.
    const gemeten = result.cycles.filter((c) => c.candidate);
    expect(gemeten.length).toBe(generateCandidateMod.STRATEGIEEN.length);
    expect(new Set(gemeten.map((c) => c.candidate?.hypothesis?.strategie)).size).toBe(gemeten.length);
    expect(result.cycles.at(-1)?.decision).toBe("UITGEPUT");
    expect(result.stopReason).toBe("ALL_HYPOTHESES_EXHAUSTED");
    expect(result.longRun?.fase).toBe("GLOBAAL_UITGEPUT");
    expect(result.acceptedCount).toBe(0);
    expect(result.rejectedCount).toBe(gemeten.length);
    expect(result.endVersionId).toBe(startVersionId);
  });

  it("zwakte-wissel: na de laatste strategie op de zwakste dimensie gaat de run door op de volgende zwakte", async () => {
    const runId = `TEST-AUTODEV-WISSEL-${Date.now()}`;
    const result = await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 360 },
      {
        ...ADVERSARIAL_GELIJK,
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55, scores: { toolChoice: 55, grounding: 70 } }),
        generateCandidate: generateCandidateMod.generateCandidateFromWeakness,
        runProofOfValue: async (options) =>
          fakeProof({ runId, variantId: options.variant!.id, decision: "REJECTED", postAgent: agentCategory({ toolChoice: 60 }), reasoning: "Afgewezen." }),
        createVersion: () => {
          throw new Error("mag niet aangeroepen worden");
        },
      },
    );
    const dims = result.cycles.filter((c) => c.candidate).map((c) => c.weakness.weakestDimension);
    const n = generateCandidateMod.STRATEGIEEN.length;
    expect(dims.slice(0, n).every((d) => d === "toolChoice")).toBe(true);
    expect(dims.slice(n, 2 * n).every((d) => d === "grounding")).toBe(true);
    expect(result.stopReason).toBe("ALL_HYPOTHESES_EXHAUSTED");
    const checkpoint = (await import("../../demo-room/src/factory/longRun")).leesCheckpoint(runId)!;
    expect(checkpoint.cycli[n].overgangen).toContain("ZWAKTE_GEWISSELD");
  });

  it("een promotie activeert nooit iets, en de run stopt niet op 'geen voortgang'", async () => {
    const runId = `TEST-AUTODEV-ACCEPT-${Date.now()}`;
    const startVersionId = versionsMod.currentVersionId();
    let call = 0;

    const result = await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 360 },
      {
        ...ADVERSARIAL_GELIJK,
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        generateCandidate: generateCandidateMod.generateCandidateFromWeakness,
        runProofOfValue: async (options) => {
          call += 1;
          const decision = call === 1 ? "PROMOTION_CANDIDATE" : "REJECTED";
          return fakeProof({
            runId,
            variantId: options.variant!.id,
            decision,
            postAgent: agentCategory({ toolChoice: decision === "PROMOTION_CANDIDATE" ? 95 : 60 }),
            reasoning: decision === "PROMOTION_CANDIDATE" ? "Verbetert aantoonbaar." : "Afgewezen: toolChoice regresseerde opnieuw.",
          });
        },
        createVersion: versionsMod.createVersion,
      },
    );

    expect(result.stopReason).not.toBe("NO_PROGRESS_ON_SAME_WEAKNESS");
    expect(["ALL_HYPOTHESES_EXHAUSTED", "MAX_MINUTES_REACHED"]).toContain(result.stopReason);
    if (result.bestCandidateVersionId) expect(versionsMod.getVersion(result.bestCandidateVersionId)?.status).not.toBe("ACTIVE");
    // De kern-veiligheidsinvariant: de ACTIEVE productieversie blijft onaangeraakt.
    expect(result.startVersionId).toBe(startVersionId);
    expect(result.endVersionId).toBe(startVersionId);
    expect(versionsMod.currentVersionId()).toBe(startVersionId);
  });

  it("slaat live voortgang op na elke cyclus (§ Development Runs-pagina) — niet pas na afloop van de hele run", async () => {
    const developmentRunsStore = await import("../../demo-room/src/store/developmentRuns");
    const runId = `TEST-AUTODEV-LIVEPROGRESS-${Date.now()}`;
    expect(developmentRunsStore.getDevelopmentRunResult(runId)).toBeNull();

    let call = 0;
    await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 360 },
      {
        ...ADVERSARIAL_GELIJK,
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        generateCandidate: generateCandidateMod.generateCandidateFromWeakness,
        runProofOfValue: async (options) => {
          call += 1;
          if (call === 2) {
            const tussentijds = developmentRunsStore.getDevelopmentRunResult(runId);
            expect(tussentijds).not.toBeNull();
            expect(tussentijds!.inProgress).toBe(true);
            expect(tussentijds!.cycles).toHaveLength(1);
            expect(tussentijds!.stopReason).toBeNull();
            expect(tussentijds!.longRun?.status).toBe("RUNNING");
          }
          return fakeProof({ runId, variantId: options.variant!.id, decision: "REJECTED", postAgent: agentCategory({ toolChoice: 60 }), reasoning: "Afgewezen: toolChoice regresseerde." });
        },
        createVersion: versionsMod.createVersion,
      },
    );

    const definitief = developmentRunsStore.getDevelopmentRunResult(runId);
    expect(definitief).not.toBeNull();
    expect(definitief!.inProgress).toBe(false);
    expect(definitief!.stopReason).toBe("ALL_HYPOTHESES_EXHAUSTED");
  });
});
