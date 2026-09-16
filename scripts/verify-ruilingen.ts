import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { toCalendarDate } from "@/domain/time";
import { isStructuralAnchor } from "@/domain/roster-structure";

/**
 * Ruilingen, getoetst op wat er in de gegevens is achtergebleven.
 *
 * ## Waarom dit een controle op de uitkomst is en niet op de knop
 *
 * Of de knop werkt, ziet een mens meteen. Wat een mens níet ziet, is een ruil
 * die is doorgevoerd zonder dat de tweede toetsing is bewaard, een ruil waarbij
 * maar één van de twee roosters is bijgewerkt, of een rustdag die via een
 * dienstruil is verdwenen. Dat zijn de dingen die hier worden nagerekend.
 *
 * Draaien met: npm run verify:ruilingen
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

async function main(): Promise<void> {
  console.log("RUILINGEN");
  console.log("════════════════════════════════════════════════════════════");

  const alle = await prisma.swapProposal.findMany({
    include: {
      initiatorDuty: {
        select: { id: true, employeeId: true, date: true, positionType: true, dutyId: true },
      },
      counterpartyDuty: {
        select: { id: true, employeeId: true, date: true, positionType: true, dutyId: true },
      },
    },
  });
  console.log(`\n${alle.length} ruilvoorstellen in de gegevens.`);

  const uitgevoerd = alle.filter((voorstel) => voorstel.status === "ACCEPTED");
  console.log(`Waarvan uitgevoerd: ${uitgevoerd.length}\n`);

  // ── 1. Elke uitgevoerde ruil draagt zijn tweede toetsing ──────────────────
  const zonderToets = uitgevoerd.filter((voorstel) => !voorstel.acceptEvaluationId);
  toets(
    "elke uitgevoerde ruil heeft een bewaarde eindtoetsing",
    zonderToets.length === 0,
    `${zonderToets.length} ruilen zonder vastgelegde hertoetsing`,
  );

  // ── 2. Beide kanten zijn bijgewerkt ──────────────────────────────────────
  const halfUitgevoerd = uitgevoerd.filter(
    (voorstel) =>
      voorstel.initiatorDuty.dutyId === null || voorstel.counterpartyDuty.dutyId === null,
  );
  toets(
    "geen half uitgevoerde ruil",
    halfUitgevoerd.length === 0,
    `${halfUitgevoerd.length} ruilen waarbij één kant leeg bleef`,
  );

  // ── 3. Geen ruil over structurele ankers ─────────────────────────────────
  const overAnkers = alle.filter(
    (voorstel) =>
      isStructuralAnchor(voorstel.initiatorDuty.positionType) ||
      isStructuralAnchor(voorstel.counterpartyDuty.positionType),
  );
  toets(
    "geen enkel voorstel raakt een structureel anker",
    overAnkers.length === 0,
    `${overAnkers.length} voorstellen op een rust-, reserve-, WTV- of compensatiedag`,
  );

  // ── 4. Eén openstaand voorstel per roosterdag ────────────────────────────
  const openstaand = alle.filter((voorstel) => voorstel.status === "PENDING");
  const perDag = new Map<string, number>();
  for (const voorstel of openstaand) {
    for (const dag of [voorstel.initiatorDuty.id, voorstel.counterpartyDuty.id]) {
      perDag.set(dag, (perDag.get(dag) ?? 0) + 1);
    }
  }
  const dubbelGeclaimd = [...perDag.entries()].filter(([, aantal]) => aantal > 1);
  toets(
    "geen roosterdag zit in twee openstaande voorstellen tegelijk",
    dubbelGeclaimd.length === 0,
    `${dubbelGeclaimd.length} roosterdagen in meerdere voorstellen`,
  );

  // ── 5. Standplaats ───────────────────────────────────────────────────────
  const medewerkers = await prisma.employee.findMany({ select: { id: true, depot: true } });
  const depots = new Map(medewerkers.map((rij) => [rij.id, rij.depot]));
  const overStandplaatsen = alle.filter(
    (voorstel) =>
      depots.get(voorstel.initiatorEmployeeId) !== depots.get(voorstel.counterpartyEmployeeId),
  );
  toets(
    "geen ruil tussen twee standplaatsen",
    overStandplaatsen.length === 0,
    `${overStandplaatsen.length} voorstellen tussen verschillende standplaatsen`,
  );

  // ── 6. Afgehandelde voorstellen dragen een moment ────────────────────────
  const afgehandeldZonderMoment = alle.filter(
    (voorstel) => voorstel.status !== "PENDING" && voorstel.respondedAt === null,
  );
  toets(
    "elk afgehandeld voorstel heeft een afhandelmoment",
    afgehandeldZonderMoment.length === 0,
    `${afgehandeldZonderMoment.length} zonder tijdstip`,
  );

  // ── 7. Meldingen bij afgehandelde ruilen ─────────────────────────────────
  const meldingen = await prisma.notification.findMany({
    where: { entityType: "SwapRequest" },
    select: { entityId: true, recipientUserId: true },
  });
  const gemeld = new Set(meldingen.map((melding) => melding.entityId));
  const afgehandeld = alle.filter((voorstel) =>
    ["ACCEPTED", "REJECTED", "WITHDRAWN", "INVALIDATED"].includes(voorstel.status),
  );
  const zonderMelding = afgehandeld.filter((voorstel) => !gemeld.has(voorstel.id));
  toets(
    "elke afgehandelde ruil heeft een melding opgeleverd",
    zonderMelding.length === 0,
    `${zonderMelding.length} afgehandelde ruilen zonder melding` +
      (zonderMelding.length > 0
        ? " (ruilen van vóór het meldingensysteem tellen hier ook in mee)"
        : ""),
  );

  // ── 8. Statusverdeling, ter informatie ───────────────────────────────────
  const perStatus = new Map<string, number>();
  for (const voorstel of alle) {
    perStatus.set(voorstel.status, (perStatus.get(voorstel.status) ?? 0) + 1);
  }
  console.log(
    `\nStatusverdeling: ${[...perStatus.entries()]
      .map(([status, aantal]) => `${status}=${aantal}`)
      .join(", ") || "geen voorstellen"}`,
  );
  if (uitgevoerd.length > 0) {
    const voorbeeld = uitgevoerd[0];
    console.log(
      `Voorbeeld uitgevoerde ruil: ${toCalendarDate(voorbeeld.initiatorDuty.date)} ↔ ` +
        `${toCalendarDate(voorbeeld.counterpartyDuty.date)}`,
    );
  }

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
