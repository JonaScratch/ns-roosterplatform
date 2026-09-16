import { formatSpan, localDateOf, zonedInstant } from "@/domain/amsterdam-time";
import { type CalendarDate, addDays, isoWeekday } from "@/domain/time";
import { RULE } from "../../ruleset/rule-ids";
import type { Evaluation } from "../evaluation";
import type { UnverifiedFact } from "../result";
import { type AssignmentRequest, hasException, protection } from "../subject";
import { type Timeline, daysBetween } from "../timeline";
import { coversSpan } from "./windows";

/**
 * Het driewekelijkse vrije weekend — CAO art. 102 lid 3.
 *
 * ## Wat de regel wél zegt
 *
 * Eenmaal per drie weken een **aaneengesloten rustperiode van minimaal 60 uur
 * die de periode zaterdag 00:00 tot en met maandag 04:00 omvat**. Twee eisen dus,
 * en de tweede is niet af te leiden uit de eerste: zestig uur rust die op
 * vrijdagmiddag begint en zondagnacht eindigt, omvat maandag 04:00 niet.
 *
 * ## Wat de regel niet zegt
 *
 * Niets over gewerkte zaterdagen of zondagen. Een eerdere versie van deze
 * controle telde in de praktijk weekenden zonder dienst en toetste daarna een
 * losse rustlengte. Dat lijkt hetzelfde en is het niet: het beantwoordt de vraag
 * "is dit weekend vrij" in plaats van "bestaat er een rustperiode met deze twee
 * eigenschappen". Daarom rekent deze controle uitsluitend op werkelijke
 * tijdstempels: de rustintervallen tussen diensten, gemeten in verstreken tijd,
 * met zomertijd verrekend.
 *
 * ## Waarom een bevinding hier zelden bewezen is
 *
 * Van de regel kan individueel vrijwillig én collectief met instemming van de
 * ondernemingsraad worden afgeweken, en Bijlage IV kent eigen
 * rood-weekendsituaties. Van geen van drieën is een bron aangesloten. Een
 * berekende overschrijding is daarmee wel een berekening, maar geen bewijs: zij
 * wordt gemeld met precies die openstaande vragen erbij. Een vergoeding maakt
 * een ongeldige planning overigens niet geldig — alleen een toegestane afwijking
 * raakt de toepasselijkheid.
 */

/** Zaterdag 00:00 tot en met maandag 04:00, op de as van de zaterdag. */
const WEEKEND_WINDOW = { fromMinute: 0, toMinute: 2 * 1440 + 4 * 60 } as const;

export interface RedWeekendAssessment {
  readonly saturday: CalendarDate;
  readonly requiredRestWindowFrom: string;
  readonly requiredRestWindowTo: string;
  /** De langste aaneengesloten rust die het vereiste venster raakt, in minuten. */
  readonly actualContinuousRest: number;
  readonly actualRestFrom: string | null;
  readonly actualRestTo: string | null;
  readonly saturday00Included: boolean;
  readonly monday04Included: boolean;
  readonly meetsMinimumRest: boolean;
  /** Voldoet dit weekend aan beide eisen? */
  readonly qualifies: boolean;
  /** Onvoldoende gegevens om hierover iets te zeggen. */
  readonly undetermined: boolean;
}

