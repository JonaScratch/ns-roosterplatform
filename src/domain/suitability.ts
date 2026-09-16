import type { DutyKind } from "@/lib/generated/prisma/enums";
import type { CalendarDate } from "./time";
import { formatDuration, formatMinuteOfDay, isWeekend } from "./time";
import {
  type DutyOccurrence,
  type DutyShape,
  measureDuty,
  isHardNightService,
  restBetween,
  startMinuteOfDay,
} from "./duty-window";

/**
 * Roosterkwaliteit: de laag tussen "mag het" en "wie krijgt hem".
 *
 * ## Waarom deze laag bestaat
 *
 * De rules engine beantwoordt één vraag: levert deze plaatsing een overtreding
 * op? Dat is een juridisch oordeel en het is bewust smal. Maar een plaatsing kan
 * juridisch precies door de beugel en toch een slechte planning zijn.
 *
 * Het klassieke geval: iemand rijdt maandag dienst 101 tot 01:24, heeft dinsdag
 * reserve, en krijgt van het systeem een dienst aangeboden die om 05:00 begint.
 * De rusttijd haalt de norm net. En toch is het geen redelijke dienst om iemand
 * als eerste voor te stellen: hij draait het dag-nachtritme in één stap om,
 * terwijl er waarschijnlijk late diensten open staan die wél aansluiten.
 *
 * Een systeem dat alleen "mag het" kan zeggen, zegt daar niets over. Dan wordt
 * de minimumnorm de norm — precies waar een minimum niet voor bedoeld is.
 *
 * ## Wat deze laag uitdrukkelijk niet is
 *
 * Geen CAO-regel. Er staat nergens in de aangeleverde bronnen dat een vroege
 * dienst na een late dienst verboden is. Dit is **productbeleid**:
 * `SELF_SERVICE_PATTERN_COMPATIBILITY`. Het staat daarom niet in de
 * regelcatalogus tussen de juridische bepalingen, het levert nooit een
 * `hard violation` op, en het kan nooit een overtreding goedmaken. Het bepaalt
 * alleen wát er uit een verzameling toegestane opties als eerste wordt getoond
 * en aan wie.
 *
 * ## Waarom de volgende dienst er altijd bij hoort
 *
 * Een dienst beoordelen op de rust ervóór is de helft van het verhaal. Wie
 * dinsdag een late dienst kiest en woensdag om 05:00 moet beginnen, heeft een
 * probleem dat pas woensdag zichtbaar wordt. Elke beoordeling hier kijkt daarom
 * naar `vorige → kandidaat → volgende`.
 */

// ── De beoordeelde overgang ──────────────────────────────────────────────────

export interface NeighbourDuty {
  readonly date: CalendarDate;
  readonly code: string;
  readonly kinds: readonly DutyKind[];
  readonly shape: DutyShape;
}

export interface TransitionContext {
  /** De laatste dienst vóór de kandidaatdag. Null bij geen dienst in beeld. */
  readonly previous: NeighbourDuty | null;
  readonly candidate: NeighbourDuty;
  /** De eerste dienst ná de kandidaatdag. */
  readonly next: NeighbourDuty | null;
  /**
   * Hoeveel dagen er tussen de vorige dienst en de kandidaat zitten. Nul
   * betekent dat er geen tussenliggende vrije of reservedag was.
   */
  readonly daysSincePrevious: number | null;
  readonly daysUntilNext: number | null;
}

export type FactorVerdict = "GOOD" | "ACCEPTABLE" | "POOR" | "UNKNOWN";

export interface SuitabilityFactor {
  readonly key: string;
  readonly label: string;
  readonly verdict: FactorVerdict;
  /** 0 tot 1. Alleen om te ordenen, nooit om iets toe te staan. */
  readonly score: number;
  /** In gewone taal, zoals een planner het zou zeggen. */
  readonly detail: string;
}

