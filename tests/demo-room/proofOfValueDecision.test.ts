import { describe, expect, it } from "vitest";
import { beoordeelProofOfValue } from "../../demo-room/src/proof/decision";
import type { AgentQualityCategory, DualQualityMeasurement } from "../../demo-room/src/types";

function agent(overrides: Partial<AgentQualityCategory> = {}): AgentQualityCategory {
  return {
    contextResolution: 80,
    multiTurnContext: 80,
    machinistTaal: 90,
    toolChoice: 85,
    falsePremiseCorrection: 75,
    grounding: 100,
    causalClaims: 100,
    unnecessaryClarifications: 90,
    latencyMs: { p50: 1200, p95: 2000 },
    ...overrides,
  };
}

function measurement(agentCat: AgentQualityCategory): DualQualityMeasurement {
  return { agent: agentCat, roster: { validity: null, packageQuality: null, profileFit: null, restRecovery: null, fairness: null, weekends: null, nightBlocks: null, rangeerDistribution: null, worstLineQuality: null, paretoResult: null, notApplicableReason: "n.v.t." }, measuredAt: "2026-09-26T00:00:00.000Z" };
}

describe("Demo Room v0.2 — proof-of-value promotiecriterium (§2)", () => {
  it("niet uitgevoerd (LOCAL REQUIRED) is nooit REJECTED, altijd KEEP_TESTING", () => {
    const leeg = measurement(agent({ contextResolution: null, multiTurnContext: null, machinistTaal: null, toolChoice: null, falsePremiseCorrection: null, grounding: null, causalClaims: null, unnecessaryClarifications: null, latencyMs: null }));
    const r = beoordeelProofOfValue({ pre: leeg, post: leeg, preHoldout: leeg, holdout: leeg, executed: false });
    expect(r.decision).toBe("KEEP_TESTING");
  });

  it("PROMOTION_CANDIDATE bij aantoonbare winst, geen regressie, holdout stabiel", () => {
    const pre = measurement(agent({ contextResolution: 77 }));
    const post = measurement(agent({ contextResolution: 91 })); // +14pp
    const preHoldout = measurement(agent({ contextResolution: 80 }));
    const holdout = measurement(agent({ contextResolution: 84 })); // geen regressie
    const r = beoordeelProofOfValue({ pre, post, preHoldout, holdout, executed: true });
    expect(r.decision).toBe("PROMOTION_CANDIDATE");
    expect(r.improvements.some((i) => i.includes("contextResolution"))).toBe(true);
  });

  it("REJECTED bij winst op de ene dimensie maar regressie op grounding (veiligheid weegt zwaarder)", () => {
    const pre = measurement(agent({ contextResolution: 77, grounding: 100 }));
    const post = measurement(agent({ contextResolution: 95, grounding: 90 })); // grounding -10, elke daling telt
    const preHoldout = measurement(agent({}));
    const holdout = measurement(agent({}));
    const r = beoordeelProofOfValue({ pre, post, preHoldout, holdout, executed: true });
    expect(r.decision).toBe("REJECTED");
    expect(r.regressions.some((x) => x.includes("grounding"))).toBe(true);
  });

  it("REJECTED bij een betekenisvolle holdoutverslechtering, ook zonder dev-regressie", () => {
    const pre = measurement(agent({ contextResolution: 77 }));
    const post = measurement(agent({ contextResolution: 95 })); // dev: flinke winst
    const preHoldout = measurement(agent({ contextResolution: 80 }));
    const holdout = measurement(agent({ contextResolution: 60 })); // holdout: -20pp t.o.v. controle
    const r = beoordeelProofOfValue({ pre, post, preHoldout, holdout, executed: true });
    expect(r.decision).toBe("REJECTED");
    expect(r.regressions.some((x) => x.startsWith("holdout"))).toBe(true);
  });

  it("KEEP_TESTING bij ruis zonder aantoonbare winst of regressie", () => {
    const pre = measurement(agent({ contextResolution: 80 }));
    const post = measurement(agent({ contextResolution: 81 })); // binnen de ruismarge
    const preHoldout = measurement(agent({}));
    const holdout = measurement(agent({}));
    const r = beoordeelProofOfValue({ pre, post, preHoldout, holdout, executed: true });
    expect(r.decision).toBe("KEEP_TESTING");
    expect(r.regressions).toEqual([]);
    expect(r.improvements).toEqual([]);
  });

  it("kleine ruis in grounding (binnen marge 0? nee -- elke daling telt) blokkeert toch promotie", () => {
    const pre = measurement(agent({ contextResolution: 80, grounding: 100 }));
    const post = measurement(agent({ contextResolution: 95, grounding: 99 })); // -1pp, nog steeds een daling
    const preHoldout = measurement(agent({}));
    const holdout = measurement(agent({}));
    const r = beoordeelProofOfValue({ pre, post, preHoldout, holdout, executed: true });
    expect(r.decision).toBe("REJECTED");
  });
});
