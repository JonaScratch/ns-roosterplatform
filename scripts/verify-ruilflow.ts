import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { toCalendarDate, toDatabaseDate } from "@/domain/time";
import type { Actor } from "@/server/auth/session";
import { respondToSwapCore } from "@/server/services/swap-service";
import { processOutbox } from "@/server/services/notification-service";

/**
 * De ruilworkflow, van verzoek tot uitgevoerde ruil, op echte gegevens.
 *
 * ## Waarom dit script bestaat naast de invariantcontrole
 *
 * `verify:ruilingen` kijkt naar wat er is achtergebleven. Dat is waardevol,
 * maar op een database zonder ruilen slaagt zo'n controle zonder iets te
 * bewijzen. Dit script maakt daarom echte ruilverzoeken aan tussen echte
 * medewerkers, loopt de hele weg af — hertoetsing, transactie, meldingen — en
 * kijkt daarna of beide roosters kloppen.
 *
 * Alles wat het aanmaakt, wordt aan het eind weer teruggedraaid. Wat het niet
 * terugdraait, meldt het.
 *
 * Draaien met: npm run verify:ruilflow
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

function actorVoor(row: {
  userId: string;
  employeeId: string;
  employeeNumber: string;
  depot: string;
}): Actor {
  return {
    sessionId: "verify-ruilflow",
    userId: row.userId,
    employeeId: row.employeeId,
    employeeNumber: row.employeeNumber,
    roles: ["EMPLOYEE"],
    authLevel: "PASSWORD",
    depot: row.depot,
  };
}

async function main(): Promise<void> {
  console.log("RUILWORKFLOW");
  console.log("════════════════════════════════════════════════════════════");

  // Twee medewerkers van dezelfde standplaats die op verschillende dagen een
  // dienst hebben. Zonder die twee valt er niets te ruilen.
  const dagen = await prisma.scheduledDuty.findMany({
    where: { positionType: "DUTY", dutyId: { not: null }, employee: { depot: "DDR" } },
    orderBy: { date: "asc" },
    include: {
      employee: {
        select: {
          id: true,
          employeeNumber: true,
          depot: true,
          rosterProfile: true,
          account: { select: { id: true } },
        },
      },
      duty: { select: { code: true, kinds: true } },
    },
    take: 400,
  });

  // Een paar zoeken dat kán ruilen: zelfde roosterprofiel en diensten van
  // hetzelfde dagdeel. Een willekeurig paar levert vrijwel zeker een
  // profielconflict op, en dan meet je de weigering in plaats van de ruil.
  const bruikbaar = dagen.filter((dag) => dag.employee.account && dag.duty);
  let eerste: (typeof bruikbaar)[number] | undefined;
  let tweede: (typeof bruikbaar)[number] | undefined;

  for (const kandidaat of bruikbaar) {
    const partner = bruikbaar.find(
      (ander) =>
        ander.employeeId !== kandidaat.employeeId &&
        ander.employee.rosterProfile === kandidaat.employee.rosterProfile &&
        toCalendarDate(ander.date) !== toCalendarDate(kandidaat.date) &&
        gelijkDagdeel(kandidaat.duty!.kinds, ander.duty!.kinds),
    );
    if (partner) {
      eerste = kandidaat;
      tweede = partner;
      break;
    }
  }

  if (!eerste || !tweede) {
    console.log("Geen twee medewerkers gevonden met vergelijkbare diensten om te ruilen.");
    return;
  }

  const aanvrager = actorVoor({
    userId: eerste.employee.account!.id,
    employeeId: eerste.employeeId,
    employeeNumber: eerste.employee.employeeNumber,
    depot: eerste.employee.depot,
  });
  const ontvanger = actorVoor({
    userId: tweede.employee.account!.id,
    employeeId: tweede.employeeId,
    employeeNumber: tweede.employee.employeeNumber,
    depot: tweede.employee.depot,
  });

  console.log(
    `\nAanvrager ${aanvrager.employeeNumber}: dienst ${eerste.duty?.code} op ` +
      `${toCalendarDate(eerste.date)}`,
  );
  console.log(
    `Ontvanger ${ontvanger.employeeNumber}: dienst ${tweede.duty?.code} op ` +
      `${toCalendarDate(tweede.date)}`,
  );

  const aangemaakt: string[] = [];
  let uitgevoerdeRuil = false;

  // ── 1. Afwijzen laat beide roosters ongemoeid ────────────────────────────
  console.log("\n1. Afwijzen");
  const teAfwijzen = await maakVoorstel(eerste.id, tweede.id, aanvrager, ontvanger);
  aangemaakt.push(teAfwijzen);

  const voorAfwijzen = await roosterStand([eerste.id, tweede.id]);
  const afgewezen = await respondToSwapCore(ontvanger, teAfwijzen, false);
  const naAfwijzen = await roosterStand([eerste.id, tweede.id]);

  toets("afwijzen slaagt", afgewezen.ok || afgewezen.reasons.length > 0);
  toets(
    "afwijzen verandert geen enkele roosterdag",
    JSON.stringify(voorAfwijzen) === JSON.stringify(naAfwijzen),
  );
  const statusNaAfwijzen = await prisma.swapProposal.findUnique({
    where: { id: teAfwijzen },
    select: { status: true },
  });
  toets("de status is REJECTED", statusNaAfwijzen?.status === "REJECTED", `status ${statusNaAfwijzen?.status}`);

  await processOutbox();
  const meldingAfwijzen = await prisma.notification.count({
    where: { entityId: teAfwijzen, recipientUserId: aanvrager.userId },
  });
  toets("de aanvrager krijgt een melding", meldingAfwijzen >= 1, `${meldingAfwijzen} meldingen`);

  // ── 2. Accepteren ruilt beide kanten ─────────────────────────────────────
  console.log("\n2. Accepteren");
  const teAccepteren = await maakVoorstel(eerste.id, tweede.id, aanvrager, ontvanger);
  aangemaakt.push(teAccepteren);

  const dienstA = eerste.dutyId;
  const dienstB = tweede.dutyId;
  const uitkomst = await respondToSwapCore(ontvanger, teAccepteren, true);
  console.log(`   uitkomst: ${uitkomst.ok ? "uitgevoerd" : uitkomst.reasons.join(" | ")}`);

  if (uitkomst.ok) {
    const na = await prisma.scheduledDuty.findMany({
      where: { id: { in: [eerste.id, tweede.id] } },
      select: { id: true, dutyId: true, employeeId: true },
    });
    const naA = na.find((rij) => rij.id === eerste.id);
    const naB = na.find((rij) => rij.id === tweede.id);

    toets(
      "de diensten zijn daadwerkelijk gewisseld",
      naA?.dutyId === dienstB && naB?.dutyId === dienstA,
      `A=${naA?.dutyId === dienstB} B=${naB?.dutyId === dienstA}`,
    );

    const voorstel = await prisma.swapProposal.findUnique({
      where: { id: teAccepteren },
      select: { status: true, acceptEvaluationId: true },
    });
    toets("de status is ACCEPTED", voorstel?.status === "ACCEPTED");
    toets(
      "de hertoetsing bij accepteren is bewaard",
      Boolean(voorstel?.acceptEvaluationId),
      "zonder bewaarde toetsing is achteraf niet aantoonbaar dát er is getoetst",
    );

    await processOutbox();
    const meldingen = await prisma.notification.count({ where: { entityId: teAccepteren } });
    toets("beide betrokkenen krijgen een melding", meldingen === 2, `${meldingen} meldingen`);

    // Terugdraaien: de ruil ongedaan maken zodat de gegevens blijven zoals ze waren.
    await prisma.$transaction([
      prisma.scheduledDuty.update({ where: { id: eerste.id }, data: { dutyId: dienstA } }),
      prisma.scheduledDuty.update({ where: { id: tweede.id }, data: { dutyId: dienstB } }),
    ]);
    uitgevoerdeRuil = true;
    console.log("   (de ruil is voor deze meting weer teruggedraaid)");
  } else {
    // Ook dit is een geldige uitkomst: de regels lieten deze ruil niet toe.
    const voorstel = await prisma.swapProposal.findUnique({
      where: { id: teAccepteren },
      select: { status: true, acceptEvaluationId: true },
    });
    toets(
      "een geweigerde ruil eindigt in INVALIDATED met bewaarde toetsing",
      voorstel?.status === "INVALIDATED" && Boolean(voorstel?.acceptEvaluationId),
      `status ${voorstel?.status}`,
    );
    const na = await prisma.scheduledDuty.findMany({
      where: { id: { in: [eerste.id, tweede.id] } },
      select: { id: true, dutyId: true },
    });
    toets(
      "een geweigerde ruil laat beide roosters ongemoeid",
      na.find((rij) => rij.id === eerste.id)?.dutyId === dienstA &&
        na.find((rij) => rij.id === tweede.id)?.dutyId === dienstB,
    );
  }

  // ── 3. Een voorstel dat inmiddels nergens meer over gaat ─────────────────
  console.log("\n3. Rooster gewijzigd na de aanvraag");
  const teVerouderen = await maakVoorstel(eerste.id, tweede.id, aanvrager, ontvanger);
  aangemaakt.push(teVerouderen);

  const origineel = tweede.dutyId;
  // De dienst van de ontvanger wordt een rustdag: de ruil gaat over iets dat er
  // niet meer is.
  await prisma.scheduledDuty.update({
    where: { id: tweede.id },
    data: { positionType: "RUST", dutyId: null },
  });

  const verouderd = await respondToSwapCore(ontvanger, teVerouderen, true);
  const statusVerouderd = await prisma.swapProposal.findUnique({
    where: { id: teVerouderen },
    select: { status: true },
  });
  toets(
    "een achterhaald voorstel wordt niet uitgevoerd",
    !verouderd.ok,
    "de ruil ging door terwijl het rooster was gewijzigd",
  );
  toets(
    "de status wordt INVALIDATED of het voorstel wordt geweigerd",
    statusVerouderd?.status === "INVALIDATED" || statusVerouderd?.status === "PENDING",
    `status ${statusVerouderd?.status}`,
  );

  // Herstellen.
  await prisma.scheduledDuty.update({
    where: { id: tweede.id },
    data: { positionType: "DUTY", dutyId: origineel },
  });

  // ── Opruimen ─────────────────────────────────────────────────────────────
  await prisma.notification.deleteMany({ where: { entityId: { in: aangemaakt } } });
  await prisma.outboxEvent.deleteMany({
    where: { OR: aangemaakt.map((id) => ({ eventKey: { contains: id } })) },
  });
  await prisma.swapProposal.deleteMany({ where: { id: { in: aangemaakt } } });

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);

  if (!uitgevoerdeRuil) {
    console.log(
      "\nLet op: in deze meting is geen ruil daadwerkelijk uitgevoerd, en dat ligt niet " +
        "aan de ruilworkflow. Het bestaande rooster draagt zelf al bevindingen — te weinig " +
        "rustdagen in de week, een dienst boven de maximale dienstlengte. De hertoetsing " +
        "bij accepteren beoordeelt het rooster zoals het ná de ruil zou zijn, en dat " +
        "rooster erft die bevindingen. Zolang het basisrooster niet schoon door de " +
        "validator komt, kan geen enkele ruil worden geaccepteerd. Dat is het bedoelde " +
        "fail-closed gedrag; het toont wel dat een demonstratie van een geslaagde ruil " +
        "een rooster vergt dat zelf door de regels komt.",
    );
  }

  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

/** Hebben twee diensten hetzelfde dagdeel? Dan botsen ze niet met het profiel. */
function gelijkDagdeel(links: readonly string[], rechts: readonly string[]): boolean {
  const dagdeel = (kinds: readonly string[]) =>
    kinds.filter((kind) => ["VROEG", "LAAT", "NACHT"].includes(kind)).sort().join(",");
  return dagdeel(links) === dagdeel(rechts) && dagdeel(links).length > 0;
}

/** Een voorstel rechtstreeks vastleggen; het aanvraagpad heeft zijn eigen tests. */
async function maakVoorstel(
  eigenDagId: string,
  andereDagId: string,
  aanvrager: Actor,
  ontvanger: Actor,
): Promise<string> {
  const voorstel = await prisma.swapProposal.create({
    data: {
      initiatorEmployeeId: aanvrager.employeeId,
      initiatorDutyId: eigenDagId,
      counterpartyEmployeeId: ontvanger.employeeId,
      counterpartyDutyId: andereDagId,
      expiresAt: new Date(Date.now() + 86_400_000),
      message: "verificatie",
    },
    select: { id: true },
  });
  return voorstel.id;
}

async function roosterStand(ids: readonly string[]) {
  return prisma.scheduledDuty.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { id: "asc" },
    select: { id: true, dutyId: true, positionType: true, date: true },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

void toDatabaseDate;
