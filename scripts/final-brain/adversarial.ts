import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { type HumanQualityReport, evaluateQuality } from "@/domain/quality-evaluator";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { polishBySwaps } from "@/domain/roster-polish";
import type { QualityRosterInput } from "@/domain/roster-quality";
import { prisma } from "@/server/data/prisma";
import { type EvaluationContext, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { decodeAssignments, readRuns } from "../benchmark/io";
import { measureRosters } from "./metrics";

/**
 * Goodhart-jacht: kan de zoekmachine de score opdrijven terwijl het menselijke
 * patroon slechter wordt? (werkopdracht §14)
 *
 * ## Deel A — de zoekmachine zelf als tegenstander
 *
 * Vanuit het officiële rooster en vanuit vier v1.0.4-kandidaten laat dit script
 * dezelfde ruilzoektocht als het bijschaven de robuuste score zo hoog mogelijk
 * maken. Daarna worden de ruwe menselijke patronen vergeleken — tellingen die
 * niet uit het model komen: nachtuitgangen onder de regel, losse nachten,
 * reeksen van twee, directe wissels terug op de klok, krappe rust. Stijgt de
 * score terwijl zo'n telling slechter wordt, dan heeft de zoekmachine een gat in
 * de meting gevonden. Zo zijn H04 en H09 ontdekt; dit maakt die jacht vast
 * onderdeel van de controle.
 *
 * ## Deel B — per principe een bedorven rooster
 *
 * Vanuit het officiële rooster zoekt de omgekeerde ruilzoektocht de hard
 * geldige variant die één principe zo slecht mogelijk maakt. Het model moet het
 * verschil zien op het onderdeel dat werd aangetast, en het menselijke rooster
 * als geheel hoger zetten.
 *
 *   npm run final-brain:adversarial
 */

const WORTEL = path.resolve(__dirname, "..", "..");

function beoordeel(rosters: readonly QualityRosterInput[], context: EvaluationContext): HumanQualityReport {
  return evaluateQuality({
    model: QUALITY_MODEL_V2,
    rosters,
    reference: context.quality.official,
    duties: context.quality.duties,
    requiredDutyKeys: context.requiredDutyKeys,
    nightRosterCodes: context.quality.nightRosterCodes,
    rules: context.rules,
  });
}

/** Ruwe patronen, niet uit het model: tellingen en minuten. */
function ruw(rosters: readonly QualityRosterInput[], context: EvaluationContext) {
  const r = beoordeel(rosters, context);
  const m = measureRosters(rosters, r, null, context);
  const banden = r.metrics.rest.bands;
  return {
    robust: r.robust ?? 0,
    exitsBelowRule: m.nights.exitsBelowRule,
    exitsToEarly: m.nights.exitsToEarly,
    minRecoveryHours: m.nights.minRecoveryHours ?? 999,
    singletons: m.nights.singletons,
    pairs: m.nights.pairs,
    backwardDirectOver60: m.transitions.backwardDirectOver60,
    oscillations: m.transitions.oscillations,
    heavyClockAware: m.transitions.heavyClockAware,
    tightRest: (banden.below ?? 0) + (banden["0-1h"] ?? 0),
    incoherentBlocks: m.coherence.blocks - m.coherence.fullyCoherent,
    startJitterMean: m.startJitter.mean ?? 0,
    maxRosterHoursDeviation: m.hours.maxRosterDeviation,
    nightsPerLineSd: r.metrics.nights.perEligibleLine.sd,
    weekendDaysPerLineSd: r.metrics.fairness.weekendDaysPerLine.sd,
  };
}
type Ruw = ReturnType<typeof ruw>;

/** Welke kant is slechter, en vanaf welk verschil telt het. */
const RICHTING: Readonly<Record<Exclude<keyof Ruw, "robust">, { hoger: boolean; marge: number; label: string }>> = {
  exitsBelowRule: { hoger: false, marge: 0, label: "nachtuitgangen onder 46 u" },
  exitsToEarly: { hoger: false, marge: 0, label: "nachtreeks gevolgd door vroeg" },
  minRecoveryHours: { hoger: true, marge: 0.5, label: "kortste herstel na nachten (u)" },
  singletons: { hoger: false, marge: 0, label: "losse nachten" },
  pairs: { hoger: false, marge: 0, label: "reeksen van twee" },
  backwardDirectOver60: { hoger: false, marge: 0, label: "directe wissel terug op de klok" },
  oscillations: { hoger: false, marge: 0, label: "heen-en-weer" },
  heavyClockAware: { hoger: false, marge: 0, label: "zware overgangen" },
  tightRest: { hoger: false, marge: 0, label: "rust minder dan een uur boven het minimum" },
  incoherentBlocks: { hoger: false, marge: 0, label: "werkblokken met meer dan één dagdeel" },
  startJitterMean: { hoger: false, marge: 5, label: "begintijdsprong gemiddeld (min)" },
  maxRosterHoursDeviation: { hoger: false, marge: 5, label: "grootste urenafwijking (min/week)" },
  nightsPerLineSd: { hoger: false, marge: 0.05, label: "spreiding nachten per regel" },
  weekendDaysPerLineSd: { hoger: false, marge: 0.1, label: "spreiding weekenddagen per regel" },
};

function verslechteringen(voor: Ruw, na: Ruw) {
  return (Object.keys(RICHTING) as (keyof typeof RICHTING)[])
    .filter((k) => (RICHTING[k].hoger ? na[k] < voor[k] - RICHTING[k].marge : na[k] > voor[k] + RICHTING[k].marge))
    .map((k) => ({ metric: k, label: RICHTING[k].label, before: voor[k], after: na[k] }));
}

interface Bederf {
  readonly naam: string;
  readonly principe: string;
  readonly bederf: (r: Ruw) => number;
  readonly onderdeel: (r: HumanQualityReport) => number | null;
  readonly onderdeelNaam: string;
}

const BEDERF: readonly Bederf[] = [
  { naam: "korte-nachtuitgang", principe: "Na nachten eerst herstel", bederf: (r) => r.exitsBelowRule * 10 - r.minRecoveryHours, onderdeel: (r) => r.components.nights.score, onderdeelNaam: "nachten" },
  { naam: "korte-nachtreeksen", principe: "Nachten in reeksen van drie tot zes", bederf: (r) => r.singletons * 10 + r.pairs * 6, onderdeel: (r) => r.components.nights.score, onderdeelNaam: "nachten" },
  { naam: "etiket-terug", principe: "Wissels op de klok, niet op het etiket", bederf: (r) => r.backwardDirectOver60 * 10 + r.heavyClockAware * 5, onderdeel: (r) => r.components.flow.score, onderdeelNaam: "regelmaat" },
  { naam: "springende-begintijden", principe: "Begintijden binnen een blok bij elkaar", bederf: (r) => r.startJitterMean, onderdeel: (r) => r.components.flow.score, onderdeelNaam: "regelmaat" },
  { naam: "heen-en-weer", principe: "Geen heen-en-weer, blokken van één dagdeel", bederf: (r) => r.oscillations * 10 + r.incoherentBlocks * 3, onderdeel: (r) => r.components.flow.score, onderdeelNaam: "regelmaat" },
  { naam: "krappe-rust", principe: "Rust boven het minimum", bederf: (r) => r.tightRest, onderdeel: (r) => r.components.rest.score, onderdeelNaam: "rust" },
  { naam: "uren-scheef", principe: "Roosteruren op cyclusniveau", bederf: (r) => r.maxRosterHoursDeviation, onderdeel: (r) => r.components.hours.score, onderdeelNaam: "uren" },
  { naam: "oneerlijk", principe: "Eerlijke verdeling van nachten en weekenden", bederf: (r) => r.nightsPerLineSd * 10 + r.weekendDaysPerLineSd * 5, onderdeel: (r) => r.components.fairness.score, onderdeelNaam: "eerlijkheid" },
];

async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const minRust = context.rules.minDailyRestMinutes;
  const seconden = Number(process.argv[process.argv.indexOf("--seconds") + 1]) || 20;

  // ── Deel A ──
  const v104 = readRuns("after").filter((r) => r.strategy !== "REPRODUCE");
  const starts: { naam: string; rosters: readonly QualityRosterInput[] }[] = [
    { naam: "officieel", rosters: context.quality.official },
    ...[1, 5, 11, 16].map((nr) => {
      const run = v104.find((r) => r.runNumber === nr)!;
      return { naam: `v1.0.4 run ${nr} (${run.strategy})`, rosters: candidateRosterInputs(decodeAssignments(run.candidates[0].roster), context.quality) };
    }),
  ];
  const jacht = [];
  for (const start of starts) {
    const voor = ruw(start.rosters, context);
    const opgedreven = polishBySwaps({
      rosters: start.rosters,
      duties: context.quality.duties,
      minRestMinutes: minRust,
      score: (rosters) => beoordeel(rosters, context).robust ?? 0,
      deadline: Date.now() + seconden * 1000,
      seed: 7,
    });
    const na = ruw(opgedreven.rosters, context);
    const slechter = verslechteringen(voor, na);
    jacht.push({ start: start.naam, swaps: opgedreven.moves.length, robustBefore: voor.robust, robustAfter: na.robust, before: voor, after: na, worsened: slechter, exploit: na.robust > voor.robust && slechter.length > 0 });
    console.log(`A ${start.naam.padEnd(34)} robuust ${voor.robust.toFixed(1)} → ${na.robust.toFixed(1)} in ${opgedreven.moves.length} ruilen; slechter: ${slechter.map((s) => `${s.label} ${s.before} → ${Number(s.after.toFixed(2))}`).join("; ") || "niets"}`);
  }

  // ── Deel B ──
  const officieel = beoordeel(context.quality.official, context);
  const negatief = [];
  for (const b of BEDERF) {
    const slecht = polishBySwaps({
      rosters: context.quality.official,
      duties: context.quality.duties,
      minRestMinutes: minRust,
      score: (rosters) => b.bederf(ruw(rosters, context)),
      deadline: Date.now() + 8000,
      seed: 17,
      maxKicks: 0,
    });
    const fout = beoordeel(slecht.rosters, context);
    const rij = {
      test: b.naam,
      principle: b.principe,
      swaps: slecht.moves.length,
      hardValid: fout.hardValidity.hardValid,
      component: b.onderdeelNaam,
      componentHuman: b.onderdeel(officieel),
      componentNegative: b.onderdeel(fout),
      seesIt: (b.onderdeel(officieel) ?? 0) > (b.onderdeel(fout) ?? 0),
      robustHuman: officieel.robust,
      robustNegative: fout.robust,
      humanHigher: (officieel.robust ?? 0) > (fout.robust ?? 0),
    };
    negatief.push(rij);
    console.log(`B ${b.naam.padEnd(24)} ${rij.swaps} ruilen · ${rij.component} ${rij.componentHuman} → ${rij.componentNegative} · robuust ${rij.robustHuman} → ${rij.robustNegative} · ${rij.seesIt && rij.humanHigher ? "gezien" : "NIET GEZIEN"}`);
  }

  writeFileSync(
    path.join(WORTEL, "docs", "v1.0.4-final-brain", "adversarial.json"),
    `${JSON.stringify({ schema: "ns-final-brain-adversarial/1", measuredAt: new Date().toISOString(), qualityModel: QUALITY_MODEL_V2.version, secondsPerHunt: seconden, hunt: jacht, negatives: negatief }, null, 2)}\n`,
  );
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
