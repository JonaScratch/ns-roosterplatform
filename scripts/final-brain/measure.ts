import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { BENCHMARK_ROOT, type Phase, type RawRun, decodeAssignments, readRuns } from "../benchmark/io";
import { type CandidateMetrics, METRICS, measureAssignments, measureOfficial } from "./metrics";

/**
 * Een meting van een benchmarkfase, met alles erbij om hem na te rekenen.
 *
 * Leest de ruwe runs uit `docs/optimizer-benchmark/<fase>` (de kandidaatroosters
 * zelf, niet wat de zoekmachine erover rapporteerde), meet elke kandidaat met
 * `metrics.ts` en schrijft per run de zaadwaarden, zoekmachineversie,
 * confighash, kwaliteitsmodel en rekentijd weg, per kandidaat alle maten, en
 * per maat de verdeling.
 *
 *   npm run final-brain:measure -- --phase after --out before.json
 *   npm run final-brain:measure -- --phase <fase> --out after.json
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "v1.0.4-final-brain");

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

export function stat(xs: readonly number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: xs.length,
    mean,
    median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2,
    min: s[0],
    max: s[s.length - 1],
    p10: q(0.1),
    p90: q(0.9),
    sd: xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1)),
  };
}

const sha = (bestand: string) => createHash("sha256").update(readFileSync(bestand)).digest("hex");

export interface PhaseMeasurement {
  readonly schema: "ns-final-brain-measurement/1";
  readonly label: string;
  readonly phase: string;
  readonly measuredAt: string;
  readonly qualityModel: string;
  /** Vingerafdruk van de definities: v2 is tijdens de ontwikkeling herzien (H09, H10). */
  readonly qualityModelHash: string;
  readonly runs: readonly {
    run: number;
    strategy: string;
    engine: string;
    mode: string | null;
    runtimeSeconds: number;
    startedAt: string;
    manifestHash: string;
    fileSha256: string;
    candidates: readonly {
      number: number;
      seed: number | null;
      optimizerModelVersion: string | null;
      qualityModelVersionAtGeneration: string | null;
      configHash: string | null;
      validationState: string;
      confirmedHardViolations: number | null;
      metrics: CandidateMetrics;
    }[];
  }[];
  readonly official: CandidateMetrics;
  readonly summary: Readonly<Record<string, ReturnType<typeof stat>>>;
  readonly minRecoveryBuckets: Readonly<Record<string, number>>;
  readonly structureFamilies: { total: number; unique: number; perRunMean: number };
  readonly runtime: ReturnType<typeof stat>;
  /** Per basisrooster het gemiddelde over de kandidaten, naast het officiële rooster. */
  readonly perRoster: Readonly<Record<string, Readonly<Record<string, { official: number | null; mean: number | null }>>>>;
  readonly hard: { candidates: number; allValid: boolean; maxUnassigned: number; maxProfileBreaches: number; maxConfirmedHardViolations: number | null };
}

