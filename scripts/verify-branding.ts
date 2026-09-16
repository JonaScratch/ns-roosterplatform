import "dotenv/config";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { svgToPdfDrawing } from "@/server/export/svg-logo";

/**
 * Het beeldmerk: staat het er, en staat het overal?
 *
 * ## Waarom dit een script is en geen afspraak
 *
 * "We gebruiken overal `NsLogo`" is precies het soort afspraak dat het één
 * scherm lang volhoudt. Dit script loopt de broncode af en zegt per plek of het
 * klopt: staat het aangeleverde bestand er, wijst het component ernaar, en zit
 * er nergens nog een oude vorm of een oude asset in een scherm.
 *
 * ## Eén canoniek bestand
 *
 * `public/brand/ns-logo.svg` is de enige toegestane bron. Er wordt hier
 * uitdrukkelijk óók gecontroleerd dat er géén oudere asset meer naast staat:
 * zolang die er is, kan hij ergens blijven meedraaien, en dan hangt het van een
 * volgorde in een lijst af welk logo er op een roosterblad belandt.
 *
 * Draaien met: npm run verify:branding
 */

const WORTEL = resolve(__dirname, "..");
const BRAND_DIR = join(WORTEL, "public", "brand");

/** Het enige toegestane bestand. */
const CANONIEK = "ns-logo.svg";
/** Optioneel, voor donkere achtergronden. */
const TOEGESTAAN_DAARNAAST = new Set([CANONIEK, "ns-logo-wit.svg", "LEESMIJ.md"]);

/** De plekken waar het beeldmerk hoort te staan. */
const PLEKKEN: readonly { readonly naam: string; readonly bestand: string }[] = [
  { naam: "Aanmeldscherm", bestand: "src/app/(auth)/aanmelden/page.tsx" },
  { naam: "Zijbalk en voettekst (alle vier de omgevingen)", bestand: "src/components/layout/app-shell.tsx" },
];

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

function bestandenIn(map: string): readonly string[] {
  return readdirSync(map, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? bestandenIn(join(map, item.name))
      : /\.(ts|tsx)$/.test(item.name)
        ? [join(map, item.name)]
        : [],
  );
}

