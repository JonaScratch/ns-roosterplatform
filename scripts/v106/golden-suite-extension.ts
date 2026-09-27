import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { laadGrondwaarheid } from "./waarheid";

/**
 * Aanvulling op de bevroren 43-item golden suite (`docs/v1.0.6/golden-suite.json`)
 * — LYRA MASTER PROGRAM, §9/§36 van de opdracht: "benchmark harness uitbreiding
 * naar minimaal 100 gegronde cases, ZONDER de bestaande 43-case frozen
 * BEFORE-suite te vervangen".
 *
 * ## Waarom een apart bestand, en geen wijziging aan golden-suite.ts
 *
 * De 43 items in `docs/v1.0.6/golden-suite.json` zijn expliciet bevroren als
 * BEFORE-referentie (zie `run-before-local.ps1`, dat exact dat bestand
 * gebruikt). Dit bestand raakt dat bestand nergens aan: het schrijft naar
 * `docs/v1.0.6/golden-suite-extension.json`, een nieuw, additioneel bestand.
 * `golden-bench.ts` kent dit nieuwe bestand vandaag nog niet — dat is bewust:
 * koppeling (een los `--suite <pad>`-argument aan golden-bench.ts, of een
 * apart `golden-bench-extension.ts`) is vervolgwerk, geen inhoudelijke
 * wijziging aan het BEFORE-gedrag.
 *
 * ## Nieuwe categorieën hier (L, O) — waarom precies deze twee
 *
 * Beide zijn honderd procent grondbaar uit reeds bestaande, geverifieerde
 * grondwaarheid-functies in `waarheid.ts` (`vroegLaatPerRooster` voor L,
 * de nieuw toegevoegde `nachtreeksLengtePerRooster` voor O) — geen nieuwe,
 * ongeteste grondwaarheidslogica die zelf eerst zou moeten worden bewezen.
 * Andere categorieën uit §36 van de opdracht (uren, profielgrenzen, lokaal-
 * vs-NS-breed) vragen grondwaarheidslogica die nog niet bestaat en zijn INIET
 * in deze ronde toegevoegd — zie `docs/lyra-knowledge/knowledge-gap-report.md`
 * voor die als openstaand gat.
 *
 * ## BELANGRIJK — dit bestand is NIET uitgevoerd in deze sessie
 *
 * `laadGrondwaarheid()` vereist een levende, gevulde ontwikkeldatabase
 * (`loadEvaluationContextCore`). Deze cloud-omgeving heeft die database niet
 * (geen DATABASE_URL, en het opzetten van `embedded-postgres` als niet-root-
 * gebruiker werd door de omgeving zelf geweigerd als een te ingrijpende
 * actie — zie het eindrapport). Dit script is dus geschreven, getypecheckt,
 * maar NOOIT gedraaid: er bestaat geen `golden-suite-extension.json` met
 * verzonnen cijfers. Wie dit met een echte lokale database draait (bijv. via
 * `run-before-local.ps1`, dat de dev-DB al controleert) krijgt een bestand
 * met ECHTE, op dat moment berekende cijfers — nooit hardcoded.
 *
 *   npx tsx --conditions=react-server scripts/v106/golden-suite-extension.ts
 */

type Kind = "roster_comparison" | "night_series_length";

interface GoldenTurn {
  readonly text: string;
}

interface GoldenItem {
  readonly id: string;
  readonly category: string;
  readonly holdout: boolean;
  readonly turns: readonly GoldenTurn[];
  readonly context: { readonly source: "official" | "candidate"; readonly rosterCode?: string | null; readonly lineNumber?: number | null };
  readonly expect: { readonly kind: Kind; readonly params?: Record<string, unknown> };
  readonly note?: string;
}

