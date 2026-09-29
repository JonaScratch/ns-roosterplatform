import "server-only";

/**
 * Het domeinwoordenboek: wat machinisten zeggen, en wat het in de gegevens is.
 *
 * ## Waarom dit een eigen bestand is en geen lijst in de chatcode
 *
 * Deze vertalingen zijn domeinkennis, geen tekstverwerking. Ze dragen een
 * herkomst: "opgegeven door de gebruiker" is iets anders dan "afgeleid uit het
 * dienstenpakket", en dat verschil hoort zichtbaar te blijven. Wie hier later
 * iets aan toevoegt, ziet meteen waar de kennis vandaan kwam.
 *
 * ## Een begrip is geen code
 *
 * RET betekent rangeerdienst. In het Dordrechtse pakket `DDR-BDU-05-10-2026-V1`
 * komt de letterlijke tekst "RET" echter in geen enkele dienstcode of
 * omschrijving voor: rangeerdiensten staan daar als de nummers 701, 702, 703,
 * 730, 731, 732, 760 en 761, met `workType = RANGEER`. De vertaling loopt
 * daarom via de dienstsoort en niet via de letters — anders zou de agent netjes
 * "niet gevonden" antwoorden op een vraag waar hij het antwoord van weet.
 */

export type BegripBron =
  /** Door de gebruiker opgegeven; niet formeel bevestigd door NS. */
  | "GEBRUIKER"
  /** Rechtstreeks af te leiden uit het dienstenpakket of het regelbestand. */
  | "GEGEVENS";

export interface Begrip {
  /** Waar mensen het over hebben; kleine letters, zoals de tekst binnenkomt. */
  readonly termen: readonly string[];
  /** Wat het in de gegevens is. */
  readonly betekenis: string;
  readonly bron: BegripBron;
  /** Wanneer en van wie, als het van een mens komt. */
  readonly herkomst: string;
  /** Waar het naar verwijst: een dienstsoort, een roosterprofiel of iets anders. */
  readonly verwijst:
    | { readonly soort: "DIENSTSOORT"; readonly kind: "RANGEER" | "NACHT" | "VROEG" | "LAAT" | "RESERVE" }
    | { readonly soort: "ROOSTERPROFIEL"; readonly profiel: string }
    | { readonly soort: "POSITIE"; readonly positionType: string }
    | { readonly soort: "UITLEG" };
}

