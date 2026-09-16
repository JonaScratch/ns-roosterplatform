import "server-only";
import {
  AvailableDutyStatus,
  RosterPositionType,
  SwapStatus,
} from "@/lib/generated/prisma/enums";
import { type CalendarDate, addDays, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { depotFilter, locationScopeFor } from "@/server/security/location-scope";
import { prisma } from "@/server/data/prisma";
import { advanceAvailableDuties } from "./available-duty-service";
import { DUTY_SELECT } from "@/server/data/mappers";
import { reserveCandidatesFor } from "./reserve-service";

/**
 * Dienstindeling: de dagelijkse operatie.
 *
 * Wat hier gebeurt is het invullen van vandaag en de komende dagen binnen de
 * roosters die er al zijn. Wat hier uitdrukkelijk **niet** gebeurt is het
 * wijzigen van die roosters: Dienstindeling heeft geen enkel recht dat de
 * structuur van een basisrooster raakt. Die scheiding staat in de rechtentabel
 * en wordt hier alleen gevolgd.
 *
 * ## Hoe de bezettingsgraad wordt berekend
 *
 * Toegewezen diensten gedeeld door alles wat die dag gereden moet worden — dus
 * inclusief wat nog openstaat. Zonder die noemer zou een dag met twee diensten
 * waarvan er twee bezet zijn, op 100% uitkomen terwijl er twintig ongedekt
 * blijven. De noemer is de waarheid, niet de teller.
 */

export interface AssignmentOverview {
  readonly date: CalendarDate;
  readonly occupancyRate: number;
  readonly occupancyTarget: number;
  readonly assignedDuties: number;
  readonly openDuties: number;
  readonly criticalOpenDuties: number;
  readonly reserveAvailable: number;
  readonly availableForEmployees: number;
  readonly pendingSwaps: number;
  readonly unresolvedDuties: number;
}

/** Streefwaarde voor de bezetting. Voorlopig; nog niet door NS bevestigd. */
const OCCUPANCY_TARGET = 0.95;

/**
 * Hoe dicht een openstaande dienst bij aanvang staat, uitgedrukt in prioriteit.
 *
 * Vandaag en morgen zijn kritiek; daarna neemt de urgentie af. Dit is een
 * werkindeling voor het scherm en geen regel: de rules engine kent haar niet.
 */
export type OpenDutyPriority = "KRITIEK" | "HOOG" | "NORMAAL";

function priorityFor(date: CalendarDate, today: CalendarDate): OpenDutyPriority {
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (days <= 1) {
    return "KRITIEK";
  }
  return days <= 4 ? "HOOG" : "NORMAAL";
}

export async function assignmentOverview(date: CalendarDate): Promise<AssignmentOverview> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const scope = await locationScopeFor(actor, null);
  const today = toCalendarDate(new Date());
  const day = toDatabaseDate(date);

  const [assigned, openToday, reserveAvailable, availableRows, pendingSwaps] = await Promise.all([
    prisma.scheduledDuty.count({
      where: {
        date: day,
        positionType: RosterPositionType.DUTY,
        dutyId: { not: null },
        employee: depotFilter(scope),
      },
    }),
    // De bezettingsgraad gaat over déze dag: wat er die dag gereden moet worden
    // en wat ervan bezet is.
    prisma.availableDuty.count({
      where: {
        date: day,
        status: {
          in: [
            AvailableDutyStatus.RESERVE_PENDING,
            AvailableDutyStatus.OPEN,
            // Het venster is dicht en er is nog niet toegewezen: dat is werk
            // dat op tafel ligt, niet werk dat weg is.
            AvailableDutyStatus.ALLOCATION_PENDING,
          ],
        },
        duty: depotFilter(scope),
      },
    }),
    prisma.scheduledDuty.count({
      where: { date: day, positionType: RosterPositionType.RES, employee: depotFilter(scope) },
    }),
    // De werkvoorraad gaat verder dan vandaag: een dienst van overmorgen die
    // nog open staat, is werk dat nu op tafel ligt. Deze teller alleen op
    // vandaag zetten gaf een dashboard dat "0 openstaand" meldde boven een
    // tabel met zes openstaande diensten.
    prisma.availableDuty.findMany({
      where: {
        date: { gte: day },
        status: {
          in: [
            AvailableDutyStatus.RESERVE_PENDING,
            AvailableDutyStatus.OPEN,
            // Het venster is dicht en er is nog niet toegewezen: dat is werk
            // dat op tafel ligt, niet werk dat weg is.
            AvailableDutyStatus.ALLOCATION_PENDING,
          ],
        },
        duty: depotFilter(scope),
      },
      select: { status: true, date: true },
    }),
    prisma.swapProposal.count({
      where: {
        status: SwapStatus.PENDING,
        initiatorEmployee: depotFilter(scope),
      },
    }),
  ]);

  const openDuties = availableRows.length;
  const total = assigned + openToday;

  return {
    date,
    occupancyRate: total === 0 ? 1 : assigned / total,
    occupancyTarget: OCCUPANCY_TARGET,
    assignedDuties: assigned,
    openDuties,
    criticalOpenDuties: availableRows.filter(
      (row) => priorityFor(toCalendarDate(row.date), today) === "KRITIEK",
    ).length,
    reserveAvailable,
    availableForEmployees: availableRows.filter(
      (row) => row.status === AvailableDutyStatus.OPEN,
    ).length,
    pendingSwaps,
    // Diensten die al open staan én waarvoor niemand belangstelling heeft
    // getoond: die vragen een menselijke oplossing.
    unresolvedDuties: await prisma.availableDuty.count({
      where: {
        date: { gte: day },
        status: AvailableDutyStatus.OPEN,
        interests: { none: {} },
        duty: depotFilter(scope),
      },
    }),
  };
}

