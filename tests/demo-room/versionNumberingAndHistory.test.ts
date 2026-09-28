import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LyraVersion } from "../../demo-room/src/types";

/**
 * § "Extra regressiechecks" (round G), drie samenhangende checks die alle
 * de versiestore raken en dus dezelfde geïsoleerde `DEMO_ROOM_STATE_ROOT_OVERRIDE`-
 * aanpak van `safePublishRollback.test.ts` gebruiken — nooit de echte lokale
 * installatie:
 *
 * - "v1.0.9 publicatie: volgende versie is v1.0.10, nooit v1.1.0 en nooit
 *   floating-point-afleiding."
 * - "publish/activate/rollback: gebruiken allemaal dezelfde canonical
 *   version-service."
 * - "historical run: toont de versie die daadwerkelijk bij die run hoorde,
 *   niet automatisch de huidige actieve versie."
 */

let tmpRoot: string;
let versionsDir: string;
let versionsMod: typeof import("../../demo-room/src/publish/versions");
let safePublishMod: typeof import("../../demo-room/src/publish/safePublish");
let logbookMod: typeof import("../../demo-room/src/store/logbook");
let aggMod: typeof import("../../demo-room/src/report/dashboardAggregates");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-versionnum-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;

  versionsMod = await import("../../demo-room/src/publish/versions");
  safePublishMod = await import("../../demo-room/src/publish/safePublish");
  logbookMod = await import("../../demo-room/src/store/logbook");
  aggMod = await import("../../demo-room/src/report/dashboardAggregates");
  const config = await import("../../demo-room/src/config");
  versionsDir = path.join(config.DATA_DIR, "lyra-versions");
});

afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Overschrijft alleen `createdAt` op schijf — zodat de chronologische volgorde in de test deterministisch is, ongeacht hoe snel `createVersion()` na elkaar draait binnen dezelfde milliseconde. */
function forceCreatedAt(versionId: string, createdAt: string): void {
  const bestand = path.join(versionsDir, `${versionId}.json`);
  const versie = JSON.parse(readFileSync(bestand, "utf8")) as LyraVersion;
  writeFileSync(bestand, `${JSON.stringify({ ...versie, createdAt }, null, 2)}\n`, "utf8");
}

describe("Demo Room v0.9 — versienummering (v1.0.x) rolt nooit over naar v1.1.0", () => {
  it("index 9 → v1.0.9, index 10 → v1.0.10 — pure stringtemplating, geen floating-point", () => {
    const ids: string[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const v = versionsMod.createVersion({
        sourceExperimentId: null,
        variantId: null,
        promptOverrideText: `versie-${i}`,
        benchmarkReference: null,
        changedFiles: [],
        knownIssues: [],
        reasonForPromotion: "",
      });
      forceCreatedAt(v.id, new Date(2026, 0, 1, 0, 0, i).toISOString()); // strikt oplopend, i seconden uit elkaar
      ids.push(v.id);
    }

    const serie = aggMod.versionPerformanceSeries();
    expect(serie).toHaveLength(11);
    expect(serie.map((p) => p.displayName)).toEqual(["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3", "v1.0.4", "v1.0.5", "v1.0.6", "v1.0.7", "v1.0.8", "v1.0.9", "v1.0.10"]);
    // Expliciet: nooit een floating-point-achtige naam zoals "v1.1" of "v1.1.0".
    expect(serie.some((p) => p.displayName === "v1.1.0" || p.displayName === "v1.1")).toBe(false);

    for (const id of ids) rmSync(path.join(versionsDir, `${id}.json`), { force: true });
  });
});

