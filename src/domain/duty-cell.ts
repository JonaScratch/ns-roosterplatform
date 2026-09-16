/**
 * Eén cel uit een aangeleverd dienstenpakket lezen.
 *
 * ## Wat er in zo'n cel staat
 *
 * De afgesproken vorm is `1 = 4:27-11:07`: het weekdagnummer, een
 * isgelijkteken, en het tijdvak. In de praktijk komt dat in tientallen
 * schrijfwijzen binnen — met en zonder voorloopnul, met een punt in plaats van
 * een dubbele punt, met een gedachtestreepje, met "tot" ertussen, met dubbele
 * spaties. Dat is geen slordigheid van de aanleveraar maar het gevolg van
 * bestanden die door meerdere handen en programma's zijn gegaan.
 *
 * ## Waarom hier normaliseren en niet weigeren
 *
 * Een import die op `4.27-11.07` afketst, dwingt iemand een bestand met
 * honderden cellen met de hand te herschrijven. Het risico van normaliseren is
 * dat je iets anders leest dan er staat — en dáár zit de grens: alles wat
 * eenduidig één betekenis heeft, wordt gelezen; alles wat twee betekenissen kan
 * hebben, wordt gemeld en niet geraden.
 *
 * `13:00-5:00` is bijvoorbeeld eenduidig: een eindtijd vóór de begintijd
 * betekent over middernacht. Maar een cel met drie tijden erin niet, en die
 * wordt dus niet "voor de zekerheid" op de eerste twee gelezen.
 *
 * ## Waarom het weekdagnummer én de kolom meedoen
 *
 * De kolom zegt welke dag het is; de cel zegt het soms ook. Staan ze er allebei
 * en verschillen ze, dan is er iets mis met het bestand — en dan is stilzwijgend
 * één van de twee kiezen de slechtste uitkomst. Een dienst op de verkeerde dag
 * valt bij het inlezen niet op en bij het rijden wel.
 */

/** Wat een cel kan betekenen. */
export type CellKind =
  /** Een dienst met een tijdvak. */
  | "DIENST"
  /** Een structurele positie: rust, WTV, reserve, wisseldienst, compensatie. */
  | "POSITIE"
  /** Leeg. */
  | "LEEG"
  /** Onleesbaar; er staat wat er mis is. */
  | "ONLEESBAAR";

export interface CellReading {
  readonly kind: CellKind;
  /** Het weekdagnummer dat in de cel zelf stond, of null. */
  readonly weekdayInCell: number | null;
  readonly startMinute: number | null;
  /** Groter dan 1440 wanneer de dienst over middernacht loopt. */
  readonly endMinute: number | null;
  /** De structurele code (R, WTV, RES, WR, CO) bij `POSITIE`. */
  readonly position: string | null;
  /** Wat er letterlijk stond, ongewijzigd. */
  readonly raw: string;
  /** Waarom de cel onleesbaar is, in gewone taal. */
  readonly problem: string | null;
}

/**
 * De structurele codes uit de NS-roosterbladen.
 *
 * Deze lijst is met opzet gesloten: een onbekende lettercombinatie wordt niet
 * als "vast wel een vrije dag" opgevat maar gemeld. Wie hier een code mist,
 * hoort hem toe te voegen na te hebben vastgesteld wat hij betekent — niet
 * doordat de import hem stilzwijgend accepteerde.
 */
export const POSITION_CODES: Readonly<Record<string, string>> = {
  R: "RUST",
  RUST: "RUST",
  WTV: "WTV",
  RES: "RES",
  RESERVE: "RES",
  WR: "WR",
  CO: "CO",
};

/** Alles wat als "hier staat niets" telt. */
const LEEG = new Set(["", "-", "–", "—", "/", "."]);

/**
 * Maakt van de aangeleverde schrijfwijze één vorm.
 *
 * Alleen tekens die geen betekenis dragen worden gelijkgetrokken: soorten
 * streepjes, soorten spaties, hoofdletters. Cijfers en de volgorde blijven
 * onaangeroerd.
 */
export function normaliseCell(raw: string): string {
  return schrijfwijze(raw).toUpperCase();
}

/**
 * Dezelfde gelijkschakeling, maar met de oorspronkelijke hoofdletters.
 *
 * Vergelijken gebeurt op de hoofdlettervorm; wat een mens te lezen krijgt, hoort
 * te staan zoals hij het zelf heeft ingetypt. Een foutmelding die de cel in
 * kapitalen teruggeeft, wekt de indruk dat het systeem er al iets mee gedaan
 * heeft.
 */
