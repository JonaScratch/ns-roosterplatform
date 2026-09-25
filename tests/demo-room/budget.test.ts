import { describe, expect, it } from "vitest";
import { addUsage, checkBudget, ZERO_USAGE } from "../../demo-room/src/research/budget";
import { DEFAULT_BUDGET, budgetFromMinutes } from "../../demo-room/src/config";

describe("Demo Room — compute-budget (§23)", () => {
  it("staat binnen alle grenzen toe", () => {
    const uitslag = checkBudget(DEFAULT_BUDGET, ZERO_USAGE, 0, 1000);
    expect(uitslag.withinBudget).toBe(true);
  });

  it("stopt op de wandklok, ook als er verder niets is verbruikt", () => {
    const start = 0;
    const now = (DEFAULT_BUDGET.maxWallClockMinutes + 1) * 60_000;
    const uitslag = checkBudget(DEFAULT_BUDGET, ZERO_USAGE, start, now);
    expect(uitslag.withinBudget).toBe(false);
    expect(uitslag.reason).toBe("WANDKLOK");
  });

  it("stopt op maxModelCalls vóór de wandklok verstreken is", () => {
    const usage = addUsage(ZERO_USAGE, { modelCalls: DEFAULT_BUDGET.maxModelCalls });
    const uitslag = checkBudget(DEFAULT_BUDGET, usage, 0, 1000);
    expect(uitslag.withinBudget).toBe(false);
    expect(uitslag.reason).toBe("MODEL_CALLS");
  });

  it("stopt op maxFailedExperiments", () => {
    const usage = addUsage(ZERO_USAGE, { failedExperiments: DEFAULT_BUDGET.maxFailedExperiments });
    const uitslag = checkBudget(DEFAULT_BUDGET, usage, 0, 1000);
    expect(uitslag.withinBudget).toBe(false);
    expect(uitslag.reason).toBe("FAILED_EXPERIMENTS");
  });

  it("een 60-minutenbudget levert nooit een budget van 0 op enig veld", () => {
    const budget = budgetFromMinutes(60);
    expect(budget.maxWallClockMinutes).toBe(60);
    expect(budget.maxModelCalls).toBeGreaterThan(0);
    expect(budget.maxOptimizerRuns).toBeGreaterThan(0);
    expect(budget.maxCandidates).toBeGreaterThan(0);
    expect(budget.maxFailedExperiments).toBeGreaterThan(0);
  });

  it("weigert een niet-positief aantal minuten", () => {
    expect(() => budgetFromMinutes(0)).toThrow();
    expect(() => budgetFromMinutes(-5)).toThrow();
  });

  it("addUsage telt op zonder de oorspronkelijke waarde te muteren", () => {
    const eerst = addUsage(ZERO_USAGE, { candidates: 2 });
    const tweede = addUsage(eerst, { candidates: 3 });
    expect(eerst.candidates).toBe(2);
    expect(tweede.candidates).toBe(5);
  });
});
