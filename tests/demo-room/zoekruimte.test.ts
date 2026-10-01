import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentQualityCategory, DualQualityMeasurement, ProofOfValueResult, RosterQualityCategory } from "../../demo-room/src/types";
import type { Les } from "../../demo-room/src/develop/lessons";
import { controleerLangeRun } from "../../scripts/lyra-master/verify-long-run";

/**
 * De dynamische zoekruimte van een lange run (eindcontrole 20260930, §55):
 * uitputting van de vaste startruimte beëindigt een tijdprofiel niet meer; de
 * regisseur maakt uit de lessen nieuwe, begrensde golven hypothesen en tests,
 * weigert semantische herhalingen, wisselt van aanpak, en meldt een echte
 * capaciteitsgrens als blocker — nooit als voltooiing.
 *
 * De metingen zijn een deterministische nepwereld (geen model): elke
 * kandidaat zonder bescherming laat falsePremiseCorrection zakken (zoals in de
 * echte run), ZELFCONTROLE verbetert toolChoice. De rechter, de cyclus, de
 * lessen en de motor zijn echt.
 */

let tmpRoot: string;
let longRun: typeof import("../../demo-room/src/factory/longRun");
let autoRun: typeof import("../../demo-room/src/develop/autonomousDevelopmentRun");
let generate: typeof import("../../demo-room/src/develop/generateCandidate");
let zoek: typeof import("../../demo-room/src/develop/zoekruimte");
let interventies: typeof import("../../demo-room/src/develop/interventies");
let lessons: typeof import("../../demo-room/src/develop/lessons");
let versions: typeof import("../../demo-room/src/publish/versions");
let canoniek: typeof import("../../demo-room/src/factory/canoniek");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-zoekruimte-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;
  longRun = await import("../../demo-room/src/factory/longRun");
  autoRun = await import("../../demo-room/src/develop/autonomousDevelopmentRun");
  generate = await import("../../demo-room/src/develop/generateCandidate");
  zoek = await import("../../demo-room/src/develop/zoekruimte");
  interventies = await import("../../demo-room/src/develop/interventies");
  lessons = await import("../../demo-room/src/develop/lessons");
  versions = await import("../../demo-room/src/publish/versions");
  canoniek = await import("../../demo-room/src/factory/canoniek");
});
beforeEach(() => rmSync(path.join(tmpRoot, "data", "learning"), { recursive: true, force: true }));
afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── nepwereld ────────────────────────────────────────────────────────────────

const ZES = ["contextResolution", "multiTurnContext", "toolChoice", "grounding", "falsePremiseCorrection", "causalClaims"] as const;
const BASIS: Omit<AgentQualityCategory, "latencyMs"> = { contextResolution: 50, multiTurnContext: 52, machinistTaal: 80, toolChoice: 54, falsePremiseCorrection: 80, grounding: 56, causalClaims: 58, unnecessaryClarifications: 80 };
const rooster = { validity: null, packageQuality: null, profileFit: null, restRecovery: null, fairness: null, weekends: null, nightBlocks: null, rangeerDistribution: null, worstLineQuality: null, paretoResult: null, notApplicableReason: "test" } as RosterQualityCategory;
const meting = (o: Partial<AgentQualityCategory> = {}): DualQualityMeasurement => ({ agent: { ...BASIS, latencyMs: { p50: 1, p95: 1 }, ...o } as AgentQualityCategory, roster: rooster, measuredAt: "t" });

function proef(runId: string, v: { id: string; hypothesis?: { dimensie: string; strategie: string } }): ProofOfValueResult {
  const dim = (v.hypothesis?.dimensie ?? "toolChoice") as keyof typeof BASIS;
  const st = v.hypothesis?.strategie ?? "REGEL";
  const beschermd = st.includes("BESCHERM:falsePremiseCorrection");
  const winst = dim === "toolChoice" && st.split("+").includes("ZELFCONTROLE") ? 20 : 0;
  const post = meting({ [dim]: (BASIS[dim] as number) + winst, ...(dim === "falsePremiseCorrection" || !beschermd ? { falsePremiseCorrection: 30 } : {}) });
  return {
    id: `p-${v.id}`, runId, startedAt: "t", finishedAt: "t", executed: true, notExecutedReason: null, variantId: v.id, variantLabel: v.id, variantCategory: "PROMPT", frozenSetId: "nep",
    pre: meting(), postRuns: [post, post], post, postVariance: {} as ProofOfValueResult["postVariance"], preHoldout: meting(), holdout: meting(),
    regressions: [], improvements: [], decision: "REJECTED", reasoning: "nepwereld", knownWeaknesses: [],
  };
}

