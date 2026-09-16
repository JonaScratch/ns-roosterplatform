import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import pg from "pg";

/**
 * De draagbare bundel: draait hij écht, ergens anders, zonder iets erbij?
 *
 * ## Waarom dit de bundel werkelijk start
 *
 * Een controle die alleen kijkt of de bestanden er staan, bewijst dat er
 * bestanden staan. De vragen die ertoe doen — start het op een andere
 * schijfletter, overleeft een pad met spaties, luistert het alleen op
 * localhost, blijven de gegevens na een herstart staan — zijn alleen te
 * beantwoorden door het te doen.
 *
 * Daarom wordt hier met `subst` een tweede schijfletter gemaakt, met een
 * knooppunt een map met spaties in de naam, en wordt de bundel daarvandaan
 * gestart, gebruikt, gestopt en opnieuw gestart.
 *
 * ## Wat dit niet kan bewijzen
 *
 * Dat er op deze machine geen Node staat: die staat er, dit script draait erop.
 * Wat wél te meten is, is dat de bundel niets van buiten zichzelf aanroept: de
 * startbestanden wijzen uitsluitend naar `runtime\\`, en dat wordt hieronder
 * regel voor regel gecontroleerd. Een echt schone Windows-machine blijft een
 * aparte proef, en dat staat zo in het rapport.
 *
 * Draaien met: npm run verify:portable
 */

const WORTEL = path.resolve(__dirname, "..");
const ORIGINEEL = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(WORTEL, "dist", "NS-Roosterplatform-Portable");

/**
 * De kopie waarop wordt geproefd.
 *
 * Een draagbare versie hoort te werken wanneer je hem ergens anders neerzet —
 * dat is het hele idee. Op de kopie proeven meet dus precies de belofte, en
 * het houdt de gebouwde bundel schoon: die raakt anders vol met proefgegevens,
 * en een logbestand dat nog vastgehouden wordt door een eerdere proef legt de
 * volgende stil.
 */
const BUNDEL = path.join(WORTEL, "dist", "portableproef-bundel");

/** Poorten die niet botsen met de ontwikkelomgeving. */
const WEB_POORT = 3403;
const DB_POORT = 5443;

const PROEFLETTER = process.env.VERIFY_PORTABLE_DRIVE ?? "X:";
const PROEFMAP = "proef met spaties";

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

function bereikbaar(poort: number, host: string, timeoutMs = 1500): Promise<boolean> {
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
    socket.connect(poort, host);
  });
}

