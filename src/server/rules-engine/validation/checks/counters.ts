import { formatSpan } from "@/domain/amsterdam-time";
import { isoWeekday } from "@/domain/time";
import { isNightServiceByTime, measureDuty, startsWithin } from "@/domain/duty-window";
import { RULE } from "../../ruleset/rule-ids";
import type { Evaluation } from "../evaluation";
import type { AssignmentRequest } from "../subject";
import { type TimelineDay, countsInServiceRun, toOccurrence } from "../timeline";
import { calendarYearSpan, coversSpan, worstSumWindow } from "./windows";

/**
 * Tellers over langere vensters.
 *
 * ## Waarom deze regels het lastigst zijn om goed te doen
 *
 * Ze zijn onzichtbaar in het klein. Eén vroege dienst overtreedt niets; de
 * elfde in vier weken wel. Wie deze regels pas bij publicatie controleert, moet
 * een rooster openbreken dat al rond was. Ze worden daarom bij elke plaatsing
 * meegerekend, over elk venster dat de dag bevat.
 */
export function checkCounters(request: AssignmentRequest, evaluation: Evaluation): void {
  checkEarlyStarts(request, evaluation);
  checkLongDuties(request, evaluation);
  checkNightServices(request, evaluation);
  checkFreeSundays(request, evaluation);
}

// ── Vroege starts ────────────────────────────────────────────────────────────

/**
 * De band van de vroege-startenteller.
 *
 * De bron zegt hier "tussen 05:00 en 06:00", zonder de scherpe formulering die
 * de dienstlengteregels wél hebben ("vóór 05:01", "ná 05:00"). Of een start om
 * precies 05:00 meetelt, staat er dus niet. Er wordt geteld met de ruimste
 * lezing — 05:00 telt mee — omdat die de bescherming niet verzwakt, en elke
 * bevinding draagt de openstaande bronvraag mee.
 */
const EARLY_START_COUNTER = { from: 5 * 60, until: 6 * 60 } as const;

function checkEarlyStarts(request: AssignmentRequest, evaluation: Evaluation): void {
  // Alleen tellen wanneer de kandidaat zelf een vroege start is: een gewone
  // middagdienst maakt dit venster niet voller en hoeft er niet op te wachten.
  if (!startsWithin(request.candidate.shape, EARLY_START_COUNTER.from, EARLY_START_COUNTER.until)) {
    return;
  }

  const rule = evaluation.require(RULE.RP_MAX_EARLY_STARTS_0500_0600_PER_4W);
  if (!rule) {
    return;
  }

  if (request.subject.earlyStartProtectionWaived) {
    // Afstand doen van de bescherming is een keuze van de werknemer en moet
    // vastgelegd zijn. Ze verdwijnt niet uit beeld: de planner ziet dat deze
    // grens hier niet geldt en waaróm niet.
    evaluation.impact({
      ruleId: rule.definition.id,
      title: rule.definition.title,
      score: 0.5,
      message:
        "Deze medewerker heeft vastgelegd af te zien van de bescherming tegen vroege " +
        "starts. De grens van vier weken wordt daarom niet toegepast.",
    });
    return;
  }

  if (!evaluation.hasContext("WEEKS_4", [rule.definition.id])) {
    return;
  }

  const worst = worstSumWindow(
    request.timeline,
    request.date,
    28,
    (day) =>
      day.duty &&
      startsWithin(day.duty.shape, EARLY_START_COUNTER.from, EARLY_START_COUNTER.until)
        ? 1
        : 0,
    "MAX",
  );
  if (worst && worst.value > rule.count) {
    evaluation.violate(rule, {
      calculatedValue: worst.value,
      limit: rule.count,
      message:
        `In de periode ${worst.from} tot en met ${worst.to} zijn dit ${worst.value} starts ` +
        `tussen 05:00 en 06:00; het maximum is ${rule.count} per vier weken.`,
      occurrenceKey: `venster:${worst.from}..${worst.to}`,
      unverified: [
        {
          kind: "APPLICABILITY",
          detail:
            "De bron zegt bij deze teller 'tussen 05:00 en 06:00' zonder aan te geven of " +
            "05:00 zelf meetelt. Er is geteld met de ruimste lezing; NS moet de bandgrens " +
            "vaststellen.",
        },
      ],
    });
  }
}

// ── Lange diensten ───────────────────────────────────────────────────────────

