import { describe, expect, it } from "vitest";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { resolveRule, type RuleDefinition } from "@/server/rules-engine/ruleset/types";
import { conflictsWithIssues } from "@/server/knowledge/consistency-check";

const CONTEXT = { employeeGroup: "MACHINIST", company: "NSR", location: "DDR", onDate: "2026-10-05" } as const;

describe("conflictsWithIssues() — Fase 10 consistency-checker infra", () => {
  // Twee echte regels als bouwstenen, zodat elke test een geldig
  // RuleDefinition-object heeft zonder de hele vorm zelf te hoeven
  // naspelen — alleen conflictsWith verschilt per scenario.
  const [ruleA, ruleB] = activeRuleset().rules;

  it("geeft niets terug op de echte regelset vandaag (conflictsWith is nog nergens gevuld)", () => {
    expect(conflictsWithIssues(activeRuleset().rules)).toEqual([]);
  });

  it("vangt een genoemde regel-id die niet bestaat", () => {
    const regels: readonly RuleDefinition[] = [{ ...ruleA, conflictsWith: ["ONBESTAAND"] }];
    expect(conflictsWithIssues(regels)).toEqual([{ ruleId: ruleA.id, kind: "UNKNOWN_TARGET", target: "ONBESTAAND" }]);
  });

  it("vangt een conflict dat maar één kant vastlegt", () => {
    const regels: readonly RuleDefinition[] = [{ ...ruleA, conflictsWith: [ruleB.id] }, { ...ruleB, conflictsWith: [] }];
    expect(conflictsWithIssues(regels)).toEqual([{ ruleId: ruleA.id, kind: "NOT_MUTUAL", target: ruleB.id }]);
  });

  it("laat een correct wederkerig conflict ongemoeid", () => {
    const regels: readonly RuleDefinition[] = [
      { ...ruleA, conflictsWith: [ruleB.id] },
      { ...ruleB, conflictsWith: [ruleA.id] },
    ];
    expect(conflictsWithIssues(regels)).toEqual([]);
  });
});

describe("PIN — NIGHT_SEQUENCE_RECOVERY (conflict-report.md #4) is één bron, dynamisch gelezen", () => {
  it("de regel resolveert vandaag naar 46 uur — verandert dit ooit, dan faalt deze test bewust", () => {
    const resolutie = resolveRule(activeRuleset(), RULE.NIGHT_SEQUENCE_RECOVERY, CONTEXT);
    expect(resolutie.kind).toBe("RESOLVED");
    if (resolutie.kind === "RESOLVED") {
      expect(resolutie.rule.value).toBe(46);
      expect(resolutie.rule.unit).toBe("HOURS");
      // src/server/services/quality-evaluation-service.ts's regelWaarde() leest
      // dit exacte veld op (RULE.NIGHT_SEQUENCE_RECOVERY via resolveRule()) —
      // dus het kwaliteitsmodel kan hier NOOIT een eigen, losse 46 hardcoderen
      // die uit de pas kan gaan lopen. Het derde punt uit conflict #4 (de
      // menselijke-roosterwaarneming in human-roster-design-principles.md,
      // bronstatus POTENTIAL) is een documentclaim, geen code — die blijft
      // een sourcing-vraag, niet iets wat deze test kan of moet dichten.
    }
  });
});
