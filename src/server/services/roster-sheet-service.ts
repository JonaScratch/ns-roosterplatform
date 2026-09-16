import "server-only";
import { type RosterHours, formatHoursMinutes } from "@/domain/roster-hours";
import { toCalendarDate } from "@/domain/time";
import { recordAudit } from "@/server/audit/log";
import { brandLogoDataUri } from "@/server/branding/assets";
import { prisma } from "@/server/data/prisma";
import { SIMULATION_LABEL, cellFor } from "@/server/export/roster-document";
import type { RosterSheet, SheetCell, SheetLine, SummaryField } from "@/server/export/roster-sheet-layout";
import { renderSheetPdf, renderSheetSvg } from "@/server/export/roster-sheet-render";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { NotFoundError, requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import { rosterHoursFor } from "./roster-hours-service";

/**
 * Het roosterblad samenstellen in de vorm die NS gebruikt.
 *
 * ## Wat er op het blad komt
 *
 * De kop, de samenvatting links en de zeven dagkolommen komen uit het
 * aangeleverde blad. De urengegevens van deze fase komen daar onder de
 * bestaande velden bij — niet ertussen, en niet in plaats van iets. Wie het
 * blad kent, moet het blad herkennen; wat nieuw is, staat eronder.
 *
 * ## De tijden per weekdag
 *
 * De begin- en eindtijd van een cel komen uit de dienstinstantie van díe
 * weekdag. Dienst 101 op maandag heeft andere tijden dan 101 op donderdag, en
 * op het blad moet elke cel zijn eigen tijd tonen. Op nummer alleen opzoeken
 * levert een blad op waarin zes van de zeven dagen de tijden van maandag
 * dragen — een blad dat er goed uitziet en waarop iemand op het verkeerde
 * moment op het perron staat.
 */

export interface BuiltSheet {
  readonly sheet: RosterSheet;
  readonly hours: RosterHours | null;
  readonly rosterCode: string;
  readonly productionSafe: boolean;
}

export async function buildRosterSheet(
  rosterCode: string,
  requestedLocation?: string | null,
): Promise<BuiltSheet> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const scope = await locationScopeFor(actor, requestedLocation);

  const rooster = await prisma.baseRoster.findFirst({
    // De standplaats zit in de zoekvoorwaarde en niet in een controle achteraf.
    where: { code: rosterCode, depot: scope.code },
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
        include: { days: { orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }] } },
      },
    },
  });
  if (!rooster) {
    throw new Error(`Rooster ${rosterCode} bestaat niet voor standplaats ${scope.code}.`);
  }

  const [location, periode, diensten, urenView] = await Promise.all([
    prisma.stationLocation.findUnique({ where: { code: scope.code } }),
    prisma.rosterPeriod.findFirst({
      where: { location: { code: scope.code } },
      orderBy: [{ year: "desc" }, { version: "desc" }],
    }),
    prisma.duty.findMany({
      where: { depot: scope.code },
      select: { code: true, weekday: true, startMinute: true, endMinute: true },
    }),
    rosterHoursFor(rosterCode, requestedLocation),
  ]);

  // Op nummer én weekdag. Zie de toelichting bovenaan dit bestand.
  const dienstPerIdentiteit = new Map(
    diensten.map((duty) => [`${duty.code}|${duty.weekday}`, duty]),
  );

  const ruleset = activeRuleset();
  const productionSafe =
    ruleset.mode === "PRODUCTION" && ruleset.legalStatus === "LEGAL_RULESET_VERIFIED";

  const lines = bladRegels(rooster.lines, dienstPerIdentiteit);

  const summary: SummaryField[] = [
    { label: "Contracturen per week", value: "40:00" },
  ];
  if (urenView) {
    const uren = urenView.hours;
    summary.push(
      {
        label: "Gemiddelde weeklengte",
        value: formatHoursMinutes(uren.averageWeeklyCreditMinutes),
      },
      { label: "Werkuren", value: formatHoursMinutes(uren.actualDutyMinutes) },
      {
        label: "WTV",
        value: formatHoursMinutes(uren.wtvCreditMinutes),
        secondValue: `${uren.wtvDays} d`,
      },
      {
        label: "Overige credit",
        value: formatHoursMinutes(uren.otherCreditedMinutes),
        secondValue: `${uren.reserveDays + uren.compensationDays} d`,
      },
      {
        label: "Roosteruren totaal",
        value: formatHoursMinutes(uren.totalCreditMinutes),
      },
      { label: "R-dagen", value: String(uren.restDays) },
      { label: "Rusturen", value: formatHoursMinutes(uren.restIntervalMinutes) },
      { label: "RES / WR / CO", value: `${uren.reserveDays} / ${uren.wtvDays} / ${uren.compensationDays}` },
    );
  }
  summary.push({ label: "Status", value: rooster.status === "ACTIVE" ? "Actief" : rooster.status });

  const sheet: RosterSheet = {
    locationName: `${location?.name ?? scope.code} (${scope.code})`,
    rosterVariant: periode?.timetableId ?? "niet vastgelegd",
    role: "MCN",
    startDate: periode ? toCalendarDate(periode.validFrom) : "niet vastgelegd",
    endDate: periode?.validUntil ? toCalendarDate(periode.validUntil) : "open",
    rosterName: rooster.name,
    summary,
    lines,
    printedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    user: actor.employeeNumber,
    simulation: !productionSafe,
    simulationLabel: SIMULATION_LABEL,
    hasLogo: brandLogoDataUri() !== null,
  };

  return { sheet, hours: urenView?.hours ?? null, rosterCode: rooster.code, productionSafe };
}

