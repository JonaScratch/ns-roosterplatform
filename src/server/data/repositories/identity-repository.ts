import "server-only";
import { cache } from "react";
import { EmployeeStatus } from "@/lib/generated/prisma/enums";
import { type Actor, currentActor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { AuthorizationError, actorHasPermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "../prisma";

/**
 * De enige plek waar persoonsnamen uit de database komen.
 *
 * Alles wat naam of e-mailadres nodig heeft, loopt hierlangs. Dat maakt drie
 * dingen mogelijk die anders niet waar te maken zijn:
 *
 *  1. Elke inzage kan worden afgedwongen op recht.
 *  2. Elke inzage kan worden vastgelegd in het auditlog.
 *  3. De vraag "waar in deze applicatie worden namen gelezen?" is te
 *     beantwoorden door één bestand te lezen.
 *
 * De rest van de applicatie werkt op `employee_id` en personeelsnummer. Wie
 * elders een `displayName` tegenkomt, weet dat die hier vandaan moet zijn
 * gekomen.
 */

export interface IdentityView {
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly displayName: string;
}

/**
 * Namen bij personeelsnummers, voor wie daartoe bevoegd is.
 *
 * De inzage wordt gelogd met de nummers waarvan de naam is opgevraagd, niet met
 * de namen zelf: het auditlog hoort geen persoonsregister te worden.
 */
export async function identitiesFor(
  actor: Actor,
  employeeIds: readonly string[],
): Promise<ReadonlyMap<string, IdentityView>> {
  if (!actorHasPermission(actor, PERMISSIONS.IDENTITY_READ_ANY)) {
    throw new AuthorizationError(PERMISSIONS.IDENTITY_READ_ANY);
  }
  if (employeeIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.employeeIdentity.findMany({
    where: { employeeId: { in: [...employeeIds] } },
    select: {
      employeeId: true,
      displayName: true,
      employee: { select: { employeeNumber: true } },
    },
  });

  await recordAudit({
    actor,
    action: "persoonsgegevens.ingezien",
    objectType: "EmployeeIdentity",
    newValue: { aantal: rows.length, personeelsnummers: rows.map((r) => r.employee.employeeNumber) },
    reason: "naamweergave in planneroverzicht",
  });

  return new Map(
    rows.map((row) => [
      row.employeeId,
      {
        employeeId: row.employeeId,
        employeeNumber: row.employee.employeeNumber,
        displayName: row.displayName,
      },
    ]),
  );
}

/**
 * Een collega opzoeken om een ruil aan te bieden.
 *
 * Bewust smal gehouden:
 *
 *  - zoeken kan alleen op volledig personeelsnummer, niet op naamfragment;
 *  - alleen binnen de eigen standplaats;
 *  - alleen actieve medewerkers;
 *  - de uitkomst is één medewerker of niets, nooit een lijst.
 *
 * Daarmee is dit geen personeelszoeksysteem maar precies wat de ruilfunctie
 * nodig heeft: bevestigen dat het nummer dat iemand invoert bij de collega
 * hoort die hij bedoelt.
 */
export async function lookupColleague(
  actor: Actor,
  employeeNumber: string,
): Promise<IdentityView | null> {
  if (!actorHasPermission(actor, PERMISSIONS.COLLEAGUE_LOOKUP)) {
    throw new AuthorizationError(PERMISSIONS.COLLEAGUE_LOOKUP);
  }

  const row = await prisma.employee.findFirst({
    where: {
      employeeNumber,
      depot: actor.depot,
      status: EmployeeStatus.ACTIVE,
      NOT: { id: actor.employeeId },
    },
    select: { id: true, employeeNumber: true, identity: { select: { displayName: true } } },
  });

  await recordAudit({
    actor,
    action: "collega.opgezocht",
    objectType: "Employee",
    objectId: row?.id ?? null,
    newValue: { gezocht: employeeNumber, gevonden: row !== null },
  });

  if (!row) {
    return null;
  }
  return {
    employeeId: row.id,
    employeeNumber: row.employeeNumber,
    // Een medewerker zonder identiteitsrecord is roostertechnisch normaal;
    // dan is het personeelsnummer de weergave.
    displayName: row.identity?.displayName ?? row.employeeNumber,
  };
}

/**
 * De eigen naam van de ingelogde gebruiker.
 *
 * ## Waarom hier geen recht en geen auditregel bij hoort
 *
 * De andere functies in dit bestand lezen persoonsgegevens van *anderen*, en
 * dat is een inzage die je wilt afdwingen en vastleggen. Je eigen naam is iets
 * anders: die staat op je eigen scherm, je kende hem al, en elke paginaweergave
 * auditeren zou het logboek vullen met ruis die niets onthult.
 *
 * De grens blijft daarmee scherp: deze functie kan uitsluitend de naam van de
 * ingelogde gebruiker opleveren. Er is geen parameter om er een ander in te
 * stoppen.
 *
 * Gecachet per verzoek, want de kop staat op elke pagina.
 */
export const ownIdentity = cache(async function ownIdentity(): Promise<{
  readonly displayName: string;
  readonly firstName: string;
} | null> {
  const actor = await currentActor();
  if (!actor) {
    return null;
  }

  const row = await prisma.employeeIdentity.findUnique({
    where: { employeeId: actor.employeeId },
    select: { displayName: true },
  });
  if (!row) {
    return null;
  }

  return {
    displayName: row.displayName,
    firstName: row.displayName.split(" ")[0] ?? row.displayName,
  };
});
