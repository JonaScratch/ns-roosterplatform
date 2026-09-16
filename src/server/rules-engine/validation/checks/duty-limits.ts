import { formatSpan } from "@/domain/amsterdam-time";
import { RULE } from "../../ruleset/rule-ids";
import { type Range, assertMaximum, assertMinimum, exact } from "../bounds";
import type { Evaluation, UsableRule } from "../evaluation";
import type { MissingRule } from "../result";
import { type AssignmentRequest, isRidingStaff } from "../subject";
import type { DutyMetrics } from "./metrics";

/**
 * De grenzen van één dienst: arbeidstijd, dienstlengte en overwerk.
 *
 * ## Waarom elke grens apart wordt getoetst
 *
 * De verleiding is om vooraf "de strengste grens" te bepalen en die één keer te
 * toetsen. Dat levert een bevinding op zonder herkomst: de planner ziet een
 * getal en niet welk artikel eronder ligt. Hier wordt elke bepaling die van
 * toepassing is afzonderlijk getoetst, met zijn eigen bron in de uitkomst. Dat
 * er meerdere tegelijk kunnen afgaan, is geen ruis maar informatie.
 *
 * ## De standplaatsafhankelijke verlaging
 *
 * Bij een werkonderbreking van meer dan een half uur ligt de maximale
 * arbeidstijd volgens de bron 2 tot 10 minuten lager, per standplaats
 * vastgesteld. Die waarde is voor Dordrecht niet aangeleverd. In plaats van
 * hem te raden wordt de grens als bandbreedte behandeld: bewezen te lang bij
 * overschrijding van de ruimste lezing, bewezen in orde onder de strengste, en
 * daartussen geblokkeerd met vermelding van precies deze ontbrekende parameter.
 */

/** Het bereik van de verlaging volgens de bron. Zie RP_STATION_BREAK_ADJUSTMENT. */
const STATION_ADJUSTMENT_RANGE = { min: 2, max: 10 } as const;

export function checkDutyLimits(
  request: AssignmentRequest,
  metrics: DutyMetrics,
  evaluation: Evaluation,
): void {
  checkWorkMaxima(request, metrics, evaluation);
  checkDutyMaxima(request, metrics, evaluation);
  checkMinima(request, metrics, evaluation);
  checkBreaks(request, metrics, evaluation);
  checkHardNightEnd(request, metrics, evaluation);
}

// ── Pauze ────────────────────────────────────────────────────────────────────

/**
 * De pauze die bij de arbeidstijd hoort.
 *
 * ## Waarom deze toets er eerst niet was
 *
 * De twee pauzebepalingen stonden wel in het regelbestand maar werden nergens
 * toegepast. Dat viel niet op omdat de dekkingsmeting alle regelnamen meetelde,
 * óók die in het regelbestand zelf — en dan lijkt elke regel geïmplementeerd.
 * Sinds die meting alleen naar de toepassende code kijkt, kwamen ze boven.
 *
 * ## Waarom een onbekende pauze hier blokkeert
 *
 * Bij een dienst zonder opgegeven pauze is de arbeidstijd een bandbreedte, en
 * dan valt niet vast te stellen of de vereiste pauze is gehaald. Een aanname
 * ("er zal wel dertig minuten in zitten") zou hier het verschil uitmaken tussen
 * een dienst die mag en een die niet mag. Daarom wordt de beslissing
 * geblokkeerd met vermelding van wat er ontbreekt.
 */
