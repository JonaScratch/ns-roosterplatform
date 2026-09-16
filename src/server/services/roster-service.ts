import "server-only";
import {
  AvailableDutyStatus,
  BaseRosterStatus,
  DutyPackageStatus,
  type RosterPositionType,
  type RosterProfile,
  RosterVersionStatus,
  SwapStatus,
  WaitlistStatus,
} from "@/lib/generated/prisma/enums";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { addDays, isWeekend, toCalendarDate, toDatabaseDate, weekdayLabel } from "@/domain/time";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { depotFilter, locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";

/**
 * Roosters voor de planner: overzicht, versies, vergelijking en export.
 *
 * Wat hier bewust níet gebeurt: roosters uitrekenen. Het samenstellen van een
 * rooster is werk van de Rules Engine. Deze service bereidt het verzoek voor,
 * bewaart het antwoord en maakt het zichtbaar. Zo blijft er geen roosterlogica
 * achter wanneer de centrale engine wordt aangesloten.
 */

export interface RosterStatusView {
  readonly baseRosters: number;
  readonly activeBaseRosters: number;
  readonly employeesAssigned: number;
  readonly activeDutyPackage: { name: string; version: number; duties: number } | null;
  readonly openAvailableDuties: number;
  readonly reservePendingDuties: number;
  readonly pendingSwaps: number;
  readonly waitlistEntries: number;
  readonly draftVersions: number;
  readonly openWarnings: number;
}

/** Het dashboard van de planner: één blik op de stand van zaken. */
export async function rosterStatus(): Promise<RosterStatusView> {
  await requirePermission(PERMISSIONS.ROSTER_READ);

  const [
    baseRosters,
    activeBaseRosters,
    employeesAssigned,
    activePackage,
    openAvailable,
    reservePending,
    pendingSwaps,
    waitlistEntries,
    draftVersions,
    openWarnings,
  ] = await Promise.all([
    prisma.baseRoster.count(),
    prisma.baseRoster.count({ where: { status: BaseRosterStatus.ACTIVE } }),
    prisma.rosterAssignment.count({ where: { validUntil: null } }),
    prisma.dutyPackage.findFirst({
      where: { status: DutyPackageStatus.ACTIVE },
      orderBy: { version: "desc" },
      select: { name: true, version: true, _count: { select: { duties: true } } },
    }),
    prisma.availableDuty.count({ where: { status: AvailableDutyStatus.OPEN } }),
    prisma.availableDuty.count({ where: { status: AvailableDutyStatus.RESERVE_PENDING } }),
    prisma.swapProposal.count({ where: { status: SwapStatus.PENDING } }),
    prisma.waitlistEntry.count({ where: { status: WaitlistStatus.ACTIVE } }),
    prisma.rosterVersion.count({
      where: { status: { in: [RosterVersionStatus.DRAFT, RosterVersionStatus.GENERATED] } },
    }),
    prisma.rosterWarning.count({ where: { severity: { in: ["WARNING", "VIOLATION"] } } }),
  ]);

  return {
    baseRosters,
    activeBaseRosters,
    employeesAssigned,
    activeDutyPackage: activePackage
      ? {
          name: activePackage.name,
          version: activePackage.version,
          duties: activePackage._count.duties,
        }
      : null,
    openAvailableDuties: openAvailable,
    reservePendingDuties: reservePending,
    pendingSwaps,
    waitlistEntries,
    draftVersions,
    openWarnings,
  };
}

export interface BaseRosterView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly profileLabel: string;
  readonly depot: string;
  readonly cycleWeeks: number;
  readonly status: BaseRosterStatus;
  readonly lines: number;
  readonly occupiedLines: number;
  readonly waiting: number;
  readonly versions: number;
}

