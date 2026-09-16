import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Excel-bestanden lezen en schrijven, zonder bibliotheek.
 *
 * ## Waarom zonder bibliotheek
 *
 * Een xlsx is een zip met een handvol XML-bestanden erin. Dat is te overzien.
 * Een spreadsheetbibliotheek is dat niet: die brengt een parser mee voor
 * formules, macro's, gekoppelde werkmappen en van alles wat dit project
 * uitdrukkelijk níét wil uitvoeren. Hier wordt alleen tekst uit cellen gehaald
 * en tekst in cellen gezet.
 *
 * ## Wat hier met opzet niet gebeurt
 *
 * Geen formule wordt uitgerekend. Geen macro wordt gestart — een werkmap met
 * een macro-onderdeel wordt geweigerd in plaats van "voor de zekerheid" gelezen.
 * Geen externe verwijzing wordt gevolgd. Wat een cel aan berekende waarde bij
 * zich draagt, wordt gelezen als tekst; dat er een formule achter zat, wordt
 * gemeld zodat een mens ernaar kan kijken.
 *
 * ## Wat er van getallen wordt gemaakt
 *
 * Excel bewaart een tijd als een breuk van een etmaal: 4:27 wordt 0,185416…
 * Wie dat als tekst opschrijft, krijgt onzin. De lezer geeft daarom naast de
 * tekst ook de ruwe getalswaarde terug, zodat de aanroeper het verschil ziet
 * tussen "hier stond 0,185" en "hier stond 4:27" — en er iets zinnigs over kan
 * zeggen in plaats van te raden.
 */

export interface XlsxCell {
  /** De cel zoals hij te lezen is. Leeg wanneer de cel leeg is. */
  readonly text: string;
  /** De ruwe getalswaarde, wanneer de cel een getal bevat. */
  readonly numeric: number | null;
  /** Zat er een formule achter deze cel? */
  readonly formula: boolean;
}

export interface XlsxSheet {
  readonly name: string;
  /** Rijen van cellen, links uitgelijnd op kolom A. */
  readonly rows: readonly (readonly XlsxCell[])[];
}

export interface XlsxRead {
  readonly sheets: readonly XlsxSheet[];
  /** Wat er mis was met het bestand zelf. */
  readonly problems: readonly string[];
}

const LEGE_CEL: XlsxCell = { text: "", numeric: null, formula: false };

/** Onderdelen die er niet in horen. Aanwezigheid is een reden tot weigeren. */
const MACRO_ONDERDELEN = [
  "vbaproject.bin",
  "xl/macrosheets/",
  "xl/vbaproject.bin",
  "xl/externallinks/",
];

// ── Lezen ────────────────────────────────────────────────────────────────────

/**
 * Leest een xlsx.
 *
 * Geeft altijd een uitkomst terug; wat niet gelezen kan worden, staat in
 * `problems`. Er wordt niets uitgevoerd en niets opgehaald.
 */
export function readXlsx(buffer: Buffer): XlsxRead {
  let onderdelen: Map<string, Buffer>;
  try {
    onderdelen = unzip(buffer);
  } catch (error) {
    return { sheets: [], problems: [`Het bestand is geen leesbare xlsx: ${String(error)}`] };
  }

  const problems: string[] = [];

  const macro = [...onderdelen.keys()].find((naam) =>
    MACRO_ONDERDELEN.some((verdacht) => naam.toLowerCase().includes(verdacht)),
  );
  if (macro) {
    return {
      sheets: [],
      problems: [
        `De werkmap bevat "${macro}". Werkmappen met macro's of externe koppelingen worden ` +
          "niet ingelezen. Lever het bestand aan als gewone xlsx zonder macro's.",
      ],
    };
  }

  const gedeeldeTeksten = leesGedeeldeTeksten(onderdelen);
  const bladen: XlsxSheet[] = [];

  for (const { naam, pad } of bladindeling(onderdelen)) {
    const xml = onderdelen.get(pad);
    if (!xml) {
      problems.push(`Werkblad "${naam}" staat in de werkmap maar het blad zelf ontbreekt.`);
      continue;
    }
    bladen.push({ name: naam, rows: leesBlad(xml.toString("utf8"), gedeeldeTeksten) });
  }

  if (bladen.length === 0 && problems.length === 0) {
    problems.push("De werkmap bevat geen werkbladen.");
  }

  return { sheets: bladen, problems };
}

