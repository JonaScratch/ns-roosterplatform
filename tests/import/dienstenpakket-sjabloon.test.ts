import { describe, expect, it } from "vitest";
import {
  TEMPLATE_HEADERS,
  WEEKDAY_NAMES,
  buildTemplate,
  readDutySheet,
  toParsedDuties,
} from "@/server/import/duty-package-sheet";
import { packZip, readXlsx, writeXlsx } from "@/server/import/xlsx";

/**
 * Het Excel-sjabloon voor een dienstenpakket, heen en terug.
 *
 * Sinds deze fase is dit een lang formaat: één rij per dienst per weekdag, met
 * Dag, Dienstnummer en Diensttijd elk in hun eigen kolom — geen mini-taaltje
 * meer in één cel. De belangrijkste eigenschap die hier gemeten wordt is nog
 * steeds dezelfde als bij het vorige sjabloon: een dienst mag niet op een
 * andere dag terechtkomen, een dienstnummer mag zijn voorloopnul niet
 * verliezen, en een cel die niet te lezen is mag niet als lege dag doorgaan.
 */

const DIENSTEN = [
  {
    code: "101",
    weekday: 1,
    startMinute: 4 * 60 + 27,
    endMinute: 11 * 60 + 7,
    depot: "DDR",
    weight: 3,
    requiredQualifications: [],
    description: "Sprinter",
  },
  {
    code: "101",
    weekday: 4,
    startMinute: 13 * 60 + 8,
    endMinute: 21 * 60 + 41,
    depot: "DDR",
    weight: 3,
    requiredQualifications: [],
    description: "Sprinter",
  },
  {
    code: "043",
    weekday: 2,
    startMinute: 23 * 60 + 10,
    endMinute: 24 * 60 + 7 * 60 + 20,
    depot: "DDR",
    weight: 4,
    requiredQualifications: ["RANGEER"],
    description: "Nachtrangeren",
  },
];

/** Het sjabloon als bewerkbaar rooster van cellen. */
function alsCellen(buffer: Buffer): string[][] {
  return readXlsx(buffer).sheets[0].rows.map((rij) => rij.map((cel) => cel.text));
}

/** Cellen weer als werkmap, zoals een ingevuld sjabloon eruitziet. */
function alsWerkmap(cellen: readonly (readonly string[])[]): Buffer {
  return writeXlsx([{ name: "Diensten", rows: cellen }]);
}

describe("het sjabloon", () => {
  it("heeft Dag, Dienstnummer en Diensttijd als de eerste drie kolommen", () => {
    expect(TEMPLATE_HEADERS.slice(0, 3)).toEqual(["dag", "dienstnummer", "diensttijd"]);
  });

  it("gebruikt de volledige Nederlandse weekdagnamen", () => {
    expect(WEEKDAY_NAMES).toEqual([
      "maandag",
      "dinsdag",
      "woensdag",
      "donderdag",
      "vrijdag",
      "zaterdag",
      "zondag",
    ]);
  });

  it("komt met een toelichtingsblad in het bestand zelf", () => {
    const gelezen = readXlsx(buildTemplate({ locationCode: "DDR", timetable: "DR2027" }));
    expect(gelezen.sheets.map((blad) => blad.name)).toEqual(["Diensten", "Toelichting"]);
    const tekst = gelezen.sheets[1].rows.map((rij) => rij[0]?.text ?? "").join(" ");
    expect(tekst).toContain("04:27 / 11:07");
    expect(tekst).toContain("22:00 / 06:00");
  });

  it("zet bij een leeg pakket voorbeeldrijen in plaats van niets", () => {
    const cellen = alsCellen(buildTemplate({ locationCode: "DDR", timetable: "DR2027" }));
    expect(cellen[1][0]).toBe("maandag");
    expect(cellen[1][1]).toBe("1");
    expect(cellen[1][2]).toBe("04:27 / 11:07");
  });
});

