import "server-only";
import {
  AvailableDutyStatus,
  ReserveFillOutcome,
  RosterPositionType,
  ScheduleSource,
} from "@/lib/generated/prisma/enums";
import { type CalendarDate, addDays, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { preferenceFit, reservePreferenceLabel } from "@/domain/roster-profiles";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { DEFAULT_PRODUCT_PARAMETERS, rulesEngine } from "@/server/rules-engine";
import { explain, explanationSummary } from "@/server/rules-engine/explain";
import { prisma } from "@/server/data/prisma";
import { fillOperationallyIn } from "@/server/services/operational-assignment-service";
import { DUTY_SELECT, EMPLOYEE_SELECT, toDutyContext } from "@/server/data/mappers";
import { toJson } from "@/server/data/json";
import { buildAssignmentCheck } from "@/server/data/repositories/schedule-repository";
import { persistEvaluation } from "./available-duty-service";

/**
 * Het reserve-rooster: de eerste opvang van een vrijgekomen dienst.
 *
 * ## De volgorde is de kern
 *
 * Een dienst die vrijkomt gaat **eerst** langs het reserve-rooster. Pas als
 * daar geen geldige invulling uit komt, wordt hij opengesteld voor andere
 * medewerkers. Die volgorde staat in de statusovergangen — `RESERVE_PENDING`
 * naar `OPEN` — en niet in de goede bedoelingen van een aanroeper: zolang een
 * dienst `RESERVE_PENDING` is, komt hij in geen enkele medewerkerslijst voor.
 *
 * Elke poging wordt vastgelegd in `ReserveFillAttempt`, ook een mislukte. Zonder
 * dat spoor is achteraf niet aantoonbaar dát reserve eerst aan bod kwam, en dan
 * is de afspraak niet meer dan een bewering.
 *
 * ## Voorkeuren sturen, ze beslissen niet
 *
 * De reservevoorkeur van een medewerker is een wens. Zij komt binnen als zachte
 * regel en beïnvloedt de rangschikking van kandidaten; zij sluit niemand uit.
 * Een reservemedewerker met voorkeur "vroeg" kan dus wel degelijk een late
 * dienst krijgen — alleen pas nadat iemand met de juiste voorkeur is
 * langsgekomen.
 *
 * ## Wat er nog niet in zit
 *
 * De rangschikking weegt nu geldigheid, rustkwaliteit en voorkeur. De eis om
 * ook "aantrekkelijke en onaantrekkelijke diensten eerlijk te verdelen" over een
 * langere periode vraagt een maat voor die verdeling, en die hoort in de
 * optimizer thuis waar het hele rooster in beeld is. Zie README.
 */

export interface ReserveCandidateView {
  readonly employeeNumber: string;
  readonly employeeId: string;
  /** Van 0 tot 1: hoe goed deze invulling scoort volgens de zachte regels. */
  readonly score: number;
  readonly preferenceLabel: string;
  readonly preferenceFit: number;
  readonly valid: boolean;
  readonly explanation: string;
}

/**
 * De reservekandidaten voor een concrete dienst op een datum, gerangschikt.
 *
 * Wie die dag geen RES-positie heeft, staat er niet tussen: dat is geen
 * reserve-invulling maar een beschikbare dienst, en dat is een andere route met
 * andere regels.
 */
export async function reserveCandidatesFor(
  dutyId: string,
  date: CalendarDate,
): Promise<readonly ReserveCandidateView[]> {
  await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  return rankReserveCandidates(dutyId, date);
}

/** Interne variant zonder rechtencontrole, voor de automatische opvang. */
async function rankReserveCandidates(
  dutyId: string,
  date: CalendarDate,
): Promise<readonly ReserveCandidateView[]> {
  const engine = rulesEngine();

  const duty = await prisma.duty.findUnique({ where: { id: dutyId }, select: DUTY_SELECT });
  if (!duty) {
    return [];
  }

  // Iedereen die die dag op een RES-positie staat, binnen dezelfde standplaats.
  const reserves = await prisma.scheduledDuty.findMany({
    where: {
      date: toDatabaseDate(date),
      positionType: RosterPositionType.RES,
      employee: { depot: duty.depot, status: "ACTIVE" },
    },
    select: { employee: { select: EMPLOYEE_SELECT } },
  });

  const dutyContext = toDutyContext(duty);
  const candidates: ReserveCandidateView[] = [];

  for (const reserve of reserves) {
    const check = await buildAssignmentCheck({
      employeeId: reserve.employee.id,
      date,
      duty: dutyContext,
    });
    const evaluation = await engine.evaluateReserveFill({
      type: "RESERVE_FILL",
      check,
      onReservePosition: true,
    });

    const fit = preferenceFit(reserve.employee.reservePreference, dutyContext.kinds);
    const explanation = explain(evaluation, {
      positive:
        fit >= 1
          ? `Beste geldige aansluiting binnen het rooster, past bij ${reservePreferenceLabel(
              reserve.employee.reservePreference,
            ).toLowerCase()}.`
          : "Geldige aansluiting binnen het rooster; de opgegeven voorkeur wijkt af.",
    });

    candidates.push({
      employeeId: reserve.employee.id,
      employeeNumber: reserve.employee.employeeNumber,
      // De voorkeur weegt mee in de rangschikking maar kan een geldige
      // kandidaat nooit onder een ongeldige duwen: die krijgt score 0.
      score: evaluation.decision === "BLOCK" ? 0 : evaluation.score * (0.75 + 0.25 * fit),
      preferenceLabel: reservePreferenceLabel(reserve.employee.reservePreference),
      preferenceFit: fit,
      valid: evaluation.decision !== "BLOCK",
      explanation: explanationSummary(explanation),
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Fase 1: probeer de dienst automatisch via het reserve-rooster op te vangen.
 *
 * Geeft terug wat er gebeurd is, met de reden. De aanroeper beslist of hij bij
 * `NO_CANDIDATE` doorgaat naar fase 2.
 */
export async function attemptReserveFill(availableDutyId: string): Promise<{
  readonly outcome: ReserveFillOutcome;
  readonly filledEmployeeNumber?: string;
  readonly reason: string;
}> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);

  const available = await prisma.availableDuty.findUnique({
    where: { id: availableDutyId },
    select: { id: true, date: true, status: true, duty: { select: DUTY_SELECT } },
  });
  if (!available || available.status !== AvailableDutyStatus.RESERVE_PENDING) {
    return {
      outcome: ReserveFillOutcome.SKIPPED,
      reason: "Deze dienst ligt niet (meer) bij het reserve-rooster.",
    };
  }

  const date = toCalendarDate(available.date);
  const candidates = await rankReserveCandidates(available.duty.id, date);
  const winner = candidates.find((candidate) => candidate.valid);

  if (!winner) {
    const reason =
      candidates.length === 0
        ? "Geen enkele medewerker staat die dag op een RES-positie."
        : "Alle reservemedewerkers vallen af op een harde regel.";

    await prisma.reserveFillAttempt.create({
      data: {
        availableDutyId,
        outcome:
          candidates.length === 0
            ? ReserveFillOutcome.NO_CANDIDATE
            : ReserveFillOutcome.BLOCKED_BY_RULES,
        candidatesConsidered: candidates.length,
        details: toJson({ reden: reason, kandidaten: candidates.map(summarise) }),
      },
    });

    await recordAudit({
      actor,
      action: "reserve.invulling-mislukt",
      objectType: "AvailableDuty",
      objectId: availableDutyId,
      newValue: { datum: date, dienst: available.duty.code, kandidaten: candidates.length },
      reason,
    });

    return {
      outcome:
        candidates.length === 0
          ? ReserveFillOutcome.NO_CANDIDATE
          : ReserveFillOutcome.BLOCKED_BY_RULES,
      reason,
    };
  }

  // De invulling gaat als laag over de reservedag heen; het RES-slot blijft
  // eronder bewaard. Wordt de dienst later ingetrokken, dan staat er weer een
  // reservedag in plaats van een lege dienstdag.
  const onderliggend = await prisma.$transaction(async (tx) => {
    const slot = await fillOperationallyIn(tx, {
      employeeId: winner.employeeId,
      date: available.date,
      dutyId: available.duty.id,
      source: ScheduleSource.RESERVE_FILL,
      assignedByUserId: actor.userId,
      reason: winner.explanation,
    });
    await tx.availableDuty.update({
      where: { id: availableDutyId },
      data: {
        status: AvailableDutyStatus.ALLOCATED,
        awardedEmployeeId: winner.employeeId,
        awardedAt: new Date(),
        awardRanking: toJson({ route: "reserve", kandidaten: candidates.map(summarise) }),
      },
    });
    await tx.reserveFillAttempt.create({
      data: {
        availableDutyId,
        outcome: ReserveFillOutcome.FILLED,
        candidatesConsidered: candidates.length,
        filledEmployeeId: winner.employeeId,
        details: toJson({ reden: winner.explanation, kandidaten: candidates.map(summarise) }),
      },
    });
    return slot;
  });

  await recordAudit({
    actor,
    action: "reserve.ingevuld",
    objectType: "AvailableDuty",
    objectId: availableDutyId,
    newValue: {
      personeelsnummer: winner.employeeNumber,
      dienst: available.duty.code,
      datum: date,
      score: Number(winner.score.toFixed(3)),
      onderliggendSlot: onderliggend,
    },
    reason: winner.explanation,
  });

  return {
    outcome: ReserveFillOutcome.FILLED,
    filledEmployeeNumber: winner.employeeNumber,
    reason: winner.explanation,
  };
}

/**
 * Fase 2: de dienst openstellen voor medewerkers.
 *
 * Kan alleen wanneer fase 1 daadwerkelijk is geprobeerd. Dat is geen formaliteit
 * maar de afdwinging van de volgorde: zonder vastgelegde poging is niet te
 * verantwoorden dat het reserve-rooster is overgeslagen.
 */
export async function openForEmployees(availableDutyId: string): Promise<{
  readonly ok: boolean;
  readonly reason: string;
}> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);

  const available = await prisma.availableDuty.findUnique({
    where: { id: availableDutyId },
    select: {
      id: true,
      date: true,
      status: true,
      duty: { select: { code: true } },
      reserveAttempts: { select: { outcome: true } },
    },
  });
  if (!available) {
    return { ok: false, reason: "Onbekende dienst." };
  }
  if (available.status !== AvailableDutyStatus.RESERVE_PENDING) {
    return { ok: false, reason: "Deze dienst staat al open of is al vergeven." };
  }
  if (available.reserveAttempts.length === 0) {
    return {
      ok: false,
      reason: "Probeer de dienst eerst via het reserve-rooster; die stap is verplicht.",
    };
  }

  const date = toCalendarDate(available.date);
  await prisma.availableDuty.update({
    where: { id: availableDutyId },
    data: {
      status: AvailableDutyStatus.OPEN,
      openedAt: new Date(),
      // Kiezen kan tot de avond vóór de dienst; de horizon van twee weken
      // begrenst hoe ver vooruit dit überhaupt speelt.
      closesAt: new Date(`${addDays(date, -1)}T20:00:00.000Z`),
    },
  });

  await recordAudit({
    actor,
    action: "beschikbare-dienst.opengesteld",
    objectType: "AvailableDuty",
    objectId: availableDutyId,
    oldValue: { status: AvailableDutyStatus.RESERVE_PENDING },
    newValue: { status: AvailableDutyStatus.OPEN, dienst: available.duty.code, datum: date },
    reason: "reserve-rooster bood geen geldige invulling",
  });

  return { ok: true, reason: "De dienst staat nu open voor geschikte medewerkers." };
}

/**
 * Een dienst vrijgeven, bijvoorbeeld bij verlof.
 *
 * Zet de roosterdag van de medewerker op verlof en biedt de dienst aan het
 * reserve-rooster aan. De medewerker verdwijnt daarmee uit de dienst en de
 * dienst begint aan zijn route: eerst reserve, dan pas open.
 */
export async function releaseDuty(options: {
  readonly scheduledDutyId: string;
  readonly newPositionType: "VERLOF" | "RUST";
  readonly reason: string;
}): Promise<{ readonly ok: boolean; readonly availableDutyId?: string; readonly reason: string }> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);

  const row = await prisma.scheduledDuty.findUnique({
    where: { id: options.scheduledDutyId },
    select: {
      id: true,
      date: true,
      employeeId: true,
      duty: { select: { id: true, code: true } },
      employee: { select: { employeeNumber: true } },
    },
  });
  if (!row?.duty) {
    return { ok: false, reason: "Op deze roosterdag staat geen dienst." };
  }

  const date = toCalendarDate(row.date);
  const horizon = addDays(toCalendarDate(new Date()), DEFAULT_PRODUCT_PARAMETERS.availableDutyHorizonDays);
  if (date > horizon) {
    // Verder vooruit dan de horizon hoeft niet via deze module: daar is nog
    // ruim tijd voor de gewone roosterprocessen.
    return {
      ok: false,
      reason: `Deze dienst ligt verder dan ${DEFAULT_PRODUCT_PARAMETERS.availableDutyHorizonDays} dagen vooruit; vrijgeven verloopt dan buiten deze module.`,
    };
  }

  const existing = await prisma.availableDuty.findUnique({
    where: { dutyId_date: { dutyId: row.duty.id, date: row.date } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, reason: "Deze dienst is op die datum al vrijgegeven." };
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.scheduledDuty.update({
      where: { id: row.id },
      data: {
        positionType: options.newPositionType,
        dutyId: null,
        source: ScheduleSource.PLANNER_MANUAL,
      },
    });
    return tx.availableDuty.create({
      data: {
        dutyId: row.duty!.id,
        date: row.date,
        status: AvailableDutyStatus.RESERVE_PENDING,
        originEmployeeId: row.employeeId,
        // Operationeel geformuleerd. Wat er met de oorspronkelijke medewerker aan
        // de hand is, gaat de dienstindeling niet aan; dát er iemand uitvalt wel.
        openReason:
          options.newPositionType === "VERLOF"
            ? "Oorspronkelijke medewerker is niet inzetbaar op deze dag."
            : "Dienst is vrijgegeven en nog niet opnieuw ingedeeld.",
        closesAt: new Date(`${addDays(date, -1)}T20:00:00.000Z`),
      },
      select: { id: true },
    });
  });

  await recordAudit({
    actor,
    action: "dienst.vrijgegeven",
    objectType: "ScheduledDuty",
    objectId: row.id,
    oldValue: { dienst: row.duty.code, personeelsnummer: row.employee.employeeNumber },
    newValue: {
      positie: options.newPositionType,
      datum: date,
      beschikbareDienstId: created.id,
    },
    reason: options.reason,
  });

  return {
    ok: true,
    availableDutyId: created.id,
    reason: "De dienst is aangeboden aan het reserve-rooster.",
  };
}

function summarise(candidate: ReserveCandidateView) {
  return {
    personeelsnummer: candidate.employeeNumber,
    score: Number(candidate.score.toFixed(3)),
    geldig: candidate.valid,
    voorkeur: candidate.preferenceLabel,
  };
}

export { persistEvaluation };
