import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { RosterPositionType, SwapListingStatus, SwapStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/server/auth/session";
import {
  claimListingCore,
  listingMatchesCore,
  marketplaceListingsCore,
  publishListingCore,
  withdrawListingCore,
} from "@/server/services/ruilmarkt-service";

/**
 * De ruilmarkt: een dienst aanbieden zonder vooraf een collega te kiezen.
 *
 * ## Wat dit script wil bewijzen
 *
 * 1. Alleen een concrete eigen dienst mag worden aangeboden — geen R, RES,
 *    WTV, CO of CAO-dag, en nooit andermans dienst.
 *    "Al open" is een gewone weigering, geen crash — dezelfde les als de
 *    CAO-dagenfix: een unieke sleutel die te veel afdwingt, geeft een
 *    onafgevangen databasefout, geen nette boodschap.
 * 2. De markt is afgebakend tot de eigen standplaats en toont nooit de eigen
 *    aanbiedingen aan de aanbieder zelf.
 * 3. Wie op zijn eigen aanbieding klikt, komt nergens — niet bij de
 *    berekening en niet bij het claimen.
 * 4. Een geldig geclaimde aanbieding wordt een gewoon `SwapProposal`, met deze
 *    aanbieding als herkomst — geen tweede uitvoeringspad.
 * 5. Intrekken kan alleen door de aanbieder, alleen zolang de aanbieding nog
 *    open staat; daarna is claimen niet meer mogelijk.
 * 6. Twee gelijktijdige acceptaties van dezelfde aanbieding: precies één mag
 *    winnen. Dit is de kern van `respondToSwapCore`'s nieuwe grendel, hier
 *    rechtstreeks getoetst op databaseniveau — deterministisch, niet
 *    afhankelijk van of het onderliggende rooster zelf schoon genoeg is om
 *    een ruil goed te keuren (zie de kanttekening in `verify-ruilflow.ts`).
 *
 * Alles wat dit script aanmaakt, draait het aan het eind terug.
 *
 * Draaien met: npm run verify:ruilmarkt
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

let geslaagd = 0;
let mislukt = 0;
let geblokkeerd = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function blokkade(naam: string, toelichting: string): void {
  geblokkeerd += 1;
  console.log(`  ⊘ ${naam} — ${toelichting}`);
}

function actorVoor(row: {
  userId: string;
  employeeId: string;
  employeeNumber: string;
  depot: string;
}): Actor {
  return {
    sessionId: "verify-ruilmarkt",
    userId: row.userId,
    employeeId: row.employeeId,
    employeeNumber: row.employeeNumber,
    roles: ["EMPLOYEE"],
    authLevel: "PASSWORD",
    depot: row.depot,
  };
}

async function main(): Promise<void> {
  console.log("RUILMARKT");
  console.log("═".repeat(66));

  // Twee medewerkers van dezelfde standplaats, allebei met een concrete
  // toekomstige dienst — zonder dat valt er niets aan te bieden.
  const kandidaten = await prisma.scheduledDuty.findMany({
    where: {
      positionType: RosterPositionType.DUTY,
      dutyId: { not: null },
      date: { gte: new Date() },
      employee: { depot: "DDR", account: { isNot: null } },
    },
    orderBy: { date: "asc" },
    take: 400,
    include: {
      employee: {
        select: { id: true, employeeNumber: true, depot: true, account: { select: { id: true } } },
      },
    },
  });

  const perMedewerker = new Map<string, (typeof kandidaten)[number][]>();
  for (const rij of kandidaten) {
    const lijst = perMedewerker.get(rij.employeeId) ?? [];
    lijst.push(rij);
    perMedewerker.set(rij.employeeId, lijst);
  }
  const medewerkersMetDienst = [...perMedewerker.entries()].filter(([, lijst]) => lijst.length > 0);

  if (medewerkersMetDienst.length < 2) {
    blokkade(
      "twee medewerkers met een toekomstige dienst",
      "BLOCKED_BY_MISSING_DATA. Draai eerst npm run db:seed.",
    );
    afsluiten();
    return;
  }

  const [, aDiensten] = medewerkersMetDienst[0];
  const [, bDiensten] = medewerkersMetDienst[1];
  const aanbiederRij = aDiensten[0].employee;
  const nemerRij = bDiensten[0].employee;
  const aanbieder = actorVoor({
    userId: aanbiederRij.account!.id,
    employeeId: aanbiederRij.id,
    employeeNumber: aanbiederRij.employeeNumber,
    depot: aanbiederRij.depot,
  });
  const nemer = actorVoor({
    userId: nemerRij.account!.id,
    employeeId: nemerRij.id,
    employeeNumber: nemerRij.employeeNumber,
    depot: nemerRij.depot,
  });
  const aangebodenDienst = aDiensten[0];

  console.log(
    `\nAanbieder ${aanbieder.employeeNumber}: dienst op ${aangebodenDienst.date.toISOString().slice(0, 10)}`,
  );
  console.log(`Mogelijke nemer ${nemer.employeeNumber} (zelfde standplaats)\n`);

  const aangemaakteListings: string[] = [];
  const aangemaakteVoorstellen: string[] = [];

  try {
    // ── 1. Alleen een concrete eigen dienst ─────────────────────────────────
    console.log("1. Wat wel en niet aangeboden mag worden");

    const nietEenDienst = await prisma.scheduledDuty.findFirst({
      where: {
        employeeId: aanbieder.employeeId,
        positionType: { not: RosterPositionType.DUTY },
      },
      select: { id: true, positionType: true },
    });
    if (nietEenDienst) {
      const poging = await publishListingCore(aanbieder, {
        scheduledDutyId: nietEenDienst.id,
        preference: "NONE",
      });
      toets(
        `een ${nietEenDienst.positionType}-dag kan niet worden aangeboden`,
        !poging.ok,
        "een niet-concrete dag werd geaccepteerd",
      );
    } else {
      blokkade(
        "een niet-concrete dag om te weigeren",
        "BLOCKED_BY_MISSING_DATA. Geen R/RES/WTV-dag gevonden bij deze medewerker.",
      );
    }

    const andermansDienst = bDiensten[0];
    const vreemdePoging = await publishListingCore(aanbieder, {
      scheduledDutyId: andermansDienst.id,
      preference: "NONE",
    });
    toets("andermans dienst kan niet worden aangeboden", !vreemdePoging.ok);

    // ── 2. Publiceren ────────────────────────────────────────────────────────
    console.log("\n2. Publiceren");

    const publicatie = await publishListingCore(aanbieder, {
      scheduledDutyId: aangebodenDienst.id,
      preference: "EARLIER",
    });
    toets("de eigen dienst wordt geaccepteerd", publicatie.ok, publicatie.reason ?? "");
    if (!publicatie.ok || !publicatie.id) {
      throw new Error("Zonder geplaatste aanbieding valt de rest niet te meten.");
    }
    aangemaakteListings.push(publicatie.id);
    const listingId = publicatie.id;

    const dubbeleAanbieding = await publishListingCore(aanbieder, {
      scheduledDutyId: aangebodenDienst.id,
      preference: "NONE",
    });
    toets(
      "dezelfde dienst kan niet twee keer tegelijk open staan — geen databasefout, een nette weigering",
      !dubbeleAanbieding.ok,
    );

    // ── 3. Zichtbaarheid en afbakening ───────────────────────────────────────
    console.log("\n3. Zichtbaarheid");

    const marktVoorNemer = await marketplaceListingsCore(nemer);
    toets(
      "de aanbieding staat in de markt voor een collega van dezelfde standplaats",
      marktVoorNemer.some((rij) => rij.id === listingId),
    );

    const marktVoorAanbieder = await marketplaceListingsCore(aanbieder);
    toets(
      "de aanbieder ziet zijn eigen aanbieding niet in de markt",
      !marktVoorAanbieder.some((rij) => rij.id === listingId),
    );

    // ── 4. Eigen aanbieding ──────────────────────────────────────────────────
    console.log("\n4. Eigen aanbieding");

    const eigenBerekening = await listingMatchesCore(aanbieder, listingId);
    toets(
      "de aanbieder kan zijn eigen aanbieding niet doorrekenen",
      !eigenBerekening.ok,
      eigenBerekening.reason ?? "",
    );

    const eigenClaim = await claimListingCore(aanbieder, {
      listingId,
      ownScheduledDutyId: aangebodenDienst.id,
    });
    toets("de aanbieder kan zijn eigen aanbieding niet claimen", !eigenClaim.created);

    // ── 5. Matching ──────────────────────────────────────────────────────────
    console.log("\n5. Matching");

    const berekening = await listingMatchesCore(nemer, listingId);
    toets("de berekening zelf slaagt", berekening.ok, berekening.reason ?? "");

    if (berekening.matches.length === 0) {
      blokkade(
        "een geldige tegenpartij om te claimen",
        "BLOCKED_BY_MISSING_DATA. Geen van de toekomstige diensten van de tweede " +
          "medewerker levert een door de rules engine goedgekeurde ruil op met het " +
          "huidige rooster. Dit is dezelfde beperking als in verify-ruilflow.ts.",
      );
    } else {
      const gekozen = berekening.matches[0];
      const claim = await claimListingCore(nemer, {
        listingId,
        ownScheduledDutyId: gekozen.scheduledDutyId,
      });
      toets("een geldige tegenpartij kan de aanbieding claimen", claim.created, claim.reasons.join("; "));

      if (claim.created) {
        const voorstel = await prisma.swapProposal.findFirst({
          where: { listingId, initiatorEmployeeId: nemer.employeeId },
          select: { id: true, status: true, counterpartyEmployeeId: true },
        });
        toets(
          "het claimen levert een gewoon SwapProposal op, met deze aanbieding als herkomst",
          voorstel !== null,
        );
        if (voorstel) {
          aangemaakteVoorstellen.push(voorstel.id);
          toets("het voorstel staat op PENDING", voorstel.status === SwapStatus.PENDING);
          toets(
            "de aanbieder is de tegenpartij die moet beantwoorden",
            voorstel.counterpartyEmployeeId === aanbieder.employeeId,
          );
        }
      }
    }

    // ── 6. Intrekken ─────────────────────────────────────────────────────────
    console.log("\n6. Intrekken");

    const intrekkenDoorAnder = await withdrawListingCore(nemer, listingId);
    toets("een ander dan de aanbieder kan niet intrekken", !intrekkenDoorAnder.ok);

    const intrekken = await withdrawListingCore(aanbieder, listingId);
    toets("de aanbieder kan intrekken", intrekken.ok, intrekken.reason);

    const nogmaalsIntrekken = await withdrawListingCore(aanbieder, listingId);
    toets("nogmaals intrekken kan niet", !nogmaalsIntrekken.ok);

    const claimNaIntrekken = await claimListingCore(nemer, {
      listingId,
      ownScheduledDutyId: bDiensten[0]?.id ?? aangebodenDienst.id,
    });
    toets("een ingetrokken aanbieding kan niet meer geclaimd worden", !claimNaIntrekken.created);

    const marktNaIntrekken = await marketplaceListingsCore(nemer);
    toets(
      "een ingetrokken aanbieding staat niet meer in de markt",
      !marktNaIntrekken.some((rij) => rij.id === listingId),
    );

    // ── 7. Eén aanbieding, twee gelijktijdige acceptaties ───────────────────
    //
    // Dit is de grendel die `respondToSwapCore` gebruikt wanneer een voorstel
    // uit de ruilmarkt komt: een `updateMany` met `status: OPEN` in de
    // voorwaarde, binnen dezelfde transactie als de ruil zelf. Rechtstreeks
    // getoetst, los van de vraag of het onderliggende rooster een echte ruil
    // toestaat — die vraag is al bewezen door `verify-ruilflow.ts`.
    console.log("\n7. Eén aanbieding, twee gelijktijdige acceptaties");

    const tweedeAanbieding = await publishListingCore(aanbieder, {
      scheduledDutyId: aangebodenDienst.id,
      preference: "NONE",
    });
    if (!tweedeAanbieding.ok || !tweedeAanbieding.id) {
      throw new Error("Kon geen tweede aanbieding aanmaken voor de gelijktijdigheidsmeting.");
    }
    aangemaakteListings.push(tweedeAanbieding.id);
    const raceListingId = tweedeAanbieding.id;

    // Twee losse, geldige SwapProposal-rijen tegen dezelfde aanbieding —
    // precies de situatie waarin twee collega's onafhankelijk hebben
    // geclaimd en de aanbieder allebei zou kunnen accepteren.
    const voorstelA = await prisma.swapProposal.create({
      data: {
        initiatorEmployeeId: nemer.employeeId,
        initiatorDutyId: bDiensten[0].id,
        counterpartyEmployeeId: aanbieder.employeeId,
        counterpartyDutyId: aangebodenDienst.id,
        expiresAt: new Date(Date.now() + 3_600_000),
        listingId: raceListingId,
      },
      select: { id: true },
    });
    aangemaakteVoorstellen.push(voorstelA.id);
    const tweedeNemerDienst = bDiensten[1] ?? aDiensten[1] ?? bDiensten[0];
    const voorstelB = await prisma.swapProposal.create({
      data: {
        initiatorEmployeeId: nemer.employeeId,
        initiatorDutyId: tweedeNemerDienst.id,
        counterpartyEmployeeId: aanbieder.employeeId,
        counterpartyDutyId: aangebodenDienst.id,
        expiresAt: new Date(Date.now() + 3_600_000),
        listingId: raceListingId,
      },
      select: { id: true },
    });
    aangemaakteVoorstellen.push(voorstelB.id);

    const [uitkomstA, uitkomstB] = await Promise.all([
      prisma.swapListing.updateMany({
        where: { id: raceListingId, status: SwapListingStatus.OPEN },
        data: { status: SwapListingStatus.MATCHED, matchedProposalId: voorstelA.id },
      }),
      prisma.swapListing.updateMany({
        where: { id: raceListingId, status: SwapListingStatus.OPEN },
        data: { status: SwapListingStatus.MATCHED, matchedProposalId: voorstelB.id },
      }),
    ]);
    const gewonnen = [uitkomstA, uitkomstB].filter((uitkomst) => uitkomst.count > 0).length;
    toets(
      "van twee gelijktijdige acceptaties wint er precies één",
      gewonnen === 1,
      `${gewonnen} van de 2 slaagden`,
    );

    const eindstand = await prisma.swapListing.findUnique({
      where: { id: raceListingId },
      select: { status: true, matchedProposalId: true },
    });
    toets(
      "de aanbieding staat op MATCHED met precies één gekoppeld voorstel",
      eindstand?.status === SwapListingStatus.MATCHED &&
        (eindstand.matchedProposalId === voorstelA.id || eindstand.matchedProposalId === voorstelB.id),
      `status ${eindstand?.status}, gekoppeld aan ${eindstand?.matchedProposalId}`,
    );
  } finally {
    // ── Opruimen ────────────────────────────────────────────────────────────
    console.log("\nOpruimen");

    await prisma.outboxEvent.deleteMany({
      where: {
        OR: aangemaakteVoorstellen.flatMap((id) => [
          { eventKey: { contains: id } },
        ]),
      },
    });
    await prisma.notification.deleteMany({
      where: { entityType: "SwapRequest", entityId: { in: aangemaakteVoorstellen } },
    });
    await prisma.auditLogEntry.deleteMany({
      where: {
        OR: [
          { objectType: "SwapProposal", objectId: { in: aangemaakteVoorstellen } },
          { objectType: "SwapListing", objectId: { in: aangemaakteListings } },
        ],
      },
    });
    await prisma.swapProposal.deleteMany({ where: { id: { in: aangemaakteVoorstellen } } });
    await prisma.swapListing.deleteMany({ where: { id: { in: aangemaakteListings } } });

    const restVoorstellen = await prisma.swapProposal.count({
      where: { id: { in: aangemaakteVoorstellen } },
    });
    const restListings = await prisma.swapListing.count({ where: { id: { in: aangemaakteListings } } });
    toets(
      "alles wat dit script aanmaakte is teruggedraaid",
      restVoorstellen === 0 && restListings === 0,
      `${restVoorstellen} voorstellen, ${restListings} aanbiedingen bleven staan`,
    );
  }

  afsluiten();
}

function afsluiten(): void {
  console.log(`\n${"═".repeat(66)}`);
  console.log(
    `${geslaagd} controles geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd door ` +
      "ontbrekende gegevens.",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
