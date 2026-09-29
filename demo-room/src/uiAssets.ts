import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Het asset-contract van de Demo Room-UI: welke bestanden `index.html`
 * (direct of via ES-module-imports) nodig heeft om gestyled en werkend te
 * renderen, en of ze allemaal op schijf staan.
 *
 * Aanleiding: een Demo Room-server die vóór de UI-opsplitsing (commit
 * 790bbde) was gestart, bleef op poort 4173 draaien. Hij las het nieuwe
 * `index.html` per verzoek van schijf, maar kende de routes voor
 * `/styles.css` en `/app.js` niet — 404, en de pagina viel terug op kale
 * browser-HTML (reuzenlogo, schreefletter, standaardknoppen). Dit bestand
 * maakt het contract expliciet zodat de server het bij opstart controleert
 * en een test het kan afdwingen.
 */

const LINK_HREF = /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi;
const SCRIPT_SRC = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
const ES_IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*["']([^"']+)["']|(?:^|[\s;(])import\(\s*["']([^"']+)["']\s*\)/gm;
const DYNAMIC_PAGE = /import\(\s*`\.\/pages\/\$\{[^}]+\}\.js`\s*\)/;

function uiPad(uiDir: string, url: string, vanafBestand?: string): string | null {
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("data:")) return null;
  const schoon = url.split(/[?#]/)[0];
  if (schoon.startsWith("/")) return path.join(uiDir, schoon.slice(1));
  const basis = vanafBestand ? path.dirname(vanafBestand) : uiDir;
  return path.resolve(basis, schoon);
}

export interface UiAssetReport {
  /** Relatief aan UI_DIR, met voorwaartse schuine strepen. */
  readonly required: readonly string[];
  readonly missing: readonly string[];
  /** Hash over alle aanwezige assets: verandert zodra één UI-bestand verandert. */
  readonly hash: string;
}

/**
 * Loopt het afhankelijkheidsnetwerk af vanaf `index.html`: stylesheets,
 * scripts, en daarna recursief elke statische ES-import. De router laadt
 * pagina's dynamisch (`import(\`./pages/${naam}.js\`)`); die worden gevonden
 * via `pageNames`, dezelfde lijst die de router zelf gebruikt.
 */
export function uiAssetReport(uiDir: string, pageNames: readonly string[]): UiAssetReport {
  const indexPad = path.join(uiDir, "index.html");
  const nodig = new Set<string>();
  const wachtrij: string[] = [];
  const voegToe = (abs: string | null) => {
    if (!abs || nodig.has(abs)) return;
    nodig.add(abs);
    if (abs.endsWith(".js")) wachtrij.push(abs);
  };

  if (existsSync(indexPad)) {
    const html = readFileSync(indexPad, "utf8");
    for (const m of html.matchAll(LINK_HREF)) voegToe(uiPad(uiDir, m[1]));
    for (const m of html.matchAll(SCRIPT_SRC)) voegToe(uiPad(uiDir, m[1]));
  }

  while (wachtrij.length > 0) {
    const bestand = wachtrij.shift() as string;
    if (!existsSync(bestand)) continue;
    const bron = readFileSync(bestand, "utf8");
    for (const m of bron.matchAll(ES_IMPORT)) voegToe(uiPad(uiDir, m[1] ?? m[2], bestand));
    if (DYNAMIC_PAGE.test(bron)) {
      for (const naam of pageNames) voegToe(path.join(path.dirname(bestand), "pages", `${naam}.js`));
    }
  }

  const rel = (abs: string) => path.relative(uiDir, abs).split(path.sep).join("/");
  const required = [...nodig].map(rel).sort();
  const missing = required.filter((r) => !existsSync(path.join(uiDir, r)));
  const hash = createHash("sha256");
  for (const r of required) if (!missing.includes(r)) hash.update(r).update(readFileSync(path.join(uiDir, r)));
  return { required, missing, hash: hash.digest("hex").slice(0, 12) };
}

/** Leest de paginanamen uit app.js (ROUTES + EXTRA_ROUTES), zodat dit bestand niet stil achterloopt op de router. */
export function routerPageNames(uiDir: string): string[] {
  const appPad = path.join(uiDir, "app.js");
  if (!existsSync(appPad)) return [];
  const bron = readFileSync(appPad, "utf8");
  const namen = new Set<string>();
  for (const lijst of bron.matchAll(/const\s+(?:ROUTES|EXTRA_ROUTES)\s*=\s*\[([^\]]*)\]/g)) {
    for (const n of lijst[1].matchAll(/["']([a-z0-9-]+)["']/g)) namen.add(n[1]);
  }
  return [...namen];
}
