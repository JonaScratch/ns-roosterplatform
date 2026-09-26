import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import type { BenchmarkRunResult, DualQualityMeasurement } from "../types";

/**
 * Geschiedenis van benchmarkscores door de tijd — de grondstof voor de
 * "Vooruitgang"-pagina (v0.2 §4, grafiek 1/2/4). Append-only JSONL, net als
 * `store/runlog.ts`: een crash kost hooguit de laatst onvoltooide regel.
 *
 * Bewust een apart bestand van `runlog.ts`: dat is het experimentgeheugen
 * (hypothese → uitkomst), dit is puur de tijdreeks van gemeten scores, ook
 * losse benchmarkruns die nooit tot een experiment leidden.
 */

export interface BenchmarkHistoryEntry {
  readonly timestamp: string;
  readonly runLabel: string;
  readonly label: string;
  readonly benchmark: BenchmarkRunResult;
  readonly preDualQuality?: DualQualityMeasurement;
  readonly dualQuality?: DualQualityMeasurement;
  readonly holdoutDualQuality?: DualQualityMeasurement;
}

function historyPath(): string {
  return path.join(DATA_DIR, "benchmark-history.jsonl");
}

export function appendBenchmarkHistory(entry: BenchmarkHistoryEntry): void {
  const file = historyPath();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

export function readBenchmarkHistory(): readonly BenchmarkHistoryEntry[] {
  const file = historyPath();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BenchmarkHistoryEntry);
}