/** De werkbladen in de volgorde waarin de werkmap ze noemt. */
function bladindeling(
  onderdelen: Map<string, Buffer>,
): readonly { naam: string; pad: string }[] {
  const workbook = onderdelen.get("xl/workbook.xml")?.toString("utf8");
  if (!workbook) {
    return [];
  }

  // De koppeling van sheet-id naar bestandsnaam staat in de rels.
  const rels = onderdelen.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const doelen = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
    const doel = /\bTarget="([^"]+)"/.exec(match[0])?.[1];
    if (id && doel) {
      doelen.set(id, doel.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }

  const bladen: { naam: string; pad: string }[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const naam = decodeerXml(/\bname="([^"]*)"/.exec(match[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(match[0])?.[1];
    const doel = rid ? doelen.get(rid) : undefined;
    if (doel) {
      bladen.push({ naam, pad: `xl/${doel}` });
    }
  }
  return bladen;
}

function leesGedeeldeTeksten(onderdelen: Map<string, Buffer>): readonly string[] {
  const xml = onderdelen.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) {
    return [];
  }
  const teksten: string[] = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // Een gedeelde tekst kan uit meerdere stukken bestaan (opmaak per deel);
    // die horen aan elkaar geplakt te worden en niet alleen het eerste stuk.
    const delen = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((deel) =>
      decodeerXml(deel[1]),
    );
    teksten.push(delen.join(""));
  }
  return teksten;
}

