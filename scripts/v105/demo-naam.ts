import "dotenv/config";
import { prisma } from "@/server/data/prisma";

/**
 * De zichtbare naam van het demoaccount bijwerken.
 *
 * De seed maakt het account voortaan aan als "Rooster Commissie Demo". Wie al
 * een gevulde database heeft, draait dit scriptje eenmalig; opnieuw seeden zou
 * alle roosters, kandidaten en metingen weggooien voor één naam.
 *
 * Idempotent: een tweede keer draaien verandert niets meer.
 */
async function main() {
  const res = await prisma.employeeIdentity.updateMany({
    where: { displayName: "Rooster Commissie Dordrecht" },
    data: { displayName: "Rooster Commissie Demo" },
  });
  const rij = await prisma.employeeIdentity.findFirst({
    where: { displayName: { startsWith: "Rooster Commissie" } },
    select: { displayName: true },
  });
  console.log(`bijgewerkt: ${res.count}; zichtbare naam nu: ${rij?.displayName ?? "(geen)"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
