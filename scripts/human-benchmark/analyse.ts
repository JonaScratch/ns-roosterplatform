import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/server/data/prisma";
import type { HumanQualityReport } from "@/domain/quality-evaluator";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { flowDays, nightBlocksFlow, workBlocks } from "@/domain/roster-flow";
import type { QualityDuty, QualityRosterInput } from "@/domain/roster-quality";
import { type RhythmMetrics, rhythmMetrics } from "@/domain/rhythm-metrics";
import {
  type EvaluationContext,
  evaluateAssignmentsCore,
  evaluateOfficialCore,
  loadEvaluationContextCore,
} from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { type Phase, type RawRun, decodeAssignments, readRuns } from "../benchmark/io";

/**
 * BEFORE tegenover AFTER van de ijking op de menselijke roosters.
 *
 * ## Wat BEFORE en AFTER hier zijn
 *
 * BEFORE: de 20 runs van de v1.0.4-zoekmachine (`docs/optimizer-benchmark/after`),
 * op dezelfde gegevens en dezelfde machine gemaakt. AFTER: de 20 runs van de
 * geijkte zoekmachine (`docs/optimizer-benchmark/human`), met dezelfde strategieën
 * en aantallen. Beide worden hier doorgerekend met kwaliteitsmodel v2 en met
 * dezelfde ritmecode als het officiële rooster, zodat er één meetlat is.
 *
 * ## Wat telt als geslaagd (werkopdracht §81)
 *
 * Hard: 0 harde overtredingen, volledige dekking, 0 profielovertredingen.
 * Gemiddeld beter: minder heen-en-weer, minder losse nachten, samenhangender
 * blokken, beter herstel na nachten, stabielere begintijden, een minder zware
 * slechtste overgang. De bewaking uit §75: eerlijkheid, uren en rust mogen niet
 * noemenswaardig achteruit.
 *
 *   npm run human-benchmark:analyse
 *   npm run human-benchmark:analyse -- --after human-dev1 --out analysis-dev1-final-v2.json
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

interface Meting {
  readonly strategy: string;
  readonly run: number;
  readonly candidate: number;
  readonly report: HumanQualityReport;
  readonly rhythm: RhythmMetrics;
  readonly meanBlockLength: number | null;
}

function gemiddeldWerkblok(rosters: readonly QualityRosterInput[], duties: ReadonlyMap<string, QualityDuty>): number | null {
  const lengtes = rosters.flatMap((rooster) => workBlocks(flowDays(rooster, duties)).map((blok) => blok.length));
  return lengtes.length ? lengtes.reduce((a, b) => a + b, 0) / lengtes.length : null;
}

const telt = (run: RawRun) => run.strategy !== "REPRODUCE";

function meet(runs: readonly RawRun[], context: EvaluationContext): Meting[] {
  return runs.filter(telt).flatMap((run) =>
    run.candidates.map((kandidaat) => {
      const toewijzingen = decodeAssignments(kandidaat.roster);
      const rosters = candidateRosterInputs(toewijzingen, context.quality);
      return {
        strategy: run.strategy,
        run: run.runNumber,
        candidate: kandidaat.number,
        report: evaluateAssignmentsCore(toewijzingen, context, QUALITY_MODEL_V2),
        rhythm: rhythmMetrics(rosters, context.quality.duties, context.rules),
        meanBlockLength: gemiddeldWerkblok(rosters, context.quality.duties),
      };
    }),
  );
}

const pct = (x: number | null) => (x === null ? null : x * 100);

/** De getallen per kandidaat die in de vergelijking meedoen, met hun richting. */
const MATEN: readonly { key: string; label: string; hoger: boolean; waarde: (m: Meting) => number | null }[] = [
  { key: "robust", label: "Robuuste kwaliteit", hoger: true, waarde: (m) => m.report.robust },
  { key: "overallWithoutContinuity", label: "Kwaliteit zonder continuïteit", hoger: true, waarde: (m) => m.report.overallWithoutContinuity },
  { key: "worstLine", label: "Slechtste regel", hoger: true, waarde: (m) => m.report.lines.worst?.score ?? null },
  { key: "flow", label: "Regelmaat", hoger: true, waarde: (m) => m.report.components.flow.score },
  { key: "nights", label: "Nachten", hoger: true, waarde: (m) => m.report.components.nights.score },
  { key: "rest", label: "Rust", hoger: true, waarde: (m) => m.report.components.rest.score },
  { key: "hours", label: "Uren", hoger: true, waarde: (m) => m.report.components.hours.score },
  { key: "fairness", label: "Eerlijkheid", hoger: true, waarde: (m) => m.report.components.fairness.score },
  { key: "stability", label: "Continuïteit", hoger: true, waarde: (m) => m.report.components.stability.score },
  { key: "oscillations", label: "Heen-en-weer (op de klok)", hoger: false, waarde: (m) => m.rhythm.oscillations },
  { key: "singletonNights", label: "Losse nachten", hoger: false, waarde: (m) => m.report.metrics.nights.singletons },
  { key: "twoNightBlocks", label: "Reeksen van twee nachten", hoger: false, waarde: (m) => m.report.metrics.nights.blocks2 },
  { key: "nightValue", label: "Waarde nachtreeksen (%)", hoger: true, waarde: (m) => pct(m.rhythm.nights.value) },
  { key: "nightExitsToEarly", label: "Nachtreeks gevolgd door vroeg", hoger: false, waarde: (m) => m.rhythm.nights.exitsToEarly },
  { key: "nightMinRecoveryHours", label: "Kortste herstel na nachtreeks (u)", hoger: true, waarde: (m) => m.rhythm.nights.minRecoveryHours },
  { key: "nightExitValue", label: "Uitgang na nachten (%)", hoger: true, waarde: (m) => pct(m.rhythm.nights.exitValue) },
  { key: "coherence", label: "Samenhang in werkblokken (%)", hoger: true, waarde: (m) => pct(m.rhythm.coherence) },
  { key: "meanBlockLength", label: "Gemiddeld werkblok (dagen)", hoger: true, waarde: (m) => m.meanBlockLength },
  { key: "changesThroughRest", label: "Dagdeelwissels via rust (%)", hoger: true, waarde: (m) => pct(m.rhythm.changesThroughRest) },
  { key: "startJitterMean", label: "Begintijdsprong gemiddeld (min)", hoger: false, waarde: (m) => m.rhythm.startJitter.mean },
  { key: "startJitterP90", label: "Begintijdsprong p90 (min)", hoger: false, waarde: (m) => m.rhythm.startJitter.p90 },
  { key: "worstTransition", label: "Zwaarste overgang (punten)", hoger: false, waarde: (m) => m.rhythm.worstTransition },
  {
    key: "linesWithHeavyTransition",
    label: "Regels met zware overgang",
    hoger: false,
    waarde: (m) => m.rhythm.worstTransitionPerLine.filter((r) => r.penalty >= 3).length,
  },
  { key: "patternDistance", label: "Structurele afstand tot officieel", hoger: false, waarde: (m) => m.report.patternDistance?.total ?? null },
];

