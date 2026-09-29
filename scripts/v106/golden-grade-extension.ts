import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { laadGrondwaarheid } from "./waarheid";
import { pasGrendelregelToe } from "./grendel-regel";
import { langsteReeksUitTekst } from "./nachtreeks-getal";

/**
 * De aanvullende golden-suite beoordelen (categorieën L, O), met verse
 * grondwaarheid — zelfde reden als `golden-grade.ts`: het dienstenpakket kan
 * tussen meten en beoordelen zijn veranderd.
 *
 *   npx tsx --conditions=react-server scripts/v106/golden-grade-extension.ts --meting before-ext-r1
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function laatstAntwoord(item: Json): Json | null {
  const beurten = item.turns as Json[] | undefined;
  return beurten && beurten.length > 0 ? beurten[beurten.length - 1] : null;
}

/** Twee roosternamen en een oordeel ("zwaarder"/"lichter"/"evenveel") uit tekst halen, zonder een specifiek formaat te eisen. */
function noemtJuisteRoosterAlsZwaarder(tekst: string, zwaarderRoster: string): boolean {
  const t = tekst.toLowerCase();
  const naam = zwaarderRoster.toLowerCase();
  // Simpele, robuuste heuristiek: staat de naam van het zwaardere rooster in
  // de buurt van een woord dat "meer/zwaarder" betekent, en niet (ook) de
  // andere kant op voor het andere rooster? Dit is een tekstheuristiek, geen
  // structurele parse — bewust ruim, om een correct antwoord in een andere
  // formulering niet onterecht af te keuren.
  return t.includes(naam) && /meer|zwaarder|hoger|vaker/.test(t);
}

function beoordeelItem(item: Json, waarheid: Awaited<ReturnType<typeof laadGrondwaarheid>>): { status: string; detail: string } {
  if (item.error) return { status: "FOUT", detail: `crash: ${String(item.error).slice(0, 200)}` };
  const laatste = laatstAntwoord(item);
  if (!laatste) return { status: "FOUT", detail: "geen beurt uitgevoerd" };
  const tekst = String(laatste.text ?? "");
  const kind = item.expect.kind as string;
  const params = item.expect.params ?? {};

  switch (kind) {
    case "roster_comparison": {
      // Structureel: heeft een tool de echte nachttelling van beide roosters teruggegeven?
      const structureel = (item.turns as Json[]).some((t) => {
        const d = t.data ?? {};
        const tekstVanData = JSON.stringify(d);
        return tekstVanData.includes(String(params.zwaarderNacht)) && (tekstVanData.includes(params.zwaarderRoster as string) || tekstVanData.includes(params.lichterRoster as string));
      });
      const tekstOk = noemtJuisteRoosterAlsZwaarder(tekst, params.zwaarderRoster as string) && !noemtJuisteRoosterAlsZwaarder(tekst, params.lichterRoster as string);
      if (structureel || tekstOk) return { status: "GOED", detail: `verwacht ${params.zwaarderRoster} zwaarder (${params.zwaarderNacht} vs ${params.lichterNacht})` };
      return { status: "FOUT", detail: `verwacht ${params.zwaarderRoster} als zwaarder (${params.zwaarderNacht} nachten) t.o.v. ${params.lichterRoster} (${params.lichterNacht}); tekst noemt dat niet duidelijk` };
    }

    case "night_series_length": {
      const echt = waarheid.nachtreeksen.filter((r) => r.roster === params.roster);
      const langsteEcht = echt.length > 0 ? Math.max(...echt.map((r) => r.lengte)) : 0;
      // Grader /3 voor deze soort: regel-/weekdagnummers zijn geen lengte (zie nachtreeks-getal.ts).
      const uitTekst = langsteReeksUitTekst(tekst);
      if (langsteEcht === 0) {
        // Correct antwoord is hier: geen nachtreeks. Een tekst die zelf geen
        // getal > 0 noemt (of expliciet "geen" zegt) is goed.
        const zegtGeen = /geen\s+(nacht|reeks)/i.test(tekst) || uitTekst === null || uitTekst === 0;
        return zegtGeen
          ? { status: "GOED", detail: "geen nachtreeks in dit rooster, agent bevestigt dat" }
          : { status: "FOUT", detail: `verwacht 'geen nachtreeks', tekst noemt ${uitTekst}` };
      }
      if (uitTekst === langsteEcht) return { status: "GOED", detail: `langste reeks ${langsteEcht}, tekst noemt ${uitTekst}` };
      if (uitTekst !== null) return { status: "FOUT", detail: `verwacht langste reeks ${langsteEcht}, tekst noemt ${uitTekst}` };
      return { status: "ONBEOORDEELD", detail: "geen getal in tekst gevonden om te vergelijken" };
    }

    default:
      return { status: "ONBEOORDEELD", detail: `onbekend soort ${kind}` };
  }
}

async function main(): Promise<void> {
  const meting = argument("meting");
  if (!meting) throw new Error("Geef --meting <naam>.");
  const map = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting);
  const bestand = path.join(map, "golden-extension.json");
  if (!existsSync(bestand)) throw new Error(`${bestand} bestaat niet. Draai eerst golden-bench-extension.ts.`);
  const rapport = JSON.parse(readFileSync(bestand, "utf8")) as Json;
  if (rapport.status !== "GEMETEN") {
    console.log(`${meting}: ${rapport.status}`);
    return;
  }

  const waarheid = await laadGrondwaarheid();
  const beoordeeld = (rapport.results as Json[]).map((item) => {
    const oordeel = pasGrendelregelToe(String(item.expect?.kind ?? ""), laatstAntwoord(item), beoordeelItem(item, waarheid));
    return { id: item.id, category: item.category, holdout: item.holdout, status: oordeel.status, detail: oordeel.detail, ms: item.ms };
  });

  const perCategorie: Record<string, Record<string, number>> = {};
  for (const r of beoordeeld) {
    const c = (perCategorie[r.category] ??= {});
    c[r.status] = (c[r.status] ?? 0) + 1;
  }
  const perHoldout: Record<string, Record<string, number>> = { dev: {}, holdout: {} };
  for (const r of beoordeeld) {
    const bucket = r.holdout ? perHoldout.holdout : perHoldout.dev;
    bucket[r.status] = (bucket[r.status] ?? 0) + 1;
  }

  const uit = {
    schema: "ns-v106-golden-grade-extension/3",
    measurement: meting,
    gradedAt: new Date().toISOString(),
    model: rapport.model,
    byCategory: perCategorie,
    byHoldout: perHoldout,
    items: beoordeeld,
  };
  // Schema /2 (grendelregel, zie grendel-regel.ts). Nooit een bestaand oordeel stil overschrijven.
  const uitvoer = path.join(map, argument("uitvoer") ?? "golden-grade-extension.json");
  if (existsSync(uitvoer)) throw new Error(`${uitvoer} bestaat al en is bewijsmateriaal; kies een eigen --uitvoer <bestand>.`);
  writeFileSync(uitvoer, `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`${meting} · ${beoordeeld.length} items beoordeeld`);
  for (const [cat, tel] of Object.entries(perCategorie).sort()) {
    console.log(`  ${cat}: ${Object.entries(tel).map(([s, n]) => `${s} ${n}`).join(", ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((fout) => {
    console.error(fout);
    process.exit(1);
  });
}
