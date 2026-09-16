import { formatDiensttijd, readDiensttijd } from "@/domain/duty-cell";
import { parseDutyCode, tryClassifyDuty } from "@/domain/duty-classification";
import type { ParsedDuty } from "@/server/validation/duty-package";
import { type SheetToWrite, readXlsx, writeXlsx } from "./xlsx";

/**
 * Het Excel-sjabloon voor een dienstenpakket.
 *
 * ## Waarom dit sjabloon en niet het brede sjabloon van eerder
 *
 * Het eerdere sjabloon zette één rij per dienstnummer neer, met een kolom per
 * weekdag en een tijdvak-mini-taaltje in elke cel ("1 = 4:27-11:07"). Dat werkte,
 * maar niemand die dit voor het eerst invulde, kon de vorm raden zonder de
 * toelichting te lezen — en een gelijkteken en een streepje zijn precies het
 * soort teken dat een spreadsheetprogramma naar eigen inzicht herschrijft.
 *
 * Dit sjabloon zet de drie dingen die een dienst identificeren elk in hun eigen
 * kolom: de weekdag, het dienstnummer, en het tijdvak. Eén rij is dan één
 * dienst op één dag — hetzelfde dienstnummer op een andere dag is gewoon een
 * andere rij, precies zoals het in de echte bron ook is: dienst 101 op maandag
 * en dienst 101 op donderdag kunnen andere tijden hebben, en dat is in Fase O
 * op de echte NS-bron vastgesteld, niet een uitzondering om apart te vangen.
 *
 * Een tijdvak is `START / EIND` met een schuine streep — nooit een streepje
 * (dat las het vorige sjabloon al als "tot") en nooit een verticale streep.
 *
 * ## Wat hier bewust niet meer in zit
 *
 * Structurele posities (R, WTV, RES, WR, CO) stonden in het vorige sjabloon
 * tussen de diensturen van dezelfde regel — een dienstenpakket is een
 * dienstencatalogus, geen roosterstructuur, en die twee horen niet in één
 * kolom te leven. Een dag waarop een dienstnummer niet rijdt, heeft in dit
 * sjabloon gewoon geen rij; er hoeft niets ingevuld te worden om "niet van
 * toepassing" te zeggen.
 */

export const SHEET_NAME = "Diensten";

export const WEEKDAY_NAMES = [
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
  "zondag",
] as const;

/**
 * Afkortingen die de lezer optioneel ook accepteert. Het sjabloon zelf gebruikt
 * altijd de volledige naam — dat staat in de toelichting en in de kopregel —
 * maar een aangeleverd bestand dat "ma" typt in plaats van "maandag" is
 * eenduidig en hoeft niet geweigerd te worden.
 */
const WEEKDAY_ABBREVIATIONS: Readonly<Record<string, number>> = {
  ma: 1,
  di: 2,
  wo: 3,
  do: 4,
  vr: 5,
  za: 6,
  zo: 7,
};

export const TEMPLATE_HEADERS = [
  "dag",
  "dienstnummer",
  "diensttijd",
  "zwaarte",
  "bevoegdheden",
  "omschrijving",
] as const;

/** De drie kolommen die een dienst identificeren; de rest is optioneel. */
const REQUIRED_HEADER_COUNT = 3;

const KOLOM = {
  dag: 0,
  dienstnummer: 1,
  diensttijd: 2,
  zwaarte: 3,
  bevoegdheden: 4,
  omschrijving: 5,
} as const;

export interface SheetDuty {
  readonly code: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly weight: number;
  readonly requiredQualifications: readonly string[];
  readonly description: string;
  readonly sourceRow: number;
}

export interface SheetProblem {
  readonly severity: "BLOCKING" | "REVIEW" | "NOTICE";
  readonly row: number;
  readonly column: string;
  readonly code: string;
  readonly message: string;
}

export interface SheetReading {
  readonly duties: readonly SheetDuty[];
  readonly problems: readonly SheetProblem[];
  readonly rowsRead: number;
}

/** Weekdagnaam of -afkorting → weekdagnummer. Null wanneer onbekend. */
function parseWeekdayName(raw: string): number | null {
  const tekst = raw.trim().toLowerCase();
  const volledig = WEEKDAY_NAMES.indexOf(tekst as (typeof WEEKDAY_NAMES)[number]);
  if (volledig >= 0) {
    return volledig + 1;
  }
  return WEEKDAY_ABBREVIATIONS[tekst] ?? null;
}

// ── Het sjabloon maken ───────────────────────────────────────────────────────

