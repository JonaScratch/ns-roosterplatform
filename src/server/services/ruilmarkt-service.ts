import "server-only";
import { RosterPositionType, SwapListingStatus } from "@/lib/generated/prisma/enums";
import { type CalendarDate, toCalendarDate } from "@/domain/time";
import { type SwapListingPreference, preferenceWeight } from "@/domain/ruilmarkt";
import { isNoOpSwap } from "@/domain/swap";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { DUTY_SELECT } from "@/server/data/mappers";
import { proposeSwapCore, simulate, type SwapCandidateView } from "./swap-service";

/**
 * De ruilmarkt: een dienst beschikbaar stellen zonder vooraf een collega te
 * kiezen.
 *
 * ## Waarom dit geen tweede uitvoeringspad is
 *
 * Alles hier stopt bij het moment waarop iemand kiest welke eigen dienst hij
 * aanbiedt. Vanaf dat punt ontstaat een gewoon `SwapProposal`, aangemaakt door
 * `proposeSwapCore` uit `swap-service.ts` — dezelfde toetsing, dezelfde
 * hertoetsing bij accepteren, dezelfde transactie, dezelfde meldingen als een
 * rechtstreekse ruil. Deze module berekent alleen wélke eigen diensten
 * geldig tegenover een aanbieding staan (via `simulate`, ongewijzigd
 * overgenomen uit `swap-service.ts`) en bewaakt de levenscyclus van de
 * aanbieding zelf: OPEN, WITHDRAWN, EXPIRED, of — via de acceptatie van één
 * van de voorstellen die eruit ontstaan — MATCHED.
 *
 * ## Waarom elke functie een `...Core(actor, ...)`-tegenhanger heeft
 *
 * Zelfde reden als bij `cao-day-service.ts` en `respondToSwapCore`: een
 * verificatiescript moet exact dezelfde weg kunnen aflopen als de applicatie,
 * met een expliciet meegegeven medewerker in plaats van een sessie. De
 * rechtencontrole zit in de dunne schil erboven.
 */

const STATUS_LABELS: Readonly<Record<string, string>> = {
  OPEN: "Open",
  MATCHED: "Geruild",
  WITHDRAWN: "Ingetrokken",
  EXPIRED: "Verlopen",
};

export interface ListingDutyView {
  readonly date: CalendarDate;
  readonly dutyCode: string;
  readonly kinds: readonly string[];
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface MarketplaceListingView {
  readonly id: string;
  readonly duty: ListingDutyView;
  readonly preference: SwapListingPreference;
  readonly createdAt: Date;
}

export interface MyListingView extends MarketplaceListingView {
  readonly status: string;
  readonly statusLabel: string;
  readonly pendingProposals: number;
}

/**
 * Eigen toekomstige diensten die aangeboden mogen worden.
 *
 * Uitsluitend concrete diensten (`positionType: DUTY`): een reservedag, een
 * rustdag, WTV, compensatie of een CAO-dag hebben geen tegenwaarde om te
 * ruilen en horen hier niet in te staan.
 */
export async function ownOfferableDuties(): Promise<
  readonly { id: string; date: CalendarDate; dutyCode: string; startMinute: number; endMinute: number }[]
> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  const rows = await prisma.scheduledDuty.findMany({
    where: {
      employeeId: actor.employeeId,
      positionType: RosterPositionType.DUTY,
      dutyId: { not: null },
      date: { gte: new Date() },
    },
    orderBy: { date: "asc" },
    take: 60,
    select: { id: true, date: true, duty: { select: DUTY_SELECT } },
  });
  return rows
    .filter((row) => row.duty !== null)
    .map((row) => ({
      id: row.id,
      date: toCalendarDate(row.date),
      dutyCode: row.duty!.code,
      startMinute: row.duty!.startMinute,
      endMinute: row.duty!.endMinute,
    }));
}

export interface PublishListingResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly id?: string;
}

/** Eén eigen dienst beschikbaar stellen voor de ruilmarkt. */
export async function publishListing(options: {
  readonly scheduledDutyId: string;
  readonly preference: SwapListingPreference;
}): Promise<PublishListingResult> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  return publishListingCore(actor, options);
}

