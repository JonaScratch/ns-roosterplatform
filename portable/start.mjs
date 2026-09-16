import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * De starter van het draagbare NS Roosterplatform.
 *
 * ## Waarom dit één bestand is
 *
 * Dit script draait op een computer waar niets van dit project op staat. Er is
 * geen npm om iets te installeren, geen buildstap, geen pakket dat ontbreekt.
 * Alles wat hier gebeurt, gebeurt met wat er in de map naast staat.
 *
 * ## Waarom alle paden vanaf dit bestand worden gerekend
 *
 * De stick krijgt op de ene computer letter E: en op de andere G:, en de map
 * kan "NS Roosterplatform (kopie)" heten. Elk absoluut pad in dit script zou
 * daarop stukgaan, en elk pad met een spatie erin zou zonder aanhalingstekens
 * halverwege afbreken. Daarom staat er nergens een letter en staat elk pad
 * tussen aanhalingstekens.
 *
 * ## Waarom er zoveel wordt gecontroleerd voordat er iets start
 *
 * Een half gestarte omgeving is erger dan een die weigert: iemand ziet een
 * scherm, denkt dat het werkt, en ontdekt pas bij het opslaan dat de database
 * er niet is. Alles wat mis kan zijn — geen schrijfrechten, poort bezet, een
 * tweede exemplaar dat al draait — wordt daarom vóóraf vastgesteld en in
 * gewone taal gemeld.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
// Dit bestand staat in de wortel van de bundel, naast de .bat-bestanden.
// Eerder stond hier `path.resolve(HIER, "..")`, en dan wees alles één map te
// hoog: het startscript zocht de applicatie naast de bundel in plaats van erin.
const WORTEL = HIER;

const MAPPEN = {
  app: path.join(WORTEL, "app"),
  runtime: path.join(WORTEL, "runtime"),
  database: path.join(WORTEL, "database"),
  config: path.join(WORTEL, "config"),
  logs: path.join(WORTEL, "logs"),
  exports: path.join(WORTEL, "exports"),
  backups: path.join(WORTEL, "backups"),
};

const GRENDEL = path.join(MAPPEN.logs, "draait.lock");
const LOGBESTAND = path.join(MAPPEN.logs, "start.log");

/**
 * Een regel naar het scherm en meteen naar het logbestand.
 *
 * Met een schrijfstroom bleef het logboek leeg zolang de buffer niet vol was.
 * Dat is precies verkeerd om: het logboek wordt gelezen wanneer het starten
 * vastloopt, en dan staat er nog niets in. Elke regel gaat daarom onmiddellijk
 * naar de schijf. Het zijn er hooguit twintig per start; dat kost niets en het
 * scheelt iemand een avond zoeken.
 */
function meld(regel) {
  const tijd = new Date().toISOString().replace("T", " ").slice(0, 19);
  const tekst = `${tijd}  ${regel}`;
  console.log(tekst);
  try {
    appendFileSync(LOGBESTAND, `${tekst}\n`, "utf8");
  } catch {
    // Kan het logbestand niet worden geschreven, dan is het scherm alles wat er
    // is. Dat is geen reden om het starten af te breken.
  }
}

function stop(regel, uitleg) {
  meld(`FOUT: ${regel}`);
  if (uitleg) {
    meld(`      ${uitleg}`);
  }
  meld("");
  meld("Het platform is niet gestart. Er is niets gewijzigd.");
  process.exitCode = 1;
}

