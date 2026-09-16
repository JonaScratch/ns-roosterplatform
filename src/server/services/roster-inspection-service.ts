import "server-only";
import type { DutyKind, RosterPositionType } from "@/lib/generated/prisma/enums";
import { describeDutyKinds } from "@/domain/duty-classification";
import {
  type DutyShape,
  isHardNightService,
  isNightServiceByTime,
  measureDuty,
  restBetween,
} from "@/domain/duty-window";
import { anchorLabel } from "@/domain/roster-structure";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { formatDuration, formatMinuteOfDay, weekdayLabel } from "@/domain/time";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { locationScopeFor } from "@/server/security/location-scope";

/**
 * Het rooster om naar te kijken.
 *
 * ## Waarom dit vooral een leesscherm is
 *
 * Een roostermaker moet een rooster kunnen doorgronden voordat hij het
 * verandert: welke dienst staat waar, wat komt ervoor, wat komt erna, hoeveel
 * rust zit ertussen, en waarom staat er op donderdag rust. Dat is geen
 * bewerking maar een inspectie, en het is de stap die nu ontbrak — de kaarten
 * lagen in de database en nergens op tafel.
 *
 * ## Waarom de rust hier wordt uitgerekend en niet opgezocht
 *
 * De rusttijd tussen twee cyclusdagen is geen opgeslagen veld maar een gevolg
 * van twee diensten. Hem hier berekenen met dezelfde domeinfunctie als de
 * rules engine (`restBetween`, zomertijdbewust) voorkomt dat het scherm iets
 * anders laat zien dan de validator rekent.
 */

export interface CellView {
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: RosterPositionType;
  readonly dutyCode: string | null;
  readonly label: string;
  /** Korte typering voor de badge: dagdeel of ankersoort. */
  readonly badge: string;
  readonly kinds: readonly DutyKind[];
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly durationMinutes: number | null;
  readonly nightByTime: boolean;
  readonly hardNight: boolean;
  readonly shunting: boolean;
  readonly weekend: boolean;
  /** Werkelijke rust vóór deze dienst, in minuten. Null wanneer onbekend. */
  readonly restBefore: number | null;
  readonly restAfter: number | null;
  readonly previousCode: string | null;
  readonly nextCode: string | null;
  /** Eén regel uitleg, in bedrijfstaal. */
  readonly summary: string;
}

export interface LineView {
  readonly lineNumber: number;
  readonly occupiedBy: string | null;
  readonly cells: readonly CellView[];
  readonly dutyDays: number;
  readonly nightDuties: number;
  readonly shuntingDuties: number;
  readonly weekendDuties: number;
  readonly restDays: number;
  readonly reserveDays: number;
  /** De kortste geplande rust binnen de cyclus, in minuten. */
  readonly shortestRest: number | null;
}

export interface RosterView {
  readonly code: string;
  readonly name: string;
  readonly profileLabel: string;
  readonly locationCode: string;
  readonly cycleWeeks: number;
  readonly lines: readonly LineView[];
  readonly totals: {
    readonly lines: number;
    readonly dutyDays: number;
    readonly nightDuties: number;
    readonly shuntingDuties: number;
    readonly weekendDuties: number;
    readonly emptyDutyDays: number;
  };
  readonly extremes: {
    readonly shortestRest: { readonly line: number; readonly minutes: number } | null;
    readonly longestDuty: { readonly line: number; readonly code: string; readonly minutes: number } | null;
    readonly mostNights: { readonly line: number; readonly count: number } | null;
    readonly mostShunting: { readonly line: number; readonly count: number } | null;
    readonly mostWeekends: { readonly line: number; readonly count: number } | null;
  };
}

