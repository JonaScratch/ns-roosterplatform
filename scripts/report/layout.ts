import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * De vormgeving van het ontwikkelrapport.
 *
 * ## Waarom de tekst mag doorlopen
 *
 * De handleiding en de brochure zijn opgemaakt als vaste bladzijden: elk blad
 * is een kader van 210 bij 297 millimeter en de inhoud is daarin gepast. Dat
 * werkt voor een document waarvan de tekst vastligt. Dit rapport bestaat uit
 * gemeten tabellen die per meting langer of korter zijn. In een vast kader
 * zou een tabel die één rij te lang is stilzwijgend worden afgekapt — precies
 * de fout die het rapport zelf moet uitsluiten. De inhoud loopt hier dus door
 * en de browser bepaalt waar de bladzijde eindigt; tabelrijen en figuren
 * blijven daarbij heel.
 *
 * ## Waarom geen paginanummers
 *
 * Doorlopende tekst betekent dat pas bij het afdrukken bekend is op welke
 * bladzijde een hoofdstuk begint. Een inhoudsopgave met verzonnen nummers is
 * erger dan een inhoudsopgave met hoofdstuknummers; die laatste staat er.
 */

const WORTEL = path.resolve(__dirname, "..", "..");

/** Het aangeleverde beeldmerk, of niets. Nooit een nagetekende variant. */
export function beeldmerk(height = 16): string {
  const bestand = path.join(WORTEL, "public", "brand", "ns-logo.svg");
  if (!existsSync(bestand)) {
    return "";
  }
  const svg = readFileSync(bestand, "utf8")
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  // Zonder viewBox schaalt het bestand niet mee: de hoogte wordt dan gevolgd en
  // de breedte blijft op nul staan, waardoor het beeldmerk onzichtbaar is.
  const breedte = /\bwidth="([\d.]+)"/.exec(svg)?.[1];
  const hoogte = /\bheight="([\d.]+)"/.exec(svg)?.[1];
  const viewBox = /viewBox="/.test(svg) || !breedte || !hoogte ? "" : ` viewBox="0 0 ${breedte} ${hoogte}"`;
  return svg.replace("<svg", `<svg${viewBox} style="height:${height}px;width:auto" `);
}

