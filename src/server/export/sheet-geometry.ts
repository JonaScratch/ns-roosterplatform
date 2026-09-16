import { readPdfObjects } from "@/server/import/pdf-text";

/**
 * De opmaak van een PDF terugmeten.
 *
 * ## Waarvoor dit bestaat
 *
 * Het aangeleverde NS-roosterblad is de canonieke vormgeving. Om te kunnen
 * zeggen dat ons blad daarop lijkt, moet je het kunnen nameten — niet ernaar
 * kijken en vinden dat het klopt. Deze module haalt uit een PDF elke tekst met
 * haar positie, lettergrootte en dikte, en elke lijn met haar begin- en
 * eindpunt.
 *
 * ## Waarom dit geen beeldvergelijking is
 *
 * Twee PDF's als plaatje vergelijken vraagt een renderer, en die is er hier
 * niet. Belangrijker: een beeldverschil zegt "er is iets anders" en niet wát.
 * Posities vergelijken zegt precies dat de dagkolom drie punten is opgeschoven
 * of dat de samenvatting een regel mist — en dat is wat je moet weten om het te
 * repareren.
 */

export interface GeometryText {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly font: string;
  readonly value: string;
}

export interface GeometryLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width: number;
}

export interface SheetGeometry {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly texts: readonly GeometryText[];
  readonly lines: readonly GeometryLine[];
  readonly images: number;
}

/**
 * De opmaak van de eerste pagina.
 *
 * Herkent de twee vormen waarin tekst geplaatst wordt: met een `cm`-translatie
 * (zoals het NS-blad doet) en met een `Td`-verplaatsing (zoals onze eigen
 * schrijver doet). Beide leveren dezelfde coördinaat op; dat de bestanden hem
 * anders opschrijven, mag voor een vergelijking niet uitmaken.
 */
export function readSheetGeometry(bytes: Buffer): SheetGeometry {
  const objecten = readPdfObjects(bytes);
  const pagina = [...objecten.values()].find((object) =>
    /\/Type\s*\/Page(?![s])/.test(object.body),
  );
  if (!pagina) {
    return { pageWidth: 0, pageHeight: 0, texts: [], lines: [], images: 0 };
  }

  const mediaBox = /\/MediaBox\s*\[([^\]]+)\]/.exec(pagina.body)?.[1] ?? "0 0 0 0";
  const [, , breedte, hoogte] = mediaBox.trim().split(/\s+/).map(Number);

  const verwijzing = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pagina.body);
  const stroom = verwijzing
    ? (objecten.get(Number(verwijzing[1]))?.stream?.toString("latin1") ?? "")
    : "";

  const texts: GeometryText[] = [];

  // Vorm 1: het NS-blad — /Fn size Tf, dan een cm-translatie.
  for (const treffer of stroom.matchAll(
    /BT\s*\/(\w+)\s+([\d.]+)\s+Tf\s*1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s*1 0 0 1 0 0 Tm\s*\(((?:[^\\()]|\\.)*)\)\s*Tj\s*ET/g,
  )) {
    texts.push({
      font: treffer[1],
      size: Number(treffer[2]),
      x: Number(treffer[3]),
      y: Number(treffer[4]),
      value: ontsnap(treffer[5]),
    });
  }

  // Vorm 2: onze eigen schrijver — /Fn size Tf, grijswaarde, dan Td.
  for (const treffer of stroom.matchAll(
    /BT\s*\/(\w+)\s+([\d.]+)\s+Tf\s+[\d.]+\s+g\s+([\d.-]+)\s+([\d.-]+)\s+Td\s*\(((?:[^\\()]|\\.)*)\)\s*Tj\s*ET/g,
  )) {
    texts.push({
      font: treffer[1],
      size: Number(treffer[2]),
      x: Number(treffer[3]),
      y: Number(treffer[4]),
      value: ontsnap(treffer[5]),
    });
  }

  const lines: GeometryLine[] = [];

  // Vorm 1: een cm-translatie met een relatieve lijn.
  for (const treffer of stroom.matchAll(
    /1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s*0 0 m\s*([\d.-]+) ([\d.-]+) l\s*([\d.]+) w/g,
  )) {
    const x = Number(treffer[1]);
    const y = Number(treffer[2]);
    lines.push({
      x1: x,
      y1: y,
      x2: x + Number(treffer[3]),
      y2: y + Number(treffer[4]),
      width: Number(treffer[5]),
    });
  }

  // Vorm 2: absolute coördinaten.
  for (const treffer of stroom.matchAll(
    /([\d.]+) G ([\d.]+) w ([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/g,
  )) {
    lines.push({
      x1: Number(treffer[3]),
      y1: Number(treffer[4]),
      x2: Number(treffer[5]),
      y2: Number(treffer[6]),
      width: Number(treffer[2]),
    });
  }

  return {
    pageWidth: breedte,
    pageHeight: hoogte,
    texts,
    lines,
    images: (stroom.match(/\/\w+ Do/g) ?? []).length,
  };
}

function ontsnap(waarde: string): string {
  return waarde
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\(\d{1,3})/g, (_, octaal: string) => String.fromCharCode(parseInt(octaal, 8)));
}

/** De x-posities waarop tekst staat, ontdubbeld en gesorteerd. */
export function textColumns(geometry: SheetGeometry, tolerance = 0.5): readonly number[] {
  const kolommen: number[] = [];
  for (const tekst of [...geometry.texts].sort((a, b) => a.x - b.x)) {
    if (kolommen.length === 0 || Math.abs(kolommen[kolommen.length - 1] - tekst.x) > tolerance) {
      kolommen.push(tekst.x);
    }
  }
  return kolommen;
}

/** Zoekt de tekst die op een bepaalde plek hoort te staan. */
export function textAt(
  geometry: SheetGeometry,
  x: number,
  y: number,
  tolerance = 1.5,
): GeometryText | null {
  return (
    geometry.texts.find(
      (tekst) => Math.abs(tekst.x - x) <= tolerance && Math.abs(tekst.y - y) <= tolerance,
    ) ?? null
  );
}

/** Alle teksten op ongeveer dezelfde hoogte, van links naar rechts. */
export function textRow(
  geometry: SheetGeometry,
  y: number,
  tolerance = 1.5,
): readonly GeometryText[] {
  return geometry.texts
    .filter((tekst) => Math.abs(tekst.y - y) <= tolerance)
    .sort((a, b) => a.x - b.x);
}
