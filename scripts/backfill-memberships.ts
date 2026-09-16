import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { toCalendarDate, toDatabaseDate } from "@/domain/time";
import { isoWeekOfDate } from "@/domain/roster-rotation";

/**
 * Zet de bestaande roosterbezetting om in expliciete roosterplaatsingen.
 *
 * ## Waarom dit nodig is
 *
 * Tot nu toe stond de koppeling tussen medewerker en rooster in
 * `RosterAssignment`: een vaste roosterlijn, zonder rotatie. Dat beschrijft één
 * week en zwijgt over alle volgende. `RosterMembership` legt vast op welke regel
 * iemand in wélke week stond; daaruit volgt elke andere week.
 *
 * De omzetting neemt de huidige lijn als ankerregel en de week van de
 * ingangsdatum als ankerweek. Dat is geen aanname maar een waarneming: dit is
 * waar deze medewerker volgens de bestaande gegevens stond.
 *
 * Draaien met: npx tsx --conditions=react-server scripts/backfill-memberships.ts
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  const bestaand = await prisma.rosterMembership.count();
  if (bestaand > 0) {
    console.log(`Er zijn al ${bestaand} roosterplaatsingen; er wordt niets overschreven.`);
    return;
  }

  const toewijzingen = await prisma.rosterAssignment.findMany({
    where: { validUntil: null },
    include: {
      employee: { select: { id: true, employeeNumber: true, depot: true } },
      rosterLine: {
        select: {
          lineNumber: true,
          baseRoster: {
            select: { id: true, code: true, depot: true, _count: { select: { lines: true } } },
          },
        },
      },
    },
    orderBy: { validFrom: "asc" },
  });

  let gemaakt = 0;
  const overgeslagen: string[] = [];

  for (const toewijzing of toewijzingen) {
    const roster = toewijzing.rosterLine.baseRoster;
    const regels = roster._count.lines;

    if (toewijzing.rosterLine.lineNumber > regels) {
      overgeslagen.push(
        `${toewijzing.employee.employeeNumber}: regel ${toewijzing.rosterLine.lineNumber} ` +
          `bestaat niet in ${roster.code} (${regels} regels)`,
      );
      continue;
    }

    const ingang = toCalendarDate(toewijzing.validFrom);
    await prisma.rosterMembership.create({
      data: {
        employeeId: toewijzing.employeeId,
        locationCode: toewijzing.employee.depot,
        baseRosterId: roster.id,
        lineCount: regels,
        anchorRuleIndex: toewijzing.rosterLine.lineNumber,
        anchorWeek: isoWeekOfDate(ingang),
        validFrom: toDatabaseDate(ingang),
        validUntil: null,
        placementType: "PERMANENT",
        status: "ACTIVE",
        reason: "Overgenomen uit de bestaande roosterbezetting.",
      },
    });
    gemaakt += 1;
  }

  console.log(`${gemaakt} permanente roosterplaatsingen aangemaakt.`);
  if (overgeslagen.length > 0) {
    console.log(`\nOvergeslagen:\n  ${overgeslagen.join("\n  ")}`);
  }

  const perRooster = await prisma.rosterMembership.groupBy({
    by: ["baseRosterId"],
    _count: { _all: true },
  });
  const roosters = await prisma.baseRoster.findMany({ select: { id: true, code: true } });
  const namen = new Map(roosters.map((r) => [r.id, r.code]));
  console.log(
    `\nPer rooster: ${perRooster
      .map((rij) => `${namen.get(rij.baseRosterId)}=${rij._count._all}`)
      .join(", ")}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
