import { describe, expect, it } from "vitest";
import {
  isoWeekKey,
  isoWeekday,
  overlaps,
  quarterKey,
  restBetween,
  toCalendarDate,
} from "@/domain/time";
import {
  allowedKindsForProfile,
  preferenceFit,
  preferenceMatches,
  profileAllowsDuty,
} from "@/domain/roster-profiles";

describe("rusttijd rond middernacht", () => {
  const nacht = { date: "2026-09-01", startMinute: 1350, endMinute: 1845 };
  const laat = { date: "2026-09-02", startMinute: 780, endMinute: 1290 };
  const vroeg = { date: "2026-09-03", startMinute: 300, endMinute: 795 };

  it("rekent over middernacht heen", () => {
    // De nachtdienst eindigt op 2 september 06:45, de late begint die dag om
    // 13:00: zes uur en een kwartier. Zonder de doorlopende eindtijd zou hier
    // een dag rust uit komen.
    expect(restBetween(nacht, laat)).toBe(375);
  });

  it("geeft ruime rust tussen laat en de vroege dienst een dag later", () => {
    expect(restBetween(laat, vroeg)).toBe(450);
  });

  it("ziet overlap als overlap en niet als weinig rust", () => {
    const overlappend = { date: "2026-09-02", startMinute: 60, endMinute: 600 };
    expect(overlaps(nacht, overlappend)).toBe(true);
    expect(restBetween(nacht, overlappend)).toBeLessThan(0);
  });
});

describe("kalender", () => {
  it("nummert weekdagen volgens ISO", () => {
    expect(isoWeekday("2026-09-07")).toBe(1);
    expect(isoWeekday("2026-09-13")).toBe(7);
  });

  it("hangt de jaarwisseling aan de juiste ISO-week", () => {
    // 1 januari 2027 is een vrijdag en hoort bij week 53 van 2026.
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2026-01-05")).toBe("2026-W02");
  });

  it("bepaalt het kwartaal", () => {
    expect(quarterKey("2026-01-31")).toBe("2026-Q1");
    expect(quarterKey("2026-09-02")).toBe("2026-Q3");
    expect(quarterKey("2026-12-31")).toBe("2026-Q4");
  });

  it("zet een databasewaarde om zonder tijdzoneverschuiving", () => {
    expect(toCalendarDate(new Date("2026-09-02T00:00:00.000Z"))).toBe("2026-09-02");
  });
});

describe("roosterprofielen zijn hard, voorkeuren niet", () => {
  it("sluit een late dienst uit voor het profiel Vroeg", () => {
    expect(profileAllowsDuty("VROEG", ["LAAT"])).toBe(false);
    expect(profileAllowsDuty("VROEG", ["VROEG"])).toBe(true);
  });

  it("sluit 760 uit voor elk profiel zonder nacht", () => {
    // 760 is nacht én rangeer. Een profiel zonder nacht wijst hem dus af, ook
    // al oogt het nummer als een gewone rangeerdienst.
    const kinds = ["NACHT", "RANGEER"] as const;
    expect(profileAllowsDuty("VROEG_LAAT", kinds)).toBe(false);
    expect(profileAllowsDuty("LAAT", kinds)).toBe(false);
    expect(profileAllowsDuty("LAAT_NACHT", kinds)).toBe(true);
    expect(profileAllowsDuty("MIX", kinds)).toBe(true);
  });

  it("laat een zuivere rangeerdienst in elk profiel toe", () => {
    for (const profile of ["VROEG", "VROEG_LAAT", "LAAT", "LAAT_NACHT", "MIX"] as const) {
      expect(profileAllowsDuty(profile, ["RANGEER"])).toBe(true);
    }
  });

  it("geeft Mix alle drie de dagdelen", () => {
    expect(allowedKindsForProfile("MIX")).toEqual(["VROEG", "LAAT", "NACHT"]);
  });

  it("laat een reservevoorkeur niets uitsluiten", () => {
    // `preferenceMatches` zegt of iets aansluit, niet of het mag. Een niet
    // passende dienst levert een lagere score op, geen verbod.
    expect(preferenceMatches("VROEG", ["NACHT"])).toBe(false);
    expect(preferenceFit("VROEG", ["NACHT"])).toBe(0);
    expect(preferenceFit("GEEN_VOORKEUR", ["NACHT"])).toBe(1);
    expect(preferenceFit("VROEG_LAAT", ["VROEG"])).toBe(1);
  });
});
