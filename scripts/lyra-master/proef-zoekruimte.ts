/**
 * Versnelde proef van de dynamische zoekruimte (eindcontrole 20260930): vult
 * een 6-uursprofiel zijn 360 actieve minuten, ook als de vaste startruimte op
 * is? En blijft elke verbreding nieuw, begrensd en op lessen gebouwd?
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/proef-zoekruimte.ts [--uitvoer <bestand>]
 *
 * NEPWERELD — geen taalmodel, geen echte meting. Echt zijn: de motor
 * (factory/longRun.ts), de regisseur (develop/zoekruimte.ts), de cyclus
 * (develop/developmentCycle.ts) met validator, rechter (judge/2) en
 * leergeheugen, het checkpoint en de verifier. De klok is versneld (9 actieve
 * minuten per cyclus, zoals de echte run DR-UI-20260930165141-d5a8); de
 * metingen komen uit een vaste nepwereld die het patroon van die echte run
 * nabootst: de meeste kandidaten laten falsePremiseCorrection zakken (één
 * item), het doel beweegt zelden. Alles draait in een tijdelijke map; er wordt
 * niets in DATA_DIR of de repository geschreven behalve het proefbestand.
 *
 * Twee scenario's:
 *  A. "na de echte run": het leergeheugen begint met de 16 verwerpingen van
 *     DR-UI-20260930165141-d5a8 (zo begint de volgende echte 6-uursrun ook);
 *  B. "leeg geheugen": de startruimte (3 × 6) raakt binnen de run op.
 *
 * De verifier draait zonder modellogboek: de controle "echt taalmodel" faalt
 * hier terecht. Alle andere controles — ook "actief budget benut" — moeten
 * slagen.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const WORTEL = path.resolve(__dirname, "..", "..");
const ECHTE_RUN = "DR-UI-20260930165141-d5a8";
const BASIS = { contextResolution: 50, multiTurnContext: 50, machinistTaal: 80, toolChoice: 50, falsePremiseCorrection: 100, grounding: 50, causalClaims: 83, unnecessaryClarifications: 80 } as const;
const GEMETEN = ["contextResolution", "multiTurnContext", "toolChoice", "grounding", "falsePremiseCorrection", "causalClaims"] as const;

function h(s: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x >>> 0;
}

/** De 16 verwerpingen van de echte run als lessen, uit het canonieke checkpoint (alleen lezen). */
function lessenUitEchteRun(): Json[] {
  const c = JSON.parse(readFileSync(path.join(WORTEL, "docs", "lyra-knowledge", "long-runs", ECHTE_RUN, "checkpoint.json"), "utf8")) as Json;
  return (c.cycli as Json[])
    .filter((x) => x.lesId && x.strategie)
    .map((x) => {
      const st = Object.fromEntries((x.stadia as Json[]).map((s) => [s.naam, s]));
      const delta = /Δ ([+-]?\d+(?:\.\d+)?)pp/.exec(String(st.BENCHMARK?.detail ?? ""));
      const adv = /adversarial (\d+)% → (\d+)%/.exec(String(st.ADVERSARIAL?.detail ?? ""));
      const reden = String(st.RECHTER?.detail ?? "").replace(/^judge\/2: \w+ — /, "");
      return {
        id: x.lesId,
        at: x.klaarOp,
        runId: ECHTE_RUN,
        dimensie: x.dimensie,
        strategie: x.strategie,
        kandidaatId: x.kandidaatId,
        verdict: x.verdict,
        beslissing: x.beslissing,
        redenen: reden ? [reden] : [],
        deltaDoel: delta ? Number(delta[1]) : null,
        adversarial: adv ? { basis: Number(adv[1]), kandidaat: Number(adv[2]) } : null,
      };
    });
}

