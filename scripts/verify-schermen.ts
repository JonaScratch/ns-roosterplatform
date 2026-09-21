import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Renderen de schermen, en staat erop wat erop hoort te staan?
 *
 * ## Waarom dit meer is dan een statuscode
 *
 * `verify:toegang` bewijst dat een pagina wordt opgeleverd aan wie er recht op
 * heeft. Dat is iets anders dan: er staat ook iets zinnigs op. Een pagina die
 * met een lege lijst en een stille fout terugkomt, geeft net zo goed een 200.
 *
 * Dit script haalt daarom elke pagina echt op met een echte sessie, en kijkt of
 * de tekst erop staat die de functie herkenbaar maakt — het mailadres van de
 * dienstindeling, de kop van het meldingenoverzicht, de dienstenbak met zijn
 * tellingen.
 *
 * Draaien met een lopende ontwikkelserver: npm run verify:schermen
 */

const WORTEL = resolve(__dirname, "..");
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3300";
const SESSION_COOKIE = "nsr_session";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

interface Scherm {
  readonly path: string;
  /** Tekst die op de pagina moet staan. */
  readonly bevat: readonly string[];
  /** Tekst die er juist niet mag staan. */
  readonly bevatNiet?: readonly string[];
  /**
   * Zoals `bevat` en `bevatNiet`, maar tegen de ruwe HTML.
   *
   * `bevat` kijkt naar de pagina zoals een lezer hem ziet: de tags zijn eruit
   * gehaald. Een verwijzing of een invoerveld zit in een attribuut en is daar
   * dus onzichtbaar. Er stond daarom een controle op `type="date"` die nooit
   * iets kón vinden en altijd slaagde — precies het groene vinkje dat niets
   * bewijst. Wie een attribuut bedoelt, zet het hier.
   */
  readonly bronBevat?: readonly string[];
  readonly bronBevatNiet?: readonly string[];
  /**
   * Tekst die niet in beeld mag staan, maar wel achter een `<details>` mag.
   *
   * Voor technische namen zoals `TECHNICALLY_VALID_UNVERIFIED_RULES`. Die
   * mogen bestaan en moeten opzoekbaar blijven — wie een uitkomst betwist, moet
   * bij de ruwe status kunnen — maar ze horen niet in het beeld van wie een
   * scenario beoordeelt. Deze controle kijkt dus naar de pagina zonder de
   * dichtgeklapte blokken.
   */
  readonly bevatNietZichtbaar?: readonly string[];
  /**
   * Zet klaar wat dit scherm nodig heeft om iets te tonen, en ruim het daarna op.
   *
   * Voor schermen die op een lege database niets te tonen hebben. Zonder deze
   * haak zou de controle daar terugvallen op de tekst van de lege staat, en dan
   * bewijst een groen vinkje precies niets over de rij die er hoort te staan.
   */
  readonly klaarzetten?: () => Promise<() => Promise<void>>;
  /**
   * Hang zoveel bestaande scenario's aan de URL als `?vergelijk=…`.
   *
   * De ids zijn per database anders, dus ze kunnen niet in de lijst hierboven
   * staan. Zijn er te weinig scenario's, dan wordt het scherm overgeslagen met
   * een zichtbare melding — het stil laten slagen zou hetzelfde valse vinkje
   * opleveren als de lege pagina die deze controle juist moest vangen.
   */
  readonly queryUitScenarios?: number;
  /**
   * Sla dit scherm over wanneer het iets anders toont dan bedoeld, met reden.
   *
   * Het generatiescherm laat een lopende opdracht zien in plaats van het
   * keuzeformulier. Draait er tijdens de controle toevallig een meting, dan zou
   * de controle een fout melden die er geen is. Overslaan met een zichtbare
   * melding is eerlijker dan de eis versoepelen tot hij altijd slaagt.
   */
  readonly slaOverAls?: () => Promise<string | null>;
}

