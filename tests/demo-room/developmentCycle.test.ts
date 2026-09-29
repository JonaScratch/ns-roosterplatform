import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentQualityCategory, DualQualityMeasurement, ProofOfValueResult, RosterQualityCategory } from "../../demo-room/src/types";

/**
 * Regressie-/bewijstest voor de "SCOPE CORRECTION AANVULLING": vóór
 * `MASTER_PROGRAM_COMPLETE` moet minimaal één volledige end-to-end
 * development cycle aantoonbaar werken op een geïsoleerde, niet-productie
 * candidate:
 *
 *   baseline candidate → diagnose → agent maakt experimentele wijziging →
 *   nieuwe candidate → benchmark/validator → objectieve vergelijking →
 *   keep/reject → versie/history correct opgeslagen
 *
 * Zoals toegestaan ("Je mag voor technische validatie disposable/synthetic
 * kandidaten gebruiken") is de PRE/POST-meting hier gecontroleerd/synthetisch
 * (geen Ollama/database nodig, zelfde DI-patroon als
 * `autonomyCapabilityTest.test.ts`) — maar de kandidaat-GENERATIE
 * (`generateCandidateFromWeakness`), de besluitvorming-koppeling en
 * `createVersion()`/journaal/logboek zijn hier ECHT, niet gemockt. Dit bewijst
 * de machinerie zelf, niet dat Lyra inhoudelijk beter is geworden.
 *
 * Isolatie: `DEMO_ROOM_STATE_ROOT_OVERRIDE`, exact zoals
 * `safePublishRollback.test.ts`/`autonomyCapabilityTest.test.ts`.
 */

let tmpRoot: string;
let developmentCycleMod: typeof import("../../demo-room/src/develop/developmentCycle");
let versionsMod: typeof import("../../demo-room/src/publish/versions");
let promptVariantsMod: typeof import("../../demo-room/src/variants/promptVariants");
let logbookMod: typeof import("../../demo-room/src/store/logbook");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-development-cycle-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;
  developmentCycleMod = await import("../../demo-room/src/develop/developmentCycle");
  versionsMod = await import("../../demo-room/src/publish/versions");
  promptVariantsMod = await import("../../demo-room/src/variants/promptVariants");
  logbookMod = await import("../../demo-room/src/store/logbook");
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
  readonly postAgent: AgentQualityCategory;
}): ProofOfValueResult {
  const preAgent = agentCategory();
  return {
    id: `fake-${input.variantId}`,
    runId: input.runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    executed: true,
    notExecutedReason: null,
    variantId: input.variantId,
    variantLabel: input.variantLabel,
    variantCategory: "TOOL_ROUTING",
    frozenSetId: "test-frozen",
    pre: measurement(preAgent),
    postRuns: [measurement(input.postAgent), measurement(input.postAgent)],
    post: measurement(input.postAgent),
    postVariance: {} as ProofOfValueResult["postVariance"],
    preHoldout: measurement(preAgent),
    holdout: measurement(input.postAgent),
    regressions: input.regressions,
    improvements: input.improvements,
    decision: input.decision,
    reasoning: input.reasoning,
    knownWeaknesses: [],
  };
}