function checkBreaks(
  request: AssignmentRequest,
  metrics: DutyMetrics,
  evaluation: Evaluation,
): void {
  const drempels: readonly {
    readonly ruleId: string;
    /** Vanaf welke arbeidstijd deze pauze verplicht is, in minuten. */
    readonly boven: number;
  }[] = [
    { ruleId: RULE.BREAK_OVER_5H30, boven: 5 * 60 + 30 },
    { ruleId: RULE.BREAK_OVER_10H, boven: 10 * 60 },
  ];

  for (const drempel of drempels) {
    const regel = evaluation.require(drempel.ruleId);
    if (!regel) {
      continue;
    }

    // De arbeidstijd is een bandbreedte. Ligt zelfs de ruimste lezing onder de
    // drempel, dan is er geen pauzeplicht en valt er niets te toetsen.
    if (metrics.work.max <= drempel.boven) {
      continue;
    }

    const pauze = metrics.measurement.breakMinutes;

    if (pauze === null) {
      // Alleen blokkeren wanneer de pauzeplicht ook werkelijk geldt: ligt de
      // ondergrens onder de drempel, dan is zelfs dát niet vast te stellen —
      // en dan is de onbekende pauze de oorzaak, niet de lengte.
      evaluation.blockOnMissing({
        ruleId: drempel.ruleId,
        title: regel.definition.title,
        status: "UNRESOLVED",
        reason:
          `De pauze van dienst ${request.candidate.code} is niet aangeleverd, terwijl de ` +
          `arbeidstijd boven ${formatSpan(drempel.boven)} uitkomt. Zonder de pauze is niet ` +
          "vast te stellen of de voorgeschreven onderbreking is gehaald.",
      });
      continue;
    }

    assertMinimum(evaluation, {
      rule: regel,
      value: exact(pauze),
      limit: exact(regel.minutes),
      occurrenceKey: `${request.date}|${request.candidate.dutyId}|pauze`,
      violationMessage: (value, limit) =>
        `Dienst ${request.candidate.code} heeft ${formatSpan(value.max)} pauze bij een ` +
        `arbeidstijd van ${formatSpan(metrics.work.max)}; voorgeschreven is minimaal ` +
        `${formatSpan(limit.min)}.`,
      indeterminate: [],
    });
  }
}

// ── Maximale arbeidstijd ─────────────────────────────────────────────────────

function checkWorkMaxima(
  request: AssignmentRequest,
  metrics: DutyMetrics,
  evaluation: Evaluation,
): void {
  const adjustment = workLimitAdjustment(request, metrics, evaluation);

  const applicable: readonly { readonly id: string; readonly value: Range; readonly label: string }[] = [
    { id: RULE.RP_MAX_WORK_PER_DUTY, value: metrics.work, label: "arbeidstijd" },
    {
      id: RULE.RP_MAX_WORK_INCL_OVERTIME,
      value: metrics.workInclOvertime,
      label: "arbeidstijd inclusief overwerk",
    },
    ...(metrics.startsEarly
      ? [{ id: RULE.RP_MAX_WORK_START_0500_0600, value: metrics.work, label: "arbeidstijd" }]
      : []),
    ...(metrics.isNight
      ? [
          { id: RULE.NIGHT_MAX_WORK, value: metrics.work, label: "arbeidstijd" },
          {
            id: RULE.NIGHT_MAX_WORK_INCL_OVERTIME,
            value: metrics.workInclOvertime,
            label: "arbeidstijd inclusief overwerk",
          },
        ]
      : []),
    ...(metrics.isNight && metrics.startsVeryEarly
      ? [{ id: RULE.RP_NIGHT_START_0400_0501_MAX_WORK, value: metrics.work, label: "arbeidstijd" }]
      : []),
    ...(metrics.crossesHalfPastTwo
      ? [{ id: RULE.RP_NIGHT_ACROSS_0230_MAX_WORK, value: metrics.work, label: "arbeidstijd" }]
      : []),
  ];

  for (const entry of applicable) {
    const rule = evaluation.require(entry.id);
    if (!rule) {
      continue;
    }
    assertMaximum(evaluation, {
      rule,
      value: entry.value,
      limit: adjustment.limitFor(rule),
      occurrenceKey: `${request.date}|${request.candidate.dutyId}`,
      violationMessage: (value, limit) =>
        `De ${entry.label} van dienst ${request.candidate.code} is ${formatSpan(value.min)} en ` +
        `overschrijdt het maximum van ${formatSpan(limit.max)} (${rule.definition.title}).`,
      indeterminate: [
        ...(adjustment.indeterminate ? [adjustment.indeterminate] : []),
        ...(metrics.measurement.workMinutesExact ? [] : [unknownWorkTime(request, entry.label)]),
      ],
    });
  }
}

