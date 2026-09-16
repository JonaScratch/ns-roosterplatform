import "server-only";
import { type CalendarDate, addDays, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { type IsoWeek, mondayOfIsoWeek, ruleForDate } from "@/domain/roster-rotation";
import { assessSuitability, type SuitabilityAssessment } from "@/domain/suitability";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { buildAssignmentCheck } from "@/server/data/repositories/schedule-repository";
import { toDutyContext } from "@/server/data/mappers";
import { rulesEngine } from "@/server/rules-engine";
import { anchorOf, effectiveMembershipOn } from "./roster-membership-service";

/**
 * De overgang naar een ander rooster.
 *
 * ## Waarom een startregel niet zomaar gekozen wordt
 *
 * Een medewerker die op maandag in een ander rooster begint, komt daar op een
 * regel terecht die zijn eigen diensten heeft. Of dat kan, hangt af van wat hij
 * de dagen ervóór reed: wie zondag om 01:00 klaar was, kan maandag niet om 05:00
 * beginnen. Een keuzelijst met "regel 1 tot en met 12" laat die vraag aan de
 * planner over; deze module beantwoordt hem per regel.
 *
 * ## Twee lagen, opnieuw
 *
 * Eerst de rules engine: mág deze overgang. Daarna de geschiktheidslaag: is hij
 * verstandig. Een regel die juridisch niet kan, is niet te kiezen; een regel die
 * mag maar slecht aansluit, staat er met zijn bezwaren bij. Dat is dezelfde
 * driedeling als bij de reserve-invulling, en met opzet dezelfde code.
 */

export interface StartRuleOption {
  readonly ruleIndex: number;
  /** Laat de rules engine de eerste dienst in deze regel toe? */
  readonly eligible: boolean;
  readonly blockingReasons: readonly string[];
  /** Roosterkwaliteit van de overgang, 0 tot 1. Null wanneer er niets te wegen valt. */
  readonly suitability: SuitabilityAssessment | null;
  /** De eerste dienst die deze regel in de startweek oplevert. */
  readonly firstDutyCode: string | null;
  readonly firstDutyDate: CalendarDate | null;
  readonly summary: string;
}

export interface TransferAnalysis {
  readonly employeeNumber: string;
  readonly targetRosterCode: string;
  readonly fromWeek: IsoWeek;
  readonly options: readonly StartRuleOption[];
  /** De dienst die deze medewerker vlak vóór de overgang nog rijdt. */
  readonly lastDutyBefore: { readonly code: string; readonly date: CalendarDate } | null;
}

/**
 * Welke startregels kunnen, en welke daarvan sluiten goed aan?
 *
 * Loopt elke regel van het doelrooster langs, zoekt de eerste dienst die die
 * regel in de startweek oplevert, en toetst de overgang daarheen vanuit het
 * huidige rooster.
 */
export async function analyseTransfer(input: {
  readonly employeeId: string;
  readonly targetRosterCode: string;
  readonly fromWeek: IsoWeek;
}): Promise<TransferAnalysis> {
  await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, employeeNumber: true, depot: true },
  });
  if (!employee) {
    throw new Error("Onbekende medewerker.");
  }

  const roster = await prisma.baseRoster.findUnique({
    where: { code: input.targetRosterCode },
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
        include: { days: { orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }] } },
      },
    },
  });
  if (!roster) {
    throw new Error(`Rooster ${input.targetRosterCode} bestaat niet.`);
  }
  if (roster.depot !== employee.depot) {
    throw new Error(
      `Rooster ${roster.code} hoort bij standplaats ${roster.depot} en de medewerker bij ` +
        `${employee.depot}.`,
    );
  }

  const maandag = mondayOfIsoWeek(input.fromWeek);

  // Wat rijdt deze medewerker vlak vóór de overgang? Dat bepaalt of de eerste
  // dienst in het nieuwe rooster kan.
  const laatste = await prisma.scheduledDuty.findFirst({
    where: {
      employeeId: employee.id,
      positionType: "DUTY",
      dutyId: { not: null },
      date: { lt: toDatabaseDate(maandag) },
    },
    orderBy: { date: "desc" },
    include: { duty: { select: { code: true } } },
  });

  const dienstenPerCode = new Map(
    (
      await prisma.duty.findMany({
        where: { depot: employee.depot },
        select: {
          id: true,
          code: true,
          kinds: true,
          startMinute: true,
          endMinute: true,
          breakMinutes: true,
          overtimeMinutes: true,
          depot: true,
          requiredQualifications: true,
          weight: true,
        },
      })
    ).map((duty) => [duty.code, duty]),
  );

  const opties: StartRuleOption[] = [];

  for (const line of roster.lines) {
    // De eerste dienstdag die deze regel in de startweek oplevert.
    const cyclusWeek = ((line.lineNumber - 1) % roster.cycleWeeks) + 1;
    const eersteDag = line.days
      .filter((dag) => dag.weekIndex === cyclusWeek && dag.positionType === "DUTY" && dag.dutyCode)
      .sort((a, b) => a.weekday - b.weekday)[0];

    if (!eersteDag?.dutyCode) {
      opties.push({
        ruleIndex: line.lineNumber,
        eligible: true,
        blockingReasons: [],
        suitability: null,
        firstDutyCode: null,
        firstDutyDate: null,
        summary: "Deze regel begint de week zonder dienst; er is niets te toetsen.",
      });
      continue;
    }

    const duty = dienstenPerCode.get(eersteDag.dutyCode);
    const datum = addDays(maandag, eersteDag.weekday - 1);

    if (!duty) {
      opties.push({
        ruleIndex: line.lineNumber,
        eligible: false,
        blockingReasons: [
          `Dienst ${eersteDag.dutyCode} staat niet in het dienstenpakket van deze standplaats.`,
        ],
        suitability: null,
        firstDutyCode: eersteDag.dutyCode,
        firstDutyDate: datum,
        summary: `Dienst ${eersteDag.dutyCode} is onbekend; deze regel is niet te beoordelen.`,
      });
      continue;
    }

    const dutyContext = toDutyContext(duty);
    const check = await buildAssignmentCheck({
      employeeId: employee.id,
      date: datum,
      duty: dutyContext,
    });
    const evaluatie = await rulesEngine().evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check,
    });

    const toegestaan = evaluatie.decision !== "BLOCK";
    const geschiktheid = toegestaan
      ? assessSuitability({
          previous: laatste?.duty
            ? {
                date: toCalendarDate(laatste.date),
                code: laatste.duty.code,
                kinds: dienstenPerCode.get(laatste.duty.code)?.kinds ?? [],
                shape: vorm(dienstenPerCode.get(laatste.duty.code)),
              }
            : null,
          candidate: {
            date: datum,
            code: duty.code,
            kinds: duty.kinds,
            shape: vorm(duty),
          },
          next: null,
          daysSincePrevious: null,
          daysUntilNext: null,
        })
      : null;

    opties.push({
      ruleIndex: line.lineNumber,
      eligible: toegestaan,
      blockingReasons: evaluatie.findings
        .filter((finding) => finding.severity === "VIOLATION")
        .map((finding) => finding.message),
      suitability: geschiktheid,
      firstDutyCode: duty.code,
      firstDutyDate: datum,
      summary: !toegestaan
        ? "Niet mogelijk: de regels laten de eerste dienst van deze regel niet toe."
        : geschiktheid?.selfServiceSuitable
          ? "Geschikt."
          : `Mogelijk, met aandachtspunten: ${geschiktheid?.concerns[0] ?? "zie de onderbouwing"}`,
    });
  }

  return {
    employeeNumber: employee.employeeNumber,
    targetRosterCode: roster.code,
    fromWeek: input.fromWeek,
    options: opties,
    lastDutyBefore: laatste?.duty
      ? { code: laatste.duty.code, date: toCalendarDate(laatste.date) }
      : null,
  };
}