function stat(xs: readonly number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n: xs.length,
    mean,
    median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2,
    min: s[0],
    max: s[s.length - 1],
    sd: xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1)),
  };
}

const PER_ROOSTER: readonly [string, (r: RhythmMetrics) => number | null][] = [
  ["coherencePct", (r) => pct(r.coherence)],
  ["oscillations", (r) => r.oscillations],
  ["startJitterMean", (r) => r.startJitter.mean],
  ["nightValuePct", (r) => pct(r.nights.value)],
  ["nightExitsToEarly", (r) => r.nights.exitsToEarly],
  ["nightMinRecoveryHours", (r) => r.nights.minRecoveryHours],
  ["worstTransition", (r) => r.worstTransition],
];

/** De zoekmachineversie zoals de kandidaat hem zelf vastlegde. */
const versies = (runs: readonly RawRun[]) => [
  ...new Set(
    runs.filter(telt).flatMap((run) => run.candidates.map((k) => String(k.provenance?.optimizerModelVersion ?? run.engine))),
  ),
];

/**
 * Waar de uitschieters zitten, per basisrooster: kortste herstel na nachten per
 * kandidaat, uitgangen onder de herstelregel, zware overgangen en korte
 * nachtreeksen. Een gemiddelde verbetering kan één profiel verbergen dat
 * achteruitgaat; in de eerste AFTER-meting was dat DDR-BLM.
 */