const SCHERMEN: Readonly<Record<string, readonly Scherm[]>> = {
  medewerker: [
    {
      path: "/medewerker",
      bevat: ["Contact Dienstindeling", "nsr.ddr-did-mcn@ns.nl", "Open in Outlook"],
      // Geen mailadres van een andere standplaats, en geen algemeen adres.
      bevatNiet: ["rtd-did", "ut-did"],
    },
    { path: "/medewerker/meldingen", bevat: ["Meldingen", "Ongelezen", "Ruilingen"] },
    {
      path: "/medewerker",
      bevat: ["Mijn basisrooster", "deze week", "volgende week"],
    },
    { path: "/medewerker/rooster", bevat: ["rooster"] },
    { path: "/medewerker/diensten", bevat: ["Open diensten"] },
    { path: "/medewerker/ruilen", bevat: ["uil"] },
    { path: "/medewerker/wachtlijsten", bevat: ["Wachtlijst"] },
    {
      // Deze pagina hoort zich anders te gedragen per medewerker: wie op een
      // vast rooster staat, krijgt uitleg in plaats van keuzes. Beide vormen
      // noemen het onderwerp; welke van de twee er staat, hangt af van de
      // medewerker in de seed.
      path: "/medewerker/reservevoorkeur",
      bevat: ["Reservevoorkeur"],
      // Geen keuzes tonen aan wie er niets aan heeft: dat belooft invloed die
      // er niet is.
      bevatNiet: ["voorkeur vrije werkdagen", "aaneengesloten blokken"],
    },
    {
      path: "/medewerker/cao-dagen",
      bevat: [
        "CAO-dagen",
        "Mijn aanvragen",
        "42 dagen vooruit",
        // De regel staat er vooraf, niet pas als iemand er tegenaan loopt.
        "niet op twee opeenvolgende dagen",
      ],
      // De kalender mag niet openen op een maand waarin nog niets te kiezen
      // valt, en er mag geen taal van goedkeuring in staan: een geldige
      // CAO-dagaanvraag is een recht.
      bevatNiet: ["goedkeuring", "ter beoordeling"],
    },
  ],
  "rooster-commissie": [
    { path: "/roostercommissie/dienstenbak", bevat: ["Dienstenbak", "Dienstsoorten"] },
    // Dienst 101 rijdt op zes weekdagen. Zonder weekdag wijst de URL niets aan;
    // mét weekdag hoort het scherm die dag te noemen en de andere te tonen.
    {
      path: "/roostercommissie/dienstenbak/101?weekdag=4",
      bevat: [
        "Dienst 101",
        "donderdag",
        "Herkomst",
        "SHA-256",
        // De andere weekdagen moeten er ook op staan: wie hier komt, moet zien
        // dat dit nummer op meer dagen rijdt en niet denken dat dit dé 101 is.
        "weekdagen, elk met eigen tijden",
        "maandag",
      ],
    },
    { path: "/roostercommissie/roosters/DDR-V", bevat: ["Vroeg 1 VA", "Uitersten"] },
    {
      path: "/roostercommissie/bezetting",
      bevat: ["Bezetting per weekdag", "maandag", "zondag", "Reservedagen", "geen norm"],
    },
    {
      // Het resultatenscherm. Hier wordt niets gegenereerd: geen strategiekeuze,
      // geen startknop. Wat er wél staat: de opdrachten met hun kandidaten, de
      // vergelijkknop, het huidige rooster als ijkpunt en de publicatieuitleg.
      path: "/roostercommissie/simulatie",
      bevat: [
        "Resultaten",
        "Nieuwe generatie",
        "Geselecteerde vergelijken",
        "Huidig rooster als ijkpunt",
        "Diensten geplaatst",
        "Bevestigde overtredingen",
        "Nachtclustering",
        "Overgangskwaliteit",
        "Opnieuw bouwen",
        "formeel worden gepubliceerd",
      ],
      bevatNiet: ["REJECTED", "Genereren starten", "Er is iets misgegaan", "Optimalisatiescore"],
      bronBevatNiet: ['name="strategy"'],
      bevatNietZichtbaar: [
        "TECHNICALLY_VALIDATED",
        "TECHNICALLY_VALID_UNVERIFIED_RULES",
        "TECHNICALLY_VALID_INCOMPLETE_CONTEXT",
        "CONFIRMED_HARD_VIOLATION",
        "INVALID_STRUCTURE",
        "NOT_VALIDATED",
      ],
    },
    {
      // Eén kandidaat als pakket van alle basisroosters.
      path: "/roostercommissie/simulatie/{kandidaat}",
      bevat: [
        "Basisroosters in dit pakket",
        "DDR-LN",
        "Nachtreeksen",
        "Roosterkwaliteit",
        "Huidig rooster",
        "Validatie",
        "Formele publicatie",
        "Opnieuw bouwen",
        "Wat moet beter?",
        "Alle basisroosters exporteren (PDF)",
      ],
      bevatNiet: ["Er is iets misgegaan", "CAO-score", "Perfect rooster"],
      bevatNietZichtbaar: ["TECHNICALLY_VALID_UNVERIFIED_RULES"],
    },
    {
      // Eén basisrooster in de agendavorm, met regelkeuze.
      path: "/roostercommissie/simulatie/{kandidaat}/DDR-LN?regel=1",
      bevat: ["DDR-LN", "Regel 1", "Alle regels", "Maandag", "Zondag", "Exporteren naar PDF", "Nachtreeksen", "Zware overgangen"],
      bronBevat: ["formaat=pdf"],
      bevatNiet: ["Er is iets misgegaan"],
    },
    {
      path: "/roostercommissie/simulatie/{kandidaat}/DDR-LN?regel=alle",
      bevat: ["Alle regels", "Uren", "Regel 1", "Regel 6"],
    },
    {
      // Twee kandidaten naast elkaar, zonder winnaar.
      path: "/roostercommissie/simulatie/vergelijken",
      bevat: ["Kandidaten vergelijken", "Roosterkwaliteit", "Per basisrooster", "Er wordt geen winnaar aangewezen"],
      bevatNiet: ["Beste rooster", "Er is iets misgegaan"],
      queryUitScenarios: 2,
    },
    {
      // Een verwijzing naar een kandidaat die er niet (meer) is: een nette 404
      // in plaats van de foutpagina.
      path: "/roostercommissie/simulatie/vergelijken?k=00000000-0000-4000-8000-000000000000",
      bevat: ["Kies twee of drie kandidaten"],
      bevatNiet: ["Er is iets misgegaan", "Opnieuw proberen"],
    },
    {
      path: "/roostercommissie/genereren",
      bevat: [
        "Nieuw rooster genereren",
        "Nulmeting",
        "Optimale totaalbalans",
        "Rust & regelmaat",
        "Eerlijkste lastenverdeling",
        // Sinds UI-1 is er één standaardgeneratie; de losse strategieën en de
        // rekentijd staan eronder, ingeklapt maar volledig aanwezig.
        "Een andere strategie kiezen",
        "Rekentijd instellen",
        // De rekentijdmodi van de adaptieve zoekmachine.
        "Hoe grondig mag gezocht worden?",
        "Snel",
        "Normaal",
        "Grondig",
        "Zeer grondig",
        "Roosterjaar",
        "Recente opdrachten",
        "tot en met",
      ],
      // Geen vrije datumkeuze: de periode volgt uit het roosterjaar.
      bronBevatNiet: ['name="from"', 'name="to"', 'type="date"'],
      // Loopt er een opdracht, dan toont dit scherm terecht de voortgang en niet
      // het keuzeformulier. Dat is geen fout en wordt ook niet als goed geteld.
      slaOverAls: async () => {
        const actief = await prisma.generationRun.findFirst({
          where: { status: { in: ["QUEUED", "RUNNING"] } },
          select: { strategyLabel: true },
        });
        return actief ? `er loopt een generatieopdracht (${actief.strategyLabel}); het scherm toont de voortgang` : null;
      },
    },
    {
      path: "/roostercommissie/pakketten",
      bevat: [
        "Dienstenpakketten",
        "Sjabloon downloaden",
        "04:27 / 11:07",
        "Bestand inlezen",
      ],
      // De knop moet naar de route wijzen die verderop als werkmap wordt
      // bewezen. Stond hier ooit een andere URL, dan downloadde de commissie
      // een 404 terwijl beide losse controles groen bleven.
      bronBevat: ["/roostercommissie/pakketten/sjabloon?standplaats="],
    },
    { path: "/roostercommissie/analyse", bevat: ["Waar de diensten terechtkomen"] },
    {
      // Elk rooster hoort in beeld te staan, ook het rooster waar niemand op
      // reageerde. Weglaten laat de commissie denken dat zij alles ziet.
      path: "/roostercommissie/feedback",
      bevat: ["Feedback", "respons"],
    },
    {
      path: "/roostercommissie/profielen",
      bevat: ["Roosterprofiel", "Gem. per week", "Roosteruren", "39:"],
      // Geen scherm noemt nog twee dienstnummers bij naam.
      bevatNiet: ["760", "761"],
    },
  ],
  dienstindeling: [
    {
      path: "/dienstindeling/openstaand",
      bevat: ["Openstaande diensten", "Kandidaten"],
      klaarzetten: openstaandeDienst,
    },
    {
      path: "/dienstindeling/roosters",
      bevat: ["Medewerkerroosters", "Deze week", "Volgende week", "Twee verschillende handelingen"],
    },
    { path: "/dienstindeling/reserve", bevat: ["Reserve"] },
    { path: "/dienstindeling/beschikbaar", bevat: ["schikbare diensten"] },
    {
      path: "/dienstindeling/cao-dagen",
      bevat: ["CAO-dagen", "Verwerkt in verlofboek", "NS-verlofboek"],
      // Geen goedkeurknop en geen afwijsknop: dit scherm legt vast wat er is
      // gedaan, het beslist niet of het mag.
      bevatNiet: ["Goedkeuren", "Afwijzen"],
      klaarzetten: openCaoDagAanvraag,
    },
  ],
  gedeeld: [
    {
      path: "/regels",
      bevat: [
        "Regels en kaders",
        "Arbeids- en rustregels",
        "Roosterregels",
        "Regio West en Dordrecht",
        "Dienstplaatsing",
        "Roosterprofielen",
        "Nog te bevestigen",
        "LET OP",
        "Technische gegevens",
      ],
      // De oude badges en de oude formulering horen nergens meer op dit
      // scherm te staan; de bronstatus zit achter het detail en in Beheer.
      bevatNiet: ["Overgenomen uit bron", "Bron laat meerdere lezingen toe"],
    },
  ],
  admin: [
    { path: "/beheer/organisatie", bevat: ["Standplaatsen", "DDR", "Dordrecht"] },
    { path: "/beheer/organisatie/DDR", bevat: ["Dordrecht", "Dienstenpakketten"] },
    { path: "/beheer/systeemstatus", bevat: ["Rooster-optimizer", "Exportsjabloon"] },
    {
      // Beheer houdt de technische bronstatus; die is uit het RC-scherm gehaald
      // maar nergens verdwenen.
      path: "/beheer/regelbronnen",
      bevat: ["Regelbronnen", "SOURCE_TRANSCRIBED", "Overgenomen uit bron", "WEEKLY_REST_72H_PER_14D"],
    },
  ],
};

