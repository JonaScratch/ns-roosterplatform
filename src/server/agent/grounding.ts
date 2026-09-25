import { RULE } from "@/server/rules-engine/ruleset/rule-ids";

/**
 * De grondingscontrole: noemt het antwoord iets wat nergens vandaan komt?
 *
 * ## Waarom dit bestaat
 *
 * Bij de eerste meting op het lokale model citeerde de agent in de rooktest een
 * regel die in geen enkel toolresultaat voorkwam. Het antwoord las prettig, het
 * klonk gezaghebbend, en het was verzonnen. Een machinist die daarop een dienst
 * weigert of juist accepteert, doet dat op niets.
 *
 * De systeeminstructie zegt al dat verzinnen niet mag. Dat is sturing, geen
 * grendel: een taalmodel dat de instructie negeert, merkt niemand. Deze
 * controle is de grendel — ze staat buiten het model en geldt daarom voor elk
 * model dat er ooit onder wordt gehangen.
 *
 * ## Wat wel en niet wordt gecontroleerd
 *
 * Alleen dingen die letterlijk in de gegevens moeten voorkomen als ze in het
 * antwoord staan: regelidentificaties, dienstnummers en roostercodes. Geen
 * zinsbouw, geen redenering, geen toon. Dat is bewust smal: een controle met
 * valse alarmen blokkeert goede antwoorden en wordt daarna uitgezet.
 *
 * ## De prijs die we bewust betalen
 *
 * Een getal dat de agent zelf uitrekent — een optelling over twee tools — komt
 * niet letterlijk in de gegevens voor en wordt hier dus tegengehouden. Dat is
 * geen ongelukje maar de afspraak: rekenwerk hoort in een tool te zitten, waar
 * het te toetsen is, en niet in een zin.
 */

/** Wat er in het antwoord stond zonder dat het in de gegevens staat. */
export interface Ongegrond {
  /** "regelidentificatie" | "dienstnummer" | "roostercode" */
  readonly soort: string;
  readonly waarde: string;
  /**
   * Bestaat dit ding wel, maar is het niet opgezocht?
   *
   * Het onderscheid doet ertoe. Een verzonnen regelnummer is een fantasie; een
   * bestaand regelnummer dat niet is opgezocht is een gok uit het geheugen van
   * het model. Allebei tegenhouden, maar niet hetzelfde noemen.
   */
  readonly bestaatWel: boolean;
}

const PATRONEN: readonly { readonly soort: string; readonly regex: RegExp }[] = [
  // Regelidentificaties: HOOFDLETTERS_MET_UNDERSCORES, minstens twee delen.
  { soort: "regelidentificatie", regex: /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){1,5}\b/g },
  // Dienstnummers in dit pakket: drie cijfers.
  { soort: "dienstnummer", regex: /\b[0-9]{3}\b/g },
  // Roostercodes.
  { soort: "roostercode", regex: /\b[A-Z]{3}-[A-Z0-9]+\b/g },
];

/**
 * Tokens die op een regelidentificatie lijken maar het niet zijn.
 *
 * Het zijn woorden uit het platform zelf: statussen en intenties die de agent
 * over zichzelf kan zeggen. Ze tegenhouden zou een correct antwoord blokkeren
 * omdat het zijn eigen onzekerheid benoemt — precies het gedrag dat we willen.
 */
const EIGEN_WOORDEN: ReadonlySet<string> = new Set([
  "NIET_VAST_TE_STELLEN",
  "VERDUIDELIJKING_NODIG",
  "OPTIMALISATIEVERZOEK",
  "VERDELINGSVRAAG",
  "ROOSTERVRAAG",
  "REGELVRAAG",
  "UITLEGVRAAG",
  "GEWEIGERD",
  "BEANTWOORD",
  "KEEP_GOOD_PARTS",
]);

/** Ronde getallen die vrijwel nooit een dienstnummer zijn. */
const RONDE_GETALLEN: ReadonlySet<string> = new Set(["100", "200", "300", "400", "500", "600", "700", "800", "900", "000"]);

const BESTAANDE_REGELS: ReadonlySet<string> = new Set(Object.values(RULE));

/**
 * Wat noemt dit antwoord dat niet in de gegevens staat?
 *
 * `gegevens` is alles wat de tools hebben opgeleverd, als platte tekst: de
 * resultaten, de aangeroepen tools en de bronnen. Zuiver en zonder database,
 * zodat het oordeel te toetsen is.
 */
export function ongegrondeVermeldingen(antwoord: string, gegevens: string): readonly Ongegrond[] {
  const gevonden: Ongegrond[] = [];
  const gezien = new Set<string>();

  for (const patroon of PATRONEN) {
    for (const match of antwoord.match(patroon.regex) ?? []) {
      if (EIGEN_WOORDEN.has(match)) continue;
      if (RONDE_GETALLEN.has(match)) continue;
      // Jaartallen zijn geen dienstnummers.
      if (/^(19|20)\d{2}$/.test(match)) continue;
      if (gegevens.includes(match)) continue;

      const sleutel = `${patroon.soort}:${match}`;
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      gevonden.push({ soort: patroon.soort, waarde: match, bestaatWel: BESTAANDE_REGELS.has(match) });
    }
  }
  return gevonden;
}

/** De toolresultaten als doorzoekbare tekst. */
export function gegevensTekst(results: readonly { data: unknown; sources: readonly string[]; tool: string }[]): string {
  return results.map((r) => `${r.tool} ${JSON.stringify(r.data ?? null)} ${r.sources.join(" ")}`).join("\n");
}

/**
 * Wat de gebruiker in plaats van het ongegronde antwoord te zien krijgt.
 *
 * Niet "er ging iets mis", maar wat er precies niet klopte. Wie dit leest, kan
 * de vraag opnieuw stellen of de agent naar de juiste bron sturen — en weet dat
 * het platform het tegenhield en niet doorliet.
 */
export function grondingsMelding(los: readonly Ongegrond[]): string {
  const verzonnen = los.filter((o) => !o.bestaatWel);
  const uitHetHoofd = los.filter((o) => o.bestaatWel);
  const delen: string[] = [
    "Ik hield mijn eigen antwoord tegen: er stonden dingen in die niet uit de geraadpleegde gegevens komen.",
  ];
  if (verzonnen.length > 0) {
    delen.push(`Niet terug te vinden: ${verzonnen.map((o) => `${o.waarde} (${o.soort})`).join(", ")}.`);
  }
  if (uitHetHoofd.length > 0) {
    delen.push(
      `Deze ${uitHetHoofd.length === 1 ? "regel bestaat" : "regels bestaan"} wel, maar ${uitHetHoofd.length === 1 ? "is" : "zijn"} niet opgezocht: ${uitHetHoofd
        .map((o) => o.waarde)
        .join(", ")}. Ik mag ze niet uit mijn hoofd citeren.`,
    );
  }
  delen.push("Stel de vraag opnieuw met het basisrooster, de regel of de dag erbij, dan zoek ik het op.");
  return delen.join(" ");
}
