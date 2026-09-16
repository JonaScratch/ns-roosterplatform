import { isNightServiceByTime, startMinuteOfDay } from "@/domain/duty-window";
import { formatSpan } from "@/domain/amsterdam-time";
import type { Evaluation } from "../evaluation";
import type { AssignmentRequest } from "../subject";
import { dayAt, nextDuty, previousDuty, restMinutesBetween } from "../timeline";

/**
 * Zachte signalen.
 *
 * ## Waarom deze nooit als overtreding verschijnen
 *
 * Alles hier is wenselijkheid, geen norm. Een omgekeerde rotatie is vermoeiend
 * maar niet verboden; een rust van dertien uur is krap maar rechtmatig. Ze
 * krijgen daarom geen regelbron en geen `violate`, maar een score voor de
 * optimizer. Dat onderscheid is niet cosmetisch: een zachte score mag een harde
 * overtreding nooit compenseren, en dat kan alleen als ze nooit in hetzelfde
 * vakje terechtkomen.
 */
export function checkQuality(request: AssignmentRequest, evaluation: Evaluation): void {
  const candidate = dayAt(request.timeline, request.date);
  if (!candidate?.duty) {
    return;
  }

  scoreRestQuality(request, evaluation);
  scoreRotation(request, evaluation);
}

/**
 * Ruime rust is beter dan krappe rust, ook boven het minimum.
 *
 * Zonder dit signaal ziet een optimizer twaalf uur en achttien uur als even
 * goed, en kiest hij de eerste zodra dat elders een halve minuut wint.
 */
function scoreRestQuality(request: AssignmentRequest, evaluation: Evaluation): void {
  const candidate = dayAt(request.timeline, request.date);
  const before = previousDuty(request.timeline, request.date);
  const after = nextDuty(request.timeline, request.date);
  if (!candidate) {
    return;
  }

  const periods = [
    before ? restMinutesBetween(before, candidate) : null,
    after ? restMinutesBetween(candidate, after) : null,
  ].filter((minutes): minutes is number => minutes !== null && minutes >= 0);

  if (periods.length === 0) {
    return;
  }

  const shortest = Math.min(...periods);
  // Twaalf uur is het wettelijke minimum, twintig uur ruim. Daartussen loopt de
  // wenselijkheid op; boven twintig uur voegt extra rust weinig meer toe.
  const score = Math.max(0, Math.min(1, (shortest - 12 * 60) / (8 * 60)));

  evaluation.impact({
    ruleId: "SOFT_RUSTKWALITEIT",
    title: "Kwaliteit van de rust rond de dienst",
    score,
    message: `De krapste rustperiode rond deze dienst is ${formatSpan(shortest)}.`,
  });
}

/**
 * Voorwaartse rotatie is prettiger dan achterwaartse.
 *
 * Vroeg → laat → nacht volgt de natuurlijke verschuiving van het slaapritme.
 * Nacht → vroeg is de omgekeerde beweging en kost het meest.
 */
function scoreRotation(request: AssignmentRequest, evaluation: Evaluation): void {
  const candidate = dayAt(request.timeline, request.date);
  const before = previousDuty(request.timeline, request.date);
  if (!candidate?.duty || !before?.duty) {
    return;
  }

  const previousStart = startMinuteOfDay(before.duty.shape);
  const candidateStart = startMinuteOfDay(candidate.duty.shape);
  const wasNight = isNightServiceByTime(before.duty.shape);

  if (wasNight && candidateStart < 10 * 60) {
    evaluation.impact({
      ruleId: "SOFT_ROTATIE",
      title: "Richting van de dienstrotatie",
      score: 0,
      message:
        `Na nachtdienst ${before.duty.code} volgt een dienst die om ` +
        `${formatSpan(candidateStart)} begint. Dat is een achterwaartse rotatie.`,
    });
    return;
  }

  const forward = candidateStart >= previousStart;
  evaluation.impact({
    ruleId: "SOFT_ROTATIE",
    title: "Richting van de dienstrotatie",
    score: forward ? 1 : 0.4,
    message: forward
      ? "De dienst begint niet eerder dan de vorige; de rotatie loopt voorwaarts."
      : `De dienst begint ${formatSpan(previousStart - candidateStart)} eerder dan de vorige.`,
  });
}
