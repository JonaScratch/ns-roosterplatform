import { describe, expect, it, vi } from "vitest";

// Vóór elke import: de bewijzen draaien uitsluitend in een eigen tijdelijke staat.
vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = mkdtempSync(join(tmpdir(), "lyra-e2e-test-"));
});

import { draaiBewijzen } from "../../scripts/lyra-master/e2e-proofs";

/**
 * Phase R: de tien end-to-end bewijzen moeten alle tien slagen. Elk bewijs
 * noemt zelf wat er synthetisch aan is (de PRE/POST-meting); de rest is de
 * echte keten.
 */
describe("Phase R — end-to-end bewijzen", () => {
  it("alle elf PASS, elk met waarnemingen", async () => {
    const env = { ...process.env };
    try {
      const bewijzen = await draaiBewijzen();
      const mislukt = bewijzen.filter((b) => b.status !== "PASS").map((b) => `${b.nr}: ${b.fout}`);
      expect(mislukt).toEqual([]);
      expect(bewijzen.map((b) => b.nr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      for (const b of bewijzen) expect(b.waarnemingen.length, b.naam).toBeGreaterThan(0);
    } finally {
      for (const k of ["NS_LOCAL_LLM_URL", "NS_LOCAL_LLM_MODEL", "NS_PRODUCTION_PROMPT_FILE"]) {
        if (env[k] === undefined) delete process.env[k];
        else process.env[k] = env[k];
      }
    }
  }, 60_000);
});
