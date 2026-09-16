import { formatSpan } from "@/domain/amsterdam-time";
import { dayNumber } from "@/domain/time";
import { endMinuteOfDay, isNightServiceByTime } from "@/domain/duty-window";
import { RULE } from "../../ruleset/rule-ids";
import type { Evaluation, UsableRule } from "../evaluation";
import {
  type AssignmentRequest,
  hasException,
  protection,
} from "../subject";
import {
  type TimelineDay,
  dayAt,
  nextDuty,
  nightRunEndingBefore,
  previousDuty,
  restMinutesBetween,
} from "../timeline";

/**
 * Dagelijkse rust.
 *
 * ## Twee kanten, altijd
 *
 * Een plaatsing verandert de rust vóór de dienst én erna. Alleen naar de rust
 * ervoor kijken is de klassieke fout: de dienst past keurig achter de vorige,
 * en drukt de rust naar de volgende ochtenddienst naar zeven uur.
 *
 * ## Waarom acht uur hier bijna nooit geldt
 *
 * De bron staat een verkorte rust van acht uur toe, maar uitdrukkelijk **niet
 * planmatig**. Een basisrooster of een 28-daagse planning waarin acht uur staat
 * ingeroosterd, is daarmee in strijd met de bepaling waarop hij zich beroept.
 * De verkorting bestaat hier dus alleen in de operationele fase, alleen met een
 * vastgelegde geautoriseerde uitzondering, en levert altijd een signaal aan de
 * optimizer dat dit geen instrument is om een rooster passend te maken.
 */

interface RestPair {
  readonly earlier: TimelineDay;
  readonly later: TimelineDay;
  /** Ligt de rustperiode vóór of na de kandidaatdienst? */
  readonly side: "VOOR" | "NA";
}

export function checkDailyRest(request: AssignmentRequest, evaluation: Evaluation): void {
  const candidate = dayAt(request.timeline, request.date);
  if (!candidate?.duty) {
    return;
  }

  if (!evaluation.hasContext("ADJACENT_DUTIES", [RULE.RP_DAILY_REST_PLANNED])) {
    return;
  }

  const before = previousDuty(request.timeline, request.date);
  const after = nextDuty(request.timeline, request.date);

  const pairs: RestPair[] = [
    ...(before ? [{ earlier: before, later: candidate, side: "VOOR" as const }] : []),
    ...(after ? [{ earlier: candidate, later: after, side: "NA" as const }] : []),
  ];

  for (const pair of pairs) {
    checkPair(request, pair, evaluation);
  }
}

function checkPair(request: AssignmentRequest, pair: RestPair, evaluation: Evaluation): void {
  const actualRest = restMinutesBetween(pair.earlier, pair.later);
  if (actualRest === null) {
    return;
  }

  if (actualRest < 0) {
    const rule = evaluation.require(RULE.RP_DAILY_REST_PLANNED);
    if (rule) {
      evaluation.violate(rule, {
        calculatedValue: actualRest,
        limit: rule.minutes,
        message:
          `Dienst ${pair.earlier.duty!.code} op ${pair.earlier.date} en dienst ` +
          `${pair.later.duty!.code} op ${pair.later.date} overlappen elkaar in de tijd.`,
        occurrenceKey: `rust:${pair.earlier.date}..${pair.later.date}`,
      });
    }
    return;
  }

  // Elke bepaling die hier geldt, met haar eigen minimum. De strengste bepaalt
  // de uitkomst, maar ze worden alle apart getoetst zodat in de uitleg staat
  // wélke bepaling wordt overtreden en niet alleen dát er een grens is.
  for (const requirement of requirementsFor(request, pair, evaluation)) {
    assertRest(request, pair, requirement, actualRest, evaluation);
  }
}

interface RestRequirement {
  readonly rule: UsableRule;
  /** Het minimum in minuten, na verwerking van een geautoriseerde uitzondering. */
  readonly minimumMinutes: number;
  readonly because: string;
  /** De regel waarop een verkorting berust, wanneer die is toegepast. */
  readonly reducedBy?: UsableRule;
}

