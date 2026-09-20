import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

/**
 * Controleert het gebouwde rapport op de fouten die je pas ziet als je het opent.
 *
 * ## Wat hier wordt gecontroleerd, en waarom zo
 *
 * De tekst in de PDF is niet leesbaar terug te halen: de browser bedt
 * uitgeklede lettertypen in, waarin een letter een nummer is geworden. Een
 * controle die de PDF-tekst probeert te lezen, geeft daardoor loos alarm over
 * hoofdstukken die er wél in staan. Deze controle doet daarom twee dingen die
 * wel kloppen: ze kijkt in de PDF naar de omvang van elke bladzijde (een
 * bladzijde zonder inhoud valt op) en ze controleert de HTML — de bron van de
 * PDF — op hoofdstukken, tabellen, figuren en plaatshouders.
 *
 * ## Wat dit niet doet
 *
 * Beoordelen of iets mooi staat, of een tabel toevallig ongelukkig afbreekt.
 * Daar is kijken voor; dit vangt wat niemand met het blote oog op dertig
 * bladzijden zou vinden.
 *
 *   npm run report:optimizer-qa
 *   npm run report:human-qa
 */

const WORTEL = path.resolve(__dirname, "..", "..");
/** `human` controleert het leerrapport over de menselijke roosters, anders het v1.0.4-rapport. */
const NAAM =
  ({ human: "NS-Roosterplatform-Human-Roster-Learning-Report", "final-brain": "NS-Roosterplatform-v1.0.4-Final-Brain-Report" } as Record<string, string>)[process.argv[2] ?? ""] ?? "NS-Roosterplatform-v1.0.4-Optimizer-Development-Report";
const PDF = path.join(WORTEL, "docs", `${NAAM}.pdf`);
const HTML = path.join(WORTEL, "docs", `${NAAM}.html`);

interface Bevinding {
  readonly ernst: "fout" | "let op";
  readonly tekst: string;
}

/** Elke bladzijde met de omvang van zijn uitgepakte inhoud. */
function bladzijden(latin: string): { nummer: number; bytes: number }[] {
  // Objecten inlezen: "<n> 0 obj ... endobj".
  const objecten = new Map<number, string>();
  const objectRegex = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = objectRegex.exec(latin)) !== null) {
    objecten.set(Number(match[1]), match[2]);
  }
  const uitgepakt = (nummer: number): number => {
    const object = objecten.get(nummer);
    if (!object) return 0;
    const begin = object.indexOf("stream");
    if (begin < 0) return 0;
    const start = begin + (object.slice(begin).startsWith("stream\r\n") ? 8 : 7);
    const einde = object.indexOf("endstream", start);
    const rauw = Buffer.from(object.slice(start, einde), "latin1");
    try {
      return inflateSync(rauw).length;
    } catch {
      return rauw.length;
    }
  };

  const uit: { nummer: number; bytes: number }[] = [];
  let nummer = 0;
  for (const [, inhoud] of objecten) {
    if (!/\/Type\s*\/Page[^s]/.test(inhoud)) continue;
    nummer += 1;
    const verwijzing = /\/Contents\s+(\d+)\s+0\s+R/.exec(inhoud);
    uit.push({ nummer, bytes: verwijzing ? uitgepakt(Number(verwijzing[1])) : 0 });
  }
  return uit;
}

