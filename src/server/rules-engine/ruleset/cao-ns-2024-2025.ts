import { RULE } from "./rule-ids";
import type { RuleDefinition, RuleScope, RuleSource } from "./types";

/**
 * De regels uit de CAO NS 2024–2025, zoals aangeleverd.
 *
 * ## Wat deze status betekent
 *
 * Elke regel hier heeft status `SOURCE_TRANSCRIBED`: overgenomen uit de
 * aangeleverde bron, nog **niet** formeel bevestigd als actueel. De CAO heet
 * 2024–2025; voor planning in 2026 mag niet worden aangenomen dat elke bepaling
 * ongewijzigd geldt. Zolang NS dat niet bevestigt, staat het hele regelbestand
 * op `LEGAL_RULESET_NOT_CURRENTLY_VERIFIED` en is de modus simulatie.
 *
 * ## Waarom hier geen enkele waarde is "afgerond" of "ingevuld"
 *
 * Waar de bron een waarde geeft, staat die waarde. Waar de bron een waarde
 * standplaatsafhankelijk of onbepaald laat, staat `value: null` met een status
 * die dat benoemt. Er is nergens een aannemelijk getal ingevuld om de code te
 * laten draaien: dat is precies de fout die dit hele bestand moet voorkomen.
 *
 * ## Reikwijdte
 *
 * De toepassing is gebouwd voor NS Reizigers, machinisten, standplaats
 * Dordrecht. Uitzonderingen voor NedTrain of andere functiegroepen staan
 * bewust niet in dit bestand: een uitzondering die toevallig in hetzelfde
 * document staat, geldt niet automatisch voor een andere groep.
 */

/**
 * De looptijd volgens artikel 3 van de bron zelf.
 *
 * De oorspronkelijke looptijd is 1 januari 2024 tot 1 maart 2025. Behoudens
 * opzegging wordt de overeenkomst telkens met één jaar verlengd, en eindigt zij
 * door opzegging, dan blijven de bepalingen gelden totdat een nieuwe
 * overeenkomst in werking treedt.
 *
 * Hier stond eerder `effectiveUntil: "2025-12-31"`. Dat getal komt in de bron
 * niet voor: het was afgeleid uit de naam "CAO 2024–2025". Daarmee stond er een
 * juridisch oordeel in de code dat niemand had genomen — en het viel bovendien
 * negen maanden náást de werkelijke contractuele einddatum.
 */
const CAO: RuleSource = {
  layer: "CAO",
  document: "CAO-NS-2024-2025",
  documentTitle: "CAO NS 2024–2025",
  legalAuthority: "CAO",
  effectiveFrom: "2024-01-01",
  contractualEnd: "2025-02-28",
  renewalRule: { kind: "TACIT_RENEWAL", termMonths: 12, survivesUntilSuccessor: true },
  // Onze bron bevat geen opzegging. Dat is iets anders dan weten dat er niet is
  // opgezegd: wij zien alleen dit document.
  terminationKnown: "UNKNOWN",
  supersededBy: null,
};

function cao(article: string, topic?: string): RuleSource {
  return { ...CAO, article, paragraph: topic };
}

/** Rijdend personeel bij NS Reizigers. Machinisten vallen hieronder. */
const RIJDEND_PERSONEEL: RuleScope = {
  employeeGroups: ["MACHINIST", "HOOFDCONDUCTEUR"],
  companies: ["NSR"],
  locations: "ALL",
};

/** Alles waar de CAO geen functiegroep bij noemt. */
const ALGEMEEN: RuleScope = { employeeGroups: "ALL", companies: "ALL", locations: "ALL" };

const TRANSCRIBED = {
  status: "SOURCE_TRANSCRIBED",
  validatedBy: null,
  validatedAt: null,
} as const;

