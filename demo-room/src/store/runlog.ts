import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import type { ExperimentRecord } from "../types";

/**
 * Het append-only experimentgeheugen van de Demo Room.
 *
 * ## Waarom JSONL, en waarom append-only
 *
 * Eén regel per experiment, altijd toegevoegd en nooit herschreven. Een run
 * die halverwege crasht, verliest daardoor nooit meer dan de regel die nog niet
 * af was — nooit de vijftig minuten ervoor (§22 van de opdracht). Een los
 * bestand per run zou hetzelfde risico geven als een proces het juist bij het
 * afsluiten had moeten wegschrijven.
 */

function runlogPath(runId: string): string {
  return path.join(DATA_DIR, "runs", `${runId}.jsonl`);
}

export function appendExperiment(record: ExperimentRecord): void {
  const file = runlogPath(record.runId);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readRunlog(runId: string): readonly ExperimentRecord[] {
  const file = runlogPath(runId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ExperimentRecord);
}

/** Alle runs die ooit iets hebben weggeschreven, nieuwste eerst. */
export function listRunIds(): readonly string[] {
  const dir = path.join(DATA_DIR, "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""))
    .sort()
    .reverse();
}

/** Alle experimenten over alle runs heen — voor duplicaatdetectie en HANDOFF.md. */
export function readAllExperiments(): readonly ExperimentRecord[] {
  return listRunIds().flatMap((id) => readRunlog(id));
}
