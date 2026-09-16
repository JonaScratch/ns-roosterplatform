import "server-only";
import { SecurityEventKind } from "@/lib/generated/prisma/enums";
import { type Actor, currentActor } from "@/server/auth/session";
import { recordSecurityEvent } from "@/server/audit/log";
import { type Permission, rolesHavePermission } from "./permissions";

/**
 * Autorisatie aan de serverkant.
 *
 * ## De regel waar dit bestand voor bestaat
 *
 * Autorisatie gebeurt op de plek waar gegevens worden opgehaald, niet op de
 * plek waar ze worden getoond. Een pagina die een component verbergt, verbergt
 * niets voor wie de API rechtstreeks aanroept. Elke service in dit project
 * begint daarom met een `requirePermission`, en geen enkele repository voert
 * een query uit zonder dat er eerst een `Actor` is vastgesteld.
 *
 * De proxy (`src/proxy.ts`) doet een eerste, grove controle op basis van de
 * cookie. Die is er voor het gebruiksgemak — meteen naar het inlogscherm in
 * plaats van een lege pagina — en telt uitdrukkelijk niet als beveiliging.
 *
 * ## Rechten, niet rollen
 *
 * Ook hier staat nergens een rolvergelijking. `rolesHavePermission` slaat de
 * rollen van het account op tegen de rechtentabel; welke rol welk recht geeft,
 * staat op één plek.
 *
 * ## Waarom weigeringen worden vastgelegd
 *
 * Een geweigerd verzoek is een signaal. Eén per ongeluk is ruis; een reeks van
 * dezelfde gebruiker op andermans gegevens is iets anders. Zonder registratie
 * is dat verschil onzichtbaar.
 */

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Aanmelden is vereist.");
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Het gevraagde bestaat niet (meer).
 *
 * Een verworpen scenario, een verwijderd rooster, een oude link uit iemands
 * favorieten. Zonder dit onderscheid komt zoiets als 500 naar buiten — "Er is
 * iets misgegaan" met een foutcode, terwijl er niets mis is behalve de
 * verwijzing. Het verschil tussen "wij hebben een probleem" en "dit bestaat
 * niet" hoort de bezoeker te zien.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class AuthorizationError extends Error {
  constructor(
    public readonly permission: Permission | null,
    message = "U heeft geen toegang tot deze gegevens.",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** De ingelogde gebruiker, of een fout. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) {
    throw new AuthenticationRequiredError();
  }
  return actor;
}

/** De ingelogde gebruiker, mits hij dit recht heeft. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (!rolesHavePermission(actor.roles, permission)) {
    await recordSecurityEvent({
      kind: SecurityEventKind.AUTHORIZATION_DENIED,
      userId: actor.userId,
      subject: actor.employeeNumber,
      detail: { ontbrekendRecht: permission, rollen: actor.roles },
    });
    throw new AuthorizationError(permission);
  }
  return actor;
}

/**
 * De ingelogde gebruiker, mits hij minstens één van deze rechten heeft.
 *
 * Voor schermen die meerdere ingangen bedienen — een overzicht dat zowel de
 * Rooster Commissie als Dienstindeling mag zien, elk vanuit een ander recht.
 */
export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<Actor> {
  const actor = await requireActor();
  if (permissions.some((permission) => rolesHavePermission(actor.roles, permission))) {
    return actor;
  }
  await recordSecurityEvent({
    kind: SecurityEventKind.AUTHORIZATION_DENIED,
    userId: actor.userId,
    subject: actor.employeeNumber,
    detail: { ontbrekendeRechten: permissions, rollen: actor.roles },
  });
  throw new AuthorizationError(permissions[0] ?? null);
}

/** Heeft deze gebruiker dit recht? Zonder te gooien, voor het opbouwen van menu's. */
export function actorHasPermission(actor: Actor, permission: Permission): boolean {
  return rolesHavePermission(actor.roles, permission);
}

/**
 * Bevestigt dat het gevraagde over de gebruiker zelf gaat.
 *
 * Dit is de controle die URL-manipulatie afvangt. Een medewerker die
 * `/api/rooster?employeeId=...` van een collega aanroept, komt hier uit met een
 * andere identificatie dan zijn eigen, en de aanroep eindigt — ongeacht wat de
 * frontend deed of niet deed.
 */
export async function assertOwnEmployee(actor: Actor, employeeId: string): Promise<void> {
  if (actor.employeeId === employeeId) {
    return;
  }
  await recordSecurityEvent({
    kind: SecurityEventKind.AUTHORIZATION_DENIED,
    userId: actor.userId,
    subject: actor.employeeNumber,
    detail: { poging: "gegevens van een andere medewerker", objectId: employeeId },
  });
  throw new AuthorizationError(null, "U kunt alleen uw eigen gegevens opvragen.");
}

/**
 * Zelfde gegevens opvragen, maar met een uitweg voor wie ze wél mag zien.
 *
 * Dienstindeling met `schedule:read:any` mag het rooster van een ander
 * opvragen; een medewerker niet. Beide gevallen komen langs deze ene functie,
 * zodat er geen tweede route ontstaat waarin de controle vergeten wordt.
 */
export async function assertOwnEmployeeOrPermission(
  actor: Actor,
  employeeId: string,
  permission: Permission,
): Promise<void> {
  if (actor.employeeId === employeeId || rolesHavePermission(actor.roles, permission)) {
    return;
  }
  await recordSecurityEvent({
    kind: SecurityEventKind.AUTHORIZATION_DENIED,
    userId: actor.userId,
    subject: actor.employeeNumber,
    detail: { ontbrekendRecht: permission, objectId: employeeId },
  });
  throw new AuthorizationError(permission);
}

/**
 * Vertaalt een autorisatiefout naar iets dat een gebruiker te zien krijgt.
 *
 * Bewust karig: wie geen toegang heeft, hoort ook niet te horen wat er precies
 * bestaat. Het volledige verhaal staat in het beveiligingslog.
 */
export function toPublicError(error: unknown): { status: number; message: string } {
  if (error instanceof AuthenticationRequiredError) {
    return { status: 401, message: "Aanmelden is vereist." };
  }
  if (error instanceof AuthorizationError) {
    return { status: 403, message: "U heeft geen toegang tot deze gegevens." };
  }
  // De melding van een NotFoundError gaat wél mee naar buiten: hij zegt welk
  // ding niet bestaat, en dat is precies wat de bezoeker nodig heeft. Hij bevat
  // per constructie geen gegevens van anderen.
  if (error instanceof NotFoundError) {
    return { status: 404, message: error.message };
  }
  // Alles wat hier komt, is niet voorzien. De bezoeker hoort daar geen details
  // van te zien, maar het logboek wél: zonder deze regel gaf de draagbare
  // versie een 500 bij elke download met geen enkel spoor in de logs, en was de
  // enige manier om de oorzaak te vinden het naspelen van de productiebuild.
  console.error("Onverwachte fout in een route:", error);
  return { status: 500, message: "Er is iets misgegaan." };
}