/** Het blad als PDF, met een auditregel omdat het naar buiten gaat. */
export async function exportSheetPdf(
  rosterCode: string,
  requestedLocation?: string | null,
): Promise<{ readonly filename: string; readonly bytes: Buffer }> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_READ);
  const gebouwd = await buildRosterSheet(rosterCode, requestedLocation);
  const bytes = renderSheetPdf(gebouwd.sheet);

  await recordAudit({
    actor,
    action: "rooster.geexporteerd-pdf",
    objectType: "BaseRoster",
    objectId: gebouwd.rosterCode,
    newValue: {
      regels: gebouwd.sheet.lines.length,
      simulatie: gebouwd.sheet.simulation,
      bytes: bytes.length,
    },
  });

  const stempel = gebouwd.productionSafe ? "" : "-SIMULATIE";
  return { filename: `${gebouwd.rosterCode}${stempel}.pdf`, bytes };
}

/**
 * Hetzelfde roosterblad, maar dan van een scenario.
 *
 * ## Waarom dit naast het gewone blad staat en niet erin
 *
 * Een scenario is geen vastgelegd rooster. Het staat niet in `BaseRoster`, het
 * heeft geen roosterperiode en het is niet gepubliceerd. Wat het wél heeft is
 * precies dezelfde vorm: lijnen met zeven dagen, elk met een dienstnummer of
 * een ankerdag. Daarom komen de cellen uit dezelfde functie als het echte blad
 * en gaat het door dezelfde renderer.
 *
 * ## Waarom hier geen urenblok staat
 *
 * De samenvatting van het gewone blad komt uit `rosterHoursFor`, en die rekent
 * over het vastgelegde rooster. Voor een scenario zou dat de uren van het
 * huidige rooster naast de diensten van het voorstel zetten — twee dingen die
 * niet bij elkaar horen, op één blad, zonder dat je het ziet. Er staat daarom
 * wat er wél van dit scenario bekend is: welk scenario het is, wanneer het is
 * gemaakt en wat de toetsing ervan zei.
 *
 * ## Dit blad is altijd een simulatie
 *
 * `simulation` staat hier vast op waar. Niet afhankelijk van het regelbestand,
 * niet afhankelijk van de validatie: een voorstel is nooit een vastgesteld
 * rooster, en het blad zegt dat met de bestaande waarschuwing bovenaan.
 */