export async function publishListingCore(
  actor: Actor,
  options: { readonly scheduledDutyId: string; readonly preference: SwapListingPreference },
): Promise<PublishListingResult> {
  // Dezelfde afbakening als bij een rechtstreekse ruil: alleen een concrete
  // eigen dienst, nooit R, RES, WTV, CO of een CAO-dag. `employeeId` in de
  // `where` maakt andermans dienst onvindbaar in plaats van een aparte
  // eigendomscontrole.
  const dienst = await prisma.scheduledDuty.findFirst({
    where: {
      id: options.scheduledDutyId,
      employeeId: actor.employeeId,
      positionType: RosterPositionType.DUTY,
      dutyId: { not: null },
      date: { gte: new Date() },
    },
    select: { id: true, date: true },
  });
  if (!dienst) {
    return {
      ok: false,
      reason: "Deze dienst bestaat niet, ligt in het verleden, of is niet van u.",
    };
  }

  const bestaand = await prisma.swapListing.findFirst({
    where: { scheduledDutyId: dienst.id, status: SwapListingStatus.OPEN },
    select: { id: true },
  });
  if (bestaand) {
    return { ok: false, reason: "Deze dienst staat al open in de ruilmarkt." };
  }

  const rij = await prisma.swapListing.create({
    data: {
      employeeId: actor.employeeId,
      scheduledDutyId: dienst.id,
      date: dienst.date,
      preference: options.preference,
      // Een aanbieding voor een dienst heeft geen zin meer ná die dag. `date`
      // staat op middernacht (kolomtype `@db.Date`) — de vervaldatum moet dus
      // het einde van die dag zijn, niet het begin, anders is een aanbieding
      // voor vandaag bij het aanmaken al "verlopen".
      expiresAt: new Date(dienst.date.getTime() + 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  await recordAudit({
    actor,
    action: "ruilmarkt.aangeboden",
    objectType: "SwapListing",
    objectId: rij.id,
    newValue: { dienstId: dienst.id, datum: toCalendarDate(dienst.date), voorkeur: options.preference },
  });

  return { ok: true, id: rij.id };
}

/** De eigen aanbiedingen, inclusief afgehandelde. */
export async function myListings(): Promise<readonly MyListingView[]> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  return myListingsCore(actor);
}

export async function myListingsCore(actor: Actor): Promise<readonly MyListingView[]> {
  await vervalVerlopenAanbiedingen(actor.employeeId);

  const rijen = await prisma.swapListing.findMany({
    where: { employeeId: actor.employeeId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      preference: true,
      createdAt: true,
      scheduledDuty: { select: { date: true, duty: { select: DUTY_SELECT } } },
      _count: {
        select: { proposals: { where: { status: "PENDING" } } },
      },
    },
  });

  return rijen
    .filter((rij) => rij.scheduledDuty.duty !== null)
    .map((rij) => ({
      id: rij.id,
      status: rij.status,
      statusLabel: STATUS_LABELS[rij.status] ?? rij.status,
      preference: rij.preference as SwapListingPreference,
      createdAt: rij.createdAt,
      pendingProposals: rij._count.proposals,
      duty: {
        date: toCalendarDate(rij.scheduledDuty.date),
        dutyCode: rij.scheduledDuty.duty!.code,
        kinds: rij.scheduledDuty.duty!.kinds,
        startMinute: rij.scheduledDuty.duty!.startMinute,
        endMinute: rij.scheduledDuty.duty!.endMinute,
      },
    }));
}

export interface WithdrawListingResult {
  readonly ok: boolean;
  readonly reason: string;
}

/** Een eigen, nog open aanbieding intrekken. */
export async function withdrawListing(listingId: string): Promise<WithdrawListingResult> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  return withdrawListingCore(actor, listingId);
}

export async function withdrawListingCore(
  actor: Actor,
  listingId: string,
): Promise<WithdrawListingResult> {
  const listing = await prisma.swapListing.findUnique({
    where: { id: listingId },
    select: { id: true, employeeId: true, status: true, version: true },
  });
  if (!listing || listing.employeeId !== actor.employeeId) {
    return { ok: false, reason: "Deze aanbieding bestaat niet." };
  }
  if (listing.status !== SwapListingStatus.OPEN) {
    return {
      ok: false,
      reason:
        listing.status === SwapListingStatus.MATCHED
          ? "Deze aanbieding is al geruild."
          : "Deze aanbieding staat al niet meer open.",
    };
  }

  const bijgewerkt = await prisma.swapListing.updateMany({
    where: { id: listingId, status: SwapListingStatus.OPEN, version: listing.version },
    data: { status: SwapListingStatus.WITHDRAWN, withdrawnAt: new Date(), version: { increment: 1 } },
  });
  if (bijgewerkt.count === 0) {
    return { ok: false, reason: "De aanbieding is net gewijzigd. Ververs de pagina." };
  }

  await recordAudit({
    actor,
    action: "ruilmarkt.ingetrokken",
    objectType: "SwapListing",
    objectId: listingId,
  });

  return { ok: true, reason: "De aanbieding is ingetrokken." };
}

/**
 * De ruilmarkt zelf: open aanbiedingen van collega's van dezelfde standplaats.
 *
 * Bevat nooit een naam of personeelsnummer van de aanbieder — wie hem heeft
 * geplaatst, is voor deze lijst niet relevant en blijft dus weg. Zonder
 * geldige tegenpartij wordt hier niets voorgerekend: die berekening gebeurt
 * pas op aanvraag, per aanbieding, in `listingMatches`.
 */
export async function marketplaceListings(): Promise<readonly MarketplaceListingView[]> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  return marketplaceListingsCore(actor);
}

export async function marketplaceListingsCore(
  actor: Actor,
): Promise<readonly MarketplaceListingView[]> {
  const rijen = await prisma.swapListing.findMany({
    where: {
      status: SwapListingStatus.OPEN,
      employeeId: { not: actor.employeeId },
      expiresAt: { gt: new Date() },
      employee: { depot: actor.depot },
    },
    orderBy: { date: "asc" },
    take: 100,
    select: {
      id: true,
      preference: true,
      createdAt: true,
      scheduledDuty: { select: { date: true, duty: { select: DUTY_SELECT } } },
    },
  });

  return rijen
    .filter((rij) => rij.scheduledDuty.duty !== null)
    .map((rij) => ({
      id: rij.id,
      preference: rij.preference as SwapListingPreference,
      createdAt: rij.createdAt,
      duty: {
        date: toCalendarDate(rij.scheduledDuty.date),
        dutyCode: rij.scheduledDuty.duty!.code,
        kinds: rij.scheduledDuty.duty!.kinds,
        startMinute: rij.scheduledDuty.duty!.startMinute,
        endMinute: rij.scheduledDuty.duty!.endMinute,
      },
    }));
}

export interface ListingMatchesResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly listing?: MarketplaceListingView;
  readonly matches: readonly SwapCandidateView[];
}

