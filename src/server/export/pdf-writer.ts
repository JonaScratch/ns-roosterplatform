import { deflateSync } from "node:zlib";

/**
 * Een echt PDF-bestand schrijven.
 *
 * ## Waarom niet gewoon de browser laten printen
 *
 * Omdat een roosterblad het huis uit gaat. Het gaat naar iemand die de
 * applicatie niet kan raadplegen, en dat blad moet zeggen wat er is
 * afgesproken. "Druk af naar PDF" levert per browser, per printerinstelling en
 * per schermbreedte iets anders op — andere marges, andere afkapping, soms een
 * kolom minder. Twee machinisten met hetzelfde rooster kunnen dan twee
 * verschillende bladen in handen hebben, en geen van beiden kan zien welke de
 * juiste is.
 *
 * ## Waarom zonder bibliotheek
 *
 * Een PDF-generator die alles kan, is een grote afhankelijkheid met een eigen
 * aanvalsoppervlak, voor een document dat uit tekst, lijnen en één afbeelding
 * bestaat. Wat hier staat is bewust klein: het schrijft precies de opbouw die
 * dit blad nodig heeft, en niets daarbuiten. Wie er meer in wil, ziet meteen
 * wat er niet is.
 *
 * ## Wat dit niet doet
 *
 * Geen automatische regelafbreking, geen tekststijlen door elkaar, geen
 * Unicode buiten WinAnsi. Tekst die niet past, wordt afgekapt — zichtbaar, met
 * een beletselteken — en niet stilzwijgend over de rand geschoven. Een blad
 * waarvan een dienstnummer half buiten de pagina valt, is erger dan een blad
 * waarop staat dat er iets is afgekapt.
 */

/**
 * Welk lettertype.
 *
 * Times staat hier omdat het aangeleverde NS-roosterblad Times-Roman en
 * Times-Bold gebruikt. Dat blad is de canonieke vormgeving; wie het in
 * Helvetica nabouwt, maakt een blad dat er nét anders uitziet en daardoor niet
 * meer als hetzelfde soort blad wordt herkend.
 */
export type PdfFontFamily = "TIMES" | "HELVETICA";

export interface PdfTextOptions {
  readonly size?: number;
  readonly bold?: boolean;
  readonly family?: PdfFontFamily;
  /** Grijswaarde 0 (zwart) tot 1 (wit). */
  readonly gray?: number;
  /** Maximale breedte in punten; wat niet past, wordt afgekapt. */
  readonly maxWidth?: number;
}

/** A4 liggend, in punten (1 pt = 1/72 inch). */
export const A4_LANDSCAPE = { width: 841.89, height: 595.28 } as const;
export const A4_PORTRAIT = { width: 595.28, height: 841.89 } as const;

interface PdfImage {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
  readonly colorSpace: "DeviceRGB" | "DeviceGray";
  readonly bitsPerComponent: number;
}

/**
 * Eén pagina in opbouw.
 *
 * De oorsprong van PDF ligt linksonder. Dat is precies omgekeerd aan hoe je een
 * blad leest, en het is de plek waar de meeste fouten ontstaan — een tabel die
 * ondersteboven begint, of een kop die net buiten de pagina valt. Daarom neemt
 * deze klasse coördinaten van linksboven aan en rekent zij zelf om.
 */
export class PdfPage {
  private readonly delen: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** Tekst op (x, y) vanaf linksboven. */
  text(x: number, y: number, waarde: string, opties: PdfTextOptions = {}): void {
    const grootte = opties.size ?? 9;
    const familie = opties.family ?? "TIMES";
    const font = fontNaam(familie, opties.bold ?? false);
    const grijs = opties.gray ?? 0;
    const tekst = opties.maxWidth
      ? afkappen(waarde, opties.maxWidth, grootte, opties.bold ?? false, familie)
      : waarde;

    this.delen.push(
      `BT ${font} ${grootte} Tf ${grijs} g ${fmt(x)} ${fmt(this.height - y)} Td ` +
        `(${escapePdfString(tekst)}) Tj ET`,
    );
  }