export const VAKWOORDEN: readonly Begrip[] = [
  {
    termen: ["ret", "ret-dienst", "ret-diensten", "rettdienst"],
    betekenis:
      "rangeerdienst. In het Dordrechtse pakket zijn dat de dienstnummers 701, 702, 703, 730, 731, 732, 760 en 761; " +
      "de letters RET komen in geen enkele dienstcode voor.",
    bron: "GEBRUIKER",
    herkomst: "opgegeven door Jonathan, 21 september 2026",
    verwijst: { soort: "DIENSTSOORT", kind: "RANGEER" },
  },
  {
    termen: ["rangeer", "rangeerdienst", "rangeerdiensten", "rangeren"],
    betekenis: "diensten met werksoort RANGEER: rangeren op het emplacement in plaats van rijden met reizigers.",
    bron: "GEGEVENS",
    herkomst: "workType RANGEER in het dienstenpakket",
    verwijst: { soort: "DIENSTSOORT", kind: "RANGEER" },
  },
  {
    termen: ["la", "laat-rooster", "het late", "laatrooster"],
    betekenis: "het basisrooster met profiel LAAT (DDR-L).",
    bron: "GEBRUIKER",
    herkomst: "gangbare afkorting; komt overeen met profiel LAAT in de gegevens",
    verwijst: { soort: "ROOSTERPROFIEL", profiel: "LAAT" },
  },
  {
    termen: ["vl", "vroeg/laat", "vroeg-laat"],
    betekenis: "het basisrooster met profiel VROEG_LAAT (DDR-VL).",
    bron: "GEGEVENS",
    herkomst: "profielnaam in het dienstenpakket",
    verwijst: { soort: "ROOSTERPROFIEL", profiel: "VROEG_LAAT" },
  },
  {
    termen: ["ln", "laat/nacht", "laat-nacht"],
    betekenis: "het basisrooster met profiel LAAT_NACHT (DDR-LN).",
    bron: "GEGEVENS",
    herkomst: "profielnaam in het dienstenpakket",
    verwijst: { soort: "ROOSTERPROFIEL", profiel: "LAAT_NACHT" },
  },
  {
    termen: ["blm"],
    betekenis: "het basisrooster met profiel BLM (DDR-BLM).",
    bron: "GEGEVENS",
    herkomst: "profielnaam in het dienstenpakket",
    verwijst: { soort: "ROOSTERPROFIEL", profiel: "BLM" },
  },
  {
    termen: ["afloper", "aflopers"],
    betekenis: "een late dienst die ver na middernacht eindigt; in de meting de klasse PREMIUM_LATE.",
    bron: "GEGEVENS",
    herkomst: "dienstklassen in src/domain/duty-class.ts",
    verwijst: { soort: "UITLEG" },
  },
  {
    termen: ["wtv", "wr"],
    betekenis: "de WTV-dag. In dit datamodel draagt positietype WR die dag.",
    bron: "GEGEVENS",
    herkomst: "roster-structure.ts: het anker bestaat, alleen de naam is dubbel bezet",
    verwijst: { soort: "POSITIE", positionType: "WR" },
  },
  {
    termen: ["res", "reservedag", "reserve"],
    betekenis: "een reservedag: beschikbaar zonder vaste dienst.",
    bron: "GEGEVENS",
    herkomst: "positietype RES",
    verwijst: { soort: "POSITIE", positionType: "RES" },
  },
];

/** Het begrip dat bij deze tekst hoort, of niets. Hele woorden, geen deelmatch. */
export function begripIn(tekst: string): Begrip | null {
  const laag = tekst.toLowerCase();
  for (const begrip of VAKWOORDEN) {
    for (const term of begrip.termen) {
      if (new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(laag)) {
        return begrip;
      }
    }
  }
  return null;
}

/** Alle begrippen die in deze tekst voorkomen. */
export function begrippenIn(tekst: string): readonly Begrip[] {
  const laag = tekst.toLowerCase();
  return VAKWOORDEN.filter((begrip) =>
    begrip.termen.some((term) => {
      const patroon = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-z0-9]|$)`, "g");
      for (const m of laag.matchAll(patroon)) {
        const start = (m.index ?? 0) + m[1].length;
        if (!binnenLangereDagdeelcombinatie(laag, start, start + term.length, term)) return true;
      }
      return false;
    }),
  );
}

const DAGDELEN = /^(vroeg|laat|nacht)$/;
const dagdelenIn = (woord: string) => woord.split(/[-/]/).filter((d) => DAGDELEN.test(d)).length;

/**
 * Staat de term midden in een langere combinatie van dagdelen?
 *
 * "vroeg-laat" is het Vroeg/Laat-rooster, maar in "vroeg-laat-nacht" is het
 * een stuk van iets anders — de koppeltekens maakten van een langere
 * samenstelling twee losse treffers (Vroeg/Laat én Laat/Nacht), en het model
 * kreeg dan twee roosters voorgelegd waar niemand naar vroeg (AFTER-run
 * 20260929-234655). Een achtervoegsel dat geen dagdeel is ("laat/nacht-rooster")
 * maakt de term niet langer: dat blijft een treffer.
 */
function binnenLangereDagdeelcombinatie(tekst: string, start: number, eind: number, term: string): boolean {
  let links = start;
  while (links > 0 && /[a-z0-9/-]/.test(tekst[links - 1])) links -= 1;
  let rechts = eind;
  while (rechts < tekst.length && /[a-z0-9/-]/.test(tekst[rechts])) rechts += 1;
  return dagdelenIn(tekst.slice(links, rechts)) > dagdelenIn(term);
}
