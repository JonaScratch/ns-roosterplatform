import { describe, expect, it } from "vitest";
import { type SwapParty, isNoOpSwap, planSwap } from "@/domain/swap";

/**
 * Wat een ruil met het rooster doet.
 *
 * Deze tests bestaan omdat de eerste implementatie hier stukliep, en niet op
 * een manier die opviel: zij wisselde de dienst tussen de twee betrokken
 * roosterrijen, wat bij een ruil op één dag klopt en bij een ruil over twee
 * dagen betekent dat er niets gebeurt. Beide medewerkers bleven hun eigen dag
 * werken, de ruil meldde "geslaagd", en het auditspoor bevestigde dat braaf.
 */

const A: SwapParty = {
  employeeId: "emp-a",
  date: "2026-09-09",
  dutyId: "duty-043",
  scheduledDutyId: "rij-a",
};

const B: SwapParty = {
  employeeId: "emp-b",
  date: "2026-09-21",
  dutyId: "duty-141",
  scheduledDutyId: "rij-b",
};

describe("ruil op twee verschillende dagen", () => {
  const mutaties = planSwap(A, B);

  it("raakt vier roosterdagen", () => {
    expect(mutaties).toHaveLength(4);
  });

  it("maakt de dag die de aanbieder weggeeft vrij", () => {
    expect(mutaties).toContainEqual({
      employeeId: "emp-a",
      date: "2026-09-09",
      dutyId: null,
      positionType: "RUST",
    });
  });

  it("zet de aanbieder op de dag en de dienst van de tegenpartij", () => {
    expect(mutaties).toContainEqual({
      employeeId: "emp-a",
      date: "2026-09-21",
      dutyId: "duty-141",
      positionType: "DUTY",
    });
  });

  it("doet bij de tegenpartij precies het spiegelbeeld", () => {
    expect(mutaties).toContainEqual({
      employeeId: "emp-b",
      date: "2026-09-21",
      dutyId: null,
      positionType: "RUST",
    });
    expect(mutaties).toContainEqual({
      employeeId: "emp-b",
      date: "2026-09-09",
      dutyId: "duty-043",
      positionType: "DUTY",
    });
  });

  it("laat niemand op zijn eigen oude dag blijven werken", () => {
    // De kern van de fout die hier ooit zat: als beide medewerkers na de ruil
    // nog steeds een dienst hebben op de dag die zij weggaven, is er niets
    // geruild.
    const aBlijftOpEigenDag = mutaties.some(
      (m) => m.employeeId === "emp-a" && m.date === A.date && m.dutyId !== null,
    );
    const bBlijftOpEigenDag = mutaties.some(
      (m) => m.employeeId === "emp-b" && m.date === B.date && m.dutyId !== null,
    );
    expect(aBlijftOpEigenDag).toBe(false);
    expect(bBlijftOpEigenDag).toBe(false);
  });

  it("houdt het aantal gewerkte dagen per medewerker gelijk", () => {
    for (const employeeId of ["emp-a", "emp-b"]) {
      const eigen = mutaties.filter((m) => m.employeeId === employeeId);
      expect(eigen.filter((m) => m.positionType === "DUTY")).toHaveLength(1);
      expect(eigen.filter((m) => m.positionType === "RUST")).toHaveLength(1);
    }
  });
});

describe("ruil op dezelfde dag", () => {
  const sameDayB: SwapParty = { ...B, date: A.date };
  const mutaties = planSwap(A, sameDayB);

  it("raakt maar twee roosterdagen", () => {
    // Het klassieke geval valt samen met het algemene: geen apart pad, geen
    // tweede stuk logica dat uit de pas kan lopen.
    expect(mutaties).toHaveLength(2);
  });

  it("laat de twee medewerkers die dag van dienst wisselen", () => {
    expect(mutaties).toContainEqual({
      employeeId: "emp-a",
      date: "2026-09-09",
      dutyId: "duty-141",
      positionType: "DUTY",
    });
    expect(mutaties).toContainEqual({
      employeeId: "emp-b",
      date: "2026-09-09",
      dutyId: "duty-043",
      positionType: "DUTY",
    });
  });

  it("laat niemand een rustdag krijgen", () => {
    expect(mutaties.every((m) => m.positionType === "DUTY")).toBe(true);
  });
});

describe("zinloze ruil", () => {
  it("herkent dezelfde dienst op dezelfde dag", () => {
    expect(isNoOpSwap(A, { ...B, date: A.date, dutyId: A.dutyId })).toBe(true);
  });

  it("beschouwt dezelfde dienst op een andere dag wél als een ruil", () => {
    // Dit ís een echte ruil: de medewerkers wisselen van werkdag, ook al heet
    // de dienst hetzelfde.
    expect(isNoOpSwap(A, { ...B, dutyId: A.dutyId })).toBe(false);
  });

  it("beschouwt een andere dienst op dezelfde dag als een ruil", () => {
    expect(isNoOpSwap(A, { ...B, date: A.date })).toBe(false);
  });
});
