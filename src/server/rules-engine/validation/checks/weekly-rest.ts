import { formatSpan } from "@/domain/amsterdam-time";
import { addDays } from "@/domain/time";
import { RULE } from "../../ruleset/rule-ids";
import type { Evaluation, UsableRule } from "../evaluation";
import { type AssignmentRequest, hasException } from "../subject";
import {
  countsInServiceRun,
  dayAt,
  daysBetween,
  longestRestMinutes,
  nextDuty,
  previousDuty,
  restMinutesBetween,
  restPeriodsIn,
} from "../timeline";
import { windowsContaining, worstSumWindow, worstWindow } from "./windows";

/**
 * Wekelijkse rust en rustdagen.
 *
 * ## Twee varianten, en waarom de volgorde ertoe doet
 *
 * De bron staat twee lezingen toe: 36 uur onafgebroken per 7×24 uur, óf 72 uur
 * per 14×24 uur, die laatste eventueel gesplitst in delen van minstens 32 uur.
 * Er hoeft er maar één te kloppen. Wie meteen op de tweede uitwijkt, keurt
 * roosters goed die met de eerste variant zouden zijn afgekeurd zonder dat
 * iemand ziet waarom. Daarom wordt eerst de gewone variant getoetst en pas bij
 * een tekort naar de alternatieve gekeken — en als die de plaatsing redt, staat
 * dat er met zoveel woorden bij.
 *
 * ## De roostercommissievariant staat standaard uit
 *
 * De commissie mag één rust verkorten tot 32 uur, hooguit eens per vijf weken,
 * en kan daar niet toe worden gedwongen. Een variant die niemand kan afdwingen,
 * hoort niet stilzwijgend aan te staan: hij bestaat hier alleen met een
 * vastgelegde uitzondering.
 */
export function checkWeeklyRest(request: AssignmentRequest, evaluation: Evaluation): void {
  checkUninterruptedRest(request, evaluation);
  checkRestDayLength(request, evaluation);
  checkRestDayCount(request, evaluation);
}

// ── Onafgebroken wekelijkse rust ─────────────────────────────────────────────

function checkUninterruptedRest(request: AssignmentRequest, evaluation: Evaluation): void {
  const weekly = evaluation.require(RULE.WEEKLY_REST_36H_PER_7D);
  if (!weekly) {
    return;
  }
  if (!evaluation.hasContext("DAYS_7", [RULE.WEEKLY_REST_36H_PER_7D])) {
    return;
  }

  const shortened = shortenedMinimum(request, weekly, evaluation);
  const minimum = shortened?.minutes ?? weekly.minutes;

  const worst = worstWindow(
    request.timeline,
    request.date,
    7,
    (days, span) => longestRestMinutes(days, span),
    (candidate, current) => candidate < current,
  );
  if (!worst) {
    return;
  }

  if (worst.value >= minimum) {
    if (shortened && worst.value < weekly.minutes) {
      reportShortenedRest(request, weekly, shortened, worst.value, evaluation);
    }
    return;
  }

  // De gewone variant wordt niet gehaald. Dan pas de alternatieve.
  if (satisfiesFortnightVariant(request, evaluation, worst.from)) {
    evaluation.warn(weekly, {
      calculatedValue: worst.value,
      limit: weekly.minutes,
      message:
        `In de week van ${worst.from} tot en met ${worst.to} is de langste onafgebroken rust ` +
        `${formatSpan(worst.value)}, minder dan ${formatSpan(weekly.minutes)}. De plaatsing ` +
        "steunt daarmee op de alternatieve variant van 72 uur per 14×24 uur.",
      occurrenceKey: `week:${worst.from}..${worst.to}`,
    });
    return;
  }

  evaluation.violate(weekly, {
    calculatedValue: worst.value,
    limit: minimum,
    message:
      `In de week van ${worst.from} tot en met ${worst.to} is de langste onafgebroken rust ` +
      `${formatSpan(worst.value)}; vereist is ${formatSpan(minimum)}. Ook de alternatieve ` +
      "variant van 72 uur per 14×24 uur wordt niet gehaald.",
    occurrenceKey: `week:${worst.from}..${worst.to}`,
  });
}