function wereld(runId: string, dims: readonly string[] = ZES, onProof?: (o: { extraItems?: readonly Record<string, unknown>[]; n: number }) => void) {
  let n = 0;
  return {
    identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: dims[0] as keyof AgentQualityCategory, weakestScore: 50, scores: Object.fromEntries(dims.map((d) => [d, BASIS[d as keyof typeof BASIS] as number])) }),
    generateCandidate: generate.generateCandidateFromWeakness,
    runProofOfValue: async (o: { variant?: { id: string; hypothesis?: { dimensie: string; strategie: string } }; extraItems?: readonly Record<string, unknown>[] }) => {
      n += 1;
      onProof?.({ extraItems: o.extraItems, n });
      return proef(runId, o.variant!);
    },
    createVersion: versions.createVersion,
    runAdversarial: async () => ({ basis: 67, kandidaat: 67 }),
  };
}

function klok(stapMin: number) {
  let t = Date.parse("2026-10-01T08:00:00.000Z");
  return () => (t += stapMin * 60_000);
}
const PROD = { versionId: "lyra-prod-baseline", generation: 0 };
const modelLog = [{ kind: "AGENT_EXECUTION_START", message: "Item x: model=qwen3:8b (taalmodel: ja), 1 beurt(en) uitgevoerd." }];
const omgeving = () => ({ commit: "test", model: { lokaal: true, model: "qwen3:8b", ollamaVersie: "0.34.4" } });

// ── de motor ─────────────────────────────────────────────────────────────────

