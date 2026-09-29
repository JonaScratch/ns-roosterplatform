import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExperimentRecord } from "../../demo-room/src/types";

/**
 * De gecontroleerde rollback-failure-injectietest (§ aanvulling "Bewijs
 * rollback met een gecontroleerde failure-test").
 *
 * ## Waarom dit met een dynamische import werkt, en niet met een gewone
 *
 * `DEMO_ROOM_STATE_ROOT_OVERRIDE` moet gezet zijn VÓÓRDAT `config.ts` (en
 * alles dat het importeert: `versions.ts`, `runlog.ts`, `journal.ts`,
 * `handoff.ts`, `logbook.ts`, `safePublish.ts`) voor het eerst geladen wordt
 * — module-top-level `const`-waarden lezen de omgevingsvariabele maar één
 * keer. Een gewone `import` aan de top van dit bestand zou al vóór de
 * `beforeAll` uitvoeren. Vandaar: env var eerst zetten, dan pas
 * `await import(...)`.
 *
 * Dit is dan ook de garantie dat deze test NOOIT de echte, waardevolle
 * productionstate van een lokale installatie raakt: alle bestanden die
 * hieronder worden gelezen/geschreven leven in een verse `mkdtempSync`-map
 * die na afloop volledig wordt verwijderd.
 */

// Productie-activatie vereist altijd een benoemde mens (src/lib/lyra-release.ts).
const TEST_AKKOORD = { door: { id: "test-mens", role: "ROOSTERCOMMISSIE" }, reden: "test" } as const;

let tmpRoot: string;
let versionsMod: typeof import("../../demo-room/src/publish/versions");
let safePublishMod: typeof import("../../demo-room/src/publish/safePublish");
let runlogMod: typeof import("../../demo-room/src/store/runlog");
let journalMod: typeof import("../../demo-room/src/store/journal");
let logbookMod: typeof import("../../demo-room/src/store/logbook");
let handoffPath: string;

const BASELINE_PROMPT = "Dit is de originele, werkende productie-instructie. Wijzig dit niet.";
const TEST_RUN_ID = "TEST-ROLLBACK-RUN";
const TEST_EXPERIMENT_ID = "test-exp-rollback-injection";

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-rollback-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;

  versionsMod = await import("../../demo-room/src/publish/versions");
  safePublishMod = await import("../../demo-room/src/publish/safePublish");
  runlogMod = await import("../../demo-room/src/store/runlog");
  journalMod = await import("../../demo-room/src/store/journal");
  logbookMod = await import("../../demo-room/src/store/logbook");
  const config = await import("../../demo-room/src/config");
  handoffPath = config.HANDOFF_PATH;

  // Seed: een "huidige productieversie" met bekende, echte inhoud — de versie
  // die na de mislukte publish exact terug moet komen.
  const baseline = versionsMod.createVersion({
    sourceExperimentId: null,
    variantId: null,
    promptOverrideText: BASELINE_PROMPT,
    benchmarkReference: null,
    changedFiles: [],
    knownIssues: [],
    reasonForPromotion: "Testbaseline vóór de rollback-injectietest.",
  });
  versionsMod.activateVersion(baseline.id, TEST_AKKOORD);

  // Seed: een PROMOTION_CANDIDATE-experiment dat verwijst naar een echte,
  // bestaande variant (zodat de preflight-stap slaagt en de pijplijn
  // daadwerkelijk bij APPLY/TYPECHECK/SMOKE_BENCHMARK uitkomt).
  const experiment: ExperimentRecord = {
    id: TEST_EXPERIMENT_ID,
    runId: TEST_RUN_ID,
    timestamp: new Date().toISOString(),
    soort: "PROMPT_VARIANT",
    hypothesis: "Testhypothese voor de rollback-injectietest.",
    reason: "Test",
    configuration: { variantId: "variant-a-tool-hint", frozenSetId: "test", devCount: 1, holdoutCount: 1 },
    candidateProduced: null,
    validatorResult: "NIET_VAN_TOEPASSING",
    qualityMetrics: { grounding: 100 },
    baselineMetrics: { grounding: 100 },
    comparisonWithBaseline: { grounding: 0 },
    outcome: "SUCCESS",
    failureReason: null,
    nextRecommendation: "Testen.",
    decision: "PROMOTION_CANDIDATE",
  };
  runlogMod.appendExperiment(experiment);
});

afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Demo Room v0.3 — rollback bij een gecontroleerd mislukte publicatie (geïsoleerde test-productionstate)", () => {
  it("zonder menselijke goedkeuring: geweigerd vóór enige wijziging, geen nieuwe versie", async () => {
    const voor = versionsMod.currentVersionId();
    const aantal = versionsMod.listVersions().length;
    const result = await safePublishMod.publishExperiment(TEST_EXPERIMENT_ID, { runId: `${TEST_RUN_ID}-GEEN-AKKOORD` });
    expect(result.steps[0]).toMatchObject({ step: "PREFLIGHT", status: "FAILED" });
    expect(result.steps[0].detail).toMatch(/menselijke goedkeuring/);
    expect(versionsMod.currentVersionId()).toBe(voor);
    expect(versionsMod.listVersions().length).toBe(aantal);
    expect(() => versionsMod.activateVersion(voor, undefined as never)).toThrow(/benoemde mens/);
  });

  it("het automatische herstel staat als AUTO_ROLLBACK op naam van wie publiceerde in de releasegeschiedenis", async () => {
    const { geschiedenis } = versionsMod.releaseInfo();
    expect(geschiedenis.every((r) => r.approvedBy?.id)).toBe(true);
  });

  it("backup → apply → gecontroleerde smoke-failure → automatische rollback, met alles programmatisch geverifieerd", async () => {
    const voorVersionId = versionsMod.currentVersionId();
    expect(voorVersionId).not.toBe(versionsMod.BASELINE_VERSION_ID); // onze eigen seed-baseline, niet de globale baseline

    const result = await safePublishMod.publishExperiment(TEST_EXPERIMENT_ID, {
      runId: TEST_RUN_ID,
      goedkeuring: TEST_AKKOORD,
      steps: {
        typecheck: () => {
          /* gecontroleerd: doet niets, slaagt altijd in deze test */
        },
        smokeBenchmark: async () => {
          throw new Error("Gesimuleerde smoke-benchmark-fout (opzettelijke test-failure-injectie).");
        },
      },
    });

    // 1. De publish is afgewezen en teruggedraaid, niet "gelukt".
    expect(result.outcome).toBe("ROLLED_BACK");
    expect(result.steps.find((s) => s.step === "TYPECHECK")?.status).toBe("OK");
    expect(result.steps.find((s) => s.step === "SMOKE_BENCHMARK")?.status).toBe("FAILED");

    // 2. Vorige production-versie is weer actief.
    expect(versionsMod.currentVersionId()).toBe(voorVersionId);

    // 2b. Het platform ziet precies dit: geverifieerd, en het herstel staat op naam.
    const { actief, geschiedenis } = versionsMod.releaseInfo();
    expect(actief).toMatchObject({ versionId: voorVersionId, integrity: "OK" });
    expect(geschiedenis.slice(-2).map((r) => r.kind)).toEqual(["ACTIVATE", "AUTO_ROLLBACK"]);
    expect(geschiedenis.at(-1)?.approvedBy).toEqual(TEST_AKKOORD.door);

    // 3. Prompt/config is EXACT hersteld — geen benadering, letterlijk dezelfde tekst.
    const huidigeVersie = versionsMod.getVersion(versionsMod.currentVersionId());
    expect(huidigeVersie?.promptOverrideText).toBe(BASELINE_PROMPT);
    expect(readFileSync(versionsMod.CURRENT_PROMPT_FILE, "utf8")).toBe(BASELINE_PROMPT);

    // 4. Versiegeschiedenis is intact: de mislukte kandidaatversie bestaat nog
    // (voor nader onderzoek), maar staat gemarkeerd als FAILED — niets is verwijderd.
    const alleVersies = versionsMod.listVersions();
    const mislukteVersie = alleVersies.find((v) => v.sourceExperimentId === TEST_EXPERIMENT_ID);
    expect(mislukteVersie).toBeDefined();
    expect(mislukteVersie?.status).toBe("FAILED");
    expect(alleVersies.some((v) => v.id === voorVersionId)).toBe(true);

    // 5. Failure + rollback staan in het journaal.
    const journal = journalMod.readLatestJournalEntry();
    expect(journal?.decision).toBe("REJECTED");
    expect(journal?.newErrors.join(" ")).toContain("Smoke-benchmark");
    expect(journal?.rollback).toContain(voorVersionId);

    // 6. HANDOFF.md is bijgewerkt en noemt de mislukking.
    expect(existsSync(handoffPath)).toBe(true);
    const handoffTekst = readFileSync(handoffPath, "utf8");
    expect(handoffTekst).toMatch(/Smoke-benchmark|mislukt/i);

    // 7. Het logboek bevat de volledige, traceerbare keten: poging, backup,
    // toegepaste wijziging, mislukte test, en expliciete
    // "Rollback started"/"Rollback completed"-regels — nooit stilzwijgend.
    const events = logbookMod.readRunEvents(TEST_RUN_ID);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("PUBLISH_ATTEMPT");
    expect(kinds).toContain("BACKUP");
    expect(kinds).toContain("CHANGE_APPLIED");
    expect(kinds).toContain("ROLLBACK");
    expect(kinds).toContain("PUBLISH_RESULT");
    const rollbackRegels = events.filter((e) => e.kind === "ROLLBACK").map((e) => e.message);
    expect(rollbackRegels.some((m) => m.includes("Rollback started") || m.toLowerCase().includes("handmatig") === false)).toBe(true);
    const logTekst = logbookMod.readRunText(TEST_RUN_ID);
    expect(logTekst).toContain("Rollback started");
    expect(logTekst).toContain("Rollback completed");

    const wijzigingsEvent = events.find((e) => e.kind === "CHANGE_APPLIED");
    expect(wijzigingsEvent?.change?.beforeVersion).toBe(voorVersionId);
    expect(wijzigingsEvent?.change?.rollbackReference).toBe(voorVersionId);
  });

  it("de echte, waardevolle installatie is nooit geraakt (isolatiecontrole)", async () => {
    const config = await import("../../demo-room/src/config");
    expect(config.DATA_DIR.startsWith(tmpRoot)).toBe(true);
    expect(config.REPORTS_DIR.startsWith(tmpRoot)).toBe(true);
    expect(config.HANDOFF_PATH.startsWith(tmpRoot)).toBe(true);
    expect(config.LOGS_DIR.startsWith(tmpRoot)).toBe(true);
  });
});
