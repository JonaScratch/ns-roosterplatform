/**
 * Roster Arena (Phase M): kandidaten tegen elkaar, op dezelfde roosteropgaven.
 *
 * Invoer: per kandidaat per opgave een score (0–1, hoger = beter; bv. het
 * aandeel verborgen invarianten dat een antwoord haalt, of een genormaliseerde
 * roosterkwaliteit). Een opgave die een kandidaat niet deed, ontbreekt —
 * die telt niet als verlies.
 *
 * Rangschikking met Bradley–Terry over paarsgewijze uitslagen: per opgave
 * wint de hoogste score, gelijk is gelijk (halve winst voor beide). Dat is
 * eerlijker dan een optelsom zodra niet elke kandidaat elke opgave deed.
 * Elke kandidaat krijgt ook het aantal beslissende vergelijkingen mee: een
 * eerste plaats op twee vergelijkingen is geen eerste plaats op tweehonderd.
 */

export interface ArenaUitslag {
  readonly kandidaat: string;
  readonly opgave: string;
  readonly score: number;
}

export interface ArenaRang {
  readonly kandidaat: string;
  readonly sterkte: number;
  readonly gewonnen: number;
  readonly verloren: number;
  readonly gelijk: number;
  readonly beslissend: number;
  readonly opgaven: number;
}

/** Scores dichter bij elkaar dan dit gelden als gelijk (meetruis). */
export const GELIJK_MARGE = 0.02;

export function arena(uitslagen: readonly ArenaUitslag[], iteraties = 200): readonly ArenaRang[] {
  const kandidaten = [...new Set(uitslagen.map((u) => u.kandidaat))].sort();
  const perOpgave = new Map<string, Map<string, number>>();
  for (const u of uitslagen) {
    if (!Number.isFinite(u.score)) continue;
    const m = perOpgave.get(u.opgave) ?? new Map<string, number>();
    m.set(u.kandidaat, u.score);
    perOpgave.set(u.opgave, m);
  }

  // w[i][j] = (gewogen) winsten van i op j.
  const idx = new Map(kandidaten.map((k, i) => [k, i]));
  const n = kandidaten.length;
  const w = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const stats = kandidaten.map(() => ({ gewonnen: 0, verloren: 0, gelijk: 0, opgaven: 0 }));
  for (const scores of perOpgave.values()) {
    const deelnemers = [...scores.keys()];
    for (const k of deelnemers) stats[idx.get(k)!].opgaven += 1;
    for (let a = 0; a < deelnemers.length; a += 1) {
      for (let b = a + 1; b < deelnemers.length; b += 1) {
        const i = idx.get(deelnemers[a])!;
        const j = idx.get(deelnemers[b])!;
        const d = scores.get(deelnemers[a])! - scores.get(deelnemers[b])!;
        if (Math.abs(d) <= GELIJK_MARGE) {
          w[i][j] += 0.5;
          w[j][i] += 0.5;
          stats[i].gelijk += 1;
          stats[j].gelijk += 1;
        } else if (d > 0) {
          w[i][j] += 1;
          stats[i].gewonnen += 1;
          stats[j].verloren += 1;
        } else {
          w[j][i] += 1;
          stats[j].gewonnen += 1;
          stats[i].verloren += 1;
        }
      }
    }
  }

  // Bradley–Terry via de MM-iteratie (Hunter 2004), met een zwakke prior
  // (0,5 winst tegen een virtuele gemiddelde tegenstander) zodat een
  // kandidaat die alles won of alles verloor een eindige sterkte houdt.
  let p = new Array<number>(n).fill(1);
  for (let it = 0; it < iteraties; it += 1) {
    const nieuw = p.map((_, i) => {
      let winsten = 0.5;
      let noemer = 1 / (p[i] + 1);
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const nij = w[i][j] + w[j][i];
        if (nij === 0) continue;
        winsten += w[i][j];
        noemer += nij / (p[i] + p[j]);
      }
      return winsten / noemer;
    });
    const som = nieuw.reduce((a, b) => a + b, 0);
    p = nieuw.map((x) => (x * n) / som);
  }

  return kandidaten
    .map((k, i) => ({ kandidaat: k, sterkte: p[i], ...stats[i], beslissend: stats[i].gewonnen + stats[i].verloren }))
    .sort((a, b) => b.sterkte - a.sterkte || a.kandidaat.localeCompare(b.kandidaat));
}