export interface OpenDutyView {
  readonly id: string;
  readonly date: CalendarDate;
  readonly dutyCode: string;
  readonly kinds: readonly string[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly status: AvailableDutyStatus;
  readonly priority: OpenDutyPriority;
  readonly interestCount: number;
  readonly reserveAttempted: boolean;
}

/** De openstaande diensten, urgentste eerst. */
export async function openDuties(
  options: { readonly limit?: number; readonly date?: CalendarDate } = {},
): Promise<readonly OpenDutyView[]> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const scope = await locationScopeFor(actor, null);
  const today = toCalendarDate(new Date());

  // Eerst de toestanden bijwerken die alleen door de klok veranderen. Zonder
  // deze regel toont dit scherm een dienst als "inschrijving open" terwijl het
  // venster gesloten is en niemand zich nog kan inschrijven.
  await advanceAvailableDuties();

  const rows = await prisma.availableDuty.findMany({
    where: {
      status: {
          in: [
            AvailableDutyStatus.RESERVE_PENDING,
            AvailableDutyStatus.OPEN,
            // Het venster is dicht en er is nog niet toegewezen: dat is werk
            // dat op tafel ligt, niet werk dat weg is.
            AvailableDutyStatus.ALLOCATION_PENDING,
          ],
        },
      // Een opgegeven dag toont uitsluitend die dag — dat is de link vanuit het
      // bezettingsoverzicht op het dashboard. Zonder opgegeven dag geldt de
      // oude norm: alles vanaf vandaag.
      date: options.date ? toDatabaseDate(options.date) : { gte: toDatabaseDate(today) },
      duty: depotFilter(scope),
    },
    orderBy: { date: "asc" },
    take: Math.min(options.limit ?? 25, 100),
    select: {
      id: true,
      date: true,
      status: true,
      duty: { select: DUTY_SELECT },
      interests: { where: { withdrawnAt: null }, select: { id: true } },
      reserveAttempts: { select: { id: true } },
    },
  });

  return rows.map((row) => {
    const date = toCalendarDate(row.date);
    return {
      id: row.id,
      date,
      dutyCode: row.duty.code,
      kinds: row.duty.kinds,
      startMinute: row.duty.startMinute,
      endMinute: row.duty.endMinute,
      depot: row.duty.depot,
      status: row.status,
      priority: priorityFor(date, today),
      interestCount: row.interests.length,
      reserveAttempted: row.reserveAttempts.length > 0,
    };
  });
}

export interface ReserveProposalView {
  readonly availableDutyId: string;
  readonly date: CalendarDate;
  readonly dutyCode: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly bestMatch: {
    readonly employeeNumber: string;
    readonly score: number;
    readonly preferenceLabel: string;
    readonly preferenceFit: number;
    readonly explanation: string;
  } | null;
}

/**
 * Automatische reserve-voorstellen voor de diensten die nog bij reserve liggen.
 *
 * Toont wat het systeem zou doen, met de reden erbij. De planner voert het uit;
 * hij hoeft niet te raden waarom juist deze medewerker bovenaan staat.
 */
export async function reserveProposals(
  limit = 5,
  date?: CalendarDate,
): Promise<readonly ReserveProposalView[]> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const scope = await locationScopeFor(actor, null);

  const pending = await prisma.availableDuty.findMany({
    where: {
      status: AvailableDutyStatus.RESERVE_PENDING,
      ...(date ? { date: toDatabaseDate(date) } : {}),
      duty: depotFilter(scope),
    },
    orderBy: { date: "asc" },
    take: limit,
    select: { id: true, date: true, duty: { select: DUTY_SELECT } },
  });

  const proposals: ReserveProposalView[] = [];
  for (const row of pending) {
    const date = toCalendarDate(row.date);
    const candidates = await reserveCandidatesFor(row.duty.id, date);
    const best = candidates.find((candidate) => candidate.valid) ?? null;

    proposals.push({
      availableDutyId: row.id,
      date,
      dutyCode: row.duty.code,
      startMinute: row.duty.startMinute,
      endMinute: row.duty.endMinute,
      bestMatch: best
        ? {
            employeeNumber: best.employeeNumber,
            score: best.score,
            preferenceLabel: best.preferenceLabel,
            preferenceFit: best.preferenceFit,
            explanation: best.explanation,
          }
        : null,
    });
  }
  return proposals;
}

