import "dotenv/config";
import { writeFileSync } from "node:fs";
import pg from "pg";

/**
 * De demonstratiegegevens uit de ontwikkeldatabase halen.
 *
 * ## Waarom niet pg_dump
 *
 * De meegeleverde PostgreSQL bestaat uit initdb, pg_ctl en de server. Meer
 * niet. Er zit geen pg_dump bij en geen psql. Een bouwstap die er toch een
 * aanroept, werkt op deze machine (waar PostgreSQL misschien wél geïnstalleerd
 * staat) en niet op de volgende — en dan is de bundel stil leeg.
 *
 * Daarom leest dit script de tabellen uit met dezelfde `pg`-client die de
 * applicatie gebruikt, en schrijft het INSERT-regels weg die de draagbare
 * versie met diezelfde client weer inleest. Wat hier wordt gebruikt, zit ook
 * in de bundel.
 *
 * ## Waarom de waarden als tekst worden weggeschreven
 *
 * Elke waarde gaat er als letterlijke SQL-waarde in, met de aanhalingstekens
 * verdubbeld. Geen enkele waarde komt van een gebruiker van dit script — het
 * zijn de eigen ontwikkelgegevens — maar de regel geldt hier net zo goed: wat
 * in een SQL-tekst belandt, wordt eerst onschadelijk gemaakt.
 */

const DOEL = process.argv[2];
if (!DOEL) {
  console.error("Geef het doelbestand op.");
  process.exit(1);
}

/** Tabellen die niet mee horen: die van de migratieadministratie zelf. */
const OVERSLAAN = new Set(["_prisma_migrations"]);

/**
 * Tabellen met vluchtige of persoonlijke inhoud die niet in een bundel horen.
 *
 * Sessies verlopen toch, en beveiligingsgebeurtenissen en auditregels gaan over
 * wat er op déze machine is gebeurd. Die meesturen naar een demonstratiestick
 * is niet alleen nutteloos maar ook onnodig: niemand op die stick heeft ze
 * nodig om te zien hoe het platform werkt.
 */
const NIET_MEENEMEN = new Set(["Session", "SecurityEvent", "AuditLogEntry", "OutboxEvent", "Notification"]);

/**
 * Eén waarde als letterlijke SQL.
 *
 * Het kolomtype gaat vóór de JavaScript-vorm, en dat is niet vrijblijvend. Een
 * JSON-kolom met een lijst erin komt uit de driver terug als een JavaScript-lijst,
 * precies zoals een `text[]`-kolom dat doet. Wie op de vorm afgaat, schrijft die
 * JSON-lijst weg als PostgreSQL-array — en dat is geen geldige JSON meer. Zo
 * liep het inladen ook werkelijk stuk, op `protections` en `qualifications`.
 */
function alsSql(waarde, type) {
  if (waarde === null || waarde === undefined) {
    return "NULL";
  }

  // Eerst het kolomtype: dat weet wat de bestemming verwacht.
  if (type === "json" || type === "jsonb") {
    return `'${JSON.stringify(waarde).replace(/'/g, "''")}'::${type}`;
  }

  if (typeof waarde === "number") {
    return Number.isFinite(waarde) ? String(waarde) : "NULL";
  }
  if (typeof waarde === "boolean") {
    return waarde ? "true" : "false";
  }
  if (waarde instanceof Date) {
    return `'${waarde.toISOString()}'`;
  }
  if (Buffer.isBuffer(waarde)) {
    return `'\\x${waarde.toString("hex")}'`;
  }
  if (Array.isArray(waarde)) {
    const delen = waarde.map((item) =>
      item === null ? "NULL" : `"${String(item).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    );
    return `'{${delen.join(",")}}'`;
  }
  if (typeof waarde === "object") {
    return `'${JSON.stringify(waarde).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(waarde).replace(/'/g, "''")}'`;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tabellen = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );

  const regels = [
    "-- Demonstratiegegevens voor de draagbare versie van het NS Roosterplatform.",
    "-- Automatisch gemaakt door portable/dump-demo.mjs. Niet met de hand wijzigen.",
    "",
  ];
  let totaalRijen = 0;
  let meegenomen = 0;
  const overgeslagen = [];

  for (const { table_name: tabel } of tabellen.rows) {
    if (OVERSLAAN.has(tabel)) {
      continue;
    }
    if (NIET_MEENEMEN.has(tabel)) {
      overgeslagen.push(tabel);
      continue;
    }

    const kolommen = await client.query(
      `SELECT column_name, udt_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tabel],
    );
    const namen = kolommen.rows.map((rij) => rij.column_name);
    const typen = new Map(kolommen.rows.map((rij) => [rij.column_name, rij.udt_name]));

    const inhoud = await client.query(`SELECT * FROM "${tabel}"`);
    if (inhoud.rowCount === 0) {
      continue;
    }

    regels.push(`-- ${tabel}: ${inhoud.rowCount} rijen`);
    const kolomlijst = namen.map((naam) => `"${naam}"`).join(", ");
    for (const rij of inhoud.rows) {
      const waarden = namen.map((naam) => alsSql(rij[naam], typen.get(naam)));
      regels.push(`INSERT INTO "${tabel}" (${kolomlijst}) VALUES (${waarden.join(", ")});`);
    }
    regels.push("");
    totaalRijen += inhoud.rowCount;
    meegenomen += 1;
  }

  await client.end();

  const sql = regels.join("\n");
  writeFileSync(DOEL, sql, "utf8");
  console.log(
    `demonstratiegegevens meegenomen (${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(1)} MB, ` +
      `${meegenomen} tabellen, ${totaalRijen} rijen; ` +
      `${overgeslagen.length} tabellen bewust weggelaten: ${overgeslagen.join(", ")})`,
  );
}

main().catch((fout) => {
  console.error(String(fout));
  process.exit(1);
});
