import { formatSpan } from "@/domain/amsterdam-time";
import { type DutyOccurrence, isNightServiceByTime } from "@/domain/duty-window";
import { RULE } from "../../ruleset/rule-ids";
import { type Range, assertMaximum, exact } from "../bounds";
import type { Evaluation, UsableRule } from "../evaluation";
import type { MissingRule } from "../result";
import type { AssignmentRequest } from "../subject";
import { type TimelineDay, toOccurrence } from "../timeline";
import { type WindowSpan, summariser, windowsContaining } from "./windows";
import { workRangeFor } from "./metrics";

/**
 * Wekelijkse arbeidstijd.
 *
 * ## Zonder contractomvang wordt hier niets berekend
 *
 * De maxima van 60, 55 en 48 uur zijn absolute grenzen en hangen niet aan de
 * contractomvang. Toch stopt deze controle wanneer de contractomvang onbekend
 * is. Reden: een urenoordeel dat niet weet of iemand voltijd of halftijd werkt,
 * is geen oordeel. Het zou een deeltijder met 46 uur in een week groen geven
 * terwijl dat voor die medewerker een grove afwijking is, en die groene vink is
 * gevaarlijker dan een blokkade — hij wordt geloofd.
 *
 * ## Bandbreedte
 *
 * De arbeidstijd per dienst is niet altijd exact bekend (zie `bounds.ts`). Over
 * een venster van zestien weken telt die onzekerheid op tot uren. De toets
 * blokkeert daarom alleen wanneer de onzekerheid werkelijk over de grens heen
 * ligt; onder de strengste lezing blijft het gewoon goedgekeurd.
 */
export function checkWeeklyHours(request: AssignmentRequest, evaluation: Evaluation): void {
  if (request.subject.contractHours === null) {
    evaluation.blockOnMissing(missingContractHours(request));
    return;
  }

  const workRange = workRangeFor(request.subject);
  const minutesMin = summariser(request.timeline, dayWork(workRange, "min"));
  const minutesMax = summariser(request.timeline, dayWork(workRange, "max"));

  checkWindow(request, evaluation, {
    ruleId: RULE.MAX_WEEKLY_HOURS,
    contextWindow: "DAYS_7",
    spanDays: 7,
    weeks: 1,
    minutesMin,
    minutesMax,
    label: "een week",
  });

  checkWindow(request, evaluation, {
    ruleId: RULE.AVG_WEEKLY_HOURS_4W,
    contextWindow: "WEEKS_4",
    spanDays: 28,
    weeks: 4,
    minutesMin,
    minutesMax,
    label: "vier weken",
  });

  checkSixteenWeeks(request, evaluation, minutesMin, minutesMax);
}

function dayWork(
  workRange: (occurrence: DutyOccurrence) => Range,
  side: "min" | "max",
): (day: TimelineDay) => number {
  return (day) => {
    const occurrence = toOccurrence(day);
    return occurrence ? workRange(occurrence)[side] : 0;
  };
}

interface WindowCheck {
  readonly ruleId: string;
  readonly contextWindow: "DAYS_7" | "WEEKS_4" | "WEEKS_16";
  readonly spanDays: number;
  readonly weeks: number;
  readonly minutesMin: (span: WindowSpan) => number;
  readonly minutesMax: (span: WindowSpan) => number;
  readonly label: string;
}

function checkWindow(
  request: AssignmentRequest,
  evaluation: Evaluation,
  check: WindowCheck,
): void {
  const rule = evaluation.require(check.ruleId);
  if (!rule) {
    return;
  }
  if (!evaluation.hasContext(check.contextWindow, [check.ruleId])) {
    return;
  }

  const limit = exact(rule.minutes * check.weeks);
  const spans = windowsContaining(request.timeline, request.date, check.spanDays);

  const worst = pickWorst(spans, check.minutesMin);
  if (!worst) {
    return;
  }

  assertMaximum(evaluation, {
    rule,
    value: { min: worst.value, max: check.minutesMax(worst) },
    limit,
    occurrenceKey: `venster:${worst.from}..${worst.to}`,
    violationMessage: (value) =>
      `In de periode ${worst.from} tot en met ${worst.to} bedraagt de arbeidstijd ` +
      `${formatSpan(value.min)}; over ${check.label} is ten hoogste ${formatSpan(limit.max)} ` +
      `toegestaan (${rule.definition.title}).`,
    indeterminate: uncertainWorkTime(rule),
  });
}