export interface SuitabilityAssessment {
  /**
   * Mag dit standaard aan een medewerker worden voorgesteld?
   *
   * Onwaar betekent níet "verboden". Het betekent: niet vanzelf aanbieden. De
   * dienstindeling kan hem met de bezwaren erbij nog steeds inzetten.
   */
  readonly selfServiceSuitable: boolean;
  /** 0 tot 1, samengesteld uit de factoren hieronder. */
  readonly score: number;
  readonly factors: readonly SuitabilityFactor[];
  /** De bezwaren, in bedrijfstaal. Leeg wanneer er geen zijn. */
  readonly concerns: readonly string[];
  readonly policyId: string;
  readonly policyVersion: string;
}

// ── Het beleid ───────────────────────────────────────────────────────────────

/**
 * De grenzen van dit beleid.
 *
 * Alle waarden hieronder zijn **productkeuzes**, geen normen uit een bron. Ze
 * staan expliciet bij elkaar zodat ze te herkennen, te bespreken en in één keer
 * te vervangen zijn zodra NS er iets over vastlegt. Wat hier niet gebeurt, is
 * ze als regel presenteren.
 */
export interface SuitabilityPolicy {
  readonly id: string;
  readonly version: string;
  /** Rust waarbij een overgang comfortabel heet. */
  readonly comfortableRestMinutes: number;
  /** Rust waaronder een overgang als krap wordt aangemerkt. */
  readonly tightRestMinutes: number;
  /** Een dienst die vóór dit tijdstip begint, heet vroeg. */
  readonly earlyStartBefore: number;
  /** Een dienst die ná dit tijdstip eindigt, heet laat. */
  readonly lateEndAfter: number;
  /** Hoeveel de starttijd mag terugschuiven voordat het terugdraaien heet. */
  readonly maxBackwardShiftMinutes: number;
  /** Vanaf deze dienstduur telt een dienst als lang. */
  readonly longDutyMinutes: number;
  /** Onder deze samengestelde score wordt niet vanzelf aangeboden. */
  readonly selfServiceThreshold: number;
}

export const DEFAULT_SUITABILITY_POLICY: SuitabilityPolicy = {
  id: "SELF_SERVICE_PATTERN_COMPATIBILITY",
  version: "1.0.0",
  comfortableRestMinutes: 14 * 60,
  tightRestMinutes: 13 * 60,
  earlyStartBefore: 7 * 60,
  lateEndAfter: 22 * 60,
  maxBackwardShiftMinutes: 4 * 60,
  longDutyMinutes: 9 * 60,
  selfServiceThreshold: 0.6,
};

// ── De beoordeling ───────────────────────────────────────────────────────────

function occurrence(duty: NeighbourDuty): DutyOccurrence {
  return { date: duty.date, shape: duty.shape };
}

function has(duty: NeighbourDuty, kind: DutyKind | string): boolean {
  return (duty.kinds as readonly string[]).includes(kind);
}

/** Eindigt deze dienst laat of in de nacht? */
function endsLate(duty: NeighbourDuty, policy: SuitabilityPolicy): boolean {
  // `endMinute` mag voorbij 1440 lopen; dat is per definitie na middernacht.
  return duty.shape.endMinute >= policy.lateEndAfter;
}

function startsEarly(duty: NeighbourDuty, policy: SuitabilityPolicy): boolean {
  return startMinuteOfDay(duty.shape) < policy.earlyStartBefore;
}

function scoreOfVerdict(verdict: FactorVerdict): number {
  switch (verdict) {
    case "GOOD":
      return 1;
    case "ACCEPTABLE":
      return 0.7;
    case "POOR":
      return 0.15;
    case "UNKNOWN":
      // Onbekend is niet goed. Een factor die niet te beoordelen valt, mag geen
      // volle score opleveren — dan zou ontbrekende informatie belonend werken.
      return 0.5;
  }
}

