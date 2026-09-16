import "server-only";
import { BaseRosterStatus, WaitlistStatus } from "@/lib/generated/prisma/enums";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";

/**
 * Wachtlijsten voor andere basisroosters.
 *
 * ## De positie
 *
 * Uitsluitend de inschrijfdatum bepaalt de plaats. Er is geen tweede criterium,
 * geen voorrang, geen weging. Daarom staat er ook geen `position`-kolom in de
 * database: een opgeslagen positie kan afwijken van de sortering, en dan is er
 * een tweede waarheid. De positie wordt berekend uit `enrolledAt` op het moment
 * dat iemand ernaar vraagt.
 *
 * Bij gelijke inschrijftijd — technisch mogelijk — beslist het id, zodat de
 * volgorde in elk geval stabiel is en niet per zoekopdracht verspringt.
 */

export interface WaitlistOptionView {
  readonly baseRosterId: string;
  readonly code: string;
  readonly name: string;
  readonly profileLabel: string;
  readonly depot: string;
  readonly enrolled: boolean;
  readonly position: number | null;
  readonly totalWaiting: number;
}

/** De basisroosters waarvoor deze medewerker zich kan inschrijven. */
export async function waitlistOptions(): Promise<readonly WaitlistOptionView[]> {
  const actor = await requirePermission(PERMISSIONS.WAITLIST_MANAGE_OWN);

  const rosters = await prisma.baseRoster.findMany({
    where: { status: BaseRosterStatus.ACTIVE, depot: actor.depot },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      profile: true,
      depot: true,
      waitlistEntries: {
        where: { status: WaitlistStatus.ACTIVE },
        orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
        select: { id: true, employeeId: true },
      },
    },
  });

  return rosters.map((roster) => {
    const index = roster.waitlistEntries.findIndex((entry) => entry.employeeId === actor.employeeId);
    return {
      baseRosterId: roster.id,
      code: roster.code,
      name: roster.name,
      profileLabel: rosterProfileLabel(roster.profile),
      depot: roster.depot,
      enrolled: index >= 0,
      position: index >= 0 ? index + 1 : null,
      totalWaiting: roster.waitlistEntries.length,
    };
  });
}

/** Inschrijven. Opnieuw inschrijven na uitschrijven levert een nieuwe datum op. */
export async function enrol(baseRosterId: string): Promise<{ ok: boolean; reason?: string }> {
  const actor = await requirePermission(PERMISSIONS.WAITLIST_MANAGE_OWN);

  const roster = await prisma.baseRoster.findFirst({
    where: { id: baseRosterId, status: BaseRosterStatus.ACTIVE, depot: actor.depot },
    select: { id: true, code: true },
  });
  if (!roster) {
    return { ok: false, reason: "Dit basisrooster bestaat niet of staat niet open." };
  }

  const existing = await prisma.waitlistEntry.findUnique({
    where: { employeeId_baseRosterId: { employeeId: actor.employeeId, baseRosterId } },
    select: { id: true, status: true },
  });

  if (existing?.status === WaitlistStatus.ACTIVE) {
    return { ok: false, reason: "U staat al op deze wachtlijst." };
  }

  // Een eerdere, ingetrokken inschrijving krijgt een nieuwe inschrijfdatum.
  // Anders zou uitschrijven en opnieuw inschrijven de oude plaats behouden, en
  // dat is niet wat "de positie volgt uit de inschrijfdatum" betekent.
  await prisma.waitlistEntry.upsert({
    where: { employeeId_baseRosterId: { employeeId: actor.employeeId, baseRosterId } },
    create: { employeeId: actor.employeeId, baseRosterId },
    update: { status: WaitlistStatus.ACTIVE, enrolledAt: new Date(), resolvedAt: null },
  });

  await recordAudit({
    actor,
    action: "wachtlijst.ingeschreven",
    objectType: "BaseRoster",
    objectId: baseRosterId,
    newValue: { rooster: roster.code },
  });
  return { ok: true };
}

/** Uitschrijven. */
export async function withdraw(baseRosterId: string): Promise<void> {
  const actor = await requirePermission(PERMISSIONS.WAITLIST_MANAGE_OWN);
  await prisma.waitlistEntry.updateMany({
    where: { employeeId: actor.employeeId, baseRosterId, status: WaitlistStatus.ACTIVE },
    data: { status: WaitlistStatus.WITHDRAWN, resolvedAt: new Date() },
  });
  await recordAudit({
    actor,
    action: "wachtlijst.uitgeschreven",
    objectType: "BaseRoster",
    objectId: baseRosterId,
  });
}

/**
 * De wachtlijst van een basisrooster, voor de planner.
 *
 * Toont personeelsnummers en posities. Namen staan er niet in: voor het
 * beoordelen van een wachtlijst zijn ze niet nodig, en de planner kan ze
 * desgewenst apart opvragen via de identiteitsrepository — waar die inzage
 * wordt gelogd.
 */
export async function waitlistForRoster(baseRosterId: string): Promise<
  readonly { position: number; employeeNumber: string; enrolledAt: Date }[]
> {
  await requirePermission(PERMISSIONS.ROSTER_READ);
  const entries = await prisma.waitlistEntry.findMany({
    where: { baseRosterId, status: WaitlistStatus.ACTIVE },
    orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
    select: { enrolledAt: true, employee: { select: { employeeNumber: true } } },
  });
  return entries.map((entry, index) => ({
    position: index + 1,
    employeeNumber: entry.employee.employeeNumber,
    enrolledAt: entry.enrolledAt,
  }));
}
