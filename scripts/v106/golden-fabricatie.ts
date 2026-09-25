import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gegevensTekst, ongegrondeVermeldingen } from "@/server/agent/grounding";

/**
 * Ongegronde vermeldingen tellen over álle antwoorden van een golden-meting,
 * niet alleen de items die dat expliciet toetsen (categorie C).
 *
 *   npx tsx --conditions=react-server scripts/v106/golden-fabricatie.ts --meting n1
 */
const argument = (naam: string) => { const i = process.argv.indexOf(`--${naam}`); return i >= 0 ? process.argv[i + 1] : null; };
const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function main() {
  const meting = argument("meting") ?? "n1";
  const r = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting, "golden.json"), "utf8")) as Json;
  const suite = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.6", "golden-suite.json"), "utf8")) as Json;
  const contextVan = new Map<string, Json>((suite.items as Json[]).map((i) => [i.id, i.context]));
  let totaal = 0;
  let gevonden = 0;
  for (const item of r.results as Json[]) {
    // Dezelfde correctie als in agent.ts: de schermcontext (het rooster/de
    // kandidaat waar de vraag over ging) telt mee als bron. Zonder dat werd
    // elk antwoord dat gewoon de gevraagde roostercode herhaalde — ook een
    // eerlijke wedervraag zonder toolaanroep — hier als "ongegrond" geteld.
    const contextTekst = Object.values(contextVan.get(item.id) ?? {}).filter(Boolean).join(" ");
    for (const t of item.turns ?? []) {
      totaal += 1;
      const gegevens = `${gegevensTekst((t.tools ?? []).map((tool: string) => ({ tool, data: t.data, sources: t.sources ?? [] })))} ${contextTekst}`;
      const los = ongegrondeVermeldingen(String(t.text ?? ""), gegevens);
      if (los.length > 0) {
        gevonden += 1;
        console.log(`  ${item.id}: ${los.map((o: Json) => `${o.soort} ${o.waarde}`).join(", ")}`);
      }
    }
  }
  console.log(`${meting}: ${gevonden} van ${totaal} antwoorden met een ongegronde vermelding.`);
}
main();