export const CAO_RULES: readonly RuleDefinition[] = [
  // ── Dagelijkse arbeidstijd ─────────────────────────────────────────────────
  {
    id: RULE.RP_MAX_WORK_PER_DUTY,
    title: "Maximale arbeidstijd per dienst",
    category: "HARD_CONSTRAINT",
    rationale:
      "De CAO begrenst de arbeidstijd binnen één dienst, exclusief overwerk. " +
      "Arbeidstijd is niet hetzelfde als dienstlengte: pauze telt niet mee.",
    source: cao("98", "Dagelijkse arbeids- en rusttijd"),
    scope: ALGEMEEN,
    value: 9,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_MAX_WORK_INCL_OVERTIME,
    title: "Maximale arbeidstijd per dienst inclusief overwerk",
    category: "HARD_CONSTRAINT",
    rationale: "Bovengrens inclusief overwerk volgens de tabel in de bron.",
    source: cao("98", "Dagelijkse arbeids- en rusttijd"),
    scope: ALGEMEEN,
    value: 12,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_MAX_WORK_START_0500_0600,
    title: "Maximale arbeidstijd bij start tussen 05:00 en 06:00",
    category: "HARD_CONSTRAINT",
    rationale:
      "Voor rijdend personeel geldt bij een start na 05:00 en vóór 06:00 een " +
      "lagere bovengrens voor de arbeidstijd, exclusief overwerk.",
    source: cao("98", "Dagelijkse arbeids- en rusttijd, rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 8,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_STATION_BREAK_ADJUSTMENT,
    title: "Standplaatsafhankelijke verlaging bij werkonderbreking > 30 minuten",
    category: "HARD_CONSTRAINT",
    rationale:
      "Wanneer de werkonderbreking bij rijdend personeel langer dan een half uur " +
      "is, ligt de maximale arbeidstijd volgens de bron standplaatsafhankelijk " +
      "2 tot 10 minuten lager. De waarde voor Dordrecht is niet aangeleverd.",
    source: cao("98", "Dagelijkse arbeids- en rusttijd, rijdend personeel"),
    scope: { employeeGroups: ["MACHINIST"], companies: ["NSR"], locations: "ALL" },
    value: null,
    unit: "MINUTES",
    contextWindows: [],
    status: "UNVALIDATED_LOCAL_PARAMETER",
    validatedBy: null,
    validatedAt: null,
    note:
      "Bereik volgens bron: 2–10 minuten, per standplaats vastgesteld. Zolang de " +
      "waarde voor deze standplaats ontbreekt, kan een dienst met een " +
      "werkonderbreking langer dan 30 minuten niet veilig worden beoordeeld.",
  },
  {
    id: RULE.MIN_WORK_PER_DUTY,
    title: "Minimale arbeidstijd per dienst",
    category: "HARD_CONSTRAINT",
    rationale: "Een dienst moet ten minste deze arbeidstijd omvatten.",
    source: cao("98", "Dagelijkse arbeids- en rusttijd"),
    scope: ALGEMEEN,
    value: 4,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },

  // ── Dienstlengte ──────────────────────────────────────────────────────────
  {
    id: RULE.RP_MAX_DUTY_DURATION,
    title: "Maximale dienstlengte rijdend personeel",
    category: "HARD_CONSTRAINT",
    rationale:
      "De dienstlengte is arbeidstijd plus pauze en wordt apart begrensd van de " +
      "arbeidstijd. Een controle die alleen naar arbeidstijd kijkt, mist dit.",
    source: cao("98", "Dienstlengte rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 9.5,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_MAX_DUTY_START_0400_0501,
    title: "Maximale dienstlengte bij start tussen 04:00 en 05:01",
    category: "HARD_CONSTRAINT",
    rationale: "Zeer vroege start; de bron begrenst de dienstlengte extra.",
    source: cao("98", "Dienstlengte rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 7,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
    note:
      "Openstaande vraag over de bron: deze band en de band 05:00–06:00 overlappen " +
      "op 05:00. Een dienst die om precies 05:00 begint valt onder beide, en dan " +
      "geldt de strengste (7 uur). In het aangeleverde rooster start een groot " +
      "deel van de vroege diensten om 05:00, waardoor deze regel daar telkens " +
      "afgaat. NS moet vaststellen welke band bij 05:00 hoort; er wordt hier geen " +
      "grens verschoven om het rooster passend te maken.",
  },
  {
    id: RULE.RP_MAX_DUTY_START_0500_0600,
    title: "Maximale dienstlengte bij start tussen 05:00 en 06:00",
    category: "HARD_CONSTRAINT",
    rationale: "Vroege start; de bron begrenst de dienstlengte extra.",
    source: cao("98", "Dienstlengte rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 8.5,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
    note:
      "Openstaande vraag over de bron: deze band en de band 05:00–06:00 overlappen " +
      "op 05:00. Een dienst die om precies 05:00 begint valt onder beide, en dan " +
      "geldt de strengste (7 uur). In het aangeleverde rooster start een groot " +
      "deel van de vroege diensten om 05:00, waardoor deze regel daar telkens " +
      "afgaat. NS moet vaststellen welke band bij 05:00 hoort; er wordt hier geen " +
      "grens verschoven om het rooster passend te maken.",
  },
  {
    id: RULE.RP_MIN_DUTY_DURATION,
    title: "Minimale dienstlengte rijdend personeel",
    category: "HARD_CONSTRAINT",
    rationale: "Een geplande dienst voor rijdend personeel duurt ten minste zo lang.",
    source: cao("98", "Dienstlengte rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 6,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },

  // ── Dagelijkse rust ───────────────────────────────────────────────────────
  {
    id: RULE.RP_DAILY_REST_PLANNED,
    title: "Dagelijkse onafgebroken rust (gepland)",
    category: "HARD_CONSTRAINT",
    rationale:
      "De normale dagelijkse onafgebroken rust voor rijdend personeel. In een " +
      "basisrooster is dit de norm waarmee gepland moet worden; de verkorte " +
      "variant mag volgens de bron niet planmatig worden gebruikt.",
    source: cao("98", "Dagelijkse rust"),
    scope: RIJDEND_PERSONEEL,
    value: 12,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.DAILY_REST_REDUCED_NON_PLANNED,
    title: "Verkorte dagelijkse rust, niet planmatig",
    category: "HARD_CONSTRAINT",
    rationale:
      "Eens per 7×24 uur kan de dagelijkse rust worden verkort tot deze waarde, " +
      "maar uitdrukkelijk niet planmatig. De optimizer mag hier nooit naartoe " +
      "optimaliseren; alleen een formeel geautoriseerde operationele uitzondering " +
      "kan er beroep op doen.",
    source: cao("98", "Dagelijkse rust, verkorting"),
    scope: RIJDEND_PERSONEEL,
    value: 8,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES", "DAYS_7"],
    ...TRANSCRIBED,
  },

  // ── Pauze en werkonderbreking ─────────────────────────────────────────────
  {
    id: RULE.BREAK_OVER_5H30,
    title: "Pauze bij meer dan 5,5 uur arbeidstijd",
    category: "HARD_CONSTRAINT",
    rationale: "Algemene pauzenorm uit de tabel in de bron.",
    source: cao("98", "Pauze"),
    scope: ALGEMEEN,
    value: 30,
    unit: "MINUTES",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.BREAK_OVER_10H,
    title: "Pauze bij meer dan 10 uur arbeidstijd",
    category: "HARD_CONSTRAINT",
    rationale: "Algemene pauzenorm uit de tabel in de bron.",
    source: cao("98", "Pauze"),
    scope: ALGEMEEN,
    value: 45,
    unit: "MINUTES",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_LOCATION_WORK_INTERRUPTION,
    title: "Standplaatsafhankelijke werkonderbreking rijdend personeel",
    category: "HARD_CONSTRAINT",
    rationale:
      "Voor rijdend personeel geldt geen gegarandeerde pauze zoals de algemene " +
      "norm, maar een standplaatsafhankelijk geplande werkonderbreking van " +
      "32 tot 40 minuten. Die is qua ligging en duur niet gegarandeerd, is geen " +
      "arbeidstijd en wordt wel doorbetaald. De waarde wordt periodiek herijkt.",
    source: cao("98", "Werkonderbreking rijdend personeel"),
    scope: { employeeGroups: ["MACHINIST"], companies: ["NSR"], locations: "ALL" },
    value: null,
    unit: "MINUTES",
    contextWindows: [],
    status: "UNVALIDATED_LOCAL_PARAMETER",
    validatedBy: null,
    validatedAt: null,
    note:
      "Bereik volgens bron: 32–40 minuten. De actuele waarde voor deze standplaats " +
      "is niet aangeleverd en wordt niet geraden.",
  },

  // ── Wekelijkse arbeidstijd ────────────────────────────────────────────────
  {
    id: RULE.MAX_WEEKLY_HOURS,
    title: "Maximale arbeidstijd per week",
    category: "HARD_CONSTRAINT",
    rationale: "Absolute bovengrens per week.",
    source: cao("99", "Wekelijkse arbeidstijd"),
    scope: ALGEMEEN,
    value: 60,
    unit: "HOURS",
    contextWindows: ["DAYS_7"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.AVG_WEEKLY_HOURS_4W,
    title: "Gemiddelde arbeidstijd over 4 weken",
    category: "HARD_CONSTRAINT",
    rationale: "Voortschrijdend gemiddelde over vier weken.",
    source: cao("99", "Wekelijkse arbeidstijd"),
    scope: ALGEMEEN,
    value: 55,
    unit: "HOURS",
    contextWindows: ["WEEKS_4"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.AVG_WEEKLY_HOURS_16W,
    title: "Gemiddelde arbeidstijd over 16 weken",
    category: "HARD_CONSTRAINT",
    rationale: "Voortschrijdend gemiddelde over zestien weken.",
    source: cao("99", "Wekelijkse arbeidstijd"),
    scope: ALGEMEEN,
    value: 48,
    unit: "HOURS",
    contextWindows: ["WEEKS_16"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.AVG_WEEKLY_HOURS_16W_MANY_NIGHTS,
    title: "Gemiddelde arbeidstijd over 16 weken bij veel nachtdiensten",
    category: "HARD_CONSTRAINT",
    rationale:
      "Bij zestien of meer nachtdiensten in het venster geldt een lager " +
      "gemiddelde dan de algemene 48-uursnorm. Beide worden getoetst.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 40,
    unit: "HOURS",
    contextWindows: ["WEEKS_16"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.MANY_NIGHTS_THRESHOLD,
    title: "Drempel 'veel nachtdiensten'",
    category: "HARD_CONSTRAINT",
    rationale: "Aantal nachtdiensten waarboven het lagere weekgemiddelde geldt.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 16,
    unit: "COUNT",
    contextWindows: ["WEEKS_16"],
    ...TRANSCRIBED,
  },

  // ── Wekelijkse rust ───────────────────────────────────────────────────────
  {
    id: RULE.WEEKLY_REST_36H_PER_7D,
    title: "Wekelijkse onafgebroken rust per 7×24 uur",
    category: "HARD_CONSTRAINT",
    rationale:
      "Eén van beide varianten moet gehaald worden: 36 uur per 7×24 uur, of " +
      "72 uur per 14×24 uur. De engine toetst of ten minste één variant klopt.",
    source: cao("100", "Wekelijkse rust"),
    scope: ALGEMEEN,
    value: 36,
    unit: "HOURS",
    contextWindows: ["DAYS_7", "DAYS_14"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.WEEKLY_REST_72H_PER_14D,
    title: "Wekelijkse onafgebroken rust per 14×24 uur",
    category: "HARD_CONSTRAINT",
    rationale: "Alternatieve variant, mag gesplitst worden in perioden van minimaal 32 uur.",
    source: cao("100", "Wekelijkse rust"),
    scope: ALGEMEEN,
    value: 72,
    unit: "HOURS",
    contextWindows: ["DAYS_14"],
    ...TRANSCRIBED,
    // De inhoud is teruggevonden in de aangeleverde CAO: op bladzijde 31 staat
    // letterlijk de variant "72 uur in een periode van 14 x 24 uur", met de
    // splitsing in perioden van minimaal 32 uur en de verkorting op initiatief
    // van de roostercommissie, eens per vijf weken.
    //
    // Het artikelnummer is niet te bevestigen. De CAO nummert deze bepalingen
    // als "Lid" binnen een tabel, en die nummers zijn niet één-op-één te
    // herleiden tot artikelnummers: bij het uitlezen leveren 100 en 101
    // dezelfde tekst op. Het nummer wordt daarom niet gecorrigeerd — dat zou
    // een gok zijn — maar als te controleren gemarkeerd.
    note:
      "SOURCE_REFERENCE_REVIEW_REQUIRED — de bepaling staat aantoonbaar in de aangeleverde " +
      "CAO (bladzijde 31), maar de verwijzing naar artikel 100 is niet uit de bron te " +
      "bevestigen: de tekst is opgemaakt als tabel met lidnummers. Te laten nakijken door NS.",
  },
  {
    id: RULE.WEEKLY_REST_SPLIT_MIN,
    title: "Minimale duur van een deel bij gesplitste wekelijkse rust",
    category: "HARD_CONSTRAINT",
    rationale: "Bij splitsing van de 72 uur is dit de ondergrens per deel.",
    source: cao("100", "Wekelijkse rust"),
    scope: ALGEMEEN,
    value: 32,
    unit: "HOURS",
    contextWindows: ["DAYS_14"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RC_SHORTENED_WEEKLY_REST_MIN,
    title: "Verkorte wekelijkse rust op initiatief van de roostercommissie",
    category: "HARD_CONSTRAINT",
    rationale:
      "De roostercommissie kan één van de rusten korter maken dan 36 uur, maar " +
      "minimaal 32 uur, hooguit eens per vijf weken. De commissie kan hiertoe " +
      "niet worden gedwongen; de variant staat daarom standaard uit.",
    source: cao("100", "Wekelijkse rust, roostercommissievariant"),
    scope: ALGEMEEN,
    value: 32,
    unit: "HOURS",
    contextWindows: ["WEEKS_5"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RC_SHORTENED_WEEKLY_REST_INTERVAL_WEEKS,
    title: "Interval voor verkorte wekelijkse rust",
    category: "HARD_CONSTRAINT",
    rationale: "Hooguit eens per dit aantal weken.",
    source: cao("100", "Wekelijkse rust, roostercommissievariant"),
    scope: ALGEMEEN,
    value: 5,
    unit: "COUNT",
    contextWindows: ["WEEKS_5"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.R_DAY_ATTACHED_MIN,
    title: "Rustdag aansluitend op een dienst",
    category: "HARD_CONSTRAINT",
    rationale: "Een R die aansluit op een dienst duurt minimaal zo lang, onafgebroken.",
    source: cao("100", "Rusttijden van langere duur"),
    scope: ALGEMEEN,
    value: 30,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES", "DAYS_7"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.R_DAY_DETACHED_MIN,
    title: "Rustdag niet aansluitend op een dienst",
    category: "HARD_CONSTRAINT",
    rationale: "Een losstaande R duurt minimaal zo lang, onafgebroken.",
    source: cao("100", "Rusttijden van langere duur"),
    scope: ALGEMEEN,
    value: 24,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES", "DAYS_7"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.R_DAYS_PER_WEEK_AVG,
    title: "Geplande rusttijden van langere duur per week",
    category: "HARD_CONSTRAINT",
    rationale:
      "Gemiddeld twee per week. Eén ervan mag binnen de rouleringsperiode naar " +
      "een andere week worden overgebracht; dat is een expliciete gebeurtenis en " +
      "geen stilzwijgend weglaten.",
    source: cao("100", "Rusttijden van langere duur"),
    scope: ALGEMEEN,
    value: 2,
    unit: "COUNT",
    contextWindows: ["DAYS_7"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RT_PREFERRED_WINDOW_WEEKS,
    title: "Termijn voor het verlenen van een rustdag terug",
    category: "HARD_CONSTRAINT",
    rationale:
      "Een niet genoten R wordt primair verleend in de twee weken volgend op de " +
      "week van ontstaan; anders uiterlijk in het kalenderkwartaal van ontstaan " +
      "of het daaropvolgende kwartaal.",
    source: cao("100", "Rustdag terug"),
    scope: ALGEMEEN,
    value: 2,
    unit: "COUNT",
    contextWindows: ["CALENDAR_QUARTER"],
    ...TRANSCRIBED,
  },

  // ── Reeksen ───────────────────────────────────────────────────────────────
  {
    id: RULE.MAX_CONSECUTIVE_SERVICES,
    title: "Maximaal aantal aaneengesloten diensten",
    category: "HARD_CONSTRAINT",
    rationale:
      "In de basisplanning. WTV- en RO-dagen worden voor deze bepaling niet als " +
      "dienst aangemerkt, dus de reeks wordt semantisch geteld en niet als " +
      "kalenderdagen met een roosterrecord.",
    source: cao("100", "Aaneengesloten diensten"),
    scope: ALGEMEEN,
    value: 7,
    unit: "COUNT",
    contextWindows: ["DAYS_14"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.MAX_CONSECUTIVE_IN_NIGHT_SEQUENCE,
    title: "Maximaal aantal diensten in een reeks met nachtdiensten",
    category: "HARD_CONSTRAINT",
    rationale:
      "Aparte grens naast de algemene reeksregel, voor reeksen waarin één of " +
      "meer nachtdiensten voorkomen.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 7,
    unit: "COUNT",
    contextWindows: ["DAYS_14"],
    ...TRANSCRIBED,
  },

  // ── Nachtdiensten ─────────────────────────────────────────────────────────
  {
    id: RULE.NIGHT_REST_AFTER_0200,
    title: "Rust na een nachtdienst die eindigt na 02:00",
    category: "HARD_CONSTRAINT",
    rationale:
      "Minimumrust na een nachtdienst die na 02:00 eindigt. De bron staat voor " +
      "bepaalde groepen verkorting toe, maar voor rijdend personeel uitdrukkelijk " +
      "niet planmatig; in een basisrooster geldt deze waarde daarom hard.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 14,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.NIGHT_SEQUENCE_RECOVERY,
    title: "Rust na een reeks van drie of meer nachtdiensten",
    category: "HARD_CONSTRAINT",
    rationale: "Herstelrust na een nachtreeks. Hard, en te toetsen in beide richtingen.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 46,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES", "DAYS_14"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.NIGHT_SEQUENCE_RECOVERY_THRESHOLD,
    title: "Reekslengte waarboven herstelrust geldt",
    category: "HARD_CONSTRAINT",
    rationale: "Aantal aaneengesloten nachtdiensten waarna de herstelrust van kracht wordt.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 3,
    unit: "COUNT",
    contextWindows: ["DAYS_14"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.MAX_NIGHT_SERVICES_16W,
    title: "Maximaal aantal nachtdiensten per 16 weken",
    category: "HARD_CONSTRAINT",
    rationale: "Diensten die eindigen na 02:00 uur, geteld over een voortschrijdend venster.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 36,
    unit: "COUNT",
    contextWindows: ["WEEKS_16"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.NIGHT_MAX_WORK,
    title: "Maximale arbeidstijd nachtdienst",
    category: "HARD_CONSTRAINT",
    rationale: "Algemene norm exclusief overwerk.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 8.5,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.NIGHT_MAX_WORK_INCL_OVERTIME,
    title: "Maximale arbeidstijd nachtdienst inclusief overwerk",
    category: "HARD_CONSTRAINT",
    rationale: "Algemene norm inclusief overwerk.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 10,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.NIGHT_MAX_DUTY_DURATION,
    title: "Maximale dienstlengte nachtdienst",
    category: "HARD_CONSTRAINT",
    rationale: "Algemene norm voor de dienstlengte van een nachtdienst.",
    source: cao("101", "Nachtarbeid"),
    scope: ALGEMEEN,
    value: 9,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_NIGHT_START_0400_0501_MAX_WORK,
    title: "Nachtdienst met start 04:00–05:01: maximale arbeidstijd",
    category: "HARD_CONSTRAINT",
    rationale: "Strengere grens voor rijdend personeel bij een zeer vroege nachtstart.",
    source: cao("101", "Nachtarbeid rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 6.5,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_NIGHT_START_0400_0501_MAX_DUTY,
    title: "Nachtdienst met start 04:00–05:01: maximale dienstlengte",
    category: "HARD_CONSTRAINT",
    rationale: "Strengere grens voor rijdend personeel bij een zeer vroege nachtstart.",
    source: cao("101", "Nachtarbeid rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 7,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_NIGHT_ACROSS_0230_MAX_WORK,
    title: "Dienst die start vóór 02:30 en eindigt na 02:30: maximale arbeidstijd",
    category: "HARD_CONSTRAINT",
    rationale: "Strengere grens voor rijdend personeel bij een dienst dwars door de nacht.",
    source: cao("101", "Nachtarbeid rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 8,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_NIGHT_ACROSS_0230_MAX_DUTY,
    title: "Dienst die start vóór 02:30 en eindigt na 02:30: maximale dienstlengte",
    category: "HARD_CONSTRAINT",
    rationale: "Strengere grens voor rijdend personeel bij een dienst dwars door de nacht.",
    source: cao("101", "Nachtarbeid rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 8.5,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_HARD_NIGHT_LATEST_END,
    title: "Harde nachtdienst mag niet na 07:00 eindigen",
    category: "HARD_CONSTRAINT",
    rationale:
      "Een dienst die de volledige periode 02:00–04:00 omvat, mag voor rijdend " +
      "personeel niet na 07:00 eindigen.",
    source: cao("101", "Nachtarbeid rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    // Minuten na middernacht van de dienstdag waarop de dienst uiterlijk eindigt.
    value: 7 * 60,
    unit: "MINUTES",
    contextWindows: [],
    ...TRANSCRIBED,
  },

  // ── Vroege starts en lange diensten ───────────────────────────────────────
  {
    id: RULE.RP_MAX_EARLY_STARTS_0500_0600_PER_4W,
    title: "Maximaal aantal starts tussen 05:00 en 06:00 per 4 weken",
    category: "HARD_CONSTRAINT",
    rationale:
      "Bescherming tegen te veel vroege starts. De werknemer kan afzien van deze " +
      "bescherming; dat moet uitdrukkelijk geregistreerd zijn en wordt nooit " +
      "aangenomen.",
    source: cao("98", "Vroege diensten rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 10,
    unit: "COUNT",
    contextWindows: ["WEEKS_4"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_MAX_LONG_DUTIES_PER_YEAR,
    title: "Maximaal aantal lange diensten per kalenderjaar",
    category: "HARD_CONSTRAINT",
    rationale:
      "Geplande diensten met een dienstlengte boven de drempel, geteld over het " +
      "volledige kalenderjaar — niet alleen de huidige roosterperiode.",
    source: cao("98", "Lange diensten rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 12,
    unit: "COUNT",
    contextWindows: ["CALENDAR_YEAR"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RP_LONG_DUTY_THRESHOLD,
    title: "Drempel voor een lange dienst",
    category: "HARD_CONSTRAINT",
    rationale: "Dienstlengte waarboven een dienst als lang telt.",
    source: cao("98", "Lange diensten rijdend personeel"),
    scope: RIJDEND_PERSONEEL,
    value: 9,
    unit: "HOURS",
    contextWindows: [],
    ...TRANSCRIBED,
  },

  // ── Individuele bescherming ───────────────────────────────────────────────
  {
    id: RULE.AGE55_VERY_EARLY_EXEMPTION,
    title: "Vrijstelling zeer vroege start vanaf 55 jaar",
    category: "HARD_CONSTRAINT",
    rationale:
      "Werknemer van 55 jaar of ouder heeft prioritair de mogelijkheid om op " +
      "verzoek te worden vrijgesteld van een dienst die start tussen 04:00 en " +
      "06:00, voor zover de omstandigheden dat toelaten. Of dit een harde " +
      "constraint of een prioriteitsregel is, moet NS formeel vaststellen.",
    source: cao("98", "Ontziemaatregelen"),
    scope: ALGEMEEN,
    value: null,
    unit: "NONE",
    contextWindows: [],
    status: "NEEDS_POLICY_VALIDATION",
    validatedBy: null,
    validatedAt: null,
    note:
      "De formulering 'prioritair, voor zover omstandigheden dit toelaten' laat in " +
      "het midden of een plaatsing geblokkeerd moet worden of zwaar ontmoedigd. " +
      "Tot die vaststelling wordt een geregistreerd verzoek als blokkerend " +
      "behandeld en als zodanig gemeld.",
  },
  {
    id: RULE.AGE50_HARD_NIGHT_EXEMPTION,
    title: "Vrijstelling harde nachtdienst vanaf 50 jaar",
    category: "HARD_CONSTRAINT",
    rationale:
      "Bij diensten die geheel of gedeeltelijk 02:00–04:00 omvatten, wordt een " +
      "werknemer van 50 jaar of ouder op verzoek vrijgesteld. De engine krijgt " +
      "uitsluitend de abstracte constraint, nooit de leeftijd of de reden.",
    source: cao("101", "Ontziemaatregelen nachtarbeid"),
    scope: RIJDEND_PERSONEEL,
    value: 1,
    unit: "NONE",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.INDIVIDUAL_SCHEDULING_RESTRICTION,
    title: "Individuele arbeidstijdbeperking",
    category: "HARD_CONSTRAINT",
    rationale:
      "Een beschermde individuele beperking, bijvoorbeeld geen dienst vóór 07:00 " +
      "of na 21:00, geen overwerk, of een lager maximum aan aaneengesloten " +
      "diensten. De reden achter de beperking bereikt de engine nooit.",
    source: cao("98", "Bijzondere arbeidstijdbeperking"),
    scope: ALGEMEEN,
    value: 1,
    unit: "NONE",
    contextWindows: ["DAYS_14"],
    ...TRANSCRIBED,
  },

  // ── Weekenden en zondagen ─────────────────────────────────────────────────
  {
    id: RULE.RED_WEEKEND_MIN_REST,
    title: "Driewekelijks vrij weekend (rood weekend)",
    category: "HARD_CONSTRAINT",
    rationale:
      "Eenmaal per drie weken een aaneengesloten rustperiode van minimaal 60 uur " +
      "die de periode zaterdag 00:00 tot en met maandag 04:00 omvat. Twee eisen " +
      "dus: de lengte én het venster. Hiervan kan collectief met instemming van de " +
      "ondernemingsraad of individueel vrijwillig worden afgeweken, en Bijlage IV " +
      "kent eigen rood-weekendsituaties.",
    source: cao("102", "Lid 3, rood weekend"),
    scope: ALGEMEEN,
    value: 60,
    unit: "HOURS",
    contextWindows: ["DAYS_14", "WEEKS_4"],
    ...TRANSCRIBED,
    note:
      "Er is geen bron aangesloten voor collectieve OR-afwijkingen, voor de " +
      "rood-weekendsituaties uit Bijlage IV of voor individuele vrijwillige " +
      "afwijkingen. Een berekende overschrijding van deze regel kan daarom niet " +
      "als bewezen overtreding worden gepresenteerd: de toepasselijkheid staat " +
      "niet vast. Een vergoeding of RT maakt een ongeldige planning overigens " +
      "niet geldig; alleen een toegestane afwijking raakt de toepasselijkheid.",
  },
  {
    id: RULE.RED_WEEKEND_INTERVAL_WEEKS,
    title: "Interval van het vrije weekend",
    category: "HARD_CONSTRAINT",
    rationale: "Eenmaal per dit aantal weken.",
    source: cao("102", "Lid 3, rood weekend"),
    scope: ALGEMEEN,
    value: 3,
    unit: "COUNT",
    contextWindows: ["WEEKS_4"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.MIN_FREE_SUNDAYS_52W,
    title: "Minimaal aantal vrije zondagen per 52 weken",
    category: "HARD_CONSTRAINT",
    rationale:
      "Voortschrijdend venster van 52 weken. Zondagarbeid kan inherent zijn aan " +
      "het spoorproces, maar deze norm blijft gelden.",
    source: cao("100", "Zondagsarbeid"),
    scope: ALGEMEEN,
    value: 13,
    unit: "COUNT",
    contextWindows: ["WEEKS_52"],
    ...TRANSCRIBED,
  },

  // ── Vrije dagen ───────────────────────────────────────────────────────────
  {
    id: RULE.HOLIDAY_ATTACHED_MIN,
    title: "Vrije feestdag aansluitend op een dienst",
    category: "HARD_CONSTRAINT",
    rationale: "Minimale onafgebroken duur.",
    source: cao("104", "Feestdagen"),
    scope: ALGEMEEN,
    value: 30,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.HOLIDAY_DETACHED_MIN,
    title: "Vrije feestdag niet aansluitend op een dienst",
    category: "HARD_CONSTRAINT",
    rationale: "Minimale onafgebroken duur.",
    source: cao("104", "Feestdagen"),
    scope: ALGEMEEN,
    value: 24,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RO_DVP_DETACHED_MIN,
    title: "Losstaande RO- of DvP-dag",
    category: "HARD_CONSTRAINT",
    rationale: "Minimale onafgebroken duur van een losstaande RO- of DvP-dag.",
    source: cao("100", "RO- en DvP-dagen"),
    scope: ALGEMEEN,
    value: 30,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.RO_DVP_COMBINED_MIN,
    title: "RO- of DvP-dag in combinatie met een andere vrijetijdsaanspraak",
    category: "HARD_CONSTRAINT",
    rationale: "Minimale onafgebroken duur in combinatie.",
    source: cao("100", "RO- en DvP-dagen"),
    scope: ALGEMEEN,
    value: 24,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.PARTTIME_DASH_DAY_MIN,
    title: "Streepjesdag deeltijder",
    category: "HARD_CONSTRAINT",
    rationale:
      "Losstaand en aansluitend op een dienst geldt dezelfde minimale duur. Er " +
      "bestaan functie- en bedrijfsonderdeeluitzonderingen die hier niet " +
      "automatisch worden toegepast.",
    source: cao("100", "Streepjesdag deeltijders"),
    scope: ALGEMEEN,
    value: 30,
    unit: "HOURS",
    contextWindows: ["ADJACENT_DUTIES"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.WTV_DAY_LATEST_START,
    title: "Uiterste aanvang van een hele WTV-dag",
    category: "HARD_CONSTRAINT",
    rationale: "Een hele WTV-dag omvat een kalenderdag die uiterlijk om 02:00 aanvangt.",
    source: cao("97", "WTV"),
    scope: ALGEMEEN,
    value: 2 * 60,
    unit: "MINUTES",
    contextWindows: [],
    ...TRANSCRIBED,
  },
  {
    id: RULE.WTV_DAYS_PER_YEAR_36H,
    title: "WTV-dagen per jaar bij een 36-urige werkweek",
    category: "SOFT_CONSTRAINT",
    rationale:
      "Het basisarbeidspatroon bij 36 uur wordt bereikt met dit aantal WTV-dagen " +
      "per jaar. Geldt niet zonder meer bij een andere contractomvang.",
    source: cao("97", "WTV"),
    scope: ALGEMEEN,
    value: 26,
    unit: "COUNT",
    contextWindows: ["CALENDAR_YEAR"],
    ...TRANSCRIBED,
  },
  {
    id: RULE.WITHDRAWN_WTV_GRANT_WITHIN_DAYS,
    title: "Termijn voor het opnieuw verlenen van een ingetrokken WTV-dag",
    category: "HARD_CONSTRAINT",
    rationale:
      "Een ingetrokken WTV-dag moet binnen deze termijn worden verleend; daarna " +
      "komt hij ter vrije beschikking van de werknemer.",
    source: cao("97", "WTV"),
    scope: ALGEMEEN,
    value: 14,
    unit: "COUNT",
    contextWindows: [],
    ...TRANSCRIBED,
  },
];
