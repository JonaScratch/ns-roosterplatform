import { describe, expect, it } from "vitest";
import { diffPackages, runImport, totalsOf } from "@/server/import/duty-import";
import {
  MAX_IMPORT_BYTES,
  looksLikeFormula,
  neutraliseForExport,
  safeFilename,
} from "@/server/import/file-safety";

/**
 * De importstraat.
 *
 * ## Wat hier op het spel staat
 *
 * Een importfout is zelden luidruchtig. Het pakket komt binnen, het aantal
 * klopt ongeveer, en pas weken later blijkt dat de nachtdienst van 23:00 tot
 * 07:00 als een dienst van min zestien uur is opgeslagen — of dat er twee keer
 * hetzelfde bestand in staat en het rooster uit twee bronnen put. De tests
 * hieronder gaan daarom vooral over de stille gevallen.
 */

const KOP = "dienst;weekdag;start;eind;standplaats;zwaarte;bevoegdheden;omschrijving";

function bestand(...regels: string[]): string {
  return [KOP, ...regels].join("\n");
}

function lees(inhoud: string, standplaats = "DDR") {
  return runImport({ filename: "pakket.csv", content: inhoud, locationCode: standplaats });
}

describe("een gewone levering", () => {
  const uitkomst = lees(
    bestand(
      "043;1;05:12;13:20;DDR;3;;Sprinter Dordrecht - Rotterdam",
      "118;1;13:40;21:55;DDR;3;;Intercity Dordrecht - Breda",
      "604;1;06:00;14:00;DDR;2;;Reservedienst vroeg",
    ),
  );

  it("komt door de controle", () => {
    expect(uitkomst.stage).toBe("VALIDATED");
    expect(uitkomst.importable).toBe(true);
  });

  it("telt wat er in zit", () => {
    expect(uitkomst.totals.duties).toBe(3);
    expect(uitkomst.totals.rows).toBe(3);
    // Twee vroeg: 043 op nummer, en reservedienst 604 van 06:00 op zijn
    // aanvangstijd. Die telde hier eerder niet mee, omdat de 600-serie op nummer
    // geen dagdeel heeft — en daardoor sloot ook geen enkel roosterprofiel hem uit.
    expect(uitkomst.totals.vroeg).toBe(2);
    expect(uitkomst.totals.laat).toBe(1);
    expect(uitkomst.totals.reserve).toBe(1);
    expect(uitkomst.totals.depots).toEqual(["DDR"]);
  });

  it("geeft een reservedienst het dagdeel van zijn aanvangstijd en houdt hem reserve", () => {
    const reserve = uitkomst.duties.find((dienst) => dienst.code === "604");
    expect(reserve?.period).toBe("VROEG");
    expect(reserve?.kinds).toEqual(["VROEG", "RESERVE"]);
    expect(uitkomst.problems.some((probleem) => probleem.code === "DAYPART_FROM_START_TIME")).toBe(
      true,
    );
  });

  it("geeft de vroegste start en de laatste eindtijd", () => {
    expect(uitkomst.totals.earliestStart).toBe("05:12");
    expect(uitkomst.totals.latestEnd).toBe("21:55");
  });
});

describe("de nachtdienst over middernacht", () => {
  // 23:00 → 07:00 is de klassieke plek waar een import stukgaat: naïef gerekend
  // is dat een dienst van min zestien uur.
  const uitkomst = lees(bestand("212;1;23:00;07:00;DDR;4;;Nachtnet"));

  it("wordt als acht uur gelezen, niet als min zestien", () => {
    const dienst = uitkomst.duties[0];
    expect(dienst.startMinute).toBe(23 * 60);
    expect(dienst.endMinute).toBe(31 * 60);
    expect(dienst.endMinute - dienst.startMinute).toBe(8 * 60);
  });

  it("wordt als zodanig gemeld", () => {
    expect(uitkomst.totals.overMidnight).toBe(1);
    expect(uitkomst.problems.some((probleem) => probleem.code === "MIDNIGHT")).toBe(true);
  });

  it("blokkeert niet", () => {
    expect(uitkomst.importable).toBe(true);
  });

  it("houdt de eindtijd leesbaar als 07:00", () => {
    expect(uitkomst.totals.latestEnd).toBe("07:00");
  });
});

