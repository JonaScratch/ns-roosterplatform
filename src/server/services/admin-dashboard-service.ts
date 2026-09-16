import "server-only";
import {
  AvailableDutyStatus,
  DutyPackageStatus,
  RosterVersionStatus,
  SwapStatus,
} from "@/lib/generated/prisma/enums";
import { toCalendarDate, toDatabaseDate } from "@/domain/time";
import { config } from "@/server/config/env";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { rulesEngine } from "@/server/rules-engine";
import { prisma } from "@/server/data/prisma";

/**
 * Het beheerdersdashboard.
 *
 * ## Wat hier bewust níet gebeurt
 *
 * Er worden geen persoonsgegevens geladen. Alles op dit dashboard is een
 * aantal, een percentage of een status. Een beheerder die een naam nodig heeft,
 * haalt die apart op — en die inzage komt dan in het auditlog. Een
 * beheerdersscherm dat standaard namen toont, is een personeelsregister dat de
 * hele dag openstaat.
 *
 * ## Waarom er getallen ontbreken in plaats van geschat worden
 *
 * Een paar cijfers uit het ontwerp bestaan in deze fase nog niet: er is geen
 * back-upvoorziening en geen bestandsopslag. Die worden hier als "niet
 * geconfigureerd" gerapporteerd en niet met een plausibel ogende waarde
 * ingevuld. Een dashboard dat een groen vinkje toont voor een back-up die niet
 * draait, is gevaarlijker dan een dashboard dat niets toont.
 */

export interface AdminKpis {
  readonly activeEmployees: number;
  readonly employeesAddedThisMonth: number;
  readonly ruleConformity: number | null;
  readonly occupancyRate: number | null;
  readonly systemHealthy: boolean;
  readonly lastCheckAt: Date;
}

export async function adminKpis(): Promise<AdminKpis> {
  await requirePermission(PERMISSIONS.SYSTEM_READ);
  const today = toCalendarDate(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;

  const [activeEmployees, addedThisMonth, conformity, occupancy, health] = await Promise.all([
    prisma.employee.count({ where: { status: "ACTIVE" } }),
    prisma.employee.count({
      where: { status: "ACTIVE", createdAt: { gte: new Date(`${monthStart}T00:00:00.000Z`) } },
    }),
    ruleConformityLast30Days(),
    todayOccupancy(today),
    systemHealth(),
  ]);

  return {
    activeEmployees,
    employeesAddedThisMonth: addedThisMonth,
    ruleConformity: conformity,
    occupancyRate: occupancy,
    systemHealthy: health.every((component) => component.state !== "ERROR"),
    lastCheckAt: new Date(),
  };
}

/**
 * Regelconformiteit: het aandeel beoordeelde beslissingen dat door de harde
 * regels kwam.
 *
 * Uitdrukkelijk geen oordeel over het rooster als geheel — dat vraagt een
 * volledige doorrekening en hoort bij de roosteranalyse. Dit is wat het systeem
 * de afgelopen dertig dagen heeft toegestaan tegenover wat het heeft
 * tegengehouden, en dat is precies het getal dat een beheerder wil zien
 * bewegen.
 */
async function ruleConformityLast30Days(): Promise<number | null> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [total, blocked] = await Promise.all([
    prisma.ruleEvaluation.count({ where: { createdAt: { gte: since } } }),
    prisma.ruleEvaluation.count({ where: { createdAt: { gte: since }, decision: "BLOCK" } }),
  ]);
  return total === 0 ? null : (total - blocked) / total;
}

async function todayOccupancy(today: string): Promise<number | null> {
  const day = toDatabaseDate(today);
  const [assigned, open] = await Promise.all([
    prisma.scheduledDuty.count({
      where: { date: day, positionType: "DUTY", dutyId: { not: null } },
    }),
    prisma.availableDuty.count({
      where: {
        date: day,
        status: { in: [AvailableDutyStatus.RESERVE_PENDING, AvailableDutyStatus.OPEN] },
      },
    }),
  ]);
  const total = assigned + open;
  return total === 0 ? null : assigned / total;
}

// ── Rooster Commissie in het kort ────────────────────────────────────────────

export interface RosterCommitteeSummary {
  readonly activePackage: { readonly name: string; readonly version: number } | null;
  readonly baseRosters: number;
  readonly rosterLines: number;
  readonly hardViolations: number;
  readonly draftVersions: number;
  readonly feedbackResponseRate: number | null;
  readonly lastPublishedAt: Date | null;
}

