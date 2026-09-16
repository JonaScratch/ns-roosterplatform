import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy (in Next.js 16 de opvolger van middleware).
 *
 * Doet twee dingen, en met opzet niet meer:
 *
 *  1. Beveiligingsheaders op elk antwoord, met een verse nonce per verzoek.
 *  2. Wie geen sessiecookie heeft, meteen naar het aanmeldscherm sturen.
 *
 * ## Waarom punt 2 geen beveiliging is
 *
 * Hier wordt alleen gekeken óf er een cookie is, niet of hij ergens bij hoort.
 * Dat kan ook niet: de proxy draait vóór de applicatie en heeft geen database.
 * Een vervalste cookie komt er dus langs — en loopt vervolgens stuk op
 * `currentActor()`, dat de sessie wél opzoekt, en op de rechtencontrole in elke
 * service.
 *
 * Deze laag bestaat voor het gebruiksgemak: meteen het inlogscherm in plaats
 * van een pagina die halverwege omvalt. Wie hem als beveiliging gaat gebruiken,
 * bouwt een systeem waarin het vergeten van één `requirePermission` genoeg is.
 */

const PUBLIC_PATHS = ["/aanmelden"];

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const hasSessionCookie = request.cookies.has("nsr_session");

  if (!isPublic && !hasSessionCookie) {
    return withSecurityHeaders(
      NextResponse.redirect(new URL("/aanmelden", request.url)),
      csp,
    );
  }

  // De nonce moet ook de render in: Next.js leest hem uit deze header en zet
  // hem op de scripts die het framework zelf plaatst.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    csp,
  );
}

/**
 * Het beleid.
 *
 * `'strict-dynamic'` met een nonce is de sterke variant voor scripts: wat het
 * framework zelf plaatst mag draaien, alles wat een injectie erbij zou zetten
 * niet — ook niet vanaf een op het oog vertrouwd pad. In ontwikkeling komt
 * `'unsafe-eval'` erbij omdat React `eval` gebruikt voor betere foutmeldingen;
 * die uitzondering staat achter een controle op de omgeving.
 *
 * ## Waarom stijlen geen nonce krijgen
 *
 * De eerste versie zette dezelfde nonce op `style-src`, met `'unsafe-inline'`
 * ernaast voor ontwikkeling. De browser wees dat af, en terecht: zodra er een
 * nonce in `style-src` staat, negeert de specificatie `'unsafe-inline'`. Een
 * nonce kan bovendien nooit gelden voor een `style="..."`-attribuut, en dat is
 * precies wat React zet voor bijvoorbeeld de balkjes in het feedbackoverzicht.
 * Het gevolg was een console vol geblokkeerde stijlen — in ontwikkeling
 * zichtbaar, in productie precies hetzelfde en dan met kapotte weergave.
 *
 * De afweging: scriptinjectie is de aanval waar dit beleid voor bestaat, en
 * daar blijft het streng. Voor stijlen weegt een werkende interface zwaarder
 * dan het restrisico van CSS-injectie, dat pas betekenis krijgt als er al een
 * injectiepunt is — en dat punt sluit `script-src` af.
 */
function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  const headers = response.headers;
  headers.set("Content-Security-Policy", csp);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  // Een interne toepassing hoort niet in een zoekindex, ook niet wanneer een
  // omgeving onbedoeld bereikbaar is vanaf internet.
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  // Publieke, statische bestanden uit `public/` — met name het beeldmerk —
  // moeten al zichtbaar zijn vóórdat iemand is aangemeld: het aanmeldscherm
  // toont het beeldmerk zelf. Zonder deze uitzondering liep zo'n verzoek via
  // deze proxy, zag geen sessiecookie, en kreeg de omleiding naar
  // /aanmelden terug in plaats van het bestand — een kapot logo op precies
  // het scherm dat het moet tonen, en alleen zichtbaar voor wie nog geen
  // sessiecookie heeft (dus bij de allereerste bezoeker, niet bij wie al
  // eerder was aangemeld op dezelfde browser).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