/**
 * De grens en de onzekerheid die erop rust.
 *
 * Twee onafhankelijke bronnen van onzekerheid komen hier samen: de grens zelf
 * (de standplaatsafhankelijke verlaging) en de gemeten waarde (een niet
 * vastgelegde werkonderbreking). Beide worden als bandbreedte doorgegeven; welke
 * van de twee de blokkade veroorzaakt, blijkt uit de gemelde ontbrekende regel.
 */
function workLimitAdjustment(
  request: AssignmentRequest,
  metrics: DutyMetrics,
  evaluation: Evaluation,
): {
  readonly limitFor: (rule: UsableRule) => Range;
  readonly indeterminate: MissingRule | null;
} {
  const applies = isRidingStaff(request.subject) && metrics.breakExceedsHalfHour;
  if (!applies) {
    return { limitFor: (rule) => exact(rule.minutes), indeterminate: null };
  }

  const adjustment = evaluation.optional(RULE.RP_STATION_BREAK_ADJUSTMENT);
  if (adjustment) {
    return {
      limitFor: (rule) => exact(rule.minutes - adjustment.minutes),
      indeterminate: null,
    };
  }

  return {
    limitFor: (rule) => ({
      min: rule.minutes - STATION_ADJUSTMENT_RANGE.max,
      max: rule.minutes - STATION_ADJUSTMENT_RANGE.min,
    }),
    indeterminate:
      evaluation.describeMissing(RULE.RP_STATION_BREAK_ADJUSTMENT) ?? {
        ruleId: RULE.RP_STATION_BREAK_ADJUSTMENT,
        title: "Standplaatsafhankelijke verlaging bij werkonderbreking > 30 minuten",
        status: "UNVALIDATED_LOCAL_PARAMETER",
        reason:
          "De werkonderbreking duurt langer dan een half uur, waardoor de maximale " +
          "arbeidstijd 2 tot 10 minuten lager ligt. De waarde voor deze standplaats " +
          "is niet aangeleverd en de arbeidstijd ligt binnen die marge van de grens.",
        packageId: "DORDRECHT_BREAK_PARAMETER",
      },
  };
}

function unknownWorkTime(request: AssignmentRequest, label: string): MissingRule {
  return {
    ruleId: RULE.RP_LOCATION_WORK_INTERRUPTION,
    title: "Standplaatsafhankelijke werkonderbreking rijdend personeel",
    status: "UNVALIDATED_LOCAL_PARAMETER",
    reason:
      `De ${label} van dienst ${request.candidate.code} is niet exact bekend omdat de ` +
      "duur van de werkonderbreking voor deze standplaats niet is aangeleverd " +
      "(bereik volgens bron: 32–40 minuten). De uitkomst van deze toets verandert " +
      "binnen dat bereik.",
    packageId: "DORDRECHT_BREAK_PARAMETER",
  };
}

// ── Maximale dienstlengte ────────────────────────────────────────────────────

function checkDutyMaxima(
  request: AssignmentRequest,
  metrics: DutyMetrics,
  evaluation: Evaluation,
): void {
  const applicable: readonly string[] = [
    RULE.RP_MAX_DUTY_DURATION,
    ...(metrics.startsVeryEarly ? [RULE.RP_MAX_DUTY_START_0400_0501] : []),
    ...(metrics.startsEarly ? [RULE.RP_MAX_DUTY_START_0500_0600] : []),
    ...(metrics.isNight ? [RULE.NIGHT_MAX_DUTY_DURATION] : []),
    ...(metrics.isNight && metrics.startsVeryEarly
      ? [RULE.RP_NIGHT_START_0400_0501_MAX_DUTY]
      : []),
    ...(metrics.crossesHalfPastTwo ? [RULE.RP_NIGHT_ACROSS_0230_MAX_DUTY] : []),
  ];

  for (const id of applicable) {
    const rule = evaluation.require(id);
    if (!rule) {
      continue;
    }
    assertMaximum(evaluation, {
      rule,
      value: metrics.duty,
      limit: exact(rule.minutes),
      occurrenceKey: `${request.date}|${request.candidate.dutyId}`,
      violationMessage: (value, limit) =>
        `Dienst ${request.candidate.code} duurt ${formatSpan(value.min)} en overschrijdt de ` +
        `maximale dienstlengte van ${formatSpan(limit.max)} (${rule.definition.title}).` +
        (metrics.dstShiftMinutes !== 0
          ? ` Op de klok is dat ${formatSpan(metrics.dutyWallClockMinutes)}; het verschil komt ` +
            "door de overgang naar zomer- of wintertijd."
          : ""),
      // De dienstlengte is exact bekend; er is hier geen onzekerheid die kan
      // blokkeren. Deze melding is dus onbereikbaar zolang dat zo blijft.
      indeterminate: {
        ruleId: id,
        title: rule.definition.title,
        status: "UNRESOLVED",
        reason: "De dienstlengte kon niet eenduidig aan deze grens worden getoetst.",
      },
    });
  }
}

