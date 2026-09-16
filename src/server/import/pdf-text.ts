import { inflateSync } from "node:zlib";

/**
 * Tekst uit een PDF halen, ook wanneer die niet in leesbare bytes staat.
 *
 * ## Waarom dit nodig is
 *
 * De roosterbladen zijn eenvoudig: hun tekststrings staan er in gewone bytes
 * en `roster-pdf.ts` leest ze rechtstreeks. De CAO is dat niet. Die is opgemaakt
 * in InDesign, gebruikt subset-lettertypen met een eigen codering, en bewaart
 * bijna al zijn objecten in objectstromen. Wie de bytes daar rechtstreeks leest,
 * krijgt betekenisloze tekens terug — geen foutmelding, gewoon onzin.
 *
 * Dat verschil is het gevaar. Een lezer die stilletjes onzin oplevert, ziet er
 * van buiten uit als een lezer die niets vond, en beide zien er uit als "de
 * bron zegt hier niets over". Voor een regelbestand dat bepaalt of iemand mag
 * rijden, is dat het verkeerde soort stilte.
 *
 * ## Wat er wordt gedaan
 *
 * 1. alle indirecte objecten uit het bestand halen;
 * 2. de objectstromen uitpakken, want daar zit hier het meeste in;
 * 3. per lettertype de ToUnicode-tabel lezen die de codes op tekens afbeeldt;
 * 4. de pagina-inhoud aflopen en elke tekststring door de tabel van het op dat
 *    moment gekozen lettertype halen.
 *
 * ## Wat er uitdrukkelijk niet wordt gedaan
 *
 * Geen OCR. Een PDF zonder tekstlaag — een scan — levert hier niets op, en dat
 * hoort ook niet stilzwijgend te worden aangevuld met een gok over wat er op
 * het plaatje staat. `hasTextLayer()` zegt met zoveel woorden of er iets te
 * lezen valt.
 */

export interface PdfObject {
  readonly num: number;
  /** De woordenboekinhoud van het object, als tekst. */
  readonly body: string;
  /** De uitgepakte stroom, of null wanneer het object er geen heeft. */
  readonly stream: Buffer | null;
}

// ── Objecten ─────────────────────────────────────────────────────────────────

/**
 * Alle indirecte objecten, inclusief die uit objectstromen.
 *
 * Er wordt bewust niet via de kruisverwijzingstabel gewerkt maar door het hele
 * bestand te scannen. Dat is trager, maar het vindt ook objecten in een bestand
 * met een beschadigde of incrementeel bijgewerkte tabel — en het kan niet
 * gebeuren dat een verkeerd verschoven verwijzing ons naar de verkeerde inhoud
 * leidt zonder dat iemand het merkt.
 */
export function readPdfObjects(bytes: Buffer): Map<number, PdfObject> {
  const objecten = new Map<number, PdfObject>();
  const tekst = bytes.toString("latin1");
  const kop = /(\d+)\s+(\d+)\s+obj\b/g;

  for (const treffer of tekst.matchAll(kop)) {
    const nummer = Number(treffer[1]);
    const begin = treffer.index + treffer[0].length;
    const einde = tekst.indexOf("endobj", begin);
    if (einde === -1) {
      continue;
    }

    const streamIndex = tekst.indexOf("stream", begin);
    const heeftStroom = streamIndex !== -1 && streamIndex < einde;
    const body = tekst.slice(begin, heeftStroom ? streamIndex : einde);

    let stream: Buffer | null = null;
    if (heeftStroom) {
      let inhoud = streamIndex + "stream".length;
      if (bytes[inhoud] === 0x0d) {
        inhoud += 1;
      }
      if (bytes[inhoud] === 0x0a) {
        inhoud += 1;
      }
      const stroomEinde = tekst.indexOf("endstream", inhoud);
      if (stroomEinde !== -1) {
        const rauw = bytes.subarray(inhoud, stroomEinde);
        stream = /\/FlateDecode/.test(body) ? probeerUitpakken(rauw) : rauw;
      }
    }

    objecten.set(nummer, { num: nummer, body, stream });
  }

  // Objectstromen bevatten hun eigen objecten. Die staan nergens anders in het
  // bestand, dus zonder deze stap mist de helft van de tekst zonder melding.
  for (const object of [...objecten.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(object.body) || !object.stream) {
      continue;
    }
    for (const kind of leesObjectStroom(object)) {
      // Een los object in het bestand gaat vóór; dat is de nieuwere versie.
      if (!objecten.has(kind.num)) {
        objecten.set(kind.num, kind);
      }
    }
  }

  return objecten;
}

