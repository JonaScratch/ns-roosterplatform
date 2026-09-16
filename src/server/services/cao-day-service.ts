import "server-only";
import {
  CAO_DAY_ALLOWANCE,
  CAO_DAY_ALLOWANCE_SOURCE,
  CAO_DAY_NOTICE_DAYS,
  type CaoDayCheck,
  calendarMonths,
  checkCaoDay,
  earliestCaoDay,
  formatDutchDate,
  monthGrid,
  todayInAmsterdam,
} from "@/domain/cao-days";
import { type CalendarDate, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { recordAudit } from "@/server/audit/log";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { flushNotifications, publishInTransaction, userIdFor } from "./domain-events";
import { projectPersonalRoster } from "./personal-roster-projection-service";

/**
 * CAO-dagen: aanvragen, tonen en in het verlofboek zetten.
 *
 * ## Waarom dit geen goedkeuringsstroom is
 *
 * Een geldige aanvraag — op tijd ingediend, op een dag waarop de medewerker
 * zou rijden, binnen het tegoed — is een recht. De dienstindeling zet hem in
 * het NS-verlofboek; dat is een handeling en geen oordeel. Er is daarom geen
 * "goedkeuren" en geen "afwijzen": de knop heet "verwerkt in verlofboek".
 *
 * Dat verschil is niet cosmetisch. Een goedkeurknop nodigt uit tot afwegen, en
 * dan wordt een recht stilzwijgend een gunst.
 *
 * ## Waarom de bevestiging pas na de commit komt
 *
 * De aanvraag en de melding aan de dienstindeling gaan in één transactie. Pas
 * wanneer die is vastgelegd, krijgt de medewerker "aangevraagd" te zien. Valt
 * de machine daarvóór om, dan is er niets aangevraagd én niets beloofd — en dat
 * is de enige combinatie die niet tot een misverstand leidt.
 *
 * ## Waarom de controle hier opnieuw draait
 *
 * Het scherm maakt dagen grijs met dezelfde functie waarmee de server weigert
 * (`checkCaoDay`). Een uitgeschakelde knop is geen regel: wie het formulier
 * omzeilt, komt langs precies deze functie.
 */

export interface CaoDayView {
  readonly id: string;
  readonly date: CalendarDate;
  readonly dateLabel: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly requestedAt: Date;
  readonly registeredAt: Date | null;
  readonly version: number;
  readonly snapshot: CaoDaySnapshot;
}

/** Wat er op de aangevraagde dag in het rooster stond, op het moment van aanvragen. */
export interface CaoDaySnapshot {
  readonly rosterCode: string | null;
  readonly rosterName: string | null;
  readonly lineNumber: number | null;
  readonly positionType: string | null;
  readonly dutyCode: string | null;
  readonly timeRange: string | null;
}

export interface CaoDayCalendarDay {
  readonly date: CalendarDate;
  readonly positionType: string | null;
  readonly dutyCode: string | null;
  readonly timeRange: string | null;
  readonly check: CaoDayCheck;
  readonly requested: boolean;
}

export interface CaoDayMonth {
  readonly month: CalendarDate;
  readonly label: string;
  readonly cells: readonly (CaoDayCalendarDay | null)[];
}

export interface CaoDayOverview {
  readonly today: CalendarDate;
  readonly earliest: CalendarDate;
  readonly earliestLabel: string;
  readonly noticeDays: number;
  readonly allowance: number;
  readonly allowanceSource: string;
  readonly used: number;
  readonly remaining: number;
  readonly requests: readonly CaoDayView[];
  readonly months: readonly CaoDayMonth[];
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  REQUESTED: "Aangevraagd",
  REGISTERED_IN_LEAVE_BOOK: "Verwerkt in verlofboek",
  CANCELLED: "Ingetrokken",
};

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Het overzicht voor de medewerker: kalender plus eigen aanvragen.
 *
 * De kalender begint bij de eerste dag die gekozen mág worden, niet bij vandaag.
 * Een kalender die op vandaag opent, laat iemand eerst zes weken doorklikken
 * langs dagen die allemaal grijs zijn.
 */
export async function caoDayOverview(): Promise<CaoDayOverview> {
  const actor = await requirePermission(PERMISSIONS.SCHEDULE_READ_OWN);
  return caoDayOverviewCore(actor);
}

/**
 * Hetzelfde overzicht, met de handelende persoon als argument.
 *
 * Bestaat zodat een verificatiescript exact dezelfde weg kan aflopen als de
 * applicatie. Een script dat zijn eigen variant schrijft, bewijst zijn eigen
 * variant. De rechtencontrole zit in de schil hierboven.
 */
export async function caoDayOverviewCore(
  actor: Actor,
  now?: Date,
): Promise<CaoDayOverview> {
  const vandaag = todayInAmsterdam(now);
  const vroegste = earliestCaoDay(vandaag);

  const maanden = calendarMonths(vandaag, 3);
  const eindeVanLaatsteMaand = laatsteDagVanMaand(maanden[maanden.length - 1]);

  const [aanvragen, projectie] = await Promise.all([
    prisma.caoDayRequest.findMany({
      where: { employeeId: actor.employeeId },
      orderBy: { requestedDate: "asc" },
    }),
    projectPersonalRoster({
      employeeId: actor.employeeId,
      from: vroegste,
      to: eindeVanLaatsteMaand,
    }),
  ]);

  const perDatum = new Map(projectie.days.map((dag) => [dag.date, dag]));
  const lopende = aanvragen
    .filter((aanvraag) => aanvraag.status !== "CANCELLED")
    .map((aanvraag) => toCalendarDate(aanvraag.requestedDate));
  const aangevraagd = new Set(lopende);
  const gebruikt = aangevraagd.size;

  const months = maanden.map<CaoDayMonth>((maand) => ({
    month: maand,
    label: maandLabel(maand),
    cells: monthGrid(maand).map((datum) => {
      if (datum === null) {
        return null;
      }
      const dag = perDatum.get(datum);
      // Een onbepaalde dag telt als "geen rooster": zonder rooster valt niet
      // vast te stellen waarvoor iemand vrij vraagt.
      const positionType = dag?.determinate ? dag.effectiveSlot : null;
      return {
        date: datum,
        positionType,
        dutyCode: dag?.effectiveDutyCode ?? null,
        timeRange: tijdvak(dag?.startMinute ?? null, dag?.endMinute ?? null),
        requested: aangevraagd.has(datum),
        // Dezelfde functie als de server gebruikt om te weigeren. Een dag naast
        // een lopende aanvraag komt hier dus vanzelf als niet-kiesbaar uit; het
        // scherm hoeft die regel niet te kennen en kan er niet van afwijken.
        check: checkCaoDay({
          date: datum,
          today: vandaag,
          positionType,
          activeDates: lopende,
        }),
      };
    }),
  }));

  return {
    today: vandaag,
    earliest: vroegste,
    earliestLabel: formatDutchDate(vroegste),
    noticeDays: CAO_DAY_NOTICE_DAYS,
    allowance: CAO_DAY_ALLOWANCE,
    allowanceSource: CAO_DAY_ALLOWANCE_SOURCE,
    used: gebruikt,
    remaining: Math.max(0, CAO_DAY_ALLOWANCE - gebruikt),
    requests: aanvragen.map(toView),
    months,
  };
}

export interface CaoDayResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Eén dag aanvragen. */
export async function requestCaoDay(date: string): Promise<CaoDayResult> {
  const actor = await requirePermission(PERMISSIONS.SCHEDULE_READ_OWN);
  return requestCaoDayCore(actor, date);
}

/** De aanvraag zelf. Zie `caoDayOverviewCore` voor waarom deze schil bestaat. */
export async function requestCaoDayCore(
  actor: Actor,
  date: string,
  now?: Date,
): Promise<CaoDayResult> {
  if (!DATUM.test(date)) {
    return { ok: false, reason: "Dat is geen geldige datum." };
  }
  const datum: CalendarDate = date;
  const vandaag = todayInAmsterdam(now);

  const [lopende, projectie, location] = await Promise.all([
    activeCaoDates(prisma, actor.employeeId),
    projectPersonalRoster({ employeeId: actor.employeeId, from: datum, to: datum }),
    prisma.stationLocation.findUnique({ where: { code: actor.depot }, select: { id: true } }),
  ]);

  const dag = projectie.days[0];
  const positionType = dag?.determinate ? dag.effectiveSlot : null;

  // Een eerste toets buiten de transactie, zodat een gewone weigering geen
  // grendel nodig heeft. De toets die telt, staat hieronder nog een keer.
  const vooraf = checkCaoDay({ date: datum, today: vandaag, positionType, activeDates: lopende });
  if (!vooraf.allowed) {
    return weigeren(actor, datum, vooraf);
  }

  if (!location) {
    return { ok: false, reason: `Standplaats ${actor.depot} is niet ingericht.` };
  }

  const snapshot: CaoDaySnapshot = {
    rosterCode: dag?.sourceRoster ?? null,
    rosterName: projectie.membership?.rosterName ?? null,
    lineNumber: dag?.sourceRule ?? null,
    positionType,
    dutyCode: dag?.effectiveDutyCode ?? null,
    timeRange: tijdvak(dag?.startMinute ?? null, dag?.endMinute ?? null),
  };

  // De dienstindeling van déze standplaats, niet van een andere. Wie geen
  // account heeft, krijgt geen melding; dat mag de aanvraag niet tegenhouden.
  const dienstindeling = await prisma.userAccount.findMany({
    where: {
      status: "ACTIVE",
      roles: { has: "DUTY_ASSIGNMENT" },
      employee: { depot: actor.depot },
    },
    select: { id: true },
  });

  // Aanvraag en melding in één transactie: een aanvraag zonder melding blijft
  // liggen, een melding zonder aanvraag verwijst naar niets.
  const uitkomst = await prisma.$transaction(async (tx) => {
    // Vanaf hier is deze medewerker aan de beurt en niemand anders.
    //
    // Zonder deze grendel kunnen twee gelijktijdige aanvragen — maandag en
    // dinsdag — allebei een lijst lezen waarin de ander nog niet staat, en
    // allebei slagen. De unieke sleutel vangt dat niet af: het zijn twee
    // verschillende datums. Hetzelfde geldt voor het tegoed: twee keer "nog
    // 1 over" is twee keer waar tot de eerste heeft geschreven.
    //
    // De grendel hangt aan de transactie en gaat dus vanzelf los, ook wanneer
    // die afbreekt. Hij geldt per medewerker, zodat aanvragen van collega's
    // elkaar niet ophouden.
    //
    // `$executeRaw` en niet `$queryRaw`: de grendelfunctie levert `void` op, en
    // daar kan de resultaatlezer niets mee.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cao-dag:${actor.employeeId}`}))`;

    // Opnieuw lezen en opnieuw toetsen, nu binnen de grendel. Dit is de toets
    // die telt; de voorafgaande bestond alleen om de grendel te sparen.
    const definitief = checkCaoDay({
      date: datum,
      today: vandaag,
      positionType,
      activeDates: await activeCaoDates(tx, actor.employeeId),
    });
    if (!definitief.allowed) {
      return { geweigerd: definitief, rij: null };
    }

    // `create` zou hier stuklopen op `CaoDayRequest_employeeId_requestedDate_key`
    // zodra deze medewerker deze datum ooit eerder heeft aangevraagd en weer
    // heeft ingetrokken: de unieke sleutel geldt over alle statussen, niet
    // alleen de lopende. `definitief.allowed` hierboven bewijst — binnen
    // dezelfde grendel — dat een eventuele bestaande rij voor deze combinatie
    // CANCELLED moet zijn, dus `upsert` maakt daar veilig een nieuwe aanvraag
    // van in plaats van een tweede rij te proberen.
    const rij = await tx.caoDayRequest.upsert({
      where: {
        employeeId_requestedDate: {
          employeeId: actor.employeeId,
          requestedDate: toDatabaseDate(datum),
        },
      },
      create: {
        employeeId: actor.employeeId,
        locationId: location.id,
        requestedDate: toDatabaseDate(datum),
        rosterSnapshot: { ...snapshot },
        status: "REQUESTED",
      },
      update: {
        locationId: location.id,
        rosterSnapshot: { ...snapshot },
        status: "REQUESTED",
        requestedAt: new Date(),
        registeredAt: null,
        registeredBy: null,
        cancelledAt: null,
        version: { increment: 1 },
      },
    });

    await publishInTransaction(tx, {
      eventType: "CaoDayRequested",
      eventKey: `cao-dag-aangevraagd:${rij.id}`,
      payload: {
        caoDayId: rij.id,
        employeeNumber: actor.employeeNumber,
        dateLabel: formatDutchDate(datum),
        dutyCode: snapshot.dutyCode,
        timeRange: snapshot.timeRange,
        positionType: snapshot.positionType,
        recipientUserIds: dienstindeling.map((account) => account.id).join(","),
      },
    });

    return { geweigerd: null, rij };
  });

  if (uitkomst.geweigerd) {
    return weigeren(actor, datum, uitkomst.geweigerd);
  }

  await recordAudit({
    actor,
    action: "cao-dag.aangevraagd",
    objectType: "CaoDayRequest",
    objectId: uitkomst.rij.id,
    newValue: { datum, rooster: snapshot.rosterCode, dienst: snapshot.dutyCode },
  });
  await flushNotifications();

  return { ok: true };
}

/** De lopende aanvragen van een medewerker, als kalenderdatums. */
async function activeCaoDates(
  client: Pick<typeof prisma, "caoDayRequest">,
  employeeId: string,
): Promise<readonly CalendarDate[]> {
  const rijen = await client.caoDayRequest.findMany({
    where: { employeeId, status: { not: "CANCELLED" } },
    select: { requestedDate: true },
  });
  return rijen.map((rij) => toCalendarDate(rij.requestedDate));
}

/** Een weigering vastleggen en teruggeven, met de reden die de medewerker leest. */
async function weigeren(
  actor: Actor,
  datum: CalendarDate,
  controle: CaoDayCheck,
): Promise<CaoDayResult> {
  await recordAudit({
    actor,
    action: "cao-dag.geweigerd",
    objectType: "CaoDayRequest",
    result: "DENIED",
    reason: controle.refusal ?? "onbekend",
    newValue: { datum },
  });
  return { ok: false, reason: controle.message ?? "Deze dag kan niet worden aangevraagd." };
}

export interface CaoDayQueueItem extends CaoDayView {
  readonly employeeNumber: string;
}

/** De aanvragen voor de dienstindeling van deze standplaats. */
export async function caoDayQueue(): Promise<readonly CaoDayQueueItem[]> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  return caoDayQueueCore(actor);
}