function schrijfwijze(raw: string): string {
  return (
    raw
      // Vaste spaties en tabs zijn spaties.
      .replace(/[ \t]+/g, " ")
      // Alle streepjes die "tot" betekenen worden hetzelfde streepje.
      .replace(/[‐-―−]/g, "-")
      // "tot en met", "tot", "t/m" tussen twee tijden is hetzelfde streepje.
      .replace(/\s+(?:tot en met|tot|t\/m|until)\s+/gi, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** "4:27", "04.27", "0427" → minuten na middernacht. Null als het geen tijd is. */
export function readClock(raw: string): number | null {
  const tekst = raw.trim();

  // Met scheidingsteken: 4:27, 04.27, 4u27.
  const metScheiding = /^(\d{1,2})[:.hu](\d{2})$/i.exec(tekst);
  if (metScheiding) {
    return uitDelen(Number(metScheiding[1]), Number(metScheiding[2]));
  }

  // Zonder scheidingsteken, maar alleen bij vier cijfers. Drie cijfers is
  // dubbelzinnig — 427 kan 4:27 of 42:7 zijn — en wordt niet geraden.
  const zonder = /^(\d{2})(\d{2})$/.exec(tekst);
  if (zonder) {
    return uitDelen(Number(zonder[1]), Number(zonder[2]));
  }

  return null;
}

function uitDelen(uren: number, minuten: number): number | null {
  if (uren > 23 || minuten > 59) {
    return null;
  }
  return uren * 60 + minuten;
}

/**
 * Leest één cel.
 *
 * `weekdayOfColumn` is de weekdag waar de kolom voor staat, 1 tot en met 7.
 * Staat er in de cel óók een weekdagnummer en verschilt dat, dan is de cel
 * onleesbaar — zie de toelichting boven in dit bestand.
 */
export function readDutyCell(raw: string, weekdayOfColumn?: number): CellReading {
  const leeg: Omit<CellReading, "kind" | "raw" | "problem"> = {
    weekdayInCell: null,
    startMinute: null,
    endMinute: null,
    position: null,
  };

  const tekst = normaliseCell(raw);
  // Dezelfde tekst, maar leesbaar voor in een melding.
  const leesbaar = schrijfwijze(raw);
  if (LEEG.has(tekst)) {
    return { ...leeg, kind: "LEEG", raw, problem: null };
  }

  // Een voorvoegsel "1 =" bindt de cel aan een weekdag.
  let weekdayInCell: number | null = null;
  let rest = tekst;
  let restLeesbaar = leesbaar;
  const voorvoegsel = /^([1-7])\s*=\s*(.+)$/.exec(tekst);
  if (voorvoegsel) {
    weekdayInCell = Number(voorvoegsel[1]);
    rest = voorvoegsel[2].trim();
    restLeesbaar = (/^[1-7]\s*=\s*(.+)$/.exec(leesbaar)?.[1] ?? rest).trim();
  }

  if (
    weekdayInCell !== null &&
    weekdayOfColumn !== undefined &&
    weekdayInCell !== weekdayOfColumn
  ) {
    return {
      ...leeg,
      weekdayInCell,
      kind: "ONLEESBAAR",
      raw,
      problem:
        `De cel staat in de kolom van dag ${weekdayOfColumn}, maar noemt zelf dag ` +
        `${weekdayInCell}. Welke van de twee bedoeld is, valt niet vast te stellen.`,
    };
  }

  const positie = POSITION_CODES[rest];
  if (positie) {
    return { ...leeg, weekdayInCell, kind: "POSITIE", position: positie, raw, problem: null };
  }

  const delen = rest.split("-").map((deel) => deel.trim());
  const delenLeesbaar = restLeesbaar.split("-").map((deel) => deel.trim());
  if (delen.length !== 2) {
    return {
      ...leeg,
      weekdayInCell,
      kind: "ONLEESBAAR",
      raw,
      problem:
        delen.length < 2
          ? `"${raw.trim()}" bevat geen tijdvak in de vorm 4:27-11:07.`
          : `"${raw.trim()}" bevat ${delen.length} tijden; er worden er twee verwacht.`,
    };
  }

  const start = readClock(delen[0]);
  const eind = readClock(delen[1]);
  if (start === null || eind === null) {
    const welke = start === null ? delenLeesbaar[0] : delenLeesbaar[1];
    return {
      ...leeg,
      weekdayInCell,
      kind: "ONLEESBAAR",
      raw,
      problem: `"${welke}" is geen tijd. Verwacht wordt bijvoorbeeld 4:27 of 04:27.`,
    };
  }

  // Een eindtijd die niet ná de begintijd ligt, betekent de volgende dag. Een
  // dienst van 23:10 tot 07:20 duurt acht uur en tien minuten, niet min zestien
  // uur — en die aftrekking is precies waar rusttijdberekeningen op stukgaan.
  const eindMinuut = eind <= start ? eind + 24 * 60 : eind;

  if (eindMinuut - start > 24 * 60) {
    return {
      ...leeg,
      weekdayInCell,
      kind: "ONLEESBAAR",
      raw,
      problem: `"${raw.trim()}" levert een dienst van meer dan 24 uur op.`,
    };
  }

  return {
    weekdayInCell,
    kind: "DIENST",
    startMinute: start,
    endMinute: eindMinuut,
    position: null,
    raw,
    problem: null,
  };
}

/** "04:27" uit 267, en "07:20 (+1)" uit 1880. */
export function formatCellTime(minute: number): string {
  const dagen = Math.floor(minute / 1440);
  const binnenDag = ((minute % 1440) + 1440) % 1440;
  const klok =
    `${String(Math.floor(binnenDag / 60)).padStart(2, "0")}:` +
    `${String(binnenDag % 60).padStart(2, "0")}`;
  return dagen === 0 ? klok : `${klok} (+${dagen})`;
}

/** De cel zoals hij er in de sjabloon uit hoort te zien. */
export function formatDutyCell(weekday: number, startMinute: number, endMinute: number): string {
  const klok = (minute: number): string => {
    const binnenDag = ((minute % 1440) + 1440) % 1440;
    return (
      `${String(Math.floor(binnenDag / 60)).padStart(2, "0")}:` +
      `${String(binnenDag % 60).padStart(2, "0")}`
    );
  };
  return `${weekday} = ${klok(startMinute)}-${klok(endMinute)}`;
}

/**
 * Eén "Diensttijd"-cel uit het eenvoudige drie-kolommensjabloon: `START / EIND`.
 *
 * ## Waarom dit een aparte functie is en geen uitbreiding van `readDutyCell`
 *
 * `readDutyCell` hoort bij het oude, brede sjabloon: één rij per dienstnummer,
 * een kolom per weekdag, een streepje tussen de tijden en soms een
 * weekdagvoorvoegsel of een structurele code in dezelfde cel. Dat sjabloon
 * bestaat niet meer, maar de PDF-route leest nog wel tekst in die vorm uit een
 * documentbladzijde en blijft daarom `readDutyCell` gebruiken.
 *
 * Het nieuwe sjabloon heeft de weekdag en het dienstnummer al in hun eigen
 * kolom staan; een Diensttijd-cel bevat dus nooit iets anders dan een tijdvak,
 * nooit een structurele code en nooit een weekdagvoorvoegsel. Een functie die
 * beide vormen tegelijk zou herkennen, zou een schrijffout eerder raden dan
 * melden — bijvoorbeeld een abusievelijk getypt streepje in plaats van een
 * schuine streep.
 */
export interface DiensttijdReading {
  readonly ok: boolean;
  readonly startMinute: number | null;
  /** Groter dan 1440 wanneer de dienst over middernacht loopt. */
  readonly endMinute: number | null;
  /** Waarom de cel niet te lezen is, in gewone taal. Null wanneer `ok`. */
  readonly problem: string | null;
}

/**
 * Leest `START / EIND`, tolerant voor spaties rond de schuine streep
 * (`04:27/11:07`, `04:27 /11:07`, `04:27/ 11:07`). Een eindtijd die niet ná de
 * begintijd ligt, betekent de volgende kalenderdag — net als bij het oude
 * sjabloon, en om dezelfde reden: een dienst van 22:00 tot 06:00 duurt acht
 * uur, niet min zestien.
 */
export function readDiensttijd(raw: string): DiensttijdReading {
  const leeg = { startMinute: null, endMinute: null };
  const tekst = raw.trim();
  if (tekst === "") {
    return { ok: false, ...leeg, problem: "Diensttijd ontbreekt." };
  }

  const delen = tekst.split("/").map((deel) => deel.trim());
  if (delen.length !== 2) {
    return {
      ok: false,
      ...leeg,
      problem:
        delen.length < 2
          ? `"${tekst}" bevat geen schuine streep. Verwacht wordt bijvoorbeeld 04:27 / 11:07.`
          : `"${tekst}" bevat ${delen.length - 1} schuine strepen; er wordt er precies één verwacht.`,
    };
  }

  const [beginTekst, eindTekst] = delen;
  if (beginTekst === "") {
    return { ok: false, ...leeg, problem: "Begintijd ontbreekt." };
  }
  if (eindTekst === "") {
    return { ok: false, ...leeg, problem: "Eindtijd ontbreekt." };
  }

  const begin = readClock(beginTekst);
  if (begin === null) {
    return {
      ok: false,
      ...leeg,
      problem: `"${beginTekst}" is geen tijd. Verwacht wordt bijvoorbeeld 4:27 of 04:27.`,
    };
  }
  const eind = readClock(eindTekst);
  if (eind === null) {
    return {
      ok: false,
      ...leeg,
      problem: `"${eindTekst}" is geen tijd. Verwacht wordt bijvoorbeeld 4:27 of 04:27.`,
    };
  }

  const eindMinuut = eind <= begin ? eind + 24 * 60 : eind;
  if (eindMinuut - begin > 24 * 60) {
    return { ok: false, ...leeg, problem: `"${tekst}" levert een dienst van meer dan 24 uur op.` };
  }

  return { ok: true, startMinute: begin, endMinute: eindMinuut, problem: null };
}

/** De Diensttijd-cel zoals hij er in het sjabloon uit hoort te zien: `04:27 / 11:07`. */
export function formatDiensttijd(startMinute: number, endMinute: number): string {
  const klok = (minute: number): string => {
    const binnenDag = ((minute % 1440) + 1440) % 1440;
    return (
      `${String(Math.floor(binnenDag / 60)).padStart(2, "0")}:` +
      `${String(binnenDag % 60).padStart(2, "0")}`
    );
  };
  return `${klok(startMinute)} / ${klok(endMinute)}`;
}