describe("uitputting van de startruimte beëindigt een 6-uursrun niet", () => {
  it("de vaste 3×6-ruimte is op na 18 cycli, het budget nog lang niet: nieuwe golf, de run gaat door tot het budget op is", async () => {
    const runId = "ZR-6H-POOL";
    const startVersie = versions.currentVersionId();
    const r = await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 360, zoek: { stagnatieVenster: 1000 } }, wereld(runId), { nu: klok(5), productie: () => PROD, omgeving });
    const c = longRun.leesCheckpoint(runId)!;
    const uitgeput = c.cycli.find((x) => x.beslissing === "UITGEPUT")!;
    expect(uitgeput.nr).toBe(19); // 3 strategieën × 6 zwaktes, allemaal verworpen
    const golf2 = c.zoekruimte!.golven[1];
    expect(golf2).toMatchObject({ nr: 2, aanleiding: "POOL_UITGEPUT", naCyclus: 19 });
    expect(golf2.hypothesen.length).toBeGreaterThan(0);
    expect(c.cycli.filter((x) => x.nr > 19 && x.kandidaatId).length).toBeGreaterThan(5);
    expect(c.stopReden).toBe("BUDGET_OP");
    expect(c.actieveMs / 60000).toBeGreaterThanOrEqual(360);
    expect(r.stopReason).toBe("MAX_MINUTES_REACHED");
    // Productie onaangeroerd: niets geactiveerd, ook niet bij een KEEP.
    expect(c.productie?.bijStart).toEqual(c.productie?.laatst);
    expect(versions.currentVersionId()).toBe(startVersie);
    const v = controleerLangeRun(c as never, modelLog);
    expect(v.controles.filter((x) => !x.ok)).toEqual([]);
    expect(v.status).toBe("PASS");
  }, 60_000);

  it("een nieuwe golf brengt echt nieuwe hypothesen, met herkomst en het verschil met de dichtstbijzijnde verworpen aanpak", async () => {
    const runId = "ZR-NIEUW";
    await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 200, zoek: { stagnatieVenster: 1000 } }, wereld(runId), { nu: klok(5), productie: () => PROD, omgeving });
    const c = longRun.leesCheckpoint(runId)!;
    const verworpen = c.cycli.filter((x) => x.verdict === "REJECT" && x.nr <= c.zoekruimte!.golven[1].naCyclus);
    const nieuw = c.zoekruimte!.hypothesen.filter((h) => h.golf === 2);
    expect(nieuw.length).toBeGreaterThan(0);
    for (const h of nieuw) {
      expect(h.herkomst.reden.length).toBeGreaterThan(10);
      expect(h.herkomst.lesIds.length).toBeGreaterThan(0);
      expect(verworpen.some((x) => x.dimensie === h.dimensie && interventies.semantischeSleutel(x.strategie!) === h.semantisch)).toBe(false);
      expect(h.herkomst.verschil.tov).not.toBeNull();
      expect(h.herkomst.verschil.toegevoegd.length + h.herkomst.verschil.weggelaten.length).toBeGreaterThan(0);
    }
    // Geen twee hypothesen met dezelfde betekenis op dezelfde zwakte, over alle golven.
    const sleutels = c.zoekruimte!.hypothesen.map((h) => `${h.dimensie}|${h.semantisch}`);
    expect(new Set(sleutels).size).toBe(sleutels.length);
  });

  it("lessen van golf N sturen golf N+1: deelwinst met bijwerking → samenstelling mét bescherming, en die meet beter", async () => {
    const runId = "ZR-LES";
    await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 200, zoek: { stagnatieVenster: 1000 } }, wereld(runId), { nu: klok(5), productie: () => PROD, omgeving });
    const c = longRun.leesCheckpoint(runId)!;
    const bron = c.cycli.find((x) => x.dimensie === "toolChoice" && x.strategie === "ZELFCONTROLE")!;
    expect(bron.verdict).toBe("REJECT"); // +20 op toolChoice, maar falsePremiseCorrection zakte
    const comp = c.zoekruimte!.hypothesen.find((h) => h.dimensie === "toolChoice" && h.strategie === "ZELFCONTROLE+BESCHERM:falsePremiseCorrection")!;
    expect(comp).toBeDefined();
    expect(comp.golf).toBe(2);
    expect(comp.herkomst.soort).toBe("COMPOSITIE");
    expect(comp.herkomst.lesIds).toContain(bron.lesId);
    expect(c.zoekruimte!.golven[1].lesIds).toContain(bron.lesId);
    const gemeten = c.cycli.find((x) => x.strategie === comp.strategie)!;
    expect(gemeten.golf).toBe(2);
    expect(gemeten.hypotheseId).toBe(comp.id);
    expect(gemeten.verdict).toBe("KEEP");
  });

  it("nieuwe tests waar de meting niet onderscheidt; de cycli daarna meten ze (zelfde items voor basis en kandidaat)", async () => {
    const runId = "ZR-TESTS";
    const extra: string[][] = [];
    await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 150, zoek: { stagnatieVenster: 1000 } }, wereld(runId, ZES, (o) => extra.push((o.extraItems ?? []).map((i) => String(i.id)))), { nu: klok(5), productie: () => PROD, omgeving });
    const c = longRun.leesCheckpoint(runId)!;
    const golf2 = c.zoekruimte!.golven[1];
    // falsePremiseCorrection sprong steeds met 50pp (een handvol items): te grof.
    expect(golf2.analyse.find((a) => a.dimensie === "falsePremiseCorrection")?.onvoldoendeDiscriminerend).toBe(true);
    const tests = c.zoekruimte!.tests;
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.length).toBeLessThanOrEqual(c.verkenning!.zoek!.maxTestsPerGolf);
    for (const t of tests) {
      expect(t.herkomst.reden).toMatch(/pp|beweging/);
      expect(t.herkomst.lesIds.length).toBeGreaterThan(0);
      expect(t.item).toMatchObject({ expect: { kind: "behaviour" }, generated: true });
    }
    // Contextdimensies hebben geen testgrammatica: eerlijk benoemd, niets verzonnen.
    expect(golf2.testGaten).toEqual(expect.arrayContaining(["contextResolution"]));
    // Vóór golf 2 geen extra items; erna wel, steeds dezelfde.
    expect(extra[0]).toEqual([]);
    expect(extra.at(-1)).toEqual(tests.map((t) => t.id));
  });

  it("specialist- en familiewissel: levert een golf niets op, dan wisselt de aanpak, en nieuwe interventieklassen komen erbij", async () => {
    const runId = "ZR-AANPAK";
    await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 360 }, wereld(runId), { nu: klok(5), productie: () => PROD, omgeving });
    const c = longRun.leesCheckpoint(runId)!;
    const golven = c.zoekruimte!.golven;
    expect(golven.length).toBeGreaterThan(2);
    expect(golven.filter((g) => g.aanleiding === "STAGNATIE").length).toBeGreaterThan(0);
    expect(new Set(golven.map((g) => g.aanpak)).size).toBeGreaterThan(1);
    expect(golven.slice(1).some((g) => g.aanpakGewisseld && /wissel naar/.test(g.aanpakReden))).toBe(true);
    const klassenStart = new Set(c.zoekruimte!.hypothesen.filter((h) => h.golf === 1).map((h) => h.familie));
    const klassenLater = new Set(c.zoekruimte!.hypothesen.filter((h) => h.golf > 1).map((h) => h.familie));
    expect([...klassenLater].some((k) => !klassenStart.has(k))).toBe(true);
    expect(c.cycli.some((x) => x.overgangen?.includes("NIEUWE_GOLF"))).toBe(true);
    expect(c.cycli.some((x) => x.overgangen?.includes("FAMILIE_GEWISSELD"))).toBe(true);
    // Begrensd: per golf niet meer dan het maximum, en nooit meer golven dan de grens.
    for (const g of golven) expect(g.hypothesen.length).toBeLessThanOrEqual(c.verkenning!.zoek!.maxHypothesenPerGolf + (g.nr === 1 ? 100 : 0));
    expect(golven.length).toBeLessThanOrEqual(c.verkenning!.zoek!.maxGolven);
    expect(c.zoekruimte!.tests.length).toBeLessThanOrEqual(c.verkenning!.zoek!.maxTestsTotaal);
  }, 60_000);
});