function leesBlad(xml: string, gedeeld: readonly string[]): readonly (readonly XlsxCell[])[] {
  const rijen: XlsxCell[][] = [];

  for (const rij of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rijnummer = Number(/\br="(\d+)"/.exec(rij[1])?.[1] ?? rijen.length + 1);
    const cellen: XlsxCell[] = [];

    for (const cel of rij[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributen = cel[1];
      const inhoud = cel[2] ?? "";
      const verwijzing = /\br="([A-Z]+)\d+"/.exec(attributen)?.[1];
      const kolom = verwijzing ? kolomIndex(verwijzing) : cellen.length;

      // Gaten opvullen: een blad slaat lege cellen over, maar de kolom bepaalt
      // hier de weekdag. Eén overgeslagen cel zou alles opschuiven.
      while (cellen.length < kolom) {
        cellen.push(LEGE_CEL);
      }
      cellen[kolom] = leesCel(attributen, inhoud, gedeeld);
    }

    while (rijen.length < rijnummer - 1) {
      rijen.push([]);
    }
    rijen[rijnummer - 1] = cellen;
  }

  return rijen.map((rij) => rij ?? []);
}

function leesCel(attributen: string, inhoud: string, gedeeld: readonly string[]): XlsxCell {
  const soort = /\bt="([^"]+)"/.exec(attributen)?.[1] ?? "n";
  const formule = /<f[\s>]/.test(inhoud);
  const waarde = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inhoud)?.[1];

  if (soort === "s") {
    const index = Number(waarde ?? "-1");
    return { text: gedeeld[index] ?? "", numeric: null, formula: formule };
  }

  if (soort === "inlineStr") {
    const delen = [...inhoud.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((deel) =>
      decodeerXml(deel[1]),
    );
    return { text: delen.join(""), numeric: null, formula: formule };
  }

  if (soort === "str") {
    return { text: decodeerXml(waarde ?? ""), numeric: null, formula: formule };
  }

  if (soort === "b") {
    return { text: waarde === "1" ? "WAAR" : "ONWAAR", numeric: null, formula: formule };
  }

  if (waarde === undefined || waarde === "") {
    return { ...LEGE_CEL, formula: formule };
  }

  const getal = Number(waarde);
  return {
    text: Number.isFinite(getal) ? waarde : decodeerXml(waarde),
    numeric: Number.isFinite(getal) ? getal : null,
    formula: formule,
  };
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function kolomIndex(letters: string): number {
  let waarde = 0;
  for (const letter of letters) {
    waarde = waarde * 26 + (letter.charCodeAt(0) - 64);
  }
  return waarde - 1;
}

/** 0 → "A", 26 → "AA". */
export function kolomLetters(index: number): string {
  let rest = index + 1;
  let letters = "";
  while (rest > 0) {
    const cijfer = (rest - 1) % 26;
    letters = String.fromCharCode(65 + cijfer) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

function decodeerXml(tekst: string): string {
  return tekst
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    // Ampersand als laatste: anders wordt "&amp;lt;" ten onrechte "<".
    .replace(/&amp;/g, "&");
}

function codeerXml(tekst: string): string {
  return tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Stuurtekens horen niet in XML en maken het bestand onleesbaar voor Excel.
    .split("")
    .filter((teken) => {
      const code = teken.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("");
}

// ── Schrijven ────────────────────────────────────────────────────────────────

export interface SheetToWrite {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  /**
   * 1-gebaseerde rijen die vetgedrukt worden weggeschreven, met een lichte
   * achtergrond — voor een titel of een kopregel. Zonder opgave: geen opmaak,
   * zoals voorheen.
   */
  readonly boldRows?: readonly number[];
  /** Kolombreedtes in Excel-eenheden, in kolomvolgorde vanaf A. */
  readonly columnWidths?: readonly number[];
  /** Hoeveel rijen vanaf boven vast blijven staan bij scrollen. */
  readonly freezeRows?: number;
  /** Celbereik voor het autofilter, bijvoorbeeld "A5:G50". */
  readonly autoFilterRange?: string;
  /** Afdrukgebied; zonder opgave het hele gebruikte blad. */
  readonly printArea?: string;
  readonly landscape?: boolean;
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="10"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="10"/><name val="Calibri"/></font>' +
  "</fonts>" +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE7EAF6"/><bgColor indexed="64"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/**
 * Schrijft een werkmap met tekstcellen.
 *
 * Alles wordt als tekst weggeschreven, ook wat op een getal lijkt. Dat is
 * opzettelijk: een dienstnummer als 043 verliest anders zijn voorloopnul, en
 * "4:27-11:07" zou door Excel tot een som kunnen worden herleid. Wie het
 * sjabloon invult en terugstuurt, hoort hetzelfde terug te krijgen als hij
 * heeft ingetypt.
 *
 * Opmaak (vet, kolombreedte, bevroren rijen, autofilter, afdrukgebied) is
 * optioneel per blad en raakt de leesbaarheid van het bestand niet: een lezer
 * die geen opmaak kent, leest gewoon de tekst uit elke cel.
 */
export function writeXlsx(sheets: readonly SheetToWrite[]): Buffer {
  const onderdelen: { naam: string; inhoud: Buffer }[] = [];
  const heeftOpmaak = sheets.some((blad) => (blad.boldRows?.length ?? 0) > 0);

  onderdelen.push({
    naam: "[Content_Types].xml",
    inhoud: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        (heeftOpmaak
          ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          : "") +
        sheets
          .map(
            (_, index) =>
              `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
              'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
          )
          .join("") +
        "</Types>",
      "utf8",
    ),
  });

  onderdelen.push({
    naam: "_rels/.rels",
    inhoud: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
      "utf8",
    ),
  });

  const printAreaDefinedNames = sheets
    .map((blad, index) =>
      blad.printArea
        ? `<definedName name="_xlnm.Print_Area" localSheetId="${index}">` +
          `'${codeerXml(blad.name)}'!${blad.printArea}</definedName>`
        : null,
    )
    .filter((entry): entry is string => entry !== null);

  onderdelen.push({
    naam: "xl/workbook.xml",
    inhoud: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets
          .map(
            (blad, index) =>
              `<sheet name="${codeerXml(blad.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
          )
          .join("") +
        "</sheets>" +
        (printAreaDefinedNames.length > 0
          ? `<definedNames>${printAreaDefinedNames.join("")}</definedNames>`
          : "") +
        "</workbook>",
      "utf8",
    ),
  });

  onderdelen.push({
    naam: "xl/_rels/workbook.xml.rels",
    inhoud: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, index) =>
              `<Relationship Id="rId${index + 1}" ` +
              'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
              `Target="worksheets/sheet${index + 1}.xml"/>`,
          )
          .join("") +
        (heeftOpmaak
          ? `<Relationship Id="rId${sheets.length + 1}" ` +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
            'Target="styles.xml"/>'
          : "") +
        "</Relationships>",
      "utf8",
    ),
  });

  if (heeftOpmaak) {
    onderdelen.push({ naam: "xl/styles.xml", inhoud: Buffer.from(STYLES_XML, "utf8") });
  }

  sheets.forEach((blad, index) => {
    onderdelen.push({
      naam: `xl/worksheets/sheet${index + 1}.xml`,
      inhoud: Buffer.from(bladXml(blad), "utf8"),
    });
  });

  return packZip(onderdelen);
}

function bladXml(blad: SheetToWrite): string {
  const vetteRijen = new Set(blad.boldRows ?? []);
  const rijen = blad.rows
    .map((rij, rijIndex) => {
      const vet = vetteRijen.has(rijIndex + 1);
      const cellen = rij
        .map((waarde, kolomIdx) => {
          if (waarde === "") {
            return "";
          }
          const verwijzing = `${kolomLetters(kolomIdx)}${rijIndex + 1}`;
          const stijl = vet ? ' s="1"' : "";
          return (
            `<c r="${verwijzing}"${stijl} t="inlineStr"><is><t xml:space="preserve">` +
            `${codeerXml(waarde)}</t></is></c>`
          );
        })
        .join("");
      return `<row r="${rijIndex + 1}">${cellen}</row>`;
    })
    .join("");

  const kolommen = blad.columnWidths
    ? "<cols>" +
      blad.columnWidths
        .map(
          (breedte, index) =>
            `<col min="${index + 1}" max="${index + 1}" width="${breedte}" customWidth="1"/>`,
        )
        .join("") +
      "</cols>"
    : "";

  const sheetViews = blad.freezeRows
    ? "<sheetViews><sheetView tabSelected=\"1\" workbookViewId=\"0\">" +
      `<pane ySplit="${blad.freezeRows}" topLeftCell="A${blad.freezeRows + 1}" ` +
      'activePane="bottomLeft" state="frozen"/>' +
      "</sheetView></sheetViews>"
    : "";

  const autoFilter = blad.autoFilterRange ? `<autoFilter ref="${blad.autoFilterRange}"/>` : "";

  const paginaInstelling =
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    `<pageSetup orientation="${blad.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0" paperSize="9"/>`;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    sheetViews +
    kolommen +
    `<sheetData>${rijen}</sheetData>` +
    autoFilter +
    paginaInstelling +
    "</worksheet>"
  );
}

// ── De zip eromheen ──────────────────────────────────────────────────────────

const CRC_TABEL = (() => {
  const tabel = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let waarde = index;
    for (let bit = 0; bit < 8; bit += 1) {
      waarde = waarde & 1 ? 0xedb88320 ^ (waarde >>> 1) : waarde >>> 1;
    }
    tabel[index] = waarde >>> 0;
  }
  return tabel;
})();

