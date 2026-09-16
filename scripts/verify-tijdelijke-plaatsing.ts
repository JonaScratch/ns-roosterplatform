import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { addDays, toCalendarDate } from "@/domain/time";
import { isoWeekOfDate, rotationSeries } from "@/domain/roster-rotation";
import { processOutbox } from "@/server/services/notification-service";
import {
  anchorOf,
  effectiveMembershipOn,
  placeTemporarilyCore,
  upcomingWeeks,
} from "@/server/services/roster-membership-service";
import { ruleForDate } from "@/domain/roster-rotation";

/**
 * Een tijdelijke roosterplaatsing, van begin tot terugkeer.
 *
 * ## Waar het hier om gaat
 *
 * Het gevaarlijke aan een tijdelijke plaatsing is de terugkeer. Wie de
 * permanente plaatsing overschrijft, kan na afloop alleen nog raden op welke
 * regel iemand hoort te staan — en "terug naar regel 6" klopt dan bijna nooit,
 * want de rotatie is intussen doorgelopen.
 *
 * Dit script meet precies dat: het legt de projectie vast vóór de tijdelijke
 * plaatsing, plaatst iemand vier weken elders, en kijkt daarna of de weken ná
 * de plaatsing nog exact dezelfde regels tonen als in de oorspronkelijke
 * reeks. Alles wat het aanmaakt, wordt opgeruimd.
 *
 * Draaien met: npm run verify:tijdelijke-plaatsing
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
  console.log("TIJDELIJKE ROOSTERPLAATSING");
  console.log("═".repeat(60));

  const basis = await prisma.rosterMembership.findFirst({
    where: { placementType: "PERMANENT", status: "ACTIVE" },
    include: {
      employee: { select: { id: true, employeeNumber: true, depot: true } },
      baseRoster: { select: { code: true, name: true } },
    },
  });
  if (!basis) {
    console.log("Geen permanente plaatsing gevonden. Draai eerst backfill-memberships.ts.");
    return;
  }

  const doel = await prisma.baseRoster.findFirst({
    where: {
      depot: basis.employee.depot,
      id: { not: basis.baseRosterId },
      status: { not: "ARCHIVED" },
    },
    select: { id: true, code: true, name: true, _count: { select: { lines: true } } },
  });
  if (!doel) {
    console.log("Geen tweede rooster op deze standplaats om naartoe te plaatsen.");
    return;
  }

  const vandaag = toCalendarDate(new Date());
  const startWeek = isoWeekOfDate(addDays(vandaag, 14));
  const eindWeek = isoWeekOfDate(addDays(vandaag, 14 + 21));

  console.log(
    `\nMedewerker ${basis.employee.employeeNumber}: basis ${basis.baseRoster.code} ` +
      `(anker regel ${basis.anchorRuleIndex} in ${basis.anchorWeek})`,
  );
  console.log(`Tijdelijk naar ${doel.code} van ${startWeek} tot en met ${eindWeek}\n`);

  // ── 1. De reeks zonder tijdelijke plaatsing ──────────────────────────────
  const voor = await upcomingWeeks(basis.employee.id, 12, vandaag);
  const verwachtePermanent = rotationSeries(anchorOf(basis), isoWeekOfDate(vandaag), 12);

  toets(
    "de uitgangsreeks volgt de permanente rotatie",
    voor.every((week, index) => week.ruleIndex === verwachtePermanent[index].ruleIndex),
    voor.map((week) => `${week.week}=${week.ruleIndex}`).join(" "),
  );

  // ── 2. De tijdelijke plaatsing ───────────────────────────────────────────
  const uitkomst = await placeTemporarilyCore(null, {
    employeeId: basis.employee.id,
    baseRosterCode: doel.code,
    anchorRuleIndex: 1,
    fromWeek: startWeek,
    untilWeek: eindWeek,
    reason: "verificatie van de tijdelijke plaatsing",
  });
  toets("de tijdelijke plaatsing wordt vastgelegd", uitkomst.ok, uitkomst.reason);
  if (!uitkomst.ok || !uitkomst.membershipId) {
    return;
  }
  const tijdelijkeId = uitkomst.membershipId;

  try {
    // ── 3. Overlap wordt geweigerd ─────────────────────────────────────────
    const tweede = await placeTemporarilyCore(null, {
      employeeId: basis.employee.id,
      baseRosterCode: doel.code,
      anchorRuleIndex: 2,
      fromWeek: startWeek,
      untilWeek: eindWeek,
      reason: "tweede poging",
    });
    toets(
      "een tweede, overlappende tijdelijke plaatsing wordt geweigerd",
      !tweede.ok,
      tweede.reason,
    );

    // ── 4. Een regel die niet bestaat, wordt geweigerd ─────────────────────
    const buitenBereik = await placeTemporarilyCore(null, {
      employeeId: basis.employee.id,
      baseRosterCode: doel.code,
      anchorRuleIndex: doel._count.lines + 1,
      fromWeek: isoWeekOfDate(addDays(vandaag, 200)),
      untilWeek: isoWeekOfDate(addDays(vandaag, 220)),
      reason: "regel buiten bereik",
    });
    toets(
      "een startregel die niet in het rooster bestaat, wordt geweigerd",
      !buitenBereik.ok && buitenBereik.reason.includes("bestaat niet"),
      buitenBereik.reason,
    );

    // ── 5. De projectie tijdens en na ──────────────────────────────────────
    const na = await upcomingWeeks(basis.employee.id, 12, vandaag);

    const tijdensWeken = na.filter((week) => week.week >= startWeek && week.week <= eindWeek);
    toets(
      `tijdens de plaatsing volgt de medewerker ${doel.code}`,
      tijdensWeken.length > 0 && tijdensWeken.every((week) => week.rosterCode === doel.code),
      tijdensWeken.map((week) => `${week.week}=${week.rosterCode}`).join(" "),
    );
    toets(
      "die weken zijn als tijdelijk gemarkeerd",
      tijdensWeken.every((week) => week.temporary),
    );

    const ervoorEnErna = na.filter((week) => week.week < startWeek || week.week > eindWeek);
    const zelfdeAlsVoor = ervoorEnErna.every((week) => {
      const oorspronkelijk = voor.find((eerder) => eerder.week === week.week);
      return (
        oorspronkelijk !== undefined &&
        oorspronkelijk.ruleIndex === week.ruleIndex &&
        oorspronkelijk.rosterCode === week.rosterCode
      );
    });
    toets(
      "de weken vóór en ná de plaatsing zijn onveranderd",
      zelfdeAlsVoor,
      ervoorEnErna
        .map((week) => {
          const eerder = voor.find((item) => item.week === week.week);
          return `${week.week}: was ${eerder?.rosterCode}/${eerder?.ruleIndex}, nu ${week.rosterCode}/${week.ruleIndex}`;
        })
        .slice(0, 3)
        .join(" | "),
    );

    // ── 6. De terugkeerpositie ─────────────────────────────────────────────
    const eersteWeekErna = na.find((week) => week.week > eindWeek);
    if (eersteWeekErna) {
      const verwacht = ruleForDate(anchorOf(basis), eersteWeekErna.monday);
      toets(
        `na afloop staat de medewerker op regel ${verwacht}, waar de rotatie hem bracht`,
        eersteWeekErna.ruleIndex === verwacht,
        `staat op ${eersteWeekErna.ruleIndex}`,
      );
      // De plaatsing duurt vier weken; alleen bij een rooster van precies vier
      // regels zou de terugkeer op dezelfde regel uitkomen. Anders hoort hij
      // verschoven te zijn — en dát is het gedrag waar het hier om gaat.
      const bijVertrek = voor.find((week) => week.week === startWeek)?.ruleIndex;
      const wekenTijdelijk = 4;
      if (bijVertrek !== undefined && basis.lineCount % wekenTijdelijk !== 0) {
        toets(
          "de terugkeerregel is meegeschoven en niet die van het vertrek",
          eersteWeekErna.ruleIndex !== bijVertrek,
          `vertrok op ${bijVertrek}, kwam terug op ${eersteWeekErna.ruleIndex}`,
        );
      }
    }

    // ── 7. De melding ──────────────────────────────────────────────────────
    await processOutbox();
    const meldingen = await prisma.notification.count({
      where: { entityId: tijdelijkeId, type: "ROSTER_PLACEMENT_TEMPORARY" },
    });
    toets("de medewerker krijgt een melding", meldingen >= 1, `${meldingen} meldingen`);

    // ── 8. De basis is niet aangeraakt ─────────────────────────────────────
    const basisNa = await prisma.rosterMembership.findUnique({ where: { id: basis.id } });
    toets(
      "de permanente plaatsing is ongewijzigd",
      basisNa?.status === "ACTIVE" &&
        basisNa.anchorRuleIndex === basis.anchorRuleIndex &&
        basisNa.anchorWeek === basis.anchorWeek &&
        basisNa.validUntil === null,
      "de basis is aangepast door een tijdelijke plaatsing",
    );

    // ── 9. Buiten de periode geldt de basis weer ───────────────────────────
    const naAfloop = await effectiveMembershipOn(
      basis.employee.id,
      addDays(vandaag, 14 + 28 + 7),
    );
    toets(
      "buiten de periode telt de permanente plaatsing weer",
      naAfloop?.placementType === "PERMANENT",
      `geldt: ${naAfloop?.placementType}`,
    );
  } finally {
    // Opruimen: de proefplaatsing en haar meldingen horen niet te blijven staan.
    await prisma.notification.deleteMany({ where: { entityId: tijdelijkeId } });
    await prisma.outboxEvent.deleteMany({ where: { eventKey: { contains: tijdelijkeId } } });
    await prisma.rosterMembership.deleteMany({ where: { id: tijdelijkeId } });
    console.log("\n(de tijdelijke plaatsing van deze meting is opgeruimd)");
  }

  console.log(`\n${"═".repeat(60)}`);
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
