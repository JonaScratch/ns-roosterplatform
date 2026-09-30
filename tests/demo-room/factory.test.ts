import { rmSync } from "node:fs";
import { DATA_DIR } from "../../demo-room/src/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Vóór elke import: manifest.ts laadt config.ts, en DATA_DIR wordt bij het
// laden vastgelegd. Zonder dit schreef de test in de echte demo-room/data.
const tmpRoot = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const d = mkdtempSync(join(tmpdir(), "demo-room-factory-test-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = d;
  return d;
});
import { arena } from "../../demo-room/src/factory/arena";
import { JUDGE_CRITERIA, oordeel, type JudgeEvidence } from "../../demo-room/src/factory/judge";
import { controleerIsolatie, detecteerLekkage, holdoutHash, judgeCriteriaHash, maakManifest, sha256 } from "../../demo-room/src/factory/manifest";
import { front, leegArchief, voegToeAanArchief } from "../../demo-room/src/factory/paretoArchive";
import { claim, hartslag, LEASE_MS, leeg, nieuwBudget, onderhoud, planIn, registreerWorker, reserveer, rondAf, verrekenen, vrijBudget, WORKER_TIMEOUT_MS } from "../../demo-room/src/factory/workers";

/**
 * Phase K–O: Candidate Factory (manifest/isolatie/lekdetectie), Independent
 * Judge, Pareto-archief, Roster Arena, JobQueue/Workers/Budget en hervatbare
 * lange runs. Pure logica direct; opslag en lange runs in een geïsoleerde
 * staatmap (`DEMO_ROOM_STATE_ROOT_OVERRIDE`).
 */

const manifest = (tekst: string | null = "Noem bij een nachtreeks altijd de lengte.") =>
  maakManifest({
    candidateId: "cand-1",
    parentVersionId: "v0",
    generator: { name: "test", version: "1" },
    hypothesis: "h",
    changeKind: "PROMPT",
    productionText: tekst,
    weaknessDimension: "toolChoice",
    sandboxRoot: "/tmp/sandbox",
    now: "2026-09-29T00:00:00.000Z",
  });
const huidig = (tekst: string | null = "Noem bij een nachtreeks altijd de lengte.") => ({ judgeCriteriaHash: judgeCriteriaHash(), holdoutHash: holdoutHash(), productionText: tekst });
const intact = { intact: true, bevindingen: [] };

function bewijs(
  over: Partial<Record<string, { basis: number[]; kandidaat: number[] }>> = {},
  holdout: JudgeEvidence["holdout"] = { basis: 70, kandidaat: 70 },
  adversarial: JudgeEvidence["adversarial"] = { basis: 78, kandidaat: 78 },
): JudgeEvidence {
  return {
    doelDimensie: "toolChoice",
    holdout,
    adversarial,
    dimensies: {
      toolChoice: { basis: [60], kandidaat: [70, 72] },
      grounding: { basis: [90], kandidaat: [90, 90] },
      machinistTaal: { basis: [80], kandidaat: [80, 79] },
      ...over,
    } as JudgeEvidence["dimensies"],
  };
}

describe("Phase K — manifest en isolatie", () => {
  it("legt tekst-, criteria- en holdouthash vast", () => {
    const m = manifest();
    expect(m.productionTextSha256).toBe(sha256("Noem bij een nachtreeks altijd de lengte."));
    expect(m.isolation.judgeCriteriaHash).toBe(judgeCriteriaHash());
    expect(m.isolation.holdoutHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.inputs.devOnly).toBe(true);
  });

  it("intact bij ongewijzigde omgeving", () => {
    expect(controleerIsolatie(manifest(), huidig())).toEqual({ intact: true, bevindingen: [] });
  });

  it("ziet een gewijzigde meetlat, holdout of kandidaattekst", () => {
    const m = manifest();
    const zachtereCriteria = judgeCriteriaHash({ ...JUDGE_CRITERIA, verbetermarge: 0 });
    expect(controleerIsolatie(m, { ...huidig(), judgeCriteriaHash: zachtereCriteria }).bevindingen.join()).toMatch(/criteria/);
    expect(controleerIsolatie(m, { ...huidig(), holdoutHash: "x" }).bevindingen.join()).toMatch(/holdout/);
    expect(controleerIsolatie(m, huidig("Andere tekst")).bevindingen.join()).toMatch(/kandidaattekst/);
  });

  it("de criteria zijn bevroren", () => {
    expect(Object.isFrozen(JUDGE_CRITERIA)).toBe(true);
  });
});

