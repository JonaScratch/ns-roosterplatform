import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import type { AutonomyCapabilityTestResult } from "../types";

/**
 * Bewaarplaats van de Zelfstandigheidstest-resultaten (§7-§13 van de finale
 * integratieronde). Eén JSON-bestand per run, zoals de rest van de Demo
 * Room-status — plat, leesbaar, niet ingecheckt (zie `.gitignore`).
 */

const DIR = path.join(DATA_DIR, "autonomy");

function ensureDir(): void {
  mkdirSync(DIR, { recursive: true });
}

export function writeAutonomyResult(result: AutonomyCapabilityTestResult): void {
  ensureDir();
  writeFileSync(path.join(DIR, `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function listAutonomyResults(): readonly AutonomyCapabilityTestResult[] {
  ensureDir();
  const bestanden = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  return bestanden
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as AutonomyCapabilityTestResult)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getAutonomyResult(id: string): AutonomyCapabilityTestResult | null {
  const bestand = path.join(DIR, `${id}.json`);
  if (!existsSync(bestand)) return null;
  return JSON.parse(readFileSync(bestand, "utf8")) as AutonomyCapabilityTestResult;
}