describe("Demo Room v0.9 — publish/activate/rollback delen dezelfde canonical version-service", () => {
  it("safePublish.rollbackTo() respecteert exact dezelfde invarianten als een directe activateVersion() — nooit een tweede actieve versie, nooit een bypass", async () => {
    const v1 = versionsMod.createVersion({ sourceExperimentId: null, variantId: null, promptOverrideText: "v1-tekst", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    const v2 = versionsMod.createVersion({ sourceExperimentId: null, variantId: null, promptOverrideText: "v2-tekst", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    versionsMod.activateVersion(v1.id);
    versionsMod.activateVersion(v2.id);
    expect(versionsMod.currentVersionId()).toBe(v2.id);

    // "Activeren" van een eerdere versie loopt via safePublish.rollbackTo(), niet
    // via een los, tweede activatiepad.
    const { fromVersionId, toVersionId } = await safePublishMod.rollbackTo(v1.id, "TEST-CANONICAL-ROLLBACK");
    expect(fromVersionId).toBe(v2.id);
    expect(toVersionId).toBe(v1.id);

    // Exact dezelfde invariant die activateVersion() zelf garandeert: precies
    // één ACTIVE versie, de vorige actieve versie is nu SUPERSEDED.
    expect(versionsMod.currentVersionId()).toBe(v1.id);
    expect(versionsMod.getVersion(v1.id)?.status).toBe("ACTIVE");
    expect(versionsMod.getVersion(v2.id)?.status).toBe("SUPERSEDED");
    const actieveVersies = versionsMod.listVersions().filter((v) => v.status === "ACTIVE");
    expect(actieveVersies).toHaveLength(1);
    expect(actieveVersies[0]?.id).toBe(v1.id);

    rmSync(path.join(versionsDir, `${v1.id}.json`), { force: true });
    rmSync(path.join(versionsDir, `${v2.id}.json`), { force: true });
  });
});

describe("Demo Room v0.9 — historische run toont de versie die tóén actief was", () => {
  it("een latere activatie verandert de al-vastgelegde productieversie van een eerdere run niet met terugwerkende kracht", async () => {
    const oud = versionsMod.createVersion({ sourceExperimentId: null, variantId: null, promptOverrideText: "oude-versie", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    versionsMod.activateVersion(oud.id);

    const runId = "TEST-HISTORISCHE-VERSIE-RUN";
    logbookMod.startRun(runId, {
      kind: "proof-of-value",
      productionVersion: safePublishMod.currentProductionVersionLabel(),
      sandboxParent: null,
      modelConfig: null,
      challengeOrGoal: null,
    });
    logbookMod.endRun(runId, {
      outcome: "RUN_COMPLETED",
      totalDurationMs: 1000,
      modelCalls: null,
      experiments: 0,
      optimizerJobs: 0,
      variantsTested: 0,
      accepted: 0,
      rejected: 0,
      bestVariant: null,
      productionChanged: false,
      openHypotheses: [],
      lessonsLearned: [],
    });

    // Nu wordt een NIEUWE versie geactiveerd — ná het einde van de run hierboven.
    const nieuw = versionsMod.createVersion({ sourceExperimentId: null, variantId: null, promptOverrideText: "nieuwe-versie", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    versionsMod.activateVersion(nieuw.id);
    expect(versionsMod.currentVersionId()).toBe(nieuw.id); // vandaag actief

    const geschiedenis = aggMod.runHistory();
    const entry = geschiedenis.find((r) => r.runId === runId);
    expect(entry).toBeDefined();
    // De run toont de versie die er destijds bij hoorde ...
    expect(entry?.productionVersionId).toBe(oud.id);
    // ... en expliciet NIET de versie die vandaag toevallig actief is.
    expect(entry?.productionVersionId).not.toBe(nieuw.id);
    expect(entry?.productionVersionId).not.toBe(versionsMod.currentVersionId());
    expect(entry?.productionVersionDisplayName).toBe(aggMod.displayNameForVersionId(oud.id));

    rmSync(path.join(versionsDir, `${oud.id}.json`), { force: true });
    rmSync(path.join(versionsDir, `${nieuw.id}.json`), { force: true });
  });
});

describe("Demo Room — runHistory() leest de echte RUN_END-uitkomst", () => {
  it("toont RUN_FAILED/RUN_INTERRUPTED zoals endRun() ze vastlegde, niet altijd RUN_COMPLETED (§ Logboek-pagina, foto 6)", () => {
    // `logbook.endRun()` schrijft de RUN_END-regel als `{..., kind: "RUN_END",
    // summary}` — `summary` op het toplevel, niet onder `data`. Vóór de fix las
    // `runHistory()` `endEvent.data?.summary?.outcome`, wat altijd `undefined`
    // gaf en dus altijd op de fallback "RUN_COMPLETED" terugviel — een mislukte
    // of onderbroken run leek daardoor altijd geslaagd.
    const mislukteRunId = "TEST-RUNHISTORY-OUTCOME-FAILED";
    logbookMod.startRun(mislukteRunId, { kind: "proof", productionVersion: versionsMod.currentVersionId(), sandboxParent: null, modelConfig: null, challengeOrGoal: null });
    logbookMod.endRun(mislukteRunId, { outcome: "RUN_FAILED", totalDurationMs: 1000, modelCalls: null, experiments: 0, optimizerJobs: 0, variantsTested: 0, accepted: 0, rejected: 0, bestVariant: null, productionChanged: false, openHypotheses: [], lessonsLearned: [] });

    const onderbrokenRunId = "TEST-RUNHISTORY-OUTCOME-INTERRUPTED";
    logbookMod.startRun(onderbrokenRunId, { kind: "proof", productionVersion: versionsMod.currentVersionId(), sandboxParent: null, modelConfig: null, challengeOrGoal: null });
    logbookMod.endRun(onderbrokenRunId, { outcome: "RUN_INTERRUPTED", totalDurationMs: 1000, modelCalls: null, experiments: 0, optimizerJobs: 0, variantsTested: 0, accepted: 0, rejected: 0, bestVariant: null, productionChanged: false, openHypotheses: [], lessonsLearned: [] });

    const geslaagdeRunId = "TEST-RUNHISTORY-OUTCOME-COMPLETED";
    logbookMod.startRun(geslaagdeRunId, { kind: "proof", productionVersion: versionsMod.currentVersionId(), sandboxParent: null, modelConfig: null, challengeOrGoal: null });
    logbookMod.endRun(geslaagdeRunId, { outcome: "RUN_COMPLETED", totalDurationMs: 1000, modelCalls: null, experiments: 0, optimizerJobs: 0, variantsTested: 0, accepted: 0, rejected: 0, bestVariant: null, productionChanged: false, openHypotheses: [], lessonsLearned: [] });

    const geschiedenis = aggMod.runHistory();
    expect(geschiedenis.find((r) => r.runId === mislukteRunId)?.outcome).toBe("RUN_FAILED");
    expect(geschiedenis.find((r) => r.runId === onderbrokenRunId)?.outcome).toBe("RUN_INTERRUPTED");
    expect(geschiedenis.find((r) => r.runId === geslaagdeRunId)?.outcome).toBe("RUN_COMPLETED");
  });
});
