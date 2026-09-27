import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Variantierapportage over N replicate-runs van de golden suite — het
 * mechanisme dat `docs/lyra-knowledge/inventory-benchmark-infrastructure.md`
 * vaststelde als ontbrekend voor de agent-Q&A-lijn (wél al aanwezig voor de
 * optimizer-lijn, met hetzelfde mean/median/worst-patroon).
 *
 * Bewijs waarom dit nodig is, niet optioneel: `docs/v1.0.6/n0-n1-vergelijking.md`
 * toont dat twee identieke-code runs op temperatuur 0 verschilden op 7 van de
 * 43 items (16%) — één run is dus geen betrouwbare BEFORE- of AFTER-meting.
 *
 * Leest N reeds gedraaide en beoordeelde metingen (elk via
 * `golden-bench.ts --meting <naam>` gevolgd door `golden-grade.ts --meting <naam>`)
 * en rapporteert, zonder zelf opnieuw te meten of te oordelen:
 * - per item: hoe vaak GOED/FOUT/ONBEOORDEELD over de N replicaten (agreement);
 * - per categorie: mean/median/worst-slagingspercentage over de N replicaten;
 * - een instabiliteitslijst: items die niet in alle N replicaten hetzelfde
 *   oordeel kregen — dit is exact het soort non-determinisme dat
 *   n0-n1-vergelijking.md met de hand ontdekte, hier geautomatiseerd.
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/aggregate-replicates.ts \
 *     --run <runId> --replicates 3 --phase before
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const WORTEL = path.resolve(__dirname, "..", "..");

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function percentiel(getallen: readonly number[], p: number): number | null {
  if (getallen.length === 0) return null;
  const gesorteerd = [...getallen].sort((a, b) => a - b);
  const idx = Math.min(gesorteerd.length - 1, Math.floor(p * gesorteerd.length));
  return gesorteerd[idx];
}

function mean(getallen: readonly number[]): number | null {
  return getallen.length === 0 ? null : getallen.reduce((a, b) => a + b, 0) / getallen.length;
}

function median(getallen: readonly number[]): number | null {
  if (getallen.length === 0) return null;
  const g = [...getallen].sort((a, b) => a - b);
  const mid = Math.floor(g.length / 2);
  return g.length % 2 === 0 ? (g[mid - 1] + g[mid]) / 2 : g[mid];
}

async function main(): Promise<void> {
  const runId = argument("run");
  const replicates = Number(argument("replicates") ?? "0");
  const phase = argument("phase") ?? "before";
  if (!runId || !replicates || replicates < 1) throw new Error("Geef --run <runId> --replicates <N> [--phase before|after].");

  const gradeBestanden: { meting: string; data: Json }[] = [];
  for (let r = 1; r <= replicates; r += 1) {
    const meting = `${phase}-${runId}-r${r}`;
    const bestand = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting, "golden-grade.json");
    if (!existsSync(bestand)) {
      console.error(`[FOUT] ${bestand} ontbreekt. Draai eerst golden-bench.ts en golden-grade.ts voor meting "${meting}".`);
      process.exit(1);
    }
    gradeBestanden.push({ meting, data: JSON.parse(readFileSync(bestand, "utf8")) as Json });
  }

  // Per item, over alle replicaten: welke statussen kwam het item tegen?
  const perItem = new Map<string, { category: string; holdout: boolean; statussen: string[] }>();
  for (const { data } of gradeBestanden) {
    for (const item of data.items as Json[]) {
      const bestaand = perItem.get(item.id) ?? { category: item.category, holdout: item.holdout, statussen: [] as string[] };
      bestaand.statussen.push(item.status);
      perItem.set(item.id, bestaand);
    }
  }

  const items = [...perItem.entries()].map(([id, v]) => {
    const uniek = new Set(v.statussen);
    return {
      id,
      category: v.category,
      holdout: v.holdout,
      statussenPerReplicaat: v.statussen,
      stabiel: uniek.size === 1,
      meestVoorkomend: [...uniek].sort((a, b) => v.statussen.filter((s) => s === b).length - v.statussen.filter((s) => s === a).length)[0],
    };
  });

  const instabiel = items.filter((i) => !i.stabiel);

  // Per categorie: slagingspercentage (GOED-aandeel) per replicaat, dan mean/median/worst over die replicaten.
  const categorieen = [...new Set(items.map((i) => i.category))].sort();
  const perCategorie: Json = {};
  for (const cat of categorieen) {
    const percentagesPerReplicaat = gradeBestanden.map(({ data }) => {
      const inCat = (data.items as Json[]).filter((it) => it.category === cat);
      const goed = inCat.filter((it) => it.status === "GOED").length;
      return inCat.length > 0 ? (goed / inCat.length) * 100 : null;
    }).filter((p): p is number => p !== null);
    perCategorie[cat] = {
      meanPct: mean(percentagesPerReplicaat),
      medianPct: median(percentagesPerReplicaat),
      worstPct: percentagesPerReplicaat.length > 0 ? Math.min(...percentagesPerReplicaat) : null,
      perReplicaat: percentagesPerReplicaat,
    };
  }

  const totaalPercentagesPerReplicaat = gradeBestanden.map(({ data }) => {
    const alle = data.items as Json[];
    const goed = alle.filter((it) => it.status === "GOED").length;
    return alle.length > 0 ? (goed / alle.length) * 100 : null;
  }).filter((p): p is number => p !== null);

  const uit = {
    schema: "ns-lyra-master-replicate-aggregate/1",
    phase,
    runId,
    replicates,
    aggregatedAt: new Date().toISOString(),
    metingen: gradeBestanden.map((g) => g.meting),
    itemAgreementRate: items.length > 0 ? items.filter((i) => i.stabiel).length / items.length : null,
    instabieleItems: instabiel.map((i) => ({ id: i.id, category: i.category, statussenPerReplicaat: i.statussenPerReplicaat })),
    overall: {
      meanPct: mean(totaalPercentagesPerReplicaat),
      medianPct: median(totaalPercentagesPerReplicaat),
      worstPct: totaalPercentagesPerReplicaat.length > 0 ? Math.min(...totaalPercentagesPerReplicaat) : null,
      p95Ms: percentiel(gradeBestanden.flatMap(({ data }) => (data.items as Json[]).map((it) => it.ms).filter(Boolean)), 0.95),
    },
    byCategory: perCategorie,
    items,
  };

  const doelMap = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", phase, runId);
  mkdirSync(doelMap, { recursive: true });
  const doel = path.join(doelMap, "aggregate.json");
  writeFileSync(doel, `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`Geschreven: ${doel}`);
  console.log(`  ${replicates} replicaten · item-agreement ${((uit.itemAgreementRate ?? 0) * 100).toFixed(1)}% · ${instabiel.length} instabiele items`);
  console.log(`  totaal: mean ${uit.overall.meanPct?.toFixed(1)}% · mediaan ${uit.overall.medianPct?.toFixed(1)}% · worst ${uit.overall.worstPct?.toFixed(1)}%`);
  if (instabiel.length > 0) {
    console.log("  instabiele items (verschillend oordeel tussen replicaten):");
    for (const i of instabiel) console.log(`    ${i.id} (${i.category}): ${i.statussenPerReplicaat.join(" / ")}`);
  }
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
