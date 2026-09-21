import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V2, QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { prisma } from "@/server/data/prisma";
import { describeVariant, engineVariant } from "@/server/generation/adaptive/variant";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { decodeAssignments, readRuns } from "../benchmark/io";
import { MACHINIST_METRICS, measureMachinist, measureMachinistOfficial } from "../machinist/metrics";

/**
 * Spoor A van het benchmarkprogramma: de roosterengine zoals hij nu draait.
 *
 * ## Waarom M0 de bestaande AFTER-fase meet en niet opnieuw twintig runs draait
 *
 * De enginecode is sinds die meting niet veranderd (zie `baseline-manifest.json`:
 * dezelfde vingerafdrukken, dezelfde configuratieafdruk, dezelfde variant), en de
 * meetbasis is aantoonbaar gelijk aan het BEFORE-manifest. Twintig identieke runs
 * opnieuw draaien kost twee uur rekentijd en levert dezelfde meting op, op de ruis van
 * CP-SAT na. Verandert de engine in een latere fase, dan wordt die fase wél opnieuw
 * gedraaid — dat is precies waar M1 tot en met M3 voor zijn.
 *
 *   npx tsx --conditions=react-server scripts/v105/m0-engine.ts [--fase mp-after]
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const WORTEL = path.resolve(__dirname, "..", "..");
const hash = (x: unknown) => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex").slice(0, 16);

async function main() {
  const fase = argument("fase") ?? "mp-after";
  const meting = argument("meting") ?? "m0";
  const map = path.join(WORTEL, "docs", "v1.0.5", "benchmarks", meting);
  mkdirSync(map, { recursive: true });

  const context = await loadEvaluationContextCore("DDR");
  const runs = readRuns(fase).filter((r) => r.strategy !== "REPRODUCE");
  if (runs.length === 0) throw new Error(`fase ${fase} heeft geen runs`);

  const kandidaten = runs.flatMap((r) =>
    r.candidates.map((k, i) => ({ ...measureMachinist(decodeAssignments(k.roster), context), run: r.runNumber, strategy: r.strategy, rank: i + 1 })),
  );
  const officieel = measureMachinistOfficial(context);

  const gem = (xs: (number | null)[]) => {
    const w = xs.filter((x): x is number => x !== null);
    return w.length ? Number((w.reduce((a, b) => a + b, 0) / w.length).toFixed(3)) : null;
  };
  const maten = Object.fromEntries(MACHINIST_METRICS.map((m) => [m.key, gem(kandidaten.map(m.get))]));
  const officieleMaten = Object.fromEntries(MACHINIST_METRICS.map((m) => [m.key, m.get(officieel)]));

  // Rekentijd en zoekinspanning uit de runbestanden zelf.
  const tellers = runs.map((r) => (r.generationRun.counters ?? {}) as Record<string, number>);
  const som = (veld: string) => tellers.reduce((s, c) => s + (Number(c[veld]) || 0), 0);
  const inspanning = {
    runs: runs.length,
    candidates: kandidaten.length,
    uniqueStructureFamilies: new Set(kandidaten.map((k) => k.base.structureFamily)).size,
    meanRuntimeSeconds: Number((runs.reduce((s, r) => s + r.runtimeSeconds, 0) / runs.length).toFixed(1)),
    meanSolverSeconds: Number((som("solverSecondsTotal") / runs.length).toFixed(1)),
    attemptsTotal: som("attempts"),
    validCandidates: som("validCandidates"),
    rejectedLowQuality: som("lowQuality"),
    duplicates: som("duplicates"),
    repairsAccepted: som("repairsAccepted"),
    repairsRejectedRegression: som("repairsRejectedRegression"),
  };

  const hard = {
    hardValid: kandidaten.filter((k) => k.base.hard.valid).length,
    fullCoverage: kandidaten.filter((k) => k.base.hard.unassigned === 0).length,
    noProfileBreaches: kandidaten.filter((k) => k.base.hard.profileBreaches === 0).length,
    operationalCompliant: kandidaten.filter((k) => k.operational.compliant).length,
    total: kandidaten.length,
  };

  const manifest = JSON.parse(readFileSync(path.join(WORTEL, "docs", "optimizer-benchmark", "manifest.json"), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const uit = {
    schema: "ns-v105-engine-measurement/1",
    measurement: meting,
    measuredAt: new Date().toISOString(),
    sourcePhase: fase,
    why: "De engine is sinds deze fase niet gewijzigd; de vingerafdrukken in baseline-manifest.json bewijzen dat. M1–M3 draaien wél nieuwe runs zodra de engine verandert.",
    environment: {
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: WORTEL, encoding: "utf8" }).trim(),
      branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: WORTEL, encoding: "utf8" }).trim(),
      engineVariant: describeVariant(engineVariant({})),
      qualityModelV2Hash: hash(QUALITY_MODEL_V2),
      qualityModelV3Hash: hash(QUALITY_MODEL_V3),
      ruleset: manifest.ruleset,
      dutyPackage: manifest.data.dutyPackage,
      machine: manifest.machine,
      runManifestHashes: [...new Set(runs.map((r) => r.manifestHash))],
      runVariants: [...new Set(runs.map((r) => JSON.stringify(r.variant ?? null)))].map((s) => JSON.parse(s)),
      strategies: Object.fromEntries(runs.reduce((m, r) => m.set(r.strategy, (m.get(r.strategy) ?? 0) + 1), new Map<string, number>())),
      mode: runs[0].mode,
    },
    hard,
    effort: inspanning,
    means: maten,
    official: officieleMaten,
    perCandidate: kandidaten.map((k) => ({ run: k.run, strategy: k.strategy, rank: k.rank, ...Object.fromEntries(MACHINIST_METRICS.map((m) => [m.key, m.get(k)])) })),
  };
  writeFileSync(path.join(map, "engine.json"), `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`${meting} · engine uit fase ${fase}: ${runs.length} runs, ${kandidaten.length} kandidaten, ${inspanning.uniqueStructureFamilies} verschillende structuurfamilies`);
  console.log(`  hard geldig ${hard.hardValid}/${hard.total} · volledige dekking ${hard.fullCoverage}/${hard.total} · operationele eisen ${hard.operationalCompliant}/${hard.total}`);
  console.log(`  rekentijd ${inspanning.meanRuntimeSeconds}s per run (solver ${inspanning.meanSolverSeconds}s) · pogingen ${inspanning.attemptsTotal} · reparaties ${inspanning.repairsAccepted} aangenomen, ${inspanning.repairsRejectedRegression} afgewezen`);
  for (const m of MACHINIST_METRICS) console.log(`  ${m.label.padEnd(38)} ${String(maten[m.key]).padStart(8)}   (officieel ${officieleMaten[m.key]})`);
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
