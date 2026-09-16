import "server-only";
import { randomUUID } from "node:crypto";
import { AuditResult, type SecurityEventKind } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/server/data/prisma";
import { toJson, toJsonOrOmit } from "@/server/data/json";
import type { Actor } from "@/server/auth/session";
import { redactForAudit } from "./redact";

/**
 * Het auditlog.
 *
 * Elke gevoelige actie komt hier langs. "Gevoelig" is in dit platform: alles
 * wat een rooster wijzigt, alles wat een dienst toewijst, elke inzage in
 * persoonsgegevens, en elke poging die is geweigerd.
 *
 * ## Weigeringen worden ook gelogd
 *
 * Een auditlog dat alleen geslaagde acties bevat, laat precies het interessante
 * weg. Een medewerker die het rooster van een ander probeert op te vragen, is
 * een gebeurtenis — of hij nu slaagt of niet. Daarom heeft elke regel een
 * `result`, en is DENIED een normale uitkomst.
 *
 * ## Het log faalt zacht, maar niet stil
 *
 * Wanneer het wegschrijven van een auditregel mislukt, mag dat de handeling
 * zelf niet omvergooien — een medewerker die zijn rooster bekijkt hoort geen
 * foutmelding te krijgen omdat het logboek klemzit. De fout gaat wel naar de
 * serverlog, waar hij opvalt.
 *
 * Voor handelingen waarbij het log zwaarder weegt dan de handeling bestaat
 * `recordAuditStrict`, die wél gooit. Die hoort in dezelfde transactie te
 * draaien als de wijziging waar hij bij hoort.
 */

export interface AuditInput {
  /** Null bij handelingen zonder ingelogde gebruiker, zoals een mislukte login. */
  readonly actor: Actor | null;
  /** Werkwoordvorm, bijvoorbeeld "rooster.gewijzigd" of "ruil.geaccepteerd". */
  readonly action: string;
  readonly objectType: string;
  readonly objectId?: string | null;
  readonly result?: AuditResult;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
  readonly correlationId?: string;
  readonly clientFingerprint?: string | null;
  readonly reason?: string;
}

function toRow(input: AuditInput) {
  return {
    actorUserId: input.actor?.userId ?? null,
    actorEmployeeNumber: input.actor?.employeeNumber ?? null,
    actorRoles: [...(input.actor?.roles ?? [])],
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId ?? null,
    result: input.result ?? AuditResult.SUCCESS,
    oldValue: toJsonOrOmit(redactForAudit(input.oldValue)),
    newValue: toJsonOrOmit(redactForAudit(input.newValue)),
    correlationId: input.correlationId ?? null,
    clientFingerprint: input.clientFingerprint ?? null,
    reason: input.reason ?? null,
  };
}

/** Schrijft een auditregel. Faalt zacht. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLogEntry.create({ data: toRow(input) });
  } catch (error) {
    console.error("[audit] wegschrijven mislukt", {
      action: input.action,
      objectType: input.objectType,
      error,
    });
  }
}

/**
 * Schrijft een auditregel en gooit wanneer dat niet lukt.
 *
 * Te gebruiken binnen de transactie van de wijziging zelf: als de wijziging
 * doorgaat maar het spoor ontbreekt, is er een wijziging zonder verantwoording.
 * Bij dit soort acties is dat erger dan de wijziging niet doen.
 */
export async function recordAuditStrict(
  input: AuditInput,
  tx: Pick<Prisma.TransactionClient, "auditLogEntry"> = prisma,
): Promise<void> {
  await tx.auditLogEntry.create({ data: toRow(input) });
}

/** Een identificatie om meerdere logregels van één verrichting te verbinden. */
export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Beveiligingsgebeurtenissen.
 *
 * Apart van het functionele auditlog: andere bewaartermijn, ander publiek, en
 * een ander soort vraag ("wordt hier iets geprobeerd?" in plaats van "wie heeft
 * dit gewijzigd?").
 */
export async function recordSecurityEvent(input: {
  readonly kind: SecurityEventKind;
  readonly userId?: string | null;
  /** Waar het om ging, bijvoorbeeld een personeelsnummer. Nooit een wachtwoord. */
  readonly subject?: string | null;
  readonly detail?: Record<string, unknown>;
  readonly clientFingerprint?: string | null;
}): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        kind: input.kind,
        userId: input.userId ?? null,
        subject: input.subject ?? null,
        detail: toJson(redactForAudit(input.detail ?? {})),
        clientFingerprint: input.clientFingerprint ?? null,
      },
    });
  } catch (error) {
    console.error("[security] wegschrijven mislukt", { kind: input.kind, error });
  }
}
