import { describe, expect, it } from "vitest";
import { RosterProfile } from "@/lib/generated/prisma/enums";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { buildRequest } from "./fixture";

/**
 * Fail-closed.
 *
 * Dit bestand toetst het gedrag waar het hele ontwerp om draait: dat een gat in
 * de regels of in de gegevens leidt tot "niet veilig te beoordelen" en niet tot
 * "toegestaan". Elke test hier hoort te falen zodra iemand ergens een
 * aannemelijke waarde invult om de boel draaiend te krijgen.
 */

function missingIds(result: { missingRules: readonly { ruleId: string }[] }): string[] {
  return result.missingRules.map((missing) => missing.ruleId);
}

describe("een bron voorbij zijn contractuele einddatum", () => {
  // De CAO liep contractueel tot 1 maart 2025, verlengt behoudens opzegging
  // stilzwijgend en kent nawerking tot een opvolger. Een planningsdatum in 2026
  // is dus géén bewijs dat de bepalingen niet meer gelden.
  const inSimulation = () => buildRequest({ date: "2026-03-10", duty: "08:00-17:31+40" });

  it("blijft rekenen en meldt dat de actuele status niet is geverifieerd", () => {
    const result = evaluateAssignment(inSimulation());

    expect(result.rulesWithUnverifiedCurrency).toContain(RULE.RP_MAX_DUTY_DURATION);
    expect(result.hardViolations.map((violation) => violation.ruleId)).toContain(
      RULE.RP_MAX_DUTY_DURATION,
    );
    expect(
      result.explanation.some((line) =>
        line.headline.includes("contractuele einddatum"),
      ),
    ).toBe(true);
  });

  it("kan op zo'n regel nooit een bevestigde overtreding melden", () => {
    const result = evaluateAssignment(inSimulation());
    const violation = result.hardViolations.find(
      (entry) => entry.ruleId === RULE.RP_MAX_DUTY_DURATION,
    );

    expect(violation?.confidence).toBe("POTENTIAL");
    expect(violation?.unverified.map((fact) => fact.kind)).toContain("SOURCE_STATUS");
    expect(result.outcome).toBe("POTENTIAL_HARD_VIOLATION");
  });

  it("behandelt een datum binnen de oorspronkelijke looptijd wél als lopend", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-02-10", duty: "08:00-15:00+40" }),
    );
    expect(result.rulesWithUnverifiedCurrency).toHaveLength(0);
  });

  it("blokkeert in productiemodus, waar verificatie vereist is", () => {
    const production = {
      ...activeRuleset(),
      mode: "PRODUCTION" as const,
      legalStatus: "LEGAL_RULESET_VERIFIED" as const,
    };
    const result = evaluateAssignment(inSimulation(), production);

    expect(result.outcome).toBe("RULESET_INCOMPLETE");
    expect(result.valid).toBe(false);
    expect(result.rulesWithUnverifiedCurrency).toHaveLength(0);

    const unverified = result.missingRules.find(
      (missing) => missing.ruleId === RULE.RP_MAX_DUTY_DURATION,
    );
    expect(unverified?.packageId).toBe("CAO_CURRENCY_CONFIRMATION");
    // De contractuele einddatum uit artikel 3, niet een uit de titel afgeleide
    // 31 december.
    expect(unverified?.reason).toContain("2025-02-28");
  });
});

describe("een niet-aangeleverde standplaatsparameter", () => {
  it("blokkeert wanneer de onzekerheid over de grens heen ligt", () => {
    // Zonder vastgelegde pauze ligt de arbeidstijd tussen 8:50 en 8:58, en de
    // grens tussen 8:50 en 8:58. Daar valt niets over te zeggen.
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "08:00-17:30" }),
    );

    expect(result.outcome).toBe("RULESET_INCOMPLETE");
    expect(missingIds(result)).toContain(RULE.RP_LOCATION_WORK_INTERRUPTION);
    expect(missingIds(result)).toContain(RULE.RP_STATION_BREAK_ADJUSTMENT);
  });

  it("blokkeert niet wanneer de onzekerheid er niet toe doet", () => {
    // Een dienst van zes uur haalt geen enkele grens, ook niet in de meest
    // ongunstige lezing van de onbekende werkonderbreking.
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "08:00-14:00" }),
    );

    expect(missingIds(result)).not.toContain(RULE.RP_LOCATION_WORK_INTERRUPTION);
    expect(missingIds(result)).not.toContain(RULE.RP_STATION_BREAK_ADJUSTMENT);
  });
});

describe("ontbrekende gegevens over de medewerker", () => {
  it("rekent geen urenregels zonder contractomvang", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        subject: { contractHours: null },
      }),
    );

    expect(result.outcome).toBe("RULESET_INCOMPLETE");
    expect(missingIds(result)).toContain("EMPLOYEE_CONTRACT_HOURS");
    expect(result.evaluatedRules).not.toContain(RULE.MAX_WEEKLY_HOURS);
  });

  it("vertrouwt bevoegdheden niet zonder gevalideerde matrix", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        requiredQualifications: ["ATB-VV"],
        subject: { qualifications: ["ATB-VV"] },
      }),
    );

    // De medewerker heeft de code, maar de bron ervan is niet gevalideerd.
    expect(result.outcome).toBe("RULESET_INCOMPLETE");
    expect(missingIds(result)).toContain("QUALIFICATION_MATRIX");
  });

  it("keurt een ontbrekende bevoegdheid gewoon af", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        requiredQualifications: ["ATB-VV"],
        subject: { qualifications: [] },
      }),
    );

    expect(result.outcome).toBe("POTENTIAL_HARD_VIOLATION");
    expect(result.hardViolations.map((violation) => violation.ruleId)).toContain(
      RULE.QUALIFICATIONS_REQUIRED,
    );
  });
});

describe("een profiel waarvan de bijzondere regels ontbreken", () => {
  it("beoordeelt geen Mix-plaatsing zolang die regels er niet zijn", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        subject: { rosterProfile: RosterProfile.MIX },
      }),
    );

    expect(result.outcome).toBe("RULESET_INCOMPLETE");
    expect(missingIds(result)).toContain(RULE.MIX_PROFILE_SPECIAL_RULES);
  });
});

describe("ontbrekende roosterhistorie", () => {
  it("levert 'niet te beoordelen' op in plaats van goedkeuring", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "08:00-15:00+40", coverageDays: 5 }),
    );

    expect(result.outcome).toBe("CONTEXT_INCOMPLETE");
    expect(result.valid).toBe(false);
    expect(result.contextGaps.length).toBeGreaterThan(0);
    expect(result.contextGaps.some((gap) => gap.affectedRules.length > 0)).toBe(true);
  });
});

describe("de uitleg", () => {
  it("noemt bij elke harde overtreding de bron", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "08:00-17:31+40" }),
    );

    // De eerste regel is de kop; de bevindingen staan daaronder.
    const line = result.explanation
      .slice(1)
      .find((entry) => entry.outcome === "POTENTIAL_HARD_VIOLATION");
    expect(line?.source).toContain("CAO NS");
  });

  it("meldt altijd dat het regelbestand niet als actueel is bevestigd", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "08:00-15:00+40" }),
    );

    expect(result.legalStatus).toBe("LEGAL_RULESET_NOT_CURRENTLY_VERIFIED");
    expect(
      result.explanation.some((entry) =>
        entry.headline.includes("niet als actueel bevestigd"),
      ),
    ).toBe(true);
  });
});
