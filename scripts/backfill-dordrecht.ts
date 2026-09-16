import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Zet de bestaande dataset op de standplaatscode waar hij over gaat.
 *
 * ## Waarom dit nodig was
 *
 * De seed uit de eerste fase gebruikte `UT` als depotcode, van vóór het moment
 * dat Dordrecht als standplaats werd vastgesteld. Alle latere fasen gaan over
 * Dordrecht: de Roosterkaders Regio West, de standplaatsafhankelijke
 * werkonderbreking, de aangeleverde roosterbestanden. Daardoor was de
 * lokale regel voor Dordrecht op deze gegevens nooit van toepassing — hij
 * zocht naar `DDR` en vond `UT`. Dat is geen zichtbare fout maar een stille:
 * de regel deed simpelweg niets.
 *
 * Dit script hernoemt de standplaatscode van de bestaande gegevens en koppelt
 * de dienstenpakketten aan de standplaats Dordrecht. Er verandert geen enkel
 * rooster, geen dienst en geen tijd — alleen de code waaronder ze hangen.
 *
 * Draaien met:
 *   npx tsx --conditions=react-server scripts/backfill-dordrecht.ts
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const FROM = "UT";
const TO = "DDR";

async function main(): Promise<void> {
  const location = await prisma.stationLocation.findUnique({ where: { code: TO } });
  if (!location) {
    throw new Error(`Standplaats ${TO} bestaat niet. Draai eerst scripts/sync-locations.ts.`);
  }

  const employees = await prisma.employee.updateMany({
    where: { depot: FROM },
    data: { depot: TO },
  });
  const duties = await prisma.duty.updateMany({ where: { depot: FROM }, data: { depot: TO } });
  const rosters = await prisma.baseRoster.updateMany({
    where: { depot: FROM },
    data: { depot: TO },
  });
  const packages = await prisma.dutyPackage.updateMany({
    where: { depot: FROM },
    data: { depot: TO, locationId: location.id },
  });
  const rotations = await prisma.rotationList.updateMany({
    where: { depot: FROM },
    data: { depot: TO },
  });

  // Het dienstenpakket droeg nog de naam uit de eerste seed ("Dienstregeling
  // 2026 Utrecht"). Die naam staat straks op het exportblad en in de
  // pakketkeuze; een pakket dat Utrecht heet en Dordrecht bevat, is precies het
  // soort verwarring dat later voor een verkeerde keuze zorgt.
  const hernoemdePakketten: string[] = [];
  for (const pakket of await prisma.dutyPackage.findMany({
    where: { depot: TO },
    select: { id: true, name: true, version: true, label: true, timetableId: true },
  })) {
    const dienstregeling =
      pakket.timetableId && pakket.timetableId !== "HUIDIG"
        ? pakket.timetableId
        : `DR${/\d{4}/.exec(pakket.name)?.[0] ?? "ONBEKEND"}`;
    const naam = `${TO}-${dienstregeling}`;
    const label = `${naam}-V${pakket.version}`;
    if (pakket.name === naam && pakket.label === label) {
      continue;
    }
    await prisma.dutyPackage.update({
      where: { id: pakket.id },
      data: { name: naam, label, timetableId: dienstregeling },
    });
    hernoemdePakketten.push(`${pakket.name} → ${label}`);
  }

  // De roostercodes dragen de standplaats in hun naam; die verschijnt op het
  // exportblad en moet dus meeveranderen.
  // De roosternamen dragen nog 'Utrecht' uit de eerste seed. Die naam staat op
  // het roosterblad dat een machinist in handen krijgt.
  for (const roster of await prisma.baseRoster.findMany({
    where: { depot: TO, name: { contains: 'Utrecht' } },
    select: { id: true, name: true },
  })) {
    await prisma.baseRoster.update({
      where: { id: roster.id },
      data: { name: roster.name.replace('Utrecht', 'Dordrecht') },
    });
  }

  // De weergavenamen van de functionele accounts noemden ook nog Utrecht.
  for (const identity of await prisma.employeeIdentity.findMany({
    where: { displayName: { contains: "Utrecht" } },
    select: { employeeId: true, displayName: true },
  })) {
    await prisma.employeeIdentity.update({
      where: { employeeId: identity.employeeId },
      data: { displayName: identity.displayName.replace("Utrecht", "Dordrecht") },
    });
  }

  const renamed: string[] = [];
  for (const roster of await prisma.baseRoster.findMany({
    where: { code: { startsWith: `${FROM}-` } },
    select: { id: true, code: true },
  })) {
    const code = `${TO}-${roster.code.slice(FROM.length + 1)}`;
    await prisma.baseRoster.update({ where: { id: roster.id }, data: { code } });
    renamed.push(`${roster.code} → ${code}`);
  }

  console.log(`Medewerkers        ${employees.count}`);
  console.log(`Diensten           ${duties.count}`);
  console.log(`Basisroosters      ${rosters.count}`);
  console.log(`Dienstenpakketten  ${packages.count}  (gekoppeld aan ${TO})`);
  console.log(`Roulatielijsten    ${rotations.count}`);
  if (hernoemdePakketten.length > 0) {
    console.log(`\nHernoemde pakketten:\n  ${hernoemdePakketten.join("\n  ")}`);
  }
  if (renamed.length > 0) {
    console.log(`\nHernoemde roostercodes:\n  ${renamed.join("\n  ")}`);
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
