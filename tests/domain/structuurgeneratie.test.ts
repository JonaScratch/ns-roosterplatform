import { describe, expect, it } from "vitest";
import {
  type StructureTargets,
  countPositions,
  generateStructure,
  teLangeReeks,
} from "@/domain/structure-generation";

/**
 * De structuurgeneratie.
 *
 * ## Waar het hier om gaat
 *
 * Dit raster bepaalt wanneer 64 mensen vrij zijn. Een fout hierin is geen
 * verkeerde dienst maar een verkeerde vrije dag, en die merkt iemand pas op de
 * ochtend dat hij had moeten rijden — of niet had hoeven rijden.
 *
 * De tests hieronder gaan daarom vooral over de gevallen waarin de generator
 * moet wéigeren. Een raster dat "grotendeels" klopt, is het gevaarlijke geval:
 * het ziet er goed uit en is op één plek fout.
 */

const BASIS: StructureTargets = {
  lineCount: 12,
  restDaysPerWeek: 2,
  reserveDaysPerCycle: 12,
  wtvDaysPerCycle: 6,
  compensationDaysPerCycle: 1,
  freeWeekendIntervalWeeks: 3,
  maxConsecutiveServices: 7,
};

function genereer(overrides: Partial<StructureTargets> = {}) {
  return generateStructure({ ...BASIS, ...overrides });
}

