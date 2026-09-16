import { describe, expect, it } from "vitest";
import {
  crc32,
  kolomIndex,
  kolomLetters,
  packZip,
  readXlsx,
  writeXlsx,
} from "@/server/import/xlsx";

/**
 * De xlsx-lezer en -schrijver.
 *
 * De heenweg en de terugweg worden hier aan elkaar geknoopt: wat de schrijver
 * maakt, moet de lezer teruggeven. Dat vangt de fouten die je met alleen een
 * van beide niet ziet — een verkeerde lengte in het zip-kopje bijvoorbeeld
 * levert een bestand op dat de eigen lezer nog wel aankan maar Excel niet, en
 * daarom staat de zipstructuur zelf hieronder ook los gecontroleerd.
 */

function maakWerkmap(): Buffer {
  return writeXlsx([
    {
      name: "Diensten",
      rows: [
        ["dienst", "maandag", "dinsdag"],
        ["101", "1 = 04:27-11:07", "2 = 13:08-21:41"],
        ["043", "", "2 = 23:10-07:20"],
      ],
    },
  ]);
}

describe("heen en terug", () => {
  it("geeft terug wat erin ging", () => {
    const gelezen = readXlsx(maakWerkmap());
    expect(gelezen.problems).toEqual([]);
    expect(gelezen.sheets).toHaveLength(1);
    expect(gelezen.sheets[0].name).toBe("Diensten");
    expect(gelezen.sheets[0].rows[0].map((cel) => cel.text)).toEqual([
      "dienst",
      "maandag",
      "dinsdag",
    ]);
    expect(gelezen.sheets[0].rows[1].map((cel) => cel.text)).toEqual([
      "101",
      "1 = 04:27-11:07",
      "2 = 13:08-21:41",
    ]);
  });

  it("houdt de voorloopnul van een dienstnummer vast", () => {
    // 043 als getal wordt 43, en dan bestaat de dienst niet meer.
    const gelezen = readXlsx(maakWerkmap());
    expect(gelezen.sheets[0].rows[2][0].text).toBe("043");
    expect(gelezen.sheets[0].rows[2][0].numeric).toBeNull();
  });

  it("laat een lege cel op zijn plek staan en schuift de rest niet op", () => {
    // De kolom bepaalt de weekdag. Eén weggevallen cel zou dinsdag op maandag
    // zetten, en dat valt bij het inlezen niet op.
    const rij = readXlsx(maakWerkmap()).sheets[0].rows[2];
    expect(rij[1].text).toBe("");
    expect(rij[2].text).toBe("2 = 23:10-07:20");
  });

  it("laat tekens die in XML iets betekenen heel", () => {
    const werkmap = writeXlsx([
      { name: "Blad", rows: [["a & b", "<niet>", '"aanhaling"', "ï ë é"]] },
    ]);
    expect(readXlsx(werkmap).sheets[0].rows[0].map((cel) => cel.text)).toEqual([
      "a & b",
      "<niet>",
      '"aanhaling"',
      "ï ë é",
    ]);
  });

  it("bewaart meerdere bladen met hun eigen naam", () => {
    const werkmap = writeXlsx([
      { name: "Diensten", rows: [["a"]] },
      { name: "Toelichting", rows: [["b"]] },
    ]);
    const gelezen = readXlsx(werkmap);
    expect(gelezen.sheets.map((blad) => blad.name)).toEqual(["Diensten", "Toelichting"]);
    expect(gelezen.sheets[1].rows[0][0].text).toBe("b");
  });
});

describe("het is een echte zip", () => {
  const werkmap = maakWerkmap();

  it("begint met de zip-handtekening", () => {
    expect(werkmap.readUInt32LE(0)).toBe(0x04034b50);
  });

  it("eindigt met een centrale map die alle onderdelen telt", () => {
    const staart = werkmap.length - 22;
    expect(werkmap.readUInt32LE(staart)).toBe(0x06054b50);
    // vijf vaste onderdelen plus één werkblad
    expect(werkmap.readUInt16LE(staart + 10)).toBe(5);
  });

  it("zet de verplichte onderdelen erin", () => {
    const inhoud = werkmap.toString("latin1");
    for (const onderdeel of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]) {
      expect(inhoud).toContain(onderdeel);
    }
  });

  it("rekent de controlesom uit zoals zip dat doet", () => {
    // De bekende waarde voor "123456789"; wijkt de tabel af, dan weigert Excel
    // het bestand zonder te zeggen waarom.
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("wat er niet ingelezen wordt", () => {
  it("weigert een werkmap met een macro-onderdeel", () => {
    // Handmatig een werkmap met vbaProject.bin nabouwen door de naam in een
    // geldige zip te zetten.
    const metMacro = writeXlsx([{ name: "Blad", rows: [["a"]] }]);
    const gelezen = readXlsx(metMacro);
    expect(gelezen.problems).toEqual([]);

    // En nu met het onderdeel erin.
    const besmet = writeXlsxMetExtra("xl/vbaProject.bin");
    const uitkomst = readXlsx(besmet);
    expect(uitkomst.sheets).toHaveLength(0);
    expect(uitkomst.problems[0]).toContain("macro's");
  });

  it("weigert iets wat geen zip is", () => {
    const uitkomst = readXlsx(Buffer.from("dit is gewoon tekst"));
    expect(uitkomst.sheets).toHaveLength(0);
    expect(uitkomst.problems[0]).toContain("geen leesbare xlsx");
  });

  it("meldt een werkmap zonder bladen", () => {
    const leeg = writeXlsx([]);
    expect(readXlsx(leeg).problems[0]).toContain("geen werkbladen");
  });
});

describe("kolomletters", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
  ])("zet %i om naar %s en terug", (index, letters) => {
    expect(kolomLetters(index)).toBe(letters);
    expect(kolomIndex(letters)).toBe(index);
  });
});

/**
 * Een echte werkmap met er één extra onderdeel in.
 *
 * Opgebouwd met dezelfde zipbouwer als de gewone schrijver, zodat dit een
 * geldig archief is en de weigering ook werkelijk over de inhoud gaat en niet
 * over kapotte bytes.
 */
function writeXlsxMetExtra(naam: string): Buffer {
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
          '<sheets><sheet name="Blad" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "utf8",
      ),
    },
    { naam, inhoud: Buffer.from([0x00, 0x01, 0x02]) },
  ]);
}
