import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { METRICS } from "./metrics";
import type { PhaseMeasurement } from "./measure";

/**
 * De acceptatiepoorten uit de werkopdracht, op twee metingen.
 *
 * ## Wat een poort is
 *
 * Een vergelijking van het gemiddelde over de kandidaten: AFTER tegen BEFORE,
 * in de richting van de maat. Hard is absoluut (0 overtredingen, volledige
 * dekking, 0 profielovertredingen). Menselijke structuur: niet slechter dan
 * BEFORE. Technische bewaking: eerlijkheid en uren niet duidelijk slechter
 * (marge 0,5 en 1 punt), rust en de slechtste regel niet slechter.
 *
 * Naast elk verschil staat een 95%-bootstrapinterval (2000 trekkingen, vaste
 * zaadwaarde). Een poort wordt op het gemiddelde beoordeeld, niet op het
 * interval; het interval laat zien of een verschil van ruis te onderscheiden is.
 *
 *   npm run final-brain:gate -- --before before.json --after after.json [--out gates.json]
 */

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain");

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const lees = (bestand: string): PhaseMeasurement =>
  JSON.parse(readFileSync(path.isAbsolute(bestand) ? bestand : path.join(MAP, bestand), "utf8")) as PhaseMeasurement;

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
export function bootstrapVerschil(a: readonly number[], b: readonly number[], trekkingen = 2000, zaad = 20260918): [number, number] | null {
  if (a.length === 0 || b.length === 0) return null;
  const kans = toeval(zaad);
  const gem = (xs: readonly number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i += 1) s += xs[Math.floor(kans() * xs.length)];
    return s / xs.length;
  };
  const verschillen: number[] = [];
  for (let i = 0; i < trekkingen; i += 1) verschillen.push(gem(b) - gem(a));
  verschillen.sort((x, y) => x - y);
  return [verschillen[Math.floor(0.025 * trekkingen)], verschillen[Math.floor(0.975 * trekkingen)]];
}

export interface Poort {
  readonly group: "hard" | "structure" | "guardrail";
  readonly key: string;
  readonly label: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly delta: number | null;
  readonly ci95: [number, number] | null;
  readonly rule: string;
  readonly pass: boolean;
}