/** Leest config/instellingen.env, zonder afhankelijkheid van dotenv. */
function leesInstellingen() {
  const bestand = path.join(MAPPEN.config, "instellingen.env");
  const waarden = {};
  if (!existsSync(bestand)) {
    return waarden;
  }
  for (const regel of readFileSync(bestand, "utf8").split(/\r?\n/)) {
    const schoon = regel.trim();
    if (schoon === "" || schoon.startsWith("#")) {
      continue;
    }
    const scheiding = schoon.indexOf("=");
    if (scheiding > 0) {
      waarden[schoon.slice(0, scheiding).trim()] = schoon
        .slice(scheiding + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
    }
  }
  return waarden;
}

/** Is er iets dat luistert op deze poort? */
function poortBezet(poort) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const klaar = (bezet) => {
      socket.destroy();
      resolve(bezet);
    };
    socket.setTimeout(800);
    socket.once("connect", () => klaar(true));
    socket.once("timeout", () => klaar(false));
    socket.once("error", () => klaar(false));
    socket.connect(poort, "127.0.0.1");
  });
}

async function wachtOpPoort(poort, seconden) {
  for (let poging = 0; poging < seconden * 2; poging += 1) {
    if (await poortBezet(poort)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Draait er nog een exemplaar? Een verweesde grendel wordt opgeruimd. */
function grendelInGebruik() {
  if (!existsSync(GRENDEL)) {
    return false;
  }
  const inhoud = Number(readFileSync(GRENDEL, "utf8").trim());
  if (!Number.isInteger(inhoud)) {
    return false;
  }
  try {
    // Signaal 0 verandert niets; het zegt alleen of het proces nog bestaat.
    process.kill(inhoud, 0);
    return true;
  } catch {
    meld(`Er stond nog een grendel van proces ${inhoud}, maar dat draait niet meer.`);
    return false;
  }
}

function schrijfbaar(map) {
  try {
    mkdirSync(map, { recursive: true });
    const proef = path.join(map, `.schrijftest-${process.pid}`);
    writeFileSync(proef, "x");
    spawnSync(process.execPath, ["-e", `require('node:fs').unlinkSync(${JSON.stringify(proef)})`]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(MAPPEN.logs, { recursive: true });

  meld("═".repeat(64));
  meld("NS Roosterplatform — draagbare versie");
  meld(`Map: ${WORTEL}`);
  meld("═".repeat(64));

  // ── 1. Staat alles er? ───────────────────────────────────────────────────
  const server = path.join(MAPPEN.app, "server.js");
  const postgresBin = path.join(MAPPEN.runtime, "postgres", "bin");
  const pgCtl = path.join(postgresBin, "pg_ctl.exe");
  const initdb = path.join(postgresBin, "initdb.exe");

  for (const [wat, pad] of [
    ["de applicatie", server],
    ["de databaseserver", pgCtl],
  ]) {
    if (!existsSync(pad)) {
      stop(
        `${wat} ontbreekt.`,
        `Verwacht op: ${pad}. Kopieer de map opnieuw van de originele stick; ` +
          "waarschijnlijk is het kopiëren afgebroken.",
      );
      return;
    }
  }

  // ── 2. Mag er geschreven worden? ─────────────────────────────────────────
  for (const [naam, map] of Object.entries(MAPPEN)) {
    if (naam === "app" || naam === "runtime") {
      continue;
    }
    if (!schrijfbaar(map)) {
      stop(
        `Er kan niet geschreven worden in ${map}.`,
        "Staat de stick op alleen-lezen, of draait dit vanaf een cd? Het platform " +
          "moet zijn database, logbestanden en exports kwijt kunnen.",
      );
      return;
    }
  }

  // ── 3. Draait er al een exemplaar? ───────────────────────────────────────
  if (grendelInGebruik()) {
    stop(
      "Het platform draait al.",
      "Sluit het eerst af met \"Stop NS Roosterplatform.bat\" en probeer het opnieuw. " +
        "Twee exemplaren op dezelfde database geven tegenstrijdige uitkomsten.",
    );
    return;
  }
  writeFileSync(GRENDEL, String(process.pid), "utf8");

  const instellingen = leesInstellingen();
  const webPoort = Number(instellingen.PORT ?? 3300);
  const dbPoort = Number(instellingen.DB_PORT ?? 5434);

  // Het sessiegeheim wordt bij de eerste start op deze stick aangemaakt en
  // daarna bewaard. Eén vast geheim in de bundel zou betekenen dat elke kopie
  // van de stick elkaars sessiecookies kan namaken.
  const geheimBestand = path.join(MAPPEN.config, "sessiegeheim.txt");
  if (!instellingen.SESSION_SECRET) {
    if (!existsSync(geheimBestand)) {
      writeFileSync(geheimBestand, randomBytes(48).toString("base64url"), "utf8");
      meld("Een nieuw sessiegeheim is aangemaakt voor deze installatie.");
    }
    instellingen.SESSION_SECRET = readFileSync(geheimBestand, "utf8").trim();
  }

  // ── 4. Is de poort vrij? ─────────────────────────────────────────────────
  for (const [wat, poort] of [
    ["de webserver", webPoort],
    ["de database", dbPoort],
  ]) {
    if (await poortBezet(poort)) {
      stop(
        `Poort ${poort} is al in gebruik (${wat}).`,
        "Er draait iets anders op deze computer dat dezelfde poort gebruikt. Pas " +
          `PORT of DB_PORT aan in config\\instellingen.env, of sluit dat programma af.`,
      );
      return;
    }
  }

  // ── 5. De database ───────────────────────────────────────────────────────
  // Waar de database staat.
  //
  // Standaard in de bundel zelf, want dat is het hele punt van een draagbare
  // versie. Met DATA_DIR in de instellingen kan het ergens anders heen: op een
  // trage stick is een map op de harde schijf merkbaar sneller, en bij het
  // beproeven van de herstelbaarheid is een verse map nodig.
  const dataDir = instellingen.DATA_DIR
    ? path.resolve(WORTEL, instellingen.DATA_DIR)
    : path.join(MAPPEN.database, "pgdata");
  const wachtwoordBestand = path.join(MAPPEN.config, "db-wachtwoord.txt");
  const dbWachtwoord = existsSync(wachtwoordBestand)
    ? readFileSync(wachtwoordBestand, "utf8").trim()
    : "roosterplatform";

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    meld("Eerste start: de database wordt aangemaakt. Dit duurt ongeveer een minuut.");
    if (!existsSync(wachtwoordBestand)) {
      writeFileSync(wachtwoordBestand, dbWachtwoord, "utf8");
    }
    // De datamap niet zelf aanmaken.
    //
    // Bestaat hij al, dan gaat initdb eerst "fixing permissions on existing
    // directory" doen, en dat blijft op Windows hangen. Alleen de bovenliggende
    // map wordt klaargezet; de datamap maakt initdb zelf, precies zoals de
    // ontwikkelomgeving het ook doet.
    mkdirSync(path.dirname(dataDir), { recursive: true });
    const gemaakt = spawnSync(
      initdb,
      [
        `--pgdata=${dataDir}`,
        "--auth=scram-sha-256",
        "--username=postgres",
        `--pwfile=${wachtwoordBestand}`,
        // UTF-8 afdwingen. De Windows-systeemlocale levert anders een
        // WIN1252-cluster op, waarin elke rij met een teken buiten Latin-1 niet
        // ingevoegd kan worden — en Nederlandse roosternamen hebben die.
        "--encoding=UTF8",
        "--locale=C",
      ],
      // stdin uitdrukkelijk dicht.
      //
      // Met een open pijp op stdin blijft initdb wachten op invoer die nooit
      // komt, en dan hangt de start zonder één melding. Dat is hier ook echt
      // gebeurd: minutenlang "de database wordt aangemaakt" en verder niets.
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    if (gemaakt.status !== 0) {
      stop("De database kon niet worden aangemaakt.", `${gemaakt.stdout ?? ""}${gemaakt.stderr ?? ""}`.slice(0, 400));
      return;
    }
  }

  meld("De database wordt gestart…");
  const pgLog = path.join(MAPPEN.logs, "database.log");

  // Kan er in het serverlog geschreven worden?
  //
  // Zo niet, dan weigert pg_ctl te starten en zegt daar niets zinnigs over; de
  // melding zou dan "kijk in database.log" zijn, terwijl juist dát bestand het
  // probleem is. Dat komt voor wanneer een eerdere database nog draait en het
  // bestand vasthoudt, of wanneer een virusscanner het open heeft.
  try {
    appendFileSync(pgLog, "");
  } catch (fout) {
    stop(
      `Het serverlogboek ${pgLog} kan niet worden beschreven.`,
      "Waarschijnlijk houdt een ander programma het bestand vast — vaak een " +
        "database van een vorige keer die nog draait. Sluit die af, of hernoem het " +
        `bestand. (${String(fout).slice(0, 120)})`,
    );
    return;
  }
  const gestart = spawnSync(
    pgCtl,
    [
      "-D",
      dataDir,
      "-l",
      pgLog,
      "-o",
      // Uitsluitend localhost. Zonder deze regel luistert de database op elk
      // netwerkadres, en dan staan de roostergegevens open zodra de laptop op
      // een wifi zit.
      `-p ${dbPoort} -c listen_addresses=127.0.0.1 -c fsync=on -c full_page_writes=on`,
      "start",
    ],
    // Geen pipes en geen `-w`.
    //
    // De opgestarte server erft de pijpen van pg_ctl en sluit ze nooit. Wie hier
    // stdout laat opvangen, krijgt een aanroep die niet terugkeert — het starten
    // bleef daar hangen zonder één melding. Waarom een start mislukt, staat in
    // het serverlog en niet op stdout; of hij gelukt is, blijkt uit de poort,
    // en dat wordt hieronder gewoon gecontroleerd.
    { stdio: "ignore", windowsHide: true },
  );
  if (gestart.status !== 0) {
    stop("De database is niet gestart.", `Kijk in ${pgLog}.`);
    return;
  }
  if (!(await wachtOpPoort(dbPoort, 30))) {
    stop("De database antwoordt niet.", `Kijk in ${pgLog}.`);
    return;
  }
  meld(`De database draait op 127.0.0.1:${dbPoort}.`);

  const databaseUrl =
    instellingen.DATABASE_URL ??
    `postgresql://postgres:${encodeURIComponent(dbWachtwoord)}@127.0.0.1:${dbPoort}/ns_roosterplatform`;

  // ── 6. Schema bijwerken ──────────────────────────────────────────────────
  const migratieScript = path.join(MAPPEN.app, "portable-migrate.mjs");
  if (existsSync(migratieScript)) {
    meld("De databasestructuur wordt gecontroleerd…");
    const migratie = spawnSync(process.execPath, [migratieScript], {
      cwd: MAPPEN.app,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    if (migratie.status !== 0) {
      stop(
        "De databasestructuur kon niet worden bijgewerkt.",
        `${migratie.stdout ?? ""}${migratie.stderr ?? ""}`.trim().slice(0, 500),
      );
      afsluitenDatabase(pgCtl, dataDir);
      return;
    }
    meld((migratie.stdout ?? "").trim().split("\n").slice(-1)[0] || "Structuur is bij.");
  }

  // ── 6b. Demonstratiegegevens bij een lege database ───────────────────────
  //
  // Een lege database betekent: geen enkel account, dus niemand kan inloggen en
  // het platform toont een aanmeldscherm waar je nooit doorheen komt. Bij de
  // allereerste start worden daarom de meegeleverde demonstratiegegevens
  // ingeladen — één keer, en alleen wanneer er werkelijk nog niets staat.
  const zaaiScript = path.join(MAPPEN.app, "portable-seed.mjs");
  if (existsSync(zaaiScript)) {
    const gezaaid = spawnSync(process.execPath, [zaaiScript], {
      cwd: MAPPEN.app,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 256 * 1024 * 1024,
    });
    if (gezaaid.status !== 0) {
      meld("LET OP: de demonstratiegegevens konden niet worden ingeladen.");
      meld(`      ${String(gezaaid.stderr ?? "").trim().slice(0, 300)}`);
      meld("      Het platform start wel, maar er is nog geen account om mee in te loggen.");
    } else {
      meld(String(gezaaid.stdout ?? "").trim().split(String.fromCharCode(10)).slice(-1)[0]);
    }
  }
  // ── 7. De webserver ──────────────────────────────────────────────────────
  meld("De applicatie wordt gestart…");
  const appLog = createWriteStream(path.join(MAPPEN.logs, "applicatie.log"), { flags: "a" });
  const web = spawn(process.execPath, [server], {
    cwd: MAPPEN.app,
    env: {
      ...process.env,
      ...instellingen,
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      // Uitsluitend localhost: geen enkel ander apparaat in het netwerk kan erbij.
      HOSTNAME: "127.0.0.1",
      PORT: String(webPoort),
      NS_EXPORT_DIR: MAPPEN.exports,
      NS_LOG_DIR: MAPPEN.logs,
      NS_PYTHON: path.join(MAPPEN.runtime, "python", "python.exe"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  web.stdout.pipe(appLog);
  web.stderr.pipe(appLog);

  if (!(await wachtOpPoort(webPoort, 60))) {
    stop("De applicatie is niet opgestart.", `Kijk in ${path.join(MAPPEN.logs, "applicatie.log")}.`);
    web.kill();
    afsluitenDatabase(pgCtl, dataDir);
    return;
  }

  const adres = `http://127.0.0.1:${webPoort}`;
  meld(`Het platform draait op ${adres}`);
  meld("");
  meld("LET OP: dit is een demonstratieomgeving.");
  meld("Zet er geen echte persoonsgegevens in zolang NS de beveiliging niet heeft");
  meld("beoordeeld. De gegevens staan onversleuteld op deze schijf en gaan mee met");
  meld("de stick.");
  meld("");
  meld("Afsluiten: sluit dit venster of gebruik \"Stop NS Roosterplatform.bat\".");

  // De browser openen mag mislukken; dat is geen reden om te stoppen.
  spawn("cmd", ["/c", "start", "", adres], { detached: true, stdio: "ignore" }).unref();

  // ── 8. Netjes afsluiten ──────────────────────────────────────────────────
  const afsluiten = () => {
    meld("Afsluiten…");
    try {
      web.kill();
    } catch {
      /* al weg */
    }
    afsluitenDatabase(pgCtl, dataDir);
    try {
      spawnSync(process.execPath, [
        "-e",
        `require('node:fs').existsSync(${JSON.stringify(GRENDEL)}) && require('node:fs').unlinkSync(${JSON.stringify(GRENDEL)})`,
      ]);
    } catch {
      /* niets */
    }
    meld("Afgesloten.");
    process.exit(0);
  };

  process.on("SIGINT", afsluiten);
  process.on("SIGTERM", afsluiten);
  web.on("exit", (code) => {
    meld(`De applicatie is gestopt (code ${code}).`);
    afsluiten();
  });
}

/**
 * De database netjes stoppen.
 *
 * `-m fast` en niet `-m immediate`: fast rolt lopende transacties terug en
 * schrijft de buffers weg. Immediate laat een vuile map achter die bij de
 * volgende start moet worden hersteld — dat werkt, maar het kost tijd en het
 * hoeft niet.
 */
function afsluitenDatabase(pgCtl, dataDir) {
  try {
    spawnSync(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "-t", "30", "stop"], {
      encoding: "utf8",
    });
  } catch {
    /* de database was al weg */
  }
}

main().catch((fout) => {
  stop("Er is iets onverwachts misgegaan.", String(fout));
});
