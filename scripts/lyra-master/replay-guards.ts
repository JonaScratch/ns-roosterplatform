/**
 * Hergebruikt opgeslagen antwoorden om te zien wat nieuwe controles zouden
 * veranderen — zonder model, zonder database. Leest alleen; schrijft niets.
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/replay-guards.ts
 *
 * Per antwoord: zou de afwezigheidscontrole het tegenhouden, krijgt het een
 * citaatvoorbehoud, en verandert het domeinwoordenboek voor de vraag? Zo
 * blijkt vóór een nieuwe meting of een reparatie een goed antwoord raakt.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { verzonnenAfwezigheden, vraagtOmCitaat } from "../../src/server/agent/bron-afwezigheid";
import { begrippenIn, VAKWOORDEN } from "../../src/server/agent/vocabulary";

const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const bestanden: string[] = [];
const bench = path.join(WORTEL, "docs", "v1.0.6", "benchmarks");
for (const map of readdirSync(bench)) {
  if (!/^(before-20260927-205217|after-2026092)/.test(map)) continue;
  for (const f of ["golden.json", "golden-extension.json"]) if (existsSync(path.join(bench, map, f))) bestanden.push(path.join(bench, map, f));
}
const adv = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", "adversarial");
if (existsSync(adv)) for (const m of readdirSync(adv)) if (existsSync(path.join(adv, m, "adversarial.json"))) bestanden.push(path.join(adv, m, "adversarial.json"));

let antwoorden = 0;
const afwezig: string[] = [];
const citaat: string[] = [];
for (const f of bestanden) {
  const d = JSON.parse(readFileSync(f, "utf8")) as Json;
  for (const it of d.results ?? []) {
    for (const t of it.turns ?? []) {
      antwoorden += 1;
      const rel = `${path.relative(WORTEL, f)} ${it.id}`;
      if (t.status === "BEANTWOORD" && verzonnenAfwezigheden(String(t.text ?? "")).length > 0) afwezig.push(`${rel}: ${verzonnenAfwezigheden(String(t.text))[0].slice(0, 140)}`);
    }
  }
}
console.log(`${bestanden.length} bestanden, ${antwoorden} beurten`);
console.log(`afwezigheidscontrole zou tegenhouden (${afwezig.length}):`);
for (const a of afwezig) console.log(`  ${a}`);
// Vragen komen uit de bevroren suite (de resultaten bevatten alleen antwoorden).
const suite = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.6", "golden-suite.json"), "utf8")) as Json;
/** De woordenboekmatching van vóór de reparatie (koppelteken = woordgrens), ter vergelijking. */
const oudeTermen = (tekst: string) => {
  const laag = tekst.toLowerCase();
  return VAKWOORDEN.filter((b) => b.termen.some((term) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(laag))).map((b) => b.termen[0]);
};
let verschil = 0;
for (const it of suite.items ?? []) {
  for (const t of it.turns ?? []) {
    const q = String(t.text ?? "");
    const oud = oudeTermen(q).join(",");
    const nieuw = begrippenIn(q).map((b) => b.termen[0]).join(",");
    if (oud !== nieuw) {
      verschil += 1;
      console.log(`  woordenboek anders bij ${it.id}: [${oud}] → [${nieuw}]`);
    }
    if (vraagtOmCitaat(q)) citaat.push(`kern ${it.id}`);
  }
}
console.log(`kernvragen met ander woordenboek: ${verschil}`);
console.log(`citaatverzoeken in kernvragen: ${citaat.length} ${citaat.join(", ")}`);