/**
 * Eén openstaande CAO-dagaanvraag, zodat de wachtrij van de dienstindeling iets
 * te tonen heeft.
 *
 * Deze wordt rechtstreeks weggeschreven en niet via de service: het gaat hier
 * om wat het scherm rendert, en `verify:cao-dagen` bewijst de weg ernaartoe.
 */
async function openCaoDagAanvraag(): Promise<() => Promise<void>> {
  const medewerker = await prisma.employee.findFirst({
    where: { depot: "DDR", status: "ACTIVE" },
    select: { id: true },
  });
  const standplaats = await prisma.stationLocation.findUnique({
    where: { code: "DDR" },
    select: { id: true },
  });
  if (!medewerker || !standplaats) {
    return async () => {};
  }

  // Ver genoeg vooruit om nooit met een echte aanvraag te botsen.
  const datum = new Date(Date.UTC(2099, 0, 5));
  const rij = await prisma.caoDayRequest.create({
    data: {
      employeeId: medewerker.id,
      locationId: standplaats.id,
      requestedDate: datum,
      rosterSnapshot: { dutyCode: "101", timeRange: "08:33 - 16:14", positionType: "DUTY" },
      status: "REQUESTED",
    },
  });
  return async () => {
    await prisma.caoDayRequest.delete({ where: { id: rij.id } });
  };
}

