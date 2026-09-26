import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { benchAnswer } from "@/server/agent/bench-adapter";
import type { ChatModel } from "@/server/agent/model/types";
import { DEMO_ROOM_ROOT } from "../config";
import type { BenchmarkRunResult, BenchmarkVariance } from "../types";

/**
 * De benchmarkrunner: dev/holdout/hidden door de bestaande `benchAnswer()`
 * van de hoofdapp (§15/§16 van de opdracht — PRE/POST, nooit overfitten op
 * dev alleen). Deze module bouwt geen eigen beoordelingslogica: het oordeel
 * (GOED/FOUT/ONBEOORDEELD) komt uit `bench-adapter.ts`, dezelfde plek die de
 * hoofdapp zelf gebruikt.
 */

export type Suite = "dev" | "holdout" | "hidden";
export type Json = Record<string, unknown>;

export function loadSuite(suite: Suite): { readonly note: string; readonly items: readonly Json[] } {
  const file = path.join(DEMO_ROOM_ROOT, "src", "benchmark", "questions", `${suite}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { note: string; items: Json[] };
  return parsed;
}

export interface RunSuiteOptions {
  readonly runLabel: string;
  readonly modelName: string;
  /** Alleen voor variantvergelijking (§14) — leeg is productiegedrag. */
  readonly modelOverride?: ChatModel;
}

export async function runSuite(suite: Suite, options: RunSuiteOptions): Promise<BenchmarkRunResult> {
  const { items } = loadSuite(suite);
  const byCategory: Record<string, { pass: number; total: number }> = {};
  let pass = 0;
  let fail = 0;
  let unrated = 0;

  for (const item of items) {
    const oordeel = await benchAnswer(item, { modelOverride: options.modelOverride });
    const behaviour = String((item.expect as Json | undefined)?.behaviour ?? (item.expect as Json | undefined)?.kind ?? "onbekend");
    byCategory[behaviour] ??= { pass: 0, total: 0 };
    byCategory[behaviour].total += 1;
    if (oordeel.status === "GOED") {
      pass += 1;
      byCategory[behaviour].pass += 1;
    } else if (oordeel.status === "ONBEOORDEELD" || oordeel.status === "NIET_GEIMPLEMENTEERD") {
      unrated += 1;
    } else {
      fail += 1;
    }
  }

  const beoordeeld = pass + fail;
  return {
    runLabel: options.runLabel,
    measuredAt: new Date().toISOString(),
    suite,
    model: options.modelName,
    itemCount: items.length,
    passCount: pass,
    failCount: fail,
    unratedCount: unrated,
    passRate: beoordeeld > 0 ? (pass / beoordeeld) * 100 : 0,
    byCategory,
  };
}

/**
 * Meerdere runs van dezelfde suite (§17 van de opdracht: run variance).
 *
 * Rapporteert min/max/gemiddelde/standaardafwijking, en NOOIT alleen de beste
 * run: elke run telt mee in het gemiddelde.
 */
export async function runSuiteWithVariance(suite: Suite, options: RunSuiteOptions, repeats: number): Promise<BenchmarkVariance> {
  if (repeats < 1) throw new Error("repeats moet minstens 1 zijn");
  const runs: BenchmarkRunResult[] = [];
  for (let i = 0; i < repeats; i += 1) {
    runs.push(await runSuite(suite, { ...options, runLabel: `${options.runLabel}-r${i + 1}` }));
  }
  const rates = runs.map((r) => r.passRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  return {
    suite,
    runs,
    min: Math.min(...rates),
    max: Math.max(...rates),
    mean,
    stddev: Math.sqrt(variance),
    // v0.1: welke items precies wisselden vergt item-niveau vergelijking
    // tussen runs; runSuite geeft nu alleen categorie-aggregaten terug. Wordt
    // met de eerste echte lokale meting verfijnd (zie HANDOFF.md-aanbeveling).
    flippedItemIds: [],
  };
}
