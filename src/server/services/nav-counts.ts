import "server-only";
import { isInReserveRoster } from "./preferences-service";
import { AvailableDutyStatus, SwapStatus } from "@/lib/generated/prisma/enums";
import { toCalendarDate, toDatabaseDate } from "@/domain/time";
import { currentActor } from "@/server/auth/session";
import { actorHasPermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";
import type { NavCounts } from "@/components/layout/navigation";

/**
 * De aantallen achter de menu-items.
 *
 * Bewust apart van de dashboardservices: een pil in de zijbalk mag nooit een
 * zwaar overzicht op gang brengen, en hij moet blijven werken op een pagina die
 * dat overzicht helemaal niet nodig heeft.
 *
 * De aantallen zijn tellingen zonder persoonsgegevens. Ze respecteren de
 * rechten van de gebruiker: wie het onderdeel niet mag zien, krijgt ook het
 * getal niet — anders verraadt een pil hoeveel er speelt in een omgeving waar
 * hij niet mag komen.
 */

export async function employeeNavCounts(): Promise<NavCounts> {
  const actor = await currentActor();
  if (!actor) {
    return {};
  }

  const today = toDatabaseDate(toCalendarDate(new Date()));

  const [available, swaps, ongelezen, reserve] = await Promise.all([
    actorHasPermission(actor, PERMISSIONS.AVAILABLE_DUTY_READ)
      ? prisma.availableDuty.count({
          where: {
            status: AvailableDutyStatus.OPEN,
            date: { gte: today },
            closesAt: { gt: new Date() },
            duty: { depot: actor.depot },
          },
        })
      : Promise.resolve(0),
    actorHasPermission(actor, PERMISSIONS.SWAP_RESPOND)
      ? prisma.swapProposal.count({
          where: {
            counterpartyEmployeeId: actor.employeeId,
            status: SwapStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
        })
      : Promise.resolve(0),
    // De echte tellerstand van de meldingen. Eén index op ontvanger en
    // leesmoment; geen joins per paginabezoek.
    prisma.notification.count({ where: { recipientUserId: actor.userId, readAt: null } }),
    // Bepaalt of "Reservevoorkeur" in het menu hoort te staan.
    isInReserveRoster(actor.employeeId),
  ]);

  return {
    // Dit is het aantal open diensten op de standplaats, niet het aantal
    // waarvoor deze medewerker geschikt is: dat laatste vraagt een volledige
    // toets per dienst en hoort niet in een menu-teller.
    availableDuties: available,
    swapRequests: swaps,
    messages: ongelezen,
    inReserveRoster: reserve,
  };
}

export async function assignmentNavCounts(): Promise<NavCounts> {
  const actor = await currentActor();
  if (!actor || !actorHasPermission(actor, PERMISSIONS.ASSIGNMENT_READ)) {
    return {};
  }

  const today = toDatabaseDate(toCalendarDate(new Date()));
  const [open, swaps, caoDagen] = await Promise.all([
    prisma.availableDuty.count({
      where: {
        status: { in: [AvailableDutyStatus.RESERVE_PENDING, AvailableDutyStatus.OPEN] },
        date: { gte: today },
      },
    }),
    prisma.swapProposal.count({ where: { status: SwapStatus.PENDING } }),
    // Alleen de eigen standplaats: een pil die aanvragen van elders meetelt,
    // stuurt iemand naar een scherm waar hij ze niet ziet staan.
    prisma.caoDayRequest.count({
      where: { status: "REQUESTED", location: { code: actor.depot } },
    }),
  ]);

  return { openDuties: open, swapRequests: swaps, caoDayRequests: caoDagen };
}