function diagnose(sets: readonly (readonly QualityRosterInput[])[], context: EvaluationContext) {
  const regel = context.rules.nightRecoveryMinutes;
  const kortsteHerstel: Record<string, number> = { "<36": 0, "36-45": 0, "46-55": 0, ">=56": 0 };
  const kortUitgang: Record<string, number> = {};
  const kortReeks: Record<string, number> = {};
  const zwaar: Record<string, number> = {};
  const tel = (x: Record<string, number>, sleutel: string) => {
    x[sleutel] = (x[sleutel] ?? 0) + 1;
  };
  for (const rosters of sets) {
    let min = Number.POSITIVE_INFINITY;
    for (const rooster of rosters) {
      for (const blok of nightBlocksFlow(flowDays(rooster, context.quality.duties))) {
        if (blok.length <= 2) tel(kortReeks, `${rooster.code} · ${blok.length}`);
        if (blok.recoveryMinutes === null) continue;
        min = Math.min(min, blok.recoveryMinutes);
        if (blok.recoveryMinutes < regel) tel(kortUitgang, rooster.code);
      }
    }
    if (Number.isFinite(min)) {
      const uren = min / 60;
      tel(kortsteHerstel, uren < 36 ? "<36" : uren < 46 ? "36-45" : uren < 56 ? "46-55" : ">=56");
    }
    for (const r of rhythmMetrics(rosters, context.quality.duties, context.rules).worstTransitionPerLine) {
      if (r.penalty >= 3) tel(zwaar, `${r.roster} · ${r.pattern}`);
    }
  }
  const gesorteerd = (x: Record<string, number>) => Object.fromEntries(Object.entries(x).sort((a, b) => b[1] - a[1]));
  return {
    sets: sets.length,
    minRecoveryHoursPerCandidate: kortsteHerstel,
    exitsBelowRuleByRoster: gesorteerd(kortUitgang),
    shortNightBlocksByRoster: gesorteerd(kortReeks),
    heavyTransitionLinesByPattern: gesorteerd(zwaar),
  };
}

