import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MachinistMetrics } from "./metrics";
import { MACHINIST_METRICS } from "./metrics";
import type { PhaseFile } from "./measure-phases";

/**
 * Beslisregel M4: de poorten voor de AFTER van de machinistenronde, tegen de
 * baseline (brain-after), per kandidaat of met een bootstrap-95%-interval.
 *
 * "Significant slechter" = het interval van (AFTER − baseline) ligt geheel aan de
 * slechte kant. Zelfde bootstrap als scripts/final-brain/gate.ts (gekopieerd:
 * dat bestand importeren voert zijn main() uit), zelfde zaad 20260918.
 *
 *   npx tsx scripts/machinist/gate.ts --before brain-after --after mp-after [--tests groen]
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences");
const lees = (naam: string) => JSON.parse(readFileSync(path.join(MAP, "phases", `${naam}.json`), "utf8")) as PhaseFile;

function toeval(zaad: number) {
  let t = zaad >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95%-interval van gemiddelde(b) − gemiddelde(a). */
function bootstrapVerschil(a: readonly number[], b: readonly number[], trekkingen = 2000, zaad = 20260918): [number, number] | null {
  if (a.length === 0 || b.length === 0) return null;
  const kans = toeval(zaad);
  const gem = (xs: readonly number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i += 1) s += xs[Math.floor(kans() * xs.length)];
    return s / xs.length;
  };
  const v: number[] = [];
  for (let i = 0; i < trekkingen; i += 1) v.push(gem(b) - gem(a));
  v.sort((x, y) => x - y);
  return [v[Math.floor(0.025 * trekkingen)], v[Math.floor(0.975 * trekkingen)]];
}

type Kandidaat = MachinistMetrics;
const maat = (key: string) => MACHINIST_METRICS.find((m) => m.key === key)!;
const waarden = (lijst: readonly Kandidaat[], get: (m: Kandidaat) => number | null) => lijst.map(get).filter((x): x is number => x !== null);
const gem = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);

/** Ruwe aantallen, zodat verbetering niet alleen in een score zit (regel M4.10). */
const RUW: Record<string, (m: Kandidaat) => number> = {
  lessAssignments: (m) => Object.values(m.profiles).reduce((s, p) => s + Math.round((p.lessShare ?? 0) * p.dutyDays), 0),
  dayDutyDeviation: (m) => Object.values(m.profiles).reduce((s, p) => s + Math.abs(p.dayDuties - p.dayDutyTarget), 0),
  laatEarlyLates: (m) => Object.values(m.profiles).filter((p) => p.profile === "LAAT").reduce((s, p) => s + p.earlyLate, 0),
};

export interface Poort {
  readonly nr: number;
  readonly label: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly ci95: [number, number] | null;
  readonly rule: string;
  readonly pass: boolean;
}

