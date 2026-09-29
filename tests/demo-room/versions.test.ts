import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Geïsoleerd: vóór elke import een eigen staatmap, zodat deze test nooit de
// echte demo-room/data raakt (de releasedienst schrijft ook prompts/ en een
// activatielogboek, die de opruimlus hieronder niet kent).
vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = mkdtempSync(join(tmpdir(), "demo-room-versions-test-"));
});
import { DATA_DIR } from "../../demo-room/src/config";
import { BASELINE_VERSION_ID, activateVersion, createVersion, currentVersionId, getVersion, listVersions, nextVersionId } from "../../demo-room/src/publish/versions";

// Productie-activatie vereist altijd een benoemde mens (src/lib/lyra-release.ts).
const TEST_AKKOORD = { door: { id: "test-mens", role: "ROOSTERCOMMISSIE" }, reden: "test" } as const;

describe("Demo Room v0.2 — versienummering (puur)", () => {
  it("begint bij 01 voor een nieuwe dag", () => {
    expect(nextVersionId([], new Date("2026-09-26T10:00:00Z"))).toBe("lyra-prod-2026-09-26-01");
  });

  it("telt op binnen dezelfde dag", () => {
    const bestaand = ["lyra-prod-2026-09-26-01", "lyra-prod-2026-09-26-02"];
    expect(nextVersionId(bestaand, new Date("2026-09-26T10:00:00Z"))).toBe("lyra-prod-2026-09-26-03");
  });

  it("begint opnieuw bij 01 op een nieuwe dag, ongeacht eerdere dagen", () => {
    const bestaand = ["lyra-prod-2026-09-25-01", "lyra-prod-2026-09-25-02"];
    expect(nextVersionId(bestaand, new Date("2026-09-26T00:00:01Z"))).toBe("lyra-prod-2026-09-26-01");
  });

  it("negeert bestanden van andere dagen bij het tellen", () => {
    const bestaand = ["lyra-prod-2026-09-24-05", "lyra-prod-2026-09-26-01"];
    expect(nextVersionId(bestaand, new Date("2026-09-26T10:00:00Z"))).toBe("lyra-prod-2026-09-26-02");
  });
});

const VERSIONS_DIR = path.join(DATA_DIR, "lyra-versions");

describe("Demo Room v0.2 — versiestore (bestandssysteem)", () => {
  afterEach(() => {
    // Elke test ruimt de versiebestanden die ze zelf aanmaakte al netjes op;
    // hier resetten we alleen de wijzer, zodat currentVersionId() tussen
    // tests weer bij de baseline begint.
    if (existsSync(VERSIONS_DIR)) {
      for (const f of readdirSync(VERSIONS_DIR)) {
        if (f === "current.json" || f === "current-prompt.txt") rmSync(path.join(VERSIONS_DIR, f), { force: true });
      }
    }
  });

  it("zonder enige gepubliceerde versie is de baseline actief", () => {
    expect(currentVersionId()).toBe(BASELINE_VERSION_ID);
    expect(getVersion(BASELINE_VERSION_ID)?.promptOverrideText).toBeNull();
  });

  it("createVersion legt vast als SUPERSEDED; activateVersion maakt hem ACTIVE en wijzigt de wijzer", () => {
    const v = createVersion({
      sourceExperimentId: "test-exp-1",
      variantId: "variant-a-tool-hint",
      promptOverrideText: "test-tekst",
      benchmarkReference: null,
      changedFiles: [],
      knownIssues: [],
      reasonForPromotion: "test",
    });
    expect(v.id).toMatch(/^lyra-prod-\d{4}-\d{2}-\d{2}-\d{2}$/);
    expect(getVersion(v.id)?.status).toBe("SUPERSEDED");

    activateVersion(v.id, TEST_AKKOORD);
    expect(currentVersionId()).toBe(v.id);
    expect(getVersion(v.id)?.status).toBe("ACTIVE");

    rmSync(path.join(VERSIONS_DIR, `${v.id}.json`), { force: true });
  });

  it("een tweede activatie zet de eerste terug op SUPERSEDED", () => {
    const v1 = createVersion({ sourceExperimentId: "test-exp-a", variantId: null, promptOverrideText: "a", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    const v2 = createVersion({ sourceExperimentId: "test-exp-b", variantId: null, promptOverrideText: "b", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    activateVersion(v1.id, TEST_AKKOORD);
    activateVersion(v2.id, TEST_AKKOORD);
    expect(getVersion(v1.id)?.status).toBe("SUPERSEDED");
    expect(getVersion(v2.id)?.status).toBe("ACTIVE");
    expect(currentVersionId()).toBe(v2.id);
    rmSync(path.join(VERSIONS_DIR, `${v1.id}.json`), { force: true });
    rmSync(path.join(VERSIONS_DIR, `${v2.id}.json`), { force: true });
  });

  it("listVersions geeft alles terug, nieuwste eerst", () => {
    const v1 = createVersion({ sourceExperimentId: "test-exp-c", variantId: null, promptOverrideText: "c", benchmarkReference: null, changedFiles: [], knownIssues: [], reasonForPromotion: "" });
    const versies = listVersions();
    expect(versies.some((v) => v.id === v1.id)).toBe(true);
    rmSync(path.join(VERSIONS_DIR, `${v1.id}.json`), { force: true });
  });
});