function probeerUitpakken(rauw: Buffer): Buffer | null {
  try {
    return inflateSync(rauw);
  } catch {
    return null;
  }
}

/** De objecten die in één objectstroom verpakt zitten. */
function leesObjectStroom(stroom: PdfObject): readonly PdfObject[] {
  const aantal = Number(/\/N\s+(\d+)/.exec(stroom.body)?.[1] ?? "0");
  const eerste = Number(/\/First\s+(\d+)/.exec(stroom.body)?.[1] ?? "0");
  if (!stroom.stream || aantal === 0) {
    return [];
  }

  const inhoud = stroom.stream.toString("latin1");
  const kopregel = inhoud.slice(0, eerste).trim().split(/\s+/).map(Number);
  const uit: PdfObject[] = [];

  for (let i = 0; i < aantal; i += 1) {
    const nummer = kopregel[i * 2];
    const verschuiving = kopregel[i * 2 + 1];
    if (!Number.isFinite(nummer) || !Number.isFinite(verschuiving)) {
      continue;
    }
    const volgende = i + 1 < aantal ? kopregel[i * 2 + 3] : undefined;
    const begin = eerste + verschuiving;
    const einde = volgende === undefined ? inhoud.length : eerste + volgende;
    uit.push({ num: nummer, body: inhoud.slice(begin, einde), stream: null });
  }
  return uit;
}

// ── ToUnicode ────────────────────────────────────────────────────────────────

export interface CMap {
  /** Hoeveel bytes één teken beslaat: 1 bij eenvoudige lettertypen, 2 bij CID. */
  readonly codeLength: number;
  readonly map: ReadonlyMap<number, string>;
}

/**
 * Een ToUnicode-tabel lezen.
 *
 * De tabel komt in twee vormen: losse paren (`bfchar`) en bereiken (`bfrange`).
 * Een bereik kan een beginwaarde noemen die per code oploopt, of een lijst met
 * één bestemming per code. Beide komen voor in hetzelfde bestand.
 *
 * ## Waarom de codebreedte niet uit de codespacerange komt
 *
 * Die zou het moeten zeggen, en zegt hier iets anders. De CAO is opgemaakt met
 * Adobe-gereedschap dat bij elk lettertype `<0000> <FFFF>` neerzet — twee bytes
 * — terwijl de tabel eronder codes van één byte opsomt (`<1D>`, `<20>`). Wie de
 * opgave gelooft, leest elke twee tekens als één en houdt lege tekst over.
 *
 * De codes in de tabel zelf liegen niet: hun lengte ís de breedte. Die wordt
 * daarom gemeten en niet gevraagd.
 */
export function parseCMap(inhoud: string): CMap {
  const map = new Map<number, string>();

  let codeLength = 1;
  const meetCode = (hex: string): void => {
    codeLength = Math.max(codeLength, Math.ceil(hex.length / 2));
  };

  for (const blok of inhoud.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const paar of blok[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      meetCode(paar[1]);
      map.set(parseInt(paar[1], 16), naarTekst(paar[2]));
    }
  }

  for (const blok of inhoud.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const regels = blok[1];

    // Vorm met een lijst: <lo> <hi> [<a> <b> <c>]
    for (const rij of regels.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      meetCode(rij[1]);
      const lo = parseInt(rij[1], 16);
      let i = 0;
      for (const item of rij[3].matchAll(/<([0-9A-Fa-f]*)>/g)) {
        map.set(lo + i, naarTekst(item[1]));
        i += 1;
      }
    }

    // Vorm met een oplopende beginwaarde: <lo> <hi> <start>
    for (const rij of regels.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      meetCode(rij[1]);
      const lo = parseInt(rij[1], 16);
      const hi = parseInt(rij[2], 16);
      const start = rij[3];
      // Een bereik van duizenden codes is bijna altijd een leesfout in plaats
      // van een echte tabel; die niet uitrollen scheelt een vastloper.
      if (hi < lo || hi - lo > 65535) {
        continue;
      }
      for (let code = lo; code <= hi; code += 1) {
        const laatste = parseInt(start.slice(-4), 16) + (code - lo);
        const voorvoegsel = start.slice(0, -4);
        map.set(code, naarTekst(voorvoegsel + laatste.toString(16).padStart(4, "0")));
      }
    }
  }

  return { codeLength, map };
}