function vorm(duty?: {
  startMinute: number;
  endMinute: number;
  breakMinutes: number | null;
  overtimeMinutes: number;
}) {
  return {
    startMinute: duty?.startMinute ?? 0,
    endMinute: duty?.endMinute ?? 0,
    breakMinutes: duty?.breakMinutes ?? null,
    overtimeMinutes: duty?.overtimeMinutes ?? 0,
  };
}

/**
 * Waar staat deze medewerker deze week en volgende week?
 *
 * Voor het scherm van de dienstindeling: één regel per medewerker, met de
 * plaatsing erachter.
 */
export async function currentAndNextRule(employeeId: string): Promise<{
  readonly rosterCode: string;
  readonly rosterName: string;
  readonly currentRule: number;
  readonly nextRule: number;
  readonly placementType: string;
  readonly validUntil: CalendarDate | null;
} | null> {
  const vandaag = toCalendarDate(new Date());
  const plaatsing = await effectiveMembershipOn(employeeId, vandaag);
  if (!plaatsing) {
    return null;
  }
  const volgendeWeek = addDays(vandaag, 7);
  const plaatsingVolgende = await effectiveMembershipOn(employeeId, volgendeWeek);

  return {
    rosterCode: plaatsing.baseRoster.code,
    rosterName: plaatsing.baseRoster.name,
    currentRule: ruleForDate(anchorOf(plaatsing), vandaag),
    nextRule: plaatsingVolgende
      ? ruleForDate(anchorOf(plaatsingVolgende), volgendeWeek)
      : ruleForDate(anchorOf(plaatsing), volgendeWeek),
    placementType: plaatsing.placementType,
    validUntil: plaatsing.validUntil ? toCalendarDate(plaatsing.validUntil) : null,
  };
}
