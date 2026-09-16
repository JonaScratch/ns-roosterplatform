import "server-only";
import { SwapStatus } from "@/lib/generated/prisma/enums";
import { type CalendarDate, toCalendarDate } from "@/domain/time";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";
import { lookupColleague } from "@/server/data/repositories/identity-repository";

/**
 * Wat het ruilscherm nodig heeft, buiten de ruil zelf om.
 *
 * Apart van `swap-service.ts` gehouden: dat bestand gaat over de vraag of een
 * ruil mag en over het uitvoeren ervan. Dit gaat over het samenstellen van een
 * scherm. Ze scheiden houdt de regels bij elkaar en de weergave erbuiten.
 */

export interface ColleagueView {
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly displayName: string;
}

/**
 * Een collega opzoeken op personeelsnummer.
 *
 * Alleen binnen de eigen standplaats en alleen op volledig nummer; de
 * begrenzing zit in de identiteitsrepository, waar de inzage ook wordt gelogd.
 */
export async function findColleague(employeeNumber: string): Promise<ColleagueView | null> {
  const actor = await requirePermission(PERMISSIONS.COLLEAGUE_LOOKUP);
  return lookupColleague(actor, employeeNumber.trim());
}

export interface ProposalView {
  readonly id: string;
  readonly otherEmployeeNumber: string;
  readonly theirDutyCode: string;
  readonly theirDate: CalendarDate;
  readonly ownDutyCode: string;
  readonly ownDate: CalendarDate;
  readonly status: SwapStatus;
  readonly expiresAt: Date;
  readonly message: string | null;
}

export interface ProposalOverview {
  readonly incoming: readonly ProposalView[];
  readonly outgoing: readonly ProposalView[];
}

/** De ruilvoorstellen van deze medewerker, beide richtingen. */
export async function myProposals(): Promise<ProposalOverview> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);

  const select = {
    id: true,
    status: true,
    expiresAt: true,
    message: true,
    initiatorEmployee: { select: { employeeNumber: true } },
    counterpartyEmployee: { select: { employeeNumber: true } },
    initiatorDuty: { select: { date: true, duty: { select: { code: true } } } },
    counterpartyDuty: { select: { date: true, duty: { select: { code: true } } } },
  } as const;

  const [incoming, outgoing] = await Promise.all([
    prisma.swapProposal.findMany({
      where: { counterpartyEmployeeId: actor.employeeId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select,
    }),
    prisma.swapProposal.findMany({
      where: { initiatorEmployeeId: actor.employeeId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select,
    }),
  ]);

  return {
    // Voor een binnenkomend voorstel is "hun dienst" die van de aanbieder en
    // "uw dienst" de eigen. Bij een uitgaand voorstel precies andersom. Dat
    // omdraaien gebeurt hier één keer, zodat het scherm er niet over hoeft na
    // te denken.
    incoming: incoming.map((row) => ({
      id: row.id,
      otherEmployeeNumber: row.initiatorEmployee.employeeNumber,
      theirDutyCode: row.initiatorDuty.duty?.code ?? "?",
      theirDate: toCalendarDate(row.initiatorDuty.date),
      ownDutyCode: row.counterpartyDuty.duty?.code ?? "?",
      ownDate: toCalendarDate(row.counterpartyDuty.date),
      status: row.status,
      expiresAt: row.expiresAt,
      message: row.message,
    })),
    outgoing: outgoing.map((row) => ({
      id: row.id,
      otherEmployeeNumber: row.counterpartyEmployee.employeeNumber,
      theirDutyCode: row.counterpartyDuty.duty?.code ?? "?",
      theirDate: toCalendarDate(row.counterpartyDuty.date),
      ownDutyCode: row.initiatorDuty.duty?.code ?? "?",
      ownDate: toCalendarDate(row.initiatorDuty.date),
      status: row.status,
      expiresAt: row.expiresAt,
      message: row.message,
    })),
  };
}

export const SWAP_STATUS_LABELS: Record<SwapStatus, string> = {
  PENDING: "In behandeling",
  ACCEPTED: "Geaccepteerd",
  REJECTED: "Afgewezen",
  WITHDRAWN: "Ingetrokken",
  EXPIRED: "Verlopen",
  INVALIDATED: "Ongeldig geworden",
};

/**
 * Eén ruilverzoek, voor de pagina waar een melding naartoe wijst.
 *
 * Alleen de twee betrokkenen kunnen hem opvragen. Voor een derde bestaat het
 * verzoek niet — geen foutmelding die bevestigt dat het er is.
 */
export async function proposalDetail(proposalId: string): Promise<
  | (ProposalView & {
      readonly role: "ONTVANGER" | "AANVRAGER";
      readonly createdAt: Date;
      readonly respondedAt: Date | null;
    })
  | null
> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);

  const row = await prisma.swapProposal.findFirst({
    where: {
      id: proposalId,
      OR: [
        { initiatorEmployeeId: actor.employeeId },
        { counterpartyEmployeeId: actor.employeeId },
      ],
    },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      message: true,
      createdAt: true,
      respondedAt: true,
      initiatorEmployeeId: true,
      initiatorEmployee: { select: { employeeNumber: true } },
      counterpartyEmployee: { select: { employeeNumber: true } },
      initiatorDuty: { select: { date: true, duty: { select: { code: true } } } },
      counterpartyDuty: { select: { date: true, duty: { select: { code: true } } } },
    },
  });
  if (!row) {
    return null;
  }

  const isAanvrager = row.initiatorEmployeeId === actor.employeeId;
  return {
    id: row.id,
    role: isAanvrager ? "AANVRAGER" : "ONTVANGER",
    otherEmployeeNumber: isAanvrager
      ? row.counterpartyEmployee.employeeNumber
      : row.initiatorEmployee.employeeNumber,
    theirDutyCode: (isAanvrager ? row.counterpartyDuty : row.initiatorDuty).duty?.code ?? "?",
    theirDate: toCalendarDate((isAanvrager ? row.counterpartyDuty : row.initiatorDuty).date),
    ownDutyCode: (isAanvrager ? row.initiatorDuty : row.counterpartyDuty).duty?.code ?? "?",
    ownDate: toCalendarDate((isAanvrager ? row.initiatorDuty : row.counterpartyDuty).date),
    status: row.status,
    expiresAt: row.expiresAt,
    message: row.message,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
  };
}
