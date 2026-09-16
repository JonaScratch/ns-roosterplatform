/**
 * Het aangeleverde SVG-beeldmerk omzetten naar PDF-tekenopdrachten.
 *
 * ## Waarom niet rasteren
 *
 * Het beeldmerk is nu een echte SVG: twee paden, meer niet. Wie daar een
 * plaatje van maakt om het in een PDF te krijgen, levert een blad in waarop het
 * logo bij inzoomen of op groot papier zichtbaar korrelig wordt — en dat is
 * precies het onderdeel waaraan iemand het document herkent.
 *
 * PDF en SVG tekenen paden bijna hetzelfde. `M/L/C/Z` uit SVG zijn `m/l/c/h` in
 * PDF, met dezelfde betekenis; het verschil zit in de richting van de y-as en
 * in de transformaties die SVG bovenop een pad legt. Die twee worden hier
 * uitgerekend, en verder wordt er niets veranderd aan wat er getekend wordt.
 *
 * ## Wat er niet wordt ondersteund
 *
 * Boogsegmenten (`A`), kwadratische krommen (`Q`), verlopen, patronen en
 * doorzichtigheid. Het aangeleverde beeldmerk gebruikt ze geen van alle. Komt
 * er ooit een versie die dat wel doet, dan levert dit bestand null op en staat
 * er geen logo — geen half getekend logo, want dat is een ander logo.
 */

export interface LogoDrawing {
  /** De breedte en hoogte waarin de paden zijn uitgedrukt. */
  readonly width: number;
  readonly height: number;
  /** Kant-en-klare PDF-tekenopdrachten, in een assenstelsel vanaf linksonder. */
  readonly operations: string;
}

interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const IDENTITEIT: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Leest het beeldmerk uit een SVG-bestand.
 *
 * Levert null wanneer het bestand iets bevat wat hier niet wordt getekend. Dat
 * is met opzet hard: een beeldmerk dat "grotendeels" klopt, is geen beeldmerk.
 */
export function svgToPdfDrawing(svg: string): LogoDrawing | null {
  const kop = /<svg\b([^>]*)>/.exec(svg);
  if (!kop) {
    return null;
  }
  const breedte = Number(/\bwidth="([\d.]+)"/.exec(kop[1])?.[1] ?? "0");
  const hoogte = Number(/\bheight="([\d.]+)"/.exec(kop[1])?.[1] ?? "0");
  if (breedte <= 0 || hoogte <= 0) {
    return null;
  }

  const delen: string[] = [];

  // De transformaties van de omhullende groepen, in volgorde van buiten naar
  // binnen. Een pad erft ze allemaal.
  const groepMatrices: Matrix[] = [];
  const tokens = svg.matchAll(/<(g|path)\b([\s\S]*?)(\/?)>|<\/g>/g);

  for (const token of tokens) {
    if (token[0] === "</g>") {
      groepMatrices.pop();
      continue;
    }
    const soort = token[1];
    const attributen = token[2] ?? "";

    if (soort === "g") {
      const eigen = parseTransform(/\btransform="([^"]*)"/.exec(attributen)?.[1] ?? "");
      if (eigen === null) {
        return null;
      }
      groepMatrices.push(eigen);
      continue;
    }

    // Een pad.
    const d = /\bd="([^"]*)"/.exec(attributen)?.[1];
    if (!d) {
      continue;
    }
    const kleur = fillKleur(attributen);
    if (kleur === null) {
      // Zonder vulkleur wordt er niets zichtbaars getekend. Het aangeleverde
      // bestand begint met zo'n pad — de achtergrondrechthoek van de tekening.
      continue;
    }

    let matrix = groepMatrices.reduce(vermenigvuldig, IDENTITEIT);
    const eigen = parseTransform(/\btransform="([^"]*)"/.exec(attributen)?.[1] ?? "");
    if (eigen === null) {
      return null;
    }
    matrix = vermenigvuldig(matrix, eigen);

    const pad = padNaarPdf(d, matrix, hoogte);
    if (pad === null) {
      return null;
    }

    const evenOdd = /fill-rule\s*:\s*evenodd/.test(attributen);
    delen.push(`${kleur} rg`, pad, evenOdd ? "f*" : "f");
  }

  if (delen.length === 0) {
    return null;
  }

  return { width: breedte, height: hoogte, operations: delen.join("\n") };
}

/** De vulkleur als PDF-kleurwaarden, of null wanneer er niets gevuld wordt. */
function fillKleur(attributen: string): string | null {
  const style = /\bstyle="([^"]*)"/.exec(attributen)?.[1] ?? "";
  const uitStyle = /fill\s*:\s*(#[0-9a-fA-F]{6}|none)/.exec(style)?.[1];
  const uitAttribuut = /\bfill="(#[0-9a-fA-F]{6}|none)"/.exec(attributen)?.[1];
  const kleur = uitStyle ?? uitAttribuut;

  if (kleur === undefined || kleur === "none") {
    return null;
  }
  const r = Number.parseInt(kleur.slice(1, 3), 16) / 255;
  const g = Number.parseInt(kleur.slice(3, 5), 16) / 255;
  const b = Number.parseInt(kleur.slice(5, 7), 16) / 255;
  return `${rond(r)} ${rond(g)} ${rond(b)}`;
}

/**
 * Een SVG-transformatie naar een matrix.
 *
 * Levert null bij een vorm die hier niet wordt begrepen — dan is de tekening
 * niet betrouwbaar om te zetten, en dat moet blijken in plaats van te leiden
 * tot een verschoven logo.
 */
