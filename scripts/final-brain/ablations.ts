import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/server/data/prisma";
import { BENCHMARK_ROOT } from "../benchmark/io";
import { gates } from "./gate";
import { METRICS } from "./metrics";
import { type PhaseMeasurement, measurePhase } from "./measure";

/**
 * Alle ablaties naast elkaar, met één meetlat (werkopdracht §24, H).
 *
 * Elke ablatie is een benchmarkfase in `docs/optimizer-benchmark/<fase>`, gedraaid
 * met één onderdeel anders (NS_ENGINE_PROFILE / NS_ENGINE_VARIANT; de variant
 * staat in elk runbestand). Dit script meet ze met `measure.ts`, zet per maat
 * het gemiddelde naast BEFORE, en toetst elke variant aan dezelfde poorten als
 * de AFTER-meting — alleen op minder runs, dus als richting, niet als bewijs.
 *
 * De lijst staat in `docs/v1.0.4-final-brain/ablation-plan.json`:
 *   [{ "phase": "ab-k5", "label": "…", "change": "…", "strategies": ["BALANCED"] }]
 *
 *   npm run final-brain:ablations
 */

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain");

interface Plan {
  readonly phase: string;
  readonly label: string;
  readonly change: string;
  /** Alleen deze strategieën uit de fase meetellen (zelfde verdeling als de referentie). */
  readonly strategies?: readonly string[];
  /** Alleen deze runnummers. */
  readonly runs?: readonly number[];
}

function beperk(m: PhaseMeasurement, plan: { strategies?: readonly string[]; runs?: readonly number[] }): PhaseMeasurement {
  const runs = m.runs.filter((r) => (!plan.strategies || plan.strategies.includes(r.strategy)) && (!plan.runs || plan.runs.includes(r.run)));
  const alle = runs.flatMap((r) => r.candidates);
  const bevestigd = alle.map((k) => k.confirmedHardViolations).filter((x): x is number => x !== null);
  return {
    ...m,
    runs,
    hard: {
      candidates: alle.length,
      allValid: alle.every((k) => k.metrics.hard.valid),
      maxUnassigned: Math.max(0, ...alle.map((k) => k.metrics.hard.unassigned)),
      maxProfileBreaches: Math.max(0, ...alle.map((k) => k.metrics.hard.profileBreaches)),
      maxConfirmedHardViolations: bevestigd.length ? Math.max(...bevestigd) : null,
    },
    runtime: m.runtime,
  };
}

async function main() {
  const plan = JSON.parse(readFileSync(path.join(MAP, "ablation-plan.json"), "utf8")) as Plan[];
  const voorVol = JSON.parse(readFileSync(path.join(MAP, "before.json"), "utf8")) as PhaseMeasurement;
  const uit = [];
  for (const p of plan) {
    if (!existsSync(path.join(BENCHMARK_ROOT, p.phase))) {
      uit.push({ ...p, status: "niet gedraaid" });
      continue;
    }
    const meting = beperk(await measurePhase(p.phase, p.label), p);
    // Vergelijk met BEFORE op dezelfde strategieën, anders meet je de strategiemix.
    const voor = beperk(voorVol, { strategies: p.strategies });
    const alle = meting.runs.flatMap((r) => r.candidates);
    const gem = (key: string) => {
      const spec = METRICS.find((m) => m.key === key)!;
      const xs = alle.map((k) => spec.get(k.metrics)).filter((x): x is number => x !== null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const poorten = gates(voor, meting);
    uit.push({
      ...p,
      status: "gemeten",
      runs: meting.runs.length,
      candidates: alle.length,
      variant: (JSON.parse(readFileSync(path.join(BENCHMARK_ROOT, p.phase, `run-${String(meting.runs[0].run).padStart(3, "0")}.json`), "utf8")) as { variant?: unknown }).variant ?? null,
      runtimeMeanSeconds: meting.runs.reduce((s, r) => s + r.runtimeSeconds, 0) / Math.max(1, meting.runs.length),
      means: Object.fromEntries(METRICS.map((m) => [m.key, gem(m.key)])),
      minRecoveryBuckets: alle.reduce<Record<string, number>>((acc, k) => {
        const u = k.metrics.nights.minRecoveryHours;
        const emmer = u === null ? "geen" : u < 36 ? "<36" : u < 46 ? "36-45" : u < 56 ? "46-55" : ">=56";
        acc[emmer] = (acc[emmer] ?? 0) + 1;
        return acc;
      }, {}),
      structureFamilies: new Set(alle.map((k) => k.metrics.structureFamily)).size,
      gates: poorten.map((g) => ({ key: g.key, group: g.group, pass: g.pass, before: g.before, after: g.after, delta: g.delta, ci95: g.ci95 })),
      gatesPassed: poorten.filter((g) => g.pass).length,
      gatesTotal: poorten.length,
    });
    const r = uit[uit.length - 1] as { means: Record<string, number | null>; gatesPassed: number; gatesTotal: number };
    const t = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
    console.log(
      `${p.phase.padEnd(22)} ${String(alle.length).padStart(3)} kand · robuust ${t(r.means.robust, 1)} · onder 46 u ${t(r.means.exitsBelowRule)} · kortste ${t(r.means.minRecoveryHours, 1)} u · slechtste uitgang ${t(r.means.worstNightExit, 1)} · los ${t(r.means.singletons)} · twee ${t(r.means.pairs)} · uren ${t(r.means.hours, 1)} · eerlijk ${t(r.means.fairness, 1)} · rust ${t(r.means.rest, 1)} · poorten ${r.gatesPassed}/${r.gatesTotal}`,
    );
  }
  writeFileSync(path.join(MAP, "ablations.json"), `${JSON.stringify({ schema: "ns-final-brain-ablations/1", measuredAt: new Date().toISOString(), reference: "before.json (v1.0.4, dezelfde strategieën)", ablations: uit }, null, 2)}\n`);
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
