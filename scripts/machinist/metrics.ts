import type { CandidateAssignment } from "@/domain/candidate";
import type { HumanQualityReport } from "@/domain/quality-evaluator";
import { QUALITY_MODEL_V3 } from "@/domain/quality-model";
import type { QualityRosterInput } from "@/domain/roster-quality";
import { type EvaluationContext, evaluateAssignmentsCore, evaluateOfficialCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { type CandidateMetrics, measureAssignments, measureOfficial } from "../final-brain/metrics";

/**
 * Maten van de machinistenronde per kandidaat.
 *
 * Alles van de Final-Brain-meting (model v2, vastgepind: nachten, rust,
 * regelmaat, eerlijkheid, slechtste regel), plus:
 * - model v3: robuust, voorkeur en zijn vijf delen, nachten op ritme min belasting;
 * - de operationele eisen: per kandidaat voldaan of niet, met de uren per rooster;
 * - de voorkeursdiagnostiek per profiel (extreem vroeg, gematigd vroeg, echte
 *   aflopers, vroege late, dagdiensten, nachten, rangeer, blootstelling).
 */

export interface MachinistMetrics {
  readonly base: CandidateMetrics;
  readonly v3: {
    readonly hardValid: boolean;
    readonly robust: number | null;
    readonly overall: number | null;
    readonly worstLine: number | null;
    readonly nights: number | null;
    readonly preference: number | null;
    readonly parts: Readonly<Record<string, number | null>>;
  };
  readonly operational: {
    readonly compliant: boolean;
    readonly violations: number;
    readonly hoursCompliant: number;
    readonly maxAverageWeeklyMinutes: number;
    readonly fridayCompliant: number;
    readonly freeWeekends: number;
    readonly structuralFindings: number;
  };
  readonly profiles: Readonly<
    Record<
      string,
      {
        readonly profile: string;
        readonly lines: number;
        readonly affinity: number | null;
        readonly lessShare: number | null;
        readonly dutyDays: number;
        readonly extremeEarly: number;
        readonly moderateEarly: number;
        readonly daylikeEarly: number;
        readonly earlyLate: number;
        readonly premiumLate: number;
        readonly night: number;
        readonly rangeer: number;
        readonly dayDuties: number;
        readonly dayDutyTarget: number;
        readonly nightWindowMinutesPerWeek: number;
        readonly weekendMinutesPerWeek: number;
        readonly weekendStart: number | null;
        readonly extremeEarlySteps: number;
      }
    >
  >;
  readonly rangeer: { readonly cvPerLine: number | null; readonly maxShare: number | null };
  readonly popular: Readonly<Record<string, { readonly score: number | null; readonly maxShare: number | null }>>;
}

function uit(report: HumanQualityReport, base: CandidateMetrics): MachinistMetrics {
  const o = report.operational;
  const p = report.preference;
  const profiles = Object.fromEntries(
    Object.entries(p.perRoster).map(([code, r]) => {
      const k = (x: string) => r.classes[x] ?? 0;
      return [
        code,
        {
          profile: r.profile,
          lines: r.lines,
          affinity: r.affinity,
          lessShare: r.lessShare,
          dutyDays: Object.values(r.classes).reduce((a, b) => a + b, 0),
          extremeEarly: k("EXTREME_EARLY"),
          moderateEarly: k("EARLY"),
          daylikeEarly: k("DAYLIKE_EARLY"),
          earlyLate: k("EARLY_LATE"),
          premiumLate: k("PREMIUM_LATE"),
          night: k("NIGHT"),
          rangeer: r.rangeer,
          dayDuties: p.dayDuties.actual[code] ?? 0,
          dayDutyTarget: p.dayDuties.expected[code] ?? 0,
          nightWindowMinutesPerWeek: r.nightWindowMinutesPerWeek,
          weekendMinutesPerWeek: r.weekendMinutesPerWeek,
          weekendStart: r.weekendStart,
          extremeEarlySteps: r.extremeEarlySteps,
        },
      ];
    }),
  );
  const perRegel = Object.values(p.perRoster).map((r) => r.rangeer / (r.lines || 1));
  const gem = perRegel.reduce((a, b) => a + b, 0) / (perRegel.length || 1);
  const sd = Math.sqrt(perRegel.reduce((a, b) => a + (b - gem) ** 2, 0) / (perRegel.length || 1));
  const totaalRangeer = Object.values(p.perRoster).reduce((s, r) => s + r.rangeer, 0);
  return {
    base,
    v3: {
      hardValid: report.hardValidity.hardValid,
      robust: report.robust,
      overall: report.overall,
      worstLine: report.lines.worst?.score ?? null,
      nights: report.components.nights.score,
      preference: report.components.preference.score,
      parts: report.components.preference.parts,
    },
    operational: {
      compliant: o.violations.length === 0,
      violations: o.violations.length,
      hoursCompliant: o.hours.filter((h) => h.ok).length,
      maxAverageWeeklyMinutes: Math.max(...o.hours.map((h) => h.averageWeeklyMinutes)),
      fridayCompliant: o.weekends.filter((w) => w.fridayCompliant).length,
      freeWeekends: o.weekends.length,
      structuralFindings: o.structuralFindings.length,
    },
    profiles,
    rangeer: {
      cvPerLine: gem > 0 ? sd / gem : null,
      maxShare: totaalRangeer > 0 ? Math.max(...Object.values(p.perRoster).map((r) => r.rangeer)) / totaalRangeer : null,
    },
    popular: Object.fromEntries(Object.entries(p.popular.perClass).map(([k, v]) => [k, { score: v.score, maxShare: v.maxShare }])),
  };
}

export function measureMachinist(assignments: readonly CandidateAssignment[], context: EvaluationContext): MachinistMetrics {
  return uit(evaluateAssignmentsCore(assignments, context, QUALITY_MODEL_V3), measureAssignments(assignments, context));
}

export function measureMachinistOfficial(context: EvaluationContext): MachinistMetrics {
  return uit(evaluateOfficialCore(context, QUALITY_MODEL_V3), measureOfficial(context));
}

export function rostersOf(assignments: readonly CandidateAssignment[], context: EvaluationContext): readonly QualityRosterInput[] {
  return candidateRosterInputs(assignments, context.quality);
}

/** Welke maten de beslisregels en poorten lezen, met de richting. */
export const MACHINIST_METRICS: readonly { key: string; label: string; higherIsBetter: boolean; get: (m: MachinistMetrics) => number | null }[] = [
  { key: "preference", label: "Voorkeur (v3)", higherIsBetter: true, get: (m) => m.v3.preference },
  { key: "affinity", label: "Affiniteit", higherIsBetter: true, get: (m) => m.v3.parts.affinity ?? null },
  { key: "restDuties", label: "Geen restbak", higherIsBetter: true, get: (m) => m.v3.parts.restDuties ?? null },
  { key: "dayDuties", label: "Dagdiensten volgens verhouding", higherIsBetter: true, get: (m) => m.v3.parts.dayDuties ?? null },
  { key: "popularFairness", label: "Populair eerlijk", higherIsBetter: true, get: (m) => m.v3.parts.popularFairness ?? null },
  { key: "weekendStart", label: "Weekendbegin", higherIsBetter: true, get: (m) => m.v3.parts.weekendStart ?? null },
  { key: "robustV3", label: "Robuust (v3)", higherIsBetter: true, get: (m) => m.v3.robust },
  { key: "robustV2", label: "Robuust (v2)", higherIsBetter: true, get: (m) => m.base.quality.robust },
  { key: "worstLineV2", label: "Slechtste regel (v2)", higherIsBetter: true, get: (m) => m.base.quality.worstLine.score },
  { key: "nightsV2", label: "Nachten (v2)", higherIsBetter: true, get: (m) => m.base.quality.components.nights },
  { key: "rest", label: "Rust", higherIsBetter: true, get: (m) => m.base.quality.components.rest },
  { key: "hours", label: "Uren", higherIsBetter: true, get: (m) => m.base.quality.components.hours },
  { key: "fairness", label: "Eerlijkheid", higherIsBetter: true, get: (m) => m.base.quality.components.fairness },
  { key: "flow", label: "Regelmaat", higherIsBetter: true, get: (m) => m.base.quality.components.flow },
  { key: "singletons", label: "Losse nachten", higherIsBetter: false, get: (m) => m.base.nights.singletons },
  { key: "pairs", label: "Reeksen van twee", higherIsBetter: false, get: (m) => m.base.nights.pairs },
  { key: "worstNightExit", label: "Slechtste nachtuitgang", higherIsBetter: true, get: (m) => m.base.nights.worstExitValue },
  { key: "minRecoveryHours", label: "Kortste herstel na nachten (u)", higherIsBetter: true, get: (m) => m.base.nights.minRecoveryHours },
  { key: "rangeerCv", label: "Rangeer: spreiding per regel (CV)", higherIsBetter: false, get: (m) => m.rangeer.cvPerLine },
  { key: "rangeerMaxShare", label: "Rangeer: grootste aandeel één rooster", higherIsBetter: false, get: (m) => m.rangeer.maxShare },
  { key: "operationalViolations", label: "Operationele overtredingen", higherIsBetter: false, get: (m) => m.operational.violations },
  { key: "extremeEarlySteps", label: "Stappen naar extreem vroeg (diagnose)", higherIsBetter: false, get: (m) => Object.values(m.profiles).reduce((s, p) => s + p.extremeEarlySteps, 0) },
];
