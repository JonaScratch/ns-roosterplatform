import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * De volledige doorloop: alles als één systeem.
 *
 * ## Waarom dit een dirigent is en geen twintigste script
 *
 * Elk onderdeel heeft al een eigen meting, en die metingen zijn scherper dan
 * wat een allesomvattend script ooit zou worden: `verify:cao-dagen` maakt echte
 * aanvragen aan, `verify:portable` start de bundel op een andere schijfletter,
 * `verify:crash-recovery` maakt processen kapot. Die opnieuw schrijven in één
 * bestand zou ze alleen maar oppervlakkiger maken.
 *
 * Wat er ontbrak, is de vraag of ze samen ook nog kloppen: of dezelfde database,
 * dezelfde bundel en dezelfde regels alle metingen achter elkaar doorstaan. Dat
 * is wat dit script doet — en het telt niet alleen of ze slagen, maar ook
 * hoeveel van de gevraagde scenario's werkelijk zijn afgedekt en welke niet.
 *
 * ## Waarom een geblokkeerde meting geen mislukking is en ook geen succes
 *
 * Waar een bron ontbreekt, kan een meting niets vaststellen. Dat wordt hier
 * apart geteld en apart gemeld. Een doorloop die zulke gevallen als "geslaagd"
 * meetelt, geeft een getal dat mooier is dan de werkelijkheid — en dat is
 * precies wat dit project niet wil.
 *
 * Draaien met een lopende ontwikkelserver: npm run verify:e2e
 */

const WORTEL = path.resolve(__dirname, "..");

interface Meting {
  readonly naam: string;
  readonly script: string;
  /** Wat deze meting afdekt van de gevraagde doorloop. */
  readonly dekt: readonly string[];
  /** Heeft deze meting een draaiende ontwikkelserver nodig? */
  readonly server?: boolean;
  /** Heeft deze meting een gebouwde draagbare bundel nodig? */
  readonly bundel?: boolean;
  /** Extra argumenten voor het script. */
  readonly args?: readonly string[];
}

