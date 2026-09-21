import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

/** Dingen die letterlijk in de gegevens moeten staan als ze in het antwoord staan. */
const PATRONEN: readonly { readonly naam: string; readonly regex: RegExp }[] = [
  // Regelidentificaties: HOOFDLETTERS_MET_UNDERSCORES, minstens twee delen.
  { naam: "regelidentificatie", regex: /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){1,5}\b/g },
  // Dienstnummers in dit pakket: drie cijfers.
  { naam: "dienstnummer", regex: /\b[0-9]{3}\b/g },
  // Roostercodes: DDR-XXX.
  { naam: "roostercode", regex: /\bDDR-[A-Z0-9]+\b/g },
];

/** Woorden die wel op een nummer lijken maar het niet zijn. */
const UITZONDERINGEN = new Set(["100", "200", "300", "400", "500", "600", "700", "800", "900", "000"]);

function ongegrond(antwoord: string, gegevens: string): { naam: string; waarde: string }[] {
  const gevonden: { naam: string; waarde: string }[] = [];
  for (const patroon of PATRONEN) {
    for (const match of antwoord.match(patroon.regex) ?? []) {
      if (UITZONDERINGEN.has(match)) continue;
      // Jaartallen en tijden laten we met rust: die staan zelden letterlijk in
      // de gegevens en zeggen niets over verzinnen.
      if (/^(19|20)\d{2}$/.test(match)) continue;
      if (!gegevens.includes(match)) gevonden.push({ naam: patroon.naam, waarde: match });
    }
  }
  // Eén keer per waarde is genoeg.
  const gezien = new Set<string>();
  return gevonden.filter((g) => {
    const sleutel = `${g.naam}:${g.waarde}`;
    if (gezien.has(sleutel)) return false;
    gezien.add(sleutel);
    return true;
  });
}

async function main() {
  const meting = argument("meting") ?? "lokaal-1";
  const bestand = path.join(WORTEL, "docs", "v1.0.5", "benchmarks", meting, "lokale-ai.json");
  const rapport = JSON.parse(readFileSync(bestand, "utf8")) as Json;

  if (rapport.status !== "GEMETEN") {
    console.log(`${meting}: ${rapport.status} — ${rapport.reason}`);
    return;
  }

  const bevindingen: Json[] = [];
  for (const r of rapport.results as Json[]) {
    const tekst = String(r.text ?? "");
    if (tekst.length === 0) continue;
    // Wat de tools hebben opgeleverd, als platte tekst om in te zoeken.
    const gegevens = JSON.stringify(r.data ?? {}) + JSON.stringify(r.tools ?? []) + JSON.stringify(r.sources ?? []);
    const los = ongegrond(tekst, gegevens);
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
    console.log(`  ${b.id} (${b.category}): ${b.ongegrond.map((o: Json) => `${o.naam} ${o.waarde}`).join(", ")}`);
  }
  console.log(`\ntijd: p50 ${rapport.timing?.p50Ms} ms · p95 ${rapport.timing?.p95Ms} ms`);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
