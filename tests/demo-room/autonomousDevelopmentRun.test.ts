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
 * budget-edge-case, `maxMinutes: 0`, dat ook `capabilityTest.ts` al zo
 * test): de "geen voortgang op dezelfde zwakte"-grens stopt de lus
 * deterministisch, dus een run met een ruim budget (10 minuten) die na 2-3
 * synthetische cycli al stopt, bewijst dat zonder op de klok te hoeven
 * wachten.
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

  it("GEEN-VOORTGANG-grens: dezelfde gemeten zwakte 2x verworpen zonder promotie → run stopt (deterministisch, niet klok-afhankelijk), ondanks een ruim budget", async () => {
    const runId = `TEST-AUTODEV-NOPROGRESS-${Date.now()}`;
    const startVersionId = versionsMod.currentVersionId();

    const result = await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 10, maxAttemptsPerDimensionWithoutPromotion: 2 },
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

    expect(result.cycles).toHaveLength(2); // stopt precies na de 2e afwijzing van dezelfde dimensie, niet later.
    expect(result.stopReason).toBe("NO_PROGRESS_ON_SAME_WEAKNESS");
    expect(result.acceptedCount).toBe(0);
    expect(result.rejectedCount).toBe(2);
    expect(result.bestCandidateVersionId).toBeNull();
    expect(result.endVersionId).toBe(startVersionId); // budget was ruim (10 min) — de STOP kwam van de voortgangsgrens, niet van de klok.
    // Twee verschillende, echt gegenereerde kandidaten (nooit dezelfde kandidaat twee keer geprobeerd).
    expect(result.cycles[0].candidate?.id).not.toBe(result.cycles[1].candidate?.id);
  });

  it("ACCEPT reset de tellers: promotie op dimensie X, daarna 2x afwijzing op dimensie X stopt de run alsnog (voortgang op X telt niet mee voor de nieuwe pogingen)", async () => {
    const runId = `TEST-AUTODEV-ACCEPT-THEN-STOP-${Date.now()}`;
    const startVersionId = versionsMod.currentVersionId();
    let call = 0;

    const result = await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 10, maxAttemptsPerDimensionWithoutPromotion: 2 },
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

    // 1 accept + 2 rejects op dezelfde dimensie (de teller werd door de accept gereset, dus de 2 latere rejects tellen opnieuw vanaf 0).
    expect(result.cycles).toHaveLength(3);
    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(2);
    expect(result.stopReason).toBe("NO_PROGRESS_ON_SAME_WEAKNESS");
    expect(result.bestCandidateVersionId).not.toBeNull();
    expect(versionsMod.getVersion(result.bestCandidateVersionId!)?.status).not.toBe("ACTIVE");

    // De kern-veiligheidsinvariant: ondanks een echte promotie blijft de ACTIEVE productieversie
    // volstrekt onaangeraakt — activeren is en blijft een aparte, mensgekeurde stap.
    expect(result.startVersionId).toBe(startVersionId);
    expect(result.endVersionId).toBe(startVersionId);
    expect(versionsMod.currentVersionId()).toBe(startVersionId);
  });

  it("slaat live voortgang op na elke cyclus (§ Development Runs-pagina) — niet pas na afloop van de hele run", async () => {
    const developmentRunsStore = await import("../../demo-room/src/store/developmentRuns");
    const runId = `TEST-AUTODEV-LIVEPROGRESS-${Date.now()}`;

    // Ná de baseline-run bestaat er nog geen snapshot voor dit run-ID.
    expect(developmentRunsStore.getDevelopmentRunResult(runId)).toBeNull();

    let call = 0;
    await autoRunMod.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 10, maxAttemptsPerDimensionWithoutPromotion: 2 },
      {
        ...ADVERSARIAL_GELIJK,
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        generateCandidate: generateCandidateMod.generateCandidateFromWeakness,
        runProofOfValue: async (options) => {
          call += 1;
          if (call === 2) {
            // Middenin cyclus 2: cyclus 1 is al voltooid en gepusht, maar de HELE run
            // loopt nog — precies het moment waarop de Development Runs-pagina moet
            // kunnen pollen. De snapshot op schijf moet dit al tonen.
            const tussentijds = developmentRunsStore.getDevelopmentRunResult(runId);
            expect(tussentijds).not.toBeNull();
            expect(tussentijds!.inProgress).toBe(true);
            expect(tussentijds!.cycles).toHaveLength(1);
            expect(tussentijds!.stopReason).toBeNull();
          }
          return fakeProof({ runId, variantId: options.variant!.id, decision: "REJECTED", postAgent: agentCategory({ toolChoice: 60 }), reasoning: "Afgewezen: toolChoice regresseerde." });
        },
        createVersion: versionsMod.createVersion,
      },
    );

    // Na afloop staat de DEFINITIEVE snapshot op schijf, niet meer "in progress".
    const definitief = developmentRunsStore.getDevelopmentRunResult(runId);
    expect(definitief).not.toBeNull();
    expect(definitief!.inProgress).toBe(false);
    expect(definitief!.stopReason).toBe("NO_PROGRESS_ON_SAME_WEAKNESS");
  });
});
