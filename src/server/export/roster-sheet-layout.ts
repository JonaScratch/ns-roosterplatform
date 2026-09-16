/**
 * Het NS-roosterblad, nagemeten uit het aangeleverde blad.
 *
 * ## Waarom hier getallen staan en geen ontwerp
 *
 * De coördinaten in dit bestand zijn niet gekozen maar gemeten. Zij komen uit
 * `tests/fixtures/dordrecht-bronnen/50+ mix 1.pdf` — het echte blad dat NS
 * uitdraait — door de inhoudsstroom ervan uit te lezen en de posities van elke
 * tekst en elke lijn op te schrijven.
 *
 * Dat is met opzet. Een machinist herkent zijn roosterblad aan de vorm: de
 * samenvatting links, de zeven dagkolommen, het dienstnummer met de tijd
 * eronder. Een blad dat dezelfde gegevens in een andere vorm toont, is voor de
 * lezer een ander document — en dan is de eerste vraag niet "klopt mijn
 * rooster" maar "waar kijk ik naar".
 *
 * ## Eén opmaak, twee uitvoerformaten
 *
 * Deze module levert primitieven: tekst, lijnen, een afbeelding, met
 * coördinaten. De PDF-schrijver en de schermvoorvertoning tekenen allebei
 * diezelfde lijst. Zo kán de voorvertoning niet iets anders tonen dan wat er in
 * het bestand komt — niet omdat we dat afspreken, maar omdat er maar één
 * berekening is.
 *
 * ## Het assenstelsel
 *
 * PDF rekent vanaf linksonder. Dat is hier overgenomen in plaats van omgerekend,
 * omdat de gemeten waarden dan letterlijk terug te vinden zijn in het originele
 * bestand. De schermvoorvertoning spiegelt zelf.
 */

// ── De gemeten maten ─────────────────────────────────────────────────────────

/** A4 liggend, zoals de MediaBox van het aangeleverde blad. */
export const SHEET = { width: 841.89, height: 595.28 } as const;

const KOP = {
  /** Labelkolom links, de dubbele punt en de waarde. */
  labelX: 19.77,
  colonX: 214.04,
  valueX: 228.44,
  /** Dezelfde drie voor de rechterkolom. */
  rightLabelX: 422.71,
  rightColonX: 616.99,
  rightValueX: 631.39,
  firstY: 523.49,
  lineHeight: 13.38,
  size: 9,
} as const;

const LOGO = { x: 733, y: 547.93, width: 75, height: 29.35 } as const;

const KOLOMKOP = {
  /** "Incl" / "Excl" staan op twee regels. */
  inclX: 227.82,
  exclX: 266.42,
  pauzeInclX: 225.19,
  pauzeExclX: 264.79,
  topY: 468.11,
  bottomY: 457.73,
  dayY: 469.61,
  dayOffsetX: 2.52,
  size: 9,
} as const;

const RASTER = {
  /** De linkerrand van de eerste dagkolom. */
  firstDayX: 295.2,
  dayWidth: 75.5257,
  /** De bovenkant van de eerste roosterregel. */
  topY: 453.44,
  // 31.605, niet 31.6: over zes regels scheelt dat 0,03 punt op de onderrand,
  // en dan valt de onderste lijn net naast die van het origineel.
  rowHeight: 31.605,
  /** Waar de verticale lijnen beginnen. */
  headerTopY: 480.95,
  headerRuleY: 480.57,
  topRuleY: 453.07,
  ruleLeftX: 172.8,
  ruleRightX: 823.14,
  outerLeftX: 18,
  outerRightX: 823.89,
  lineWidth: 0.75,
} as const;

/** De x-posities van de verticale lijnen, links van het dagraster. */
const VERTICAAL_LINKS = [18.38, 173.17, 216.37, 255.97, 295.57] as const;

