/**
 * Claim-verificatie: gezagsclaims zonder onderliggende bron.
 *
 * ## Waarom dit een NIEUW, apart bestand is en geen uitbreiding van grounding.ts
 *
 * `grounding.ts` controleert of een LETTERLIJK GENOEMD DING (regel-ID,
 * dienstnummer, roostercode) ook echt in de opgehaalde gegevens voorkomt.
 * Dit bestand controleert iets anders: of een TOON VAN GEZAG in de tekst
 * ("is bevestigd", "formeel", "officieel", "CAO-verplicht") wordt gedekt
 * door een daadwerkelijk opgehaald `legalStatus: VALIDATED`-signaal. Een
 * antwoord kan grondingscontrole-technisch prima zijn (elk genoemd regel-ID
 * bestaat echt en is opgezocht) en toch een woord als "bevestigd" gebruiken
 * over iets dat de tool zelf als `SOURCE_TRANSCRIBED` (nog niet bevestigd)
 * bestempelt. Dat is precies het gat dat de fase-0-inventaris vaststelde
 * (`docs/lyra-knowledge/inventory-memory-grounding-tools.md` §2): de
 * bestaande regressietoets in `scripts/verify-agent.ts` bevat zelfs het
 * woord "bevestigd" in de testinvoer zonder dat op te merken.
 *
 * ## BELANGRIJK — dit bestand is NIET aangesloten op agent.ts
 *
 * Precies zoals grounding.ts's eigen commentaar zegt over valse alarmen: een
 * te gretige claim-verificatie die goede antwoorden blokkeert, wordt
 * uitgezet en helpt dan niemand meer. Deze functie is daarom gebouwd en
 * volledig los getest (zie `tests/agent/claim-verification.test.ts`), maar
 * NOG NIET aangeroepen vanuit `agent.ts`. Aansluiten op de echte
 * antwoordketen is expliciet vervolgwerk NA de bevroren BEFORE-meting (§33/
 * §34 van de opdracht: een nieuwe grendel die antwoorden kan blokkeren of
 * wijzigen is een inhoudelijke gedragswijziging, en die mag niet vóór de
 * BEFORE-meting plaatsvinden — anders meet de BEFORE-run al het AFTER-
 * gedrag).
 *
 * ## Waarom bewust smal (negatie-bewust, geen kale trefwoordmatch)
 *
 * "CAO" en "bevestigd" komen ook voor in correcte, eerlijke hedging-taal
 * ("nog niet formeel bevestigd", "dit staat in de CAO-transcriptie, niet
 * geverifieerd"). Een kale trefwoordmatch zou zulke eerlijke antwoorden
 * juist afstraffen — het tegenovergestelde van de bedoeling. Deze module
 * herkent daarom uitsluitend POSITIEVE gezagsclaims (een bewering DAT iets
 * bevestigd/formeel/officieel/verplicht IS), met een korte negatie-blik
 * terug ("niet", "nog niet", "geen") die de claim ontkracht.
 */

export interface GezagsClaim {
  /** Het exacte, gevonden claim-fragment, voor herleidbaarheid. */
  readonly fragment: string;
  /** Welk gezagswoord de claim triggerde. */
  readonly signaalwoord: string;
}

interface ClaimPatroon {
  readonly signaalwoord: string;
  /** Matcht een POSITIEVE claim — "is bevestigd", niet los "bevestigd". */
  readonly regex: RegExp;
}

const CLAIM_PATRONEN: readonly ClaimPatroon[] = [
  // Kale woordmatch, geen vereist werkwoord ervoor: "artikel X, bevestigd"
  // (de letterlijke historische testzin) heeft geen "is/zijn" nodig om een
  // claim te zijn. De negatiecontrole hieronder kijkt naar de woorden VLAK
  // VOOR "bevestigd" zelf — dat ving eerder "is nog niet bevestigd" fout,
  // omdat "nog niet" toen ONDERDEEL van de match was (tussen "is" en
  // "bevestigd") en dus buiten het negatievenster viel.
  { signaalwoord: "bevestigd", regex: /\bbevestigd\b/gi },
  { signaalwoord: "formeel", regex: /\bformeel\s+(?:bevestigd|vastgesteld|goedgekeurd|geldig)\b/gi },
  { signaalwoord: "officieel", regex: /\bofficieel\s+(?:bevestigd|vastgesteld|goedgekeurd|geldig)\b/gi },
  { signaalwoord: "verplicht", regex: /\b(?:cao|wettelijk|ns)[\s-]*verplicht\b/gi },
  { signaalwoord: "CAO-regel", regex: /\bcao-regel\b/gi },
  { signaalwoord: "NS-regel", regex: /\bns-regel\b/gi },
];

