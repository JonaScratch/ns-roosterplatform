import { enkelvoud, samenstellingsStam, woordenVan } from "../../../src/lib/nl-woorden";
import type { Concept } from "./concepts";

/**
 * Generalization Engine (Phase I): leert Lyra het BEGRIP, of alleen de zin?
 *
 * Een concept mag pas VALIDATED worden (concepts.ts) als het op anders
 * geformuleerde vragen wordt teruggevonden én níét op vragen die er alleen op
 * lijken. Daarvoor krijgt elk concept een suite van ≥10 parafrasen en ≥5
 * grens-/tegenvoorbeelden, verdeeld in een dev- en een holdoutdeel.
 *
 * ## De holdout blijft verborgen
 *
 * `devVoorbeelden()` is de enige manier waarop een kandidaatgenerator
 * voorbeelden te zien krijgt. De holdout zit alleen in `evalueer()`, die
 * cijfers teruggeeft en geen teksten. Zo kan geen generator op de holdout
 * leren (masterprompt: "Do not expose locked holdout prompts to candidate
 * generators").
 *
 * ## Waarom deterministisch
 *
 * Parafrasen en tegenvoorbeelden komen uit vaste sjablonen en een klein
 * domeinwoordenboek, niet uit een taalmodel: dezelfde invoer geeft dezelfde
 * suite, dus een verschil tussen twee metingen komt van het concept of de
 * retriever — niet van de dobbelsteen.
 *
 * Eerlijke grens: sjabloonparafrasen delen veel woorden met het origineel en
 * zijn dus een ondergrens, geen bewijs van begrip. Echte, door mensen
 * geschreven parafrasen gaan via `extraPositief`/`extraNegatief` mee en tellen
 * volwaardig mee in dezelfde dev/holdout-verdeling.
 */

export type VoorbeeldSoort = "PARAFRASE" | "GRENS" | "TEGEN";
export interface Voorbeeld {
  readonly text: string;
  readonly shouldMatch: boolean;
  readonly soort: VoorbeeldSoort;
  readonly split: "DEV" | "HOLDOUT";
}
export interface GeneralisatieSuite {
  readonly conceptId: string;
  readonly voorbeelden: readonly Voorbeeld[];
}

/** Het ophalen van concepten bij een vraag — vervangbaar (lexicaal nu, embeddings later). */
export interface ConceptRetriever {
  readonly naam: string;
  retrieve(vraag: string, concepten: readonly Concept[], limit?: number): readonly { readonly concept: Concept; readonly score: number }[];
}

/** Domeinsynoniemen: wat machinisten zeggen ↔ wat het is. Klein en uitlegbaar. */
const DOMEIN_SYNONIEMEN: readonly (readonly string[])[] = [
  ["vroeg", "vroege", "ochtend", "ochtenddienst"],
  ["laat", "late", "avond", "avonddienst"],
  ["nacht", "nachtdienst", "nachten"],
  ["rust", "vrij", "rustdag", "vrije"],
  ["weekend", "zaterdag", "zondag"],
  ["reeks", "blok", "achter elkaar", "op rij"],
  ["afloper", "laatste dienst"],
];

/** Contrasterend onderwerp: vervang dit en het gaat over iets anders. */
const CONTRAST: Readonly<Record<string, string>> = {
  nacht: "vroege dienst",
  vroeg: "nachtdienst",
  laat: "vroege dienst",
  weekend: "doordeweekse dag",
  rust: "overwerk",
  reeks: "losse dienst",
};

/** Standplaatsen, voor het herkennen van een vraag over een ándere standplaats. */
const STANDPLAATSEN: Readonly<Record<string, string>> = {
  dordrecht: "DDR", ddr: "DDR", rotterdam: "RTD", amsterdam: "ASD", utrecht: "UT", zwolle: "ZL", eindhoven: "EHV", groningen: "GN", roosendaal: "RSD", leiden: "LEDN",
};

const VULWOORDEN = new Set(["ik", "we", "wij", "ons", "onze", "mijn", "de", "het", "een", "en", "of", "dat", "die", "dit", "is", "zijn", "wil", "willen", "liever", "graag", "heel", "erg", "hier", "bij", "op", "in", "van", "voor", "na", "naar", "met", "om", "te", "als", "dan", "ook", "wel", "zo", "maar", "kan", "het", "zou", "fijn", "mogelijk"]);

/**
 * "Laat" als werkwoord ("laat de rangeerdiensten eerlijker verdelen", "laat
 * maar zien") is geen late dienst. Zonder deze uitzondering maakte de
 * parafrasegenerator van "Laat de …" een "avonddienst de …".
 */
function zonderWerkwoordLaat(laag: string): string {
  return laag.replace(/\blaat (?=(de|het|een|ons|me|mij|je|jullie|hem|haar|zien|weten|maar)\b)/g, "laatww ");
}

