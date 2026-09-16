import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * De demonstratiegegevens inladen bij een lege database.
 *
 * ## Waarom dit geen psql aanroept
 *
 * De meegeleverde PostgreSQL bestaat uit precies drie programma's: initdb,
 * pg_ctl en de server zelf. Er zit geen psql bij en geen pg_dump. Dat is bij
 * het bouwen van de bundel gebleken, en het is maar goed ook dat het toen bleek:
 * een startscript dat een programma aanroept dat er niet is, meldt "gestart" en
 * levert een lege database op.
 *
 * Alles gaat daarom via de `pg`-client die de applicatie zelf toch al gebruikt.
 *
 * ## Waarom in één transactie met de trekkers uit
 *
 * De gegevens hebben verwijzingen naar elkaar. Ze in de juiste volgorde
 * invoegen kan, maar die volgorde is een tweede plek waar de structuur staat
 * beschreven — en die loopt vroeg of laat uit de pas met het schema.
 *
 * `session_replication_role = replica` zet de controle op verwijzingen even
 * uit. Aan het eind van de transactie staat hij weer aan, en dan controleert
 * PostgreSQL alsnog: een verwijzing die nergens heen wijst, laat de hele
 * transactie stuklopen. De volgorde doet er niet toe; de uitkomst wel.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
const BESTAND = path.join(HIER, "demonstratie-gegevens.sql");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL ontbreekt.");
  }
  if (!existsSync(BESTAND)) {
    console.log("Er zijn geen demonstratiegegevens meegeleverd; er wordt niets ingeladen.");
    return;
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  // Alleen inladen wanneer er werkelijk nog niets staat. Twee keer inladen zou
  // dubbele rijen opleveren, en dat is erger dan een lege database.
  const bestaand = await client.query('SELECT count(*)::int AS aantal FROM "UserAccount"');
  if (bestaand.rows[0].aantal > 0) {
    console.log(`De database bevat al ${bestaand.rows[0].aantal} accounts; er wordt niets ingeladen.`);
    await client.end();
    return;
  }

  const sql = readFileSync(BESTAND, "utf8");
  await client.query("BEGIN");
  try {
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("SET session_replication_role = replica");
    await client.query(sql);
    await client.query("SET session_replication_role = origin");
    await client.query("COMMIT");
  } catch (fout) {
    await client.query("ROLLBACK");
    await client.end();
    throw new Error(`De demonstratiegegevens konden niet worden ingeladen: ${fout}`);
  }

  const na = await client.query('SELECT count(*)::int AS aantal FROM "UserAccount"');
  await client.end();
  console.log(`Demonstratiegegevens ingeladen: ${na.rows[0].aantal} accounts.`);
}

main().catch((fout) => {
  console.error(String(fout));
  process.exit(1);
});