export function assessSuitability(
  context: TransitionContext,
  policy: SuitabilityPolicy = DEFAULT_SUITABILITY_POLICY,
): SuitabilityAssessment {
  const factors: SuitabilityFactor[] = [
    restBeforeFactor(context, policy),
    restAfterFactor(context, policy),
    rotationFactor(context, policy),
    patternFactor(context, policy),
    burdenFactor(context, policy),
  ];

  const score =
    factors.reduce((sum, factor) => sum + factor.score, 0) / Math.max(factors.length, 1);

  const concerns = factors
    .filter((factor) => factor.verdict === "POOR")
    .map((factor) => factor.detail);

  // Eén slechte factor is genoeg om niet vanzelf aan te bieden. Middelen zou
  // precies het geval verbergen waar het om gaat: een prima rust met een
  // onmogelijk ritme.
  const selfServiceSuitable = concerns.length === 0 && score >= policy.selfServiceThreshold;

  return {
    selfServiceSuitable,
    score: Number(score.toFixed(4)),
    factors,
    concerns,
    policyId: policy.id,
    policyVersion: policy.version,
  };
}

function restBeforeFactor(
  context: TransitionContext,
  policy: SuitabilityPolicy,
): SuitabilityFactor {
  const { previous, candidate } = context;
  if (!previous) {
    return {
      key: "REST_BEFORE",
      label: "Rust vooraf",
      verdict: "GOOD",
      score: 1,
      detail: "Geen dienst in de dagen ervoor; de rust vooraf is ruim.",
    };
  }
  const rest = restBetween(occurrence(previous), occurrence(candidate));
  const verdict: FactorVerdict =
    rest >= policy.comfortableRestMinutes
      ? "GOOD"
      : rest >= policy.tightRestMinutes
        ? "ACCEPTABLE"
        : "POOR";
  return {
    key: "REST_BEFORE",
    label: "Rust vooraf",
    verdict,
    score: scoreOfVerdict(verdict),
    detail:
      `Na dienst ${previous.code} (eindigt ${formatMinuteOfDay(previous.shape.endMinute)}) ` +
      `blijft ${formatDuration(rest)} rust over tot deze dienst begint.`,
  };
}

function restAfterFactor(context: TransitionContext, policy: SuitabilityPolicy): SuitabilityFactor {
  const { candidate, next } = context;
  if (!next) {
    return {
      key: "REST_AFTER",
      label: "Rust erna",
      verdict: "GOOD",
      score: 1,
      detail: "Er staat in de dagen erna geen dienst gepland.",
    };
  }
  const rest = restBetween(occurrence(candidate), occurrence(next));
  const verdict: FactorVerdict =
    rest >= policy.comfortableRestMinutes
      ? "GOOD"
      : rest >= policy.tightRestMinutes
        ? "ACCEPTABLE"
        : "POOR";
  return {
    key: "REST_AFTER",
    label: "Rust erna",
    verdict,
    score: scoreOfVerdict(verdict),
    detail:
      `Daarna volgt dienst ${next.code} (begint ${formatMinuteOfDay(
        startMinuteOfDay(next.shape),
      )}); daartussen zit ${formatDuration(rest)} rust.`,
  };
}

/**
 * De draairichting.
 *
 * Vooruit draaien — vroeg naar laat naar nacht — is voor de meeste mensen
 * makkelijker vol te houden dan terugdraaien. Dit is een voorkeur en geen norm;
 * hij weegt mee en beslist niets in zijn eentje.
 */
function rotationFactor(context: TransitionContext, policy: SuitabilityPolicy): SuitabilityFactor {
  const { previous, candidate } = context;
  if (!previous) {
    return {
      key: "ROTATION",
      label: "Draairichting",
      verdict: "GOOD",
      score: 1,
      detail: "Geen voorgaande dienst om tegen af te zetten.",
    };
  }

  const vorigeStart = startMinuteOfDay(previous.shape);
  const nieuweStart = startMinuteOfDay(candidate.shape);
  const verschuiving = nieuweStart - vorigeStart;

  if (verschuiving >= 0) {
    return {
      key: "ROTATION",
      label: "Draairichting",
      verdict: "GOOD",
      score: 1,
      detail:
        `De dienst begint ${formatDuration(verschuiving)} later dan de vorige; dat is de ` +
        "natuurlijke richting.",
    };
  }

  const terug = Math.abs(verschuiving);
  const verdict: FactorVerdict = terug > policy.maxBackwardShiftMinutes ? "POOR" : "ACCEPTABLE";
  return {
    key: "ROTATION",
    label: "Draairichting",
    verdict,
    score: scoreOfVerdict(verdict),
    detail:
      `De dienst begint ${formatDuration(terug)} vroeger dan de vorige (${formatMinuteOfDay(
        vorigeStart,
      )} → ${formatMinuteOfDay(nieuweStart)}); dat is terugdraaien in het ritme.`,
  };
}

