import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V2, QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { BENCHMARK_ROOT, decodeAssignments, readRuns } from "../benchmark/io";
import { MACHINIST_METRICS, type MachinistMetrics, measureMachinist, measureMachinistOfficial } from "./metrics";

/**
 * Meet benchmarkfasen voor de machinistenronde: elke kandidaat met model v2
 * (vastgepind, Final Brain) én v3, de operationele eisen en de voorkeur per profiel.
 *
 *   npx tsx --conditions=react-server scripts/machinist/measure-phases.ts --phases brain-after,mp-m1,mp-m2 [--strategy BALANCED]
 *
 * Fasen uit de bevroren kopie (ns-roosterplatform-mp) worden eerst naar
 * docs/optimizer-benchmark gekopieerd; daar horen alle runbestanden.
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences", "phases");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

export interface PhaseFile {
  readonly schema: "ns-machinist-phase/1";
  readonly phase: string;
  readonly measuredAt: string;
  readonly qualityModelV2Hash: string;
  readonly qualityModelV3Hash: string;
  readonly strategyFilter: string | null;
  readonly runs: readonly { run: number; strategy: string; variant: unknown; status: string; seconds: number | null; candidates: number }[];
  readonly candidates: readonly (MachinistMetrics & { run: number; strategy: string; rank: number })[];
  readonly means: Readonly<Record<string, number | null>>;
}

export function means(lijst: readonly MachinistMetrics[]): Record<string, number | null> {
  return Object.fromEntries(
    MACHINIST_METRICS.map((m) => {
      const w = lijst.map(m.get).filter((x): x is number => x !== null);
      return [m.key, w.length ? Number((w.reduce((a, b) => a + b, 0) / w.length).toFixed(3)) : null];
    }),
  );
}

async function main() {
  const fasen = (argument("phases") ?? "brain-after").split(",");
  const strategie = argument("strategy");
  mkdirSync(MAP, { recursive: true });
  const context = await loadEvaluationContextCore("DDR");
  const officieel = measureMachinistOfficial(context);
  writeFileSync(
    path.join(MAP, "official.json"),
    `${JSON.stringify({ schema: "ns-machinist-phase/1", phase: "official", measuredAt: new Date().toISOString(), qualityModelV2Hash: hash(QUALITY_MODEL_V2), qualityModelV3Hash: hash(QUALITY_MODEL_V3), official: officieel, means: means([officieel]) }, null, 2)}\n`,
  );
  for (const fase of fasen) {
    const map = path.join(BENCHMARK_ROOT, fase);
    if (!existsSync(map)) {
      console.log(`${fase}: geen map ${map}`);
      continue;
    }
    const runs = readRuns(fase).filter((r) => r.strategy !== "REPRODUCE" && (!strategie || r.strategy === strategie));
    const kandidaten = runs.flatMap((r) =>
      r.candidates.map((k, i) => ({ ...measureMachinist(decodeAssignments(k.roster), context), run: r.runNumber, strategy: r.strategy, rank: i + 1 })),
    );
    const bestand: PhaseFile = {
      schema: "ns-machinist-phase/1",
      phase: fase,
      measuredAt: new Date().toISOString(),
      qualityModelV2Hash: hash(QUALITY_MODEL_V2),
      qualityModelV3Hash: hash(QUALITY_MODEL_V3),
      strategyFilter: strategie,
      runs: runs.map((r) => ({ run: r.runNumber, strategy: r.strategy, variant: r.variant ?? null, status: r.generationRun.status, seconds: r.runtimeSeconds, candidates: r.candidates.length })),
      candidates: kandidaten,
      means: means(kandidaten),
    };
    writeFileSync(path.join(MAP, `${fase}${strategie ? `-${strategie}` : ""}.json`), `${JSON.stringify(bestand, null, 2)}\n`);
    const g = bestand.means;
    console.log(
      `${fase.padEnd(12)} ${kandidaten.length} kandidaten · operationeel ${kandidaten.filter((k) => k.operational.compliant).length}/${kandidaten.length} · voorkeur ${g.preference} (aff ${g.affinity}, rest ${g.restDuties}, dag ${g.dayDuties}, pop ${g.popularFairness}, wknd ${g.weekendStart}) · v3 ${g.robustV3} · v2 ${g.robustV2} · slechtste regel ${g.worstLineV2} · losse ${g.singletons} · paren ${g.pairs} · uitgang ${g.worstNightExit} · rust ${g.rest} · uren ${g.hours} · eerlijk ${g.fairness}`,
    );
  }
  const o = means([officieel]);
  console.log(`officieel    voorkeur ${o.preference} (aff ${o.affinity}, rest ${o.restDuties}, dag ${o.dayDuties}, pop ${o.popularFairness}, wknd ${o.weekendStart}) · v3 ${o.robustV3} · v2 ${o.robustV2}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