describe("verkennen vóór verdiepen", () => {
  it("een gemeten zwakte zonder poging komt in de volgorde vóór een al geprobeerde, ongeacht de aanpak", () => {
    const les = (dimensie: string, strategie: string): Les => ({ id: `L-${dimensie}-${strategie}`, at: "t", runId: "r", dimensie, strategie, kandidaatId: "k", verdict: "REJECT", beslissing: "REJECTED", redenen: [], deltaDoel: 30, adversarial: null, deltas: { [dimensie]: 30, falsePremiseCorrection: -50 } });
    const ls = [les("contextResolution", "REGEL"), les("contextResolution", "ZELFCONTROLE")];
    const analyse = ["contextResolution", "toolChoice", "grounding"].map((d) => zoek.analyseer(d, ls));
    for (const aanpak of zoek.AANPAKKEN) {
      const v = zoek.volgordeVoor(aanpak, analyse, { contextResolution: 10, toolChoice: 60, grounding: 50 });
      expect(v.indexOf("contextResolution"), aanpak).toBe(2);
      expect(v.slice(0, 2)).toEqual(["grounding", "toolChoice"]); // onderling: zwakste eerst
    }
  });
});

describe("semantische herhaling wordt geweigerd", () => {
  const les = (dimensie: string, strategie: string, verdict: Les["verdict"] = "REJECT", extra: Partial<Les> = {}): Les => ({
    id: `L-${dimensie}-${strategie}`, at: "t", runId: "r", dimensie, strategie, kandidaatId: "k", verdict, beslissing: "REJECTED", redenen: [], deltaDoel: 0, adversarial: null, ...extra,
  });

  it("dezelfde aanpak in een ander jasje (alleen nadruk, andere volgorde) is dezelfde aanpak", () => {
    expect(interventies.semantischeSleutel("NADRUK+ZELFCONTROLE")).toBe("ZELFCONTROLE");
    expect(interventies.sleutelVan({ operatoren: ["WAAROM", "VOORRANG"], bescherm: [] })).toBe(interventies.sleutelVan({ operatoren: ["VOORRANG", "WAAROM"], bescherm: [] }));
    // Het leergeheugen blokkeert de herverpakte variant van een verworpen aanpak.
    const s = lessons.stand("grounding", [les("grounding", "ZELFCONTROLE")], ["NADRUK+ZELFCONTROLE", "STAPPEN"]);
    expect(s.afgewezen.has("NADRUK+ZELFCONTROLE")).toBe(true);
    expect(lessons.kiesStrategie("grounding", [les("grounding", "ZELFCONTROLE")], ["NADRUK+ZELFCONTROLE", "STAPPEN"])?.waarde).toBe("STAPPEN");
  });

  it("de regisseur weigert duplicaten, al verworpen en herverpakte voorstellen — en legt die weigering vast", () => {
    const start = zoek.startGolf(["grounding"], generate.STRATEGIEEN, "t");
    const stand = { golven: [start.golf], hypothesen: start.hypothesen, tests: [] };
    const ls = generate.STRATEGIEEN.map((s) => les("grounding", s, "REJECT", { deltas: { grounding: 0, falsePremiseCorrection: -50 } }));
    const u = zoek.breidUit({
      nr: 2, op: "t", aanleiding: "POOL_UITGEPUT", naCyclus: 4, stand, lessen: ls, scores: { grounding: 50 }, dimensies: ["grounding"], vorigeGolfLeverdeOp: false,
      grenzen: { maxGolven: 10, maxHypothesenPerGolf: 50, maxTestsPerGolf: 4, maxTestsTotaal: 8, stagnatieVenster: 6 },
      tekst: (d, st) => generate.tekstVoorStrategie(d, st), maxTekens: 1200, bestaandeTestPrompts: [],
    });
    const redenen = new Set(u.golf.geweigerd.map((g) => g.reden));
    expect(redenen.has("AL_VERWORPEN")).toBe(true); // gericht voorstel ZELFCONTROLE/WAAROM: al verworpen
    expect(redenen.has("HERVERPAKT")).toBe(true); // mutatie: verworpen aanpak + nadruk
    const verworpenSem = new Set(generate.STRATEGIEEN.map((s) => interventies.semantischeSleutel(s)));
    for (const h of u.hypothesen) expect(verworpenSem.has(h.semantisch)).toBe(false);
    // Een tweede golf op dezelfde stand voegt geen semantische duplicaten toe.
    const stand2 = { golven: [...stand.golven, u.golf], hypothesen: [...stand.hypothesen, ...u.hypothesen], tests: [...u.tests] };
    const u2 = zoek.breidUit({ ...{ nr: 3, op: "t", aanleiding: "STAGNATIE" as const, naCyclus: 9, stand: stand2, lessen: ls, scores: { grounding: 50 }, dimensies: ["grounding"], vorigeGolfLeverdeOp: false }, grenzen: { maxGolven: 10, maxHypothesenPerGolf: 50, maxTestsPerGolf: 4, maxTestsTotaal: 8, stagnatieVenster: 6 }, tekst: (d, st) => generate.tekstVoorStrategie(d, st), maxTekens: 1200, bestaandeTestPrompts: [] });
    const eerder = new Set(stand2.hypothesen.map((h) => h.semantisch));
    for (const h of u2.hypothesen) expect(eerder.has(h.semantisch)).toBe(false);
    expect(u2.golf.geweigerd.some((g) => g.reden === "DUPLICAAT")).toBe(true);
  });

  it("komt een verworpen aanpak tóch terug in een ander jasje, dan telt de motor dat als herhaling (en boven de tolerantie: echte blocker)", async () => {
    let n = 0;
    const r = await longRun.draaiLongRun({ runId: "ZR-HERHAAL", profiel: "1h" }, {
      nu: klok(1),
      cyclus: async () => {
        n += 1;
        return { beslissing: "REJECTED", kandidaatId: `h${n}`, dimensie: "grounding", versieId: null, verdict: "REJECT", strategie: n === 1 ? "ZELFCONTROLE" : "NADRUK+ZELFCONTROLE" };
      },
    });
    expect(r.cycli[1].overgangen).toContain("HERHALING_GEBLOKKEERD");
    expect(r.stopReden).toBe("HERHAALDE_FOUT");
  });

  it("een gegenereerde test die op de holdout lijkt, wordt aan de meetkant geweigerd (de regisseur ziet de holdout nooit)", () => {
    const ls = [les("falsePremiseCorrection", "REGEL", "REJECT", { deltaDoel: -50, deltas: { falsePremiseCorrection: -50 } }), les("falsePremiseCorrection", "WAAROM", "REJECT", { deltaDoel: -50, deltas: { falsePremiseCorrection: -50 } })];
    const start = zoek.startGolf(["falsePremiseCorrection"], generate.STRATEGIEEN, "t");
    const basis = { nr: 2, op: "t", aanleiding: "STAGNATIE" as const, naCyclus: 2, stand: { golven: [start.golf], hypothesen: start.hypothesen, tests: [] }, lessen: ls, scores: { falsePremiseCorrection: 80 }, dimensies: ["falsePremiseCorrection"], vorigeGolfLeverdeOp: false, grenzen: { maxGolven: 10, maxHypothesenPerGolf: 4, maxTestsPerGolf: 4, maxTestsTotaal: 8, stagnatieVenster: 6 }, tekst: (d: string, st: string) => generate.tekstVoorStrategie(d, st), maxTekens: 1200, bestaandeTestPrompts: [] };
    expect(zoek.breidUit(basis).tests.length).toBeGreaterThan(0);
    expect(zoek.breidUit({ ...basis, testToegestaan: () => false }).tests).toEqual([]);
  });
});