export async function measurePhase(phase: string, label: string): Promise<PhaseMeasurement> {
  const context = await loadEvaluationContextCore("DDR");
  const runs = readRuns(phase as Phase).filter((run: RawRun) => run.strategy !== "REPRODUCE");
  if (runs.length === 0) throw new Error(`Geen runs in docs/optimizer-benchmark/${phase}.`);
  const uit = runs.map((run) => ({
    run: run.runNumber,
    strategy: run.strategy,
    engine: run.engine,
    mode: run.mode,
    runtimeSeconds: run.runtimeSeconds,
    startedAt: run.startedAt,
    manifestHash: run.manifestHash,
    fileSha256: sha(path.join(BENCHMARK_ROOT, phase, `run-${String(run.runNumber).padStart(3, "0")}.json`)),
    candidates: run.candidates.map((k) => {
      const p = (k.provenance ?? {}) as Record<string, unknown>;
      const versies = (p.versions ?? {}) as Record<string, unknown>;
      return {
        number: k.number,
        seed: typeof p.seed === "number" ? p.seed : null,
        optimizerModelVersion: typeof p.optimizerModelVersion === "string" ? p.optimizerModelVersion : null,
        qualityModelVersionAtGeneration: typeof p.qualityModelVersion === "string" ? p.qualityModelVersion : null,
        configHash: typeof versies.configHash === "string" ? versies.configHash : null,
        validationState: k.validationState,
        confirmedHardViolations: k.confirmedHardViolations,
        metrics: measureAssignments(decodeAssignments(k.roster), context),
      };
    }),
  }));
  const alle = uit.flatMap((r) => r.candidates);
  const summary = Object.fromEntries(
    METRICS.map((m) => [m.key, stat(alle.map((k) => m.get(k.metrics)).filter((x): x is number => x !== null))]),
  );
  const emmers: Record<string, number> = { "<36": 0, "36-45": 0, "46-55": 0, ">=56": 0, geen: 0 };
  for (const k of alle) {
    const u = k.metrics.nights.minRecoveryHours;
    emmers[u === null ? "geen" : u < 36 ? "<36" : u < 46 ? "36-45" : u < 56 ? "46-55" : ">=56"] += 1;
  }
  const velden = ["worstLine", "weeklyDeviation", "exitsBelowRule", "minRecoveryHours", "coherence", "oscillations", "startJitterMean", "worstTransition"] as const;
  const official = measureOfficial(context);
  const perRoster = Object.fromEntries(
    Object.keys(official.perRoster).map((code) => [
      code,
      Object.fromEntries(
        velden.map((veld) => {
          const xs = alle.map((k) => k.metrics.perRoster[code]?.[veld]).filter((x): x is number => typeof x === "number");
          return [veld, { official: (official.perRoster[code]?.[veld] as number | null) ?? null, mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null }];
        }),
      ),
    ]),
  );
  const families = new Set(alle.map((k) => k.metrics.structureFamily));
  const perRun = uit.map((r) => new Set(r.candidates.map((k) => k.metrics.structureFamily)).size);
  const bevestigd = alle.map((k) => k.confirmedHardViolations).filter((x): x is number => x !== null);
  return {
    schema: "ns-final-brain-measurement/1",
    label,
    phase,
    measuredAt: new Date().toISOString(),
    qualityModel: QUALITY_MODEL_V2.version,
    qualityModelHash: createHash("sha256").update(JSON.stringify(QUALITY_MODEL_V2)).digest("hex").slice(0, 16),
    runs: uit,
    official,
    summary,
    minRecoveryBuckets: emmers,
    structureFamilies: { total: alle.length, unique: families.size, perRunMean: perRun.reduce((a, b) => a + b, 0) / perRun.length },
    runtime: stat(uit.map((r) => r.runtimeSeconds)),
    perRoster,
    hard: {
      candidates: alle.length,
      allValid: alle.every((k) => k.metrics.hard.valid),
      maxUnassigned: Math.max(...alle.map((k) => k.metrics.hard.unassigned)),
      maxProfileBreaches: Math.max(...alle.map((k) => k.metrics.hard.profileBreaches)),
      maxConfirmedHardViolations: bevestigd.length ? Math.max(...bevestigd) : null,
    },
  };
}

async function main() {
  const phase = argument("phase");
  const out = argument("out");
  if (!phase || !out) throw new Error("Gebruik: --phase <fase> --out <bestand.json> [--label <naam>]");
  const meting = await measurePhase(phase, argument("label") ?? phase);
  mkdirSync(MAP, { recursive: true });
  const doel = path.isAbsolute(out) ? out : path.join(MAP, out);
  writeFileSync(doel, `${JSON.stringify(meting, null, 2)}\n`);
  const t = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "—" : x.toFixed(d));
  console.log(`${meting.label}: ${meting.hard.candidates} kandidaten uit ${meting.runs.length} runs · model ${meting.qualityModel}`);
  console.log(`hard: ${JSON.stringify(meting.hard)}`);
  for (const m of METRICS) {
    const s = meting.summary[m.key];
    console.log(`  ${m.label.padEnd(44)} officieel ${t(m.get(meting.official), m.decimals).padStart(7)}  gem ${t(s?.mean, m.decimals).padStart(7)}  [${t(s?.min, m.decimals)}–${t(s?.max, m.decimals)}]`);
  }
  console.log(`kortste herstel per kandidaat: ${JSON.stringify(meting.minRecoveryBuckets)}`);
  console.log(`structuurfamilies: ${meting.structureFamilies.unique} uniek van ${meting.structureFamilies.total}; gemiddeld ${meting.structureFamilies.perRunMean.toFixed(2)} per run`);
  console.log(`rekentijd per run: ${t(meting.runtime?.mean, 0)} s`);
  console.log(`Geschreven: ${doel}`);
  if (existsSync(doel)) await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (fout) => {
    console.error(fout);
    await prisma.$disconnect();
    process.exit(1);
  });
}
