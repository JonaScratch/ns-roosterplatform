import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PdfDocument, escapePdfString, textWidth } from "@/server/export/pdf-writer";
import { svgToPdfDrawing } from "@/server/export/svg-logo";
import {
  LINES_PER_SHEET,
  type RosterSheet,
  SHEET,
  type SheetLine,
  layoutRosterSheet,
} from "@/server/export/roster-sheet-layout";
import { renderSheetPdf, renderSheetSvg } from "@/server/export/roster-sheet-render";
import { readSheetGeometry, textAt, textRow } from "@/server/export/sheet-geometry";
import { pdfPages, readPdfObjects } from "@/server/import/pdf-text";

/**
 * Het roosterblad in de NS-vorm.
 *
 * ## Waar deze tests tegenaan leggen
 *
 * Niet tegen een eigen verwachting maar tegen het aangeleverde blad zelf:
 * `tests/fixtures/dordrecht-bronnen/50+ mix 1.pdf`. De coördinaten van de kop,
 * de kolommen en het raster worden uit dat bestand gemeten en met de onze
 * vergeleken. Een blad dat er "ongeveer zo uitziet", zakt hier.
 *
 * ## Waarom niet met plaatjes
 *
 * Een beeldverschil zegt dát er iets anders is, niet wát. Een positieverschil
 * zegt dat de dinsdagkolom drie punten is opgeschoven, en dat is wat je nodig
 * hebt om het te repareren.
 */

const CANONIEK = join(
  __dirname,
  "..",
  "fixtures",
  "dordrecht-bronnen",
  "50+ mix 1.pdf",
);

const BRON = readSheetGeometry(readFileSync(CANONIEK));

/** De uitgepakte inhoudsstroom van de eerste pagina. */
function inhoudsstroom(bytes: Buffer): string {
  const objecten = readPdfObjects(bytes);
  const pagina = [...objecten.values()].find((object) =>
    /\/Type\s*\/Page(?![s])/.test(object.body),
  );
  const verwijzing = pagina ? /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pagina.body) : null;
  return verwijzing
    ? (objecten.get(Number(verwijzing[1]))?.stream?.toString("latin1") ?? "")
    : "";
}

function cel(code: string, duration: string | null = null, timeRange: string | null = null) {
  return { code, duration, timeRange };
}

function regel(lineNumber: number): SheetLine {
  return {
    lineNumber,
    hoursIncludingBreak: "40:00",
    hoursExcludingBreak: "37:23",
    cells: [
      cel("108", "08:33", "13:08 - 21:41"),
      cel("RES", "08:00"),
      cel("WR", "08:00"),
      cel("R"),
      cel("731", "08:00", "11:00 - 19:00"),
      cel("111", "08:17", "09:54 - 18:11"),
      cel("6", "07:15", "10:13 - 17:28"),
    ],
  };
}

function blad(regels: number, overrides: Partial<RosterSheet> = {}): RosterSheet {
  return {
    locationName: "MCN - Dordrecht plan",
    rosterVariant: "BDU-05-10-2026",
    role: "MCN",
    startDate: "5 okt. 2026",
    endDate: "12 dec. 2026",
    rosterName: "50+ mix 1 - Y",
    summary: [
      { label: "Contracturen per week", value: "40:00" },
      { label: "Status", value: "Goedgekeurd" },
      { label: "Gemiddelde weeklengte", value: "39:51", secondValue: "37:23" },
    ],
    lines: Array.from({ length: regels }, (_, index) => regel(index + 1)),
    printedAt: "5 sep. 2026 11:00",
    user: "900001",
    simulation: true,
    simulationLabel: "SIMULATIE — GEEN VASTGESTELD ROOSTER",
    hasLogo: true,
    ...overrides,
  };
}

