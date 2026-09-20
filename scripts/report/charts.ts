/**
 * Grafieken voor het ontwikkel- en benchmarkrapport, als losse SVG.
 *
 * Geen bibliotheek: elke grafiek is een handvol rechthoeken en tekst op één
 * schaal, zodat de PDF precies toont wat de gegevens zeggen. Elke functie krijgt
 * getallen en geeft een SVG-tekst terug; de titels en bijschriften staan in het
 * rapport zelf.
 */

export const KLEUR = {
  before: "#8aa3c7",
  after: "#003082",
  official: "#e1a100",
  grid: "#dde3ec",
  ink: "#13203a",
  muted: "#5b6a82",
  good: "#1d7a4f",
  bad: "#b4232a",
} as const;

const esc = (tekst: string) => tekst.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (waarde: number, decimalen = 1) =>
  Number.isInteger(waarde) && decimalen === 0 ? String(waarde) : waarde.toFixed(decimalen).replace(".", ",");

function schaal(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (max === min) {
    max = min + 1;
  }
  const bereik = max - min;
  const stap = Math.pow(10, Math.floor(Math.log10(bereik / 4)));
  const kandidaten = [1, 2, 2.5, 5, 10].map((f) => f * stap);
  const gekozen = kandidaten.find((k) => bereik / k <= 6) ?? kandidaten[kandidaten.length - 1];
  const lo = Math.floor(min / gekozen) * gekozen;
  const hi = Math.ceil(max / gekozen) * gekozen;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + gekozen / 2; t += gekozen) ticks.push(Math.round(t * 1000) / 1000);
  return { lo, hi, ticks };
}

export interface RangeRow {
  readonly label: string;
  readonly series: readonly {
    readonly name: string;
    readonly color: string;
    readonly min: number | null;
    readonly median: number | null;
    readonly max: number | null;
    readonly mean: number | null;
  }[];
  readonly reference?: number | null;
}

/**
 * Per rij een bereik (min–max) met mediaan en gemiddelde, per reeks naast elkaar.
 * Een verticale gouden lijn is het officiële rooster.
 */
export function rangeChart(rows: readonly RangeRow[], options: { width?: number; unit?: string; decimals?: number; domain?: [number, number] } = {}): string {
  const breedte = options.width ?? 660;
  const labelBreedte = 190;
  const rijHoogte = 16 * Math.max(1, rows[0]?.series.length ?? 1) + 14;
  const hoogte = rows.length * rijHoogte + 34;
  const waarden = rows.flatMap((r) => [...r.series.flatMap((s) => [s.min, s.max]), r.reference ?? null]).filter((v): v is number => v !== null);
  const s = options.domain ? { ...schaal(options.domain[0], options.domain[1]) } : schaal(Math.min(...waarden, 0), Math.max(...waarden));
  const x = (v: number) => labelBreedte + ((v - s.lo) / (s.hi - s.lo)) * (breedte - labelBreedte - 16);
  const delen: string[] = [];
  for (const tick of s.ticks) {
    delen.push(`<line x1="${x(tick)}" y1="6" x2="${x(tick)}" y2="${hoogte - 22}" stroke="${KLEUR.grid}" stroke-width="1"/>`);
    delen.push(`<text x="${x(tick)}" y="${hoogte - 8}" font-size="9" text-anchor="middle" fill="${KLEUR.muted}">${fmt(tick, options.decimals ?? 0)}</text>`);
  }
  rows.forEach((rij, i) => {
    const y0 = 8 + i * rijHoogte;
    delen.push(`<text x="${labelBreedte - 8}" y="${y0 + rijHoogte / 2}" font-size="10" text-anchor="end" dominant-baseline="middle" fill="${KLEUR.ink}">${esc(rij.label)}</text>`);
    if (rij.reference !== null && rij.reference !== undefined) {
      delen.push(`<line x1="${x(rij.reference)}" y1="${y0}" x2="${x(rij.reference)}" y2="${y0 + rijHoogte - 10}" stroke="${KLEUR.official}" stroke-width="2.5"/>`);
    }
    rij.series.forEach((serie, j) => {
      const y = y0 + 6 + j * 16;
      if (serie.min === null || serie.max === null) return;
      delen.push(`<line x1="${x(serie.min)}" y1="${y}" x2="${x(serie.max)}" y2="${y}" stroke="${serie.color}" stroke-width="5" stroke-linecap="round" opacity="0.45"/>`);
      if (serie.median !== null) delen.push(`<circle cx="${x(serie.median)}" cy="${y}" r="4" fill="${serie.color}"/>`);
      if (serie.mean !== null) delen.push(`<line x1="${x(serie.mean)}" y1="${y - 6}" x2="${x(serie.mean)}" y2="${y + 6}" stroke="${KLEUR.ink}" stroke-width="1.5"/>`);
    });
  });
  return `<svg viewBox="0 0 ${breedte} ${hoogte}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Source Sans 3, Arial, sans-serif">${delen.join("")}</svg>`;
}