/**
 * Haalt een venster van veertien dagen rond deze week de alternatieve variant?
 *
 * De 72 uur mag gesplitst zijn, mits elk deel minstens de ondergrens haalt.
 * Delen die korter zijn tellen niet mee — ze optellen zou de splitsingsregel
 * uithollen tot "genoeg losse uurtjes bij elkaar".
 */
function satisfiesFortnightVariant(
  request: AssignmentRequest,
  evaluation: Evaluation,
  weekStart: string,
): boolean {
  const fortnight = evaluation.require(RULE.WEEKLY_REST_72H_PER_14D);
  const splitMinimum = evaluation.require(RULE.WEEKLY_REST_SPLIT_MIN);
  if (!fortnight || !splitMinimum) {
    return false;
  }
  if (!evaluation.hasContext("DAYS_14", [RULE.WEEKLY_REST_72H_PER_14D])) {
    return false;
  }

  return windowsContaining(request.timeline, request.date, 14)
    .filter((span) => span.from <= weekStart)
    .some((span) => {
      const days = daysBetween(request.timeline, span.from, span.to);
      const qualifying = restPeriodsIn(days, span).filter(
        (minutes) => minutes >= splitMinimum.minutes,
      );
      return qualifying.reduce((total, minutes) => total + minutes, 0) >= fortnight.minutes;
    });
}

/**
 * Mag de wekelijkse rust hier korter zijn dan de norm?
 *
 * Alleen met een vastgelegde uitzondering op naam van de roostercommissie. Het
 * interval van vijf weken kan de engine niet zelf controleren: er is geen bron
 * van eerder verleende verkortingen. Dat wordt niet verzwegen maar bij de
 * bevinding vermeld.
 */
function shortenedMinimum(
  request: AssignmentRequest,
  weekly: UsableRule,
  evaluation: Evaluation,
): UsableRule | null {
  if (!hasException(request, RULE.RC_SHORTENED_WEEKLY_REST_MIN)) {
    return null;
  }
  const shortened = evaluation.require(RULE.RC_SHORTENED_WEEKLY_REST_MIN);
  if (!shortened || shortened.minutes >= weekly.minutes) {
    return null;
  }
  return shortened;
}

function reportShortenedRest(
  request: AssignmentRequest,
  weekly: UsableRule,
  shortened: UsableRule,
  actual: number,
  evaluation: Evaluation,
): void {
  const exception = hasException(request, RULE.RC_SHORTENED_WEEKLY_REST_MIN);
  const interval = evaluation.optional(RULE.RC_SHORTENED_WEEKLY_REST_INTERVAL_WEEKS);

  evaluation.warn(shortened, {
    calculatedValue: actual,
    limit: weekly.minutes,
    message:
      `De wekelijkse rust is ${formatSpan(actual)} en steunt op de verkorting door de ` +
      `roostercommissie. Dat mag hooguit eens per ${interval?.count ?? "?"} weken; de engine ` +
      "houdt geen register van eerder verleende verkortingen bij en kan dat interval " +
      "niet zelf vaststellen. De roostercommissie blijft daarvoor verantwoordelijk.",
    occurrenceKey: `verkorte-weekrust:${request.date}`,
    details: { verleendDoor: exception?.grantedByUserId, verleendOp: exception?.grantedAt },
  });

  evaluation.impact({
    ruleId: RULE.RC_SHORTENED_WEEKLY_REST_MIN,
    title: "Verkorte wekelijkse rust op initiatief van de roostercommissie",
    score: 0,
    message:
      "Een verkorte wekelijkse rust telt voor de optimizer als de slechtst mogelijke " +
      "uitkomst en mag nooit als sluitpost worden gebruikt.",
  });
}

// ── Rustdagen ────────────────────────────────────────────────────────────────

