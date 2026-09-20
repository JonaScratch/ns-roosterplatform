import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CandidateAssignment } from "@/domain/candidate";

/**
 * Het bestandsformaat van de optimizerbenchmark.
 *
 * ## Waarom de ruwe uitkomst en niet de scores worden bewaard
 *
 * Een run bewaart wat de engine opleverde: de toewijzingen, de solverstatistiek,
 * het oordeel van de eindvalidatie en de tijden. De kwaliteitsmaten worden
 * daarna uit die ruwe gegevens berekend, voor BEFORE en AFTER met dezelfde
 * evaluator. Blijkt een maat tijdens de ontwikkeling fout, dan wordt hij
 * gerepareerd en worden beide fases opnieuw doorgerekend — zonder één solver
 * opnieuw te draaien, en zonder dat de ene fase met een andere maat is gemeten
 * dan de andere.
 */

export const BENCHMARK_ROOT = path.resolve(__dirname, "..", "..", "docs", "optimizer-benchmark");

/**
 * De meetfasen. "human" is de AFTER-meting van de ijking op de menselijke
 * roosters (engine adaptive-1.0.4-rhythm; de eerste metingen heetten 1.0.5); de BEFORE daarvan is "after" (v1.0.4),
 * met hetzelfde kwaliteitsmodel v2 opnieuw doorgerekend. "human-dev1" is de
 * eerste AFTER-meting, vóór de herziening H09 van de meetdefinities; bewaard
 * als ontwikkelmeting en met de definitieve v2 opnieuw door te rekenen.
 */
export type Phase = "before" | "after" | "ablation" | "budget" | "human" | "human-dev1" | (string & {});

export interface RawCandidate {
  readonly number: number;
  readonly candidateId: string;
  readonly label: string;
  readonly validationState: string;
  readonly confirmedHardViolations: number | null;
  readonly perRule: readonly { ruleId: string; uniqueViolations: number; confidence: string }[];
  readonly solver: Record<string, unknown> | null;
  /** Provenance van de adaptieve engine: poging, ouder, gewichten. Null bij legacy. */
  readonly provenance: Record<string, unknown> | null;
  /** Per basisrooster per regel|week zeven cellen: dienstnummer of ~POSITIE. */
  readonly roster: Record<string, Record<string, readonly string[]>>;
}

export interface RawRun {
  readonly schema: "ns-optimizer-benchmark-run/1";
  readonly phase: Phase;
  readonly runNumber: number;
  readonly engine: string;
  readonly mode: string | null;
  readonly strategy: string;
  readonly label: string;
  readonly manifestHash: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly runtimeSeconds: number;
  readonly generationRun: {
    readonly id: string;
    readonly status: string;
    readonly requested: number;
    readonly found: number;
    readonly stageMessage: string | null;
    readonly failureReason: string | null;
    readonly log: unknown;
    readonly searchJournal: unknown;
    readonly counters: unknown;
  };
  readonly candidates: readonly RawCandidate[];
  readonly diversity: readonly { a: number; b: number; changedDutyDays: number }[];
  readonly resources: {
    readonly peakPythonWorkingSetBytes: number | null;
    readonly peakNodeRssBytes: number;
    readonly logicalCpus: number;
  };
  readonly ablation?: string | null;
  /** Het zoekmachineprofiel en eventuele ablatie (NS_ENGINE_PROFILE / NS_ENGINE_VARIANT). */
  readonly variant?: Record<string, unknown> | null;
}

export function encodeAssignments(assignments: readonly CandidateAssignment[]): RawCandidate["roster"] {
  const uit: Record<string, Record<string, string[]>> = {};
  for (const entry of assignments) {
    const rooster = (uit[entry.baseRosterCode] ??= {});
    const sleutel = `${entry.lineNumber}|${entry.weekIndex}`;
    const cellen = (rooster[sleutel] ??= Array.from({ length: 7 }, () => "~RUST"));
    cellen[entry.weekday - 1] =
      entry.positionType === "DUTY" ? (entry.dutyCode ?? "~LEEG") : `~${entry.positionType}`;
  }
  return uit;
}

export function decodeAssignments(roster: RawCandidate["roster"]): CandidateAssignment[] {
  const uit: CandidateAssignment[] = [];
  for (const [code, regels] of Object.entries(roster)) {
    for (const [sleutel, cellen] of Object.entries(regels)) {
      const [lineNumber, weekIndex] = sleutel.split("|").map(Number);
      cellen.forEach((cel, index) => {
        const structureel = cel.startsWith("~");
        uit.push({
          baseRosterCode: code,
          lineNumber,
          weekIndex,
          weekday: index + 1,
          positionType: (structureel ? (cel === "~LEEG" ? "DUTY" : cel.slice(1)) : "DUTY") as CandidateAssignment["positionType"],
          dutyCode: structureel ? null : cel,
        });
      });
    }
  }
  return uit;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function runFile(phase: Phase, runNumber: number): string {
  return path.join(BENCHMARK_ROOT, phase, `run-${String(runNumber).padStart(3, "0")}.json`);
}

export function readRuns(phase: Phase): RawRun[] {
  const map = path.join(BENCHMARK_ROOT, phase);
  if (!existsSync(map)) {
    return [];
  }
  return readdirSync(map)
    .filter((naam) => /^run-\d+\.json$/.test(naam))
    .sort()
    .map((naam) => readJson<RawRun>(path.join(map, naam)));
}