describe("Phase K — lekdetectie", () => {
  // Synthetisch: nooit echte holdouttekst in code of tests.
  const holdout = ["Men vertelde mij dat het Zeta-rooster in vroegere jaren officieel 'Ochtend-Avond-Zeta' werd genoemd. Is dat juist?"];
  it("vangt een letterlijk overgeschreven stuk holdoutvraag", () => {
    expect(detecteerLekkage("Als iemand zegt: men vertelde mij dat het zeta-rooster in vroegere jaren officieel ochtend-avond-zeta werd genoemd, antwoord dan ...", holdout)).toHaveLength(1);
  });
  it("geen vals alarm op een algemene regel over hetzelfde onderwerp", () => {
    expect(detecteerLekkage("Bevestig een beweerde oude profielnaam alleen met een bron.", holdout)).toEqual([]);
    expect(detecteerLekkage(null, holdout)).toEqual([]);
  });
});

describe("Phase L — Independent Judge", () => {
  const m = manifest();
  it("KEEP bij verbetering boven de marge, zonder regressie, met holdout en ≥2 replicaten", () => {
    const o = oordeel(m, intact, [], bewijs());
    expect(o.verdict).toBe("KEEP");
    expect(o.deltas.toolChoice).toBeCloseTo(11);
  });
  it("REJECT bij geschonden isolatie, ongeacht de scores", () => {
    expect(oordeel(m, { intact: false, bevindingen: ["x"] }, [], bewijs()).verdict).toBe("REJECT");
  });
  it("REJECT bij holdoutlek", () => {
    expect(oordeel(m, intact, ["stuk"], bewijs()).verdict).toBe("REJECT");
  });
  it("REJECT bij elke daling op een veiligheidsdimensie (geen marge)", () => {
    const o = oordeel(m, intact, [], bewijs({ grounding: { basis: [90], kandidaat: [89, 89] } }));
    expect(o.verdict).toBe("REJECT");
    expect(o.redenen.join()).toMatch(/veiligheidsdimensie grounding/);
  });
  it("REJECT bij regressie groter dan de marge; binnen de marge niet", () => {
    expect(oordeel(m, intact, [], bewijs({ machinistTaal: { basis: [80], kandidaat: [70, 70] } })).verdict).toBe("REJECT");
    expect(oordeel(m, intact, [], bewijs({ machinistTaal: { basis: [80], kandidaat: [78, 78] } })).verdict).toBe("KEEP");
  });
  it("REJECT bij een holdout die meer dan de marge zakt", () => {
    expect(oordeel(m, intact, [], bewijs({}, { basis: 80, kandidaat: 70 })).verdict).toBe("REJECT");
  });
  it("NEEDS_MORE_EVIDENCE: doel niet gemeten, één replicaat, geen holdout, of winst binnen de ruis", () => {
    expect(oordeel(m, intact, [], { ...bewijs(), doelDimensie: "contextResolution" }).verdict).toBe("NEEDS_MORE_EVIDENCE");
    expect(oordeel(m, intact, [], bewijs({ toolChoice: { basis: [60], kandidaat: [75] }, grounding: { basis: [90], kandidaat: [90] }, machinistTaal: { basis: [80], kandidaat: [80] } })).verdict).toBe("NEEDS_MORE_EVIDENCE");
    expect(oordeel(m, intact, [], bewijs({}, null)).verdict).toBe("NEEDS_MORE_EVIDENCE");
    expect(oordeel(m, intact, [], bewijs({ toolChoice: { basis: [60], kandidaat: [61, 62] } })).verdict).toBe("NEEDS_MORE_EVIDENCE");
  });
  it("judge/2: elke daling op de adversarial holdout is REJECT; zonder adversarial meting geen KEEP", () => {
    const daling = oordeel(m, intact, [], bewijs({}, undefined, { basis: 78, kandidaat: 67 }));
    expect(daling.verdict).toBe("REJECT");
    expect(daling.redenen.join()).toMatch(/adversarial holdout daalt/);
    const zonder = oordeel(m, intact, [], bewijs({}, undefined, null));
    expect(zonder.verdict).toBe("NEEDS_MORE_EVIDENCE");
    expect(zonder.redenen.join()).toMatch(/adversarial holdout niet gemeten/);
    expect(oordeel(m, intact, [], bewijs({}, undefined, { basis: 67, kandidaat: 78 })).verdict).toBe("KEEP");
    expect(JUDGE_CRITERIA.versie).toBe("judge/2");
  });
  it("REJECT als het doel niet verbetert", () => {
    expect(oordeel(m, intact, [], bewijs({ toolChoice: { basis: [60], kandidaat: [58, 60] } })).verdict).toBe("REJECT");
  });
});