describe("een gewone opdracht", () => {
  const uitkomst = genereer();

  it("levert een raster op", () => {
    expect(uitkomst.ok).toBe(true);
  });

  it("geeft elke regel precies zeven dagen", () => {
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    expect(uitkomst.lines).toHaveLength(12);
    for (const line of uitkomst.lines) {
      expect(line.days).toHaveLength(7);
    }
  });

  it("nummert de regels van 1 tot en met het aantal", () => {
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    expect(uitkomst.lines.map((line) => line.lineNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("geeft elke regel het gevraagde aantal rustdagen", () => {
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    for (const line of uitkomst.lines) {
      const rust = line.days.filter((dag) => dag === "RUST").length;
      expect(rust).toBe(BASIS.restDaysPerWeek);
    }
  });

  it("geeft elke regel het gevraagde aantal reservedagen", () => {
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    for (const line of uitkomst.lines) {
      expect(line.days.filter((dag) => dag === "RES").length).toBe(1);
    }
  });

  it("verdeelt WTV en compensatie over de cyclus zonder er te verliezen", () => {
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    const telling = countPositions(uitkomst.lines);
    expect(telling.WR).toBe(BASIS.wtvDaysPerCycle);
    expect(telling.CO).toBe(BASIS.compensationDaysPerCycle);
  });

  it("houdt het totaal aantal dagen gelijk aan regels maal zeven", () => {
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    const telling = countPositions(uitkomst.lines);
    const som = Object.values(telling).reduce((a, b) => a + b, 0);
    expect(som).toBe(12 * 7);
  });
});

describe("het vrije weekend", () => {
  it("komt terug met het interval dat de regels noemen", () => {
    const uitkomst = genereer({ freeWeekendIntervalWeeks: 3 });
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    const metVrijWeekend = uitkomst.lines
      .filter((line) => line.days[5] === "RUST" && line.days[6] === "RUST")
      .map((line) => line.lineNumber);
    // Bij twaalf regels en interval drie: regel 1, 4, 7 en 10.
    expect(metVrijWeekend).toEqual([1, 4, 7, 10]);
  });

  it("wordt niet afgedwongen wanneer het interval nul is", () => {
    const uitkomst = genereer({ freeWeekendIntervalWeeks: 0 });
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    const heleWeekenden = uitkomst.lines.filter(
      (line) => line.days[5] === "RUST" && line.days[6] === "RUST",
    );
    // Niet afgedwongen betekent niet uitgesloten; wel: niet in dit ritme.
    expect(heleWeekenden.length).toBeLessThan(uitkomst.lines.length);
  });
});

describe("de generator weigert wat niet kan", () => {
  it("weigert meer vrije dagen dan er dagen in een week zijn", () => {
    const uitkomst = genereer({ restDaysPerWeek: 6, reserveDaysPerCycle: 36 });
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) {
      throw new Error("had moeten weigeren");
    }
    expect(uitkomst.reason).toContain("zeven dagen");
  });

  it("weigert een rooster zonder regels", () => {
    const uitkomst = genereer({ lineCount: 0 });
    expect(uitkomst.ok).toBe(false);
  });

  it("weigert een negatief aantal rustdagen", () => {
    const uitkomst = genereer({ restDaysPerWeek: -1 });
    expect(uitkomst.ok).toBe(false);
  });

  it("weigert wanneer er een te lange reeks dienstdagen zou ontstaan", () => {
    // Eén rustdag per week, die per regel één dag opschuift. De langste reeks
    // is dan precies zeven: regel 1 heeft maandag vrij en rijdt dinsdag tot en
    // met zondag, regel 2 rijdt maandag en heeft dinsdag vrij. Bij een maximum
    // van zeven mag dat nog net; bij vijf niet meer.
    //
    // Deze verwachting stond er eerst met maximum zeven en faalde. Dat was geen
    // fout in de generator maar in de aanname erachter: de verschuiving breekt
    // de reeks precies op tijd. Het getal is bijgesteld, niet de generator.
    const uitkomst = genereer({
      restDaysPerWeek: 1,
      reserveDaysPerCycle: 0,
      wtvDaysPerCycle: 0,
      compensationDaysPerCycle: 0,
      freeWeekendIntervalWeeks: 0,
      maxConsecutiveServices: 5,
    });
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) {
      throw new Error("had moeten weigeren");
    }
    expect(uitkomst.reason).toContain("dienstdagen achter elkaar");
  });

  it("laat de reeks van precies het maximum nog toe", () => {
    const uitkomst = genereer({
      restDaysPerWeek: 1,
      reserveDaysPerCycle: 0,
      wtvDaysPerCycle: 0,
      compensationDaysPerCycle: 0,
      freeWeekendIntervalWeeks: 0,
      maxConsecutiveServices: 7,
    });
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    expect(teLangeReeks(uitkomst.lines, 7)).toBeNull();
    expect(teLangeReeks(uitkomst.lines, 6)).toContain("7 dienstdagen");
  });
});

describe("de reekscontrole leest over de regelgrens heen", () => {
  it("ziet een reeks die op zondag begint en op maandag doorloopt", () => {
    // Regel 1 eindigt met vier dienstdagen, regel 2 begint met vier. Per regel
    // apart gelezen is er niets aan de hand; achter elkaar zijn het er acht.
    const lines = [
      { lineNumber: 1, days: ["RUST", "RUST", "RUST", "DUTY", "DUTY", "DUTY", "DUTY"] },
      { lineNumber: 2, days: ["DUTY", "DUTY", "DUTY", "DUTY", "RUST", "RUST", "RUST"] },
    ] as const;
    expect(teLangeReeks(lines as never, 7)).toContain("8 dienstdagen");
    expect(teLangeReeks(lines as never, 8)).toBeNull();
  });

  it("leest ook de overgang van de laatste regel terug naar de eerste", () => {
    // Eén regel die op vrijdag, zaterdag en zondag rijdt en op maandag weer:
    // wie de cyclus doorloopt, rijdt vier dagen op rij en niet drie.
    const lines = [
      { lineNumber: 1, days: ["DUTY", "RUST", "RUST", "RUST", "DUTY", "DUTY", "DUTY"] },
    ] as const;
    expect(teLangeReeks(lines as never, 3)).toContain("4 dienstdagen");
  });
});

describe("de rustdagen liggen niet bij elke regel op dezelfde dag", () => {
  it("verschuift het patroon per regel", () => {
    const uitkomst = genereer();
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    // Als elke regel hetzelfde patroon had, zou de hele standplaats op dezelfde
    // dag vrij zijn en op de andere dagen voltallig. Dat is geen rooster.
    const patronen = new Set(uitkomst.lines.map((line) => line.days.join("")));
    expect(patronen.size).toBeGreaterThan(1);
  });

  it("heeft op elke weekdag ten minste één regel die rijdt", () => {
    const uitkomst = genereer();
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    for (let weekdag = 0; weekdag < 7; weekdag += 1) {
      const rijdend = uitkomst.lines.filter((line) => line.days[weekdag] === "DUTY").length;
      expect(rijdend).toBeGreaterThan(0);
    }
  });
});

describe("dezelfde opdracht levert hetzelfde raster", () => {
  it("is deterministisch", () => {
    const een = genereer();
    const twee = genereer();
    expect(JSON.stringify(een)).toBe(JSON.stringify(twee));
  });
});

describe("het aantal reservedagen krimpt niet", () => {
  it("blijft ook kloppen wanneer het niet gelijk over de regels te verdelen is", () => {
    // 15 reservedagen over 12 regels is 1,25 per week. Wie dat per week afrondt,
    // houdt er 12 over en verliest er drie — drie dagen waarop de
    // dienstindeling een uitval niet meer kan opvangen, zonder dat er iets over
    // klaagt. Deze mutatie werd door geen enkele test gevangen; vandaar deze.
    const uitkomst = genereer({ lineCount: 12, reserveDaysPerCycle: 15 });
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    expect(countPositions(uitkomst.lines).RES).toBe(15);
  });

  it("verdeelt de rest over de eerste regels in plaats van hem weg te laten vallen", () => {
    const uitkomst = genereer({ lineCount: 6, reserveDaysPerCycle: 7 });
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    const perRegel = uitkomst.lines.map(
      (line) => line.days.filter((dag) => dag === "RES").length,
    );
    expect(perRegel.reduce((a, b) => a + b, 0)).toBe(7);
    // Eén regel krijgt er twee, de rest één. Niet vier en drie nul.
    expect(perRegel).toEqual([2, 1, 1, 1, 1, 1]);
  });

  it("houdt ook WTV en compensatie heel bij een oneven verdeling", () => {
    const uitkomst = genereer({ lineCount: 6, wtvDaysPerCycle: 4, compensationDaysPerCycle: 5 });
    if (!uitkomst.ok) {
      throw new Error(uitkomst.reason);
    }
    const telling = countPositions(uitkomst.lines);
    expect(telling.WR).toBe(4);
    expect(telling.CO).toBe(5);
  });
});