describe("de canonieke bron is leesbaar", () => {
  it("levert de opmaak van het aangeleverde NS-blad op", () => {
    expect(BRON.pageWidth).toBeCloseTo(841.89, 2);
    expect(BRON.pageHeight).toBeCloseTo(595.28, 2);
    expect(BRON.texts.length).toBeGreaterThan(150);
    expect(BRON.lines.length).toBe(20);
  });
});

describe("de kop staat waar hij op het NS-blad staat", () => {
  const eigen = readSheetGeometry(renderSheetPdf(blad(6)));

  it.each([
    ["Standplaats", 19.77, 523.49],
    ["Roostervariant", 19.77, 510.11],
    ["Rol", 19.77, 496.73],
    ["Startdatum", 422.71, 510.11],
    ["Einddatum", 422.71, 496.73],
  ])("%s staat op de plek van het origineel", (label, x, y) => {
    const inBron = textAt(BRON, x, y);
    const inEigen = textAt(eigen, x, y);
    expect(inBron?.value).toBe(label);
    expect(inEigen?.value).toBe(label);
  });

  it("zet de waarden in dezelfde kolom als het origineel", () => {
    // Het origineel: label op 19.77, dubbele punt op 214.04, waarde op 228.44.
    expect(textAt(BRON, 214.04, 523.82)?.value).toBe(":");
    expect(textAt(eigen, 214.04, 523.49)?.value).toBe(":");
    expect(textAt(BRON, 228.44, 523.82)?.value).toBe("MCN - Dordrecht plan");
    expect(textAt(eigen, 228.44, 523.49)?.value).toBe("MCN - Dordrecht plan");
  });
});

describe("de kolomkoppen", () => {
  const eigen = readSheetGeometry(renderSheetPdf(blad(6)));

  it("staan op de x-posities van het origineel", () => {
    const dagen = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
    for (const dag of dagen) {
      const inBron = BRON.texts.find((tekst) => tekst.value === dag);
      const inEigen = eigen.texts.find((tekst) => tekst.value === dag);
      expect(inBron, `${dag} in de bron`).toBeDefined();
      expect(inEigen, `${dag} in ons blad`).toBeDefined();
      expect(inEigen!.x).toBeCloseTo(inBron!.x, 1);
      expect(inEigen!.y).toBeCloseTo(inBron!.y, 1);
    }
  });

  it("houdt Incl en Excl pauze op twee regels, net als het origineel", () => {
    for (const [waarde, x, y] of [
      ["Incl ", 227.82, 468.11],
      ["Excl ", 266.42, 468.11],
      ["pauze", 225.19, 457.73],
      ["pauze", 264.79, 457.73],
    ] as const) {
      expect(textAt(BRON, x, y)?.value).toBe(waarde);
      expect(textAt(eigen, x, y)?.value).toBe(waarde);
    }
  });
});

describe("het raster", () => {
  const eigen = readSheetGeometry(renderSheetPdf(blad(6)));

  it("heeft evenveel lijnen als het origineel bij zes regels", () => {
    expect(eigen.lines.length).toBe(BRON.lines.length);
  });

  // Op een tiende punt vergelijken, niet op gelijkheid van afgeronde getallen.
  // Een lijn op 295.045 en een op 295.05 liggen op hetzelfde papier; wie ze
  // eerst afrondt, ziet 295.0 tegenover 295.1 en meldt een verschil dat er
  // niet is. Een tiende punt is ruim onder de dikte van de lijn zelf (0,75).
  const OP_EEN_TIENDE = 0.1;

  it("zet de verticale scheidingen op dezelfde x", () => {
    const xVan = (g: typeof BRON) =>
      g.lines.filter((l) => l.x1 === l.x2).map((l) => l.x1).sort((a, b) => a - b);
    const bron = xVan(BRON);
    const ons = xVan(eigen);
    expect(ons).toHaveLength(bron.length);
    for (const [index, x] of ons.entries()) {
      expect(x, `verticale lijn ${index}`).toBeCloseTo(bron[index], 1);
    }
  });

  it("zet de horizontale scheidingen op dezelfde y", () => {
    const yVan = (g: typeof BRON) =>
      g.lines.filter((l) => l.y1 === l.y2).map((l) => l.y1).sort((a, b) => a - b);
    const bron = yVan(BRON);
    const ons = yVan(eigen);
    expect(ons).toHaveLength(bron.length);
    for (const [index, y] of ons.entries()) {
      expect(Math.abs(y - bron[index]), `horizontale lijn ${index}`).toBeLessThanOrEqual(
        OP_EEN_TIENDE,
      );
    }
  });
});