describe("Phase L — Pareto-archief", () => {
  const richting = { a: true, b: true, c: null };
  it("houdt niet-gedomineerde punten allebei op het front en markeert gedomineerde", () => {
    let arch = leegArchief(richting);
    arch = voegToeAanArchief(arch, { id: "x", label: "x", metrics: { a: 1, b: 0, c: 5 } }, "t1");
    arch = voegToeAanArchief(arch, { id: "y", label: "y", metrics: { a: 0, b: 1, c: 0 } }, "t2");
    arch = voegToeAanArchief(arch, { id: "z", label: "z", metrics: { a: 0, b: 0.5, c: 9 } }, "t3");
    expect(front(arch).map((p) => p.id).sort()).toEqual(["x", "y"]);
    expect(arch.items.find((i) => i.punt.id === "z")?.gedomineerdDoor).toEqual(["y"]);
    expect(arch.items).toHaveLength(3);
  });
  it("is idempotent per id", () => {
    const p = { id: "x", label: "x", metrics: { a: 1, b: 1 } };
    const arch = voegToeAanArchief(voegToeAanArchief(leegArchief(richting), p, "t1"), p, "t2");
    expect(arch.items).toHaveLength(1);
  });
});

describe("Phase M — Roster Arena", () => {
  it("rangschikt de consequente winnaar bovenaan", () => {
    const opgaven = ["o1", "o2", "o3", "o4"];
    const u = opgaven.flatMap((o, i) => [
      { kandidaat: "A", opgave: o, score: 0.9 },
      { kandidaat: "B", opgave: o, score: 0.6 + i * 0.01 },
      { kandidaat: "C", opgave: o, score: 0.3 },
    ]);
    const r = arena(u);
    expect(r.map((x) => x.kandidaat)).toEqual(["A", "B", "C"]);
    expect(r[0].gewonnen).toBe(8);
    expect(r[2].verloren).toBe(8);
  });
  it("een ontbrekende opgave is geen verlies; gelijk binnen de ruismarge", () => {
    const r = arena([
      { kandidaat: "A", opgave: "o1", score: 0.8 },
      { kandidaat: "B", opgave: "o1", score: 0.81 },
      { kandidaat: "A", opgave: "o2", score: 0.8 },
    ]);
    const a = r.find((x) => x.kandidaat === "A")!;
    const b = r.find((x) => x.kandidaat === "B")!;
    expect(a.gelijk).toBe(1);
    expect(b.gelijk).toBe(1);
    expect(a.verloren + b.verloren).toBe(0);
    expect(a.sterkte).toBeCloseTo(b.sterkte, 5);
    expect(a.beslissend).toBe(0);
  });
});