describe("dezelfde levering twee keer lezen", () => {
  const inhoud = bestand(
    "043;1;05:12;13:20;DDR;3;;Sprinter",
    "212;1;23:00;07:00;DDR;4;;Nachtnet",
  );

  it("levert exact hetzelfde op", () => {
    const eerste = lees(inhoud);
    const tweede = lees(inhoud);
    expect(tweede.duties).toEqual(eerste.duties);
    expect(tweede.totals).toEqual(eerste.totals);
    expect(tweede.stage).toBe(eerste.stage);
  });

  it("verandert niet door regeleinden of een BOM", () => {
    const schoon = lees(inhoud);
    const rommelig = lees(`﻿${inhoud.replace(/\n/g, "\r\n")}\r\n\r\n`);
    expect(rommelig.duties).toEqual(schoon.duties);
    expect(rommelig.totals.duties).toBe(schoon.totals.duties);
  });
});

describe("wat er niet in mag", () => {
  it("weigert een dienst van een andere standplaats", () => {
    const uitkomst = lees(bestand("043;1;05:12;13:20;RTD;3;;Sprinter"), "DDR");
    expect(uitkomst.importable).toBe(false);
    expect(uitkomst.problems.some((probleem) => probleem.code === "DEPOT")).toBe(true);
  });

  it("weigert een dubbel dienstnummer", () => {
    const uitkomst = lees(
      bestand("043;1;05:12;13:20;DDR;3;;Eerste", "043;1;06:12;14:20;DDR;3;;Tweede"),
    );
    expect(uitkomst.importable).toBe(false);
  });

  it("weigert een cel die een spreadsheet als formule uitvoert", () => {
    const uitkomst = lees(bestand("043;1;05:12;13:20;DDR;3;;=cmd|'/c calc'!A1"));
    expect(uitkomst.importable).toBe(false);
    expect(uitkomst.problems.some((probleem) => probleem.code === "FORMULA")).toBe(true);
  });

  it("weigert een bestandstype dat we niet lezen", () => {
    const uitkomst = runImport({
      filename: "pakket.xlsx",
      content: bestand("043;1;05:12;13:20;DDR;3;;Sprinter"),
      locationCode: "DDR",
    });
    expect(uitkomst.stage).toBe("REJECTED");
    expect(uitkomst.problems[0]?.code).toBe("FILE");
  });

  it("weigert een leeg bestand", () => {
    const uitkomst = runImport({ filename: "leeg.csv", content: "", locationCode: "DDR" });
    expect(uitkomst.importable).toBe(false);
  });

  it("weigert een bestand dat te groot is", () => {
    const groot = `${KOP}\n${"043;05:12;13:20;DDR;3;;x\n".repeat(1)}`.padEnd(
      MAX_IMPORT_BYTES + 10,
      " ",
    );
    const uitkomst = runImport({ filename: "groot.csv", content: groot, locationCode: "DDR" });
    expect(uitkomst.importable).toBe(false);
  });
});

describe("de bestandsnaam", () => {
  it("houdt geen pad over", () => {
    expect(safeFilename("..\\..\\Windows\\System32\\rooster.csv")).toBe("rooster.csv");
    expect(safeFilename("/etc/passwd")).toBe("passwd");
  });

  it("valt terug op een neutrale naam wanneer er niets overblijft", () => {
    expect(safeFilename("../")).toBe("aangeleverd-bestand");
  });

  it("herkent en neutraliseert formulecellen voor de export", () => {
    expect(looksLikeFormula("=SOM(A1:A2)")).toBe(true);
    expect(looksLikeFormula("043")).toBe(false);
    expect(neutraliseForExport("=SOM(A1:A2)")).toBe("'=SOM(A1:A2)");
    expect(neutraliseForExport("043")).toBe("043");
  });
});

describe("het verschil met de vorige versie", () => {
  const vorige = [
    { code: "043", weekday: 1, startMinute: 312, endMinute: 800, depot: "DDR", weight: 3, requiredQualifications: [] },
    { code: "118", weekday: 1, startMinute: 820, endMinute: 1315, depot: "DDR", weight: 3, requiredQualifications: [] },
  ];
  const nieuwe = [
    // 043 begint op maandag tien minuten later
    { code: "043", weekday: 1, startMinute: 322, endMinute: 800, depot: "DDR", weight: 3, requiredQualifications: [] },
    // 118 van maandag is verdwenen, 212 van maandag is nieuw
    { code: "212", weekday: 1, startMinute: 1380, endMinute: 1860, depot: "DDR", weight: 4, requiredQualifications: [] },
  ];

  const diff = diffPackages(vorige, nieuwe);

  it("noemt wat erbij komt en wat verdwijnt", () => {
    expect(diff.added).toEqual(["212 (maandag)"]);
    expect(diff.removed).toEqual(["118 (maandag)"]);
  });

  it("noemt per veld wat er verandert", () => {
    expect(diff.changed).toEqual([
      { code: "043 (maandag)", field: "begintijd", from: "05:12", to: "05:22" },
    ]);
  });

  it("telt wat gelijk bleef", () => {
    expect(diff.unchanged).toBe(0);
    expect(diffPackages(vorige, vorige).unchanged).toBe(2);
    expect(diffPackages(vorige, vorige).changed).toEqual([]);
  });
});

