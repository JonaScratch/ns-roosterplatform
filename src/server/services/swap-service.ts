import "server-only";
import {
  RosterPositionType,
  ScheduleSource,
  SwapListingStatus,
  SwapStatus,
} from "@/lib/generated/prisma/enums";
import { type CalendarDate, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { type SwapParty, isNoOpSwap, planSwap } from "@/domain/swap";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { DEFAULT_PRODUCT_PARAMETERS, rulesEngine } from "@/server/rules-engine";
import type { AssignmentCheck, RuleEvaluationResult } from "@/server/rules-engine";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { flushNotifications, publishInTransaction, userIdsFor } from "./domain-events";
import { DUTY_SELECT, toDutyContext } from "@/server/data/mappers";
import { buildAssignmentCheck } from "@/server/data/repositories/schedule-repository";
import { persistEvaluation } from "./available-duty-service";

/**
 * Dienstenruil tussen twee medewerkers.
 *
 * ## Twee keer toetsen, en waarom dat geen dubbel werk is
 *
 * Bij het versturen wordt de ruil gesimuleerd; bij het accepteren opnieuw.
 * Tussen die twee momenten kan er van alles gebeurd zijn: een van beiden pakte
 * een beschikbare dienst op, een planner wijzigde iets, een derde ruil ging
 * door. Een voorstel dat bij versturen geldig was, is dat bij accepteren niet
 * automatisch nog. Beide evaluaties worden bewaard.
 *
 * ## Wat er precies gesimuleerd wordt
 *
 * Twee `AssignmentCheck`s: A krijgt de dienst van B op de dag van B, zonder
 * zijn eigen dienst; B krijgt die van A op de dag van A, zonder de zijne. Beide
 * met een venster van weken eromheen, waardoor de dienst vóór en ná de ruildag
 * bij allebei automatisch meegenomen wordt in de rust- en reeksregels.
 */

export interface SwapCandidateView {
  readonly scheduledDutyId: string;
  readonly date: CalendarDate;
  readonly dutyCode: string;
  readonly kinds: readonly string[];
  readonly startMinute: number;
  readonly endMinute: number;
  /** Waarom deze ruil niet kan. Leeg wanneer hij wel kan. */
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * De diensten van een collega waarmee geruild kan worden.
 *
 * Alleen geldige mogelijkheden worden getoond. De ongeldige worden wel
 * berekend, met de reden erbij, omdat "waarom staat die dienst er niet bij" de
 * eerstvolgende vraag is — maar de aanroeper kiest of hij die toont.
 */
export async function swapCandidates(options: {
  readonly ownScheduledDutyId: string;
  readonly counterpartyEmployeeId: string;
  readonly includeInvalid?: boolean;
}): Promise<readonly SwapCandidateView[]> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  const own = await loadOwnDuty(actor.employeeId, options.ownScheduledDutyId);

  const counterpartyDuties = await prisma.scheduledDuty.findMany({
    where: {
      employeeId: options.counterpartyEmployeeId,
      positionType: RosterPositionType.DUTY,
      date: { gte: new Date() },
      dutyId: { not: null },
    },
    orderBy: { date: "asc" },
    take: 40,
    select: { id: true, date: true, duty: { select: DUTY_SELECT } },
  });

  const views: SwapCandidateView[] = [];
  const ownParty = asSwapParty(actor.employeeId, own);

  for (const candidate of counterpartyDuties) {
    const candidateDuty = candidate.duty;
    if (!candidateDuty) {
      continue;
    }
    const candidateParty = asSwapParty(options.counterpartyEmployeeId, {
      id: candidate.id,
      date: candidate.date,
      duty: candidateDuty,
    });

    // Een ruil die niets verandert. Twee collega's op hetzelfde basisrooster
    // rijden geregeld dezelfde dienst op dezelfde dag; die combinatie is
    // roostertechnisch volkomen geldig en daarom keurt de engine haar terecht
    // goed. Zij hoort alleen niet in een keuzelijst thuis.
    if (isNoOpSwap(ownParty, candidateParty)) {
      continue;
    }
    const evaluation = await simulate({
      initiator: {
        employeeId: actor.employeeId,
        surrenderScheduledDutyId: own.id,
        surrenderDuty: own.duty,
        receivesDate: toCalendarDate(candidate.date),
        receivesDuty: candidateDuty,
      },
      counterparty: {
        employeeId: options.counterpartyEmployeeId,
        surrenderScheduledDutyId: candidate.id,
        surrenderDuty: candidateDuty,
        receivesDate: toCalendarDate(own.date),
        receivesDuty: own.duty,
      },
    });

    const blockers = evaluation.findings
      .filter((item) => item.severity === "VIOLATION")
      .map((item) => `${item.employeeNumber ?? ""}: ${item.message}`.trim());

    if (blockers.length > 0 && !options.includeInvalid) {
      continue;
    }

    views.push({
      scheduledDutyId: candidate.id,
      date: toCalendarDate(candidate.date),
      dutyCode: candidateDuty.code,
      kinds: candidateDuty.kinds,
      startMinute: candidateDuty.startMinute,
      endMinute: candidateDuty.endMinute,
      blockers,
      warnings: evaluation.findings
        .filter((item) => item.severity === "WARNING")
        .map((item) => item.message),
    });
  }
  return views;
}

/** Een ruilvoorstel versturen. Alleen wanneer de simulatie hem toelaat. */
export async function proposeSwap(options: {
  readonly ownScheduledDutyId: string;
  readonly counterpartyScheduledDutyId: string;
  readonly message?: string;
  /** Gezet wanneer dit voorstel ontstaat vanuit een ruilmarktaanbieding. */
  readonly listingId?: string;
}): Promise<{ readonly created: boolean; readonly reasons: readonly string[] }> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  return proposeSwapCore(actor, options);
}

