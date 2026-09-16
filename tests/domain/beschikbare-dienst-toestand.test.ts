import { describe, expect, it } from "vitest";
import {
  FINAL_STATES,
  OPEN_STATES,
  STATE_LABELS,
  acceptsAllocation,
  acceptsInterest,
  canTransition,
  stateByClock,
  transitionRefusal,
} from "@/domain/available-duty-state";
import type { AvailableDutyStatus } from "@/lib/generated/prisma/enums";

/**
 * De toestanden van een vrijgekomen dienst.
 *
 * ## Wat hier misgaat als het misgaat
 *
 * Een dienst die in twee toestanden tegelijk lijkt te zijn, levert twee
 * schermen op die iets anders zeggen: de medewerker ziet hem verdwijnen, de
 * dienstindeling ziet hem nog openstaan. Niemand van beiden kan aanwijzen wie
 * er ongelijk heeft, en de dienst wordt niet gereden.
 */

const ALLE: readonly AvailableDutyStatus[] = [
  "RESERVE_PENDING",
  "OPEN",
  "ALLOCATION_PENDING",
  "ALLOCATED",
  "CLOSED",
  "CANCELLED",
];

describe("de toestanden zelf", () => {
  it("hebben allemaal een leesbare naam", () => {
    for (const toestand of ALLE) {
      expect(STATE_LABELS[toestand]).toBeTruthy();
    }
  });

  it("zijn óf onderweg óf eindstation, nooit beide en nooit geen van beide", () => {
    for (const toestand of ALLE) {
      const onderweg = OPEN_STATES.includes(toestand);
      const eind = FINAL_STATES.includes(toestand);
      expect(onderweg !== eind).toBe(true);
    }
  });
});

describe("de volgorde die de opdracht voorschrijft", () => {
  it("laat reserve eerst aan bod komen", () => {
    expect(canTransition("RESERVE_PENDING", "OPEN")).toBe(true);
    // Reserve mag hem ook zelf opvangen; dat is de bedoelde eerste route.
    expect(canTransition("RESERVE_PENDING", "ALLOCATED")).toBe(true);
  });

  it("loopt van open via toewijzing-in-behandeling naar toegewezen", () => {
    expect(canTransition("OPEN", "ALLOCATION_PENDING")).toBe(true);
    expect(canTransition("ALLOCATION_PENDING", "ALLOCATED")).toBe(true);
  });

  it("laat een gesloten inschrijving alsnog sluiten zonder toewijzing", () => {
    expect(canTransition("ALLOCATION_PENDING", "CLOSED")).toBe(true);
  });

  it("staat niet toe dat een dienst terugvalt naar het reserve-rooster", () => {
    expect(canTransition("OPEN", "RESERVE_PENDING")).toBe(false);
    expect(canTransition("ALLOCATION_PENDING", "OPEN")).toBe(false);
  });

  it("laat een eindstation een eindstation zijn", () => {
    for (const eind of FINAL_STATES) {
      for (const doel of ALLE) {
        expect(canTransition(eind, doel)).toBe(false);
      }
    }
  });

  it("legt in gewone taal uit waarom een overgang niet mag", () => {
    expect(transitionRefusal("ALLOCATED", "OPEN")).toContain("al ");
    expect(transitionRefusal("OPEN", "RESERVE_PENDING")).toContain("Mogelijk vanaf hier");
    expect(transitionRefusal("OPEN", "ALLOCATED")).toBeNull();
  });
});

describe("wie wanneer iets mag", () => {
  it("laat alleen tijdens het venster inschrijven", () => {
    expect(acceptsInterest("OPEN")).toBe(true);
    for (const toestand of ALLE.filter((t) => t !== "OPEN")) {
      expect(acceptsInterest(toestand)).toBe(false);
    }
  });

  it("laat de dienstindeling ook ná sluiting nog toewijzen", () => {
    // Juist dán is zij aan zet: het venster is dicht en de keuze moet worden
    // gemaakt. Zou toewijzen alleen tijdens het venster mogen, dan zou de
    // dienst nooit meer toegewezen kunnen worden.
    expect(acceptsAllocation("OPEN")).toBe(true);
    expect(acceptsAllocation("ALLOCATION_PENDING")).toBe(true);
    expect(acceptsAllocation("RESERVE_PENDING")).toBe(false);
    expect(acceptsAllocation("ALLOCATED")).toBe(false);
    expect(acceptsAllocation("CLOSED")).toBe(false);
  });
});

describe("de klok", () => {
  const sluit = new Date("2026-09-10T20:00:00.000Z");

  it("sluit het venster zodra de sluitingstijd is bereikt", () => {
    expect(
      stateByClock({ state: "OPEN", closesAt: sluit, now: new Date("2026-09-10T20:00:00.000Z") }),
    ).toBe("ALLOCATION_PENDING");
    expect(
      stateByClock({ state: "OPEN", closesAt: sluit, now: new Date("2026-09-11T00:00:00.000Z") }),
    ).toBe("ALLOCATION_PENDING");
  });

  it("laat het venster open zolang de tijd nog niet om is", () => {
    expect(
      stateByClock({ state: "OPEN", closesAt: sluit, now: new Date("2026-09-10T19:59:59.000Z") }),
    ).toBeNull();
  });

  it("raakt een toestand die niet van de klok afhangt niet aan", () => {
    for (const toestand of ALLE.filter((t) => t !== "OPEN")) {
      expect(
        stateByClock({ state: toestand, closesAt: sluit, now: new Date("2027-01-01T00:00:00Z") }),
      ).toBeNull();
    }
  });

  it("stelt alleen overgangen voor die ook zijn toegestaan", () => {
    // Anders zou de klok een overgang kunnen afdwingen die de tabel verbiedt,
    // en dan is er niet één waarheid maar twee.
    for (const toestand of ALLE) {
      const voorstel = stateByClock({
        state: toestand,
        closesAt: sluit,
        now: new Date("2027-01-01T00:00:00Z"),
      });
      if (voorstel !== null) {
        expect(canTransition(toestand, voorstel)).toBe(true);
      }
    }
  });
});