describe("de tellingen", () => {
  it("tellen dezelfde diensten in dezelfde volgorde gelijk", () => {
    const duties = lees(
      bestand("043;1;05:12;13:20;DDR;3;;a", "212;1;23:00;07:00;DDR;4;;b"),
    ).duties;
    const omgekeerd = [...duties].reverse();
    expect(totalsOf(omgekeerd, 2)).toEqual(totalsOf(duties, 2));
  });
});

describe("hetzelfde dienstnummer op verschillende weekdagen", () => {
  // Dit is in Dordrecht de regel en niet de uitzondering: 39 van de 46 nummers
  // hebben per weekdag andere tijden. De mutatietoets liet zien dat geen enkele
  // test dat onderscheid afdwong — op nummer alleen sleutelen bleef groen.
  const uitkomst = lees(
    bestand(
      "101;1;18:08;01:24;DDR;3;;Maandag",
      "101;4;16:27;01:24;DDR;3;;Donderdag",
      "101;7;16:39;01:24;DDR;3;;Zondag",
    ),
  );

  it("komt door de controle: dit zijn drie diensten en geen duplicaten", () => {
    expect(uitkomst.importable).toBe(true);
    expect(uitkomst.duties).toHaveLength(3);
  });

  it("houdt de eigen begintijd van elke weekdag", () => {
    const perDag = new Map(uitkomst.duties.map((duty) => [duty.weekday, duty.startMinute]));
    expect(perDag.get(1)).toBe(18 * 60 + 8);
    expect(perDag.get(4)).toBe(16 * 60 + 27);
    expect(perDag.get(7)).toBe(16 * 60 + 39);
  });

  it("weigert wél hetzelfde nummer twee keer op dezelfde weekdag", () => {
    const dubbel = lees(
      bestand("101;1;18:08;01:24;DDR;3;;Eerste", "101;1;16:27;01:24;DDR;3;;Tweede"),
    );
    expect(dubbel.importable).toBe(false);
    expect(
      dubbel.problems.map((probleem) => probleem.message).join(" "),
    ).toContain("weekdag 1 dubbel");
  });
});

describe("het verschil met de vorige versie kijkt naar de weekdag", () => {
  it("ziet dat 101 van donderdag verdwijnt terwijl 101 van maandag blijft", () => {
    // Zonder de weekdag in de sleutel meldt de vergelijking "niets veranderd",
    // en dan krijgt de planner geen signaal dat er een donderdagdienst weg is.
    const vorige = [
      { code: "101", weekday: 1, startMinute: 1088, endMinute: 1524, depot: "DDR", weight: 3, requiredQualifications: [] },
      { code: "101", weekday: 4, startMinute: 987, endMinute: 1524, depot: "DDR", weight: 3, requiredQualifications: [] },
    ];
    const nieuwe = [
      { code: "101", weekday: 1, startMinute: 1088, endMinute: 1524, depot: "DDR", weight: 3, requiredQualifications: [] },
    ];

    const diff = diffPackages(vorige, nieuwe);
    expect(diff.removed).toEqual(["101 (donderdag)"]);
    expect(diff.added).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });

  it("meldt een tijdswijziging bij de juiste weekdag", () => {
    const vorige = [
      { code: "101", weekday: 1, startMinute: 1088, endMinute: 1524, depot: "DDR", weight: 3, requiredQualifications: [] },
      { code: "101", weekday: 4, startMinute: 987, endMinute: 1524, depot: "DDR", weight: 3, requiredQualifications: [] },
    ];
    const nieuwe = [
      { code: "101", weekday: 1, startMinute: 1088, endMinute: 1524, depot: "DDR", weight: 3, requiredQualifications: [] },
      { code: "101", weekday: 4, startMinute: 997, endMinute: 1524, depot: "DDR", weight: 3, requiredQualifications: [] },
    ];

    const diff = diffPackages(vorige, nieuwe);
    expect(diff.changed).toEqual([
      { code: "101 (donderdag)", field: "begintijd", from: "16:27", to: "16:37" },
    ]);
    expect(diff.unchanged).toBe(1);
  });
});