/**
 * Het versturen zelf, met de handelende persoon als argument.
 *
 * Zie `respondToSwapCore` hieronder voor waarom: een verificatiescript — of,
 * hier, de ruilmarkt — kan zo exact dezelfde toetsing aanroepen zonder een
 * sessie te hoeven nabootsen.
 */
export async function proposeSwapCore(
  actor: Actor,
  options: {
    readonly ownScheduledDutyId: string;
    readonly counterpartyScheduledDutyId: string;
    readonly message?: string;
    readonly listingId?: string;
  },
): Promise<{ readonly created: boolean; readonly reasons: readonly string[] }> {
  const own = await loadOwnDuty(actor.employeeId, options.ownScheduledDutyId);
  const other = await prisma.scheduledDuty.findUnique({
    where: { id: options.counterpartyScheduledDutyId },
    select: { id: true, employeeId: true, date: true, duty: { select: DUTY_SELECT } },
  });

  if (!other?.duty) {
    return { created: false, reasons: ["De gekozen dienst van de collega bestaat niet."] };
  }
  if (other.employeeId === actor.employeeId) {
    return { created: false, reasons: ["Ruilen met uzelf heeft geen zin."] };
  }
  // Ook hier, en niet alleen in de keuzelijst: een voorstel kan met een
  // handgemaakt verzoek binnenkomen, en de rules engine heeft geen reden om
  // een geldige maar zinloze ruil tegen te houden.
  if (
    isNoOpSwap(
      asSwapParty(actor.employeeId, own),
      asSwapParty(other.employeeId, { id: other.id, date: other.date, duty: other.duty }),
    )
  ) {
    return {
      created: false,
      reasons: ["Deze ruil verandert niets: het is dezelfde dienst op dezelfde dag."],
    };
  }

  const evaluation = await simulate({
    initiator: {
      employeeId: actor.employeeId,
      surrenderScheduledDutyId: own.id,
      surrenderDuty: own.duty,
      receivesDate: toCalendarDate(other.date),
      receivesDuty: other.duty,
    },
    counterparty: {
      employeeId: other.employeeId,
      surrenderScheduledDutyId: other.id,
      surrenderDuty: other.duty,
      receivesDate: toCalendarDate(own.date),
      receivesDuty: own.duty,
    },
  });

  const stored = await persistEvaluation(evaluation, "SWAP_PROPOSAL");

  if (evaluation.decision === "BLOCK") {
    await recordAudit({
      actor,
      action: "ruil.voorstel-geweigerd",
      objectType: "ScheduledDuty",
      objectId: own.id,
      result: "DENIED",
      newValue: { evaluatieId: stored.id },
    });
    return {
      created: false,
      reasons: evaluation.findings
        .filter((item) => item.severity === "VIOLATION")
        .map((item) => item.message),
    };
  }

  const proposal = await prisma.swapProposal.create({
    data: {
      initiatorEmployeeId: actor.employeeId,
      initiatorDutyId: own.id,
      counterpartyEmployeeId: other.employeeId,
      counterpartyDutyId: other.id,
      message: options.message?.slice(0, 500) ?? null,
      expiresAt: new Date(
        Date.now() + DEFAULT_PRODUCT_PARAMETERS.swapProposalValidHours * 3_600_000,
      ),
      proposalEvaluationId: stored.id,
      listingId: options.listingId ?? null,
    },
    select: { id: true },
  });

  await recordAudit({
    actor,
    action: "ruil.voorgesteld",
    objectType: "SwapProposal",
    objectId: proposal.id,
    newValue: {
      eigenDienst: own.duty.code,
      eigenDatum: toCalendarDate(own.date),
      collegaDienst: other.duty.code,
      collegaDatum: toCalendarDate(other.date),
      evaluatieId: stored.id,
    },
  });

  // De ontvanger hoort te weten dat er iets van hem wordt gevraagd. De melding
  // noemt de diensten en de data; wie het vraagt staat er met personeelsnummer
  // bij, want zonder dat is een ruilverzoek niet te beoordelen.
  // De codes vóór de closure vastleggen: binnen een callback houdt TypeScript
  // de eerdere null-controle op other.duty niet vast.
  const eigenDienstCode = own.duty.code;
  const collegaDienstCode = other.duty.code;
  const accounts = await userIdsFor([other.employeeId]);
  const ontvanger = accounts.get(other.employeeId);
  if (ontvanger) {
    await prisma.$transaction(async (tx) => {
      await publishInTransaction(tx, {
        eventType: "SwapRequested",
        eventKey: `ruil-aangevraagd|${proposal.id}`,
        payload: {
          swapId: proposal.id,
          recipientUserId: ontvanger,
          requesterEmployeeNumber: actor.employeeNumber,
          requesterDutyCode: eigenDienstCode,
          requesterDate: toCalendarDate(own.date),
          recipientDutyCode: collegaDienstCode,
          recipientDate: toCalendarDate(other.date),
        },
      });
    });
    await flushNotifications();
  }

  return { created: true, reasons: [] };
}

