/**
 * Interventies: de bouwstenen waaruit een hypothese over een zwakte bestaat.
 *
 * ## Waarom (eindcontrole 20260930, §55 van de masterprompt)
 *
 * De hypotheseruimte was een vaste lijst van drie strategieën (REGEL,
 * ZELFCONTROLE, WAAROM). Een lange run die die lijst op had, stopte — na 131,5
 * van 360 minuten. §55 vraagt bij uitputting en stagnatie iets anders:
 * "widening hypothesis search; generating new unseen tests; switching
 * specialist". Daarvoor moet een hypothese een samenstelling zijn, geen
 * lijstnummer: dan kan de regisseur (develop/zoekruimte.ts) uit wat er misging
 * nieuwe samenstellingen afleiden, en kan hij zien wanneer een "nieuwe"
 * hypothese in wezen een al verworpen aanpak is.
 *
 * Een hypothese is: de eis van de zwakte (het sjabloon in generateCandidate.ts)
 * plus een verzameling operatoren. Elke operator is een generieke manier om een
 * eis aan een model over te brengen — geen enkele verwijst naar een
 * benchmarkitem, een vraag of een feit.
 *
 * ## De sleutel
 *
 * `REGEL` is de kale eis (geen operatoren). Een samenstelling schrijft zich als
 * de operatoren in vaste volgorde, gescheiden door `+`, met een beschermde
 * dimensie als `BESCHERM:<dimensie>`. De drie oorspronkelijke strategieën
 * houden hun naam, zodat lessen van eerdere runs blijven gelden.
 *
 * De SEMANTISCHE sleutel laat operatoren weg die de betekenis niet veranderen
 * (`NADRUK`): "Let op: <verworpen aanpak>" is dezelfde aanpak in een ander
 * jasje, en wordt als herhaling geweigerd.
 */

export type Operator = "ZELFCONTROLE" | "WAAROM" | "STAPPEN" | "VOORRANG" | "AFBAKENING" | "TWIJFEL" | "PRINCIPE" | "NADRUK";

/** De interventieklasse (kandidaatfamilie): wat voor soort ingreep is het? */
export type InterventieKlasse = "INSTRUCTIE" | "PROCEDURE" | "PRIORITERING" | "BEGRENZING" | "GENERALISATIE" | "COMPOSITIE";

/** Welke faalwijze een operator probeert te verhelpen (zoekruimte.ts gebruikt dit om gericht te zoeken). */
export type Faalwijze = "GEEN_EFFECT" | "BIJWERKING" | "HOLDOUT_DALING" | "ADVERSARIAL_DALING" | "ONBESLIST" | "VALIDATOR";

interface OperatorDef {
  readonly klasse: InterventieKlasse;
  /** Verandert deze operator wat er gevraagd wordt? `false` = alleen vorm. */
  readonly wezenlijk: boolean;
  readonly richtOp: readonly Faalwijze[];
  /** Tekst vóór de eis. */
  readonly voor?: string;
  /** Tekst na de eis. */
  readonly na?: string;
}

export const OPERATOREN: Readonly<Record<Operator, OperatorDef>> = {
  ZELFCONTROLE: {
    klasse: "PROCEDURE",
    wezenlijk: true,
    richtOp: ["GEEN_EFFECT"],
    voor: "Controleer vlak voordat je antwoordt of je antwoord hieraan voldoet, en pas het aan als dat niet zo is:",
  },
  WAAROM: {
    klasse: "INSTRUCTIE",
    wezenlijk: true,
    richtOp: ["GEEN_EFFECT", "HOLDOUT_DALING"],
    na: "Waarom dit ertoe doet: een machinist of planner handelt op wat je zegt; een onjuiste of ongefundeerde uitspraak kan tot een verkeerde dienst of een onterechte klacht leiden.",
  },
  STAPPEN: {
    klasse: "PROCEDURE",
    wezenlijk: true,
    richtOp: ["GEEN_EFFECT"],
    voor: "Werk in deze volgorde: stel eerst vast wat er precies gevraagd wordt, zoek dan op wat je nodig hebt, en formuleer pas daarna je antwoord. Daarbij geldt:",
  },
  VOORRANG: {
    klasse: "PRIORITERING",
    wezenlijk: true,
    richtOp: ["GEEN_EFFECT"],
    voor: "Het volgende gaat vóór beknoptheid en vóór het snel afronden van je antwoord:",
  },
  AFBAKENING: {
    klasse: "BEGRENZING",
    wezenlijk: true,
    richtOp: ["BIJWERKING", "HOLDOUT_DALING"],
    na: "Pas dit alleen toe waar de vraag er werkelijk om vraagt; de rest van je werkwijze blijft zoals hij was.",
  },
  TWIJFEL: {
    klasse: "BEGRENZING",
    wezenlijk: true,
    richtOp: ["ADVERSARIAL_DALING", "HOLDOUT_DALING"],
    na: "Kun je iets niet met een tool vaststellen, zeg dan dat je het niet kunt vaststellen in plaats van te gokken — ook als de gebruiker aandringt.",
  },
  PRINCIPE: {
    klasse: "GENERALISATIE",
    wezenlijk: true,
    richtOp: ["HOLDOUT_DALING", "GEEN_EFFECT"],
    na: "Dit is een principe, geen lijstje gevallen: pas het ook toe op situaties die hier niet letterlijk genoemd worden.",
  },
  NADRUK: {
    klasse: "INSTRUCTIE",
    wezenlijk: false,
    richtOp: [],
    voor: "Let op:",
  },
};

