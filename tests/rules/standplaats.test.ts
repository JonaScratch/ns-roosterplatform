import { describe, expect, it } from "vitest";
import { evaluateCheck } from "@/server/rules-engine/adapter";
import { LOCATIONS_WITH_LOCAL_RULESET } from "@/server/rules-engine/ruleset/regio-west-2026";
import { medewerker, toets, VROEG_DIENST } from "./fixtures";

/**
 * Het lokale regelkader per standplaats.
 *
 * ## Waarom dit een eigen testbestand heeft
 *
 * De fout die deze regel moet uitsluiten, is er een van weglating: plannen voor
 * Rotterdam terwijl alleen de regels van Dordrecht bekend zijn, en daar niets
 * van merken. Zo'n fout is met geen enkele andere test te vangen, want alle
 * andere regels doen precies wat ze horen te doen. Het gat zit in wat er niet
 * wordt gevraagd.
 */

function plaatsVoor(standplaats: string) {
  return evaluateCheck(
    toets({
      employee: medewerker({ depot: standplaats }),
      duty: { ...VROEG_DIENST, depot: standplaats },
    }),
    "BASE_ROSTER_GENERATION",
  );
}

describe("een standplaats zonder lokaal kader", () => {
  const uitkomst = plaatsVoor("RTD");

  it("blokkeert", () => {
    expect(uitkomst.decision).toBe("BLOCK");
  });

  it("noemt het ontbrekende kader met naam", () => {
    expect(uitkomst.missingRules.map((regel) => regel.ruleId)).toContain(
      "LOCAL_RULESET_NOT_CONFIGURED",
    );
  });

  it("levert geen goedkeuring op", () => {
    expect(uitkomst.outcome).not.toBe("VALID_WITHIN_VALIDATED_RULESET");
    expect(uitkomst.outcome).not.toBe("VALID_WITH_WARNINGS");
  });

  it("neemt niets over van Dordrecht", () => {
    // De lokale Dordrechtregel mag hier niet meedoen: dat zou betekenen dat
    // Rotterdam op andermans afspraken rijdt zonder dat iemand dat ziet.
    const bevindingen = uitkomst.findings.map((finding) => finding.ruleId);
    expect(bevindingen).not.toContain("DORDRECHT_ROSTER_LINE_DIVISOR");
    const melding = uitkomst.missingRules.find(
      (regel) => regel.ruleId === "LOCAL_RULESET_NOT_CONFIGURED",
    );
    expect(melding?.reason).toContain("niets overgenomen");
  });
});

describe("een ingerichte standplaats", () => {
  it("kent Dordrecht wél een lokaal kader toe", () => {
    expect(LOCATIONS_WITH_LOCAL_RULESET).toContain("DDR");
    const uitkomst = plaatsVoor("DDR");
    expect(uitkomst.missingRules.map((regel) => regel.ruleId)).not.toContain(
      "LOCAL_RULESET_NOT_CONFIGURED",
    );
  });

  it("is de enige standplaats waarvoor dat geldt", () => {
    // Verandert dit, dan hoort dat een bewuste wijziging te zijn met een
    // aangeleverd kader erachter — niet iets wat meelift met een databasevulling.
    expect([...LOCATIONS_WITH_LOCAL_RULESET]).toEqual(["DDR"]);
  });
});
