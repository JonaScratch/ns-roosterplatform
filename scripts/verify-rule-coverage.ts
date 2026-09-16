import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { BLOCKING_STATUSES } from "@/server/rules-engine/ruleset/types";

/**
 * Welke regels worden werkelijk op hun gedrag getoetst?
 *
 * ## Waarom "de regel wordt genoemd" niet genoeg is
 *
 * De vorige dekkingsmeting telde een regel als getest zodra zijn naam ergens in
 * een testbestand voorkwam. Dat is te makkelijk: een test die alleen vaststelt
 * dát een regel bestaat, bewijst niets over wat hij doet, en een regel met een
 * omgekeerde vergelijking blijft daarmee gewoon groen.
 *
 * Hier telt alleen gedrag, en wel in twee richtingen:
 *
 *   - **hij gaat af**       ergens staat `toContain(RULE.X)`: een situatie die
 *                           de regel hoort af te keuren, wordt afgekeurd.
 *   - **hij gaat niet af**  ergens staat `not.toContain(RULE.X)`: een situatie
 *                           die mag, wordt niet afgekeurd.
 *
 * Die tweede kant is de belangrijkste. Een regel die alles afkeurt, haalt de
 * eerste toets moeiteloos; pas de tweede laat zien dat hij onderscheid maakt.
 *
 * ## Waarom een geblokkeerde regel anders wordt geteld
 *
 * Een regel zonder bruikbare waarde kán niet afgaan: hij blokkeert de hele
 * beslissing. Van zo'n regel is "hij keurt dit af" dus niet te meten. Wat wél
 * te meten valt, is dat de beslissing werkelijk wordt geblokkeerd, en dat is
 * hier een eigen soort dekking.
 *
 * Draaien met: npm run verify:rule-coverage
 */

const WORTEL = path.resolve(__dirname, "..");
const TESTMAP = path.join(WORTEL, "tests");
const UITVOER = path.join(WORTEL, "docs", "regeldekking-gedrag.md");

/**
 * Regels die geen eigen bevinding opleveren, maar een andere regel voeden.
 *
 * ## Waarom deze lijst er is
 *
 * Sommige bepalingen zijn een parameter en geen zelfstandige toets. "Reeks
 * waarna herstelrust geldt: 3" gaat nooit zelf af — hij bepaalt wanneer de
 * herstelrustregel afgaat. Een gedragstoets die zoekt naar een bevinding met
 * die naam, zou hem nooit vinden, en dan zou de dekkingsmeting eeuwig een
 * tekort melden dat er niet is.
 *
 * ## Waarom dat hier met de hand staat
 *
 * Omdat het een oordeel is en geen meting. Elke regel hieronder is nagelopen in
 * de code, en de regel waar hij in meegaat staat erbij. Wie een van deze regels
 * verplaatst, hoort deze lijst tegen te komen — en dan is de vraag "voedt hij
 * nog steeds diezelfde regel?" precies de goede vraag.
 *
 * De dekking van een parameter is die van de regel die hij voedt: staat die
 * regel niet in twee richtingen getoetst, dan telt de parameter ook niet mee.
 */
const PARAMETERS: Readonly<Record<string, { readonly voedt: string; readonly waarom: string }>> = {
  NIGHT_SEQUENCE_RECOVERY_THRESHOLD: {
    voedt: "NIGHT_SEQUENCE_RECOVERY",
    waarom: "bepaalt vanaf welke reekslengte de herstelrust van kracht wordt",
  },
  MANY_NIGHTS_THRESHOLD: {
    voedt: "AVG_WEEKLY_HOURS_16W_MANY_NIGHTS",
    waarom: "bepaalt wanneer het lagere zestienwekengemiddelde geldt",
  },
  RP_LONG_DUTY_THRESHOLD: {
    voedt: "RP_MAX_LONG_DUTIES_PER_YEAR",
    waarom: "bepaalt welke diensten als lange dienst meetellen",
  },
  WEEKLY_REST_72H_PER_14D: {
    voedt: "WEEKLY_REST_36H_PER_7D",
    waarom: "is de veertiendaagse variant waarmee aan de wekelijkse rust kan worden voldaan",
  },
  WEEKLY_REST_SPLIT_MIN: {
    voedt: "WEEKLY_REST_36H_PER_7D",
    waarom: "bepaalt hoe lang een deel van een gesplitste wekelijkse rust minimaal is",
  },
  RC_SHORTENED_WEEKLY_REST_MIN: {
    voedt: "WEEKLY_REST_36H_PER_7D",
    waarom: "verlaagt de weeknorm wanneer er een vastgelegde uitzondering is",
  },
  RC_SHORTENED_WEEKLY_REST_INTERVAL_WEEKS: {
    voedt: "WEEKLY_REST_36H_PER_7D",
    waarom: "bepaalt hoe vaak die verkorting mag terugkeren",
  },
  RED_WEEKEND_INTERVAL_WEEKS: {
    voedt: "RED_WEEKEND_MIN_REST",
    waarom: "bepaalt over hoeveel weekenden de reeks wordt beoordeeld",
  },
  AVG_WEEKLY_HOURS_16W_MANY_NIGHTS: {
    voedt: "AVG_WEEKLY_HOURS_16W",
    waarom: "is de lagere variant van hetzelfde zestienwekengemiddelde",
  },
  DAILY_REST_REDUCED_NON_PLANNED: {
    voedt: "RP_DAILY_REST_PLANNED",
    waarom:
      "verlaagt de dagelijkse rustnorm in de operationele fase wanneer er een uitzondering " +
      "is verleend; hij levert nooit een eigen bevinding op",
  },
  R_DAY_DETACHED_MIN: {
    voedt: "R_DAY_ATTACHED_MIN",
    waarom:
      "is dezelfde toets met een lagere norm, voor een rustdag die niet op een dienst " +
      "aansluit; in een rooster met hele kalenderdagen levert die altijd ruim meer dan " +
      "vierentwintig uur op en kan hij dus niet afgaan",
  },
};