const METINGEN: readonly Meting[] = [
  {
    naam: "Regels: gedrag van elke harde regel",
    script: "verify-rule-coverage.ts",
    dekt: ["regels: positieve en negatieve toets per harde regel"],
  },
  {
    naam: "Roosteruren en de 40-uursbalans",
    script: "verify-roster-hours.ts",
    dekt: ["RC: roosteruren per rooster", "RC: 40-uursbalans per rooster"],
  },
  {
    naam: "Roosterjaar december–december",
    script: "verify-rooster-year.ts",
    dekt: ["RC: roosterjaarselector", "RC: aansluitende perioden zonder gaten"],
  },
  {
    naam: "CAO-dagen van aanvraag tot verlofboek",
    script: "verify-cao-dagen.ts",
    dekt: [
      "medewerker: CAO-dag +42 dagen",
      "medewerker: aaneengesloten dagen geblokkeerd",
      "medewerker: 31 december en 1 januari geblokkeerd",
      "medewerker: aanvraag en melding",
      "DID: wachtrij en verwerkt in verlofboek",
      "DID: gelijktijdige verwerking",
    ],
  },
  {
    naam: "Dienstenpakket: sjabloon, upload en 223 diensten heen en terug",
    script: "verify-pakketimport.ts",
    dekt: [
      "import: Excel-sjabloon",
      "import: 223 diensten heen en terug",
      "import: weekdagafhankelijke tijden bij hetzelfde dienstnummer",
      "import: diensten over middernacht",
      "import: onleesbare cellen",
      "import: verkeerd bestandstype geweigerd",
    ],
  },
  {
    naam: "Exportsjabloon: de knop die de commissie als eerste gebruikt",
    script: "verify-template.ts",
    server: true,
    dekt: [
      "demo: sjabloon downloaden met de diensten erin",
      "demo: sjabloon weigert een onbekende standplaats",
    ],
  },
  {
    naam: "Scenario's: genereren, bewaren, toetsen en vergelijken",
    script: "verify-scenarios.ts",
    dekt: [
      "demo: scenario blijft bestaan na de sessie",
      "demo: onzekerheid is geen overtreding",
      "demo: simulatie mag terwijl publicatie geblokkeerd blijft",
      "demo: twee scenario's naast elkaar",
    ],
  },
  {
    naam: "Roosterprofielen: dagdeel, profielgrens en weigering",
    script: "verify-profielen.ts",
    dekt: [
      "v1.0.3: dagdeel uit aanvangstijd gelijk in database en code",
      "v1.0.3: geen vroege dienst in Laat/Nacht",
      "v1.0.3: profielovertreding wordt nooit bewaard",
    ],
  },
  {
    naam: "Generatie: drie kandidaten, stoppen en herbouwen",
    script: "verify-generatie.ts",
    args: ["--stop", "--herbouw"],
    dekt: [
      "v1.0.3: één generatie tegelijk",
      "v1.0.3: onderbroken opdracht blokkeert niet",
      "v1.0.3: drie verschillende complete kandidaten",
      "v1.0.3: stoppen tijdens het rekenen",
      "v1.0.3: gericht herbouwen met herkomst",
    ],
  },
  {
    naam: "Roosterkwaliteit: officieel naast gegenereerd",
    script: "verify-kwaliteit.ts",
    dekt: [
      "v1.0.3: nachten in reeksen, geen losse nachten",
      "v1.0.3: niet meer zware overgangen dan officieel",
      "v1.0.3: kwaliteitsmeting onderscheidt roosters",
    ],
  },
  {
    naam: "Ruilingen van voorstel tot uitvoering",
    script: "verify-ruilflow.ts",
    dekt: ["medewerker: ruilen", "DID: toezicht op ruilingen"],
  },
  {
    naam: "Plaatsingen en tijdelijke plaatsing",
    script: "verify-tijdelijke-plaatsing.ts",
    dekt: ["DID: tijdelijke roosterplaatsing", "medewerker: eigen rooster volgt de plaatsing"],
  },
  {
    naam: "Rotatie en de eigen roosterregel",
    script: "verify-rotatie.ts",
    dekt: ["medewerker: juiste huidige en volgende roosterregel"],
  },
  {
    naam: "Meldingen via de uitgaande wachtrij",
    script: "verify-meldingen.ts",
    dekt: ["medewerker: meldingen", "DID: meldingen"],
  },
  {
    naam: "Integriteit van de gegevens",
    script: "verify-integriteit.ts",
    dekt: ["alle rollen: geen tegenstrijdige gegevens"],
  },
  {
    naam: "Toegang per rol",
    script: "verify-toegang.ts",
    dekt: ["beheer: rollen en rechten", "alle rollen: standplaatsafbakening"],
  },
  {
    naam: "Schermen en interne verwijzingen",
    script: "verify-schermen.ts",
    server: true,
    dekt: [
      "medewerker: alle schermen",
      "medewerker: eigen rooster",
      "medewerker: reservevoorkeur alleen bij reserve",
      "medewerker: wachtlijst",
      "medewerker: beschikbare dienst",
      "RC: alle schermen",
      "RC: alle roosters zichtbaar",
      "RC: alle feedbackkaarten zichtbaar",
      "DID: alle schermen",
      "DID: openstaande diensten",
      "DID: reservekoppeling",
      "beheer: alle schermen",
      "RC: regels en kaders vereenvoudigd",
      "export: roosterblad als PDF",
      "export: Excel-sjabloon",
      "v1.0.3: resultaten zonder generatieknoppen",
      "v1.0.3: kandidaat als pakket en rooster in agendavorm",
      "v1.0.3: kandidaten vergelijken zonder winnaar",
      "v1.0.3: alle basisroosters als één PDF",
    ],
  },
  {
    naam: "Beeldmerk in alle omgevingen",
    script: "verify-branding.ts",
    dekt: ["export: NS-logo", "alle rollen: huisstijl"],
  },
  {
    naam: "Draagbare versie: starten, gebruiken, stoppen, herstarten",
    script: "verify-portable.ts",
    bundel: true,
    dekt: [
      "draagbaar: starten zonder installatie",
      "draagbaar: andere schijfletter en spaties in het pad",
      "draagbaar: alleen localhost",
      "draagbaar: gegevens blijven na herstart",
      "draagbaar: één exemplaar tegelijk",
    ],
  },
  {
    naam: "Crashbestendigheid en herstel",
    script: "verify-crash-recovery.ts",
    bundel: true,
    dekt: [
      "crash: bevestigde wijziging overleeft",
      "crash: halve transactie verdwijnt",
      "crash: uitgaande wachtrij hervat",
      "crash: import blijft consistent",
      "crash: draagbare database na vuile stop",
    ],
  },
];