describe("Phase N — JobQueue, workers en budget", () => {
  const job = (id: string, prioriteit = 1, vereist: string[] = ["cyclus"], minuten = 10) => ({ id, soort: "cyclus", idempotentieSleutel: id, prioriteit, vereist, maxPogingen: 2, budget: { minuten, modelCalls: 0 } });

  it("plant dezelfde idempotentiesleutel niet twee keer in", () => {
    const q = planIn(planIn(leeg(), job("j1")), job("j1"));
    expect(q.jobs).toHaveLength(1);
  });

  it("claimt op prioriteit en alleen wat de worker kan", () => {
    let q = registreerWorker(leeg(), "w", ["cyclus"], 0);
    q = planIn(q, job("laag", 1));
    q = planIn(q, job("hoog", 5));
    q = planIn(q, job("gpu", 9, ["gpu"]));
    const r = claim(q, "w", 0, nieuwBudget(100, 100));
    expect(r.job?.id).toBe("hoog");
    expect(r.job?.lease?.tot).toBe(LEASE_MS);
  });

  it("een dode worker verliest zijn job; na maxPogingen faalt die met reden", () => {
    let q = planIn(registreerWorker(leeg(), "w", ["cyclus"], 0), job("j"));
    let b = nieuwBudget(100, 100);
    ({ q, budget: b } = claim(q, "w", 0, b));
    q = onderhoud(q, WORKER_TIMEOUT_MS + 1);
    expect(q.workers).toHaveLength(0);
    expect(q.jobs[0].status).toBe("QUEUED");
    q = registreerWorker(q, "w2", ["cyclus"], WORKER_TIMEOUT_MS + 2);
    ({ q } = claim(q, "w2", WORKER_TIMEOUT_MS + 2, nieuwBudget(100, 100)));
    expect(q.jobs[0].pogingen).toBe(2);
    q = onderhoud(q, WORKER_TIMEOUT_MS * 3 + 10);
    expect(q.jobs[0].status).toBe("FAILED");
    expect(q.jobs[0].reden).toMatch(/2\/2 pogingen/);
  });

  it("hartslag verlengt de lease", () => {
    let q = planIn(registreerWorker(leeg(), "w", ["cyclus"], 0), job("j"));
    ({ q } = claim(q, "w", 0, nieuwBudget(100, 100)));
    q = hartslag(q, "w", 60_000);
    expect(q.jobs[0].lease?.tot).toBe(60_000 + LEASE_MS);
    expect(onderhoud(q, 90_000).jobs[0].status).toBe("RUNNING");
    expect(rondAf(q, "j", "DONE").jobs[0]).toMatchObject({ status: "DONE", lease: null });
  });

  it("reserveert vóór het werk, rekent af op werkelijk verbruik, weigert bij tekort", () => {
    let b = nieuwBudget(30, 5);
    const r1 = reserveer(b, "a", { minuten: 20, modelCalls: 2 });
    expect(r1.ok).toBe(true);
    b = r1.budget;
    expect(reserveer(b, "b", { minuten: 20, modelCalls: 1 }).ok).toBe(false);
    b = verrekenen(b, "a", { minuten: 12, modelCalls: 2 });
    expect(vrijBudget(b)).toEqual({ minuten: 18, modelCalls: 3 });
    expect(reserveer(b, "b", { minuten: 18, modelCalls: 1 }).ok).toBe(true);
  });

  it("een job waarvoor geen budget is, wordt niet geclaimd", () => {
    const q = planIn(registreerWorker(leeg(), "w", ["cyclus"], 0), job("duur", 1, ["cyclus"], 500));
    expect(claim(q, "w", 0, nieuwBudget(60, 10)).job).toBeNull();
  });
});