export async function buildCandidateSheet(
  candidateId: string,
  rosterCode: string,
): Promise<BuiltSheet> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);

  const kandidaat = await prisma.candidateRoster.findUnique({
    where: { id: candidateId },
    select: {
      scenarioLabel: true,
      generatedAt: true,
      validationState: true,
      locationCode: true,
      assignments: true,
    },
  });
  if (!kandidaat) {
    throw new NotFoundError("Dit scenario bestaat niet (meer).");
  }

  const scope = await locationScopeFor(actor, kandidaat.locationCode);

  const toewijzingen = (kandidaat.assignments ?? []) as unknown as readonly (BladDag & {
    readonly baseRosterCode: string;
    readonly lineNumber: number;
  })[];
  const vanDitRooster = toewijzingen.filter((entry) => entry.baseRosterCode === rosterCode);
  if (vanDitRooster.length === 0) {
    throw new NotFoundError(`Dit scenario bevat geen rooster ${rosterCode}.`);
  }

  const [rooster, location, diensten] = await Promise.all([
    prisma.baseRoster.findFirst({
      where: { code: rosterCode, depot: scope.code },
      select: { code: true, name: true },
    }),
    prisma.stationLocation.findUnique({ where: { code: scope.code } }),
    prisma.duty.findMany({
      where: { depot: scope.code },
      select: { code: true, weekday: true, startMinute: true, endMinute: true },
    }),
  ]);
  if (!rooster) {
    throw new NotFoundError(`Rooster ${rosterCode} bestaat niet voor standplaats ${scope.code}.`);
  }

  const dienstPerIdentiteit = new Map(
    diensten.map((duty) => [`${duty.code}|${duty.weekday}`, duty]),
  );

  const perLijn = new Map<number, BladDag[]>();
  for (const entry of vanDitRooster) {
    const bestaand = perLijn.get(entry.lineNumber);
    if (bestaand) {
      bestaand.push(entry);
    } else {
      perLijn.set(entry.lineNumber, [entry]);
    }
  }
  const lijnen = [...perLijn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lineNumber, days]) => ({ lineNumber, days }));

  const sheet: RosterSheet = {
    locationName: `${location?.name ?? scope.code} (${scope.code})`,
    rosterVariant: "scenario",
    role: "MCN",
    startDate: "niet vastgelegd",
    endDate: "niet vastgelegd",
    rosterName: `${rooster.name} — ${kandidaat.scenarioLabel}`,
    summary: [
      { label: "Contracturen per week", value: "40:00" },
      { label: "Scenario", value: kandidaat.scenarioLabel },
      {
        label: "Gegenereerd",
        value: kandidaat.generatedAt.toISOString().slice(0, 16).replace("T", " "),
      },
      { label: "Toetsing", value: toetsingInWoorden(kandidaat.validationState) },
      { label: "Roosterlijnen", value: String(lijnen.length) },
      { label: "Status", value: "Voorstel — niet vastgesteld" },
    ],
    lines: bladRegels(lijnen, dienstPerIdentiteit),
    printedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    user: actor.employeeNumber,
    simulation: true,
    simulationLabel: SIMULATION_LABEL,
    hasLogo: brandLogoDataUri() !== null,
  };

  return { sheet, hours: null, rosterCode: rooster.code, productionSafe: false };
}

/** Het scenarioblad als PDF, met een auditregel omdat het naar buiten gaat. */
export async function exportCandidateSheetPdf(
  candidateId: string,
  rosterCode: string,
): Promise<{ readonly filename: string; readonly bytes: Buffer }> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const gebouwd = await buildCandidateSheet(candidateId, rosterCode);
  const bytes = renderSheetPdf(gebouwd.sheet);

  await recordAudit({
    actor,
    action: "scenario.roosterblad-geexporteerd-pdf",
    objectType: "CandidateRoster",
    objectId: candidateId,
    newValue: {
      rooster: gebouwd.rosterCode,
      regels: gebouwd.sheet.lines.length,
      simulatie: true,
      bytes: bytes.length,
    },
  });

  return { filename: `${gebouwd.rosterCode}-SCENARIO-SIMULATIE.pdf`, bytes };
}

/** Hetzelfde scenarioblad als SVG, voor de voorvertoning op het scherm. */
export async function previewCandidateSheetSvg(
  candidateId: string,
  rosterCode: string,
): Promise<string> {
  const gebouwd = await buildCandidateSheet(candidateId, rosterCode);
  return renderSheetSvg(gebouwd.sheet, brandLogoDataUri());
}