/** Wat de opdracht vraagt, en dus wat afgedekt moet zijn. */
const GEVRAAGD: readonly string[] = [
  "medewerker: eigen rooster",
  "medewerker: juiste huidige en volgende roosterregel",
  "medewerker: reservevoorkeur alleen bij reserve",
  "medewerker: CAO-dag +42 dagen",
  "medewerker: aaneengesloten dagen geblokkeerd",
  "medewerker: 31 december en 1 januari geblokkeerd",
  "medewerker: aanvraag en melding",
  "medewerker: ruilen",
  "medewerker: wachtlijst",
  "medewerker: beschikbare dienst",
  "medewerker: meldingen",
  "medewerker: alle schermen",
  "DID: openstaande diensten",
  "DID: reservekoppeling",
  "DID: wachtrij en verwerkt in verlofboek",
  "DID: gelijktijdige verwerking",
  "DID: tijdelijke roosterplaatsing",
  "DID: toezicht op ruilingen",
  "DID: meldingen",
  "DID: alle schermen",
  "RC: alle roosters zichtbaar",
  "RC: alle feedbackkaarten zichtbaar",
  "RC: roosteruren per rooster",
  "RC: 40-uursbalans per rooster",
  "RC: regels en kaders vereenvoudigd",
  "RC: roosterjaarselector",
  "RC: aansluitende perioden zonder gaten",
  "RC: alle schermen",
  "beheer: rollen en rechten",
  "beheer: alle schermen",
  "import: Excel-sjabloon",
  "import: 223 diensten heen en terug",
  "import: weekdagafhankelijke tijden bij hetzelfde dienstnummer",
  "import: diensten over middernacht",
  "import: onleesbare cellen",
  "import: verkeerd bestandstype geweigerd",
  "export: roosterblad als PDF",
  "export: NS-logo",
  "export: Excel-sjabloon",
  "draagbaar: starten zonder installatie",
  "draagbaar: andere schijfletter en spaties in het pad",
  "draagbaar: alleen localhost",
  "draagbaar: gegevens blijven na herstart",
  "draagbaar: één exemplaar tegelijk",
  "crash: bevestigde wijziging overleeft",
  "crash: halve transactie verdwijnt",
  "crash: uitgaande wachtrij hervat",
  "crash: import blijft consistent",
  "crash: draagbare database na vuile stop",
  "regels: positieve en negatieve toets per harde regel",
  // De doorloop van de demo zelf: sjabloon, scenario, toetsing, vergelijking.
  // Die stond hier niet in, terwijl het precies de weg is die op het scherm
  // wordt voorgedaan — en dus de weg die niet stuk mag zijn.
  "demo: sjabloon downloaden met de diensten erin",
  "demo: sjabloon weigert een onbekende standplaats",
  "demo: scenario blijft bestaan na de sessie",
  "demo: onzekerheid is geen overtreding",
  "demo: simulatie mag terwijl publicatie geblokkeerd blijft",
  "demo: twee scenario's naast elkaar",
  // v1.0.3: generatie, kandidaten en roosterkwaliteit.
  "v1.0.3: dagdeel uit aanvangstijd gelijk in database en code",
  "v1.0.3: geen vroege dienst in Laat/Nacht",
  "v1.0.3: profielovertreding wordt nooit bewaard",
  "v1.0.3: één generatie tegelijk",
  "v1.0.3: onderbroken opdracht blokkeert niet",
  "v1.0.3: drie verschillende complete kandidaten",
  "v1.0.3: stoppen tijdens het rekenen",
  "v1.0.3: gericht herbouwen met herkomst",
  "v1.0.3: nachten in reeksen, geen losse nachten",
  "v1.0.3: niet meer zware overgangen dan officieel",
  "v1.0.3: kwaliteitsmeting onderscheidt roosters",
  "v1.0.3: resultaten zonder generatieknoppen",
  "v1.0.3: kandidaat als pakket en rooster in agendavorm",
  "v1.0.3: kandidaten vergelijken zonder winnaar",
  "v1.0.3: alle basisroosters als één PDF",
];

interface Uitkomst {
  readonly meting: Meting;
  readonly geslaagd: number;
  readonly mislukt: number;
  readonly geblokkeerd: number;
  readonly gelukt: boolean;
  readonly duurMs: number;
  readonly staart: string;
}

/** Haalt de tellingen uit de slotregel van een verificatiescript. */
function tel(uitvoer: string): { geslaagd: number; mislukt: number; geblokkeerd: number } {
  const laatste = [...uitvoer.matchAll(/(\d+)\s+(?:controles\s+)?geslaagd,\s*(\d+)\s+mislukt(?:,\s*(\d+)\s+geblokkeerd)?/g)];
  const schermen = [...uitvoer.matchAll(/(\d+)\s+schermen in orde,\s*(\d+)\s+met bevindingen/g)];
  if (laatste.length > 0) {
    const treffer = laatste[laatste.length - 1];
    return {
      geslaagd: Number(treffer[1]),
      mislukt: Number(treffer[2]),
      geblokkeerd: Number(treffer[3] ?? 0),
    };
  }
  // Twee metingen sluiten af met een zin in plaats van met tellingen. Hun
  // uitkomst zit in de exitcode; het aantal controles staat er niet bij, en dat
  // wordt hier ook niet verzonnen.
  if (/Alle rollen gedragen zich zoals verwacht/.test(uitvoer)) {
    return { geslaagd: 1, mislukt: 0, geblokkeerd: 0 };
  }
  if (/Elke gebouwde harde regel is op gedrag getoetst/.test(uitvoer)) {
    return { geslaagd: 1, mislukt: 0, geblokkeerd: 0 };
  }
  if (schermen.length > 0) {
    const treffer = schermen[schermen.length - 1];
    return { geslaagd: Number(treffer[1]), mislukt: Number(treffer[2]), geblokkeerd: 0 };
  }
  return { geslaagd: 0, mislukt: 0, geblokkeerd: 0 };
}

