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
 * ## Aangesloten op agent.ts (na de bevroren BEFORE-meting)
 *
 * Precies zoals grounding.ts's eigen commentaar zegt over valse alarmen: een
 * te gretige claim-verificatie die goede antwoorden blokkeert, wordt
 * uitgezet en helpt dan niemand meer. Deze functie is daarom eerst gebouwd en
 * volledig los getest (`tests/agent/claim-verification.test.ts`) en pas
 * daarna aangesloten — bewust NIET vóór de bevroren BEFORE-meting bestond
 * (§33/§34 van de opdracht: een nieuwe grendel die antwoorden kan blokkeren
 * of wijzigen is een inhoudelijke gedragswijziging, en die mocht niet vóór
 * de BEFORE-meting plaatsvinden — anders had de BEFORE-run al het AFTER-
 * gedrag gemeten). Die freeze is bevestigd (run `20260927-205217`, zie
 * `docs/lyra-knowledge/progress.md`), dus dit is nu precies het beloofde
 * AFTER-gedrag: `agent.ts` roept `ongedekteGezagsClaims()` aan na
 * `model.compose()`, in dezelfde poort als grounding.ts (identiek voor
 * `stubModel` en `localModel`), en vervangt het antwoord door
 * `claimVerificatieMelding()` + status `NIET_VAST_TE_STELLEN` als er een
 * ongedekte claim overblijft — nooit stilzwijgend, altijd met de
 * oorspronkelijke tekst nog in het activiteitenlog.
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

/** Het deel van een toolresultaat dat de dekkingscontrole nodig heeft. */
export interface ClaimToolResultaat {
  readonly data: unknown;
  /** Toolnaam; ontbreekt in oudere aanroepen en tests — dan beslist de data. */
  readonly tool?: string;
  readonly ok?: boolean;
}

/**
 * Is er, ONDER DE TOOLRESULTATEN VAN DEZE BEURT, een daadwerkelijk
 * `VALIDATED`-signaal — de enige dekking die een positieve gezagsclaim over
 * een REGEL rechtvaardigt? `ruleLookup`/`ruleSearch` geven dit terug als
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

/**
 * ## Waarom "bevestigd" niet altijd een gezagsclaim is (AFTER-run 20260929-151948)
 *
 * De eerste versie behandelde elk niet-ontkracht "bevestigd" als claim over
 * een regel. Teruggespeeld over alle bewaarde ruwe antwoorden
 * (`docs/v1.0.6/benchmarks/{n0,n0b,n1}/golden.json`) viel hij 45 keer, en
 * vrijwel steeds op dezelfde zin onder een roostertelling: "De bron is
 * officieel en bevestigd." of "(bron: official, bevestigd)". De oorzaak zat
 * in de instructie aan het lokale model ("Noem bij een regel altijd de bron
 * en of die bevestigd is"): in het Nederlands is "regel" óók een roosterregel,
 * dus het model zette die herkomstzin onder elk antwoord over roostergegevens.
 * De grendel hield daarmee juist correcte premiecorrecties tegen
 * (B-…-omgekeerd), terwijl er over geen enkele regel iets beweerd werd.
 *
 * Wat een claim tot GEZAGSCLAIM maakt, is waar hij over gaat. Daarom telt nu
 * de context, per claim:
 *
 * - `REGELSTATUS` — de beurt raadpleegde regelkennis (ruleLookup, ruleSearch,
 *   knowledgeSearch, of data met een `legalStatus`), óf de zin zelf gebruikt
 *   normatieve taal (CAO, wet, rusttijd, verplicht, mag, "voldoet aan de
 *   regels", een regel-ID), óf het signaalwoord is uit zichzelf normatief
 *   (formeel, CAO-/NS-/wettelijk verplicht, CAO-regel, NS-regel). Alleen een
 *   `VALIDATED`-signaal dekt dit — ongewijzigd streng.
 * - `MENSELIJK` — de bevestiging wordt aan een mens toegeschreven ("door de
 *   gebruiker bevestigd"). Geen NS-gezag, maar wel een feitelijke bewering
 *   over herkomst: gedekt alleen als de gegevens die menselijke herkomst ook
 *   echt dragen.
 * - `HERKOMST` — een herkomstaanduiding bij roostergegevens, zonder enige
 *   normatieve inhoud. Gedekt zodra de beurt daadwerkelijk roostergegevens
 *   ophaalde; zonder gegevens blijft ook dit ongedekt.
 *
 * Geen uitzondering per vraag of per item: de indeling kijkt alleen naar de
 * zin en naar welke soort gegevens de beurt echt ophaalde.
 */
export type ClaimSoort = "REGELSTATUS" | "MENSELIJK" | "HERKOMST";

export interface GeclassificeerdeClaim extends GezagsClaim {
  readonly soort: ClaimSoort;
  /** De zin waarin de claim staat — dat is de context die de indeling bepaalde. */
  readonly zin: string;
}

/** Tools die regel- of kennisstatus teruggeven: daar is "bevestigd" altijd een statusclaim. */
const NORMATIEVE_TOOLS: ReadonlySet<string> = new Set(["ruleLookup", "ruleSearch", "knowledgeSearch"]);

/** Signaalwoorden die uit zichzelf over regels/gezag gaan, ongeacht de zin. */
const ALTIJD_NORMATIEF: ReadonlySet<string> = new Set(["formeel", "verplicht", "CAO-regel", "NS-regel"]);