function main() {
  const ruw = readFileSync(PDF);
  const latin = ruw.toString("latin1");
  const html = readFileSync(HTML, "utf8");
  const tekstHtml = html.replace(/<style>[\s\S]*?<\/style>/g, "");
  const bevindingen: Bevinding[] = [];

  // ── De PDF ─────────────────────────────────────────────────────────────────
  const paginas = bladzijden(latin);
  const leeg = paginas.filter((pagina) => pagina.bytes < 400);
  for (const pagina of leeg) {
    bevindingen.push({ ernst: "fout", tekst: `Bladzijde ${pagina.nummer} bevat vrijwel niets (${pagina.bytes} bytes).` });
  }
  if (!/\/FontFile2|\/FontFile3|\/FontFile\b/.test(latin)) {
    bevindingen.push({ ernst: "fout", tekst: "Er zijn geen lettertypen ingebed; op een andere machine ziet het document er anders uit." });
  }

  // ── De hoofdstukken ────────────────────────────────────────────────────────
  const titels = [...html.matchAll(/<div class="num">Hoofdstuk (\d+)<\/div><h2>([^<]+)<\/h2>/g)].map((m) => ({
    nummer: Number(m[1]),
    titel: m[2],
  }));
  const inhoudsopgave = [...html.matchAll(/<div class="toc-row"><div class="num">(\d+)<\/div><div class="name">([^<]+)<\/div>/g)];
  if (inhoudsopgave.length !== titels.length) {
    bevindingen.push({
      ernst: "fout",
      tekst: `De inhoudsopgave noemt ${inhoudsopgave.length} hoofdstukken, het document heeft er ${titels.length}.`,
    });
  }
  for (const [index, titel] of titels.entries()) {
    if (titel.nummer !== index + 1) {
      bevindingen.push({ ernst: "fout", tekst: `Hoofdstuknummering springt bij "${titel.titel}" (${titel.nummer}).` });
    }
    if (inhoudsopgave[index] && inhoudsopgave[index][2] !== titel.titel) {
      bevindingen.push({
        ernst: "fout",
        tekst: `Inhoudsopgave zegt "${inhoudsopgave[index][2]}", het hoofdstuk heet "${titel.titel}".`,
      });
    }
  }
  const leegHoofdstuk = [...html.matchAll(/<section class="chapter">([\s\S]*?)<\/section>/g)].filter(
    (m) => m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").length < 400,
  );
  if (leegHoofdstuk.length > 0) {
    bevindingen.push({ ernst: "fout", tekst: `${leegHoofdstuk.length} hoofdstuk(ken) met nauwelijks inhoud.` });
  }

  // ── De tabellen ────────────────────────────────────────────────────────────
  let cellen = 0;
  let streepjes = 0;
  let scheve = 0;
  const tabellen = [...html.matchAll(/<table>([\s\S]*?)<\/table>/g)];
  for (const [, inhoud] of tabellen) {
    // Let op: <th[^>]*> matcht ook <thead>, en dan lijkt elke rij één cel tekort.
    const koppen = (inhoud.match(/<th(?=[\s>])[^>]*>/g) ?? []).length;
    for (const [, rij] of inhoud.matchAll(/<tr>((?:(?!<\/tr>)[\s\S])*)<\/tr>/g)) {
      const aantal = (rij.match(/<td[^>]*>/g) ?? []).length;
      if (aantal === 0) continue;
      cellen += aantal;
      streepjes += (rij.match(/<td[^>]*>—<\/td>/g) ?? []).length;
      if (aantal !== koppen) scheve += 1;
    }
  }
  if (scheve > 0) {
    bevindingen.push({ ernst: "fout", tekst: `${scheve} tabelrij(en) hebben niet evenveel cellen als kolommen.` });
  }
  if (cellen > 0 && streepjes / cellen > 0.15) {
    bevindingen.push({
      ernst: "fout",
      tekst: `${streepjes} van de ${cellen} tabelcellen zijn leeg (—); er ontbreken gegevens.`,
    });
  } else if (streepjes > 0) {
    bevindingen.push({
      ernst: "let op",
      tekst: `${streepjes} van de ${cellen} tabelcellen staan op — (niet gemeten). Controleer of dat klopt.`,
    });
  }

  // ── De figuren ─────────────────────────────────────────────────────────────
  const figuren = (html.match(/<figure>/g) ?? []).length;
  const bijschriften = (html.match(/<figcaption>/g) ?? []).length;
  const legeSvg = (html.match(/<svg[^>]*>\s*<\/svg>/g) ?? []).length;
  if (legeSvg > 0) bevindingen.push({ ernst: "fout", tekst: `${legeSvg} lege SVG-figuur(en).` });
  if (figuren !== bijschriften) {
    bevindingen.push({ ernst: "fout", tekst: `${figuren} figuren maar ${bijschriften} bijschriften.` });
  }
  for (const [, svg] of html.matchAll(/<svg[^>]*>([\s\S]*?)<\/svg>/g)) {
    if (/NaN|Infinity|undefined/.test(svg)) {
      bevindingen.push({ ernst: "fout", tekst: "Een figuur bevat een ongeldige coördinaat (NaN of Infinity)." });
      break;
    }
  }

  // ── Plaatshouders en rekenfouten ───────────────────────────────────────────
  for (const patroon of [/\bTODO\b/i, /\bLorem ipsum\b/i, /\bXXX+\b/, /\bNaN\b/, /\bundefined\b/, /\bnull\b/, /\[object Object\]/, /NOG NIET GEGENEREERD/, /nog niet vastgelegd/, /GEFAALD/]) {
    if (patroon.test(tekstHtml)) {
      bevindingen.push({ ernst: "fout", tekst: `Plaatshouder of rekenfout in de tekst: ${patroon}.` });
    }
  }

  // ── Uitkomst ───────────────────────────────────────────────────────────────
  const kleinste = paginas.reduce((min, pagina) => Math.min(min, pagina.bytes), Number.POSITIVE_INFINITY);
  console.log(`PDF   : ${paginas.length} bladzijden, ${(ruw.length / 1024).toFixed(0)} kB, kleinste bladzijde ${kleinste} bytes inhoud`);
  console.log(`HTML  : ${titels.length} hoofdstukken, ${tabellen.length} tabellen (${cellen} cellen), ${figuren} figuren`);
  if (bevindingen.length === 0) {
    console.log("\nGeen bevindingen.");
    return;
  }
  console.log("");
  for (const bevinding of bevindingen) {
    console.log(`  ${bevinding.ernst === "fout" ? "✗" : "!"} ${bevinding.tekst}`);
  }
  if (bevindingen.some((bevinding) => bevinding.ernst === "fout")) {
    process.exitCode = 1;
  }
}

main();
