/**
 * Nederlandse woordnormalisatie — puur, zonder afhankelijkheden, zodat zowel
 * de regelkennisbank (src/server/agent/knowledge.ts) als de Demo Room
 * (demo-room/src/learning/generalization.ts) dezelfde regels gebruiken.
 */

/**
 * Kernwoorden achteraan Nederlandse samenstellingen: "weekendnorm",
 * "rusttijd", "nachtgrens". Het regelbestand gebruikt vaak een ándere
 * samenstelling met dezelfde stam ("Weekendbalans").
 */
const KERNWOORDEN = ["normen", "norm", "balans", "grenzen", "grens", "limiet", "eisen", "eis", "tijden", "tijd", "duur", "periode", "kaders", "kader", "regels", "regel", "aantal"];

/** De stam van een samenstelling met een kernwoord achteraan, of `null`. `verboden` sluit stammen uit (bv. stopwoorden). */
export function samenstellingsStam(woord: string, verboden: ReadonlySet<string> = new Set()): string | null {
  for (const kern of KERNWOORDEN) {
    if (woord.length > kern.length + 3 && woord.endsWith(kern)) {
      const stam = woord.slice(0, -kern.length).replace(/s$/, "");
      if (stam.length >= 4 && !verboden.has(stam)) return stam;
    }
  }
  return null;
}

/** Grove enkelvoudsvorm: "diensten" → "dienst", "nachten" → "nacht", "roosters" → "rooster". */
export function enkelvoud(woord: string): string {
  if (woord.length > 5 && woord.endsWith("en")) return woord.slice(0, -2);
  if (woord.length > 4 && woord.endsWith("s") && !woord.endsWith("ss")) return woord.slice(0, -1);
  return woord;
}

/** Woorden van een tekst, klein, zonder leestekens. */
export function woordenVan(tekst: string): string[] {
  return tekst
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúëïöüä+\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}
