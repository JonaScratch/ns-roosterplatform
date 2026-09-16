import "server-only";
import type { DutyKind } from "@/lib/generated/prisma/enums";
import { RosterProfile } from "@/lib/generated/prisma/enums";
import {
  allowedKindsForProfile,
  hasPendingProfileRules,
  profileAllowsDuty,
  rosterProfileLabel,
} from "@/domain/roster-profiles";
import { describeDutyKinds } from "@/domain/duty-classification";
import { isHardNightService, isNightServiceByTime, measureDuty } from "@/domain/duty-window";
import { formatDuration, formatMinuteOfDay, weekdayLabel } from "@/domain/time";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { locationScopeFor } from "@/server/security/location-scope";
import { dutyCoverage } from "./duty-coverage-service";

/**
 * De dienstenbak: de volledige dienstvoorraad van een standplaats.
 *
 * ## Waarom dit meer is dan een importresultaat
 *
 * Een importscherm laat zien wat er binnenkwam. De dienstenbak laat zien wat
 * er is: hoeveel diensten, van welke soort, waar ze terechtkomen en waar ze
 * vandaan komen. Dat is het overzicht waarop een roostermaker werkt, en het is
 * het enige plek waar de vraag "waar is dienst 101 gebleven" een antwoord
 * krijgt.
 *
 * ## Waarom hier niets wordt afgerond
 *
 * Elke telling hier is een telling van rijen, niet van een schatting. Een
 * dienst die nergens in past, telt mee als "niet plaatsbaar" en verdwijnt niet
 * in een restcategorie.
 */

export interface DutyPoolSummary {
  readonly locationCode: string;
  readonly packageLabel: string | null;
  readonly timetableId: string | null;
  readonly packageStatus: string | null;
  readonly sourceFilename: string | null;
  readonly checksum: string | null;
  readonly importedAt: Date | null;
  readonly total: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly placement: Readonly<Record<string, number>>;
  readonly notPlaceable: readonly { readonly code: string; readonly explanation: readonly string[] }[];
}

