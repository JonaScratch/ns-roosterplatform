import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { type CalendarDate, toCalendarDate, toDatabaseDate } from "@/domain/time";
import {
  type IsoWeek,
  type RotationAnchor,
  isoWeekOfDate,
  ruleForDate,
  rotationSeries,
} from "@/domain/roster-rotation";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { publishInTransaction, flushNotifications, userIdFor } from "./domain-events";

/**
 * De koppeling tussen een medewerker en zijn rooster.
 *
 * ## Drie soorten plaatsing, en waarom ze uit elkaar blijven
 *
 *  - **Permanent** — iemands structurele basis. Eén tegelijk, punt.
 *  - **Tijdelijk** — een afgebakende periode in een ander rooster. Ligt eróver
 *    heen; de permanente rotatie loopt eronder gewoon door, zodat na afloop
 *    vaststaat op welke regel iemand hoort te staan. Niet op de regel waar hij
 *    vertrok — op de regel waar de tijd hem gebracht heeft.
 *  - **Operationeel** — één dag, één dienst. Woont in `OperationalAssignment`
 *    en hoort hier niet.
 *
 * Wie deze drie door elkaar modelleert, krijgt het niet meer uit elkaar: een
 * tijdelijke plaatsing die de permanente overschrijft, kan na afloop niet meer
 * worden teruggedraaid omdat de basis weg is.
 *
 * ## Waarom er niets wordt overschreven
 *
 * Een plaatsing eindigt door een einddatum en een status, niet door een
 * `UPDATE` die de vorige waarde wist. Anders is de vraag "waar stond deze
 * medewerker in januari" niet meer te beantwoorden.
 */

type Tx = Prisma.TransactionClient;

export interface MembershipView {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly baseRosterCode: string;
  readonly baseRosterName: string;
  readonly lineCount: number;
  readonly anchorRuleIndex: number;
  readonly anchorWeek: IsoWeek;
  readonly validFrom: CalendarDate;
  readonly validUntil: CalendarDate | null;
  readonly placementType: "PERMANENT" | "TEMPORARY";
  readonly status: string;
  readonly reason: string | null;
}

// ── Lezen ────────────────────────────────────────────────────────────────────

/** De plaatsingen van één medewerker die op deze datum gelden. */
export async function membershipsOn(
  employeeId: string,
  date: CalendarDate,
  client: Tx | typeof prisma = prisma,
) {
  const dag = toDatabaseDate(date);
  return client.rosterMembership.findMany({
    where: {
      employeeId,
      status: "ACTIVE",
      validFrom: { lte: dag },
      OR: [{ validUntil: null }, { validUntil: { gte: dag } }],
    },
    include: { baseRoster: { select: { code: true, name: true, profile: true, cycleWeeks: true } } },
    orderBy: { placementType: "asc" },
  });
}

/**
 * De plaatsing die op deze dag telt.
 *
 * Een tijdelijke plaatsing wint van de permanente — dat is precies waarvoor hij
 * bestaat. Zijn er twee tijdelijke, dan is er iets mis; dat mag niet kunnen en
 * wordt bij het aanmaken tegengehouden.
 */
export async function effectiveMembershipOn(
  employeeId: string,
  date: CalendarDate,
  client: Tx | typeof prisma = prisma,
) {
  const geldig = await membershipsOn(employeeId, date, client);
  return (
    geldig.find((plaatsing) => plaatsing.placementType === "TEMPORARY") ??
    geldig.find((plaatsing) => plaatsing.placementType === "PERMANENT") ??
    null
  );
}

export function anchorOf(membership: {
  anchorRuleIndex: number;
  anchorWeek: string;
  lineCount: number;
}): RotationAnchor {
  return {
    anchorRuleIndex: membership.anchorRuleIndex,
    anchorWeek: membership.anchorWeek,
    lineCount: membership.lineCount,
  };
}

/** De roosterregel van deze medewerker op deze dag, of niets. */
export async function ruleOn(
  employeeId: string,
  date: CalendarDate,
): Promise<{ readonly membership: MembershipView; readonly ruleIndex: number } | null> {
  const plaatsing = await effectiveMembershipOn(employeeId, date);
  if (!plaatsing) {
    return null;
  }
  const medewerker = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employeeNumber: true },
  });
  return {
    membership: toView(plaatsing, medewerker?.employeeNumber ?? ""),
    ruleIndex: ruleForDate(anchorOf(plaatsing), date),
  };
}