/**
 * De lengte van een rustdag rond de plaatsing.
 *
 * Een R die aansluit op een dienst moet 30 uur onafgebroken duren, een
 * losstaande R 24 uur. Meerdere R-dagen achter elkaar delen dezelfde
 * rustperiode; die wordt één keer beoordeeld en niet per dag herhaald.
 */
function checkRestDayLength(request: AssignmentRequest, evaluation: Evaluation): void {
  if (!evaluation.hasContext("ADJACENT_DUTIES", [RULE.R_DAY_ATTACHED_MIN])) {
    return;
  }

  const attachedRule = evaluation.require(RULE.R_DAY_ATTACHED_MIN);
  const detachedRule = evaluation.require(RULE.R_DAY_DETACHED_MIN);
  if (!attachedRule || !detachedRule) {
    return;
  }

  const seen = new Set<string>();

  for (const day of daysBetween(
    request.timeline,
    addDays(request.date, -3),
    addDays(request.date, 3),
  )) {
    if (day.positionType !== "RUST") {
      continue;
    }

    const before = previousDuty(request.timeline, day.date);
    const after = nextDuty(request.timeline, day.date);
    if (!before || !after) {
      continue;
    }

    const key = `${before.date}|${after.date}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const rest = restMinutesBetween(before, after);
    if (rest === null) {
      continue;
    }

    const previousDay = dayAt(request.timeline, addDays(day.date, -1));
    const attached = previousDay !== null && countsInServiceRun(previousDay);
    const rule = attached ? attachedRule : detachedRule;

    if (rest < rule.minutes) {
      evaluation.violate(rule, {
        calculatedValue: rest,
        limit: rule.minutes,
        message:
          `De rustdag op ${day.date} levert ${formatSpan(rest)} onafgebroken rust op; een ` +
          `rustdag ${attached ? "die aansluit op een dienst" : "die niet op een dienst aansluit"} ` +
          `moet ten minste ${formatSpan(rule.minutes)} duren.`,
        occurrenceKey: `rustdag:${day.date}`,
      });
    }
  }
}

/**
 * Twee rustdagen per week — en waarom een tekort hier geen overtreding heet.
 *
 * Eén van de twee mag binnen de rouleringsperiode naar een andere week worden
 * overgebracht. Dat is een uitdrukkelijke gebeurtenis met een eigen registratie,
 * en die registratie is niet aangeleverd. Een week met één R kan dus een
 * overtreding zijn of een correcte overdracht, en die twee zijn met de
 * beschikbare gegevens niet te onderscheiden. Dan is "overtreding" net zo
 * onjuist als "in orde".
 */
function checkRestDayCount(request: AssignmentRequest, evaluation: Evaluation): void {
  const rule = evaluation.require(RULE.R_DAYS_PER_WEEK_AVG);
  if (!rule) {
    return;
  }
  if (!evaluation.hasContext("DAYS_7", [RULE.R_DAYS_PER_WEEK_AVG])) {
    return;
  }

  const worst = worstSumWindow(
    request.timeline,
    request.date,
    7,
    (day) => (day.positionType === "RUST" ? 1 : 0),
    "MIN",
  );
  if (!worst || worst.value >= rule.count) {
    return;
  }

  evaluation.blockOnMissing({
    ruleId: "R_DAY_TRANSFER_REGISTER",
    title: "Register van overgebrachte rustdagen",
    status: "NOT_SUPPLIED",
    reason:
      `In de week van ${worst.from} tot en met ${worst.to} staan ${worst.value} rustdagen in ` +
      `plaats van ${rule.count}. Eén rustdag mag binnen de rouleringsperiode naar een andere ` +
      "week worden overgebracht, maar er is geen bron waaruit blijkt of dat hier is gebeurd. " +
      "Zonder die registratie is niet vast te stellen of dit een overtreding of een " +
      "correcte overdracht is.",
    packageId: "WR_CO_DEFINITION",
  });
}
