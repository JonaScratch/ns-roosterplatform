import { describe, expect, it } from "vitest";
import {
  formatCellTime,
  formatDiensttijd,
  formatDutyCell,
  normaliseCell,
  readClock,
  readDiensttijd,
  readDutyCell,
} from "@/domain/duty-cell";

/**
 * Het lezen van één cel uit een aangeleverd dienstenpakket.
 *
 * De tests zijn in twee helften verdeeld, en die verdeling is het punt: wat
 * eenduidig is, hoort gelezen te worden; wat dubbelzinnig is, hoort gemeld te
 * worden. Een parser die de tweede helft ook "oplost", raadt — en raden is bij
 * dienstijden het verschil tussen op tijd zijn en er niet zijn.
 */

describe("de afgesproken vorm", () => {
  it("leest 1 = 4:27-11:07", () => {
    const cel = readDutyCell("1 = 4:27-11:07");
    expect(cel.kind).toBe("DIENST");
    expect(cel.weekdayInCell).toBe(1);
    expect(cel.startMinute).toBe(4 * 60 + 27);
    expect(cel.endMinute).toBe(11 * 60 + 7);
  });

  it("leest hem ook zonder weekdagnummer", () => {
    const cel = readDutyCell("4:27-11:07");
    expect(cel.kind).toBe("DIENST");
    expect(cel.weekdayInCell).toBeNull();
    expect(cel.startMinute).toBe(267);
  });

  it("schrijft hem terug in dezelfde vorm", () => {
    expect(formatDutyCell(1, 267, 667)).toBe("1 = 04:27-11:07");
  });
});

describe("schrijfwijzen die hetzelfde betekenen", () => {
  const verwacht = { start: 4 * 60 + 27, eind: 11 * 60 + 7 };

  it.each([
    "1 = 4:27-11:07",
    "1=4:27-11:07",
    "1 =  4:27 - 11:07",
    "1 = 04:27-11:07",
    "04:27-11:07",
    "4.27-11.07",
    "4u27-11u07",
    "0427-1107",
    "4:27 tot 11:07",
    "4:27 t/m 11:07",
    "4:27–11:07",
    "4:27—11:07",
    "  4:27-11:07  ",
  ])("leest %s als hetzelfde tijdvak", (invoer) => {
    const cel = readDutyCell(invoer);
    expect(cel.kind).toBe("DIENST");
    expect(cel.startMinute).toBe(verwacht.start);
    expect(cel.endMinute).toBe(verwacht.eind);
  });
});

describe("middernacht", () => {
  it("telt door wanneer de eindtijd vóór de begintijd ligt", () => {
    const cel = readDutyCell("23:10-07:20");
    expect(cel.kind).toBe("DIENST");
    expect(cel.startMinute).toBe(23 * 60 + 10);
    // Niet 440 maar 1880: de dienst duurt 8 uur 10, geen min 16 uur.
    expect(cel.endMinute).toBe(24 * 60 + 7 * 60 + 20);
    expect(cel.endMinute! - cel.startMinute!).toBe(8 * 60 + 10);
  });

  it("laat een dienst die precies om middernacht eindigt doorlopen", () => {
    const cel = readDutyCell("16:00-00:00");
    expect(cel.endMinute).toBe(24 * 60);
    expect(cel.endMinute! - cel.startMinute!).toBe(8 * 60);
  });

  it("ziet gelijke begin- en eindtijd als een etmaal en niet als nul", () => {
    // Zou dit nul minuten opleveren, dan verdwijnt een dienst stilzwijgend uit
    // elke urenberekening.
    const cel = readDutyCell("08:00-08:00");
    expect(cel.endMinute! - cel.startMinute!).toBe(24 * 60);
  });

  it("toont een eindtijd op de volgende dag herkenbaar", () => {
    expect(formatCellTime(1880)).toBe("07:20 (+1)");
    expect(formatCellTime(667)).toBe("11:07");
  });
});

describe("structurele posities", () => {
  it.each([
    ["R", "RUST"],
    ["r", "RUST"],
    ["Rust", "RUST"],
    ["WTV", "WTV"],
    ["RES", "RES"],
    ["reserve", "RES"],
    ["WR", "WR"],
    ["CO", "CO"],
  ])("leest %s als %s", (invoer, verwacht) => {
    const cel = readDutyCell(invoer);
    expect(cel.kind).toBe("POSITIE");
    expect(cel.position).toBe(verwacht);
  });

  it("leest een positie ook met weekdagvoorvoegsel", () => {
    const cel = readDutyCell("3 = R", 3);
    expect(cel.kind).toBe("POSITIE");
    expect(cel.position).toBe("RUST");
  });

  it("houdt een onbekende lettercombinatie niet voor een vrije dag", () => {
    // Dit is de belangrijkste test van dit blok. Zou een onbekende code als
    // rust doorgaan, dan verdwijnt er een werkdag uit het rooster zonder dat
    // iemand het ziet.
    const cel = readDutyCell("XYZ");
    expect(cel.kind).toBe("ONLEESBAAR");
    expect(cel.position).toBeNull();
  });
});

describe("lege cellen", () => {
  it.each(["", "   ", "-", "–", "/", "."])("ziet %s als leeg", (invoer) => {
    expect(readDutyCell(invoer).kind).toBe("LEEG");
  });
});

