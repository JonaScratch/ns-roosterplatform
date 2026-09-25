import { describe, expect, it } from "vitest";
import { vindDuplicaat } from "../../demo-room/src/store/experimentMemory";
import type { ExperimentRecord } from "../../demo-room/src/types";

function record(overrides: Partial<ExperimentRecord>): ExperimentRecord {
  return {
    id: "exp-1",
    runId: "run-1",
    timestamp: new Date().toISOString(),
    soort: "PROMPT_VARIANT",
    hypothesis: "Duidelijkere toolbeschrijving vermindert ongegronde beweringen",
    reason: "",
    configuration: { promptVariant: "variant-a-tool-hint" },
    candidateProduced: null,
    validatorResult: null,
    qualityMetrics: null,
    baselineMetrics: null,
    comparisonWithBaseline: null,
    outcome: "FAILURE",
    failureReason: "geen meetbaar verschil met de controle",
    nextRecommendation: "andere hypothese proberen",
    decision: "REJECTED",
    ...overrides,
  };
}

describe("Demo Room — experimentgeheugen (duplicaatdetectie)", () => {
  it("herkent experiment 17 als duplicaat van experiment 4 (§13)", () => {
    const eerder = record({ id: "exp-4" });
    const kandidaat = record({
      id: "exp-17",
      hypothesis: "Een duidelijkere beschrijving van de tool vermindert ongegronde beweringen",
    });
    const bevinding = vindDuplicaat(kandidaat, [eerder]);
    expect(bevinding.isDuplicaat).toBe(true);
    expect(bevinding.eerdereMatch?.id).toBe("exp-4");
    expect(bevinding.toelichting).toContain("exp-4");
  });

  it("beschouwt een compleet ander onderwerp niet als duplicaat", () => {
    const eerder = record({ id: "exp-4" });
    const kandidaat = record({
      id: "exp-99",
      hypothesis: "Nachten beter clusteren door een hoger gewicht op NIGHT_CLUSTERING",
      configuration: { goal: "NIGHT_CLUSTERING" },
    });
    const bevinding = vindDuplicaat(kandidaat, [eerder]);
    expect(bevinding.isDuplicaat).toBe(false);
  });

  it("vergelijkt alleen binnen hetzelfde soort experiment", () => {
    const eerder = record({ id: "exp-4", soort: "ENGINE_VARIANT" });
    const kandidaat = record({ id: "exp-17", soort: "PROMPT_VARIANT" });
    const bevinding = vindDuplicaat(kandidaat, [eerder]);
    expect(bevinding.isDuplicaat).toBe(false);
    expect(bevinding.eerdereMatch).toBeNull();
  });

  it("gelijke kernwoorden maar andere configuratie is verwant, geen duplicaat", () => {
    const eerder = record({ id: "exp-4", configuration: { promptVariant: "variant-a-tool-hint" } });
    const kandidaat = record({
      id: "exp-17",
      hypothesis: "Een duidelijkere beschrijving van de tool vermindert ongegronde beweringen",
      configuration: { promptVariant: "variant-c-anders" },
    });
    const bevinding = vindDuplicaat(kandidaat, [eerder]);
    expect(bevinding.isDuplicaat).toBe(false);
    expect(bevinding.eerdereMatch?.id).toBe("exp-4");
  });

  it("zonder eerdere experimenten is er nooit een duplicaat", () => {
    const bevinding = vindDuplicaat(record({}), []);
    expect(bevinding.isDuplicaat).toBe(false);
    expect(bevinding.eerdereMatch).toBeNull();
  });
});