export async function rosterView(
  code: string,
  requestedLocation?: string | null,
): Promise<RosterView | null> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const roster = await prisma.baseRoster.findFirst({
    where: { code, depot: scope.code },
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
    return null;
  }

  const duties = await prisma.duty.findMany({
    where: { depot: scope.code },
    select: {
      code: true,
      kinds: true,
      startMinute: true,
      endMinute: true,
      breakMinutes: true,
      overtimeMinutes: true,
    },
  });
  const perCode = new Map(duties.map((duty) => [duty.code, duty]));

  const cycleDays = roster.cycleWeeks * 7;
  const lines: LineView[] = roster.lines.map((line) => {
    const dagen = [...line.days].sort(
      (a, b) => (a.weekIndex - b.weekIndex) * 7 + (a.weekday - b.weekday),
    );

    // Een cyclus is rond: na de laatste dag komt de eerste weer.
    const cells: CellView[] = dagen.map((dag, index) => {
      const duty = dag.dutyCode ? perCode.get(dag.dutyCode) : undefined;
      const vorige = vorigeDienst(dagen, index, perCode);
      const volgende = volgendeDienst(dagen, index, perCode);

      const shape: DutyShape | null = duty
        ? {
            startMinute: duty.startMinute,
            endMinute: duty.endMinute,
            breakMinutes: duty.breakMinutes,
            overtimeMinutes: duty.overtimeMinutes,
          }
        : null;

      // Voor de rustberekening gebruiken we fictieve maar consistente datums:
      // de cyclusdag bepaalt de afstand, niet de kalender.
      const datum = fictieveDatum(index);
      const restBefore =
        shape && vorige
          ? restBetween(
              { date: fictieveDatum(vorige.index - (vorige.index > index ? cycleDays : 0)), shape: vorige.shape },
              { date: datum, shape },
            )
          : null;
      const restAfter =
        shape && volgende
          ? restBetween(
              { date: datum, shape },
              {
                date: fictieveDatum(
                  volgende.index + (volgende.index < index ? cycleDays : 0),
                ),
                shape: volgende.shape,
              },
            )
          : null;

      const weekend = dag.weekday >= 6;
      return {
        weekIndex: dag.weekIndex,
        weekday: dag.weekday,
        positionType: dag.positionType,
        dutyCode: dag.dutyCode,
        label:
          dag.positionType === "DUTY"
            ? (dag.dutyCode ?? "?")
            : kortLabel(dag.positionType),
        badge:
          dag.positionType === "DUTY"
            ? duty
              ? describeDutyKinds(duty.kinds)
              : "dienst"
            : anchorLabel(dag.positionType),
        kinds: duty?.kinds ?? [],
        startMinute: duty?.startMinute ?? null,
        endMinute: duty?.endMinute ?? null,
        durationMinutes: shape ? measureDuty({ date: datum, shape }).dutyMinutes : null,
        nightByTime: shape ? isNightServiceByTime(shape) : false,
        hardNight: shape ? isHardNightService(shape) : false,
        shunting: (duty?.kinds ?? []).includes("RANGEER"),
        weekend,
        restBefore,
        restAfter,
        previousCode: vorige?.code ?? null,
        nextCode: volgende?.code ?? null,
        summary: samenvatting(dag.positionType, dag.dutyCode, duty, restBefore, restAfter),
      };
    });

    const dienstdagen = cells.filter((cel) => cel.positionType === "DUTY");
    const rusten = cells
      .map((cel) => cel.restBefore)
      .filter((rust): rust is number => rust !== null);

    return {
      lineNumber: line.lineNumber,
      occupiedBy: line.assignments[0]?.employee.employeeNumber ?? null,
      cells,
      dutyDays: dienstdagen.length,
      nightDuties: dienstdagen.filter((cel) => cel.kinds.includes("NACHT")).length,
      shuntingDuties: dienstdagen.filter((cel) => cel.shunting).length,
      weekendDuties: dienstdagen.filter((cel) => cel.weekend).length,
      restDays: cells.filter((cel) => cel.positionType === "RUST").length,
      reserveDays: cells.filter((cel) => cel.positionType === "RES").length,
      shortestRest: rusten.length > 0 ? Math.min(...rusten) : null,
    };
  });

  const alleCellen = lines.flatMap((line) =>
    line.cells.map((cel) => ({ line: line.lineNumber, cel })),
  );

  return {
    code: roster.code,
    name: roster.name,
    profileLabel: rosterProfileLabel(roster.profile),
    locationCode: scope.code,
    cycleWeeks: roster.cycleWeeks,
    lines,
    totals: {
      lines: lines.length,
      dutyDays: lines.reduce((som, line) => som + line.dutyDays, 0),
      nightDuties: lines.reduce((som, line) => som + line.nightDuties, 0),
      shuntingDuties: lines.reduce((som, line) => som + line.shuntingDuties, 0),
      weekendDuties: lines.reduce((som, line) => som + line.weekendDuties, 0),
      emptyDutyDays: alleCellen.filter(
        (item) => item.cel.positionType === "DUTY" && !item.cel.dutyCode,
      ).length,
    },
    extremes: {
      shortestRest: kleinste(
        lines
          .filter((line) => line.shortestRest !== null)
          .map((line) => ({ line: line.lineNumber, minutes: line.shortestRest! })),
        (item) => item.minutes,
      ),
      longestDuty: grootste(
        alleCellen
          .filter((item) => item.cel.durationMinutes !== null)
          .map((item) => ({
            line: item.line,
            code: item.cel.dutyCode ?? "?",
            minutes: item.cel.durationMinutes!,
          })),
        (item) => item.minutes,
      ),
      mostNights: grootste(
        lines.map((line) => ({ line: line.lineNumber, count: line.nightDuties })),
        (item) => item.count,
      ),
      mostShunting: grootste(
        lines.map((line) => ({ line: line.lineNumber, count: line.shuntingDuties })),
        (item) => item.count,
      ),
      mostWeekends: grootste(
        lines.map((line) => ({ line: line.lineNumber, count: line.weekendDuties })),
        (item) => item.count,
      ),
    },
  };
}