/**
 * De scheidingen tussen de dagkolommen, zoals gemeten.
 *
 * Niet berekend uit een kolombreedte. De laatste kolom van het origineel is
 * smaller dan de andere zes — de rechterrand ligt op 823.51 en niet op wat de
 * regelmaat zou voorspellen. Wie hier een pitch invult, krijgt een blad dat op
 * één plek 0,75 punt afwijkt van het origineel, precies op de buitenrand waar
 * het opvalt.
 */
const VERTICAAL_DAGEN = [371.1, 446.63, 522.15, 597.68, 673.21, 748.73, 823.51] as const;
/** Waar de twee lijnen beginnen die alleen naast de roosterregels lopen. */
const VERTICAAL_KORT = new Set([18.38, 173.17]);

const REGEL = {
  labelX: 175.32,
  labelOffsetY: 11.34,
  inclX: 236.11,
  exclX: 275.71,
  urenOffsetY: 10.03,
  size: 9,
  cellSize: 8,
} as const;

const CEL = {
  codeOffsetX: 3.79,
  durationOffsetX: 55.56,
  timeOffsetX: 18.73,
  firstLineOffsetY: 12.53,
  secondLineOffsetY: 26.46,
} as const;

const SAMENVATTING = {
  nameX: 20.52,
  labelX: 21.99,
  valueX: 105.39,
  secondValueX: 143.19,
  firstOffsetY: 24.21,
  lineHeight: 12.21,
  size: 8,
} as const;

const VOET = {
  printedX: 19.8,
  userX: 423.53,
  sheetLabelX: 743.27,
  sheetNumberX: 778.69,
  y: 28.37,
  sheetY: 26.87,
  size: 10,
  bandTopY: 39.6,
} as const;

// ── Het model ────────────────────────────────────────────────────────────────

/** Eén dagcel zoals het blad haar toont. */
export interface SheetCell {
  /** Dienstnummer, of de aanduiding van een structurele dag: R, RES, WR, CO. */
  readonly code: string;
  /** De duur zoals het blad die toont. Null wanneer het blad er geen toont. */
  readonly duration: string | null;
  /** "13:08 - 21:41". Alleen bij een concrete dienst. */
  readonly timeRange: string | null;
}

export interface SheetLine {
  readonly lineNumber: number;
  readonly hoursIncludingBreak: string;
  readonly hoursExcludingBreak: string;
  /** Zeven cellen, maandag tot en met zondag. */
  readonly cells: readonly SheetCell[];
}

/** Eén regel in de samenvatting links. */
export interface SummaryField {
  readonly label: string;
  readonly value: string;
  /** Een tweede kolom, zoals bij "Gemiddelde weeklengte" incl. en excl. pauze. */
  readonly secondValue?: string;
}

export interface RosterSheet {
  readonly locationName: string;
  readonly rosterVariant: string;
  readonly role: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly rosterName: string;
  readonly summary: readonly SummaryField[];
  readonly lines: readonly SheetLine[];
  readonly printedAt: string;
  readonly user: string;
  /** Wordt het blad als simulatie afgestempeld? */
  readonly simulation: boolean;
  readonly simulationLabel: string;
  readonly hasLogo: boolean;
}

// ── De primitieven ───────────────────────────────────────────────────────────

export type SheetPrimitive =
  | {
      readonly kind: "text";
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly bold: boolean;
      readonly value: string;
    }
  | {
      readonly kind: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly width: number;
    }
  | { readonly kind: "image"; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: "watermark"; readonly value: string };

export interface SheetPage {
  readonly primitives: readonly SheetPrimitive[];
  readonly pageNumber: number;
  readonly pageCount: number;
}

/**
 * Hoeveel roosterregels er op één blad passen.
 *
 * Het raster begint op 453.07 en de voetband op 39.6. Bij een regelhoogte van
 * 31.6 passen er dertien; met marge houden we er twaalf aan, wat precies het
 * grootste Dordrechtse rooster is. Grotere roosters krijgen een tweede blad in
 * plaats van kleinere regels: onleesbaar is erger dan een blad extra.
 */
export const LINES_PER_SHEET = Math.floor((RASTER.topRuleY - VOET.bandTopY) / RASTER.rowHeight);