  /** Tekst rechts uitgelijnd op x. */
  textRight(x: number, y: number, waarde: string, opties: PdfTextOptions = {}): void {
    const breedte = textWidth(waarde, opties.size ?? 9, opties.bold ?? false, opties.family);
    this.text(x - breedte, y, waarde, opties);
  }

  /** Tekst gecentreerd op x. */
  textCenter(x: number, y: number, waarde: string, opties: PdfTextOptions = {}): void {
    const breedte = textWidth(waarde, opties.size ?? 9, opties.bold ?? false, opties.family);
    this.text(x - breedte / 2, y, waarde, opties);
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = 0.7, width = 0.5): void {
    this.delen.push(
      `${gray} G ${fmt(width)} w ${fmt(x1)} ${fmt(this.height - y1)} m ` +
        `${fmt(x2)} ${fmt(this.height - y2)} l S`,
    );
  }

  rect(x: number, y: number, w: number, h: number, gray: number): void {
    this.delen.push(
      `${gray} g ${fmt(x)} ${fmt(this.height - y - h)} ${fmt(w)} ${fmt(h)} re f`,
    );
  }

  /**
   * Een vectortekening plaatsen, geschaald in een vak.
   *
   * Voor het beeldmerk. De opdrachten zijn uitgedrukt in het assenstelsel van
   * de tekening zelf; de schaal- en verplaatsingsmatrix hieronder zet ze in het
   * vak. De verhouding blijft behouden: één schaalfactor voor beide assen, de
   * kleinste van de twee. Een logo dat net iets is uitgerekt, valt op bij
   * iedereen die het merk kent.
   */
  drawing(
    operations: string,
    box: { x: number; y: number; width: number; height: number },
    source: { width: number; height: number },
  ): void {
    const schaal = Math.min(box.width / source.width, box.height / source.height);
    const x = box.x + (box.width - source.width * schaal) / 2;
    // De aanroeper rekent vanaf linksboven; hier terug naar PDF-coördinaten.
    const y =
      this.height - box.y - box.height + (box.height - source.height * schaal) / 2;
    this.delen.push(
      `q ${fmt(schaal)} 0 0 ${fmt(schaal)} ${fmt(x)} ${fmt(y)} cm`,
      operations,
      "Q",
    );
  }

  /** Een eerder geregistreerde afbeelding plaatsen. */
  image(name: string, x: number, y: number, w: number, h: number): void {
    this.delen.push(
      `q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(this.height - y - h)} cm /${name} Do Q`,
    );
  }

  /**
   * Tekst diagonaal over de pagina.
   *
   * Voor het simulatiestempel. Het staat schuin en in lichtgrijs achter de
   * inhoud, zodat het niet weg te knippen is zonder dat het opvalt.
   */
  watermark(waarde: string, gray = 0.88, size = 46): void {
    const breedte = textWidth(waarde, size, true, "HELVETICA");
    const hoek = Math.atan2(this.height, this.width);
    const cos = Math.cos(hoek);
    const sin = Math.sin(hoek);
    const x = this.width / 2 - (breedte / 2) * cos;
    const y = this.height / 2 - (breedte / 2) * sin;
    this.delen.push(
      `q BT /F4 ${size} Tf ${gray} g ${fmt(cos)} ${fmt(sin)} ${fmt(-sin)} ${fmt(cos)} ` +
        `${fmt(x)} ${fmt(y)} Tm (${escapePdfString(waarde)}) Tj ET Q`,
    );
  }

  content(): string {
    return this.delen.join("\n");
  }
}

