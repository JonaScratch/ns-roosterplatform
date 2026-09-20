import "dotenv/config";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * De draagbare bundel bouwen.
 *
 * ## Wat er in de bundel gaat
 *
 * Alles wat nodig is om te draaien op een Windows-computer waar niets van dit
 * project op staat: de applicatie, een Node-runtime, een PostgreSQL-runtime, en
 * — als die te vinden is — een Python met ortools voor de optimizer.
 *
 * ## Waarom hier niets wordt gedownload
 *
 * De runtimes worden gekopieerd van wat er op deze machine al staat. Dat is
 * geen gemakzucht: een bouwstap die tijdens het bouwen internet nodig heeft,
 * levert op een dag een andere bundel op dan de dag ervoor, en dan weet niemand
 * meer wat er op de stick staat. Wat ontbreekt, wordt gemeld en niet stilzwijgend
 * overgeslagen.
 *
 * Draaien met: npm run build:portable
 */

const WORTEL = path.resolve(__dirname, "..");
const DOEL = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(WORTEL, "dist", "NS-Roosterplatform-Portable");

const stappen: string[] = [];
const waarschuwingen: string[] = [];

function stap(regel: string): void {
  stappen.push(regel);
  console.log(`  • ${regel}`);
}

function waarschuw(regel: string): void {
  waarschuwingen.push(regel);
  console.log(`  ! ${regel}`);
}

