import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentQualityCategory, DualQualityMeasurement, ProofOfValueResult, RosterQualityCategory } from "../../demo-room/src/types";
import { controleerLangeRun } from "../../scripts/lyra-master/verify-long-run";

/**
 * De canonieke lange run (incident DR-UI-202609301449): één motor voor UI,
 * CLI en verifier; lokaal mislukken leidt tot een andere strategie of zwakte,
 * niet tot het einde van de run; verkenningsbudget per profiel; hervatten
 * behoudt alle toestand; een run die vanuit de UI start, is direct te
 * verifiëren.
 */

let tmpRoot: string;
let longRun: typeof import("../../demo-room/src/factory/longRun");
let autoRun: typeof import("../../demo-room/src/develop/autonomousDevelopmentRun");
let generate: typeof import("../../demo-room/src/develop/generateCandidate");
let lessons: typeof import("../../demo-room/src/develop/lessons");
let canoniek: typeof import("../../demo-room/src/factory/canoniek");

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "demo-room-longrun-canon-"));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmpRoot;
  longRun = await import("../../demo-room/src/factory/longRun");
  autoRun = await import("../../demo-room/src/develop/autonomousDevelopmentRun");
  generate = await import("../../demo-room/src/develop/generateCandidate");
  lessons = await import("../../demo-room/src/develop/lessons");
  canoniek = await import("../../demo-room/src/factory/canoniek");
});
beforeEach(() => rmSync(path.join(tmpRoot, "data", "learning"), { recursive: true, force: true }));
afterAll(() => {
  delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function klok(stapMs: number) {
  let t = Date.parse("2026-09-30T12:00:00.000Z");
  return () => (t += stapMs);
}

describe("verkenningsbudget per profiel", () => {
  it("pogingen per zwakte = strategieën × MAX_ONBESLIST: meer kan het leergeheugen zelf nooit vragen", () => {
    expect(longRun.STRATEGIE_POGINGEN).toBe(generate.STRATEGIEEN.length * lessons.MAX_ONBESLIST);
  });
  it("1h < 6h < 24h in maxCycli en herhalingstolerantie; aangepast schaalt met de minuten", () => {
    const [a, b, c] = (["1h", "6h", "24h"] as const).map((p) => longRun.verkenningVoor(p));
    expect(a.maxCycli).toBeLessThan(b.maxCycli);
    expect(b.maxCycli).toBeLessThan(c.maxCycli);
    expect(a.herhalingsTolerantie).toBeLessThanOrEqual(b.herhalingsTolerantie);
    expect(b.herhalingsTolerantie).toBeLessThanOrEqual(c.herhalingsTolerantie);
    expect(longRun.verkenningVoor("aangepast", 30).maxCycli).toBeLessThan(longRun.verkenningVoor("aangepast", 600).maxCycli);
  });
  it("de kaartjes 1/6/24 uur worden de profielen, iets anders 'aangepast', oneindig 'handmatig'", () => {
    expect(longRun.profielVoorMinuten(360)).toEqual({ profiel: "6h", minuten: null });
    expect(longRun.profielVoorMinuten(60)).toEqual({ profiel: "1h", minuten: null });
    expect(longRun.profielVoorMinuten(90)).toEqual({ profiel: "aangepast", minuten: 90 });
    expect(longRun.profielVoorMinuten(Number.POSITIVE_INFINITY)).toEqual({ profiel: "handmatig", minuten: null });
  });
});

describe("lokaal mislukken ≠ run stoppen", () => {
  it("een verworpen paar wordt geblokkeerd en gaat mee naar de volgende cyclus; die kiest een andere strategie", async () => {
    const gezien: { paren: readonly { dimensie: string; strategie: string }[] }[] = [];
    const strategieen = ["REGEL", "ZELFCONTROLE", "WAAROM"];
    let n = 0;
    const r = await longRun.draaiLongRun({ runId: "CAN-blok", profiel: "6h" }, {
      nu: klok(60_000),
      cyclus: async ({ runUitsluitingen }) => {
        gezien.push({ paren: runUitsluitingen.paren });
        const vrij = strategieen.filter((s) => !runUitsluitingen.paren.some((p) => p.strategie === s));
        if (vrij.length === 0) return { beslissing: "UITGEPUT", kandidaatId: null, dimensie: null, versieId: null, verdict: null };
        n += 1;
        return { beslissing: "REJECTED", kandidaatId: `b${n}`, dimensie: "contextResolution", versieId: null, verdict: "REJECT", strategie: vrij[0] };
      },
    });
    expect(gezien[1].paren).toEqual([{ dimensie: "contextResolution", strategie: "REGEL" }]);
    expect(r.cycli.slice(0, 3).map((c) => c.strategie)).toEqual(strategieen);
    expect(r.cycli[1].overgangen).toContain("STRATEGIE_GEWISSELD");
    // Twee rejects op dezelfde zwakte beëindigden de 6h-run niet. Na de derde is
    // de startruimte op; deze nepcyclus schrijft geen lessen, dus de regisseur
    // heeft geen bewijs om iets nieuws op te bouwen: een eerlijke capaciteitsgrens
    // met escalatie — geen succes, geen "alles geprobeerd".
    expect(r.stopReden).toBe("CAPACITEIT_BLOKKADE");
    expect(r.status).toBe("STOPPED");
    expect(r.fase).toBe("CAPACITEIT_BLOKKADE");
    expect(r.gebeurtenissen.at(-1)?.tekst).toMatch(/escaleer naar Claude\/mens/);
  });

  it("komt een al verworpen paar toch terug (les genegeerd), dan telt dat als herhaling; boven de tolerantie een echte blocker", async () => {
    const r = await longRun.draaiLongRun({ runId: "CAN-herhaal", profiel: "1h" }, {
      nu: klok(1_000),
      cyclus: async () => ({ beslissing: "REJECTED", kandidaatId: `h${Math.random()}`, dimensie: "grounding", versieId: null, verdict: "REJECT", strategie: "REGEL" }),
    });
    const tol = longRun.verkenningVoor("1h").herhalingsTolerantie;
    expect(r.stopReden).toBe("HERHAALDE_FOUT");
    expect(r.fase).toBe("FOUT_BLOKKADE");
    expect(r.herhalingen).toBe(tol + 1);
    expect(r.cycli.at(-1)?.overgangen).toContain("HERHALING_GEBLOKKEERD");
  });

  it("ALLES_GEPROBEERD alleen als de cyclus globale uitputting meldt — niet door lokale uitputting", async () => {
    let n = 0;
    const r = await longRun.draaiLongRun({ runId: "CAN-lokaal", profiel: "6h", maxPogingenPerDimensie: 1, maxCycli: 8 }, {
      nu: klok(60_000),
      // Negeert de uitsluitingen expres niet, maar er zijn steeds nieuwe zwaktes: nooit globaal uitgeput.
      cyclus: async () => {
        n += 1;
        return { beslissing: "REJECTED", kandidaatId: `l${n}`, dimensie: `d${n}`, versieId: null, verdict: "REJECT", strategie: "REGEL" };
      },
    });
    expect(r.uitgeslotenDimensies?.length).toBe(8);
    expect(r.stopReden).toBe("MAX_CYCLI");
  });
});

describe("pauze, hervatten en crash behouden de toestand", () => {
  it("uitgesloten zwaktes, geblokkeerde paren, verkenningsbudget en segmenten blijven over pauze en hervatting heen", async () => {
    let n = 0;
    const cyclus = async ({ runUitsluitingen }: { runUitsluitingen: { dimensies: readonly string[] } }) => {
      n += 1;
      if (n === 3) longRun.vraagControle("CAN-pauze", "PAUSE", "test");
      const dim = runUitsluitingen.dimensies.includes("a") ? "b" : "a";
      return { beslissing: "REJECTED", kandidaatId: `p${n}`, dimensie: dim, versieId: null, verdict: "REJECT", strategie: `S${n}` };
    };
    const p = await longRun.draaiLongRun({ runId: "CAN-pauze", profiel: "6h", maxPogingenPerDimensie: 2 }, { nu: klok(60_000), cyclus, omgeving: () => ({ commit: "abc" }) });
    expect(p.status).toBe("PAUSED");
    expect(p.fase).toBe("GEPAUZEERD");
    expect(p.uitgeslotenDimensies).toEqual(["a"]);
    const voor = { paren: p.geblokkeerdeParen, verkenning: p.verkenning };
    let m = 0;
    const h = await longRun.draaiLongRun({ runId: "CAN-pauze", profiel: "6h" }, {
      nu: klok(60_000),
      omgeving: () => ({ commit: "abc" }),
      cyclus: async (ctx) => {
        m += 1;
        // De hervatting krijgt de uitsluitingen van vóór de pauze mee.
        expect(ctx.runUitsluitingen.dimensies).toContain("a");
        if (m === 1) longRun.vraagControle("CAN-pauze", "STOP", "test");
        return { beslissing: "REJECTED", kandidaatId: `q${m}`, dimensie: "b", versieId: null, verdict: "REJECT", strategie: `T${m}` };
      },
    });
    expect(h.stopReden).toBe("HANDMATIG_GESTOPT");
    expect(h.segmenten).toBe(2);
    expect(h.omgevingen?.map((o) => o.segment)).toEqual([1, 2]);
    expect(h.verkenning).toEqual(voor.verkenning);
    for (const paar of voor.paren ?? []) expect(h.geblokkeerdeParen).toContainEqual(paar);
  });

  it("na een crash (proces weg, checkpoint RUNNING) hervat dezelfde run met hetzelfde id", async () => {
    let n = 0;
    void longRun.draaiLongRun({ runId: "CAN-crash", profiel: "6h" }, {
      nu: klok(60_000),
      cyclus: async () => {
        n += 1;
        if (n === 2) return new Promise(() => undefined); // hangt: "proces valt weg"
        return { beslissing: "REJECTED", kandidaatId: `c${n}`, dimensie: "a", versieId: null, verdict: "REJECT", strategie: "REGEL" };
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const gecrasht = longRun.leesCheckpoint("CAN-crash")!;
    expect(gecrasht.status).toBe("RUNNING");
    expect(gecrasht.geblokkeerdeParen).toEqual([{ dimensie: "a", strategie: "REGEL" }]);
    let m = 0;
    const r = await longRun.draaiLongRun({ runId: "CAN-crash", profiel: "6h" }, {
      nu: klok(60_000),
      cyclus: async (ctx) => {
        m += 1;
        expect(ctx.runUitsluitingen.paren).toContainEqual({ dimensie: "a", strategie: "REGEL" });
        if (m === 1) longRun.vraagControle("CAN-crash", "STOP", "test");
        return { beslissing: "REJECTED", kandidaatId: `d${m}`, dimensie: "a", versieId: null, verdict: "REJECT", strategie: "ZELFCONTROLE" };
      },
    });
    expect(r.runId).toBe("CAN-crash");
    expect(r.segmenten).toBe(2);
    expect(r.cycli.map((c) => c.kandidaatId)).toEqual(["c1", "d1"]);
  });
});

// ── UI-run → canoniek checkpoint → verifier ─────────────────────────────────

function agent(o: Partial<AgentQualityCategory> = {}): AgentQualityCategory {
  return { contextResolution: 80, multiTurnContext: 80, machinistTaal: 80, toolChoice: 80, falsePremiseCorrection: 80, grounding: 80, causalClaims: 80, unnecessaryClarifications: 80, latencyMs: { p50: 1, p95: 1 }, ...o };
}
const rooster = { validity: null, packageQuality: null, profileFit: null, restRecovery: null, fairness: null, weekends: null, nightBlocks: null, rangeerDistribution: null, worstLineQuality: null, paretoResult: null, notApplicableReason: "test" } as RosterQualityCategory;
const meting = (a: AgentQualityCategory): DualQualityMeasurement => ({ agent: a, roster: rooster, measuredAt: new Date().toISOString() });
function proof(runId: string, variantId: string): ProofOfValueResult {
  return {
    id: `p-${variantId}`, runId, startedAt: "", finishedAt: "", executed: true, notExecutedReason: null, variantId, variantLabel: variantId, variantCategory: "PROMPT", frozenSetId: "t",
    pre: meting(agent()), postRuns: [meting(agent({ contextResolution: 70 }))], post: meting(agent({ contextResolution: 70 })), postVariance: {} as ProofOfValueResult["postVariance"],
    preHoldout: meting(agent()), holdout: meting(agent({ contextResolution: 70 })), regressions: ["contextResolution: 80 -> 70"], improvements: [], decision: "REJECTED", reasoning: "afgewezen", knownWeaknesses: [],
  };
}

describe("een UI-run is dezelfde canonieke run, en direct te verifiëren", () => {
  it("canoniek checkpoint (werk + kopie) bestaat tíjdens de run, en de verifier beoordeelt de afgeronde UI-run", async () => {
    const runId = "DR-UI-202609301449-TEST";
    const kopieMap = path.join(tmpRoot, "docs-long-runs", runId);
    let tijdensRun: { status: string } | null = null;
    const result = await autoRun.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 360 },
      {
        runAdversarial: async () => ({ basis: 80, kandidaat: 80 }),
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "contextResolution", weakestScore: 50, scores: { contextResolution: 50, grounding: 75 } }),
        generateCandidate: generate.generateCandidateFromWeakness,
        runProofOfValue: async (o) => {
          const kopie = path.join(kopieMap, "checkpoint.json");
          if (existsSync(kopie)) tijdensRun = JSON.parse(readFileSync(kopie, "utf8"));
          return proof(runId, o.variant!.id);
        },
        createVersion: () => {
          throw new Error("geen promotie in deze test");
        },
      },
      // Versnelde klok: elke cyclus 10 actieve minuten, zodat het 360-minutenbudget echt opgaat.
      { nu: klok(10 * 60_000), omgeving: () => ({ commit: "test", model: { lokaal: true, model: "qwen3:8b", ollamaVersie: "0.34.4" } }), spiegel: (c) => canoniek.schrijfCanoniekeKopie(c, kopieMap) },
    );
    expect(tijdensRun).not.toBeNull();
    expect(tijdensRun!.status).toBe("RUNNING");

    // Zelfde run-id in samenvatting, werkcheckpoint en canonieke kopie.
    const werk = longRun.leesCheckpoint(runId)!;
    const kopie = JSON.parse(readFileSync(path.join(kopieMap, "checkpoint.json"), "utf8"));
    expect(result.runId).toBe(runId);
    expect(werk.runId).toBe(runId);
    expect(kopie).toEqual(werk);
    // Meer dan twee rejects op contextResolution, dan de wissel naar grounding.
    expect(werk.cycli.filter((c) => c.dimensie === "contextResolution" && c.kandidaatId).length).toBeGreaterThan(2);
    expect(werk.cycli.some((c) => c.overgangen?.includes("ZWAKTE_GEWISSELD"))).toBe(true);
    // De startruimte (3 strategieën × 2 zwaktes) was ruim vóór het budget op; de run ging door met nieuwe golven.
    expect(werk.stopReden).toBe("BUDGET_OP");
    expect(werk.actieveMs / 60000).toBeGreaterThanOrEqual(360);
    expect(werk.zoekruimte!.golven.length).toBeGreaterThan(1);
    expect(werk.cycli.filter((c) => c.kandidaatId).length).toBeGreaterThan(6);

    const logboek = werk.cycli.filter((c) => c.kandidaatId).map(() => ({ kind: "AGENT_EXECUTION_START", message: "Item x: model=lokaal:qwen3:8b (taalmodel: ja), 1 beurt(en) uitgevoerd." }));
    const v = controleerLangeRun(werk as never, logboek);
    expect(v.controles.filter((c) => !c.ok)).toEqual([]);
    expect(v.status).toBe("PASS");
    expect(werk.productie?.bijStart).toEqual(werk.productie?.laatst);
  });

  it("de verifier keurt het incidentpatroon af: stoppen op lokale uitputting, of 'alles geprobeerd' zonder bewijs", () => {
    const cyclus = (nr: number) => ({ nr, beslissing: "REJECTED", dimensie: "contextResolution", strategie: nr === 1 ? "REGEL" : "ZELFCONTROLE", verdict: "REJECT", lesId: `l${nr}`, geleerdVan: nr > 1 ? [`l${nr - 1}`] : [], stadia: [] });
    const incident = { runId: "INC", status: "DONE", stopReden: "GEEN_VOORTGANG", cycli: [cyclus(1), cyclus(2)], productie: { bijStart: { versionId: "v", generation: 0 }, laatst: { versionId: "v", generation: 0 } } };
    expect(controleerLangeRun(incident, []).controles.find((c) => c.naam === "geldige stopreden")?.ok).toBe(false);
    const zonderBewijs = { ...incident, stopReden: "ALLES_GEPROBEERD" };
    expect(controleerLangeRun(zonderBewijs, []).controles.find((c) => c.naam === "geldige stopreden")?.ok).toBe(false);
    expect(controleerLangeRun(incident, []).controles.find((c) => c.naam.startsWith("canoniek"))?.ok).toBe(false);
  });
});

describe("verkenningsruimte over runs heen", () => {
  it("telt open paren zwakte×strategie; verworpen strategieën en wachtende kandidaten tellen niet", () => {
    const les = (dimensie: string, strategie: string, verdict: "REJECT" | "KEEP") =>
      ({ id: `${dimensie}${strategie}`, at: "t", runId: "r", dimensie, strategie, kandidaatId: "k", verdict, beslissing: "x", redenen: [], deltaDoel: null, adversarial: null }) as const;
    const r = lessons.verkenningsruimte(["a", "b", "c"], [les("a", "REGEL", "REJECT"), les("a", "ZELFCONTROLE", "REJECT"), les("b", "REGEL", "KEEP")], ["REGEL", "ZELFCONTROLE", "WAAROM"]);
    expect(r.totaal).toBe(9);
    expect(r.open).toBe(1 + 3); // a: alleen WAAROM; b wacht op een mens; c: alle drie
  });
});
