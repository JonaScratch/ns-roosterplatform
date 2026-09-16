import { inflateSync } from "node:zlib";

/**
 * De aangeleverde NS-roosterbladen lezen.
 *
 * ## Wat deze bestanden zijn
 *
 * PDF-uitdraaien uit het NS-planningssysteem, per roostervariant één blad:
 * "Vroeg 1 VA", "Laat/Nacht 1 - C", enzovoort. Ze bevatten echte tekst — geen
 * scan — dus er is geen OCR nodig en er wordt niets geraden.
 *
 * ## Hoe het blad in elkaar zit
 *
 * Bovenaan de kopgegevens: standplaats, roostervariant, geldigheidsperiode,
 * rol. Daaronder per regel een rij van zeven dagen. Elke dagcel is één van:
 *
 *     dienstnummer | duur | begin - eind      een dienstdag
 *     RES | 08:00  |                          reservedag
 *     R   |        |                          rustdag
 *     WR  | 08:00  |                          WTV-/vrije dag
 *     CO  | 08:00  |                          compensatiedag
 *
 * ## Waarom hier niets wordt afgerond of aangevuld
 *
 * Dit bestand is de bron. Wat er niet in staat, wordt hier niet bedacht: een
 * cel die niet te lezen is, komt terug als onbekend en niet als rustdag. Het
 * verschil tussen "hij heeft vrij" en "wij konden het niet lezen" is precies
 * het verschil dat iemand thuis houdt terwijl hij had moeten rijden.
 */

export interface RosterPdfMeta {
  readonly standplaats: string;
  readonly roostervariant: string;
  readonly rol: string;
  readonly startdatum: string;
  readonly einddatum: string;
  readonly roosterNaam: string;
  readonly contracturenPerWeek: string;
  readonly status: string;
  readonly gemiddeldeWeeklengteInclusiefPauze: string;
  readonly gemiddeldeWeeklengteExclusiefPauze: string;
  readonly wtvIngeroosterd: string;
  readonly geprintOp: string;
}

export type CellKind = "DUTY" | "RES" | "R" | "WR" | "CO" | "WTV" | "ONBEKEND";

export interface RosterPdfCell {
  readonly weekday: number;
  readonly kind: CellKind;
  readonly dutyCode: string | null;
  /** De duur zoals op het blad, bijvoorbeeld "07:05". */
  readonly duration: string | null;
  /** Begintijd in minuten na middernacht, of null. */
  readonly startMinute: number | null;
  /** Eindtijd; voorbij 1440 wanneer de dienst over middernacht loopt. */
  readonly endMinute: number | null;
  /** Wat er letterlijk stond, voor de herleidbaarheid. */
  readonly raw: string;
}

export interface RosterPdfLine {
  readonly lineNumber: number;
  readonly weekHoursIncludingBreak: string;
  readonly weekHoursExcludingBreak: string;
  readonly cells: readonly RosterPdfCell[];
}

export interface RosterPdfDocument {
  readonly meta: RosterPdfMeta;
  readonly lines: readonly RosterPdfLine[];
  /** Fragmenten die niet konden worden geplaatst. Leeg is de bedoeling. */
  readonly unparsed: readonly string[];
}

// ── De tekst uit het bestand halen ───────────────────────────────────────────

/**
 * De tekstfragmenten van een PDF, in leesvolgorde.
 *
 * De bladen gebruiken FlateDecode-streams met gewone tekstoperatoren. Er is
 * bewust geen PDF-bibliotheek toegevoegd: dat is een afhankelijkheid met een
 * eigen aanvalsoppervlak voor een bestandsformaat dat hier in één vorm
 * voorkomt. Komt er ooit een blad met een andere codering, dan valt dat op —
 * de fragmenten zijn dan leeg en de reconciliatie slaat alarm.
 */
