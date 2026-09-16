import "server-only";
import type { BaselineSlot, RosterChangeType } from "@/domain/roster-structure";
import { isStructuralAnchor } from "@/domain/roster-structure";
import { recordAudit, recordAuditStrict } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import type { Actor } from "@/server/auth/session";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * Roosterperiodes en de vastlegging van hun structuur.
 *
 * ## Waarom een periode een eigen begrip is
 *
 * Tot nu toe was een rooster een verzameling lijnen zonder tijdvak: hij gold
 * gewoon. Dat werkt zolang er één rooster is. Zodra een dienstregelingjaar, een
 * wijzigingsblad en een volgende versie naast elkaar bestaan, moet van elke
 * plaatsing vaststaan bij welke ronde hij hoort — anders is niet te bepalen
 * tegen welke structuur je hem toetst.
 *
 * ## Wat vastleggen betekent
 *
 * Bij het vaststellen van een jaarrooster wordt de structuur gekopieerd naar
 * `RosterStructureBaselineSlot`. Niet als verwijzing maar als afdruk: de lijnen
 * zelf blijven bewerkbaar en zouden anders stilzwijgend de maatstaf verplaatsen
 * waartegen ze gemeten worden. Een baseline die met zijn onderwerp meebeweegt,
 * bewijst niets.
 *
 * Er is geen functie om een vastgelegde baseline te wijzigen of te
 * ontgrendelen. Dat is geen omissie: de weg terug is een nieuwe
 * dienstregelingronde, en die legt zijn eigen baseline vast.
 */

/** Genoeg van een Prisma-client om dit werk te doen — de app-client of die van een script. */
export type PrismaLike = Pick<
  PrismaClient,
  "rosterPeriod" | "stationLocation" | "baseRoster" | "rosterStructureBaselineSlot" | "$transaction"
>;

export interface PeriodInput {
  readonly locationCode: string;
  readonly timetableId: string;
  readonly year: number;
  readonly changeType: RosterChangeType;
  readonly validFrom: Date;
  readonly validUntil?: Date | null;
  /** Bij een wijzigingsblad: de periode waarvan de structuur wordt overgenomen. */
  readonly baseVersionId?: string | null;
  readonly dutyPackageId?: string | null;
}

export async function createPeriod(input: PeriodInput) {
  const actor = await requirePermission(PERMISSIONS.ROSTER_MANAGE);
  return createPeriodCore(prisma, input, actor);
}

/**
 * Het werk zelf, zonder rechtencontrole.
 *
 * Bestaat zodat een verificatiescript dezelfde code kan draaien als de
 * applicatie. Een script dat zijn eigen variant schrijft, bewijst zijn eigen
 * variant — en precies daar zit het soort verschil dat niemand opmerkt.
 */