function toView(
  row: {
    id: string;
    employeeId: string;
    lineCount: number;
    anchorRuleIndex: number;
    anchorWeek: string;
    validFrom: Date;
    validUntil: Date | null;
    placementType: string;
    status: string;
    reason: string | null;
    baseRoster: { code: string; name: string };
  },
  employeeNumber: string,
): MembershipView {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeNumber,
    baseRosterCode: row.baseRoster.code,
    baseRosterName: row.baseRoster.name,
    lineCount: row.lineCount,
    anchorRuleIndex: row.anchorRuleIndex,
    anchorWeek: row.anchorWeek,
    validFrom: toCalendarDate(row.validFrom),
    validUntil: row.validUntil ? toCalendarDate(row.validUntil) : null,
    placementType: row.placementType as "PERMANENT" | "TEMPORARY",
    status: row.status,
    reason: row.reason,
  };
}

/** Alle plaatsingen van een medewerker, historie inbegrepen. */
export async function membershipHistory(employeeId: string): Promise<readonly MembershipView[]> {
  await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const [rows, employee] = await Promise.all([
    prisma.rosterMembership.findMany({
      where: { employeeId },
      include: { baseRoster: { select: { code: true, name: true } } },
      orderBy: [{ validFrom: "desc" }],
    }),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { employeeNumber: true } }),
  ]);
  return rows.map((row) => toView(row, employee?.employeeNumber ?? ""));
}

/** Wie staat er op welke regel van dit rooster, in deze week? */
export async function rosterOccupancy(
  baseRosterCode: string,
  week: IsoWeek,
): Promise<
  readonly {
    readonly ruleIndex: number;
    readonly employeeNumber: string | null;
    readonly placementType: string | null;
  }[]
> {
  await requirePermission(PERMISSIONS.ROSTER_READ);

  const roster = await prisma.baseRoster.findUnique({
    where: { code: baseRosterCode },
    include: { lines: { select: { lineNumber: true }, orderBy: { lineNumber: "asc" } } },
  });
  if (!roster) {
    return [];
  }

  const maandag = mondayOf(week);
  const plaatsingen = await prisma.rosterMembership.findMany({
    where: {
      baseRosterId: roster.id,
      status: "ACTIVE",
      validFrom: { lte: toDatabaseDate(maandag) },
      OR: [{ validUntil: null }, { validUntil: { gte: toDatabaseDate(maandag) } }],
    },
    include: { employee: { select: { employeeNumber: true } } },
  });

  const perRegel = new Map<number, { employeeNumber: string; placementType: string }>();
  for (const plaatsing of plaatsingen) {
    const regel = ruleForDate(anchorOf(plaatsing), maandag);
    perRegel.set(regel, {
      employeeNumber: plaatsing.employee.employeeNumber,
      placementType: plaatsing.placementType,
    });
  }

  return roster.lines.map((line) => ({
    ruleIndex: line.lineNumber,
    employeeNumber: perRegel.get(line.lineNumber)?.employeeNumber ?? null,
    placementType: perRegel.get(line.lineNumber)?.placementType ?? null,
  }));
}

function mondayOf(week: IsoWeek): CalendarDate {
  // Hergebruikt de rotatiemodule zodat er één definitie van "de maandag van
  // deze week" bestaat.
  return rotationSeries({ anchorRuleIndex: 1, anchorWeek: week, lineCount: 1 }, week, 1)[0].monday;
}

// ── Schrijven ────────────────────────────────────────────────────────────────

export interface PlacementResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly membershipId?: string;
}

export interface PermanentPlacementInput {
  readonly employeeId: string;
  readonly baseRosterCode: string;
  readonly anchorRuleIndex: number;
  /** De week waarin de plaatsing ingaat; tevens de ankerweek. */
  readonly effectiveFromWeek: IsoWeek;
  readonly reason?: string;
  readonly waitlistEntryId?: string | null;
}

/**
 * Een medewerker permanent in een rooster plaatsen.
 *
 * Een lopende permanente plaatsing wordt beëindigd op de dag vóór de nieuwe
 * ingaat — niet verwijderd. De historie blijft daardoor kloppen: de vraag "waar
 * stond deze medewerker vorig jaar" houdt een antwoord.
 */