describe("een dienstcel toont nummer, duur én tijdvak", () => {
  const eigen = readSheetGeometry(renderSheetPdf(blad(6)));

  it("op dezelfde drie posities als het origineel", () => {
    // Origineel, regel 1 maandag: 108 op 298.99, 08:33 op 350.76,
    // 13:08 - 21:41 op 313.93 een regel lager.
    expect(textAt(BRON, 298.99, 440.91)?.value).toBe("108");
    expect(textAt(BRON, 350.76, 440.91)?.value).toBe("08:33");
    expect(textAt(BRON, 313.93, 426.98)?.value).toBe("13:08 - 21:41");

    expect(textAt(eigen, 298.99, 440.91)?.value).toBe("108");
    expect(textAt(eigen, 350.76, 440.91)?.value).toBe("08:33");
    expect(textAt(eigen, 313.93, 426.98)?.value).toBe("13:08 - 21:41");
  });

  it("toont een dienst nooit als alleen een nummer", () => {
    const inhoud = pdfPages(renderSheetPdf(blad(6))).join("\n");
    expect(inhoud).toContain("13:08 - 21:41");
    expect(inhoud).toContain("08:33");
  });
});

describe("structurele dagen volgen het origineel", () => {
  const eigen = readSheetGeometry(renderSheetPdf(blad(6)));

  it("toont RES, WR en CO met hun credit van 08:00", () => {
    expect(textAt(eigen, 374.52, 440.91)?.value).toBe("RES");
    expect(textAt(eigen, 426.29, 440.91)?.value).toBe("08:00");
    expect(textAt(eigen, 450.04, 440.91)?.value).toBe("WR");
    expect(textAt(eigen, 501.82, 440.91)?.value).toBe("08:00");
  });

  it("toont een rustdag als losse R zonder tijden", () => {
    expect(textAt(eigen, 525.57, 440.91)?.value).toBe("R");
    // Geen duur en geen tijdvak in die cel.
    expect(textAt(eigen, 577.34, 440.91)).toBeNull();
    expect(textAt(eigen, 540.51, 426.98)).toBeNull();
  });

  it("verzint geen begin- of eindtijd bij een structurele dag", () => {
    const rij = textRow(eigen, 426.98);
    // Alleen de dienstcellen hebben een tijdvak op de tweede regel.
    expect(rij.every((tekst) => /^\d{2}:\d{2} - \d{2}:\d{2}$/.test(tekst.value))).toBe(true);
  });
});