describe("heen en terug met echte diensten", () => {
  const sjabloon = buildTemplate({
    locationCode: "DDR",
    timetable: "DR2027",
    duties: DIENSTEN,
  });

  it("levert dezelfde diensten weer op", () => {
    const gelezen = readDutySheet(sjabloon, "DDR");
    expect(gelezen.problems).toEqual([]);
    expect(gelezen.duties).toHaveLength(3);

    const maandag = gelezen.duties.find(
      (dienst) => dienst.code === "101" && dienst.weekday === 1,
    );
    expect(maandag?.startMinute).toBe(4 * 60 + 27);
    expect(maandag?.endMinute).toBe(11 * 60 + 7);
  });

  it("houdt de tijden per weekdag uit elkaar", () => {
    // Dit is de kern: dienst 101 heeft op maandag andere tijden dan op
    // donderdag. Wie het dienstnummer als identiteit gebruikt, verliest dat.
    const gelezen = readDutySheet(sjabloon, "DDR");
    const perDag = new Map(
      gelezen.duties
        .filter((dienst) => dienst.code === "101")
        .map((dienst) => [dienst.weekday, dienst.startMinute]),
    );
    expect(perDag.get(1)).toBe(4 * 60 + 27);
    expect(perDag.get(4)).toBe(13 * 60 + 8);
    expect(perDag.get(1)).not.toBe(perDag.get(4));
  });

  it("laat een dienst over middernacht over middernacht", () => {
    const nacht = readDutySheet(sjabloon, "DDR").duties.find((dienst) => dienst.code === "043");
    expect(nacht?.startMinute).toBe(23 * 60 + 10);
    expect(nacht?.endMinute).toBe(24 * 60 + 7 * 60 + 20);
    expect(nacht!.endMinute - nacht!.startMinute).toBe(8 * 60 + 10);
  });

  it("houdt de voorloopnul en de bevoegdheid vast", () => {
    const nacht = readDutySheet(sjabloon, "DDR").duties.find((dienst) => dienst.code === "043");
    expect(nacht?.code).toBe("043");
    expect(nacht?.requiredQualifications).toEqual(["RANGEER"]);
    expect(nacht?.weight).toBe(4);
  });
});

