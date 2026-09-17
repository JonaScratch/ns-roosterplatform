import { describe, expect, it } from "vitest";
import { candidateRejection, profileBoundFindings } from "@/domain/candidate-acceptance";

/**
 * De poort waarlangs een gegenereerde kandidaat wordt bewaard.
 *
 * Een dienst buiten het roosterprofiel wordt geweigerd, ook als de
 * eindvalidatie hem als "mogelijke" overtreding meldt omdat de regel formeel
 * nog niet is bevestigd.
 */

function review(overrides: Partial<Parameters<typeof candidateRejection>[0]> = {}) {
  return {
    tally: { confirmedHardViolations: 0 },
    simulationEligible: true,
    perRule: [],
    reasons: { violations: [], structural: [] },
    ...overrides,
  };
}

describe("bewaren of weigeren", () => {
  it("bewaart een kandidaat zonder bevestigde overtredingen en zonder profielbevinding", () => {
    expect(candidateRejection(review())).toBeNull();
  });

  it("weigert een bevestigde harde overtreding", () => {
    expect(candidateRejection(review({ tally: { confirmedHardViolations: 2 } }))).toContain("bevestigde");
  });

  it("weigert een mogelijke profielovertreding, ook als de kandidaat verder bruikbaar heet", () => {
    const uitkomst = candidateRejection(
      review({ perRule: [{ ruleId: "ROSTER_PROFILE_BOUNDS", uniqueViolations: 3 }] }),
    );
    expect(uitkomst).toContain("roosterprofiel");
  });

  it("laat een mogelijke bevinding op een andere regel door: onzekerheid is geen overtreding", () => {
    expect(candidateRejection(review({ perRule: [{ ruleId: "NIGHT_SEQUENCE_RECOVERY", uniqueViolations: 90 }] }))).toBeNull();
  });

  it("weigert een kandidaat die niet volledig te beoordelen is", () => {
    expect(candidateRejection(review({ simulationEligible: false }))).toContain("Niet volledig");
  });

  it("telt profielbevindingen ook als er geen lijst is", () => {
    expect(profileBoundFindings(undefined)).toBe(0);
  });
});
