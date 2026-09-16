import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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
 * `docs/rule-coverage.md` opmaken uit wat er werkelijk is.
 *
 * ## Waarom dit een script is en geen document
 *
 * Een met de hand bijgehouden dekkingstabel is precies één keer waar. Daarna
 * verandert er een regel, wordt er een test verwijderd, en blijft de tabel
 * staan zoals hij was — met een groen vinkje bij iets wat er niet meer is. Het
 * document hieronder wordt daarom elke keer opnieuw gemeten en overschreven.
 *
 * ## De vijf statussen
 *
 *  - `SOURCE_PRESENT`      de bron waar deze regel uit komt, is aangeleverd en
 *                          leesbaar.
 *  - `TRANSCRIBED`         de regel staat in het regelbestand, met een
 *                          artikelverwijzing.
 *  - `IMPLEMENTED`         de regel-id komt voor in de code van de engine; er
 *                          is dus iets dat hem kan laten afgaan.
 *  - `TESTED`              er is een test die deze regel bij naam noemt.
 *  - `FORMALLY_VALIDATED`  NS heeft bevestigd dat waarde en lezing kloppen.
 *
 * Die laatste staat overal op false, en dat blijft zo tot iemand bij NS ervoor
 * tekent. Zolang dat niet is gebeurd, mag nergens in dit platform staan dat de
 * regels compleet of juist zijn.
 *
 * Draaien met: npm run docs:regeldekking
 */

const WORTEL = resolve(__dirname, "..");
const BRONMAP = join(WORTEL, "tests", "fixtures", "dordrecht-bronnen");
const UITVOER = join(WORTEL, "docs", "rule-coverage.md");

/** Alle .ts-bestanden onder een map, als één tekst. */
function codeIn(map: string): string {
  const delen: string[] = [];
  const loop = (pad: string): void => {
    for (const item of readdirSync(pad, { withFileTypes: true })) {
      const vol = join(pad, item.name);
      if (item.isDirectory()) {
        loop(vol);
      } else if (/\.tsx?$/.test(item.name)) {
        delen.push(readFileSync(vol, "utf8"));
      }
    }
  };
  loop(join(WORTEL, map));
  return delen.join("\n");
}

