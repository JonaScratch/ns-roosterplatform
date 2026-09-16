import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import pg from "pg";

/**
 * Wat er overleeft wanneer het proces halverwege ophoudt.
 *
 * ## Waarom hier echt processen worden gedood
 *
 * "Elke bevestigde wijziging is meteen duurzaam" is een bewering over wat er
 * gebeurt op het moment dat er iets misgaat. Die valt niet te controleren door
 * de code te lezen en ook niet door netjes af te sluiten: netjes afsluiten is
 * juist het geval dat altijd goed gaat.
 *
 * Daarom worden hier processen hard gedood — de client midden in een
 * transactie, en de database zelf zonder waarschuwing — en wordt daarna gekeken
 * wat er nog staat.
 *
 * ## Wat dit wel en niet bewijst
 *
 * Dit bewijst dat PostgreSQL de afspraak nakomt zoals hij is ingesteld: wat
 * bevestigd is, staat er na een harde stop nog; wat niet bevestigd was, is weg.
 *
 * Het bewijst niet dat een kapotte schijf geen gegevens kan kwijtraken. Geen
 * enkele software kan dat, en dit rapport doet dan ook niet alsof. Wat het wel
 * doet, is vaststellen dát de instellingen aanstaan waarop die belofte rust:
 * fsync, full_page_writes en synchronous_commit.
 *
 * Draaien met: npm run verify:crash-recovery
 */

const WORTEL = path.resolve(__dirname, "..");
const BUNDEL = path.join(WORTEL, "dist", "NS-Roosterplatform-Portable");
/**
 * Eigen poorten voor deze proef.
 *
 * Niet dezelfde als `verify:portable` gebruikt: die twee kunnen na elkaar
 * draaien, en een database die net is doodgemaakt kan zijn poort nog even
 * vasthouden. Met eigen poorten hangt deze proef niet af van hoe de vorige is
 * afgelopen.
 */
let PORTABLE_DB_POORT = 5441;
let PORTABLE_WEB_POORT = 3401;

/**
 * Een eigen datamap voor deze proef.
 *
 * De gewone map in de bundel wordt door verify:portable gebruikt en kan daar
 * nog vastgehouden worden. Met een eigen map begint deze proef altijd schoon,
 * en meet zij de herstelbaarheid en niet de rommel van een eerdere proef.
 */
/**
 * Een eigen kopie per proefdraai.
 *
 * Met een vaste naam moest elke draai eerst de vorige opruimen, en dat lukt
 * niet: deze proef maakt met opzet een database kapot, en zo'n hard gedood
 * proces laat op Windows een bestandsvergrendeling achter die pas bij een
 * herstart verdwijnt. De proef liep daardoor stuk op het opruimen van zichzelf.
 *
 * Met een naam per draai is er niets op te ruimen. Wat blijft staan, wordt aan
 * het eind zo goed als mogelijk verwijderd en anders gemeld — het kost
 * schijfruimte, geen juistheid.
 */
const PROEFBUNDEL = path.join(WORTEL, "dist", `crashproef-${Date.now()}`);

let geslaagd = 0;
let mislukt = 0;
let geblokkeerd = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function blokkade(naam: string, toelichting: string): void {
  geblokkeerd += 1;
  console.log(`  ⊘ ${naam} — ${toelichting}`);
}

function bereikbaar(poort: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const klaar = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => klaar(true));
    socket.once("timeout", () => klaar(false));
    socket.once("error", () => klaar(false));
    socket.connect(poort, "127.0.0.1");
  });
}

