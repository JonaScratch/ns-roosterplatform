import path from "node:path";
import { BENCHMARK_ROOT, type RawRun, readJson, readRuns, writeJson } from "./io";

/**
 * BEFORE tegenover AFTER, zonder de uitkomst mooier te maken dan hij is.
 *
 * ## Waarom niet alleen gemiddelden
 *
 * Een gemiddelde verbergt precies waar een roostermaker last van heeft. Daarom
 * vergelijkt dit script per maat vier dingen naast elkaar: gemiddelde tegen
 * gemiddelde, mediaan tegen mediaan, beste tegen beste en slechtste tegen
 * slechtste. Gaat één daarvan de verkeerde kant op, dan staat dat er gewoon in.
 *
 * ## Waarom kandidaten én runs
 *
 * Eén run levert drie kandidaten. Alleen kandidaten vergelijken laat een engine
 * die één uitschieter en twee middelmatige roosters maakt er te goed uitzien;
 * alleen runs vergelijken gooit weg wat de Roostercommissie werkelijk te zien
 * krijgt. Beide staan er dus in: per kandidaat, en per run de beste.
 *
 * ## Wat hard is
 *
 * De regressietoetsen kennen geen tolerantie. Een vroege dienst in een
 * Laat/Nacht-rooster, een profieloverschrijding, een onbezette dienstdag of een
 * bevestigde harde overtreding is geen verslechtering van een cijfer maar een
 * fout, en die maakt de uitkomst ongeldig.
 *
 *   npm run analyse:optimizer
 */

interface CandidateRow {
  readonly phase: string;
  readonly strategy: string;
  readonly run: number;
  readonly candidate: number;
  readonly [key: string]: unknown;
}

interface MetricDef {
  readonly key: string;
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly unit: string;
}

interface Summary {
  readonly metrics: readonly MetricDef[];
  readonly official: Record<string, unknown>;
  readonly qualityModel: Record<string, unknown>;
}

const getal = (waarde: unknown): number | null =>
  typeof waarde === "number" && Number.isFinite(waarde) ? waarde : null;

function stat(waarden: readonly number[]) {
  if (waarden.length === 0) {
    return null;
  }
  const gesorteerd = [...waarden].sort((a, b) => a - b);
  const mean = waarden.reduce((a, b) => a + b, 0) / waarden.length;
  const midden = Math.floor(gesorteerd.length / 2);
  return {
    n: waarden.length,
    mean,
    median: gesorteerd.length % 2 === 0 ? (gesorteerd[midden - 1] + gesorteerd[midden]) / 2 : gesorteerd[midden],
    min: gesorteerd[0],
    max: gesorteerd[gesorteerd.length - 1],
    sd:
      waarden.length < 2
        ? 0
        : Math.sqrt(waarden.reduce((som, x) => som + (x - mean) ** 2, 0) / (waarden.length - 1)),
  };
}

/** Beter of slechter, met de richting van de maat erin verwerkt. */
function oordeel(voor: number | null, na: number | null, higherIsBetter: boolean) {
  if (voor === null || na === null) {
    return { delta: null, percent: null, verdict: "onbekend" as const };
  }
  const delta = na - voor;
  const beter = higherIsBetter ? delta > 0 : delta < 0;
  const gelijk = Math.abs(delta) < 1e-9;
  return {
    delta,
    percent: voor === 0 ? null : (delta / Math.abs(voor)) * 100,
    verdict: gelijk ? ("gelijk" as const) : beter ? ("beter" as const) : ("slechter" as const),
  };
}

function vergelijk(
  voor: readonly number[],
  na: readonly number[],
  higherIsBetter: boolean,
) {
  const a = stat(voor);
  const b = stat(na);
  if (!a || !b) {
    return null;
  }
  // Beste en slechtste hangen af van de richting van de maat: bij "lager is
  // beter" is het minimum de beste waarde, niet het maximum.
  const beste = (s: NonNullable<ReturnType<typeof stat>>) => (higherIsBetter ? s.max : s.min);
  const slechtste = (s: NonNullable<ReturnType<typeof stat>>) => (higherIsBetter ? s.min : s.max);
  return {
    before: a,
    after: b,
    mean: oordeel(a.mean, b.mean, higherIsBetter),
    median: oordeel(a.median, b.median, higherIsBetter),
    best: oordeel(beste(a), beste(b), higherIsBetter),
    worst: oordeel(slechtste(a), slechtste(b), higherIsBetter),
  };
}