function mapGrootte(map: string): number {
  if (!existsSync(map)) {
    return 0;
  }
  let totaal = 0;
  for (const item of readdirSync(map, { withFileTypes: true })) {
    const volledig = path.join(map, item.name);
    totaal += item.isDirectory() ? mapGrootte(volledig) : statSync(volledig).size;
  }
  return totaal;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function main(): void {
  console.log("DRAAGBARE BUNDEL BOUWEN");
  console.log("═".repeat(70));
  console.log(`Doel: ${DOEL}`);

  // ── 1. De applicatie bouwen ──────────────────────────────────────────────
  console.log("\n1. De applicatie bouwen");
  const bouw = spawnSync(process.execPath, [path.join(WORTEL, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: WORTEL,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (bouw.status !== 0) {
    console.error(bouw.stdout?.slice(-4000));
    console.error(bouw.stderr?.slice(-4000));
    throw new Error("next build is mislukt; de bundel is niet gemaakt.");
  }
  stap("productiebuild gemaakt");

  const standalone = path.join(WORTEL, ".next", "standalone");
  if (!existsSync(standalone)) {
    throw new Error(
      "Er is geen standalone-uitvoer. Zet `output: \"standalone\"` in next.config.ts en bouw opnieuw.",
    );
  }

  // ── 2. De mappen ─────────────────────────────────────────────────────────
  console.log("\n2. De mapstructuur");
  if (existsSync(DOEL)) {
    rmSync(DOEL, { recursive: true, force: true });
  }
  for (const map of ["app", "runtime", "database", "config", "logs", "exports", "backups"]) {
    mkdirSync(path.join(DOEL, map), { recursive: true });
  }
  stap("mappen aangemaakt");

  // ── 3. De applicatie ─────────────────────────────────────────────────────
  console.log("\n3. De applicatie kopiëren");
  cpSync(standalone, path.join(DOEL, "app"), { recursive: true });
  // De statische bestanden zitten niet in de standalone-uitvoer.
  cpSync(path.join(WORTEL, ".next", "static"), path.join(DOEL, "app", ".next", "static"), {
    recursive: true,
  });
  if (existsSync(path.join(WORTEL, "public"))) {
    cpSync(path.join(WORTEL, "public"), path.join(DOEL, "app", "public"), { recursive: true });
  }
  // De migraties gaan mee: de eerste start maakt de database zelf aan.
  cpSync(path.join(WORTEL, "prisma", "migrations"), path.join(DOEL, "app", "prisma", "migrations"), {
    recursive: true,
  });
  cpSync(path.join(WORTEL, "prisma", "schema.prisma"), path.join(DOEL, "app", "prisma", "schema.prisma"));
  if (existsSync(path.join(WORTEL, "python"))) {
    cpSync(path.join(WORTEL, "python"), path.join(DOEL, "app", "python"), { recursive: true });
  }
  for (const script of ["portable-migrate.mjs"]) {
    cpSync(path.join(WORTEL, "portable", script), path.join(DOEL, "app", script));
  }
  // Pakketten die het traceren niet (volledig) meeneemt.
  //
  // Twee soorten. `pg` en zijn afhankelijkheden worden door het migratie- en
  // zaaiscript rechtstreeks gebruikt, buiten de applicatie om; die kan het
  // traceren dus niet zien.
  //
  // De Prisma-pakketten zijn een ander geval: de gegenereerde client laadt zijn
  // runtime met een verwijzing die pas tijdens het draaien wordt samengesteld.
  // Het traceren nam van `client-runtime-utils` alleen de package.json mee en
  // niet de code, en dat leverde een bundel op die opstartte en bij de eerste
  // paginaweergave een 500 gaf. Wat dynamisch wordt geladen, moet met de hand
  // worden meegegeven.
  for (const pakket of [
    "pg",
    "pg-protocol",
    "pg-types",
    "pg-int8",
    "pg-connection-string",
    "pgpass",
    "postgres-array",
    "postgres-bytea",
    "postgres-date",
    "postgres-interval",
    "split2",
    "@prisma/client",
    "@prisma/client-runtime-utils",
    "@prisma/adapter-pg",
    "@prisma/driver-adapter-utils",
    "@prisma/query-plan-executor",
    "@prisma/streams-local",
    "@prisma/debug",
  ]) {
    const bron = path.join(WORTEL, "node_modules", pakket);
    if (existsSync(bron)) {
      cpSync(bron, path.join(DOEL, "app", "node_modules", pakket), { recursive: true });
    }
  }
  stap(`applicatie gekopieerd (${mb(mapGrootte(path.join(DOEL, "app")))})`);

  // ── 4. De Node-runtime ───────────────────────────────────────────────────
  console.log("\n4. De Node-runtime");
  const nodeRuntime = path.join(DOEL, "runtime", "node");
  mkdirSync(nodeRuntime, { recursive: true });
  cpSync(process.execPath, path.join(nodeRuntime, "node.exe"));
  // Sommige Node-installaties leveren losse DLL's mee; die horen erbij.
  const nodeMap = path.dirname(process.execPath);
  for (const bestand of readdirSync(nodeMap)) {
    if (bestand.toLowerCase().endsWith(".dll")) {
      cpSync(path.join(nodeMap, bestand), path.join(nodeRuntime, bestand));
    }
  }
  stap(`Node ${process.version} meegenomen (${mb(mapGrootte(nodeRuntime))})`);

  // ── 5. De databaseruntime ────────────────────────────────────────────────
  console.log("\n5. De databaseruntime");
  const embedded = path.join(WORTEL, "node_modules", "@embedded-postgres", "windows-x64", "native");
  if (!existsSync(embedded)) {
    throw new Error(
      `De PostgreSQL-binaries ontbreken (${embedded}). Draai eerst npm install op een ` +
        "Windows-machine.",
    );
  }
  cpSync(embedded, path.join(DOEL, "runtime", "postgres"), { recursive: true });
  stap(`PostgreSQL meegenomen (${mb(mapGrootte(path.join(DOEL, "runtime", "postgres")))})`);

  // ── 6. De optimizerruntime ───────────────────────────────────────────────
  console.log("\n6. De optimizerruntime (Python met ortools)");
  const pythonBron = zoekPython();
  if (!pythonBron) {
    waarschuw(
      "BLOCKED_BY_MISSING_RUNTIME: er is geen Python met ortools gevonden om mee te nemen. " +
        "De bundel werkt verder volledig; alleen de CP-SAT-optimizer kan niet draaien en " +
        "meldt dat ook zo.",
    );
  } else {
    cpSync(pythonBron.prefix, path.join(DOEL, "runtime", "python"), { recursive: true });
    if (pythonBron.extraPackages && existsSync(pythonBron.extraPackages)) {
      // ortools staat vaak in de gebruikersmap en niet bij de installatie zelf.
      cpSync(
        pythonBron.extraPackages,
        path.join(DOEL, "runtime", "python", "Lib", "site-packages"),
        { recursive: true, force: false, errorOnExist: false },
      );
    }
    stap(
      `Python ${pythonBron.version} met ortools meegenomen ` +
        `(${mb(mapGrootte(path.join(DOEL, "runtime", "python")))})`,
    );
  }

  // ── 6b. De demonstratiegegevens ──────────────────────────────────────────
  console.log("\n6b. De demonstratiegegevens");
  cpSync(path.join(WORTEL, "portable", "portable-seed.mjs"), path.join(DOEL, "app", "portable-seed.mjs"));
  const dumpDoel = path.join(DOEL, "app", "demonstratie-gegevens.sql");
  const dumper = spawnSync(
    process.execPath,
    [path.join(WORTEL, "portable", "dump-demo.mjs"), dumpDoel],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: process.env },
  );
  if (dumper.status !== 0) {
    waarschuw(
      "BLOCKED_BY_MISSING_DATA: de demonstratiegegevens konden niet worden uitgelezen " +
        `(${(dumper.stderr ?? "").trim().slice(0, 200)}). De bundel start met een lege ` +
        "database en niemand kan inloggen.",
    );
  } else {
    stap((dumper.stdout ?? "").trim().split("\n").slice(-1)[0]);
  }

  // ── 7. De startbestanden ─────────────────────────────────────────────────
  console.log("\n7. De start- en stopbestanden");
  cpSync(path.join(WORTEL, "portable", "start.mjs"), path.join(DOEL, "start.mjs"));
  cpSync(path.join(WORTEL, "portable", "stop.mjs"), path.join(DOEL, "stop.mjs"));
  writeFileSync(path.join(DOEL, "Start NS Roosterplatform.bat"), START_BAT, "latin1");
  writeFileSync(path.join(DOEL, "Stop NS Roosterplatform.bat"), STOP_BAT, "latin1");
  writeFileSync(path.join(DOEL, "config", "instellingen.env"), INSTELLINGEN, "utf8");
  writeFileSync(path.join(DOEL, "LEESMIJ.txt"), LEESMIJ, "utf8");
  // Eén bron: de handleiding staat in docs/handleiding.md en gaat hier
  // ongewijzigd mee de bundel in, zodat een ontvanger van alleen de map ook
  // de volledige uitleg heeft — niet alleen de operationele LEESMIJ.
  const handleidingBron = path.join(WORTEL, "docs", "handleiding.md");
  if (existsSync(handleidingBron)) {
    cpSync(handleidingBron, path.join(DOEL, "HANDLEIDING.md"));
  }
  // Dezelfde reden als hierboven, voor de brochure: één bron
  // (docs/NS-Roosterplatform-Brochure.pdf), ongewijzigd mee de bundel in.
  const brochureBron = path.join(WORTEL, "docs", "NS-Roosterplatform-Brochure.pdf");
  if (existsSync(brochureBron)) {
    cpSync(brochureBron, path.join(DOEL, "NS Roosterplatform - Brochure.pdf"));
  }
  // Dezelfde reden, voor de PDF-versie van de handleiding — naast HANDLEIDING.md,
  // voor wie liever een doorbladerbaar, gepagineerd document heeft.
  const handleidingPdfBron = path.join(WORTEL, "docs", "NS-Roosterplatform-Handleiding.pdf");
  if (existsSync(handleidingPdfBron)) {
    cpSync(handleidingPdfBron, path.join(DOEL, "NS Roosterplatform - Handleiding.pdf"));
  }
  // Het ontwikkelrapport van de zoekmachine gaat mee omdat de bundel ook los van
  // deze werkplek moet uitleggen waarop de roosters zijn gebaseerd: welke
  // meting, welke keuzes, en wat er niet werkte.
  const optimizerRapport = path.join(WORTEL, "docs", "NS-Roosterplatform-v1.0.4-Optimizer-Development-Report.pdf");
  if (existsSync(optimizerRapport)) {
    cpSync(optimizerRapport, path.join(DOEL, "NS Roosterplatform - Ontwikkelrapport optimizer v1.0.4.pdf"));
  }
  for (const map of ["logs", "exports", "backups", "database"]) {
    writeFileSync(path.join(DOEL, map, "LEESMIJ.txt"), MAP_UITLEG[map], "utf8");
  }
  stap("start, stop, instellingen en toelichting geschreven");

  // ── 8. Uitkomst ──────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log(`Bundel klaar: ${DOEL}`);
  console.log(`Totale omvang: ${mb(mapGrootte(DOEL))}`);
  console.log(`${stappen.length} stappen uitgevoerd, ${waarschuwingen.length} waarschuwing(en).`);
  for (const regel of waarschuwingen) {
    console.log(`  ! ${regel}`);
  }
  console.log("\nControleren met: npm run verify:portable");
}

/** Een Python-installatie met ortools erin, of niets. */
function zoekPython(): { prefix: string; version: string; extraPackages: string | null } | null {
  const kandidaten = [
    process.env.NS_PYTHON,
    ...(process.env.LOCALAPPDATA
      ? readdirSafe(path.join(process.env.LOCALAPPDATA, "Programs", "Python")).map((naam) =>
          path.join(process.env.LOCALAPPDATA!, "Programs", "Python", naam, "python.exe"),
        )
      : []),
    "python3",
    "python",
  ].filter((kandidaat): kandidaat is string => Boolean(kandidaat));

  for (const kandidaat of kandidaten) {
    const uitkomst = spawnSync(
      kandidaat,
      [
        "-c",
        "import sys, ortools, os; print(sys.prefix); print(sys.version.split()[0]); " +
          "print(os.path.dirname(os.path.dirname(ortools.__file__)))",
      ],
      { encoding: "utf8" },
    );
    if (uitkomst.status === 0 && uitkomst.stdout) {
      const [prefix, version, pakketten] = uitkomst.stdout.trim().split(/\r?\n/);
      if (prefix && existsSync(prefix)) {
        const eigenPakketten = path.join(prefix, "Lib", "site-packages");
        return {
          prefix,
          version,
          extraPackages:
            pakketten && path.resolve(pakketten) !== path.resolve(eigenPakketten) ? pakketten : null,
        };
      }
    }
  }
  return null;
}

function readdirSafe(map: string): string[] {
  try {
    return readdirSync(map);
  } catch {
    return [];
  }
}

// ── De bestanden die in de bundel komen ────────────────────────────────────

/**
 * Het startbestand.
 *
 * `%~dp0` is de map waarin dit bestand zelf staat — geen schijfletter, geen
 * aanname over waar de stick hangt. De aanhalingstekens eromheen zijn niet
 * cosmetisch: zonder die breekt elk pad met een spatie halverwege af, en
 * "NS Roosterplatform" heeft er een.
 */
const START_BAT = [
  "@echo off",
  "setlocal",
  "title NS Roosterplatform",
  'cd /d "%~dp0"',
  'if not exist "runtime\\node\\node.exe" (',
  "  echo.",
  "  echo De Node-runtime ontbreekt. Kopieer de map opnieuw van de originele stick.",
  "  echo.",
  "  pause",
  "  exit /b 1",
  ")",
  '"runtime\\node\\node.exe" "start.mjs"',
  "if errorlevel 1 (",
  "  echo.",
  "  echo Het platform is niet gestart. Kijk in logs\\start.log.",
  "  echo.",
  "  pause",
  ")",
  "endlocal",
  "",
].join("\r\n");

const STOP_BAT = [
  "@echo off",
  "setlocal",
  "title NS Roosterplatform - afsluiten",
  'cd /d "%~dp0"',
  'if not exist "runtime\\node\\node.exe" (',
  "  echo De Node-runtime ontbreekt.",
  "  pause",
  "  exit /b 1",
  ")",
  '"runtime\\node\\node.exe" "stop.mjs"',
  "timeout /t 3 >nul",
  "endlocal",
  "",
].join("\r\n");

const INSTELLINGEN = `# Instellingen van het draagbare NS Roosterplatform.
#
# Alles hierin is optioneel. Zonder dit bestand werkt het platform met de
# waarden die hieronder als voorbeeld staan.

# De poort waarop het platform in de browser bereikbaar is.
PORT=3300

# De poort van de meegeleverde database. Alleen wijzigen wanneer een ander
# programma op deze computer dezelfde poort gebruikt.
DB_PORT=5434

# Het geheim waarmee sessies worden ondertekend. Bij de eerste start wordt hier
# een willekeurige waarde neergezet wanneer u dat zelf niet doet.
# SESSION_SECRET=

# Hoe klein een groep mag zijn voordat er geaggregeerde feedback wordt getoond.
PRIVACY_MIN_COHORT=5
`;

const LEESMIJ = `NS ROOSTERPLATFORM — DRAAGBARE VERSIE 1.0.3
===========================================

LEES DIT EERST
  Deze LEESMIJ gaat over starten, stoppen en de stick zelf.
  Voor uitleg over wat het platform kan en hoe u het gebruikt: HANDLEIDING.md
  in deze zelfde map, of "NS Roosterplatform - Handleiding.pdf" voor dezelfde
  inhoud als doorbladerbaar, gepagineerd document.
  Voor een korte, doorbladerbare presentatie van het platform:
  "NS Roosterplatform - Brochure.pdf", eveneens in deze map.

STARTEN
  Dubbelklik op "Start NS Roosterplatform.bat".
  De eerste keer duurt dat ongeveer een minuut: de database wordt dan
  aangemaakt. Daarna gaat het in enkele seconden.
  De browser opent vanzelf op http://127.0.0.1:3300

AANMELDEN — TESTACCOUNTS
  personeelsnummer 100001   medewerker
  personeelsnummer 900001   rooster commissie
  personeelsnummer 910001   dienstindeling
  personeelsnummer 990001   beheerder
  wachtwoord voor elk account: Ontwikkel!2026

AFSLUITEN
  Dubbelklik op "Stop NS Roosterplatform.bat", of sluit het zwarte venster.
  Wacht tot er "Klaar" staat voordat u de stick eruit haalt.

WAT ER OP DEZE STICK STAAT
  HANDLEIDING.md            wat het platform kan en hoe u het gebruikt
  NS Roosterplatform -      dezelfde handleiding, als gepagineerd document
    Handleiding.pdf
  NS Roosterplatform -      korte presentatie, om door te bladeren of te delen
    Brochure.pdf
  Start NS Roosterplatform  hiermee begint u
  Stop NS Roosterplatform   hiermee sluit u veilig af
  app\\        de applicatie
  runtime\\    Node, PostgreSQL en (indien meegeleverd) Python
  database\\   uw gegevens
  config\\     instellingen
  logs\\       logbestanden
  exports\\    wat u exporteert komt hier terecht
  backups\\    reservekopieën

NIEUW IN VERSIE 1.0.3
  - Genereren & simulatie: kies een strategie en een roosterjaar; één opdracht
    levert tot drie complete, onderling verschillende kandidaten op. Een
    opdracht duurt enkele minuten en loopt door als u het scherm ververst.
  - Scenario's vergelijken: kandidaten openen als pakket, elk basisrooster in
    agendavorm bekijken, kandidaten naast elkaar leggen, gericht herbouwen.
  - Nachten in reeksen, rustiger overgangen tussen dagdelen, en nooit een
    vroege dienst in Laat/Nacht.
  - De eindvalidatie rekent ongeveer tien keer sneller.
  De publicatiepoort is ongewijzigd: publiceren blijft uitgeschakeld zolang de
  regelbron niet formeel is bevestigd.

WAT U NODIG HEEFT OP DE COMPUTER
  Niets. Er hoeft geen Node, geen Python en geen PostgreSQL geïnstalleerd te
  zijn. Er is ook geen internet nodig.

BEVEILIGING EN PRIVACY
  Het platform luistert uitsluitend op 127.0.0.1. Andere computers in het
  netwerk kunnen er niet bij, ook niet op een openbaar wifinetwerk.

  MAAR: de gegevens op deze stick zijn niet versleuteld. Wie de stick heeft,
  heeft de gegevens. Zet er daarom geen echte persoonsgegevens in zolang NS de
  beveiliging van dit platform niet formeel heeft beoordeeld. Deze versie is
  bedoeld om te tonen wat het platform doet, niet om mee te werken.

ALS ER IETS MISGAAT
  Kijk in logs\\start.log. Daar staat in gewone taal wat er is misgegaan.
  De meest voorkomende oorzaken:
    - de stick staat op alleen-lezen
    - poort 3300 of 5434 is al in gebruik (aan te passen in config\\)
    - het kopiëren van de stick is halverwege afgebroken

RESERVEKOPIE
  Sluit het platform af en kopieer de map database\\ naar backups\\.
  Terugzetten: sluit het platform af en zet de kopie terug.
  Kopieer nooit terwijl het platform draait: dan kopieert u een database
  halverwege een wijziging.
`;

const MAP_UITLEG: Record<string, string> = {
  logs:
    "Hier komen de logbestanden.\n\n" +
    "start.log       wat er bij het starten gebeurde\n" +
    "applicatie.log  wat de applicatie zelf meldt\n" +
    "database.log    wat de database meldt\n\n" +
    "Deze bestanden blijven op de stick staan en gaan nergens heen.\n",
  exports:
    "Hier komen de bestanden die u vanuit het platform exporteert: roosterbladen,\n" +
    "overzichten en uitdraaien.\n",
  backups:
    "Hier kunt u reservekopieën van de map database\\ neerzetten.\n\n" +
    "Maak een kopie alleen wanneer het platform is afgesloten. Een kopie die\n" +
    "tijdens het draaien is gemaakt, kan een wijziging half bevatten.\n",
  database:
    "Hier staan uw gegevens.\n\n" +
    "Deze map niet met de hand wijzigen en niet kopiëren terwijl het platform\n" +
    "draait. Voor een reservekopie: eerst afsluiten, dan kopiëren.\n",
};

main();