/**
 * Welke eigen diensten kunnen daadwerkelijk tegenover deze aanbieding staan.
 *
 * Roept exact dezelfde toetsing aan als een rechtstreekse ruil (`simulate`,
 * ongewijzigd uit `swap-service.ts`) — per eigen dienst, tegen de ene
 * aangeboden dienst. Geen kandidaat: geen resultaat, en de aanroeper toont dan
 * geen bevestigingsknop maar de eerlijke boodschap dat er nu niets kan.
 */
export async function listingMatches(listingId: string): Promise<ListingMatchesResult> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  return listingMatchesCore(actor, listingId);
}

export async function listingMatchesCore(
  actor: Actor,
  listingId: string,
): Promise<ListingMatchesResult> {
  const listing = await prisma.swapListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      status: true,
      employeeId: true,
      preference: true,
      createdAt: true,
      scheduledDutyId: true,
      scheduledDuty: { select: { date: true, duty: { select: DUTY_SELECT } } },
    },
  });
  if (!listing || !listing.scheduledDuty.duty) {
    return { ok: false, reason: "Deze aanbieding bestaat niet.", matches: [] };
  }
  if (listing.status !== SwapListingStatus.OPEN) {
    return { ok: false, reason: "Deze aanbieding is niet meer beschikbaar.", matches: [] };
  }
  if (listing.employeeId === actor.employeeId) {
    return { ok: false, reason: "U kunt niet op uw eigen aanbieding reageren.", matches: [] };
  }

  const aangebodenDuty = listing.scheduledDuty.duty;
  const aangebodenDatum = toCalendarDate(listing.scheduledDuty.date);
  const voorkeur = listing.preference as SwapListingPreference;

  const eigenDiensten = await prisma.scheduledDuty.findMany({
    where: {
      employeeId: actor.employeeId,
      positionType: RosterPositionType.DUTY,
      dutyId: { not: null },
      date: { gte: new Date() },
    },
    orderBy: { date: "asc" },
    take: 40,
    select: { id: true, date: true, duty: { select: DUTY_SELECT } },
  });

  const resultaten: (SwapCandidateView & { readonly gewicht: number })[] = [];

  for (const eigen of eigenDiensten) {
    const eigenDuty = eigen.duty;
    if (!eigenDuty) {
      continue;
    }
    if (
      isNoOpSwap(
        {
          employeeId: actor.employeeId,
          date: toCalendarDate(eigen.date),
          dutyId: eigenDuty.id,
          scheduledDutyId: eigen.id,
        },
        {
          employeeId: listing.employeeId,
          date: aangebodenDatum,
          dutyId: aangebodenDuty.id,
          scheduledDutyId: listing.scheduledDutyId,
        },
      )
    ) {
      continue;
    }

    const evaluatie = await simulate({
      initiator: {
        employeeId: actor.employeeId,
        surrenderScheduledDutyId: eigen.id,
        surrenderDuty: eigenDuty,
        receivesDate: aangebodenDatum,
        receivesDuty: aangebodenDuty,
      },
      counterparty: {
        employeeId: listing.employeeId,
        surrenderScheduledDutyId: listing.scheduledDutyId,
        surrenderDuty: aangebodenDuty,
        receivesDate: toCalendarDate(eigen.date),
        receivesDuty: eigenDuty,
      },
    });

    const blockers = evaluatie.findings
      .filter((item) => item.severity === "VIOLATION")
      .map((item) => `${item.employeeNumber ?? ""}: ${item.message}`.trim());
    if (blockers.length > 0) {
      continue;
    }

    resultaten.push({
      scheduledDutyId: eigen.id,
      date: toCalendarDate(eigen.date),
      dutyCode: eigenDuty.code,
      kinds: eigenDuty.kinds,
      startMinute: eigenDuty.startMinute,
      endMinute: eigenDuty.endMinute,
      blockers,
      warnings: evaluatie.findings.filter((item) => item.severity === "WARNING").map((item) => item.message),
      gewicht: preferenceWeight(aangebodenDuty.startMinute, eigenDuty.startMinute, voorkeur),
    });
  }

  resultaten.sort((een, ander) => een.gewicht - ander.gewicht || (een.date < ander.date ? -1 : 1));

  return {
    ok: true,
    listing: {
      id: listing.id,
      preference: voorkeur,
      createdAt: listing.createdAt,
      duty: {
        date: aangebodenDatum,
        dutyCode: aangebodenDuty.code,
        kinds: aangebodenDuty.kinds,
        startMinute: aangebodenDuty.startMinute,
        endMinute: aangebodenDuty.endMinute,
      },
    },
    matches: resultaten.map(({ gewicht: _gewicht, ...zicht }) => zicht),
  };
}

