import type { ExperimentRecord } from "../types";

/**
 * Herkent of experiment 17 hetzelfde idee probeert als experiment 4 (§13).
 *
 * Bewust grof en uitlegbaar in plaats van semantisch slim: genormaliseerde
 * hypothesetekst plus dezelfde configuratiesleutels/-waarden. Een Demo Room die
 * zelf moet raden of twee hypotheses "ongeveer hetzelfde" zijn, voegt precies
 * de soort giswerk toe die deze module moet voorkomen.
 */

function normaliseer(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWOORDEN = new Set([
  "de", "het", "een", "en", "of", "voor", "van", "dat", "die", "dit", "deze",
  "is", "in", "op", "met", "naar", "om", "te", "wordt", "worden", "zou",
]);

function kernwoorden(tekst: string): Set<string> {
  return new Set(normaliseer(tekst).split(" ").filter((w) => w.length > 2 && !STOPWOORDEN.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersect = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersect / union;
}

function configuratieGelijk(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const sleutelsA = Object.keys(a).sort();
  const sleutelsB = Object.keys(b).sort();
  if (sleutelsA.join(",") !== sleutelsB.join(",")) return false;
  return sleutelsA.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

export interface DuplicaatBevinding {
  readonly isDuplicaat: boolean;
  readonly gelijkenis: number;
  readonly eerdereMatch: ExperimentRecord | null;
  readonly toelichting: string;
}

/**
 * Kernwoord-gelijkenis ≥ deze grens EN dezelfde configuratie ⇒ duplicaat.
 * Alleen gelijke kernwoorden zonder gelijke configuratie ⇒ verwant, geen duplicaat
 * (twee hypotheses kunnen over hetzelfde onderwerp gaan met een andere variant).
 */
const GELIJKENISGRENS = 0.5;

export function vindDuplicaat(kandidaat: Pick<ExperimentRecord, "hypothesis" | "configuration" | "soort">, eerdere: readonly ExperimentRecord[]): DuplicaatBevinding {
  const kandidaatWoorden = kernwoorden(kandidaat.hypothesis);
  let beste: { record: ExperimentRecord; score: number } | null = null;

  for (const e of eerdere) {
    if (e.soort !== kandidaat.soort) continue;
    const score = jaccard(kandidaatWoorden, kernwoorden(e.hypothesis));
    if (!beste || score > beste.score) beste = { record: e, score };
  }

  if (!beste || beste.score < GELIJKENISGRENS) {
    return { isDuplicaat: false, gelijkenis: beste?.score ?? 0, eerdereMatch: beste?.record ?? null, toelichting: "geen eerdere hypothese met vergelijkbare kernwoorden gevonden" };
  }

  const gelijkeConfig = configuratieGelijk(kandidaat.configuration, beste.record.configuration);
  if (!gelijkeConfig) {
    return {
      isDuplicaat: false,
      gelijkenis: beste.score,
      eerdereMatch: beste.record,
      toelichting: `verwant aan ${beste.record.id} (kernwoorden ${(beste.score * 100).toFixed(0)}%), maar een andere configuratie — geen duplicaat, wel het vermelden waard`,
    };
  }

  return {
    isDuplicaat: true,
    gelijkenis: beste.score,
    eerdereMatch: beste.record,
    toelichting:
      `dit lijkt op experiment ${beste.record.id} (kernwoorden ${(beste.score * 100).toFixed(0)}%, dezelfde configuratie), ` +
      `dat toen eindigde als ${beste.record.decision} — "${beste.record.nextRecommendation ?? beste.record.failureReason ?? "geen aanbeveling vastgelegd"}"`,
  };
}
