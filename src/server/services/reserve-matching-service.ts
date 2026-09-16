import "server-only";
import {
  AvailableDutyStatus,
  RosterPositionType,
  ScheduleSource,
} from "@/lib/generated/prisma/enums";
import { type CalendarDate, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { preferenceFit, reservePreferenceLabel } from "@/domain/roster-profiles";
import type { SuitabilityFactor } from "@/domain/suitability";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { DUTY_SELECT, toDutyContext } from "@/server/data/mappers";
import { toJson } from "@/server/data/json";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { formatMinuteOfDay } from "@/domain/time";
import { assessAssignment } from "./assignment-suitability-service";
import { flushNotifications, publishInTransaction, userIdFor } from "./domain-events";
import { fillOperationallyIn } from "./operational-assignment-service";

/**
 * Wie krijgt deze dienst? — de derde laag.
 *
 * ## De volgorde in dit bestand
 *
 *  1. **Mag het.** De rules engine. Wie hier afvalt, verschijnt in geen enkele
 *     lijst en is met geen enkele knop alsnog toe te wijzen.
 *  2. **Sluit het aan.** De geschiktheidslaag. Wat niet aansluit, verdwijnt niet
 *     voor de dienstindeling — het krijgt zijn bezwaren mee. De planner weet
 *     dingen die het systeem niet weet, en mag afwegen; hij mag alleen niet
 *     langs stap 1.
 *  3. **Wie als eerste.** Voorkeur, eerlijkheid, rangschikking. Pas hier telt
 *     wat iemand het liefst wil, en nooit eerder: een voorkeur mag een slechte
 *     aansluiting niet goedpraten.
 *
 * ## Opnieuw toetsen bij het toewijzen
 *
 * Tussen het tonen van een lijst en het aanklikken van een naam kan het rooster
 * veranderen — door een ruil, door een ziekmelding, door een andere planner. De
 * toewijzing toetst daarom opnieuw, en weigert wanneer de situatie is
 * verschoven. De lijst op het scherm is een momentopname en wordt ook zo
 * behandeld.
 */

export interface ReserveMatch {
  readonly employeeId: string;
  readonly employeeNumber: string;
  /** Laat de rules engine deze invulling toe? */
  readonly eligible: boolean;
  /** De juridische bezwaren wanneer dat niet zo is. */
  readonly blockingReasons: readonly string[];
  /** 0 tot 1 — rangschikking, geen oordeel over de medewerker. */
  readonly score: number;
  readonly factors: readonly SuitabilityFactor[];
  readonly concerns: readonly string[];
  readonly preferenceLabel: string;
  readonly preferenceFit: number;
  /** Zou een medewerker deze dienst zelf voorgesteld krijgen? */
  readonly selfServiceSuitable: boolean;
}

export interface ReserveMatching {
  readonly date: CalendarDate;
  readonly dutyCode: string;
  readonly matches: readonly ReserveMatch[];
  /** Kandidaten die de regels uitsluiten. Zichtbaar met reden, niet inzetbaar. */
  readonly blocked: readonly ReserveMatch[];
  readonly consideredReserves: number;
}

/**
 * De reservekandidaten voor één dienst, met onderbouwing per kandidaat.
 *
 * Alleen medewerkers die die dag een RES-positie hebben. Wie die dag gewoon
 * dienst heeft, is geen reserve-invulling maar een beschikbare dienst — een
 * andere route met andere regels.
 */
export async function reserveMatching(
  dutyId: string,
  date: CalendarDate,
): Promise<ReserveMatching> {
  await requirePermission(PERMISSIONS.ASSIGNMENT_READ);

  const duty = await prisma.duty.findUnique({ where: { id: dutyId }, select: DUTY_SELECT });
  if (!duty) {
    throw new Error("Onbekende dienst.");
  }
  const dutyContext = toDutyContext(duty);

  const reserves = await prisma.scheduledDuty.findMany({
    where: {
      date: toDatabaseDate(date),
      positionType: RosterPositionType.RES,
      employee: { depot: duty.depot, status: "ACTIVE" },
    },
    select: {
      employee: {
        select: { id: true, employeeNumber: true, reservePreference: true },
      },
    },
  });

  const matches: ReserveMatch[] = [];
  const blocked: ReserveMatch[] = [];

  for (const reserve of reserves) {
    const beoordeling = await assessAssignment({
      employeeId: reserve.employee.id,
      date,
      duty: dutyContext,
    });
    const fit = preferenceFit(reserve.employee.reservePreference, dutyContext.kinds);

    const basis: ReserveMatch = {
      employeeId: reserve.employee.id,
      employeeNumber: reserve.employee.employeeNumber,
      eligible: beoordeling.hardEligible,
      blockingReasons: beoordeling.blockingReasons,
      // De voorkeur weegt licht mee en pas nadat geschiktheid is bepaald: zij
      // mag een goede aansluiting nooit onder een slechte duwen.
      score: beoordeling.hardEligible
        ? Number((((beoordeling.suitability?.score ?? 0) * 0.85 + fit * 0.15)).toFixed(4))
        : 0,
      factors: beoordeling.suitability?.factors ?? [],
      concerns: beoordeling.suitability?.concerns ?? [],
      preferenceLabel: reservePreferenceLabel(reserve.employee.reservePreference),
      preferenceFit: fit,
      selfServiceSuitable: beoordeling.showToEmployee,
    };

    if (beoordeling.hardEligible) {
      matches.push(basis);
    } else {
      blocked.push(basis);
    }
  }

  return {
    date,
    dutyCode: duty.code,
    matches: matches.sort((a, b) => b.score - a.score),
    blocked,
    consideredReserves: reserves.length,
  };
}

export interface AssignResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly employeeNumber?: string;
}

