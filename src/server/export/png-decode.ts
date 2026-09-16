import { inflateSync } from "node:zlib";

/**
 * Een PNG uitpakken tot ruwe pixels.
 *
 * ## Waarom dit nodig is
 *
 * Het aangeleverde NS-beeldmerk is een PNG. Een PDF kan een PNG niet zomaar
 * doorgeven: de compressie is dezelfde (deflate), maar PNG legt er nog een
 * filterlaag overheen die per beeldrij verschilt. Wie de PNG-bytes
 * rechtstreeks in een PDF-afbeelding stopt, krijgt bij sommige bestanden een
 * plaatje en bij andere ruis — en welke van de twee, hangt af van keuzes die de
 * maker van het bestand ooit heeft gemaakt.
 *
 * Voor het beeldmerk van NS is "soms ruis" geen optie. Het wordt daarom
 * volledig uitgepakt: de filters worden ongedaan gemaakt en de pixels gaan er
 * onbewerkt in.
 *
 * ## Wat er wordt ondersteund
 *
 * 8 bits per kanaal, kleurtypes 0 (grijs), 2 (RGB), 4 (grijs met alfa) en 6
 * (RGBA). Geen palet, geen interlacing, geen 16 bits. Wat er niet in staat,
 * levert null op — en de aanroeper moet daar iets mee, want een beeldmerk dat
 * ontbreekt is iets anders dan een beeldmerk dat wit is.
 */

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Drie bytes per pixel, rij voor rij. Alfa is al over wit samengesteld. */
  readonly rgb: Buffer;
}

const HANDTEKENING = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(bytes: Buffer): DecodedPng | null {
  if (!bytes.subarray(0, 8).equals(HANDTEKENING)) {
    return null;
  }

  let breedte = 0;
  let hoogte = 0;
  let bitDiepte = 0;
  let kleurType = 0;
  let interlace = 0;
  const data: Buffer[] = [];

  let index = 8;
  while (index + 8 <= bytes.length) {
    const lengte = bytes.readUInt32BE(index);
    const soort = bytes.toString("latin1", index + 4, index + 8);
    const inhoud = bytes.subarray(index + 8, index + 8 + lengte);

    if (soort === "IHDR") {
      breedte = inhoud.readUInt32BE(0);
      hoogte = inhoud.readUInt32BE(4);
      bitDiepte = inhoud[8];
      kleurType = inhoud[9];
      interlace = inhoud[12];
    } else if (soort === "IDAT") {
      data.push(inhoud);
    } else if (soort === "IEND") {
      break;
    }
    index += 12 + lengte;
  }

  // Uitdrukkelijk weigeren in plaats van iets benaderen: een half uitgepakt
  // beeldmerk is een verminkt logo, en dat is erger dan geen logo.
  if (bitDiepte !== 8 || interlace !== 0 || breedte === 0 || hoogte === 0) {
    return null;
  }
  const kanalen = KANALEN[kleurType];
  if (kanalen === undefined) {
    return null;
  }

  let rauw: Buffer;
  try {
    rauw = inflateSync(Buffer.concat(data));
  } catch {
    return null;
  }

  const stap = kanalen;
  const rijLengte = breedte * stap;
  if (rauw.length < hoogte * (rijLengte + 1)) {
    return null;
  }

  // ── De filters ongedaan maken ───────────────────────────────────────────
  // Elke rij begint met een filterbyte. De filters verwijzen naar de pixel
  // links (a), boven (b) en linksboven (c) — en dat is de reden dat dit niet
  // rij voor rij los kan: rij 40 hangt af van rij 39.
  const uitgepakt = Buffer.alloc(hoogte * rijLengte);
  for (let rij = 0; rij < hoogte; rij += 1) {
    const filter = rauw[rij * (rijLengte + 1)];
    const bron = rij * (rijLengte + 1) + 1;
    const doel = rij * rijLengte;

    for (let kolom = 0; kolom < rijLengte; kolom += 1) {
      const x = rauw[bron + kolom];
      const a = kolom >= stap ? uitgepakt[doel + kolom - stap] : 0;
      const b = rij > 0 ? uitgepakt[doel - rijLengte + kolom] : 0;
      const c = rij > 0 && kolom >= stap ? uitgepakt[doel - rijLengte + kolom - stap] : 0;

      let waarde: number;
      switch (filter) {
        case 0:
          waarde = x;
          break;
        case 1:
          waarde = x + a;
          break;
        case 2:
          waarde = x + b;
          break;
        case 3:
          waarde = x + Math.floor((a + b) / 2);
          break;
        case 4:
          waarde = x + paeth(a, b, c);
          break;
        default:
          return null;
      }
      uitgepakt[doel + kolom] = waarde & 0xff;
    }
  }

  // ── Naar RGB, met alfa over wit ─────────────────────────────────────────
  // Een PDF-afbeelding zonder softmask kent geen doorzichtigheid. Het logo
  // staat op een witte kop, dus samenstellen over wit levert exact hetzelfde
  // beeld op als wat de gebruiker op het scherm ziet.
  const rgb = Buffer.alloc(breedte * hoogte * 3);
  for (let pixel = 0; pixel < breedte * hoogte; pixel += 1) {
    const bron = pixel * stap;
    let r: number;
    let g: number;
    let b: number;
    let alpha = 255;

    if (kleurType === 0) {
      r = g = b = uitgepakt[bron];
    } else if (kleurType === 4) {
      r = g = b = uitgepakt[bron];
      alpha = uitgepakt[bron + 1];
    } else if (kleurType === 2) {
      r = uitgepakt[bron];
      g = uitgepakt[bron + 1];
      b = uitgepakt[bron + 2];
    } else {
      r = uitgepakt[bron];
      g = uitgepakt[bron + 1];
      b = uitgepakt[bron + 2];
      alpha = uitgepakt[bron + 3];
    }

    const meng = (kanaal: number): number =>
      Math.round((kanaal * alpha + 255 * (255 - alpha)) / 255);
    rgb[pixel * 3] = meng(r);
    rgb[pixel * 3 + 1] = meng(g);
    rgb[pixel * 3 + 2] = meng(b);
  }

  return { width: breedte, height: hoogte, rgb };
}

const KANALEN: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** De Paeth-voorspeller uit de PNG-specificatie. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}