/** De domeinbegrippen (synoniemgroepen) in een tekst, bv. {"#vroeg", "#nacht"}. */
export function domeinbegrippen(tekst: string): Set<string> {
  const laag = zonderWerkwoordLaat(tekst.toLowerCase());
  const uit = new Set<string>();
  for (const groep of DOMEIN_SYNONIEMEN) {
    if (groep.some((w) => new RegExp(`\\b${w}`).test(laag))) uit.add(`#${groep[0]}`);
  }
  return uit;
}

/** Kernbegrippen van een tekst: genormaliseerd, met synoniemgroep en samenstellingsstam. */
export function kernbegrippen(tekst: string): Set<string> {
  const uit = new Set<string>(domeinbegrippen(tekst));
  const laag = zonderWerkwoordLaat(tekst.toLowerCase());
  for (const w of woordenVan(laag)) {
    if (w === "laatww") continue;
    if (VULWOORDEN.has(w)) continue;
    const e = enkelvoud(w);
    uit.add(e);
    const stam = samenstellingsStam(e, VULWOORDEN);
    if (stam) uit.add(stam);
  }
  return uit;
}

function genoemdeStandplaats(tekst: string): string | null {
  const laag = tekst.toLowerCase();
  for (const [naam, code] of Object.entries(STANDPLAATSEN)) if (new RegExp(`\\b${naam}\\b`).test(laag)) return code;
  return null;
}

/**
 * Lexicale retriever: overlap van kernbegrippen (met domeinsynoniemen en
 * samenstellingsstammen), gedeeld door het aantal kernbegrippen van het
 * concept. Een vraag die een ándere standplaats noemt, haalt een
 * standplaatsgebonden concept nooit op.
 */
export class LexicaleConceptRetriever implements ConceptRetriever {
  readonly naam = "lexicaal-v1";
  constructor(private readonly drempel = 0.5) {}

