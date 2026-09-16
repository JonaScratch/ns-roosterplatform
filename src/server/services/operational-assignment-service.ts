import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { RosterPositionType, ScheduleSource } from "@/lib/generated/prisma/enums";
import { isAllowedInReserveBase } from "@/domain/roster-structure";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * De operationele laag bovenop het basisrooster.
 *
 * ## Waarom dit een laag is en geen overschrijving
 *
 * Een reservemedewerker die op dinsdag een dienst krijgt, houdt een reservedag.
 * Dat klinkt als een formaliteit, maar het is het verschil tussen twee
 * datamodellen. Wordt het RES-slot overschreven met de dienst, dan is de
 * reservedag weg: bij het intrekken van de dienst blijft er een dienstdag
 * zonder dienst over, de teller reservedagen klopt niet meer, en het
 * basisrooster is stilletjes veranderd door een operationele beslissing van één
 * dag.
 *
 * Daarom ligt de invulling erbovenop. `underlyingSlotType` bewaart wat eronder
 * zat; verwijderen zet dat terug. Het basisrooster is daarmee wat het hoort te
 * zijn: de afspraak, niet de dagelijkse werkelijkheid.
 *
 * ## Wat deze laag niet mag
 *
 * De invulling omzeilt de rules engine niet. Wie hier een dienst neerzet, heeft
 * hem elders al laten valideren; deze functies schrijven alleen weg. Ze staan
 * bewust dicht bij de database en ver van elk oordeel over wat mag.
 */

type Tx = Prisma.TransactionClient;

export interface OperationalFill {
  readonly employeeId: string;
  /** De kalenderdag, als Date op middernacht — zoals `ScheduledDuty.date`. */
  readonly date: Date;
  readonly dutyId: string;
  readonly source?: ScheduleSource;
  readonly assignedByUserId?: string | null;
  readonly reason?: string | null;
}

/**
 * Legt een operationele invulling vast binnen een lopende transactie.
 *
 * Levert het slottype op dat eronder lag, zodat de aanroeper het kan
 * verantwoorden.
 */
export async function fillOperationallyIn(tx: Tx, fill: OperationalFill): Promise<string> {
  const slot = await tx.scheduledDuty.findUnique({
    where: { employeeId_date: { employeeId: fill.employeeId, date: fill.date } },
    select: { id: true, positionType: true, dutyId: true, operationalAssignment: true },
  });
  if (!slot) {
    throw new Error("Er is voor deze medewerker en dag geen roosterdag om op te vullen.");
  }
  if (slot.operationalAssignment) {
    throw new Error(
      "Deze dag heeft al een operationele invulling. Trek die eerst in; twee lagen " +
        "over elkaar heen maken niet meer te herleiden wat eronder lag.",
    );
  }
  if (slot.positionType === RosterPositionType.DUTY) {
    // Een dienstdag heeft geen onderliggend anker om te bewaren. Zo'n wijziging
    // hoort via de gewone roosterweg te lopen, niet via deze laag.
    throw new Error(
      "Op een dienstdag hoort geen operationele laag. Wijzig de dienst zelf, of " +
        "geef de dienst eerst vrij.",
    );
  }

  await tx.operationalAssignment.create({
    data: {
      scheduledDutyId: slot.id,
      dutyId: fill.dutyId,
      underlyingSlotType: slot.positionType,
      assignedByUserId: fill.assignedByUserId ?? null,
      reason: fill.reason ?? null,
    },
  });
  await tx.scheduledDuty.update({
    where: { id: slot.id },
    data: {
      positionType: RosterPositionType.DUTY,
      dutyId: fill.dutyId,
      source: fill.source ?? ScheduleSource.RESERVE_FILL,
    },
  });

  return slot.positionType;
}

/**
 * Trekt een operationele invulling in en zet het onderliggende slot terug.
 *
 * Dit is de reden dat de laag bestaat: na intrekken staat er weer precies wat
 * het basisrooster zei, zonder dat iemand hoeft te weten wát dat was.
 */
export async function withdrawOperationallyIn(
  tx: Tx,
  scheduledDutyId: string,
): Promise<{ readonly restored: string } | null> {
  const assignment = await tx.operationalAssignment.findUnique({
    where: { scheduledDutyId },
  });
  if (!assignment) {
    return null;
  }

  await tx.operationalAssignment.delete({ where: { scheduledDutyId } });
  await tx.scheduledDuty.update({
    where: { id: scheduledDutyId },
    data: {
      positionType: assignment.underlyingSlotType as RosterPositionType,
      dutyId: null,
      source: ScheduleSource.BASE,
    },
  });

  return { restored: assignment.underlyingSlotType };
}

/** Trekt een invulling in, met rechtencontrole en auditregel. */
export async function withdrawOperational(scheduledDutyId: string, reason: string) {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);
  const result = await prisma.$transaction((tx) => withdrawOperationallyIn(tx, scheduledDutyId));

  if (!result) {
    return null;
  }
  await recordAudit({
    actor,
    action: "operationele-invulling.ingetrokken",
    objectType: "ScheduledDuty",
    objectId: scheduledDutyId,
    newValue: { hersteld: result.restored },
    reason,
  });
  return result;
}

/** De operationele invullingen op een dag, met wat eronder ligt. */
export async function operationalFillsOn(date: Date) {
  await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  return prisma.operationalAssignment.findMany({
    where: { scheduledDuty: { date } },
    include: {
      duty: { select: { code: true } },
      scheduledDuty: { select: { id: true, employee: { select: { employeeNumber: true } } } },
    },
  });
}

/**
 * Klopt het basisreserverooster: staat er onder elke laag een toegestaan slot?
 *
 * Een controle die je normaal niet nodig hebt en juist daarom bestaat. Zou er
 * ooit een dienstnummer rechtstreeks in een reservelijn belanden, dan is dat
 * hier zichtbaar in plaats van pas wanneer de reservecapaciteit onverklaarbaar
 * blijkt te zijn opgedroogd.
 */
export async function reserveBaseIntegrity(locationCode: string): Promise<{
  readonly checked: number;
  readonly offending: readonly { readonly roster: string; readonly line: number; readonly slot: string }[];
}> {
  const rosters = await prisma.baseRoster.findMany({
    where: { depot: locationCode, profile: "RESERVE" },
    include: { lines: { include: { days: true } } },
  });

  const offending: { roster: string; line: number; slot: string }[] = [];
  let checked = 0;
  for (const roster of rosters) {
    for (const line of roster.lines) {
      for (const day of line.days) {
        checked += 1;
        if (!isAllowedInReserveBase(day.positionType)) {
          offending.push({
            roster: roster.code,
            line: line.lineNumber,
            slot: day.dutyCode ? `${day.positionType} ${day.dutyCode}` : day.positionType,
          });
        }
      }
    }
  }
  return { checked, offending };
}
