import { writeFileSync } from "node:fs";
import path from "node:path";
import { readRuns } from "../benchmark/io";

/**
 * Wat de zoekstappen doen: starts, reparaties per doel, bijschaven, en uit
 * welke stap de gekozen kandidaten komen (werkopdracht §13, §17, §18).
 *
 * Leest alleen het zoekjournaal dat elke run al bewaart; er wordt niets
 * opnieuw gerekend.
 *
 *   npm run final-brain:repair-analysis -- after human ab-…
 */

interface Entry {
  readonly kind: string;
  readonly target?: string | null;
  readonly verdict?: string;
  readonly polish?: { gain?: number; moves?: unknown[] } | null;
  readonly deltaToParent?: Record<string, number | null> | null;
}

function analyseer(fase: string) {
  const runs = readRuns(fase).filter((r) => r.strategy !== "REPRODUCE");
  const perDoel: Record<string, { attempts: number; accepted: number; rejected: number; failed: number; other: number }> = {};
  const perSoort: Record<string, number> = {};
  const herkomst: Record<string, number> = {};
  let bijschaafWinst = 0;
  let bijschaafRuns = 0;
  let reparatiesPerRun = 0;
  const stop: Record<string, number> = {};
  for (const run of runs) {
    const journaal = (run.generationRun.searchJournal as { entries?: Entry[]; stopReason?: string } | null) ?? {};
    const entries = journaal.entries ?? [];
    stop[journaal.stopReason ?? "—"] = (stop[journaal.stopReason ?? "—"] ?? 0) + 1;
    for (const e of entries) {
      perSoort[e.kind] = (perSoort[e.kind] ?? 0) + 1;
      if (e.polish && typeof e.polish.gain === "number") {
        bijschaafWinst += e.polish.gain;
        bijschaafRuns += 1;
      }
      if (e.kind !== "REPAIR") continue;
      reparatiesPerRun += 1;
      const doel = e.target ?? "—";
      const rij = (perDoel[doel] ??= { attempts: 0, accepted: 0, rejected: 0, failed: 0, other: 0 });
      rij.attempts += 1;
      if (e.verdict === "VALID_ELITE") rij.accepted += 1;
      else if (e.verdict === "REPAIR_REJECTED") rij.rejected += 1;
      else if (e.verdict === "REPAIR_FAILED") rij.failed += 1;
      else rij.other += 1;
    }
    for (const k of run.candidates) {
      const lijn = ((k.provenance ?? {}) as { lineage?: { kind: string; target: string | null }[] }).lineage ?? [];
      const sleutel = lijn.map((l) => (l.target ? `${l.kind}:${l.target}` : l.kind)).join(" → ") || "—";
      herkomst[sleutel] = (herkomst[sleutel] ?? 0) + 1;
    }
  }
  return {
    phase: fase,
    runs: runs.length,
    attemptsByKind: perSoort,
    repairsPerRun: runs.length ? reparatiesPerRun / runs.length : 0,
    repairsByTarget: perDoel,
    polishMeanGain: bijschaafRuns ? bijschaafWinst / bijschaafRuns : null,
    finalCandidateLineage: Object.fromEntries(Object.entries(herkomst).sort((a, b) => b[1] - a[1])),
    stopReasons: stop,
  };
}

function main() {
  const fasen = process.argv.slice(2);
  const uit = fasen.map(analyseer);
  writeFileSync(
    path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "repair-analysis.json"),
    `${JSON.stringify({ schema: "ns-final-brain-repair-analysis/1", measuredAt: new Date().toISOString(), phases: uit }, null, 2)}\n`,
  );
  for (const f of uit) {
    console.log(`${f.phase}: ${f.runs} runs · ${f.repairsPerRun.toFixed(1)} reparaties per run · bijschaven gem. +${f.polishMeanGain?.toFixed(2)}`);
    for (const [doel, r] of Object.entries(f.repairsByTarget)) console.log(`   ${doel.padEnd(12)} ${r.attempts} pogingen · ${r.accepted} aanvaard · ${r.rejected} afgewezen · ${r.failed} mislukt`);
    console.log(`   herkomst gekozen kandidaten: ${JSON.stringify(f.finalCandidateLineage)}`);
  }
}

main();
