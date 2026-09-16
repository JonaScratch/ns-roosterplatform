import "server-only";
import { type CalendarDate, addDays, daysBetween } from "@/domain/time";
import {
  type NeighbourDuty,
  type SuitabilityAssessment,
  type TransitionContext,
  assessSuitability,
  suitabilitySummary,
} from "@/domain/suitability";
import type { DutyContext, RuleEvaluationResult, ScheduleWindow } from "@/server/rules-engine";
import { rulesEngine } from "@/server/rules-engine";
import { buildAssignmentCheck } from "@/server/data/repositories/schedule-repository";

/**
 * De ene plek waar "mag het", "is het verstandig" en "voor wie" samenkomen.
 *
 * ## De driedeling
 *
 *     Rules Engine        mag deze plaatsing? — juridisch, hard, fail-closed
 *          ↓
 *     Suitability         is dit een verstandige dienst gezien gisteren en morgen?
 *          ↓
 *     Ranking             wie van de geschikte kandidaten komt als eerste?
 *
 * Elke laag consumeert de vorige en voedt de vorige nooit terug. De rules engine
 * weet niet dat er zoiets als geschiktheid bestaat; als zij "nee" zegt, houdt
 * het op en kan geen enkele score daar iets aan veranderen.
 *
 * ## Waarom dit één service is
 *
 * Reserve-invulling, beschikbare diensten, ruilen en de handmatige toewijzing
 * door de dienstindeling stellen dezelfde vraag. Vier implementaties zouden
 * binnen een half jaar vier verschillende antwoorden geven op precies het geval
 * dat ertoe doet — de late dienst gevolgd door een vroege. Vandaar één ingang.
 *
 * ## Twee publieken
 *
 * Een medewerker krijgt alleen wat past. De dienstindeling mag ook zien wat
 * technisch mag maar slecht aansluit, mét de bezwaren erbij — die heeft
 * operationele redenen die het systeem niet kent. Wat de dienstindeling
 * uitdrukkelijk **niet** kan, is iets inzetten dat de rules engine afkeurt.
 */

export type Audience = "EMPLOYEE" | "PLANNER";

export interface SuitabilityRequest {
  readonly employeeId: string;
  readonly date: CalendarDate;
  readonly duty: DutyContext;
  /** De dienst die deze medewerker inlevert, bij een ruil. */
  readonly surrenderScheduledDutyId?: string | null;
  readonly surrendering?: DutyContext | null;
}

export interface AssignmentSuitability {
  readonly employeeId: string;
  readonly date: CalendarDate;
  readonly dutyCode: string;
  /** Laat de rules engine deze plaatsing toe? Onwaar sluit iedereen uit. */
  readonly hardEligible: boolean;
  readonly decision: RuleEvaluationResult["decision"];
  readonly outcome: RuleEvaluationResult["outcome"];
  /** De juridische bezwaren, in de woorden van de engine. */
  readonly blockingReasons: readonly string[];
  /** Null wanneer de plaatsing al juridisch afvalt: dan valt er niets te wegen. */
  readonly suitability: SuitabilityAssessment | null;
  /** Mag dit standaard aan de medewerker worden getoond? */
  readonly showToEmployee: boolean;
  /** Mag de dienstindeling dit inzetten? */
  readonly assignableByPlanner: boolean;
  /** Eén zin, zonder gegevens over andere medewerkers. */
  readonly summary: string;
}

/**
 * Beoordeelt één mogelijke plaatsing volledig.
 *
 * Eerst hard, dan pas geschikt. De volgorde is niet toevallig: geschiktheid
 * berekenen over een plaatsing die niet mag, nodigt uit tot een interface die
 * "bijna goed" toont.
 */
