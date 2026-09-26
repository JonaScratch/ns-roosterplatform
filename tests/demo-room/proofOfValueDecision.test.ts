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
    const r = beoordeelProofOfValue({ pre: leeg, postRuns: [leeg], preHoldout: leeg, holdout: leeg, executed: false });
    expect(r.decision).toBe("KEEP_TESTING");
  });

  it("PROMOTION_CANDIDATE bij aantoonbare winst, geen regressie, holdout stabiel", () => {
    const pre = measurement(agent({ contextResolution: 77 }));
    const post = measurement(agent({ contextResolution: 91 })); // +14pp
    const preHoldout = measurement(agent({ contextResolution: 80 }));
    const holdout = measurement(agent({ contextResolution: 84 })); // geen regressie
    const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout, holdout, executed: true });
    expect(r.decision).toBe("PROMOTION_CANDIDATE");
    expect(r.improvements.some((i) => i.includes("contextResolution"))).toBe(true);
  });

  it("REJECTED bij winst op de ene dimensie maar regressie op grounding (veiligheid weegt zwaarder)", () => {
    const pre = measurement(agent({ contextResolution: 77, grounding: 100 }));
    const post = measurement(agent({ contextResolution: 95, grounding: 90 })); // grounding -10, elke daling telt
    const preHoldout = measurement(agent({}));
    const holdout = measurement(agent({}));
    const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout, holdout, executed: true });
    expect(r.decision).toBe("REJECTED");
    expect(r.regressions.some((x) => x.includes("grounding"))).toBe(true);
  });

  it("REJECTED bij een betekenisvolle holdoutverslechtering, ook zonder dev-regressie", () => {
    const pre = measurement(agent({ contextResolution: 77 }));
    const post = measurement(agent({ contextResolution: 95 })); // dev: flinke winst
    const preHoldout = measurement(agent({ contextResolution: 80 }));
    const holdout = measurement(agent({ contextResolution: 60 })); // holdout: -20pp t.o.v. controle
    const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout, holdout, executed: true });
    expect(r.decision).toBe("REJECTED");
    expect(r.regressions.some((x) => x.startsWith("holdout"))).toBe(true);
  });

  it("KEEP_TESTING bij ruis zonder aantoonbare winst of regressie", () => {
    const pre = measurement(agent({ contextResolution: 80 }));
    const post = measurement(agent({ contextResolution: 81 })); // binnen de ruismarge
    const preHoldout = measurement(agent({}));
    const holdout = measurement(agent({}));
    const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout, holdout, executed: true });
    expect(r.decision).toBe("KEEP_TESTING");
    expect(r.regressions).toEqual([]);
    expect(r.improvements).toEqual([]);
  });

  it("kleine ruis in grounding (binnen marge 0? nee -- elke daling telt) blokkeert toch promotie", () => {
    const pre = measurement(agent({ contextResolution: 80, grounding: 100 }));
    const post = measurement(agent({ contextResolution: 95, grounding: 99 })); // -1pp, nog steeds een daling
    const preHoldout = measurement(agent({}));
    const holdout = measurement(agent({}));
    const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout, holdout, executed: true });
    expect(r.decision).toBe("REJECTED");
  });

  describe("§3 — geen promotie op één toevallige modelrun", () => {
    it("geïnspireerd op het voorbeeld uit de opdracht: twee POST-runs, holdout zakt betekenisvol — REJECTED, ook al zag POST #1 er goed uit", () => {
      const pre = measurement(agent({ contextResolution: 81.4 }));
      const post1 = measurement(agent({ contextResolution: 84.1 }));
      const post2 = measurement(agent({ contextResolution: 82.0 }));
      const preHoldout = measurement(agent({ contextResolution: 84.0 }));
      const holdout = measurement(agent({ contextResolution: 78.2 })); // -5.8pp t.o.v. de controle op dezelfde holdout-set
      const r = beoordeelProofOfValue({ pre, postRuns: [post1, post2], preHoldout, holdout, executed: true });
      expect(r.decision).toBe("REJECTED");
      expect(r.regressions.some((x) => x.startsWith("holdout"))).toBe(true);
    });

    it("kleine dev-winst die de ruismarge niet haalt (zoals in het voorbeeld: +1.65pp gemiddeld) blijft KEEP_TESTING zonder holdoutregressie", () => {
      const pre = measurement(agent({ contextResolution: 81.4 }));
      const post1 = measurement(agent({ contextResolution: 84.1 }));
      const post2 = measurement(agent({ contextResolution: 82.0 })); // gemiddeld +1.65pp, onder VERBETERMARGE
      const r = beoordeelProofOfValue({ pre, postRuns: [post1, post2], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true });
      expect(r.decision).toBe("KEEP_TESTING");
    });

    it("winst wordt op het GEMIDDELDE van de POST-runs beoordeeld, niet op de beste run", () => {
      const pre = measurement(agent({ contextResolution: 80 }));
      const goedeRun = measurement(agent({ contextResolution: 95 })); // ruim boven de marge
      const matigeRun = measurement(agent({ contextResolution: 81 })); // binnen de ruismarge
      // gemiddelde = 88, dat is nog steeds een aantoonbare verbetering — mag PROMOTION_CANDIDATE zijn
      const r1 = beoordeelProofOfValue({ pre, postRuns: [goedeRun, matigeRun], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true });
      expect(r1.decision).toBe("PROMOTION_CANDIDATE");

      // maar cherry-picken van alléén de goede run zou een ANDER besluit geven dan het eerlijke gemiddelde bij een kleinere winst
      const kleineWinst = measurement(agent({ contextResolution: 85 }));
      const geenWinst = measurement(agent({ contextResolution: 80 }));
      // gemiddelde = 82.5, ruim binnen de ruismarge van 3pp t.o.v. pre=80
      const r2 = beoordeelProofOfValue({ pre, postRuns: [kleineWinst, geenWinst], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true });
      expect(r2.decision).toBe("KEEP_TESTING");
    });

    it("een regressie op grounding in ÉÉN van de twee runs blokkeert promotie, ook als de andere run perfect scoorde", () => {
      const pre = measurement(agent({ contextResolution: 80, grounding: 100 }));
      const perfecteRun = measurement(agent({ contextResolution: 95, grounding: 100 }));
      const eenSlechteRun = measurement(agent({ contextResolution: 95, grounding: 85 })); // duidelijke terugval
      const r = beoordeelProofOfValue({ pre, postRuns: [perfecteRun, eenSlechteRun], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true });
      expect(r.decision).toBe("REJECTED");
      expect(r.regressions.some((x) => x.includes("grounding"))).toBe(true);
      expect(r.regressions.some((x) => x.includes("2 POST-runs"))).toBe(true);
    });

    it("rapporteert expliciet dat het om meerdere runs gaat in de tekst van winst/regressie", () => {
      const pre = measurement(agent({ contextResolution: 77 }));
      const post1 = measurement(agent({ contextResolution: 90 }));
      const post2 = measurement(agent({ contextResolution: 92 }));
      const r = beoordeelProofOfValue({ pre, postRuns: [post1, post2], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true });
      expect(r.decision).toBe("PROMOTION_CANDIDATE");
      expect(r.improvements.some((i) => i.includes("2 runs"))).toBe(true);
    });
  });

  describe("§ flight recorder-aanvulling — 'TEST MOET BIJ VARIANT PASSEN'", () => {
    it("een TOOL_ROUTING-variant promoveert NOOIT op winst elders wanneer toolChoice zelf niet gemeten is (null) — de echte bug uit DR-UI-202609261343", () => {
      // Precies de situatie van de eerste echte lokale run: grounding 50→100,
      // maar toolChoice bleef null omdat geen enkel item destijds `expectedTools`
      // had. Dat bewijst niet dat tool-routing verbeterde.
      const pre = measurement(agent({ grounding: 50, toolChoice: null }));
      const post = measurement(agent({ grounding: 100, toolChoice: null }));
      const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true, variantCategory: "TOOL_ROUTING" });
      expect(r.decision).toBe("KEEP_TESTING");
      expect(r.reasoning).toMatch(/toolChoice/);
      expect(r.reasoning).toMatch(/niet gemeten|niet meetbaar/i);
    });

    it("dezelfde variant promoveert wél zodra toolChoice daadwerkelijk gemeten is en meeverbetert", () => {
      const pre = measurement(agent({ grounding: 50, toolChoice: 50 }));
      const post = measurement(agent({ grounding: 100, toolChoice: 100 }));
      const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true, variantCategory: "TOOL_ROUTING" });
      expect(r.decision).toBe("PROMOTION_CANDIDATE");
    });

    it("een PROMPT-categorie-variant heeft geen primaire-dimensie-eis (mag gewoon promoveren zonder toolChoice)", () => {
      const pre = measurement(agent({ grounding: 50, toolChoice: null }));
      const post = measurement(agent({ grounding: 100, toolChoice: null }));
      const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true, variantCategory: "PROMPT" });
      expect(r.decision).toBe("PROMOTION_CANDIDATE");
    });

    it("KNOWN WEAKNESSES AFTER RUN: een promotie verbergt nooit dat andere dimensies zwak blijven", () => {
      const pre = measurement(agent({ grounding: 50, contextResolution: 0, falsePremiseCorrection: 0 }));
      const post = measurement(agent({ grounding: 100, contextResolution: 0, falsePremiseCorrection: 0 }));
      const r = beoordeelProofOfValue({ pre, postRuns: [post], preHoldout: measurement(agent({})), holdout: measurement(agent({})), executed: true, variantCategory: "PROMPT" });
      expect(r.decision).toBe("PROMOTION_CANDIDATE");
      expect(r.knownWeaknesses.some((w) => w.includes("contextResolution"))).toBe(true);
      expect(r.knownWeaknesses.some((w) => w.includes("falsePremiseCorrection"))).toBe(true);
      expect(r.reasoning).toMatch(/welke onzekerheden blijven bestaan/i);
    });
  });
});