function pickWorst(
  spans: readonly WindowSpan[],
  minutes: (span: WindowSpan) => number,
): (WindowSpan & { readonly value: number }) | null {
  let best: (WindowSpan & { value: number }) | null = null;
  for (const span of spans) {
    const value = minutes(span);
    if (best === null || value > best.value) {
      best = { ...span, value };
    }
  }
  return best;
}

/**
 * Zestien weken, met een strengere grens bij veel nachtdiensten.
 *
 * De strengere norm hangt aan hetzelfde venster als de telling. Het venster met
 * de meeste uren en het venster met de meeste nachtdiensten hoeven niet
 * hetzelfde te zijn, dus wordt elk venster op zijn eigen norm getoetst.
 */
function checkSixteenWeeks(
  request: AssignmentRequest,
  evaluation: Evaluation,
  minutesMin: (span: WindowSpan) => number,
  minutesMax: (span: WindowSpan) => number,
): void {
  const standard = evaluation.require(RULE.AVG_WEEKLY_HOURS_16W);
  if (!standard) {
    return;
  }
  if (!evaluation.hasContext("WEEKS_16", [RULE.AVG_WEEKLY_HOURS_16W])) {
    return;
  }

  const strict = evaluation.optional(RULE.AVG_WEEKLY_HOURS_16W_MANY_NIGHTS);
  const threshold = evaluation.optional(RULE.MANY_NIGHTS_THRESHOLD);
  const nights = summariser(request.timeline, (day) =>
    day.duty && isNightServiceByTime(day.duty.shape) ? 1 : 0,
  );

  const spans = windowsContaining(request.timeline, request.date, 112);

  // Twee toetsen naast elkaar: de algemene norm over het zwaarste venster, en
  // de strengere norm over het zwaarste venster dat ook veel nachtdiensten telt.
  checkWindow(request, evaluation, {
    ruleId: RULE.AVG_WEEKLY_HOURS_16W,
    contextWindow: "WEEKS_16",
    spanDays: 112,
    weeks: 16,
    minutesMin,
    minutesMax,
    label: "zestien weken",
  });

  if (!strict || !threshold) {
    // De strengere norm bestaat wél; hem overslaan omdat een van de twee
    // waarden onbruikbaar is, zou een stille versoepeling zijn.
    if (spans.some((span) => nights(span) > 0)) {
      const missing =
        evaluation.describeMissing(RULE.AVG_WEEKLY_HOURS_16W_MANY_NIGHTS) ??
        evaluation.describeMissing(RULE.MANY_NIGHTS_THRESHOLD);
      if (missing) {
        evaluation.blockOnMissing(missing);
      }
    }
    return;
  }

  const heavy = spans.filter((span) => nights(span) >= threshold.count);
  const worst = pickWorst(heavy, minutesMin);
  if (!worst) {
    return;
  }

  assertMaximum(evaluation, {
    rule: strict,
    value: { min: worst.value, max: minutesMax(worst) },
    limit: exact(strict.minutes * 16),
    occurrenceKey: `venster:${worst.from}..${worst.to}`,
    violationMessage: (value, limit) =>
      `In de periode ${worst.from} tot en met ${worst.to} vallen ${nights(worst)} ` +
      `nachtdiensten en bedraagt de arbeidstijd ${formatSpan(value.min)}; bij veel ` +
      `nachtdiensten is over zestien weken ten hoogste ${formatSpan(limit.max)} toegestaan.`,
    indeterminate: uncertainWorkTime(strict),
  });
}

function uncertainWorkTime(rule: UsableRule): MissingRule {
  return {
    ruleId: RULE.RP_LOCATION_WORK_INTERRUPTION,
    title: "Standplaatsafhankelijke werkonderbreking rijdend personeel",
    status: "UNVALIDATED_LOCAL_PARAMETER",
    reason:
      `De arbeidstijd over dit venster is niet exact bekend omdat de duur van de ` +
      `werkonderbreking voor deze standplaats niet is aangeleverd (bereik volgens ` +
      `bron: 32–40 minuten). De uitkomst van "${rule.definition.title}" verandert ` +
      "binnen dat bereik.",
    packageId: "DORDRECHT_BREAK_PARAMETER",
  };
}

function missingContractHours(request: AssignmentRequest): MissingRule {
  return {
    ruleId: "EMPLOYEE_CONTRACT_HOURS",
    title: "Contractomvang van de medewerker",
    status: "NOT_SUPPLIED",
    reason:
      `Voor medewerker ${request.subject.employeeNumber} is geen contractomvang ` +
      "vastgelegd. Zonder dat gegeven kan geen enkele urenregel worden beoordeeld; " +
      "een aanname over voltijd of deeltijd wordt hier niet gedaan.",
    packageId: "EMPLOYEE_CONTRACT_HOURS",
  };
}
