import { describe, expect, it } from "vitest";
import {
  candidateStepKeys,
  planProgress,
  progressPercentage,
  resetCandidate,
  skipRemaining,
  withStep,
} from "@/domain/generation-progress";

/**
 * De voortgang van een generatie: een percentage uit echte stappen.
 *
 * Wat hier vastligt, is dat de balk niets verzint: bij de start staat hij op
 * nul, hij beweegt alleen wanneer een stap klaar is, en een afgekeurde poging
 * zet de stappen van die kandidaat terug in plaats van ze als klaar te tellen.
 */

describe("het plan", () => {
  it("heeft voor drie kandidaten twee voorbereidende stappen, vijf per kandidaat en een afronding", () => {
    const plan = planProgress("SOLVER", 3);
    expect(plan.steps).toHaveLength(2 + 3 * 5 + 1);
    expect(plan.steps.map((step) => step.key)).toEqual([
      "INPUT",
      "STRUCTURE",
      ...candidateStepKeys(1),
      ...candidateStepKeys(2),
      ...candidateStepKeys(3),
      "FINISH",
    ]);
    expect(plan.candidatesRequested).toBe(3);
  });

  it("slaat bij de nulmeting het verbeteren over: daar valt niets te verbeteren", () => {
    const plan = planProgress("BASELINE", 1);
    expect(plan.steps.find((step) => step.key === "REPAIR_1")?.state).toBe("skipped");
    expect(plan.steps.find((step) => step.key === "SOLVE_1")?.label).toBe("Huidig rooster overnemen");
  });

  it("noemt geen dagdeel of rooster als stap: alle roosters worden samen opgebouwd", () => {
    const labels = planProgress("SOLVER", 3).steps.map((step) => step.label.toLowerCase());
    expect(labels.some((label) => label.includes("laat/nacht") || label.includes("vroeg"))).toBe(false);
  });
});

describe("het percentage", () => {
  it("staat bij de start op nul", () => {
    expect(progressPercentage(planProgress("SOLVER", 3))).toBe(0);
  });

  it("telt een actieve stap nog niet mee", () => {
    const plan = withStep(planProgress("SOLVER", 3), "INPUT", "active");
    expect(progressPercentage(plan)).toBe(0);
  });

  it("beweegt alleen met afgeronde stappen", () => {
    let plan = planProgress("SOLVER", 3);
    plan = withStep(plan, "INPUT", "done");
    plan = withStep(plan, "STRUCTURE", "done");
    expect(progressPercentage(plan)).toBe(Math.round((2 / 18) * 100));
  });

  it("zet de stappen van een afgekeurde poging terug", () => {
    let plan = planProgress("SOLVER", 3);
    for (const key of ["SOLVE_1", "ANALYSE_1", "REPAIR_1"]) {
      plan = withStep(plan, key, "done");
    }
    plan = withStep(plan, "VALIDATE_1", "failed");
    const terug = resetCandidate(plan, 1, false);
    expect(terug.steps.filter((step) => step.key.endsWith("_1")).every((step) => step.state === "pending")).toBe(true);
    expect(progressPercentage(terug)).toBe(0);
  });

  it("komt bij afronden op 100, ook als er minder kandidaten zijn gevonden", () => {
    let plan = planProgress("SOLVER", 3);
    for (const key of ["INPUT", "STRUCTURE", ...candidateStepKeys(1), ...candidateStepKeys(2)]) {
      plan = withStep(plan, key, "done");
    }
    plan = skipRemaining(withStep(plan, "FINISH", "done"));
    expect(progressPercentage(plan)).toBe(100);
    expect(plan.steps.filter((step) => step.key.endsWith("_3")).every((step) => step.state === "skipped")).toBe(true);
  });
});