/**
 * Woorden binnen deze afstand VÓÓR de match die de claim ontkrachten — "nog
 * niet bevestigd", "geen officiële bevestiging", "niet formeel vastgesteld".
 * Een korte, vaste venstergrootte (6 woorden) is dezelfde soort bewuste,
 * simpele grens als `grounding.ts` elders gebruikt (bijv. de
 * roostercode-grens rond "CAO-NS-2024-2025").
 */
const ONTKRACHTERS = /\b(niet|geen|nooit|zonder)\b/i;
const NEGATIE_VENSTER_WOORDEN = 4;

function isOntkracht(tekst: string, matchIndex: number): boolean {
  const voorMatch = tekst.slice(0, matchIndex);
  const woorden = voorMatch.trim().split(/\s+/);
  const venster = woorden.slice(-NEGATIE_VENSTER_WOORDEN).join(" ");
  return ONTKRACHTERS.test(venster);
}

/**
 * Vindt positieve gezagsclaims in een antwoordtekst die niet zijn ontkracht
 * door een nabije negatie. Geeft GEEN oordeel over of de claim gedekt is
 * door de gegevens — dat doet `isGedektDoorGegevens()` hieronder, apart,
 * zodat de tekstherkenning en de dekkingscontrole onafhankelijk te toetsen
 * en te begrijpen zijn.
 */
export function gezagsClaims(antwoord: string): readonly GezagsClaim[] {
  const gevonden: GezagsClaim[] = [];
  const gezien = new Set<string>();
  for (const patroon of CLAIM_PATRONEN) {
    for (const match of antwoord.matchAll(patroon.regex)) {
      if (match.index === undefined) continue;
      if (isOntkracht(antwoord, match.index)) continue;
      const sleutel = `${patroon.signaalwoord}:${match[0].toLowerCase()}`;
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      gevonden.push({ fragment: match[0], signaalwoord: patroon.signaalwoord });
    }
  }
  return gevonden;
}

/**
 * Is er, ONDER DE TOOLRESULTATEN VAN DEZE BEURT, een daadwerkelijk
 * `VALIDATED`-signaal — de enige dekking die een positieve gezagsclaim
 * rechtvaardigt? `ruleLookup`/`ruleSearch` geven dit terug als
 * `legalStatus: "VALIDATED"` (zie `src/server/agent/tools.ts`,
 * `STATUS_TEKST.VALIDATED` in `knowledge.ts`: "door NS bevestigd").
 *
 * Bewust ruim in wat het accepteert als "een toolresultaat met dit signaal
 * erin" (simpele tekstsearch op de geserialiseerde data), om niet afhankelijk
 * te zijn van het exacte veldpad van elke tool — een tool die het signaal
 * ooit anders structureert, blijft zo gedekt zonder deze functie te breken.
 */
export function isGedektDoorGegevens(toolResultaten: readonly { readonly data: unknown }[]): boolean {
  return toolResultaten.some((r) => {
    const tekst = JSON.stringify(r.data ?? null);
    return tekst.includes('"VALIDATED"') || tekst.includes("door NS bevestigd");
  });
}

/** Claims die niet gedekt zijn door de gegevens van deze beurt. */
export function ongedekteGezagsClaims(antwoord: string, toolResultaten: readonly { readonly data: unknown }[]): readonly GezagsClaim[] {
  if (isGedektDoorGegevens(toolResultaten)) return [];
  return gezagsClaims(antwoord);
}