export async function listBaseRosters(
  requestedLocation?: string | null,
): Promise<readonly BaseRosterView[]> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  // De standplaats komt uit de sessie, niet uit het scherm. Zie
  // src/server/security/location-scope.ts.
  const scope = await locationScopeFor(actor, requestedLocation);
  const rows = await prisma.baseRoster.findMany({
    where: depotFilter(scope),
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      profile: true,
      depot: true,
      cycleWeeks: true,
      status: true,
      _count: { select: { versions: true } },
      lines: {
        select: {
          _count: { select: { assignments: { where: { validUntil: null } } } },
        },
      },
      waitlistEntries: { where: { status: WaitlistStatus.ACTIVE }, select: { id: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    profileLabel: rosterProfileLabel(row.profile),
    depot: row.depot,
    cycleWeeks: row.cycleWeeks,
    status: row.status,
    lines: row.lines.length,
    occupiedLines: row.lines.filter((line) => line._count.assignments > 0).length,
    waiting: row.waitlistEntries.length,
    versions: row._count.versions,
  }));
}

// ── Versies en vergelijking ──────────────────────────────────────────────────

export interface RosterVersionView {
  readonly id: string;
  readonly label: string;
  readonly status: RosterVersionStatus;
  readonly generatedAt: Date;
  readonly engine: string | null;
  readonly warnings: { info: number; warning: number; violation: number };
}

export async function listVersions(baseRosterId: string): Promise<readonly RosterVersionView[]> {
  await requirePermission(PERMISSIONS.ROSTER_READ);
  const rows = await prisma.rosterVersion.findMany({
    where: { baseRosterId },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      label: true,
      status: true,
      generatedAt: true,
      engineName: true,
      warnings: { select: { severity: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    status: row.status,
    generatedAt: row.generatedAt,
    engine: row.engineName,
    warnings: {
      info: row.warnings.filter((w) => w.severity === "INFO").length,
      warning: row.warnings.filter((w) => w.severity === "WARNING").length,
      violation: row.warnings.filter((w) => w.severity === "VIOLATION").length,
    },
  }));
}

export interface RosterDiffCell {
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly weekdayLabel: string;
  readonly before: string;
  readonly after: string;
}

export interface RosterDiff {
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly changed: readonly RosterDiffCell[];
  readonly unchangedCount: number;
  readonly onlyInLeft: number;
  readonly onlyInRight: number;
}

/**
 * Twee roosterversies naast elkaar.
 *
 * De vergelijking gebeurt op de sleutel lijn/week/dag en niet op volgorde: een
 * versie met een andere hoeveelheid lijnen levert dan geen verschoven diff op
 * maar nette "alleen in links"- en "alleen in rechts"-tellingen.
 */
export async function compareVersions(
  leftVersionId: string,
  rightVersionId: string,
): Promise<RosterDiff> {
  await requirePermission(PERMISSIONS.ROSTER_COMPARE);

  const [left, right] = await Promise.all([
    loadVersionDays(leftVersionId),
    loadVersionDays(rightVersionId),
  ]);

  const key = (day: VersionDay) => `${day.lineNumber}|${day.weekIndex}|${day.weekday}`;
  const leftMap = new Map(left.days.map((day) => [key(day), day]));
  const rightMap = new Map(right.days.map((day) => [key(day), day]));

  const changed: RosterDiffCell[] = [];
  let unchanged = 0;
  let onlyInLeft = 0;

  for (const [cellKey, leftDay] of leftMap) {
    const rightDay = rightMap.get(cellKey);
    if (!rightDay) {
      onlyInLeft += 1;
      continue;
    }
    const before = describeCell(leftDay);
    const after = describeCell(rightDay);
    if (before === after) {
      unchanged += 1;
      continue;
    }
    changed.push({
      lineNumber: leftDay.lineNumber,
      weekIndex: leftDay.weekIndex,
      weekday: leftDay.weekday,
      weekdayLabel: weekdayLabel(leftDay.weekday),
      before,
      after,
    });
  }

  let onlyInRight = 0;
  for (const cellKey of rightMap.keys()) {
    if (!leftMap.has(cellKey)) {
      onlyInRight += 1;
    }
  }

  changed.sort(
    (a, b) =>
      a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday,
  );

  return {
    leftLabel: left.label,
    rightLabel: right.label,
    changed,
    unchangedCount: unchanged,
    onlyInLeft,
    onlyInRight,
  };
}

interface VersionDay {
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: RosterPositionType;
  readonly dutyCode: string | null;
}

async function loadVersionDays(versionId: string) {
  const version = await prisma.rosterVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: {
      label: true,
      days: {
        select: {
          lineNumber: true,
          weekIndex: true,
          weekday: true,
          positionType: true,
          dutyCode: true,
        },
      },
    },
  });
  return { label: version.label, days: version.days };
}

