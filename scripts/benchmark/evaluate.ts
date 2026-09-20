import { writeFileSync } from "node:fs";
import path from "node:path";
import type { HumanQualityReport } from "@/domain/quality-evaluator";
import { type QualityModel, QUALITY_MODEL_V1 } from "@/domain/quality-model";
import {
  type EvaluationContext,
  evaluateAssignmentsCore,
  evaluateOfficialCore,
  loadEvaluationContextCore,
} from "@/server/services/quality-evaluation-service";
import { BENCHMARK_ROOT, type Phase, type RawRun, decodeAssignments, readRuns, writeJson } from "./io";

/**
 * Van ruwe runs naar vergelijkbare getallen.
 *
 * ## Eén evaluator, alle fases
 *
 * Het officiële rooster, elke BEFORE-kandidaat en elke AFTER-kandidaat gaan
 * door dezelfde `evaluateQuality` met hetzelfde model. Er wordt hier niets
 * gewogen of gekozen dat niet in `quality-model.ts` staat.
 *
 * ## Geen selectiebias
 *
 * Elke kandidaat die de Roostercommissie zou zien, telt mee. Daarnaast staat per
 * run de eerste kandidaat apart (wat de engine vooraan zet). Vergeleken wordt
 * gemiddelde met gemiddelde, mediaan met mediaan, beste met beste en slechtste
 * met slechtste — nooit de beste AFTER met het gemiddelde van BEFORE.
 */