describe("roosters van verschillende omvang", () => {
  it.each([6, 10, 12])("een rooster van %i regels past op één blad", (aantal) => {
    const paginas = layoutRosterSheet(blad(aantal));
    expect(paginas).toHaveLength(1);

    const eigen = readSheetGeometry(renderSheetPdf(blad(aantal)));
    // Elke regel staat erop.
    for (let nummer = 1; nummer <= aantal; nummer += 1) {
      expect(
        eigen.texts.some((tekst) => tekst.value === `Regel ${nummer}`),
        `Regel ${nummer}`,
      ).toBe(true);
    }
  });

  it.each([6, 10, 12])("blijft bij %i regels binnen de pagina", (aantal) => {
    const eigen = readSheetGeometry(renderSheetPdf(blad(aantal)));
    for (const tekst of eigen.texts) {
      expect(tekst.x).toBeGreaterThanOrEqual(0);
      expect(tekst.x).toBeLessThan(SHEET.width);
      expect(tekst.y).toBeGreaterThan(0);
      expect(tekst.y).toBeLessThan(SHEET.height);
    }
  });

  it("verdeelt een rooster dat niet past over meerdere bladen", () => {
    const groot = blad(LINES_PER_SHEET + 3);
    const paginas = layoutRosterSheet(groot);
    expect(paginas.length).toBeGreaterThan(1);

    // En elke regel komt op een van de bladen terecht.
    const alles = pdfPages(renderSheetPdf(groot)).join("\n");
    for (let nummer = 1; nummer <= LINES_PER_SHEET + 3; nummer += 1) {
      expect(alles).toContain(`Regel ${nummer}`);
    }
  });
});

describe("voorvertoning en bestand tonen hetzelfde", () => {
  it("tekenen dezelfde opmaakprimitieven", () => {
    // Niet "de teksten komen overeen" maar: er is één opmaakfunctie, en beide
    // renderers krijgen haar uitvoer. Dat is hier de toets.
    const sheet = blad(6);
    const primitieven = layoutRosterSheet(sheet).flatMap((pagina) => pagina.primitives);
    const teksten = primitieven.filter((item) => item.kind === "text");

    const svg = renderSheetSvg(sheet, null);
    const pdf = pdfPages(renderSheetPdf(sheet)).join("\n");

    for (const item of teksten) {
      if (item.kind !== "text") {
        continue;
      }
      // Getrimd vergeleken: de tekstlezer knipt spaties aan de regeleinden weg,
      // dus "Incl " komt terug als "Incl". Dat is een eigenschap van de lezer
      // en niet van het blad.
      const waarde = item.value.trim();
      if (waarde === "") {
        continue;
      }
      expect(svg, `SVG mist ${waarde}`).toContain(waarde);
      expect(pdf, `PDF mist ${waarde}`).toContain(waarde);
    }
  });

  it("zet de tekst in de SVG op de gespiegelde coördinaat", () => {
    const svg = renderSheetSvg(blad(6), null);
    // "Standplaats" staat in de opmaak op y=523.49 vanaf onder; op het scherm
    // dus op 595.28 − 523.49 = 71.79 vanaf boven.
    expect(svg).toContain('x="19.77" y="71.79"');
  });
});

describe("het blad liegt niet", () => {
  it("stempelt een simulatie af", () => {
    const inhoud = pdfPages(renderSheetPdf(blad(6))).join("\n");
    expect(inhoud).toContain("SIMULATIE");
  });

  it("laat het stempel weg zodra het rooster is vastgesteld", () => {
    const inhoud = pdfPages(renderSheetPdf(blad(6, { simulation: false }))).join("\n");
    expect(inhoud).not.toContain("SIMULATIE");
  });

  it("zet het stempel ook in de voorvertoning", () => {
    expect(renderSheetSvg(blad(6), null)).toContain("SIMULATIE");
  });
});

describe("de voet", () => {
  const eigen = readSheetGeometry(renderSheetPdf(blad(6)));

  it("staat op de plek van het origineel", () => {
    expect(textAt(BRON, 19.8, 28.37)?.value).toMatch(/^Geprint op: /);
    expect(textAt(eigen, 19.8, 28.37)?.value).toMatch(/^Geprint op: /);
    expect(textAt(BRON, 743.27, 26.87)?.value).toBe("Blad: ");
    expect(textAt(eigen, 743.27, 26.87)?.value).toBe("Blad: ");
  });

  it("noemt de gebruiker met personeelsnummer en niet met naam", () => {
    expect(textAt(eigen, 423.53, 28.37)?.value).toBe("Gebruiker: 900001");
  });
});