/**
 * Hoe vaak wint AFTER als je de runs op volgorde naast elkaar legt?
 *
 * Elke run gerangschikt van slecht naar goed en dan paar voor paar
 * vergelijken. Zo telt niet de gelukkigste AFTER-run tegen de ongelukkigste
 * BEFORE-run, maar de hele verdeling tegen de hele verdeling.
 */
function winstKans(voor: readonly number[], na: readonly number[], higherIsBetter: boolean) {
  const a = [...voor].sort((x, y) => x - y);
  const b = [...na].sort((x, y) => x - y);
  const paren = Math.min(a.length, b.length);
  let gewonnen = 0;
  let gelijk = 0;
  for (let i = 0; i < paren; i += 1) {
    const verschil = b[i] - a[i];
    if (Math.abs(verschil) < 1e-9) gelijk += 1;
    else if (higherIsBetter ? verschil > 0 : verschil < 0) gewonnen += 1;
  }
  // Daarnaast: elke AFTER-run tegen elke BEFORE-run. Dit is de kans dat een
  // willekeurige AFTER-run een willekeurige BEFORE-run verslaat.
  let beter = 0;
  let totaal = 0;
  for (const x of voor) {
    for (const y of na) {
      totaal += 1;
      if (Math.abs(y - x) < 1e-9) continue;
      if (higherIsBetter ? y > x : y < x) beter += 1;
    }
  }
  return {
    pairs: paren,
    wonByRank: gewonnen,
    tiedByRank: gelijk,
    lostByRank: paren - gewonnen - gelijk,
    allPairsProbability: totaal === 0 ? null : beter / totaal,
  };
}

const NIET_VERGELIJKEN = new Set(["run", "candidate", "runtimeSeconds"]);