export interface TemplateDuty {
  readonly code: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly weight: number;
  readonly requiredQualifications: readonly string[];
  readonly description: string | null;
}

/**
 * Bouwt het sjabloon, eventueel gevuld met de diensten die er nu zijn.
 *
 * Eén rij per dienst per weekdag, gesorteerd op dienstnummer en dan op
 * weekdag — zo staan de dagen van dezelfde dienst bij elkaar en is in één
 * oogopslag te zien welke dagen een dienstnummer wel en niet rijdt.
 */
export function buildTemplate(input: {
  readonly locationCode: string;
  readonly timetable: string;
  readonly duties?: readonly TemplateDuty[];
}): Buffer {
  const rijen: string[][] = [[...TEMPLATE_HEADERS]];

  const gesorteerd = [...(input.duties ?? [])].sort(
    (een, ander) =>
      een.code.localeCompare(ander.code, "nl", { numeric: true }) || een.weekday - ander.weekday,
  );

  for (const dienst of gesorteerd) {
    const rij = new Array<string>(TEMPLATE_HEADERS.length).fill("");
    rij[KOLOM.dag] = WEEKDAY_NAMES[dienst.weekday - 1] ?? "";
    rij[KOLOM.dienstnummer] = dienst.code;
    rij[KOLOM.diensttijd] = formatDiensttijd(dienst.startMinute, dienst.endMinute);
    rij[KOLOM.zwaarte] = String(dienst.weight);
    rij[KOLOM.bevoegdheden] = dienst.requiredQualifications.join(", ");
    rij[KOLOM.omschrijving] = dienst.description ?? "";
    rijen.push(rij);
  }

  if (gesorteerd.length === 0) {
    // Een leeg sjabloon krijgt voorbeeldrijen, zodat de vorm van elke kolom
    // zichtbaar is zonder dat iemand de toelichting hoeft te lezen.
    rijen.push(
      ["maandag", "1", "04:27 / 11:07", "3", "", "voorbeeldregel — verwijderen vóór aanleveren"],
      ["maandag", "760", "22:00 / 06:00", "3", "RANGEER", "voorbeeldregel — verwijderen vóór aanleveren"],
    );
  }

  const toelichting: SheetToWrite = {
    name: "Toelichting",
    rows: [
      [`Dienstenpakket ${input.locationCode} — ${input.timetable}`],
      [""],
      ["Eén rij per dienst per weekdag. Dezelfde dienst op een andere dag: een nieuwe rij."],
      [""],
      ["Vul de kolom Dag met de volledige naam: maandag, dinsdag, woensdag, donderdag,"],
      ["vrijdag, zaterdag of zondag."],
      [""],
      ["Vul de kolom Diensttijd in deze vorm:"],
      ["04:27 / 11:07"],
      [""],
      ["Een eindtijd vóór de begintijd betekent de volgende dag:"],
      ["22:00 / 06:00   is een dienst van 8 uur, van 22:00 tot 06:00 de volgende dag."],
      [""],
      ["Zwaarte, Bevoegdheden en Omschrijving zijn niet verplicht. Zwaarte loopt van 1"],
      ["tot en met 5 en is standaard 3. Bevoegdheden gescheiden door een komma."],
      [""],
      ["Rijdt een dienst op een dag niet, laat die rij dan gewoon weg."],
      [""],
      ["Verander de kopregel niet en voeg geen kolommen toe."],
      ["Lever het bestand aan als xlsx zonder macro's."],
    ],
  };

  return writeXlsx([{ name: SHEET_NAME, rows: rijen }, toelichting]);
}

// ── Het sjabloon lezen ───────────────────────────────────────────────────────

/**
 * Leest een ingevuld sjabloon.
 *
 * Geeft altijd terug wat het wél kon lezen, samen met de problemen. Half
 * inlezen en dan doorgaan gebeurt niet: de aanroeper beslist, en die beslist op
 * de volledige lijst en niet op de eerste fout.
 */