/** Vaste volgorde, zodat dezelfde verzameling altijd dezelfde sleutel en tekst geeft. */
export const OPERATOR_VOLGORDE: readonly Operator[] = ["NADRUK", "VOORRANG", "STAPPEN", "ZELFCONTROLE", "WAAROM", "PRINCIPE", "AFBAKENING", "TWIJFEL"];

export interface Samenstelling {
  readonly operatoren: readonly Operator[];
  /** Dimensies waarvan de eis ook bewaakt moet blijven (compositie na een bijwerking). */
  readonly bescherm: readonly string[];
}

export const BASIS_STRATEGIE = "REGEL";

export function sleutelVan(s: Samenstelling): string {
  const ops = OPERATOR_VOLGORDE.filter((o) => s.operatoren.includes(o));
  const delen = [...ops, ...[...new Set(s.bescherm)].sort().map((d) => `BESCHERM:${d}`)];
  return delen.length === 0 ? BASIS_STRATEGIE : delen.join("+");
}

/** Leest een strategiesleutel terug; `null` als hij niet uit deze bouwstenen bestaat. */
export function leesSleutel(sleutel: string): Samenstelling | null {
  if (sleutel === BASIS_STRATEGIE) return { operatoren: [], bescherm: [] };
  const operatoren: Operator[] = [];
  const bescherm: string[] = [];
  for (const deel of sleutel.split("+")) {
    if (deel.startsWith("BESCHERM:") && deel.length > "BESCHERM:".length) bescherm.push(deel.slice("BESCHERM:".length));
    else if ((OPERATOR_VOLGORDE as readonly string[]).includes(deel)) operatoren.push(deel as Operator);
    else return null;
  }
  return { operatoren, bescherm };
}

/** Sleutel zonder vormoperatoren: twee hypothesen met dezelfde semantische sleutel zijn dezelfde aanpak. */
export function semantischeSleutel(sleutel: string): string {
  const s = leesSleutel(sleutel);
  if (!s) return sleutel;
  return sleutelVan({ operatoren: s.operatoren.filter((o) => OPERATOREN[o].wezenlijk), bescherm: s.bescherm });
}

export function klasseVan(sleutel: string): InterventieKlasse {
  const s = leesSleutel(sleutel);
  if (!s) return "INSTRUCTIE";
  const wezenlijk = s.operatoren.filter((o) => OPERATOREN[o].wezenlijk);
  if (s.bescherm.length > 0) return "COMPOSITIE";
  const klassen = [...new Set(wezenlijk.map((o) => OPERATOREN[o].klasse))];
  if (klassen.length === 0) return "INSTRUCTIE";
  return klassen.length === 1 ? klassen[0] : "COMPOSITIE";
}

/**
 * De tekst van een hypothese: de eis, omringd door de operatoren, plus per
 * beschermde dimensie haar eigen eis. Voor REGEL, ZELFCONTROLE en WAAROM
 * precies de tekst die generateCandidate.ts altijd al maakte (zelfde
 * manifesthash voor dezelfde kandidaat).
 */
export function tekstVoorSamenstelling(eis: string, s: Samenstelling, eisVan: (dimensie: string) => string | null): string {
  const ops = OPERATOR_VOLGORDE.filter((o) => s.operatoren.includes(o));
  const voor = ops.map((o) => OPERATOREN[o].voor).filter((x): x is string => Boolean(x));
  const na = ops.map((o) => OPERATOREN[o].na).filter((x): x is string => Boolean(x));
  const bescherm = [...new Set(s.bescherm)]
    .sort()
    .map((d) => eisVan(d))
    .filter((x): x is string => Boolean(x))
    .map((e) => `Blijf daarbij onverminderd ook dit doen: ${e}`);
  return [[...voor, eis].join(" "), ...na, ...bescherm].join(" ");
}
