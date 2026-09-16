import { RULE } from "./rule-ids";
import type { MissingRulePackage, RuleDefinition, RuleSource } from "./types";

/**
 * Regionale roosterkaders Regio West 2026 en lokale productregels.
 *
 * ## Waarom hier veel op "nog niet vast te stellen" staat
 *
 * De regionale kaders zijn beleidsteksten, geen rekenregels. "Zoveel als
 * mogelijk 50% weekenden roosteren" laat open of het gaat om gewerkte
 * weekenden, vrije weekenden, of een aandeel van de roosterlijnen. Zo'n zin
 * omzetten in een harde grens betekent een norm verzinnen — en een verzonnen
 * norm wordt binnen een maand als de echte norm gelezen.
 *
 * Wat wél hard kan, staat hard. Wat interpretatie vergt, staat als
 * `UNRESOLVED` of `LOCAL_POLICY_INTERPRETATION_REQUIRED` en blokkeert de
 * beslissingen die ervan afhangen.
 *
 * ## Een lagere bron mag een hogere niet versoepelen
 *
 * Regionale kaders staan onder de CAO. Een regionaal streven mag nooit een
 * CAO-rustnorm oprekken; het conflictmodel in `types.ts` laat de hogere,
 * specifiekere bron winnen en niet toevallig de ruimste waarde.
 */

/**
 * De standplaatsen waarvoor een lokaal regelkader is aangeleverd.
 *
 * Deze lijst hoort hier en niet in de database: hij beschrijft welke regels dit
 * bestand kent, niet hoe een omgeving is ingericht. Wie een standplaats aan de
 * database toevoegt, heeft daarmee nog geen regels — en die twee dingen mogen
 * niet per ongeluk hetzelfde gaan betekenen.
 */
export const LOCATIONS_WITH_LOCAL_RULESET: readonly string[] = ["DDR"];

const REGIO_WEST: RuleSource = {
  layer: "REGIONAL",
  document: "ROOSTERKADERS-REGIO-WEST-2026",
  documentTitle: "Roosterkaders Regio West 2026",
  legalAuthority: "REGIO",
  effectiveFrom: "2026-01-01",
  contractualEnd: null,
  renewalRule: { kind: "OPEN_ENDED" },
  terminationKnown: "NO_TERMINATION_KNOWN",
  supersededBy: null,
};

const LOKAAL: RuleSource = {
  ...REGIO_WEST,
  layer: "LOCAL",
  legalAuthority: "LOKAAL",
  documentTitle: "Roosterkaders Regio West 2026, lokale afspraken",
};

/**
 * Het product zelf: onze eigen roosterindeling, geen externe bron.
 *
 * De ingangsdatum ligt bewust vóór die van de regionale kaders. Dit zijn geen
 * afspraken met een looptijd maar uitgangspunten van de applicatie: een
 * standplaats klopt of klopt niet, een profiel staat een dienst toe of niet.
 * Zou dit op 2026 staan, dan zou de engine bij elke beoordeling van een oudere
 * roosterperiode melden dat zelfs de standplaatscontrole nog niet gold — ruis
 * die de werkelijke bronvragen zou ondersneeuwen.
 */
const PRODUCT: RuleSource = {
  // Onderaan de hiërarchie en met een eigen gezagsaanduiding: dit is beleid van
  // het platform en geen NS-bron. Zolang het als LOKAAL te boek stond, zat het
  // in dezelfde laag als een echte standplaatsafspraak en kon het er bij gelijke
  // naam vóór komen.
  layer: "PRODUCT_POLICY",
  document: "NS-ROOSTERPLATFORM",
  documentTitle: "NS Roosterplatform, functionele uitgangspunten",
  legalAuthority: "PRODUCT",
  effectiveFrom: "2020-01-01",
  contractualEnd: null,
  renewalRule: { kind: "OPEN_ENDED" },
  terminationKnown: "NO_TERMINATION_KNOWN",
  supersededBy: null,
};