export const METRICS: readonly { key: string; label: string; higherIsBetter: boolean | null; unit: string }[] = [
  { key: "overall", label: "Kwaliteit totaal", higherIsBetter: true, unit: "score" },
  { key: "overallWithoutContinuity", label: "Kwaliteit zonder continuïteit", higherIsBetter: true, unit: "score" },
  { key: "robust", label: "Robuuste kwaliteit (pakket + slechtste regel)", higherIsBetter: true, unit: "score" },
  { key: "hours", label: "Uren", higherIsBetter: true, unit: "score" },
  { key: "flow", label: "Regelmaat", higherIsBetter: true, unit: "score" },
  { key: "rest", label: "Rust", higherIsBetter: true, unit: "score" },
  { key: "nights", label: "Nachten", higherIsBetter: true, unit: "score" },
  { key: "fairness", label: "Eerlijkheid", higherIsBetter: true, unit: "score" },
  { key: "stability", label: "Continuïteit", higherIsBetter: true, unit: "score" },
  { key: "hoursRosterMAD", label: "Uren: gem. afwijking per basisrooster", higherIsBetter: false, unit: "min" },
  { key: "hoursRosterMax", label: "Uren: grootste afwijking per basisrooster", higherIsBetter: false, unit: "min" },
  { key: "hoursRosterSD", label: "Uren: spreiding afwijking per basisrooster", higherIsBetter: false, unit: "min" },
  { key: "hoursLineMAD", label: "Uren: gem. weekafwijking per regel", higherIsBetter: false, unit: "min" },
  { key: "hoursLineMax", label: "Uren: grootste weekafwijking per regel", higherIsBetter: false, unit: "min" },
  { key: "hoursLinesOutside30", label: "Uren: regels buiten ±30 min", higherIsBetter: false, unit: "regels" },
  { key: "singletonNights", label: "Losse nachten", higherIsBetter: false, unit: "aantal" },
  { key: "twoNightBlocks", label: "Reeksen van twee nachten", higherIsBetter: false, unit: "aantal" },
  { key: "nightBlocks3plus", label: "Nachtreeksen van drie of meer", higherIsBetter: null, unit: "aantal" },
  { key: "averageNightBlock", label: "Gemiddelde nachtreeks", higherIsBetter: null, unit: "nachten" },
  { key: "longestNightBlock", label: "Langste nachtreeks", higherIsBetter: null, unit: "nachten" },
  { key: "heavyTransitions", label: "Zware overgangen", higherIsBetter: false, unit: "aantal" },
  { key: "nightToEarly", label: "Nacht → vroeg", higherIsBetter: false, unit: "aantal" },
  { key: "lateToEarly", label: "Laat → vroeg", higherIsBetter: false, unit: "aantal" },
  { key: "earlyToNight", label: "Vroeg → nacht", higherIsBetter: false, unit: "aantal" },
  { key: "transitionPenalty", label: "Overgangsstrafpunten", higherIsBetter: false, unit: "punten" },
  { key: "switchesPerWorkedDay", label: "Dagdeelwisselingen per gewerkte dag", higherIsBetter: false, unit: "ratio" },
  { key: "averageStreak", label: "Gemiddelde reeks in hetzelfde dagdeel", higherIsBetter: true, unit: "dagen" },
  { key: "restSurplus", label: "Rust boven minimum (score)", higherIsBetter: true, unit: "score" },
  { key: "restRecovery", label: "Herstel na nachten (score)", higherIsBetter: true, unit: "score" },
  { key: "shortestRestSurplus", label: "Kortste rust boven minimum", higherIsBetter: true, unit: "min" },
  { key: "minNightRecoveryHours", label: "Kortste herstel na nachtreeks", higherIsBetter: true, unit: "uur" },
  { key: "nightFairness", label: "Eerlijke nachtverdeling", higherIsBetter: true, unit: "score" },
  { key: "shuntingFairness", label: "Eerlijke rangeerverdeling", higherIsBetter: true, unit: "score" },
  { key: "weekendFairness", label: "Eerlijke weekendbelasting", higherIsBetter: true, unit: "score" },
  { key: "nightsPerLineSD", label: "Nachten per regel: spreiding tussen nachtroosters", higherIsBetter: false, unit: "nachten" },
  { key: "shuntingPerLineMaxMin", label: "Rangeer per regel: max − min tussen roosters", higherIsBetter: false, unit: "diensten" },
  { key: "worstLine", label: "Slechtste regel", higherIsBetter: true, unit: "score" },
  { key: "medianLine", label: "Mediane regel", higherIsBetter: true, unit: "score" },
  { key: "patternDistance", label: "Patroonafstand tot officieel", higherIsBetter: null, unit: "0–100" },
  { key: "sameDutyShare", label: "Zelfde dienstnummer als huidig", higherIsBetter: null, unit: "%" },
  { key: "sameDaypartShare", label: "Zelfde dagdeel als huidig", higherIsBetter: null, unit: "%" },
  { key: "hardValid", label: "Hard geldig (evaluator)", higherIsBetter: true, unit: "0/1" },
  { key: "confirmedHardViolations", label: "Bevestigde harde overtredingen (eindvalidatie)", higherIsBetter: false, unit: "aantal" },
  { key: "profileBreaches", label: "Profielovertredingen", higherIsBetter: false, unit: "aantal" },
  { key: "coverageUnassigned", label: "Niet geplaatste diensten", higherIsBetter: false, unit: "aantal" },
  { key: "lnEarlyDuties", label: "Laat/Nacht: vroege diensten", higherIsBetter: false, unit: "aantal" },
];

export type Row = Record<string, number | string | null>;

function perRooster(report: HumanQualityReport) {
  return report.metrics.hours.rosters.map((uren) => {
    const regels = report.lines.all.filter((line) => line.roster === uren.code);
    const nachten = report.metrics.nights.perRoster.find((r) => r.code === uren.code);
    const gescoord = regels.filter((line) => line.score !== null).map((line) => line.score as number);
    const pairs = regels.reduce((som, line) => som + line.counts.pairs, 0);
    const herstel = report.metrics.rest.recovery.filter((r) => r.roster === uren.code).map((r) => r.minutes / 60);
    return {
      code: uren.code,
      averageWeeklyMinutes: uren.averageWeeklyMinutes,
      deviationMinutes: uren.deviationMinutes,
      nights: nachten?.nights ?? 0,
      nightBlocks: nachten?.blocks ?? [],
      heavyTransitions: regels.reduce((som, line) => som + line.counts.heavy, 0),
      stableShare: pairs > 0 ? regels.reduce((som, line) => som + line.counts.stable, 0) / pairs : null,
      worstLine: gescoord.length > 0 ? Math.min(...gescoord) : null,
      minRecoveryHours: herstel.length > 0 ? Math.min(...herstel) : null,
    };
  });
}