function main() {
  const summary = readJson<Summary>(path.join(BENCHMARK_ROOT, "benchmark-summary.json"));
  const kandidaten = readJson<CandidateRow[]>(path.join(BENCHMARK_ROOT, "tables", "candidates.json"));
  const runs = readJson<Record<string, unknown>[]>(path.join(BENCHMARK_ROOT, "tables", "runs.json"));
  const perRooster = readJson<Record<string, unknown>[]>(path.join(BENCHMARK_ROOT, "tables", "per-roster.json"));

  const fases = ["before", "after"] as const;
  const aanwezig = fases.filter((fase) => kandidaten.some((rij) => rij.phase === fase));
  if (aanwezig.length < 2) {
    throw new Error(
      "Er is maar één fase gemeten. Zonder BEFORE én AFTER valt er niets te vergelijken; " +
        "draai eerst beide benchmarks en daarna `evaluate`.",
    );
  }

  const strategieën = [...new Set(kandidaten.map((rij) => rij.strategy))].filter((s) => s !== "REPRODUCE");
  // De nulmeting telt niet mee in de vergelijking: dat is het huidige rooster
  // overgenomen, geen zoekresultaat. Hij is in beide fasen hetzelfde kandidaat
  // en zou het gemiddelde, het minimum en het maximum van beide kanten gelijk
  // optrekken — een vergelijking die daardoor "gelijk" zegt, meet niets.
  const waarden = (fase: string, strategie: string | null, sleutel: string) =>
    kandidaten
      .filter(
        (rij) =>
          rij.phase === fase &&
          (strategie === null ? rij.strategy !== "REPRODUCE" : rij.strategy === strategie),
      )
      .map((rij) => getal(rij[sleutel]))
      .filter((x): x is number => x !== null);

  // ── Per maat, per strategie en over alles heen ──────────────────────────────
  const vergelijking = summary.metrics
    .filter((metric) => !NIET_VERGELIJKEN.has(metric.key))
    .map((metric) => ({
      ...metric,
      official: getal(summary.official[metric.key]),
      overall: vergelijk(waarden("before", null, metric.key), waarden("after", null, metric.key), metric.higherIsBetter),
      perStrategy: Object.fromEntries(
        strategieën.map((strategie) => [
          strategie,
          vergelijk(
            waarden("before", strategie, metric.key),
            waarden("after", strategie, metric.key),
            metric.higherIsBetter,
          ),
        ]),
      ),
    }));

  // ── Per run: de beste kandidaat, want die telt voor de Roostercommissie ─────
  const runWaarden = (fase: string, strategie: string | null, sleutel: string) =>
    runs
      .filter(
        (rij) =>
          rij.phase === fase &&
          (strategie === null ? rij.strategy !== "REPRODUCE" : rij.strategy === strategie),
      )
      .map((rij) => getal(rij[sleutel]))
      .filter((x): x is number => x !== null);

  const perRun = {
    bestRobust: {
      overall: vergelijk(runWaarden("before", null, "bestRobust"), runWaarden("after", null, "bestRobust"), true),
      winRate: winstKans(runWaarden("before", null, "bestRobust"), runWaarden("after", null, "bestRobust"), true),
      perStrategy: Object.fromEntries(
        strategieën.map((strategie) => [
          strategie,
          {
            comparison: vergelijk(
              runWaarden("before", strategie, "bestRobust"),
              runWaarden("after", strategie, "bestRobust"),
              true,
            ),
            winRate: winstKans(
              runWaarden("before", strategie, "bestRobust"),
              runWaarden("after", strategie, "bestRobust"),
              true,
            ),
          },
        ]),
      ),
    },
    meanRobust: vergelijk(runWaarden("before", null, "meanRobust"), runWaarden("after", null, "meanRobust"), true),
    minDiversity: vergelijk(runWaarden("before", null, "minDiversity"), runWaarden("after", null, "minDiversity"), true),
    runtimeSeconds: vergelijk(
      runWaarden("before", null, "runtimeSeconds"),
      runWaarden("after", null, "runtimeSeconds"),
      false,
    ),
    candidatesFound: vergelijk(runWaarden("before", null, "found"), runWaarden("after", null, "found"), true),
  };

  // ── Per basisrooster (en daarmee per profiel) ───────────────────────────────
  const roosterCodes = [
    ...new Set(
      perRooster.flatMap((rij) => ((rij.rosters as { code: string }[]) ?? []).map((r) => r.code)),
    ),
  ].sort();
  const roosterMaten = [
    { key: "deviationMinutes", label: "Afwijking van 40:00 (min)", higherIsBetter: false, absolute: true },
    { key: "nights", label: "Nachten", higherIsBetter: true, absolute: false },
    { key: "heavyTransitions", label: "Zware overgangen", higherIsBetter: false, absolute: false },
    { key: "stableShare", label: "Stabiele opeenvolging", higherIsBetter: true, absolute: false },
    { key: "worstLine", label: "Slechtste regel", higherIsBetter: true, absolute: false },
    { key: "minRecoveryHours", label: "Kortste herstel na nachten (u)", higherIsBetter: true, absolute: false },
  ];
  const perProfiel = roosterCodes.map((code) => ({
    roster: code,
    metrics: roosterMaten.map((maat) => {
      const uit = (fase: string) =>
        perRooster
          .filter((rij) => rij.phase === fase)
          .flatMap((rij) => ((rij.rosters as Record<string, unknown>[]) ?? []).filter((r) => r.code === code))
          .map((r) => {
            const w = getal(r[maat.key]);
            return w === null ? null : maat.absolute ? Math.abs(w) : w;
          })
          .filter((x): x is number => x !== null);
      return { ...maat, comparison: vergelijk(uit("before"), uit("after"), maat.higherIsBetter) };
    }),
  }));

  // ── Harde regressietoetsen ─────────────────────────────────────────────────
  const hard = (fase: string, sleutel: string) => waarden(fase, null, sleutel);
  const maximaal = (lijst: readonly number[]) => (lijst.length === 0 ? null : Math.max(...lijst));
  const regressie = [
    {
      key: "lnEarlyDuties",
      label: "Vroege diensten in een Laat/Nacht-rooster",
      before: maximaal(hard("before", "lnEarlyDuties")),
      after: maximaal(hard("after", "lnEarlyDuties")),
      mustBe: 0,
    },
    {
      key: "profileBreaches",
      label: "Diensten buiten het roosterprofiel",
      before: maximaal(hard("before", "profileBreaches")),
      after: maximaal(hard("after", "profileBreaches")),
      mustBe: 0,
    },
    {
      key: "coverageUnassigned",
      label: "Dienstdagen zonder dienstnummer",
      before: maximaal(hard("before", "coverageUnassigned")),
      after: maximaal(hard("after", "coverageUnassigned")),
      mustBe: 0,
    },
    {
      key: "confirmedHardViolations",
      label: "Bevestigde harde overtredingen",
      before: maximaal(hard("before", "confirmedHardViolations")),
      after: maximaal(hard("after", "confirmedHardViolations")),
      mustBe: 0,
    },
  ].map((toets) => ({ ...toets, pass: toets.after === toets.mustBe }));

  // De tabellen zijn ook de bron van de CSV; daarin staat een ja/nee als 1 of 0.
  // Een vergelijking met `=== true` zegt dan van elke kandidaat dat hij ongeldig
  // is, en dat maakt van een geslaagde meting een afkeuring.
  const jaNee = (waarde: unknown): boolean => waarde === true || waarde === 1;
  const geldig = (fase: string) => kandidaten.filter((rij) => rij.phase === fase).every((rij) => jaNee(rij.hardValid));
  const validatieStanden = (fase: string) => {
    const per: Record<string, number> = {};
    for (const rij of kandidaten.filter((r) => r.phase === fase)) {
      const stand = String(rij.validationState);
      per[stand] = (per[stand] ?? 0) + 1;
    }
    return per;
  };

  // ── Wat de zoektocht heeft gedaan (alleen AFTER heeft tellers) ──────────────
  const ruwe: RawRun[] = readRuns("after" as Parameters<typeof readRuns>[0]);
  const tellers = ruwe
    .map((run) => run.generationRun.counters as Record<string, unknown> | null)
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object");
  const som = (sleutel: string) => tellers.reduce((totaal, c) => totaal + (getal(c[sleutel]) ?? 0), 0);
  const stopRedenen: Record<string, number> = {};
  for (const c of tellers) {
    const reden = typeof c.stopReason === "string" ? c.stopReason.split(":")[0] : "onbekend";
    stopRedenen[reden] = (stopRedenen[reden] ?? 0) + 1;
  }
  const zoekefficiëntie = {
    runs: tellers.length,
    attempts: som("attempts"),
    starts: som("starts"),
    repairs: som("repairs"),
    repairsAccepted: som("repairsAccepted"),
    repairsImprovedTarget: som("repairsImprovedTarget"),
    repairsRejectedRegression: som("repairsRejectedRegression"),
    repairsFailed: som("repairsFailed"),
    duplicates: som("duplicates"),
    lowQuality: som("lowQuality"),
    rejected: som("rejected"),
    validCandidates: som("validCandidates"),
    polishRuns: som("polishRuns"),
    polishImproved: som("polishImproved"),
    polishVariants: som("polishVariants"),
    polishSwaps: som("polishSwaps"),
    polishGainTotal: Math.round(som("polishGainTotal") * 100) / 100,
    solverSecondsTotal: Math.round(som("solverSecondsTotal")),
    evaluationSecondsTotal: Math.round(som("evaluationMsTotal") / 1000),
    validationSecondsTotal: Math.round(som("validationMsTotal") / 1000),
    stopReasons: stopRedenen,
    repairAcceptRate: som("repairs") === 0 ? null : som("repairsAccepted") / som("repairs"),
    polishImproveRate: som("polishRuns") === 0 ? null : som("polishImproved") / som("polishRuns"),
    variantsPerValidCandidate:
      som("validCandidates") === 0 ? null : (som("polishVariants") + som("attempts")) / som("validCandidates"),
  };

  const belangrijk = ["robust", "worstLine", "rest", "flow", "fairness", "nights", "hours", "overallWithoutContinuity"];
  const kernoordeel = vergelijking
    .filter((metric) => belangrijk.includes(metric.key))
    .map((metric) => ({
      key: metric.key,
      label: metric.label,
      meanVerdict: metric.overall?.mean.verdict ?? "onbekend",
      medianVerdict: metric.overall?.median.verdict ?? "onbekend",
      worstVerdict: metric.overall?.worst.verdict ?? "onbekend",
    }));

  // De nulmeting hoort in beide fasen hetzelfde te zijn: hij neemt het huidige
  // rooster over en raakt de zoekmachine niet aan. Verschilt hij toch, dan is er
  // iets veranderd wat niet had mogen veranderen.
  const nulmeting = (fase: string) => kandidaten.find((rij) => rij.phase === fase && rij.strategy === "REPRODUCE");
  const nulVoor = nulmeting("before");
  const nulNa = nulmeting("after");
  const nulSleutels = ["robust", "overall", "worstLine", "hours", "flow", "rest", "nights", "fairness"];
  const baseline = {
    measured: nulVoor !== undefined && nulNa !== undefined,
    identical:
      nulVoor !== undefined &&
      nulNa !== undefined &&
      nulSleutels.every((sleutel) => getal(nulVoor[sleutel]) === getal(nulNa[sleutel])),
    before: nulVoor ? Object.fromEntries(nulSleutels.map((s) => [s, getal(nulVoor[s])])) : null,
    after: nulNa ? Object.fromEntries(nulSleutels.map((s) => [s, getal(nulNa[s])])) : null,
  };

  const uitkomst = {
    schema: "ns-optimizer-analysis/1",
    baseline,
    generatedAt: new Date().toISOString(),
    qualityModel: summary.qualityModel,
    phases: aanwezig,
    // De aantallen tellen wat er is vergeleken; de nulmeting staat apart, zodat
    // een bijschrift als "gemiddeld over N kandidaten" klopt met de N waarover
    // het gemiddelde werkelijk is berekend.
    counts: {
      before: {
        runs: runs.filter((r) => r.phase === "before" && r.strategy !== "REPRODUCE").length,
        candidates: kandidaten.filter((r) => r.phase === "before" && r.strategy !== "REPRODUCE").length,
      },
      after: {
        runs: runs.filter((r) => r.phase === "after" && r.strategy !== "REPRODUCE").length,
        candidates: kandidaten.filter((r) => r.phase === "after" && r.strategy !== "REPRODUCE").length,
      },
    },
    baselineRuns: {
      before: runs.filter((r) => r.phase === "before" && r.strategy === "REPRODUCE").length,
      after: runs.filter((r) => r.phase === "after" && r.strategy === "REPRODUCE").length,
    },
    hardValidity: {
      beforeAllValid: geldig("before"),
      afterAllValid: geldig("after"),
      beforeValidationStates: validatieStanden("before"),
      afterValidationStates: validatieStanden("after"),
    },
    regression: regressie,
    headline: kernoordeel,
    metrics: vergelijking,
    perRun,
    perProfile: perProfiel,
    searchEfficiency: zoekefficiëntie,
  };

  const doel = path.join(BENCHMARK_ROOT, "analysis.json");
  writeJson(doel, uitkomst);

  // ── Wat er op het scherm komt ──────────────────────────────────────────────
  const tekst = (waarde: number | null, decimalen = 1) =>
    waarde === null ? "—" : waarde.toFixed(decimalen).replace(".", ",");
  console.log(`BEFORE: ${uitkomst.counts.before.runs} runs, ${uitkomst.counts.before.candidates} kandidaten`);
  console.log(`AFTER : ${uitkomst.counts.after.runs} runs, ${uitkomst.counts.after.candidates} kandidaten\n`);
  console.log("maat                              voor      na    delta   mediaan  slechtste");
  for (const metric of vergelijking) {
    if (!belangrijk.includes(metric.key) || !metric.overall) continue;
    const o = metric.overall;
    console.log(
      metric.label.padEnd(32).slice(0, 32),
      tekst(o.before.mean).padStart(7),
      tekst(o.after.mean).padStart(7),
      `${o.mean.delta !== null && o.mean.delta > 0 ? "+" : ""}${tekst(o.mean.delta)}`.padStart(8),
      `${o.median.verdict}`.padStart(9),
      `${o.worst.verdict}`.padStart(10),
    );
  }
  console.log("\nHarde toetsen:");
  for (const toets of regressie) {
    console.log(`  ${toets.pass ? "✓" : "✗"} ${toets.label}: voor ${toets.before ?? "—"}, na ${toets.after ?? "—"}`);
  }
  const wr = perRun.bestRobust.winRate;
  console.log(
    `\nBeste kandidaat per run: AFTER wint ${wr.wonByRank} van ${wr.pairs} op rang, ` +
      `kans over alle paren ${tekst((wr.allPairsProbability ?? 0) * 100, 0)}%`,
  );
  console.log(`Geschreven: ${doel}`);
}

main();
