import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * De databasestructuur bijwerken op een computer zonder Prisma-CLI.
 *
 * ## Waarom niet gewoon `prisma migrate deploy`
 *
 * De CLI hoort bij de ontwikkelomgeving en zit niet in een draagbare bundel.
 * Wat hij doet, is echter goed te overzien: hij houdt bij welke migraties al
 * gedraaid hebben en voert de rest in volgorde uit. Dat gebeurt hier, met
 * dezelfde tabel (`_prisma_migrations`) en dezelfde volgorde, zodat een
 * draagbare installatie later gewoon door de CLI kan worden overgenomen.
 *
 * ## Waarom elke migratie in zijn eigen transactie draait
 *
 * Slaagt een migratie half, dan staat de database in een toestand die nergens
 * bij hoort en die niemand kan herkennen. Met een transactie per migratie is
 * de uitkomst altijd: hij is helemaal gedraaid, of helemaal niet — en in het
 * tweede geval staat er in de tabel niet dat hij klaar is.
 *
 * Op één soort migratie kan dat niet: PostgreSQL weigert een nieuwe enum-waarde
 * te gebruiken in dezelfde transactie waarin zij is toegevoegd. Die draaien
 * daarom statement voor statement zonder transactie, net als bij de Prisma-CLI.
 * De administratie wordt ook dan pas bijgewerkt als álle statements erdoor zijn,
 * zodat een afgebroken poging niet als voltooid geldt.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIES = path.join(HIER, "prisma", "migrations");

const MIGRATIETABEL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" varchar(36) PRIMARY KEY,
  "checksum" varchar(64) NOT NULL,
  "finished_at" timestamptz,
  "migration_name" varchar(255) NOT NULL,
  "logs" text,
  "rolled_back_at" timestamptz,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "applied_steps_count" integer NOT NULL DEFAULT 0
)`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL ontbreekt.");
  }

  // De database zelf kan nog niet bestaan bij een eerste start.
  const beheer = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, "/postgres") });
  await beheer.connect();
  const naam = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1).split("?")[0]);
  const bestaat = await beheer.query("SELECT 1 FROM pg_database WHERE datname = $1", [naam]);
  if (bestaat.rowCount === 0) {
    // De naam komt uit de eigen configuratie en niet van een gebruiker, maar
    // hij gaat hier wel in de SQL-tekst: daarom aanhalingstekens verdubbelen.
    await beheer.query(`CREATE DATABASE "${naam.replace(/"/g, '""')}"`);
    console.log(`Database ${naam} aangemaakt.`);
  }
  await beheer.end();

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(MIGRATIETABEL);

  const gedaan = new Set(
    (await client.query('SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL')).rows.map(
      (rij) => rij.migration_name,
    ),
  );

  if (!existsSync(MIGRATIES)) {
    throw new Error(`De migratiemap ontbreekt: ${MIGRATIES}`);
  }

  const beschikbaar = readdirSync(MIGRATIES, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();

  let gedraaid = 0;
  for (const migratie of beschikbaar) {
    if (gedaan.has(migratie)) {
      continue;
    }
    const bestand = path.join(MIGRATIES, migratie, "migration.sql");
    if (!existsSync(bestand)) {
      continue;
    }
    const sql = readFileSync(bestand, "utf8");

    // PostgreSQL staat niet toe dat een nieuwe enum-waarde wordt gebruikt in
    // dezelfde transactie waarin zij is toegevoegd. Zulke migraties draaien
    // daarom statement voor statement buiten een transactie — precies wat de
    // Prisma-CLI ook doet.
    //
    // Dat kost iets: loopt zo'n migratie halverwege vast, dan staat de database
    // in een tussentoestand. Die wordt dan ook niet als voltooid weggeschreven,
    // zodat een volgende start hem opnieuw probeert en niet stilzwijgend
    // verder gaat op een half schema.
    const enumUitbreiding = /ALTER\s+TYPE[\s\S]*?ADD\s+VALUE/i.test(sql);

    try {
      if (enumUitbreiding) {
        for (const statement of splitsStatements(sql)) {
          await client.query(statement);
        }
      } else {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
      }
      await client.query(
        'INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","applied_steps_count") ' +
          "VALUES ($1,$2,$3,now(),1)",
        [crypto.randomUUID(), "portable", migratie],
      );
      gedraaid += 1;
      console.log(`Migratie ${migratie} uitgevoerd.`);
    } catch (fout) {
      if (!enumUitbreiding) {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw new Error(
        `Migratie ${migratie} is mislukt${enumUitbreiding ? "" : " en teruggedraaid"}: ${fout}`,
      );
    }
  }

  await client.end();
  console.log(
    gedraaid === 0
      ? `Structuur is bij (${beschikbaar.length} migraties, niets te doen).`
      : `Structuur bijgewerkt: ${gedraaid} migratie(s) uitgevoerd.`,
  );
}


/**
 * Splitst een migratiebestand in losse statements.
 *
 * Niet met een simpele split op puntkomma: die staat ook in tekstwaarden en in
 * commentaar, en dan valt een statement middendoor. Dit loopt de tekst teken
 * voor teken af en houdt bij of hij zich in een tekst, in een dollarhaakje of
 * in commentaar bevindt.
 */
function splitsStatements(sql) {
  const statements = [];
  let huidig = "";
  let inTekst = false;
  let inRegelcommentaar = false;
  let inBlokcommentaar = false;
  let dollarTag = null;

  for (let index = 0; index < sql.length; index += 1) {
    const teken = sql[index];
    const volgende = sql[index + 1];

    if (inRegelcommentaar) {
      huidig += teken;
      if (teken === String.fromCharCode(10)) inRegelcommentaar = false;
      continue;
    }
    if (inBlokcommentaar) {
      huidig += teken;
      if (teken === "*" && volgende === "/") { huidig += volgende; index += 1; inBlokcommentaar = false; }
      continue;
    }
    if (dollarTag) {
      huidig += teken;
      if (sql.startsWith(dollarTag, index)) {
        huidig += sql.slice(index + 1, index + dollarTag.length);
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (inTekst) {
      huidig += teken;
      if (teken === "'") {
        if (volgende === "'") { huidig += volgende; index += 1; } else { inTekst = false; }
      }
      continue;
    }

    if (teken === "-" && volgende === "-") { inRegelcommentaar = true; huidig += teken; continue; }
    if (teken === "/" && volgende === "*") { inBlokcommentaar = true; huidig += teken; continue; }
    if (teken === "'") { inTekst = true; huidig += teken; continue; }
    if (teken === "$") {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(index));
      if (tag) { dollarTag = tag[0]; huidig += tag[0]; index += tag[0].length - 1; continue; }
    }
    if (teken === ";") {
      if (huidig.trim() !== "") statements.push(huidig.trim());
      huidig = "";
      continue;
    }
    huidig += teken;
  }

  if (huidig.trim() !== "") statements.push(huidig.trim());
  return statements;
}

main().catch((fout) => {
  console.error(String(fout));
  process.exit(1);
});