export async function rosterCommitteeSummary(): Promise<RosterCommitteeSummary> {
  await requirePermission(PERMISSIONS.ROSTER_READ);

  const [activePackage, baseRosters, rosterLines, violations, drafts, published, respondents, employees] =
    await Promise.all([
      prisma.dutyPackage.findFirst({
        where: { status: DutyPackageStatus.ACTIVE },
        orderBy: { version: "desc" },
        select: { name: true, version: true },
      }),
      prisma.baseRoster.count(),
      prisma.rosterLine.count(),
      prisma.rosterWarning.count({ where: { severity: "VIOLATION" } }),
      prisma.rosterVersion.count({
        where: { status: { in: [RosterVersionStatus.DRAFT, RosterVersionStatus.GENERATED] } },
      }),
      prisma.rosterVersion.findFirst({
        where: { status: RosterVersionStatus.PUBLISHED },
        orderBy: { generatedAt: "desc" },
        select: { generatedAt: true },
      }),
      prisma.quarterlyFeedback.count(),
      prisma.employee.count({ where: { status: "ACTIVE" } }),
    ]);

  return {
    activePackage,
    baseRosters,
    rosterLines,
    hardViolations: violations,
    draftVersions: drafts,
    feedbackResponseRate: employees === 0 ? null : Math.min(1, respondents / employees),
    lastPublishedAt: published?.generatedAt ?? null,
  };
}

// ── Dienstindeling in het kort ───────────────────────────────────────────────

export interface DutyAssignmentSummary {
  readonly occupancyRate: number | null;
  readonly openDuties: number;
  readonly reserveAvailable: number;
  readonly availableForEmployees: number;
  readonly pendingSwaps: number;
  readonly unresolvedDuties: number;
}

export async function dutyAssignmentSummary(): Promise<DutyAssignmentSummary> {
  await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const today = toCalendarDate(new Date());
  const day = toDatabaseDate(today);

  const [occupancy, open, reserve, available, swaps, unresolved] = await Promise.all([
    todayOccupancy(today),
    prisma.availableDuty.count({
      where: {
        status: { in: [AvailableDutyStatus.RESERVE_PENDING, AvailableDutyStatus.OPEN] },
        date: { gte: day },
      },
    }),
    prisma.scheduledDuty.count({ where: { date: day, positionType: "RES" } }),
    prisma.availableDuty.count({ where: { status: AvailableDutyStatus.OPEN, date: { gte: day } } }),
    prisma.swapProposal.count({ where: { status: SwapStatus.PENDING } }),
    prisma.availableDuty.count({
      where: { status: AvailableDutyStatus.OPEN, date: { gte: day }, interests: { none: {} } },
    }),
  ]);

  return {
    occupancyRate: occupancy,
    openDuties: open,
    reserveAvailable: reserve,
    availableForEmployees: available,
    pendingSwaps: swaps,
    unresolvedDuties: unresolved,
  };
}

// ── Systeemstatus ────────────────────────────────────────────────────────────

export interface SystemComponent {
  readonly name: string;
  readonly state: "OK" | "WARN" | "ERROR" | "UNKNOWN";
  readonly detail: string;
}

/**
 * De toestand van de onderdelen.
 *
 * Elk onderdeel wordt echt gecontroleerd of eerlijk als onbekend gemeld. De
 * database wordt bevraagd en de rules engine noemt zijn eigen naam en versie.
 * Voor bestandsopslag en back-ups bestaat nog geen
 * voorziening; dat staat er dan ook zo.
 */
