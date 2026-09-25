import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beoordeelDeterministisch } from "@/server/agent/bench-adapter";

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
 * De deterministische items dragen hun `expected` en hun `data` in het
 * ruwe bestand; die zijn volledig opnieuw te beoordelen. Gedrags- en
 * geheugenitems niet: hun oordeel hangt af van de antwoordstatus, en die is bij
 * het wegschrijven overschreven door het oordeel zelf. Die items blijven staan
 * zoals ze gemeten zijn, en dat staat in de uitvoer.
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
  const bestand = path.join(map, "lokale-ai.json");
  const rapport = JSON.parse(readFileSync(bestand, "utf8")) as Json;
  if (rapport.status !== "GEMETEN") {
    console.log(`${meting}: ${rapport.status} — niets te herbeoordelen.`);
    return;
  }

  const testset = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.5", "intelligence-testset.json"), "utf8")) as Json;
  const specVan = new Map<string, Json>((testset.items as Json[]).map((i) => [i.id, i]));

  const rijen: Json[] = [];
  let veranderd = 0;
  for (const r of rapport.results as Json[]) {
    const spec = specVan.get(r.id);
    if (!spec || spec.expect?.kind !== "deterministic") {
      rijen.push({ id: r.id, category: r.category, was: r.status, nu: r.status, herbeoordeeld: false, reden: "geen deterministische controle" });
      continue;
    }
    const oordeel = beoordeelDeterministisch(spec, r.expected ?? null, (r.data ?? null) as Json | null);
    if (oordeel.status !== r.status) veranderd += 1;
    rijen.push({
      id: r.id,
      category: r.category,
      check: spec.expect.check,
      was: r.status,
      wasDetail: r.detail ?? "",
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
      "Alleen deterministische controles zijn opnieuw beoordeeld. Gedrags- en geheugenitems dragen " +
      "hun antwoordstatus niet in het ruwe bestand en blijven staan zoals ze destijds zijn gemeten.",
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
