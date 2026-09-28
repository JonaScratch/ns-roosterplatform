import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * § UI/UX REBUILD — Logboek (foto 6): "benchmarkontwikkeling-over-tijd toont
 * alleen promotie/activatiemomenten". Deze test bewijst dat `promotionHistory()`
 * (demo-room/src/report/dashboardAggregates.ts) uitsluitend échte
 * `activateVersion()`-momenten teruggeeft — en expliciet NIET een
 * development-cycle-kandidaat die met `createVersion()` is aangemaakt maar
 * (nog) nooit geactiveerd is (zie `develop/developmentCycle.ts`: een
 * kandidaat wordt pas een versie ná menselijke goedkeuring).
 *
 * Eigen, geïsoleerde `DEMO_ROOM_STATE_ROOT_OVERRIDE` (in plaats van aan te
 * sluiten bij `versionNumberingAndHistory.test.ts`'s gedeelde tmpRoot): dat
 * bestand hergebruikt versie-ID's over meerdere `it()`-blokken heen zodra
 * eerdere testversies zijn opgeruimd, en het logboek is append-only — een
 * globale "bestaat er ooit een regel voor deze versie-ID"-check zou dan een
 * loos-positieve treffer uit een ANDERE test kunnen oppikken.
 */

let tmpRoot: string;
let versionsMod: typeof import("../../demo-room/src/publish/versions");
let safePublishMod: typeof import("../../demo-room/src/publish/safePublish");
let logbookMod: typeof import("../../demo-room/src/store/logbook");
let aggMod: typeof import("../../demo-room/src/report/dashboardAggregates");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-promotionhistory-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;
  versionsMod = await import("../../demo-room/src/publish/versions");
  safePublishMod = await import("../../demo-room/src/publish/safePublish");
  logbookMod = await import("../../demo-room/src/store/logbook");
  aggMod = await import("../../demo-room/src/report/dashboardAggregates");
});

afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("promotionHistory()", () => {
  it("neemt een echte publicatie en een handmatige rollback op, maar nooit een nooit-geactiveerde development-cycle-kandidaat", async () => {
    const kandidaat = versionsMod.createVersion({ sourceExperimentId: "exp-kandidaat", variantId: "v-kandidaat", promptOverrideText: "kandidaat-tekst", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });

    const gepubliceerd = versionsMod.createVersion({ sourceExperimentId: "exp-publish", variantId: "v-publish", promptOverrideText: "publish-tekst", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    const vanVersie = versionsMod.currentVersionId();
    versionsMod.activateVersion(gepubliceerd.id);
    const publishRunId = "TEST-PROMOTIONHISTORY-PUBLISH";
    logbookMod.startRun(publishRunId, { kind: "publish", productionVersion: vanVersie, sandboxParent: null, modelConfig: null, challengeOrGoal: null });
    logbookMod.log(publishRunId, {
      kind: "CHANGE_APPLIED",
      experimentId: "exp-publish",
      message: "Systeeminstructie bijgewerkt.",
      change: { beforeVersion: vanVersie, afterVersion: gepubliceerd.id, affectedFiles: ["NS_PRODUCTION_PROMPT_FILE"], causedByExperimentId: "exp-publish", rollbackReference: vanVersie, diffReference: null },
    });

    // Een korte, echte wachttijd tussen publicatie en herstel — in de praktijk
    // zijn dit altijd twee aparte, mens-bevestigde acties (nooit binnen
    // dezelfde milliseconde), en de chronologische sortering van
    // `promotionHistory()` mag daar terecht van uitgaan.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const terugVersie = versionsMod.createVersion({ sourceExperimentId: null, variantId: null, promptOverrideText: "rollback-doel-tekst", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    await safePublishMod.rollbackTo(terugVersie.id, "TEST-PROMOTIONHISTORY-ROLLBACK");

    const geschiedenis = aggMod.promotionHistory();
    expect(geschiedenis.some((e) => e.toVersionId === kandidaat.id)).toBe(false);

    const publishEntry = geschiedenis.find((e) => e.toVersionId === gepubliceerd.id);
    expect(publishEntry).toBeDefined();
    expect(publishEntry?.kind).toBe("PUBLISH");
    expect(publishEntry?.fromVersionId).toBe(vanVersie);

    const rollbackEntry = geschiedenis.find((e) => e.toVersionId === terugVersie.id);
    expect(rollbackEntry).toBeDefined();
    expect(rollbackEntry?.kind).toBe("ROLLBACK");
    expect(rollbackEntry?.fromVersionId).toBe(gepubliceerd.id);

    // Chronologisch: de publicatie kwam vóór de rollback.
    expect(geschiedenis.indexOf(publishEntry!)).toBeLessThan(geschiedenis.indexOf(rollbackEntry!));
  });
});