export async function caoDayQueueCore(actor: Actor): Promise<readonly CaoDayQueueItem[]> {
  const rijen = await prisma.caoDayRequest.findMany({
    where: { location: { code: actor.depot } },
    orderBy: [{ requestedDate: "asc" }],
    include: { employee: { select: { employeeNumber: true } } },
  });
  return rijen.map((rij) => ({ ...toView(rij), employeeNumber: rij.employee.employeeNumber }));
}

/**
 * De dienstindeling zet de aanvraag in het NS-verlofboek.
 *
 * Voorwaardelijk op de versie: klikken twee mensen tegelijk, dan slaagt er
 * precies één en krijgt de ander te horen dat het al gedaan is. Zonder die
 * voorwaarde zou de tweede klik een tweede melding aan de medewerker sturen
 * over iets wat al verwerkt was.
 */
export async function registerCaoDay(
  id: string,
  expectedVersion: number,
): Promise<CaoDayResult> {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE);
  return registerCaoDayCore(actor, id, expectedVersion);
}

/** Het verwerken zelf. Zie `caoDayOverviewCore` voor waarom deze schil bestaat. */
export async function registerCaoDayCore(
  actor: Actor,
  id: string,
  expectedVersion: number,
): Promise<CaoDayResult> {
  const aanvraag = await prisma.caoDayRequest.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, employeeNumber: true } },
      location: { select: { code: true } },
    },
  });
  if (!aanvraag || aanvraag.location.code !== actor.depot) {
    return { ok: false, reason: "Deze aanvraag bestaat niet." };
  }
  if (aanvraag.status !== "REQUESTED") {
    return {
      ok: false,
      reason: `Deze aanvraag staat al op "${STATUS_LABELS[aanvraag.status] ?? aanvraag.status}".`,
    };
  }

  const ontvanger = await userIdFor(aanvraag.employee.id);
  const datum = toCalendarDate(aanvraag.requestedDate);

  const gelukt = await prisma.$transaction(async (tx) => {
    const bijgewerkt = await tx.caoDayRequest.updateMany({
      where: { id, version: expectedVersion, status: "REQUESTED" },
      data: {
        status: "REGISTERED_IN_LEAVE_BOOK",
        registeredAt: new Date(),
        registeredBy: actor.employeeNumber,
        version: { increment: 1 },
      },
    });
    if (bijgewerkt.count === 0) {
      return false;
    }

    if (ontvanger) {
      await publishInTransaction(tx, {
        eventType: "CaoDayRegistered",
        eventKey: `cao-dag-verwerkt:${id}`,
        payload: {
          caoDayId: id,
          recipientUserId: ontvanger,
          dateLabel: formatDutchDate(datum),
        },
      });
    }
    return true;
  });

  if (!gelukt) {
    return {
      ok: false,
      reason: "Deze aanvraag is inmiddels door iemand anders bijgewerkt. Ververs de pagina.",
    };
  }

  await recordAudit({
    actor,
    action: "cao-dag.verwerkt-in-verlofboek",
    objectType: "CaoDayRequest",
    objectId: id,
    newValue: { datum, medewerker: aanvraag.employee.employeeNumber },
  });
  await flushNotifications();

  return { ok: true };
}