const MACHINIST_WEST = {
  employeeGroups: ["MACHINIST"] as const,
  companies: ["NSR"] as const,
  locations: "ALL" as const,
};

export const REGIONAL_RULES: readonly RuleDefinition[] = [
  {
    id: RULE.REGIO_WEST_WEEKEND_TARGET,
    title: "Weekendbalans Regio West",
    category: "OPTIMIZATION_OBJECTIVE",
    rationale:
      "Het kader noemt 'zoveel als mogelijk 50% weekenden roosteren' met een zo " +
      "breed mogelijke spreiding. De maatstaf is niet wiskundig gespecificeerd.",
    source: { ...REGIO_WEST, article: "Weekendbalans" },
    scope: MACHINIST_WEST,
    value: null,
    unit: "RATIO",
    contextWindows: ["WEEKS_16"],
    status: "UNRESOLVED",
    validatedBy: null,
    validatedAt: null,
    note:
      "Onduidelijk of 50% slaat op gewerkte weekenden, vrije weekenden, een " +
      "aandeel van de roosterlijnen of iets anders. Tot een formele definitie " +
      "blijft dit een zichtbaar, niet-geactiveerd beleidsdoel; de CAO-regels voor " +
      "het rode weekend gelden onverkort en hard.",
  },
  {
    id: RULE.DORDRECHT_ROSTER_LINE_DIVISOR,
    title: "Aantal roosterlijnen deelbaar door",
    category: "HARD_CONSTRAINT",
    rationale:
      "Het lokale kader vraagt voor Dordrecht roosters waarvan het aantal lijnen " +
      "deelbaar is door dit getal. Voor Rotterdam noemt het kader zes.",
    source: { ...LOKAAL, article: "Roostergrootte" },
    scope: { employeeGroups: ["MACHINIST"], companies: ["NSR"], locations: ["DDR"] },
    value: 2,
    unit: "COUNT",
    contextWindows: [],
    status: "SOURCE_TRANSCRIBED",
    validatedBy: null,
    validatedAt: null,
  },
  {
    id: RULE.REGIO_WEST_WTV_INTERVAL_WEEKS,
    title: "WTV-dag gemiddeld eens per aantal weken",
    category: "SOFT_CONSTRAINT",
    rationale:
      "Het regionale kader noemt gemiddeld elke twee weken een WTV-dag. WTV-dagen " +
      "zijn verkoppelbaar, behalve in het lange-weekendenrooster.",
    source: { ...REGIO_WEST, article: "WTV" },
    scope: MACHINIST_WEST,
    value: 2,
    unit: "COUNT",
    contextWindows: ["WEEKS_4"],
    status: "SOURCE_TRANSCRIBED",
    validatedBy: null,
    validatedAt: null,
    note:
      "Het kader noemt daarnaast '2 dagen VTA, rust of WTV per week' die in " +
      "principe niet worden verschoven, terwijl rustdagen wél verschoven mogen " +
      "worden om losse VTA-dagen te voorkomen. Die twee zinnen laten meerdere " +
      "lezingen toe; als harde regel is dit niet vast te leggen.",
  },
  {
    id: RULE.NEW_DRIVER_PROTECTION_YEARS,
    title: "Beschermde periode nieuwe machinisten",
    category: "SOFT_CONSTRAINT",
    rationale:
      "Nieuwe machinisten blijven in beginsel minimaal deze periode na het " +
      "praktijkexamen in een rooster met vroeg, laat, nacht en beperkte " +
      "weekendheid, met veel rangeerdiensten om ervaring op te doen.",
    source: { ...REGIO_WEST, article: "Nieuwe machinisten" },
    scope: MACHINIST_WEST,
    value: 2,
    unit: "COUNT",
    contextWindows: [],
    status: "SOURCE_TRANSCRIBED",
    validatedBy: null,
    validatedAt: null,
    note: "Plaatsingsbeleid, geen arbeidstijdregel. Geldt niet voor ervaren machinisten.",
  },
  {
    id: RULE.PLAN_ROSTER_OVERFLOW_LIMIT,
    title: "Diensten die in een planrooster mogen belanden",
    category: "SOFT_CONSTRAINT",
    rationale:
      "Het kader noemt dat alle diensten moeten worden ingeroosterd, met als " +
      "uitzondering ongeveer de laatste 800 diensten die zo nodig in een " +
      "planrooster kunnen worden geplaatst.",
    source: { ...REGIO_WEST, article: "Planrooster" },
    scope: MACHINIST_WEST,
    value: null,
    unit: "COUNT",
    contextWindows: [],
    status: "UNRESOLVED",
    validatedBy: null,
    validatedAt: null,
    note:
      "Het getal 800 is regionaal en breed geformuleerd; of het voor Dordrecht " +
      "geldt en waarop het precies slaat, is niet vastgesteld. Niet als magisch " +
      "getal in de optimizer opnemen.",
  },
];

