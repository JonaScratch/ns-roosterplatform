import "server-only";
import { weekdayLabel } from "@/domain/time";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * Waar zit de druk in de week?
 *
 * ## Wat deze kaart laat zien
 *
 * Per weekdag en per dagdeel: hoeveel diensten er te rijden zijn, hoeveel
 * roosterregels daar een dienstdag hebben staan, en hoeveel reservedagen er
 * naast liggen. Het is een beschrijving en geen oordeel — er staat geen
 * streefwaarde bij, want welke bezetting gewenst is, hangt af van afspraken die
 * niet zijn aangeleverd.
 *
 * ## Waarom "krap" hier geen kleur met een norm is
 *
 * De verleiding is om alles onder de tachtig procent rood te maken. Dat getal
 * zou ik zelf verzinnen, en zodra het op een scherm staat, gaat iemand erop
 * sturen. Wat er wél staat is het verschil tussen wat er te rijden is en wat
 * ervoor is ingeroosterd; dat is een feit, en de lezer mag zelf vinden of het
 * krap is.
 *
 * ## Waarom per dagdeel en niet per uur
 *
 * Een uurraster suggereert een nauwkeurigheid die de bron niet heeft: een
 * dienst van 05:27 tot 12:32 beslaat zeven uren en is één dienst. Het dagdeel
 * volgt de indeling die de rest van het systeem ook gebruikt.
 */

export interface HeatmapCell {
  readonly weekday: number;
  readonly weekdayLabel: string;
  readonly period: "VROEG" | "LAAT" | "NACHT" | "GEEN";
  /** Diensten van dit dagdeel die op deze weekdag gereden moeten worden. */
  readonly duties: number;
  /** Roosterregels die op deze weekdag een dienst van dit dagdeel hebben. */
  readonly rosteredLines: number;
  /** Diensten die er zijn maar op geen enkele roosterregel staan. */
  readonly unplaced: number;
}

export interface HeatmapRow {
  readonly weekday: number;
  readonly weekdayLabel: string;
  readonly cells: readonly HeatmapCell[];
  readonly totalDuties: number;
  readonly totalRostered: number;
  readonly reserveDays: number;
  readonly restDays: number;
  /** Regels die deze dag vrij zijn: rust, WTV of compensatie. */
  readonly freeLines: number;
}

export interface CoverageHeatmap {
  readonly locationCode: string;
  readonly rows: readonly HeatmapRow[];
  readonly periods: readonly ("VROEG" | "LAAT" | "NACHT" | "GEEN")[];
  /** De hoogste celwaarde; de schaal van de kaart hangt hieraan. */
  readonly maxDuties: number;
  readonly totalDuties: number;
  readonly totalUnplaced: number;
  readonly packageLabel: string | null;
}

const PERIODES = ["VROEG", "LAAT", "NACHT", "GEEN"] as const;

export async function coverageHeatmap(
  requestedLocation?: string | null,
): Promise<CoverageHeatmap> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const [pakket, roosters] = await Promise.all([
    prisma.dutyPackage.findFirst({
      where: { depot: scope.code, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: {
        label: true,
        name: true,
        duties: { select: { code: true, weekday: true, period: true } },
      },
    }),
    prisma.baseRoster.findMany({
      where: { depot: scope.code },
      select: {
        lines: { select: { days: { select: { weekday: true, positionType: true, dutyCode: true } } } },
      },
    }),
  ]);

  const diensten = pakket?.duties ?? [];

  // Welke dienst-identiteiten staan er op een roosterregel? Nummer én weekdag,
  // want 101 van maandag ergens inroosteren zegt niets over 101 van zondag.
  const ingeroosterd = new Map<string, number>();
  const reservePerDag = new Map<number, number>();
  const rustPerDag = new Map<number, number>();
  const vrijPerDag = new Map<number, number>();

  for (const rooster of roosters) {
    for (const regel of rooster.lines) {
      for (const dag of regel.days) {
        if (dag.positionType === "DUTY" && dag.dutyCode) {
          const sleutel = `${dag.dutyCode}|${dag.weekday}`;
          ingeroosterd.set(sleutel, (ingeroosterd.get(sleutel) ?? 0) + 1);
        } else if (dag.positionType === "RES") {
          reservePerDag.set(dag.weekday, (reservePerDag.get(dag.weekday) ?? 0) + 1);
        } else if (dag.positionType === "RUST") {
          rustPerDag.set(dag.weekday, (rustPerDag.get(dag.weekday) ?? 0) + 1);
          vrijPerDag.set(dag.weekday, (vrijPerDag.get(dag.weekday) ?? 0) + 1);
        } else {
          vrijPerDag.set(dag.weekday, (vrijPerDag.get(dag.weekday) ?? 0) + 1);
        }
      }
    }
  }

  const rows: HeatmapRow[] = [];
  let maxDuties = 0;
  let totalDuties = 0;
  let totalUnplaced = 0;

  for (let weekdag = 1; weekdag <= 7; weekdag += 1) {
    const vanDeDag = diensten.filter((dienst) => dienst.weekday === weekdag);
    const cells: HeatmapCell[] = [];

    for (const periode of PERIODES) {
      const vanHetDagdeel = vanDeDag.filter((dienst) => dienst.period === periode);
      const geplaatst = vanHetDagdeel.filter((dienst) =>
        ingeroosterd.has(`${dienst.code}|${weekdag}`),
      );
      const aantalRegels = vanHetDagdeel.reduce(
        (som, dienst) => som + (ingeroosterd.get(`${dienst.code}|${weekdag}`) ?? 0),
        0,
      );

      maxDuties = Math.max(maxDuties, vanHetDagdeel.length);
      totalUnplaced += vanHetDagdeel.length - geplaatst.length;

      cells.push({
        weekday: weekdag,
        weekdayLabel: weekdayLabel(weekdag),
        period: periode,
        duties: vanHetDagdeel.length,
        rosteredLines: aantalRegels,
        unplaced: vanHetDagdeel.length - geplaatst.length,
      });
    }

    totalDuties += vanDeDag.length;
    rows.push({
      weekday: weekdag,
      weekdayLabel: weekdayLabel(weekdag),
      cells,
      totalDuties: vanDeDag.length,
      totalRostered: cells.reduce((som, cel) => som + cel.rosteredLines, 0),
      reserveDays: reservePerDag.get(weekdag) ?? 0,
      restDays: rustPerDag.get(weekdag) ?? 0,
      freeLines: vrijPerDag.get(weekdag) ?? 0,
    });
  }

  return {
    locationCode: scope.code,
    rows,
    periods: [...PERIODES],
    maxDuties,
    totalDuties,
    totalUnplaced,
    packageLabel: pakket?.label ?? pakket?.name ?? null,
  };
}
