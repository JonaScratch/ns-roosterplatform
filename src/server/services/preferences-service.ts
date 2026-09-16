import "server-only";
import type { ReservePreferenceKind } from "@/lib/generated/prisma/enums";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";
import {
  type RosterPreferences,
  parsePreferences,
  rosterPreferencesSchema,
} from "@/server/validation/preferences";

/**
 * Eigen rooster- en reservevoorkeuren.
 *
 * Er is geen functie in dit bestand die de voorkeuren van iemand anders leest
 * of schrijft. Dat is een keuze, geen omissie: voorkeuren zijn van de
 * medewerker, en de optimizer krijgt ze straks via de rooster-engine, niet via
 * een planner die ze kan doorbladeren.
 */

export interface PreferencesView {
  readonly reservePreference: ReservePreferenceKind;
  readonly preferences: RosterPreferences;
  /**
   * Zit deze medewerker in een reserverooster?
   *
   * Alleen dan is een reservevoorkeur ergens goed voor. Wie op een vaste
   * roosterregel staat, rijdt de diensten van die regel; een dagdeelvoorkeur
   * verandert daar niets aan en zou beloven wat niet waargemaakt kan worden.
   */
  readonly inReserveRoster: boolean;
}

export async function ownPreferences(): Promise<PreferencesView> {
  const actor = await requirePermission(PERMISSIONS.PREFERENCES_MANAGE_OWN);
  const row = await prisma.employee.findUniqueOrThrow({
    where: { id: actor.employeeId },
    select: { reservePreference: true, preferences: true },
  });
  return {
    reservePreference: row.reservePreference,
    preferences: parsePreferences(row.preferences),
    inReserveRoster: await isInReserveRoster(actor.employeeId),
  };
}

/**
 * Staat deze medewerker vandaag op een reserverooster?
 *
 * Op de plaatsing gekeken en niet op het profielveld van de medewerker: de
 * plaatsing zegt waar hij werkelijk staat, het profielveld waar hij ooit is
 * ingedeeld. Bij een tijdelijke plaatsing lopen die twee uit elkaar, en dan
 * telt waar hij nu rijdt.
 */
export async function isInReserveRoster(employeeId: string): Promise<boolean> {
  const vandaag = new Date();
  const plaatsing = await prisma.rosterMembership.findFirst({
    where: {
      employeeId,
      status: "ACTIVE",
      validFrom: { lte: vandaag },
      OR: [{ validUntil: null }, { validUntil: { gte: vandaag } }],
    },
    orderBy: [{ placementType: "asc" }, { validFrom: "desc" }],
    select: { baseRoster: { select: { profile: true } } },
  });
  return plaatsing?.baseRoster.profile === "RESERVE";
}

export async function updateOwnPreferences(input: {
  readonly reservePreference: ReservePreferenceKind;
  readonly preferences: unknown;
}): Promise<{ ok: boolean; reason?: string }> {
  const actor = await requirePermission(PERMISSIONS.PREFERENCES_MANAGE_OWN);

  const parsed = rosterPreferencesSchema.safeParse(input.preferences);
  if (!parsed.success) {
    return { ok: false, reason: "De opgegeven voorkeuren zijn niet geldig." };
  }

  const before = await prisma.employee.findUniqueOrThrow({
    where: { id: actor.employeeId },
    select: { reservePreference: true, preferences: true },
  });

  await prisma.employee.update({
    where: { id: actor.employeeId },
    data: { reservePreference: input.reservePreference, preferences: parsed.data },
  });

  await recordAudit({
    actor,
    action: "voorkeuren.gewijzigd",
    objectType: "Employee",
    objectId: actor.employeeId,
    oldValue: { reservevoorkeur: before.reservePreference, voorkeuren: before.preferences },
    newValue: { reservevoorkeur: input.reservePreference, voorkeuren: parsed.data },
  });

  return { ok: true };
}
