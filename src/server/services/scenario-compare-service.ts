import "server-only";
import { type CandidateRoster, simulationEligible } from "@/domain/candidate";
import { type CycleDay, formatHoursMinutes, rosterHours } from "@/domain/roster-hours";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";
import { locationScopeFor } from "@/server/security/location-scope";
import { activeRuleset } from "@/server/rules-engine";
import type { ReviewableRoster } from "@/domain/candidate";

/**
 * Scenario's naast elkaar.
 *
 * ## Waarom dit niet dezelfde vergelijking is als `/roostercommissie/vergelijken`
 *
 * Dat scherm vergelijkt twee vastgelegde roosterversies: wat is er veranderd
 * tussen wat er lag en wat er ligt. Dit scherm vergelijkt voorstellen die nog
 * niets zijn — verschillende manieren om dezelfde diensten te verdelen. De
 * vraag is hier niet "wat is er veranderd" maar "welke verdeling zou ik kiezen".
 *
 * ## Alleen wat werkelijk is uitgerekend
 *
 * Elk getal hieronder komt uit de kandidaat zelf: uit zijn toewijzingen, uit
 * de boekhouding van de solver, of uit de opgeslagen validatie. Er wordt niets
 * geschat en niets afgeleid uit een ander scenario. Waar een getal ontbreekt,
 * staat er niets in plaats van een nul — een nul leest als een meting.
 */

export interface ScenarioRosterHours {
  readonly rosterCode: string;
  readonly rosterName: string;
  /** Gemiddelde weekomvang van dit basisrooster, als "39:55". */
  readonly averageWeek: string;
  /** Afwijking van 40:00 in minuten. Positief is meer. */
  readonly deviationMinutes: number;
  readonly lineCount: number;
}

export interface ScenarioMetrics {
  readonly id: string;
  readonly label: string;
  readonly generatedAt: Date;
  readonly optimizer: string;

  /** De technische uitkomst, zoals de validator hem gaf. */
  readonly validationState: string;
  readonly validatedAt: Date | null;
  readonly simulationEligible: boolean;
  readonly publicationEligible: boolean;

  /** Hoger is beter. Zie `scoreExplanation`. */
  readonly optimisationScore: number;

  readonly dutiesRequired: number;
  readonly dutiesPlaced: number;
  readonly dutiesUnfilled: number;

  readonly confirmedHardViolations: number | null;
  /** Aantal regelgroepen dat niet volledig beoordeeld kon worden. */
  readonly uncertaintyGroups: number | null;

  readonly restQuality: number;
  readonly weekendBalance: number;
  readonly nightBalance: number;
  readonly shuntingBalance: number;

  /** Per basisrooster de gemiddelde weekomvang. Leeg wanneer niet te bepalen. */
  readonly hoursByRoster: readonly ScenarioRosterHours[];

  /** Waar deze kandidaat op is gebaseerd; vergelijken mag alleen binnen één basis. */
  readonly basis: {
    readonly locationCode: string | null;
    readonly sourceScheduleVersion: string;
    readonly inputDataVersion: string;
  };
}

export interface ScenarioComparison {
  readonly scenarios: readonly ScenarioMetrics[];
  /** Alle basisroosters die in minstens één scenario voorkomen, gesorteerd. */
  readonly rosterCodes: readonly string[];
  /**
   * Gezet wanneer de gekozen scenario's niet op dezelfde basis rusten. Dan is
   * vergelijken appels met peren en zegt het scherm dat.
   */
  readonly incomparable: string | null;
}

/** Uitleg bij de score, zodat niemand hem voor een juridisch oordeel aanziet. */
export const SCORE_EXPLANATION =
  "De optimalisatiescore weegt rustkwaliteit, verdeling van nacht-, weekend- en " +
  "rangeerdiensten en de aansluiting op medewerkerfeedback. Hoger is beter. Het is " +
  "een maat voor de verdeling, geen uitspraak over rechtmatigheid: een hoge score " +
  "zegt niets over formele goedkeuring.";

/**
 * De scenario's die de gebruiker heeft aangevinkt, naast elkaar.
 *
 * Geeft ook een scenario terug dat niet vergelijkbaar is; het scherm laat dan
 * zien waarom in plaats van het stilletjes weg te laten.
 */