export function crc32(data: Buffer): number {
  let waarde = 0xffffffff;
  for (const byte of data) {
    waarde = CRC_TABEL[(waarde ^ byte) & 0xff] ^ (waarde >>> 8);
  }
  return (waarde ^ 0xffffffff) >>> 0;
}

/**
 * Zet onderdelen in een zip.
 *
 * Openbaar omdat de weigering van macro-onderdelen alleen te meten is met een
 * échte werkmap waar zo'n onderdeel in zit. Een test die daarvoor bytes aan
 * elkaar plakt, meet zijn eigen plakwerk.
 */
export function packZip(onderdelen: readonly { naam: string; inhoud: Buffer }[]): Buffer {
  const lokaal: Buffer[] = [];
  const centraal: Buffer[] = [];
  let verschuiving = 0;

  for (const onderdeel of onderdelen) {
    const naam = Buffer.from(onderdeel.naam, "utf8");
    const geperst = deflateRawSync(onderdeel.inhoud, { level: 9 });
    const controle = crc32(onderdeel.inhoud);

    const kop = Buffer.alloc(30);
    kop.writeUInt32LE(0x04034b50, 0);
    kop.writeUInt16LE(20, 4); // benodigde versie
    kop.writeUInt16LE(0x0800, 6); // vlag: namen in UTF-8
    kop.writeUInt16LE(8, 8); // methode: deflate
    kop.writeUInt16LE(0, 10); // tijd
    kop.writeUInt16LE(0x21, 12); // datum: 1 januari 1980
    kop.writeUInt32LE(controle, 14);
    kop.writeUInt32LE(geperst.length, 18);
    kop.writeUInt32LE(onderdeel.inhoud.length, 22);
    kop.writeUInt16LE(naam.length, 26);
    kop.writeUInt16LE(0, 28);
    lokaal.push(kop, naam, geperst);

    const ingang = Buffer.alloc(46);
    ingang.writeUInt32LE(0x02014b50, 0);
    ingang.writeUInt16LE(20, 4); // gemaakt door
    ingang.writeUInt16LE(20, 6); // benodigde versie
    ingang.writeUInt16LE(0x0800, 8);
    ingang.writeUInt16LE(8, 10);
    ingang.writeUInt16LE(0, 12);
    ingang.writeUInt16LE(0x21, 14);
    ingang.writeUInt32LE(controle, 16);
    ingang.writeUInt32LE(geperst.length, 20);
    ingang.writeUInt32LE(onderdeel.inhoud.length, 24);
    ingang.writeUInt16LE(naam.length, 28);
    ingang.writeUInt32LE(verschuiving, 42);
    centraal.push(ingang, naam);

    verschuiving += kop.length + naam.length + geperst.length;
  }

  const centraleMap = Buffer.concat(centraal);
  const staart = Buffer.alloc(22);
  staart.writeUInt32LE(0x06054b50, 0);
  staart.writeUInt16LE(onderdelen.length, 8);
  staart.writeUInt16LE(onderdelen.length, 10);
  staart.writeUInt32LE(centraleMap.length, 12);
  staart.writeUInt32LE(verschuiving, 16);

  return Buffer.concat([...lokaal, centraleMap, staart]);
}