export const REPORT_CSS = `
  :root{
    --ns-blue:#003da5;
    --ns-blue-dark:#00265c;
    --ns-blue-soft:#eaf1fb;
    --ink:#13203a;
    --ink-muted:#57647d;
    --ink-faint:#8695ac;
    --line:#dbe3f0;
    --line-soft:#eef2f9;
    --paper:#ffffff;
    --ok:#0c7a53;
    --ok-soft:#e4f5ee;
    --warn:#a3620b;
    --warn-soft:#fbeed9;
    --bad:#a3231f;
    --bad-soft:#fbe6e5;
    --serif:"Source Serif 4", Georgia, "Times New Roman", serif;
    --sans:"Source Sans 3", -apple-system, Segoe UI, Arial, sans-serif;
    --mono:"IBM Plex Mono", "Cascadia Code", Consolas, monospace;
  }
  *{ box-sizing:border-box; }
  html{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body{
    margin:0; background:#eef1f6; color:var(--ink);
    font-family:var(--sans); font-size:10.5px; line-height:1.62;
  }
  .sheet{
    max-width:210mm; margin:0 auto; background:var(--paper);
    padding:16mm 18mm 18mm 18mm; box-shadow:0 1px 6px rgba(19,32,58,.18);
  }
  @page{ size:210mm 297mm; margin:16mm 18mm 16mm 18mm; }
  @media print{
    body{ background:#fff; }
    .sheet{ max-width:none; margin:0; padding:0; box-shadow:none; }
  }

  h1,h2,h3,h4{ margin:0; font-weight:700; text-wrap:balance; }
  p{ margin:0 0 2.6mm; }
  a{ color:var(--ns-blue); }

  /* ── Omslag ────────────────────────────────────────────────────────── */
  .cover{ break-after:page; page-break-after:always; min-height:245mm; display:flex; flex-direction:column; }
  .cover-top{ display:flex; justify-content:space-between; align-items:flex-start; }
  .cover-tag{ font-size:9px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint); text-align:right; line-height:1.7; }
  .cover-mid{ margin-top:46mm; }
  .cover-mid .kicker{ font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ns-blue); margin-bottom:6mm; }
  .cover-mid h1{ font-size:40px; line-height:1.08; margin-bottom:8mm; }
  .cover-mid .claim{ font-family:var(--serif); font-size:16px; line-height:1.45; color:var(--ns-blue-dark); font-weight:600; max-width:135mm; }
  .cover-band{
    margin-top:auto; background:linear-gradient(120deg, var(--ns-blue) 0%, #0057c7 60%, #2f7fe0 100%);
    color:#fff; padding:7mm 8mm; display:flex; justify-content:space-between; align-items:flex-end; gap:8mm;
  }
  .cover-band .place{ font-family:var(--serif); font-size:15px; font-weight:600; }
  .cover-band .version{ color:#cfe0fa; font-size:9.5px; text-align:right; line-height:1.6; font-family:var(--mono); }

  /* ── Hoofdstukken ──────────────────────────────────────────────────── */
  .chapter{ break-before:page; page-break-before:always; }
  .chapter:first-of-type{ break-before:auto; page-break-before:auto; }
  .chapter > .head{ border-bottom:2px solid var(--ns-blue); padding-bottom:3mm; margin-bottom:5mm; }
  .chapter > .head .num{ font-family:var(--mono); font-size:10px; color:var(--ns-blue); letter-spacing:.05em; }
  .chapter > .head h2{ font-size:21px; line-height:1.15; margin-top:1mm; }
  .chapter > .head .sub{ font-size:10px; color:var(--ink-muted); margin-top:1.5mm; }
  h3.sec{ font-size:12.5px; margin:6mm 0 2mm; color:var(--ns-blue-dark); }
  h3.sec:first-child{ margin-top:0; }
  h4.sub{ font-size:10.8px; margin:4mm 0 1.5mm; }
  .lede{ font-family:var(--serif); font-size:13px; line-height:1.6; margin-bottom:4mm; }

  /* ── Inhoudsopgave ─────────────────────────────────────────────────── */
  .toc{ break-after:page; page-break-after:always; }
  .toc-row{ display:flex; gap:4mm; align-items:baseline; padding:2.4mm 0; border-bottom:1px solid var(--line-soft); }
  .toc-row .num{ font-family:var(--mono); font-size:10px; color:var(--ns-blue); width:7mm; flex:none; }
  .toc-row .name{ font-family:var(--serif); font-size:12px; font-weight:600; }
  .toc-row .what{ font-size:9.4px; color:var(--ink-muted); margin-left:auto; text-align:right; max-width:95mm; }

  /* ── Tabellen ──────────────────────────────────────────────────────── */
  table{ width:100%; border-collapse:collapse; font-size:9.3px; margin:2mm 0 3mm; }
  thead{ display:table-header-group; }
  tr{ break-inside:avoid; page-break-inside:avoid; }
  th{
    text-align:left; font-size:8.2px; text-transform:uppercase; letter-spacing:.05em;
    color:var(--ink-faint); border-bottom:1px solid var(--line); padding:1.8mm 2mm 1.8mm 0; vertical-align:bottom;
  }
  td{ padding:1.7mm 2mm 1.7mm 0; border-bottom:1px solid var(--line-soft); vertical-align:top; }
  td.num, th.num{ text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; padding-right:3mm; }
  tbody tr:last-child td{ border-bottom:1px solid var(--line); }
  .wide{ overflow-x:auto; }
  caption{ caption-side:top; text-align:left; font-size:9.6px; font-weight:700; padding-bottom:1.5mm; }

  .better{ color:var(--ok); font-weight:600; }
  .worse{ color:var(--bad); font-weight:600; }
  .same{ color:var(--ink-faint); }

  /* ── Blokken ───────────────────────────────────────────────────────── */
  .callout{ background:var(--ns-blue-soft); border-left:3px solid var(--ns-blue); padding:4mm 5mm; margin:3mm 0; break-inside:avoid; }
  .callout p{ font-family:var(--serif); font-size:11.5px; line-height:1.55; color:var(--ns-blue-dark); margin:0; }
  .callout.warn{ background:var(--warn-soft); border-left-color:var(--warn); }
  .callout.warn p{ color:#6b4400; }
  .callout.bad{ background:var(--bad-soft); border-left-color:var(--bad); }
  .callout.bad p{ color:#7a1a17; }
  .callout.ok{ background:var(--ok-soft); border-left-color:var(--ok); }
  .callout.ok p{ color:#08573b; }

  .cards{ display:grid; gap:3mm; margin:3mm 0; }
  .cards.g2{ grid-template-columns:1fr 1fr; }
  .cards.g3{ grid-template-columns:repeat(3,1fr); }
  .cards.g4{ grid-template-columns:repeat(4,1fr); }
  .card{ border:1px solid var(--line); border-radius:3px; padding:4mm; background:#fbfcff; break-inside:avoid; }
  .card h4{ font-size:10.4px; margin-bottom:1.4mm; }
  .card p{ font-size:9.2px; line-height:1.5; color:var(--ink-muted); margin:0; }
  .stat{ border-left:2.5px solid var(--ns-blue); padding-left:3.5mm; break-inside:avoid; }
  .stat .n{ font-family:var(--mono); font-size:21px; font-weight:500; color:var(--ns-blue); line-height:1.05; }
  .stat .l{ font-size:8.8px; color:var(--ink-muted); margin-top:1.2mm; line-height:1.45; }

  figure{ margin:3mm 0 4mm; break-inside:avoid; page-break-inside:avoid; }
  figure svg{ max-width:100%; height:auto; display:block; }
  figcaption{ font-size:8.8px; color:var(--ink-muted); margin-top:1.6mm; line-height:1.5; }

  ul,ol{ margin:0 0 3mm; padding-left:5mm; }
  li{ margin-bottom:1mm; }
  code{ font-family:var(--mono); font-size:9px; background:var(--line-soft); padding:.4mm 1mm; border-radius:2px; }
  .note{ font-size:8.8px; color:var(--ink-faint); line-height:1.5; }
  .mono{ font-family:var(--mono); font-variant-numeric:tabular-nums; }
`;