function checkLongDuties(request: AssignmentRequest, evaluation: Evaluation): void {
  const threshold = evaluation.require(RULE.RP_LONG_DUTY_THRESHOLD);
  if (!threshold) {
    return;
  }

  const isLong = (day: TimelineDay): boolean => {
    const minutes = dutyMinutesOf(day);
    return minutes !== null && minutes > threshold.minutes;
  };

  const candidateMinutes = measureDuty({
    date: request.date,
    shape: request.candidate.shape,
  }).dutyMinutes;
  if (candidateMinutes <= threshold.minutes) {
    return;
  }

  const rule = evaluation.require(RULE.RP_MAX_LONG_DUTIES_PER_YEAR);
  if (!rule) {
    return;
  }

  // Het kalenderjaar is geen voortschrijdend venster maar een vast blok: de
  // dertiende lange dienst van het jaar is een overtreding, ook wanneer de
  // twaalfde elf maanden eerder viel. Is het jaar niet volledig geladen, dan
  // wordt dat als hiaat gemeld in plaats van te tellen wat toevallig in beeld is.
  const year = calendarYearSpan(request.date);
  if (
    !coversSpan(request.timeline, year) &&
    !evaluation.hasContext("CALENDAR_YEAR", [rule.definition.id])
  ) {
    return;
  }

  const count = request.timeline.days
    .filter((day) => day.date >= year.from && day.date <= year.to)
    .filter(isLong).length;

  if (count > rule.count) {
    evaluation.violate(rule, {
      calculatedValue: count,
      limit: rule.count,
      message:
        `Dit is de ${count}e dienst van ${year.from.slice(0, 4)} met een dienstlengte van meer ` +
        `dan ${formatSpan(threshold.minutes)}; er zijn er ten hoogste ${rule.count} per ` +
        "kalenderjaar toegestaan.",
      occurrenceKey: `kalenderjaar:${year.from.slice(0, 4)}`,
    });
  }
}

function dutyMinutesOf(day: TimelineDay): number | null {
  const occurrence = toOccurrence(day);
  return occurrence ? measureDuty(occurrence).dutyMinutes : null;
}

// ── Nachtdiensten ────────────────────────────────────────────────────────────

function checkNightServices(request: AssignmentRequest, evaluation: Evaluation): void {
  if (!isNightServiceByTime(request.candidate.shape)) {
    return;
  }

  const rule = evaluation.require(RULE.MAX_NIGHT_SERVICES_16W);
  if (!rule) {
    return;
  }
  if (!evaluation.hasContext("WEEKS_16", [rule.definition.id])) {
    return;
  }

  const worst = worstSumWindow(
    request.timeline,
    request.date,
    112,
    (day) => (day.duty && isNightServiceByTime(day.duty.shape) ? 1 : 0),
    "MAX",
  );
  if (worst && worst.value > rule.count) {
    evaluation.violate(rule, {
      calculatedValue: worst.value,
      limit: rule.count,
      message:
        `In de periode ${worst.from} tot en met ${worst.to} zijn dit ${worst.value} ` +
        `nachtdiensten; het maximum is ${rule.count} per zestien weken.`,
      occurrenceKey: `venster:${worst.from}..${worst.to}`,
    });
  }
}

// ── Vrije zondagen ───────────────────────────────────────────────────────────

function checkFreeSundays(request: AssignmentRequest, evaluation: Evaluation): void {
  // Alleen relevant wanneer de plaatsing zelf een zondag bezet houdt.
  if (isoWeekday(request.date) !== 7) {
    return;
  }

  const rule = evaluation.require(RULE.MIN_FREE_SUNDAYS_52W);
  if (!rule) {
    return;
  }
  if (!evaluation.hasContext("WEEKS_52", [rule.definition.id])) {
    return;
  }

  const worst = worstSumWindow(
    request.timeline,
    request.date,
    364,
    (day) => (isoWeekday(day.date) === 7 && !countsInServiceRun(day) ? 1 : 0),
    "MIN",
  );
  if (worst && worst.value < rule.count) {
    evaluation.violate(rule, {
      calculatedValue: worst.value,
      limit: rule.count,
      message:
        `In de periode ${worst.from} tot en met ${worst.to} blijven er ${worst.value} vrije ` +
        `zondagen over; er zijn er ten minste ${rule.count} per 52 weken vereist.`,
      occurrenceKey: `venster:${worst.from}..${worst.to}`,
    });
  }
}