function main(): void {
  console.log("VOLLEDIGE DOORLOOP");
  console.log("═".repeat(78));
  console.log(
    "Elke meting hieronder draait echt: tegen de echte database, de echte\n" +
      "schermen en de echte draagbare bundel.\n",
  );

  const alleen = process.argv.slice(2);
  const uitkomsten: Uitkomst[] = [];

  for (const meting of METINGEN) {
    if (alleen.length > 0 && !alleen.some((deel) => meting.script.includes(deel))) {
      continue;
    }

    process.stdout.write(`${meting.naam}… `);
    const begin = Date.now();
    const uitvoer = spawnSync(
      process.execPath,
      [
        path.join(WORTEL, "node_modules", "tsx", "dist", "cli.mjs"),
        "--conditions=react-server",
        path.join(WORTEL, "scripts", meting.script),
        ...(meting.args ?? []),
      ],
      { encoding: "utf8", cwd: WORTEL, env: process.env, maxBuffer: 64 * 1024 * 1024 },
    );
    const duurMs = Date.now() - begin;
    const tekst = `${uitvoer.stdout ?? ""}${uitvoer.stderr ?? ""}`;
    const tellingen = tel(tekst);
    const gelukt = uitvoer.status === 0 && tellingen.mislukt === 0;

    uitkomsten.push({
      meting,
      ...tellingen,
      gelukt,
      duurMs,
      staart: tekst.trim().split("\n").slice(-4).join(" | ").slice(0, 300),
    });

    console.log(
      `${gelukt ? "✓" : "✗"} ${tellingen.geslaagd} geslaagd, ${tellingen.mislukt} mislukt` +
        `${tellingen.geblokkeerd > 0 ? `, ${tellingen.geblokkeerd} geblokkeerd` : ""}` +
        ` (${Math.round(duurMs / 1000)}s)`,
    );
    if (!gelukt) {
      console.log(`    ${uitkomsten[uitkomsten.length - 1].staart}`);
    }
  }

  // ── De optelsom ──────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(78)}`);
  const totaalGeslaagd = uitkomsten.reduce((som, rij) => som + rij.geslaagd, 0);
  const totaalMislukt = uitkomsten.reduce((som, rij) => som + rij.mislukt, 0);
  const totaalGeblokkeerd = uitkomsten.reduce((som, rij) => som + rij.geblokkeerd, 0);
  console.log(
    `${uitkomsten.length} metingen: ${totaalGeslaagd} controles geslaagd, ` +
      `${totaalMislukt} mislukt, ${totaalGeblokkeerd} geblokkeerd door een ontbrekende bron.`,
  );

  // ── Wat er van de gevraagde doorloop is afgedekt ─────────────────────────
  console.log(`\n${"─".repeat(78)}`);
  console.log("Dekking van de gevraagde doorloop\n");

  const afgedekt = new Set(
    uitkomsten.filter((rij) => rij.gelukt).flatMap((rij) => rij.meting.dekt),
  );
  const gemeten = new Set(uitkomsten.flatMap((rij) => rij.meting.dekt));

  const ontbreekt: string[] = [];
  for (const scenario of GEVRAAGD) {
    if (afgedekt.has(scenario)) {
      continue;
    }
    ontbreekt.push(`${gemeten.has(scenario) ? "mislukt" : "geen meting"}: ${scenario}`);
  }

  console.log(`  afgedekt en geslaagd   ${GEVRAAGD.length - ontbreekt.length}/${GEVRAAGD.length}`);
  if (ontbreekt.length > 0) {
    console.log("\n  Niet aangetoond:");
    for (const regel of ontbreekt) {
      console.log(`    ${regel}`);
    }
  }

  console.log(`\n${"═".repeat(78)}`);
  if (totaalMislukt === 0 && ontbreekt.length === 0) {
    console.log("De hele doorloop is aangetoond op echte gegevens.");
  } else {
    console.log(
      "De doorloop is niet volledig aangetoond. Wat hierboven bij 'Niet aangetoond'\n" +
        "staat, hoort in het eindrapport te staan — niet als afgerond.",
    );
    process.exitCode = 1;
  }
}

main();