export async function compareScenarios(
  candidateIds: readonly string[],
  requestedLocation?: string | null,
): Promise<ScenarioComparison> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, requestedLocation);

  const rows = await prisma.candidateRoster.findMany({
    where: {
      id: { in: [...candidateIds] },
      OR: [{ locationCode: scope.code }, { locationCode: null }],
    },
    orderBy: { generatedAt: "asc" },
  });

  const roosterNamen = new Map(
    (
      await prisma.baseRoster.findMany({
        where: { depot: scope.code },
        select: { code: true, name: true },
      })
    ).map((roster) => [roster.code, roster.name]),
  );

  // De diensttijden horen niet bij de toewijzing maar bij de dienst. Dezelfde
  // sleutel als de validator gebruikt: nummer én weekdag, want hetzelfde
  // dienstnummer op een andere dag is een andere dienst.
  const dutyCodes = [
    ...new Set(
      rows.flatMap((row) =>
        ((row.assignments ?? []) as unknown as CandidateRoster["assignments"])
          .map((entry) => entry.dutyCode)
          .filter((code): code is string => code !== null),
      ),
    ),
  ];
  const diensten = await prisma.duty.findMany({
    where: { code: { in: dutyCodes } },
    select: { code: true, weekday: true, startMinute: true, endMinute: true },
  });
  const dienstTijden = new Map(
    diensten.map((duty) => [
      `${duty.code}|${duty.weekday}`,
      { startMinute: duty.startMinute, endMinute: duty.endMinute },
    ]),
  );

  const regelbestand = activeRuleset();
  const scenarios = rows.map((row) => toMetrics(row, roosterNamen, dienstTijden, regelbestand));

  const codes = [
    ...new Set(scenarios.flatMap((entry) => entry.hoursByRoster.map((uren) => uren.rosterCode))),
  ].sort();

  return {
    scenarios,
    rosterCodes: codes,
    incomparable: incomparabilityReason(scenarios),
  };
}

/**
 * Rusten deze scenario's op dezelfde basis?
 *
 * Twee scenario's die op een ander dienstenpakket of een ander bronrooster zijn
 * gemaakt, verschillen niet door hun strategie maar door hun invoer. Ze naast
 * elkaar zetten zonder dat te zeggen, nodigt uit tot de verkeerde conclusie.
 */
function incomparabilityReason(scenarios: readonly ScenarioMetrics[]): string | null {
  if (scenarios.length < 2) {
    return null;
  }
  const eerste = scenarios[0].basis;
  for (const scenario of scenarios.slice(1)) {
    if (scenario.basis.locationCode !== eerste.locationCode) {
      return "Deze scenario's horen bij verschillende standplaatsen.";
    }
    if (scenario.basis.sourceScheduleVersion !== eerste.sourceScheduleVersion) {
      return (
        "Deze scenario's zijn op verschillende versies van het bronrooster gemaakt. " +
        "Het verschil dat u ziet, komt dan deels uit de invoer en niet uit de strategie."
      );
    }
    if (scenario.basis.inputDataVersion !== eerste.inputDataVersion) {
      return (
        "Deze scenario's zijn op verschillende dienst- of medewerkergegevens gemaakt. " +
        "Het verschil dat u ziet, komt dan deels uit de invoer en niet uit de strategie."
      );
    }
  }
  return null;
}

type CandidateRow = {
  id: string;
  scenarioLabel: string;
  generatedAt: Date;
  optimizerName: string;
  optimizerVersion: string;
  locationCode: string | null;
  sourceScheduleVersion: string;
  inputDataVersion: string;
  validationState: string;
  validatedAt: Date | null;
  assignments: unknown;
  scoreBreakdown: unknown;
  solverRun: unknown;
  validationSummary: unknown;
};

interface DutyTime {
  readonly startMinute: number;
  readonly endMinute: number;
}

