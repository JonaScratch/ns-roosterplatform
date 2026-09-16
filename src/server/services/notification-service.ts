import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  type NotificationCategory,
  type NotificationType,
} from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import { requireActor } from "@/server/security/authorize";
import { recordSecurityEvent } from "@/server/audit/log";

/**
 * Meldingen.
 *
 * ## Waarom een gebeurtenis eerst in een uitgaande wachtrij belandt
 *
 * Een ruil die doorgaat zonder melding is een ruil waar iemand niets van weet
 * en morgen voor de verkeerde dienst staat. Een melding zonder ruil is een
 * mededeling over iets wat niet gebeurd is. Beide zijn erger dan een melding
 * die een minuut later komt.
 *
 * Daarom schrijft elke wijziging in dezelfde transactie een `OutboxEvent`. Die
 * transactie slaagt of faalt als geheel. Het omzetten naar meldingen gebeurt
 * daarna en mag mislukken: de gebeurtenis blijft staan en wordt opnieuw
 * opgepakt.
 *
 * ## Waarom een melding niet twee keer kan
 *
 * Elke melding draagt de sleutel van het onderliggende feit
 * (`recipientUserId` + `eventKey`, uniek in de database). Een tweede poging
 * botst op die sleutel en verandert niets. Opnieuw verwerken is daarmee
 * onschadelijk in plaats van riskant.
 *
 * ## Wat er niet in een melding staat
 *
 * Geen medische gegevens, geen reden van afwezigheid, geen namen van anderen
 * waar een personeelsnummer volstaat. De melding is een verwijzing; wat erachter
 * zit, valt onder de rechten van het scherm waarheen zij leidt.
 */

type Tx = Prisma.TransactionClient;

export interface OutboxWrite {
  readonly eventType: string;
  /** De sleutel van het feit. Twee keer dezelfde sleutel is dezelfde gebeurtenis. */
  readonly eventKey: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Legt een domeingebeurtenis vast binnen de lopende transactie.
 *
 * Bewust géén losse `prisma`-aanroep: wie deze functie buiten een transactie
 * gebruikt, verliest precies de garantie waarvoor zij bestaat.
 */
export async function enqueueEvent(tx: Tx, event: OutboxWrite): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [
      {
        eventType: event.eventType,
        eventKey: event.eventKey,
        payload: event.payload as Prisma.InputJsonValue,
      },
    ],
    // Dezelfde gebeurtenis twee keer vastleggen is geen fout; het is dezelfde
    // gebeurtenis.
    skipDuplicates: true,
  });
}

export interface NotificationWrite {
  readonly recipientUserId: string;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly message: string;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly actionPath?: string | null;
  readonly eventKey: string;
  readonly expiresAt?: Date | null;
}

/** Schrijft meldingen weg; dubbele sleutels worden overgeslagen. */
export async function deliver(
  notifications: readonly NotificationWrite[],
  client: Tx | typeof prisma = prisma,
): Promise<number> {
  if (notifications.length === 0) {
    return 0;
  }
  const result = await client.notification.createMany({
    data: notifications.map((notification) => ({
      recipientUserId: notification.recipientUserId,
      type: notification.type,
      category: notification.category,
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType ?? null,
      entityId: notification.entityId ?? null,
      actionPath: notification.actionPath ?? null,
      eventKey: notification.eventKey,
      expiresAt: notification.expiresAt ?? null,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Verwerkt openstaande gebeurtenissen tot meldingen.
 *
 * Wordt aangeroepen na een wijziging en kan daarnaast periodiek draaien. Faalt
 * de verwerking van één gebeurtenis, dan blijft die staan met de fout erbij en
 * gaan de andere gewoon door — één kapotte melding mag de rest niet ophouden.
 */
export async function processOutbox(limit = 50): Promise<{
  readonly processed: number;
  readonly delivered: number;
  readonly failed: number;
}> {
  const events = await prisma.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let delivered = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const notifications = await notificationsFor(event);
      delivered += await deliver(notifications);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: new Date(), attempts: { increment: 1 } },
      });
    } catch (error) {
      failed += 1;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          // Geen persoonsgegevens in de fouttekst; alleen wat er technisch misging.
          lastError: String(error).slice(0, 500),
        },
      });
    }
  }

  return { processed: events.length, delivered, failed };
}