async function scenario(naam: string, metEchteLessen: boolean): Promise<Json> {
  const map = mkdtempSync(path.join(tmpdir(), `proef-zoekruimte-${naam}-`));
  process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = map;
  try {
    // Eén scenario per proces (zie main): DATA_DIR volgt de override bij het laden.
    const auto = (await import("../../demo-room/src/develop/autonomousDevelopmentRun")) as typeof import("../../demo-room/src/develop/autonomousDevelopmentRun");
    const gen = (await import("../../demo-room/src/develop/generateCandidate")) as typeof import("../../demo-room/src/develop/generateCandidate");
    const lr = (await import("../../demo-room/src/factory/longRun")) as typeof import("../../demo-room/src/factory/longRun");
    const { controleerLangeRun } = await import("./verify-long-run");
    const { DATA_DIR } = await import("../../demo-room/src/config");
    if (metEchteLessen) {
      mkdirSync(path.join(DATA_DIR, "learning"), { recursive: true });
      writeFileSync(path.join(DATA_DIR, "learning", "lessons.jsonl"), lessenUitEchteRun().map((l) => JSON.stringify(l)).join("\n") + "\n");
    }
    const meting = (o: Json = {}) => ({ agent: { ...BASIS, latencyMs: { p50: 1, p95: 1 }, ...o }, roster: { validity: null, packageQuality: null, profileFit: null, restRecovery: null, fairness: null, weekends: null, nightBlocks: null, rangeerDistribution: null, worstLineQuality: null, paretoResult: null, notApplicableReason: "nepwereld" }, measuredAt: "t" });
    const runId = `PROEF-ZOEKRUIMTE-${naam}`;
    let t = Date.parse("2026-10-01T08:00:00Z");
    const extraPerCyclus: number[] = [];
    const r = await auto.runAutonomousDevelopmentRun(
      { runId, maxMinutes: 360 },
      {
        identifyWeakness: async () => ({ executed: true, notExecutedReason: null, weakestDimension: "contextResolution", weakestScore: 50, scores: Object.fromEntries(GEMETEN.map((d) => [d, BASIS[d]])) }),
        generateCandidate: gen.generateCandidateFromWeakness,
        runProofOfValue: async (o) => {
          const v = o.variant!;
          const dim = (v.hypothesis?.dimensie ?? "toolChoice") as keyof typeof BASIS;
          const st = v.hypothesis?.strategie ?? "REGEL";
          const extra = (o.extraItems ?? []).filter((i) => String(i.id).includes("falsePremiseCorrection")).length;
          extraPerCyclus.push((o.extraItems ?? []).length);
          const x = h(`${dim}|${st}`);
          const fp = st.includes("BESCHERM:falsePremiseCorrection") || x % 3 === 0 ? 100 : 100 - 100 / (1 + extra);
          const post = meting({ [dim]: Math.min(100, BASIS[dim] + (x % 7 === 0 ? 25 : 0)), ...(dim === "falsePremiseCorrection" ? {} : { falsePremiseCorrection: fp }) });
          return { id: `nep-${v.id}`, runId, startedAt: "t", finishedAt: "t", executed: true, notExecutedReason: null, variantId: v.id, variantLabel: v.id, variantCategory: v.category, frozenSetId: "nepwereld", pre: meting(), postRuns: [post, post], post, postVariance: {}, preHoldout: meting(), holdout: meting(), regressions: [], improvements: [], decision: "REJECTED", reasoning: "nepwereld", knownWeaknesses: [] } as never;
        },
        createVersion: ((i: Json) => ({ id: `nep-versie-${i.variantId}`, status: "CANDIDATE" })) as never,
        runAdversarial: async () => ({ basis: 67, kandidaat: 67 }),
      },
      { nu: () => (t += 9 * 60_000), productie: () => ({ versionId: "lyra-prod-baseline", generation: 0 }), omgeving: () => ({ bron: "proef-zoekruimte", model: { lokaal: false, model: "NEPWERELD" } }) },
    );
    const c = lr.leesCheckpoint(runId)! as unknown as Json;
    const v = controleerLangeRun(c, []);
    const z = c.zoekruimte as Json;
    return {
      scenario: naam,
      leergeheugenBijStart: metEchteLessen ? `${lessenUitEchteRun().length} verwerpingen uit ${ECHTE_RUN}` : "leeg",
      runId,
      stop: { status: c.status, stopReden: c.stopReden, resultaat: r.stopReason },
      actieveMinuten: Math.round(c.actieveMs / 6000) / 10,
      budgetMinuten: c.budgetMinuten,
      cycli: c.cycli.length,
      gemeten: (c.cycli as Json[]).filter((x) => x.kandidaatId).length,
      uitgeputteCycli: (c.cycli as Json[]).filter((x) => x.beslissing === "UITGEPUT").map((x) => x.nr),
      golven: (z.golven as Json[]).map((g) => ({
        nr: g.nr,
        aanleiding: g.aanleiding,
        naCyclus: g.naCyclus,
        aanpak: g.aanpak,
        aanpakGewisseld: g.aanpakGewisseld,
        hypothesen: (z.hypothesen as Json[]).filter((x) => x.golf === g.nr && g.nr > 1).map((x) => ({ id: x.id, strategie: `${x.dimensie}/${x.strategie}`, familie: x.familie, soort: x.herkomst.soort, reden: x.herkomst.reden, lessen: x.herkomst.lesIds.length, verschil: x.herkomst.verschil })),
        startruimte: g.nr === 1 ? g.hypothesen.length : undefined,
        tests: g.tests,
        geweigerd: Object.entries((g.geweigerd as Json[]).reduce((a: Json, x) => ({ ...a, [x.reden]: (a[x.reden] ?? 0) + 1 }), {})).map(([k, n]) => `${n}× ${k}`),
        testGaten: g.testGaten,
        lessen: g.lesIds.length,
      })),
      gegenereerdeTests: (z.tests as Json[]).map((x) => ({ id: x.id, dimensie: x.dimensie, prompt: x.item.prompt, gedrag: x.item.expect.behaviour, reden: x.herkomst.reden })),
      extraItemsPerCyclus: extraPerCyclus,
      productie: c.productie,
      verifier: { status: v.status, controles: v.controles.map((x) => `${x.ok ? "OK  " : "FOUT"} ${x.naam} — ${x.detail}`) },
      verwachting: "alle controles OK behalve 'een echt taalmodel deed de metingen' (nepwereld)",
      klopt: v.controles.every((x) => x.ok || x.naam === "een echt taalmodel deed de metingen") && !v.controles.find((x) => x.naam === "een echt taalmodel deed de metingen")!.ok,
    };
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  // Eén scenario per proces houdt DATA_DIR zuiver (config leest de override bij het laden).
  const welk = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario") + 1] : null;
  if (welk) {
    console.log(JSON.stringify(await scenario(welk, welk === "A-na-echte-run")));
    return;
  }
  const { execFileSync } = await import("node:child_process");
  const uit = (s: string) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, __filename, "--scenario", s], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").at(-1)!) as Json;
  const a = uit("A-na-echte-run");
  const b = uit("B-leeg-geheugen");
  const proef = {
    schema: "ns-lyra-zoekruimte-proof/1",
    gemaakt: new Date().toISOString(),
    LET_OP: "NEPWERELD — geen taalmodel en geen echte meting; versnelde klok (9 actieve min per cyclus). Bewijst het gedrag van motor, regisseur, cyclus, rechter, leergeheugen, checkpoint en verifier bij uitputting en stagnatie, niet de modelkwaliteit. Geen LONG-RUN-VERIFICATION van een echte run.",
    scenarios: [a, b],
  };
  const i = process.argv.indexOf("--uitvoer");
  const bestand = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(WORTEL, "docs", "lyra-knowledge", "proofs", `zoekruimte-proof-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`);
  writeFileSync(bestand, `${JSON.stringify(proef, null, 2)}\n`, { flag: "wx" });
  for (const s of [a, b]) {
    console.log(`\n${s.scenario}: ${s.stop.status} · ${s.stop.stopReden} na ${s.actieveMinuten}/${s.budgetMinuten} min, ${s.gemeten} gemeten cycli, ${s.golven.length} golven, uitgeput bij cyclus ${s.uitgeputteCycli.join(", ") || "—"}`);
    for (const c of s.verifier.controles) console.log(`  ${c}`);
    console.log(`  → ${s.klopt ? "zoals verwacht" : "NIET zoals verwacht"}`);
  }
  console.log(`\n${bestand}`);
  process.exitCode = a.klopt && b.klopt ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
