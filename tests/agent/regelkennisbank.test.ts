import { describe, expect, it } from "vitest";
import { searchRules } from "@/server/agent/knowledge";
import type { RuleContext } from "@/server/rules-engine/ruleset/types";

/**
 * De regelkennisbank, tegen het echte regelbestand.
 *
 * Geen database nodig: het regelbestand is code. Wat hier wordt vastgelegd is
 * dat de agent regels vindt op de woorden van een mens, en — belangrijker — dat
 * hij niets vindt wanneer er niets te vinden is.
 */

const context: RuleContext = {
  employeeGroup: "MACHINIST",
  company: "NSR",
  location: "DDR",
  onDate: "2026-09-21",
};

describe("regels zoeken op gewone woorden", () => {
  it("vindt de dagelijkse rust", () => {
    const uitkomst = searchRules("Hoeveel rust moet er tussen twee diensten zitten?", context);
    expect(uitkomst.hits.length).toBeGreaterThan(0);
    const titels = uitkomst.hits.map((h) => h.title.toLowerCase());
    expect(titels.some((t) => t.includes("rust"))).toBe(true);
  });

  it("geeft bij elke regel de bron en de status mee", () => {
    const uitkomst = searchRules("nachtdiensten achter elkaar", context);
    for (const hit of uitkomst.hits) {
      expect(hit.source.documentTitle.length).toBeGreaterThan(0);
      expect(hit.status.length).toBeGreaterThan(0);
      expect(typeof hit.blocking).toBe("boolean");
    }
  });

  it("verzint niets bij een onderwerp dat niet in het regelbestand staat", () => {
    // Gevonden in het scherm: een vraag over pauzes leverde regels over lange
    // diensten op, omdat "dienst" in hun toelichting stond.
    const uitkomst = searchRules("Welke regel geldt er voor pauzes tijdens een dienst?", context);
    const titels = uitkomst.hits.map((h) => h.title.toLowerCase());
    expect(titels.every((t) => !t.includes("aaneengesloten"))).toBe(true);
    for (const hit of uitkomst.hits) {
      expect(hit.title.toLowerCase() + hit.ruleId.toLowerCase()).toMatch(/pauze|break/);
    }
  });

  it("noemt een waarde die niet is aangeleverd niet als vrijheid", () => {
    const uitkomst = searchRules("rust nacht weekend uren", context);
    for (const hit of uitkomst.hits) {
      if (hit.value === null) {
        expect(hit.blocking).toBe(true);
      }
    }
  });

  it("draagt de versie en de juridische status van het hele regelbestand", () => {
    const uitkomst = searchRules("rust", context);
    expect(uitkomst.rulesetVersion.length).toBeGreaterThan(0);
    expect(uitkomst.rulesetLegalStatus).toMatch(/VERIFIED/);
  });
});
