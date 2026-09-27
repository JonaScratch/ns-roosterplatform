import { describe, expect, it } from "vitest";
import { generateCandidateFromWeakness } from "../../demo-room/src/develop/generateCandidate";
import { findPromptVariant, PROMPT_VARIANTS } from "../../demo-room/src/variants/promptVariants";

/**
 * Zuivere unit tests voor de kandidaatgenerator (§ SCOPE CORRECTION —
 * "agent maakt experimentele wijziging"). Zie `developmentCycle.test.ts`
 * voor het bewijs dat een gegenereerde kandidaat ook echt door de volledige
 * meet-en-opslagketen heen komt.
 */

describe("generateCandidateFromWeakness", () => {
  it("genereert een kandidaat die NIET in de vaste PROMPT_VARIANTS-lijst staat", () => {
    const candidate = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 });
    expect(findPromptVariant(candidate.id)).toBeNull();
    expect(PROMPT_VARIANTS.some((v) => v.id === candidate.id)).toBe(false);
  });

  it("kiest een dimensiespecifiek sjabloon wanneer er een bestaat, en verwijst naar de gemeten zwakte", () => {
    const candidate = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: "grounding", weakestScore: 42 });
    expect(candidate.description).toMatch(/grounding/i);
    expect(candidate.description).toMatch(/42/);
    expect(candidate.productionText).toMatch(/tool/i);
  });

  it("valt terug op een generiek sjabloon bij een onbekende/ontbrekende dimensie", () => {
    const candidate = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: null, weakestScore: null });
    expect(candidate.productionText).not.toBeNull();
    expect(candidate.productionText!.length).toBeGreaterThan(0);
    expect(candidate.id).toContain("algemeen");
  });

  it("genereert unieke id's bij herhaalde aanroepen voor dezelfde dimensie (geen collisie binnen één run)", () => {
    const a = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 });
    const b = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: "toolChoice", weakestScore: 55 });
    expect(a.id).not.toBe(b.id);
  });

  it("respecteert uitgeslotenIds: genereert nooit een id die al is uitgesloten", () => {
    const eerste = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: "causalClaims", weakestScore: 30 });
    const tweede = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: "causalClaims", weakestScore: 30 }, [eerste.id]);
    expect(tweede.id).not.toBe(eerste.id);
  });

  it("de transform-functie voegt de productionText additief toe aan de basisinstructie (nooit vervangend)", () => {
    const candidate = generateCandidateFromWeakness({ executed: true, notExecutedReason: null, weakestDimension: "causalClaims", weakestScore: 30 });
    const basis = "BASISINSTRUCTIE";
    const resultaat = candidate.transform(basis, {} as never);
    expect(resultaat.startsWith(basis)).toBe(true);
    expect(resultaat).toContain(candidate.productionText);
  });
});
