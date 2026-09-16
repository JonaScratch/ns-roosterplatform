import "dotenv/config";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  caoArticleBodies,
  caoArticles,
  containsNumber,
  findCaoArticle,
} from "@/server/import/cao-articles";
import { hasTextLayer } from "@/server/import/pdf-text";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";

/**
 * Verwijzen de regels naar artikelen die werkelijk bestaan?
 *
 * ## Wat hier wel en niet wordt bewezen
 *
 * Elke regel draagt een artikelverwijzing: "artikel 98, dagelijkse rust". Tot
 * nu toe was dat een bewering zonder tegenspraak — er lag geen CAO naast. Nu
 * wel. Dit script legt elke verwijzing tegen de inhoudsopgave van de
 * aangeleverde CAO en zegt per regel of het artikel bestaat en hoe het heet.
 *
 * Wat dit **niet** bewijst: dat de wáárde klopt. Dat artikel 98 over dagelijkse
 * rust gaat, zegt niets over de vraag of die rust twaalf uur is. Die stap
 * vraagt iemand die de CAO leest en tekent, en staat in `docs/rule-coverage.md`
 * als `FORMALLY_VALIDATED` — op false, voor elke regel.
 *
 * Dat onderscheid is het hele punt. Een script dat "regels gecontroleerd tegen
 * de CAO ✓" afdrukt terwijl het alleen nummers heeft vergeleken, is precies het
 * soort groene vinkje waar niemand iets aan heeft.
 *
 * Draaien met: npm run verify:regelbronnen
 */

