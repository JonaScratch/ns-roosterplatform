import { evaluateAssignment } from "./assignment";
import type { Ruleset } from "./ruleset/types";
import type { ValidationResult } from "./validation/result";
import type { AssignmentRequest, AssignmentReason } from "./validation/subject";
import type { Timeline, TimelineDay } from "./validation/timeline";
import type {
  AssignmentCheck,
  RuleDecision,
  RuleEvaluationResult,
  RuleFinding,
} from "./types";

/**
 * De brug tussen het bestaande contract en de nieuwe validator.
 *
 * ## Waarom deze laag bestaat en niet is weggewerkt
 *
 * De rest van de applicatie stelt zijn vraag al in de goede vorm: "mag
 * medewerker E op dag D dienst X rijden, gegeven dit venster". Die vorm is
 * juist gebleken en hoeft niet te veranderen. Wat eronder ligt wél. Door hier
 * te vertalen, gaan beschikbare diensten, ruilingen, reserve-invulling en
 * roosterwijzigingen in één keer over op de fail-closed engine, zonder dat
 * ergens een tweede route ontstaat waar de oude logica blijft hangen.
 *
 * ## Wat er bij het vertalen niet verloren mag gaan
 *
 * `RuleDecision` kent drie waarden en de validator vijf uitkomsten. De verleiding
 * is om "niet te beoordelen" op `WARN` te laten uitkomen, want er is immers geen
 * overtreding aangetoond. Dat is precies de fout die dit hele onderdeel moet
 * uitsluiten: alles wat geen bewezen goedkeuring is, wordt `BLOCK`. De rijkere
 * uitkomst reist mee in `outcome`, zodat een scherm het onderscheid wél kan
 * tonen.
 */

export function evaluateCheck(
  check: AssignmentCheck,
  reason: AssignmentReason,
  ruleset?: Ruleset,
): RuleEvaluationResult {
  const result = evaluateAssignment(toRequest(check, reason), ruleset);
  return toEvaluationResult(result, check);
}

/** Meerdere plaatsingen als één uitkomst; de strengste bepaalt de beslissing. */
export function evaluateChecks(
  checks: readonly AssignmentCheck[],
  reason: AssignmentReason,
  ruleset?: Ruleset,
): RuleEvaluationResult {
  const results = checks.map((check) => evaluateCheck(check, reason, ruleset));
  if (results.length === 1) {
    return results[0];
  }

  return {
    decision: results.some((result) => result.decision === "BLOCK")
      ? "BLOCK"
      : results.some((result) => result.decision === "WARN")
        ? "WARN"
        : "ALLOW",
    outcome: worstOutcome(results.map((result) => result.outcome)),
    findings: results.flatMap((result) => result.findings),
    missingRules: results.flatMap((result) => result.missingRules),
    contextGaps: results.flatMap((result) => result.contextGaps),
    rulesWithUnverifiedCurrency: [
      ...new Set(results.flatMap((result) => result.rulesWithUnverifiedCurrency)),
    ].sort(),
    contextCoverage: results.flatMap((result) => result.contextCoverage),
    rulesetVersion: results[0]?.rulesetVersion ?? "onbekend",
    rulesetMode: results[0]?.rulesetMode ?? "onbekend",
    legalStatus: results[0]?.legalStatus ?? "onbekend",
    // De laagste score telt: een ruil is zo goed als zijn slechtste kant.
    score: results.length === 0 ? 0 : Math.min(...results.map((result) => result.score)),
    engine: results[0]?.engine ?? { name: "ns-rules-engine", version: "onbekend" },
    inputDigest: results.map((result) => result.inputDigest).join("+"),
  };
}

const OUTCOME_SEVERITY = [
  "VALID_WITHIN_VALIDATED_RULESET",
  "VALID_WITH_WARNINGS",
  "CONTEXT_INCOMPLETE",
  "RULESET_INCOMPLETE",
  "POTENTIAL_HARD_VIOLATION",
  "CONFIRMED_HARD_VIOLATION",
] as const;

function worstOutcome(
  outcomes: readonly RuleEvaluationResult["outcome"][],
): RuleEvaluationResult["outcome"] {
  return outcomes.reduce<RuleEvaluationResult["outcome"]>(
    (worst, outcome) =>
      OUTCOME_SEVERITY.indexOf(outcome) > OUTCOME_SEVERITY.indexOf(worst) ? outcome : worst,
    "VALID_WITHIN_VALIDATED_RULESET",
  );
}

// ── Heen ─────────────────────────────────────────────────────────────────────