/**
 * Wijst een openstaande dienst toe aan een reservemedewerker.
 *
 * Drie dingen gebeuren hier bewust in deze volgorde: de dienst wordt
 * voorwaardelijk vastgezet (zodat een tweede planner hem niet ook kan pakken),
 * daarna wordt opnieuw getoetst, en pas dan wordt geschreven. De omgekeerde
 * volgorde — toetsen, dan claimen — laat precies het gaatje open waarin twee
 * planners dezelfde dienst aan twee mensen geven.
 */
export async function assignReserve(input: {
  readonly availableDutyId: string;
  readonly employeeId: string;
  readonly reason: string;
}): Promise<AssignResult> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);

  const available = await prisma.availableDuty.findUnique({
    where: { id: input.availableDutyId },
    select: { id: true, date: true, status: true, duty: { select: DUTY_SELECT } },
  });
  if (!available) {
    return { ok: false, reason: "Onbekende dienst." };
  }
  if (
    available.status !== AvailableDutyStatus.RESERVE_PENDING &&
    available.status !== AvailableDutyStatus.OPEN
  ) {
    return { ok: false, reason: "Deze dienst staat niet meer open." };
  }

  const date = toCalendarDate(available.date);
  const dutyContext = toDutyContext(available.duty);

  // Opnieuw toetsen, met de stand van nu. De lijst waaruit de planner koos, kan
  // inmiddels achterhaald zijn.
  const beoordeling = await assessAssignment({
    employeeId: input.employeeId,
    date,
    duty: dutyContext,
  });
  if (!beoordeling.hardEligible) {
    await recordAudit({
      actor,
      action: "reserve.toewijzing-geweigerd",
      objectType: "AvailableDuty",
      objectId: input.availableDutyId,
      result: "DENIED",
      reason: beoordeling.blockingReasons[0] ?? "Regels laten deze toewijzing niet toe.",
    });
    return {
      ok: false,
      reason:
        "Deze dienst kan niet meer aan deze medewerker worden toegewezen; het rooster is " +
        `inmiddels gewijzigd of de regels laten het niet toe. ${beoordeling.blockingReasons[0] ?? ""}`.trim(),
    };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { employeeNumber: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      // Voorwaardelijk claimen: alleen wanneer de status nog is wat wij zagen.
      // Een tweede planner die tegelijk klikt, raakt hier nul rijen en valt uit.
      const geclaimd = await tx.availableDuty.updateMany({
        where: { id: input.availableDutyId, status: available.status },
        data: {
          status: AvailableDutyStatus.ALLOCATED,
          awardedEmployeeId: input.employeeId,
          awardedAt: new Date(),
          awardRanking: toJson({
            route: "dienstindeling",
            geschiktheid: beoordeling.suitability?.score ?? null,
            bezwaren: beoordeling.suitability?.concerns ?? [],
          }),
        },
      });
      if (geclaimd.count === 0) {
        throw new ConcurrentAssignment();
      }

      await fillOperationallyIn(tx, {
        employeeId: input.employeeId,
        date: available.date,
        dutyId: available.duty.id,
        source: ScheduleSource.RESERVE_FILL,
        assignedByUserId: actor.userId,
        reason: input.reason,
      });

      // De gebeurtenis gaat in dezelfde transactie mee. Slaagt de toewijzing,
      // dan bestaat de melding; faalt zij, dan bestaat geen van beide.
      const ontvanger = await userIdFor(input.employeeId, tx);
      if (ontvanger) {
        await publishInTransaction(tx, {
          eventType: "OperationalAssignmentCreated",
          eventKey: `did-toewijzing|${input.availableDutyId}|${input.employeeId}`,
          payload: {
            employeeUserId: ontvanger,
            date,
            dutyCode: available.duty.code,
            times: `${formatMinuteOfDay(available.duty.startMinute)}–${formatMinuteOfDay(
              available.duty.endMinute,
            )}`,
            scheduledDutyId: input.availableDutyId,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof ConcurrentAssignment) {
      return {
        ok: false,
        reason:
          "Een andere planner heeft deze dienst zojuist toegewezen. Vernieuw het overzicht.",
      };
    }
    throw error;
  }

  await recordAudit({
    actor,
    action: "reserve.toegewezen-door-dienstindeling",
    objectType: "AvailableDuty",
    objectId: input.availableDutyId,
    newValue: {
      personeelsnummer: employee?.employeeNumber,
      dienst: available.duty.code,
      datum: date,
      geschiktheid: beoordeling.suitability?.score ?? null,
      bezwaren: beoordeling.suitability?.concerns ?? [],
      zelfservicegeschikt: beoordeling.showToEmployee,
    },
    reason: input.reason,
  });

  await flushNotifications();

  return { ok: true, reason: "Toegewezen.", employeeNumber: employee?.employeeNumber };
}

class ConcurrentAssignment extends Error {
  constructor() {
    super("Deze dienst is inmiddels door een andere planner toegewezen.");
    this.name = "ConcurrentAssignment";
  }
}
