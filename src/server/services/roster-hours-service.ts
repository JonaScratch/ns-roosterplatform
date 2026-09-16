import "server-only";
import {
  type CycleDay,
  type RosterHours,
  formatHoursMinutes,
  hoursNotice,
  hoursVerdict,
  rosterHours,
} from "@/domain/roster-hours";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * De urenberekening van elk basisrooster, uit de database.
 *
 * ## Wat hier gebeurt en wat in het domein
 *
 * Deze dienst haalt de gegevens op en zet ze in de volgorde waarin een
 * medewerker ze rijdt. Het rekenwerk zelf staat in `src/domain/roster-hours.ts`
 * en kent geen database — zo is het toetsbaar zonder er een op te tuigen, en zo
 * kan de urenverificatie dezelfde berekening op een andere invoer loslaten.
 *
 * ## De volgorde is het hele punt
 *
 * Een roosterregel is geen week die zich herhaalt. Wie deze week op regel 6
 * staat, staat volgende week op regel 7, en na de laatste regel weer op 1. De
 * cyclus van een medewerker is dus de reis langs álle regels van zijn rooster.
 * Dat maakt uit voor de rusttijden: de rust tussen zondag van regel 6 en maandag
 * van regel 7 is een echte rustperiode tussen twee echte diensten, en die zie je
 * niet wanneer je één regel zeven keer achter elkaar legt.
 */

export interface RosterHoursView {
  readonly rosterCode: string;
  readonly rosterName: string;
  readonly profile: string;
  readonly profileLabel: string;
  readonly hours: RosterHours;
  readonly verdict: ReturnType<typeof hoursVerdict>;
  readonly notice: string | null;
  /** Hoeveel regels er op dit moment bezet zijn. */
  readonly occupiedLines: number;
  /** De weeklengte zoals het aangeleverde blad die zelf noemt, indien bekend. */
  readonly sourceAverage: string | null;
}

/** De uren van alle basisroosters van deze standplaats. */
export async function allRosterHours(
  requestedLocation?: string | null,
): Promise<readonly RosterHoursView[]> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const roosters = await prisma.baseRoster.findMany({
    where: { depot: scope.code },
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          days: { orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }] },
          assignments: { where: { validUntil: null }, take: 1, select: { id: true } },
        },
      },
    },
    orderBy: { code: "asc" },
  });

  // De dienstzijden in één keer, op identiteit: nummer én weekdag. Op nummer
  // alleen zou dienst 101 van zondag de tijden van maandag krijgen, en dan
  // klopt de urensom voor zes van de zeven dagen net niet.
  const diensten = await prisma.duty.findMany({
    where: { depot: scope.code },
    select: { code: true, weekday: true, startMinute: true, endMinute: true },
  });
  const dienstPerIdentiteit = new Map(
    diensten.map((duty) => [`${duty.code}|${duty.weekday}`, duty]),
  );

  const views: RosterHoursView[] = [];
  for (const rooster of roosters) {
    const days = cycleDays(rooster, dienstPerIdentiteit);
    const hours = rosterHours({
      days,
      lineCount: rooster.lines.length,
      weeksPerLine: rooster.cycleWeeks,
    });

    views.push({
      rosterCode: rooster.code,
      rosterName: rooster.name,
      profile: rooster.profile,
      profileLabel: rosterProfileLabel(rooster.profile),
      hours,
      verdict: hoursVerdict(hours),
      notice: hoursNotice(hours),
      occupiedLines: rooster.lines.filter((regel) => regel.assignments.length > 0).length,
      sourceAverage: null,
    });
  }

  return views;
}

/** De uren van één rooster. */
export async function rosterHoursFor(
  rosterCode: string,
  requestedLocation?: string | null,
): Promise<RosterHoursView | null> {
  const alle = await allRosterHours(requestedLocation);
  return alle.find((view) => view.rosterCode === rosterCode) ?? null;
}