function requirementsFor(
  request: AssignmentRequest,
  pair: RestPair,
  evaluation: Evaluation,
): readonly RestRequirement[] {
  const requirements: RestRequirement[] = [];

  const planned = evaluation.require(RULE.RP_DAILY_REST_PLANNED);
  if (planned) {
    const reduction = reducedMinimum(request, planned, evaluation);
    requirements.push({
      rule: planned,
      minimumMinutes: reduction?.minutes ?? planned.minutes,
      because: "dagelijkse onafgebroken rust",
      reducedBy: reduction?.rule,
    });
  }

  const earlierShape = pair.earlier.duty!.shape;
  if (isNightServiceByTime(earlierShape) && endMinuteOfDay(earlierShape) > 120) {
    const nightRest = evaluation.require(RULE.NIGHT_REST_AFTER_0200);
    if (nightRest) {
      requirements.push({
        rule: nightRest,
        minimumMinutes: nightRest.minutes,
        because: `dienst ${pair.earlier.duty!.code} is een nachtdienst die na 02:00 eindigt`,
      });
    }
  }

  const recovery = recoveryRequirement(request, pair, evaluation);
  if (recovery) {
    requirements.push(recovery);
  }

  return requirements;
}

/**
 * Herstelrust na een reeks nachtdiensten.
 *
 * Wordt gemeten vanaf het einde van de laatste nachtdienst van de reeks. De
 * reeks moet daarvoor volledig in beeld zijn; is dat niet zo, dan wordt de
 * toets niet stilzwijgend overgeslagen maar als hiaat gemeld.
 */
function recoveryRequirement(
  request: AssignmentRequest,
  pair: RestPair,
  evaluation: Evaluation,
): RestRequirement | null {
  const earlierShape = pair.earlier.duty!.shape;
  if (!isNightServiceByTime(earlierShape)) {
    return null;
  }

  const rule = evaluation.require(RULE.NIGHT_SEQUENCE_RECOVERY);
  const threshold = evaluation.require(RULE.NIGHT_SEQUENCE_RECOVERY_THRESHOLD);
  if (!rule || !threshold) {
    return null;
  }
  if (!evaluation.hasContext("DAYS_14", [RULE.NIGHT_SEQUENCE_RECOVERY])) {
    return null;
  }

  // De reeks tot en met de eerdere dienst: alles vóór die dag, plus die dag zelf.
  const run = nightRunEndingBefore(request.timeline, pair.earlier.date).length + 1;
  if (run < threshold.count) {
    return null;
  }

  return {
    rule,
    minimumMinutes: rule.minutes,
    because: `dienst ${pair.earlier.duty!.code} sluit een reeks van ${run} nachtdiensten af`,
  };
}

/**
 * Mag het minimum hier omlaag?
 *
 * Alleen wanneer de bron dat toestaat, de fase operationeel is, én er een
 * vastgelegde geautoriseerde uitzondering ligt. Ontbreekt één van de drie, dan
 * geldt gewoon het volle minimum — niet als straf, maar omdat een verkorting
 * zonder die drie geen verkorting is maar een overtreding.
 */
function reducedMinimum(
  request: AssignmentRequest,
  planned: UsableRule,
  evaluation: Evaluation,
): { readonly minutes: number; readonly rule: UsableRule } | null {
  const operational =
    request.planningStage === "DW_LOCK" || request.planningStage === "POST_DW_OPERATIONAL";
  if (!operational) {
    return null;
  }
  if (!hasException(request, RULE.DAILY_REST_REDUCED_NON_PLANNED)) {
    return null;
  }

  const reduced = evaluation.require(RULE.DAILY_REST_REDUCED_NON_PLANNED);
  if (!reduced || reduced.minutes >= planned.minutes) {
    return null;
  }
  return { minutes: reduced.minutes, rule: reduced };
}