async function main(): Promise<void> {
  const g = await laadGrondwaarheid();
  const items: GoldenItem[] = [];
  let holdoutTeller = 0;
  const holdout = () => {
    holdoutTeller += 1;
    return holdoutTeller % 5 === 0;
  };

  // ── Categorie L: roostervergelijking ────────────────────────────────────────
  // Elk paar roosters vergeleken op nachtdiensten — een dimensie die uit de
  // bestaande vroegLaat-grondwaarheid al bekend is (geen nieuwe query nodig).
  const rosters = [...g.vroegLaat].filter((r) => r.vroeg + r.laat + r.nacht > 0);
  for (let i = 0; i < rosters.length; i += 1) {
    for (let j = i + 1; j < rosters.length; j += 1) {
      const a = rosters[i];
      const b = rosters[j];
      if (a.nacht === b.nacht) continue; // alleen ondubbelzinnige paren; gelijkspel is geen zinvolle vergelijkingsvraag
      const zwaarder = a.nacht > b.nacht ? a : b;
      const lichter = a.nacht > b.nacht ? b : a;
      items.push({
        id: `L-${a.roster}-vs-${b.roster}`,
        category: "L",
        holdout: holdout(),
        turns: [{ text: `Heeft ${a.roster} meer nachtdiensten dan ${b.roster}, of is dat andersom?` }],
        context: { source: "official", rosterCode: a.roster },
        expect: { kind: "roster_comparison", params: { zwaarderRoster: zwaarder.roster, zwaarderNacht: zwaarder.nacht, lichterRoster: lichter.roster, lichterNacht: lichter.nacht } },
        note: `Grondwaarheid: ${a.roster} heeft ${a.nacht} nachtdiensten, ${b.roster} heeft er ${b.nacht}.`,
      });
    }
  }

  // ── Categorie O: nachtreeksen (lengte, cyclisch geteld) ─────────────────────
  // Vraag naar de langste nachtreeks per rooster — grondwaarheid is de
  // langste waarde in g.nachtreeksen voor dat rooster (0 als er geen enkele
  // nachtreeks in dat rooster voorkomt — een geldig antwoord, geen fout).
  const perRoosterLangsteReeks = new Map<string, number>();
  for (const r of g.nachtreeksen) {
    const huidig = perRoosterLangsteReeks.get(r.roster) ?? 0;
    if (r.lengte > huidig) perRoosterLangsteReeks.set(r.roster, r.lengte);
  }
  for (const r of rosters) {
    const langste = perRoosterLangsteReeks.get(r.roster) ?? 0;
    items.push({
      id: `O-${r.roster}-nachtreeks`,
      category: "O",
      holdout: holdout(),
      turns: [{ text: "Wat is de langste aaneengesloten reeks nachtdiensten die in dit rooster voorkomt?" }],
      context: { source: "official", rosterCode: r.roster },
      expect: { kind: "night_series_length", params: { roster: r.roster, langsteReeks: langste } },
      note:
        langste === 0
          ? `Grondwaarheid: geen enkele nachtreeks in ${r.roster} — de agent moet dat ook zo zeggen, niet een reeks verzinnen.`
          : `Grondwaarheid: langste nachtreeks in ${r.roster} is ${langste} (cyclisch geteld, dus ook over de regelgrens heen).`,
    });
  }

  const suite = {
    schema: "ns-v106-golden-suite-extension/1",
    version: 1,
    generatedAt: new Date().toISOString(),
    extendsBaseSuite: "docs/v1.0.6/golden-suite.json (43 items, ONGEWIJZIGD — dit bestand vervangt niets, telt op)",
    groundedOn: { dutyPackage: "actueel bij generatie, zie n0-manifest.json / before-manifest.json" },
    counts: {
      total: items.length,
      holdout: items.filter((i) => i.holdout).length,
      dev: items.filter((i) => !i.holdout).length,
      perCategory: Object.fromEntries([...new Set(items.map((i) => i.category))].map((c) => [c, items.filter((i) => i.category === c).length])),
      combinedWithBaseSuite: "43 (basis) + dit aantal — zie docs/lyra-knowledge/progress.md voor de actuele som",
    },
    note:
      "Additief bij de bevroren 43-item golden-suite.json, nooit als vervanging. Nieuwe categorieën L " +
      "(roostervergelijking) en O (nachtreeksen), beide gegrond op reeds bestaande waarheid.ts-functies — " +
      "geen nieuwe, ongeteste grondwaarheidslogica. Verdere categorieën (uren, profielgrenzen, lokaal-vs-NS-breed) " +
      "vragen grondwaarheidslogica die nog niet bestaat; zie knowledge-gap-report.md.",
    items,
  };

  const doel = path.join(path.resolve(__dirname, "..", ".."), "docs", "v1.0.6", "golden-suite-extension.json");
  writeFileSync(doel, `${JSON.stringify(suite, null, 2)}\n`);
  console.log(`Geschreven: ${doel}`);
  console.log(`  ${suite.counts.total} nieuwe items (${suite.counts.dev} dev / ${suite.counts.holdout} holdout)`);
  console.log(`  per categorie: ${JSON.stringify(suite.counts.perCategory)}`);
  console.log(`  totaal incl. basis-suite: 43 + ${suite.counts.total} = ${43 + suite.counts.total}`);
  process.exit(0);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