/**
 * Haalt de onderdelen uit een zip.
 *
 * Leest de centrale map en niet de losse kopjes ervoor: die twee kunnen van
 * elkaar afwijken, en de centrale map is de lijst die telt. Namen met een pad
 * naar boven (`../`) worden geweigerd — een archief hoort niet te kunnen
 * bepalen waar iets terechtkomt.
 */
function unzip(buffer: Buffer): Map<string, Buffer> {
  const staart = zoekStaart(buffer);
  if (staart < 0) {
    throw new Error("geen zip-afsluiting gevonden");
  }

  const aantal = buffer.readUInt16LE(staart + 10);
  let positie = buffer.readUInt32LE(staart + 16);
  const onderdelen = new Map<string, Buffer>();

  for (let index = 0; index < aantal; index += 1) {
    if (buffer.readUInt32LE(positie) !== 0x02014b50) {
      throw new Error(`onverwachte ingang in de centrale map op ${positie}`);
    }
    const methode = buffer.readUInt16LE(positie + 10);
    const geperstLengte = buffer.readUInt32LE(positie + 20);
    const naamLengte = buffer.readUInt16LE(positie + 28);
    const extraLengte = buffer.readUInt16LE(positie + 30);
    const commentaarLengte = buffer.readUInt16LE(positie + 32);
    const lokaalOffset = buffer.readUInt32LE(positie + 42);
    const naam = buffer.toString("utf8", positie + 46, positie + 46 + naamLengte);

    if (naam.includes("..") || naam.startsWith("/")) {
      throw new Error(`onveilige naam in het archief: ${naam}`);
    }

    // De lengtes in het lokale kopje bepalen waar de gegevens beginnen.
    const lokaalNaam = buffer.readUInt16LE(lokaalOffset + 26);
    const lokaalExtra = buffer.readUInt16LE(lokaalOffset + 28);
    const begin = lokaalOffset + 30 + lokaalNaam + lokaalExtra;
    const rauw = buffer.subarray(begin, begin + geperstLengte);

    onderdelen.set(naam, methode === 0 ? Buffer.from(rauw) : inflateRawSync(rauw));

    positie += 46 + naamLengte + extraLengte + commentaarLengte;
  }

  return onderdelen;
}

function zoekStaart(buffer: Buffer): number {
  // De afsluiting staat achteraan, maar er mag een commentaar achter staan.
  const ondergrens = Math.max(0, buffer.length - 22 - 0xffff);
  for (let positie = buffer.length - 22; positie >= ondergrens; positie -= 1) {
    if (buffer.readUInt32LE(positie) === 0x06054b50) {
      return positie;
    }
  }
  return -1;
}
