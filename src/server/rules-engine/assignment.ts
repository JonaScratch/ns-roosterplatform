import { createHash } from "node:crypto";
import { activeRuleset } from "./ruleset/index";
import type { RuleContext, Ruleset } from "./ruleset/types";
import { Evaluation } from "./validation/evaluation";
import {
  type ExplanationLine,
  type ValidationResult,
  OUTCOME_LABELS,
  allowsPlacement,
  outcomeOf,
  violationsWith,
} from "./validation/result";
import type { AssignmentRequest } from "./validation/subject";
import { checkCounters } from "./validation/checks/counters";
import { checkDailyRest } from "./validation/checks/daily-rest";
import { checkDutyLimits } from "./validation/checks/duty-limits";
import { checkEligibility } from "./validation/checks/eligibility";
import { checkLocationRuleset } from "./validation/checks/location";
import { metricsOf } from "./validation/checks/metrics";
import { checkQuality } from "./validation/checks/quality";
import { checkSequences } from "./validation/checks/sequences";
import { checkStructure } from "./validation/checks/structure";
import { checkRedWeekend } from "./validation/checks/weekend";
import { checkWeeklyHours } from "./validation/checks/weekly-hours";
import { checkWeeklyRest } from "./validation/checks/weekly-rest";

/**
 * De enige plek waar een dienstplaatsing wordt beoordeeld.
 *
 * ## Waarom er precies één ingang is
 *
 * Zodra er twee zijn, gaan ze uit elkaar lopen. De ene krijgt een nieuwe regel,
 * de andere niet; de ene rekent met werkelijke tijd, de andere met kloktijd. Dat
 * verschil is onzichtbaar tot iemand er last van heeft. Roostercommissie,
 * dienstindeling, reserve-inzet, beschikbare diensten, ruilingen, publicatie en
 * een toekomstige optimizer gebruiken daarom letterlijk deze functie.
 *
 * ## Wat "geldig" betekent
 *
 * Alleen `VALID` en `VALID_WITH_WARNINGS` laten een plaatsing door. Een
 * ontbrekende regel of ontbrekende context levert géén goedkeuring op: dan is
 * de uitkomst dat het niet veilig te beoordelen valt, en dat blokkeert net zo
 * goed als een overtreding. De oplossing verschilt wel — een ontbrekende regel
 * los je op door hem aan te leveren, niet door het rooster te wijzigen.
 */
export function evaluateAssignment(
  request: AssignmentRequest,
  ruleset: Ruleset = activeRuleset(),
): ValidationResult {
  const lookup: RuleContext = {
    employeeGroup: request.subject.employeeGroup,
    company: request.subject.company,
    location: request.subject.depot,
    onDate: request.date,
  };

  const evaluation = new Evaluation(
    ruleset,
    lookup,
    request.timeline.coverage,
    request.subject.employeeNumber,
    request.date,
  );

  const metrics = metricsOf(
    { date: request.date, shape: request.candidate.shape },
    request.subject,
  );

  // Volgorde van goedkoop naar duur. Niet om te kunnen stoppen — alle controles
  // draaien altijd, zodat een planner in één keer het hele beeld krijgt in
  // plaats van na elke reparatie een nieuwe bevinding.
  checkLocationRuleset(request, evaluation);
  checkStructure(request, evaluation);
  checkEligibility(request, evaluation);
  checkDutyLimits(request, metrics, evaluation);
  checkDailyRest(request, evaluation);
  checkSequences(request, evaluation);
  checkWeeklyRest(request, evaluation);
  checkWeeklyHours(request, evaluation);
  checkCounters(request, evaluation);
  checkRedWeekend(request, evaluation);
  checkQuality(request, evaluation);

  const findings = evaluation.build();
  const outcome = outcomeOf(findings);

  return {
    outcome,
    valid: allowsPlacement(outcome),
    hardViolations: findings.hardViolations,
    warnings: findings.warnings,
    optimizationImpacts: findings.optimizationImpacts,
    missingRules: findings.missingRules,
    contextGaps: findings.contextGaps,
    contextCoverage: findings.contextCoverage,
    explanation: explain(outcome, findings, ruleset),
    evaluatedRules: findings.evaluatedRules,
    rulesWithUnverifiedCurrency: findings.rulesWithUnverifiedCurrency,
    rulesetVersion: ruleset.version,
    rulesetMode: ruleset.mode,
    legalStatus: ruleset.legalStatus,
    score: scoreOf(outcome, findings),
    inputDigest: digestOf(request, ruleset),
  };
}

