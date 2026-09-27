import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import type { AutonomousDevelopmentRunResult } from "../develop/autonomousDevelopmentRun";

/**
 * Bewaarplaats van Development Run-resultaten (§ UI/UX REBUILD — Dashboard,
 * Development Runs en Candidates lezen hier hun data uit).
 *
 * `runAutonomousDevelopmentRun()` (`develop/autonomousDevelopmentRun.ts`) gaf
 * tot nu toe alleen een in-memory resultaat terug — er bestond nog geen
 * manier om een eerdere run terug te vinden nadat het proces stopte. Dit
 * bestand voegt precies dat toe, in hetzelfde vlakke-JSON-bestand-per-run-
 * patroon als `store/autonomyResults.ts` (waarvan de Zelfstandigheidstest
 * dezelfde behoefte had) — geen nieuwe waarheid, alleen persistentie voor een
 * resultaat dat al bestond.
 */

const DIR = path.join(DATA_DIR, "development-runs");

function ensureDir(): void {
  mkdirSync(DIR, { recursive: true });
}

export function writeDevelopmentRunResult(result: AutonomousDevelopmentRunResult): void {
  ensureDir();
  writeFileSync(path.join(DIR, `${result.runId}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function listDevelopmentRunResults(): readonly AutonomousDevelopmentRunResult[] {
  ensureDir();
  const bestanden = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  return bestanden
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as AutonomousDevelopmentRunResult)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getDevelopmentRunResult(runId: string): AutonomousDevelopmentRunResult | null {
  const bestand = path.join(DIR, `${runId}.json`);
  if (!existsSync(bestand)) return null;
  return JSON.parse(readFileSync(bestand, "utf8")) as AutonomousDevelopmentRunResult;
}

/** Eén platte rij per kandidaat, over ALLE runs heen — de brongegevens voor de Candidates-pagina (§ foto 4). */
export interface CandidateRow {
  readonly candidateId: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly label: string;
  readonly category: string;
  readonly targetedWeakness: string | null;
  readonly benchmarkDev: number | null;
  readonly benchmarkDelta: number | null;
  readonly holdout: number | null;
  readonly holdoutDelta: number | null;
  /** Afgeleid uit `beoordeelProofOfValue()`'s eigen regressiecontrole (geen apart "validator"-veld in de meting) — PASS alleen als er echt geen regressie was. */
  readonly validator: "PASS" | "FAIL" | null;
  readonly decision: "PROMOTION_CANDIDATE" | "REJECTED" | "KEEP_TESTING";
  readonly reasoning: string;
  readonly versionId: string | null;
}

function averageOf(agent: Record<string, unknown>): number | null {
  const waarden = Object.entries(agent)
    .filter(([k]) => k !== "latencyMs")
    .map(([, v]) => v)
    .filter((v): v is number => typeof v === "number");
  return waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : null;
}

/** Alle kandidaten uit alle bewaarde development runs, meest recente eerst — nooit alleen de gepromoveerde. */
export function listAllCandidates(): readonly CandidateRow[] {
  const runs = listDevelopmentRunResults();
  const rijen: CandidateRow[] = [];
  for (const run of runs) {
    for (const cycle of run.cycles) {
      if (!cycle.candidate || !cycle.proof || cycle.decision === "NOT_EXECUTED") continue;
      const preGem = averageOf(cycle.proof.pre.agent as unknown as Record<string, unknown>);
      const postGem = averageOf(cycle.proof.post.agent as unknown as Record<string, unknown>);
      const preHoldoutGem = averageOf(cycle.proof.preHoldout.agent as unknown as Record<string, unknown>);
      const holdoutGem = averageOf(cycle.proof.holdout.agent as unknown as Record<string, unknown>);
      rijen.push({
        candidateId: cycle.candidate.id,
        runId: run.runId,
        createdAt: cycle.proof.startedAt,
        label: cycle.candidate.label,
        category: cycle.candidate.category,
        targetedWeakness: cycle.weakness.weakestDimension,
        benchmarkDev: postGem,
        benchmarkDelta: postGem !== null && preGem !== null ? postGem - preGem : null,
        holdout: holdoutGem,
        holdoutDelta: holdoutGem !== null && preHoldoutGem !== null ? holdoutGem - preHoldoutGem : null,
        validator: cycle.proof.executed ? (cycle.proof.regressions.length === 0 ? "PASS" : "FAIL") : null,
        decision: cycle.decision,
        reasoning: cycle.proof.reasoning,
        versionId: cycle.version?.id ?? null,
      });
    }
  }
  return rijen.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