/** Het blad als bladen met primitieven. */
export function layoutRosterSheet(sheet: RosterSheet): readonly SheetPage[] {
  const paginas: SheetPage[] = [];
  const aantal = Math.max(1, Math.ceil(sheet.lines.length / LINES_PER_SHEET));

  for (let index = 0; index < aantal; index += 1) {
    const regels = sheet.lines.slice(
      index * LINES_PER_SHEET,
      (index + 1) * LINES_PER_SHEET,
    );
    paginas.push({
      pageNumber: index + 1,
      pageCount: aantal,
      primitives: paginaPrimitieven(sheet, regels, index + 1, aantal),
    });
  }
  return paginas;
}

function paginaPrimitieven(
  sheet: RosterSheet,
  regels: readonly SheetLine[],
  pagina: number,
  paginas: number,
): readonly SheetPrimitive[] {
  const uit: SheetPrimitive[] = [];
  const tekst = (
    x: number,
    y: number,
    value: string,
    size: number,
    bold = false,
  ): void => {
    if (value !== "") {
      uit.push({ kind: "text", x, y, size, bold, value });
    }
  };

  // Het stempel gaat er als eerste in, zodat alles erna eroverheen staat.
  if (sheet.simulation) {
    uit.push({ kind: "watermark", value: sheet.simulationLabel });
  }

  // ── De kop ───────────────────────────────────────────────────────────────
  const kopregels: readonly [string, string, string | null, string | null][] = [
    ["Standplaats", sheet.locationName, null, null],
    ["Roostervariant", sheet.rosterVariant, "Startdatum", sheet.startDate],
    ["Rol", sheet.role, "Einddatum", sheet.endDate],
  ];
  for (const [index, [label, waarde, rechtsLabel, rechtsWaarde]] of kopregels.entries()) {
    const y = KOP.firstY - index * KOP.lineHeight;
    tekst(KOP.labelX, y, label, KOP.size, true);
    tekst(KOP.colonX, y, ":", KOP.size);
    tekst(KOP.valueX, y, waarde, KOP.size);
    if (rechtsLabel !== null && rechtsWaarde !== null) {
      tekst(KOP.rightLabelX, y, rechtsLabel, KOP.size, true);
      tekst(KOP.rightColonX, y, ":", KOP.size);
      tekst(KOP.rightValueX, y, rechtsWaarde, KOP.size);
    }
  }

  if (sheet.hasLogo) {
    uit.push({
      kind: "image",
      x: LOGO.x,
      y: LOGO.y,
      width: LOGO.width,
      height: LOGO.height,
    });
  }

  // ── De kolomkoppen ───────────────────────────────────────────────────────
  tekst(KOLOMKOP.inclX, KOLOMKOP.topY, "Incl ", KOLOMKOP.size, true);
  tekst(KOLOMKOP.exclX, KOLOMKOP.topY, "Excl ", KOLOMKOP.size, true);
  tekst(KOLOMKOP.pauzeInclX, KOLOMKOP.bottomY, "pauze", KOLOMKOP.size, true);
  tekst(KOLOMKOP.pauzeExclX, KOLOMKOP.bottomY, "pauze", KOLOMKOP.size, true);
  for (const [index, dag] of WEEKDAGEN.entries()) {
    tekst(
      RASTER.firstDayX + index * RASTER.dayWidth + KOLOMKOP.dayOffsetX,
      KOLOMKOP.dayY,
      dag,
      KOLOMKOP.size,
      true,
    );
  }

  // ── De samenvatting links ────────────────────────────────────────────────
  const eersteRegelY = RASTER.topY - REGEL.labelOffsetY;
  tekst(SAMENVATTING.nameX, eersteRegelY, sheet.rosterName, REGEL.size, true);
  for (const [index, veld] of sheet.summary.entries()) {
    const y = eersteRegelY - SAMENVATTING.firstOffsetY - index * SAMENVATTING.lineHeight;
    tekst(SAMENVATTING.labelX, y, veld.label, SAMENVATTING.size, true);
    tekst(SAMENVATTING.valueX, y, veld.value, SAMENVATTING.size);
    if (veld.secondValue !== undefined) {
      tekst(SAMENVATTING.secondValueX, y, veld.secondValue, SAMENVATTING.size);
    }
  }

  // ── De roosterregels ─────────────────────────────────────────────────────
  for (const [index, regel] of regels.entries()) {
    const top = RASTER.topY - index * RASTER.rowHeight;

    tekst(REGEL.labelX, top - REGEL.labelOffsetY, `Regel ${regel.lineNumber}`, REGEL.size, true);
    tekst(REGEL.inclX, top - REGEL.urenOffsetY, regel.hoursIncludingBreak, REGEL.cellSize);
    tekst(REGEL.exclX, top - REGEL.urenOffsetY, regel.hoursExcludingBreak, REGEL.cellSize);

    for (const [dag, cel] of regel.cells.entries()) {
      const kolomX = RASTER.firstDayX + dag * RASTER.dayWidth;
      tekst(kolomX + CEL.codeOffsetX, top - CEL.firstLineOffsetY, cel.code, REGEL.cellSize);
      if (cel.duration !== null) {
        tekst(
          kolomX + CEL.durationOffsetX,
          top - CEL.firstLineOffsetY,
          cel.duration,
          REGEL.cellSize,
        );
      }
      if (cel.timeRange !== null) {
        tekst(
          kolomX + CEL.timeOffsetX,
          top - CEL.secondLineOffsetY,
          cel.timeRange,
          REGEL.cellSize,
        );
      }
    }
  }

  // ── De lijnen ────────────────────────────────────────────────────────────
  const onderY = RASTER.topRuleY - regels.length * RASTER.rowHeight;

  for (const x of VERTICAAL_LINKS) {
    const vanY = VERTICAAL_KORT.has(x) ? RASTER.topY : RASTER.headerTopY;
    uit.push({ kind: "line", x1: x, y1: vanY, x2: x, y2: onderY, width: RASTER.lineWidth });
  }
  for (const x of VERTICAAL_DAGEN) {
    uit.push({
      kind: "line",
      x1: x,
      y1: RASTER.headerTopY,
      x2: x,
      y2: onderY,
      width: RASTER.lineWidth,
    });
  }

  uit.push({
    kind: "line",
    x1: 216,
    y1: RASTER.headerRuleY,
    x2: RASTER.ruleRightX,
    y2: RASTER.headerRuleY,
    width: RASTER.lineWidth,
  });
  uit.push({
    kind: "line",
    x1: 18.75,
    y1: RASTER.topRuleY,
    x2: RASTER.ruleRightX,
    y2: RASTER.topRuleY,
    width: RASTER.lineWidth,
  });
  for (let rij = 1; rij < regels.length; rij += 1) {
    const y = RASTER.topRuleY - rij * RASTER.rowHeight;
    uit.push({
      kind: "line",
      x1: RASTER.ruleLeftX,
      y1: y,
      x2: RASTER.ruleRightX,
      y2: y,
      width: RASTER.lineWidth,
    });
  }
  uit.push({
    kind: "line",
    x1: RASTER.outerLeftX,
    y1: onderY,
    x2: RASTER.outerRightX,
    y2: onderY,
    width: RASTER.lineWidth,
  });

  // ── De voet ──────────────────────────────────────────────────────────────
  tekst(VOET.printedX, VOET.y, `Geprint op: ${sheet.printedAt}`, VOET.size);
  tekst(VOET.userX, VOET.y, `Gebruiker: ${sheet.user}`, VOET.size);
  tekst(VOET.sheetLabelX, VOET.sheetY, "Blad: ", VOET.size);
  tekst(VOET.sheetNumberX, VOET.sheetY, `${pagina} / ${paginas}`, VOET.size);

  return uit;
}

export const WEEKDAGEN = [
  "Maandag",
  "Dinsdag",
  "Woensdag",
  "Donderdag",
  "Vrijdag",
  "Zaterdag",
  "Zondag",
] as const;