export function readDutySheet(buffer: Buffer, defaultDepot: string): SheetReading {
  const werkmap = readXlsx(buffer);
  if (werkmap.problems.length > 0) {
    return {
      duties: [],
      rowsRead: 0,
      problems: werkmap.problems.map((message) => ({
        severity: "BLOCKING" as const,
        row: 0,
        column: "",
        code: "BESTAND",
        message,
      })),
    };
  }

  const blad =
    werkmap.sheets.find((kandidaat) => kandidaat.name.toLowerCase() === SHEET_NAME.toLowerCase()) ??
    werkmap.sheets[0];
  if (!blad) {
    return {
      duties: [],
      rowsRead: 0,
      problems: [
        {
          severity: "BLOCKING",
          row: 0,
          column: "",
          code: "BLAD",
          message: `De werkmap bevat geen werkblad "${SHEET_NAME}".`,
        },
      ],
    };
  }

  const problems: SheetProblem[] = [];
  const kop = (blad.rows[0] ?? []).map((cel) => cel.text.trim().toLowerCase());

  // De kopregel wordt gecontroleerd en niet aangenomen. De eerste drie kolommen
  // zijn verplicht in deze volgorde; de rest mag ontbreken, maar staat hij er
  // wel, dan moet hij ook kloppen — anders komt een omschrijving terecht in de
  // kolom die de import als bevoegdheden leest.
  TEMPLATE_HEADERS.forEach((verwacht, index) => {
    if (index >= REQUIRED_HEADER_COUNT && kop.length <= index) {
      return;
    }
    if (kop[index] !== verwacht) {
      problems.push({
        severity: "BLOCKING",
        row: 1,
        column: verwacht,
        code: "KOPREGEL",
        message:
          `Kolom ${index + 1} van de kopregel hoort "${verwacht}" te zijn, maar er staat ` +
          `"${kop[index] ?? ""}". Gebruik het sjabloon ongewijzigd.`,
      });
    }
  });

  if (problems.length > 0) {
    return { duties: [], problems, rowsRead: 0 };
  }

  const heeftOptioneleKolommen = kop.length > REQUIRED_HEADER_COUNT;

  const duties: SheetDuty[] = [];
  // Sleutel is dienstnummer + weekdag, niet dienstnummer alleen: hetzelfde
  // nummer op een andere dag is in dit lange formaat de normale vorm en geen
  // duplicaat. Zie het toelichtende blok bovenaan dit bestand.
  const gezien = new Map<string, number>();
  let rowsRead = 0;

  for (let index = 1; index < blad.rows.length; index += 1) {
    const rij = blad.rows[index];
    const rijnummer = index + 1;

    if (rij.every((cel) => cel.text.trim() === "")) {
      continue;
    }
    rowsRead += 1;

    const dagRuw = (rij[KOLOM.dag]?.text ?? "").trim();
    const code = (rij[KOLOM.dienstnummer]?.text ?? "").trim();
    const diensttijdCel = rij[KOLOM.diensttijd];
    const diensttijdRuw = (diensttijdCel?.text ?? "").trim();

    const context = `Dag: ${dagRuw || "—"} / Dienstnummer: ${code || "—"} / Diensttijd: ${diensttijdRuw || "—"}`;

    if (code === "") {
      problems.push({
        severity: "BLOCKING",
        row: rijnummer,
        column: "",
        code: "GEEN_NUMMER",
        message: `${context} — Deze rij heeft geen dienstnummer.`,
      });
      continue;
    }

    const weekday = parseWeekdayName(dagRuw);
    if (weekday === null) {
      problems.push({
        severity: "BLOCKING",
        row: rijnummer,
        column: "",
        code: "ONBEKENDE_DAG",
        message:
          dagRuw === ""
            ? `${context} — Deze rij heeft geen dag.`
            : `${context} — "${dagRuw}" is geen weekdag. Gebruik maandag tot en met zondag.`,
      });
      continue;
    }

    const sleutel = `${code}|${weekday}`;
    const eersteRij = gezien.get(sleutel);
    if (eersteRij !== undefined) {
      problems.push({
        severity: "BLOCKING",
        row: rijnummer,
        column: "",
        code: "DUBBEL",
        message:
          `${context} — Dienst ${code} staat al op ${dagRuw.toLowerCase()} (rij ${eersteRij}). ` +
          "Zet dezelfde dienst op dezelfde dag maar op één rij.",
      });
      continue;
    }
    gezien.set(sleutel, rijnummer);

    if (diensttijdCel?.formula) {
      problems.push({
        severity: "BLOCKING",
        row: rijnummer,
        column: "",
        code: "FORMULE",
        message: `${context} — Deze cel bevat een formule. Lever de tijden als tekst aan.`,
      });
      continue;
    }

    const lezing = readDiensttijd(diensttijdRuw);
    if (!lezing.ok) {
      // Een getal tussen 0 en 1 is bijna zeker een tijd die Excel heeft omgezet
      // naar een breuk van een etmaal — een andere fout dan "geen schuine
      // streep" en dus een ander antwoord.
      const getal = diensttijdCel?.numeric ?? null;
      const isExcelTijd = getal !== null && getal > 0 && getal < 1 && diensttijdRuw !== "";
      problems.push({
        severity: "BLOCKING",
        row: rijnummer,
        column: "",
        code: isExcelTijd ? "EXCELTIJD" : "DIENSTTIJD",
        message: isExcelTijd
          ? `${context} — Excel heeft deze cel als tijd opgeslagen in plaats van als tekst. ` +
            "Zet de cel op Tekst en typ het tijdvak opnieuw, bijvoorbeeld 04:27 / 11:07."
          : `${context} — ${lezing.problem}`,
      });
      continue;
    }

    const zwaarteTekst = heeftOptioneleKolommen ? (rij[KOLOM.zwaarte]?.text ?? "").trim() : "";
    const zwaarte = zwaarteTekst === "" ? 3 : Number(zwaarteTekst);
    if (!Number.isInteger(zwaarte) || zwaarte < 1 || zwaarte > 5) {
      problems.push({
        severity: "BLOCKING",
        row: rijnummer,
        column: "",
        code: "ZWAARTE",
        message: `${context} — "${zwaarteTekst}" is geen zwaarte. Vul 1 tot en met 5 in, of laat leeg.`,
      });
      continue;
    }

    const bevoegdheden = heeftOptioneleKolommen
      ? (rij[KOLOM.bevoegdheden]?.text ?? "")
          .split(/[,;]/)
          .map((deel) => deel.trim().toUpperCase())
          .filter((deel) => deel.length > 0)
      : [];
    const omschrijving = heeftOptioneleKolommen ? (rij[KOLOM.omschrijving]?.text ?? "").trim() : "";

    duties.push({
      code,
      weekday,
      startMinute: lezing.startMinute!,
      endMinute: lezing.endMinute!,
      depot: defaultDepot,
      weight: zwaarte,
      requiredQualifications: bevoegdheden,
      description: omschrijving,
      sourceRow: rijnummer,
    });
  }

  if (duties.length === 0 && problems.length === 0) {
    problems.push({
      severity: "BLOCKING",
      row: 0,
      column: "",
      code: "LEEG",
      message: "Het sjabloon bevat geen diensten.",
    });
  }

  return { duties, problems, rowsRead };
}

