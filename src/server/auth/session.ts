import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import type { AuthLevel, Role } from "@/lib/generated/prisma/enums";
import { AccountStatus } from "@/lib/generated/prisma/enums";
import { config, isProduction } from "@/server/config/env";
import { prisma } from "@/server/data/prisma";

/**
 * Sessiebeheer.
 *
 * ## Waarom sessies aan de serverkant staan en niet in een JWT
 *
 * Een JWT is geldig tot hij verloopt, ook nadat een account is geblokkeerd of
 * een rol is ingetrokken. Voor een applicatie waarin roosters worden gewijzigd
 * en persoonsgegevens worden ingezien, is "we kunnen toegang niet meteen
 * intrekken" geen aanvaardbare eigenschap. Een sessie in de database is
 * onmiddellijk in te trekken en zichtbaar in het toezicht.
 *
 * ## Waarom alleen de hash wordt opgeslagen
 *
 * Wat in de database staat is een HMAC van het token met de servergeheime
 * sleutel. Uit een databasekopie zijn dus geen bruikbare sessiecookies te
 * halen. De sleutel staat niet in de database.
 *
 * ## Twee vervaltijden
 *
 * `expiresAt` schuift mee met gebruik (inactiviteit), `absoluteExpiry` niet.
 * Zonder die tweede blijft een sessie die actief gehouden wordt eeuwig geldig,
 * en is een gestolen cookie een permanente sleutel.
 */

const SESSION_COOKIE = "nsr_session";
const IDLE_TIMEOUT_MINUTES = 30;
const ABSOLUTE_TIMEOUT_HOURS = 12;

/** Wie er handelt. Bevat bewust geen naam en geen e-mailadres. */
export interface Actor {
  readonly sessionId: string;
  readonly userId: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  /** Alle rollen van dit account. Rechten zijn de vereniging daarvan. */
  readonly roles: readonly Role[];
  readonly authLevel: AuthLevel;
  readonly depot: string;
}

function hashToken(token: string): string {
  return createHmac("sha256", config().SESSION_SECRET).update(token).digest("hex");
}

/**
 * Maakt een sessie aan en zet de cookie.
 *
 * Het token wordt hier gegenereerd en nergens bewaard: na deze functie bestaat
 * het alleen nog in de cookie van de gebruiker.
 */
export async function createSession(options: {
  userId: string;
  authLevel: AuthLevel;
  clientFingerprint: string | null;
}): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();

  await prisma.session.create({
    data: {
      userId: options.userId,
      tokenHash: hashToken(token),
      authLevel: options.authLevel,
      expiresAt: new Date(now + IDLE_TIMEOUT_MINUTES * 60_000),
      absoluteExpiry: new Date(now + ABSOLUTE_TIMEOUT_HOURS * 3_600_000),
      clientFingerprint: options.clientFingerprint,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Alleen over HTTPS in productie. In ontwikkeling draait de applicatie op
    // http://localhost en zou een secure cookie nooit teruggestuurd worden.
    secure: isProduction(),
    path: "/",
    // Geen maxAge: een sessiecookie verdwijnt bij het sluiten van de browser.
    // De echte levensduur staat in de database, waar hij intrekbaar is.
  });
}

/**
 * De huidige gebruiker, of null.
 *
 * Verlopen en ingetrokken sessies leveren null. De inactiviteitstermijn schuift
 * mee, maar nooit voorbij de absolute vervaltijd.
 *
 * ## Waarom hij gecachet is per verzoek
 *
 * Zowel de layout als de pagina heeft de gebruiker nodig, en elke aanroep leest
 * de sessie én werkt "lastSeenAt" bij. Zonder deze cache zou één
 * paginaweergave twee sessielezingen en twee schrijfacties opleveren. De
 * "cache" van React dedupliceert binnen één render; over verzoeken heen deelt
 * hij niets, dus een ingetrokken sessie werkt nog steeds onmiddellijk.
 *
 * ## Waarom de cookie búiten die cache wordt gelezen
 *
 * `cache()` van React hoort bij een render. Een routehandler rendert niets, en
 * daar bleek `cookies()` binnen die cache te stranden op "called outside a
 * request scope" — maar alleen in een productiebuild, want de ontwikkelserver
 * zet die grens anders. Het gevolg was dat in de draagbare versie álle vijf de
 * downloadroutes een 500 gaven terwijl dezelfde code op de ontwikkelserver
 * werkte, en de fout werd door de afhandeling ook nog stilgehouden. De cookie
 * wordt daarom hier gelezen, in de gewone verzoekcontext, en alleen het opzoeken
 * erna is gecachet — op het token, zodat de deduplicatie per verzoek blijft
 * werken.
 */
