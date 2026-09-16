import "server-only";
import type { Actor } from "@/server/auth/session";
import { recordSecurityEvent } from "@/server/audit/log";
import { actorHasPermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";

/**
 * Welke standplaats mag deze gebruiker zien?
 *
 * ## Waarom dit niet in het scherm zit
 *
 * De standplaatskeuze is een keuzelijst, en een keuzelijst is een suggestie.
 * Wie de URL aanpast, een oude link opent of een verzoek herhaalt met een
 * andere waarde, komt langs die lijst heen. Een planner van Dordrecht die per
 * ongeluk het rooster van Rotterdam ziet, is geen schoonheidsfout: hij ziet
 * dienstindelingen van collega's die hij niet hoort te zien, en hij kan erop
 * gaan sturen.
 *
 * De vraag "welke standplaats" wordt daarom hier beantwoord, op de server, uit
 * de sessie — en het antwoord op een verzoek dat daarbuiten valt is niet de
 * gevraagde standplaats maar de eigen.
 *
 * ## Wie mag wisselen
 *
 * Beheer, roostercommissie en dienstindeling. Een medewerker niet: die heeft
 * één standplaats en daar gaat zijn rooster over.
 *
 * Of een lid van de roostercommissie landelijk werkt of aan één standplaats
 * hangt, is niet uit de aangeleverde stukken op te maken. Zolang dat niet
 * vaststaat is wisselen toegestaan voor wie roosters beheert — dat is de
 * huidige werkwijze — en wordt elke wissel vastgelegd, zodat het later te zien
 * is als het anders blijkt te moeten.
 */

export interface LocationScope {
  /** De standplaats waarvoor de gegevens gelden. */
  readonly code: string;
  /** Mag deze gebruiker van standplaats wisselen? */
  readonly canSwitch: boolean;
  /** De standplaatsen waaruit gekozen kan worden. */
  readonly available: readonly { readonly code: string; readonly name: string; readonly enabled: boolean }[];
  /** Is er een andere standplaats gevraagd dan is toegekend? */
  readonly denied: string | null;
}

export function maySwitchLocation(actor: Actor): boolean {
  return (
    actorHasPermission(actor, PERMISSIONS.LOCATION_MANAGE) ||
    actorHasPermission(actor, PERMISSIONS.ROSTER_MANAGE) ||
    actorHasPermission(actor, PERMISSIONS.ASSIGNMENT_MANAGE)
  );
}

/**
 * Bepaalt de standplaats voor dit verzoek.
 *
 * `requested` komt uit de zoekparameters en is dus invoer van buiten: hij wordt
 * behandeld als een wens, niet als een gegeven.
 */
export async function locationScopeFor(
  actor: Actor,
  requested?: string | null,
): Promise<LocationScope> {
  const canSwitch = maySwitchLocation(actor);
  const gevraagd = requested?.trim().toUpperCase() || null;

  const locations = canSwitch
    ? await prisma.stationLocation.findMany({
        where: { active: true },
        select: { code: true, name: true, planningEnabled: true },
        orderBy: { code: "asc" },
      })
    : [];

  const available = locations.map((location) => ({
    code: location.code,
    name: location.name,
    enabled: location.planningEnabled,
  }));

  if (!gevraagd || gevraagd === actor.depot) {
    return { code: actor.depot, canSwitch, available, denied: null };
  }

  if (!canSwitch) {
    // Geen foutmelding met de naam van de gevraagde standplaats erin: die zou
    // bevestigen dat hij bestaat. De gebruiker krijgt gewoon zijn eigen gegevens.
    await recordSecurityEvent({
      kind: "AUTHORIZATION_DENIED",
      userId: actor.userId,
      subject: actor.employeeNumber,
      detail: { poging: "standplaatswissel", gevraagd, toegekend: actor.depot },
    });
    return { code: actor.depot, canSwitch, available, denied: gevraagd };
  }

  const bestaat = available.some((location) => location.code === gevraagd);
  if (!bestaat) {
    return { code: actor.depot, canSwitch, available, denied: gevraagd };
  }

  return { code: gevraagd, canSwitch, available, denied: null };
}

/**
 * De filterclausule voor een query op `depot`.
 *
 * Bedoeld om overal te gebruiken waar een lijst per standplaats hoort te zijn,
 * zodat het filter niet per query opnieuw wordt bedacht.
 */
export function depotFilter(scope: LocationScope | string): { depot: string } {
  return { depot: typeof scope === "string" ? scope : scope.code };
}