function describeCell(day: VersionDay): string {
  return day.positionType === "DUTY" ? (day.dutyCode ?? "?") : day.positionType;
}

// ── Controles ────────────────────────────────────────────────────────────────

export interface WarningView {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly message: string;
  readonly lineNumber: number | null;
  readonly weekIndex: number | null;
  readonly weekdayLabel: string | null;
}

export async function versionWarnings(versionId: string): Promise<readonly WarningView[]> {
  await requirePermission(PERMISSIONS.ROSTER_READ);
  const rows = await prisma.rosterWarning.findMany({
    where: { versionId },
    orderBy: [{ severity: "desc" }, { lineNumber: "asc" }],
    select: {
      id: true,
      ruleId: true,
      severity: true,
      message: true,
      lineNumber: true,
      weekIndex: true,
      weekday: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    ruleId: row.ruleId,
    severity: row.severity,
    message: row.message,
    lineNumber: row.lineNumber,
    weekIndex: row.weekIndex,
    weekdayLabel: row.weekday === null ? null : weekdayLabel(row.weekday),
  }));
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * Roosterexport als CSV.
 *
 * Bevat personeelsnummers en geen namen. Een export is een bestand dat het
 * systeem verlaat en daarmee de plek waar privacy het snelst weglekt; de
 * beperking zit daarom in de export zelf en niet in een instelling.
 */
export async function exportVersionCsv(versionId: string): Promise<{
  readonly filename: string;
  readonly content: string;
}> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_EXPORT);

  const version = await prisma.rosterVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: {
      label: true,
      baseRoster: { select: { code: true } },
      days: {
        orderBy: [{ lineNumber: "asc" }, { weekIndex: "asc" }, { weekday: "asc" }],
        select: {
          lineNumber: true,
          weekIndex: true,
          weekday: true,
          positionType: true,
          dutyCode: true,
        },
      },
    },
  });

  const rows = [
    "basisrooster;versie;lijn;week;weekdag;positie;dienst",
    ...version.days.map((day) =>
      [
        version.baseRoster.code,
        version.label,
        day.lineNumber,
        day.weekIndex,
        day.weekday,
        day.positionType,
        day.dutyCode ?? "",
      ].join(";"),
    ),
  ];

  await recordAudit({
    actor,
    action: "rooster.geexporteerd",
    objectType: "RosterVersion",
    objectId: versionId,
    newValue: { regels: version.days.length, formaat: "csv" },
  });

  return {
    filename: `${version.baseRoster.code}-${version.label}.csv`.replace(/\s+/g, "_"),
    content: rows.join("\n"),
  };
}

// ── Dashboard van de Rooster Commissie ───────────────────────────────────────

export interface ProfileQualityView {
  readonly profile: RosterProfile;
  readonly profileLabel: string;
  readonly baseRosters: number;
  readonly lines: number;
  readonly occupiedLines: number;
  /** Aandeel diensten per dagdeel binnen dit profiel, over de komende periode. */
  readonly shareEarly: number;
  readonly shareLate: number;
  readonly shareNight: number;
  readonly shareShunting: number;
  /** Aandeel weekenddagen dat gewerkt wordt binnen dit profiel. */
  readonly weekendLoad: number;
}