/**
 * Regels die met opzet blokkeren in plaats van afkeuren.
 *
 * Bij deze bepalingen ontbreekt een bron die nodig is om te kunnen zeggen óf er
 * iets fout is. De engine keurt dan niet af en laat ook niet door: zij blokkeert
 * de beslissing en noemt wat er ontbreekt. Van zo'n regel is geen bevinding te
 * meten; wat te meten valt is de blokkade, en welke ontbrekende bron erbij hoort.
 */
const BLOKKEREN: Readonly<Record<string, string>> = {
  R_DAYS_PER_WEEK_AVG: "R_DAY_TRANSFER_REGISTER",
};

interface Dekking {
  readonly id: string;
  readonly titel: string;
  readonly categorie: string;
  readonly status: string;
  readonly blokkeert: boolean;
  readonly geimplementeerd: boolean;
  readonly gaatAf: boolean;
  readonly gaatNietAf: boolean;
  readonly geblokkeerdGetest: boolean;
  readonly genoemd: boolean;
  readonly bronArtikel: string | null;
}

function testTekst(): string {
  const delen: string[] = [];
  const loop = (map: string): void => {
    for (const item of readdirSync(map, { withFileTypes: true })) {
      const vol = path.join(map, item.name);
      if (item.isDirectory()) {
        loop(vol);
      } else if (/\.tsx?$/.test(item.name)) {
        delen.push(readFileSync(vol, "utf8"));
      }
    }
  };
  loop(TESTMAP);
  return delen.join("\n");
}

/**
 * De code die regels tóépast — uitdrukkelijk zonder de regeldefinities zelf.
 *
 * De map `ruleset/` bevat de regels: daar staat elke regel-id per definitie in.
 * Wie die meetelt, meet dat een regel bestaat en niet dat er iets mee gebeurt,
 * en krijgt keurig "71 van de 71 geïmplementeerd" te zien. Dat stond er ook, en
 * het was onzin: de pauzeregels bleken alleen in het regelbestand te staan en
 * nergens te worden toegepast.
 */
function engineTekst(): string {
  const delen: string[] = [];
  const loop = (map: string): void => {
    for (const item of readdirSync(map, { withFileTypes: true })) {
      const vol = path.join(map, item.name);
      if (item.isDirectory()) {
        if (item.name === "ruleset") {
          continue;
        }
        loop(vol);
      } else if (/\.tsx?$/.test(item.name)) {
        delen.push(readFileSync(vol, "utf8"));
      }
    }
  };
  loop(path.join(WORTEL, "src", "server", "rules-engine"));
  loop(path.join(WORTEL, "src", "domain"));
  loop(path.join(WORTEL, "src", "server", "optimizer"));
  return delen.join("\n");
}