describe("Phase K/L/O — opslag en hervatbare lange runs", () => {
  let store: typeof import("../../demo-room/src/factory/store");
  let longRun: typeof import("../../demo-room/src/factory/longRun");

  beforeAll(async () => {
    expect(DATA_DIR.startsWith(tmpRoot)).toBe(true);
    store = await import("../../demo-room/src/factory/store");
    longRun = await import("../../demo-room/src/factory/longRun");
  });
  afterAll(() => {
    delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("een manifest wordt nooit overschreven; het oordeel komt ernaast", () => {
    const m = { ...manifest(), candidateId: "cand-store", isolation: { ...manifest().isolation, sandboxRoot: store.sandboxVoor("cand-store") } };
    store.bewaarManifest(m);
    expect(() => store.bewaarManifest(m)).toThrow(store.ManifestBestaatAl);
    const o = store.beoordeelEnBewaar("cand-store", "Noem bij een nachtreeks altijd de lengte.", bewijs(), "2026-09-29T01:00:00.000Z");
    expect(o.verdict).toBe("KEEP");
    expect(store.leesOordeel("cand-store")?.verdict).toBe("KEEP");
    expect(store.lijstKandidaten().map((k) => k.manifest.candidateId)).toContain("cand-store");
    // Tekst gewijzigd na het manifest → REJECT.
    expect(store.beoordeelEnBewaar("cand-store", "iets anders", bewijs(), "t").verdict).toBe("REJECT");
  });

  it("zonder manifest geen oordeel", () => {
    expect(() => store.beoordeelEnBewaar("bestaat-niet", null, bewijs(), "t")).toThrow(/geen manifest/);
  });

  it("alleen KEEP komt in het Pareto-archief", () => {
    const richting = { toolChoice: true };
    expect(store.archiveerKeep({ id: "r", label: "r", metrics: { toolChoice: 1 } }, { verdict: "REJECT", redenen: [], criteriaVersie: "judge/1", deltas: {} }, richting, "t")).toBeNull();
    expect(store.archiveerKeep({ id: "k", label: "k", metrics: { toolChoice: 1 } }, { verdict: "KEEP", redenen: [], criteriaVersie: "judge/1", deltas: {} }, richting, "t")?.items).toHaveLength(1);
  });

  function klok(stapMs: number) {
    let t = Date.parse("2026-09-29T00:00:00.000Z");
    return () => (t += stapMs);
  }
  const verworpen = (dim: string) => async () => ({ beslissing: "REJECTED", kandidaatId: `k-${Math.random().toString(36).slice(2, 8)}`, dimensie: dim, versieId: null, verdict: "REJECT" });

  it("stopt als het actieve budget op is en telt alleen cyclustijd", async () => {
    let i = 0;
    const dims = ["a", "b", "c", "d", "e", "f"];
    const r = await longRun.draaiLongRun({ runId: "LR-budget", profiel: "1h" }, { nu: klok(10 * 60_000), cyclus: async () => verworpen(dims[i++ % dims.length])() });
    expect(r.status).toBe("DONE");
    expect(r.stopReden).toBe("BUDGET_OP");
    expect(r.actieveMs).toBe(r.cycli.length * 10 * 60_000);
    expect(r.cycli.length).toBe(6);
  });

  it("pauzeren en hervatten: gepauzeerde tijd telt niet, cycli gaan door waar ze waren", async () => {
    const nu = klok(5 * 60_000);
    let n = 0;
    const cyclus = async () => {
      n += 1;
      if (n === 2) longRun.vraagControle("LR-pauze", "PAUSE", "planner");
      return { beslissing: "KEEP_TESTING", kandidaatId: `k${n}`, dimensie: `d${n}`, versieId: null, verdict: "NEEDS_MORE_EVIDENCE" };
    };
    const p = await longRun.draaiLongRun({ runId: "LR-pauze", profiel: "6h" }, { nu, cyclus });
    expect(p.status).toBe("PAUSED");
    expect(p.cycli).toHaveLength(2);
    const actiefBijPauze = p.actieveMs;
    // Uren later hervat: die uren tellen niet mee.
    for (let i = 0; i < 100; i += 1) nu();
    const nuVoorHervatten = n;
    const h = await longRun.draaiLongRun({ runId: "LR-pauze", profiel: "6h" }, { nu, cyclus: async () => {
      n += 1;
      if (n === nuVoorHervatten + 1) longRun.vraagControle("LR-pauze", "PAUSE", "planner");
      return { beslissing: "KEEP_TESTING", kandidaatId: `k${n}`, dimensie: `d${n}`, versieId: null, verdict: null };
    } });
    expect(h.status).toBe("PAUSED");
    expect(h.segmenten).toBe(2);
    expect(h.cycli).toHaveLength(3);
    // Alleen de ene extra cyclus telt; de 100 stappen pauze niet.
    expect(h.actieveMs).toBe(actiefBijPauze + 5 * 60_000);
    // Stoppen tijdens een pauze werkt meteen, zonder proces.
    longRun.vraagControle("LR-pauze", "STOP", "planner");
    const s = longRun.leesCheckpoint("LR-pauze")!;
    expect(s.status).toBe("STOPPED");
    expect(s.stopReden).toBe("HANDMATIG_GESTOPT");
    expect(s.uitgeslotenKandidaten).toEqual(["k1", "k2", "k3"]);
    // Een gestopte run start niet opnieuw.
    const nogmaals = await longRun.draaiLongRun({ runId: "LR-pauze", profiel: "6h" }, { nu, cyclus });
    expect(nogmaals.cycli).toHaveLength(3);
  });

  it("herstelt na een crash: de lopende cyclus wordt opnieuw ingepland, niet dubbel", async () => {
    const nu = klok(60_000);
    let n = 0;
    // Segment 1: cyclus 2 hangt voor altijd — het proces "sterft" midden in de cyclus.
    void longRun.draaiLongRun({ runId: "LR-crash", profiel: "24h" }, {
      nu,
      cyclus: async () => {
        n += 1;
        if (n === 2) return new Promise<never>(() => {});
        return { beslissing: "KEEP_TESTING", kandidaatId: `k${n}`, dimensie: `d${n}`, versieId: null, verdict: null };
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const gecrasht = longRun.leesCheckpoint("LR-crash")!;
    expect(gecrasht.status).toBe("RUNNING");
    expect(gecrasht.cycli).toHaveLength(1);
    expect(gecrasht.wachtrij.jobs.find((j) => j.status === "RUNNING")?.id).toBe("LR-crash-c2");

    // Segment 2: een nieuw proces hervat. Cyclus 2 gaat opnieuw (poging 2), niet dubbel ingepland.
    let m = 0;
    const r = await longRun.draaiLongRun({ runId: "LR-crash", profiel: "24h" }, {
      nu,
      cyclus: async () => {
        m += 1;
        if (m === 2) longRun.vraagControle("LR-crash", "PAUSE", "test");
        return { beslissing: "KEEP_TESTING", kandidaatId: `h${m}`, dimensie: `e${m}`, versieId: null, verdict: null };
      },
    });
    expect(r.status).toBe("PAUSED");
    expect(r.segmenten).toBe(2);
    expect(r.wachtrij.jobs.filter((j) => j.idempotentieSleutel === "LR-crash:cyclus:2")).toHaveLength(1);
    const c2 = r.wachtrij.jobs.find((j) => j.id === "LR-crash-c2")!;
    expect(c2.status).toBe("DONE");
    expect(c2.pogingen).toBe(2);
    expect(r.cycli[1].kandidaatId).toBe("h1");
  });

  it("lokale uitputting stopt de run niet (incident DR-UI-202609301449): de zwakte wordt uitgesloten en de run gaat door", async () => {
    // Een cyclus die de run-uitsluitingen respecteert, zoals developmentCycle via lessons.ts.
    const dims = ["toolChoice", "grounding"];
    let k = 0;
    const g = await longRun.draaiLongRun({ runId: "LR-stuck", profiel: "24h", maxPogingenPerDimensie: 2 }, {
      nu: klok(60_000),
      cyclus: async ({ runUitsluitingen }) => {
        const open = dims.filter((d) => !runUitsluitingen.dimensies.includes(d));
        if (open.length === 0) return { beslissing: "UITGEPUT", kandidaatId: null, dimensie: null, versieId: null, verdict: null };
        k += 1;
        return { beslissing: "REJECTED", kandidaatId: `s${k}`, dimensie: open[0], versieId: null, verdict: "REJECT" };
      },
    });
    // Twee keer verworpen op toolChoice → lokaal uitgeput, dóór naar grounding, pas daarna globaal uitgeput.
    expect(g.stopReden).toBe("ALLES_GEPROBEERD");
    expect(g.cycli).toHaveLength(5);
    expect(g.uitgeslotenDimensies).toEqual(dims);
    expect(g.cycli[2].dimensie).toBe("grounding");
    expect(g.cycli[2].overgangen).toContain("ZWAKTE_GEWISSELD");
    expect(g.gebeurtenissen.map((e) => e.tekst).join("\n")).toMatch(/Lokaal uitgeput: toolChoice 2x zonder promotie; de run gaat verder/);
    expect(g.fase).toBe("GLOBAAL_UITGEPUT");
    // Meldt de cyclus zelf dat alles geprobeerd is, dan stopt de run daarop.
    let n = 0;
    const u = await longRun.draaiLongRun({ runId: "LR-uitgeput", profiel: "24h" }, {
      nu: klok(60_000),
      cyclus: async () => {
        n += 1;
        return n < 3
          ? { beslissing: "REJECTED", kandidaatId: `u${n}`, dimensie: `d${n}`, versieId: null, verdict: "REJECT" }
          : { beslissing: "UITGEPUT", kandidaatId: null, dimensie: null, versieId: null, verdict: null };
      },
    });
    expect(u.stopReden).toBe("ALLES_GEPROBEERD");
    expect(u.cycli).toHaveLength(3);
    const d = await longRun.draaiLongRun({ runId: "LR-nodiag", profiel: "1h" }, { nu: klok(60_000), cyclus: async () => ({ beslissing: "NOT_EXECUTED", kandidaatId: null, dimensie: null, versieId: null, verdict: null }) });
    expect(d.stopReden).toBe("GEEN_DIAGNOSE");
  });

  it("een cyclus die blijft falen stopt de run na maxPogingen, met reden", async () => {
    const r = await longRun.draaiLongRun({ runId: "LR-fout", profiel: "1h" }, { nu: klok(60_000), cyclus: async () => { throw new Error("Ollama onbereikbaar"); } });
    expect(r.status).toBe("STOPPED");
    expect(r.stopReden).toBe("HERHAALDE_FOUT");
    expect(r.gebeurtenissen.map((g) => g.tekst).join("\n")).toMatch(/Ollama onbereikbaar/);
    expect(r.cycli).toHaveLength(0);
  });
});