/** Zet een gebeurtenis om in de meldingen die eruit horen te volgen. */
async function notificationsFor(event: {
  eventType: string;
  eventKey: string;
  payload: unknown;
}): Promise<readonly NotificationWrite[]> {
  const payload = (event.payload ?? {}) as Record<string, string | number | null>;

  switch (event.eventType) {
    case "SwapRequested":
      return [
        {
          recipientUserId: String(payload.recipientUserId),
          type: "SWAP_REQUEST_RECEIVED",
          category: "RUILING",
          title: "Ruilverzoek ontvangen",
          message:
            `Medewerker ${payload.requesterEmployeeNumber} wil dienst ${payload.recipientDutyCode} ` +
            `op ${payload.recipientDate} ruilen tegen dienst ${payload.requesterDutyCode} op ` +
            `${payload.requesterDate}.`,
          entityType: "SwapRequest",
          entityId: String(payload.swapId),
          actionPath: `/medewerker/ruilen/${payload.swapId}`,
          eventKey: event.eventKey,
        },
      ];

    case "SwapAccepted":
      return [
        {
          recipientUserId: String(payload.requesterUserId),
          type: "SWAP_ACCEPTED",
          category: "RUILING",
          title: "Uw ruiling is uitgevoerd",
          message: `De ruil met medewerker ${payload.recipientEmployeeNumber} is doorgevoerd.`,
          entityType: "SwapRequest",
          entityId: String(payload.swapId),
          actionPath: `/medewerker/ruilen/${payload.swapId}`,
          eventKey: `${event.eventKey}|aanvrager`,
        },
        {
          recipientUserId: String(payload.recipientUserId),
          type: "SWAP_ACCEPTED",
          category: "RUILING",
          title: "Uw geaccepteerde ruiling is uitgevoerd",
          message: `De ruil met medewerker ${payload.requesterEmployeeNumber} is doorgevoerd.`,
          entityType: "SwapRequest",
          entityId: String(payload.swapId),
          actionPath: `/medewerker/ruilen/${payload.swapId}`,
          eventKey: `${event.eventKey}|ontvanger`,
        },
      ];

    case "SwapRejected":
      return [
        {
          recipientUserId: String(payload.requesterUserId),
          type: "SWAP_REJECTED",
          category: "RUILING",
          title: "Ruilverzoek afgewezen",
          message: "Uw ruilverzoek is niet geaccepteerd. Uw rooster is ongewijzigd.",
          entityType: "SwapRequest",
          entityId: String(payload.swapId),
          actionPath: `/medewerker/ruilen/${payload.swapId}`,
          eventKey: event.eventKey,
        },
      ];

    case "SwapCancelled":
      return [
        {
          recipientUserId: String(payload.recipientUserId),
          type: "SWAP_CANCELLED",
          category: "RUILING",
          title: "Ruilverzoek ingetrokken",
          message: "De aanvrager heeft het ruilverzoek ingetrokken.",
          entityType: "SwapRequest",
          entityId: String(payload.swapId),
          actionPath: `/medewerker/ruilen/${payload.swapId}`,
          eventKey: event.eventKey,
        },
      ];

    case "SwapInvalidated":
      return [
        {
          recipientUserId: String(payload.requesterUserId),
          type: "SWAP_INVALIDATED",
          category: "RUILING",
          title: "Ruiling kon niet meer worden uitgevoerd",
          message:
            "Een van beide roosters is sinds de aanvraag gewijzigd. De ruil is niet " +
            "doorgevoerd en beide roosters zijn ongewijzigd gebleven.",
          entityType: "SwapRequest",
          entityId: String(payload.swapId),
          actionPath: `/medewerker/ruilen/${payload.swapId}`,
          eventKey: `${event.eventKey}|aanvrager`,
        },
        {
          recipientUserId: String(payload.recipientUserId),
          type: "SWAP_INVALIDATED",
          category: "RUILING",
          title: "Ruiling kon niet meer worden uitgevoerd",
          message:
            "Een van beide roosters is sinds de aanvraag gewijzigd. De ruil is niet " +
            "doorgevoerd en beide roosters zijn ongewijzigd gebleven.",
          entityType: "SwapRequest",
          entityId: String(payload.swapId),
          actionPath: `/medewerker/ruilen/${payload.swapId}`,
          eventKey: `${event.eventKey}|ontvanger`,
        },
      ];

    case "OperationalAssignmentCreated":
      return [
        {
          recipientUserId: String(payload.employeeUserId),
          type: "RES_ASSIGNMENT_CONFIRMED",
          category: "DIENSTINDELING",
          title: "Dienstindeling heeft uw reservedag ingevuld",
          message:
            `Op ${payload.date} rijdt u dienst ${payload.dutyCode} ` +
            `(${payload.times}). Uw basisrooster blijft een reservedag.`,
          entityType: "ScheduledDuty",
          entityId: String(payload.scheduledDutyId),
          actionPath: "/medewerker/rooster",
          eventKey: event.eventKey,
        },
      ];

    case "OperationalAssignmentWithdrawn":
      return [
        {
          recipientUserId: String(payload.employeeUserId),
          type: "RES_ASSIGNMENT_WITHDRAWN",
          category: "DIENSTINDELING",
          title: "Operationele invulling ingetrokken",
          message: `De dienst op ${payload.date} is ingetrokken. U staat weer op reserve.`,
          entityType: "ScheduledDuty",
          entityId: String(payload.scheduledDutyId),
          actionPath: "/medewerker/rooster",
          eventKey: event.eventKey,
        },
      ];

    case "AvailableDutyAllocated": {
      const winnaar: NotificationWrite = {
        recipientUserId: String(payload.winnerUserId),
        type: "AVAILABLE_DUTY_ALLOCATED",
        category: "BESCHIKBARE_DIENST",
        title: "Dienst aan u toegewezen",
        message: `Dienst ${payload.dutyCode} op ${payload.date} is aan u toegewezen.`,
        entityType: "AvailableDuty",
        entityId: String(payload.availableDutyId),
        actionPath: "/medewerker/rooster",
        eventKey: `${event.eventKey}|winnaar`,
      };
      // De anderen horen dát de dienst weg is, niet aan wie.
      const overigen = String(payload.otherUserIds ?? "")
        .split(",")
        .filter(Boolean)
        .map<NotificationWrite>((userId) => ({
          recipientUserId: userId,
          type: "AVAILABLE_DUTY_NOT_ALLOCATED",
          category: "BESCHIKBARE_DIENST",
          title: "Dienst aan een andere kandidaat toegewezen",
          message: `Dienst ${payload.dutyCode} op ${payload.date} is niet aan u toegewezen.`,
          entityType: "AvailableDuty",
          entityId: String(payload.availableDutyId),
          actionPath: "/medewerker/diensten",
          eventKey: `${event.eventKey}|${userId}`,
        }));
      return [winnaar, ...overigen];
    }

    case "AvailableDutyInterestRegistered":
      return [
        {
          recipientUserId: String(payload.employeeUserId),
          type: "AVAILABLE_DUTY_INTEREST_REGISTERED",
          category: "BESCHIKBARE_DIENST",
          title: "Belangstelling geregistreerd",
          message:
            `Uw belangstelling voor dienst ${payload.dutyCode} op ${payload.date} is ` +
            "vastgelegd. De toewijzing gaat via de roulatielijst van die weekdag.",
          entityType: "AvailableDuty",
          entityId: String(payload.availableDutyId),
          actionPath: "/medewerker/diensten",
          eventKey: event.eventKey,
        },
      ];

    case "PermanentPlacementCreated":
      return [
        {
          recipientUserId: String(payload.employeeUserId),
          type: "ROSTER_PLACEMENT_PERMANENT",
          category: "ROOSTER",
          title: "Uw basisrooster wijzigt",
          message:
            `Vanaf ${payload.fromDate} volgt u rooster ${payload.rosterCode} ` +
            `(${payload.rosterName}); u start op regel ${payload.ruleIndex}.`,
          entityType: "RosterMembership",
          entityId: String(payload.membershipId),
          actionPath: "/medewerker/rooster",
          eventKey: event.eventKey,
        },
      ];

    case "TemporaryPlacementCreated":
      return [
        {
          recipientUserId: String(payload.employeeUserId),
          type: "ROSTER_PLACEMENT_TEMPORARY",
          category: "ROOSTER",
          title: "U bent tijdelijk in een ander rooster geplaatst",
          message:
            `Van ${payload.fromDate} tot en met ${payload.untilDate} volgt u rooster ` +
            `${payload.rosterCode} (${payload.rosterName}). Daarna keert u terug naar uw ` +
            "basisrooster.",
          entityType: "RosterMembership",
          entityId: String(payload.membershipId),
          actionPath: "/medewerker/rooster",
          eventKey: event.eventKey,
        },
      ];

    case "TemporaryPlacementEnded":
      return [
        {
          recipientUserId: String(payload.employeeUserId),
          type: "ROSTER_PLACEMENT_ENDED",
          category: "ROOSTER",
          title: "Uw tijdelijke roosterplaatsing is beëindigd",
          message:
            `De tijdelijke plaatsing in ${payload.rosterCode} is per ${payload.endDate} ` +
            "beëindigd. U volgt weer uw basisrooster.",
          entityType: "RosterMembership",
          entityId: String(payload.membershipId),
          actionPath: "/medewerker/rooster",
          eventKey: event.eventKey,
        },
      ];

    case "CaoDayRequested": {
      // Eén gebeurtenis, meerdere ontvangers: de hele dienstindeling van die
      // standplaats. Elk krijgt een eigen sleutel, anders zou de tweede
      // melding als duplicaat van de eerste worden weggegooid.
      const wat =
        payload.dutyCode !== null && payload.dutyCode !== undefined
          ? ` Ingeroosterd: dienst ${payload.dutyCode}${
              payload.timeRange ? ` (${payload.timeRange})` : ""
            }.`
          : payload.positionType === "RES"
            ? " Deze dag staat als reservedienst ingeroosterd."
            : "";
      return String(payload.recipientUserIds ?? "")
        .split(",")
        .filter(Boolean)
        .map<NotificationWrite>((userId) => ({
          recipientUserId: userId,
          type: "CAO_DAY_REQUESTED",
          category: "CAO_DAG",
          title: "Nieuwe CAO-dagaanvraag",
          message:
            `Medewerker ${payload.employeeNumber} vraagt een CAO-dag aan voor ` +
            `${payload.dateLabel}.${wat} Zet deze aanvraag in het NS-verlofboek.`,
          entityType: "CaoDayRequest",
          entityId: String(payload.caoDayId),
          actionPath: "/dienstindeling/cao-dagen",
          eventKey: `${event.eventKey}|${userId}`,
        }));
    }

    case "CaoDayRegistered":
      return [
        {
          recipientUserId: String(payload.recipientUserId),
          type: "CAO_DAY_REGISTERED",
          category: "CAO_DAG",
          title: "Uw CAO-dag staat in het verlofboek",
          message:
            `Uw CAO-dag voor ${payload.dateLabel} is door de dienstindeling in het ` +
            "NS-verlofboek gezet.",
          entityType: "CaoDayRequest",
          entityId: String(payload.caoDayId),
          actionPath: "/medewerker/cao-dagen",
          eventKey: event.eventKey,
        },
      ];

    default:
      // Onbekende gebeurtenis: niets verzinnen, wel zichtbaar laten mislukken.
      throw new Error(`Onbekend gebeurtenistype: ${event.eventType}`);
  }
}

