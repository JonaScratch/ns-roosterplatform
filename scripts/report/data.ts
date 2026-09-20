import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Alles wat het rapport beweert, komt hier vandaan.
 *
 * ## Waarom dit stuk stopt in plaats van iets in te vullen
 *
 * Een ontwikkelrapport met een voorbeeldgetal erin is erger dan geen rapport:
 * wie het leest kan niet zien welk cijfer gemeten is en welk cijfer ooit als
 * plaatshouder is neergezet. Ontbreekt een bestand of een meting, dan stopt de
 * bouw met de naam van wat ontbreekt en wat je moet draaien om het te krijgen.
 */

const WORTEL = path.resolve(__dirname, "..", "..");
export const BENCHMARK = path.join(WORTEL, "docs", "optimizer-benchmark");

function lees<T>(bestand: string, hoeTeKrijgen: string): T {
  if (!existsSync(bestand)) {
    throw new Error(
      `Ontbreekt: ${path.relative(WORTEL, bestand)}. ${hoeTeKrijgen} Het rapport wordt niet gebouwd met verzonnen cijfers.`,
    );
  }
  return JSON.parse(readFileSync(bestand, "utf8")) as T;
}

export interface Stat {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly sd: number;
}

export interface Oordeel {
  readonly delta: number | null;
  readonly percent: number | null;
  readonly verdict: "beter" | "slechter" | "gelijk" | "onbekend";
}

export interface Vergelijking {
  readonly before: Stat;
  readonly after: Stat;
  readonly mean: Oordeel;
  readonly median: Oordeel;
  readonly best: Oordeel;
  readonly worst: Oordeel;
}

export interface MetricVergelijking {
  readonly key: string;
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly unit: string;
  readonly official: number | null;
  readonly overall: Vergelijking | null;
  readonly perStrategy: Record<string, Vergelijking | null>;
}

export interface Analyse {
  readonly generatedAt: string;
  readonly qualityModel: Record<string, unknown>;
  readonly counts: Record<"before" | "after", { runs: number; candidates: number }>;
  readonly hardValidity: {
    readonly beforeAllValid: boolean;
    readonly afterAllValid: boolean;
    readonly beforeValidationStates: Record<string, number>;
    readonly afterValidationStates: Record<string, number>;
  };
  readonly regression: readonly {
    key: string;
    label: string;
    before: number | null;
    after: number | null;
    mustBe: number;
    pass: boolean;
  }[];
  readonly headline: readonly {
    key: string;
    label: string;
    meanVerdict: string;
    medianVerdict: string;
    worstVerdict: string;
  }[];
  readonly metrics: readonly MetricVergelijking[];
  readonly perRun: {
    readonly bestRobust: {
      readonly overall: Vergelijking | null;
      readonly winRate: WinstKans;
      readonly perStrategy: Record<string, { comparison: Vergelijking | null; winRate: WinstKans }>;
    };
    readonly meanRobust: Vergelijking | null;
    readonly minDiversity: Vergelijking | null;
    readonly runtimeSeconds: Vergelijking | null;
    readonly candidatesFound: Vergelijking | null;
  };
  readonly perProfile: readonly {
    roster: string;
    metrics: readonly { key: string; label: string; higherIsBetter: boolean; comparison: Vergelijking | null }[];
  }[];
  readonly searchEfficiency: Record<string, number | null | Record<string, number>>;
}

export interface WinstKans {
  readonly pairs: number;
  readonly wonByRank: number;
  readonly tiedByRank: number;
  readonly lostByRank: number;
  readonly allPairsProbability: number | null;
}

export interface Manifest {
  readonly phase: string;
  readonly createdAt: string;
  readonly git: { readonly commit: string; readonly branch: string; readonly dirty: boolean };
  readonly version: string;
  readonly data: Record<string, unknown>;
  readonly hashes: Record<string, string>;
  readonly ruleset: { readonly version: string; readonly legalStatus: string; readonly rules: number };
  readonly optimizerConfig: Record<string, unknown>;
  readonly machine: Record<string, unknown>;
  readonly rosters?: readonly Record<string, unknown>[];
}

export interface Groep {
  readonly phase: string;
  readonly strategy: string;
  readonly mode: string | null;
  readonly ablation: string | null;
  readonly runs: number;
  readonly candidates: number;
  readonly runtimeSeconds: Stat;
  readonly metrics: Record<string, Stat>;
  readonly stopReasons?: Record<string, number>;
}

export interface Summary {
  readonly generatedAt: string;
  readonly qualityModel: Record<string, unknown>;
  readonly official: Record<string, unknown>;
  readonly groups: readonly Groep[];
  readonly metrics: readonly { key: string; label: string; higherIsBetter: boolean; unit: string }[];
  readonly rawRuns: readonly string[];
}