/**
 * De samenstelling per roosterprofiel.
 *
 * Dit is roosteranalyse en geen operationele stand: het gaat over de vraag
 * "hoe zit dit profiel in elkaar", niet over "wie rijdt morgen wat". Daarom
 * telt het over een periode van vier weken en niet over vandaag.
 *
 * De aandelen zijn beschrijvend. Er staat geen oordeel bij en geen streefwaarde:
 * welke verdeling gewenst is, hangt af van cao-afspraken die nog niet zijn
 * aangeleverd. Wat de commissie hier krijgt, is wat er feitelijk staat.
 */
export async function profileQuality(
  requestedLocation?: string | null,
): Promise<readonly ProfileQualityView[]> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const today = toCalendarDate(new Date());
  const from = toDatabaseDate(today);
  const to = toDatabaseDate(addDays(today, 27));

  const rosters = await prisma.baseRoster.findMany({
    where: depotFilter(scope),
    select: {
      profile: true,
      lines: {
        select: {
          id: true,
          _count: { select: { assignments: { where: { validUntil: null } } } },
        },
      },
    },
  });

  const scheduled = await prisma.scheduledDuty.findMany({
    where: { date: { gte: from, lte: to } },
    select: {
      date: true,
      positionType: true,
      employee: { select: { rosterProfile: true } },
      duty: { select: { kinds: true } },
    },
  });

  const byProfile = new Map<RosterProfile, ProfileQualityView>();

  for (const roster of rosters) {
    const existing = byProfile.get(roster.profile);
    const lines = roster.lines.length;
    const occupied = roster.lines.filter((line) => line._count.assignments > 0).length;
    byProfile.set(roster.profile, {
      profile: roster.profile,
      profileLabel: rosterProfileLabel(roster.profile),
      baseRosters: (existing?.baseRosters ?? 0) + 1,
      lines: (existing?.lines ?? 0) + lines,
      occupiedLines: (existing?.occupiedLines ?? 0) + occupied,
      shareEarly: 0,
      shareLate: 0,
      shareNight: 0,
      shareShunting: 0,
      weekendLoad: 0,
    });
  }

  for (const [profile, view] of byProfile) {
    const rows = scheduled.filter((row) => row.employee.rosterProfile === profile);
    const duties = rows.filter((row) => row.duty !== null);
    const total = duties.length || 1;

    const weekendDays = rows.filter((row) => isWeekend(toCalendarDate(row.date)));
    const weekendWorked = weekendDays.filter(
      (row) => row.positionType === "DUTY" || row.positionType === "RES",
    ).length;

    byProfile.set(profile, {
      ...view,
      shareEarly: duties.filter((row) => row.duty?.kinds.includes("VROEG")).length / total,
      shareLate: duties.filter((row) => row.duty?.kinds.includes("LAAT")).length / total,
      shareNight: duties.filter((row) => row.duty?.kinds.includes("NACHT")).length / total,
      shareShunting: duties.filter((row) => row.duty?.kinds.includes("RANGEER")).length / total,
      weekendLoad: weekendDays.length === 0 ? 0 : weekendWorked / weekendDays.length,
    });
  }

  return [...byProfile.values()].sort((a, b) => a.profileLabel.localeCompare(b.profileLabel));
}

export interface PublicationStatus {
  readonly activePackage: { readonly name: string; readonly version: number } | null;
  readonly baseRosters: number;
  readonly activeBaseRosters: number;
  readonly rosterLines: number;
  readonly draftVersions: number;
  readonly publishedVersions: number;
  readonly hardViolations: number;
  readonly warnings: number;
  readonly lastPublishedAt: Date | null;
  readonly waitlistEntries: number;
}

