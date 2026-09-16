import "server-only";
import { type CalendarDate, isoWeekKey, isoWeekday } from "@/domain/time";
import { type RotationParticipant, placementsForOffset } from "@/domain/rotation";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";

/**
 * Roulatielijsten beheren.
 *
 * Per weekdag en standplaats bestaat één lijst. De volgorde ligt vast in
 * `baseIndex`; wat beweegt is de offset. Eén keer per week schuift die één op,
 * waarmee iedereen een plaats opschuift en wie bovenaan stond onderaan komt.
 *
 * ## Waarom de rotatie idempotent is
 *
 * De taak die de offset ophoogt kan twee keer draaien: een herstart, een
 * handmatige aanroep, twee servers. Zonder bescherming zou de lijst dan twee
 * plaatsen opschuiven in één week, en dat is precies het soort onopgemerkte
 * oneerlijkheid dat het systeem hoort uit te sluiten. `offsetWeek` legt vast
 * voor welke week de huidige stand geldt; een tweede aanroep in dezelfde week
 * doet niets.
 */

export interface RotationListView {
  readonly weekday: number;
  readonly depot: string;
  readonly offset: number;
  readonly participants: readonly RotationParticipant[];
}

/** De roulatielijst die bij deze datum en standplaats hoort. */
export async function rotationListFor(
  date: CalendarDate,
  depot: string,
): Promise<RotationListView> {
  const weekday = isoWeekday(date);
  const list = await prisma.rotationList.findUnique({
    where: { weekday_depot: { weekday, depot } },
    select: {
      offset: true,
      entries: {
        orderBy: { baseIndex: "asc" },
        select: {
          baseIndex: true,
          employeeId: true,
          employee: { select: { employeeNumber: true } },
        },
      },
    },
  });

  if (!list) {
    return { weekday, depot, offset: 0, participants: [] };
  }

  return {
    weekday,
    depot,
    offset: list.offset,
    participants: list.entries.map((entry) => ({
      employeeId: entry.employeeId,
      employeeNumber: entry.employee.employeeNumber,
      baseIndex: entry.baseIndex,
    })),
  };
}

/** De volgorde van vandaag, voor het transparantiescherm. */
export async function currentPlacements(date: CalendarDate, depot: string) {
  const list = await rotationListFor(date, depot);
  return {
    weekday: list.weekday,
    offset: list.offset,
    placements: placementsForOffset(list.participants, list.offset),
  };
}

/**
 * Schuift alle lijsten één plaats op voor de opgegeven week.
 *
 * Bedoeld voor een geplande taak (`npm run rotation:advance`). Geeft terug
 * hoeveel lijsten daadwerkelijk zijn verschoven — bij een tweede aanroep in
 * dezelfde week is dat nul.
 */
export async function advanceRotation(reference: CalendarDate): Promise<{
  readonly isoWeek: string;
  readonly advanced: number;
  readonly skipped: number;
}> {
  const week = isoWeekKey(reference);
  const lists = await prisma.rotationList.findMany({
    select: { id: true, weekday: true, depot: true, offset: true, offsetWeek: true },
  });

  let advanced = 0;
  let skipped = 0;

  for (const list of lists) {
    if (list.offsetWeek === week) {
      skipped += 1;
      continue;
    }
    const nextOffset = list.offset + 1;
    await prisma.$transaction([
      prisma.rotationList.update({
        where: { id: list.id },
        data: { offset: nextOffset, offsetWeek: week },
      }),
      prisma.rotationLog.create({
        data: {
          listId: list.id,
          fromOffset: list.offset,
          toOffset: nextOffset,
          isoWeek: week,
        },
      }),
    ]);
    advanced += 1;
  }

  await recordAudit({
    actor: null,
    action: "roulatie.verschoven",
    objectType: "RotationList",
    newValue: { isoWeek: week, verschoven: advanced, overgeslagen: skipped },
  });

  return { isoWeek: week, advanced, skipped };
}

export interface RotationOverviewRow {
  readonly weekday: number;
  readonly depot: string;
  readonly offset: number;
  readonly participants: number;
}

/**
 * Alle roulatielijsten in het kort.
 *
 * Voor Dienstindeling, dat wil kunnen zien welke volgorde er geldt zonder de
 * hele lijst te hoeven doorlopen. Bevat geen personeelsnummers: wie de volgorde
 * zelf nodig heeft, vraagt die op bij een concrete toewijzing, en dan wordt hij
 * ook vastgelegd.
 */
export async function rotationOverview(): Promise<readonly RotationOverviewRow[]> {
  await requirePermission(PERMISSIONS.ASSIGNMENT_READ);

  const lists = await prisma.rotationList.findMany({
    orderBy: [{ depot: "asc" }, { weekday: "asc" }],
    select: {
      weekday: true,
      depot: true,
      offset: true,
      _count: { select: { entries: true } },
    },
  });

  return lists.map((list) => ({
    weekday: list.weekday,
    depot: list.depot,
    offset: list.offset,
    participants: list._count.entries,
  }));
}
