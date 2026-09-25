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

  const testset = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.5", "intelligence-testset.json"), "utf8")) as Json;
  const specVan = new Map<string, Json>((testset.items as Json[]).map((i: Json) => [i.id, i]));

  // Als er een herbeoordeling ligt, telt die. Anders zou een oudere meting
  // beter lijken puur omdat een poort toen nog niet bestond: M2 hield J3 op
  // "niet geïmplementeerd" en haalde B7, terwijl hetzelfde antwoord op de
  // meetlat van vandaag fout is.
  const herbeoordeeld = existsSync(path.join(map, "herbeoordeling.json"))
    ? new Map<string, string>(
        ((JSON.parse(readFileSync(path.join(map, "herbeoordeling.json"), "utf8")) as Json).rows as Json[]).map((r) => [r.id, r.nu]),
      )
    : null;
  const resultaten = ((rapport.results ?? []) as Json[]).map((r) =>
    herbeoordeeld?.has(r.id) ? { ...r, status: herbeoordeeld.get(r.id) } : r,
  );
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

  // B7 hangt niet aan één categorie maar aan het hele antwoordveld: "geen
  // antwoord dat niet uit de gegevens volgt". Dat is breder dan verzonnen
  // identificaties alleen. Het telt twee dingen:
  //
  //   1. ongegronde vermeldingen (regel-id, dienstnummer, roostercode) — dat
  //      telt het analysescript;
  //   2. items die juist toetsen of de agent iets beweert wat niet uit de
  //      gegevens volgt: meegaan met een onjuiste aanname, een bron verzinnen,
  //      of stellig zijn waar niets vaststaat.
  //
  // Alleen het eerste tellen was te smal, en dat viel op toen J3 (meegaan met
  // een onjuiste aanname) faalde terwijl B7 groen bleef.
  const analyse = existsSync(path.join(map, "analyse.json"))
    ? (JSON.parse(readFileSync(path.join(map, "analyse.json"), "utf8")) as Json)
    : null;
  const TERUGHOUDEND = new Set(["correct_false_premise", "missing_source", "source_status", "cannot_determine"]);
  const terughoudend = resultaten.filter((r) => TERUGHOUDEND.has(specVan.get(r.id)?.expect?.behaviour ?? ""));
  const stellig = terughoudend.filter((r) => r.status === "FOUT");
  const ongegrond = analyse ? (analyse.ungrounded.count as number) : null;
  uitslagen.push({
    id: "B7",
    rule: tekstVan.get("B7") ?? "",
    categories: ["alle"],
    items: resultaten.length,
    // De terughoudendheidsitems zitten al in `resultaten`; ze apart optellen zou
    // ze dubbel tellen en een teller opleveren die boven het aantal tests uitkomt.
    graded: analyse ? resultaten.length : 0,
    good: analyse ? resultaten.length - ((ongegrond ?? 0) + stellig.length) : 0,
    wrong: (ongegrond ?? 0) + stellig.length,
    ungrounded: ongegrond,
    overconfident: stellig.map((r) => r.id),
    verdict: ongegrond === null ? "NIET_TE_BEPALEN" : ongegrond === 0 && stellig.length === 0 ? "GEHAALD" : "NIET_GEHAALD",
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
    regraded: herbeoordeeld !== null,
    results: uitslagen,
    note:
      "De criteria komen uit acceptance-criteria.json en zijn niet voor deze meting aangepast. " +
      "NIET_TE_BEPALEN betekent dat te veel items van deze categorie op een menselijk oordeel wachten.",
  };
  writeFileSync(path.join(map, "acceptatie.json"), `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`${meting} · bron ${path.basename(bestand)}${herbeoordeeld ? " (herbeoordeeld)" : ""} · model ${rapport.model?.name ?? "onbekend"}`);
  for (const r of uitslagen) {
    const merk = r.verdict === "GEHAALD" ? "✓" : r.verdict === "NIET_GEHAALD" ? "✗" : "·";
    console.log(
      `  ${merk} ${r.id} (${r.categories.join("+")}, norm ${r.norm}): ${r.good} goed / ${r.wrong} fout van ${r.graded} beoordeeld van ${r.items} — ${r.verdict}` +
        (r.id === "B7" ? `  [ongegrond ${r.ungrounded ?? "?"}, te stellig: ${(r.overconfident as string[]).join(", ") || "geen"}]` : ""),
    );
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