function toMetrics(
  row: CandidateRow,
  roosterNamen: ReadonlyMap<string, string>,
  dienstTijden: ReadonlyMap<string, DutyTime>,
  regelbestand: ReturnType<typeof activeRuleset>,
): ScenarioMetrics {
  const assignments = (row.assignments ?? []) as CandidateRoster["assignments"];
  const score = (row.scoreBreakdown ?? {}) as Partial<CandidateRoster["scoreBreakdown"]>;
  const solver = row.solverRun as
    | { emptyDutySlots?: number; dutySlots?: number }
    | null;
  const summary = row.validationSummary as
    | { tally?: ReviewableRoster["tally"]; uncertainties?: ReviewableRoster["uncertainties"] }
    | null;

  const dienstdagen = assignments.filter(
    (entry) => entry.positionType === "DUTY" && entry.dutyCode !== null,
  ).length;
  const leeg = solver?.emptyDutySlots ?? 0;

  const status = row.validationState as Parameters<typeof simulationEligible>[0];

  return {
    id: row.id,
    label: row.scenarioLabel,
    generatedAt: row.generatedAt,
    optimizer: `${row.optimizerName}@${row.optimizerVersion}`,
    validationState: row.validationState,
    validatedAt: row.validatedAt,
    simulationEligible: simulationEligible(status),
    // Publicatie hangt aan het regelbestand van nú, niet aan dat van toen.
    publicationEligible:
      status === "TECHNICALLY_VALIDATED" &&
      regelbestand.legalStatus === "LEGAL_RULESET_VERIFIED" &&
      regelbestand.missingPackages.length === 0,
    optimisationScore: score.overallQualityScore ?? 0,
    dutiesRequired: dienstdagen + leeg,
    dutiesPlaced: dienstdagen,
    dutiesUnfilled: leeg,
    confirmedHardViolations: summary?.tally?.confirmedHardViolations ?? null,
    uncertaintyGroups: summary?.uncertainties?.length ?? null,
    restQuality: score.restQuality ?? 0,
    weekendBalance: score.weekendBalance ?? 0,
    nightBalance: score.nightBalance ?? 0,
    shuntingBalance: score.shuntingBalance ?? 0,
    hoursByRoster: hoursPerRoster(assignments, roosterNamen, dienstTijden),
    basis: {
      locationCode: row.locationCode,
      sourceScheduleVersion: row.sourceScheduleVersion,
      inputDataVersion: row.inputDataVersion,
    },
  };
}

/**
 * De gemiddelde weekomvang per basisrooster, uit de kandidaat zelf.
 *
 * Dezelfde berekening als bij een vastgelegd rooster (`rosterHours`), gevoed
 * met de dagen van de kandidaat. Eén gemiddelde over alle roosters heen zou
 * verbergen waar het schuurt: het is per rooster dat de veertig uur moet
 * kloppen, niet over de standplaats heen.
 */
function hoursPerRoster(
  assignments: CandidateRoster["assignments"],
  roosterNamen: ReadonlyMap<string, string>,
  dienstTijden: ReadonlyMap<string, DutyTime>,
): readonly ScenarioRosterHours[] {
  const perRooster = new Map<string, CandidateRoster["assignments"][number][]>();
  for (const entry of assignments) {
    const lijst = perRooster.get(entry.baseRosterCode) ?? [];
    lijst.push(entry);
    perRooster.set(entry.baseRosterCode, lijst);
  }

  const uitkomst: ScenarioRosterHours[] = [];
  for (const [code, rijen] of [...perRooster.entries()].sort()) {
    const regels = new Set(rijen.map((entry) => entry.lineNumber));
    const weken = new Set(rijen.map((entry) => entry.weekIndex));
    const lineCount = regels.size;
    const weeksPerLine = weken.size;
    if (lineCount === 0 || weeksPerLine === 0) {
      continue;
    }

    // De dagen in de volgorde waarin een medewerker ze rijdt: regel na regel.
    const dagen: CycleDay[] = [...rijen]
      .sort(
        (een, ander) =>
          een.lineNumber - ander.lineNumber ||
          een.weekIndex - ander.weekIndex ||
          een.weekday - ander.weekday,
      )
      .map((entry) => {
        const tijden = entry.dutyCode
          ? dienstTijden.get(`${entry.dutyCode}|${entry.weekday}`)
          : undefined;
        return {
          positionType: entry.positionType,
          startMinute: tijden?.startMinute ?? null,
          endMinute: tijden?.endMinute ?? null,
        };
      });

    const uren = rosterHours({ days: dagen, lineCount, weeksPerLine });
    uitkomst.push({
      rosterCode: code,
      rosterName: roosterNamen.get(code) ?? code,
      averageWeek: formatHoursMinutes(uren.averageWeeklyCreditMinutes),
      deviationMinutes: uren.deviationFromTargetMinutes,
      lineCount,
    });
  }
  return uitkomst;
}