export interface ClaimListingResult {
  readonly created: boolean;
  readonly reasons: readonly string[];
}

/**
 * Een aanbieding claimen: de gekozen eigen dienst wordt een gewoon
 * ruilvoorstel aan de aanbieder, met deze aanbieding als herkomst.
 *
 * Vanaf hier is er niets marktplaats-specifieks meer: `proposeSwapCore` doet
 * dezelfde toetsing, dezelfde vastlegging en dezelfde melding als bij een
 * rechtstreekse ruil. De aanbieder beantwoordt dit voorstel op precies dezelfde
 * manier — accepteren voert de ruil uit, via `respondToSwapCore`, die de
 * aanbieding op zijn beurt van OPEN naar MATCHED zet.
 */
export async function claimListing(options: {
  readonly listingId: string;
  readonly ownScheduledDutyId: string;
  readonly message?: string;
}): Promise<ClaimListingResult> {
  const actor = await requirePermission(PERMISSIONS.SWAP_PROPOSE);
  return claimListingCore(actor, options);
}

export async function claimListingCore(
  actor: Actor,
  options: {
    readonly listingId: string;
    readonly ownScheduledDutyId: string;
    readonly message?: string;
  },
): Promise<ClaimListingResult> {
  const listing = await prisma.swapListing.findUnique({
    where: { id: options.listingId },
    select: { id: true, status: true, employeeId: true, scheduledDutyId: true },
  });
  if (!listing) {
    return { created: false, reasons: ["Deze aanbieding bestaat niet."] };
  }
  if (listing.employeeId === actor.employeeId) {
    return { created: false, reasons: ["U kunt niet op uw eigen aanbieding reageren."] };
  }
  if (listing.status !== SwapListingStatus.OPEN) {
    return { created: false, reasons: ["Deze aanbieding is niet meer beschikbaar voor ruil."] };
  }

  return proposeSwapCore(actor, {
    ownScheduledDutyId: options.ownScheduledDutyId,
    counterpartyScheduledDutyId: listing.scheduledDutyId,
    message: options.message,
    listingId: listing.id,
  });
}

/** Verlopen aanbiedingen van deze medewerker bijwerken, lezend op verzoek. */
async function vervalVerlopenAanbiedingen(employeeId: string): Promise<void> {
  await prisma.swapListing.updateMany({
    where: { employeeId, status: SwapListingStatus.OPEN, expiresAt: { lte: new Date() } },
    data: { status: SwapListingStatus.EXPIRED },
  });
}