function main(): void {
  console.log("REGELDEKKING — GEDRAG");
  console.log("═".repeat(78));

  const ruleset = activeRuleset();
  const tests = testTekst();
  const engine = engineTekst();

  const dekkingen: Dekking[] = ruleset.rules.map((rule) => {
    const blokkeert = BLOCKING_STATUSES.includes(rule.status) || rule.value === null;

    // `RULE.X` met een woordgrens erachter, zodat RP_MAX_WORK niet meetelt voor
    // RP_MAX_WORK_PER_DUTY.
    const noem = new RegExp(`RULE\\.${rule.id}\\b`);
    const gaatAf = new RegExp(`(?<!not\\.)toContain\\(\\s*RULE\\.${rule.id}\\b`).test(tests);
    const gaatNietAf = new RegExp(`not\\.toContain\\(\\s*RULE\\.${rule.id}\\b`).test(tests);
    const geblokkeerd = new RegExp(
      `(blocked|geblokkeerd|blokkeert)[\\s\\S]{0,400}RULE\\.${rule.id}\\b|` +
        `RULE\\.${rule.id}\\b[\\s\\S]{0,400}(blocked|geblokkeerd|blokkeert)`,
      "i",
    ).test(tests);

    return {
      id: rule.id,
      titel: rule.title,
      categorie: rule.category,
      status: rule.status,
      blokkeert,
      geimplementeerd: noem.test(engine),
      gaatAf,
      gaatNietAf,
      geblokkeerdGetest: geblokkeerd,
      genoemd: noem.test(tests),
      bronArtikel: rule.source.article ?? null,
    };
  });

  const tweezijdig = new Set(dekkingen.filter((rij) => rij.gaatAf && rij.gaatNietAf).map((rij) => rij.id));

  /** Is deze regel afgedekt, en hoe? */
  const dekkingssoort = (rij: Dekking): string => {
    if (rij.gaatAf && rij.gaatNietAf) return "TWEEZIJDIG";
    if (BLOKKEREN[rij.id]) {
      return tests.includes(BLOKKEREN[rij.id]) ? "BLOKKADE_GETOETST" : "BLOKKADE_ONGETOETST";
    }
    // Een parameter kan zelf weer een parameter voeden. De keten wordt gevolgd
    // tot een regel die in twee richtingen is getoetst, of tot hij ophoudt.
    let huidig = PARAMETERS[rij.id];
    const gezien = new Set([rij.id]);
    while (huidig) {
      if (tweezijdig.has(huidig.voedt)) {
        return "PARAMETER_GEDEKT";
      }
      if (gezien.has(huidig.voedt)) {
        break;
      }
      gezien.add(huidig.voedt);
      huidig = PARAMETERS[huidig.voedt];
    }
    if (PARAMETERS[rij.id]) {
      return "PARAMETER_ONGEDEKT";
    }
    if (rij.gaatAf || rij.gaatNietAf) return "EENZIJDIG";
    return "GEEN";
  };

  const hard = dekkingen.filter((rij) => rij.categorie === "HARD_CONSTRAINT");
  const bruikbaar = hard.filter((rij) => !rij.blokkeert);
  const geblokkeerdeHard = hard.filter((rij) => rij.blokkeert);

  const gebouwd = bruikbaar.filter((rij) => rij.geimplementeerd);
  const nietGebouwdHard = bruikbaar.filter((rij) => !rij.geimplementeerd);
  void nietGebouwdHard;
  const volledig = gebouwd.filter((rij) => dekkingssoort(rij) === "TWEEZIJDIG");
  const viaParameter = gebouwd.filter((rij) => dekkingssoort(rij) === "PARAMETER_GEDEKT");
  const viaBlokkade: readonly Dekking[] = gebouwd.filter((rij) => dekkingssoort(rij) === "BLOKKADE_GETOETST");
  const halve = gebouwd.filter((rij) => dekkingssoort(rij) === "EENZIJDIG");
  const zonder = gebouwd.filter((rij) =>
    ["GEEN", "PARAMETER_ONGEDEKT", "BLOKKADE_ONGETOETST"].includes(dekkingssoort(rij)),
  );

  console.log(`\nTotaal regels                              ${ruleset.rules.length}`);
  console.log(`  waarvan harde regels                     ${hard.length}`);
  console.log(`    bruikbaar (kunnen afgaan)              ${bruikbaar.length}`);
  console.log(`    geblokkeerd (kunnen niet afgaan)       ${geblokkeerdeHard.length}`);
  console.log(`\nGedragsdekking van de bruikbare harde regels`);
  console.log(`  positief én negatief getoetst            ${volledig.length}`);
  console.log(`  maar één kant getoetst                   ${halve.length}`);
  console.log(`  gedekt via de regel die zij voeden       ${viaParameter.length}`);
  console.log(`  blokkade getoetst                        ${viaBlokkade.length}`);
  console.log(`  geen gedragstoets                        ${zonder.length}`);

  const geimplementeerd = dekkingen.filter((rij) => rij.geimplementeerd).length;
  console.log(`\nIn de engine terug te vinden               ${geimplementeerd}/${ruleset.rules.length}`);
  console.log(
    `Geblokkeerde harde regels met een blokkadetoets  ` +
      `${geblokkeerdeHard.filter((rij) => rij.geblokkeerdGetest).length}/${geblokkeerdeHard.length}`,
  );

  if (halve.length > 0) {
    console.log("\nMaar één kant getoetst:");
    for (const rij of halve) {
      console.log(
        `  ${rij.id.padEnd(42)} ${rij.gaatAf ? "gaat af" : "gaat niet af"} — de andere kant ontbreekt`,
      );
    }
  }

  const nietGebouwd = dekkingen.filter((rij) => !rij.geimplementeerd);
  if (nietGebouwd.length > 0) {
    console.log("\nWel in het regelbestand, niet in de code:");
    for (const rij of nietGebouwd) {
      console.log(`  ${rij.id.padEnd(42)} ${rij.titel}`);
    }
    console.log(
      "  Voor deze regels is geen gedragstoets te schrijven: er is niets dat afgaat." +
        " Zij staan als IMPLEMENTATION_GAP in het rapport.",
    );
  }

  if (zonder.length > 0) {
    console.log("\nZonder enige gedragstoets:");
    for (const rij of zonder) {
      console.log(`  ${rij.id.padEnd(42)} ${rij.titel}`);
    }
  }

  schrijfRapport(dekkingen);
  console.log(`\n${path.relative(WORTEL, UITVOER)} geschreven.`);

  // ── De grens ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(78)}`);
  const tekort = zonder.length + halve.length;
  if (tekort === 0) {
    console.log(
      "Elke gebouwde harde regel is op gedrag getoetst: in twee richtingen, via de\n" +
        "regel die hij voedt, of op de blokkade die hij oplevert.",
    );
  } else {
    console.log(
      `${tekort} bruikbare harde regels missen een volledige gedragstoets. ` +
        "De eis is nul.",
    );
    process.exitCode = 1;
  }

  console.log(
    "\nFormele validatie door NS: 0 van de " +
      `${ruleset.rules.length}. Een test bewijst dat de code doet wat er staat; ` +
      "niet dat\nwat er staat juridisch klopt. Zolang de Arbeidstijdenwet en het " +
      "Arbeidstijdenbesluit\nvervoer niet zijn aangeleverd, blijft dat onderscheid staan.",
  );
}