describe("een echte capaciteitsgrens is een blocker met escalatie, nooit voltooiing", () => {
  it("elke gemeten zwakte wacht op een mens → CAPACITEIT_BLOKKADE met escalatie naar een mens; de verifier keurt af", async () => {
    const keep: Les = { id: "K1", at: "t", runId: "r", dimensie: "toolChoice", strategie: "REGEL", kandidaatId: "k", verdict: "KEEP", beslissing: "PROMOTION_CANDIDATE", redenen: [], deltaDoel: 20, adversarial: null };
    const r = await longRun.draaiLongRun({ runId: "ZR-MENS", profiel: "6h" }, {
      nu: klok(5),
      lessen: () => [keep],
      cyclus: async () => ({ beslissing: "UITGEPUT", kandidaatId: null, dimensie: null, versieId: null, verdict: null, scores: { toolChoice: 50 } }),
    });
    expect(r.status).toBe("STOPPED");
    expect(r.stopReden).toBe("CAPACITEIT_BLOKKADE");
    expect(r.gebeurtenissen.at(-1)?.tekst).toMatch(/menselijk besluit/);
    expect(controleerLangeRun(r as never, modelLog).status).toBe("FAIL");
  });

  it("de zoekgrens (maxGolven) is begrensd en wordt als capaciteitsgrens gemeld, niet als succes", async () => {
    const runId = "ZR-GRENS";
    const r = await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 360, zoek: { maxGolven: 2, stagnatieVenster: 1000 } }, wereld(runId, ["grounding"]), { nu: klok(5), productie: () => PROD, omgeving });
    const c = longRun.leesCheckpoint(runId)!;
    expect(c.zoekruimte!.golven.length).toBe(2);
    expect(c.stopReden).toBe("CAPACITEIT_BLOKKADE");
    expect(c.gebeurtenissen.at(-1)?.tekst).toMatch(/Zoekgrens bereikt/);
    expect(r.stopReason).toBe("CAPABILITY_BLOCKER");
    const v = controleerLangeRun(c as never, modelLog);
    expect(v.controles.find((x) => x.naam.startsWith("actief budget benut"))?.ok).toBe(false);
  });
});