function parseTransform(waarde: string): Matrix | null {
  if (waarde.trim() === "") {
    return IDENTITEIT;
  }

  let matrix = IDENTITEIT;
  const patroon = /(matrix|translate|scale)\s*\(([^)]*)\)/g;
  let gevonden = false;

  for (const treffer of waarde.matchAll(patroon)) {
    gevonden = true;
    const getallen = treffer[2]
      .split(/[\s,]+/)
      .filter((deel) => deel !== "")
      .map(Number);
    if (getallen.some((getal) => !Number.isFinite(getal))) {
      return null;
    }

    if (treffer[1] === "matrix" && getallen.length === 6) {
      matrix = vermenigvuldig(matrix, {
        a: getallen[0],
        b: getallen[1],
        c: getallen[2],
        d: getallen[3],
        e: getallen[4],
        f: getallen[5],
      });
    } else if (treffer[1] === "translate") {
      matrix = vermenigvuldig(matrix, {
        ...IDENTITEIT,
        e: getallen[0],
        f: getallen[1] ?? 0,
      });
    } else if (treffer[1] === "scale") {
      matrix = vermenigvuldig(matrix, {
        ...IDENTITEIT,
        a: getallen[0],
        d: getallen[1] ?? getallen[0],
      });
    } else {
      return null;
    }
  }

  return gevonden ? matrix : null;
}

function vermenigvuldig(links: Matrix, rechts: Matrix): Matrix {
  return {
    a: links.a * rechts.a + links.c * rechts.b,
    b: links.b * rechts.a + links.d * rechts.b,
    c: links.a * rechts.c + links.c * rechts.d,
    d: links.b * rechts.c + links.d * rechts.d,
    e: links.a * rechts.e + links.c * rechts.f + links.e,
    f: links.b * rechts.e + links.d * rechts.f + links.f,
  };
}

/**
 * Een `d`-attribuut naar PDF-tekenopdrachten.
 *
 * Ondersteunt `M m L l H h V v C c Z z`. Elk punt gaat door de matrix en wordt
 * daarna in de y-as gespiegeld: SVG rekent naar beneden, PDF naar boven.
 */
function padNaarPdf(d: string, matrix: Matrix, hoogte: number): string | null {
  const opdrachten: string[] = [];
  const tokens = d.match(/[MmLlHhVvCcZz]|-?[\d.]+(?:e-?\d+)?/g);
  if (!tokens) {
    return null;
  }

  let index = 0;
  let huidigX = 0;
  let huidigY = 0;
  let startX = 0;
  let startY = 0;
  let commando = "";

  const getal = (): number => Number(tokens[index++]);
  const plaats = (x: number, y: number): string => {
    const px = matrix.a * x + matrix.c * y + matrix.e;
    const py = matrix.b * x + matrix.d * y + matrix.f;
    // SVG telt y naar beneden vanaf de bovenkant; PDF naar boven vanaf onder.
    return `${rond(px)} ${rond(hoogte - py)}`;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[MmLlHhVvCcZz]$/.test(token)) {
      commando = token;
      index += 1;
    } else if (commando === "M") {
      // Een herhaald getallenpaar na M is een impliciete lineto.
      commando = "L";
    } else if (commando === "m") {
      commando = "l";
    }

    const relatief = commando === commando.toLowerCase();
    switch (commando.toUpperCase()) {
      case "M": {
        const x = getal();
        const y = getal();
        huidigX = relatief ? huidigX + x : x;
        huidigY = relatief ? huidigY + y : y;
        startX = huidigX;
        startY = huidigY;
        opdrachten.push(`${plaats(huidigX, huidigY)} m`);
        break;
      }
      case "L": {
        const x = getal();
        const y = getal();
        huidigX = relatief ? huidigX + x : x;
        huidigY = relatief ? huidigY + y : y;
        opdrachten.push(`${plaats(huidigX, huidigY)} l`);
        break;
      }
      case "H": {
        const x = getal();
        huidigX = relatief ? huidigX + x : x;
        opdrachten.push(`${plaats(huidigX, huidigY)} l`);
        break;
      }
      case "V": {
        const y = getal();
        huidigY = relatief ? huidigY + y : y;
        opdrachten.push(`${plaats(huidigX, huidigY)} l`);
        break;
      }
      case "C": {
        const x1 = getal();
        const y1 = getal();
        const x2 = getal();
        const y2 = getal();
        const x = getal();
        const y = getal();
        const c1x = relatief ? huidigX + x1 : x1;
        const c1y = relatief ? huidigY + y1 : y1;
        const c2x = relatief ? huidigX + x2 : x2;
        const c2y = relatief ? huidigY + y2 : y2;
        huidigX = relatief ? huidigX + x : x;
        huidigY = relatief ? huidigY + y : y;
        opdrachten.push(
          `${plaats(c1x, c1y)} ${plaats(c2x, c2y)} ${plaats(huidigX, huidigY)} c`,
        );
        break;
      }
      case "Z": {
        huidigX = startX;
        huidigY = startY;
        opdrachten.push("h");
        break;
      }
      default:
        return null;
    }

    if (tokens.slice(index).some((deel) => Number.isNaN(Number(deel)) && !/^[MmLlHhVvCcZz]$/.test(deel))) {
      return null;
    }
  }

  return opdrachten.join("\n");
}

function rond(waarde: number): string {
  return (Math.round(waarde * 1000) / 1000).toString();
}
