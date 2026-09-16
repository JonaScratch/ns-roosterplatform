import { readDutyCell } from "@/domain/duty-cell";
import type { SheetDuty, SheetProblem } from "./duty-package-sheet";
import { hasTextLayer, pdfPages } from "./pdf-text";

/**
 * Een dienstenpakket uit een aangeleverd PDF-document halen.
 *
 * ## Wat dit wel en niet doet
 *
 * Dit leest de tekstlaag van het document en zoekt regels die een dienst
 * beschrijven: een dienstnummer met een tijdvak erachter. Wat het vindt, gaat
 * naar de voorvertoning, waar een mens het naast de bron legt.
 *
 * Wat het uitdrukkelijk niet doet, is de uitkomst als vaststaand aanbieden. Een
 * PDF heeft geen kolommen — die zijn alleen zichtbaar doordat tekst op een
 * bepaalde plek staat — en aan de volgorde van tekstfragmenten valt niet met
 * zekerheid af te lezen welke weekdag bij welk tijdvak hoort. Deze route levert
 * daarom altijd `REVIEW` op: het pakket komt binnen als voorstel, en de planner
 * bevestigt het per dienst.
 *
 * ## Waarom een gescand document wordt geweigerd
 *
 * Een PDF zonder tekstlaag bevat plaatjes van letters. Daar valt niets uit te
 * lezen zonder tekstherkenning, en tekstherkenning die er soms een 8 van een 3
 * maakt, hoort niet ongezien in een dienstregeling terecht te komen. Dan liever
 * de mededeling dat het zo niet gaat.
 */

export interface PdfReading {
  readonly duties: readonly SheetDuty[];
  readonly problems: readonly SheetProblem[];
  /** De regels waar wél een dienstnummer in stond maar geen leesbaar tijdvak. */
  readonly unreadableLines: readonly string[];
  readonly pages: number;
  /** Deze route levert nooit een pakket op dat zonder nalopen mag doorgaan. */
  readonly requiresReview: true;
}

/**
 * Een regel met een dienst.
 *
 * Bijvoorbeeld: `101  ma  04:27 - 11:07  Sprinter Dordrecht`. Het weekdagdeel
 * is optioneel, want lang niet elk document heeft het.
 */
const DIENSTREGEL =
  /^\s*(\d{2,4})\s+(?:(ma|di|wo|do|vr|za|zo|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\s+)?(\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2})\s*(.*)$/i;

const DAGNAMEN: Readonly<Record<string, number>> = {
  ma: 1,
  maandag: 1,
  di: 2,
  dinsdag: 2,
  wo: 3,
  woensdag: 3,
  do: 4,
  donderdag: 4,
  vr: 5,
  vrijdag: 5,
  za: 6,
  zaterdag: 6,
  zo: 7,
  zondag: 7,
};

export function readDutyPackagePdf(bytes: Buffer, defaultDepot: string): PdfReading {
  if (!hasTextLayer(bytes)) {
    return {
      duties: [],
      unreadableLines: [],
      pages: 0,
      requiresReview: true,
      problems: [
        {
          severity: "BLOCKING",
          row: 0,
          column: "",
          code: "GEEN_TEKSTLAAG",
          message:
            "Dit document bevat geen tekst maar afbeeldingen van tekst. Daar valt geen " +
            "dienstenpakket uit te lezen zonder te gokken op de cijfers. Lever het aan als " +
            "Excel-sjabloon of als PDF met een tekstlaag.",
        },
      ],
    };
  }

  let paginas: readonly string[];
  try {
    paginas = pdfPages(bytes);
  } catch (error) {
    return {
      duties: [],
      unreadableLines: [],
      pages: 0,
      requiresReview: true,
      problems: [
        {
          severity: "BLOCKING",
          row: 0,
          column: "",
          code: "ONLEESBAAR_PDF",
          message: `Het document is niet te openen: ${String(error)}`,
        },
      ],
    };
  }

  const duties: SheetDuty[] = [];
  const problems: SheetProblem[] = [];
  const unreadableLines: string[] = [];
  const gezien = new Set<string>();
  let regelnummer = 0;

  for (const pagina of paginas) {
    for (const ruweRegel of pagina.split("\n")) {
      regelnummer += 1;
      const regel = ruweRegel.trim();
      if (regel === "") {
        continue;
      }

      const treffer = DIENSTREGEL.exec(regel);
      if (!treffer) {
        // Een regel die met een dienstnummer begint maar niet verder komt, is
        // een aanwijzing dat er iets gemist wordt. Die wordt bewaard zodat de
        // planner ziet wát er is overgeslagen — een stille overslag zou een
        // ontbrekende dienst opleveren die niemand mist tot hij niet rijdt.
        if (/^\s*\d{2,4}\s/.test(regel)) {
          unreadableLines.push(regel);
        }
        continue;
      }

      const [, code, dagnaam, tijdvak, staart] = treffer;
      const weekdag = dagnaam ? DAGNAMEN[dagnaam.toLowerCase()] : null;
      const lezing = readDutyCell(tijdvak);

      if (lezing.kind !== "DIENST") {
        unreadableLines.push(regel);
        continue;
      }

      if (weekdag === null) {
        problems.push({
          severity: "REVIEW",
          row: regelnummer,
          column: "weekdag",
          code: "GEEN_WEEKDAG",
          message:
            `Regel "${regel.slice(0, 60)}" noemt geen weekdag. Een dienstnummer zonder ` +
            "weekdag is geen dienst: dezelfde 101 heeft op maandag andere tijden dan op " +
            "donderdag. Vul de weekdag aan in het Excel-sjabloon.",
        });
        continue;
      }

      const sleutel = `${code}|${weekdag}`;
      if (gezien.has(sleutel)) {
        problems.push({
          severity: "REVIEW",
          row: regelnummer,
          column: "dienst",
          code: "DUBBEL",
          message: `Dienst ${code} staat meer dan één keer voor dezelfde weekdag in dit document.`,
        });
        continue;
      }
      gezien.add(sleutel);

      duties.push({
        code,
        weekday: weekdag,
        startMinute: lezing.startMinute!,
        endMinute: lezing.endMinute!,
        depot: defaultDepot,
        weight: 3,
        requiredQualifications: [],
        description: staart.trim().slice(0, 200),
        sourceRow: regelnummer,
      });
    }
  }

  if (duties.length === 0) {
    problems.push({
      severity: "BLOCKING",
      row: 0,
      column: "",
      code: "NIETS_GEVONDEN",
      message:
        "In dit document is geen enkele regel gevonden met een dienstnummer en een tijdvak. " +
        "Controleer of het het juiste document is, of gebruik het Excel-sjabloon.",
    });
  }

  if (unreadableLines.length > 0) {
    problems.push({
      severity: "REVIEW",
      row: 0,
      column: "",
      code: "OVERGESLAGEN",
      message:
        `${unreadableLines.length} regels beginnen met een nummer maar bevatten geen leesbaar ` +
        "tijdvak. Ze staan hieronder; controleer of er diensten tussen zitten.",
    });
  }

  return {
    duties,
    problems,
    unreadableLines: unreadableLines.slice(0, 50),
    pages: paginas.length,
    requiresReview: true,
  };
}
