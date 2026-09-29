/**
 * Twee dingen die het platform over een brondocument wél zeker weet, en het
 * model niet.
 *
 * ## 1. Wat een document níet bevat, weet niemand hier
 *
 * De tools geven gevonden regels terug, nooit een heel document. Een zin als
 * "het document bevat geen tekst over X" of "de CAO zegt niets over Y" is dus
 * altijd een verzonnen afwezigheid: het model heeft het document niet gezien.
 * Wat wel klopt: "in wat ik kon raadplegen, vond ik geen tekst over X". Die
 * vorm (de geraadpleegde gegevens als onderwerp) wordt niet tegengehouden.
 *
 * ## 2. Om een letterlijk citaat vragen bij een document zonder tekst
 *
 * Vraagt iemand om de exacte tekst, en komt het antwoord uit een document
 * waarvan het platform alleen een scan heeft (`source-text.ts`), dan hoort de
 * gebruiker dat — ook als het model het vergeet. Dat is geen oordeel over de
 * inhoud maar herkomst, net als de bronvermelding.
 *
 * Beide zijn smal en toetsbaar, zonder model en zonder database.
 */

const DOCUMENTWOORD = "(?:document|brondocument|bron|kader|roosterkader|roosterkaders|cao|regeling|tekst van (?:het|de) (?:document|kader|cao))";
const ONTKENNING = "(?:geen|niets|nergens)";

/**
 * Zinnen waarin een document het onderwerp is van een afwezigheid:
 * "het document bevat geen …", "de CAO zegt niets over …", "in de roosterkaders
 * staat niets over …". Zinnen met de geraadpleegde gegevens als onderwerp
 * ("in de gegevens die ik kon raadplegen staat geen …") vallen erbuiten.
 */
export function verzonnenAfwezigheden(antwoord: string): readonly string[] {
  const zinnen = antwoord.split(/(?<=[.!?])\s+/);
  const doc = new RegExp(
    [
      // "het document … bevat/zegt/noemt/vermeldt geen/niets"
      `\\b(?:het|de|dit|dat|deze)\\s+(?:[\\w'‘’"“”-]+\\s+){0,6}?${DOCUMENTWOORD}\\b[^.!?]{0,60}?\\b(?:bevat|zegt|noemt|vermeldt|beschrijft|regelt)\\s+(?:er\\s+)?${ONTKENNING}\\b`,
      // "in het document staat niets/geen …"
      `\\bin\\s+(?:het|de|dit|dat|deze)\\s+(?:[\\w'‘’"“”-]+\\s+){0,6}?${DOCUMENTWOORD}\\b[^.!?]{0,40}?\\bstaat\\s+(?:er\\s+)?${ONTKENNING}\\b`,
    ].join("|"),
    "i",
  );
  const overGegevens = /\b(in (de |het )?(gegevens|toolresultaten|zoekresultaten|resultaten)|wat ik (kon |heb kunnen )?(raadplegen|vinden|opzoeken)|(vond|heb) ik (niets|geen))\b[^.!?]*$/i;
  return zinnen.filter((z) => doc.test(z) && !beginMetGegevens(z, overGegevens));
}

/** Het onderwerp is "de gegevens" als die vóór het documentwoord staan. */
function beginMetGegevens(zin: string, overGegevens: RegExp): boolean {
  const m = zin.match(overGegevens);
  if (!m || m.index === undefined) return false;
  const doc = zin.search(new RegExp(`\\b${DOCUMENTWOORD}\\b`, "i"));
  return doc >= 0 && m.index < doc;
}

/** Vraagt de gebruiker om de letterlijke brontekst? */
export function vraagtOmCitaat(vraag: string): boolean {
  return /\b(letterlijk(e)?|exact(e)?\s+(tekst|bewoording|formulering|zin)|citaat|citeer|citeren|woordelijk|precieze\s+(tekst|bewoording)|hoe\s+staat\s+het\s+er\s+precies)\b/i.test(vraag);
}

export interface NietCiteerbareBron {
  readonly documentTitle: string;
  readonly uitleg: string;
}

/**
 * Welke documenten in de gegevens van deze beurt hebben geen tekst om uit te
 * citeren? Leest `source.textAccess` uit ruleSearch/ruleLookup-resultaten.
 */
export function nietCiteerbareBronnen(
  resultaten: readonly { readonly data: unknown }[],
  uitlegVoor: (documentTitle: string) => string | null,
): readonly NietCiteerbareBron[] {
  const titels = new Set<string>();
  for (const r of resultaten) {
    const data = r.data as { hits?: unknown; rules?: unknown } | null;
    const regels = [...(Array.isArray(data?.hits) ? data.hits : []), ...(Array.isArray(data?.rules) ? data.rules : [])] as { source?: { documentTitle?: string; textAccess?: string | null } }[];
    for (const h of regels) {
      if (h.source?.textAccess === "SCAN_NO_TEXT_LAYER" && h.source.documentTitle) titels.add(h.source.documentTitle);
    }
  }
  return [...titels].map((documentTitle) => ({ documentTitle, uitleg: uitlegVoor(documentTitle) ?? "er is geen machineleesbare brontekst." }));
}

/** De zin die bij een citaatverzoek hoort als de bron geen tekst heeft. */
export function citaatVoorbehoud(bronnen: readonly NietCiteerbareBron[]): string | null {
  if (bronnen.length === 0) return null;
  return bronnen.map((b) => `Over de brontekst van '${b.documentTitle}': ${b.uitleg} Een letterlijk citaat kan ik daarom niet als vaststaande tekst geven.`).join(" ");
}

/** Wat de gebruiker ziet als een verzonnen afwezigheid wordt tegengehouden: wat er wél gevonden is. */
export function afwezigheidsMelding(
  resultaten: readonly { readonly tool: string; readonly data: unknown }[],
  bronnen: readonly NietCiteerbareBron[],
): string {
  const gevonden: string[] = [];
  for (const r of resultaten) {
    const data = r.data as { hits?: unknown; rules?: unknown } | null;
    const regels = [...(Array.isArray(data?.hits) ? data.hits : []), ...(Array.isArray(data?.rules) ? data.rules : [])] as {
      title?: string;
      statusText?: string;
      rationale?: string;
      source?: { documentTitle?: string };
    }[];
    for (const h of regels.slice(0, 3)) {
      if (!h.title) continue;
      gevonden.push(`${h.title} (${h.source?.documentTitle ?? "bron onbekend"}${h.statusText ? `, ${h.statusText}` : ""})${h.rationale ? `: ${h.rationale}` : ""}`);
    }
  }
  const delen = [
    "Ik hield mijn eigen antwoord tegen: ik schreef wat een document níet bevat, maar ik zie alleen de regels die ik opzocht, niet het document zelf.",
  ];
  if (gevonden.length > 0) delen.push(`Wat ik wel vond: ${gevonden.join(" · ")}`);
  const voorbehoud = citaatVoorbehoud(bronnen);
  if (voorbehoud) delen.push(voorbehoud);
  return delen.join(" ");
}