// ── Lezen ────────────────────────────────────────────────────────────────────

export interface NotificationView {
  readonly id: string;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly message: string;
  readonly actionPath: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/** Het aantal ongelezen meldingen. Eén index, geen joins. */
export async function unreadCount(): Promise<number> {
  const actor = await requireActor();
  return prisma.notification.count({
    where: { recipientUserId: actor.userId, readAt: null },
  });
}

export async function listNotifications(options: {
  readonly onlyUnread?: boolean;
  readonly category?: NotificationCategory;
  readonly limit?: number;
  readonly offset?: number;
} = {}): Promise<{ readonly items: readonly NotificationView[]; readonly total: number }> {
  const actor = await requireActor();
  const where = {
    // De eigen meldingen, en niets anders. Er is geen parameter waarmee een
    // andere ontvanger te kiezen valt.
    recipientUserId: actor.userId,
    ...(options.onlyUnread ? { readAt: null } : {}),
    ...(options.category ? { category: options.category } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(options.limit ?? 25, 100),
      skip: options.offset ?? 0,
      select: {
        id: true,
        type: true,
        category: true,
        title: true,
        message: true,
        actionPath: true,
        entityType: true,
        entityId: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
  ]);

  return { items, total };
}

/** Markeert één melding als gelezen. Alleen een eigen melding. */
export async function markRead(notificationId: string): Promise<boolean> {
  const actor = await requireActor();
  const result = await prisma.notification.updateMany({
    // De eigenaar zit in de voorwaarde, niet in een controle achteraf: een
    // melding van iemand anders wordt niet gevonden in plaats van geweigerd.
    where: { id: notificationId, recipientUserId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });

  if (result.count === 0) {
    const bestaat = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { recipientUserId: true },
    });
    if (bestaat && bestaat.recipientUserId !== actor.userId) {
      await recordSecurityEvent({
        kind: "AUTHORIZATION_DENIED",
        userId: actor.userId,
        subject: actor.employeeNumber,
        detail: { poging: "melding-van-ander-lezen", melding: notificationId },
      });
    }
  }
  return result.count > 0;
}

export async function markAllRead(): Promise<number> {
  const actor = await requireActor();
  const result = await prisma.notification.updateMany({
    where: { recipientUserId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