function schrijfRapport(dekkingen: readonly Dekking[]): void {
  const regels: string[] = [
    "# Regeldekking op gedrag",
    "",
    "Automatisch gemaakt door `npm run verify:rule-coverage`. Niet met de hand bijwerken:",
    "dit bestand wordt bij elke meting overschreven.",
    "",
    "Een regel telt hier pas als getoetst wanneer een test zijn gedrag vastlegt —",
    "niet wanneer zijn naam ergens voorkomt. Twee richtingen:",
    "",
    "- **gaat af**: er is een situatie die de regel hoort af te keuren, en die wordt afgekeurd.",
    "- **gaat niet af**: er is een situatie die mag, en die wordt niet afgekeurd.",
    "",
    "| Regel | Soort | Status | In engine | Gaat af | Gaat niet af | Bron |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  const vink = (waar: boolean): string => (waar ? "ja" : "—");

  for (const rij of [...dekkingen].sort((een, ander) => een.id.localeCompare(ander.id))) {
    regels.push(
      `| \`${rij.id}\` | ${soort(rij.categorie)} | ${rij.blokkeert ? "blokkeert" : "actief"} | ` +
        `${vink(rij.geimplementeerd)} | ${vink(rij.gaatAf)} | ${vink(rij.gaatNietAf)} | ` +
        `${rij.bronArtikel ? `art. ${rij.bronArtikel}` : "—"} |`,
    );
  }

  regels.push(
    "",
    "## Wat hier niet in staat",
    "",
    "Formele validatie door NS. Geen enkele regel is door de bevoegde partij bevestigd,",
    "en een gedragstoets verandert daar niets aan: die laat zien dat de code doet wat er",
    "in het regelbestand staat, niet dat wat er staat de juiste lezing van de bron is.",
    "",
  );

  writeFileSync(UITVOER, regels.join("\n"), "utf8");
}

function soort(categorie: string): string {
  switch (categorie) {
    case "HARD_CONSTRAINT":
      return "hard";
    case "SOFT_CONSTRAINT":
      return "zacht";
    default:
      return "doel";
  }
}

main();