describe("wat niet geraden wordt", () => {
  it("weigert drie cijfers als tijd", () => {
    // 427 kan 4:27 zijn of 42:7. Beide zijn te verdedigen, dus geen van beide.
    expect(readClock("427")).toBeNull();
    expect(readDutyCell("427-1107").kind).toBe("ONLEESBAAR");
  });

  it("weigert een cel met drie tijden", () => {
    const cel = readDutyCell("4:27-11:07-13:00");
    expect(cel.kind).toBe("ONLEESBAAR");
    expect(cel.problem).toContain("3 tijden");
  });

  it("weigert een onmogelijke klok", () => {
    expect(readClock("25:00")).toBeNull();
    expect(readClock("12:75")).toBeNull();
    expect(readDutyCell("25:00-11:07").kind).toBe("ONLEESBAAR");
  });

  it("weigert een cel zonder tijdvak", () => {
    const cel = readDutyCell("ochtenddienst");
    expect(cel.kind).toBe("ONLEESBAAR");
    expect(cel.problem).toContain("geen tijdvak");
  });

  it("noemt in de melding wat er stond", () => {
    expect(readDutyCell("4:27-elf uur").problem).toContain("elf uur");
  });
});

describe("de weekdag in de cel tegenover de kolom", () => {
  it("gaat akkoord wanneer ze hetzelfde zeggen", () => {
    expect(readDutyCell("2 = 4:27-11:07", 2).kind).toBe("DIENST");
  });

  it("weigert wanneer ze verschillen, en kiest er niet één", () => {
    // Een dienst op de verkeerde dag valt bij het inlezen niet op en bij het
    // rijden wel. Daarom een melding en geen keuze.
    const cel = readDutyCell("1 = 4:27-11:07", 5);
    expect(cel.kind).toBe("ONLEESBAAR");
    expect(cel.problem).toContain("dag 5");
    expect(cel.problem).toContain("dag 1");
    expect(cel.startMinute).toBeNull();
  });

  it("accepteert een cel zonder eigen weekdag in elke kolom", () => {
    expect(readDutyCell("4:27-11:07", 6).kind).toBe("DIENST");
  });

  it("kent alleen weekdagen 1 tot en met 7 als voorvoegsel", () => {
    // "8 = ..." is geen weekdag; dan is het geen voorvoegsel en blijft de hele
    // tekst het tijdvak — dat leest niet, en dat hoort ook zo.
    const cel = readDutyCell("8 = 4:27-11:07");
    expect(cel.weekdayInCell).toBeNull();
    expect(cel.kind).toBe("ONLEESBAAR");
  });
});

describe("normaliseren", () => {
  it("laat cijfers en volgorde ongemoeid", () => {
    expect(normaliseCell("  4:27  -  11:07 ")).toBe("4:27 - 11:07");
  });

  it("maakt van alle streepjes hetzelfde streepje", () => {
    expect(normaliseCell("4:27–11:07")).toBe("4:27-11:07");
    expect(normaliseCell("4:27−11:07")).toBe("4:27-11:07");
  });
});

/**
 * De Diensttijd-cel van het nieuwe, eenvoudige sjabloon: `START / EIND`.
 *
 * Los van `readDutyCell` omdat het een ander formaat is — geen
 * weekdagvoorvoegsel, geen structurele code, een schuine streep in plaats van
 * een streepje. Zie de toelichting in `duty-cell.ts`.
 */
describe("Diensttijd (START / EIND)", () => {
  it("leest 04:27 / 11:07", () => {
    const gelezen = readDiensttijd("04:27 / 11:07");
    expect(gelezen.ok).toBe(true);
    expect(gelezen.startMinute).toBe(4 * 60 + 27);
    expect(gelezen.endMinute).toBe(11 * 60 + 7);
  });

  it("accepteert spaties rond de schuine streep in elke combinatie", () => {
    for (const vorm of ["04:27/11:07", "04:27 /11:07", "04:27/ 11:07", "04:27 / 11:07"]) {
      const gelezen = readDiensttijd(vorm);
      expect(gelezen.ok).toBe(true);
      expect(gelezen.startMinute).toBe(4 * 60 + 27);
      expect(gelezen.endMinute).toBe(11 * 60 + 7);
    }
  });

  it("laat een eindtijd vóór de begintijd de volgende dag betekenen", () => {
    const gelezen = readDiensttijd("22:00 / 06:00");
    expect(gelezen.ok).toBe(true);
    expect(gelezen.startMinute).toBe(22 * 60);
    expect(gelezen.endMinute).toBe(24 * 60 + 6 * 60);
  });

  it("meldt een ontbrekende eindtijd zonder te raden", () => {
    const gelezen = readDiensttijd("17:49 /");
    expect(gelezen.ok).toBe(false);
    expect(gelezen.problem).toBe("Eindtijd ontbreekt.");
  });

  it("meldt een ontbrekende begintijd zonder te raden", () => {
    const gelezen = readDiensttijd("/ 11:07");
    expect(gelezen.ok).toBe(false);
    expect(gelezen.problem).toBe("Begintijd ontbreekt.");
  });

  it("weigert een streepje in plaats van een schuine streep", () => {
    // Dit is precies het verschil met het oude sjabloon: een cel met een
    // streepje is in dit formaat geen tijdvak, ook al zou hij dat in het oude
    // sjabloon wel zijn geweest.
    const gelezen = readDiensttijd("04:27-11:07");
    expect(gelezen.ok).toBe(false);
    expect(gelezen.problem).toContain("schuine streep");
  });

  it("schrijft hem terug in dezelfde vorm", () => {
    expect(formatDiensttijd(4 * 60 + 27, 11 * 60 + 7)).toBe("04:27 / 11:07");
    expect(formatDiensttijd(22 * 60, 24 * 60 + 6 * 60)).toBe("22:00 / 06:00");
  });
});