type Findings = ReturnType<Evaluation["build"]>;

/**
 * De uitleg.
 *
 * Elke bevinding krijgt een regel met haar bron erbij. Een planner die een
 * plaatsing geweigerd ziet, moet kunnen nagaan wélke bepaling dat doet en waar
 * die staat — anders wordt de engine een orakel waar mensen omheen gaan werken.
 */
function explain(
  outcome: ValidationResult["outcome"],
  findings: Findings,
  ruleset: Ruleset,
): readonly ExplanationLine[] {
  const lines: ExplanationLine[] = [
    {
      outcome,
      headline: OUTCOME_LABELS[outcome],
      detail: headlineDetail(outcome, findings),
    },
  ];

  for (const violation of findings.hardViolations) {
    const confirmed = violation.confidence === "CONFIRMED";
    lines.push({
      outcome: confirmed ? "CONFIRMED_HARD_VIOLATION" : "POTENTIAL_HARD_VIOLATION",
      headline: confirmed ? violation.title : `${violation.title} (mogelijk)`,
      detail: confirmed
        ? violation.message
        : `${violation.message} Nog niet vastgesteld: ` +
          violation.unverified.map((fact) => fact.detail).join(" "),
      source: sourceLabel(violation.source),
    });
  }

  for (const missing of findings.missingRules) {
    lines.push({
      outcome: "RULESET_INCOMPLETE",
      headline: missing.title,
      detail: missing.reason,
      source: missing.packageId ? `Ontbrekend pakket: ${missing.packageId}` : undefined,
    });
  }

  for (const gap of findings.contextGaps) {
    lines.push({
      outcome: "CONTEXT_INCOMPLETE",
      headline: `Onvoldoende roosterhistorie (${gap.window})`,
      detail:
        `Nodig van ${gap.requiredFrom} tot en met ${gap.requiredTo}, beschikbaar van ` +
        `${gap.availableFrom} tot en met ${gap.availableTo}. Hierdoor konden ` +
        `${gap.affectedRules.length} regel${gap.affectedRules.length === 1 ? "" : "s"} niet ` +
        `worden beoordeeld: ${gap.affectedRules.join(", ")}.`,
    });
  }

  for (const warning of findings.warnings) {
    lines.push({
      outcome: "VALID_WITH_WARNINGS",
      headline: warning.title,
      detail: warning.message,
      source: sourceLabel(warning.source),
    });
  }

  if (findings.rulesWithUnverifiedCurrency.length > 0) {
    lines.push({
      outcome: "CONTEXT_INCOMPLETE",
      headline: "Bron voorbij de contractuele einddatum, actuele status niet geverifieerd",
      detail:
        `${findings.rulesWithUnverifiedCurrency.length} regels komen uit een bron waarvan de ` +
        "oorspronkelijke looptijd is verstreken. De bron voorziet in verlenging en nawerking, " +
        "dus de bepalingen zijn niet vervallen — maar of deze versie de actuele is, is niet " +
        "geverifieerd. Ze zijn toegepast; in productiemodus is verificatie vereist en " +
        "blokkeert dit. Een bevinding op zo'n regel kan nooit bevestigd zijn.",
    });
  }

  if (ruleset.legalStatus !== "LEGAL_RULESET_VERIFIED") {
    lines.push({
      outcome: "CONTEXT_INCOMPLETE",
      headline: "Regelbestand niet als actueel bevestigd",
      detail:
        `Het regelbestand draait in modus ${ruleset.mode}. De uitkomst hierboven is een ` +
        "simulatie op basis van de aangeleverde bron en mag niet als juridisch oordeel " +
        "worden gebruikt.",
    });
  }

  return lines;
}