/** De toetsingsuitkomst in gewone taal; de ruwe code hoort niet op een blad. */
function toetsingInWoorden(state: string): string {
  switch (state) {
    case "TECHNICALLY_VALIDATED":
      return "Volledig getoetst";
    case "TECHNICALLY_VALID_UNVERIFIED_RULES":
      return "Getoetst — formele validatie onvolledig";
    case "TECHNICALLY_VALID_INCOMPLETE_CONTEXT":
      return "Getoetst — historie onvolledig";
    case "CONFIRMED_HARD_VIOLATION":
      return "Afgewezen — bevestigde overtreding";
    case "INVALID_STRUCTURE":
      return "Afgewezen — niet volledig te beoordelen";
    case "NOT_VALIDATED":
      return "Nog niet getoetst";
    default:
      return "Beoordeeld vóór de huidige indeling";
  }
}

/** Hetzelfde blad als SVG, voor de voorvertoning op het scherm. */
export async function previewSheetSvg(
  rosterCode: string,
  requestedLocation?: string | null,
): Promise<string> {
  const gebouwd = await buildRosterSheet(rosterCode, requestedLocation);
  return renderSheetSvg(gebouwd.sheet, brandLogoDataUri());
}

/** Eén dag van een roosterlijn, zoals hij in de database of in een kandidaat staat. */
interface BladDag {
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: string;
  readonly dutyCode: string | null;
}

interface BladLijn {
  readonly lineNumber: number;
  readonly days: readonly BladDag[];
}

interface DienstTijden {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * De zeven dagcellen van elke roosterlijn.
 *
 * Eén opbouw voor het vastgelegde rooster én voor een scenario: beide leveren
 * dezelfde dagen aan, en een blad hoort er niet anders uit te zien omdat het
 * uit een ander scherm komt. Zou dit twee keer bestaan, dan zou het scenarioblad
 * op den duur van het echte blad gaan afwijken zonder dat iemand het merkt.
 */
function bladRegels(
  lijnen: readonly BladLijn[],
  dienstPerIdentiteit: ReadonlyMap<string, DienstTijden>,
): SheetLine[] {
  return lijnen.map((regel) => {
    const cells: SheetCell[] = [];
    let inclMinuten = 0;

    for (let weekdag = 1; weekdag <= 7; weekdag += 1) {
      const dag = regel.days.find(
        (kandidaat) => kandidaat.weekIndex === 1 && kandidaat.weekday === weekdag,
      );
      if (!dag) {
        cells.push({ code: "", duration: null, timeRange: null });
        continue;
      }

      const code = cellFor(dag.positionType, dag.dutyCode);
      if (dag.positionType === "DUTY" && dag.dutyCode) {
        const dienst = dienstPerIdentiteit.get(`${dag.dutyCode}|${weekdag}`);
        if (!dienst) {
          // Geen tijden verzinnen. Een dienstcel zonder tijd valt op; een cel
          // met de tijden van een andere dag niet.
          cells.push({ code, duration: null, timeRange: null });
          continue;
        }
        const duur = dienst.endMinute - dienst.startMinute;
        inclMinuten += duur;
        cells.push({
          code,
          duration: formatHoursMinutes(duur).padStart(5, "0"),
          timeRange: `${klok(dienst.startMinute)} - ${klok(dienst.endMinute)}`,
        });
      } else if (dag.positionType === "RUST") {
        // Het aangeleverde blad toont bij een rustdag alleen "R".
        cells.push({ code, duration: null, timeRange: null });
      } else {
        // RES, WR en CO tonen op het blad 08:00 en geen tijdvak.
        inclMinuten += 8 * 60;
        cells.push({ code, duration: "08:00", timeRange: null });
      }
    }

    return {
      lineNumber: regel.lineNumber,
      hoursIncludingBreak: formatHoursMinutes(inclMinuten).padStart(5, "0"),
      // De pauzeduur per dienst is niet aangeleverd; zonder die waarde is de
      // tijd exclusief pauze niet te berekenen. Een streepje zegt dat; een
      // geschat getal zou hetzelfde ogen als een gemeten getal.
      hoursExcludingBreak: "—",
      cells,
    };
  });
}

function klok(minuten: number): string {
  const dagminuut = ((minuten % 1440) + 1440) % 1440;
  return `${String(Math.floor(dagminuut / 60)).padStart(2, "0")}:${String(dagminuut % 60).padStart(2, "0")}`;
}