export async function currentActor(): Promise<Actor | null> {
  // Een routehandler heeft het token al meegegeven; zie `metSessieUitVerzoek`.
  const uitVerzoek = SESSIE_UIT_VERZOEK.getStore();
  if (uitVerzoek) {
    return actorVoorToken(uitVerzoek.token);
  }
  const store = await cookies();
  return actorVoorToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * De sessie van een routehandler, uit het verzoek dat hij zelf al heeft.
 *
 * In een productiebuild is `cookies()` binnen een routehandler niet bruikbaar:
 * hij stuit op "called outside a request scope", terwijl precies dezelfde code
 * in een pagina en op de ontwikkelserver wél werkt. Het gevolg was dat in de
 * draagbare versie álle downloadroutes een 500 gaven — het sjabloon, het
 * roosterblad, beide exports — en dat dit nergens opviel omdat de
 * ontwikkelserver ze wel bedient.
 *
 * Een routehandler krijgt het `Request`-object gewoon binnen, met de
 * cookieheader erin. Dat is de bron die hier wordt gebruikt. Er verandert
 * niets aan de controle zelf: het token gaat door dezelfde HMAC en dezelfde
 * sessieopzoeking, met dezelfde vervaltijden en dezelfde intrekking. Alleen de
 * weg waarlangs het token binnenkomt is expliciet gemaakt.
 */
const SESSIE_UIT_VERZOEK = new AsyncLocalStorage<{ readonly token: string | undefined }>();

export function metSessieUitVerzoek<T>(request: Request, handeling: () => Promise<T>): Promise<T> {
  return SESSIE_UIT_VERZOEK.run({ token: sessieCookie(request) }, handeling);
}

/** Het sessietoken uit de cookieheader van een verzoek. */
function sessieCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) {
    return undefined;
  }
  for (const deel of header.split(";")) {
    const scheiding = deel.indexOf("=");
    if (scheiding === -1) {
      continue;
    }
    if (deel.slice(0, scheiding).trim() === SESSION_COOKIE) {
      return decodeURIComponent(deel.slice(scheiding + 1).trim());
    }
  }
  return undefined;
}

const actorVoorToken = cache(async function actorVoorToken(
  token: string | undefined,
): Promise<Actor | null> {
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      authLevel: true,
      expiresAt: true,
      absoluteExpiry: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          roles: true,
          status: true,
          employee: { select: { id: true, employeeNumber: true, depot: true } },
        },
      },
    },
  });

  const now = new Date();
  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.absoluteExpiry <= now
  ) {
    return null;
  }

  // Een geblokkeerd of ingetrokken account verliest onmiddellijk toegang, ook
  // met een sessie die op zich nog geldig is. Dit is precies het gedrag dat een
  // JWT niet kan bieden.
  if (session.user.status !== AccountStatus.ACTIVE) {
    return null;
  }

  const slidTo = new Date(now.getTime() + IDLE_TIMEOUT_MINUTES * 60_000);
  const nextExpiry = slidTo > session.absoluteExpiry ? session.absoluteExpiry : slidTo;
  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: now, expiresAt: nextExpiry },
  });

  return {
    sessionId: session.id,
    userId: session.user.id,
    employeeId: session.user.employee.id,
    employeeNumber: session.user.employee.employeeNumber,
    roles: session.user.roles,
    authLevel: session.authLevel,
    depot: session.user.employee.depot,
  };
});

/** Trekt de huidige sessie in en verwijdert de cookie. */
export async function destroySession(reason = "uitgelogd"): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!token) {
    return;
  }
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Trekt alle sessies van een gebruiker in. Voor beheer en noodgevallen. */
export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

export const SESSION_POLICY = {
  cookieName: SESSION_COOKIE,
  idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
  absoluteTimeoutHours: ABSOLUTE_TIMEOUT_HOURS,
};