// ── Hulpjes ──────────────────────────────────────────────────────────────────

type DutyRow = {
  code: string;
  kinds: DutyKind[];
  startMinute: number;
  endMinute: number;
  breakMinutes: number | null;
  overtimeMinutes: number;
};

function fictieveDatum(index: number): string {
  // Maandag 5 januari 2026 als nulpunt. Alleen de afstand telt.
  const basis = Date.UTC(2026, 0, 5) + index * 86_400_000;
  return new Date(basis).toISOString().slice(0, 10);
}

function vorigeDienst(
  dagen: readonly { positionType: string; dutyCode: string | null }[],
  vanaf: number,
  perCode: Map<string, DutyRow>,
): { index: number; code: string; shape: DutyShape } | null {
  for (let stap = 1; stap <= dagen.length; stap += 1) {
    const index = (vanaf - stap + dagen.length) % dagen.length;
    const dag = dagen[index];
    if (dag.positionType === "DUTY" && dag.dutyCode) {
      const duty = perCode.get(dag.dutyCode);
      if (duty) {
        return {
          index: index - (index > vanaf ? dagen.length : 0),
          code: duty.code,
          shape: {
            startMinute: duty.startMinute,
            endMinute: duty.endMinute,
            breakMinutes: duty.breakMinutes,
            overtimeMinutes: duty.overtimeMinutes,
          },
        };
      }
    }
  }
  return null;
}

function volgendeDienst(
  dagen: readonly { positionType: string; dutyCode: string | null }[],
  vanaf: number,
  perCode: Map<string, DutyRow>,
): { index: number; code: string; shape: DutyShape } | null {
  for (let stap = 1; stap <= dagen.length; stap += 1) {
    const index = (vanaf + stap) % dagen.length;
    const dag = dagen[index];
    if (dag.positionType === "DUTY" && dag.dutyCode) {
      const duty = perCode.get(dag.dutyCode);
      if (duty) {
        return {
          index: index + (index < vanaf ? dagen.length : 0),
          code: duty.code,
          shape: {
            startMinute: duty.startMinute,
            endMinute: duty.endMinute,
            breakMinutes: duty.breakMinutes,
            overtimeMinutes: duty.overtimeMinutes,
          },
        };
      }
    }
  }
  return null;
}

function kortLabel(positionType: string): string {
  switch (positionType) {
    case "RUST":
      return "R";
    case "RES":
      return "RES";
    case "WR":
      return "WR";
    case "CO":
      return "CO";
    case "VERLOF":
      return "V";
    case "OPLEIDING":
      return "OPL";
    default:
      return positionType;
  }
}

function samenvatting(
  positionType: string,
  dutyCode: string | null,
  duty: DutyRow | undefined,
  restBefore: number | null,
  restAfter: number | null,
): string {
  if (positionType === "RES") {
    return "Reservedag — operationele invulling door de dienstindeling.";
  }
  if (positionType !== "DUTY") {
    return `${anchorLabel(positionType)} — structureel anker in het jaarrooster.`;
  }
  if (!duty) {
    return dutyCode
      ? `Dienst ${dutyCode} staat niet in het dienstenpakket van deze standplaats.`
      : "Dienstdag zonder dienstnummer.";
  }
  const delen = [
    `${duty.code}: ${formatMinuteOfDay(duty.startMinute)}–${formatMinuteOfDay(duty.endMinute)}`,
    describeDutyKinds(duty.kinds),
  ];
  if (restBefore !== null) {
    delen.push(`rust ervoor ${formatDuration(restBefore)}`);
  }
  if (restAfter !== null) {
    delen.push(`rust erna ${formatDuration(restAfter)}`);
  }
  return delen.join(" · ");
}

function grootste<T>(items: readonly T[], van: (item: T) => number): T | null {
  return items.reduce<T | null>(
    (beste, item) => (beste === null || van(item) > van(beste) ? item : beste),
    null,
  );
}

function kleinste<T>(items: readonly T[], van: (item: T) => number): T | null {
  return items.reduce<T | null>(
    (beste, item) => (beste === null || van(item) < van(beste) ? item : beste),
    null,
  );
}

/** De weekdagkoppen van het raster. */
export const WEEKDAY_HEADS = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  label: weekdayLabel(weekday).slice(0, 2),
  weekend: weekday >= 6,
}));
