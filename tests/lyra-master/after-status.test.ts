import { describe, expect, it } from "vitest";
import { afterStatus, type AfterStatusInvoer } from "../../scripts/lyra-master/after-status";

/** Run 20260929-193436: 43/43 en toch FAIL, door een telling die de extensiebestanden meetelde. */
const perReplicaat = (namen: string[], n: number) => Array.from({ length: n }, () => namen).flat();
const basis: AfterStatusInvoer = {
  replicaten: 3, modelBereikbaar: true, stubUit: true, alleReplicatenOk: true, aggregatieOk: true,
  ruweBestandsnamen: perReplicaat(["golden.json", "golden-grade.json", "golden-extension.json", "golden-grade-extension.json"], 3),
  extensieGedraaid: true,
};

describe("afterStatus", () => {
  it("een volledige run met extensie is PASS (de oude telling gaf hier FAIL)", () => {
    expect(afterStatus(basis)).toEqual({ status: "PASS", redenen: [] });
  });
  it("zonder extensie volstaan golden + grade", () => {
    expect(afterStatus({ ...basis, extensieGedraaid: false, ruweBestandsnamen: perReplicaat(["golden.json", "golden-grade.json"], 3) }).status).toBe("PASS");
  });
  it("elke ontbrekende voorwaarde levert een eigen, leesbare reden", () => {
    const r = afterStatus({ ...basis, modelBereikbaar: false, stubUit: false, ruweBestandsnamen: basis.ruweBestandsnamen.slice(1) });
    expect(r.status).toBe("FAIL");
    expect(r.redenen).toEqual(["het lokale model was niet bereikbaar", "de stub was niet expliciet uitgeschakeld", "golden.json: 2 van 3 replicaten aanwezig"]);
  });
  it("een gedraaide maar onvolledige extensie is FAIL", () => {
    const r = afterStatus({ ...basis, ruweBestandsnamen: perReplicaat(["golden.json", "golden-grade.json"], 3) });
    expect(r.status).toBe("FAIL");
    expect(r.redenen).toContain("golden-extension.json: 0 van 3 replicaten aanwezig");
  });
});