describe("wat er wordt gemeld", () => {
  const basis = alsCellen(buildTemplate({ locationCode: "DDR", timetable: "DR2027", duties: DIENSTEN }));

  it("weigert een gewijzigde kopregel", () => {
    const kapot = basis.map((rij) => [...rij]);
    kapot[0][1] = "nummer";
    const gelezen = readDutySheet(alsWerkmap(kapot), "DDR");
    expect(gelezen.duties).toHaveLength(0);
    expect(gelezen.problems[0].code).toBe("KOPREGEL");
    expect(gelezen.problems[0].message).toContain("dienstnummer");
  });

  it("weigert een verschoven kolom", () => {
    // Een ingevoegde kolom verschuift dienstnummer en diensttijd één plaats op.
    // Zonder controle op de kopregel komt een tijdvak in de dienstnummerkolom
    // terecht en andersom.
    const verschoven = basis.map((rij) => [rij[0], "extra", ...rij.slice(1)]);
    const gelezen = readDutySheet(alsWerkmap(verschoven), "DDR");
    expect(gelezen.problems.some((probleem) => probleem.code === "KOPREGEL")).toBe(true);
    expect(gelezen.duties).toHaveLength(0);
  });

  it("meldt een dienst die op dezelfde dag op twee rijen staat", () => {
    const dubbel = [...basis.map((rij) => [...rij]), [...basis[1]]];
    const gelezen = readDutySheet(alsWerkmap(dubbel), "DDR");
    expect(gelezen.problems.some((probleem) => probleem.code === "DUBBEL")).toBe(true);
  });

  it("staat hetzelfde dienstnummer op een andere weekdag wél toe", () => {
    // Dat is geen duplicaat maar precies waarom dit sjabloon een lang formaat
    // is: dienst 101 staat hier al op maandag én op donderdag, met andere
    // tijden, en dat mag geen DUBBEL-melding opleveren.
    const gelezen = readDutySheet(
      buildTemplate({ locationCode: "DDR", timetable: "DR2027", duties: DIENSTEN }),
      "DDR",
    );
    expect(gelezen.problems.some((probleem) => probleem.code === "DUBBEL")).toBe(false);
  });

  it("meldt een dienst zonder dienstnummer", () => {
    const zonderNummer = basis.map((rij) => [...rij]);
    zonderNummer[1][1] = "";
    const gelezen = readDutySheet(alsWerkmap(zonderNummer), "DDR");
    expect(gelezen.problems.some((probleem) => probleem.code === "GEEN_NUMMER")).toBe(true);
  });

  it("meldt een onbekende weekdag in plaats van te raden", () => {
    const fout = basis.map((rij) => [...rij]);
    fout[1][0] = "maandab";
    const gelezen = readDutySheet(alsWerkmap(fout), "DDR");
    const probleem = gelezen.problems.find((kandidaat) => kandidaat.code === "ONBEKENDE_DAG");
    expect(probleem).toBeDefined();
    expect(probleem?.message).toContain("maandab");
  });

  it("accepteert een weekdagafkorting", () => {
    const afgekort = basis.map((rij) => [...rij]);
    afgekort[1][0] = "ma";
    const gelezen = readDutySheet(alsWerkmap(afgekort), "DDR");
    expect(gelezen.problems).toEqual([]);
    expect(gelezen.duties.find((dienst) => dienst.code === "101")?.weekday).toBe(1);
  });

  it("meldt een diensttijd zonder schuine streep", () => {
    const fout = basis.map((rij) => [...rij]);
    fout[1][2] = "04:27-11:07";
    const gelezen = readDutySheet(alsWerkmap(fout), "DDR");
    const probleem = gelezen.problems.find((kandidaat) => kandidaat.code === "DIENSTTIJD");
    expect(probleem).toBeDefined();
    expect(probleem?.message).toContain("schuine streep");
  });

  it("meldt precies welke rij, dag, dienstnummer en diensttijd het betreft", () => {
    // Voorbeeld uit de opdracht: "Rij 14 / Dag: Maandag / Dienstnummer: 101 /
    // Diensttijd: 17:49 / — Eindtijd ontbreekt." Deze meting toetst dezelfde
    // vorm: geen kale foutcode, maar de rij en de drie velden erbij.
    const enkeleRij = writeXlsx([
      {
        name: "Diensten",
        rows: [[...TEMPLATE_HEADERS.slice(0, 3)], ["maandag", "101", "17:49 /"]],
      },
    ]);
    const gelezen = readDutySheet(enkeleRij, "DDR");
    const probleem = gelezen.problems.find((kandidaat) => kandidaat.code === "DIENSTTIJD");
    expect(probleem?.row).toBe(2);
    expect(probleem?.message).toContain("Dag: maandag");
    expect(probleem?.message).toContain("Dienstnummer: 101");
    expect(probleem?.message).toContain("Diensttijd: 17:49 /");
    expect(probleem?.message).toContain("Eindtijd ontbreekt.");
  });

  it("accepteert spaties rond de schuine streep", () => {
    for (const vorm of ["04:27/11:07", "04:27 /11:07", "04:27/ 11:07", "04:27 / 11:07"]) {
      const rij = basis.map((r) => [...r]);
      rij[1][2] = vorm;
      const gelezen = readDutySheet(alsWerkmap(rij), "DDR");
      expect(gelezen.problems).toEqual([]);
      expect(gelezen.duties.find((d) => d.code === "101" && d.weekday === 1)?.startMinute).toBe(
        4 * 60 + 27,
      );
    }
  });

  it("herkent een cel die Excel als tijd heeft opgeslagen", () => {
    // 0,185416… is wat er van 4:27 overblijft wanneer de cel op Tijd staat.
    // "DIENSTTIJD" zou hier waar zijn maar nutteloos; de oorzaak is bekend.
    const gelezen = readDutySheet(metEchtGetal(), "DDR");
    expect(gelezen.problems.some((probleem) => probleem.code === "EXCELTIJD")).toBe(true);
  });

  it("staat optionele kolommen (zwaarte, bevoegdheden, omschrijving) toe om te ontbreken", () => {
    // Precies de voorbeeldrijen uit de opdracht: alleen Dag, Dienstnummer en
    // Diensttijd ingevuld, verder niets.
    const minimaal = writeXlsx([
      {
        name: "Diensten",
        rows: [
          [...TEMPLATE_HEADERS.slice(0, 3)],
          ["maandag", "1", "04:27 / 11:07"],
          ["maandag", "101", "17:49 / 01:25"],
          ["dinsdag", "1", "04:27 / 10:54"],
          ["woensdag", "760", "22:00 / 06:00"],
        ],
      },
    ]);
    const gelezen = readDutySheet(minimaal, "DDR");
    expect(gelezen.problems).toEqual([]);
    expect(gelezen.duties).toHaveLength(4);
    expect(gelezen.duties.every((dienst) => dienst.weight === 3)).toBe(true);
    expect(gelezen.duties.every((dienst) => dienst.requiredQualifications.length === 0)).toBe(true);
    const nacht = gelezen.duties.find((dienst) => dienst.code === "760");
    expect(nacht?.weekday).toBe(3);
    expect(nacht?.startMinute).toBe(22 * 60);
    expect(nacht?.endMinute).toBe(24 * 60 + 6 * 60);
  });
});