/**
 * Een ruilvoorstel beantwoorden.
 *
 * Accepteren voert de ruil daadwerkelijk uit, binnen één transactie: twee
 * roosterdagen wisselen van dienst, en het voorstel gaat naar ACCEPTED. Half
 * uitgevoerde ruil bestaat niet.
 */
export async function respondToSwap(
  proposalId: string,
  accept: boolean,
): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const actor = await requirePermission(PERMISSIONS.SWAP_RESPOND);
  return respondToSwapCore(actor, proposalId, accept);
}

/**
 * Het antwoord zelf, met de handelende persoon als argument.
 *
 * Bestaat zodat een verificatiescript exact dezelfde weg kan aflopen als de
 * applicatie: dezelfde hertoetsing, dezelfde transactie, dezelfde meldingen.
 * Een script dat zijn eigen variant schrijft, bewijst zijn eigen variant.
 *
 * De rechtencontrole zit in de schil hierboven; wie deze functie aanroept, moet
 * die zelf hebben gedaan.
 */
export async function respondToSwapCore(
  actor: Actor,
  proposalId: string,
  accept: boolean,
): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {

  const proposal = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      initiatorEmployeeId: true,
      counterpartyEmployeeId: true,
      listingId: true,
      initiatorDuty: { select: { id: true, date: true, duty: { select: DUTY_SELECT } } },
      counterpartyDuty: { select: { id: true, date: true, duty: { select: DUTY_SELECT } } },
    },
  });

  // Alleen de geadresseerde mag antwoorden. Een voorstel van iemand anders
  // bestaat voor deze gebruiker niet — vandaar dezelfde uitkomst als "niet
  // gevonden".
  if (!proposal || proposal.counterpartyEmployeeId !== actor.employeeId) {
    await recordAudit({
      actor,
      action: "ruil.antwoord-geweigerd",
      objectType: "SwapProposal",
      objectId: proposalId,
      result: "DENIED",
      reason: "niet de geadresseerde",
    });
    return { ok: false, reasons: ["Dit voorstel bestaat niet."] };
  }

  if (proposal.status !== SwapStatus.PENDING) {
    return { ok: false, reasons: ["Dit voorstel is al afgehandeld."] };
  }
  if (proposal.expiresAt <= new Date()) {
    await prisma.swapProposal.update({
      where: { id: proposalId },
      data: { status: SwapStatus.EXPIRED, respondedAt: new Date() },
    });
    return { ok: false, reasons: ["Dit voorstel is verlopen."] };
  }

  if (!accept) {
    await prisma.swapProposal.update({
      where: { id: proposalId },
      data: { status: SwapStatus.REJECTED, respondedAt: new Date() },
    });
    await recordAudit({
      actor,
      action: "ruil.afgewezen",
      objectType: "SwapProposal",
      objectId: proposalId,
    });
    await meldRuil("SwapRejected", `ruil-afgewezen|${proposalId}`, proposal);
    return { ok: true, reasons: [] };
  }

  const initiatorDuty = proposal.initiatorDuty.duty;
  const counterpartyDuty = proposal.counterpartyDuty.duty;
  if (!initiatorDuty || !counterpartyDuty) {
    return { ok: false, reasons: ["Een van beide diensten bestaat niet meer."] };
  }

  // Opnieuw toetsen: het rooster van vandaag is niet dat van het moment van
  // versturen.
  const evaluation = await simulate({
    initiator: {
      employeeId: proposal.initiatorEmployeeId,
      surrenderScheduledDutyId: proposal.initiatorDuty.id,
      surrenderDuty: initiatorDuty,
      receivesDate: toCalendarDate(proposal.counterpartyDuty.date),
      receivesDuty: counterpartyDuty,
    },
    counterparty: {
      employeeId: proposal.counterpartyEmployeeId,
      surrenderScheduledDutyId: proposal.counterpartyDuty.id,
      surrenderDuty: counterpartyDuty,
      receivesDate: toCalendarDate(proposal.initiatorDuty.date),
      receivesDuty: initiatorDuty,
    },
  });
  const stored = await persistEvaluation(evaluation, "SWAP_PROPOSAL");

  if (evaluation.decision === "BLOCK") {
    await prisma.swapProposal.update({
      where: { id: proposalId },
      data: {
        status: SwapStatus.INVALIDATED,
        respondedAt: new Date(),
        acceptEvaluationId: stored.id,
      },
    });
    await recordAudit({
      actor,
      action: "ruil.ongeldig-geworden",
      objectType: "SwapProposal",
      objectId: proposalId,
      result: "DENIED",
      newValue: { evaluatieId: stored.id },
    });
    await meldRuil("SwapInvalidated", `ruil-ongeldig|${proposalId}`, proposal);
    return {
      ok: false,
      reasons: [
        "De ruil is sinds het voorstel ongeldig geworden:",
        ...evaluation.findings
          .filter((item) => item.severity === "VIOLATION")
          .map((item) => item.message),
      ],
    };
  }

  // Welke roosterrijen veranderen, wordt uitgerekend door `planSwap` — zie
  // src/domain/swap.ts voor waarom dat een aparte, toetsbare functie is.
  const mutations = planSwap(
    {
      employeeId: proposal.initiatorEmployeeId,
      date: toCalendarDate(proposal.initiatorDuty.date),
      dutyId: initiatorDuty.id,
      scheduledDutyId: proposal.initiatorDuty.id,
    },
    {
      employeeId: proposal.counterpartyEmployeeId,
      date: toCalendarDate(proposal.counterpartyDuty.date),
      dutyId: counterpartyDuty.id,
      scheduledDutyId: proposal.counterpartyDuty.id,
    },
  );

  // Een callback-transactie en geen array: wanneer dit voorstel uit de
  // ruilmarkt komt, moet de aanbieding binnen dezelfde transactie van OPEN
  // naar MATCHED, en dat mag maar één keer slagen. Een array-transactie voert
  // alles onvoorwaardelijk uit; hier moet de uitkomst van die ene stap
  // bepalen of de rest doorgaat.
  let listingAlAnders = false;
  await prisma.$transaction(async (tx) => {
    if (proposal.listingId) {
      const vergrendeld = await tx.swapListing.updateMany({
        where: { id: proposal.listingId, status: SwapListingStatus.OPEN },
        data: {
          status: SwapListingStatus.MATCHED,
          matchedProposalId: proposalId,
          version: { increment: 1 },
        },
      });
      if (vergrendeld.count === 0) {
        // Een ander voorstel voor dezelfde aanbieding won de race. Alles in
        // deze transactie draait terug door de throw; niets hierboven is dan
        // al aangepast.
        listingAlAnders = true;
        throw new Error("SWAP_LISTING_ALREADY_MATCHED");
      }
    }

    for (const mutation of mutations) {
      // Upsert en geen update: bij een ruil over twee dagen krijgt elke
      // medewerker een dag toegewezen waarop hij vrij was, en die dag heeft
      // niet per se al een roosterrij — bijvoorbeeld buiten de periode die is
      // uitgeschreven.
      await tx.scheduledDuty.upsert({
        where: {
          employeeId_date: {
            employeeId: mutation.employeeId,
            date: toDatabaseDate(mutation.date),
          },
        },
        create: {
          employeeId: mutation.employeeId,
          date: toDatabaseDate(mutation.date),
          positionType: mutation.positionType,
          dutyId: mutation.dutyId,
          source: ScheduleSource.SWAP,
        },
        update: {
          positionType: mutation.positionType,
          dutyId: mutation.dutyId,
          source: ScheduleSource.SWAP,
        },
      });
    }

    await tx.swapProposal.update({
      where: { id: proposalId },
      data: {
        status: SwapStatus.ACCEPTED,
        respondedAt: new Date(),
        acceptEvaluationId: stored.id,
      },
    });
  }).catch((error) => {
    if (!listingAlAnders) {
      throw error;
    }
  });

  if (listingAlAnders) {
    await prisma.swapProposal.update({
      where: { id: proposalId },
      data: { status: SwapStatus.INVALIDATED, respondedAt: new Date(), acceptEvaluationId: stored.id },
    });
    await recordAudit({
      actor,
      action: "ruil.ongeldig-geworden",
      objectType: "SwapProposal",
      objectId: proposalId,
      result: "DENIED",
      reason: "ruilmarktaanbieding al door een ander voorstel geruild",
    });
    await meldRuil("SwapInvalidated", `ruil-ongeldig|${proposalId}`, proposal);
    return {
      ok: false,
      reasons: ["Deze dienst is inmiddels niet meer beschikbaar voor ruil."],
    };
  }

  await meldRuil("SwapAccepted", `ruil-geaccepteerd|${proposalId}`, proposal);

  await recordAudit({
    actor,
    action: "ruil.geaccepteerd",
    objectType: "SwapProposal",
    objectId: proposalId,
    oldValue: {
      initiatorDienst: initiatorDuty.code,
      collegaDienst: counterpartyDuty.code,
    },
    newValue: {
      initiatorDienst: counterpartyDuty.code,
      collegaDienst: initiatorDuty.code,
      evaluatieId: stored.id,
    },
  });

  return { ok: true, reasons: [] };
}