const NORMATIEVE_TAAL =
  /\b(?:cao\w*|wet|wetten|wettelijk\w*|atw|arbeidstijden\w*|norm|normen|regelgeving|regelbestand|rusttijd\w*|rustregel\w*|verplicht\w*|toegestaan|verboden|voorschrift\w*|juridisch\w*|rechtsgeldig\w*|artikel\w*|mag|mogen|voldoe\w*)\b|\bart\.|regels\b/i;
/** Regel-ID's uit het regelbestand, zoals RP_DAILY_REST_PLANNED. */
const REGEL_ID = /\b[A-Z]{2,}_[A-Z0-9_]{2,}\b/;

const MENSELIJKE_TOESCHRIJVING =
  /\bdoor\s+(?:de\s+|een\s+|jou|u\b)?(?:gebruiker|planner|roosteraar|roostercommissie|machinist|collega|mens|medewerker|teamleider|dienstplanner)\w*/i;
const MENSELIJKE_HERKOMST_IN_DATA = /van een mens|"GEBRUIKER"|HUMAN_DOMAIN_INPUT|opgegeven door|door de gebruiker/i;

/**
 * De zin rond positie `index`. Een punt telt alleen als zinseinde als er
 * witruimte en een hoofdletter (of het einde) op volgt, zodat "art. 12" en
 * "bijv. de nacht" de zin — en dus de normatieve context — niet doorknippen.
 */
function zinRond(tekst: string, index: number): string {
  const grens = /[.!?](?=\s+[A-Z\u00C0-\u00DE"'(]|\s*$)|\n/g;
  let begin = 0;
  let eind = tekst.length;
  for (const m of tekst.matchAll(grens)) {
    const pos = m.index ?? 0;
    if (pos < index) begin = pos + 1;
    else {
      eind = pos + 1;
      break;
    }
  }
  return tekst.slice(begin, eind).trim();
}

function isNormatieveBeurt(toolResultaten: readonly ClaimToolResultaat[]): boolean {
  return toolResultaten.some((r) => (r.tool !== undefined && NORMATIEVE_TOOLS.has(r.tool)) || JSON.stringify(r.data ?? null).includes('"legalStatus"'));
}

function heeftOpgehaaldeGegevens(toolResultaten: readonly ClaimToolResultaat[]): boolean {
  return toolResultaten.some((r) => {
    if (r.ok === false || r.data === null || r.data === undefined) return false;
    const d = r.data as { found?: unknown };
    return d.found !== false;
  });
}

/** Deelt elke positieve claim in naar waar hij over gaat (zie het commentaar bij `ClaimSoort`). */
export function classificeerGezagsClaims(antwoord: string, toolResultaten: readonly ClaimToolResultaat[]): readonly GeclassificeerdeClaim[] {
  const normatieveBeurt = isNormatieveBeurt(toolResultaten);
  const uitkomst: GeclassificeerdeClaim[] = [];
  const gezien = new Set<string>();
  for (const patroon of CLAIM_PATRONEN) {
    for (const match of antwoord.matchAll(patroon.regex)) {
      if (match.index === undefined || isOntkracht(antwoord, match.index)) continue;
      const zin = zinRond(antwoord, match.index);
      const soort: ClaimSoort = ALTIJD_NORMATIEF.has(patroon.signaalwoord)
        ? "REGELSTATUS"
        : MENSELIJKE_TOESCHRIJVING.test(zin) && !/\bNS\b/.test(zin)
          ? "MENSELIJK"
          : normatieveBeurt || NORMATIEVE_TAAL.test(zin) || REGEL_ID.test(zin)
            ? "REGELSTATUS"
            : "HERKOMST";
      const sleutel = `${patroon.signaalwoord}:${soort}:${zin.toLowerCase()}`;
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      uitkomst.push({ fragment: match[0], signaalwoord: patroon.signaalwoord, soort, zin });
    }
  }
  return uitkomst;
}

/** Claims die niet gedekt zijn door de gegevens van deze beurt. */
export function ongedekteGezagsClaims(antwoord: string, toolResultaten: readonly ClaimToolResultaat[]): readonly GeclassificeerdeClaim[] {
  const gevalideerd = isGedektDoorGegevens(toolResultaten);
  const menselijk = toolResultaten.some((r) => MENSELIJKE_HERKOMST_IN_DATA.test(JSON.stringify(r.data ?? null)));
  const gegevens = heeftOpgehaaldeGegevens(toolResultaten);
  return classificeerGezagsClaims(antwoord, toolResultaten).filter((c) => {
    if (gevalideerd) return false;
    if (c.soort === "MENSELIJK") return !menselijk;
    if (c.soort === "HERKOMST") return !gegevens;
    return true;
  });
}

/**
 * De gebruikersmelding als het antwoord wordt tegengehouden — zelfde toon en
 * opbouw als `grondingsMelding()` in grounding.ts: eerlijk over wát er mis
 * is, welk fragment het veroorzaakte, en wat wel kan.
 */
export function claimVerificatieMelding(claims: readonly GezagsClaim[]): string {
  const signaalwoorden = [...new Set(claims.map((c) => c.signaalwoord))];
  return [
    "Ik hield mijn eigen antwoord tegen: ik gebruikte een gezagswoord " +
      `(${signaalwoorden.join(", ")}) zonder dat ik daarvoor een regel met een bevestigde status (legalStatus VALIDATED) heb geraadpleegd.`,
    "Dat een tekst ergens staat, maakt hem nog niet officieel — die stap mag ik niet zelf maken.",
    "Stel de vraag opnieuw, dan zoek ik de regel op en zeg ik erbij of NS hem daadwerkelijk heeft bevestigd of dat het (nog) een transcriptie is.",
  ].join(" ");
}
