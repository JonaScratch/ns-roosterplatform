/**
 * De landelijke standplaatsen.
 *
 * ## Registratie is niet hetzelfde als inrichting
 *
 * Alle standplaatsen staan hier, want een systeem dat Utrecht niet kent, kan
 * ook niet uitleggen waarom er voor Utrecht niets is. Ingericht is er precies
 * één: Dordrecht. De rest is bekend, leeg en zichtbaar leeg — geen fictieve
 * diensten, geen gekopieerde Dordrechtroosters.
 *
 * ## Waarom de regio meestal onbekend is
 *
 * De aangeleverde bron noemt standplaatsen, geen regio-indeling. Alleen voor
 * Dordrecht en Rotterdam blijkt uit de Roosterkaders Regio West dat zij onder
 * die regio vallen. Voor de overige negenendertig is de regio niet vastgesteld,
 * en dat staat er dan ook — een geraden indeling is binnen een maand een
 * gegeven waar niemand meer aan twijfelt.
 */

export interface RegionSeed {
  readonly code: string;
  readonly name: string;
  readonly note?: string;
}

export const REGIONS: readonly RegionSeed[] = [
  {
    code: "WEST",
    name: "Regio West",
    note: "Vastgesteld uit de Roosterkaders Regio West 2026.",
  },
  {
    code: "ONBEPAALD",
    name: "Regio niet vastgesteld",
    note:
      "De aangeleverde standplaatslijst bevat geen regio-indeling. Deze " +
      "standplaatsen wachten op een bron die dat wel vaststelt.",
  },
];

export interface StationSeed {
  readonly code: string;
  readonly name: string;
  readonly region: string;
}

/** De standplaatsen zoals aangeleverd, in alfabetische volgorde van naam. */
export const STATIONS: readonly StationSeed[] = [
  { code: "AMR", name: "Alkmaar", region: "ONBEPAALD" },
  { code: "ALM", name: "Almere", region: "ONBEPAALD" },
  { code: "AMF", name: "Amersfoort", region: "ONBEPAALD" },
  { code: "ASD", name: "Amsterdam", region: "ONBEPAALD" },
  { code: "ASA", name: "Amsterdam Amstel", region: "ONBEPAALD" },
  { code: "ASB", name: "Amsterdam Bijlmer-ArenA", region: "ONBEPAALD" },
  { code: "ASS", name: "Amsterdam Sloterdijk", region: "ONBEPAALD" },
  { code: "ASDZ", name: "Amsterdam Zuid", region: "ONBEPAALD" },
  { code: "AH", name: "Arnhem", region: "ONBEPAALD" },
  { code: "BD", name: "Breda", region: "ONBEPAALD" },
  { code: "DT", name: "Delft", region: "ONBEPAALD" },
  { code: "HT", name: "Den Bosch", region: "ONBEPAALD" },
  { code: "GVC", name: "Den Haag", region: "ONBEPAALD" },
  { code: "GV", name: "Den Haag Holland Spoor", region: "ONBEPAALD" },
  { code: "HDR", name: "Den Helder", region: "ONBEPAALD" },
  { code: "DV", name: "Deventer", region: "ONBEPAALD" },
  { code: "DDR", name: "Dordrecht", region: "WEST" },
  { code: "EHV", name: "Eindhoven", region: "ONBEPAALD" },
  { code: "EKZ", name: "Enkhuizen", region: "ONBEPAALD" },
  { code: "ES", name: "Enschede", region: "ONBEPAALD" },
  { code: "GD", name: "Gouda", region: "ONBEPAALD" },
  { code: "GN", name: "Groningen", region: "ONBEPAALD" },
  { code: "HLM", name: "Haarlem", region: "ONBEPAALD" },
  { code: "HRL", name: "Heerlen", region: "ONBEPAALD" },
  { code: "HGL", name: "Hengelo", region: "ONBEPAALD" },
  { code: "HFDO", name: "Hoofddorp Opstel", region: "ONBEPAALD" },
  { code: "HN", name: "Hoorn", region: "ONBEPAALD" },
  { code: "LW", name: "Leeuwarden", region: "ONBEPAALD" },
  { code: "LEDN", name: "Leiden", region: "ONBEPAALD" },
  { code: "LLS", name: "Lelystad", region: "ONBEPAALD" },
  { code: "MT", name: "Maastricht", region: "ONBEPAALD" },
  { code: "NM", name: "Nijmegen", region: "ONBEPAALD" },
  { code: "RSD", name: "Roosendaal", region: "ONBEPAALD" },
  { code: "RTD", name: "Rotterdam", region: "WEST" },
  { code: "SHL", name: "Schiphol", region: "ONBEPAALD" },
  { code: "UT", name: "Utrecht", region: "ONBEPAALD" },
  { code: "VL", name: "Venlo", region: "ONBEPAALD" },
  { code: "VS", name: "Vlissingen", region: "ONBEPAALD" },
  { code: "ZD", name: "Zaandam", region: "ONBEPAALD" },
  { code: "ZP", name: "Zutphen", region: "ONBEPAALD" },
  { code: "ZL", name: "Zwolle", region: "ONBEPAALD" },
];

export interface PlanningUnitSeed {
  readonly code: string;
  readonly name: string;
  /** De hoofdstandplaats waaronder deze eenheid valt. */
  readonly parent: string;
}

/**
 * De plannings- of locatie-eenheden onder een hoofdstandplaats.
 *
 * De bron noemt naast de standplaatsen ook "ASD 1", "UT 2" en dergelijke.
 * Zelfstandige standplaatsen zijn het niet: ze delen hun code met een
 * hoofdstandplaats. Wat ze organisatorisch wél zijn — een tweede planbureau,
 * een deel van het personeelsbestand, een opstelterrein — blijkt niet uit de
 * bron, en wordt hier niet ingevuld.
 */
export const PLANNING_UNITS: readonly PlanningUnitSeed[] = [
  { code: "ASD 1", name: "Amsterdam, eenheid 1", parent: "ASD" },
  { code: "ASD 2", name: "Amsterdam, eenheid 2", parent: "ASD" },
  { code: "RTD 1", name: "Rotterdam, eenheid 1", parent: "RTD" },
  { code: "RTD 2", name: "Rotterdam, eenheid 2", parent: "RTD" },
  { code: "UT 1", name: "Utrecht, eenheid 1", parent: "UT" },
  { code: "UT 2", name: "Utrecht, eenheid 2", parent: "UT" },
];

export const PLANNING_UNIT_NOTE =
  "De bron noemt deze code naast de hoofdstandplaats zonder te zeggen wat het " +
  "onderscheid is. Tot dat is vastgesteld is dit een eenheid onder de " +
  "hoofdstandplaats en geen zelfstandige standplaats.";

/** De enige standplaats die op dit moment functioneel is ingericht. */
/**
 * De mailadressen van de dienstindeling, per standplaats.
 *
 * Alleen wat is aangeleverd. Er wordt geen adres afgeleid uit een
 * standplaatscode en er is geen algemeen adres als terugval: een medewerker die
 * bij de verkeerde dienstindeling aanklopt, merkt dat pas als het misgaat.
 */
export const DID_CONTACTS: Readonly<Record<string, string>> = {
  DDR: "nsr.ddr-did-mcn@ns.nl",
};

export const CONFIGURED_LOCATION = "DDR";

/** De boodschap voor een standplaats die wel bestaat maar niet is ingericht. */
export const NOT_CONFIGURED_MESSAGE =
  "Deze standplaats is geregistreerd maar nog niet ingericht.";