export function checkRedWeekend(request: AssignmentRequest, evaluation: Evaluation): void {
  const rule = evaluation.require(RULE.RED_WEEKEND_MIN_REST);
  const interval = evaluation.require(RULE.RED_WEEKEND_INTERVAL_WEEKS);
  if (!rule || !interval) {
    return;
  }

  const waiver = protection(request.subject, "RED_WEEKEND_WAIVER");
  if (waiver && waiver.validUntil >= request.date) {
    evaluation.impact({
      ruleId: rule.definition.id,
      title: rule.definition.title,
      score: 0.5,
      message:
        `Voor deze medewerker is tot en met ${waiver.validUntil} een individuele vrijwillige ` +
        "afwijking van het driewekelijkse vrije weekend vastgelegd.",
    });
    return;
  }

  // De dekking wordt vastgelegd, maar niet als poort gebruikt. Deze regel
  // kijkt naar drie concrete weekenden; voor een reeks die vóór de beoordeelde
  // dag uit ligt, is helemaal geen historie nodig. Een blanco eis van vier weken
  // terug sloeg daardoor elke reeks in de eerste roostermaand over — zonder dat
  // iemand dat aan de uitkomst kon zien.
  evaluation.recordCoverage("WEEKS_4", [rule.definition.id]);

  const weekends = saturdaysAround(request.date, interval.count * 7).map((saturday) =>
    assessWeekend(request.timeline, saturday, rule.minutes),
  );

  let assessableRuns = 0;
  let runsTouchingDate = 0;

  for (let start = 0; start + interval.count <= weekends.length; start += 1) {
    const run = weekends.slice(start, start + interval.count);
    const from = run[0].saturday;
    const to = addDays(run[run.length - 1].saturday, 2);

    // Alleen reeksen die de beoordeelde dag raken. Anders zou het valideren van
    // één dag uitspraken doen over weekenden die er niets mee te maken hebben.
    if (request.date < from || request.date > to) {
      continue;
    }
    runsTouchingDate += 1;
    if (run.some((entry) => entry.undetermined)) {
      continue;
    }
    assessableRuns += 1;
    if (run.some((entry) => entry.qualifies)) {
      continue;
    }

    evaluation.violate(rule, {
      calculatedValue: Math.max(...run.map((entry) => entry.actualContinuousRest)),
      limit: rule.minutes,
      // Het onderliggende feit is de reeks weekenden, niet de dag waarop dit
      // toevallig werd opgemerkt. Alle dagen binnen deze reeks leveren dezelfde
      // sleutel op en tellen dus als één probleem.
      occurrenceKey: `weekendreeks:${from}..${to}`,
      message:
        `Van ${from} tot en met ${to} is er geen aaneengesloten rustperiode van ` +
        `${formatSpan(rule.minutes)} die zaterdag 00:00 tot en met maandag 04:00 omvat. ` +
        `De langste rust die een van deze drie weekenden raakt, is ` +
        `${formatSpan(Math.max(...run.map((entry) => entry.actualContinuousRest)))}.`,
      details: {
        threeWeekWindowStart: from,
        threeWeekWindowEnd: to,
        weekenden: run.map((entry) => ({
          saturday: entry.saturday,
          requiredRestWindow: `${entry.requiredRestWindowFrom} — ${entry.requiredRestWindowTo}`,
          actualContinuousRest: entry.actualContinuousRest,
          actualRestWindow:
            entry.actualRestFrom && entry.actualRestTo
              ? `${entry.actualRestFrom} — ${entry.actualRestTo}`
              : null,
          Saturday00Included: entry.saturday00Included,
          Monday04Included: entry.monday04Included,
          meetsMinimumRest: entry.meetsMinimumRest,
        })),
        waiverPresent: false,
        source: sourceLabel(rule.definition.source),
      },
      unverified: openApplicabilityQuestions(request),
    });
    // Bewust geen `return`: een dag kan in meer dan één reeks van drie weekenden
    // vallen, en elke reeks is een eigen probleem met een eigen sleutel. Stoppen
    // na de eerste zou blokkeren even goed doen, maar een regressierapport te
    // weinig feiten laten zien — en dat is precies waar zo'n rapport voor is.
  }

  // Viel er over geen enkele reeks iets te zeggen, dan is dat een hiaat en geen
  // stilte.
  if (runsTouchingDate > 0 && assessableRuns === 0) {
    evaluation.noteContextGap("WEEKS_4", [rule.definition.id]);
  }
}

/**
 * De openstaande toepasselijkheidsvragen bij deze regel.
 *
 * Geen van deze bronnen is aangesloten. Dat maakt de berekening niet onjuist,
 * maar wel onvoldoende om een overtreding te bewijzen — en dat hoort in de
 * bevinding te staan en niet in een voetnoot bij het rapport.
 */
function openApplicabilityQuestions(request: AssignmentRequest): readonly UnverifiedFact[] {
  const facts: UnverifiedFact[] = [
    {
      kind: "APPLICABILITY",
      detail:
        "Er is geen bron aangesloten waaruit blijkt of de ondernemingsraad een collectieve " +
        "afwijking van het driewekelijkse vrije weekend heeft toegestaan.",
    },
    {
      kind: "APPLICABILITY",
      detail:
        "De rood-weekendsituaties uit Bijlage IV zijn niet aangeleverd; of deze medewerker " +
        "of roosterlijn daaronder valt, is niet vast te stellen.",
    },
  ];

  if (!hasException(request, RULE.RED_WEEKEND_MIN_REST)) {
    facts.push({
      kind: "APPLICABILITY",
      detail:
        "Een individuele vrijwillige afwijking is niet vastgelegd. Of die ontbreekt omdat zij " +
        "er niet is, of omdat zij nergens is geregistreerd, is met de huidige gegevens niet " +
        "te onderscheiden.",
    });
  }

  return facts;
}

/**
 * Beoordeelt één weekend op beide eisen.
 *
 * Werkt op instants, niet op roosterposities: het vereiste venster is een
 * periode in de tijd, en of die vrij is hangt af van de begin- en eindtijden van
 * de omliggende diensten — ook wanneer die op andere kalenderdagen staan.
 */
