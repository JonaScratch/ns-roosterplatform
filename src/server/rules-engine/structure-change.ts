import {
  type BaselineSlot,
  type ProposedSlot,
  type RosterChangeType,
  anchorLockedMessage,
  assessStructuralChange,
} from "@/domain/roster-structure";
import type { CalendarDate } from "@/domain/time";
import { activeRuleset } from "./ruleset/index";
import { RULE } from "./ruleset/rule-ids";
import type { Company, EmployeeGroup, RuleContext, Ruleset } from "./ruleset/types";
import { Evaluation } from "./validation/evaluation";
import { type ValidationOutcome, allowsPlacement, outcomeOf } from "./validation/result";
import type { MissingRule, RuleViolation } from "./validation/result";

/**
 * De beoordeling van een wijziging in de roosterstructuur zelf.
 *
 * ## Waarom dit naast `evaluateAssignment` staat
 *
 * `evaluateAssignment` beoordeelt een dienstplaatsing: er is een kandidaat met
 * een begintijd, een eindtijd en een rusthistorie. Een structuurwijziging heeft
 * dat allemaal niet — "maak van deze WTV-dag een reservedag" bevat geen dienst
 * om over te rekenen. Die vraag door de dienstvalidator persen zou een
 * nepdienst vereisen, en een nepdienst in de invoer is precies hoe je een
 * uitkomst krijgt die over iets anders gaat dan de vraag.
 *
 * Wat hier níet gebeurt, is een tweede regelboek openen. De regel komt uit
 * hetzelfde regelbestand, via dezelfde `Evaluation`, met dezelfde
 * fail-closed-afhandeling: is `ROSTER_ANCHOR_LOCKED` onbruikbaar of onbekend,
 * dan blokkeert de wijziging op een onvolledig regelbestand in plaats van door
 * te glippen. En de vergelijking zelf staat in `assessStructuralChange`, waar
 * ook de dienstvalidator hem vandaan haalt.
 */

export interface StructuralChangeRequest {
  readonly changeType: RosterChangeType;
  readonly date: CalendarDate;
  /** Wat het vastgestelde jaarrooster hier heeft. Null bij een nieuwe regel. */
  readonly baseline: BaselineSlot | null;
  readonly proposed: ProposedSlot;
  readonly employeeGroup: EmployeeGroup;
  readonly company: Company;
  readonly location: string;
  /** Waar de bevinding aan hangt. Een roosterlijn, geen persoon. */
  readonly scope: string;
}

export interface StructuralChangeDecision {
  readonly decision: "ALLOW" | "BLOCK";
  readonly outcome: ValidationOutcome;
  readonly violations: readonly RuleViolation[];
  readonly missingRules: readonly MissingRule[];
  readonly rulesetVersion: string;
  readonly rulesetMode: string;
}

export function evaluateStructuralChange(
  request: StructuralChangeRequest,
  ruleset: Ruleset = activeRuleset(),
): StructuralChangeDecision {
  const lookup: RuleContext = {
    employeeGroup: request.employeeGroup,
    company: request.company,
    location: request.location,
    onDate: request.date,
  };
  const evaluation = new Evaluation(
    ruleset,
    lookup,
    { from: request.date, to: request.date },
    request.scope,
    request.date,
  );

  if (request.changeType === "AMENDMENT") {
    const rule = evaluation.require(RULE.ROSTER_ANCHOR_LOCKED);
    const assessment = assessStructuralChange({
      changeType: request.changeType,
      baseline: request.baseline,
      proposed: request.proposed,
    });

    if (assessment.verdict === "BASELINE_MISSING") {
      evaluation.blockOnMissing({
        ruleId: "ROSTER_STRUCTURE_BASELINE",
        title: "Structurele baseline van het vastgestelde jaarrooster",
        status: "NOT_SUPPLIED",
        reason:
          `Voor ${request.date} is geen vastgelegde baseline gevonden. Een ` +
          "wijzigingsblad wordt daartegen getoetst; zonder die vastlegging kan een " +
          "ankerverschuiving niet worden vastgesteld.",
      });
    } else if (assessment.verdict === "ANCHOR_LOCKED" && rule) {
      evaluation.violate(rule, {
        calculatedValue: 0,
        limit: 1,
        occurrenceKey: request.baseline
          ? `anker:${request.baseline.baseRosterCode}|${request.baseline.lineNumber}|${request.baseline.weekIndex}|${request.baseline.weekday}`
          : `anker:${request.scope}|${request.date}`,
        message: anchorLockedMessage(assessment.from, assessment.to),
        details: {
          baselineSlotType: assessment.from,
          proposedSlotType: assessment.to,
          datum: request.date,
        },
      });
    }
  }

  const findings = evaluation.build();
  const outcome = outcomeOf(findings);
  return {
    decision: allowsPlacement(outcome) ? "ALLOW" : "BLOCK",
    outcome,
    violations: findings.hardViolations,
    missingRules: findings.missingRules,
    rulesetVersion: ruleset.version,
    rulesetMode: ruleset.mode,
  };
}
