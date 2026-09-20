import { createHash } from "node:crypto";
import type { CandidateAssignment } from "@/domain/candidate";
import type { HumanQualityReport } from "@/domain/quality-evaluator";
import { QUALITY_MODEL_V1, QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { flowDays, klokAfstand, nightBlocksFlow, workBlocks, workedPairs } from "@/domain/roster-flow";
import type { QualityRosterInput } from "@/domain/roster-quality";
import { nightExitValue, rhythmMetrics } from "@/domain/rhythm-metrics";
import { type EvaluationContext, evaluateAssignmentsCore, evaluateOfficialCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";

/**
 * Eén meetlat voor elke kandidaat: BEFORE, ontwikkelmetingen, ablaties, AFTER.
 *
 * ## Wat een maat hier moet zijn
 *
 * Uit te rekenen uit de toewijzingen alleen, met dezelfde code als voor het
 * officiële rooster. Geen maat leest iets uit het zoekjournaal van de
 * zoekmachine: een kandidaat wordt beoordeeld op wat hij ís, niet op wat de
 * machine ervan dacht. Het kwaliteitsmodel is v2, vastgepind (de Final-Brain-ronde is daarmee gemeten; v3 kwam erna);
 * v1 staat ernaast voor de aansluiting op het v1.0.4-rapport.
 *
 * ## Slechtste gevallen
 *
 * Naast gemiddelden telt per kandidaat het slechtste: de slechtste regel, de
 * slechtste nachtuitgang, de zwaarste overgang, het rommeligste werkblok. Een
 * sterk gemiddelde mag één extreme fout niet verbergen (werkopdracht §12, §13).
 */

export interface CandidateMetrics {
  readonly hard: { valid: boolean; unassigned: number; profileBreaches: number };
  readonly quality: {
    robust: number | null;
    overall: number | null;
    overallWithoutContinuity: number | null;
    components: Record<string, number | null>;
    worstLine: { score: number | null; roster: string | null; line: number | null };
    patternDistance: number | null;
    robustV1: number | null;
    worstLineV1: number | null;
  };
  readonly nights: {
    total: number;
    blocks: Record<string, number>;
    singletons: number;
    pairs: number;
    blockValue: number | null;
    exitValue: number | null;
    worstExitValue: number | null;
    exitsBelowRule: number;
    exitsToEarly: number;
    minRecoveryHours: number | null;
    worstExit: { roster: string; lines: string; pattern: string; hours: number | null } | null;
  };
  readonly coherence: { blocks: number; fullyCoherent: number; coherentShare: number | null; dayWeighted: number | null; meanBlockLength: number | null };
  readonly transitions: {
    oscillations: number;
    labelOnlyOscillations: number;
    directDaypartChanges: number;
    changesThroughRest: number | null;
    worstLabel: number;
    heavyClockAware: number;
    linesWithHeavyLabel: number;
    boundaryDaypartChanges: number;
    boundaryHeavy: number;
    forwardChanges: number;
    backwardChanges: number;
    backwardDirectOver60: number;
  };
  readonly startJitter: { mean: number | null; median: number | null; p90: number | null; over120: number };
  readonly worstWorkBlock: { switches: number; states: string | null };
  readonly hours: { maxRosterDeviation: number; meanRosterDeviation: number; lineOutliers: number };
  readonly rest: { shortestSurplusMinutes: number | null };
  readonly structureFamily: string;
  /** Per basisrooster: het karakter van elk profiel apart (§9, §17). */
  readonly perRoster: Readonly<Record<string, RosterMetrics>>;
}

export interface RosterMetrics {
  readonly profile: string;
  readonly worstLine: number | null;
  readonly weeklyDeviation: number | null;
  readonly nightBlocks: Record<string, number>;
  readonly exitsBelowRule: number;
  readonly minRecoveryHours: number | null;
  readonly coherence: number | null;
  readonly oscillations: number;
  readonly startJitterMean: number | null;
  readonly worstTransition: number;
}

const gemiddelde = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * De structuurfamilie: waar in elk rooster de nachtreeksen liggen en hoe lang
 * ze zijn. Twee kandidaten met dezelfde familie verschillen alleen in welke
 * dienst waar staat, niet in hoe het rooster rijdt (§21).
 */
function familie(rosters: readonly QualityRosterInput[], context: EvaluationContext): string {
  const delen = rosters
    .map((r) => {
      const dagen = flowDays(r, context.quality.duties);
      const reeksen = nightBlocksFlow(dagen).map((b) => `${dagen[b.startIndex].lineNumber}.${dagen[b.startIndex].weekday}x${b.length}`);
      return reeksen.length ? `${r.code}:${reeksen.sort().join(",")}` : "";
    })
    .filter(Boolean)
    .sort();
  return createHash("sha256").update(delen.join("|")).digest("hex").slice(0, 12);
}

export function measureRosters(rosters: readonly QualityRosterInput[], report: HumanQualityReport, reportV1: HumanQualityReport | null, context: EvaluationContext): CandidateMetrics {
  const { duties } = context.quality;
  const regel = context.rules.nightRecoveryMinutes;
  const ritme = rhythmMetrics(rosters, duties, context.rules);

  let slechtsteUitgang: CandidateMetrics["nights"]["worstExit"] = null;
  let slechtsteWaarde: number | null = null;
  let onderRegel = 0;
  let blokken = 0;
  let coherent = 0;
  const lengtes: number[] = [];
  let vooruit = 0;
  let achteruit = 0;
  let achteruitDirect = 0;
  for (const r of rosters) {
    const dagen = flowDays(r, duties);
    for (const b of nightBlocksFlow(dagen)) {
      const waarde = nightExitValue(b.nextState, b.recoveryMinutes, regel);
      if (b.recoveryMinutes !== null && b.recoveryMinutes < regel) onderRegel += 1;
      if (slechtsteWaarde === null || waarde < slechtsteWaarde || (waarde === slechtsteWaarde && (b.recoveryMinutes ?? Infinity) < (slechtsteUitgang?.hours ?? Infinity) * 60)) {
        slechtsteWaarde = waarde;
        slechtsteUitgang = {
          roster: r.code,
          lines: b.lines.join("+"),
          pattern: `${"N".repeat(b.length)}${b.exit}`,
          hours: b.recoveryMinutes === null ? null : Math.round((b.recoveryMinutes / 60) * 10) / 10,
        };
      }
    }
    for (const w of workBlocks(dagen)) {
      blokken += 1;
      lengtes.push(w.length);
      if (w.switches === 0) coherent += 1;
    }
    // Richting van een dagdeelwissel: begint de volgende dienst later of eerder op de klok?
    for (const p of workedPairs(dagen)) {
      if (p.from === p.to) continue;
      const a = dagen[p.fromIndex].start;
      const b = dagen[p.toIndex].start;
      if (a === null || b === null) continue;
      const vooruitMinuten = (((b - a) % 1440) + 1440) % 1440;
      const isVooruit = vooruitMinuten <= 720;
      if (isVooruit) vooruit += 1;
      else achteruit += 1;
      if (!isVooruit && p.offDaysBetween + p.resDaysBetween === 0 && klokAfstand(a, b) > 60) achteruitDirect += 1;
    }
  }

  const hist: Record<string, number> = {};
  for (const [lengte, aantal] of Object.entries(ritme.nights.lengths)) {
    const sleutel = Number(lengte) >= 5 ? "5+" : lengte;
    hist[sleutel] = (hist[sleutel] ?? 0) + aantal;
  }
  const uren = report.metrics.hours;
  // De natuurlijke band van een regel uit het model; een regel mag ver van 40:00 liggen (§10).
  const band = (QUALITY_MODEL_V2.components.hours.parts as { outliers?: { naturalBandMinutes: number } }).outliers?.naturalBandMinutes ?? 630;
  return {
    hard: {
      valid: report.hardValidity.hardValid,
      unassigned: report.hardValidity.coverage.unassigned,
      profileBreaches: report.hardValidity.profileBreaches.length,
    },
    quality: {
      robust: report.robust,
      overall: report.overall,
      overallWithoutContinuity: report.overallWithoutContinuity,
      components: Object.fromEntries(Object.entries(report.components).map(([k, c]) => [k, c.score])),
      worstLine: { score: report.lines.worst?.score ?? null, roster: report.lines.worst?.roster ?? null, line: report.lines.worst?.lineNumber ?? null },
      patternDistance: report.patternDistance?.total ?? null,
      robustV1: reportV1?.robust ?? null,
      worstLineV1: reportV1?.lines.worst?.score ?? null,
    },
    nights: {
      total: report.metrics.nights.total,
      blocks: hist,
      singletons: report.metrics.nights.singletons,
      pairs: report.metrics.nights.blocks2,
      blockValue: ritme.nights.value === null ? null : ritme.nights.value * 100,
      exitValue: ritme.nights.exitValue === null ? null : ritme.nights.exitValue * 100,
      worstExitValue: slechtsteWaarde === null ? null : slechtsteWaarde * 100,
      exitsBelowRule: onderRegel,
      exitsToEarly: ritme.nights.exitsToEarly,
      minRecoveryHours: ritme.nights.minRecoveryHours,
      worstExit: slechtsteUitgang,
    },
    coherence: {
      blocks: blokken,
      fullyCoherent: coherent,
      coherentShare: blokken ? (coherent / blokken) * 100 : null,
      dayWeighted: ritme.coherence === null ? null : ritme.coherence * 100,
      meanBlockLength: gemiddelde(lengtes),
    },
    transitions: {
      oscillations: ritme.oscillations,
      labelOnlyOscillations: ritme.labelOnlyOscillations,
      directDaypartChanges: ritme.directDaypartChanges,
      changesThroughRest: ritme.changesThroughRest === null ? null : ritme.changesThroughRest * 100,
      worstLabel: ritme.worstTransition,
      heavyClockAware: report.metrics.transitions.heavy,
      linesWithHeavyLabel: ritme.worstTransitionPerLine.filter((r) => r.penalty >= 3).length,
      boundaryDaypartChanges: ritme.boundaries.daypartChangeAcross,
      boundaryHeavy: ritme.boundaries.heavyAcross,
      forwardChanges: vooruit,
      backwardChanges: achteruit,
      backwardDirectOver60: achteruitDirect,
    },
    startJitter: { mean: ritme.startJitter.mean, median: ritme.startJitter.median, p90: ritme.startJitter.p90, over120: ritme.startJitter.over120 },
    worstWorkBlock: { switches: ritme.worstWorkBlock?.switches ?? 0, states: ritme.worstWorkBlock?.states ?? null },
    hours: {
      maxRosterDeviation: Math.max(...uren.rosters.map((r) => Math.abs(r.deviationMinutes))),
      meanRosterDeviation: gemiddelde(uren.rosters.map((r) => Math.abs(r.deviationMinutes))) ?? 0,
      lineOutliers: uren.lines.filter((l) => Math.abs(l.deviationMinutes) > band).length,
    },
    rest: { shortestSurplusMinutes: report.metrics.rest.shortestSurplusMinutes },
    structureFamily: familie(rosters, context),
    perRoster: Object.fromEntries(
      rosters.map((r) => {
        const eigen = rhythmMetrics([r], duties, context.rules);
        const regels = report.lines.all.filter((l) => l.roster === r.code && l.score !== null).map((l) => l.score as number);
        const uitgangen = nightBlocksFlow(flowDays(r, duties)).filter((b) => b.recoveryMinutes !== null && b.recoveryMinutes < regel).length;
        return [
          r.code,
          {
            profile: r.profile,
            worstLine: regels.length ? Math.min(...regels) : null,
            weeklyDeviation: uren.rosters.find((x) => x.code === r.code)?.deviationMinutes ?? null,
            nightBlocks: eigen.nights.lengths,
            exitsBelowRule: uitgangen,
            minRecoveryHours: eigen.nights.minRecoveryHours,
            coherence: eigen.coherence === null ? null : eigen.coherence * 100,
            oscillations: eigen.oscillations,
            startJitterMean: eigen.startJitter.mean,
            worstTransition: eigen.worstTransition,
          },
        ];
      }),
    ),
  };
}

export function measureAssignments(assignments: readonly CandidateAssignment[], context: EvaluationContext): CandidateMetrics {
  const rosters = candidateRosterInputs(assignments, context.quality);
  const report = evaluateAssignmentsCore(assignments, context, QUALITY_MODEL_V2);
  const reportV1 = evaluateAssignmentsCore(assignments, context, QUALITY_MODEL_V1);
  return measureRosters(rosters, report, reportV1, context);
}

export function measureOfficial(context: EvaluationContext): CandidateMetrics {
  return measureRosters(
    context.quality.official,
    evaluateOfficialCore(context, QUALITY_MODEL_V2),
    evaluateOfficialCore(context, QUALITY_MODEL_V1),
    context,
  );
}

/** Een maat als getal uit de platte meting, met zijn richting. */
export interface MetricSpec {
  readonly key: string;
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly get: (m: CandidateMetrics) => number | null;
  readonly decimals: number;
}

export const METRICS: readonly MetricSpec[] = [
  { key: "robust", label: "Robuuste kwaliteit", higherIsBetter: true, get: (m) => m.quality.robust, decimals: 1 },
  { key: "overallWithoutContinuity", label: "Kwaliteit zonder continuïteit", higherIsBetter: true, get: (m) => m.quality.overallWithoutContinuity, decimals: 1 },
  { key: "worstLine", label: "Slechtste regel", higherIsBetter: true, get: (m) => m.quality.worstLine.score, decimals: 1 },
  { key: "flow", label: "Regelmaat", higherIsBetter: true, get: (m) => m.quality.components.flow, decimals: 1 },
  { key: "nights", label: "Nachten", higherIsBetter: true, get: (m) => m.quality.components.nights, decimals: 1 },
  { key: "rest", label: "Rust", higherIsBetter: true, get: (m) => m.quality.components.rest, decimals: 1 },
  { key: "hours", label: "Uren", higherIsBetter: true, get: (m) => m.quality.components.hours, decimals: 1 },
  { key: "fairness", label: "Eerlijkheid", higherIsBetter: true, get: (m) => m.quality.components.fairness, decimals: 1 },
  { key: "stability", label: "Continuïteit", higherIsBetter: true, get: (m) => m.quality.components.stability, decimals: 1 },
  { key: "singletons", label: "Losse nachten", higherIsBetter: false, get: (m) => m.nights.singletons, decimals: 2 },
  { key: "pairs", label: "Reeksen van twee nachten", higherIsBetter: false, get: (m) => m.nights.pairs, decimals: 2 },
  { key: "nightBlockValue", label: "Waarde nachtreeksen", higherIsBetter: true, get: (m) => m.nights.blockValue, decimals: 1 },
  { key: "nightExitValue", label: "Uitgang na nachten (gemiddeld)", higherIsBetter: true, get: (m) => m.nights.exitValue, decimals: 1 },
  { key: "worstNightExit", label: "Slechtste nachtuitgang", higherIsBetter: true, get: (m) => m.nights.worstExitValue, decimals: 1 },
  { key: "minRecoveryHours", label: "Kortste herstel na nachtreeks (u)", higherIsBetter: true, get: (m) => m.nights.minRecoveryHours, decimals: 1 },
  { key: "exitsBelowRule", label: "Nachtuitgangen onder 46 u", higherIsBetter: false, get: (m) => m.nights.exitsBelowRule, decimals: 2 },
  { key: "exitsToEarly", label: "Nachtreeks gevolgd door vroeg", higherIsBetter: false, get: (m) => m.nights.exitsToEarly, decimals: 2 },
  { key: "coherence", label: "Samenhang werkblokken (dagen, %)", higherIsBetter: true, get: (m) => m.coherence.dayWeighted, decimals: 1 },
  { key: "coherentShare", label: "Werkblokken met één dagdeel (%)", higherIsBetter: true, get: (m) => m.coherence.coherentShare, decimals: 1 },
  { key: "oscillations", label: "Heen-en-weer (op de klok)", higherIsBetter: false, get: (m) => m.transitions.oscillations, decimals: 2 },
  { key: "changesThroughRest", label: "Dagdeelwissels via rust (%)", higherIsBetter: true, get: (m) => m.transitions.changesThroughRest, decimals: 1 },
  { key: "heavyClockAware", label: "Zware overgangen (op de klok)", higherIsBetter: false, get: (m) => m.transitions.heavyClockAware, decimals: 2 },
  { key: "worstTransition", label: "Zwaarste overgang (etiket)", higherIsBetter: false, get: (m) => m.transitions.worstLabel, decimals: 2 },
  { key: "backwardDirectOver60", label: "Directe wissel terug op de klok (> 1 u)", higherIsBetter: false, get: (m) => m.transitions.backwardDirectOver60, decimals: 2 },
  { key: "boundaryHeavy", label: "Zware overgang over de regelgrens", higherIsBetter: false, get: (m) => m.transitions.boundaryHeavy, decimals: 2 },
  { key: "worstWorkBlock", label: "Rommeligste werkblok (wissels)", higherIsBetter: false, get: (m) => m.worstWorkBlock.switches, decimals: 2 },
  { key: "startJitterMean", label: "Begintijdsprong gemiddeld (min)", higherIsBetter: false, get: (m) => m.startJitter.mean, decimals: 0 },
  { key: "startJitterP90", label: "Begintijdsprong p90 (min)", higherIsBetter: false, get: (m) => m.startJitter.p90, decimals: 0 },
  { key: "maxRosterHoursDeviation", label: "Grootste urenafwijking rooster (min/week)", higherIsBetter: false, get: (m) => m.hours.maxRosterDeviation, decimals: 1 },
  { key: "patternDistance", label: "Structurele afstand tot officieel", higherIsBetter: false, get: (m) => m.quality.patternDistance, decimals: 1 },
  { key: "robustV1", label: "Robuust (model v1, ter aansluiting)", higherIsBetter: true, get: (m) => m.quality.robustV1, decimals: 1 },
];