/**
 * Zet gelezen sjabloonregels om naar de vorm die de importstraat verwerkt.
 *
 * De indeling naar dagdeel en soort gebeurt met dezelfde functie als bij de
 * CSV-route. Twee wegen naar binnen, één classificatie: anders krijgt dezelfde
 * dienst een ander dagdeel afhankelijk van hoe hij is aangeleverd.
 */
export function toParsedDuties(duties: readonly SheetDuty[]): {
  readonly duties: readonly ParsedDuty[];
  readonly problems: readonly SheetProblem[];
} {
  const problems: SheetProblem[] = [];
  const uitkomst: ParsedDuty[] = [];

  for (const dienst of duties) {
    // De indeling volgt uit het dienstnummer. Valt het nummer buiten elk bekend
    // bereik, dan is dat een vraag aan de planner en geen reden om te raden:
    // een verkeerd dagdeel verschuift de dienst in elke bezettingstelling.
    const classificatie = tryClassifyDuty(dienst.code);
    if (!classificatie) {
      problems.push({
        severity: "BLOCKING",
        row: dienst.sourceRow,
        column: "",
        code: "ONBEKEND_NUMMER",
        message:
          `Dienstnummer ${dienst.code} valt buiten de bekende nummerreeksen, waardoor het ` +
          "dagdeel niet is vast te stellen.",
      });
      continue;
    }

    uitkomst.push({
      code: dienst.code,
      weekday: dienst.weekday,
      numericCode: parseDutyCode(dienst.code),
      period: classificatie.period,
      workType: classificatie.workType,
      kinds: classificatie.kinds,
      startMinute: dienst.startMinute,
      endMinute: dienst.endMinute,
      depot: dienst.depot,
      weight: dienst.weight,
      requiredQualifications: dienst.requiredQualifications,
      description: dienst.description === "" ? null : dienst.description,
      sourceRow: dienst.sourceRow,
      sourceValues: {
        dag: WEEKDAY_NAMES[dienst.weekday - 1] ?? String(dienst.weekday),
        dienstnummer: dienst.code,
        diensttijd: formatDiensttijd(dienst.startMinute, dienst.endMinute),
      },
    });
  }

  return { duties: uitkomst, problems };
}
