import { describe, expect, it } from "vitest";
import { controleerLangeRun, VERPLICHTE_STADIA } from "../../scripts/lyra-master/verify-long-run";

/**
 * De controle die na een echte lange run bewijst dat de cyclus zelfstandig en
 * lerend liep. Hier getoetst op synthetische checkpoints: een goede run moet
 * PASS geven, en elke vorm van tekortschieten FAIL — anders bewijst een PASS
 * niets.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const stadia = (uitgezonderd: string[] = []) =>
  VERPLICHTE_STADIA.filter((n) => !uitgezonderd.includes(n)).map((naam) => ({ naam, status: "OK", detail: naam === "RECHTER" ? "judge/2: REJECT — test" : "ok" }));

function goedeRun(): Json {
  return {
    runId: "LR-T",
    status: "DONE",
    stopReden: "BUDGET_OP",
    actieveMs: 60 * 60_000,
    productie: { bijStart: { versionId: "lyra-prod-baseline", generation: 0 }, laatst: { versionId: "lyra-prod-baseline", generation: 0 } },
    profiel: "1h",
    budgetMinuten: 60,
    verkenning: { pogingenPerDimensie: 6, herhalingsTolerantie: 2, maxCycli: 24 },
    omgevingen: [{ segment: 1, op: "2026-09-30T12:00:00.000Z", omgeving: { commit: "abcdef0123", model: { lokaal: true, model: "qwen3:8b", ollamaVersie: "0.34.4" } } }],
    uitgeslotenDimensies: [],
    cycli: [
      { nr: 1, beslissing: "REJECTED", dimensie: "toolChoice", strategie: "REGEL", verdict: "REJECT", stadia: stadia(), lesId: "L1", geleerdVan: [] },
      { nr: 2, beslissing: "REJECTED", dimensie: "toolChoice", strategie: "ZELFCONTROLE", verdict: "REJECT", stadia: stadia(), lesId: "L2", geleerdVan: ["L1"] },
      { nr: 3, beslissing: "PROMOTION_CANDIDATE", dimensie: "toolChoice", strategie: "WAAROM", verdict: "KEEP", stadia: stadia(), lesId: "L3", geleerdVan: ["L1", "L2"] },
    ],
  };
}
const echteModelLog = [
  { kind: "AGENT_EXECUTION_START", message: "Item DR-DEV-01: model=qwen3:8b (taalmodel: ja), 1 beurt(en) uitgevoerd." },
  { kind: "AGENT_EXECUTION_START", message: "Item DR-DEV-02: model=qwen3:8b (taalmodel: ja), 1 beurt(en) uitgevoerd." },
];

const fout = (v: ReturnType<typeof controleerLangeRun>) => v.controles.filter((c) => !c.ok).map((c) => c.naam);

describe("verify-long-run: controleerLangeRun", () => {
  it("een volledige, lerende run met een echt model en zonder activatie: PASS", () => {
    const v = controleerLangeRun(goedeRun(), echteModelLog);
    expect(fout(v)).toEqual([]);
    expect(v.status).toBe("PASS");
    expect(v.samenvatting).toMatchObject({ volledigeCycli: 3, strategieen: ["REGEL", "ZELFCONTROLE", "WAAROM"], stopReden: "BUDGET_OP" });
  });

  it("FAIL: stubmodel of geen modelaanroepen", () => {
    expect(fout(controleerLangeRun(goedeRun(), [{ kind: "AGENT_EXECUTION_START", message: "Item X: model=stub (taalmodel: nee), 1 beurt(en) uitgevoerd." }]))).toEqual(["een echt taalmodel deed de metingen"]);
    expect(fout(controleerLangeRun(goedeRun(), []))).toEqual(["een echt taalmodel deed de metingen"]);
  });

  it("FAIL: een stap ontbreekt (bijv. adversarial)", () => {
    const r = goedeRun();
    r.cycli[1].stadia = stadia(["ADVERSARIAL"]);
    expect(fout(controleerLangeRun(r, echteModelLog))).toContain("elke gemeten cyclus doorliep alle stappen");
  });

  it("FAIL: een verworpen strategie opnieuw geprobeerd, of een cyclus die de vorige les negeerde", () => {
    const herhaal = goedeRun();
    herhaal.cycli[1].strategie = "REGEL";
    expect(fout(controleerLangeRun(herhaal, echteModelLog))).toEqual(["elke cyclus leerde van de vorige"]);
    const negeer = goedeRun();
    negeer.cycli[2].geleerdVan = ["L1"];
    expect(fout(controleerLangeRun(negeer, echteModelLog))).toEqual(["elke cyclus leerde van de vorige"]);
  });

  it("FAIL: productie veranderd tijdens de run, of geen productiestand vastgelegd", () => {
    const r = goedeRun();
    r.productie.laatst = { versionId: "lyra-prod-2026-09-30-01", generation: 1 };
    expect(fout(controleerLangeRun(r, echteModelLog))).toEqual(["productie onaangeroerd (geen autonome activatie)"]);
    const zonder = goedeRun();
    delete zonder.productie;
    expect(fout(controleerLangeRun(zonder, echteModelLog))).toEqual(["productie onaangeroerd (geen autonome activatie)"]);
  });

  it("FAIL: te weinig gemeten cycli, of gestopt door herhaalde fouten, of een oude rechter", () => {
    const kort = goedeRun();
    kort.cycli = kort.cycli.slice(0, 1);
    expect(fout(controleerLangeRun(kort, echteModelLog))).toContain("minstens twee gemeten cycli");
    const kapot = goedeRun();
    kapot.stopReden = "HERHAALDE_FOUT";
    expect(fout(controleerLangeRun(kapot, echteModelLog))).toEqual(["geldige stopreden"]);
    const oud = goedeRun();
    oud.cycli[0].stadia = oud.cycli[0].stadia.map((s: Json) => (s.naam === "RECHTER" ? { ...s, detail: "judge/1: KEEP" } : s));
    expect(fout(controleerLangeRun(oud, echteModelLog))).toEqual(["onafhankelijke rechter (judge/2, met adversarial) gaf per cyclus een oordeel"]);
  });
});

describe("verify-long-run: vingerafdruk van het modeleindpunt", () => {
  it("een segment zonder lokaal model faalt, en het detail noemt de build van het eindpunt", () => {
    const run = goedeRun();
    const zonder = { ...run, omgevingen: [{ segment: 1, op: "t", omgeving: { commit: "x", model: { lokaal: false } } }] };
    expect(fout(controleerLangeRun(zonder, echteModelLog))).toContain("een echt taalmodel deed de metingen");
    const detail = controleerLangeRun(run, echteModelLog).controles.find((c) => c.naam === "een echt taalmodel deed de metingen")?.detail;
    expect(detail).toContain("qwen3:8b @ ollama 0.34.4");
  });
});