/**
 * Eén dienst die bij de reserve ligt.
 *
 * Zonder deze rij toont het scherm zijn lege toestand, en dan ontbreekt de
 * kolom met de knoppen — inclusief de link "Kandidaten". De controle viel
 * daardoor om op een scherm dat niets mankeert: hij toetste een tabel die er
 * alleen is als er werk ligt. Het werk wordt hier dus neergelegd en daarna weer
 * opgeruimd, zodat de toets meet wat hij beweert te meten.
 */
async function openstaandeDienst(): Promise<() => Promise<void>> {
  const dienst = await prisma.duty.findFirst({
    where: { depot: "DDR" },
    select: { id: true },
    orderBy: { numericCode: "asc" },
  });
  if (!dienst) {
    return async () => {};
  }

  // Ver genoeg vooruit om nooit met een echte openstelling te botsen, en ruim
  // binnen het venster waarin nog gekozen kan worden.
  const datum = new Date(Date.UTC(2099, 0, 6));
  const rij = await prisma.availableDuty.create({
    data: {
      dutyId: dienst.id,
      date: datum,
      status: "RESERVE_PENDING",
      openReason: "Controle van het scherm",
      closesAt: new Date(Date.UTC(2098, 11, 30)),
    },
  });
  return async () => {
    await prisma.availableDuty.delete({ where: { id: rij.id } });
  };
}