/**
 * De dagen van één volledige cyclus, in rijvolgorde.
 *
 * Regel 1 week 1 tot en met week N, dan regel 2, enzovoort. Dat is precies de
 * reeks die een medewerker aflegt wanneer hij op regel 1 begint — en omdat elke
 * regel precies één keer aan de beurt komt, is het ook de reeks die élke
 * medewerker aflegt, alleen op een ander beginpunt. De uren en de rustintervallen
 * zijn daarmee voor iedereen gelijk; alleen het startmoment verschilt.
 */
function cycleDays(
  rooster: {
    readonly cycleWeeks: number;
    readonly lines: readonly {
      readonly lineNumber: number;
      readonly days: readonly {
        readonly weekIndex: number;
        readonly weekday: number;
        readonly positionType: string;
        readonly dutyCode: string | null;
      }[];
    }[];
  },
  diensten: ReadonlyMap<string, { startMinute: number; endMinute: number }>,
): readonly CycleDay[] {
  const days: CycleDay[] = [];

  for (const regel of rooster.lines) {
    for (let week = 1; week <= rooster.cycleWeeks; week += 1) {
      for (let weekdag = 1; weekdag <= 7; weekdag += 1) {
        const dag = regel.days.find(
          (kandidaat) => kandidaat.weekIndex === week && kandidaat.weekday === weekdag,
        );
        if (!dag) {
          // Een ontbrekende dag is geen rustdag. Hem als rust meetellen zou de
          // urensom lager maken en de rust langer — allebei de gunstige kant op.
          days.push({ positionType: "OPLEIDING", startMinute: null, endMinute: null });
          continue;
        }

        const dienst =
          dag.positionType === "DUTY" && dag.dutyCode
            ? diensten.get(`${dag.dutyCode}|${weekdag}`)
            : undefined;

        days.push({
          positionType: dag.positionType as CycleDay["positionType"],
          startMinute: dienst?.startMinute ?? null,
          endMinute: dienst?.endMinute ?? null,
        });
      }
    }
  }

  return days;
}

/** Voor schermen: de uren in een tabelvorm die direct te tonen is. */
export interface RosterHoursRow {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}

export function hoursRows(view: RosterHoursView): readonly RosterHoursRow[] {
  const uren = view.hours;
  return [
    {
      label: "Werkuren",
      value: formatHoursMinutes(uren.actualDutyMinutes),
      hint: `${uren.dutyDays} dienstdagen`,
    },
    {
      label: "WTV",
      value: formatHoursMinutes(uren.wtvCreditMinutes),
      hint: `${uren.wtvDays} dagen à 8:00`,
    },
    {
      label: "Overige roostercredit",
      value: formatHoursMinutes(uren.otherCreditedMinutes),
      hint: `${uren.reserveDays} reserve + ${uren.compensationDays} compensatie, à 8:00`,
    },
    {
      label: "Roosteruren totaal",
      value: formatHoursMinutes(uren.totalCreditMinutes),
      hint: `over ${uren.cycleWeeks} weken`,
    },
    {
      label: "Gemiddeld per week",
      value: formatHoursMinutes(uren.averageWeeklyCreditMinutes),
      hint:
        uren.deviationFromTargetMinutes === 0
          ? "exact op 40:00"
          : `${formatHoursMinutes(uren.deviationFromTargetMinutes)} ten opzichte van 40:00`,
    },
    {
      label: "Rustdagen",
      value: String(uren.restDays),
      hint:
        uren.shortestRestMinutes === null
          ? "geen diensten om rust tussen te meten"
          : `kortste rust ${formatHoursMinutes(uren.shortestRestMinutes)}, ` +
            `langste ${formatHoursMinutes(uren.longestRestMinutes ?? 0)}`,
    },
    {
      label: "Geplande rusturen",
      value: formatHoursMinutes(uren.restIntervalMinutes),
      hint: "gemeten tussen echte dienstgrenzen, niet rustdagen × 24",
    },
  ];
}
