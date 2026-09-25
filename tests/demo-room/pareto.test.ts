import { describe, expect, it } from "vitest";
import { domineert, paretoFront } from "../../demo-room/src/benchmark/pareto";
import type { CandidatePoint } from "../../demo-room/src/types";

describe("Demo Room — Pareto-analyse (§11)", () => {
  const richting = { weekends: true, fairness: true, nights: null as boolean | null };

  it("A domineert B als A op alles minstens gelijk is en op iets strikt beter", () => {
    const a: CandidatePoint = { id: "A", label: "A", metrics: { weekends: 80, fairness: 70 } };
    const b: CandidatePoint = { id: "B", label: "B", metrics: { weekends: 75, fairness: 70 } };
    expect(domineert(a, b, richting)).toBe(true);
    expect(domineert(b, a, richting)).toBe(false);
  });

  it("geen dominantie als elk op iets anders wint", () => {
    const a: CandidatePoint = { id: "A", label: "A", metrics: { weekends: 90, fairness: 60 } };
    const b: CandidatePoint = { id: "B", label: "B", metrics: { weekends: 70, fairness: 85 } };
    expect(domineert(a, b, richting)).toBe(false);
    expect(domineert(b, a, richting)).toBe(false);
  });

  it("een metric met higherIsBetter=null telt niet mee in dominantie", () => {
    const a: CandidatePoint = { id: "A", label: "A", metrics: { weekends: 80, fairness: 70, nights: 2 } };
    const b: CandidatePoint = { id: "B", label: "B", metrics: { weekends: 80, fairness: 70, nights: 9 } };
    // gelijk op de twee richtinggevende metrics, "nights" verschilt maar telt niet mee
    expect(domineert(a, b, richting)).toBe(false);
    expect(domineert(b, a, richting)).toBe(false);
  });

  it("paretoFront: kandidaat A wint op X, kandidaat B wint op Z, allebei op het front", () => {
    const candidates: CandidatePoint[] = [
      { id: "A", label: "A", metrics: { weekends: 90, fairness: 60 } },
      { id: "B", label: "B", metrics: { weekends: 70, fairness: 85 } },
      { id: "C", label: "C", metrics: { weekends: 60, fairness: 55 } }, // gedomineerd door zowel A als B
    ];
    const result = paretoFront(candidates, richting);
    expect([...result.front].sort()).toEqual(["A", "B"]);
    expect(result.dominated).toEqual(["C"]);
    expect(result.wins.A).toContain("weekends");
    expect(result.wins.B).toContain("fairness");
  });

  it("het beste compromis kan op het front staan zonder ergens op te winnen t.o.v. het front als geheel", () => {
    const candidates: CandidatePoint[] = [
      { id: "A", label: "A", metrics: { weekends: 90, fairness: 60 } },
      { id: "B", label: "B", metrics: { weekends: 60, fairness: 90 } },
      { id: "C", label: "C", metrics: { weekends: 75, fairness: 75 } }, // door niemand gedomineerd
    ];
    const result = paretoFront(candidates, richting);
    expect([...result.front].sort()).toEqual(["A", "B", "C"]);
  });
});