export async function placePermanently(input: PermanentPlacementInput): Promise<PlacementResult> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_MANAGE);
  return placePermanentlyCore(actor, input);
}

export async function placePermanentlyCore(
  actor: Actor | null,
  input: PermanentPlacementInput,
): Promise<PlacementResult> {
  const controle = await controleerDoelrooster(input.baseRosterCode, input.anchorRuleIndex);
  if (!controle.ok) {
    return controle;
  }
  const roster = controle.roster;

  const medewerker = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, depot: true, employeeNumber: true },
  });
  if (!medewerker) {
    return { ok: false, reason: "Onbekende medewerker." };
  }
  if (medewerker.depot !== roster.depot) {
    return {
      ok: false,
      reason:
        `Deze medewerker hoort bij standplaats ${medewerker.depot} en het rooster bij ` +
        `${roster.depot}. Een plaatsing over standplaatsen heen is niet ingericht.`,
    };
  }

  const ingang = mondayOf(input.effectiveFromWeek);
  const dagVoorIngang = new Date(new Date(`${ingang}T12:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  const nieuweId = await prisma.$transaction(async (tx) => {
    // De lopende permanente plaatsing eindigt; hij wordt niet gewist.
    await tx.rosterMembership.updateMany({
      where: {
        employeeId: input.employeeId,
        placementType: "PERMANENT",
        status: "ACTIVE",
        OR: [{ validUntil: null }, { validUntil: { gte: toDatabaseDate(ingang) } }],
      },
      data: {
        validUntil: toDatabaseDate(dagVoorIngang),
        status: "ENDED",
        endedAt: new Date(),
        endedByUserId: actor?.userId ?? null,
      },
    });

    const membership = await tx.rosterMembership.create({
      data: {
        employeeId: input.employeeId,
        locationCode: medewerker.depot,
        baseRosterId: roster.id,
        lineCount: roster.lines.length,
        anchorRuleIndex: input.anchorRuleIndex,
        anchorWeek: input.effectiveFromWeek,
        validFrom: toDatabaseDate(ingang),
        validUntil: null,
        placementType: "PERMANENT",
        status: "ACTIVE",
        reason: input.reason ?? null,
        waitlistEntryId: input.waitlistEntryId ?? null,
        createdByUserId: actor?.userId ?? null,
      },
      select: { id: true },
    });

    const gebruiker = await userIdFor(input.employeeId, tx);
    if (gebruiker) {
      await publishInTransaction(tx, {
        eventType: "PermanentPlacementCreated",
        eventKey: `plaatsing-permanent|${membership.id}`,
        payload: {
          employeeUserId: gebruiker,
          rosterCode: roster.code,
          rosterName: roster.name,
          fromDate: ingang,
          ruleIndex: input.anchorRuleIndex,
          membershipId: membership.id,
        },
      });
    }

    return membership.id;
  });

  await recordAudit({
    actor,
    action: "roosterplaatsing.permanent",
    objectType: "RosterMembership",
    objectId: nieuweId,
    newValue: {
      personeelsnummer: medewerker.employeeNumber,
      rooster: roster.code,
      ankerregel: input.anchorRuleIndex,
      ankerweek: input.effectiveFromWeek,
      ingang,
    },
    reason: input.reason,
  });
  await flushNotifications();

  return { ok: true, reason: "Permanente plaatsing vastgelegd.", membershipId: nieuweId };
}

export interface TemporaryPlacementInput {
  readonly employeeId: string;
  readonly baseRosterCode: string;
  readonly anchorRuleIndex: number;
  readonly fromWeek: IsoWeek;
  /** De laatste week van de tijdelijke plaatsing. */
  readonly untilWeek: IsoWeek;
  readonly reason?: string;
}

/**
 * Een medewerker tijdelijk in een ander rooster plaatsen.
 *
 * De permanente plaatsing blijft ongemoeid en loopt eronder door. Na de
 * einddatum valt de projectie er vanzelf op terug, op de regel waar de rotatie
 * inmiddels is aangekomen.
 */
export async function placeTemporarily(input: TemporaryPlacementInput): Promise<PlacementResult> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);
  return placeTemporarilyCore(actor, input);
}

export async function placeTemporarilyCore(
  actor: Actor | null,
  input: TemporaryPlacementInput,
): Promise<PlacementResult> {
  const controle = await controleerDoelrooster(input.baseRosterCode, input.anchorRuleIndex);
  if (!controle.ok) {
    return controle;
  }
  const roster = controle.roster;

  const van = mondayOf(input.fromWeek);
  const laatsteMaandag = mondayOf(input.untilWeek);
  const tot = new Date(new Date(`${laatsteMaandag}T12:00:00Z`).getTime() + 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  if (tot < van) {
    return { ok: false, reason: "De einddatum ligt vóór de begindatum." };
  }

  const medewerker = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, depot: true, employeeNumber: true },
  });
  if (!medewerker) {
    return { ok: false, reason: "Onbekende medewerker." };
  }
  if (medewerker.depot !== roster.depot) {
    return {
      ok: false,
      reason: `Het rooster hoort bij standplaats ${roster.depot} en de medewerker bij ${medewerker.depot}.`,
    };
  }

  // Overlappende tijdelijke plaatsingen bestaan niet. Twee tegelijk zou
  // betekenen dat niemand kan zeggen welk rooster telt.
  const overlappend = await prisma.rosterMembership.findFirst({
    where: {
      employeeId: input.employeeId,
      placementType: "TEMPORARY",
      status: "ACTIVE",
      validFrom: { lte: toDatabaseDate(tot) },
      OR: [{ validUntil: null }, { validUntil: { gte: toDatabaseDate(van) } }],
    },
    include: { baseRoster: { select: { code: true } } },
  });
  if (overlappend) {
    return {
      ok: false,
      reason:
        `Er loopt al een tijdelijke plaatsing in ${overlappend.baseRoster.code} van ` +
        `${toCalendarDate(overlappend.validFrom)} tot ` +
        `${overlappend.validUntil ? toCalendarDate(overlappend.validUntil) : "onbepaald"}. ` +
        "Twee tijdelijke plaatsingen tegelijk zijn niet toegestaan.",
    };
  }

  const basis = await prisma.rosterMembership.findFirst({
    where: { employeeId: input.employeeId, placementType: "PERMANENT", status: "ACTIVE" },
    select: { id: true },
  });

  const nieuweId = await prisma.$transaction(async (tx) => {
    const membership = await tx.rosterMembership.create({
      data: {
        employeeId: input.employeeId,
        locationCode: medewerker.depot,
        baseRosterId: roster.id,
        lineCount: roster.lines.length,
        anchorRuleIndex: input.anchorRuleIndex,
        anchorWeek: input.fromWeek,
        validFrom: toDatabaseDate(van),
        validUntil: toDatabaseDate(tot),
        placementType: "TEMPORARY",
        status: "ACTIVE",
        basePlacementId: basis?.id ?? null,
        reason: input.reason ?? null,
        createdByUserId: actor?.userId ?? null,
      },
      select: { id: true },
    });

    const gebruiker = await userIdFor(input.employeeId, tx);
    if (gebruiker) {
      await publishInTransaction(tx, {
        eventType: "TemporaryPlacementCreated",
        eventKey: `plaatsing-tijdelijk|${membership.id}`,
        payload: {
          employeeUserId: gebruiker,
          rosterCode: roster.code,
          rosterName: roster.name,
          fromDate: van,
          untilDate: tot,
          membershipId: membership.id,
        },
      });
    }
    return membership.id;
  });

  await recordAudit({
    actor,
    action: "roosterplaatsing.tijdelijk",
    objectType: "RosterMembership",
    objectId: nieuweId,
    newValue: {
      personeelsnummer: medewerker.employeeNumber,
      rooster: roster.code,
      ankerregel: input.anchorRuleIndex,
      van,
      tot,
    },
    reason: input.reason,
  });
  await flushNotifications();

  return { ok: true, reason: "Tijdelijke plaatsing vastgelegd.", membershipId: nieuweId };
}

/** Een tijdelijke plaatsing vroegtijdig beëindigen. */
export async function endTemporaryPlacement(
  membershipId: string,
  reason: string,
): Promise<PlacementResult> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);

  const plaatsing = await prisma.rosterMembership.findUnique({
    where: { id: membershipId },
    include: { baseRoster: { select: { code: true } } },
  });
  if (!plaatsing || plaatsing.placementType !== "TEMPORARY") {
    return { ok: false, reason: "Deze tijdelijke plaatsing bestaat niet." };
  }
  if (plaatsing.status !== "ACTIVE") {
    return { ok: false, reason: "Deze plaatsing is al beëindigd." };
  }

  const vandaag = toCalendarDate(new Date());
  await prisma.$transaction(async (tx) => {
    const bijgewerkt = await tx.rosterMembership.updateMany({
      where: { id: membershipId, status: "ACTIVE" },
      data: {
        status: "ENDED",
        validUntil: toDatabaseDate(vandaag),
        endedAt: new Date(),
        endedByUserId: actor.userId,
      },
    });
    if (bijgewerkt.count === 0) {
      throw new Error("Deze plaatsing is inmiddels door iemand anders beëindigd.");
    }

    const gebruiker = await userIdFor(plaatsing.employeeId, tx);
    if (gebruiker) {
      await publishInTransaction(tx, {
        eventType: "TemporaryPlacementEnded",
        eventKey: `plaatsing-tijdelijk-einde|${membershipId}`,
        payload: {
          employeeUserId: gebruiker,
          rosterCode: plaatsing.baseRoster.code,
          endDate: vandaag,
          membershipId,
        },
      });
    }
  });

  await recordAudit({
    actor,
    action: "roosterplaatsing.tijdelijk-beeindigd",
    objectType: "RosterMembership",
    objectId: membershipId,
    oldValue: { tot: plaatsing.validUntil ? toCalendarDate(plaatsing.validUntil) : null },
    newValue: { tot: vandaag },
    reason,
  });
  await flushNotifications();

  return { ok: true, reason: "De tijdelijke plaatsing is beëindigd." };
}

/** Controleert of het doelrooster bestaat, actief is en die regel heeft. */
async function controleerDoelrooster(
  baseRosterCode: string,
  anchorRuleIndex: number,
): Promise<
  | { ok: false; reason: string }
  | {
      ok: true;
      reason: string;
      roster: { id: string; code: string; name: string; depot: string; lines: { lineNumber: number }[] };
    }
> {
  const roster = await prisma.baseRoster.findUnique({
    where: { code: baseRosterCode },
    include: { lines: { select: { lineNumber: true }, orderBy: { lineNumber: "asc" } } },
  });
  if (!roster) {
    return { ok: false, reason: `Rooster ${baseRosterCode} bestaat niet.` };
  }
  if (roster.status === "ARCHIVED") {
    return { ok: false, reason: `Rooster ${baseRosterCode} is gearchiveerd.` };
  }
  if (roster.lines.length === 0) {
    return {
      ok: false,
      reason: `Rooster ${baseRosterCode} heeft geen regels; er valt niemand op te plaatsen.`,
    };
  }
  if (!roster.lines.some((line) => line.lineNumber === anchorRuleIndex)) {
    return {
      ok: false,
      reason:
        `Regel ${anchorRuleIndex} bestaat niet in ${baseRosterCode}; dat rooster heeft ` +
        `${roster.lines.length} regels.`,
    };
  }
  return { ok: true, reason: "", roster };
}

/** De weken die deze medewerker vanaf nu doorloopt. Voor het dashboard. */
export async function upcomingWeeks(
  employeeId: string,
  weeks = 12,
  from: CalendarDate = toCalendarDate(new Date()),
): Promise<
  readonly {
    readonly week: IsoWeek;
    readonly monday: CalendarDate;
    readonly ruleIndex: number;
    readonly rosterCode: string;
    readonly temporary: boolean;
  }[]
> {
  const reeks: {
    week: IsoWeek;
    monday: CalendarDate;
    ruleIndex: number;
    rosterCode: string;
    temporary: boolean;
  }[] = [];

  const weken = rotationSeries(
    { anchorRuleIndex: 1, anchorWeek: isoWeekOfDate(from), lineCount: 1 },
    isoWeekOfDate(from),
    weeks,
  );

  for (const week of weken) {
    const plaatsing = await effectiveMembershipOn(employeeId, week.monday);
    if (!plaatsing) {
      continue;
    }
    reeks.push({
      week: week.week,
      monday: week.monday,
      ruleIndex: ruleForDate(anchorOf(plaatsing), week.monday),
      rosterCode: plaatsing.baseRoster.code,
      temporary: plaatsing.placementType === "TEMPORARY",
    });
  }
  return reeks;
}
