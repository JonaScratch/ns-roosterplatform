import { describe, expect, it } from "vitest";
import { candidateHash, isUnmodified } from "@/domain/candidate";
import { validateCandidate } from "@/server/rules-engine/final-validator";
import { buildCandidate, contextFor, portFor, type CandidateSpec } from "./fixture";

/**
 * Verouderde en gewijzigde kandidaten.
 *
 * Een kandidaat is een momentopname. Hij is gemaakt op een bepaald bronrooster,
 * onder een bepaald regelbestand, met bepaalde gegevens over medewerkers en
 * diensten. Verandert één van die drie, dan slaat de beoordeling nergens meer
 * op — en dat is het gevaarlijkst wanneer niemand het merkt, want de kandidaat
 * ziet er nog precies hetzelfde uit.
 */

const BASE: CandidateSpec = { lines: [{ pattern: "VRRVRRR VRRVRRR" }] };

describe("het bronrooster verandert tussen generatie en beoordeling", () => {
  it("levert STALE_SCHEDULE op en beoordeelt niets", async () => {
    const candidate = buildCandidate(BASE);

    const result = await validateCandidate(
      candidate,
      { ...contextFor(BASE), sourceScheduleVersion: "schedule-v2" },
      portFor(BASE),
    );

    expect(result.status).toBe("STALE_SCHEDULE");
    expect(result.tally.checkedAssignments).toBe(0);
    expect(result.blockingReasons.join(" ")).toContain("schedule-v1");
    expect(result.blockingReasons.join(" ")).toContain("schedule-v2");
    expect(result.publishable).toBe(false);
  });
});

describe("het regelbestand verandert tussen generatie en beoordeling", () => {
  it("levert STALE_RULESET op en vraagt om hervalidatie", async () => {
    const candidate = buildCandidate(BASE);

    const result = await validateCandidate(
      candidate,
      { ...contextFor(BASE), rulesetVersion: "ruleset-v2" },
      portFor(BASE),
    );

    expect(result.status).toBe("STALE_RULESET");
    expect(result.tally.checkedAssignments).toBe(0);
    expect(result.blockingReasons.join(" ")).toContain("Opnieuw valideren");
  });
});

describe("de invoergegevens veranderen", () => {
  it("levert STALE_INPUT op", async () => {
    const result = await validateCandidate(
      buildCandidate(BASE),
      { ...contextFor(BASE), inputDataVersion: "input-v2" },
      portFor(BASE),
    );

    expect(result.status).toBe("STALE_INPUT");
    expect(result.blockingReasons.join(" ")).toContain("gewijzigd sinds de generatie");
  });
});

describe("onveranderlijkheid", () => {
  it("bevriest de toewijzingen na generatie", () => {
    const candidate = buildCandidate(BASE);

    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.assignments)).toBe(true);
    expect(() => {
      (candidate.assignments as { push?: (value: unknown) => void }).push?.({});
    }).toThrow();
  });

  it("herkent een kandidaat waarvan de inhoud is aangepast", async () => {
    const candidate = buildCandidate(BASE);
    // Een aanvaller of een bug die de vingerafdruk laat staan en de inhoud wijzigt.
    const tampered = {
      ...candidate,
      assignments: [
        ...candidate.assignments.slice(1),
        { ...candidate.assignments[0], dutyCode: "241" },
      ],
    };

    expect(isUnmodified(tampered)).toBe(false);

    const result = await validateCandidate(tampered, contextFor(BASE), portFor(BASE));
    expect(result.status).toBe("TAMPERED");
    expect(result.tally.checkedAssignments).toBe(0);
  });

  it("geeft dezelfde inhoud dezelfde vingerafdruk, ongeacht de volgorde", () => {
    const candidate = buildCandidate(BASE);
    const { hash, ...rest } = candidate;
    const shuffled = { ...rest, assignments: [...rest.assignments].reverse() };

    expect(candidateHash(shuffled)).toBe(hash);
  });

  it("geeft een ander regelbestand een andere vingerafdruk", () => {
    const first = buildCandidate(BASE);
    const second = buildCandidate({ ...BASE, rulesetVersion: "ruleset-v2" });

    // Dezelfde toewijzingen, een ander regelbestand: geen gelijk voorstel.
    expect(second.hash).not.toBe(first.hash);
  });
});