export async function assessAssignment(
  request: SuitabilityRequest,
): Promise<AssignmentSuitability> {
  const check = await buildAssignmentCheck({
    employeeId: request.employeeId,
    date: request.date,
    duty: request.duty,
    surrenderScheduledDutyId: request.surrenderScheduledDutyId ?? null,
    surrendering: request.surrendering ?? null,
  });

  const evaluation = await rulesEngine().evaluateDutyEligibility({
    type: "DUTY_ELIGIBILITY",
    check,
  });

  const hardEligible = evaluation.decision !== "BLOCK";
  if (!hardEligible) {
    return {
      employeeId: request.employeeId,
      date: request.date,
      dutyCode: request.duty.code,
      hardEligible: false,
      decision: evaluation.decision,
      outcome: evaluation.outcome,
      blockingReasons: evaluation.findings
        .filter((finding) => finding.severity === "VIOLATION")
        .map((finding) => finding.message),
      suitability: null,
      showToEmployee: false,
      assignableByPlanner: false,
      summary: "Deze dienst kan niet worden toegewezen; de regels laten dat niet toe.",
    };
  }

  const context = transitionFrom(check.window, request.date, request.duty);
  const suitability = assessSuitability(context);

  return {
    employeeId: request.employeeId,
    date: request.date,
    dutyCode: request.duty.code,
    hardEligible: true,
    decision: evaluation.decision,
    outcome: evaluation.outcome,
    blockingReasons: [],
    suitability,
    showToEmployee: suitability.selfServiceSuitable,
    // De dienstindeling mag afwegen wat een medewerker niet vanzelf krijgt
    // voorgesteld. Wat de engine afkeurt, kan ook zij niet inzetten.
    assignableByPlanner: true,
    summary: suitabilitySummary(suitability),
  };
}

/**
 * Bouwt vorige → kandidaat → volgende uit het roostervenster.
 *
 * Het venster is hetzelfde venster waarmee de rules engine rekent; door het
 * hier te hergebruiken kunnen beide lagen niet uiteenlopen over wat er die week
 * gepland staat.
 */
export function transitionFrom(
  window: ScheduleWindow,
  date: CalendarDate,
  duty: DutyContext,
): TransitionContext {
  const dagen = [...window.days].sort((a, b) => a.date.localeCompare(b.date));

  const vorige = [...dagen]
    .reverse()
    .find((day) => day.date < date && day.positionType === "DUTY" && day.duty);
  const volgende = dagen.find(
    (day) => day.date > date && day.positionType === "DUTY" && day.duty,
  );

  return {
    previous: vorige?.duty ? toNeighbour(vorige.date, vorige.duty) : null,
    candidate: {
      date,
      code: duty.code,
      kinds: duty.kinds,
      shape: {
        startMinute: duty.startMinute,
        endMinute: duty.endMinute,
        breakMinutes: duty.breakMinutes,
        overtimeMinutes: duty.overtimeMinutes,
      },
    },
    next: volgende?.duty ? toNeighbour(volgende.date, volgende.duty) : null,
    daysSincePrevious: vorige ? daysBetween(vorige.date, date) : null,
    daysUntilNext: volgende ? daysBetween(date, volgende.date) : null,
  };
}

function toNeighbour(date: CalendarDate, duty: DutyContext): NeighbourDuty {
  return {
    date,
    code: duty.code,
    kinds: duty.kinds,
    shape: {
      startMinute: duty.startMinute,
      endMinute: duty.endMinute,
      breakMinutes: duty.breakMinutes,
      overtimeMinutes: duty.overtimeMinutes,
    },
  };
}

/**
 * Beoordeelt een lijst mogelijke plaatsingen en ordent ze.
 *
 * De volgorde is niet onderhandelbaar: eerst filteren op wat mag, dan pas
 * ordenen. Een ongeldige kandidaat komt niet in de rangschikking terecht, ook
 * niet onderaan — anders staat hij op het scherm en wordt hij vroeg of laat
 * aangeklikt.
 */
export async function rankAssignments(
  requests: readonly SuitabilityRequest[],
  audience: Audience,
): Promise<readonly AssignmentSuitability[]> {
  const beoordeeld: AssignmentSuitability[] = [];
  for (const request of requests) {
    beoordeeld.push(await assessAssignment(request));
  }

  const toegestaan = beoordeeld.filter((item) => item.hardEligible);
  const zichtbaar =
    audience === "EMPLOYEE" ? toegestaan.filter((item) => item.showToEmployee) : toegestaan;

  return [...zichtbaar].sort(
    (a, b) => (b.suitability?.score ?? 0) - (a.suitability?.score ?? 0),
  );
}

/** De dag ná deze dag; hulpje voor aanroepers die een venster opbouwen. */
export function nextDay(date: CalendarDate): CalendarDate {
  return addDays(date, 1);
}
