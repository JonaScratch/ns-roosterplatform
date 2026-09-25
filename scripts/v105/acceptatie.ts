import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * De acceptatiecriteria naast een meting leggen.
 *
 * ## Waarom dit een script is en geen tabel in een rapport
 *
 * Omdat een met de hand overgeschreven tabel de verleiding kent om een criterium
 * net iets gunstiger te lezen. De criteria staan in `acceptance-criteria.json`,
 * vastgelegd vóór M0 en sindsdien onveranderd; dit script leest ze daar en
 * rekent ze uit over de ruwe uitkomsten. Wie het cijfer wil veranderen, moet de
 * meting veranderen.
 *
 * ## Drie uitkomsten, niet twee
 *
 * GEHAALD, NIET_GEHAALD, en NIET_TE_BEPALEN. Dat derde is er voor categorieën
 * waarin te veel items op een menselijk oordeel wachten: een criterium
 * "gehaald" noemen op basis van één beoordeeld item van de vier is geen
 * uitspraak maar een wens. De drempel staat hieronder en is streng: minstens de
 * helft van de items in een categorie moet beoordeeld zijn.
 *
 *   npx tsx --conditions=react-server scripts/v105/acceptatie.ts --meting m3
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Welke categorieën horen bij welk criterium, en wat de norm is. */
const KOPPELING: readonly {
  readonly id: string;
  readonly categories: readonly string[];
  /** null = nulfoutcriterium: één fout is een gezakt criterium. */
  readonly minShare: number | null;
}[] = [
  { id: "B1", categories: ["A"], minShare: 0.9 },
  { id: "B2", categories: ["B", "F"], minShare: 1 },
  { id: "B3", categories: ["C"], minShare: null },
  { id: "B4", categories: ["D"], minShare: 0.8 },
  { id: "B5", categories: ["E"], minShare: null },
  { id: "B6", categories: ["I"], minShare: null },
];

/** Minstens dit deel van een categorie moet beoordeeld zijn voor een uitspraak. */
const MINIMAAL_BEOORDEELD = 0.5;

function main(): void {
  const meting = argument("meting");
  if (!meting) throw new Error("Geef --meting <naam>, bijvoorbeeld m3.");
  const map = path.join(WORTEL, "docs", "v1.0.5", "benchmarks", meting);

  // Zowel de stubmeting (intelligence.json) als de lokale meting (lokale-ai.json).
  const bestand = existsSync(path.join(map, "intelligence.json"))
    ? path.join(map, "intelligence.json")
    : path.join(map, "lokale-ai.json");
  const rapport = JSON.parse(readFileSync(bestand, "utf8")) as Json;
  const criteria = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.5", "acceptance-criteria.json"), "utf8")) as Json;
  const tekstVan = new Map<string, string>((criteria.agent as Json[]).map((c) => [c.id, c.rule]));

  const resultaten = (rapport.results ?? []) as Json[];
  const uitslagen: Json[] = [];

  for (const k of KOPPELING) {
    const items = resultaten.filter((r) => k.categories.includes(r.category));
    const beoordeeld = items.filter((r) => r.status === "GOED" || r.status === "FOUT");
    const goed = beoordeeld.filter((r) => r.status === "GOED").length;
    const fout = beoordeeld.length - goed;

    const genoeg = items.length > 0 && beoordeeld.length / items.length >= MINIMAAL_BEOORDEELD;
    const gehaald = k.minShare === null ? fout === 0 : beoordeeld.length > 0 && goed / beoordeeld.length >= k.minShare;

    uitslagen.push({
      id: k.id,
      rule: tekstVan.get(k.id) ?? "",
      categories: k.categories,
      items: items.length,
      graded: beoordeeld.length,
      good: goed,
      wrong: fout,
      // Niet beoordeeld is niet hetzelfde als goed. Een categorie waarin de helft
      // op een mens wacht, levert geen uitspraak op.
      verdict: !genoeg ? "NIET_TE_BEPALEN" : gehaald ? "GEHAALD" : "NIET_GEHAALD",
      norm: k.minShare === null ? "nulfout" : `${Math.round(k.minShare * 100)}%`,
    });
  }

  // B7 hangt niet aan een categorie maar aan het hele antwoordveld: noemt een
  // antwoord iets wat niet in de gegevens staat? Dat telt het analysescript.
  const analyse = existsSync(path.join(map, "analyse.json"))
    ? (JSON.parse(readFileSync(path.join(map, "analyse.json"), "utf8")) as Json)
    : null;
  uitslagen.push({
    id: "B7",
    rule: tekstVan.get("B7") ?? "",
    categories: ["alle"],
    items: resultaten.length,
    graded: analyse ? resultaten.length : 0,
    good: analyse ? resultaten.length - analyse.ungrounded.count : 0,
    wrong: analyse ? analyse.ungrounded.count : 0,
    verdict: !analyse ? "NIET_TE_BEPALEN" : analyse.ungrounded.count === 0 ? "GEHAALD" : "NIET_GEHAALD",
    norm: "nulfout",
    note: analyse ? undefined : "draai eerst bench:lokale-ai-analyse voor deze meting",
  });

  const uit = {
    schema: "ns-v105-acceptance-check/1",
    measurement: meting,
    checkedAt: new Date().toISOString(),
    source: path.basename(bestand),
    model: rapport.model ?? null,
    isLanguageModel: rapport.isLanguageModel ?? null,
    thresholdGraded: MINIMAAL_BEOORDEELD,
    results: uitslagen,
    note:
      "De criteria komen uit acceptance-criteria.json en zijn niet voor deze meting aangepast. " +
      "NIET_TE_BEPALEN betekent dat te veel items van deze categorie op een menselijk oordeel wachten.",
  };
  writeFileSync(path.join(map, "acceptatie.json"), `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`${meting} · bron ${path.basename(bestand)} · model ${rapport.model?.name ?? "onbekend"}`);
  for (const r of uitslagen) {
    const merk = r.verdict === "GEHAALD" ? "✓" : r.verdict === "NIET_GEHAALD" ? "✗" : "·";
    console.log(`  ${merk} ${r.id} (${r.categories.join("+")}, norm ${r.norm}): ${r.good} goed / ${r.wrong} fout van ${r.graded} beoordeeld van ${r.items} — ${r.verdict}`);
  }
  const gezakt = uitslagen.filter((r) => r.verdict === "NIET_GEHAALD").length;
  const onbepaald = uitslagen.filter((r) => r.verdict === "NIET_TE_BEPALEN").length;
  console.log(`\n${uitslagen.length - gezakt - onbepaald} gehaald, ${gezakt} niet gehaald, ${onbepaald} niet te bepalen.`);
}

try {
  main();
} catch (fout) {
  console.error(fout);
  process.exit(1);
}