function main() {
  const voor = lees(argument("before") ?? "brain-after");
  const na = lees(argument("after") ?? "mp-after");
  const testsGroen = argument("tests") === "groen";
  const a = voor.candidates;
  const b = na.candidates;
  const poorten: Poort[] = [];

  const nietSlechter = (nr: number, key: string) => {
    const m = maat(key);
    const x = waarden(a, m.get);
    const y = waarden(b, m.get);
    const ci = bootstrapVerschil(x, y);
    const slechter = ci ? (m.higherIsBetter ? ci[1] < 0 : ci[0] > 0) : false;
    poorten.push({ nr, label: `${m.label} niet significant slechter`, before: r2(gem(x)), after: r2(gem(y)), ci95: ci ? [r2(ci[0])!, r2(ci[1])!] : null, rule: "interval niet geheel aan de slechte kant", pass: !slechter });
  };

  // 1. Hard, per kandidaat.
  const hard = b.filter((k) => k.base.hard.valid && k.base.hard.unassigned === 0 && k.base.hard.profileBreaches === 0).length;
  poorten.push({ nr: 1, label: "Hard: 0 overtredingen, volledige dekking, 0 profielbreuken", before: a.filter((k) => k.base.hard.valid).length, after: hard, ci95: null, rule: `alle ${b.length} kandidaten`, pass: hard === b.length });
  // 2. Operationeel, per kandidaat.
  const ops = b.filter((k) => k.operational.compliant).length;
  poorten.push({ nr: 2, label: "Operationeel: elk rooster ≤ 40:00 en elke vrije-weekendvrijdag conform", before: a.filter((k) => k.operational.compliant).length, after: ops, ci95: null, rule: `alle ${b.length} kandidaten`, pass: ops === b.length });
  // 3. Nachten.
  for (const key of ["singletons", "pairs", "worstNightExit", "minRecoveryHours"]) nietSlechter(3, key);
  // 4. Rust. 5. Slechtste regel.
  nietSlechter(4, "rest");
  nietSlechter(5, "worstLineV2");
  // 6. Eerlijkheid: gemiddeld hooguit 0,5 lager.
  {
    const x = gem(waarden(a, maat("fairness").get));
    const y = gem(waarden(b, maat("fairness").get));
    poorten.push({ nr: 6, label: "Eerlijkheid gemiddeld hooguit 0,5 lager", before: r2(x), after: r2(y), ci95: null, rule: "AFTER ≥ baseline − 0,5", pass: x !== null && y !== null && y >= x - 0.5 });
  }
  // 7. Voorkeur significant hoger; affiniteit en restdiensten niet slechter.
  {
    const m = maat("preference");
    const x = waarden(a, m.get);
    const y = waarden(b, m.get);
    const ci = bootstrapVerschil(x, y);
    poorten.push({ nr: 7, label: "Voorkeur significant hoger", before: r2(gem(x)), after: r2(gem(y)), ci95: ci ? [r2(ci[0])!, r2(ci[1])!] : null, rule: "interval geheel boven 0", pass: ci !== null && ci[0] > 0 });
    nietSlechter(7, "affinity");
    nietSlechter(7, "restDuties");
  }
  // 8. Populair eerlijk. 9. Rangeer.
  nietSlechter(8, "popularFairness");
  nietSlechter(9, "rangeerCv");
  nietSlechter(9, "rangeerMaxShare");
  // 10. Geen schijnvooruitgang: adversariële toetsen en ruwe aantallen.
  poorten.push({ nr: 10, label: "Adversariële toetsen 1–10 groen", before: null, after: null, ci95: null, rule: "vitest: machinistenvoorkeur, operationele-eisen(-solver)", pass: testsGroen });
  for (const [key, get] of Object.entries(RUW)) {
    const x = a.map(get);
    const y = b.map(get);
    const ci = bootstrapVerschil(x, y);
    poorten.push({ nr: 10, label: `Ruw aantal lager: ${key}`, before: r2(gem(x)), after: r2(gem(y)), ci95: ci ? [r2(ci[0])!, r2(ci[1])!] : null, rule: "gemiddeld lager dan de baseline", pass: (gem(y) ?? Infinity) < (gem(x) ?? -Infinity) });
  }

  const groen = poorten.filter((p) => p.pass).length;
  const uit = {
    schema: "ns-machinist-gates/1",
    rule: "M4",
    decidedAt: new Date().toISOString(),
    before: { phase: voor.phase, candidates: a.length, qualityModelV3Hash: voor.qualityModelV3Hash },
    after: { phase: na.phase, candidates: b.length, qualityModelV3Hash: na.qualityModelV3Hash },
    sameModel: voor.qualityModelV3Hash === na.qualityModelV3Hash,
    gates: poorten,
    green: groen,
    total: poorten.length,
    allGreen: groen === poorten.length && voor.qualityModelV3Hash === na.qualityModelV3Hash,
  };
  writeFileSync(path.join(MAP, "gates.json"), `${JSON.stringify(uit, null, 2)}\n`);
  for (const p of poorten) console.log(`${p.pass ? "✓" : "✗"} ${String(p.nr).padStart(2)} ${p.label.padEnd(60)} ${String(p.before).padStart(8)} → ${String(p.after).padEnd(8)} ${p.ci95 ? `[${p.ci95[0]}, ${p.ci95[1]}]` : ""}`);
  console.log(`\n${groen}/${poorten.length} poorten groen${uit.sameModel ? "" : " — LET OP: verschillende modelvingerafdruk"}`);
}

main();
