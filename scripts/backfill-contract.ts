import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Vult de contractomvang aan voor medewerkers die er nog geen hebben.
 *
 * De Dordrechtse basisroosters zijn aangeleverd als 40-uursroosters; die omvang
 * wordt hier overgenomen voor medewerkers die nog geen waarde hebben. Het is een
 * gegeven uit de roosterdata en geen afleiding uit werkelijk gewerkte uren.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  const zonder = await prisma.employee.findMany({
    where: { OR: [{ contractHours: null }, { contractHours: { not: 40 } }] },
    select: { id: true, employeeNumber: true },
    orderBy: { employeeNumber: "asc" },
  });

  for (const employee of zonder) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { contractHours: 40 },
    });
  }
  console.log(`${zonder.length} medewerkers een contractomvang gegeven.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