export function assessWeekend(
  timeline: Timeline,
  saturday: CalendarDate,
  minimumRestMinutes: number,
): RedWeekendAssessment {
  const monday = addDays(saturday, 2);
  const windowStart = zonedInstant(saturday, WEEKEND_WINDOW.fromMinute);
  const windowEnd = zonedInstant(saturday, WEEKEND_WINDOW.toMinute);

  const undetermined: RedWeekendAssessment = {
    saturday,
    requiredRestWindowFrom: stamp(windowStart),
    requiredRestWindowTo: stamp(windowEnd),
    actualContinuousRest: 0,
    actualRestFrom: null,
    actualRestTo: null,
    saturday00Included: false,
    monday04Included: false,
    meetsMinimumRest: false,
    qualifies: false,
    undetermined: true,
  };

  // Om een rustperiode van zestig uur rond dit weekend te kunnen meten, moet het
  // rooster ruim vóór zaterdag en ruim ná maandag bekend zijn. Zonder die marge
  // is het antwoord "onbekend" en niet "geen vrij weekend".
  const needed = { from: addDays(saturday, -4), to: addDays(monday, 3) };
  if (!coversSpan(timeline, needed)) {
    return undetermined;
  }

  // Alle diensten die het ruime venster raken, als intervallen op de tijdas.
  const busy = daysBetween(timeline, needed.from, needed.to)
    .filter((day) => day.duty !== null)
    .map((day) => ({
      start: zonedInstant(day.date, day.duty!.shape.startMinute),
      end: zonedInstant(day.date, day.duty!.shape.endMinute),
    }))
    .sort((a, b) => a.start - b.start);

  // De rustperiode rond het weekend: van het einde van de laatste dienst die
  // vóór het vensterEinde afloopt, tot het begin van de eerste dienst daarna.
  const searchFrom = zonedInstant(needed.from, 0);
  const searchTo = zonedInstant(addDays(needed.to, 1), 0);

  let restStart = searchFrom;
  let restEnd = searchTo;
  for (const interval of busy) {
    if (interval.end <= windowStart) {
      restStart = Math.max(restStart, interval.end);
    }
    if (interval.start >= windowEnd) {
      restEnd = Math.min(restEnd, interval.start);
      break;
    }
  }

  const overlapping = busy.some(
    (interval) => interval.start < windowEnd && interval.end > windowStart,
  );

  if (overlapping) {
    // Het vereiste venster is niet vrij. De langste rust die het venster raakt,
    // wordt alsnog gerapporteerd zodat te zien is hoe ver het ernaast zat.
    const touching = longestFreeIntervalTouching(busy, searchFrom, searchTo, windowStart, windowEnd);
    return {
      saturday,
      requiredRestWindowFrom: stamp(windowStart),
      requiredRestWindowTo: stamp(windowEnd),
      actualContinuousRest: Math.round((touching.end - touching.start) / 60_000),
      actualRestFrom: stamp(touching.start),
      actualRestTo: stamp(touching.end),
      saturday00Included: touching.start <= windowStart && touching.end > windowStart,
      monday04Included: touching.start < windowEnd && touching.end >= windowEnd,
      meetsMinimumRest: touching.end - touching.start >= minimumRestMinutes * 60_000,
      qualifies: false,
      undetermined: false,
    };
  }

  const restMinutes = Math.round((restEnd - restStart) / 60_000);
  const saturday00Included = restStart <= windowStart;
  const monday04Included = restEnd >= windowEnd;
  const meetsMinimumRest = restMinutes >= minimumRestMinutes;

  return {
    saturday,
    requiredRestWindowFrom: stamp(windowStart),
    requiredRestWindowTo: stamp(windowEnd),
    actualContinuousRest: restMinutes,
    actualRestFrom: stamp(restStart),
    actualRestTo: stamp(restEnd),
    saturday00Included,
    monday04Included,
    meetsMinimumRest,
    qualifies: saturday00Included && monday04Included && meetsMinimumRest,
    undetermined: false,
  };
}

/** De langste dienstvrije periode die het vereiste venster raakt. */
function longestFreeIntervalTouching(
  busy: readonly { start: number; end: number }[],
  searchFrom: number,
  searchTo: number,
  windowStart: number,
  windowEnd: number,
): { start: number; end: number } {
  let best = { start: windowStart, end: windowStart };
  let cursor = searchFrom;

  for (const interval of [...busy, { start: searchTo, end: searchTo }]) {
    if (interval.start > cursor) {
      const free = { start: cursor, end: interval.start };
      const touches = free.start < windowEnd && free.end > windowStart;
      if (touches && free.end - free.start > best.end - best.start) {
        best = free;
      }
    }
    cursor = Math.max(cursor, interval.end);
  }

  return best;
}

/** De zaterdagen binnen een straal van zoveel dagen rond een datum. */
export function saturdaysAround(
  date: CalendarDate,
  radiusDays: number,
): readonly CalendarDate[] {
  const saturdays: CalendarDate[] = [];
  for (let offset = -radiusDays; offset <= radiusDays; offset += 1) {
    const day = addDays(date, offset);
    if (isoWeekday(day) === 6) {
      saturdays.push(day);
    }
  }
  return saturdays;
}

function stamp(instant: number): string {
  const date = localDateOf(instant);
  const minutes = Math.round((instant - zonedInstant(date, 0)) / 60_000);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}

function sourceLabel(source: { documentTitle: string; article?: string }): string {
  return source.article ? `${source.documentTitle}, art. ${source.article}` : source.documentTitle;
}