describe("pauze, hervatten en crash over golven heen; het canonieke checkpoint bewaart alles", () => {
  it("pauze na golf 2 → hervatten behoudt golven, hypothesen, tests en lessen, en de run maakt verder nieuwe golven", async () => {
    const runId = "ZR-PAUZE";
    let gepauzeerd = false;
    const deps = wereld(runId, ZES, () => {
      const c = longRun.leesCheckpoint(runId);
      if (!gepauzeerd && c && c.zoekruimte!.golven.length >= 2) {
        gepauzeerd = true;
        longRun.vraagControle(runId, "PAUSE", "test");
      }
    });
    const kopieMap = path.join(tmpRoot, "canoniek", runId);
    const extras = { nu: klok(5), productie: () => PROD, omgeving, spiegel: (c: Parameters<typeof canoniek.schrijfCanoniekeKopie>[0]) => canoniek.schrijfCanoniekeKopie(c, kopieMap) };
    const p = await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 360, zoek: { stagnatieVenster: 1000 } }, deps, extras);
    expect(p.stopReason).toBe("PAUSED");
    const voor = longRun.leesCheckpoint(runId)!;
    expect(voor.fase).toBe("GEPAUZEERD");
    const golvenVoor = voor.zoekruimte!.golven.length;
    const r = await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 360 }, deps, extras);
    const na = longRun.leesCheckpoint(runId)!;
    expect(na.segmenten).toBe(2);
    expect(na.zoekruimte!.golven.slice(0, golvenVoor)).toEqual(voor.zoekruimte!.golven);
    expect(na.zoekruimte!.hypothesen.slice(0, voor.zoekruimte!.hypothesen.length)).toEqual(voor.zoekruimte!.hypothesen);
    expect(na.zoekruimte!.golven.length).toBeGreaterThan(golvenVoor);
    expect(r.stopReason).toBe("MAX_MINUTES_REACHED");
    // Het canonieke checkpoint: golven, hypothesen (met herkomst), weigeringen, tests, lessen en budget.
    const kopie = JSON.parse(readFileSync(path.join(kopieMap, "checkpoint.json"), "utf8"));
    expect(kopie).toEqual(na);
    expect(kopie.budgetMinuten).toBe(360);
    expect(kopie.verkenning.zoek.maxGolven).toBeGreaterThan(0);
    expect(kopie.zoekruimte.golven[1].geweigerd.length + kopie.zoekruimte.golven[1].hypothesen.length).toBeGreaterThan(0);
    expect(kopie.zoekruimte.golven[1].lesIds.length).toBeGreaterThan(0);
    expect(kopie.zoekruimte.hypothesen.at(-1).herkomst.reden).toBeTruthy();
    expect(kopie.cycli.every((x: { golf?: number }) => typeof x.golf === "number")).toBe(true);
    expect(controleerLangeRun(kopie, modelLog).status).toBe("PASS");
  }, 60_000);

  it("crash midden in een cyclus na golf 2 → hervatten met hetzelfde id gaat door met dezelfde zoekruimte", async () => {
    const runId = "ZR-CRASH";
    const bestandCp = path.join(tmpRoot, "data", "long-runs", runId, "checkpoint.json");
    const bestandLes = path.join(tmpRoot, "data", "learning", "lessons.jsonl");
    const snap = path.join(tmpRoot, "crash-snap");
    let genomen = false;
    // Momentopname van checkpoint én leergeheugen terwijl een cyclus loopt na golf 2: zo laat het proces de wereld achter als het nu wegvalt.
    const deps = wereld(runId, ZES, () => {
      const c = longRun.leesCheckpoint(runId);
      if (!genomen && c && c.zoekruimte!.golven.length >= 2 && c.status === "RUNNING") {
        genomen = true;
        copyFileSync(bestandCp, `${snap}.cp`);
        copyFileSync(bestandLes, `${snap}.les`);
      }
    });
    await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 360, zoek: { stagnatieVenster: 1000 } }, deps, { nu: klok(15), productie: () => PROD, omgeving });
    expect(genomen).toBe(true);
    writeFileSync(bestandCp, readFileSync(`${snap}.cp`));
    writeFileSync(bestandLes, readFileSync(`${snap}.les`));
    const gecrasht = longRun.leesCheckpoint(runId)!;
    expect(gecrasht.status).toBe("RUNNING");
    expect(gecrasht.wachtrij.jobs.some((j) => j.status === "RUNNING")).toBe(true);
    const r = await autoRun.runAutonomousDevelopmentRun({ runId, maxMinutes: 360 }, deps, { nu: klok(15), productie: () => PROD, omgeving });
    const na = longRun.leesCheckpoint(runId)!;
    expect(na.runId).toBe(runId);
    expect(na.segmenten).toBe(2);
    expect(na.zoekruimte!.golven.slice(0, gecrasht.zoekruimte!.golven.length)).toEqual(gecrasht.zoekruimte!.golven);
    // De onderbroken cyclus is opnieuw ingepland (zelfde idempotentiesleutel), niet dubbel.
    const sleutel = `${runId}:cyclus:${gecrasht.cycli.length + 1}`;
    expect(na.wachtrij.jobs.filter((j) => j.idempotentieSleutel === sleutel)).toHaveLength(1);
    expect(r.stopReason).toBe("MAX_MINUTES_REACHED");
    expect(existsSync(bestandCp)).toBe(true);
  }, 60_000);
});