export async function systemHealth(): Promise<readonly SystemComponent[]> {
  const settings = config();
  const engine = rulesEngine();

  const components: SystemComponent[] = [];

  // Database: een echte query, geen aanname.
  try {
    await prisma.$queryRaw`SELECT 1`;
    components.push({ name: "Database", state: "OK", detail: "Bereikbaar" });
  } catch {
    components.push({ name: "Database", state: "ERROR", detail: "Niet bereikbaar" });
  }

  components.push({
    name: "Rules Engine",
    state: settings.RULES_ENGINE_MODE === "local" ? "WARN" : "OK",
    detail:
      settings.RULES_ENGINE_MODE === "local"
        ? `Lokale referentie-implementatie (${engine.version})`
        : "Centrale Rules Engine",
  });

  // De optimizer draait als apart proces. Of hij bruikbaar is, wordt hier
  // gemeten door hem een miniatuurmodel te laten oplossen — een vinkje op grond
  // van "hij zou er moeten zijn" zegt niets.
  const { solverHealth } = await import("@/server/optimizer/cpsat-solver");
  const solver = await solverHealth();
  components.push({
    name: "Rooster-optimizer",
    state: solver.available ? "OK" : "ERROR",
    detail: solver.detail,
  });

  // De exportrenderer: één functie, dus één echte proefopmaak.
  try {
    const { renderRosterDocument } = await import("@/server/export/roster-document");
    const proef = renderRosterDocument({
      meta: {
        logoDataUri: null,
        locationCode: "PROEF",
        locationName: "Proef",
        rosterCode: "PROEF",
        rosterName: "Proef",
        profileLabel: "Proef",
        timetableId: "PROEF",
        periodLabel: "—",
        changeType: "NEW_TIMETABLE",
        structureState: "STRUCTURE_EDITABLE",
        rulesetVersion: engine.version,
        rulesetMode: "SIMULATION",
        legalStatus: "onbekend",
        generatedAt: "",
        generatedBy: "",
        productionSafe: false,
        dutyPackageLabel: null,
      },
      lines: [{ lineNumber: 1, employeeNumber: null, weeks: [["R"]] }],
    });
    components.push({
      name: "Exportsjabloon",
      state: proef.includes("SIMULATIE") ? "OK" : "WARN",
      detail: proef.includes("SIMULATIE")
        ? "Renderer werkt en stempelt een simulatie af"
        : "Renderer werkt, maar stempelt geen simulatie af",
    });
  } catch (error) {
    components.push({
      name: "Exportsjabloon",
      state: "ERROR",
      detail: `Renderer faalt: ${String(error).slice(0, 120)}`,
    });
  }

  // Bestandsopslag en back-up zijn nog niet ingericht. Ze worden als zodanig
  // gemeld en niet met een schijncontrole ingevuld: een groen vinkje voor een
  // voorziening die niet bestaat, is gevaarlijker dan een leeg vak.
  components.push({
    name: "Bestandsopslag",
    state: "UNKNOWN",
    detail: "Nog geen documentopslag ingericht",
  });

  components.push({
    name: "Back-up en herstel",
    state: "UNKNOWN",
    detail: "Niet geconfigureerd",
  });

  components.push({
    name: "Authenticatie",
    state: settings.AUTH_PROVIDER === "local" ? "WARN" : "OK",
    detail:
      settings.AUTH_PROVIDER === "local"
        ? "Lokale testauthenticatie — geen SSO/MFA"
        : "NS SSO",
  });

  return components;
}

// ── Recente beheerdersacties ─────────────────────────────────────────────────

export interface AdminActivityView {
  readonly id: string;
  readonly action: string;
  readonly summary: string;
  readonly objectType: string;
  readonly actorEmployeeNumber: string | null;
  readonly occurredAt: Date;
  readonly denied: boolean;
}

const ADMIN_ACTION_LABELS: Record<string, string> = {
  "rollen.gewijzigd": "Rollen gewijzigd",
  "rollen.wijziging-geweigerd": "Rolwijziging geweigerd",
  "account.status-gewijzigd": "Accountstatus gewijzigd",
  "dienstenpakket.geimporteerd": "Dienstenpakket geïmporteerd",
  "dienstenpakket.geactiveerd": "Dienstenpakket geactiveerd",
  "rooster.generatie-aangevraagd": "Roostergeneratie aangevraagd",
  "rooster.gepubliceerd": "Rooster gepubliceerd",
  "rooster.geexporteerd": "Rooster geëxporteerd",
  "reserve.ingevuld": "Reserve ingevuld",
  "reserve.invulling-mislukt": "Reserve-invulling mislukt",
  "beschikbare-dienst.opengesteld": "Dienst opengesteld",
  "dienst.vrijgegeven": "Dienst vrijgegeven",
};

/** De laatste beheer- en planningsacties, zonder persoonsgegevens. */
export async function recentAdminActivity(limit = 6): Promise<readonly AdminActivityView[]> {
  await requirePermission(PERMISSIONS.AUDIT_READ);

  const rows = await prisma.auditLogEntry.findMany({
    where: { action: { in: Object.keys(ADMIN_ACTION_LABELS) } },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      objectType: true,
      actorEmployeeNumber: true,
      occurredAt: true,
      result: true,
      reason: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    action: ADMIN_ACTION_LABELS[row.action] ?? row.action,
    summary: row.reason ?? row.objectType,
    objectType: row.objectType,
    actorEmployeeNumber: row.actorEmployeeNumber,
    occurredAt: row.occurredAt,
    denied: row.result === "DENIED",
  }));
}
