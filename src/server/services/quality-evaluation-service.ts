import "server-only";
import type { CandidateAssignment } from "@/domain/candidate";
import { type EvaluationInput, type HumanQualityReport, type QualityRuleParameters, evaluateQuality } from "@/domain/quality-evaluator";
import { type OperationalRequirements, operationalSwapGuard } from "@/domain/operational-requirements";
import { type PolishResult, polishBySwaps } from "@/domain/roster-polish";
import type { QualityModel } from "@/domain/quality-model";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { resolveRule } from "@/server/rules-engine/ruleset/types";
import {
  type QualityContext,
  candidateRosterInputs,
  loadQualityContextCore,
} from "@/server/services/roster-quality-service";

/**
 * De context voor de RosterQualityEvaluator, uit de database en het regelbestand.
 *
 * ## Waarom de regelwaarden hier worden opgezocht
 *
 * De evaluator zelf kent geen regelbestand: hij krijgt de geplande dagelijkse
 * rust, de herstelrust na nachten en de grens van een lange dienst als getal.
 * Die getallen komen uit dezelfde regels die de eindvalidatie gebruikt. Lukt het
 * opzoeken niet, dan stopt het hier met een melding in plaats van dat er een
 * standaardwaarde wordt verzonnen.
 */

export interface EvaluationContext {
  readonly quality: QualityContext;
  readonly requiredDutyKeys: readonly string[];
  readonly rules: QualityRuleParameters;
}

function regelWaarde(id: string, locationCode: string): number {
  const resolutie = resolveRule(activeRuleset(), id, {
    employeeGroup: "MACHINIST",
    company: "NSR",
    location: locationCode,
    onDate: new Date().toISOString().slice(0, 10),
  });
  if (resolutie.kind !== "RESOLVED" || resolutie.rule.value === null) {
    throw new Error(`Regel ${id} is niet op te zoeken (${resolutie.kind}); de kwaliteitsevaluatie stopt.`);
  }
  return resolutie.rule.unit === "HOURS" ? resolutie.rule.value * 60 : resolutie.rule.value;
}

export async function loadEvaluationContextCore(locationCode: string): Promise<EvaluationContext> {
  const quality = await loadQualityContextCore(locationCode);
  return {
    quality,
    requiredDutyKeys: [...quality.duties.keys()],
    rules: {
      minDailyRestMinutes: regelWaarde(RULE.RP_DAILY_REST_PLANNED, locationCode),
      nightRecoveryMinutes: regelWaarde(RULE.NIGHT_SEQUENCE_RECOVERY, locationCode),
      longDutyMinutes: regelWaarde(RULE.RP_LONG_DUTY_THRESHOLD, locationCode),
    },
  };
}

function invoer(rosters: EvaluationInput["rosters"], context: EvaluationContext, model?: QualityModel): EvaluationInput {
  return {
    model,
    rosters,
    reference: context.quality.official,
    duties: context.quality.duties,
    requiredDutyKeys: context.requiredDutyKeys,
    nightRosterCodes: context.quality.nightRosterCodes,
    rules: context.rules,
  };
}

/**
 * Zonder `model` rekent dit met het huidige kwaliteitsmodel. Wie een opgeslagen
 * kandidaat natrekt, geeft het model mee waarmee hij destijds is beoordeeld.
 */
export function evaluateOfficialCore(context: EvaluationContext, model?: QualityModel): HumanQualityReport {
  return evaluateQuality(invoer(context.quality.official, context, model));
}

export function evaluateAssignmentsCore(
  assignments: readonly CandidateAssignment[],
  context: EvaluationContext,
  model?: QualityModel,
): HumanQualityReport {
  return evaluateQuality(invoer(candidateRosterInputs(assignments, context.quality), context, model));
}

/**
 * Bijschaven met ruildiensten en het resultaat teruggeven als toewijzingen.
 *
 * De zoektocht zelf staat in `roster-polish.ts` en kent geen database; deze
 * laag vertaalt toewijzingen naar roosters en terug, en laat de aanroeper
 * bepalen wat "beter" betekent. Het resultaat is nog niet gevalideerd: dat doet
 * de eindvalidatie, zoals bij elke andere kandidaat.
 */
export function polishAssignmentsCore(
  assignments: readonly CandidateAssignment[],
  context: EvaluationContext,
  options: {
    readonly score: (report: HumanQualityReport) => number;
    readonly deadline: number;
    readonly seed?: number;
    readonly signal?: { readonly aborted: boolean };
    readonly model?: QualityModel;
    /** Operationele eisen die geen ruil mag breken; zonder: alleen profiel en rust. */
    readonly operational?: OperationalRequirements;
  },
): { assignments: readonly CandidateAssignment[]; report: HumanQualityReport; polish: PolishResult } {
  const rosters = candidateRosterInputs(assignments, context.quality);
  const uitkomst = polishBySwaps({
    rosters,
    guard: options.operational ? operationalSwapGuard(rosters, options.operational) : undefined,
    duties: context.quality.duties,
    minRestMinutes: context.rules.minDailyRestMinutes,
    score: (rosters) => options.score(evaluateQuality(invoer(rosters, context, options.model))),
    deadline: options.deadline,
    seed: options.seed,
    signal: options.signal,
  });
  const nieuw = new Map<string, string | null>();
  for (const rooster of uitkomst.rosters) {
    for (const dag of rooster.days) {
      nieuw.set(`${rooster.code}|${dag.lineNumber}|${dag.weekIndex}|${dag.weekday}`, dag.dutyCode);
    }
  }
  return {
    assignments: assignments.map((entry) => {
      const code = nieuw.get(`${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|${entry.weekday}`);
      return code === undefined || code === entry.dutyCode ? entry : { ...entry, dutyCode: code };
    }),
    report: evaluateQuality(invoer(uitkomst.rosters, context, options.model)),
    polish: uitkomst,
  };
}