const ACCOUNTS: Readonly<Record<string, string>> = {
  medewerker: "100001",
  "rooster-commissie": "900001",
  dienstindeling: "910001",
  gedeeld: "900001",
  admin: "990001",
};

let geslaagd = 0;
let mislukt = 0;
/** Niet getoetst omdat de gegevens ontbraken. Nooit stil, nooit als geslaagd. */
let geblokkeerd = 0;

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
    throw new Error(`Geen account ${employeeNumber}. Draai eerst de seed.`);
  }
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId: account.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + 15 * 60_000),
      absoluteExpiry: new Date(now + 30 * 60_000),
      clientFingerprint: "verify-schermen",
    },
  });
  return token;
}

function alsTekst(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/**
 * Wijst elke interne verwijzing in de broncode naar een bestaande route?
 *
 * Deze controle bestaat omdat een verplaatste pagina een link achterlaat die
 * nergens uit blijkt: de typecheck kent hem niet, de tests komen er niet langs,
 * en het scherm ziet er goed uit tot iemand klikt. Zo bleef er een knop
 * "Voorkeuren invullen" op het medewerkerdashboard staan nadat die pagina naar
 * `/medewerker/reservevoorkeur` was gegaan.
 *
 * Alleen letterlijke paden worden bekeken; een `href={variabele}` valt hier
 * buiten en hoort door de typecheck van Next te worden gedekt.
 */
function doodeLinks(): void {
  console.log("\nInterne verwijzingen");
  console.log("─".repeat(60));

  const appDir = join(WORTEL, "src", "app");

  // De routes die werkelijk bestaan, afgeleid uit de mappen met een page of
  // een route handler.
  const routes = new Set<string>();
  const loop = (map: string, pad: string): void => {
    for (const item of readdirSync(map, { withFileTypes: true })) {
      if (item.isDirectory()) {
        // Groepsmappen `(app)` zitten niet in de URL; `[param]` wel, maar dan
        // als jokerteken.
        const segment = /^\(.+\)$/.test(item.name)
          ? ""
          : /^\[.+\]$/.test(item.name)
            ? "/*"
            : `/${item.name}`;
        loop(join(map, item.name), pad + segment);
      } else if (/^(page|route)\.tsx?$/.test(item.name)) {
        routes.add(pad === "" ? "/" : pad);
      }
    }
  };
  loop(appDir, "");

  const past = (href: string): boolean => {
    const pad = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
    if (routes.has(pad)) {
      return true;
    }
    // Een route met een parameter: `/x/*` dekt `/x/DDR-V`.
    const delen = pad.split("/");
    return [...routes].some((route) => {
      const routeDelen = route.split("/");
      return (
        routeDelen.length === delen.length &&
        routeDelen.every((deel, index) => deel === "*" || deel === delen[index])
      );
    });
  };

  const bestanden = (map: string): string[] =>
    readdirSync(map, { withFileTypes: true }).flatMap((item) =>
      item.isDirectory()
        ? bestanden(join(map, item.name))
        : /\.tsx?$/.test(item.name)
          ? [join(map, item.name)]
          : [],
    );

  const kapot: string[] = [];
  let bekeken = 0;
  for (const bestand of bestanden(join(WORTEL, "src"))) {
    const inhoud = readFileSync(bestand, "utf8");
    for (const treffer of inhoud.matchAll(/(?:href|actionPath|link)[:=]\s*"(\/[^"]*)"/g)) {
      bekeken += 1;
      if (!past(treffer[1])) {
        kapot.push(`${relative(WORTEL, bestand)} → ${treffer[1]}`);
      }
    }
  }

  if (kapot.length === 0) {
    geslaagd += 1;
    console.log(`  ✓ alle ${bekeken} letterlijke interne verwijzingen wijzen naar een route`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${kapot.length} van de ${bekeken} verwijzingen wijzen nergens heen:`);
    for (const regel of kapot) {
      console.log(`      ${regel}`);
    }
  }
}

/**
 * De URL waarmee dit scherm wordt opgehaald.
 *
 * `null` betekent: de gegevens die dit scherm nodig heeft, staan er niet. De
 * aanroeper meldt dat dan als "niet getoetst" — niet als geslaagd.
 */
async function metScenarioQuery(scherm: Scherm): Promise<string | null> {
  // `{kandidaat}` in het pad: de nieuwste bruikbare kandidaat uit een
  // generatieopdracht. Is die er niet, dan is het scherm niet te toetsen.
  if (scherm.path.includes("{kandidaat}")) {
    const kandidaat = await prisma.candidateRoster.findFirst({
      where: {
        generationRunId: { not: null },
        archivedAt: null,
        validationState: { in: ["TECHNICALLY_VALIDATED", "TECHNICALLY_VALID_UNVERIFIED_RULES"] },
      },
      orderBy: { generatedAt: "desc" },
      select: { id: true },
    });
    return kandidaat ? scherm.path.replace("{kandidaat}", kandidaat.id) : null;
  }
  if (scherm.queryUitScenarios === undefined) {
    return scherm.path;
  }

  // Dezelfde selectie als het scherm zelf maakt: getoetst en bruikbaar, of nog
  // helemaal niet getoetst. Een kandidaat die de validator inhoudelijk heeft
  // afgewezen hoort niet in een vergelijking en dus ook niet in deze controle.
  const scenarios = await prisma.candidateRoster.findMany({
    where: {
      validationState: {
        in: [
          "NOT_VALIDATED",
          "TECHNICALLY_VALIDATED",
          "TECHNICALLY_VALID_UNVERIFIED_RULES",
          "TECHNICALLY_VALID_INCOMPLETE_CONTEXT",
        ],
      },
    },
    orderBy: { generatedAt: "desc" },
    take: scherm.queryUitScenarios,
    select: { id: true },
  });
  if (scenarios.length < scherm.queryUitScenarios) {
    return null;
  }

  const query = scenarios.map((scenario) => `k=${scenario.id}`).join("&");
  return `${scherm.path}?${query}`;
}

async function main(): Promise<void> {
  console.log(`SCHERMCONTROLE tegen ${BASE_URL}`);
  console.log("════════════════════════════════════════════════════════════");

  const tokens = new Map<string, string>();
  for (const [rol, nummer] of Object.entries(ACCOUNTS)) {
    tokens.set(rol, await openSession(nummer));
  }

  for (const [rol, schermen] of Object.entries(SCHERMEN)) {
    console.log(`\n${rol}`);
    console.log("─".repeat(60));
    const token = tokens.get(rol)!;

    for (const scherm of schermen) {
      const pad = await metScenarioQuery(scherm);
      if (pad === null) {
        geblokkeerd += 1;
        console.log(
          `  … ${scherm.path} — niet getoetst: ${scherm.queryUitScenarios} vergelijkbare ` +
            "scenario's nodig, die staan niet in deze database",
        );
        continue;
      }

      const overslaan = scherm.slaOverAls ? await scherm.slaOverAls() : null;
      if (overslaan !== null) {
        geblokkeerd += 1;
        console.log(`  … ${scherm.path} — niet getoetst: ${overslaan}`);
        continue;
      }

      const opruimen = scherm.klaarzetten ? await scherm.klaarzetten() : null;
      const response = await fetch(`${BASE_URL}${pad}`, {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
        redirect: "manual",
      });
      const bron = response.status === 200 ? await response.text() : "";
      const tekst = alsTekst(bron);
      await opruimen?.();

      const ontbreekt = [
        ...scherm.bevat.filter((stuk) => !tekst.includes(stuk)),
        ...(scherm.bronBevat ?? []).filter((stuk) => !bron.includes(stuk)),
      ];
      // Dezelfde pagina, maar zonder wat er dichtgeklapt staat.
      const zichtbaar = alsTekst(bron.replace(/<details[\s\S]*?<\/details>/g, " "));
      const teveel = [
        ...(scherm.bevatNiet ?? []).filter((stuk) =>
          tekst.toLowerCase().includes(stuk.toLowerCase()),
        ),
        ...(scherm.bronBevatNiet ?? []).filter((stuk) =>
          bron.toLowerCase().includes(stuk.toLowerCase()),
        ),
        ...(scherm.bevatNietZichtbaar ?? []).filter((stuk) =>
          zichtbaar.toLowerCase().includes(stuk.toLowerCase()),
        ),
      ];
      const goed = response.status === 200 && ontbreekt.length === 0 && teveel.length === 0;

      if (goed) {
        geslaagd += 1;
        console.log(`  ✓ ${pad}`);
      } else {
        mislukt += 1;
        console.log(
          `  ✗ ${pad} (${response.status})` +
            (ontbreekt.length > 0 ? ` — mist: ${ontbreekt.join(", ")}` : "") +
            (teveel.length > 0 ? ` — bevat ten onrechte: ${teveel.join(", ")}` : ""),
        );
      }
    }
  }

  // ── De PDF-export ────────────────────────────────────────────────────────
  // Apart, want dit is geen HTML: hier telt of er bytes uitkomen die met de
  // PDF-handtekening beginnen. Een route die netjes 200 teruggeeft met een
  // HTML-foutpagina erin, zou anders als geslaagd tellen.
  console.log("\nExport");
  console.log("─".repeat(60));
  const rcToken = tokens.get("rooster-commissie")!;
  const pdfResponse = await fetch(`${BASE_URL}/roostercommissie/roosterblad/DDR-V?formaat=pdf`, {
    headers: { cookie: `${SESSION_COOKIE}=${rcToken}` },
    redirect: "manual",
  });
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  const isPdf =
    pdfResponse.status === 200 &&
    pdfResponse.headers.get("content-type") === "application/pdf" &&
    pdfBytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
    pdfBytes.subarray(-1024).toString("latin1").includes("%%EOF");
  if (isPdf) {
    geslaagd += 1;
    console.log(
      `  ✓ /roostercommissie/roosterblad/DDR-V?formaat=pdf (${pdfBytes.length} bytes)`,
    );
  } else {
    mislukt += 1;
    console.log(
      `  ✗ /roostercommissie/roosterblad/DDR-V?formaat=pdf (${pdfResponse.status}, ` +
        `${pdfResponse.headers.get("content-type")}, ${pdfBytes.length} bytes)`,
    );
  }

  // Hetzelfde blad, maar dan van een scenario. Dit is de weg die de commissie
  // na het toetsen gebruikt: een voorstel op papier krijgen. Het moet een echte
  // PDF zijn, en de bestandsnaam moet zeggen dat het een simulatie is — een
  // scenarioblad dat op een vastgesteld rooster lijkt, is het gevaarlijkste
  // document dat dit platform kan maken.
  const scenario = await prisma.candidateRoster.findFirst({
    orderBy: { generatedAt: "desc" },
    select: { id: true },
  });
  if (!scenario) {
    geblokkeerd += 1;
    console.log(
      "  … roosterblad van een scenario — niet getoetst: er staat geen scenario in de database",
    );
  } else {
    const scenarioPdf = await fetch(
      `${BASE_URL}/roostercommissie/roosterblad/DDR-V?formaat=pdf&kandidaat=${scenario.id}`,
      { headers: { cookie: `${SESSION_COOKIE}=${rcToken}` }, redirect: "manual" },
    );
    const scenarioBytes = Buffer.from(await scenarioPdf.arrayBuffer());
    const bestandsnaam =
      /filename="([^"]*)"/.exec(scenarioPdf.headers.get("content-disposition") ?? "")?.[1] ?? "";
    const goed =
      scenarioPdf.status === 200 &&
      scenarioBytes.subarray(0, 5).toString() === "%PDF-" &&
      bestandsnaam.includes("SIMULATIE");
    if (goed) {
      geslaagd += 1;
      console.log(`  ✓ roosterblad van een scenario als PDF (${bestandsnaam}, ${scenarioBytes.length} bytes)`);
    } else {
      mislukt += 1;
      console.log(
        `  ✗ roosterblad van een scenario als PDF (${scenarioPdf.status}, ` +
          `${bestandsnaam || "geen bestandsnaam"}, ${scenarioBytes.length} bytes)`,
      );
    }

    // Een verwijzing naar een scenario dat er niet meer is, hoort een leesbare
    // 404 te geven en geen 500 met "Er is iets misgegaan".
    const weg = await fetch(
      `${BASE_URL}/roostercommissie/roosterblad/DDR-V?formaat=pdf&kandidaat=00000000-0000-4000-8000-000000000000`,
      { headers: { cookie: `${SESSION_COOKIE}=${rcToken}` }, redirect: "manual" },
    );
    const wegTekst = await weg.text();
    if (weg.status === 404 && wegTekst.includes("bestaat niet")) {
      geslaagd += 1;
      console.log("  ✓ een verdwenen scenario geeft een leesbare 404");
    } else {
      mislukt += 1;
      console.log(`  ✗ een verdwenen scenario geeft ${weg.status}: ${wegTekst.slice(0, 80)}`);
    }
  }

  // Alle basisroosters van een kandidaat in één PDF: één blad per rooster, met
  // de simulatiestempel in de bestandsnaam.
  const pakket = await prisma.candidateRoster.findFirst({
    where: { generationRunId: { not: null }, archivedAt: null },
    orderBy: { generatedAt: "desc" },
    select: { id: true, assignments: true },
  });
  if (!pakket) {
    geblokkeerd += 1;
    console.log("  … pakket-PDF — niet getoetst: er is nog geen kandidaat uit een generatieopdracht");
  } else {
    const roosters = new Set(
      (pakket.assignments as unknown as { baseRosterCode: string }[]).map((entry) => entry.baseRosterCode),
    ).size;
    const antwoord = await fetch(`${BASE_URL}/roostercommissie/simulatie/${pakket.id}/pdf`, {
      headers: { cookie: `${SESSION_COOKIE}=${rcToken}` },
      redirect: "manual",
    });
    const bytes = Buffer.from(await antwoord.arrayBuffer());
    const naam = /filename="([^"]*)"/.exec(antwoord.headers.get("content-disposition") ?? "")?.[1] ?? "";
    const paginas = (bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    const goed =
      antwoord.status === 200 &&
      bytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
      naam.includes("SIMULATIE") &&
      paginas >= roosters;
    if (goed) {
      geslaagd += 1;
      console.log(`  ✓ alle basisroosters als één PDF (${naam}, ${paginas} bladen voor ${roosters} roosters)`);
    } else {
      mislukt += 1;
      console.log(`  ✗ pakket-PDF (${antwoord.status}, ${naam || "geen naam"}, ${paginas} bladen voor ${roosters} roosters)`);
    }
  }

  doodeLinks();

  // Het Excel-sjabloon: geen HTML maar een werkmap, en het moet ook werkelijk
  // een zip zijn. Een route die netjes 200 teruggeeft met een foutpagina erin
  // zou anders als geslaagd tellen.
  const sjabloonResponse = await fetch(
    `${BASE_URL}/roostercommissie/pakketten/sjabloon?standplaats=DDR&dienstregeling=HUIDIG`,
    { headers: { cookie: `${SESSION_COOKIE}=${rcToken}` }, redirect: "manual" },
  );
  const sjabloonBytes = Buffer.from(await sjabloonResponse.arrayBuffer());
  const isWerkmap =
    sjabloonResponse.status === 200 &&
    (sjabloonResponse.headers.get("content-type") ?? "").includes("spreadsheetml") &&
    sjabloonBytes.length > 4 &&
    sjabloonBytes.readUInt32LE(0) === 0x04034b50 &&
    sjabloonBytes.toString("latin1").includes("xl/worksheets/sheet1.xml");
  if (isWerkmap) {
    geslaagd += 1;
    console.log(`  ✓ /roostercommissie/pakketten/sjabloon (${sjabloonBytes.length} bytes)`);
  } else {
    mislukt += 1;
    console.log(
      `  ✗ /roostercommissie/pakketten/sjabloon (${sjabloonResponse.status}, ` +
        `${sjabloonResponse.headers.get("content-type")}, ${sjabloonBytes.length} bytes)`,
    );
  }

  for (const token of tokens.values()) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date(), revokedReason: "schermcontrole afgerond" },
    });
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(
    `${geslaagd} schermen in orde, ${mislukt} met bevindingen` +
      (geblokkeerd > 0 ? `, ${geblokkeerd} niet getoetst (gegevens ontbreken)` : "") +
      ".",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