/** Het document. */
export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly images: PdfImage[] = [];

  addPage(size: { width: number; height: number } = A4_LANDSCAPE): PdfPage {
    const page = new PdfPage(size.width, size.height);
    this.pages.push(page);
    return page;
  }

  /**
   * Een afbeelding beschikbaar maken.
   *
   * Alleen ruwe pixels: de aanroeper heeft de PNG al uitgepakt. Een PNG
   * rechtstreeks doorgeven zou meeliften op de overeenkomst tussen PNG-filters
   * en PDF-filters, en die overeenkomst geldt alleen voor een deel van de
   * PNG's. Dan werkt het voor het ene logo wel en het andere niet.
   */
  addImage(image: PdfImage): void {
    this.images.push(image);
  }

  /** Het bestand als bytes. */
  build(): Buffer {
    const objecten: Buffer[] = [];
    const push = (inhoud: string | Buffer): number => {
      objecten.push(Buffer.isBuffer(inhoud) ? inhoud : Buffer.from(inhoud, "latin1"));
      return objecten.length;
    };

    // 1 catalog, 2 pages, 3 font regular, 4 font bold, daarna de afbeeldingen
    // en de pagina's. De nummering is vast zodat de verwijzingen te lezen zijn.
    const catalogId = push("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesId = push("");
    // F1/F2 zijn Times: dat is wat het aangeleverde NS-roosterblad gebruikt.
    // F3/F4 zijn Helvetica, voor het simulatiestempel — dat hoort juist níet op
    // het blad thuis te lijken.
    const fontId = push(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    );
    const boldId = push(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>",
    );
    const sansId = push(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    );
    const sansBoldId = push(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    );

    const imageIds: { name: string; id: number }[] = [];
    for (const image of this.images) {
      const gecomprimeerd = deflateSync(image.data);
      const dict =
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /${image.colorSpace} /BitsPerComponent ${image.bitsPerComponent} ` +
        `/Filter /FlateDecode /Length ${gecomprimeerd.length} >>\nstream\n`;
      imageIds.push({
        name: image.name,
        id: push(
          Buffer.concat([
            Buffer.from(dict, "latin1"),
            gecomprimeerd,
            Buffer.from("\nendstream", "latin1"),
          ]),
        ),
      });
    }

    const pageIds: number[] = [];
    for (const page of this.pages) {
      const inhoud = deflateSync(Buffer.from(page.content(), "latin1"));
      const contentId = push(
        Buffer.concat([
          Buffer.from(`<< /Length ${inhoud.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
          inhoud,
          Buffer.from("\nendstream", "latin1"),
        ]),
      );
      const xobjects = imageIds
        .map((image) => `/${image.name} ${image.id} 0 R`)
        .join(" ");
      pageIds.push(
        push(
          `<< /Type /Page /Parent ${pagesId} 0 R ` +
            `/MediaBox [0 0 ${fmt(page.width)} ${fmt(page.height)}] ` +
            `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R ` +
            `/F3 ${sansId} 0 R /F4 ${sansBoldId} 0 R >>` +
            (xobjects ? ` /XObject << ${xobjects} >>` : "") +
            " >> " +
            `/Contents ${contentId} 0 R >>`,
        ),
      );
    }

    objecten[pagesId - 1] = Buffer.from(
      `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
        .map((id) => `${id} 0 R`)
        .join(" ")}] >>`,
      "latin1",
    );

    // ── Samenstellen ──────────────────────────────────────────────────────
    const delen: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    let positie = delen[0].length;
    const offsets: number[] = [];

    for (const [index, object] of objecten.entries()) {
      offsets.push(positie);
      const stuk = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
        object,
        Buffer.from("\nendobj\n", "latin1"),
      ]);
      delen.push(stuk);
      positie += stuk.length;
    }

    const xrefStart = positie;
    const xref = [
      `xref`,
      `0 ${objecten.length + 1}`,
      "0000000000 65535 f ",
      ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
      "trailer",
      `<< /Size ${objecten.length + 1} /Root ${catalogId} 0 R >>`,
      "startxref",
      String(xrefStart),
      "%%EOF",
      "",
    ].join("\n");

    delen.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(delen);
  }
}

// ── Tekstbreedte ─────────────────────────────────────────────────────────────

/**
 * De breedte van Helvetica-tekens, in duizendsten van de lettergrootte.
 *
 * Alleen de tekens die op een roosterblad voorkomen staan er met hun echte
 * waarde in; de rest krijgt de breedte van een cijfer. Dat is genoeg om te
 * bepalen waar iets moet worden afgekapt en om iets te centreren, en het is
 * ruim minder dan de volledige tabel — die zou hier vooral suggereren dat er
 * meer wordt ondersteund dan het geval is.
 */