// ── Intern ───────────────────────────────────────────────────────────────────

interface SwapSide {
  readonly employeeId: string;
  readonly surrenderScheduledDutyId: string;
  readonly surrenderDuty: Parameters<typeof toDutyContext>[0];
  readonly receivesDate: CalendarDate;
  readonly receivesDuty: Parameters<typeof toDutyContext>[0];
}

/**
 * Bouwt beide kanten van de ruil en laat de engine oordelen.
 *
 * Geëxporteerd zodat de ruilmarkt (`ruilmarkt-service.ts`) exact dezelfde
 * toetsing gebruikt om te berekenen welke eigen diensten geldig tegenover een
 * aanbieding staan — geen tweede, eenvoudiger nagebouwde controle.
 */
export async function simulate(sides: {
  readonly initiator: SwapSide;
  readonly counterparty: SwapSide;
}): Promise<RuleEvaluationResult> {
  const initiator = await checkFor(sides.initiator);
  const counterparty = await checkFor(sides.counterparty);
  return rulesEngine().evaluateSwap({ type: "SWAP_PROPOSAL", initiator, counterparty });
}

async function checkFor(side: SwapSide): Promise<AssignmentCheck> {
  return buildAssignmentCheck({
    employeeId: side.employeeId,
    date: side.receivesDate,
    duty: toDutyContext(side.receivesDuty),
    surrenderScheduledDutyId: side.surrenderScheduledDutyId,
    surrendering: toDutyContext(side.surrenderDuty),
  });
}