export async function createPeriodCore(
  client: PrismaLike,
  input: PeriodInput,
  actor: Actor | null,
) {
  const location = await client.stationLocation.findUnique({
    where: { code: input.locationCode },
  });
  if (!location) {
    throw new Error(`Standplaats ${input.locationCode} bestaat niet.`);
  }

  if (input.changeType === "AMENDMENT") {
    if (!input.baseVersionId) {
      throw new Error(
        "Een wijzigingsblad hoort bij een vastgestelde periode. Zonder die " +
          "koppeling is er geen structuur om tegen te toetsen.",
      );
    }
    const basis = await client.rosterPeriod.findUnique({ where: { id: input.baseVersionId } });
    if (!basis) {
      throw new Error("De opgegeven basisperiode bestaat niet.");
    }
    if (basis.structureState !== "STRUCTURE_LOCKED") {
      // Een wijzigingsblad op een nog bewerkbare structuur zou ankers
      // vergrendelen die nog niet zijn vastgesteld.
      throw new Error(
        `De structuur van ${basis.label} is nog niet vastgelegd. Leg die eerst vast; ` +
          "pas daarna kan er een wijzigingsblad op volgen.",
      );
    }
  }

  const laatste = await client.rosterPeriod.findFirst({
    where: { locationId: location.id, timetableId: input.timetableId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (laatste?.version ?? 0) + 1;
  const soort = input.changeType === "AMENDMENT" ? "WB" : "DR";
  const label = `${location.code}-${soort}${input.timetableId}-V${version}`;

  const period = await client.rosterPeriod.create({
    data: {
      locationId: location.id,
      timetableId: input.timetableId,
      year: input.year,
      changeType: input.changeType,
      version,
      label,
      baseVersionId: input.baseVersionId ?? null,
      dutyPackageId: input.dutyPackageId ?? null,
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
      createdByUserId: actor?.userId ?? null,
    },
  });

  await recordAudit({
    actor,
    action: "roosterperiode.aangemaakt",
    objectType: "RosterPeriod",
    objectId: period.id,
    newValue: {
      label,
      standplaats: location.code,
      dienstregeling: input.timetableId,
      soort: input.changeType,
      geldigVan: input.validFrom.toISOString(),
    },
  });

  return period;
}

export interface SealResult {
  readonly slots: number;
  readonly anchors: number;
  readonly sealedAt: Date;
  readonly rosters: readonly string[];
}

/**
 * Legt de structuur van deze periode vast.
 *
 * Vanaf dat moment liggen rust-, vrije-, compensatie- en reservedagen vast en
 * mag een wijzigingsblad ze niet meer verplaatsen. Dienstnummers blijven vrij.
 *
 * De auditregel gaat in dezelfde transactie mee. Een vastlegging zonder spoor
 * is bij deze handeling erger dan geen vastlegging: hij bepaalt vanaf dat
 * moment wat een heel jaar lang niet meer mag wijzigen.
 */
export async function sealBaseline(periodId: string): Promise<SealResult> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_MANAGE);
  return sealBaselineCore(prisma, periodId, actor);
}

/** Het vastleggen zelf, zonder rechtencontrole. Zie `createPeriodCore`. */
export async function sealBaselineCore(
  client: PrismaLike,
  periodId: string,
  actor: Actor | null,
): Promise<SealResult> {
  const period = await client.rosterPeriod.findUnique({
    where: { id: periodId },
    include: { location: true },
  });
  if (!period) {
    throw new Error("Deze roosterperiode bestaat niet.");
  }
  if (period.structureState === "STRUCTURE_LOCKED") {
    throw new Error(
      `De structuur van ${period.label} is al vastgelegd op ` +
        `${period.baselineSealedAt?.toISOString() ?? "onbekend moment"}. Een vastgelegde ` +
        "baseline wordt niet overschreven.",
    );
  }

  const rosters = await client.baseRoster.findMany({
    where: { depot: period.location.code },
    include: { lines: { include: { days: true } } },
  });

  const slots = rosters.flatMap((roster) =>
    roster.lines.flatMap((line) =>
      line.days.map((day) => ({
        periodId: period.id,
        baseRosterCode: roster.code,
        profile: roster.profile,
        lineNumber: line.lineNumber,
        weekIndex: day.weekIndex,
        weekday: day.weekday,
        slotType: day.positionType as string,
        structuralAnchor: isStructuralAnchor(day.positionType),
        dutyCode: day.dutyCode,
      })),
    ),
  );

  if (slots.length === 0) {
    // Een lege baseline zou elke latere ankertoets stil laten slagen: geen slot
    // gevonden betekent geen anker gevonden.
    throw new Error(
      `Voor standplaats ${period.location.code} zijn geen roosterlijnen gevonden. Een lege ` +
        "baseline vastleggen zou de vergrendeling betekenisloos maken.",
    );
  }

  const sealedAt = new Date();
  const anchors = slots.filter((slot) => slot.structuralAnchor).length;

  await client.$transaction(async (tx) => {
    await tx.rosterStructureBaselineSlot.createMany({ data: slots });
    await tx.rosterPeriod.update({
      where: { id: period.id },
      data: { structureState: "STRUCTURE_LOCKED", baselineSealedAt: sealedAt },
    });
    await recordAuditStrict(
      {
        actor,
        action: "roosterstructuur.vastgelegd",
        objectType: "RosterPeriod",
        objectId: period.id,
        newValue: {
          label: period.label,
          slots: slots.length,
          ankers: anchors,
          roosters: rosters.map((roster) => roster.code),
          vastgelegdOp: sealedAt.toISOString(),
        },
      },
      tx,
    );
  });

  return { slots: slots.length, anchors, sealedAt, rosters: rosters.map((r) => r.code) };
}

function toBaselineSlot(slot: {
  baseRosterCode: string;
  lineNumber: number;
  weekIndex: number;
  weekday: number;
  slotType: string;
  structuralAnchor: boolean;
  dutyCode: string | null;
}): BaselineSlot {
  return {
    baseRosterCode: slot.baseRosterCode,
    lineNumber: slot.lineNumber,
    weekIndex: slot.weekIndex,
    weekday: slot.weekday,
    slotType: slot.slotType as BaselineSlot["slotType"],
    structuralAnchor: slot.structuralAnchor,
    dutyCode: slot.dutyCode,
  };
}

/** De vastgelegde structuur voor één cyclusdag, in de vorm die de engine kent. */
export async function baselineSlotFor(
  periodId: string,
  key: {
    readonly baseRosterCode: string;
    readonly lineNumber: number;
    readonly weekIndex: number;
    readonly weekday: number;
  },
  client: PrismaLike = prisma,
): Promise<BaselineSlot | null> {
  const slot = await client.rosterStructureBaselineSlot.findUnique({
    where: {
      periodId_baseRosterCode_lineNumber_weekIndex_weekday: {
        periodId,
        baseRosterCode: key.baseRosterCode,
        lineNumber: key.lineNumber,
        weekIndex: key.weekIndex,
        weekday: key.weekday,
      },
    },
  });
  return slot ? toBaselineSlot(slot) : null;
}

/** De volledige vastgelegde structuur van een periode. */
export async function baselineOf(
  periodId: string,
  client: PrismaLike = prisma,
): Promise<readonly BaselineSlot[]> {
  const slots = await client.rosterStructureBaselineSlot.findMany({
    where: { periodId },
    orderBy: [
      { baseRosterCode: "asc" },
      { lineNumber: "asc" },
      { weekIndex: "asc" },
      { weekday: "asc" },
    ],
  });
  return slots.map(toBaselineSlot);
}

export async function listPeriods(locationCode?: string) {
  await requirePermission(PERMISSIONS.ROSTER_READ);
  return prisma.rosterPeriod.findMany({
    where: locationCode ? { location: { code: locationCode } } : undefined,
    include: { location: true, _count: { select: { baselineSlots: true } } },
    orderBy: [{ year: "desc" }, { version: "desc" }],
  });
}

/** De periode die op deze datum voor deze standplaats geldt. */
export async function activePeriod(
  locationCode: string,
  onDate: Date,
  client: PrismaLike = prisma,
) {
  return client.rosterPeriod.findFirst({
    where: {
      location: { code: locationCode },
      validFrom: { lte: onDate },
      OR: [{ validUntil: null }, { validUntil: { gte: onDate } }],
    },
    orderBy: { version: "desc" },
    include: { location: true },
  });
}

/** Mag de structuur van deze periode nog worden bepaald? */
export function structureEditable(period: {
  readonly changeType: RosterChangeType | string;
  readonly structureState: string;
}): boolean {
  return period.changeType === "NEW_TIMETABLE" && period.structureState === "STRUCTURE_EDITABLE";
}

// ── De publicatieketen ───────────────────────────────────────────────────────

/**
 * De volgorde waarin een roosterperiode naar buiten gaat.
 *
 * De keten staat er helemaal, en het laatste vakje is met opzet dicht. Zo is
 * zichtbaar wat er nog moet gebeuren, zonder dat iemand er per ongeluk
 * doorheen loopt: publiceren betekent dat honderden mensen hun leven op dit
 * rooster gaan inrichten, en dat mag niet kunnen zolang de regelverzameling
 * niet als actueel is geverifieerd.
 */
export const PERIOD_STATUS_ORDER = [
  "CONCEPT",
  "SIMULATION",
  "RULE_VALIDATION_PENDING",
  "REVIEWED",
  "OR_APPROVAL_REQUIRED",
  "APPROVED",
  "PUBLISHED",
] as const;

export type PeriodStatus = (typeof PERIOD_STATUS_ORDER)[number];

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  CONCEPT: "Concept",
  SIMULATION: "Simulatie",
  RULE_VALIDATION_PENDING: "Regelvalidatie loopt",
  REVIEWED: "Beoordeeld",
  OR_APPROVAL_REQUIRED: "Instemming OR nodig",
  APPROVED: "Goedgekeurd",
  PUBLISHED: "Gepubliceerd",
};

