import "server-only";
import type { CandidateAssignment } from "@/domain/candidate";
import {
  type PackageQuality,
  type QualityDuty,
  type QualityRosterInput,
  measurePackage,
  nightRosterCodesOf,
} from "@/domain/roster-quality";
import { allowedKindsForProfile } from "@/domain/roster-profiles";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * Roosterkwaliteit uit de database: het huidige rooster en elke kandidaat.
 *
 * ## Waarom dezelfde context voor allebei
 *
 * Een kandidaat en het officiële rooster worden met exact dezelfde diensten,
 * dezelfde roosterstructuur en dezelfde lijst nachtroosters gemeten. Anders
 * vergelijk je twee getallen die op verschillende invoer rusten, en is het
 * verschil tussen "Nulmeting" en "Optimale totaalbalans" deels een verschil in
 * meetopzet.
 *
 * ## Kern zonder toegangscheck
 *
 * De `…Core`-functies nemen geen actor en doen geen toegangscontrole; de
 * generatiepijplijn en de verificatiescripts roepen ze aan. Wat vanuit een
 * scherm komt, gaat via de functies met toegangscheck eronder.
 */

export interface QualityContext {
  readonly locationCode: string;
  readonly duties: ReadonlyMap<string, QualityDuty>;
  readonly requiredDuties: number;
  /** Het huidige rooster, per basisrooster, in dezelfde vorm als een kandidaat. */
  readonly official: readonly QualityRosterInput[];
  readonly nightRosterCodes: readonly string[];
}

export async function loadQualityContextCore(locationCode: string): Promise<QualityContext> {
  const [diensten, roosters] = await Promise.all([
    prisma.duty.findMany({
      where: { package: { status: "ACTIVE" }, depot: locationCode },
      select: { code: true, weekday: true, startMinute: true, endMinute: true, kinds: true },
    }),
    prisma.baseRoster.findMany({
      where: { depot: locationCode, status: { in: ["ACTIVE", "DRAFT"] } },
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        profile: true,
        cycleWeeks: true,
        lines: {
          orderBy: { lineNumber: "asc" },
          select: {
            lineNumber: true,
            days: {
              orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }],
              select: { weekIndex: true, weekday: true, positionType: true, dutyCode: true },
            },
          },
        },
      },
    }),
  ]);

  const duties = new Map<string, QualityDuty>(
    diensten.map((duty) => [
      `${duty.code}|${duty.weekday}`,
      { ...duty, kinds: [...duty.kinds] },
    ]),
  );
  const official: QualityRosterInput[] = roosters.map((rooster) => ({
    code: rooster.code,
    name: rooster.name,
    profile: rooster.profile,
    weeksPerLine: rooster.cycleWeeks,
    days: rooster.lines.flatMap((regel) =>
      regel.days.map((dag) => ({
        lineNumber: regel.lineNumber,
        weekIndex: dag.weekIndex,
        weekday: dag.weekday,
        positionType: dag.positionType,
        dutyCode: dag.dutyCode,
      })),
    ),
  }));

  return {
    locationCode,
    duties,
    requiredDuties: diensten.length,
    official,
    nightRosterCodes: nightRosterCodesOf(official, duties, (profile) =>
      allowedKindsForProfile(profile as RosterProfile).includes("NACHT"),
    ),
  };
}

/**
 * De roosters van een kandidaat, in de vorm van het officiële rooster.
 *
 * Naam, profiel en weken per regel komen van het basisrooster; de dagen uit de
 * kandidaat. Een basisrooster dat in de kandidaat ontbreekt, ontbreekt hier ook
 * — geen stille terugval op het huidige rooster, want dan meet je het
 * verkeerde rooster en ziet het er goed uit.
 */
export function candidateRosterInputs(
  assignments: readonly CandidateAssignment[],
  context: QualityContext,
): readonly QualityRosterInput[] {
  const perRooster = new Map<string, CandidateAssignment[]>();
  for (const entry of assignments) {
    const lijst = perRooster.get(entry.baseRosterCode) ?? [];
    lijst.push(entry);
    perRooster.set(entry.baseRosterCode, lijst);
  }
  return context.official
    .filter((rooster) => perRooster.has(rooster.code))
    .map((rooster) => ({
      code: rooster.code,
      name: rooster.name,
      profile: rooster.profile,
      weeksPerLine: rooster.weeksPerLine,
      days: perRooster.get(rooster.code)!.map((entry) => ({
        lineNumber: entry.lineNumber,
        weekIndex: entry.weekIndex,
        weekday: entry.weekday,
        positionType: entry.positionType,
        dutyCode: entry.dutyCode,
      })),
    }));
}

export function measureOfficialCore(context: QualityContext): PackageQuality {
  return measurePackage(context.official, context.duties, {
    requiredDuties: context.requiredDuties,
    nightRosterCodes: context.nightRosterCodes,
    reference: context.official,
  });
}

export function measureAssignmentsCore(
  assignments: readonly CandidateAssignment[],
  context: QualityContext,
): PackageQuality {
  return measurePackage(candidateRosterInputs(assignments, context), context.duties, {
    requiredDuties: context.requiredDuties,
    nightRosterCodes: context.nightRosterCodes,
    reference: context.official,
  });
}

// ── Met toegangscheck ────────────────────────────────────────────────────────

export async function officialQuality(requestedLocation?: string | null): Promise<PackageQuality> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, requestedLocation);
  return measureOfficialCore(await loadQualityContextCore(scope.code));
}
