import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Het Excel-sjabloon, over de echte route.
 *
 * ## Waarom dit script bestaat
 *
 * Het sjabloon werd geleverd met status 200, met het juiste content-type, en
 * met een geldig xlsx-bestand erin — en tóch was het onbruikbaar: het bevatte
 * nul diensten. De opzoeking filterde op `locationId` (leeg bij dit pakket) en
 * op een dienstregelingcode die het scherm hardcoded meestuurde (`HUIDIG`),
 * terwijl het echte pakket `BDU-05-10-2026` heet.
 *
 * Een controle die alleen naar statuscode en bestandsvorm kijkt, keurt dat
 * goed. Dit script kijkt daarom in het bestand: staan de kolomkoppen erin, en
 * staan de diensten erin die volgens de database in het actieve pakket zitten?
 *
 * Het pakt het bestand zelf uit (ZIP + XML) in plaats van de lezer van het
 * project te gebruiken. Een schrijver die met zijn eigen lezer wordt getoetst,
 * bewijst alleen dat ze dezelfde aanname delen.
 *
 * Draaien met een lopende ontwikkelserver: npm run verify:template
 */

const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3300";
const SESSION_COOKIE = "nsr_session";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
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

function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET ontbreekt.");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

async function openSession(employeeNumber: string): Promise<string> {
  const account = await prisma.userAccount.findFirst({
    where: { employee: { employeeNumber } },
    select: { id: true },
  });
  if (!account) {
    throw new Error(`Geen account met personeelsnummer ${employeeNumber}. Draai eerst de seed.`);
  }
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId: account.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + 15 * 60_000),
      absoluteExpiry: new Date(now + 30 * 60_000),
      clientFingerprint: "verify-template",
    },
  });
  return token;
}

// ── Een eigen, minimale xlsx-lezer ───────────────────────────────────────────
//
// Genoeg om te bewijzen dat er een werkblad met tekst in zit. Geen bibliotheek:
// dat zou een afhankelijkheid toevoegen om één controle te kunnen doen.

interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

/** Leest de bestanden uit een ZIP-archief (alleen opgeslagen of deflate). */
function readZip(buffer: Buffer): readonly ZipEntry[] {
  const entries: ZipEntry[] = [];
  // Het centrale register staat achteraan; vandaar terugzoeken naar de
  // eindmarkering in plaats van vooruit door de bestanden lopen.
  let eind = buffer.length - 22;
  while (eind >= 0 && buffer.readUInt32LE(eind) !== 0x06054b50) {
    eind -= 1;
  }
  if (eind < 0) {
    throw new Error("Geen ZIP-eindmarkering gevonden: dit is geen xlsx-bestand.");
  }
  const aantal = buffer.readUInt16LE(eind + 10);
  let plek = buffer.readUInt32LE(eind + 16);

  for (let index = 0; index < aantal; index += 1) {
    if (buffer.readUInt32LE(plek) !== 0x02014b50) {
      throw new Error("Beschadigd centraal register in het archief.");
    }
    const methode = buffer.readUInt16LE(plek + 10);
    const gecomprimeerd = buffer.readUInt32LE(plek + 20);
    const naamLengte = buffer.readUInt16LE(plek + 28);
    const extraLengte = buffer.readUInt16LE(plek + 30);
    const commentaarLengte = buffer.readUInt16LE(plek + 32);
    const lokaalBegin = buffer.readUInt32LE(plek + 42);
    const naam = buffer.toString("utf8", plek + 46, plek + 46 + naamLengte);

    const lokaalNaamLengte = buffer.readUInt16LE(lokaalBegin + 26);
    const lokaalExtraLengte = buffer.readUInt16LE(lokaalBegin + 28);
    const dataBegin = lokaalBegin + 30 + lokaalNaamLengte + lokaalExtraLengte;
    const ruw = buffer.subarray(dataBegin, dataBegin + gecomprimeerd);

    entries.push({ name: naam, bytes: methode === 0 ? ruw : inflateRawSync(ruw) });
    plek += 46 + naamLengte + extraLengte + commentaarLengte;
  }
  return entries;
}

