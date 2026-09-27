import { describe, expect, it } from "vitest";
import { fromMemoryStatus, fromOperationalRequirementSource, fromRuleStatus } from "@/server/knowledge/canonical-status";
import type { RuleStatus } from "@/server/rules-engine/ruleset/types";

/**
 * Dekking van elke enum-waarde uit alle drie bronsystemen (§ knowledge-model.md
 * §4/§6) — puur functioneel, geen database, geen model, geen gedragswijziging
 * van iets bestaands: deze functies worden vandaag nergens aangeroepen.
 */
describe("canonical-status — projectie van RuleStatus", () => {
  const gevallen: readonly [RuleStatus, string][] = [
    ["VALIDATED", "FORMALLY_CONFIRMED"],
    ["SOURCE_TRANSCRIBED", "TRANSCRIBED_UNVALIDATED"],
    ["UNVALIDATED_LOCAL_PARAMETER", "LOCAL_UNVALIDATED"],
    ["NEEDS_POLICY_VALIDATION", "PROPOSED"],
    ["POLICY_PENDING", "PROPOSED"],
    ["UNRESOLVED", "PROPOSED"],
    ["NOT_SUPPLIED", "MISSING"],
  ];

  it.each(gevallen)("vertaalt %s naar %s", (status, verwacht) => {
    expect(fromRuleStatus(status)).toBe(verwacht);
  });
});

describe("canonical-status — projectie van operational-requirements-bron", () => {
  it("vertaalt de enige bestaande bronwaarde naar LOCAL_UNVALIDATED", () => {
    expect(fromOperationalRequirementSource("USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT")).toBe("LOCAL_UNVALIDATED");
  });
});

describe("canonical-status — projectie van MemoryStatus", () => {
  const gevallen: readonly ["PROPOSED" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "SUPERSEDED", string][] = [
    ["PROPOSED", "PROPOSED"],
    ["APPROVED", "FORMALLY_CONFIRMED"],
    ["REJECTED", "REJECTED"],
    ["WITHDRAWN", "WITHDRAWN"],
    ["SUPERSEDED", "SUPERSEDED"],
  ];

  it.each(gevallen)("vertaalt %s naar %s", (status, verwacht) => {
    expect(fromMemoryStatus(status)).toBe(verwacht);
  });
});
