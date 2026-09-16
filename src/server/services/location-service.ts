import "server-only";
import {
  CONFIGURED_LOCATION,
  NOT_CONFIGURED_MESSAGE,
  PLANNING_UNITS,
  PLANNING_UNIT_NOTE,
  REGIONS,
  STATIONS,
} from "@/domain/locations";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * Standplaatsen: registreren, tonen en pas inrichten wanneer het kan.
 *
 * ## Waarom een standplaats niet met één vinkje aangaat
 *
 * `planningEnabled` is geen voorkeur maar een bewering: hier kan gepland
 * worden. Die bewering is onwaar zolang er geen diensten, geen roosters, geen
 * lokale regels en geen exportsjabloon zijn. Eén checkbox die dat overslaat,
 * levert een standplaats op die er werkend uitziet en het niet is — en de
 * eerste die daar last van heeft is een machinist met een rooster dat nergens
 * op stoelt. Vandaar de readiness check.
 */

export interface LocationReadiness {
  readonly dutiesImported: boolean;
  readonly rosterProfilesConfigured: boolean;
  readonly localRulesConfigured: boolean;
  readonly qualificationsConfigured: boolean;
  readonly exportTemplateConfigured: boolean;
  readonly legalRulesetValid: boolean;
  /** Mag `planningEnabled` aan? Alleen wanneer alles hierboven klopt. */
  readonly ready: boolean;
  readonly missing: readonly string[];
}

export interface LocationOverview {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly regionName: string;
  readonly active: boolean;
  readonly planningEnabled: boolean;
  readonly dutiesConfigured: boolean;
  readonly rostersConfigured: boolean;
  readonly rulesConfigured: boolean;
  readonly exportTemplateConfigured: boolean;
  readonly optimizerMode: string;
  readonly units: readonly { readonly code: string; readonly name: string }[];
}

// ── Masterdata bijwerken ─────────────────────────────────────────────────────

/**
 * Zet de landelijke standplaatsstructuur klaar.
 *
 * Idempotent: opnieuw draaien verandert niets aan de inrichtingsstatus van een
 * standplaats. Alleen naam en regio worden bijgewerkt, zodat een correctie in
 * de bron doorkomt zonder dat Dordrecht zijn inrichting kwijtraakt.
 */
export async function syncLocationMasterData(): Promise<{
  readonly regions: number;
  readonly locations: number;
  readonly units: number;
}> {
  for (const region of REGIONS) {
    await prisma.region.upsert({
      where: { code: region.code },
      update: { name: region.name, note: region.note ?? null },
      create: { code: region.code, name: region.name, note: region.note ?? null },
    });
  }

  const regionIds = new Map(
    (await prisma.region.findMany({ select: { id: true, code: true } })).map((region) => [
      region.code,
      region.id,
    ]),
  );

  for (const station of STATIONS) {
    const configured = station.code === CONFIGURED_LOCATION;
    await prisma.stationLocation.upsert({
      where: { code: station.code },
      // Bewust niets over inrichting bijwerken: dat is een toestand van het
      // systeem en geen eigenschap van de bronlijst.
      update: { name: station.name, regionId: regionIds.get(station.region)! },
      create: {
        code: station.code,
        name: station.name,
        regionId: regionIds.get(station.region)!,
        active: true,
        planningEnabled: configured,
        dutiesConfigured: configured,
        rostersConfigured: configured,
        rulesConfigured: configured,
        exportTemplateConfigured: configured,
        optimizerMode: configured ? "SIMULATION" : "DISABLED",
      },
    });
  }

  const locationIds = new Map(
    (await prisma.stationLocation.findMany({ select: { id: true, code: true } })).map(
      (location) => [location.code, location.id],
    ),
  );

  for (const unit of PLANNING_UNITS) {
    await prisma.planningUnit.upsert({
      where: { code: unit.code },
      update: { name: unit.name, note: PLANNING_UNIT_NOTE },
      create: {
        code: unit.code,
        name: unit.name,
        note: PLANNING_UNIT_NOTE,
        locationId: locationIds.get(unit.parent)!,
      },
    });
  }

  return { regions: REGIONS.length, locations: STATIONS.length, units: PLANNING_UNITS.length };
}

// ── Lezen ────────────────────────────────────────────────────────────────────

export async function listLocations(): Promise<readonly LocationOverview[]> {
  await requirePermission(PERMISSIONS.ROSTER_READ);
  return allLocations();
}