/**
 * Het patroon: laat gevolgd door zeer vroeg, of nacht gevolgd door vroeg.
 *
 * Dit is de factor waarvoor deze hele laag bestaat. Hij kijkt niet naar de
 * hoeveelheid rust maar naar het soort dienst ervoor en erna.
 */
function patternFactor(context: TransitionContext, policy: SuitabilityPolicy): SuitabilityFactor {
  const { previous, candidate, next } = context;
  const bezwaren: string[] = [];

  if (previous && endsLate(previous, policy) && startsEarly(candidate, policy)) {
    bezwaren.push(
      `dienst ${previous.code} eindigt ${formatMinuteOfDay(previous.shape.endMinute)} en deze ` +
        `dienst begint al ${formatMinuteOfDay(startMinuteOfDay(candidate.shape))}`,
    );
  }
  if (previous && has(previous, "NACHT") && startsEarly(candidate, policy)) {
    bezwaren.push(`na een nachtdienst (${previous.code}) volgt hier meteen een vroege start`);
  }
  if (next && endsLate(candidate, policy) && startsEarly(next, policy)) {
    bezwaren.push(
      `deze dienst eindigt ${formatMinuteOfDay(candidate.shape.endMinute)} terwijl de dienst ` +
        `erna (${next.code}) om ${formatMinuteOfDay(startMinuteOfDay(next.shape))} begint`,
    );
  }
  if (next && has(candidate, "NACHT") && !has(next, "NACHT")) {
    // Eén losse nacht midden in een dagritme is zwaarder dan een nachtreeks.
    bezwaren.push(`een losse nachtdienst tussen dagdiensten (erna volgt ${next.code})`);
  }

  if (bezwaren.length === 0) {
    return {
      key: "PATTERN",
      label: "Ritme",
      verdict: "GOOD",
      score: 1,
      detail: "De dienst sluit qua dagdeel aan op wat ervoor en erna staat.",
    };
  }
  return {
    key: "PATTERN",
    label: "Ritme",
    verdict: "POOR",
    score: scoreOfVerdict("POOR"),
    detail: `Ongunstige opeenvolging: ${bezwaren.join("; ")}.`,
  };
}

/** Zwaarte: lange dienst, harde nacht, weekend. Weegt mee, verbiedt niets. */
function burdenFactor(context: TransitionContext, policy: SuitabilityPolicy): SuitabilityFactor {
  const { candidate } = context;
  const punten: string[] = [];
  const duur = measureDuty(occurrence(candidate)).dutyMinutes;

  if (duur >= policy.longDutyMinutes) {
    punten.push(`lange dienst (${formatDuration(duur)})`);
  }
  if (isHardNightService(candidate.shape)) {
    punten.push("harde nacht");
  }
  if (isWeekend(candidate.date)) {
    punten.push("weekenddienst");
  }

  if (punten.length === 0) {
    return {
      key: "BURDEN",
      label: "Zwaarte",
      verdict: "GOOD",
      score: 1,
      detail: "Geen bijzondere belasting.",
    };
  }
  const verdict: FactorVerdict = punten.length >= 2 ? "ACCEPTABLE" : "GOOD";
  return {
    key: "BURDEN",
    label: "Zwaarte",
    verdict,
    score: scoreOfVerdict(verdict),
    detail: `Zwaardere dienst: ${punten.join(", ")}.`,
  };
}

/** Eén zin voor de medewerker, zonder gegevens over anderen. */
export function suitabilitySummary(assessment: SuitabilityAssessment): string {
  if (assessment.selfServiceSuitable) {
    return "Deze dienst sluit aan op uw rooster.";
  }
  if (assessment.concerns.length === 0) {
    return "Deze dienst past minder goed in uw rooster.";
  }
  return `Niet passend: ${assessment.concerns[0]}`;
}