export function rowOf(report: HumanQualityReport, extra: Row, context: EvaluationContext, lnEarly: number): Row {
  const m = report.metrics;
  const herstel = m.rest.recovery.map((r) => r.minutes / 60);
  return {
    ...extra,
    overall: report.overall,
    overallWithoutContinuity: report.overallWithoutContinuity,
    robust: report.robust,
    hours: report.components.hours.score,
    flow: report.components.flow.score,
    rest: report.components.rest.score,
    nights: report.components.nights.score,
    fairness: report.components.fairness.score,
    stability: report.components.stability.score,
    hoursRosterMAD: m.hours.rosterStats.mean,
    hoursRosterMax: m.hours.rosterStats.max,
    hoursRosterSD: m.hours.rosterStats.sd,
    hoursLineMAD: m.hours.lineStats.mean,
    hoursLineMax: m.hours.lineStats.max,
    hoursLinesOutside30: m.hours.lineStats.outside30,
    singletonNights: m.nights.singletons,
    twoNightBlocks: m.nights.blocks2,
    nightBlocks3plus: m.nights.blocks3 + m.nights.blocks4 + m.nights.blocks5plus,
    averageNightBlock: m.nights.averageBlockLength,
    longestNightBlock: m.nights.longestBlock,
    heavyTransitions: m.transitions.heavy,
    nightToEarly: m.transitions.nightToEarly,
    lateToEarly: m.transitions.lateToEarly,
    earlyToNight: m.transitions.earlyToNight,
    transitionPenalty: m.transitions.penaltyTotal,
    switchesPerWorkedDay: m.transitions.switchesPerWorkedDay,
    averageStreak: m.transitions.averageStreak,
    restSurplus: report.components.rest.parts.surplus ?? null,
    restRecovery: report.components.rest.parts.recovery ?? null,
    shortestRestSurplus: m.rest.shortestSurplusMinutes,
    minNightRecoveryHours: herstel.length > 0 ? Math.min(...herstel) : null,
    nightFairness: report.components.fairness.parts.nights ?? null,
    shuntingFairness: report.components.fairness.parts.shunting ?? null,
    weekendFairness: report.components.fairness.parts.weekend ?? null,
    nightsPerLineSD: m.nights.perEligibleLine.sd,
    shuntingPerLineMaxMin: m.fairness.shuntingPerLine.maxMin,
    worstLine: report.lines.worst?.score ?? null,
    medianLine: report.lines.median,
    patternDistance: report.patternDistance?.total ?? null,
    sameDutyShare: m.change.sameDutyShare === null ? null : 100 * m.change.sameDutyShare,
    sameDaypartShare: m.change.sameDaypartShare === null ? null : 100 * m.change.sameDaypartShare,
    hardValid: report.hardValidity.hardValid ? 1 : 0,
    profileBreaches: report.hardValidity.profileBreaches.length,
    coverageUnassigned: report.hardValidity.coverage.unassigned,
    lnEarlyDuties: lnEarly,
    requiredDuties: context.requiredDutyKeys.length,
  };
}

function vroegInLaatNacht(report: HumanQualityReport, raw: RawRun["candidates"][number], context: EvaluationContext): number {
  void report;
  let aantal = 0;
  for (const [code, regels] of Object.entries(raw.roster)) {
    const rooster = context.quality.official.find((r) => r.code === code);
    if (rooster?.profile !== "LAAT_NACHT") continue;
    for (const cellen of Object.values(regels)) {
      cellen.forEach((cel, index) => {
        if (cel.startsWith("~")) return;
        if (context.quality.duties.get(`${cel}|${index + 1}`)?.kinds.includes("VROEG")) aantal += 1;
      });
    }
  }
  return aantal;
}