export interface OntwikkelLog {
  readonly entries: readonly {
    id: string;
    date: string;
    phase: string;
    component: string;
    change: string;
    reason: string;
    observedEffect: string;
    outcome: string;
  }[];
}

export interface PolishBudget {
  readonly measuredAt: string;
  readonly budgets: readonly number[];
  readonly results: readonly {
    candidate: string;
    start: Record<string, unknown>;
    budgets: readonly {
      seconds: number;
      variants: number;
      swaps: number;
      gain: number;
      stopReason: string;
      after: Record<string, unknown>;
    }[];
  }[];
}

export interface CandidateRow {
  readonly phase: string;
  readonly strategy: string;
  readonly run: number;
  readonly candidate: number;
  readonly [key: string]: unknown;
}

export interface RunRow {
  readonly phase: string;
  readonly strategy: string;
  readonly run: number;
  readonly status: string;
  readonly found: number;
  readonly runtimeSeconds: number;
  readonly bestRobust: number | null;
  readonly meanRobust: number | null;
  readonly minDiversity: number | null;
  readonly peakPythonMB: number | null;
  readonly peakNodeMB: number | null;
  readonly [key: string]: unknown;
}

export interface TestUitslag {
  readonly ranAt: string;
  readonly suites: readonly {
    name: string;
    command: string;
    ok: boolean;
    summary: string;
    seconds: number;
  }[];
}

export interface HandmatigeControle {
  readonly reviewedAt: string;
  readonly phase: string;
  readonly candidate: { run: number; strategy: string; candidate: number; robust: number };
  readonly rosters: readonly {
    roster: string;
    nights: number;
    nightBlocks: readonly number[];
    worstLine: number;
    bestLine: number;
    minRecoveryHours: number | null;
    earlyDuties: number;
  }[];
  readonly checklist: readonly { punt: string; bevinding: string; oordeel: string; opmerking?: string }[];
  readonly conclusion?: string;
}

export interface RapportGegevens {
  readonly manifestBefore: Manifest;
  readonly manifestAfter: Manifest;
  readonly summary: Summary;
  readonly analyse: Analyse;
  readonly log: OntwikkelLog;
  readonly polish: PolishBudget;
  readonly kandidaten: readonly CandidateRow[];
  readonly runs: readonly RunRow[];
  readonly optimizerConfig: Record<string, unknown>;
  readonly qualityConfig: Record<string, unknown>;
  readonly tests: TestUitslag | null;
  readonly review: HandmatigeControle | null;
  readonly ablatie: readonly RunRow[];
}

export function laadGegevens(): RapportGegevens {
  const summary = lees<Summary>(
    path.join(BENCHMARK, "benchmark-summary.json"),
    "Draai `npm run verify:optimizer-benchmark -- evaluate`.",
  );
  const analyse = lees<Analyse>(
    path.join(BENCHMARK, "analysis.json"),
    "Draai `npm run analyse:optimizer` nadat beide fasen zijn gemeten.",
  );
  const kandidaten = lees<CandidateRow[]>(path.join(BENCHMARK, "tables", "candidates.json"), "Draai `evaluate`.");
  const runs = lees<RunRow[]>(path.join(BENCHMARK, "tables", "runs.json"), "Draai `evaluate`.");
  if (!kandidaten.some((rij) => rij.phase === "after")) {
    throw new Error("Er zijn geen AFTER-kandidaten. Geen AFTER, geen rapport.");
  }
  const testBestand = path.join(BENCHMARK, "test-results.json");
  return {
    manifestBefore: lees<Manifest>(path.join(BENCHMARK, "manifest.json"), "Draai `manifest --phase before`."),
    manifestAfter: lees<Manifest>(path.join(BENCHMARK, "manifest-after.json"), "Draai `manifest --phase after`."),
    summary,
    analyse,
    log: lees<OntwikkelLog>(path.join(BENCHMARK, "development-log.json"), "Dit bestand hoort in de repository te staan."),
    polish: lees<PolishBudget>(
      path.join(BENCHMARK, "polish-budget.json"),
      "Draai `npm run measure:polish-budget`.",
    ),
    kandidaten,
    runs,
    optimizerConfig: lees<Record<string, unknown>>(
      path.join(WORTEL, "configs", "optimizer-config-v1.0.4.json"),
      "Draai `npm run config:write`.",
    ),
    qualityConfig: lees<Record<string, unknown>>(
      path.join(WORTEL, "configs", "quality-model-v1.json"),
      "Draai `npm run config:write`.",
    ),
    tests: existsSync(testBestand) ? (JSON.parse(readFileSync(testBestand, "utf8")) as TestUitslag) : null,
    review: existsSync(path.join(BENCHMARK, "manual-review.json"))
      ? (JSON.parse(readFileSync(path.join(BENCHMARK, "manual-review.json"), "utf8")) as HandmatigeControle)
      : null,
    ablatie: runs.filter((rij) => rij.phase === "ablation" || rij.ablation !== null),
  };
}