export interface BarGroup {
  readonly label: string;
  readonly bars: readonly { readonly name: string; readonly value: number | null; readonly color: string }[];
}

/** Gegroepeerde staven met de waarde erboven. */
export function groupedBars(groups: readonly BarGroup[], options: { width?: number; height?: number; decimals?: number; min?: number; max?: number } = {}): string {
  const breedte = options.width ?? 660;
  const hoogte = options.height ?? 200;
  const onder = 34;
  const boven = 16;
  const waarden = groups.flatMap((g) => g.bars.map((b) => b.value)).filter((v): v is number => v !== null);
  const s = schaal(options.min ?? Math.min(0, ...waarden), options.max ?? Math.max(...waarden, 1));
  const y = (v: number) => hoogte - onder - ((v - s.lo) / (s.hi - s.lo)) * (hoogte - onder - boven);
  const groepBreedte = (breedte - 40) / groups.length;
  const delen: string[] = [];
  for (const tick of s.ticks) {
    delen.push(`<line x1="36" y1="${y(tick)}" x2="${breedte}" y2="${y(tick)}" stroke="${KLEUR.grid}"/>`);
    delen.push(`<text x="32" y="${y(tick)}" font-size="9" text-anchor="end" dominant-baseline="middle" fill="${KLEUR.muted}">${fmt(tick, 0)}</text>`);
  }
  groups.forEach((groep, i) => {
    const gx = 40 + i * groepBreedte;
    const staaf = Math.min(28, (groepBreedte - 12) / groep.bars.length);
    const start = gx + (groepBreedte - staaf * groep.bars.length) / 2;
    groep.bars.forEach((bar, j) => {
      if (bar.value === null) return;
      const bx = start + j * staaf;
      const top = y(Math.max(bar.value, s.lo));
      delen.push(`<rect x="${bx + 1}" y="${top}" width="${staaf - 2}" height="${Math.max(0, y(s.lo) - top)}" fill="${bar.color}"/>`);
      delen.push(`<text x="${bx + staaf / 2}" y="${top - 3}" font-size="8.5" text-anchor="middle" fill="${KLEUR.ink}">${fmt(bar.value, options.decimals ?? 1)}</text>`);
    });
    delen.push(`<text x="${gx + groepBreedte / 2}" y="${hoogte - onder + 14}" font-size="9.5" text-anchor="middle" fill="${KLEUR.ink}">${esc(groep.label)}</text>`);
  });
  return `<svg viewBox="0 0 ${breedte} ${hoogte}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Source Sans 3, Arial, sans-serif">${delen.join("")}</svg>`;
}

/** Een histogram van waarden per reeks, op gedeelde bakken. */
export function histogram(series: readonly { name: string; color: string; values: readonly number[] }[], options: { width?: number; height?: number; bins?: number; min?: number; max?: number } = {}): string {
  const alle = series.flatMap((s) => s.values);
  const lo = options.min ?? Math.floor(Math.min(...alle));
  const hi = options.max ?? Math.ceil(Math.max(...alle));
  const bakken = options.bins ?? 12;
  const breedteBak = (hi - lo) / bakken || 1;
  const tellingen = series.map((serie) => {
    const t = Array.from({ length: bakken }, () => 0);
    for (const v of serie.values) t[Math.min(bakken - 1, Math.max(0, Math.floor((v - lo) / breedteBak)))] += 1;
    return t;
  });
  const groepen: BarGroup[] = Array.from({ length: bakken }, (_, i) => ({
    label: `${fmt(lo + i * breedteBak, 0)}`,
    bars: series.map((serie, j) => ({ name: serie.name, value: tellingen[j][i], color: serie.color })),
  }));
  return groupedBars(groepen, { width: options.width, height: options.height ?? 180, decimals: 0, min: 0 });
}

