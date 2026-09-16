import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/server/data/prisma";
import { enqueueEvent, processOutbox } from "./notification-service";

/**
 * De brug van "er is iets gebeurd" naar "iemand hoort het te weten".
 *
 * ## Waarom hier zo weinig staat
 *
 * De services die roosters wijzigen, horen niet te weten hoe een melding eruit
 * ziet. Zij melden alleen wát er gebeurd is, binnen hun eigen transactie. Wat
 * daar vervolgens uit volgt — voor wie, in welke bewoording — staat in
 * `notification-service.ts`. Dat scheelt niet alleen rommel: het maakt het
 * mogelijk om later een kanaal toe te voegen zonder één regel in de ruil- of
 * dienstindelingcode aan te raken.
 *
 * ## Waarom het account-id hier wordt opgezocht
 *
 * Een gebeurtenis gaat over een medewerker; een melding gaat naar een account.
 * Niet elke medewerker heeft er een. Wie geen account heeft, krijgt geen
 * melding — en dat is geen fout die de ruil zelf mag tegenhouden.
 */

type Tx = Prisma.TransactionClient;

/** Het account bij een medewerker, of niets. */
export async function userIdFor(
  employeeId: string,
  client: Tx | typeof prisma = prisma,
): Promise<string | null> {
  const account = await client.userAccount.findUnique({
    where: { employeeId },
    select: { id: true },
  });
  return account?.id ?? null;
}

export async function userIdsFor(
  employeeIds: readonly string[],
  client: Tx | typeof prisma = prisma,
): Promise<Map<string, string>> {
  const accounts = await client.userAccount.findMany({
    where: { employeeId: { in: [...employeeIds] } },
    select: { id: true, employeeId: true },
  });
  return new Map(accounts.map((account) => [account.employeeId, account.id]));
}

/**
 * Legt een gebeurtenis vast binnen de transactie van de wijziging zelf.
 *
 * De naam is expliciet: wie hem buiten een transactie aanroept, ziet dat in de
 * aanroep terug.
 */
export async function publishInTransaction(
  tx: Tx,
  event: { eventType: string; eventKey: string; payload: Record<string, unknown> },
): Promise<void> {
  await enqueueEvent(tx, event);
}

/**
 * Verwerkt de wachtrij meteen na een geslaagde wijziging.
 *
 * Mislukt dat, dan blijft de gebeurtenis staan en pikt een volgende aanroep hem
 * op. De aanroeper hoeft er niet op te wachten en mag er niet op stukgaan: een
 * ruil die is doorgevoerd, hoort niet alsnog te falen omdat een melding niet
 * lukte.
 */
export async function flushNotifications(): Promise<void> {
  try {
    await processOutbox();
  } catch (error) {
    console.error("[meldingen] verwerken mislukt; de gebeurtenis blijft staan", error);
  }
}