/**
 * De medewerker trekt een aanvraag in.
 *
 * Kan zolang de dienstindeling hem nog niet in het verlofboek heeft gezet.
 * Daarna staat hij in een systeem buiten dit platform, en dan is intrekken hier
 * een belofte die dit platform niet waar kan maken.
 */
export async function cancelCaoDay(id: string): Promise<CaoDayResult> {
  const actor = await requirePermission(PERMISSIONS.SCHEDULE_READ_OWN);
  return cancelCaoDayCore(actor, id);
}

export async function cancelCaoDayCore(actor: Actor, id: string): Promise<CaoDayResult> {
  const aanvraag = await prisma.caoDayRequest.findUnique({
    where: { id },
    select: { id: true, employeeId: true, status: true, version: true, requestedDate: true },
  });
  if (!aanvraag || aanvraag.employeeId !== actor.employeeId) {
    return { ok: false, reason: "Deze aanvraag bestaat niet." };
  }
  if (aanvraag.status !== "REQUESTED") {
    return {
      ok: false,
      reason:
        aanvraag.status === "REGISTERED_IN_LEAVE_BOOK"
          ? "Deze CAO-dag staat al in het verlofboek. Neem contact op met de dienstindeling."
          : "Deze aanvraag is al ingetrokken.",
    };
  }

  const gelukt = await prisma.$transaction(async (tx) => {
    const bijgewerkt = await tx.caoDayRequest.updateMany({
      where: { id, version: aanvraag.version, status: "REQUESTED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } },
    });
    return bijgewerkt.count > 0;
  });

  if (!gelukt) {
    return { ok: false, reason: "De aanvraag is inmiddels gewijzigd. Ververs de pagina." };
  }

  await recordAudit({
    actor,
    action: "cao-dag.ingetrokken",
    objectType: "CaoDayRequest",
    objectId: id,
    newValue: { datum: toCalendarDate(aanvraag.requestedDate) },
  });

  return { ok: true };
}

// ── Hulpmiddelen ─────────────────────────────────────────────────────────────

function toView(rij: {
  id: string;
  requestedDate: Date;
  status: string;
  requestedAt: Date;
  registeredAt: Date | null;
  version: number;
  rosterSnapshot: unknown;
}): CaoDayView {
  const datum = toCalendarDate(rij.requestedDate);
  return {
    id: rij.id,
    date: datum,
    dateLabel: formatDutchDate(datum),
    status: rij.status,
    statusLabel: STATUS_LABELS[rij.status] ?? rij.status,
    requestedAt: rij.requestedAt,
    registeredAt: rij.registeredAt,
    version: rij.version,
    snapshot: (rij.rosterSnapshot ?? {}) as CaoDaySnapshot,
  };
}

function tijdvak(start: number | null, eind: number | null): string | null {
  if (start === null || eind === null) {
    return null;
  }
  return `${klok(start)} - ${klok(eind)}`;
}

function klok(minuten: number): string {
  const dagminuut = ((minuten % 1440) + 1440) % 1440;
  const uren = String(Math.floor(dagminuut / 60)).padStart(2, "0");
  return `${uren}:${String(dagminuut % 60).padStart(2, "0")}`;
}

function laatsteDagVanMaand(maand: CalendarDate): CalendarDate {
  const eerste = new Date(`${maand.slice(0, 7)}-01T12:00:00Z`);
  return toCalendarDate(
    new Date(Date.UTC(eerste.getUTCFullYear(), eerste.getUTCMonth() + 1, 0, 12)),
  );
}

const MAANDNAMEN = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

function maandLabel(maand: CalendarDate): string {
  const moment = new Date(`${maand.slice(0, 7)}-01T12:00:00Z`);
  return `${MAANDNAMEN[moment.getUTCMonth()]} ${moment.getUTCFullYear()}`;
}
