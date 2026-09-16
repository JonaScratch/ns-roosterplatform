import "server-only";
import { type PlacementSummary, categoriseDuties } from "@/domain/duty-placement";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { locationScopeFor } from "@/server/security/location-scope";

/**
 * Waar de diensten van een standplaats terechtkomen.
 *
 * ## Waarom dit uit de gegevens komt en niet uit de simulatie
 *
 * De verleiding is om deze indeling door de optimizer te laten maken: die weet
 * immers wat hij geplaatst heeft. Precies daarom niet. Een optimizer die zijn
 * eigen dekkingsrapport schrijft, rapporteert wat hij van plan was — en een
 * dienst die hij nooit heeft overwogen, komt in geen enkele categorie voor.
 *
 * Deze telling begint daarom bij het dienstenpakket: elke dienst die erin zit,
 * krijgt een categorie, of hij nu ergens is beland of niet. Wat overblijft, is
 * het antwoord op de vraag die er werkelijk toe doet: welke diensten kan
 * niemand rijden, en waarom niet.
 */

export interface CoverageOverview extends PlacementSummary {
  readonly locationCode: string;
  readonly packageLabel: string | null;
  readonly dutiesInPackage: number;
  readonly reserveSlotsPerWeek: number;
}

export async function dutyCoverage(requestedLocation?: string | null): Promise<CoverageOverview> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const [pakket, rosters, qualifications] = await Promise.all([
    prisma.dutyPackage.findFirst({
      where: { depot: scope.code, status: "ACTIVE" },
      orderBy: { version: "desc" },
      include: {
        duties: {
          select: {
            code: true,
            weekday: true,
            kinds: true,
            requiredQualifications: true,
            depot: true,
          },
          orderBy: [{ code: "asc" }, { weekday: "asc" }],
        },
      },
    }),
    prisma.baseRoster.findMany({
      where: { depot: scope.code },
      select: {
        code: true,
        profile: true,
        lines: {
          select: { days: { select: { positionType: true, dutyCode: true, weekday: true } } },
        },
      },
    }),
    prisma.employee.findMany({
      where: { depot: scope.code, status: "ACTIVE" },
      select: { qualifications: true },
    }),
  ]);

  const inFixedRosters = new Set<string>();
  let reserveSlots = 0;
  for (const roster of rosters) {
    for (const line of roster.lines) {
      for (const day of line.days) {
        if (day.positionType === "DUTY" && day.dutyCode) {
          inFixedRosters.add(`${day.dutyCode}|${day.weekday}`);
        }
        if (day.positionType === "RES") {
          reserveSlots += 1;
        }
      }
    }
  }

  // Reservedagen per week: het totaal gedeeld door het aantal cyclusweken dat
  // die dagen beslaan. Zonder roosters is dat nul, en dat is dan ook precies
  // wat er beschikbaar is.
  const cyclusDagen = rosters.reduce(
    (som, roster) =>
      som + roster.lines.reduce((lijnSom, line) => lijnSom + line.days.length, 0),
    0,
  );
  const weken = cyclusDagen > 0 ? cyclusDagen / 7 : 0;
  const reserveSlotsPerWeek = weken > 0 ? Math.round((reserveSlots / weken) * 10) / 10 : 0;

  const availableQualifications = new Set(
    qualifications.flatMap((employee) => employee.qualifications),
  );

  const summary = categoriseDuties({
    locationCode: scope.code,
    duties: pakket?.duties ?? [],
    inFixedRosters,
    profiles: [...new Set(rosters.map((roster) => roster.profile))],
    reserveSlotsPerWeek,
    availableQualifications,
  });

  return {
    ...summary,
    locationCode: scope.code,
    packageLabel: pakket?.label ?? pakket?.name ?? null,
    dutiesInPackage: pakket?.duties.length ?? 0,
    reserveSlotsPerWeek,
  };
}