/** Punten: rekentijd tegenover kwaliteit, per modus. */
export function scatter(points: readonly { x: number; y: number; label: string; color: string }[], options: { width?: number; height?: number; xLabel: string; yLabel: string }): string {
  const breedte = options.width ?? 660;
  const hoogte = options.height ?? 230;
  const links = 46;
  const onder = 36;
  // Niet vanaf nul: de punten liggen dicht bij elkaar en zouden anders allemaal
  // in de rechterhelft op een kluitje staan.
  const sx = schaal(Math.min(...points.map((p) => p.x)) * 0.9, Math.max(...points.map((p) => p.x)) * 1.05);
  const sy = schaal(Math.min(...points.map((p) => p.y)) - 1, Math.max(...points.map((p) => p.y)) + 1);
  const x = (v: number) => links + ((v - sx.lo) / (sx.hi - sx.lo)) * (breedte - links - 20);
  const y = (v: number) => hoogte - onder - ((v - sy.lo) / (sy.hi - sy.lo)) * (hoogte - onder - 12);
  const delen: string[] = [];
  for (const t of sx.ticks) {
    delen.push(`<line x1="${x(t)}" y1="12" x2="${x(t)}" y2="${hoogte - onder}" stroke="${KLEUR.grid}"/>`);
    delen.push(`<text x="${x(t)}" y="${hoogte - onder + 12}" font-size="9" text-anchor="middle" fill="${KLEUR.muted}">${fmt(t, 0)}</text>`);
  }
  for (const t of sy.ticks) {
    delen.push(`<line x1="${links}" y1="${y(t)}" x2="${breedte - 20}" y2="${y(t)}" stroke="${KLEUR.grid}"/>`);
    delen.push(`<text x="${links - 5}" y="${y(t)}" font-size="9" text-anchor="end" dominant-baseline="middle" fill="${KLEUR.muted}">${fmt(t, 0)}</text>`);
  }
  delen.push(`<text x="${(breedte + links) / 2}" y="${hoogte - 6}" font-size="9.5" text-anchor="middle" fill="${KLEUR.ink}">${esc(options.xLabel)}</text>`);
  delen.push(`<text x="12" y="${(hoogte - onder) / 2}" font-size="9.5" text-anchor="middle" fill="${KLEUR.ink}" transform="rotate(-90 12 ${(hoogte - onder) / 2})">${esc(options.yLabel)}</text>`);
  // Een label per punt loopt bij tientallen punten door elkaar heen en maakt de
  // figuur onleesbaar. Alleen de uitersten krijgen een naam; de rest is een stip.
  const uitersten = new Set<string>();
  if (points.length > 0) {
    const noem = (gekozen: { label: string }) => uitersten.add(gekozen.label);
    noem(points.reduce((a, b) => (b.y > a.y ? b : a)));
    noem(points.reduce((a, b) => (b.y < a.y ? b : a)));
    noem(points.reduce((a, b) => (b.x > a.x ? b : a)));
  }
  for (const p of points) {
    delen.push(`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="4" fill="${p.color}" opacity="0.8"/>`);
    if (uitersten.has(p.label)) {
      const naarLinks = x(p.x) > breedte - 140;
      delen.push(
        `<text x="${x(p.x) + (naarLinks ? -7 : 7)}" y="${y(p.y) - 6}" font-size="8.5" text-anchor="${
          naarLinks ? "end" : "start"
        }" fill="${KLEUR.ink}">${esc(p.label)}</text>`,
      );
    }
  }
  return `<svg viewBox="0 0 ${breedte} ${hoogte}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Source Sans 3, Arial, sans-serif">${delen.join("")}</svg>`;
}

/** Een eenvoudig blokschema: vakken onder elkaar met pijlen. */
export function flowDiagram(steps: readonly { title: string; note: string }[], options: { width?: number } = {}): string {
  const breedte = options.width ?? 660;
  const vak = 40;
  const tussen = 16;
  const hoogte = steps.length * (vak + tussen);
  const delen: string[] = [];
  steps.forEach((stap, i) => {
    const y = i * (vak + tussen);
    delen.push(`<rect x="120" y="${y}" width="${breedte - 240}" height="${vak}" rx="6" fill="${i === 0 || i === steps.length - 1 ? "#eaf1fb" : "#ffffff"}" stroke="${KLEUR.after}" stroke-width="1.2"/>`);
    delen.push(`<text x="${breedte / 2}" y="${y + 16}" font-size="11" font-weight="600" text-anchor="middle" fill="${KLEUR.ink}">${esc(stap.title)}</text>`);
    delen.push(`<text x="${breedte / 2}" y="${y + 31}" font-size="9" text-anchor="middle" fill="${KLEUR.muted}">${esc(stap.note)}</text>`);
    if (i < steps.length - 1) {
      delen.push(`<line x1="${breedte / 2}" y1="${y + vak}" x2="${breedte / 2}" y2="${y + vak + tussen - 3}" stroke="${KLEUR.after}" stroke-width="1.4"/>`);
      delen.push(`<path d="M ${breedte / 2 - 4} ${y + vak + tussen - 7} L ${breedte / 2} ${y + vak + tussen - 1} L ${breedte / 2 + 4} ${y + vak + tussen - 7} Z" fill="${KLEUR.after}"/>`);
    }
  });
  return `<svg viewBox="0 -2 ${breedte} ${hoogte}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Source Sans 3, Arial, sans-serif">${delen.join("")}</svg>`;
}