/** Een reeks UTF-16BE-codepunten als hex omzetten naar tekst. */
function naarTekst(hex: string): string {
  let uit = "";
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const stuk = hex.slice(i, i + 4);
    if (stuk.length === 4) {
      uit += String.fromCharCode(parseInt(stuk, 16));
    }
  }
  return uit;
}

// ── Pagina's ─────────────────────────────────────────────────────────────────

/**
 * De leesbare tekst van een PDF, pagina voor pagina.
 *
 * Levert een lege lijst wanneer het bestand geen tekstlaag heeft. Dat is een
 * uitkomst en geen fout: een scan bevat werkelijk geen tekst.
 */
export function pdfPages(bytes: Buffer): readonly string[] {
  const objecten = readPdfObjects(bytes);

  // Per lettertype-object zijn ToUnicode-tabel.
  const tabelPerFont = new Map<number, CMap>();
  for (const object of objecten.values()) {
    const verwijzing = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(object.body);
    if (!verwijzing) {
      continue;
    }
    const tabelObject = objecten.get(Number(verwijzing[1]));
    if (tabelObject?.stream) {
      tabelPerFont.set(object.num, parseCMap(tabelObject.stream.toString("latin1")));
    }
  }

  const paginas: string[] = [];
  for (const object of objecten.values()) {
    if (!/\/Type\s*\/Page(?![s])/.test(object.body)) {
      continue;
    }

    // De namen waarmee de pagina naar haar lettertypen verwijst.
    const namen = new Map<string, CMap>();
    const fontDeel = /\/Font\s*<<([\s\S]*?)>>/.exec(object.body);
    if (fontDeel) {
      for (const paar of fontDeel[1].matchAll(/\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g)) {
        const tabel = tabelPerFont.get(Number(paar[2]));
        if (tabel) {
          namen.set(paar[1], tabel);
        }
      }
    }

    const inhoud = paginaInhoud(object, objecten);
    if (inhoud) {
      paginas.push(leesInhoudsstroom(inhoud, namen));
    }
  }

  return paginas;
}

/** Alle tekst van het bestand achter elkaar. */
export function pdfPlainText(bytes: Buffer): string {
  return pdfPages(bytes).join("\n\n");
}

/** Of er überhaupt iets te lezen valt. Een scan levert hier false op. */
export function hasTextLayer(bytes: Buffer): boolean {
  return pdfPlainText(bytes).replace(/\s+/g, "").length > 0;
}

function paginaInhoud(pagina: PdfObject, objecten: Map<number, PdfObject>): string | null {
  const enkel = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pagina.body);
  if (enkel) {
    return objecten.get(Number(enkel[1]))?.stream?.toString("latin1") ?? null;
  }
  const reeks = /\/Contents\s*\[([\s\S]*?)\]/.exec(pagina.body);
  if (reeks) {
    const delen: string[] = [];
    for (const verwijzing of reeks[1].matchAll(/(\d+)\s+\d+\s+R/g)) {
      const stroom = objecten.get(Number(verwijzing[1]))?.stream;
      if (stroom) {
        delen.push(stroom.toString("latin1"));
      }
    }
    return delen.length > 0 ? delen.join("\n") : null;
  }
  return null;
}

/**
 * Een inhoudsstroom aflopen en de tekst eruit halen.
 *
 * De stroom is een reeks operatoren. Alleen die van belang zijn worden gevolgd:
 * `Tf` kiest een lettertype, `Tj` en `TJ` zetten tekst, `Td`, `TD`, `T*` en `ET`
 * betekenen een nieuwe regel. Een grote negatieve verschuiving binnen `TJ` is in
 * de praktijk een spatie; zonder die aanname plakken woorden aan elkaar.
 */
