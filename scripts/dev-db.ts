import "dotenv/config";
import path from "node:path";
import { Client } from "pg";
import {
  clusterExists,
  clusterRunning,
  initCluster,
  portInUse,
  startCluster,
  stopCluster,
  waitForPort,
} from "../src/lib/pg-tools";

/**
 * Het lokale ontwikkelcluster van PostgreSQL.
 *
 *   npm run db:up       starten en afsluiten — blijft draaien na deze shell
 *   npm run db:status   draait het, en welke database
 *   npm run db:down     stoppen
 *
 * `db:down` stopt uitsluitend het cluster in de datadirectory van dit project.
 * Er wordt nooit gezocht naar losse postgres-processen: een ander project of een
 * echte PostgreSQL-installatie op deze machine is niet onze zaak.
 */

const DATA_DIR = path.resolve(process.env.DEV_PGDATA ?? "./storage/dev-db");
const LOG_FILE = path.resolve(process.env.DEV_PGLOG ?? "./storage/dev-db.log");
const PORT = Number(process.env.DEV_PGPORT ?? 5433);
const USER = process.env.POSTGRES_USER ?? "ns_rooster";
const PASSWORD = process.env.POSTGRES_PASSWORD ?? "ns_rooster";
const DATABASE = process.env.POSTGRES_DB ?? "ns_roosterplatform";
const SHADOW = `${DATABASE}_shadow`;

/** Maakt de applicatiedatabase (en de shadow-database voor migraties) aan. */
async function createDatabasesIfMissing(): Promise<void> {
  const client = new Client({
    host: "127.0.0.1",
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: "postgres",
  });
  await client.connect();
  try {
    for (const name of [DATABASE, SHADOW]) {
      const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (existing.rowCount === 0) {
        await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
        console.log(`Database "${name}" aangemaakt.`);
      }
    }
  } finally {
    await client.end();
  }
}

async function up(): Promise<void> {
  if (await portInUse(PORT)) {
    // Bezet betekent niet vanzelf "ons cluster draait al": op een machine met
    // meerdere projecten kan hier iets anders luisteren. Doorgaan is dan
    // gevaarlijk, want we zouden migraties op een vreemde database draaien.
    if (clusterExists(DATA_DIR) && clusterRunning(DATA_DIR)) {
      console.log(`PostgreSQL luistert al op 127.0.0.1:${PORT} — ongemoeid gelaten.`);
      return;
    }
    throw new Error(
      [
        `Poort ${PORT} is bezet, maar niet door het cluster van dit project (${DATA_DIR}).`,
        "Kies een vrije poort via DEV_PGPORT in .env en pas DATABASE_URL mee aan.",
      ].join("\n"),
    );
  }

  const fresh = !clusterExists(DATA_DIR);
  if (fresh) {
    console.log(`Nieuw PostgreSQL-cluster initialiseren in ${DATA_DIR} ...`);
    initCluster({ dataDir: DATA_DIR, user: USER, password: PASSWORD });
  }

  startCluster({ dataDir: DATA_DIR, port: PORT, logFile: LOG_FILE });
  if (!(await waitForPort(PORT, true))) {
    throw new Error(`PostgreSQL luistert niet op poort ${PORT}. Zie ${LOG_FILE}.`);
  }
  await createDatabasesIfMissing();

  console.log(`PostgreSQL draait op 127.0.0.1:${PORT} (data: ${DATA_DIR})`);
  console.log(`Log: ${LOG_FILE}`);
  console.log("Blijft draaien na dit commando. Stoppen met: npm run db:down");
}

async function status(): Promise<void> {
  const listening = await portInUse(PORT);
  const initialised = clusterExists(DATA_DIR);
  const running = initialised ? clusterRunning(DATA_DIR) : false;

  console.log(`datadirectory   ${DATA_DIR}`);
  console.log(`geïnitialiseerd ${initialised ? "ja" : "nee"}`);
  console.log(`pg_ctl          ${running ? "server draait" : "geen server"}`);
  console.log(`luistert        ${listening ? `ja (127.0.0.1:${PORT})` : "nee"}`);
  console.log(`database        ${DATABASE}`);

  if (running && !listening) {
    console.log("\nDe postmaster leeft maar antwoordt niet — controleer het log.");
    process.exitCode = 1;
    return;
  }
  if (!listening) {
    console.log("\nStarten met: npm run db:up");
    process.exitCode = 1;
  }
}

function down(): void {
  if (!clusterExists(DATA_DIR)) {
    console.log(`Geen cluster in ${DATA_DIR}.`);
    return;
  }
  const result = stopCluster(DATA_DIR);
  console.log(result.output || (result.ok ? "Gestopt." : "Stoppen mislukt."));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  switch (command) {
    case "up":
      await up();
      break;
    case "status":
      await status();
      break;
    case "down":
      down();
      break;
    default:
      console.error(`Onbekend commando: ${command}. Gebruik up | status | down.`);
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