/** Zonder rechtencontrole, voor gebruik binnen andere geautoriseerde services. */
export async function allLocations(): Promise<readonly LocationOverview[]> {
  const rows = await prisma.stationLocation.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      active: true,
      planningEnabled: true,
      dutiesConfigured: true,
      rostersConfigured: true,
      rulesConfigured: true,
      exportTemplateConfigured: true,
      optimizerMode: true,
      region: { select: { name: true } },
      units: { orderBy: { code: "asc" }, select: { code: true, name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    regionName: row.region.name,
    active: row.active,
    planningEnabled: row.planningEnabled,
    dutiesConfigured: row.dutiesConfigured,
    rostersConfigured: row.rostersConfigured,
    rulesConfigured: row.rulesConfigured,
    exportTemplateConfigured: row.exportTemplateConfigured,
    optimizerMode: row.optimizerMode,
    units: row.units,
  }));
}

export async function locationByCode(code: string): Promise<LocationOverview | null> {
  const locations = await allLocations();
  return locations.find((location) => location.code === code) ?? null;
}

/**
 * De standplaats waarin gewerkt wordt.
 *
 * Valt terug op de enige ingerichte standplaats. Een onbekende of
 * niet-ingerichte code levert wél die standplaats op — met `planningEnabled`
 * op false — zodat het scherm kan uitleggen wat er aan de hand is in plaats van
 * stilletjes Dordrecht te tonen.
 */
export async function resolveLocation(requested: string | null): Promise<LocationOverview> {
  const locations = await allLocations();
  const found = requested ? locations.find((location) => location.code === requested) : null;
  return (
    found ??
    locations.find((location) => location.code === CONFIGURED_LOCATION) ??
    locations[0]
  );
}

export { NOT_CONFIGURED_MESSAGE };

// ── Readiness ────────────────────────────────────────────────────────────────

/**
 * Kan hier gepland worden?
 *
 * Zes voorwaarden, elk afgeleid uit wat er werkelijk in de database staat en
 * niet uit een vinkje dat iemand ooit heeft aangezet. De laatste — een
 * gevalideerde juridische regelverzameling — is op dit moment voor élke
 * standplaats onwaar, ook voor Dordrecht. Dat is precies waarom Dordrecht in
 * simulatiemodus draait en niet in productie.
 */
export async function readinessOf(code: string): Promise<LocationReadiness> {
  const { activeRuleset } = await import("@/server/rules-engine/ruleset/index");
  const ruleset = activeRuleset();

  const [duties, rosters, employeesWithQualifications, location] = await Promise.all([
    prisma.duty.count({ where: { depot: code } }),
    prisma.baseRoster.count({ where: { depot: code } }),
    prisma.employee.count({ where: { depot: code, NOT: { qualifications: { isEmpty: true } } } }),
    prisma.stationLocation.findUnique({
      where: { code },
      select: { rulesConfigured: true, exportTemplateConfigured: true },
    }),
  ]);

  const checks = {
    dutiesImported: duties > 0,
    rosterProfilesConfigured: rosters > 0,
    localRulesConfigured: location?.rulesConfigured ?? false,
    qualificationsConfigured: employeesWithQualifications > 0,
    exportTemplateConfigured: location?.exportTemplateConfigured ?? false,
    legalRulesetValid: ruleset.legalStatus === "LEGAL_RULESET_VERIFIED",
  };

  const labels: Record<keyof typeof checks, string> = {
    dutiesImported: "Dienstenpakket geïmporteerd",
    rosterProfilesConfigured: "Roosterprofielen ingericht",
    localRulesConfigured: "Lokale regels ingericht",
    qualificationsConfigured: "Bevoegdheden vastgelegd",
    exportTemplateConfigured: "Exportsjabloon ingericht",
    legalRulesetValid: "Juridische regelverzameling gevalideerd",
  };

  const missing = (Object.keys(checks) as (keyof typeof checks)[])
    .filter((key) => !checks[key])
    .map((key) => labels[key]);

  return { ...checks, ready: missing.length === 0, missing };
}

/**
 * Zet een standplaats aan of uit.
 *
 * Aanzetten kan alleen wanneer de readiness check dat toelaat. Er is geen
 * parameter om die controle over te slaan: een beheerder die een standplaats
 * "toch even" openzet, zou daarmee een bewering doen die het systeem niet kan
 * waarmaken.
 */
export async function setPlanningEnabled(code: string, enabled: boolean): Promise<LocationReadiness> {
  const actor = await requirePermission(PERMISSIONS.LOCATION_MANAGE);
  const readiness = await readinessOf(code);

  if (enabled && !readiness.ready) {
    await recordAudit({
      actor,
      action: "standplaats.inschakelen-geweigerd",
      objectType: "StationLocation",
      objectId: code,
      result: "DENIED",
      reason: `Nog niet gereed: ${readiness.missing.join(", ")}.`,
    });
    return readiness;
  }

  await prisma.stationLocation.update({
    where: { code },
    data: { planningEnabled: enabled },
  });

  await recordAudit({
    actor,
    action: enabled ? "standplaats.ingeschakeld" : "standplaats.uitgeschakeld",
    objectType: "StationLocation",
    objectId: code,
    result: "SUCCESS",
    newValue: { planningEnabled: enabled },
  });

  return readiness;
}