describe("het NS-beeldmerk", () => {
  it("staat rechtsboven, op de plek van het origineel", () => {
    const primitieven = layoutRosterSheet(blad(6)).flatMap((pagina) => pagina.primitives);
    const afbeelding = primitieven.find((item) => item.kind === "image");
    expect(afbeelding).toBeDefined();
    if (afbeelding?.kind === "image") {
      expect(afbeelding.x).toBeCloseTo(733, 1);
      expect(afbeelding.y).toBeCloseTo(547.93, 1);
      expect(afbeelding.width).toBeCloseTo(75, 1);
    }
  });

  it("komt uit het aangeleverde bestand en wordt niet nagetekend", () => {
    const tekening = svgToPdfDrawing(
      readFileSync(join(process.cwd(), "public", "brand", "ns-logo.svg"), "utf8"),
    );
    expect(tekening).not.toBeNull();
    expect(tekening!.width).toBeCloseTo(538.33, 1);
    expect(tekening!.height).toBeCloseTo(210.26, 1);
    // De vulkleur komt letterlijk uit het bestand en wordt niet bijgesteld.
    expect(tekening!.operations).toContain("0.2 0.2 0.6 rg");
  });

  it("gaat als vector mee en niet als plaatje", () => {
    // De tekenopdrachten zitten in de gecomprimeerde inhoudsstroom; de ruwe
    // bytes van het bestand doorzoeken vindt ze niet.
    const inhoud = inhoudsstroom(renderSheetPdf(blad(6)));
    // Krommen: een vectorlogo blijft scherp op papier en bij inzoomen.
    expect(inhoud).toMatch(/ c\n/);
    expect(inhoud).toContain("0.2 0.2 0.6 rg");
    expect(renderSheetPdf(blad(6)).toString("latin1")).not.toContain("/Subtype /Image");
  });

  it("wordt niet uitgerekt: één schaalfactor voor beide assen", () => {
    const inhoud = inhoudsstroom(renderSheetPdf(blad(6)));
    const matrix = /q ([\d.]+) 0 0 ([\d.]+) [\d.-]+ [\d.-]+ cm/.exec(inhoud);
    expect(matrix, "geen tekenmatrix voor het beeldmerk gevonden").not.toBeNull();
    expect(Number(matrix![1])).toBeCloseTo(Number(matrix![2]), 6);
  });
});

describe("het is een echt PDF-bestand", () => {
  const bytes = renderSheetPdf(blad(6));

  it("begint met de handtekening en eindigt met de eindmarkering", () => {
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.subarray(-2048).toString("latin1")).toContain("%%EOF");
  });

  it("gebruikt Times, net als het aangeleverde blad", () => {
    const inhoud = bytes.toString("latin1");
    expect(inhoud).toContain("/Times-Roman");
    expect(inhoud).toContain("/Times-Bold");
  });
});

describe("inhoud uit de database", () => {
  it("kan de opbouw van het bestand niet openbreken", () => {
    expect(escapePdfString("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
    const bytes = renderSheetPdf(blad(6, { rosterName: "50+ (1) \\ Y" }));
    expect(pdfPages(bytes).join("")).toContain("50+ (1) \\ Y");
  });

  it("kan de SVG niet openbreken", () => {
    const svg = renderSheetSvg(blad(6, { rosterName: "<script>x</script>" }), null);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("tekst die niet past", () => {
  it("wordt zichtbaar afgekapt", () => {
    const pdf = new PdfDocument();
    const page = pdf.addPage();
    page.text(10, 10, "een hele lange omschrijving die er niet in past", {
      size: 9,
      maxWidth: 40,
    });
    const inhoud = pdfPages(pdf.build()).join("");
    expect(inhoud).not.toContain("past");
  });

  it("meet Times smaller dan Helvetica", () => {
    expect(textWidth("Roostervariant", 9, false, "TIMES")).toBeLessThan(
      textWidth("Roostervariant", 9, false, "HELVETICA"),
    );
  });
});
