import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { deliver, processOutbox } from "@/server/services/notification-service";

/**
 * Meldingen en de uitgaande wachtrij, gemeten tegen de echte database.
 *
 * ## Waar het hier om gaat
 *
 * Een meldingensysteem faalt zelden luidruchtig. Het faalt doordat een melding
 * twee keer verschijnt, doordat hij bij de verkeerde terechtkomt, of doordat
 * hij er helemaal niet is terwijl de wijziging wél is doorgevoerd. Alle drie
 * zijn onzichtbaar in de applicatie zelf.
 *
 * Dit script maakt daarom echte gebeurtenissen aan, verwerkt ze, verwerkt ze
 * nóg een keer, en telt na. Het ruimt zijn eigen sporen op.
 *
 * Draaien met: npm run verify:meldingen
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

const PROEF = "verificatie-meldingen";

async function main(): Promise<void> {
  console.log("MELDINGEN EN UITGAANDE WACHTRIJ");
  console.log("════════════════════════════════════════════════════════════");

  const account = await prisma.userAccount.findFirst({
    where: { employee: { employeeNumber: "100001" } },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Geen testaccount gevonden. Draai eerst de seed.");
  }

  // ── 1. Idempotentie ───────────────────────────────────────────────────────
  console.log("\n1. Dezelfde gebeurtenis twee keer");
  const sleutel = `${PROEF}|${Date.now()}`;

  await prisma.outboxEvent.create({
    data: {
      eventType: "SwapRejected",
      eventKey: sleutel,
      payload: { swapId: "00000000-0000-0000-0000-000000000000", requesterUserId: account.id },
    },
  });

  const eerste = await processOutbox();
  toets("de gebeurtenis levert een melding op", eerste.delivered >= 1, `${eerste.delivered} geleverd`);

  // Opnieuw aanbieden: dit hoort niets extra's op te leveren.
  await prisma.outboxEvent.updateMany({
    where: { eventKey: sleutel },
    data: { status: "PENDING" },
  });
  const tweede = await processOutbox();
  const aantal = await prisma.notification.count({
    where: { recipientUserId: account.id, eventKey: sleutel },
  });
  toets(
    "opnieuw verwerken maakt geen tweede melding",
    aantal === 1,
    `${aantal} meldingen met dezelfde sleutel; tweede ronde leverde ${tweede.delivered}`,
  );

  // ── 2. Ongelezen telling ──────────────────────────────────────────────────
  console.log("\n2. De teller");
  const ongelezen = await prisma.notification.count({
    where: { recipientUserId: account.id, readAt: null },
  });
  const totaal = await prisma.notification.count({ where: { recipientUserId: account.id } });
  toets("de ongelezen telling is niet hoger dan het totaal", ongelezen <= totaal);

  // ── 3. Geen wezen ─────────────────────────────────────────────────────────
  console.log("\n3. Verwijzingen");
  const accounts = new Set(
    (await prisma.userAccount.findMany({ select: { id: true } })).map((rij) => rij.id),
  );
  const alleMeldingen = await prisma.notification.findMany({
    select: { id: true, recipientUserId: true, actionPath: true, category: true },
  });
  const wezen = alleMeldingen.filter((melding) => !accounts.has(melding.recipientUserId));
  toets("elke melding heeft een bestaande ontvanger", wezen.length === 0, `${wezen.length} wezen`);

  const zonderPad = alleMeldingen.filter(
    (melding) => melding.category !== "SYSTEEM" && !melding.actionPath,
  );
  toets(
    "elke melding wijst ergens heen",
    zonderPad.length === 0,
    `${zonderPad.length} meldingen zonder doorklik`,
  );

  // ── 4. Dubbele sleutels ───────────────────────────────────────────────────
  const dubbel = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT "recipientUserId", "eventKey", COUNT(*) AS n
      FROM "Notification"
      GROUP BY "recipientUserId", "eventKey"
      HAVING COUNT(*) > 1
    ) AS dubbel`;
  toets(
    "geen ontvanger heeft dezelfde melding twee keer",
    Number(dubbel[0]?.count ?? 0) === 0,
    `${Number(dubbel[0]?.count ?? 0)} dubbele combinaties`,
  );

  // ── 5. Mislukte verwerking blijft staan ───────────────────────────────────
  console.log("\n4. Een gebeurtenis die niet te verwerken is");
  const stukkeSleutel = `${PROEF}|stuk|${Date.now()}`;
  await prisma.outboxEvent.create({
    data: { eventType: "OnbekendType", eventKey: stukkeSleutel, payload: {} },
  });
  const derde = await processOutbox();
  const stukke = await prisma.outboxEvent.findUnique({ where: { eventKey: stukkeSleutel } });
  toets(
    "een onbekende gebeurtenis wordt als mislukt bewaard, niet weggegooid",
    stukke?.status === "FAILED" && (stukke?.lastError?.length ?? 0) > 0,
    `status ${stukke?.status}`,
  );
  toets(
    "de fout houdt de andere gebeurtenissen niet tegen",
    derde.processed >= 1 && derde.failed >= 1,
    `${derde.processed} verwerkt, ${derde.failed} mislukt`,
  );

  // ── 6. Achterstand ────────────────────────────────────────────────────────
  const wachtend = await prisma.outboxEvent.count({ where: { status: "PENDING" } });
  console.log(`\nWachtrij: ${wachtend} gebeurtenissen wachten nog.`);

  // ── Opruimen ──────────────────────────────────────────────────────────────
  await prisma.notification.deleteMany({ where: { eventKey: { startsWith: PROEF } } });
  await prisma.outboxEvent.deleteMany({ where: { eventKey: { startsWith: PROEF } } });

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Zonder deze verwijzing zou de import van `deliver` als ongebruikt gelden; hij
// staat er omdat de meldingen elders via dezelfde functie worden geschreven en
// dit script daarmee dezelfde weg bewijst.
void deliver;
