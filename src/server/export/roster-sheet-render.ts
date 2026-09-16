import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PdfDocument } from "@/server/export/pdf-writer";
import { svgToPdfDrawing } from "@/server/export/svg-logo";
import {
  type RosterSheet,
  SHEET,
  type SheetPage,
  layoutRosterSheet,
} from "@/server/export/roster-sheet-layout";

/**
 * Het roosterblad tekenen — als PDF en als voorvertoning.
 *
 * ## De harde afspraak
 *
 * Beide functies hieronder krijgen dezelfde lijst primitieven van
 * `layoutRosterSheet`. Zij vertalen alleen: een `text` wordt een `Tj` of een
 * `<text>`, een `line` wordt een `S` of een `<line>`. Er wordt in geen van
 * beide iets berekend, weggelaten of verschoven.
 *
 * Daarmee is "de voorvertoning toont hetzelfde als het bestand" geen afspraak
 * die iemand moet naleven maar een eigenschap van de opbouw. Een verschil zou
 * betekenen dat een van beide vertalers iets anders doet met dezelfde invoer,
 * en dat is een fout die je in de tekening ziet.
 */

/** Het blad als PDF-bestand. */
export function renderSheetPdf(sheet: RosterSheet): Buffer {
  const pdf = new PdfDocument();
  const logo = sheet.hasLogo ? laadBeeldmerk() : null;

  for (const pagina of layoutRosterSheet(sheet)) {
    const page = pdf.addPage(SHEET);
    for (const item of pagina.primitives) {
      switch (item.kind) {
        case "text":
          // De opmaak rekent vanaf linksonder, net als het aangeleverde blad.
          // `PdfPage.text` rekent vanaf linksboven, dus hier één omrekening —
          // op één plek, zodat de gemeten waarden herkenbaar blijven.
          page.text(item.x, SHEET.height - item.y, item.value, {
            size: item.size,
            bold: item.bold,
            family: "TIMES",
          });
          break;
        case "line":
          page.line(
            item.x1,
            SHEET.height - item.y1,
            item.x2,
            SHEET.height - item.y2,
            0,
            item.width,
          );
          break;
        case "image":
          if (logo) {
            // Als vector, niet als plaatje: het aangeleverde beeldmerk is een
            // SVG, en die blijft bij inzoomen en op groot papier scherp.
            page.drawing(
              logo.operations,
              {
                x: item.x,
                y: SHEET.height - item.y - item.height,
                width: item.width,
                height: item.height,
              },
              { width: logo.width, height: logo.height },
            );
          }
          break;
        case "watermark":
          page.watermark(item.value);
          break;
      }
    }
  }

  return pdf.build();
}

/**
 * Het blad als SVG, voor op het scherm.
 *
 * Waarom SVG en geen HTML-tabel: een tabel legt zijn eigen kolombreedtes op en
 * die hangen af van de browser en de lettergrootte van de lezer. Dan staat er op
 * het scherm iets anders dan in het bestand, en is de voorvertoning geen
 * voorvertoning meer. SVG neemt exact dezelfde coördinaten.
 */
export function renderSheetSvg(sheet: RosterSheet, logoDataUri: string | null): string {
  const paginas = layoutRosterSheet(sheet);
  return paginas
    .map((pagina) => paginaSvg(pagina, logoDataUri, paginas.length))
    .join("\n");
}

function paginaSvg(pagina: SheetPage, logoDataUri: string | null, totaal: number): string {
  const delen: string[] = [];
  delen.push(
    `<svg viewBox="0 0 ${SHEET.width} ${SHEET.height}" xmlns="http://www.w3.org/2000/svg" ` +
      `role="img" aria-label="Roosterblad, blad ${pagina.pageNumber} van ${totaal}" ` +
      `class="roosterblad" style="width:100%;height:auto;background:#fff">`,
  );

  for (const item of pagina.primitives) {
    switch (item.kind) {
      case "text":
        delen.push(
          `<text x="${rond(item.x)}" y="${rond(SHEET.height - item.y)}" ` +
            `font-family="Times New Roman, Times, serif" font-size="${item.size}" ` +
            `${item.bold ? 'font-weight="bold" ' : ""}fill="#000">` +
            `${escapeXml(item.value)}</text>`,
        );
        break;
      case "line":
        delen.push(
          `<line x1="${rond(item.x1)}" y1="${rond(SHEET.height - item.y1)}" ` +
            `x2="${rond(item.x2)}" y2="${rond(SHEET.height - item.y2)}" ` +
            `stroke="#000" stroke-width="${item.width}" />`,
        );
        break;
      case "image":
        if (logoDataUri) {
          delen.push(
            `<image href="${escapeXml(logoDataUri)}" x="${rond(item.x)}" ` +
              `y="${rond(SHEET.height - item.y - item.height)}" width="${item.width}" ` +
              `height="${item.height}" preserveAspectRatio="xMidYMid meet" />`,
          );
        }
        break;
      case "watermark": {
        // Zelfde plek en zelfde hoek als in de PDF: over de diagonaal, achter
        // de inhoud. Wie het van het scherm knipt, mist het op het blad niet.
        const hoek = -(Math.atan2(SHEET.height, SHEET.width) * 180) / Math.PI;
        delen.push(
          `<text x="${rond(SHEET.width / 2)}" y="${rond(SHEET.height / 2)}" ` +
            `text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="46" ` +
            `font-weight="bold" fill="#e0e0e0" ` +
            `transform="rotate(${rond(hoek)} ${rond(SHEET.width / 2)} ${rond(SHEET.height / 2)})">` +
            `${escapeXml(item.value)}</text>`,
        );
        break;
      }
    }
  }

  delen.push("</svg>");
  return delen.join("");
}

function rond(waarde: number): string {
  return (Math.round(waarde * 100) / 100).toString();
}

function escapeXml(waarde: string): string {
  return waarde
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Het aangeleverde beeldmerk als tekenopdrachten.
 *
 * Eén bestand, geen terugvallijst. Het aangeleverde `ns-logo.svg` is de enige
 * canonieke asset; is die er niet of valt zij niet om te zetten, dan komt er
 * geen beeldmerk op het blad. Zeker geen nagetekend of vervangend merk: een
 * blad zonder logo is herkenbaar onvolledig, een blad met een verzonnen logo
 * niet.
 */
function laadBeeldmerk(): ReturnType<typeof svgToPdfDrawing> {
  try {
    return svgToPdfDrawing(
      readFileSync(join(process.cwd(), "public", "brand", "ns-logo.svg"), "utf8"),
    );
  } catch {
    return null;
  }
}