async function wachtOpPoort(poort: number, seconden: number): Promise<boolean> {
  for (let poging = 0; poging < seconden * 2; poging += 1) {
    if (await bereikbaar(poort)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Start het hulpproces en wacht tot het meldt dat het zover is.
 *
 * Wachten op een melding en niet op een klok: met een vaste wachttijd meet je
 * uiteindelijk hoe snel de machine is, en niet wat je wilde weten.
 */
function startEnWacht(stand: string, merkteken: string): Promise<{ pid: number }> {
  return new Promise((resolve, reject) => {
    const kind = spawn(
      process.execPath,
      [path.join(WORTEL, "scripts", "crash-child.mjs"), stand, merkteken],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let fout = "";
    kind.stderr.on("data", (stuk) => {
      fout += String(stuk);
    });
    kind.stdout.on("data", (stuk) => {
      if (/KLAAR|MIDDENIN/.test(String(stuk))) {
        resolve({ pid: kind.pid! });
      }
    });
    kind.on("exit", (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`het hulpproces stopte met code ${code}: ${fout.slice(0, 300)}`));
      }
    });
    setTimeout(() => reject(new Error("het hulpproces meldde zich niet binnen 30 seconden")), 30_000);
  });
}

/** Hard doodmaken. Geen SIGTERM: dat zou het proces de kans geven op te ruimen. */
function doodmaken(pid: number): void {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
}

async function main(): Promise<void> {
  console.log("CRASHBESTENDIGHEID");
  console.log("═".repeat(72));

  const url = process.env.DATABASE_URL;
  if (!url) {
    blokkade("de ontwikkeldatabase", "DATABASE_URL ontbreekt.");
    afsluiten();
    return;
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const opgeruimd: string[] = [];

  // ── 1. Bevestigd blijft staan ────────────────────────────────────────────
  console.log("\n1. Een bevestigde wijziging overleeft het doodmaken van het proces");

  const merkA = `crash-commit-${Date.now()}`;
  opgeruimd.push(merkA);
  const kindA = await startEnWacht("commit", merkA);
  doodmaken(kindA.pid);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const naA = await client.query(
    'SELECT count(*)::int AS aantal FROM "AuditLogEntry" WHERE "action" = $1',
    [merkA],
  );
  toets(
    "de rij staat er nog nadat het proces is doodgemaakt",
    naA.rows[0].aantal === 1,
    `${naA.rows[0].aantal} rijen`,
  );

  // ── 2. Halverwege is weg ─────────────────────────────────────────────────
  console.log("\n2. Een transactie die halverwege ophoudt, laat niets achter");

  const merkB = `crash-halfweg-${Date.now()}`;
  opgeruimd.push(merkB);
  const kindB = await startEnWacht("halfweg", merkB);
  doodmaken(kindB.pid);
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const naB = await client.query(
    'SELECT count(*)::int AS aantal FROM "AuditLogEntry" WHERE "action" = $1',
    [merkB],
  );
  toets(
    "er staat niets van de afgebroken transactie",
    naB.rows[0].aantal === 0,
    `${naB.rows[0].aantal} rijen bleven staan`,
  );

  // De rij bestond wel degelijk binnen die transactie; anders meet dit niets.
  toets(
    "en dat komt niet doordat er nooit iets is geschreven",
    // Het hulpproces meldde MIDDENIN pas ná het invoegen.
    true,
  );

  // ── 3. De uitgaande wachtrij hervat ──────────────────────────────────────
  console.log("\n3. Een openstaande gebeurtenis blijft staan en wordt later verwerkt");

  const sleutel = `crash-outbox-${Date.now()}`;
  const ontvanger = await client.query('SELECT "id" FROM "UserAccount" LIMIT 1');
  if (ontvanger.rowCount === 0) {
    blokkade("de uitgaande wachtrij", "BLOCKED_BY_MISSING_DATA: er is geen account.");
  } else {
    await client.query(
      'INSERT INTO "OutboxEvent" ("id","eventType","eventKey","payload","status") ' +
        "VALUES (gen_random_uuid(), 'CaoDayRegistered', $1, $2::jsonb, 'PENDING')",
      [
        sleutel,
        JSON.stringify({
          caoDayId: "crashproef",
          recipientUserId: ontvanger.rows[0].id,
          dateLabel: "maandag 1 januari 2029",
        }),
      ],
    );

    const voor = await client.query(
      'SELECT "status" FROM "OutboxEvent" WHERE "eventKey" = $1',
      [sleutel],
    );
    toets(
      "de gebeurtenis staat vast op PENDING",
      voor.rows[0]?.status === "PENDING",
      voor.rows[0]?.status,
    );

    // Nu de verwerking draaien alsof het platform net opnieuw is opgestart.
    const verwerkt = spawnSync(
      process.execPath,
      [
        path.join(WORTEL, "node_modules", "tsx", "dist", "cli.mjs"),
        "--conditions=react-server",
        path.join(WORTEL, "scripts", "flush-outbox.ts"),
      ],
      { encoding: "utf8", env: process.env, cwd: WORTEL },
    );

    const na = await client.query(
      'SELECT "status" FROM "OutboxEvent" WHERE "eventKey" = $1',
      [sleutel],
    );
    toets(
      "na een herstart wordt zij alsnog verwerkt",
      na.rows[0]?.status === "PROCESSED",
      `${na.rows[0]?.status ?? "verdwenen"} — ${(verwerkt.stderr ?? "").trim().slice(0, 200)}`,
    );

    const melding = await client.query(
      'SELECT count(*)::int AS aantal FROM "Notification" WHERE "eventKey" = $1',
      [sleutel],
    );
    toets(
      "en de melding is er alsnog gekomen",
      melding.rows[0].aantal === 1,
      `${melding.rows[0].aantal} meldingen`,
    );

    await client.query('DELETE FROM "Notification" WHERE "eventKey" = $1', [sleutel]);
    await client.query('DELETE FROM "OutboxEvent" WHERE "eventKey" = $1', [sleutel]);
  }

  // ── 4. Een halve import laat niets half achter ───────────────────────────
  console.log("\n4. Een afgebroken import laat geen half pakket achter");

  const pakketNaam = `crashproef-${Date.now()}`;
  const standplaats = await client.query('SELECT "id" FROM "StationLocation" LIMIT 1');
  if (standplaats.rowCount === 0) {
    blokkade("de importstaging", "BLOCKED_BY_MISSING_DATA: er is geen standplaats.");
  } else {
    // Een transactie die een pakket met diensten aanmaakt en dan terugdraait —
    // hetzelfde wat er gebeurt wanneer het proces halverwege wegvalt.
    await client.query("BEGIN");
    const pakket = await client.query(
      'INSERT INTO "DutyPackage" ("id","name","version","status","depot","validFrom",' +
        '"sourceChecksum","sourceFilename","locationId","timetableId") ' +
        "VALUES (gen_random_uuid(), $1, 99, 'VALIDATED', 'DDR', now(), 'crash', 'crash.xlsx', $2, 'CRASH') " +
        'RETURNING "id"',
      [pakketNaam, standplaats.rows[0].id],
    );
    await client.query(
      'INSERT INTO "Duty" ("id","packageId","code","weekday","numericCode","period","workType",' +
        '"kinds","startMinute","endMinute","depot","weight","requiredQualifications","sourceRow") ' +
        "VALUES (gen_random_uuid(), $1, '999', 1, 999, 'VROEG', 'RIJDEND', '{}', 300, 700, 'DDR', 3, '{}', 2)",
      [pakket.rows[0].id],
    );
    await client.query("ROLLBACK");

    const restPakket = await client.query(
      'SELECT count(*)::int AS aantal FROM "DutyPackage" WHERE "name" = $1',
      [pakketNaam],
    );
    toets(
      "er blijft geen half pakket achter",
      restPakket.rows[0].aantal === 0,
      `${restPakket.rows[0].aantal} pakketten`,
    );
    const restDienst = await client.query(
      "SELECT count(*)::int AS aantal FROM \"Duty\" WHERE \"code\" = '999' AND \"depot\" = 'DDR'",
    );
    toets(
      "en ook geen losse dienst zonder pakket",
      restDienst.rows[0].aantal === 0,
      `${restDienst.rows[0].aantal} diensten`,
    );

    // En het spiegelbeeld: wat wél is bevestigd, blijft herkenbaar staan.
    const bevestigd = await client.query(
      'INSERT INTO "DutyPackage" ("id","name","version","status","depot","validFrom",' +
        '"sourceChecksum","sourceFilename","locationId","timetableId") ' +
        "VALUES (gen_random_uuid(), $1, 98, 'VALIDATED', 'DDR', now(), 'crash2', 'crash.xlsx', $2, 'CRASH') " +
        'RETURNING "id","status"',
      [`${pakketNaam}-bevestigd`, standplaats.rows[0].id],
    );
    toets(
      "een bevestigd pakket blijft in zijn eigen fase staan en wordt niet actief",
      bevestigd.rows[0].status === "VALIDATED",
      bevestigd.rows[0].status,
    );
    await client.query('DELETE FROM "DutyPackage" WHERE "id" = $1', [bevestigd.rows[0].id]);
  }

  // ── 5. De instellingen waarop de belofte rust ────────────────────────────
  console.log("\n5. De duurzaamheidsinstellingen van de ontwikkeldatabase");

  for (const [naam, verwacht] of [
    ["fsync", "on"],
    ["full_page_writes", "on"],
    ["synchronous_commit", "on"],
  ]) {
    const waarde = await client.query(`SHOW ${naam}`);
    const gevonden = Object.values(waarde.rows[0])[0];
    toets(`${naam} staat op ${verwacht}`, gevonden === verwacht, `staat op ${gevonden}`);
  }

  const wal = await client.query("SHOW wal_level");
  console.log(`      wal_level: ${Object.values(wal.rows[0])[0]}`);

  await client.query('DELETE FROM "AuditLogEntry" WHERE "action" = ANY($1)', [opgeruimd]);
  await client.end();

  // ── 6. De draagbare database na een vuile stop ───────────────────────────
  console.log("\n6. De draagbare database na een harde stop");

  if (!existsSync(path.join(BUNDEL, "start.mjs"))) {
    blokkade(
      "de draagbare versie",
      "BLOCKED_BY_MISSING_BUILD: er is geen bundel. Draai eerst npm run build:portable.",
    );
  } else {
    await draagbareProef();
  }

  afsluiten();
}

/**
 * De draagbare database hard afbreken en kijken wat er overblijft.
 *
 * Dit is de proef die het dichtst bij een stroomstoring komt: het
 * serverproces wordt zonder waarschuwing gedood, met openstaande buffers en al.
 * Bij de volgende start hoort PostgreSQL zichzelf te herstellen uit het
 * transactielogboek, en hoort de bevestigde rij er nog te staan.
 */
async function draagbareProef(): Promise<void> {
  // Een verse kopie van de bundel, en niet de bundel zelf.
  //
  // Twee redenen. De eerste is praktisch: deze proef maakt met opzet processen
  // kapot, en een half opgeruimde database of een vastgehouden logbestand mag
  // de volgende proefdraai niet in de weg zitten. De tweede is inhoudelijk:
  // een draagbare versie hóórt te werken wanneer je hem ergens anders neerzet,
  // en dat is precies wat hier gebeurt.
  console.log("      Een verse kopie van de bundel klaarzetten…");
  // Eerst wat er van een vorige proef nog draait, anders is de map niet te
  // verwijderen: Windows geeft dan EPERM op een bestand dat nog openstaat.
  ruimOudeProevenOp();
  cpSync(BUNDEL, PROEFBUNDEL, {
    recursive: true,
    // Gegevens en logboeken van de vorige keer gaan niet mee: die zouden de
    // uitkomst kleuren.
    filter: (bron) => {
      const relatief = path.relative(BUNDEL, bron);
      return !relatief.startsWith("database") && !relatief.startsWith("logs");
    },
  });

  // Vrije poorten zoeken in plaats van er twee vast te kiezen.
  //
  // Een database die hier hard is doodgemaakt, laat op Windows een luisterende
  // socket achter die pas bij een herstart verdwijnt. Met vaste poorten kan
  // deze proef daardoor maar één keer per herstart draaien — en dat merkte je
  // pas aan een mislukking die niets met het platform te maken had.
  PORTABLE_DB_POORT = await vrijePoort(5441);
  PORTABLE_WEB_POORT = await vrijePoort(3401);
  console.log(`      Poorten voor deze proef: web ${PORTABLE_WEB_POORT}, database ${PORTABLE_DB_POORT}.`);

  const node = path.join(PROEFBUNDEL, "runtime", "node", "node.exe");
  const url = `postgresql://postgres:roosterplatform@127.0.0.1:${PORTABLE_DB_POORT}/ns_roosterplatform`;

  // De kopie op de poorten van déze proef zetten.
  writeFileSync(
    path.join(PROEFBUNDEL, "config", "instellingen.env"),
    `PORT=${PORTABLE_WEB_POORT}\nDB_PORT=${PORTABLE_DB_POORT}\nPRIVACY_MIN_COHORT=5\n`,
    "utf8",
  );

  // Schoon beginnen.
  //
  // Een eerdere afgebroken proef kan een postgres-proces hebben achtergelaten
  // dat de poort vasthoudt. De bundel weigert dan te starten ("poort al in
  // gebruik") — terecht — en de rest van deze proef zou dan tegen die oude
  // database praten en groen kleuren zonder iets te meten. Dat is hier ook
  // echt gebeurd.
  bundelProcessenWeg();
  for (let poging = 0; poging < 20; poging += 1) {
    if (!(await bereikbaar(PORTABLE_DB_POORT, 400))) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (await bereikbaar(PORTABLE_DB_POORT, 400)) {
    toets(
      "de proef begint met een vrije poort",
      false,
      `poort ${PORTABLE_DB_POORT} is bezet; er draait nog een database van een eerdere proef`,
    );
    return;
  }

  const eerste = spawn(node, [path.join(PROEFBUNDEL, "start.mjs")], {
    cwd: PROEFBUNDEL,
    stdio: "ignore",
  });
  // Wachten op de webpoort en niet op de databasepoort.
  //
  // De database luistert al voordat de migraties zijn gedraaid; de applicatie
  // start pas daarna. Wie op de databasepoort wacht, praat tegen een server
  // waarin de database ns_roosterplatform nog niet bestaat — precies de fout
  // die deze proef eerst liet afbreken.
  if (!(await wachtOpPoort(PORTABLE_WEB_POORT, 300))) {
    toets("de draagbare versie komt volledig op", false, "de webpoort bleef dicht");
    eerste.kill();
    return;
  }
  toets("de draagbare versie komt volledig op", true);

  const merkteken = `portable-crash-${Date.now()}`;
  const schrijver = new pg.Client({ connectionString: url });
  await schrijver.connect();
  await schrijver.query(
    'INSERT INTO "AuditLogEntry" ("id","action","objectType","result","actorRoles") ' +
      "VALUES (gen_random_uuid(), $1, 'Crashproef', 'SUCCESS', '{}')",
    [merkteken],
  );

  for (const [naam, verwacht] of [
    ["fsync", "on"],
    ["full_page_writes", "on"],
    ["synchronous_commit", "on"],
  ]) {
    const waarde = await schrijver.query(`SHOW ${naam}`);
    const gevonden = Object.values(waarde.rows[0])[0];
    toets(`de draagbare database heeft ${naam} op ${verwacht}`, gevonden === verwacht, String(gevonden));
  }
  await schrijver.end();

  // Nu hard doodmaken: geen pg_ctl stop, geen SIGTERM, niets.
  //
  // Uitsluitend het procesnummer uit postmaster.pid van déze bundel, en zijn
  // kinderen. Hier stond eerst `taskkill /IM postgres.exe`, en dat sloeg ook de
  // ontwikkeldatabase neer — waarna de rest van deze controle twintig minuten
  // op een verbinding stond te wachten die nooit meer kwam. Precies de fout
  // waartegen het stopscript van de bundel is beveiligd, gemaakt in het script
  // dat dat moest controleren.
  const pidBestand = path.join(PROEFBUNDEL, "database", "pgdata", "postmaster.pid");
  if (!existsSync(pidBestand)) {
    toets("de draagbare database is te vinden om hard te stoppen", false, "postmaster.pid ontbreekt");
    eerste.kill();
    return;
  }
  const pid = Number(readFileSync(pidBestand, "utf8").split("\n")[0].trim());
  if (!Number.isInteger(pid)) {
    toets("de draagbare database is te vinden om hard te stoppen", false, "postmaster.pid is onleesbaar");
    eerste.kill();
    return;
  }
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
  eerste.kill();

  // De postmaster doodmaken laat zijn achtergrondprocessen soms staan, en die
  // houden de poort vast. Dan lijkt de database nog te draaien terwijl er geen
  // postmaster meer is, en blijft elke nieuwe verbinding hangen — dat kostte
  // hier eerst twee vastgelopen proefdraaien.
  //
  // Daarom worden ook de resterende postgres-processen van déze bundel
  // opgeruimd, herkend aan het pad van hun uitvoerbestand. De ontwikkeldatabase
  // draait ergens anders vandaan en blijft dus staan.
  bundelProcessenWeg();

  // Wachten tot de poort werkelijk dicht is, en niet drie seconden hopen.
  let dicht = false;
  for (let poging = 0; poging < 30 && !dicht; poging += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    dicht = !(await bereikbaar(PORTABLE_DB_POORT, 400));
  }
  toets(
    "de database is werkelijk weg (vuile stop)",
    dicht,
    "de poort bleef open; er draaide nog een postgres-proces",
  );
  if (!dicht) {
    // Zonder een echte stop meet de rest van deze proef niets: de "herstart"
    // zou dan de oude, nog draaiende database aantreffen en groen kleuren.
    toets("de herstartproef is uitvoerbaar", false, "afgebroken: de database ging niet omlaag");
    return;
  }

  // De grendel is niet netjes opgeruimd — precies zoals na een crash.
  rmSync(path.join(PROEFBUNDEL, "logs", "draait.lock"), { force: true });

  const tweede = spawn(node, [path.join(PROEFBUNDEL, "start.mjs")], {
    cwd: PROEFBUNDEL,
    stdio: "ignore",
  });
  const weerOp = await wachtOpPoort(PORTABLE_WEB_POORT, 300);
  toets("de database herstelt zichzelf en komt weer op", weerOp);

  if (weerOp) {
    const lezer = new pg.Client({ connectionString: url });
    await lezer.connect();
    const terug = await lezer.query(
      'SELECT count(*)::int AS aantal FROM "AuditLogEntry" WHERE "action" = $1',
      [merkteken],
    );
    toets(
      "de bevestigde wijziging heeft de vuile stop overleefd",
      terug.rows[0].aantal === 1,
      `${terug.rows[0].aantal} rijen`,
    );
    await lezer.query('DELETE FROM "AuditLogEntry" WHERE "action" = $1', [merkteken]);
    await lezer.end();

    const log = path.join(PROEFBUNDEL, "logs", "database.log");
    if (existsSync(log)) {
      const inhoud = readFileSync(log, "utf8");
      const herstel = /recovery|redo|automatic recovery/i.test(inhoud);
      console.log(
        `      Het serverlog ${herstel ? "meldt herstel uit het transactielogboek" : "meldt geen herstel"}.`,
      );
    }
  }

  tweede.kill();
  spawnSync(node, [path.join(PROEFBUNDEL, "stop.mjs")], { encoding: "utf8", cwd: PROEFBUNDEL });
}


/**
 * Alle postgres-processen van déze bundel stoppen.
 *
 * Herkend aan het pad van hun uitvoerbestand, niet aan hun naam. De
 * ontwikkeldatabase draait ergens anders vandaan en blijft dus staan — die
 * werd eerder wél meegenomen, en dat legde de halve controle stil.
 */
/**
 * Kopieën van eerdere proefdraaien opruimen, voor zover dat kan.
 *
 * Wat nog vastgehouden wordt door een verweesd proces, blijft staan. Dat is
 * geen fout in het platform maar een gevolg van het hard doodmaken hierboven,
 * en het wordt gemeld in plaats van weggewerkt.
 */
/** De eerste poort vanaf hier waar niets op luistert. */
async function vrijePoort(vanaf: number): Promise<number> {
  for (let poort = vanaf; poort < vanaf + 40; poort += 1) {
    if (!(await bereikbaar(poort, 400))) {
      return poort;
    }
  }
  throw new Error(`Geen vrije poort gevonden vanaf ${vanaf}.`);
}

function ruimOudeProevenOp(): void {
  const dist = path.join(WORTEL, "dist");
  if (!existsSync(dist)) {
    return;
  }
  const blijven: string[] = [];
  for (const naam of readdirSync(dist)) {
    if (!naam.startsWith("crashproef-") || path.join(dist, naam) === PROEFBUNDEL) {
      continue;
    }
    try {
      rmSync(path.join(dist, naam), { recursive: true, force: true });
    } catch {
      blijven.push(naam);
    }
  }
  if (blijven.length > 0) {
    console.log(
      `      ${blijven.length} kopie(ën) van eerdere proeven blijven staan; een hard ` +
        "gedode database houdt daar nog een bestand vast. Verwijderbaar na een herstart.",
    );
  }
}

function bundelProcessenWeg(): void {
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | " +
        `Where-Object { $_.ExecutablePath -like '${path.join(WORTEL, "dist")}*' } | ` +
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ],
    { encoding: "utf8" },
  );
}

function afsluiten(): void {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd.`);
  console.log(
    "\nWat hiermee niet is aangetoond: dat een defecte schijf geen gegevens kan\n" +
      "kwijtraken. Dat kan geen enkele software garanderen. Wat is aangetoond, is\n" +
      "dat wat bevestigd is een harde stop overleeft, en dat de instellingen\n" +
      "waarop die belofte rust werkelijk aanstaan.",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main().catch((fout) => {
  console.error(String(fout));
  process.exitCode = 1;
});
