import "server-only";
import {
  AvailableDutyStatus,
  RosterPositionType,
  ScheduleSource,
} from "@/lib/generated/prisma/enums";
import { type CalendarDate, addDays, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { buildSnapshot, placementsForOffset, positionOf, selectWinner } from "@/domain/rotation";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import {
  STATE_LABELS,
  acceptsAllocation,
  acceptsInterest,
  stateByClock,
} from "@/domain/available-duty-state";
import { DEFAULT_PRODUCT_PARAMETERS, rulesEngine } from "@/server/rules-engine";
import type { RuleEvaluationResult } from "@/server/rules-engine";
import { prisma } from "@/server/data/prisma";
import { DUTY_SELECT, toDutyContext } from "@/server/data/mappers";
import { toJson } from "@/server/data/json";
import { buildAssignmentCheck } from "@/server/data/repositories/schedule-repository";
import { rotationListFor } from "./rotation-service";
import { assessAssignment } from "./assignment-suitability-service";
import { flushNotifications, publishInTransaction, userIdsFor } from "./domain-events";

/**
 * Beschikbare diensten.
 *
 * ## De volgorde die deze service bewaakt
 *
 * Een vrijgekomen dienst gaat eerst naar het reserve-rooster. Pas wanneer daar
 * geen geldige invulling uit komt, wordt hij opengesteld voor andere
 * medewerkers. Die volgorde staat in de statusovergangen
 * (`RESERVE_PENDING` → `OPEN`) en niet in de goede bedoelingen van de
 * aanroeper: een dienst die nog `RESERVE_PENDING` is, komt in geen enkele
 * medewerkerslijst voor.
 *
 * ## Wat een medewerker te zien krijgt
 *
 * Alleen diensten waarvoor hij roostertechnisch geschikt is. De geschiktheid
 * wordt vóór het tonen bepaald door de Rules Engine, met het volledige venster:
 * huidige roosterpositie, vorige dienst, volgende dienst, rust ervoor, rust
 * erna, roosterprofiel en bevoegdheden. Filteren in de interface gebeurt niet —
 * wat de server niet teruggeeft, bestaat voor de client niet.
 */

export interface AvailableDutyView {
  readonly id: string;
  readonly date: CalendarDate;
  readonly dutyCode: string;
  readonly kinds: readonly string[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly description: string | null;
  readonly closesAt: Date;
  readonly alreadyInterested: boolean;
  /** Waarschuwingen die de dienst niet blokkeren maar wel het vermelden waard zijn. */
  readonly warnings: readonly string[];
  /** Roosterkwaliteit van deze plaatsing, 0 tot 1. Ordent, verbiedt niets. */
  readonly suitabilityScore: number;
  /** Waarom deze dienst minder goed aansluit. Leeg wanneer hij goed aansluit. */
  readonly concerns: readonly string[];
  /** Sluit deze dienst aan op het rooster van de medewerker? */
  readonly suitable: boolean;
}

/** Wat er is weggelaten en waarom, zonder de diensten zelf te tonen. */
export interface AvailableDutyListing {
  readonly duties: readonly AvailableDutyView[];
  /** Aantal diensten dat wel mag maar niet aansluit op het eigen rooster. */
  readonly hiddenUnsuitable: number;
  /** Aantal diensten dat de regels niet toestaan. */
  readonly hiddenIneligible: number;
}

/**
 * De beschikbare diensten die deze medewerker mag oppakken.
 *
 * Duur, en dat is bewust: geschiktheid is niet uit te rekenen zonder het
 * rooster rond elke datum. De horizon van twee weken houdt het begrensd.
 */
export async function availableDutiesForActor(): Promise<AvailableDutyListing> {
  const actor = await requirePermission(PERMISSIONS.AVAILABLE_DUTY_READ);

  const today = toCalendarDate(new Date());
  const horizon = addDays(today, DEFAULT_PRODUCT_PARAMETERS.availableDutyHorizonDays);

  const candidates = await prisma.availableDuty.findMany({
    where: {
      status: AvailableDutyStatus.OPEN,
      date: { gte: toDatabaseDate(today), lte: toDatabaseDate(horizon) },
      closesAt: { gt: new Date() },
      duty: { depot: actor.depot },
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      closesAt: true,
      duty: { select: { ...DUTY_SELECT, description: true } },
      interests: {
        where: { employeeId: actor.employeeId, withdrawnAt: null },
        select: { id: true },
      },
    },
  });

  const views: AvailableDutyView[] = [];
  let hiddenUnsuitable = 0;
  let hiddenIneligible = 0;

  for (const candidate of candidates) {
    const date = toCalendarDate(candidate.date);
    const duty = toDutyContext(candidate.duty);

    // Eerst de regels: wat niet mag, komt niet in de lijst en ook niet in een
    // uitgegrijsde rij. Daarna pas de vraag of het een verstandige dienst is.
    const beoordeling = await assessAssignment({
      employeeId: actor.employeeId,
      date,
      duty,
    });

    if (!beoordeling.hardEligible) {
      hiddenIneligible += 1;
      continue;
    }
    if (!beoordeling.showToEmployee) {
      hiddenUnsuitable += 1;
      continue;
    }

    views.push({
      id: candidate.id,
      date,
      dutyCode: candidate.duty.code,
      kinds: candidate.duty.kinds,
      startMinute: candidate.duty.startMinute,
      endMinute: candidate.duty.endMinute,
      description: candidate.duty.description,
      closesAt: candidate.closesAt,
      alreadyInterested: candidate.interests.length > 0,
      warnings: [],
      suitabilityScore: beoordeling.suitability?.score ?? 0,
      concerns: beoordeling.suitability?.concerns ?? [],
      suitable: true,
    });
  }

  // Beste aansluiting eerst; bij gelijke geschiktheid de eerstvolgende datum.
  views.sort((a, b) =>
    b.suitabilityScore === a.suitabilityScore
      ? a.date.localeCompare(b.date)
      : b.suitabilityScore - a.suitabilityScore,
  );

  return { duties: views, hiddenUnsuitable, hiddenIneligible };
}

/**
 * Belangstelling tonen voor een beschikbare dienst.
 *
 * De geschiktheid wordt hier opnieuw geëvalueerd. Dat is geen dubbel werk: de
 * lijst kan minuten oud zijn en het rooster kan intussen gewijzigd zijn. De
 * evaluatie wordt vastgelegd en aan de inschrijving gekoppeld, zodat later te
 * zien is op welke gronden iemand meedeed.
 */
export async function registerInterest(availableDutyId: string): Promise<{
  readonly accepted: boolean;
  readonly reasons: readonly string[];
}> {
  const actor = await requirePermission(PERMISSIONS.AVAILABLE_DUTY_CLAIM);
  const engine = rulesEngine();

  const available = await prisma.availableDuty.findUnique({
    where: { id: availableDutyId },
    select: {
      id: true,
      date: true,
      status: true,
      closesAt: true,
      duty: { select: DUTY_SELECT },
    },
  });

  if (!available || !acceptsInterest(available.status)) {
    // Een dienst die nog bij reserve ligt of al vergeven is, bestaat voor de
    // medewerker niet. Dezelfde melding voor "niet gevonden" en "niet open":
    // het bestaan van een dienst is zelf informatie.
    await recordAudit({
      actor,
      action: "beschikbare-dienst.belangstelling-geweigerd",
      objectType: "AvailableDuty",
      objectId: availableDutyId,
      result: "DENIED",
      reason: "dienst niet open",
    });
    return { accepted: false, reasons: ["Deze dienst is niet (meer) beschikbaar."] };
  }

  if (available.closesAt <= new Date()) {
    return { accepted: false, reasons: ["De inschrijftermijn voor deze dienst is verstreken."] };
  }

  const date = toCalendarDate(available.date);
  const check = await buildAssignmentCheck({
    employeeId: actor.employeeId,
    date,
    duty: toDutyContext(available.duty),
  });
  const evaluation = await engine.evaluateDutyEligibility({ type: "DUTY_ELIGIBILITY", check });

  const evaluationRow = await persistEvaluation(evaluation, "DUTY_ELIGIBILITY");

  if (evaluation.decision === "BLOCK") {
    await recordAudit({
      actor,
      action: "beschikbare-dienst.belangstelling-geweigerd",
      objectType: "AvailableDuty",
      objectId: availableDutyId,
      result: "DENIED",
      newValue: { evaluatieId: evaluationRow.id },
    });
    return {
      accepted: false,
      reasons: evaluation.findings
        .filter((item) => item.severity === "VIOLATION")
        .map((item) => item.message),
    };
  }

  await prisma.availableDutyInterest.upsert({
    where: { availableDutyId_employeeId: { availableDutyId, employeeId: actor.employeeId } },
    create: {
      availableDutyId,
      employeeId: actor.employeeId,
      ruleEvaluationId: evaluationRow.id,
    },
    update: { withdrawnAt: null, ruleEvaluationId: evaluationRow.id },
  });

  await recordAudit({
    actor,
    action: "beschikbare-dienst.belangstelling-getoond",
    objectType: "AvailableDuty",
    objectId: availableDutyId,
    newValue: { evaluatieId: evaluationRow.id, datum: date },
  });

  await prisma.$transaction(async (tx) => {
    await publishInTransaction(tx, {
      eventType: "AvailableDutyInterestRegistered",
      eventKey: `interesse|${availableDutyId}|${actor.employeeId}`,
      payload: {
        employeeUserId: actor.userId,
        availableDutyId,
        dutyCode: available.duty.code,
        date,
      },
    });
  });
  await flushNotifications();

  return { accepted: true, reasons: [] };
}

/** Belangstelling intrekken. */
export async function withdrawInterest(availableDutyId: string): Promise<void> {
  const actor = await requirePermission(PERMISSIONS.AVAILABLE_DUTY_CLAIM);
  await prisma.availableDutyInterest.updateMany({
    where: { availableDutyId, employeeId: actor.employeeId, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });
  await recordAudit({
    actor,
    action: "beschikbare-dienst.belangstelling-ingetrokken",
    objectType: "AvailableDuty",
    objectId: availableDutyId,
  });
}

/**
 * De dienst toewijzen aan de hoogst geplaatste geldige belangstellende.
 *
 * Draait aan de serverkant, buiten elk gebruikersscherm om. De uitkomst is
 * volledig bepaald door de roulatielijst van de weekdag van de dienst en door
 * de Rules Engine — er zit geen menselijke keuze in, en de momentopname van de
 * volgorde wordt bewaard zodat de uitkomst na te lopen is.
 */
export async function awardAvailableDuty(availableDutyId: string): Promise<{
  readonly awardedEmployeeNumber: string | null;
  readonly reason: string;
}> {
  const engine = rulesEngine();
  const available = await prisma.availableDuty.findUnique({
    where: { id: availableDutyId },
    select: {
      id: true,
      date: true,
      status: true,
      duty: { select: DUTY_SELECT },
      interests: {
        where: { withdrawnAt: null },
        select: { employeeId: true },
      },
    },
  });

  if (!available || !acceptsAllocation(available.status)) {
    // Toewijzen mag ook nadat het venster is gesloten: dat is juist het moment
    // waarop de dienstindeling aan zet is. Wat níet meer mag, is inschrijven.
    return {
      awardedEmployeeNumber: null,
      reason: available
        ? `Deze dienst staat op "${STATE_LABELS[available.status]}"; toewijzen kan daar niet.`
        : "Dienst staat niet open.",
    };
  }
  if (available.interests.length === 0) {
    return { awardedEmployeeNumber: null, reason: "Geen belangstellenden." };
  }

  const date = toCalendarDate(available.date);
  const duty = toDutyContext(available.duty);
  const { weekday, offset, participants } = await rotationListFor(date, available.duty.depot);

  const interested = new Set(available.interests.map((row) => row.employeeId));

  // Opnieuw toetsen op het laatste moment: tussen inschrijven en toewijzen kan
  // het rooster van een kandidaat gewijzigd zijn.
  const eligible = new Set<string>();
  for (const participant of participants) {
    if (!interested.has(participant.employeeId)) {
      continue;
    }
    const check = await buildAssignmentCheck({
      employeeId: participant.employeeId,
      date,
      duty,
    });
    const evaluation = await engine.evaluateDutyEligibility({ type: "DUTY_ELIGIBILITY", check });
    if (evaluation.decision !== "BLOCK") {
      eligible.add(participant.employeeId);
    }
  }

  const placements = placementsForOffset(participants, offset);
  const winner = selectWinner(placements, eligible);
  const snapshot = buildSnapshot(weekday, offset, placements, interested, eligible);

  if (!winner) {
    await prisma.availableDuty.update({
      where: { id: availableDutyId },
      data: { awardRanking: toJson(snapshot) },
    });
    return {
      awardedEmployeeNumber: null,
      reason: "Geen van de belangstellenden is roostertechnisch geldig.",
    };
  }

  await prisma.$transaction([
    prisma.scheduledDuty.upsert({
      where: { employeeId_date: { employeeId: winner.employeeId, date: available.date } },
      create: {
        employeeId: winner.employeeId,
        date: available.date,
        positionType: RosterPositionType.DUTY,
        dutyId: available.duty.id,
        source: ScheduleSource.AVAILABLE_DUTY,
      },
      update: {
        positionType: RosterPositionType.DUTY,
        dutyId: available.duty.id,
        source: ScheduleSource.AVAILABLE_DUTY,
      },
    }),
    prisma.availableDuty.update({
      where: { id: availableDutyId },
      data: {
        status: AvailableDutyStatus.ALLOCATED,
        awardedEmployeeId: winner.employeeId,
        awardedAt: new Date(),
        awardRanking: toJson(snapshot),
      },
    }),
  ]);

  const betrokkenen = await userIdsFor([...interested]);
  await prisma.$transaction(async (tx) => {
    await publishInTransaction(tx, {
      eventType: "AvailableDutyAllocated",
      eventKey: `toewijzing|${availableDutyId}`,
      payload: {
        availableDutyId,
        dutyCode: available.duty.code,
        date,
        winnerUserId: betrokkenen.get(winner.employeeId) ?? "",
        // De overige belangstellenden horen dát de dienst weg is, niet aan wie.
        otherUserIds: [...interested]
          .filter((employeeId) => employeeId !== winner.employeeId)
          .map((employeeId) => betrokkenen.get(employeeId))
          .filter(Boolean)
          .join(","),
      },
    });
  });
  await flushNotifications();

  await recordAudit({
    actor: null,
    action: "beschikbare-dienst.toegewezen",
    objectType: "AvailableDuty",
    objectId: availableDutyId,
    newValue: {
      personeelsnummer: winner.employeeNumber,
      positie: winner.position,
      weekdag: weekday,
      offset,
    },
    reason: "roulatievolgorde",
  });

  return {
    awardedEmployeeNumber: winner.employeeNumber,
    reason: `Positie ${winner.position} op de roulatielijst van weekdag ${weekday}.`,
  };
}

/** Legt een evaluatie vast zodat een besluit later uitlegbaar blijft. */
async function persistEvaluation(evaluation: RuleEvaluationResult, requestType: string) {
  return prisma.ruleEvaluation.create({
    data: {
      engineName: evaluation.engine.name,
      engineVersion: evaluation.engine.version,
      requestType,
      decision: evaluation.decision,
      findings: toJson(evaluation.findings),
      inputDigest: evaluation.inputDigest,
    },
    select: { id: true },
  });
}

export { persistEvaluation };

/**
 * De roulatiepositie van de ingelogde medewerker, per weekdag.
 *
 * Transparantie is hier het punt: een medewerker die een dienst misloopt, moet
 * kunnen zien waar hij die dag stond. De positie volgt uit de vaste
 * basisvolgorde en de wekelijkse verschuiving en is dus voor elke week na te
 * rekenen — ook achteraf.
 */
export async function rotationStandingForActor(): Promise<
  readonly { weekday: number; position: number; participants: number }[]
> {
  const actor = await requirePermission(PERMISSIONS.AVAILABLE_DUTY_READ);

  const lists = await prisma.rotationList.findMany({
    where: { depot: actor.depot },
    orderBy: { weekday: "asc" },
    select: {
      weekday: true,
      offset: true,
      entries: { select: { employeeId: true, baseIndex: true } },
    },
  });

  return lists
    .map((list) => {
      const own = list.entries.find((entry) => entry.employeeId === actor.employeeId);
      if (!own || list.entries.length === 0) {
        return null;
      }
      return {
        weekday: list.weekday,
        position: positionOf(own.baseIndex, list.offset, list.entries.length),
        participants: list.entries.length,
      };
    })
    .filter((entry): entry is { weekday: number; position: number; participants: number } =>
      entry !== null,
    );
}

/**
 * De toestanden bijwerken die alleen door de klok veranderen.
 *
 * ## Waarom hier een aparte stap voor nodig is
 *
 * Een dienst waarvan de inschrijving is gesloten, verandert niet vanzelf van
 * toestand: er is niemand die op dat moment iets doet. Zonder deze stap blijft
 * hij `OPEN` heten terwijl niemand zich nog kan inschrijven — en dan zegt het
 * scherm van de medewerker (dat op de sluitingstijd filtert) iets anders dan
 * dat van de dienstindeling (dat op de toestand filtert). Twee schermen die
 * elkaar tegenspreken over dezelfde dienst, allebei zonder aanwijsbare fout.
 *
 * ## Waarom het geen achtergrondproces is
 *
 * Dit draait wanneer iemand ernaar kijkt, en niet op een timer. Een timer die
 * stilvalt, laat de toestand stilletjes achterlopen; een aanroep bij het lezen
 * kan dat niet. De uitkomst is hetzelfde omdat de klokregel een pure functie
 * is: wat er hoort te staan, hangt van de tijd af en niet van wanneer dit
 * toevallig heeft gedraaid.
 */
export async function advanceAvailableDuties(now = new Date()): Promise<{
  readonly toAllocationPending: number;
}> {
  const kandidaten = await prisma.availableDuty.findMany({
    where: { status: AvailableDutyStatus.OPEN, closesAt: { lte: now } },
    select: { id: true, status: true, closesAt: true },
  });

  let verplaatst = 0;
  for (const kandidaat of kandidaten) {
    const nieuw = stateByClock({
      state: kandidaat.status,
      closesAt: kandidaat.closesAt,
      now,
    });
    if (nieuw === null) {
      continue;
    }
    // Voorwaardelijk op de oude toestand: draaien er twee van deze aanroepen
    // tegelijk, dan wint er precies één en telt de ander hem niet dubbel.
    const uitkomst = await prisma.availableDuty.updateMany({
      where: { id: kandidaat.id, status: kandidaat.status },
      data: { status: nieuw },
    });
    verplaatst += uitkomst.count;
  }

  return { toAllocationPending: verplaatst };
}