/** Een roosterrij uit de database als partij in een ruil, voor de domeinlaag. */
function asSwapParty(
  employeeId: string,
  row: { id: string; date: Date; duty: { id: string } },
): SwapParty {
  return {
    employeeId,
    date: toCalendarDate(row.date),
    dutyId: row.duty.id,
    scheduledDutyId: row.id,
  };
}

/**
 * De eigen dienst ophalen.
 *
 * De `where` bevat het personeelsnummer van de aanroeper. Een ander id in de
 * aanvraag levert daardoor "niet gevonden" op — de controle zit in de query en
 * niet in een vergeetbaar `if` erna.
 */
async function loadOwnDuty(employeeId: string, scheduledDutyId: string) {
  const row = await prisma.scheduledDuty.findFirst({
    where: { id: scheduledDutyId, employeeId, positionType: RosterPositionType.DUTY },
    select: { id: true, date: true, duty: { select: DUTY_SELECT } },
  });
  if (!row?.duty) {
    throw new Error("De opgegeven eigen dienst bestaat niet of is niet van u.");
  }
  return { id: row.id, date: row.date, duty: row.duty };
}

/**
 * Meldt een ruilgebeurtenis aan beide betrokkenen.
 *
 * De gebeurtenis wordt vastgelegd in een eigen transactie, direct na de
 * wijziging. Mislukt het versturen daarna, dan blijft de gebeurtenis staan en
 * wordt hij bij een volgende ronde opnieuw opgepakt — de ruil zelf staat er dan
 * al, en dat is de goede volgorde: liever een late melding dan een ruil die
 * terugdraait omdat een melding niet lukte.
 */
