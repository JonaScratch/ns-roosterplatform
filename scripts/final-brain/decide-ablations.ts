import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Beslisregel R2 (vastgelegd in decision-rules.json vóór de ablatieruns),
 * mechanisch toegepast op ablations.json.
 *
 * Een onderdeel blijft aan als de variant mét het onderdeel minstens evenveel
 * nachtpoorten én minstens evenveel bewakingspoorten haalt als de variant
 * zonder (beide tegen v1.0.4 op dezelfde strategie). Twijfel — minder op één
 * van beide — is uit. Voor de eerlijkheidsmarge wint de variant met de meeste
 * poorten; bij gelijkspel blijft 0,5.
 *
 * De schaal van de nachtrij valt onder R1 (de solver-A/B); de ablatie ×5
 * tegen de referentie wordt hier wel getoond, niet opnieuw beslist.
 *
 *   npx tsx scripts/final-brain/decide-ablations.ts
 */

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain");
const ab = JSON.parse(readFileSync(path.join(MAP, "ablations.json"), "utf8")) as { ablations: { phase: string; label: string; status: string; gates?: { key: string; group: string; pass: boolean }[] }[] };

const NACHT = new Set(["singletons", "pairs", "nightBlockValue", "worstNightExit", "minRecoveryHours"]);
const telling = (fase: string) => {
  const a = ab.ablations.find((x) => x.phase === fase);
  if (!a || a.status !== "gemeten" || !a.gates) return null;
  return {
    night: a.gates.filter((g) => NACHT.has(g.key) && g.pass).length,
    guard: a.gates.filter((g) => g.group === "guardrail" && g.pass).length,
    all: a.gates.filter((g) => g.pass).length,
    failed: a.gates.filter((g) => !g.pass).map((g) => g.key),
  };
};

const vergelijk = (onderdeel: string, aan: string, uit: string) => {
  const x = telling(aan);
  const y = telling(uit);
  if (!x || !y) return { component: onderdeel, on: aan, off: uit, decision: "niet te beslissen (ontbreekt)", keep: null };
  const keep = x.night >= y.night && x.guard >= y.guard;
  return { component: onderdeel, on: aan, off: uit, onCounts: x, offCounts: y, keep, decision: keep ? "aan" : "uit" };
};

const k = "k5";
const besluiten = [
  { ...vergelijk("nachtrij × 5 (informatief; beslist door R1)", `ab-${k}`, "human"), binding: false },
  { ...vergelijk("slechtste geval in de rangschikking", `ab-${k}-wc`, `ab-${k}`), binding: true },
  { ...vergelijk("nachtuitgangreparatie + nachten eerst", `ab-${k}-full`, `ab-${k}-wc`), binding: true },
  { ...vergelijk("nachten eerst (binnen de reparatie)", `ab-${k}-full`, `ab-${k}-nofirst`), binding: true },
];
const marges = [
  { tolerance: 0.25, phase: `ab-${k}-f025` },
  { tolerance: 0.5, phase: `ab-${k}-full` },
  { tolerance: 1, phase: `ab-${k}-f100` },
].map((m) => ({ ...m, counts: telling(m.phase) }));
const beste = Math.max(...marges.map((m) => m.counts?.all ?? -1));
const marge = marges.filter((m) => (m.counts?.all ?? -1) === beste).some((m) => m.tolerance === 0.5) ? 0.5 : marges.find((m) => (m.counts?.all ?? -1) === beste)?.tolerance ?? 0.5;

writeFileSync(path.join(MAP, "decision-r2.json"), `${JSON.stringify({ rule: "R2", decisions: besluiten, fairnessTolerance: { options: marges, chosen: marge } }, null, 2)}\n`);
for (const b of besluiten) {
  console.log(`${b.component.padEnd(46)} ${b.decision}${"onCounts" in b && b.onCounts ? `  (nacht ${b.onCounts.night} vs ${b.offCounts!.night}, bewaking ${b.onCounts.guard} vs ${b.offCounts!.guard})` : ""}${b.binding ? "" : "  [informatief]"}`);
}
console.log(`eerlijkheidsmarge: ${marges.map((m) => `${m.tolerance}: ${m.counts?.all ?? "—"} poorten`).join(" · ")} → ${marge}`);
