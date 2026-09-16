import "server-only";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * De contactgegevens van de dienstindeling, per standplaats.
 *
 * ## Waarom er geen terugval bestaat
 *
 * Een medewerker die op "Contact Dienstindeling" klikt, verwacht bij zíjn
 * dienstindeling uit te komen. Zou het systeem bij een ontbrekend adres
 * terugvallen op dat van Dordrecht, dan mailt een Rotterdammer straks een
 * afdeling die niets met zijn dienst te maken heeft — en niets op het scherm
 * verraadt dat. Ontbreekt het adres, dan staat dat er.
 *
 * ## Waarom de standplaats uit de sessie komt
 *
 * Niet uit een zoekparameter. `?standplaats=RTD` mag het mailadres niet
 * veranderen: dat zou een manier zijn om een intern adres van een andere
 * standplaats op te vragen. De standplaats van de medewerker staat in zijn
 * account en nergens anders.
 *
 * ## Waarom de applicatie zelf niets verstuurt
 *
 * De knop opent een concept in Outlook. De medewerker leest wat er staat, past
 * het aan en verstuurt zelf. Een systeem dat namens iemand mailt, stuurt vroeg
 * of laat iets wat die persoon niet had willen sturen.
 */

export interface DidContact {
  readonly locationCode: string;
  readonly locationName: string;
  readonly configured: boolean;
  readonly email: string | null;
  /** Wat er op het scherm hoort te staan wanneer er geen adres is. */
  readonly notice: string | null;
  readonly subject: string;
  readonly body: string;
  /** Outlook op het web, met het concept al klaar. */
  readonly outlookUrl: string | null;
  /** Terugval voor wie geen Outlook-web heeft. */
  readonly mailtoUrl: string | null;
}

export const NO_CONTACT_NOTICE =
  "Contactgegevens Dienstindeling voor deze standplaats zijn nog niet ingericht.";

/**
 * Het contactvoorstel voor de ingelogde medewerker.
 *
 * De tekst is een sjabloon met lege velden. Er wordt niets ingevuld wat de
 * medewerker niet zelf zou opschrijven: geen roosterhistorie, geen reden van
 * afwezigheid, geen gegevens over anderen.
 */
export async function didContactForActor(): Promise<DidContact | null> {
  const actor = await currentActor();
  if (!actor) {
    return null;
  }

  const location = await prisma.stationLocation.findUnique({
    where: { code: actor.depot },
    select: { code: true, name: true, didContactEmail: true },
  });

  const code = location?.code ?? actor.depot;
  const name = location?.name ?? actor.depot;
  const email = location?.didContactEmail ?? null;

  const subject = `Roosterplatform – contact Dienstindeling ${name}`;
  const body = [
    "Naam:",
    `Personeelsnummer: ${actor.employeeNumber}`,
    "Datum:",
    "Betreft:",
    "",
    "",
  ].join("\n");

  if (!email) {
    return {
      locationCode: code,
      locationName: name,
      configured: false,
      email: null,
      notice: NO_CONTACT_NOTICE,
      subject,
      body,
      outlookUrl: null,
      mailtoUrl: null,
    };
  }

  return {
    locationCode: code,
    locationName: name,
    configured: true,
    email,
    notice: null,
    subject,
    body,
    outlookUrl: outlookComposeUrl(email, subject, body),
    mailtoUrl: mailtoUrl(email, subject, body),
  };
}

/**
 * Een conceptvenster in Outlook op het web.
 *
 * Opent een nieuw bericht met ontvanger, onderwerp en tekst ingevuld. Er wordt
 * niets verstuurd; de medewerker ziet het bericht en drukt zelf op verzenden.
 */
export function outlookComposeUrl(email: string, subject: string, body: string): string {
  const parameters = new URLSearchParams({ to: email, subject, body });
  return `https://outlook.office.com/mail/deeplink/compose?${parameters.toString()}`;
}

export function mailtoUrl(email: string, subject: string, body: string): string {
  const parameters = new URLSearchParams({ subject, body });
  return `mailto:${email}?${parameters.toString()}`;
}
