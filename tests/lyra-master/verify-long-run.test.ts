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

/**
 * Een voltooide 6-uursrun in het klein: het budget van 360 actieve minuten is
 * op (BUDGET_OP), drie volledige cycli van elk 120 minuten, en na twee
 * verworpen aanpakken een verbreding van de zoekruimte (golf 2) die op die
 * lessen rust en een nieuwe, semantisch andere hypothese oplevert.
 */
function goedeRun(): Json {
  return {
    runId: "LR-T",
    status: "DONE",
    stopReden: "BUDGET_OP",
    actieveMs: 360 * 60_000,
    productie: { bijStart: { versionId: "lyra-prod-baseline", generation: 0 }, laatst: { versionId: "lyra-prod-baseline", generation: 0 } },
    profiel: "6h",
    budgetMinuten: 360,
    verkenning: { pogingenPerDimensie: 6, herhalingsTolerantie: 3, maxCycli: 144 },
    omgevingen: [{ segment: 1, op: "2026-09-30T12:00:00.000Z", omgeving: { commit: "abcdef0123", model: { lokaal: true, model: "qwen3:8b", ollamaVersie: "0.34.4" } } }],
    uitgeslotenDimensies: [],
    cycli: [
      { nr: 1, beslissing: "REJECTED", dimensie: "toolChoice", strategie: "REGEL", verdict: "REJECT", stadia: stadia(), lesId: "L1", geleerdVan: [], duurMs: 120 * 60_000, golf: 1 },
      { nr: 2, beslissing: "REJECTED", dimensie: "toolChoice", strategie: "ZELFCONTROLE", verdict: "REJECT", stadia: stadia(), lesId: "L2", geleerdVan: ["L1"], duurMs: 120 * 60_000, golf: 1 },
      { nr: 3, beslissing: "PROMOTION_CANDIDATE", dimensie: "toolChoice", strategie: "STAPPEN+BESCHERM:falsePremiseCorrection", verdict: "KEEP", stadia: stadia(), lesId: "L3", geleerdVan: ["L1", "L2"], duurMs: 120 * 60_000, golf: 2 },
    ],
    zoekruimte: {
      golven: [
        { nr: 1, aanleiding: "START", naCyclus: 0, aanpak: "ZWAKSTE_EERST", hypothesen: ["G1-toolChoice-REGEL", "G1-toolChoice-ZELFCONTROLE", "G1-toolChoice-WAAROM"], lesIds: [], geweigerd: [] },
        { nr: 2, aanleiding: "STAGNATIE", naCyclus: 2, aanpak: "HEFBOOM", hypothesen: ["G2-toolChoice-1"], lesIds: ["L1", "L2"], geweigerd: [{ dimensie: "toolChoice", strategie: "NADRUK+ZELFCONTROLE", reden: "HERVERPAKT", detail: "" }] },
      ],
      hypothesen: [
        { id: "G1-toolChoice-REGEL", golf: 1, dimensie: "toolChoice", strategie: "REGEL", semantisch: "REGEL", herkomst: { soort: "STARTRUIMTE", reden: "start", lesIds: [] } },
        { id: "G1-toolChoice-ZELFCONTROLE", golf: 1, dimensie: "toolChoice", strategie: "ZELFCONTROLE", semantisch: "ZELFCONTROLE", herkomst: { soort: "STARTRUIMTE", reden: "start", lesIds: [] } },
        { id: "G1-toolChoice-WAAROM", golf: 1, dimensie: "toolChoice", strategie: "WAAROM", semantisch: "WAAROM", herkomst: { soort: "STARTRUIMTE", reden: "start", lesIds: [] } },
        {
          id: "G2-toolChoice-1",
          golf: 2,
          dimensie: "toolChoice",
          strategie: "STAPPEN+BESCHERM:falsePremiseCorrection",
          semantisch: "STAPPEN+BESCHERM:falsePremiseCorrection",
          herkomst: { soort: "GERICHT", reden: "2× bijwerking op falsePremiseCorrection", lesIds: ["L1", "L2"], verschil: { tov: "ZELFCONTROLE", toegevoegd: ["STAPPEN", "BESCHERM:falsePremiseCorrection"], weggelaten: ["ZELFCONTROLE"] } },
        },
      ],
      tests: [],
    },
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
    expect(v.samenvatting).toMatchObject({ volledigeCycli: 3, strategieen: ["REGEL", "ZELFCONTROLE", "STAPPEN+BESCHERM:falsePremiseCorrection"], stopReden: "BUDGET_OP", budgetMinuten: 360, golven: 2, hypothesen: 4 });
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
    expect(fout(controleerLangeRun(herhaal, echteModelLog))).toEqual(["elke cyclus leerde van de vorige", "geen verworpen aanpak semantisch herhaald"]);
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
    expect(fout(controleerLangeRun(kapot, echteModelLog))).toEqual(["geldige stopreden", "actief budget benut (voltooiing)"]);
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

describe("verify-long-run: voltooiing is het budget benutten (eindcontrole 20260930)", () => {
  const naam = (v: ReturnType<typeof controleerLangeRun>, n: string) => v.controles.find((c) => c.naam.startsWith(n));

  it("FAIL op 131,5 van 360 minuten, ook met een geldige, bewezen uitputting (het patroon van DR-UI-20260930165141-d5a8)", () => {
    const r = goedeRun();
    r.actieveMs = 131.5 * 60_000;
    r.stopReden = "ALLES_GEPROBEERD";
    r.cycli = r.cycli.map((c: Json) => ({ ...c, duurMs: 40 * 60_000 }));
    r.cycli.push({ nr: 4, beslissing: "UITGEPUT", dimensie: "toolChoice", verdict: null, stadia: [], duurMs: 60_000 });
    const v = controleerLangeRun(r, echteModelLog);
    expect(naam(v, "geldige stopreden")?.ok).toBe(true); // de uitputting zelf was geldig…
    expect(naam(v, "actief budget benut")?.ok).toBe(false); // …maar de run is niet voltooid
    expect(naam(v, "actief budget benut")?.detail).toMatch(/131\.5 van 360/);
    expect(naam(v, "uitputting en stagnatie")?.ok).toBe(false);
    expect(v.status).toBe("FAIL");
  });

  it("PASS alleen met het budget echt benut; een natuurlijke overschrijding op de cyclusgrens mag, meer niet", () => {
    const op = goedeRun();
    op.actieveMs = (360 + 7) * 60_000; // laatste cyclus liep 7 min over de grens
    expect(controleerLangeRun(op, echteModelLog).status).toBe("PASS");
    const teVer = goedeRun();
    teVer.actieveMs = (360 + 200) * 60_000;
    expect(fout(controleerLangeRun(teVer, echteModelLog))).toContain("actief budget benut (voltooiing)");
    for (const stop of ["HANDMATIG_GESTOPT", "CAPACITEIT_BLOKKADE", "MAX_CYCLI"]) {
      const r = goedeRun();
      r.stopReden = stop;
      r.actieveMs = 200 * 60_000;
      expect(fout(controleerLangeRun(r, echteModelLog)), stop).toContain("actief budget benut (voltooiing)");
    }
    const handmatig = goedeRun();
    handmatig.profiel = "handmatig";
    handmatig.budgetMinuten = null;
    expect(fout(controleerLangeRun(handmatig, echteModelLog))).toContain("actief budget benut (voltooiing)");
  });

  it("FAIL als de tijd niet aan betekenisvolle cycli opging", () => {
    const r = goedeRun();
    r.cycli = r.cycli.map((c: Json) => ({ ...c, duurMs: 10 * 60_000 }));
    expect(fout(controleerLangeRun(r, echteModelLog))).toEqual(["betekenisvolle cycli gedurende het budget"]);
  });

  it("FAIL op een hypothese zonder herkomst, een semantisch duplicaat, of een herverpakte verworpen aanpak", () => {
    const zonder = goedeRun();
    zonder.zoekruimte.hypothesen[3].herkomst = { soort: "GERICHT", reden: "", lesIds: [] };
    expect(fout(controleerLangeRun(zonder, echteModelLog))).toContain("nieuwe hypothesen zijn aantoonbaar nieuw (herkomst, les, geen semantisch duplicaat)");
    const herverpakt = goedeRun();
    Object.assign(herverpakt.zoekruimte.hypothesen[3], { strategie: "NADRUK+ZELFCONTROLE", semantisch: "ZELFCONTROLE" });
    const v = controleerLangeRun(herverpakt, echteModelLog);
    expect(naam(v, "nieuwe hypothesen")?.ok).toBe(false);
    expect(naam(v, "nieuwe hypothesen")?.detail).toMatch(/duplicaat|herverpakte/);
  });

  it("FAIL als een verworpen aanpak in een ander jasje opnieuw gemeten wordt", () => {
    const r = goedeRun();
    r.cycli[2] = { ...r.cycli[2], strategie: "NADRUK+ZELFCONTROLE", semantisch: "ZELFCONTROLE" };
    expect(fout(controleerLangeRun(r, echteModelLog))).toContain("geen verworpen aanpak semantisch herhaald");
  });

  it("uitputting in de laatste cyclus is geen einde als er daarna verbreed is en het budget op de cyclusgrens opging", () => {
    const r = goedeRun();
    r.cycli.push({ nr: 4, beslissing: "UITGEPUT", dimensie: "toolChoice", verdict: null, stadia: [], duurMs: 0, golf: 2 });
    r.zoekruimte.golven.push({ nr: 3, aanleiding: "POOL_UITGEPUT", naCyclus: 4, aanpak: "HEFBOOM", hypothesen: ["G3-toolChoice-1"], lesIds: ["L3"], geweigerd: [] });
    r.zoekruimte.hypothesen.push({ id: "G3-toolChoice-1", golf: 3, dimensie: "toolChoice", strategie: "PRINCIPE", semantisch: "PRINCIPE", herkomst: { soort: "VERBREDING", reden: "verbreding", lesIds: ["L3"] } });
    expect(controleerLangeRun(r, echteModelLog).status).toBe("PASS");
    const zonderGolf = goedeRun();
    zonderGolf.cycli.push({ nr: 4, beslissing: "UITGEPUT", dimensie: "toolChoice", verdict: null, stadia: [], duurMs: 0, golf: 2 });
    expect(fout(controleerLangeRun(zonderGolf, echteModelLog))).toContain("uitputting en stagnatie leidden tot verbreding, niet tot het einde");
  });

  it("FAIL als een golf niet op de lessen van de vorige rust, of als uitputting het einde was", () => {
    const blind = goedeRun();
    blind.zoekruimte.golven[1].lesIds = ["L-elders"];
    expect(fout(controleerLangeRun(blind, echteModelLog))).toEqual(["lessen van golf N sturen golf N+1"]);
    const zonderZoekruimte = goedeRun();
    delete zonderZoekruimte.zoekruimte;
    expect(fout(controleerLangeRun(zonderZoekruimte, echteModelLog))).toContain("uitputting en stagnatie leidden tot verbreding, niet tot het einde");
  });
});