// ── Minima ───────────────────────────────────────────────────────────────────

function checkMinima(
  request: AssignmentRequest,
  metrics: DutyMetrics,
  evaluation: Evaluation,
): void {
  const minWork = evaluation.require(RULE.MIN_WORK_PER_DUTY);
  if (minWork) {
    assertMinimum(evaluation, {
      rule: minWork,
      value: metrics.work,
      limit: exact(minWork.minutes),
      occurrenceKey: `${request.date}|${request.candidate.dutyId}`,
      violationMessage: (value, limit) =>
        `De arbeidstijd van dienst ${request.candidate.code} is ${formatSpan(value.max)} en ` +
        `blijft onder het minimum van ${formatSpan(limit.min)}.`,
      indeterminate: unknownWorkTime(request, "arbeidstijd"),
    });
  }

  const minDuty = evaluation.require(RULE.RP_MIN_DUTY_DURATION);
  if (minDuty) {
    assertMinimum(evaluation, {
      rule: minDuty,
      value: metrics.duty,
      limit: exact(minDuty.minutes),
      occurrenceKey: `${request.date}|${request.candidate.dutyId}`,
      violationMessage: (value, limit) =>
        `Dienst ${request.candidate.code} duurt ${formatSpan(value.max)} en blijft onder de ` +
        `minimale dienstlengte van ${formatSpan(limit.min)}.`,
      indeterminate: {
        ruleId: RULE.RP_MIN_DUTY_DURATION,
        title: minDuty.definition.title,
        status: "UNRESOLVED",
        reason: "De dienstlengte kon niet eenduidig aan deze grens worden getoetst.",
      },
    });
  }
}

// ── Uiterste eindtijd van een harde nachtdienst ──────────────────────────────

function checkHardNightEnd(
  request: AssignmentRequest,
  metrics: DutyMetrics,
  evaluation: Evaluation,
): void {
  if (!metrics.isHardNight) {
    return;
  }
  const rule = evaluation.require(RULE.RP_HARD_NIGHT_LATEST_END);
  if (!rule) {
    return;
  }

  const endMinuteOfDay = request.candidate.shape.endMinute % 1440;
  // Alleen zinvol voor een dienst die 's ochtends eindigt: een harde nachtdienst
  // die om 03:30 afloopt eindigt niet "na 07:00", en een dienst die 's avonds
  // eindigt raakt het venster 02:00–04:00 aan de andere kant van de nacht.
  const endsInTheMorning = request.candidate.shape.endMinute > 1440;
  if (endsInTheMorning && endMinuteOfDay > rule.minutes) {
    evaluation.violate(rule, {
      calculatedValue: endMinuteOfDay,
      limit: rule.minutes,
      occurrenceKey: `${request.date}|${request.candidate.dutyId}|eindtijd`,
      message:
        `Dienst ${request.candidate.code} raakt de periode 02:00–04:00 en eindigt om ` +
        `${formatSpan(endMinuteOfDay)}. Een harde nachtdienst mag niet later dan ` +
        `${formatSpan(rule.minutes)} eindigen.`,
    });
  }
}
