import { rmSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

// Vóór elke import: eigen staatmap (lessons.ts schrijft in DATA_DIR/learning).
const tmpRoot = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const d = mkdtempSync(join(tmpdir(), "demo-room-lessons-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = d;
  return d;
});

import { generateCandidateFromWeakness, STRATEGIEEN } from "../../demo-room/src/develop/generateCandidate";
import { kiesDoel, kiesStrategie, leesLessen, MAX_ONBESLIST, voegLesToe, type Les } from "../../demo-room/src/develop/lessons";
import { MAX_TEKENS, valideerKandidaat } from "../../demo-room/src/develop/validator";
import type { PromptVariant } from "../../demo-room/src/variants/promptVariants";

afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

let n = 0;
const les = (dimensie: string, strategie: string, verdict: Les["verdict"]): Les => ({
  id: `les-${(n += 1)}`,
  at: `2026-09-30T00:00:${String(n).padStart(2, "0")}Z`,
  runId: "T",
  dimensie,
  strategie,
  kandidaatId: `k${n}`,
  verdict,
  beslissing: "x",
  redenen: [],
  deltaDoel: null,
  adversarial: null,
});
const S = STRATEGIEEN;

describe("leergeheugen — diagnose na het leren", () => {
  const scores = { toolChoice: 50, grounding: 60, machinistTaal: 70 };

  it("zonder lessen: de zwakste gemeten dimensie", () => {
    expect(kiesDoel(scores, [], S)?.waarde).toBe("toolChoice");
  });
  it("een uitgeputte dimensie wordt overgeslagen, met reden en met de lessen die dat bepaalden", () => {
    const lessen = S.map((st) => les("toolChoice", st, "REJECT"));
    const k = kiesDoel(scores, lessen, S)!;
    expect(k.waarde).toBe("grounding");
    expect(k.reden).toMatch(/overgeslagen: toolChoice/);
    expect(k.lesIds).toEqual(lessen.map((l) => l.id));
  });
  it("een behouden kandidaat wacht op een mens: geen tweede kandidaat op dezelfde dimensie", () => {
    expect(kiesDoel(scores, [les("toolChoice", "REGEL", "KEEP")], S)?.waarde).toBe("grounding");
  });
  it("een handmatige focus gaat voor, ook ongemeten; een uitgeputte focus niet", () => {
    expect(kiesDoel(scores, [], S, "causalClaims")?.waarde).toBe("causalClaims");
    expect(kiesDoel(scores, S.map((st) => les("causalClaims", st, "REJECT")), S, "causalClaims")?.waarde).toBe("toolChoice");
  });
  it("alles uitgeput → null (de cyclus meldt UITGEPUT in plaats van dezelfde tekst te herhalen)", () => {
    const lessen = Object.keys(scores).flatMap((d) => S.map((st) => les(d, st, "REJECT")));
    expect(kiesDoel(scores, lessen, S)).toBeNull();
  });
});

describe("leergeheugen — hypothese na het leren", () => {
  it("een verworpen strategie komt niet terug; de volgende wordt gekozen", () => {
    expect(kiesStrategie("grounding", [], S)?.waarde).toBe("REGEL");
    const k = kiesStrategie("grounding", [les("grounding", "REGEL", "REJECT")], S)!;
    expect(k.waarde).toBe("ZELFCONTROLE");
    expect(k.reden).toMatch(/REGEL verworpen/);
  });
  it("'meer bewijs nodig' → dezelfde strategie met meer replicaten, hoogstens tot MAX_ONBESLIST", () => {
    const een = [les("grounding", "REGEL", "NEEDS_MORE_EVIDENCE")];
    expect(kiesStrategie("grounding", een, S)).toMatchObject({ waarde: "REGEL", meerReplicaten: true });
    const twee = Array.from({ length: MAX_ONBESLIST }, () => les("grounding", "REGEL", "NEEDS_MORE_EVIDENCE"));
    expect(kiesStrategie("grounding", twee, S)).toMatchObject({ waarde: "ZELFCONTROLE", meerReplicaten: false });
  });
  it("een validator-afwijzing telt als verworpen", () => {
    expect(kiesStrategie("grounding", [les("grounding", "REGEL", "VALIDATOR_REJECT")], S)?.waarde).toBe("ZELFCONTROLE");
  });
  it("alle strategieën verworpen → null", () => {
    expect(kiesStrategie("grounding", S.map((st) => les("grounding", st, "REJECT")), S)).toBeNull();
  });
  it("lessen zijn append-only en overleven de cyclus", () => {
    const a = voegLesToe({ runId: "R1", dimensie: "grounding", strategie: "REGEL", kandidaatId: "k", verdict: "REJECT", beslissing: "REJECTED", redenen: ["r"], deltaDoel: -1, adversarial: null });
    voegLesToe({ runId: "R2", dimensie: "grounding", strategie: "ZELFCONTROLE", kandidaatId: "k2", verdict: "NEEDS_MORE_EVIDENCE", beslissing: "KEEP_TESTING", redenen: [], deltaDoel: 1, adversarial: { basis: 70, kandidaat: 70 } });
    const alle = leesLessen();
    expect(alle.map((l) => l.runId)).toEqual(["R1", "R2"]);
    expect(alle[0].id).toBe(a.id);
    // Over runs heen: run 2 ziet wat run 1 verwierp.
    expect(kiesStrategie("grounding", alle, S)).toMatchObject({ waarde: "ZELFCONTROLE", meerReplicaten: true });
  });
});

describe("strategieën en validator", () => {
  const zwakte = { executed: true, notExecutedReason: null, weakestDimension: "grounding" as const, weakestScore: 40 };

  it("elke strategie levert een andere, publiceerbare tekst die de validator doorlaat", () => {
    const teksten = S.map((st) => generateCandidateFromWeakness(zwakte, [], st));
    expect(new Set(teksten.map((k) => k.productionText)).size).toBe(S.length);
    for (const k of teksten) {
      expect(k.hypothesis).toEqual({ dimensie: "grounding", strategie: expect.any(String), familie: expect.any(String) });
      expect(valideerKandidaat(k, []), k.id).toEqual({ ok: true, bevindingen: [] });
    }
  });

  const kandidaat = (productionText: string, transform?: PromptVariant["transform"]): PromptVariant => ({
    id: "t",
    label: "t",
    description: "t",
    category: "PROMPT",
    productionText,
    transform: transform ?? ((b) => `${b}\n\n${productionText}`),
  });

  it("wijst af: niet publiceerbaar, te lang, gezagsclaim, vastgezet feit, holdoutlek", () => {
    expect(valideerKandidaat(kandidaat("Wees precies.", (b) => `Wees precies.\n\n${b}`), []).bevindingen.join()).toMatch(/niet publiceerbaar/);
    expect(valideerKandidaat(kandidaat("x".repeat(MAX_TEKENS + 1)), []).bevindingen.join()).toMatch(/te lang/);
    expect(valideerKandidaat(kandidaat("Deze werkwijze is bevestigd door de roostercommissie."), []).bevindingen.join()).toMatch(/gezagsclaim/);
    expect(valideerKandidaat(kandidaat("Noem bij rust altijd RED_WEEKEND_MIN_REST."), []).bevindingen.join()).toMatch(/feit vast/);
    expect(valideerKandidaat(kandidaat("Dienst 701 is altijd een rangeerdienst."), []).bevindingen.join()).toMatch(/feit vast/);
    const holdout = ["Een volledig verzonnen testvraag over de zeta-dienst op de derde dag van de maand."];
    expect(valideerKandidaat(kandidaat("Let op: een volledig verzonnen testvraag over de zeta-dienst op de derde dag."), holdout).bevindingen.join()).toMatch(/holdoutfragment/);
  });
});