async function meldRuil(
  eventType: "SwapAccepted" | "SwapRejected" | "SwapCancelled" | "SwapInvalidated",
  eventKey: string,
  proposal: {
    id: string;
    initiatorEmployeeId: string;
    counterpartyEmployeeId: string;
  },
): Promise<void> {
  const [accounts, medewerkers] = await Promise.all([
    userIdsFor([proposal.initiatorEmployeeId, proposal.counterpartyEmployeeId]),
    prisma.employee.findMany({
      where: { id: { in: [proposal.initiatorEmployeeId, proposal.counterpartyEmployeeId] } },
      select: { id: true, employeeNumber: true },
    }),
  ]);
  const nummers = new Map(medewerkers.map((rij) => [rij.id, rij.employeeNumber]));
  const aanvrager = accounts.get(proposal.initiatorEmployeeId);
  const ontvanger = accounts.get(proposal.counterpartyEmployeeId);
  if (!aanvrager && !ontvanger) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await publishInTransaction(tx, {
      eventType,
      eventKey,
      payload: {
        swapId: proposal.id,
        requesterUserId: aanvrager ?? "",
        recipientUserId: ontvanger ?? "",
        requesterEmployeeNumber: nummers.get(proposal.initiatorEmployeeId) ?? "",
        recipientEmployeeNumber: nummers.get(proposal.counterpartyEmployeeId) ?? "",
      },
    });
  });
  await flushNotifications();
}

/**
 * De aanvrager trekt zijn eigen verzoek in.
 *
 * Kan alleen zolang de ontvanger nog niet heeft gereageerd, en alleen door de
 * aanvrager zelf. Er verandert geen enkele roosterdag: een ingetrokken verzoek
 * is een verzoek dat nooit is uitgevoerd.
 */
export async function cancelSwap(
  proposalId: string,
): Promise<{ readonly ok: boolean; readonly reason: string }> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);

  const proposal = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, status: true, initiatorEmployeeId: true, counterpartyEmployeeId: true },
  });
  if (!proposal || proposal.initiatorEmployeeId !== actor.employeeId) {
    // Niet gevonden en niet van jou lopen hier samen: een verzoek van iemand
    // anders hoort niet te bestaan voor wie er niet bij hoort.
    return { ok: false, reason: "Dit ruilverzoek bestaat niet." };
  }
  if (proposal.status !== SwapStatus.PENDING) {
    return { ok: false, reason: "Dit verzoek is al afgehandeld." };
  }

  // Het bestaande model noemt deze toestand WITHDRAWN; de opdracht noemt hem
  // CANCELLED. Dezelfde toestand, en hernoemen zou bestaande auditregels en
  // ruilen betekenisloos maken.
  const bijgewerkt = await prisma.swapProposal.updateMany({
    where: { id: proposalId, status: SwapStatus.PENDING },
    data: { status: SwapStatus.WITHDRAWN, respondedAt: new Date() },
  });
  if (bijgewerkt.count === 0) {
    return { ok: false, reason: "Dit verzoek is inmiddels afgehandeld." };
  }

  await recordAudit({
    actor,
    action: "ruil.ingetrokken",
    objectType: "SwapProposal",
    objectId: proposalId,
  });
  await meldRuil("SwapCancelled", `ruil-ingetrokken|${proposalId}`, proposal);

  return { ok: true, reason: "Het verzoek is ingetrokken." };
}