export function pdfTextFragments(bytes: Buffer): readonly string[] {
  const stukken: string[] = [];
  let index = 0;

  for (;;) {
    const start = bytes.indexOf("stream", index);
    if (start === -1) {
      break;
    }
    let inhoudStart = start + "stream".length;
    if (bytes[inhoudStart] === 0x0d) {
      inhoudStart += 1;
    }
    if (bytes[inhoudStart] === 0x0a) {
      inhoudStart += 1;
    }
    const eind = bytes.indexOf("endstream", inhoudStart);
    if (eind === -1) {
      break;
    }
    try {
      stukken.push(inflateSync(bytes.subarray(inhoudStart, eind)).toString("latin1"));
    } catch {
      // Een stream met een andere filter (bijvoorbeeld een afbeelding). Die
      // bevat geen bladtekst en wordt overgeslagen.
    }
    index = eind + "endstream".length;
  }

  const fragmenten: string[] = [];
  const tekstPatroon = new RegExp("\\((?:\\\\.|[^\\\\()])*\\)", "g");
  for (const treffer of stukken.join("\n").matchAll(tekstPatroon)) {
    fragmenten.push(
      treffer[0]
        .slice(1, -1)
        .split("\\(")
        .join("(")
        .split("\\)")
        .join(")")
        .split("\\\\")
        .join("\\"),
    );
  }
  return fragmenten;
}

// ── Het blad ontleden ────────────────────────────────────────────────────────

const WEEKDAGEN = [
  "Maandag",
  "Dinsdag",
  "Woensdag",
  "Donderdag",
  "Vrijdag",
  "Zaterdag",
  "Zondag",
] as const;

/** Ontleedt één roosterblad. */
export function parseRosterPdf(bytes: Buffer): RosterPdfDocument {
  const f = pdfTextFragments(bytes).map((deel) => deel.trim());
  const onverwerkt: string[] = [];

  const naVeld = (label: string): string => {
    const index = f.findIndex((deel) => deel === label);
    if (index === -1) {
      return "";
    }
    // De bladen zetten het label, dan een dubbele punt, dan de waarde.
    for (let stap = 1; stap <= 3; stap += 1) {
      const kandidaat = f[index + stap];
      if (kandidaat && kandidaat !== ":" && kandidaat !== "") {
        return kandidaat;
      }
    }
    return "";
  };

  // De roosternaam staat direct na "Zondag" — de laatste kolomkop.
  const zondagIndex = f.findIndex((deel) => deel === "Zondag");
  const roosterNaam = zondagIndex >= 0 ? (f[zondagIndex + 1] ?? "") : "";

  const gemiddeldeIndex = f.findIndex((deel) => deel.startsWith("weeklengte"));
  const meta: RosterPdfMeta = {
    standplaats: naVeld("Standplaats"),
    roostervariant: naVeld("Roostervariant"),
    rol: naVeld("Rol"),
    startdatum: naVeld("Startdatum"),
    einddatum: naVeld("Einddatum"),
    roosterNaam,
    contracturenPerWeek: naVeld("Contracturen per week"),
    status: naVeld("Status"),
    gemiddeldeWeeklengteInclusiefPauze: gemiddeldeIndex >= 0 ? (f[gemiddeldeIndex + 1] ?? "") : "",
    gemiddeldeWeeklengteExclusiefPauze: gemiddeldeIndex >= 0 ? (f[gemiddeldeIndex + 2] ?? "") : "",
    wtvIngeroosterd: naVeld("WTV ingeroosterd"),
    geprintOp: f.find((deel) => deel.startsWith("Geprint op")) ?? "",
  };

  // Vanaf de eerste "Regel n" begint het raster.
  const regelIndexen: number[] = [];
  f.forEach((deel, index) => {
    if (/^Regel \d+$/.test(deel)) {
      regelIndexen.push(index);
    }
  });

  const lines: RosterPdfLine[] = [];
  for (let r = 0; r < regelIndexen.length; r += 1) {
    const start = regelIndexen[r];
    const eind = r + 1 < regelIndexen.length ? regelIndexen[r + 1] : f.length;
    const blok = f.slice(start, eind);

    const lineNumber = Number(blok[0].replace("Regel ", ""));
    const incl = blok[1] ?? "";
    const excl = blok[2] ?? "";

    const cells = leesDagen(blok.slice(3), onverwerkt);
    lines.push({
      lineNumber,
      weekHoursIncludingBreak: incl,
      weekHoursExcludingBreak: excl,
      cells,
    });
  }

  return { meta, lines, unparsed: onverwerkt };
}