export interface OccupancyPoint {
  readonly date: CalendarDate;
  readonly rate: number;
  /** Aantal toegewezen diensten deze dag. */
  readonly assigned: number;
  /** Alles wat deze dag gereden moet worden: toegewezen plus openstaand. */
  readonly needed: number;
  /** Openstaand: nog bij reserve, opengesteld, of wachtend op toewijzing. */
  readonly open: number;
}

/** De bezetting van de komende dagen, voor het bezettingsoverzicht op het dashboard. */
export async function occupancyTrend(from: CalendarDate, days = 7): Promise<readonly OccupancyPoint[]> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const scope = await locationScopeFor(actor, null);

  const points: OccupancyPoint[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(from, offset);
    const day = toDatabaseDate(date);
    const [assigned, open] = await Promise.all([
      prisma.scheduledDuty.count({
        where: {
          date: day,
          positionType: RosterPositionType.DUTY,
          dutyId: { not: null },
          employee: depotFilter(scope),
        },
      }),
      prisma.availableDuty.count({
        where: {
          date: day,
          status: {
          in: [
            AvailableDutyStatus.RESERVE_PENDING,
            AvailableDutyStatus.OPEN,
            // Het venster is dicht en er is nog niet toegewezen: dat is werk
            // dat op tafel ligt, niet werk dat weg is.
            AvailableDutyStatus.ALLOCATION_PENDING,
          ],
        },
        duty: depotFilter(scope),
        },
      }),
    ]);
    const total = assigned + open;
    points.push({
      date,
      rate: total === 0 ? 1 : assigned / total,
      assigned,
      needed: total,
      open,
    });
  }
  return points;
}

export interface SwapOversightView {
  readonly id: string;
  readonly fromEmployeeNumber: string;
  readonly toEmployeeNumber: string;
  readonly dutyCode: string;
  readonly date: CalendarDate;
  readonly status: SwapStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * Ruilverzoeken, ter informatie voor Dienstindeling.
 *
 * Bewust alleen lezen. Een ruil is een afspraak tussen twee medewerkers die de
 * rules engine heeft goedgekeurd; Dienstindeling ziet hem zodat de dagplanning
 * klopt, en hoeft er niet tussen te komen.
 */
export async function swapOversight(limit = 10): Promise<readonly SwapOversightView[]> {
  const actor = await requirePermission(PERMISSIONS.SWAP_OVERSEE);
  const scope = await locationScopeFor(actor, null);

  const rows = await prisma.swapProposal.findMany({
    where: { status: SwapStatus.PENDING, initiatorEmployee: depotFilter(scope) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      initiatorEmployee: { select: { employeeNumber: true } },
      counterpartyEmployee: { select: { employeeNumber: true } },
      initiatorDuty: { select: { date: true, duty: { select: { code: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fromEmployeeNumber: row.initiatorEmployee.employeeNumber,
    toEmployeeNumber: row.counterpartyEmployee.employeeNumber,
    dutyCode: row.initiatorDuty.duty?.code ?? "—",
    date: toCalendarDate(row.initiatorDuty.date),
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}

export interface DayPlanRow {
  readonly employeeNumber: string;
  readonly rosterProfile: string;
  readonly positionType: RosterPositionType;
  readonly dutyCode: string | null;
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly source: string;
}

/** De dagplanning: wie doet vandaag wat. */
export async function dayPlan(date: CalendarDate): Promise<readonly DayPlanRow[]> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const scope = await locationScopeFor(actor, null);

  const rows = await prisma.scheduledDuty.findMany({
    where: { date: toDatabaseDate(date), employee: depotFilter(scope) },
    orderBy: [{ positionType: "asc" }, { employee: { employeeNumber: "asc" } }],
    select: {
      positionType: true,
      source: true,
      duty: { select: { code: true, startMinute: true, endMinute: true } },
      employee: { select: { employeeNumber: true, rosterProfile: true } },
    },
  });

  return rows.map((row) => ({
    employeeNumber: row.employee.employeeNumber,
    rosterProfile: row.employee.rosterProfile,
    positionType: row.positionType,
    dutyCode: row.duty?.code ?? null,
    startMinute: row.duty?.startMinute ?? null,
    endMinute: row.duty?.endMinute ?? null,
    source: row.source,
  }));
}
