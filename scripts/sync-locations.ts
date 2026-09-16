import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import {
  CONFIGURED_LOCATION,
  DID_CONTACTS,
  PLANNING_UNITS,
  PLANNING_UNIT_NOTE,
  REGIONS,
  STATIONS,
} from "@/domain/locations";

/**
 * Zet de landelijke standplaatsstructuur in de database.
 *
 * Idempotent: opnieuw draaien werkt alleen naam en regio bij en laat de
 * inrichtingsstatus met rust. Draaien met:
 *   npx tsx --conditions=react-server scripts/sync-locations.ts
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  for (const region of REGIONS) {
    await prisma.region.upsert({
      where: { code: region.code },
      update: { name: region.name, note: region.note ?? null },
      create: { code: region.code, name: region.name, note: region.note ?? null },
    });
  }
  const regions = new Map(
    (await prisma.region.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]),
  );

  for (const station of STATIONS) {
    const configured = station.code === CONFIGURED_LOCATION;
    await prisma.stationLocation.upsert({
      where: { code: station.code },
      update: {
        name: station.name,
        regionId: regions.get(station.region)!,
        // Alleen zetten waar een adres is aangeleverd; nooit leegmaken wat
        // iemand met de hand heeft ingevuld.
        ...(DID_CONTACTS[station.code] ? { didContactEmail: DID_CONTACTS[station.code] } : {}),
      },
      create: {
        code: station.code,
        name: station.name,
        regionId: regions.get(station.region)!,
        active: true,
        planningEnabled: configured,
        dutiesConfigured: configured,
        rostersConfigured: configured,
        rulesConfigured: configured,
        exportTemplateConfigured: configured,
        optimizerMode: configured ? "SIMULATION" : "DISABLED",
        rosterProfilesConfigured: configured,
        qualificationsConfigured: false,
        didContactEmail: DID_CONTACTS[station.code] ?? null,
      },
    });
  }

  const locations = new Map(
    (await prisma.stationLocation.findMany({ select: { id: true, code: true } })).map((l) => [l.code, l.id]),
  );

  for (const unit of PLANNING_UNITS) {
    await prisma.planningUnit.upsert({
      where: { code: unit.code },
      update: { name: unit.name, note: PLANNING_UNIT_NOTE },
      create: { code: unit.code, name: unit.name, note: PLANNING_UNIT_NOTE, locationId: locations.get(unit.parent)! },
    });
  }

  const enabled = await prisma.stationLocation.count({ where: { planningEnabled: true } });
  console.log(`${STATIONS.length} standplaatsen, ${PLANNING_UNITS.length} eenheden, ${enabled} ingericht.`);

  const perDepot = await prisma.duty.groupBy({ by: ["depot"], _count: { _all: true } });
  console.log(
    `Diensten per standplaats: ${perDepot
      .map((row) => `${row.depot}=${row._count._all}`)
      .join(", ")}`,
  );
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