export function gates(before: PhaseMeasurement, after: PhaseMeasurement): Poort[] {
  const waarden = (m: PhaseMeasurement, key: string) => {
    const spec = METRICS.find((x) => x.key === key)!;
    return m.runs.flatMap((r) => r.candidates.map((k) => spec.get(k.metrics))).filter((x): x is number => x !== null);
  };
  const gem = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const poort = (group: Poort["group"], key: string, rule: string, pass: (b: number, a: number) => boolean): Poort => {
    const spec = METRICS.find((x) => x.key === key)!;
    const a = waarden(before, key);
    const b = waarden(after, key);
    const vb = gem(a);
    const va = gem(b);
    return {
      group,
      key,
      label: spec.label,
      before: vb,
      after: va,
      delta: vb === null || va === null ? null : va - vb,
      ci95: bootstrapVerschil(a, b),
      rule,
      pass: vb !== null && va !== null && pass(vb, va),
    };
  };
  const EPS = 1e-9;
  const officieel = after.official;
  const jitterBand = (officieel.startJitter.mean ?? 0);
  const jitterP90 = (officieel.startJitter.p90 ?? 0);
  const p90After = gem(waarden(after, "startJitterP90")) ?? Infinity;

  const hard: Poort[] = [
    { group: "hard", key: "hardValid", label: "Alle kandidaten hard geldig", before: before.hard.allValid ? 1 : 0, after: after.hard.allValid ? 1 : 0, delta: null, ci95: null, rule: "alle", pass: after.hard.allValid },
    { group: "hard", key: "unassigned", label: "Niet toegewezen diensten (max)", before: before.hard.maxUnassigned, after: after.hard.maxUnassigned, delta: null, ci95: null, rule: "= 0", pass: after.hard.maxUnassigned === 0 },
    { group: "hard", key: "profileBreaches", label: "Profielovertredingen (max)", before: before.hard.maxProfileBreaches, after: after.hard.maxProfileBreaches, delta: null, ci95: null, rule: "= 0", pass: after.hard.maxProfileBreaches === 0 },
    {
      group: "hard",
      key: "confirmedHard",
      label: "Bevestigde harde overtredingen (max)",
      before: before.hard.maxConfirmedHardViolations,
      after: after.hard.maxConfirmedHardViolations,
      delta: null,
      ci95: null,
      rule: "= 0",
      pass: (after.hard.maxConfirmedHardViolations ?? 0) === 0,
    },
  ];
  const structuur: Poort[] = [
    poort("structure", "singletons", "≤ BEFORE", (b, a) => a <= b + EPS),
    poort("structure", "pairs", "≤ BEFORE", (b, a) => a <= b + EPS),
    poort("structure", "nightBlockValue", "≥ BEFORE", (b, a) => a >= b - EPS),
    poort("structure", "worstNightExit", "≥ BEFORE", (b, a) => a >= b - EPS),
    poort("structure", "minRecoveryHours", "≥ BEFORE", (b, a) => a >= b - EPS),
    poort("structure", "coherence", "≥ BEFORE", (b, a) => a >= b - EPS),
    poort("structure", "oscillations", "≤ BEFORE", (b, a) => a <= b + EPS),
    poort("structure", "startJitterMean", `≤ BEFORE, of binnen de menselijke band (gem ≤ ${jitterBand.toFixed(0)}, p90 ≤ ${jitterP90.toFixed(0)})`, (b, a) => a <= b + EPS || (a <= jitterBand && p90After <= jitterP90)),
  ];
  const bewaking: Poort[] = [
    poort("guardrail", "fairness", "≥ BEFORE − 0,5", (b, a) => a >= b - 0.5),
    poort("guardrail", "hours", "≥ BEFORE − 1", (b, a) => a >= b - 1),
    poort("guardrail", "rest", "≥ BEFORE", (b, a) => a >= b - EPS),
    poort("guardrail", "worstLine", "≥ BEFORE", (b, a) => a >= b - EPS),
  ];
  return [...hard, ...structuur, ...bewaking];
}

function main() {
  const voor = lees(argument("before") ?? "before.json");
  const na = lees(argument("after") ?? "after.json");
  const uitkomst = gates(voor, na);
  const runtime = {
    beforeMeanSeconds: voor.runtime?.mean ?? null,
    afterMeanSeconds: na.runtime?.mean ?? null,
    changePct: voor.runtime && na.runtime ? ((na.runtime.mean - voor.runtime.mean) / voor.runtime.mean) * 100 : null,
  };
  const uit = argument("out");
  if (uit) {
    writeFileSync(
      path.isAbsolute(uit) ? uit : path.join(MAP, uit),
      `${JSON.stringify({ schema: "ns-final-brain-gates/1", before: voor.label, after: na.label, qualityModel: na.qualityModel, gates: uitkomst, runtime, allPass: uitkomst.every((p) => p.pass) }, null, 2)}\n`,
    );
  }
  const t = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
  console.log(`${voor.label}  →  ${na.label}`);
  for (const p of uitkomst) {
    console.log(
      `  ${p.pass ? "✓" : "✗"} [${p.group.padEnd(9)}] ${p.label.padEnd(40).slice(0, 40)} ${t(p.before).padStart(8)} → ${t(p.after).padStart(8)}  Δ ${t(p.delta).padStart(7)}  CI [${t(p.ci95?.[0])}, ${t(p.ci95?.[1])}]  ${p.rule}`,
    );
  }
  console.log(`  rekentijd per run ${t(runtime.beforeMeanSeconds, 0)} → ${t(runtime.afterMeanSeconds, 0)} s (${t(runtime.changePct, 1)}%)`);
  console.log(uitkomst.every((p) => p.pass) ? "ALLE POORTEN GROEN" : `${uitkomst.filter((p) => !p.pass).length} poort(en) niet gehaald`);
}

if (require.main === module) main();
