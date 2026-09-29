/**
 * Welke reekslengte noemt een antwoord? (grader voor `night_series_length`)
 *
 * ## Waarom een eigen, toetsbaar bestand
 *
 * De eerste versie stond in `golden-grade-extension.ts` en pakte "het eerste
 * getal binnen 20 tekens na 'nacht'". In AFTER-run 20260929-234655 las die
 * "…de nachtreeks van regel 8…" als een reeks van 8, terwijl het antwoord
 * eerder in dezelfde tekst "…is 5 diensten…" zei. Een regel- of weekdagnummer
 * is geen lengte. Het antwoord was goed; de meting was fout.
 *
 * ## De regel
 *
 * 1. Verwijzingen naar een plek (regel 8, regels 2 en 3, weekdag 5, week 2)
 *    en kloktijden tellen nooit als lengte.
 * 2. Een lengte is een getal (ook als woord: "drie") gevolgd door een
 *    telwoord: nachten, nachtdiensten, diensten, dagen — of het getal na
 *    "reeks … is/van/telt/bedraagt".
 * 3. Staat er een zin met "langste", dan telt de lengte uit die zin. Anders
 *    de grootste genoemde lengte: de vraag gaat over de langste reeks.
 *
 * Dezelfde regel voor goed en fout: een tekst die "8 nachten op regel 5" zegt,
 * levert 8 op — niet 5.
 */

const GETALWOORDEN: Readonly<Record<string, number>> = {
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
  elf: 11,
  twaalf: 12,
};
const GETAL = `(\\d+|${Object.keys(GETALWOORDEN).join("|")})`;
const TELWOORD = "(?:opeenvolgende\\s+|aaneengesloten\\s+|achtereenvolgende\\s+)?(?:nachten|nachtdiensten|nachtdienst|diensten|dagen)";

const naarGetal = (s: string): number => (/^\d+$/.test(s) ? Number(s) : GETALWOORDEN[s]);

/** Plekken en tijden eruit: die getallen zijn nooit een lengte. */
function zonderPlekken(tekst: string): string {
  return tekst
    .toLowerCase()
    .replace(/\b(regels?|lijnen?|weekdag|week|dag)\s+\d+(\s*(,|en|t\/m|tot en met|tot|-)\s*\d+)*/g, " <plek> ")
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " <tijd> ");
}

function lengtesIn(zin: string): number[] {
  const uit: number[] = [];
  for (const m of zin.matchAll(new RegExp(`\\b${GETAL}\\s+${TELWOORD}\\b`, "g"))) uit.push(naarGetal(m[1]));
  for (const m of zin.matchAll(new RegExp(`reeks[^.!?]{0,60}?\\b(?:is|van|telt|bedraagt|omvat)\\s+${GETAL}\\b`, "g"))) uit.push(naarGetal(m[1]));
  return uit;
}

export function langsteReeksUitTekst(tekst: string): number | null {
  const schoon = zonderPlekken(tekst);
  const zinnen = schoon.split(/(?<=[.!?])\s+/);
  const inLangste = zinnen.filter((z) => /langste/.test(z)).flatMap(lengtesIn);
  if (inLangste.length > 0) return inLangste[0];
  const alle = zinnen.flatMap(lengtesIn);
  return alle.length > 0 ? Math.max(...alle) : null;
}