const BREEDTES: Readonly<Record<string, number>> = {
  " ": 278, "!": 278, '"': 355, "#": 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  "[": 278, "]": 278, "_": 556, "|": 260, "—": 1000, "–": 556, "·": 278, "…": 1000,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

/**
 * Times is smaller dan Helvetica.
 *
 * De verhouding is niet constant per teken, maar voor het bepalen van een
 * afkappunt en een centrering is deze benadering ruim genoeg — en zij is de
 * goede kant op conservatief: Times valt daarmee eerder te smal dan te breed,
 * en te smal loopt niet over de rand.
 */
const TIMES_FACTOR = 0.92;

function fontNaam(familie: PdfFontFamily, bold: boolean): string {
  if (familie === "TIMES") {
    return bold ? "/F2" : "/F1";
  }
  return bold ? "/F4" : "/F3";
}

export function textWidth(
  waarde: string,
  size: number,
  bold: boolean,
  familie: PdfFontFamily = "TIMES",
): number {
  let totaal = 0;
  for (const teken of waarde) {
    // Vet is ongeveer 5% breder; exact genoeg om niet over de rand te lopen, en
    // dat is waar deze functie voor bestaat.
    totaal += (BREEDTES[teken] ?? 556) * (bold ? 1.05 : 1);
  }
  const schaal = familie === "TIMES" ? TIMES_FACTOR : 1;
  return ((totaal * schaal) / 1000) * size;
}

function afkappen(
  waarde: string,
  maxWidth: number,
  size: number,
  bold: boolean,
  familie: PdfFontFamily = "TIMES",
): string {
  if (textWidth(waarde, size, bold, familie) <= maxWidth) {
    return waarde;
  }
  let uit = "";
  for (const teken of waarde) {
    if (textWidth(`${uit}${teken}…`, size, bold, familie) > maxWidth) {
      break;
    }
    uit += teken;
  }
  return `${uit}…`;
}

// ── Ontsnappingen ────────────────────────────────────────────────────────────

/**
 * Een string veilig in een PDF zetten.
 *
 * Haakjes en backslashes moeten worden ontsnapt, en alles buiten WinAnsi wordt
 * vervangen door een vraagteken. Dat laatste is zichtbaar fout in plaats van
 * onzichtbaar weg: een naam met een teken dat het lettertype niet kent, hoort
 * op te vallen en niet stilletjes te verdwijnen.
 */
export function escapePdfString(waarde: string): string {
  let uit = "";
  for (const teken of waarde) {
    const code = teken.codePointAt(0) ?? 63;
    if (teken === "(" || teken === ")" || teken === "\\") {
      uit += `\\${teken}`;
    } else if (code < 32) {
      uit += " ";
    } else if (code < 127) {
      uit += teken;
    } else {
      const winansi = WINANSI[teken];
      uit += winansi !== undefined ? `\\${winansi.toString(8).padStart(3, "0")}` : "?";
    }
  }
  return uit;
}

/** De tekens buiten ASCII die op een Nederlands roosterblad voorkomen. */
const WINANSI: Readonly<Record<string, number>> = {
  "é": 0xe9, "è": 0xe8, "ë": 0xeb, "ê": 0xea,
  "á": 0xe1, "à": 0xe0, "ä": 0xe4, "â": 0xe2,
  "í": 0xed, "ï": 0xef, "ó": 0xf3, "ö": 0xf6, "ô": 0xf4,
  "ú": 0xfa, "ü": 0xfc, "û": 0xfb, "ç": 0xe7, "ñ": 0xf1,
  "É": 0xc9, "Ë": 0xcb, "Ä": 0xc4, "Ö": 0xd6, "Ü": 0xdc,
  "€": 0x80, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
  "–": 0x96, "—": 0x97, "…": 0x85, "·": 0xb7, "°": 0xb0,
};

function fmt(waarde: number): string {
  return (Math.round(waarde * 100) / 100).toString();
}
