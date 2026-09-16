import { describe, expect, it } from "vitest";
import {
  type ValidationTally,
  publicationEligible,
  simulationEligible,
  technicalStatusOf,
} from "@/domain/candidate";

/**
 * De scheiding tussen "bruikbaar als simulatie" en "mag formeel gepubliceerd".
 *
 * Deze tests bestaan omdat die twee ooit hetzelfde antwoord kregen. Eén teller
 * boven nul — ook als dat alleen betekende dat de Arbeidstijdenwet nog niet
 * formeel was aangeleverd — maakte een compleet doorgerekend scenario
 * `REJECTED`, en daarmee onbruikbaar om te analyseren of te vergelijken.
 *
 * Wat hier wordt vastgelegd is niet dat er soepeler wordt geoordeeld, maar dat
 * er preciezer wordt geoordeeld: onzekerheid blokkeert publicatie en houdt op
 * met doen alsof het een bewezen fout in het rooster is.
 */

const SCHOON: ValidationTally = {
  checkedAssignments: 2206,
  confirmedHardViolations: 0,
  potentialHardViolations: 0,
  rulesetIncomplete: 0,
  missingCriticalContext: 0,
  uniqueViolations: 0,
  affectedEmployees: 0,
  unvalidatableAssignments: 0,
};

describe("technicalStatusOf", () => {
  it("keurt een volledig schone kandidaat goed", () => {
    expect(technicalStatusOf(SCHOON)).toBe("TECHNICALLY_VALIDATED");
  });

  it("noemt een bevestigde overtreding een bevestigde overtreding", () => {
    expect(technicalStatusOf({ ...SCHOON, confirmedHardViolations: 1 })).toBe(
      "CONFIRMED_HARD_VIOLATION",
    );
  });

  it("noemt een onbeoordeelbare kandidaat structureel ongeldig", () => {
    expect(technicalStatusOf({ ...SCHOON, unvalidatableAssignments: 1 })).toBe(
      "INVALID_STRUCTURE",
    );
  });

  it("noemt een onbevestigde bron geen overtreding", () => {
    expect(technicalStatusOf({ ...SCHOON, potentialHardViolations: 180 })).toBe(
      "TECHNICALLY_VALID_UNVERIFIED_RULES",
    );
  });

  it("noemt een ontbrekende regelparameter geen overtreding", () => {
    expect(technicalStatusOf({ ...SCHOON, rulesetIncomplete: 2194 })).toBe(
      "TECHNICALLY_VALID_UNVERIFIED_RULES",
    );
  });

  it("noemt ontbrekende historie geen overtreding", () => {
    expect(technicalStatusOf({ ...SCHOON, missingCriticalContext: 1222 })).toBe(
      "TECHNICALLY_VALID_INCOMPLETE_CONTEXT",
    );
  });

  it("laat een bewezen overtreding zwaarder wegen dan onzekerheid", () => {
    expect(
      technicalStatusOf({
        ...SCHOON,
        confirmedHardViolations: 1,
        potentialHardViolations: 99,
        missingCriticalContext: 99,
      }),
    ).toBe("CONFIRMED_HARD_VIOLATION");
  });

  it("laat een onbeoordeelbare kandidaat zwaarder wegen dan onzekerheid", () => {
    expect(
      technicalStatusOf({ ...SCHOON, unvalidatableAssignments: 1, potentialHardViolations: 99 }),
    ).toBe("INVALID_STRUCTURE");
  });
});

describe("simulationEligible", () => {
  it("laat onzekerheid toe: het scenario blijft te analyseren en te vergelijken", () => {
    expect(simulationEligible("TECHNICALLY_VALIDATED")).toBe(true);
    expect(simulationEligible("TECHNICALLY_VALID_UNVERIFIED_RULES")).toBe(true);
    expect(simulationEligible("TECHNICALLY_VALID_INCOMPLETE_CONTEXT")).toBe(true);
  });

  it("laat een bewezen overtreding of een onbeoordeelbare kandidaat niet toe", () => {
    expect(simulationEligible("CONFIRMED_HARD_VIOLATION")).toBe(false);
    expect(simulationEligible("INVALID_STRUCTURE")).toBe(false);
  });

  it("laat een verouderde, gemanipuleerde of ongetoetste kandidaat niet toe", () => {
    expect(simulationEligible("NOT_VALIDATED")).toBe(false);
    expect(simulationEligible("STALE_SCHEDULE")).toBe(false);
    expect(simulationEligible("STALE_RULESET")).toBe(false);
    expect(simulationEligible("STALE_INPUT")).toBe(false);
    expect(simulationEligible("TAMPERED")).toBe(false);
  });

  it("laat de oude verzamelbak niet toe: die kan een bewezen overtreding bevatten", () => {
    expect(simulationEligible("REJECTED")).toBe(false);
  });
});

describe("publicationEligible", () => {
  const BEVESTIGD = { rulesetLegallyVerified: true, missingRulePackages: 0 };

  it("blijft dicht zolang het regelbestand niet formeel is bevestigd", () => {
    expect(
      publicationEligible({
        status: "TECHNICALLY_VALIDATED",
        rulesetLegallyVerified: false,
        missingRulePackages: 0,
      }),
    ).toBe(false);
  });

  it("blijft dicht zolang er regelpakketten ontbreken", () => {
    expect(
      publicationEligible({
        status: "TECHNICALLY_VALIDATED",
        rulesetLegallyVerified: true,
        missingRulePackages: 10,
      }),
    ).toBe(false);
  });

  it("blijft dicht bij elke vorm van onzekerheid, ook met een bevestigd regelbestand", () => {
    for (const status of [
      "TECHNICALLY_VALID_UNVERIFIED_RULES",
      "TECHNICALLY_VALID_INCOMPLETE_CONTEXT",
      "CONFIRMED_HARD_VIOLATION",
      "INVALID_STRUCTURE",
      "REJECTED",
      "NOT_VALIDATED",
      "STALE_RULESET",
      "TAMPERED",
    ] as const) {
      expect(publicationEligible({ status, ...BEVESTIGD })).toBe(false);
    }
  });

  it("gaat alleen open bij een schone kandidaat én een bevestigd regelbestand", () => {
    expect(publicationEligible({ status: "TECHNICALLY_VALIDATED", ...BEVESTIGD })).toBe(true);
  });

  it("is in de huidige werkelijkheid dus altijd dicht", () => {
    // Het actieve regelbestand is niet bevestigd en mist pakketten. Deze
    // combinatie hoort in geen enkele status een `true` op te leveren.
    for (const status of [
      "TECHNICALLY_VALIDATED",
      "TECHNICALLY_VALID_UNVERIFIED_RULES",
      "TECHNICALLY_VALID_INCOMPLETE_CONTEXT",
    ] as const) {
      expect(
        publicationEligible({ status, rulesetLegallyVerified: false, missingRulePackages: 10 }),
      ).toBe(false);
    }
  });
});