async function wacht(poort: number, host: string, seconden: number): Promise<boolean> {
  for (let poging = 0; poging < seconden * 2; poging += 1) {
    if (await bereikbaar(poort, host)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function weg(poort: number, seconden: number): Promise<boolean> {
  for (let poging = 0; poging < seconden * 2; poging += 1) {
    if (!(await bereikbaar(poort, "127.0.0.1", 500))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Het eigen adres in het netwerk, om te controleren dat dáár niets luistert. */
function netwerkAdres(): string | null {
  for (const kaarten of Object.values(networkInterfaces())) {
    for (const kaart of kaarten ?? []) {
      if (kaart.family === "IPv4" && !kaart.internal) {
        return kaart.address;
      }
    }
  }
  return null;
}

/**
 * Werken de downloads in de bundel zelf?
 *
 * Deze controle bestaat omdat alle vijf de downloadroutes in de draagbare
 * versie een 500 gaven terwijl ze op de ontwikkelserver werkten. Next voerde ze
 * bij het bouwen van de productiebundel alvast één keer uit — zonder verzoek en
 * dus zonder sessie — en bewaarde de toegangsfout als antwoord. De
 * ontwikkelserver bouwt elke route per verzoek opnieuw en liet het verschil
 * daarom nooit zien. Een controle die alleen daar draait, kan dit niet vinden;
 * deze draait in de bundel.
 */
async function downloadsInDeBundel(client: pg.Client, proefpad: string): Promise<void> {
  console.log("\n6b. Downloads uit de bundel");

  const geheim = readFileSync(path.join(proefpad, "config", "sessiegeheim.txt"), "utf8").trim();
  const account = await client.query(
    'SELECT u."id" FROM "UserAccount" u JOIN "Employee" e ON e."id" = u."employeeId" ' +
      'WHERE e."employeeNumber" = $1 LIMIT 1',
    ["900001"],
  );
  if (account.rowCount === 0) {
    blokkade(
      "de downloads in de bundel",
      "BLOCKED_BY_MISSING_DATA. Geen account 900001 in de draagbare database.",
    );
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const nu = Date.now();
  await client.query(
    'INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","absoluteExpiry",' +
      '"clientFingerprint") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)',
    [
      account.rows[0].id,
      createHmac("sha256", geheim).update(token).digest("hex"),
      new Date(nu + 30 * 60_000),
      new Date(nu + 60 * 60_000),
      "verify-portable",
    ],
  );

  const downloads: { readonly naam: string; readonly pad: string; readonly type: string }[] = [
    {
      naam: "het Excel-sjabloon",
      pad: "/roostercommissie/pakketten/sjabloon?standplaats=DDR&dienstregeling=HUIDIG",
      type: "spreadsheetml",
    },
    {
      naam: "het roosterblad als PDF",
      pad: "/roostercommissie/roosterblad/DDR-V?formaat=pdf",
      type: "pdf",
    },
  ];

  // Het roosterblad van een scenario: de weg die de commissie na het toetsen
  // gebruikt. De demonstratiegegevens bevatten scenario's; zit er geen in, dan
  // is dat een gat in de bundel en geen reden om deze controle over te slaan.
  const scenario = await client.query(
    'SELECT "id" FROM "CandidateRoster" ORDER BY "generatedAt" DESC LIMIT 1',
  );
  if (scenario.rowCount === 0) {
    blokkade(
      "het roosterblad van een scenario uit de bundel",
      "BLOCKED_BY_MISSING_DATA. De demonstratiegegevens bevatten geen scenario.",
    );
  } else {
    downloads.push({
      naam: "het roosterblad van een scenario als PDF",
      pad: `/roostercommissie/roosterblad/DDR-V?formaat=pdf&kandidaat=${scenario.rows[0].id}`,
      type: "pdf",
    });
  }

  for (const download of downloads) {
    const antwoord = await fetch(`http://127.0.0.1:${WEB_POORT}${download.pad}`, {
      headers: { cookie: `nsr_session=${token}` },
    }).catch(() => null);
    const bytes = antwoord ? (await antwoord.arrayBuffer()).byteLength : 0;
    const type = antwoord?.headers.get("content-type") ?? "";
    toets(
      `${download.naam} komt als bestand uit de bundel`,
      antwoord?.status === 200 && type.includes(download.type) && bytes > 1000,
      `status ${antwoord?.status ?? "geen antwoord"}, ${type || "geen type"}, ${bytes} bytes`,
    );
  }
}

async function main(): Promise<void> {
  console.log("DRAAGBARE VERSIE");
  console.log("═".repeat(72));

  if (!existsSync(ORIGINEEL)) {
    blokkade(
      "de bundel bestaat",
      `BLOCKED_BY_MISSING_BUILD: ${ORIGINEEL} bestaat niet. Draai eerst npm run build:portable.`,
    );
    afsluiten();
    return;
  }

  // Alles van een eerdere proef eerst weg: processen die nog draaien houden
  // bestanden vast, en dan is de map niet te vervangen.
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | " +
        `Where-Object { $_.ExecutablePath -like '${BUNDEL}*' } | ` +
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ],
    { encoding: "utf8" },
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  rmSync(BUNDEL, { recursive: true, force: true });

  console.log("\nEen verse kopie van de bundel klaarzetten…");
  cpSync(ORIGINEEL, BUNDEL, {
    recursive: true,
    // Gegevens en logboeken van de gebouwde bundel gaan niet mee: deze proef
    // hoort met een lege database te beginnen, net als een nieuwe stick.
    filter: (bron) => {
      const relatief = path.relative(ORIGINEEL, bron);
      return !relatief.startsWith("database") && !relatief.startsWith("logs");
    },
  });
  // De weggelaten mappen horen wél bij de structuur van een stick; ze gaan
  // alleen leeg mee.
  for (const map of ["database", "logs"]) {
    mkdirSync(path.join(BUNDEL, map), { recursive: true });
  }

  // ── 1. De structuur ──────────────────────────────────────────────────────
  console.log("\n1. De structuur");

  for (const verwacht of [
    "Start NS Roosterplatform.bat",
    "Stop NS Roosterplatform.bat",
    "LEESMIJ.txt",
    "HANDLEIDING.md",
    "NS Roosterplatform - Brochure.pdf",
    "NS Roosterplatform - Handleiding.pdf",
    "start.mjs",
    "stop.mjs",
    path.join("app", "server.js"),
    path.join("app", "portable-migrate.mjs"),
    path.join("app", "prisma", "migrations"),
    path.join("runtime", "node", "node.exe"),
    path.join("runtime", "postgres", "bin", "pg_ctl.exe"),
    path.join("runtime", "postgres", "bin", "initdb.exe"),
    path.join("config", "instellingen.env"),
    "logs",
    "exports",
    "backups",
    "database",
  ]) {
    toets(`${verwacht} staat erin`, existsSync(path.join(BUNDEL, verwacht)));
  }

  const optimizer = path.join(BUNDEL, "runtime", "python", "python.exe");
  if (existsSync(optimizer)) {
    toets("de optimizerruntime staat erin", true);
  } else {
    blokkade(
      "de optimizerruntime",
      "BLOCKED_BY_MISSING_RUNTIME: er is geen Python met ortools meegenomen. De bundel " +
        "draait verder volledig; alleen de CP-SAT-optimizer kan niet starten.",
    );
  }

  // ── 2. Geen paden van de bouwmachine ─────────────────────────────────────
  console.log("\n2. Geen paden van de bouwmachine");

  const startbestanden = [
    path.join(BUNDEL, "Start NS Roosterplatform.bat"),
    path.join(BUNDEL, "Stop NS Roosterplatform.bat"),
    path.join(BUNDEL, "start.mjs"),
    path.join(BUNDEL, "stop.mjs"),
    path.join(BUNDEL, "app", "portable-migrate.mjs"),
  ].filter((bestand) => existsSync(bestand));

  const absolute: string[] = [];
  for (const bestand of startbestanden) {
    const inhoud = readFileSync(bestand, "utf8");
    // Een schijfletter met dubbele punt en slash: C:\ of C:/
    //
    // Niet zomaar elke "x:/": een URL-schema ziet er hetzelfde uit, en
    // `http://` en `postgresql://` werden hier ten onrechte als pad van de
    // bouwmachine aangemerkt. Een schijfletter is precies één letter, en er
    // staat geen letter of cijfer vlak voor.
    for (const treffer of inhoud.matchAll(/(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/g)) {
      absolute.push(`${path.basename(bestand)}: ${inhoud.slice(Math.max(0, treffer.index - 30), treffer.index + 30).replace(/\s+/g, " ")}`);
    }
  }
  toets(
    "de start- en stopbestanden bevatten geen enkele schijfletter",
    absolute.length === 0,
    absolute.slice(0, 3).join(" | "),
  );

  const bouwpad = WORTEL.replace(/\\/g, "\\\\");
  const metBouwpad = startbestanden.filter((bestand) =>
    new RegExp(bouwpad, "i").test(readFileSync(bestand, "utf8")),
  );
  toets(
    "en nergens het pad van deze ontwikkelmachine",
    metBouwpad.length === 0,
    metBouwpad.map((bestand) => path.basename(bestand)).join(", "),
  );

  const startBat = readFileSync(path.join(BUNDEL, "Start NS Roosterplatform.bat"), "utf8");
  toets(
    "het startbestand rekent vanaf zijn eigen map (%~dp0)",
    startBat.includes("%~dp0"),
  );
  toets(
    "en zet elk pad tussen aanhalingstekens, zodat een spatie het niet breekt",
    /"runtime\\node\\node\.exe"/.test(startBat) && /cd \/d "%~dp0"/.test(startBat),
  );
  toets(
    "het stopbestand stopt niet zomaar alle node-processen",
    !/taskkill.*\/IM\s+node/i.test(readFileSync(path.join(BUNDEL, "stop.mjs"), "utf8")),
    "er staat een taskkill op procesnaam in plaats van op het eigen procesnummer",
  );

  // ── 3. Klaarzetten op een andere schijfletter, in een pad met spaties ─────
  console.log(`\n3. Starten vanaf ${PROEFLETTER}\\${PROEFMAP}`);

  const distMap = path.dirname(BUNDEL);
  const spatieMap = path.join(distMap, PROEFMAP);
  const knooppunt = path.join(spatieMap, path.basename(BUNDEL));

  opruimenKoppeling(knooppunt, spatieMap);
  mkdirSync(spatieMap, { recursive: true });
  const koppeling = spawnSync("cmd", ["/c", "mklink", "/J", knooppunt, BUNDEL], {
    encoding: "utf8",
  });
  if (koppeling.status !== 0) {
    blokkade(
      "een map met spaties in de naam",
      `Er kon geen knooppunt worden gemaakt: ${(koppeling.stderr ?? koppeling.stdout ?? "").trim()}`,
    );
    afsluiten();
    return;
  }

  spawnSync("subst", [PROEFLETTER, "/d"], { encoding: "utf8" });
  const schijf = spawnSync("subst", [PROEFLETTER, distMap], { encoding: "utf8" });
  if (schijf.status !== 0) {
    blokkade(
      "een tweede schijfletter",
      `subst is mislukt: ${(schijf.stderr ?? schijf.stdout ?? "").trim()}. ` +
        "Kies een vrije letter met VERIFY_PORTABLE_DRIVE.",
    );
    opruimenKoppeling(knooppunt, spatieMap);
    afsluiten();
    return;
  }

  const proefpad = path.join(`${PROEFLETTER}\\`, PROEFMAP, path.basename(BUNDEL));
  console.log(`      De bundel is nu bereikbaar als ${proefpad}`);
  toets("de bundel is bereikbaar via de nieuwe schijfletter", existsSync(proefpad));
  toets("het pad bevat een spatie", proefpad.includes(" "));

  // Poorten die niet botsen met de ontwikkelomgeving.
  writeFileSync(
    path.join(proefpad, "config", "instellingen.env"),
    `PORT=${WEB_POORT}\nDB_PORT=${DB_POORT}\nPRIVACY_MIN_COHORT=5\n`,
    "utf8",
  );

  // Een eventuele eerdere proefdatabase weg, zodat dit een échte eerste start is.
  rmSync(path.join(BUNDEL, "database", "pgdata"), { recursive: true, force: true });
  rmSync(path.join(BUNDEL, "logs", "draait.lock"), { force: true });

  const databaseUrl = `postgresql://postgres:roosterplatform@127.0.0.1:${DB_POORT}/ns_roosterplatform`;

  try {
    // ── 4. Eerste start ────────────────────────────────────────────────────
    console.log("\n4. De eerste start (database wordt aangemaakt)");
    const eerste = start(proefpad);
    const opgekomen = await wacht(WEB_POORT, "127.0.0.1", 240);
    toets(
      "het platform komt op zonder dat er iets geïnstalleerd is",
      opgekomen,
      logstaart(BUNDEL),
    );
    if (!opgekomen) {
      eerste.kill();
      throw new Error("gestopt: de eerste start is mislukt");
    }

    const antwoord = await fetch(`http://127.0.0.1:${WEB_POORT}/aanmelden`).catch(() => null);
    toets(
      "het aanmeldscherm wordt geleverd",
      antwoord?.status === 200,
      `status ${antwoord?.status ?? "geen antwoord"}`,
    );

    const html = antwoord ? await antwoord.text() : "";
    toets("en het is werkelijk de applicatie", html.includes("Roosterplatform"));

    // ── 5. Alleen localhost ────────────────────────────────────────────────
    console.log("\n5. Alleen localhost");
    const adres = netwerkAdres();
    if (!adres) {
      blokkade("bereikbaarheid van buiten", "Deze machine heeft geen netwerkadres om te proberen.");
    } else {
      const vanBuiten = await bereikbaar(WEB_POORT, adres, 2000);
      toets(
        `de applicatie is niet bereikbaar op ${adres} (alleen 127.0.0.1)`,
        !vanBuiten,
        "het platform luistert op het netwerk; andere computers kunnen erbij",
      );
      const dbVanBuiten = await bereikbaar(DB_POORT, adres, 2000);
      toets(`de database is niet bereikbaar op ${adres}`, !dbVanBuiten);
    }

    // ── 6. Gegevens en een eigen wijziging ─────────────────────────────────
    console.log("\n6. De gegevens");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const accounts = await client.query('SELECT count(*)::int AS aantal FROM "UserAccount"');
    toets(
      `de demonstratiegegevens staan erin (${accounts.rows[0].aantal} accounts)`,
      accounts.rows[0].aantal > 0,
      "de bundel start met een lege database; niemand kan inloggen",
    );
    const diensten = await client.query('SELECT count(*)::int AS aantal FROM "Duty"');
    toets(
      `en de diensten ook (${diensten.rows[0].aantal})`,
      diensten.rows[0].aantal > 0,
    );

    const merkteken = `verify-portable-${Date.now()}`;
    await client.query(
      'INSERT INTO "AuditLogEntry" ("id","action","objectType","result","actorRoles") ' +
        "VALUES (gen_random_uuid(), $1, 'Verificatie', 'SUCCESS', '{}')",
      [merkteken],
    );
    await downloadsInDeBundel(client, proefpad);
    await client.end();
    toets("een wijziging wordt geaccepteerd", true);

    // ── 7. Netjes stoppen ──────────────────────────────────────────────────
    console.log("\n7. Stoppen");
    const gestopt = spawnSync(
      path.join(proefpad, "runtime", "node", "node.exe"),
      [path.join(proefpad, "stop.mjs")],
      { encoding: "utf8", cwd: proefpad },
    );
    console.log(
      `      ${(gestopt.stdout ?? "").trim().split("\n").slice(-1)[0] || "(geen uitvoer)"}`,
    );
    toets("het stopscript meldt zich netjes af", gestopt.status === 0);
    toets("de webpoort is vrij", await weg(WEB_POORT, 20));
    toets("de databasepoort is vrij", await weg(DB_POORT, 20));
    toets(
      "de grendel is opgeruimd",
      !existsSync(path.join(BUNDEL, "logs", "draait.lock")),
    );

    // ── 8. Opnieuw starten ─────────────────────────────────────────────────
    console.log("\n8. Opnieuw starten");
    const tweede = start(proefpad);
    const weerOp = await wacht(WEB_POORT, "127.0.0.1", 180);
    toets("het platform komt opnieuw op", weerOp, logstaart(BUNDEL));

    if (weerOp) {
      const opnieuw = new pg.Client({ connectionString: databaseUrl });
      await opnieuw.connect();
      const terug = await opnieuw.query(
        'SELECT count(*)::int AS aantal FROM "AuditLogEntry" WHERE "action" = $1',
        [merkteken],
      );
      toets(
        "de wijziging van vóór het afsluiten staat er nog",
        terug.rows[0].aantal === 1,
        `${terug.rows[0].aantal} rijen gevonden`,
      );

      const nogSteeds = await opnieuw.query('SELECT count(*)::int AS aantal FROM "UserAccount"');
      toets(
        "de demonstratiegegevens zijn niet opnieuw ingeladen",
        nogSteeds.rows[0].aantal === accounts.rows[0].aantal,
        `${accounts.rows[0].aantal} werd ${nogSteeds.rows[0].aantal}`,
      );
      await opnieuw.end();

      // ── 9. Eén exemplaar tegelijk ────────────────────────────────────────
      console.log("\n9. Eén exemplaar tegelijk");
      const tweedeStart = spawnSync(
        path.join(proefpad, "runtime", "node", "node.exe"),
        [path.join(proefpad, "start.mjs")],
        { encoding: "utf8", cwd: proefpad, timeout: 60_000 },
      );
      const melding = `${tweedeStart.stdout ?? ""}${tweedeStart.stderr ?? ""}`;
      toets(
        "een tweede exemplaar weigert te starten",
        tweedeStart.status !== 0 && /draait al/i.test(melding),
        melding.trim().split("\n").slice(-2).join(" ").slice(0, 200),
      );
      toets("en het eerste exemplaar draait gewoon door", await bereikbaar(WEB_POORT, "127.0.0.1"));
    }

    tweede.kill();
    spawnSync(
      path.join(proefpad, "runtime", "node", "node.exe"),
      [path.join(proefpad, "stop.mjs")],
      { encoding: "utf8", cwd: proefpad },
    );
    await weg(WEB_POORT, 20);
    await weg(DB_POORT, 20);

    // ── 10. Wat er op de schijf achterblijft ───────────────────────────────
    console.log("\n10. Wat er op de schijf staat");
    toets(
      "de database staat in de bundel en niet ergens op de computer",
      existsSync(path.join(BUNDEL, "database", "pgdata", "PG_VERSION")),
    );
    toets(
      "er zijn logbestanden geschreven in de bundel",
      existsSync(path.join(BUNDEL, "logs", "start.log")),
    );
    const leesmij = readFileSync(path.join(BUNDEL, "LEESMIJ.txt"), "utf8");
    toets(
      "de toelichting waarschuwt tegen echte persoonsgegevens",
      /geen echte persoonsgegevens/i.test(leesmij) && /niet versleuteld/i.test(leesmij),
    );
    toets(
      "en legt uit hoe een reservekopie werkt",
      /reservekopie/i.test(leesmij) && /(afgesloten|sluit het platform af)/i.test(leesmij),
    );
  } finally {
    console.log("\nOpruimen");
    spawnSync(
      path.join(BUNDEL, "runtime", "node", "node.exe"),
      [path.join(BUNDEL, "stop.mjs")],
      { encoding: "utf8", cwd: BUNDEL },
    );
    opruimenKoppeling(knooppunt, spatieMap);
    spawnSync("subst", [PROEFLETTER, "/d"], { encoding: "utf8" });
    console.log(`      ${PROEFLETTER} losgekoppeld en de proefmap verwijderd.`);
  }

  afsluiten();
}

function start(bundelpad: string): ReturnType<typeof spawn> {
  return spawn(
    path.join(bundelpad, "runtime", "node", "node.exe"),
    [path.join(bundelpad, "start.mjs")],
    { cwd: bundelpad, detached: false, stdio: "ignore" },
  );
}

function logstaart(bundel: string): string {
  const log = path.join(bundel, "logs", "start.log");
  if (!existsSync(log)) {
    return "er is geen start.log geschreven";
  }
  return readFileSync(log, "utf8").trim().split("\n").slice(-3).join(" | ").slice(0, 300);
}

function opruimenKoppeling(knooppunt: string, spatieMap: string): void {
  if (existsSync(knooppunt)) {
    // Een knooppunt met rmdir weghalen; rmSync zou de inhoud erachter wissen.
    spawnSync("cmd", ["/c", "rmdir", knooppunt], { encoding: "utf8" });
  }
  if (existsSync(spatieMap) && readdirSync(spatieMap).length === 0) {
    rmSync(spatieMap, { recursive: true, force: true });
  }
}

function afsluiten(): void {
  console.log(`\n${"═".repeat(72)}`);
  console.log(
    `${geslaagd} controles geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd.`,
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main().catch((fout) => {
  console.error(String(fout));
  process.exitCode = 1;
});