export interface Aggregate {
  readonly n: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly sd: number | null;
}

export function aggregate(values: readonly (number | string | null)[]): Aggregate {
  const getallen = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  const n = getallen.length;
  if (n === 0) return { n: 0, mean: null, median: null, min: null, max: null, sd: null };
  const mean = getallen.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 1 ? getallen[(n - 1) / 2] : (getallen[n / 2 - 1] + getallen[n / 2]) / 2;
  const sd = Math.sqrt(getallen.reduce((som, v) => som + (v - mean) ** 2, 0) / n);
  return { n, mean, median, min: getallen[0], max: getallen[n - 1], sd };
}

export async function evaluateBenchmark(model: QualityModel = QUALITY_MODEL_V1): Promise<void> {
  const context = await loadEvaluationContextCore("DDR");
  const officieel = evaluateOfficialCore(context, model);
  const officieelRij = rowOf(officieel, { phase: "official", strategy: "OFFICIAL", run: 0, candidate: 0, engine: "human", mode: null, runtimeSeconds: null }, context, 0);

  const phases: Phase[] = ["before", "after", "budget", "ablation"];
  const rows: Row[] = [];
  const runRows: Row[] = [];
  const profielen: Record<string, unknown>[] = [];
  const runs: RawRun[] = [];
  for (const phase of phases) {
    for (const run of readRuns(phase)) {
      runs.push(run);
      const kandidaatRijen: Row[] = [];
      for (const kandidaat of run.candidates) {
        const rapport = evaluateAssignmentsCore(decodeAssignments(kandidaat.roster), context, model);
        const rij = rowOf(
          rapport,
          {
            phase,
            strategy: run.strategy,
            run: run.runNumber,
            candidate: kandidaat.number,
            engine: run.engine,
            mode: run.mode,
            ablation: run.ablation ?? null,
            candidateId: kandidaat.candidateId,
            runtimeSeconds: run.runtimeSeconds,
            confirmedHardViolations: kandidaat.confirmedHardViolations,
            validationState: kandidaat.validationState,
          },
          context,
          vroegInLaatNacht(rapport, kandidaat, context),
        );
        rows.push(rij);
        kandidaatRijen.push(rij);
        profielen.push({ phase, strategy: run.strategy, run: run.runNumber, candidate: kandidaat.number, mode: run.mode, ablation: run.ablation ?? null, rosters: perRooster(rapport) });
      }
      const diversiteit = run.diversity.map((d) => d.changedDutyDays);
      runRows.push({
        phase,
        strategy: run.strategy,
        run: run.runNumber,
        engine: run.engine,
        mode: run.mode,
        ablation: run.ablation ?? null,
        status: run.generationRun.status,
        found: run.generationRun.found,
        requested: run.generationRun.requested,
        runtimeSeconds: run.runtimeSeconds,
        bestRobust: aggregate(kandidaatRijen.map((r) => r.robust)).max,
        meanRobust: aggregate(kandidaatRijen.map((r) => r.robust)).mean,
        firstRobust: kandidaatRijen[0]?.robust ?? null,
        minDiversity: diversiteit.length > 0 ? Math.min(...diversiteit) : null,
        peakPythonMB: run.resources.peakPythonWorkingSetBytes === null ? null : Math.round(run.resources.peakPythonWorkingSetBytes / 1048576),
        peakNodeMB: Math.round(run.resources.peakNodeRssBytes / 1048576),
        counters: JSON.stringify(run.generationRun.counters ?? null),
      });
    }
  }

  // Samenvatting per groep: fase × strategie × modus × ablatie.
  const groepen = new Map<string, Row[]>();
  for (const rij of rows) {
    const sleutel = [rij.phase, rij.strategy, rij.mode ?? "-", rij.ablation ?? "-"].join("|");
    groepen.set(sleutel, [...(groepen.get(sleutel) ?? []), rij]);
  }
  const samenvatting = [...groepen.entries()].map(([sleutel, groep]) => {
    const [phase, strategy, mode, ablation] = sleutel.split("|");
    const eersteKandidaten = groep.filter((r) => r.candidate === 1);
    const groepRuns = runRows.filter((r) => r.phase === phase && r.strategy === strategy && (r.mode ?? "-") === mode && (r.ablation ?? "-") === ablation);
    return {
      phase,
      strategy,
      mode: mode === "-" ? null : mode,
      ablation: ablation === "-" ? null : ablation,
      runs: groepRuns.length,
      candidates: groep.length,
      runtimeSeconds: aggregate(groepRuns.map((r) => r.runtimeSeconds)),
      // Waarom het zoeken stopte, per groep geteld. Zonder dit is niet te zien
      // of de plateaudetectie ooit iets doet of alleen bestaat.
      stopReasons: groepRuns.reduce<Record<string, number>>((per, rij) => {
        const tellers = typeof rij.counters === "string" ? (JSON.parse(rij.counters) as { stopReason?: unknown } | null) : null;
        const reden = typeof tellers?.stopReason === "string" ? tellers.stopReason.split(":")[0] : "onbekend";
        per[reden] = (per[reden] ?? 0) + 1;
        return per;
      }, {}),
      metrics: Object.fromEntries(METRICS.map((metric) => [metric.key, aggregate(groep.map((r) => r[metric.key]))])),
      firstCandidateMetrics: Object.fromEntries(METRICS.map((metric) => [metric.key, aggregate(eersteKandidaten.map((r) => r[metric.key]))])),
    };
  });

  writeJson(path.join(BENCHMARK_ROOT, "tables", "candidates.json"), rows);
  writeJson(path.join(BENCHMARK_ROOT, "tables", "runs.json"), runRows);
  writeJson(path.join(BENCHMARK_ROOT, "tables", "per-roster.json"), profielen);
  writeJson(path.join(BENCHMARK_ROOT, "tables", "official.json"), { row: officieelRij, perRoster: perRooster(officieel), report: officieel });
  writeJson(path.join(BENCHMARK_ROOT, "benchmark-summary.json"), {
    schema: "ns-optimizer-benchmark-summary/1",
    generatedAt: new Date().toISOString(),
    qualityModel: model.version,
    official: officieelRij,
    groups: samenvatting,
    metrics: METRICS,
    rawRuns: runs.map((run) => `${run.phase}/run-${String(run.runNumber).padStart(3, "0")}.json`),
  });

  // CSV: één regel per kandidaat, plus het officiële rooster.
  const kolommen = ["phase", "strategy", "mode", "ablation", "run", "candidate", "engine", "candidateId", "runtimeSeconds", "validationState", ...METRICS.map((m) => m.key)];
  const csv = [officieelRij, ...rows]
    .map((rij) => kolommen.map((k) => formatCsv(rij[k])).join(","))
    .join("\n");
  writeFileSync(path.join(BENCHMARK_ROOT, "before-after-metrics.csv"), `${kolommen.join(",")}\n${csv}\n`, "utf8");
  console.log(`Geëvalueerd: ${rows.length} kandidaten uit ${runRows.length} runs, model ${model.version}.`);
  for (const groep of samenvatting) {
    const r = groep.metrics.robust;
    console.log(
      `  ${groep.phase.padEnd(8)} ${groep.strategy.padEnd(14)} ${String(groep.mode ?? "-").padEnd(9)} ${String(groep.ablation ?? "-").padEnd(12)} runs ${groep.runs} kand ${groep.candidates} robust gem ${r.mean?.toFixed(1)} med ${r.median?.toFixed(1)} min ${r.min?.toFixed(1)} max ${r.max?.toFixed(1)}`,
    );
  }
}

function formatCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  const tekst = String(value);
  return /[",\n]/.test(tekst) ? `"${tekst.replace(/"/g, '""')}"` : tekst;
}
