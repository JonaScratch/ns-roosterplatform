import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ongegrondeVermeldingen } from "@/server/agent/grounding";

/**
 * Ongegronde antwoorden tellen in plaats van aanvoelen.
 *
 * ## Wat hier "ongegrond" betekent
 *
 * Een antwoord noemt iets concreets — een regelidentificatie, een dienstnummer,
 * een roostercode, een getal met een eenheid — dat niet voorkomt in de
 * gegevens die de tools hebben teruggegeven. Dan staat er iets in het antwoord
 * dat nergens vandaan komt. Dat is precies de zwaarste foutcategorie uit de
 * methodiek, en het is machinaal vast te stellen zolang je het beperkt houdt
 * tot dingen die letterlijk overeen moeten komen.
 *
 * ## Wat dit níet meet
 *
 * Of het antwoord goed Nederlands is, of het prettig leest, of het de vraag
 * beantwoordt. Dat blijft mensenwerk, en dat staat ook zo in de uitvoer.
 *
 * Draaien met:
 *   npx tsx --conditions=react-server scripts/v105/lokale-ai-analyse.ts --meting lokaal-1
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Het oordeel zelf staat in `src/server/agent/grounding.ts`, want de agent
 * gebruikt het tijdens het draaien om zulke antwoorden tegen te houden. Dit
 * script telt na afloop hoe vaak dat nodig was. Twee kopieën van dezelfde
 * definitie zouden vroeg of laat uit elkaar lopen, en dan meet dit script iets
 * anders dan de agent doet.
 */

async function main() {
  const meting = argument("meting") ?? "lokaal-1";
  // Ook de stubmeting: de vraag "noemt dit antwoord iets wat nergens vandaan
  // komt" geldt voor elk model, en B7 is een nulfoutcriterium voor allemaal.
  const map = path.join(WORTEL, "docs", "v1.0.5", "benchmarks", meting);
  const bestand = existsSync(path.join(map, "lokale-ai.json"))
    ? path.join(map, "lokale-ai.json")
    : path.join(map, "intelligence.json");
  const rapport = JSON.parse(readFileSync(bestand, "utf8")) as Json;

  if (rapport.status && rapport.status !== "GEMETEN") {
    console.log(`${meting}: ${rapport.status} — ${rapport.reason}`);
    return;
  }

  const testset = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.5", "intelligence-testset.json"), "utf8")) as Json;
  const specVan = new Map<string, Json>((testset.items as Json[]).map((i: Json) => [i.id, i]));

  const bevindingen: Json[] = [];
  for (const ruw of rapport.results as Json[]) {
    const r = { ...ruw, ...(ruw.answer ?? {}) } as Json;
    const tekst = String(r.text ?? "");
    if (tekst.length === 0) continue;
    // Wat de tools hebben opgeleverd, als platte tekst om in te zoeken.
    // Dezelfde korf als de grendel tijdens het draaien: toolresultaten én de
    // context van het scherm. Zonder die tweede helft telt "DDR-L" als verzonnen
    // terwijl de kiezer erop stond — dat was precies de valse melding die bij
    // lokaal-3 zeven van de zeven bevindingen opleverde.
    const context = specVan.get(r.id)?.context ?? {};
    const gegevens =
      JSON.stringify(r.data ?? {}) +
      JSON.stringify(r.tools ?? []) +
      JSON.stringify(r.sources ?? []) +
      Object.values(context).join(" ");
    const los = ongegrondeVermeldingen(tekst, gegevens);
    if (los.length > 0) bevindingen.push({ id: r.id, category: r.category, status: r.status, ongegrond: los, text: tekst.slice(0, 220) });
  }

  const perCategorie: Record<string, Record<string, number>> = {};
  for (const r of rapport.results as Json[]) {
    const c = (perCategorie[r.category] ??= {});
    c[r.status] = (c[r.status] ?? 0) + 1;
  }

  const uit = {
    schema: "ns-v105-local-ai-analysis/1",
    measurement: meting,
    analysedAt: new Date().toISOString(),
    model: rapport.model,
    items: (rapport.results as Json[]).length,
    byCategory: perCategorie,
    ungrounded: { count: bevindingen.length, items: bevindingen },
    timing: rapport.timing,
    hardware: rapport.hardware,
    note:
      "Ongegrond = het antwoord noemt een regelidentificatie, dienstnummer of roostercode die niet in de " +
      "toolgegevens voorkomt. Taalkwaliteit en leesbaarheid zijn hier niet gemeten; die blijven mensenwerk.",
  };
  writeFileSync(path.join(path.dirname(bestand), "analyse.json"), `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`${meting} · model ${rapport.model?.name ?? "onbekend"} · ${uit.items} tests`);
  for (const [cat, tellingen] of Object.entries(perCategorie).sort()) {
    console.log(`  ${cat}: ${Object.entries(tellingen).map(([s, n]) => `${s} ${n}`).join(", ")}`);
  }
  console.log(`\nongegronde vermeldingen: ${bevindingen.length} van ${uit.items} antwoorden`);
  for (const b of bevindingen.slice(0, 8)) {
    console.log(`  ${b.id} (${b.category}): ${b.ongegrond.map((o: Json) => `${o.soort} ${o.waarde}`).join(", ")}`);
  }
  console.log(`\ntijd: p50 ${rapport.timing?.p50Ms} ms · p95 ${rapport.timing?.p95Ms} ms`);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