function headlineDetail(outcome: ValidationResult["outcome"], findings: Findings): string {
  switch (outcome) {
    case "VALID_WITHIN_VALIDATED_RULESET":
      return (
        `${findings.evaluatedRules.length} regels doorgerekend, geen bevindingen. Dit zegt ` +
        "iets over de regels die aanwezig en gevalideerd zijn, niet over regels die " +
        "ontbreken."
      );
    case "VALID_WITH_WARNINGS":
      return `${findings.warnings.length} aandachtspunt${
        findings.warnings.length === 1 ? "" : "en"
      }; geen harde bevinding.`;
    case "CONTEXT_INCOMPLETE":
      return "De benodigde roosterhistorie is niet volledig beschikbaar. Dit is geen goedkeuring.";
    case "CONFIRMED_HARD_VIOLATION":
      return `${violationsWith(findings.hardViolations, "CONFIRMED").length} bevestigde ` +
        "overtreding van een gevalideerde, actuele regel.";
    case "POTENTIAL_HARD_VIOLATION":
      return (
        `${violationsWith(findings.hardViolations, "POTENTIAL").length} berekende ` +
        "overschrijding waarvan de bron of de toepasselijkheid niet vaststaat. Dit " +
        "blokkeert, maar is geen bewijs: eerst de openstaande punten hieronder afwerken."
      );
    case "RULESET_INCOMPLETE":
      return (
        "Er ontbreekt een regel of parameter die voor deze beslissing nodig is. " +
        "Ontbrekend betekent hier niet toegestaan, maar niet veilig te beoordelen."
      );
  }
}

function sourceLabel(source: {
  documentTitle: string;
  article?: string;
  paragraph?: string;
}): string {
  const parts = [source.documentTitle];
  if (source.article) {
    parts.push(`art. ${source.article}`);
  }
  if (source.paragraph) {
    parts.push(source.paragraph);
  }
  return parts.join(", ");
}

/**
 * De wenselijkheid, van 0 tot 1.
 *
 * Nul zodra er iets blokkeert. Dat is geen strengheid maar een structurele
 * voorwaarde: zou een geblokkeerde plaatsing een positieve score kunnen krijgen,
 * dan kan een optimizer die score elders terugverdienen en de blokkade
 * wegoptimaliseren. Een harde overtreding is niet duur — hij is onmogelijk.
 */
function scoreOf(outcome: ValidationResult["outcome"], findings: Findings): number {
  if (!allowsPlacement(outcome)) {
    return 0;
  }
  if (findings.optimizationImpacts.length === 0) {
    return 1;
  }
  const total = findings.optimizationImpacts.reduce((sum, impact) => sum + impact.score, 0);
  return Number((total / findings.optimizationImpacts.length).toFixed(4));
}

/**
 * Een vingerafdruk van de invoer.
 *
 * Maakt een uitkomst reproduceerbaar en controleerbaar: dezelfde invoer met
 * dezelfde regelversie hoort dezelfde afdruk te geven. Er zit geen naam,
 * e-mailadres of reden in — alleen wat de engine werkelijk heeft gebruikt.
 */
function digestOf(request: AssignmentRequest, ruleset: Ruleset): string {
  const normalised = {
    ruleset: `${ruleset.version}/${ruleset.mode}/${ruleset.legalStatus}`,
    employee: request.subject.employeeNumber,
    group: request.subject.employeeGroup,
    company: request.subject.company,
    depot: request.subject.depot,
    profile: request.subject.rosterProfile,
    contractHours: request.subject.contractHours,
    date: request.date,
    duty: request.candidate.dutyId,
    shape: request.candidate.shape,
    stage: request.planningStage,
    reason: request.reason,
    changeType: request.changeType ?? "NEW_TIMETABLE",
    // De baseline bepaalt mede de uitkomst; dan hoort hij in de afdruk.
    baseline: request.baselineSlot
      ? [
          request.baselineSlot.baseRosterCode,
          request.baselineSlot.lineNumber,
          request.baselineSlot.weekIndex,
          request.baselineSlot.weekday,
          request.baselineSlot.slotType,
        ]
      : null,
    exceptions: request.exceptions.map((exception) => exception.ruleId).sort(),
    coverage: request.timeline.coverage,
    days: request.timeline.days.map((day) => [
      day.date,
      day.positionType,
      day.duty?.dutyId ?? null,
    ]),
  };
  return createHash("sha256").update(JSON.stringify(normalised)).digest("hex");
}