/** De teksten uit sharedStrings.xml, in volgorde. */
function readSharedStrings(xml: string): readonly string[] {
  const teksten: string[] = [];
  for (const item of xml.split("<si>").slice(1)) {
    const stukken = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    teksten.push(
      stukken
        .join("")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'"),
    );
  }
  return teksten;
}

/** De cellen van een werkblad als rijen tekst. */
function readSheetRows(xml: string, shared: readonly string[]): readonly (readonly string[])[] {
  const rijen: string[][] = [];
  for (const rij of xml.split("<row").slice(1)) {
    const cellen: string[] = [];
    for (const cel of rij.split("<c ").slice(1)) {
      const type = /t="([^"]+)"/.exec(cel)?.[1];
      const waarde = /<v>([\s\S]*?)<\/v>/.exec(cel)?.[1];
      if (waarde === undefined) {
        const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cel)?.[1];
        cellen.push(inline ?? "");
        continue;
      }
      cellen.push(type === "s" ? (shared[Number(waarde)] ?? "") : waarde);
    }
    rijen.push(cellen);
  }
  return rijen;
}

async function main(): Promise<void> {
  console.log("EXCEL-SJABLOON");
  console.log("═".repeat(66));

  const token = await openSession("900001");

  // Wat er volgens de database in het actieve pakket van DDR zit. Dit is de
  // maatstaf: het sjabloon hoort exact deze diensten te bevatten.
  const location = await prisma.stationLocation.findUnique({
    where: { code: "DDR" },
    select: { id: true, code: true },
  });
  const pakket = await prisma.dutyPackage.findFirst({
    where: {
      status: { in: ["ACTIVE", "CONFIRMED"] },
      OR: [{ locationId: location?.id ?? "" }, { depot: "DDR" }],
    },
    orderBy: [{ status: "asc" }, { version: "desc" }],
    select: { timetableId: true, _count: { select: { duties: true } }, duties: { select: { code: true } } },
  });
  const verwachteDiensten = pakket?._count.duties ?? 0;
  console.log(
    `\nActief pakket DDR: dienstregeling ${pakket?.timetableId ?? "geen"}, ` +
      `${verwachteDiensten} diensten.\n`,
  );

  console.log("1. De route levert een bestand");
  const response = await fetch(
    `${BASE_URL}/roostercommissie/pakketten/sjabloon?standplaats=DDR&dienstregeling=HUIDIG`,
    { redirect: "manual", headers: { cookie: `${SESSION_COOKIE}=${token}` } },
  );
  toets("status 200", response.status === 200, `status ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "";
  toets(
    "content-type is xlsx",
    contentType.includes("spreadsheetml.sheet"),
    contentType || "ontbreekt",
  );
  const disposition = response.headers.get("content-disposition") ?? "";
  toets(
    "content-disposition biedt het bestand als download aan",
    disposition.includes("attachment") && disposition.includes(".xlsx"),
    disposition || "ontbreekt",
  );

  const buffer = Buffer.from(await response.arrayBuffer());
  toets("het bestand is niet leeg", buffer.length > 0, `${buffer.length} bytes`);

  // Een HTML-foutpagina met een .xlsx-naam is precies wat hier nooit mag
  // gebeuren; die begint niet met de ZIP-handtekening.
  const zipHandtekening = buffer.subarray(0, 4).toString("hex");
  toets(
    "het begint met de ZIP-handtekening (geen HTML-foutpagina)",
    zipHandtekening === "504b0304",
    `eerste bytes: ${zipHandtekening}`,
  );

  console.log("\n2. Het bestand is een leesbaar werkboek");
  let entries: readonly ZipEntry[] = [];
  try {
    entries = readZip(buffer);
    toets("het archief kan onafhankelijk worden uitgepakt", entries.length > 0);
  } catch (error) {
    toets("het archief kan onafhankelijk worden uitgepakt", false, String(error));
    afsluiten();
    return;
  }

  const namen = entries.map((entry) => entry.name);
  // Geen eis aan een gedeelde tekstenlijst: deze schrijver zet de tekst inline
  // in het werkblad, en dat is even geldig. Wat wél moet: een werkboek met
  // minstens één werkblad erin.
  toets(
    "het bevat een werkboek met minstens één werkblad",
    namen.includes("xl/workbook.xml") &&
      namen.some((naam) => naam.startsWith("xl/worksheets/")),
    namen.join(", "),
  );

  const shared = readSharedStrings(
    entries.find((entry) => entry.name.includes("sharedStrings"))?.bytes.toString("utf8") ?? "",
  );
  const blad = entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml");
  const rijen = readSheetRows(blad?.bytes.toString("utf8") ?? "", shared);
  toets("het eerste werkblad bevat rijen", rijen.length > 0, `${rijen.length} rijen`);

  console.log("\n3. De kolommen die de opdracht voorschrijft");
  const kop = rijen[0] ?? [];
  for (const verwacht of ["Dag", "Dienstnummer", "Diensttijd"]) {
    toets(
      `kolom "${verwacht}" staat in de kopregel`,
      kop.some((cel) => cel.trim().toLowerCase() === verwacht.toLowerCase()),
      `kopregel: ${kop.join(" | ")}`,
    );
  }

  console.log("\n4. De inhoud komt overeen met het actieve pakket");
  const gegevensrijen = rijen.slice(1).filter((rij) => rij.some((cel) => cel.trim() !== ""));
  toets(
    `het sjabloon bevat de ${verwachteDiensten} diensten van het actieve pakket`,
    verwachteDiensten > 0 && gegevensrijen.length === verwachteDiensten,
    `${gegevensrijen.length} rijen in het bestand, ${verwachteDiensten} diensten in de database`,
  );

  const dagKolom = kop.findIndex((cel) => cel.trim().toLowerCase() === "dag");
  const nummerKolom = kop.findIndex((cel) => cel.trim().toLowerCase() === "dienstnummer");
  const tijdKolom = kop.findIndex((cel) => cel.trim().toLowerCase() === "diensttijd");
  const eerste = gegevensrijen[0] ?? [];
  const dagen = [
    "maandag",
    "dinsdag",
    "woensdag",
    "donderdag",
    "vrijdag",
    "zaterdag",
    "zondag",
  ];
  toets(
    "de eerste gegevensrij heeft een weekdag voluit",
    dagen.includes((eerste[dagKolom] ?? "").trim().toLowerCase()),
    `"${eerste[dagKolom] ?? ""}"`,
  );
  toets(
    "de eerste gegevensrij heeft een dienstnummer",
    (eerste[nummerKolom] ?? "").trim().length > 0,
    `"${eerste[nummerKolom] ?? ""}"`,
  );
  toets(
    "de diensttijd staat in de vorm 04:27 / 11:07",
    /^\d{2}:\d{2}\s*\/\s*\d{2}:\d{2}$/.test((eerste[tijdKolom] ?? "").trim()),
    `"${eerste[tijdKolom] ?? ""}"`,
  );

  // Het oude formaat mag nergens meer als hoofdsjabloon opduiken.
  const alleTekst = gegevensrijen.flat().join(" ");
  toets(
    "geen oud `1 = 4:27-11:07`-formaat in de gegevens",
    !/\d\s*=\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(alleTekst),
  );

  console.log("\n5. Een onbekende standplaats levert geen bestand");
  const onzin = await fetch(
    `${BASE_URL}/roostercommissie/pakketten/sjabloon?standplaats=&dienstregeling=HUIDIG`,
    { redirect: "manual", headers: { cookie: `${SESSION_COOKIE}=${token}` } },
  );
  toets(
    "een lege standplaats wordt geweigerd met een leesbare melding",
    onzin.status === 400,
    `status ${onzin.status}`,
  );

  afsluiten();
}

function afsluiten(): void {
  console.log(`\n${"═".repeat(66)}`);
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
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