function assertRest(
  request: AssignmentRequest,
  pair: RestPair,
  requirement: RestRequirement,
  actualRest: number,
  evaluation: Evaluation,
): void {
  if (actualRest >= requirement.minimumMinutes) {
    if (requirement.reducedBy) {
      reportReduction(request, pair, requirement, actualRest, evaluation);
    }
    return;
  }

  const wallClockRest = wallClockRestMinutes(pair);
  const causedByDst = wallClockRest >= requirement.minimumMinutes;

  if (causedByDst && protection(request.subject, "DST_CONSENT")) {
    evaluation.warn(requirement.rule, {
      calculatedValue: actualRest,
      limit: requirement.minimumMinutes,
      message:
        `De rust ${pair.side.toLowerCase()} dienst ${request.candidate.code} is op de klok ` +
        `${formatSpan(wallClockRest)}, maar werkelijk ${formatSpan(actualRest)} door het ingaan ` +
        "van de zomertijd. Hiervoor is instemming vastgelegd.",
      occurrenceKey: `rust:${pair.earlier.date}..${pair.later.date}`,
      details: { klokminuten: wallClockRest, werkelijkeMinuten: actualRest },
    });
    return;
  }

  evaluation.violate(requirement.rule, {
    calculatedValue: actualRest,
    limit: requirement.minimumMinutes,
    message:
      `De rust ${pair.side === "VOOR" ? "vóór" : "na"} dienst ${request.candidate.code} is ` +
      `${formatSpan(actualRest)}; vereist is ${formatSpan(requirement.minimumMinutes)} ` +
      `(${requirement.because}).` +
      (causedByDst
        ? ` Op de klok lijkt de rust ${formatSpan(wallClockRest)}; het verschil komt door het ` +
          "ingaan van de zomertijd. Rust is werkelijk verstreken tijd, en voor deze " +
          "medewerker is geen instemming met een kortere rust vastgelegd."
        : ""),
    occurrenceKey: `rust:${pair.earlier.date}..${pair.later.date}`,
    details: { klokminuten: wallClockRest, werkelijkeMinuten: actualRest },
  });
}

/**
 * Een toegepaste verkorting is nooit gewoon "in orde".
 *
 * Ze wordt uitgelegd, aan de uitzondering gekoppeld en als signaal aan de
 * optimizer meegegeven met de laagst mogelijke wenselijkheid. Zo kan een
 * optimizer die op score stuurt hier nooit naartoe rekenen.
 */
function reportReduction(
  request: AssignmentRequest,
  pair: RestPair,
  requirement: RestRequirement,
  actualRest: number,
  evaluation: Evaluation,
): void {
  const exception = hasException(request, RULE.DAILY_REST_REDUCED_NON_PLANNED);
  const full = requirement.rule.minutes;
  if (actualRest >= full) {
    return;
  }

  evaluation.warn(requirement.reducedBy!, {
    calculatedValue: actualRest,
    limit: full,
    message:
      `De rust ${pair.side === "VOOR" ? "vóór" : "na"} dienst ${request.candidate.code} is ` +
      `${formatSpan(actualRest)} en daarmee korter dan de geplande ${formatSpan(full)}. Dit is ` +
      "alleen toegestaan als niet-planmatige uitzondering en is als zodanig vastgelegd.",
    occurrenceKey: `rust:${pair.earlier.date}..${pair.later.date}|verkort`,
    details: { verleendDoor: exception?.grantedByUserId, verleendOp: exception?.grantedAt },
  });

  evaluation.impact({
    ruleId: RULE.DAILY_REST_REDUCED_NON_PLANNED,
    title: "Verkorte dagelijkse rust, niet planmatig",
    score: 0,
    message:
      "Verkorte dagelijkse rust mag niet worden gebruikt om een rooster passend te " +
      "maken. Deze plaatsing telt voor de optimizer als de slechtst mogelijke uitkomst.",
  });
}

/** De rust volgens de klok, dus zonder verrekening van de zomertijd. */
function wallClockRestMinutes(pair: RestPair): number {
  const days = dayNumber(pair.later.date) - dayNumber(pair.earlier.date);
  return days * 1440 + pair.later.duty!.shape.startMinute - pair.earlier.duty!.shape.endMinute;
}