describe("Development Sandbox — volledige end-to-end ontwikkelcyclus (SCOPE CORRECTION AANVULLING)", () => {
  it("ACCEPT: diagnose → echt gegenereerde kandidaat → synthetische meting → PROMOTION_CANDIDATE → echte, niet-actieve versie opgeslagen", async () => {
    const runId = `TEST-DEVCYCLE-ACCEPT-${Date.now()}`;
    const baselineActiveId = versionsMod.currentVersionId();
    const idsVoor = new Set(versionsMod.listVersions().map((v) => v.id));

    const proof = fakeProof({
      runId,
      variantId: "experiment-toolChoice-placeholder", // wordt overschreven door de ECHTE generator hieronder, zie assert op result.candidate.id
      variantLabel: "Gegenereerde kandidaat — toolChoice",
      decision: "PROMOTION_CANDIDATE",
      regressions: [],
      improvements: ["toolChoice: 55.0 → 92.0 (+37.0pp)"],
      reasoning: "Verbetert aantoonbaar op toolChoice, geen regressie op veiligheid/grounding.",
      postAgent: agentCategory({ toolChoice: 92 }),
    });

    let ontvangenVariantId: string | null = null;
    const result = await developmentCycleMod.runDevelopmentCycle(
      { runId },
      {
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        // ECHTE generator — dit is de kern van de test: geen mens/test kiest deze kandidaat, de sandbox construeert hem zelf.
        generateCandidate: (await import("../../demo-room/src/develop/generateCandidate")).generateCandidateFromWeakness,
        runProofOfValue: async (options) => {
          ontvangenVariantId = options.variant?.id ?? null;
          return { ...proof, variantId: options.variant?.id ?? proof.variantId };
        },
        createVersion: versionsMod.createVersion,
      },
    );

    // 1. Diagnose gebeurde echt (geïnjecteerd, maar wel doorlopen).
    expect(result.weakness.executed).toBe(true);
    expect(result.weakness.weakestDimension).toBe("toolChoice");

    // 2. "Agent maakt experimentele wijziging": een ECHT gegenereerde, NIEUWE kandidaat —
    // niet een van de twee vaste, hand-geschreven varianten uit promptVariants.ts.
    expect(result.candidate).not.toBeNull();
    const candidate = result.candidate!;
    expect(promptVariantsMod.findPromptVariant(candidate.id)).toBeNull();
    expect(candidate.productionText).toMatch(/tool/i);
    expect(ontvangenVariantId).toBe(candidate.id); // runProofOfValue kreeg exact deze gegenereerde kandidaat, geen ID uit de vaste lijst.

    // 3+4. Benchmark/validator + objectieve vergelijking + besluit.
    expect(result.proof).not.toBeNull();
    expect(result.decision).toBe("PROMOTION_CANDIDATE");

    // 5. Versie/history correct opgeslagen: een NIEUWE, NIET-actieve versie.
    expect(result.version).not.toBeNull();
    const version = result.version!;
    expect(version.variantId).toBe(candidate.id);
    expect(version.status).not.toBe("ACTIVE");
    expect(version.reasonForPromotion).toBe(proof.reasoning);
    expect(version.benchmarkReference?.post.toolChoice).toBe(92);

    // De onveranderlijke versiegeschiedenis is echt gegroeid (niet gesimuleerd) —
    // een nieuw, nog nooit eerder bestaand versie-ID is er nu echt bij gekomen.
    const idsNa = new Set(versionsMod.listVersions().map((v) => v.id));
    expect(idsVoor.has(version.id)).toBe(false);
    expect(idsNa.has(version.id)).toBe(true);
    // … maar de ACTIEVE productieversie is volstrekt onaangeraakt gebleven.
    expect(versionsMod.currentVersionId()).toBe(baselineActiveId);
    expect(versionsMod.getVersion(version.id)?.status).not.toBe("ACTIVE");

    // Logboek bevat de volledige keten, reconstrueerbaar zonder de code te lezen.
    const eventKinds = logbookMod.eventKindsIn(runId);
    expect(eventKinds.has("HYPOTHESIS")).toBe(true);
    expect(eventKinds.has("CANDIDATE_GENERATED")).toBe(true);
    expect(eventKinds.has("INFO")).toBe(true);

    // Phase K/L: herkomst vastgelegd vóór de meting, en de onafhankelijke rechter is het eens.
    expect(result.manifest?.candidateId).toBe(candidate.id);
    expect(result.manifest?.inputs.weaknessDimension).toBe("toolChoice");
    expect(result.judge?.verdict).toBe("KEEP");
  });

  it("de rechter kan een positieve proof tegenhouden (nooit andersom): winst naast het doel is geen bewezen verbetering van het doel", async () => {
    const runId = `TEST-DEVCYCLE-VETO-${Date.now()}`;
    const idsVoor = versionsMod.listVersions().length;
    const proof = fakeProof({
      runId,
      variantId: "placeholder",
      variantLabel: "Gegenereerde kandidaat — toolChoice",
      decision: "PROMOTION_CANDIDATE",
      regressions: [],
      improvements: ["contextResolution +15"],
      reasoning: "Positief op contextResolution.",
      postAgent: agentCategory({ contextResolution: 95 }),
    });
    const result = await developmentCycleMod.runDevelopmentCycle(
      { runId },
      {
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 }),
        generateCandidate: (await import("../../demo-room/src/develop/generateCandidate")).generateCandidateFromWeakness,
        runProofOfValue: async (options) => ({ ...proof, variantId: options.variant?.id ?? proof.variantId }),
        createVersion: versionsMod.createVersion,
      },
    );
    expect(result.judge?.verdict).toBe("REJECT");
    expect(result.decision).toBe("REJECTED");
    expect(result.version).toBeNull();
    expect(versionsMod.listVersions().length).toBe(idsVoor);
    expect(logbookMod.readRunText(runId) ?? "").toMatch(/rechter verwierp/);
  });

  it("focusDimension overschrijft de zwakte die de kandidaatgenerator target, en de echte diagnose blijft alsnog gelogd", async () => {
    const runId = `TEST-DEVCYCLE-FOCUS-${Date.now()}`;
    let ontvangenCandidateIdVoorProof: string | null = null;
    const proof = fakeProof({
      runId,
      variantId: "placeholder",
      variantLabel: "Gegenereerde kandidaat — grounding",
      decision: "KEEP_TESTING",
      regressions: [],
      improvements: [],
      reasoning: "Geen aantoonbare winst.",
      postAgent: agentCategory(),
    });

    const result = await developmentCycleMod.runDevelopmentCycle(
      { runId, focusDimension: "grounding" },
      {
        // Automatische diagnose vindt "toolChoice" als zwakste dimensie — de gebruiker koos handmatig "grounding".
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 40 }),
        generateCandidate: (await import("../../demo-room/src/develop/generateCandidate")).generateCandidateFromWeakness,
        runProofOfValue: async (options) => {
          ontvangenCandidateIdVoorProof = options.variant?.id ?? null;
          return { ...proof, variantId: options.variant?.id ?? proof.variantId };
        },
        createVersion: versionsMod.createVersion,
      },
    );

    // De kandidaat is echt gegenereerd voor "grounding", niet voor de automatisch gediagnosticeerde "toolChoice".
    expect(result.weakness.weakestDimension).toBe("grounding");
    expect(result.candidate?.description).toMatch(/grounding/i);
    expect(ontvangenCandidateIdVoorProof).toBe(result.candidate?.id);

    // De echte, automatische diagnose is niet verborgen — de overschrijving staat expliciet in het logboek.
    const tekst = logbookMod.readRunText(runId) ?? "";
    expect(tekst).toMatch(/toolChoice/);
    expect(tekst).toMatch(/overschreven/i);
  });

  it("REJECT: een synthetische kandidaat met een veiligheidsregressie wordt afgewezen — geen versie aangemaakt, actieve versie ongewijzigd", async () => {
    const runId = `TEST-DEVCYCLE-REJECT-${Date.now()}`;
    const baselineActiveId = versionsMod.currentVersionId();
    const idsVoor = new Set(versionsMod.listVersions().map((v) => v.id));

    const proof = fakeProof({
      runId,
      variantId: "placeholder",
      variantLabel: "Gegenereerde kandidaat — grounding",
      decision: "REJECTED",
      regressions: ["grounding (veiligheid/grounding): 80.0 → 55.0 (marge 0)"],
      improvements: [],
      reasoning: "Afgewezen: grounding regresseerde op een bewaakte dimensie.",
      postAgent: agentCategory({ grounding: 55 }),
    });

    let createVersionAangeroepen = false;
    const result = await developmentCycleMod.runDevelopmentCycle(
      { runId },
      {
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "grounding", weakestScore: 60 }),
        generateCandidate: (await import("../../demo-room/src/develop/generateCandidate")).generateCandidateFromWeakness,
        runProofOfValue: async (options) => ({ ...proof, variantId: options.variant?.id ?? proof.variantId }),
        createVersion: (input) => {
          createVersionAangeroepen = true;
          return versionsMod.createVersion(input);
        },
      },
    );

    expect(result.decision).toBe("REJECTED");
    expect(result.version).toBeNull();
    expect(createVersionAangeroepen).toBe(false); // een afgewezen kandidaat mag NOOIT als versie belanden.
    const idsNa = new Set(versionsMod.listVersions().map((v) => v.id));
    expect(idsNa).toEqual(idsVoor); // geen enkele nieuwe versie erbij.
    expect(versionsMod.currentVersionId()).toBe(baselineActiveId);

    const eventKinds = logbookMod.eventKindsIn(runId);
    expect(eventKinds.has("VARIANT_REJECTED")).toBe(true);
  });

  it("NOT_EXECUTED: zonder een echte diagnose wordt er nooit een kandidaat gegenereerd of gemeten (geen gok, eerlijk LOCAL REQUIRED-resultaat)", async () => {
    const runId = `TEST-DEVCYCLE-NOTEXEC-${Date.now()}`;
    const baselineActiveId = versionsMod.currentVersionId();

    const result = await developmentCycleMod.runDevelopmentCycle(
      { runId },
      {
        identifyWeakness: async () => ({ executed: false, notExecutedReason: "Niet uitgevoerd: geen lokaal model (LOCAL REQUIRED).", weakestDimension: null, weakestScore: null }),
        generateCandidate: () => {
          throw new Error("mag niet aangeroepen worden zonder een geïdentificeerde zwakte");
        },
        runProofOfValue: async () => {
          throw new Error("mag niet aangeroepen worden zonder een gegenereerde kandidaat");
        },
        createVersion: () => {
          throw new Error("mag niet aangeroepen worden zonder een PROMOTION_CANDIDATE-besluit");
        },
      },
    );

    expect(result.decision).toBe("NOT_EXECUTED");
    expect(result.candidate).toBeNull();
    expect(result.proof).toBeNull();
    expect(result.version).toBeNull();
    expect(versionsMod.currentVersionId()).toBe(baselineActiveId);
  });
});
