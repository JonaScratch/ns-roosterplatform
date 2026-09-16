import { describe, expect, it } from "vitest";
import {
  UnknownDutyCodeError,
  classifyDuty,
  classifyDutyCode,
  isReserveDuty,
  parseDutyCode,
  tryClassifyDutyCode,
} from "@/domain/duty-classification";

describe("dienstclassificatie", () => {
  it("deelt de vier hoofdbereiken in", () => {
    expect(classifyDutyCode("043")).toEqual(["VROEG"]);
    expect(classifyDutyCode("141")).toEqual(["LAAT"]);
    expect(classifyDutyCode("241")).toEqual(["NACHT"]);
    expect(classifyDutyCode("604")).toEqual(["RESERVE"]);
    expect(classifyDutyCode("712")).toEqual(["RANGEER"]);
  });

  it("kent 760 en 761 als nacht én rangeer", () => {
    // De uitzondering die het hele model verklaart: één dienst kan meerdere
    // soorten hebben, en de uitzondering gaat vóór het nummerbereik.
    expect(classifyDutyCode("760")).toEqual(["NACHT", "RANGEER"]);
    expect(classifyDutyCode("761")).toEqual(["NACHT", "RANGEER"]);
    expect(classifyDutyCode("759")).toEqual(["RANGEER"]);
    expect(classifyDutyCode("762")).toEqual(["RANGEER"]);
  });

  it("leest een dienstnummer met voorloopnullen", () => {
    expect(parseDutyCode("043")).toBe(43);
    expect(parseDutyCode("43")).toBe(43);
    expect(parseDutyCode(" 043 ")).toBe(43);
  });

  it("weigert een dienstnummer dat geen nummer is", () => {
    // Stil naar 0 afronden zou van een onbekende dienst een vroege dienst
    // maken; dat mag nooit gebeuren.
    expect(() => parseDutyCode("A43")).toThrow(UnknownDutyCodeError);
    expect(() => parseDutyCode("")).toThrow(UnknownDutyCodeError);
    expect(tryClassifyDutyCode("A43")).toBeNull();
  });

  it("weigert een nummer buiten alle bereiken", () => {
    expect(() => classifyDutyCode("350")).toThrow(UnknownDutyCodeError);
    expect(() => classifyDutyCode("900")).toThrow(UnknownDutyCodeError);
  });

  it("onderscheidt een 600-dienst van andere diensten", () => {
    expect(isReserveDuty("601")).toBe(true);
    expect(isReserveDuty("041")).toBe(false);
  });
});

describe("dagdeel en werksoort apart", () => {
  it("legt van 760 beide eigenschappen vast", () => {
    // Dit is de reden dat de classificatie twee velden oplevert in plaats van
    // één: met één veld moet je kiezen tussen nacht en rangeer, en die keuze
    // lekt door in rusttijden, profielgrenzen en de verdeling van nachtwerk.
    expect(classifyDuty("760")).toEqual({
      period: "NACHT",
      workType: "RANGEER",
      kinds: ["NACHT", "RANGEER"],
    });
  });

  it("geeft een gewone rangeerdienst geen dagdeel", () => {
    expect(classifyDuty("712")).toEqual({
      period: "GEEN",
      workType: "RANGEER",
      kinds: ["RANGEER"],
    });
  });

  it("geeft rijdend werk geen apart etiket", () => {
    // RIJDEND is het normale geval; een etiket ervoor zou alleen ruis toevoegen
    // aan elke regel die op `kinds` filtert.
    expect(classifyDuty("043")).toEqual({
      period: "VROEG",
      workType: "RIJDEND",
      kinds: ["VROEG"],
    });
  });

  it("merkt een 600-dienst als reserve, niet als dagdeel", () => {
    expect(classifyDuty("604")).toEqual({
      period: "GEEN",
      workType: "RESERVE",
      kinds: ["RESERVE"],
    });
    // En een 600-dienst is iets anders dan een RES-positie in een rooster.
    expect(isReserveDuty("604")).toBe(true);
    expect(isReserveDuty("043")).toBe(false);
  });

  it("levert nooit een lege verzameling etiketten", () => {
    for (const code of ["001", "099", "100", "199", "200", "299", "600", "699", "700", "799"]) {
      expect(classifyDuty(code).kinds.length).toBeGreaterThan(0);
    }
  });
});
