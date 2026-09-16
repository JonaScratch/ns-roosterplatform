import "server-only";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import { type CalendarDate, formatMinuteOfDay, formatCalendarDate } from "@/domain/time";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { writeXlsx } from "@/server/import/xlsx";
import { dayPlan, openDuties, type DayPlanRow } from "./duty-assignment-service";

/**
 * De dagplanning als professioneel Excel-bestand.
 *
 * ## Waarom dit de primaire export is en de CSV niet meer
 *
 * Een puntkomma-bestand met enum-waarden ("DUTY", "RUST", "BASE") is te lezen
 * voor een programma en niet voor de dienstindeling die het 's ochtends afdrukt
 * of doorstuurt. Deze export gebruikt dezelfde gegevens als de CSV — `dayPlan`
 * — maar met de labels waarmee dit platform overal elders al werkt, een
 * samenvatting bovenaan, en een indeling die aansluit bij hoe iemand een
 * dagplanning leest: wie rijdt, dan wie reserve heeft, dan de rest.
 *
 * ## Waarom hier geen namen staan
 *
 * Zoals bij elke export in dit platform: personeelsnummers, geen namen. Zie
 * de toelichting bij de CSV-route.
 */

const POSITION_LABEL: Record<string, string> = {
  DUTY: "Dienst",
  RES: "RES",
  WR: "WTV",
  CO: "CO",
  RUST: "R",
  VERLOF: "Verlof",
  OPLEIDING: "Opleiding",
};

/** Sorteervolgorde: concrete dienst eerst, dan reserve, dan overig werk, dan vrij/rust. */
const POSITION_SORT: Record<string, number> = {
  DUTY: 0,
  RES: 1,
  WR: 2,
  CO: 3,
  OPLEIDING: 4,
  VERLOF: 5,
  RUST: 6,
};

const SOURCE_LABEL: Record<string, string> = {
  BASE: "Basisrooster",
  RESERVE_FILL: "Reserve ingevuld",
  AVAILABLE_DUTY: "Opengesteld",
  SWAP: "Ruiling",
  PLANNER_MANUAL: "Handmatig",
};

function diensttijd(row: DayPlanRow): string {
  if (row.startMinute === null || row.endMinute === null) {
    return "";
  }
  return `${formatMinuteOfDay(row.startMinute)} / ${formatMinuteOfDay(row.endMinute)}`;
}

function sorteer(rows: readonly DayPlanRow[]): readonly DayPlanRow[] {
  return [...rows].sort((a, b) => {
    const volgorde = (POSITION_SORT[a.positionType] ?? 9) - (POSITION_SORT[b.positionType] ?? 9);
    return volgorde !== 0 ? volgorde : a.employeeNumber.localeCompare(b.employeeNumber);
  });
}

/**
 * Bouwt het dagplanning-werkboek voor één dag en standplaats.
 *
 * `locationLabel` is alleen voor op het blad; de gegevens zelf komen, net als
 * bij de CSV-route, uit `dayPlan` — die al op de sessie-standplaats filtert.
 */
export async function buildDagplanningWorkbook(
  date: CalendarDate,
  locationLabel: string,
): Promise<Buffer> {
  const [rows, open] = await Promise.all([dayPlan(date), openDuties({ date, limit: 200 })]);
  const gesorteerd = sorteer(rows);

  const concreet = rows.filter((row) => row.positionType === "DUTY").length;
  const reserve = rows.filter((row) => row.positionType === "RES").length;
  const vrijRust = rows.filter((row) => row.positionType === "RUST").length;

  const kop = ["Personeelsnummer", "Rooster", "Status", "Dienst", "Diensttijd", "Herkomst"];

  const rijen: string[][] = [
    ["Dagplanning " + locationLabel],
    [`Datum: ${formatCalendarDate(date)}`, `Standplaats: ${locationLabel}`],
    [],
    ["Totaal medewerkers", "Concrete diensten", "RES", "Vrij / Rust", "Openstaande diensten"],
    [
      String(rows.length),
      String(concreet),
      String(reserve),
      String(vrijRust),
      String(open.length),
    ],
    [],
    kop,
    ...gesorteerd.map((row) => [
      row.employeeNumber,
      rosterProfileLabel(row.rosterProfile as RosterProfile),
      POSITION_LABEL[row.positionType] ?? row.positionType,
      row.dutyCode ?? "",
      diensttijd(row),
      SOURCE_LABEL[row.source] ?? row.source,
    ]),
  ];

  const kopRijnummer = 7; // 1-gebaseerd: rij 7 is de kopregel van de tabel.
  const laatsteRij = rijen.length;

  return writeXlsx([
    {
      name: "Dagplanning",
      rows: rijen,
      boldRows: [1, 4, kopRijnummer],
      columnWidths: [16, 16, 10, 10, 16, 16],
      freezeRows: kopRijnummer,
      autoFilterRange: `A${kopRijnummer}:F${laatsteRij}`,
      printArea: `A1:F${laatsteRij}`,
      landscape: true,
    },
  ]);
}