export function toRequest(check: AssignmentCheck, reason: AssignmentReason): AssignmentRequest {
  const candidateShape = {
    startMinute: check.duty.startMinute,
    endMinute: check.duty.endMinute,
    breakMinutes: check.duty.breakMinutes,
    overtimeMinutes: check.duty.overtimeMinutes,
  };

  // Het venster bevat de kandidaatdag nog zoals hij was. De tijdlijn moet de
  // situatie ná de plaatsing beschrijven, anders rekent elke regel over een
  // rooster dat niet gaat bestaan.
  const days: TimelineDay[] = check.window.days
    .filter((day) => day.date !== check.date)
    .map((day) => ({
      date: day.date,
      positionType: day.positionType,
      duty: day.duty
        ? {
            dutyId: day.duty.dutyId,
            code: day.duty.code,
            shape: {
              startMinute: day.duty.startMinute,
              endMinute: day.duty.endMinute,
              breakMinutes: day.duty.breakMinutes,
              overtimeMinutes: day.duty.overtimeMinutes,
            },
          }
        : null,
    }));

  days.push({
    date: check.date,
    positionType: "DUTY",
    duty: { dutyId: check.duty.dutyId, code: check.duty.code, shape: candidateShape },
    // Wordt er een dienst ingeleverd, dan komt de dag vrij en is er niets meer
    // dat overschreven wordt. Zonder dit onderscheid zou een ruil op zichzelf
    // vastlopen: de eigen dienst zou de dag bezet houden.
    replacedPosition: check.surrendering ? null : check.replacedPosition,
  });
  days.sort((a, b) => a.date.localeCompare(b.date));

  const timeline: Timeline = {
    days,
    coverage: { from: check.window.from, to: check.window.to },
  };

  return {
    subject: {
      employeeId: check.employee.employeeId,
      employeeNumber: check.employee.employeeNumber,
      employeeGroup: check.employee.employeeGroup,
      company: check.employee.company,
      depot: check.employee.depot,
      rosterProfile: check.employee.rosterProfile,
      qualifications: check.employee.qualifications,
      contractHours: check.employee.contractHours,
      earlyStartProtectionWaived: check.employee.earlyStartProtectionWaived,
      protections: check.employee.protections,
    },
    date: check.date,
    candidate: {
      dutyId: check.duty.dutyId,
      code: check.duty.code,
      kinds: check.duty.kinds,
      depot: check.duty.depot,
      requiredQualifications: check.duty.requiredQualifications,
      weight: check.duty.weight,
      shape: candidateShape,
    },
    planningStage: check.planningStage,
    reason,
    timeline,
    exceptions: check.exceptions,
    changeType: check.changeType ?? "NEW_TIMETABLE",
    baselineSlot: check.baselineSlot ?? null,
  };
}

// ── Terug ────────────────────────────────────────────────────────────────────

function toEvaluationResult(
  result: ValidationResult,
  check: AssignmentCheck,
): RuleEvaluationResult {
  const findings: RuleFinding[] = [
    ...result.hardViolations.map((violation) => ({
      ruleId: violation.ruleId,
      category: "HARD_CONSTRAINT" as const,
      severity: "VIOLATION" as const,
      message:
        violation.confidence === "CONFIRMED"
          ? violation.message
          : `${violation.message} Niet bevestigd: ${violation.unverified
              .map((fact) => fact.detail)
              .join(" ")}`,
      employeeNumber: violation.employeeScope,
      details: { ...violation.details, zekerheid: violation.confidence },
    })),
    ...result.warnings.map((warning) => ({
      ruleId: warning.ruleId,
      category: "SOFT_CONSTRAINT" as const,
      severity: "WARNING" as const,
      message: warning.message,
      employeeNumber: warning.employeeScope,
      details: warning.details,
    })),
    ...result.missingRules.map((missing) => ({
      ruleId: missing.ruleId,
      category: "HARD_CONSTRAINT" as const,
      // Een ontbrekende regel is geen waarschuwing: hij houdt de beslissing
      // tegen, en dat moet uit de ernst blijken en niet alleen uit de tekst.
      severity: "VIOLATION" as const,
      message: missing.reason,
      employeeNumber: check.employee.employeeNumber,
      details: { status: missing.status, pakket: missing.packageId },
    })),
    ...result.contextGaps.map((gap) => ({
      ruleId: `CONTEXT_${gap.window}`,
      category: "HARD_CONSTRAINT" as const,
      severity: "VIOLATION" as const,
      message:
        `Onvoldoende roosterhistorie: nodig van ${gap.requiredFrom} tot en met ` +
        `${gap.requiredTo}, beschikbaar van ${gap.availableFrom} tot en met ${gap.availableTo}.`,
      employeeNumber: check.employee.employeeNumber,
      details: { regels: gap.affectedRules },
    })),
  ];

  return {
    decision: decisionOf(result),
    outcome: result.outcome,
    findings,
    missingRules: result.missingRules,
    contextGaps: result.contextGaps,
    rulesWithUnverifiedCurrency: result.rulesWithUnverifiedCurrency,
    contextCoverage: result.contextCoverage,
    rulesetVersion: result.rulesetVersion,
    rulesetMode: result.rulesetMode,
    legalStatus: result.legalStatus,
    score: result.score,
    engine: { name: "ns-rules-engine", version: result.rulesetVersion },
    inputDigest: result.inputDigest,
  };
}

function decisionOf(result: ValidationResult): RuleDecision {
  if (!result.valid) {
    return "BLOCK";
  }
  return result.warnings.length > 0 ? "WARN" : "ALLOW";
}
