import "server-only";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { toCalendarDate } from "@/domain/time";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import {
  type RosterDocument,
  cellFor,
  renderRosterDocument,
} from "@/server/export/roster-document";
import { brandLogoDataUri } from "@/server/branding/assets";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * Het roosterblad samenstellen uit de gegevens.
 *
 * ## Waarom hier bijna geen keuzes worden gemaakt
 *
 * Alles wat op het blad komt, komt uit de database of uit het regelbestand. Er
 * wordt niets afgerond, niets weggelaten en niets mooier gemaakt. Zelfs de zin
 * die zegt dat dit een simulatie is, komt uit de stand van het regelbestand en
 * niet uit een instelling die iemand kan omzetten.
 */

export interface ExportedRoster {
  readonly filename: string;
  readonly html: string;
  readonly document: RosterDocument;
}


export async function buildRosterDocument(
  rosterCode: string,
  requestedLocation?: string | null,
): Promise<RosterDocument> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const roster = await prisma.baseRoster.findFirst({
    // De standplaats zit in de zoekvoorwaarde en niet in een controle achteraf:
    // een rooster van een andere standplaats wordt niet gevonden in plaats van
    // gevonden-en-geweigerd.
    where: { code: rosterCode, depot: scope.code },
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          days: { orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }] },
          assignments: {
            where: { validUntil: null },
            take: 1,
            select: { employee: { select: { employeeNumber: true } } },
          },
        },
      },
    },
  });
  if (!roster) {
    throw new Error(`Rooster ${rosterCode} bestaat niet voor standplaats ${scope.code}.`);
  }

  const [location, periode, pakket] = await Promise.all([
    prisma.stationLocation.findUnique({ where: { code: scope.code } }),
    prisma.rosterPeriod.findFirst({
      where: { location: { code: scope.code } },
      orderBy: [{ year: "desc" }, { version: "desc" }],
    }),
    prisma.dutyPackage.findFirst({
      where: { depot: scope.code, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: { label: true, name: true, version: true },
    }),
  ]);

  const ruleset = activeRuleset();
  const lines = roster.lines.map((line) => {
    const weeks: string[][] = Array.from({ length: roster.cycleWeeks }, () =>
      Array.from({ length: 7 }, () => ""),
    );
    for (const day of line.days) {
      const week = weeks[day.weekIndex - 1];
      if (week) {
        week[day.weekday - 1] = cellFor(day.positionType, day.dutyCode);
      }
    }
    return {
      lineNumber: line.lineNumber,
      employeeNumber: line.assignments[0]?.employee.employeeNumber ?? null,
      weeks,
    };
  });

  return {
    meta: {
      logoDataUri: brandLogoDataUri(),
      locationCode: scope.code,
      locationName: location?.name ?? scope.code,
      rosterCode: roster.code,
      rosterName: roster.name,
      profileLabel: rosterProfileLabel(roster.profile),
      timetableId: periode?.timetableId ?? "niet vastgelegd",
      periodLabel: periode
        ? `${toCalendarDate(periode.validFrom)} — ${
            periode.validUntil ? toCalendarDate(periode.validUntil) : "open"
          }`
        : "geen roosterperiode vastgelegd",
      changeType: (periode?.changeType ?? "NEW_TIMETABLE") as "NEW_TIMETABLE" | "AMENDMENT",
      structureState: periode?.structureState ?? "STRUCTURE_EDITABLE",
      rulesetVersion: ruleset.version,
      rulesetMode: ruleset.mode,
      legalStatus: ruleset.legalStatus,
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
      generatedBy: actor.employeeNumber,
      // Eén bron voor deze bewering, en die staat niet in dit bestand.
      productionSafe:
        ruleset.mode === "PRODUCTION" && ruleset.legalStatus === "LEGAL_RULESET_VERIFIED",
      dutyPackageLabel: pakket?.label ?? pakket?.name ?? null,
    },
    lines,
  };
}

/** Het blad als printbare HTML, met een auditregel omdat het naar buiten gaat. */
export async function exportRoster(
  rosterCode: string,
  requestedLocation?: string | null,
): Promise<ExportedRoster> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const document = await buildRosterDocument(rosterCode, requestedLocation);
  const html = renderRosterDocument(document);

  await recordAudit({
    actor,
    action: "rooster.geexporteerd",
    objectType: "BaseRoster",
    objectId: document.meta.rosterCode,
    newValue: {
      standplaats: document.meta.locationCode,
      lijnen: document.lines.length,
      simulatie: !document.meta.productionSafe,
      regelbestand: document.meta.rulesetVersion,
    },
  });

  const stempel = document.meta.productionSafe ? "" : "-SIMULATIE";
  return {
    filename: `${document.meta.locationCode}-${document.meta.rosterCode}${stempel}.html`,
    html,
    document,
  };
}
