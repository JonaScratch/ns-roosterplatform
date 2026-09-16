import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Waarden klaarmaken voor een JSON-kolom.
 *
 * Prisma verlangt voor JSON-kolommen een `InputJsonValue`, en dat is strenger
 * dan "een object": een interface met vaste velden voldoet niet, omdat er geen
 * index-signatuur op zit. Een cast op elke aanroepplaats zou het probleem
 * verplaatsen naar dertig plekken waar de volgende lezer moet uitzoeken of hij
 * veilig is.
 *
 * De ronde door `JSON.stringify` is daarom geen kunstgreep maar het echte werk:
 * hij verwijdert `undefined`, zet `Date` om naar tekst, en gooit op cyclische
 * structuren — precies de dingen die anders pas bij het schrijven naar de
 * database misgaan.
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Zelfde, maar voor een kolom die leeg mag blijven.
 *
 * Geeft `undefined` terug wanneer er niets is. Prisma laat het veld dan weg en
 * de kolom blijft NULL. Dat is bewust gekozen boven `Prisma.DbNull`: een
 * ontbrekende oude waarde in het auditlog is "niet van toepassing", en dat is
 * iets anders dan de JSON-waarde null.
 */
export function toJsonOrOmit(value: unknown): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : toJson(value);
}
