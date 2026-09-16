import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * De Prisma-client, als enkelvoudige instantie.
 *
 * ## Waarom de client lui wordt gemaakt
 *
 * Hem bij het importeren van deze module bouwen zou "DATABASE_URL ontbreekt"
 * gooien op het moment dat de module geladen wordt. Dat is de juiste fout op
 * het verkeerde moment: `next build` importeert elke routemodule om
 * routegegevens te verzamelen, en die build hoort te slagen op een machine
 * zonder database. De fout blijft even luid voor wie daadwerkelijk een query
 * doet.
 *
 * ## Waarom hij op globalThis staat
 *
 * Hot reload in ontwikkeling evalueert modules opnieuw. Zonder deze cache opent
 * elke bewerking van een bestand een nieuwe verbindingspool, tot de database
 * geen verbindingen meer geeft.
 */
const globalForPrisma = globalThis as unknown as { nsRoosterPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL ontbreekt. Kopieer .env.example naar .env en vul hem in.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function client(): PrismaClient {
  const existing = globalForPrisma.nsRoosterPrisma;
  if (existing) {
    return existing;
  }
  const created = createClient();
  globalForPrisma.nsRoosterPrisma = created;
  return created;
}

/**
 * Een Proxy en geen getter, omdat aanroepers `prisma.employee.findMany(...)`
 * schrijven: elke property-lees moet bij de echte client uitkomen.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(client(), property, receiver);
    return typeof value === "function" ? value.bind(client()) : value;
  },
  has(_target, property) {
    return Reflect.has(client(), property);
  },
});