/**
 * Zeven dagcellen uit een rij fragmenten.
 *
 * Elke cel bestaat uit drie fragmenten: een aanduiding, een duur en een
 * tijdvak. Bij R zijn de laatste twee leeg; bij RES/WR/CO staat er een duur en
 * geen tijdvak. Door steeds drie fragmenten te nemen blijft de weekdag exact
 * kloppen, ook wanneer een cel leeg is — en dat is precies waar een naïeve
 * "sla lege stukken over"-lezing een dienst een dag laat opschuiven.
 */
function leesDagen(rest: readonly string[], onverwerkt: string[]): readonly RosterPdfCell[] {
  const cells: RosterPdfCell[] = [];
  let index = 0;

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const a = rest[index] ?? "";
    const b = rest[index + 1] ?? "";
    const c = rest[index + 2] ?? "";
    index += 3;

    const raw = [a, b, c].join("|");
    const tijden = leesTijdvak(c);

    if (a === "R") {
      cells.push(leeg(weekday, "R", raw));
    } else if (a === "RES" || a === "WR" || a === "CO" || a === "WTV") {
      cells.push({
        weekday,
        kind: a as CellKind,
        dutyCode: null,
        duration: b || null,
        startMinute: null,
        endMinute: null,
        raw,
      });
    } else if (/^\d{1,4}$/.test(a)) {
      cells.push({
        weekday,
        kind: "DUTY",
        dutyCode: a,
        duration: b || null,
        startMinute: tijden?.start ?? null,
        endMinute: tijden?.eind ?? null,
        raw,
      });
    } else {
      // Niet te plaatsen. Uitdrukkelijk niet als rustdag opvatten.
      onverwerkt.push(raw);
      cells.push(leeg(weekday, "ONBEKEND", raw));
    }
  }
  return cells;
}

function leeg(weekday: number, kind: CellKind, raw: string): RosterPdfCell {
  return {
    weekday,
    kind,
    dutyCode: null,
    duration: null,
    startMinute: null,
    endMinute: null,
    raw,
  };
}

/**
 * Een tijdvak als "05:27 - 12:32" of "16:52 - 00:28".
 *
 * Een eindtijd die niet later is dan de begintijd, ligt de volgende dag; die
 * telt door voorbij 1440. Dat is de plek waar een nachtdienst stilzwijgend een
 * dienst van min zestien uur wordt wanneer je er niet op let.
 */
export function leesTijdvak(waarde: string): { start: number; eind: number } | null {
  const treffer = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(waarde.trim());
  if (!treffer) {
    return null;
  }
  const start = Number(treffer[1]) * 60 + Number(treffer[2]);
  let eind = Number(treffer[3]) * 60 + Number(treffer[4]);
  if (eind <= start) {
    eind += 24 * 60;
  }
  return { start, eind };
}

/** Alle dienstinstanties uit een blad: dienstnummer met weekdag en tijden. */
export function dutyInstancesOf(document: RosterPdfDocument): readonly {
  readonly dutyCode: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly duration: string | null;
  readonly lineNumber: number;
}[] {
  return document.lines.flatMap((line) =>
    line.cells
      .filter(
        (cell): cell is RosterPdfCell & { dutyCode: string; startMinute: number; endMinute: number } =>
          cell.kind === "DUTY" && cell.dutyCode !== null && cell.startMinute !== null && cell.endMinute !== null,
      )
      .map((cell) => ({
        dutyCode: cell.dutyCode,
        weekday: cell.weekday,
        startMinute: cell.startMinute,
        endMinute: cell.endMinute,
        duration: cell.duration,
        lineNumber: line.lineNumber,
      })),
  );
}

/** De weekdagnamen zoals ze op het blad staan. Voor de reconciliatie. */
export const WEEKDAY_HEADERS = WEEKDAGEN;
