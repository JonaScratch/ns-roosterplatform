import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beoordeelDeterministisch, beoordeelGedrag, beoordeelGeheugen } from "@/server/agent/bench-adapter";

/**
 * Een bewaarde meting opnieuw scoren met de meetlat van vandaag.
 *
 * ## Waarom dit nodig was
 *
 * Bij lokaal-3 bleek dat twee controles naar de veldnaam van één tool keken in
 * plaats van naar het feit. `rule_value` las alleen `rules` (van ruleLookup) en
 * niet `hits` (van ruleSearch); `night_lines` las alleen `nightStructure` en
 * niet `dutyKindPerLine`. Een model dat via de andere tool het juiste artikel
 * met de juiste waarde vond, kreeg FOUT. Dat is geen modelfout maar een
 * meetfout, en hij drukte categorie C omlaag.
 *
 * Zulke fouten herstellen verandert de meetlat. Oude cijfers naast nieuwe
 * leggen alsof er niets is veranderd, zou de verbetering groter laten lijken
 * dan hij is. Daarom worden de oude ruwe uitkomsten hier opnieuw gescoord.
 *
 * ## Wat hier wél en niet kan
 *
 * Deterministische items dragen hun `expected` en hun `data` in het ruwe
 * bestand en zijn altijd opnieuw te beoordelen. Gedrags- en geheugenitems
 * kunnen dat alleen als de meting ook `answered` heeft bewaard: `status` is
 * daar overschreven door het oordeel zelf. De eerste lokale metingen misten dat
 * veld; sinds die beperking opviel, schrijven beide benchmarks het weg.
 * Rubrieken blijven mensenwerk en worden nooit aangeraakt.
 *
 * Het oorspronkelijke bestand wordt nooit overschreven; de herbeoordeling komt
 * ernaast te staan als `herbeoordeling.json`.
 *
 *   npx tsx --conditions=react-server scripts/v105/herbeoordeel.ts --meting lokaal-3
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function main(): void {
  const meting = argument("meting");
  if (!meting) throw new Error("Geef --meting <naam>, bijvoorbeeld lokaal-3.");
  const map = path.join(WORTEL, "docs", "v1.0.5", "benchmarks", meting);
  // Twee formaten: de lokale meting en de stubmeting. Ze schrijven hetzelfde
  // antwoord op een andere plek; hier wordt dat gladgestreken.
  const bestand = existsSync(path.join(map, "lokale-ai.json"))
    ? path.join(map, "lokale-ai.json")
    : path.join(map, "intelligence.json");
  const rapport = JSON.parse(readFileSync(bestand, "utf8")) as Json;
  if (rapport.status && rapport.status !== "GEMETEN") {
    console.log(`${meting}: ${rapport.status} — niets te herbeoordelen.`);
    return;
  }

  const testset = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.5", "intelligence-testset.json"), "utf8")) as Json;
  const specVan = new Map<string, Json>((testset.items as Json[]).map((i) => [i.id, i]));

  const rijen: Json[] = [];
  let veranderd = 0;
  for (const r of rapport.results as Json[]) {
    const spec = specVan.get(r.id);
    const antwoord = (r.answer ?? r) as Json;
    const data = (antwoord.data ?? null) as Json | null;
    // De antwoordstatus, niet het oordeel. `status` is bij het wegschrijven
    // overschreven door de uitslag van de poort; `answered` is wat de agent
    // werkelijk meldde. Zonder dat veld is een gedragsitem niet opnieuw te
    // beoordelen, en dat staat dan ook zo in de uitvoer.
    const gemeld = antwoord.answered ?? null;

    if (!spec) {
      rijen.push({ id: r.id, category: r.category, was: r.status, nu: r.status, herbeoordeeld: false, reden: "staat niet in de testset" });
      continue;
    }
    const soort = spec.expect?.kind;
    let oordeel: { status: string; detail: string } | null = null;
    if (soort === "deterministic") {
      oordeel = beoordeelDeterministisch(spec, r.expected ?? null, data);
    } else if ((soort === "behaviour" || soort === "memory_recall") && gemeld !== null) {
      const voor = { text: antwoord.text, status: gemeld, data, sources: antwoord.sources ?? [], intent: antwoord.intent, tools: antwoord.tools ?? [] };
      oordeel = soort === "behaviour" ? beoordeelGedrag(spec, voor) : beoordeelGeheugen(spec, voor);
    }

    if (!oordeel) {
      rijen.push({
        id: r.id,
        category: r.category,
        was: r.status,
        nu: r.status,
        herbeoordeeld: false,
        reden: soort === "rubric" ? "menselijk oordeel" : "de antwoordstatus is niet bewaard",
      });
      continue;
    }
    if (oordeel.status !== r.status) veranderd += 1;
    rijen.push({
      id: r.id,
      category: r.category,
      check: spec.expect.check ?? spec.expect.behaviour ?? soort,
      was: r.status,
      wasDetail: r.detail ?? antwoord.detail ?? "",
      nu: oordeel.status,
      nuDetail: oordeel.detail,
      herbeoordeeld: true,
    });
  }

  const tel = (sleutel: "was" | "nu") => {
    const uit: Record<string, number> = {};
    for (const r of rijen) uit[r[sleutel]] = (uit[r[sleutel]] ?? 0) + 1;
    return uit;
  };

  const uit = {
    schema: "ns-v105-regrade/1",
    measurement: meting,
    regradedAt: new Date().toISOString(),
    model: rapport.model,
    counts: { toen: tel("was"), nu: tel("nu") },
    changed: veranderd,
    rows: rijen,
    note:
      "Deterministische, gedrags- en geheugenitems zijn opnieuw beoordeeld, mits de meting de " +
      "antwoordstatus heeft bewaard. Rubrieken blijven mensenwerk en worden niet aangeraakt.",
  };
  writeFileSync(path.join(map, "herbeoordeling.json"), `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`${meting} · herbeoordeeld met de meetlat van vandaag`);
  console.log(`  toen: ${Object.entries(uit.counts.toen).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  nu:   ${Object.entries(uit.counts.nu).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  ${veranderd} item(s) van oordeel veranderd:`);
  for (const r of rijen.filter((x) => x.herbeoordeeld && x.was !== x.nu)) {
    console.log(`    ${r.id} (${r.check}): ${r.was} → ${r.nu}${r.nuDetail ? ` — ${r.nuDetail}` : ""}`);
  }
}

try {
  main();
} catch (fout) {
  console.error(fout);
  process.exit(1);
}