function main(): void {
  const ruleset = activeRuleset();
  const engineCode = codeIn(join("src", "server", "rules-engine"));
  const overigeCode = codeIn(join("src", "server", "services")) + codeIn(join("src", "domain"));
  const testCode = codeIn("tests") + codeIn("scripts");

  const caoBestand = readdirSync(BRONMAP).find((naam) => /CAO/i.test(naam));
  const kaderBestand = readdirSync(BRONMAP).find((naam) => /Roosterkaders/i.test(naam));
  const caoBytes = caoBestand ? readFileSync(join(BRONMAP, caoBestand)) : null;
  const artikelen = caoBytes ? caoArticles(caoBytes) : [];
  const teksten = caoBytes ? caoArticleBodies(caoBytes) : [];
  const kaderLeesbaar = kaderBestand
    ? hasTextLayer(readFileSync(join(BRONMAP, kaderBestand)))
    : false;

  interface Rij {
    id: string;
    titel: string;
    laag: string;
    artikel: string;
    artikelTitel: string;
    waarde: string;
    bronAanwezig: boolean;
    overgenomen: boolean;
    geimplementeerd: boolean;
    getest: boolean;
    waardeInArtikel: string;
  }

  const rijen: Rij[] = ruleset.rules.map((regel) => {
    const isCao = regel.source.legalAuthority === "CAO";
    const isRegio = regel.source.legalAuthority === "REGIO";
    const isProduct = regel.source.legalAuthority === "PRODUCT";

    const artikel =
      isCao && regel.source.article ? findCaoArticle(artikelen, regel.source.article) : null;

    // De bron is aanwezig wanneer het document er is én leesbaar. Voor een
    // productregel is het platform zelf de bron; die is per definitie aanwezig.
    const bronAanwezig = isProduct
      ? true
      : isCao
        ? artikelen.length > 0
        : isRegio
          ? kaderLeesbaar
          : false;

    let waardeInArtikel = "—";
    if (isCao && artikel && regel.value !== null) {
      const body = teksten.find((kandidaat) => kandidaat.number === artikel.number);
      const zoek = regel.unit === "MINUTES" ? [regel.value, regel.value / 60] : [regel.value];
      waardeInArtikel =
        body && zoek.some((waarde) => containsNumber(body.text, waarde)) ? "ja" : "nee";
    }

    return {
      id: regel.id,
      titel: regel.title,
      laag: regel.source.layer,
      artikel: regel.source.article ?? "—",
      artikelTitel: artikel?.title ?? "—",
      waarde: regel.value === null ? "niet aangeleverd" : `${regel.value} ${regel.unit}`,
      bronAanwezig,
      overgenomen: true,
      geimplementeerd:
        engineCode.includes(`RULE.${regel.id}`) ||
        engineCode.includes(`"${regel.id}"`) ||
        overigeCode.includes(regel.id),
      getest: testCode.includes(regel.id),
      waardeInArtikel,
    };
  });

  const tel = {
    totaal: rijen.length,
    bron: rijen.filter((rij) => rij.bronAanwezig).length,
    overgenomen: rijen.filter((rij) => rij.overgenomen).length,
    geimplementeerd: rijen.filter((rij) => rij.geimplementeerd).length,
    getest: rijen.filter((rij) => rij.getest).length,
    gevalideerd: 0,
  };

  const vinkje = (waar: boolean): string => (waar ? "ja" : "nee");

  const regels: string[] = [];
  regels.push("# Regeldekking");
  regels.push("");
  regels.push(
    "Dit bestand wordt gegenereerd door `npm run docs:regeldekking`. Niet met de hand",
  );
  regels.push("bijwerken: een dekkingstabel die je zelf bijhoudt, is precies één keer waar.");
  regels.push("");
  regels.push(`Gemeten op ${new Date().toISOString().slice(0, 10)}.`);
  regels.push("");
  regels.push("## Samenvatting");
  regels.push("");
  regels.push("| Status | Betekenis | Aantal |");
  regels.push("| --- | --- | --- |");
  regels.push(
    `| SOURCE_PRESENT | de bron is aangeleverd en leesbaar | ${tel.bron} / ${tel.totaal} |`,
  );
  regels.push(
    `| TRANSCRIBED | de regel staat in het regelbestand | ${tel.overgenomen} / ${tel.totaal} |`,
  );
  regels.push(
    `| IMPLEMENTED | de engine kan deze regel laten afgaan | ${tel.geimplementeerd} / ${tel.totaal} |`,
  );
  regels.push(
    `| TESTED | een test noemt deze regel bij naam | ${tel.getest} / ${tel.totaal} |`,
  );
  regels.push(
    `| FORMALLY_VALIDATED | NS heeft waarde en lezing bevestigd | ${tel.gevalideerd} / ${tel.totaal} |`,
  );
  regels.push("");
  regels.push("## Wat deze cijfers niet zeggen");
  regels.push("");
  regels.push(
    "`FORMALLY_VALIDATED` staat op nul en dat is geen tekortkoming van de bouw. Het",
  );
  regels.push(
    "betekent dat niemand bij NS heeft bevestigd dat deze waarden de juiste zijn. Zolang",
  );
  regels.push(
    "dat zo is, mag nergens in dit platform staan dat de regels compleet of juist zijn,",
  );
  regels.push("en blijft `Production-safe: NO` staan.");
  regels.push("");
  regels.push(
    "`IMPLEMENTED` betekent dat de regel-id in de code van de engine voorkomt — er is dus",
  );
  regels.push(
    "iets dat hem kan laten afgaan. Het betekent niet dat de bijbehorende berekening",
  );
  regels.push("klopt. Daarvoor is `TESTED` nodig, en daar zit het gat.");
  regels.push("");
  regels.push(
    `${tel.totaal - tel.getest} van de ${tel.totaal} regels worden door geen enkele test bij naam genoemd. Die`,
  );
  regels.push(
    "regels kunnen stilletjes verkeerd rekenen zonder dat er iets rood wordt. Ze staan",
  );
  regels.push("hieronder met `nee` in de kolom Getest.");
  regels.push("");
  regels.push("## De bronnen");
  regels.push("");
  regels.push("| Bron | Staat er | Leesbaar | Gevolg |");
  regels.push("| --- | --- | --- | --- |");
  regels.push(
    `| ${caoBestand ?? "CAO"} | ${vinkje(Boolean(caoBestand))} | ${vinkje(artikelen.length > 0)} | ` +
      `${artikelen.length} artikelen; verwijzingen zijn te controleren |`,
  );
  regels.push(
    `| ${kaderBestand ?? "Roosterkaders Regio West"} | ${vinkje(Boolean(kaderBestand))} | ` +
      `${vinkje(kaderLeesbaar)} | ` +
      (kaderLeesbaar
        ? "verwijzingen zijn te controleren"
        : "scan zonder tekstlaag: `SOURCE_PRESENT_NOT_MACHINE_READABLE`") +
      " |",
  );
  regels.push(
    "| Arbeidstijdenwet | nee | — | `BLOCKED_BY_MISSING_SOURCE`; niet gereconstrueerd |",
  );
  regels.push(
    "| Arbeidstijdenbesluit vervoer | nee | — | `BLOCKED_BY_MISSING_SOURCE`; niet gereconstrueerd |",
  );
  regels.push("");
  regels.push("## Per regel");
  regels.push("");
  regels.push(
    "De kolom **Waarde in artikel** zegt of het getal van de regel voorkomt in de tekst",
  );
  regels.push(
    "van het artikel waar de regel naar verwijst. `nee` is geen bewijs dat de regel fout",
  );
  regels.push(
    "is — het is een plek om te kijken. `ja` is evenmin bewijs dat hij goed is: het getal",
  );
  regels.push("staat er, meer niet.");
  regels.push("");
  regels.push("| Regel | Laag | Artikel | Waarde | Bron | Overgenomen | Geïmplementeerd | Getest | Waarde in artikel | Formeel gevalideerd |");
  regels.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const rij of rijen) {
    regels.push(
      `| \`${rij.id}\`<br>${rij.titel} | ${rij.laag} | ${rij.artikel}` +
        (rij.artikelTitel === "—" ? "" : `<br>${rij.artikelTitel}`) +
        ` | ${rij.waarde} | ${vinkje(rij.bronAanwezig)} | ${vinkje(rij.overgenomen)} | ` +
        `${vinkje(rij.geimplementeerd)} | ${vinkje(rij.getest)} | ${rij.waardeInArtikel} | nee |`,
    );
  }
  regels.push("");
  regels.push("## Regelpakketten die helemaal ontbreken");
  regels.push("");
  regels.push(
    "Deze staan niet als regel in de tabel hierboven, want er is niets om over te nemen.",
  );
  regels.push("");
  for (const pakket of ruleset.missingPackages) {
    regels.push(`### ${pakket.id}`);
    regels.push("");
    regels.push(`**${pakket.title}** — ${pakket.reason}`);
    regels.push("");
    if (pakket.blocks.length > 0) {
      regels.push("Hierdoor kan niet veilig worden vastgesteld:");
      regels.push("");
      for (const blok of pakket.blocks) {
        regels.push(`- ${blok}`);
      }
      regels.push("");
    }
  }

  writeFileSync(UITVOER, `${regels.join("\n")}\n`, "utf8");
  console.log(`docs/rule-coverage.md geschreven: ${tel.totaal} regels.`);
  console.log(
    `  bron aanwezig ${tel.bron} · overgenomen ${tel.overgenomen} · ` +
      `geïmplementeerd ${tel.geimplementeerd} · getest ${tel.getest} · ` +
      `formeel gevalideerd ${tel.gevalideerd}`,
  );
  if (tel.getest < tel.totaal) {
    console.log(
      `  ${tel.totaal - tel.getest} regels worden door geen enkele test bij naam genoemd.`,
    );
  }
}

main();
