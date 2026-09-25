import { describe, expect, it } from "vitest";
import { beoordeelPromotie, renderPromotionProposal } from "../../demo-room/src/promotion/proposal";

describe("Demo Room — promotion proposals (§29)", () => {
  it("PROMOTE alleen als er winst is, geen regressie, én een holdoutmeting", () => {
    const p = beoordeelPromotie({
      change: "tool hint duidelijker",
      reason: "minder ongegronde profielbeweringen",
      pre: { passRate: 82 },
      post: { passRate: 94 },
      holdout: { passRate: 93 },
    });
    expect(p.recommendation).toBe("PROMOTE");
    expect(p.regressions).toEqual([]);
  });

  it("MORE_TESTING_REQUIRED als er winst is maar nog geen holdoutmeting", () => {
    const p = beoordeelPromotie({
      change: "x",
      reason: "y",
      pre: { passRate: 82 },
      post: { passRate: 94 },
      holdout: null,
    });
    expect(p.recommendation).toBe("MORE_TESTING_REQUIRED");
  });

  it("DO_NOT_PROMOTE bij een regressie, ook als de totaalscore stijgt", () => {
    const p = beoordeelPromotie({
      change: "x",
      reason: "y",
      pre: { passRate: 82, safetyRefusals: 100 },
      post: { passRate: 94, safetyRefusals: 90 },
      holdout: { passRate: 95, safetyRefusals: 90 },
    });
    expect(p.recommendation).toBe("DO_NOT_PROMOTE");
    expect(p.regressions.some((r) => r.startsWith("safetyRefusals"))).toBe(true);
  });

  it("DO_NOT_PROMOTE zonder enige winst", () => {
    const p = beoordeelPromotie({ change: "x", reason: "y", pre: { passRate: 82 }, post: { passRate: 82 }, holdout: { passRate: 82 } });
    expect(p.recommendation).toBe("DO_NOT_PROMOTE");
  });

  it("renderPromotionProposal volgt het §29-format", () => {
    const p = beoordeelPromotie({ change: "tool hint", reason: "reden", pre: { passRate: 82 }, post: { passRate: 94 }, holdout: { passRate: 93 } });
    const tekst = renderPromotionProposal(p);
    expect(tekst).toContain("Change:");
    expect(tekst).toContain("PRE:");
    expect(tekst).toContain("POST:");
    expect(tekst).toContain("Holdout:");
    expect(tekst).toContain("Regressions:");
    expect(tekst).toContain("Recommendation:");
    expect(tekst).toContain("PROMOTE");
  });
});