const WORTEL = resolve(__dirname, "..");
const BRONMAP = join(WORTEL, "tests", "fixtures", "dordrecht-bronnen");

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function main(): void {
  console.log("REGELS TEGEN DE AANGELEVERDE BRONNEN");
  console.log("═".repeat(78));

  const ruleset = activeRuleset();
  console.log(
    `\nRegelbestand ${ruleset.version} · modus ${ruleset.mode} · ` +
      `juridische status ${ruleset.legalStatus}`,
  );
  console.log(`${ruleset.rules.length} regels, ${ruleset.missingPackages.length} ontbrekende pakketten.`);

  // ── 1. De CAO ────────────────────────────────────────────────────────────
  console.log("\n1. De CAO");
  const caoBestand = readdirSync(BRONMAP).find((naam) => /CAO/i.test(naam));
  if (!caoBestand || !existsSync(join(BRONMAP, caoBestand))) {
    console.log("  ⊘ BLOCKED_BY_MISSING_SOURCE — er is geen CAO aangeleverd.");
    process.exitCode = 1;
    return;
  }
  const caoBytes = readFileSync(join(BRONMAP, caoBestand));
  const artikelen = caoArticles(caoBytes);
  console.log(`  ${caoBestand}: ${artikelen.length} artikelen uit de inhoudsopgave.`);
  toets(
    "de CAO is leesbaar en levert een bruikbare artikelindex op",
    artikelen.length > 0,
    "de inhoudsopgave kon niet worden gelezen; verwijzingen zijn niet te controleren",
  );
  if (artikelen.length === 0) {
    process.exitCode = 1;
    return;
  }

  // ── 2. De verwijzingen ───────────────────────────────────────────────────
  console.log("\n2. De artikelverwijzingen");
  const caoRegels = ruleset.rules.filter((regel) => regel.source.legalAuthority === "CAO");
  const metArtikel = caoRegels.filter((regel) => regel.source.article !== undefined);
  const zonderArtikel = caoRegels.filter((regel) => regel.source.article === undefined);

  const onbekend: string[] = [];
  const gevonden: { id: string; artikel: string; titel: string }[] = [];
  const waardeGevonden: string[] = [];
  const waardeElders: string[] = [];
  const waardeNergens: string[] = [];
  const zonderWaarde: string[] = [];

  const teksten = caoArticleBodies(caoBytes);

  /**
   * Het hoofdstuk arbeids- en rusttijden: artikel 97 tot en met 122.
   *
   * Buiten dat hoofdstuk zoeken heeft geen zin. Het getal 36 staat ook in het
   * artikel over jubilea en in het artikel over reiskosten, en een meting die
   * dát meldt als "de norm staat elders" wijst de lezer alleen maar weg van de
   * plek waar hij moet kijken.
   */
  const hoofdstuk = teksten.filter((artikel) => {
    const nummer = Number.parseInt(artikel.number, 10);
    return nummer >= 97 && nummer <= 122;
  });

  for (const regel of metArtikel) {
    const artikel = findCaoArticle(artikelen, regel.source.article!);
    if (!artikel) {
      onbekend.push(`${regel.id} → artikel ${regel.source.article} bestaat niet in deze CAO`);
      continue;
    }
    gevonden.push({ id: regel.id, artikel: artikel.number, titel: artikel.title });

    // De waarde is het enige dat werkelijk te controleren valt. Een artikeltitel
    // vergelijken met een regelnaam levert woordgelijkenis op en geen bewijs;
    // het getal staat er of het staat er niet.
    if (regel.value === null) {
      zonderWaarde.push(`${regel.id} (${regel.title})`);
      continue;
    }

    const body = teksten.find((kandidaat) => kandidaat.number === artikel.number);
    // Een waarde in minuten schrijft de CAO als klokstand of als uren: 420
    // minuten heet daar "07.00 uur" en niet "420". Zonder die vertaling zou de
    // meting melden dat de norm nergens in de CAO staat, terwijl zij er staat.
    const zoekwaarden =
      regel.unit === "MINUTES" ? [regel.value, regel.value / 60] : [regel.value];
    const staatIn = (tekst: string): boolean =>
      zoekwaarden.some((waarde) => containsNumber(tekst, waarde));

    const naam = `${regel.id} = ${regel.value} ${regel.unit.toLowerCase()} → art. ${artikel.number}`;

    if (body && staatIn(body.text)) {
      waardeGevonden.push(naam);
    } else {
      const elders = hoofdstuk
        .filter((kandidaat) => staatIn(kandidaat.text))
        .map((kandidaat) => kandidaat.number);
      if (elders.length > 0) {
        // Eén alternatief is een aanwijzing; twintig alternatieven zijn ruis.
        // Het getal 5 staat in bijna elk artikel en zegt dus niets; het getal
        // 72 staat in precies één ander artikel, en dat is wél iets.
        const scherp =
          elders.length === 1
            ? `\n          LET OP: precies één ander artikel bevat dit getal. ` +
              "Dit is een concrete aanwijzing dat de verwijzing verkeerd staat."
            : "";
        waardeElders.push(
          `${naam}\n          het getal staat niet in artikel ${artikel.number} ` +
            `(p. ${body?.firstPage}–${body?.lastPage}) maar wel in art. ${elders.join(", ")}.` +
            scherp,
        );
      } else {
        waardeNergens.push(
          `${naam}\n          dit getal komt in het hele hoofdstuk arbeids- en ` +
            "rusttijden niet voor.",
        );
      }
    }
  }

  console.log(`  ${caoRegels.length} CAO-regels, waarvan ${metArtikel.length} met artikelnummer.`);
  toets(
    "elk genoemd CAO-artikel bestaat werkelijk in de aangeleverde CAO",
    onbekend.length === 0,
    onbekend.slice(0, 6).join(" · "),
  );

  if (zonderArtikel.length > 0) {
    console.log(`  ${zonderArtikel.length} CAO-regels noemen geen artikelnummer:`);
    for (const regel of zonderArtikel.slice(0, 8)) {
      console.log(`      ${regel.id} — ${regel.title}`);
    }
  }
  toets(
    "elke CAO-regel noemt het artikel waar zij vandaan komt",
    zonderArtikel.length === 0,
    `${zonderArtikel.length} regels zonder artikelverwijzing`,
  );

  // Welke artikelen worden aangehaald, en waarvoor.
  const perArtikel = new Map<string, { titel: string; regels: string[] }>();
  for (const item of gevonden) {
    const bestaand = perArtikel.get(item.artikel);
    if (bestaand) {
      bestaand.regels.push(item.id);
    } else {
      perArtikel.set(item.artikel, { titel: item.titel, regels: [item.id] });
    }
  }
  console.log(`\n  Aangehaalde artikelen (${perArtikel.size}):`);
  for (const [nummer, item] of [...perArtikel.entries()].sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    const body = teksten.find((kandidaat) => kandidaat.number === nummer);
    console.log(
      `      art. ${nummer.padStart(4)} "${item.titel}" (p. ${body?.firstPage}–${body?.lastPage}) ` +
        `— ${item.regels.length} regel(s)`,
    );
  }

  // ── 2b. De waarden ───────────────────────────────────────────────────────
  console.log("\n2b. De waarden tegen de tekst van het aangehaalde artikel");
  console.log(`  in het aangehaalde artikel teruggevonden: ${waardeGevonden.length}`);
  console.log(`  wel in de CAO, maar in een ander artikel:  ${waardeElders.length}`);
  console.log(`  nergens in de CAO teruggevonden:           ${waardeNergens.length}`);
  console.log(`  regels zonder waarde (niet aangeleverd):   ${zonderWaarde.length}`);

  if (waardeElders.length > 0) {
    console.log("\n  Staat elders in de CAO:");
    for (const regel of waardeElders) {
      console.log(`      · ${regel}`);
    }
  }
  if (waardeNergens.length > 0) {
    console.log("\n  Niet in de CAO teruggevonden:");
    for (const regel of waardeNergens) {
      console.log(`      · ${regel}`);
    }
  }
  console.log(
    "\n  Wat hier NIET uit volgt: dat een teruggevonden getal de juiste norm is. Het\n" +
      "  getal 7 staat in artikel 99, en dat is geen bewijs dat de maximale dienstlengte\n" +
      "  bij een start vóór 05:01 zeven uur is. Deze meting wijst aan waar iemand moet\n" +
      "  kijken; zij vervangt dat kijken niet. Niets is op grond hiervan aangepast.",
  );

  // ── 3. Het regionale kader ───────────────────────────────────────────────
  console.log("\n3. Het regionale kader");
  const kaderBestand = readdirSync(BRONMAP).find((naam) => /Roosterkaders/i.test(naam));
  const regionaal = ruleset.rules.filter((regel) => regel.source.legalAuthority === "REGIO");
  if (!kaderBestand) {
    console.log("  ⊘ BLOCKED_BY_MISSING_SOURCE — geen regionaal kader aangeleverd.");
  } else {
    const leesbaar = hasTextLayer(readFileSync(join(BRONMAP, kaderBestand)));
    console.log(
      `  ${kaderBestand}: ${leesbaar ? "machineleesbaar" : "SOURCE_PRESENT_NOT_MACHINE_READABLE"}`,
    );
    console.log(`  ${regionaal.length} regionale regels in het regelbestand.`);
    if (!leesbaar) {
      console.log(
        "  Het bestand is een scan zonder tekstlaag. De regionale regels zijn daarom niet\n" +
          "  tegen hun bron te leggen. Zij blijven op hun huidige status staan; er is niets\n" +
          "  uit dit bestand overgenomen dat niet door een mens is overgeschreven.",
      );
    }
  }
  // Dit is uitdrukkelijk geen falende toets: een onleesbare bron is geen fout
  // in de code. Wat wél fout zou zijn, is doen alsof hij gelezen is.
  toets(
    "geen enkele regionale regel claimt formeel gevalideerd te zijn",
    regionaal.every((regel) => regel.status !== "VALIDATED"),
    "een regel uit een onleesbare bron staat op VALIDATED",
  );

  // ── 4. De validatiestatus ────────────────────────────────────────────────
  console.log("\n4. Validatiestatus");
  const perStatus = new Map<string, number>();
  for (const regel of ruleset.rules) {
    perStatus.set(regel.status, (perStatus.get(regel.status) ?? 0) + 1);
  }
  for (const [status, aantal] of [...perStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(32)} ${aantal}`);
  }
  // Wat hier fout zou zijn, is niet dat er een regel op VALIDATED staat, maar
  // dat een regel uit een NS-bron dat doet. Wij kunnen een CAO-artikel niet
  // bevestigen; dat kan alleen NS. Een regel die dit platform zelf stelt en
  // zelf kan bewijzen — is een anker verplaatst, staat er een dienstnummer in
  // het reserverooster — is een ander geval: die bewering is hier hard te maken.
  const tenOnrechteGevalideerd = ruleset.rules.filter(
    (regel) => regel.status === "VALIDATED" && regel.source.legalAuthority !== "PRODUCT",
  );
  const productGevalideerd = ruleset.rules.filter(
    (regel) => regel.status === "VALIDATED" && regel.source.legalAuthority === "PRODUCT",
  );
  console.log(
    `  waarvan uit een NS-bron: ${tenOnrechteGevalideerd.length}, ` +
      `eigen productbeleid: ${productGevalideerd.length}`,
  );
  toets(
    "geen enkele regel uit een NS-bron beweert door ons gevalideerd te zijn",
    tenOnrechteGevalideerd.length === 0,
    tenOnrechteGevalideerd.map((regel) => regel.id).join(", "),
  );
  toets(
    "geen enkele regel van eigen productbeleid doet zich voor als NS-bron",
    ruleset.rules.every(
      (regel) =>
        (regel.source.document === "NS-ROOSTERPLATFORM") ===
        (regel.source.legalAuthority === "PRODUCT"),
    ),
    "productbeleid en NS-bron zijn niet consequent uit elkaar gehouden",
  );
  toets(
    "het regelbestand draait niet in productiemodus",
    ruleset.mode !== "PRODUCTION",
    "het regelbestand staat op PRODUCTION terwijl de bronnen niet formeel zijn bevestigd",
  );

  // ── 5. Ontbrekende pakketten ─────────────────────────────────────────────
  console.log("\n5. Ontbrekende regelpakketten");
  for (const pakket of ruleset.missingPackages) {
    console.log(`  ⊘ ${pakket.id} — ${pakket.title}`);
    console.log(`      ${pakket.reason}`);
  }
  if (ruleset.missingPackages.length === 0) {
    console.log("  Geen.");
  }

  console.log(`\n${"═".repeat(78)}`);
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
  console.log(
    "Let op: dit toetst of de verwijzing naar het juiste artikel wijst. Of de waarde\n" +
      "van de regel klopt, is hiermee niet aangetoond en blijft FORMALLY_VALIDATED: false.",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main();