  retrieve(vraag: string, concepten: readonly Concept[], limit = 3) {
    const v = kernbegrippen(vraag);
    const plaats = genoemdeStandplaats(vraag);
    return concepten
      .filter((c) => !(plaats && ["DEPOT", "LOCAL_AGREEMENT", "PROFILE", "TEAM"].includes(c.scope) && plaats !== c.provenance.locationCode))
      .map((concept) => {
        // Elk domeinbegrip van het concept moet in de vraag zitten: "geen vroege
        // dienst na een nachtreeks" gaat niet over "vroeg na vroeg", hoeveel
        // woorden die twee verder ook delen.
        const domein = domeinbegrippen(concept.statement);
        if ([...domein].some((d) => !v.has(d))) return { concept, score: 0 };
        const k = kernbegrippen(concept.statement);
        const overlap = [...k].filter((w) => v.has(w)).length;
        return { concept, score: k.size === 0 ? 0 : overlap / k.size };
      })
      .filter((r) => r.score >= this.drempel)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

const PARAFRASE_SJABLONEN = [
  (x: string) => x,
  (x: string) => `Kan het zo dat ${x}?`,
  (x: string) => `Is het mogelijk dat ${x}?`,
  (x: string) => `Het zou fijn zijn als ${x}.`,
  (x: string) => `Wij zien het liefst dat ${x}.`,
  (x: string) => `${x}, kan dat?`,
  (x: string) => `Zou het kunnen dat ${x}?`,
  (x: string) => `Graag zou ik zien dat ${x}.`,
  (x: string) => `Onze voorkeur: ${x}.`,
  (x: string) => `Kun je ervoor zorgen dat ${x}?`,
  (x: string) => `Voor ons werkt het beter als ${x}.`,
];

/** De kern van een uitspraak, zonder aanloop als "ik wil liever dat", voor in een sjabloon. */
function kernzin(statement: string): string {
  return statement
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/^(ik|wij|we)\s+(wil|willen|zou|zouden|zien|hebben)\s+(graag|liever|het liefst)?\s*(dat|zien dat)?\s*/i, "")
    .replace(/^(liever|graag)\s+/i, "")
    .trim();
}

/** Vervangt het eerste woord uit een synoniemgroep door een ander lid van die groep. */
function synoniemVariant(zin: string, keuze: number): string | null {
  const beschermd = zonderWerkwoordLaat(zin.toLowerCase()).includes("laatww");
  for (const groep of DOMEIN_SYNONIEMEN) {
    if (beschermd && groep[0] === "laat") continue;
    const i = groep.findIndex((w) => new RegExp(`\\b${w}\\b`, "i").test(zin));
    if (i >= 0) {
      const ander = groep[(i + 1 + keuze) % groep.length];
      if (ander !== groep[i]) return zin.replace(new RegExp(`\\b${groep[i]}\\b`, "i"), ander);
    }
  }
  return null;
}

/** Deterministische suite: ≥10 parafrasen, ≥5 grens-/tegenvoorbeelden, elk derde voorbeeld in de holdout. */
export function maakSuite(concept: Concept, extraPositief: readonly string[] = [], extraNegatief: readonly string[] = []): GeneralisatieSuite {
  const kern = kernzin(concept.statement);
  const positief = new Set<string>([...extraPositief]);
  for (const sjabloon of PARAFRASE_SJABLONEN) positief.add(sjabloon(kern));
  for (let k = 0; k < 3; k += 1) {
    const s = synoniemVariant(kern, k);
    if (s) positief.add(`Kan het zo dat ${s}?`);
  }
  // Andere zinsbouw: "geen X na Y" → "na Y liever geen X".
  const na = /^(.*?)\s+na\s+(.*)$/i.exec(kern);
  if (na) {
    positief.add(`Na ${na[2]} liever ${na[1]}.`);
    positief.add(`Na ${na[2]}: ${na[1]}, alsjeblieft.`);
  }

  const negatief = new Set<string>([...extraNegatief]);
  for (const [woord, tegen] of Object.entries(CONTRAST)) {
    if (new RegExp(`\\b${woord}`, "i").test(kern)) negatief.add(`Kan het zo dat ${kern.replace(new RegExp(`\\b${woord}\\w*`, "i"), tegen)}?`);
  }
  if (["DEPOT", "LOCAL_AGREEMENT", "PROFILE", "TEAM"].includes(concept.scope)) {
    const ander = concept.provenance.locationCode === "RTD" ? "Amsterdam" : "Rotterdam";
    negatief.add(`In ${ander} willen ze dat ${kern}.`);
  }
  // Vaste tegenvoorbeelden uit het domein: lijken op roostervragen, gaan over iets anders.
  for (const v of [
    "Hoe laat begint dienst 701 op dinsdag?",
    "Hoeveel diensten telt het dienstenpakket?",
    "Welke kandidaat scoorde het best op de benchmark?",
    "Wie zit er in de roostercommissie?",
    "Waar vind ik de CAO-tekst?",
  ]) negatief.add(v);

  const verdeel = (teksten: string[], shouldMatch: boolean, soort: (t: string) => VoorbeeldSoort): Voorbeeld[] =>
    teksten.map((text, i) => ({ text, shouldMatch, soort: soort(text), split: i % 3 === 2 ? "HOLDOUT" : "DEV" }));
  return {
    conceptId: concept.id,
    voorbeelden: [
      ...verdeel([...positief], true, () => "PARAFRASE"),
      ...verdeel([...negatief], false, (t) => (/^(In |Kan het zo dat)/.test(t) ? "GRENS" : "TEGEN")),
    ],
  };
}

export class SuiteTeKlein extends Error {}

/** Alleen het dev-deel — het enige dat een kandidaatgenerator mag zien. */
export function devVoorbeelden(suite: GeneralisatieSuite): readonly Voorbeeld[] {
  return suite.voorbeelden.filter((v) => v.split === "DEV");
}

export interface GeneralisatieMeting {
  readonly retriever: string;
  readonly devRecall: number;
  readonly holdoutRecall: number;
  readonly falsePositiveRate: number;
  readonly aantallen: { readonly parafrasen: number; readonly negatief: number; readonly holdout: number };
  readonly measuredAt: string;
}

/**
 * Meet een concept tegen zijn suite, tussen afleiders (de andere concepten):
 * een parafrase telt alleen als goed als juist díT concept bovenaan komt.
 * Geeft alleen cijfers terug — nooit de holdoutteksten.
 */
export function evalueer(concept: Concept, suite: GeneralisatieSuite, retriever: ConceptRetriever, afleiders: readonly Concept[], now: string): GeneralisatieMeting {
  const pos = suite.voorbeelden.filter((v) => v.shouldMatch);
  const neg = suite.voorbeelden.filter((v) => !v.shouldMatch);
  if (pos.length < 10 || neg.length < 5) throw new SuiteTeKlein(`suite te klein: ${pos.length} parafrasen (min 10), ${neg.length} tegenvoorbeelden (min 5)`);
  const alle = [concept, ...afleiders.filter((c) => c.id !== concept.id)];
  const raak = (v: Voorbeeld) => retriever.retrieve(v.text, alle, 1)[0]?.concept.id === concept.id;
  const recall = (split: Voorbeeld["split"]) => {
    const sel = pos.filter((v) => v.split === split);
    return sel.length === 0 ? 0 : sel.filter(raak).length / sel.length;
  };
  return {
    retriever: retriever.naam,
    devRecall: recall("DEV"),
    holdoutRecall: recall("HOLDOUT"),
    falsePositiveRate: neg.filter(raak).length / neg.length,
    aantallen: { parafrasen: pos.length, negatief: neg.length, holdout: suite.voorbeelden.filter((v) => v.split === "HOLDOUT").length },
    measuredAt: now,
  };
}