export interface DutyRow {
  readonly code: string;
  readonly kinds: readonly string[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly durationMinutes: number;
  readonly weekday: number;
  readonly weekdayLabel: string;
  readonly requiredQualifications: readonly string[];
  readonly description: string | null;
  readonly placement: string;
}

export async function dutyPool(requestedLocation?: string | null): Promise<{
  readonly summary: DutyPoolSummary;
  readonly duties: readonly DutyRow[];
}> {
  const actor = await requirePermission(PERMISSIONS.DUTY_PACKAGE_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const pakket = await prisma.dutyPackage.findFirst({
    where: { depot: scope.code, status: { in: ["ACTIVE", "CONFIRMED", "VALIDATED", "REVIEW_REQUIRED"] } },
    orderBy: [{ status: "asc" }, { version: "desc" }],
    include: { duties: { orderBy: { code: "asc" } } },
  });

  const dekking = await dutyCoverage(scope.code);
  // Op nummer + weekdag: dienst 101 van zondag heeft een eigen plaatsing en een
  // eigen uitleg, en die mag niet die van maandag worden.
  const perDienst = new Map(
    dekking.placements.map((placement) => [`${placement.code}|${placement.weekday}`, placement]),
  );

  const duties = (pakket?.duties ?? []).map((duty) => ({
    code: duty.code,
    kinds: duty.kinds as string[],
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    durationMinutes: duty.endMinute - duty.startMinute,
    weekday: duty.weekday,
    weekdayLabel: weekdayLabel(duty.weekday),
    requiredQualifications: duty.requiredQualifications,
    description: duty.description,
    placement: perDienst.get(`${duty.code}|${duty.weekday}`)?.category ?? "EXCLUDED",
  }));

  const byKind: Record<string, number> = {
    VROEG: 0,
    LAAT: 0,
    NACHT: 0,
    RESERVE: 0,
    RANGEER: 0,
  };
  for (const duty of duties) {
    for (const kind of duty.kinds) {
      if (kind in byKind) {
        byKind[kind] += 1;
      }
    }
  }

  return {
    summary: {
      locationCode: scope.code,
      packageLabel: pakket?.label ?? pakket?.name ?? null,
      timetableId: pakket?.timetableId ?? null,
      packageStatus: pakket?.status ?? null,
      sourceFilename: pakket?.sourceFilename ?? null,
      checksum: pakket?.sourceChecksum ?? null,
      importedAt: pakket?.importedAt ?? null,
      total: duties.length,
      byKind,
      placement: dekking.counts,
      notPlaceable: dekking.notPlaceable.map((placement) => ({
        code: placement.code,
        explanation: placement.explanation,
      })),
    },
    duties,
  };
}

// ── Eén dienst ───────────────────────────────────────────────────────────────

export interface ProfileFit {
  readonly profile: RosterProfile;
  readonly label: string;
  readonly fits: boolean;
  /** Waarom niet, of waarom het niet volledig te beoordelen is. */
  readonly explanation: string;
  readonly assessable: boolean;
}

export interface DutyPlacementSpot {
  readonly baseRosterCode: string;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
}

export interface DutyDetail {
  readonly code: string;
  readonly locationCode: string;
  readonly kinds: readonly string[];
  readonly kindLabel: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly durationMinutes: number;
  readonly breakMinutes: number | null;
  readonly overtimeMinutes: number;
  readonly nightByTime: boolean;
  readonly hardNight: boolean;
  readonly shunting: boolean;
  readonly weight: number;
  readonly description: string | null;
  readonly requiredQualifications: readonly string[];
  readonly qualificationsKnown: boolean;
  readonly weekday: number;
  readonly weekdayLabel: string;
  /** Dezelfde dienstcode op andere weekdagen. Elk met eigen tijden. */
  readonly variants: readonly {
    readonly weekday: number;
    readonly weekdayLabel: string;
    readonly startMinute: number;
    readonly endMinute: number;
  }[];
  readonly profileFits: readonly ProfileFit[];
  readonly placedIn: readonly DutyPlacementSpot[];
  readonly placement: string;
  readonly placementExplanation: readonly string[];
  /** Waar deze dienst vandaan komt. */
  readonly source: {
    readonly packageLabel: string | null;
    readonly filename: string | null;
    readonly checksum: string | null;
    readonly importedAt: Date | null;
    readonly row: number | null;
    readonly originalValues: Readonly<Record<string, string>> | null;
  };
}

/**
 * Eén dienst, op één weekdag.
 *
 * ## Waarom de weekdag hier een parameter is en geen bijzaak
 *
 * Er zijn zes diensten met nummer 101, elk op een andere weekdag en elk met
 * andere tijden. Een detailscherm dat er stilzwijgend één van kiest, toont de
 * verkeerde tijden bij het juiste nummer — en dat is een scherm dat er goed
 * uitziet en niet klopt. Zonder weekdag wordt de vroegste genomen, en het
 * scherm zegt er dan bij welke andere er zijn.
 */
export async function dutyDetail(
  code: string,
  weekday: number | null,
  requestedLocation?: string | null,
): Promise<DutyDetail | null> {
  const actor = await requirePermission(PERMISSIONS.DUTY_PACKAGE_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const varianten = await prisma.duty.findMany({
    where: { code, depot: scope.code },
    select: { weekday: true, startMinute: true, endMinute: true },
    orderBy: { weekday: "asc" },
  });

  const duty = await prisma.duty.findFirst({
    where: {
      code,
      depot: scope.code,
      ...(weekday === null ? {} : { weekday }),
    },
    orderBy: [{ package: { version: "desc" } }, { weekday: "asc" }],
    include: {
      package: {
        select: {
          label: true,
          name: true,
          sourceFilename: true,
          sourceChecksum: true,
          importedAt: true,
        },
      },
    },
  });
  if (!duty) {
    return null;
  }

  const shape = {
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    breakMinutes: duty.breakMinutes,
    overtimeMinutes: duty.overtimeMinutes,
  };

  // Alleen de profielen die op deze standplaats werkelijk bestaan. Een profiel
  // dat hier niet is ingericht, hoort niet als optie op het scherm te staan.
  const rosters = await prisma.baseRoster.findMany({
    where: { depot: scope.code },
    select: { profile: true },
    distinct: ["profile"],
  });

  const profileFits: ProfileFit[] = rosters.map((roster) => {
    const past = profileAllowsDuty(roster.profile, duty.kinds);
    const wachtend = hasPendingProfileRules(roster.profile);
    const toegestaan = allowedKindsForProfile(roster.profile).join("/");

    if (!past) {
      return {
        profile: roster.profile,
        label: rosterProfileLabel(roster.profile),
        fits: false,
        assessable: true,
        explanation:
          `Dienstsoort ${describeDutyKinds(duty.kinds)} is binnen profiel ` +
          `${rosterProfileLabel(roster.profile)} niet toegestaan; dat profiel staat ` +
          `${toegestaan} toe.`,
      };
    }
    if (wachtend) {
      return {
        profile: roster.profile,
        label: rosterProfileLabel(roster.profile),
        fits: true,
        assessable: false,
        explanation:
          "Het dagdeel past, maar de bijzondere regels voor dit profiel zijn niet " +
          "aangeleverd. Nog niet volledig te beoordelen.",
      };
    }
    return {
      profile: roster.profile,
      label: rosterProfileLabel(roster.profile),
      fits: true,
      assessable: true,
      explanation: `Het dagdeel past binnen dit profiel (${toegestaan}).`,
    };
  });

  const plekken = await prisma.rosterLineDay.findMany({
    where: {
      dutyCode: duty.code,
      // Ook op de weekdag: deze dienst staat op één dag in het rooster, en de
      // plekken van de gelijknamige dienst van een andere dag horen er niet bij.
      weekday: duty.weekday,
      positionType: "DUTY",
      rosterLine: { baseRoster: { depot: scope.code } },
    },
    select: {
      weekIndex: true,
      weekday: true,
      rosterLine: {
        select: { lineNumber: true, baseRoster: { select: { code: true } } },
      },
    },
    orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }],
  });

  const dekking = await dutyCoverage(scope.code);
  const plaatsing = dekking.placements.find(
    (placement) => placement.code === duty.code && placement.weekday === duty.weekday,
  );

  return {
    code: duty.code,
    locationCode: scope.code,
    kinds: duty.kinds,
    kindLabel: describeDutyKinds(duty.kinds),
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    durationMinutes: measureDuty({ date: "2026-01-05", shape }).dutyMinutes,
    breakMinutes: duty.breakMinutes,
    overtimeMinutes: duty.overtimeMinutes,
    nightByTime: isNightServiceByTime(shape),
    hardNight: isHardNightService(shape),
    shunting: duty.kinds.includes("RANGEER"),
    weight: duty.weight,
    description: duty.description,
    requiredQualifications: duty.requiredQualifications,
    // De bevoegdhedenmatrix is niet aangeleverd; wat hier staat komt uit het
    // pakket en is niet tegen een bronsysteem geverifieerd.
    qualificationsKnown: false,
    weekday: duty.weekday,
    weekdayLabel: weekdayLabel(duty.weekday),
    variants: varianten.map((variant) => ({
      weekday: variant.weekday,
      weekdayLabel: weekdayLabel(variant.weekday),
      startMinute: variant.startMinute,
      endMinute: variant.endMinute,
    })),
    profileFits,
    placedIn: plekken.map((plek) => ({
      baseRosterCode: plek.rosterLine.baseRoster.code,
      lineNumber: plek.rosterLine.lineNumber,
      weekIndex: plek.weekIndex,
      weekday: plek.weekday,
    })),
    placement: plaatsing?.category ?? "EXCLUDED",
    placementExplanation: plaatsing?.explanation ?? [],
    source: {
      packageLabel: duty.package.label ?? duty.package.name,
      filename: duty.package.sourceFilename,
      checksum: duty.package.sourceChecksum,
      importedAt: duty.package.importedAt,
      row: duty.sourceRow,
      originalValues: (duty.sourceValues as Record<string, string> | null) ?? null,
    },
  };
}

/** Korte omschrijving van een dienst voor een tooltip. */
export function dutyTooltip(duty: {
  readonly code: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly kinds: readonly DutyKind[];
}): string {
  return (
    `${duty.code}\n${formatMinuteOfDay(duty.startMinute)}–${formatMinuteOfDay(duty.endMinute)}` +
    `\n${describeDutyKinds(duty.kinds)}` +
    `\nduur ${formatDuration(duty.endMinute - duty.startMinute)}`
  );
}