export interface StatusChange {
  readonly ok: boolean;
  readonly status: PeriodStatus;
  readonly reason?: string;
}

/**
 * Zet een periode een stap verder in de keten.
 *
 * Alleen vooruit, en alleen één stap tegelijk: een periode die van concept naar
 * goedgekeurd springt, heeft de tussenliggende beoordelingen niet gehad, en dat
 * is later niet meer te zien.
 */
export async function advancePeriodStatus(
  periodId: string,
  to: PeriodStatus,
  reason: string,
): Promise<StatusChange> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_MANAGE);
  const period = await prisma.rosterPeriod.findUnique({ where: { id: periodId } });
  if (!period) {
    throw new Error("Deze roosterperiode bestaat niet.");
  }

  const huidig = period.status as PeriodStatus;
  const van = PERIOD_STATUS_ORDER.indexOf(huidig);
  const naar = PERIOD_STATUS_ORDER.indexOf(to);

  if (naar !== van + 1) {
    return {
      ok: false,
      status: huidig,
      reason:
        `Van ${PERIOD_STATUS_LABELS[huidig]} kan alleen naar ` +
        `${PERIOD_STATUS_LABELS[PERIOD_STATUS_ORDER[van + 1] ?? huidig]}. Stappen overslaan ` +
        "zou een beoordeling overslaan.",
    };
  }

  if (to === "PUBLISHED") {
    const { activeRuleset } = await import("@/server/rules-engine/ruleset/index");
    const ruleset = activeRuleset();
    const productieklaar =
      ruleset.mode === "PRODUCTION" && ruleset.legalStatus === "LEGAL_RULESET_VERIFIED";
    if (!productieklaar) {
      await recordAudit({
        actor,
        action: "roosterperiode.publicatie-geweigerd",
        objectType: "RosterPeriod",
        objectId: periodId,
        result: "DENIED",
        reason:
          `Regelbestand ${ruleset.version} draait in ${ruleset.mode} met status ` +
          `${ruleset.legalStatus}.`,
      });
      return {
        ok: false,
        status: huidig,
        reason:
          "Publiceren kan niet zolang het regelbestand niet als actueel en geverifieerd " +
          "vaststaat. Dit is geen instelling die hier kan worden omgezet: er is geen " +
          "route in de applicatie die dit overslaat. Zie het rapport bij fase J.",
      };
    }
  }

  await prisma.rosterPeriod.update({ where: { id: periodId }, data: { status: to } });
  await recordAudit({
    actor,
    action: "roosterperiode.status-gewijzigd",
    objectType: "RosterPeriod",
    objectId: periodId,
    oldValue: { status: huidig },
    newValue: { status: to, label: period.label },
    reason,
  });
  return { ok: true, status: to };
}