/**
 * Een productregel die wél als bevestigd geldt.
 *
 * De regels uit de CAO staan op `SOURCE_TRANSCRIBED`: overgenomen, niet door NS
 * bevestigd. Voor een regel die het platform zelf stelt en zelf kan bewijzen,
 * ligt dat anders. Of een structureel anker is verplaatst, is een vergelijking
 * met een bevroren baseline uit onze eigen database — daar komt geen
 * broninterpretatie aan te pas. Zo'n regel mag dus een bevestigde overtreding
 * opleveren.
 *
 * Dat zegt niets over de CAO. Het zegt alleen dat déze bewering hard te maken is.
 */
const PRODUCT_VALIDATED = {
  status: "VALIDATED" as const,
  validatedBy: "NS Roosterplatform, functionele uitgangspunten",
  validatedAt: "2026-09-03",
};

export const PRODUCT_RULES: readonly RuleDefinition[] = [
  {
    id: RULE.ROSTER_ANCHOR_LOCKED,
    title: "Structureel anker vastgelegd bij een wijzigingsblad",
    category: "HARD_CONSTRAINT",
    rationale:
      "Zodra een jaarrooster is vastgesteld, liggen de rust-, vrije-, " +
      "compensatie- en reservedagen vast. Een wijzigingsblad mag de diensten " +
      "opnieuw invullen maar geen ankerdag verplaatsen. Dat kan alleen in een " +
      "nieuwe dienstregelingronde, waarin de structuur formeel opnieuw wordt " +
      "vastgesteld.",
    source: { ...PRODUCT, article: "Roosterstructuur" },
    scope: { employeeGroups: "ALL", companies: "ALL", locations: "ALL" },
    value: 1,
    unit: "NONE",
    contextWindows: [],
    ...PRODUCT_VALIDATED,
    note:
      "Deze regel kent geen uitzondering. Een beheerder is beheerder en geen " +
      "roosterregel-bypass; wie een anker wil verplaatsen, start een nieuwe " +
      "dienstregelingronde.",
  },
  {
    id: RULE.RESERVE_BASE_WITHOUT_DUTIES,
    title: "Reservebasisrooster bevat geen dienstnummers",
    category: "HARD_CONSTRAINT",
    rationale:
      "Het reserverooster is een operationeel opvangrooster. De vaste roosters " +
      "krijgen eerst hun diensten; wat daarna overblijft wordt door de " +
      "dienstindeling per dag ingevuld, als laag bovenop het RES-slot. Een " +
      "dienstnummer in het basisreserverooster zou die opvangruimte vooraf " +
      "dichtzetten.",
    source: { ...PRODUCT, article: "Reserverooster" },
    scope: { employeeGroups: "ALL", companies: "ALL", locations: "ALL" },
    value: 1,
    unit: "NONE",
    contextWindows: [],
    ...PRODUCT_VALIDATED,
  },
  {
    id: RULE.ROSTER_PROFILE_BOUNDS,
    title: "Grenzen van het roosterprofiel",
    category: "HARD_CONSTRAINT",
    rationale:
      "Een vast roosterprofiel begrenst welke dagdelen een medewerker rijdt. " +
      "Een dienst die 's nachts rijdt telt als nacht, ook wanneer het werk zelf " +
      "rangeerwerk is, en valt daarmee buiten elk profiel zonder nacht.",
    source: { ...PRODUCT, article: "Roosterprofielen" },
    scope: { employeeGroups: "ALL", companies: "ALL", locations: "ALL" },
    value: 1,
    unit: "NONE",
    contextWindows: [],
    status: "SOURCE_TRANSCRIBED",
    validatedBy: null,
    validatedAt: null,
  },
  {
    id: RULE.DEPOT_MATCH,
    title: "Standplaats",
    category: "HARD_CONSTRAINT",
    rationale:
      "Diensten worden gereden vanaf de standplaats waaraan de medewerker is " +
      "verbonden. Afwijken vergt een uitdrukkelijke uitzondering.",
    source: { ...PRODUCT, article: "Standplaats" },
    scope: { employeeGroups: "ALL", companies: "ALL", locations: "ALL" },
    value: 1,
    unit: "NONE",
    contextWindows: [],
    status: "SOURCE_TRANSCRIBED",
    validatedBy: null,
    validatedAt: null,
  },
  {
    id: RULE.DAY_AVAILABLE,
    title: "Dag beschikbaar",
    category: "HARD_CONSTRAINT",
    rationale:
      "Op een dag met verlof of opleiding kan geen dienst worden gereden, en een " +
      "dag waarop al een andere dienst staat is niet nogmaals te vullen.",
    source: { ...PRODUCT, article: "Roosterposities" },
    scope: { employeeGroups: "ALL", companies: "ALL", locations: "ALL" },
    value: 1,
    unit: "NONE",
    contextWindows: ["ADJACENT_DUTIES"],
    status: "SOURCE_TRANSCRIBED",
    validatedBy: null,
    validatedAt: null,
  },
  {
    id: RULE.QUALIFICATIONS_REQUIRED,
    title: "Vereiste bevoegdheden",
    category: "HARD_CONSTRAINT",
    rationale:
      "Geen medewerker mag een dienst krijgen waarvoor een noodzakelijke " +
      "bevoegdheid, baanvak-, materieel- of veiligheidskwalificatie ontbreekt.",
    source: { ...PRODUCT, article: "Bevoegdheden" },
    scope: { employeeGroups: "ALL", companies: "ALL", locations: "ALL" },
    value: 1,
    unit: "NONE",
    contextWindows: [],
    status: "SOURCE_TRANSCRIBED",
    validatedBy: null,
    validatedAt: null,
    note:
      "De formele kwalificatiematrix is niet aangeleverd. De controle gebruikt de " +
      "bevoegdheidscodes die in het systeem staan; die zijn niet gevalideerd " +
      "tegen een bronsysteem. Zie het ontbrekende pakket QUALIFICATION_MATRIX.",
  },
  {
    id: RULE.MIX_PROFILE_SPECIAL_RULES,
    title: "Bijzondere regels Mix, 50+ Mix en BLM",
    category: "HARD_CONSTRAINT",
    rationale:
      "Voor deze profielen gelden aanvullende regels die nog niet formeel zijn " +
      "vastgelegd.",
    source: { ...PRODUCT, article: "Roosterprofielen" },
    scope: { employeeGroups: "ALL", companies: "ALL", locations: "ALL" },
    value: null,
    unit: "NONE",
    contextWindows: [],
    status: "POLICY_PENDING",
    validatedBy: null,
    validatedAt: null,
    note:
      "Er worden geen extra grenzen verzonnen. Zolang de regels ontbreken kan een " +
      "plaatsing in deze profielen niet volledig worden beoordeeld.",
  },
];