describe("de indeling naar dagdeel", () => {
  it("volgt uit het dienstnummer", () => {
    const gelezen = readDutySheet(
      buildTemplate({ locationCode: "DDR", timetable: "DR2027", duties: DIENSTEN }),
      "DDR",
    );
    const omgezet = toParsedDuties(gelezen.duties);
    expect(omgezet.problems).toEqual([]);
    expect(omgezet.duties).toHaveLength(3);
    expect(omgezet.duties.every((dienst) => dienst.period.length > 0)).toBe(true);
  });

  it("meldt een nummer buiten elke bekende reeks in plaats van te raden", () => {
    const onbekend = toParsedDuties([
      {
        code: "999999",
        weekday: 1,
        startMinute: 300,
        endMinute: 700,
        depot: "DDR",
        weight: 3,
        requiredQualifications: [],
        description: "",
        sourceRow: 2,
      },
    ]);
    expect(onbekend.duties).toHaveLength(0);
    expect(onbekend.problems[0].code).toBe("ONBEKEND_NUMMER");
  });
});

/**
 * Een blad met een écht getal in de Diensttijd-cel.
 *
 * De schrijver zet alles als tekst weg — dat is precies de bedoeling — dus voor
 * deze meting wordt het werkblad met de hand samengesteld, zoals Excel het zou
 * opslaan wanneer iemand 4:27 in een cel typt en de cel op Tijd staat.
 */
function metEchtGetal(): Buffer {
  const kop = TEMPLATE_HEADERS.map(
    (naam, index) =>
      `<c r="${String.fromCharCode(65 + index)}1" t="inlineStr"><is><t>${naam}</t></is></c>`,
  ).join("");
  const rij =
    '<c r="A2" t="inlineStr"><is><t>maandag</t></is></c>' +
    '<c r="B2" t="inlineStr"><is><t>101</t></is></c>' +
    '<c r="C2"><v>0.1854166666</v></c>';

  return packZip([
    {
      naam: "[Content_Types].xml",
      inhoud: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="xml" ContentType="application/xml"/></Types>',
        "utf8",
      ),
    },
    {
      naam: "xl/workbook.xml",
      inhoud: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Diensten" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "utf8",
      ),
    },
    {
      naam: "xl/_rels/workbook.xml.rels",
      inhoud: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          "</Relationships>",
        "utf8",
      ),
    },
    {
      naam: "xl/worksheets/sheet1.xml",
      inhoud: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          `<sheetData><row r="1">${kop}</row><row r="2">${rij}</row></sheetData></worksheet>`,
        "utf8",
      ),
    },
  ]);
}