function leesInhoudsstroom(stroom: string, namen: ReadonlyMap<string, CMap>): string {
  let uit = "";
  let huidige: CMap | null = null;

  const patroon =
    /\/([^\s/<>[\]]+)\s+[\d.]+\s+Tf|\[((?:[^\][\\]|\\.)*)\]\s*TJ|\((?:[^\\()]|\\.)*\)\s*Tj|<([0-9A-Fa-f\s]*)>\s*Tj|(T\*|Td|TD|ET)/g;

  for (const treffer of stroom.matchAll(patroon)) {
    if (treffer[1] !== undefined) {
      huidige = namen.get(treffer[1]) ?? null;
    } else if (treffer[2] !== undefined) {
      uit += leesArray(treffer[2], huidige);
    } else if (treffer[3] !== undefined) {
      uit += decodeer(treffer[3].replace(/\s+/g, ""), huidige, true);
    } else if (treffer[4] !== undefined) {
      uit += "\n";
    } else {
      // (…) Tj
      const letterlijk = /\(((?:[^\\()]|\\.)*)\)/.exec(treffer[0]);
      if (letterlijk) {
        uit += decodeer(letterlijk[1], huidige, false);
      }
    }
  }

  return uit
    .split("\n")
    .map((regel) => regel.replace(/[ \t]+/g, " ").trim())
    .filter((regel) => regel.length > 0)
    .join("\n");
}

function leesArray(inhoud: string, font: CMap | null): string {
  let uit = "";
  const patroon = /\(((?:[^\\()]|\\.)*)\)|<([0-9A-Fa-f\s]*)>|(-?[\d.]+)/g;
  for (const deel of inhoud.matchAll(patroon)) {
    if (deel[1] !== undefined) {
      uit += decodeer(deel[1], font, false);
    } else if (deel[2] !== undefined) {
      uit += decodeer(deel[2].replace(/\s+/g, ""), font, true);
    } else if (Number(deel[3]) < -100) {
      uit += " ";
    }
  }
  return uit;
}

/**
 * Eén tekststring omzetten naar tekens.
 *
 * Zonder tabel worden de bytes als Latin-1 gelezen. Dat klopt voor eenvoudige
 * lettertypen met een standaardcodering en is fout voor een subset-lettertype —
 * maar dan is het resultaat zichtbaar onzin en niet stilzwijgend net verkeerd.
 */
function decodeer(rauw: string, font: CMap | null, isHex: boolean): string {
  const bytes: number[] = [];
  if (isHex) {
    const even = rauw.length % 2 === 0 ? rauw : `${rauw}0`;
    for (let i = 0; i < even.length; i += 2) {
      bytes.push(parseInt(even.slice(i, i + 2), 16));
    }
  } else {
    // De ontsnappingen van PDF, waaronder de octale vorm `\037`. Die laatste
    // is geen randgeval: de CAO gebruikt hem voor elke spatie in een kop, en
    // wie hem als vier losse tekens leest, krijgt "CAO NS0372024" terug — geen
    // foutmelding, alleen tekst die er net genoeg uitziet om te blijven staan.
    for (let i = 0; i < rauw.length; i += 1) {
      if (rauw[i] !== "\\") {
        bytes.push(rauw.charCodeAt(i) & 0xff);
        continue;
      }
      const volgend = rauw[i + 1];
      const octaal = /^[0-7]{1,3}/.exec(rauw.slice(i + 1, i + 4));
      if (octaal) {
        bytes.push(parseInt(octaal[0], 8) & 0xff);
        i += octaal[0].length;
      } else if (volgend === "n") {
        bytes.push(0x0a);
        i += 1;
      } else if (volgend === "r") {
        bytes.push(0x0d);
        i += 1;
      } else if (volgend === "t") {
        bytes.push(0x09);
        i += 1;
      } else if (volgend !== undefined) {
        bytes.push(rauw.charCodeAt(i + 1) & 0xff);
        i += 1;
      }
    }
  }

  if (!font) {
    return String.fromCharCode(...bytes);
  }

  let uit = "";
  const breedte = font.codeLength;
  for (let i = 0; i < bytes.length; i += breedte) {
    let code = 0;
    for (let b = 0; b < breedte; b += 1) {
      code = (code << 8) | (bytes[i + b] ?? 0);
    }
    uit += font.map.get(code) ?? "";
  }
  return uit;
}