/**
 * Regelpakketten die als geheel ontbreken.
 *
 * Dit is geen lijst met wensen maar een blokkeerlijst: zolang een pakket
 * ontbreekt, kan elke beslissing die ervan afhangt niet veilig worden genomen.
 */
export const MISSING_PACKAGES: readonly MissingRulePackage[] = [
  {
    id: "ATW_VALIDATED_RULESET",
    title: "Arbeidstijdenwet, gevalideerd regelpakket",
    reason:
      "De aangeleverde bron is de CAO. De CAO bepaalt zelf dat een werktijdregeling " +
      "ook aan de Arbeidstijdenwet moet voldoen. De actuele wettekst en de " +
      "bijbehorende grenswaarden zijn niet aangeleverd en worden niet gereconstrueerd.",
    blocks: ["PUBLICATION", "PRODUCTION_MODE"],
  },
  {
    id: "ATB_VALIDATED_RULESET",
    title: "Arbeidstijdenbesluit vervoer, gevalideerd regelpakket",
    reason:
      "Voor spoorwegpersoneel gelden aanvullende bepalingen uit het " +
      "Arbeidstijdenbesluit vervoer. Niet aangeleverd.",
    blocks: ["PUBLICATION", "PRODUCTION_MODE"],
  },
  {
    id: "CAO_CURRENCY_CONFIRMATION",
    title: "Bevestiging welke CAO actueel is",
    reason:
      "De aangeleverde CAO heet 2024–2025. Voor planning in 2026 moet NS " +
      "bevestigen welke CAO, nawerking of nieuwe afspraken gelden.",
    blocks: ["PRODUCTION_MODE"],
  },
  {
    id: "QUALIFICATION_MATRIX",
    title: "Kwalificatiematrix",
    reason:
      "Welke baanvakken, materieelsoorten, bevoegdheden en lokale kennis een " +
      "dienst vereist, en welke een medewerker heeft, komt uit een bronsysteem " +
      "dat niet is aangesloten.",
    blocks: ["PUBLICATION", "PRODUCTION_MODE"],
  },
  {
    id: "DORDRECHT_BREAK_PARAMETER",
    title: "Werkonderbreking en arbeidstijdcorrectie voor deze standplaats",
    reason:
      "De CAO legt de duur van de werkonderbreking en de daaraan gekoppelde " +
      "verlaging van de maximale arbeidstijd per standplaats vast. Die waarden " +
      "zijn niet aangeleverd.",
    blocks: ["DUTY_WITH_LONG_BREAK"],
  },
  {
    id: "REGIO_WEST_WEEKEND_TARGET_DEFINITION",
    title: "Definitie van de weekendmaatstaf Regio West",
    reason:
      "Het kader noemt 'zoveel als mogelijk 50% weekenden' zonder wiskundige " +
      "definitie.",
    blocks: ["WEEKEND_TARGET_OPTIMIZATION"],
  },
  {
    id: "MIX_BLM_50PLUS_PROFILE_RULES",
    title: "Bijzondere regels Mix, BLM en 50+ Mix",
    reason: "Niet formeel vastgelegd.",
    blocks: ["MIX_PROFILE_PLACEMENT"],
  },
  {
    id: "INDIVIDUAL_RESTRICTIONS_SOURCE",
    title: "Bron voor individuele arbeidstijdbeperkingen",
    reason:
      "Individuele beperkingen moeten uit een geautoriseerd HR-systeem komen. Er " +
      "is geen koppeling; de engine kan daarom niet weten of een medewerker een " +
      "beschermde beperking heeft.",
    blocks: ["PUBLICATION", "PRODUCTION_MODE"],
  },
  {
    id: "EMPLOYEE_CONTRACT_HOURS",
    title: "Contractomvang per medewerker",
    reason:
      "Urennormen zijn niet te berekenen zonder de individuele contractomvang. " +
      "Er wordt geen 36 of 40 uur aangenomen.",
    blocks: ["WEEKLY_HOURS_VALIDATION"],
  },
  {
    id: "WR_CO_DEFINITION",
    title: "Betekenis en regels van de roosterposities WR en CO",
    reason: "Komen voor in bestaande roosters; hun regels zijn niet aangeleverd.",
    blocks: ["WR_CO_PLACEMENT"],
  },
];
