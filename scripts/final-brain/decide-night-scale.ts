import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Beslisregel R1 (vastgelegd in decision-rules.json vóór de uitslag): de schaal
 * van de nachtrij, mechanisch uit solver-ab-nightrow.json.
 *
 *   npx tsx scripts/final-brain/decide-night-scale.ts
 */

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain");
const ab = JSON.parse(readFileSync(path.join(MAP, "solver-ab-nightrow.json"), "utf8")) as { rows: Record<string, unknown>[]; variants: string[] };

const gem = (variant: string, veld: string) => {
  const xs = ab.rows.filter((r) => r.variant === variant && typeof r[veld] === "number").map((r) => r[veld] as number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
};

const schalen = [1, 3, 5, 8].filter((k) => ab.variants.includes(`mens${k}`));
const basis = { fairness: gem("mens1", "fairness"), hours: gem("mens1", "hours") };
const rijen = schalen.map((k) => {
  const v = `mens${k}`;
  const eerlijk = gem(v, "fairness");
  const uren = gem(v, "hours");
  return {
    scale: k,
    exitsBelowRule: gem(v, "exitsBelowRule"),
    minRecoveryHours: gem(v, "minRecoveryHours"),
    fairness: eerlijk,
    hours: uren,
    fairnessDrop: basis.fairness - eerlijk,
    hoursDrop: basis.hours - uren,
    eligible: basis.fairness - eerlijk <= 2 && basis.hours - uren <= 0.5,
  };
});
const kandidaten = rijen.filter((r) => r.eligible);
const laagste = Math.min(...kandidaten.map((r) => r.exitsBelowRule));
const gekozen = kandidaten.filter((r) => r.exitsBelowRule === laagste).sort((a, b) => a.scale - b.scale)[0]?.scale ?? 1;
const klassiek = { exitsBelowRule: gem("klassiek", "exitsBelowRule"), minRecoveryHours: gem("klassiek", "minRecoveryHours"), fairness: gem("klassiek", "fairness"), hours: gem("klassiek", "hours") };

writeFileSync(path.join(MAP, "decision-r1.json"), `${JSON.stringify({ rule: "R1", classic: klassiek, rows: rijen, chosenScale: gekozen }, null, 2)}\n`);
for (const r of rijen) {
  console.log(`×${r.scale}: < 46 u ${r.exitsBelowRule.toFixed(2)} · kortste ${r.minRecoveryHours.toFixed(1)} u · eerlijk ${r.fairness.toFixed(1)} (−${r.fairnessDrop.toFixed(1)}) · uren ${r.hours.toFixed(2)} (−${r.hoursDrop.toFixed(2)}) · ${r.eligible ? "toegestaan" : "valt af"}`);
}
console.log(`klassiek: < 46 u ${klassiek.exitsBelowRule.toFixed(2)} · kortste ${klassiek.minRecoveryHours.toFixed(1)} u · eerlijk ${klassiek.fairness.toFixed(1)}`);
console.log(`R1 kiest schaal ${gekozen}`);
