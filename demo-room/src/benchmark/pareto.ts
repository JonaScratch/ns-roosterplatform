import type { CandidatePoint, ParetoResult } from "../types";

/**
 * Pareto-analyse over kandidaten (§11 van de opdracht).
 *
 * "Beter" is hier bewust geen enkel getal: kandidaat A domineert kandidaat B
 * alleen als A op ALLE meegegeven metrics minstens gelijk is én op minstens
 * één metric strikt beter. Twee kandidaten die elk op iets anders winnen,
 * staan allebei op het front — geen van beide wordt automatisch "de winnaar".
 *
 * `higherIsBetter: null` (bijvoorbeeld "gemiddelde nachtreeks", waar te hoog
 * én te laag ongewenst kan zijn) telt niet mee in de dominantievergelijking:
 * zo'n metric wordt gerapporteerd maar bepaalt het front niet.
 */

export function domineert(a: CandidatePoint, b: CandidatePoint, higherIsBetter: Readonly<Record<string, boolean | null>>): boolean {
  let strikt = false;
  for (const key of Object.keys(higherIsBetter)) {
    const richting = higherIsBetter[key];
    if (richting === null) continue;
    const av = a.metrics[key];
    const bv = b.metrics[key];
    if (av === undefined || bv === undefined) continue;
    const aBeterOfGelijk = richting ? av >= bv : av <= bv;
    if (!aBeterOfGelijk) return false;
    if (av !== bv) strikt = true;
  }
  return strikt;
}

export function paretoFront(candidates: readonly CandidatePoint[], higherIsBetter: Readonly<Record<string, boolean | null>>): ParetoResult {
  const front: string[] = [];
  const dominated: string[] = [];
  const wins: Record<string, string[]> = {};

  for (const c of candidates) {
    const overwonnenDoor = candidates.find((other) => other.id !== c.id && domineert(other, c, higherIsBetter));
    if (overwonnenDoor) {
      dominated.push(c.id);
    } else {
      front.push(c.id);
    }
  }

  // Per paar op het front: waarop wint elk van hen, om "kandidaat A wint op
  // X/Y, kandidaat B wint op Z" te kunnen zeggen zoals de opdracht vraagt.
  for (const id of front) {
    const c = candidates.find((x) => x.id === id)!;
    const eigenWins: string[] = [];
    for (const key of Object.keys(higherIsBetter)) {
      const richting = higherIsBetter[key];
      if (richting === null) continue;
      const eigenWaarde = c.metrics[key];
      if (eigenWaarde === undefined) continue;
      const isBeste = front.every((otherId) => {
        if (otherId === id) return true;
        const otherWaarde = candidates.find((x) => x.id === otherId)!.metrics[key];
        if (otherWaarde === undefined) return true;
        return richting ? eigenWaarde >= otherWaarde : eigenWaarde <= otherWaarde;
      });
      if (isBeste) eigenWins.push(key);
    }
    wins[id] = eigenWins;
  }

  return { front, dominated, wins };
}
