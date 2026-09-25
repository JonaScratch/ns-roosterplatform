import { describe, expect, it } from "vitest";
import { CHALLENGES, findChallenge } from "../../demo-room/src/challenges/catalogue";

describe("Demo Room — challengecatalogus (§6)", () => {
  it("heeft unieke id's", () => {
    const ids = CHALLENGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dekt elk moeilijkheidsniveau 1 t/m 7 minstens één keer", () => {
    const niveaus = new Set(CHALLENGES.map((c) => c.difficulty));
    for (let n = 1; n <= 7; n += 1) expect(niveaus.has(n as 1)).toBe(true);
  });

  it("elke CHATBOT-challenge heeft turns en minstens één verborgen criterium", () => {
    for (const c of CHALLENGES.filter((c) => c.track === "CHATBOT")) {
      expect(c.turns.length).toBeGreaterThan(0);
      expect(c.hiddenInvariants.length).toBeGreaterThan(0);
    }
  });

  it("elke RESEARCHER-challenge heeft een researchGoal met minstens één doel", () => {
    for (const c of CHALLENGES.filter((c) => c.track === "RESEARCHER")) {
      expect(c.researchGoal).toBeDefined();
      expect(c.researchGoal!.goals.length).toBeGreaterThan(0);
    }
  });

  it("elk compute-budget is positief", () => {
    for (const c of CHALLENGES) {
      expect(c.computeBudgetMinutes).toBeGreaterThan(0);
      expect(c.maxModelCalls).toBeGreaterThan(0);
    }
  });

  it("findChallenge vindt een bestaande challenge en geeft null voor een onbekende", () => {
    expect(findChallenge(CHALLENGES[0].id)?.id).toBe(CHALLENGES[0].id);
    expect(findChallenge("bestaat-niet")).toBeNull();
  });

  it("level 6/7 (waarschijnlijk onmogelijk / long-horizon) staan expliciet toe dat 'geen verbetering' een goed antwoord is", () => {
    const l6 = CHALLENGES.find((c) => c.difficulty === 6)!;
    const l7 = CHALLENGES.find((c) => c.difficulty === 7)!;
    expect(l6.expectedInvariants.join(" ")).toMatch(/geen kandidaat|geen betere/i);
    expect(l7.expectedInvariants.join(" ")).toMatch(/eerlijk gerapporteerd|geen betere/i);
  });
});