/** De publicatiestand van de dienstregeling. */
export async function publicationStatus(): Promise<PublicationStatus> {
  await requirePermission(PERMISSIONS.ROSTER_READ);

  const [
    activePackage,
    baseRosters,
    activeBaseRosters,
    rosterLines,
    drafts,
    publishedCount,
    violations,
    warnings,
    lastPublished,
    waitlist,
  ] = await Promise.all([
    prisma.dutyPackage.findFirst({
      where: { status: DutyPackageStatus.ACTIVE },
      orderBy: { version: "desc" },
      select: { name: true, version: true },
    }),
    prisma.baseRoster.count(),
    prisma.baseRoster.count({ where: { status: BaseRosterStatus.ACTIVE } }),
    prisma.rosterLine.count(),
    prisma.rosterVersion.count({
      where: { status: { in: [RosterVersionStatus.DRAFT, RosterVersionStatus.GENERATED] } },
    }),
    prisma.rosterVersion.count({ where: { status: RosterVersionStatus.PUBLISHED } }),
    prisma.rosterWarning.count({ where: { severity: "VIOLATION" } }),
    prisma.rosterWarning.count({ where: { severity: "WARNING" } }),
    prisma.rosterVersion.findFirst({
      where: { status: RosterVersionStatus.PUBLISHED },
      orderBy: { generatedAt: "desc" },
      select: { generatedAt: true },
    }),
    prisma.waitlistEntry.count({ where: { status: WaitlistStatus.ACTIVE } }),
  ]);

  return {
    activePackage,
    baseRosters,
    activeBaseRosters,
    rosterLines,
    draftVersions: drafts,
    publishedVersions: publishedCount,
    hardViolations: violations,
    warnings,
    lastPublishedAt: lastPublished?.generatedAt ?? null,
    waitlistEntries: waitlist,
  };
}

/**
 * Een roosterversie publiceren.
 *
 * ## Waarom harde overtredingen blokkeren en niet waarschuwen
 *
 * Een gepubliceerd rooster is het rooster waarop mensen hun leven inrichten.
 * Een waarschuwing die je kunt wegklikken, wordt weggeklikt. Een versie met een
 * overtreding van een harde regel wordt daarom door deze functie geweigerd, en
 * de weigering wordt vastgelegd — inclusief welke regels het waren.
 */
export async function publishVersion(versionId: string): Promise<{
  readonly ok: boolean;
  readonly reason: string;
}> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_PUBLISH);

  const version = await prisma.rosterVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      label: true,
      status: true,
      baseRoster: { select: { code: true } },
      warnings: { where: { severity: "VIOLATION" }, select: { ruleId: true } },
    },
  });
  if (!version) {
    return { ok: false, reason: "Onbekende roosterversie." };
  }
  if (version.status === RosterVersionStatus.PUBLISHED) {
    return { ok: false, reason: "Deze versie is al gepubliceerd." };
  }

  if (version.warnings.length > 0) {
    const rules = [...new Set(version.warnings.map((warning) => warning.ruleId))];
    await recordAudit({
      actor,
      action: "rooster.publicatie-geweigerd",
      objectType: "RosterVersion",
      objectId: versionId,
      result: "DENIED",
      newValue: { overtredingen: version.warnings.length, regels: rules },
      reason: "harde overtredingen",
    });
    return {
      ok: false,
      reason: `Deze versie heeft ${version.warnings.length} harde overtreding(en): ${rules.join(", ")}. Publiceren kan pas als die zijn opgelost.`,
    };
  }

  await prisma.rosterVersion.update({
    where: { id: versionId },
    data: { status: RosterVersionStatus.PUBLISHED },
  });

  await recordAudit({
    actor,
    action: "rooster.gepubliceerd",
    objectType: "RosterVersion",
    objectId: versionId,
    oldValue: { status: version.status },
    newValue: {
      status: RosterVersionStatus.PUBLISHED,
      rooster: version.baseRoster.code,
      versie: version.label,
    },
  });

  return { ok: true, reason: `${version.baseRoster.code} ${version.label} is gepubliceerd.` };
}