// ── Getallen ─────────────────────────────────────────────────────────────────

/** Nederlands getal: komma als decimaalteken, punt als duizendtal. */
export function nummer(waarde: number | null | undefined, decimalen = 1): string {
  if (waarde === null || waarde === undefined || !Number.isFinite(waarde)) {
    return "—";
  }
  return waarde.toLocaleString("nl-NL", {
    minimumFractionDigits: decimalen,
    maximumFractionDigits: decimalen,
  });
}

/** Een verschil met teken, zodat de richting meteen te zien is. */
export function verschil(waarde: number | null | undefined, decimalen = 1): string {
  if (waarde === null || waarde === undefined || !Number.isFinite(waarde)) {
    return "—";
  }
  const tekst = nummer(Math.abs(waarde), decimalen);
  if (Math.abs(waarde) < 10 ** -decimalen / 2) {
    return `0${decimalen > 0 ? `,${"0".repeat(decimalen)}` : ""}`;
  }
  return `${waarde > 0 ? "+" : "−"}${tekst}`;
}

export function procent(waarde: number | null | undefined, decimalen = 0): string {
  return waarde === null || waarde === undefined || !Number.isFinite(waarde)
    ? "—"
    : `${nummer(waarde, decimalen)}%`;
}

export function duur(seconden: number | null | undefined): string {
  if (seconden === null || seconden === undefined || !Number.isFinite(seconden)) {
    return "—";
  }
  const minuten = Math.floor(seconden / 60);
  const rest = Math.round(seconden % 60);
  return minuten === 0 ? `${rest} s` : `${minuten} min ${String(rest).padStart(2, "0")} s`;
}

export function escape(waarde: string): string {
  return waarde
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** De klasse waarmee een oordeel gekleurd wordt. */
export function oordeelKlasse(verdict: string): string {
  return verdict === "beter" ? "better" : verdict === "slechter" ? "worse" : "same";
}

// ── Bouwstenen ───────────────────────────────────────────────────────────────

export interface TableColumn {
  readonly head: string;
  readonly numeric?: boolean;
  readonly width?: string;
}

export function tabel(input: {
  readonly caption?: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly (readonly string[])[];
  readonly note?: string;
}): string {
  const kop = input.columns
    .map(
      (kolom) =>
        `<th${kolom.numeric ? ' class="num"' : ""}${kolom.width ? ` style="width:${kolom.width}"` : ""}>${escape(kolom.head)}</th>`,
    )
    .join("");
  const lijf = input.rows
    .map(
      (rij) =>
        `<tr>${rij
          .map((cel, index) => `<td${input.columns[index]?.numeric ? ' class="num"' : ""}>${cel}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table>${input.caption ? `<caption>${escape(input.caption)}</caption>` : ""}<thead><tr>${kop}</tr></thead><tbody>${lijf}</tbody></table>${
    input.note ? `<p class="note">${input.note}</p>` : ""
  }`;
}

export function figuur(svg: string, caption: string): string {
  return `<figure>${svg}<figcaption>${caption}</figcaption></figure>`;
}

export function kaart(titel: string, tekst: string): string {
  return `<div class="card"><h4>${escape(titel)}</h4><p>${tekst}</p></div>`;
}

export function cijferkaart(getal: string, label: string): string {
  return `<div class="card stat"><div class="n">${getal}</div><div class="l">${label}</div></div>`;
}

export function blok(tekst: string, soort: "info" | "warn" | "bad" | "ok" = "info"): string {
  const klasse = soort === "info" ? "callout" : `callout ${soort}`;
  return `<div class="${klasse}"><p>${tekst}</p></div>`;
}

export interface Chapter {
  readonly number: number;
  readonly title: string;
  /** Eén regel in de inhoudsopgave: wat er in dit hoofdstuk staat. */
  readonly what: string;
  readonly body: string;
}

export function hoofdstuk(chapter: Chapter): string {
  return `<section class="chapter"><div class="head"><div class="num">Hoofdstuk ${chapter.number}</div><h2>${escape(
    chapter.title,
  )}</h2><div class="sub">${escape(chapter.what)}</div></div>${chapter.body}</section>`;
}

export function document(input: {
  readonly title: string;
  readonly cover: string;
  readonly toc: string;
  readonly chapters: readonly string[];
}): string {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>${escape(input.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Source+Sans+3:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="sheet">
${input.cover}
${input.toc}
${input.chapters.join("\n")}
</div>
</body>
</html>
`;
}