function main(): void {
  console.log("BEELDMERK");
  console.log("═".repeat(66));

  // ── 1. Het aangeleverde bestand ──────────────────────────────────────────
  console.log("\n1. Het aangeleverde bestand");
  const pad = join(BRAND_DIR, CANONIEK);

  if (!existsSync(pad)) {
    blokkade(
      "het officiële NS-logo is aanwezig",
      `BLOCKED_BY_MISSING_SOURCE. Verwacht op public/brand/${CANONIEK}. ` +
        `Aangetroffen: ${
          existsSync(BRAND_DIR) ? readdirSync(BRAND_DIR).join(", ") || "niets" : "de map bestaat niet"
        }`,
    );
    console.log(`\n${"═".repeat(66)}`);
    console.log(`${geslaagd} geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd.`);
    process.exitCode = 1;
    return;
  }

  const inhoud = readFileSync(pad, "utf8");
  const grootte = statSync(pad).size;
  toets(
    `het aangeleverde bestand staat er (${CANONIEK}, ${Math.round(grootte / 1024)} kB)`,
    grootte > 0,
    "het bestand is leeg",
  );
  toets(
    "het is werkelijk een SVG en niet een ander bestand met die naam",
    inhoud.trimStart().startsWith("<?xml") || inhoud.trimStart().startsWith("<svg"),
    // Het eerder aangeleverde bestand heette .svg en was een PNG. Sindsdien
    // wordt dit gecontroleerd in plaats van aangenomen.
    `het bestand begint met ${JSON.stringify(inhoud.slice(0, 12))}`,
  );

  const tekening = svgToPdfDrawing(inhoud);
  toets(
    "de SVG is om te zetten naar tekenopdrachten voor de export",
    tekening !== null,
    "de paden bevatten iets wat de omzetting niet kent; er komt dan geen logo op het blad",
  );
  if (tekening) {
    console.log(
      `      ${tekening.width} × ${tekening.height} punten, ` +
        `${tekening.operations.split("\n").length} tekenopdrachten`,
    );
  }

  // ── 2. Geen oude assets ernaast ──────────────────────────────────────────
  console.log("\n2. Geen oude assets");
  const overtollig = readdirSync(BRAND_DIR).filter((naam) => !TOEGESTAAN_DAARNAAST.has(naam));
  toets(
    "er staat geen oudere logoasset naast de canonieke",
    overtollig.length === 0,
    `aangetroffen: ${overtollig.join(", ")}`,
  );

  const bronnen = bestandenIn(join(WORTEL, "src"));
  const oudeVerwijzingen = bronnen.filter((bestand) => {
    const tekst = readFileSync(bestand, "utf8");
    return /ns-logo\.png|ns-logo-blauw|ns-logo-white/.test(tekst);
  });
  toets(
    "nergens in de broncode wordt nog naar een oude asset verwezen",
    oudeVerwijzingen.length === 0,
    oudeVerwijzingen.map((bestand) => relative(WORTEL, bestand)).join(", "),
  );

  // ── 3. Het centrale component ────────────────────────────────────────────
  console.log("\n3. Het centrale component");
  const componentPad = join(WORTEL, "src", "components", "ui", "ns-logo.tsx");
  const component = existsSync(componentPad) ? readFileSync(componentPad, "utf8") : "";
  toets("er is één centraal logo-component", component.length > 0, "src/components/ui/ns-logo.tsx ontbreekt");
  toets(
    "het component leest het aangeleverde bestand uit public/brand",
    component.includes("brandAssets"),
    "het component verwijst niet naar de assetdetectie",
  );

  const assetsPad = join(WORTEL, "src", "server", "branding", "assets.ts");
  const assets = existsSync(assetsPad) ? readFileSync(assetsPad, "utf8") : "";
  toets(
    "de assetdetectie wijst naar precies één canoniek bestand",
    assets.includes(`"${CANONIEK}"`) && !assets.includes("ns-logo.png"),
    "er staat nog een terugvallijst met andere bestandsnamen in",
  );

  // ── 4. Geen terugvalvorm meer zichtbaar ──────────────────────────────────
  console.log("\n4. Geen terugvalvorm");
  const oudeGebruikers = bronnen.filter((bestand) => {
    if (bestand.endsWith(join("ui", "icons.tsx")) || bestand.endsWith(join("ui", "ns-logo.tsx"))) {
      // De definitie zelf en de gedocumenteerde terugval in NsLogo mogen blijven
      // bestaan; wat niet mag, is dat een scherm haar rechtstreeks tekent.
      return false;
    }
    return /\bBrandMark\b/.test(readFileSync(bestand, "utf8"));
  });
  toets(
    "geen enkel scherm tekent nog rechtstreeks de terugvalvorm",
    oudeGebruikers.length === 0,
    oudeGebruikers.map((bestand) => relative(WORTEL, bestand)).join(", "),
  );
  toets(
    "de terugval wordt niet getoond zolang het aangeleverde bestand er is",
    component.includes("brandAssets") && existsSync(pad),
    "het component kan de terugval tonen terwijl de asset aanwezig is",
  );

  // ── 5. De plekken waar het moet staan ────────────────────────────────────
  console.log("\n5. De plekken waar het beeldmerk hoort");
  for (const plek of PLEKKEN) {
    const bestandspad = join(WORTEL, plek.bestand);
    const tekst = existsSync(bestandspad) ? readFileSync(bestandspad, "utf8") : "";
    toets(
      `${plek.naam} gebruikt NsLogo`,
      tekst.includes("NsLogo"),
      `${plek.bestand} verwijst niet naar NsLogo`,
    );
  }

  // ── 6. De export ─────────────────────────────────────────────────────────
  console.log("\n6. De export");
  const renderPad = join(WORTEL, "src", "server", "export", "roster-sheet-render.ts");
  const render = existsSync(renderPad) ? readFileSync(renderPad, "utf8") : "";
  toets(
    "het roosterblad tekent het beeldmerk uit hetzelfde bestand",
    render.includes(CANONIEK),
    "de bladrenderer verwijst niet naar de canonieke asset",
  );
  toets(
    "het beeldmerk gaat als vector mee en niet als plaatje",
    render.includes("svgToPdfDrawing") && !render.includes("decodePng"),
    "de export zet het logo nog om naar pixels",
  );

  const sheetService = join(WORTEL, "src", "server", "services", "roster-sheet-service.ts");
  const dienst = existsSync(sheetService) ? readFileSync(sheetService, "utf8") : "";
  toets(
    "de voorvertoning gebruikt hetzelfde ingesloten beeldmerk",
    dienst.includes("brandLogoDataUri"),
    "de voorvertoning haalt het logo ergens anders vandaan",
  );

  console.log(`\n${"═".repeat(66)}`);
  console.log(
    `${geslaagd} controles geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd door een ` +
      "ontbrekende bron.",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main();