async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const { duties } = context.quality;

  const officieel: Meting = {
    strategy: "OFFICIAL",
    run: 0,
    candidate: 0,
    report: evaluateOfficialCore(context, QUALITY_MODEL_V2),
    rhythm: rhythmMetrics(context.quality.official, duties, context.rules),
    meanBlockLength: gemiddeldWerkblok(context.quality.official, duties),
  };

  const voorRuns = readRuns("after");
  const naFase = (argument("after") ?? "human") as Phase;
  const naRuns = readRuns(naFase);
  const voor = meet(voorRuns, context);
  const na = meet(naRuns, context);
  if (voor.length === 0 || na.length === 0) {
    throw new Error(`Geen vergelijking mogelijk: BEFORE ${voor.length} kandidaten, AFTER ${na.length}.`);
  }

  const vergelijking = MATEN.map((maat) => {
    const a = stat(voor.map(maat.waarde).filter((x): x is number => x !== null));
    const b = stat(na.map(maat.waarde).filter((x): x is number => x !== null));
    const delta = a && b ? b.mean - a.mean : null;
    const oordeel =
      delta === null ? null : Math.abs(delta) < 1e-9 ? "gelijk" : (maat.hoger ? delta > 0 : delta < 0) ? "beter" : "slechter";
    return { key: maat.key, label: maat.label, higherIsBetter: maat.hoger, official: maat.waarde(officieel), before: a, after: b, delta, verdict: oordeel };
  });

  // Per basisrooster, zodat een profiel dat achteruitgaat niet in het gemiddelde verdwijnt.
  const ritmeVan = (rosters: readonly QualityRosterInput[], code: string) => {
    const rooster = rosters.find((r) => r.code === code);
    return rooster ? rhythmMetrics([rooster], duties, context.rules) : null;
  };
  const kandidaatRoosters = (runs: readonly RawRun[]) =>
    runs.filter(telt).flatMap((run) => run.candidates.map((k) => candidateRosterInputs(decodeAssignments(k.roster), context.quality)));
  const voorRoosters = kandidaatRoosters(voorRuns);
  const naRoosters = kandidaatRoosters(naRuns);
  const perRooster = context.quality.official.map((ref) => {
    const middel = (sets: readonly (readonly QualityRosterInput[])[], f: (r: RhythmMetrics) => number | null) => {
      const xs = sets
        .map((rosters) => ritmeVan(rosters, ref.code))
        .filter((r): r is RhythmMetrics => r !== null)
        .map(f)
        .filter((x): x is number => x !== null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const eigen = ritmeVan(context.quality.official, ref.code)!;
    return {
      roster: ref.code,
      profile: ref.profile,
      metrics: Object.fromEntries(
        PER_ROOSTER.map(([naam, f]) => [naam, { official: f(eigen), before: middel(voorRoosters, f), after: middel(naRoosters, f) }]),
      ),
    };
  });

  const hard = (metingen: readonly Meting[]) => ({
    candidates: metingen.length,
    allHardValid: metingen.every((m) => m.report.hardValidity.hardValid),
    maxUnassigned: Math.max(...metingen.map((m) => m.report.hardValidity.coverage.unassigned)),
    maxProfileBreaches: Math.max(...metingen.map((m) => m.report.hardValidity.profileBreaches.length)),
  });
  const hardNa = hard(na);

  const maat = (key: string) => vergelijking.find((c) => c.key === key)!;
  const beter = (key: string) => maat(key).verdict === "beter";
  const alNul = (key: string) => (maat(key).before?.max ?? 1) === 0 && (maat(key).after?.max ?? 1) === 0;
  const binnen = (key: string, marge: number) => (maat(key).delta ?? 0) >= -marge;
  const acceptatie = [
    {
      eis: "0 harde overtredingen, volledige dekking, 0 profielovertredingen",
      gehaald: hardNa.allHardValid && hardNa.maxUnassigned === 0 && hardNa.maxProfileBreaches === 0,
    },
    { eis: "Minder heen-en-weer", gehaald: beter("oscillations") || alNul("oscillations") },
    { eis: "Minder losse nachten", gehaald: beter("singletonNights") || alNul("singletonNights") },
    { eis: "Langere, samenhangender werkblokken", gehaald: beter("coherence") && maat("meanBlockLength").verdict !== "slechter" },
    { eis: "Beter herstel na nachten", gehaald: beter("nightExitValue") && beter("nightMinRecoveryHours") },
    { eis: "Stabielere begintijden", gehaald: beter("startJitterMean") },
    { eis: "Minder zware slechtste overgang", gehaald: beter("worstTransition") || maat("worstTransition").verdict === "gelijk" },
    { eis: "Eerlijkheid niet verder achteruit (marge 0,5)", gehaald: binnen("fairness", 0.5) },
    { eis: "Uren niet noemenswaardig achteruit (marge 1)", gehaald: binnen("hours", 1) },
    { eis: "Rust niet noemenswaardig achteruit (marge 1)", gehaald: binnen("rest", 1) },
  ];

  const perKandidaat = (metingen: readonly Meting[]) =>
    metingen.map((m) => ({
      strategy: m.strategy,
      run: m.run,
      candidate: m.candidate,
      ...Object.fromEntries(MATEN.map((x) => [x.key, x.waarde(m)])),
    }));

  const diagnostiek = {
    official: diagnose([context.quality.official], context),
    before: diagnose(voorRoosters, context),
    after: diagnose(naRoosters, context),
  };

  const doel = path.resolve(__dirname, "..", "..", "docs", "human-roster-benchmark", argument("out") ?? "analysis-before-after.json");
  writeFileSync(
    doel,
    `${JSON.stringify(
      {
        schema: "ns-human-calibration-analysis/1",
        measuredAt: new Date().toISOString(),
        qualityModel: QUALITY_MODEL_V2.version,
        before: { source: "docs/optimizer-benchmark/after", versions: versies(voorRuns), runs: voorRuns.filter(telt).length, candidates: voor.length },
        after: { source: `docs/optimizer-benchmark/${naFase}`, versions: versies(naRuns), runs: naRuns.filter(telt).length, candidates: na.length },
        hard: { before: hard(voor), after: hardNa },
        comparison: vergelijking,
        perRoster: perRooster,
        acceptance: acceptatie,
        diagnostics: diagnostiek,
        perCandidate: { before: perKandidaat(voor), after: perKandidaat(na) },
      },
      null,
      2,
    )}\n`,
  );

  const t = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "—" : x.toFixed(d));
  console.log(`BEFORE: ${voor.length} kandidaten · AFTER: ${na.length} kandidaten · model ${QUALITY_MODEL_V2.version}\n`);
  console.log(`${"maat".padEnd(38)} ${"officieel".padStart(9)} ${"before".padStart(8)} ${"after".padStart(8)} ${"delta".padStart(7)}  oordeel`);
  for (const c of vergelijking) {
    const d = c.delta === null ? "—" : `${c.delta > 0 ? "+" : ""}${c.delta.toFixed(1)}`;
    console.log(
      `${c.label.padEnd(38).slice(0, 38)} ${t(c.official).padStart(9)} ${t(c.before?.mean).padStart(8)} ${t(c.after?.mean).padStart(8)} ${d.padStart(7)}  ${c.verdict}`,
    );
  }
  console.log(`\nHard: ${JSON.stringify(hardNa)}`);
  console.log("\nAcceptatie (§81, §75):");
  for (const a of acceptatie) console.log(`  ${a.gehaald ? "✓" : "✗"} ${a.eis}`);
  for (const [naam, d] of Object.entries(diagnostiek)) {
    console.log(`\n${naam}: kortste herstel na nachten per kandidaat ${JSON.stringify(d.minRecoveryHoursPerCandidate)}`);
    console.log(`  uitgangen onder de herstelregel ${JSON.stringify(d.exitsBelowRuleByRoster)}`);
    console.log(`  zware overgangen ${JSON.stringify(d.heavyTransitionLinesByPattern)}`);
    console.log(`  korte nachtreeksen ${JSON.stringify(d.shortNightBlocksByRoster)}`);
  }
  console.log(`\nGeschreven: ${doel}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
