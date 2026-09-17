import { describe, expect, it } from "vitest";
import { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
import { distributionOf, dutyIndex, measureLine, spreadOf } from "@/server/optimizer/metrics";
import { patternScore, patternsOf, restQualityScore, scoreRoster } from "@/server/optimizer/scoring";
import { rankCandidates } from "@/server/optimizer/ranking";
import type { OptimizerDuty, OptimizerLine } from "@/server/optimizer/contract";

/**
 * Het kwaliteitsmodel en de rangschikking.
 *
 * De belangrijkste test staat onderaan: kwaliteit mag een overtreding nooit
 * kunnen kopen. Alles daarboven bewijst dat de deelscores meten wat ze beweren
 * te meten, want een uitlegbaar model dat het verkeerde uitlegt is nog steeds
 * onbruikbaar.
 */

const VROEG: OptimizerDuty = {
  code: "041",
  kinds: [DutyKind.VROEG],
  startMinute: 5 * 60 + 30,
  endMinute: 13 * 60,
  breakMinutes: 40,
  overtimeMinutes: 0,
  depot: "DDR",
  requiredQualifications: [],
  weight: 3,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};

const LAAT: OptimizerDuty = { ...VROEG, code: "141", kinds: [DutyKind.LAAT], startMinute: 13 * 60, endMinute: 21 * 60 + 30 };
const RANGEER: OptimizerDuty = { ...VROEG, code: "701", kinds: [DutyKind.VROEG, DutyKind.RANGEER] };

const DUTIES = dutyIndex([VROEG, LAAT, RANGEER]);

function line(pattern: string, lineNumber = 1): OptimizerLine {
  const tokens = pattern.replace(/\s+/g, "").split("");
  return {
    baseRosterCode: "DDR-VL",
    profile: RosterProfile.VROEG_LAAT,
    lineNumber,
    cycleWeeks: Math.ceil(tokens.length / 7),
    contractHours: 40,
    occupiedBy: `10000${lineNumber}`,
    days: tokens.map((token, index) => ({
      // Vanaf 1, zoals in de database. Deze fixture telde vanaf 0 en verborg
      // daarmee dat cycleOf dat ook deed.
      weekIndex: Math.floor(index / 7) + 1,
      weekday: (index % 7) + 1,
      positionType: token === "R" ? "RUST" : "DUTY",
      dutyCode: token === "V" ? "041" : token === "L" ? "141" : token === "G" ? "701" : null,
    })),
  };
}

describe("rustverdeling", () => {
  it("verdeelt rustperioden over de vier bakken", () => {
    const distribution = distributionOf([
      11 * 60,
      13 * 60,
      15 * 60,
      20 * 60,
      30 * 60,
    ]);

    expect(distribution).toEqual({
      under12h: 1,
      from12to14h: 1,
      from14to16h: 1,
      from16to24h: 1,
      over24h: 1,
    });
  });

  it("waardeert langere rust hoger", () => {
    // Laat tot 21:30 en de volgende ochtend vroeg vanaf 05:30 is acht uur rust;
    // met twee vrije dagen ertussen wordt dat ruim twee etmalen.
    const krap = measureLine(line("LVRRRRR LVRRRRR"), DUTIES);
    const ruim = measureLine(line("LRRVRRR LRRVRRR"), DUTIES);

    expect(restQualityScore([ruim])).toBeGreaterThan(restQualityScore([krap]));
  });

  it("meet de cyclus als rond: de laatste dag sluit aan op de eerste", () => {
    // Eén dienst per cyclus levert precies één rustperiode op — de wikkeling.
    const metrics = measureLine(line("VRRRRRR"), DUTIES);
    expect(metrics.restIntervals).toHaveLength(1);
    expect(metrics.restIntervals[0].minutes).toBeGreaterThan(6 * 24 * 60);
  });
});

describe("verdeling tussen lijnen", () => {
  it("noemt een gelijke verdeling nul procent verschil", () => {
    expect(spreadOf("test", [4, 4, 4]).rangePercentage).toBe(0);
  });

  it("drukt het verschil uit als percentage van het gemiddelde", () => {
    // Zwaarste 6, lichtste 2, gemiddelde 4: verschil is 100% van het gemiddelde.
    expect(spreadOf("test", [6, 4, 2]).rangePercentage).toBe(100);
  });

  it("rapporteert daarnaast de variatiecoëfficiënt", () => {
    const spread = spreadOf("test", [6, 4, 2]);
    expect(spread.coefficientOfVariation).toBeGreaterThan(0);
    expect(spread.coefficientOfVariation).toBeLessThan(spread.rangePercentage);
  });
});

describe("patronen", () => {
  it("herkent een geïsoleerde late dienst tussen vroege diensten", () => {
    const findings = patternsOf(line("VLVRRRR VRRRRRR"), DUTIES);
    expect(findings.isolatedLate).toBeGreaterThan(0);
  });

  it("herkent een achterwaartse verschuiving met korte rust", () => {
    // Laat tot 21:30, de volgende dag vroeg vanaf 05:30: acht uur rust en een
    // verschuiving van zeven en een half uur naar voren.
    const findings = patternsOf(line("LVRRRRR RRRRRRR"), DUTIES);
    expect(findings.backwardShift).toBeGreaterThan(0);
  });

  it("geeft een rooster zonder ongewenste patronen de volle score", () => {
    expect(patternScore([{ isolatedLate: 0, backwardShift: 0, largeShift: 0, heavyCluster: 0, dutyDays: 8 }])).toBe(100);
  });

  it("verlaagt de score naarmate er meer patronen zijn", () => {
    const light = patternScore([{ isolatedLate: 1, backwardShift: 0, largeShift: 0, heavyCluster: 0, dutyDays: 20 }]);
    const heavy = patternScore([{ isolatedLate: 3, backwardShift: 2, largeShift: 1, heavyCluster: 1, dutyDays: 20 }]);

    expect(heavy).toBeLessThan(light);
    expect(heavy).toBeGreaterThanOrEqual(0);
  });
});

describe("de totaalscore", () => {
  it("beloont een gelijkere verdeling van rangeerdiensten", () => {
    const scheef = scoreRoster([line("GGGRRRR", 1), line("VVVRRRR", 2)], DUTIES, []);
    const gelijk = scoreRoster([line("GVGRRRR", 1), line("VGVRRRR", 2)], DUTIES, []);

    expect(gelijk.breakdown.shuntingBalance).toBeGreaterThan(scheef.breakdown.shuntingBalance);
  });

  it("blijft binnen nul en honderd", () => {
    const scored = scoreRoster([line("VLVLVLV", 1), line("RRRRRRR", 2)], DUTIES, []);

    for (const [key, value] of Object.entries(scored.breakdown)) {
      expect(value, key).toBeGreaterThanOrEqual(0);
      expect(value, key).toBeLessThanOrEqual(100);
    }
  });

  it("zegt niets over rechtmatigheid", () => {
    // Een rooster met acht diensten op rij scoort gewoon op kwaliteit. Dat het
    // niet mag, is een andere vraag en een ander antwoord.
    const scored = scoreRoster([line("VVVVVVV VRRRRRR", 1)], DUTIES, []);
    expect(scored.breakdown.overallQualityScore).toBeGreaterThan(0);
  });
});

describe("rangschikking", () => {
  it("laat kwaliteit een bevestigde overtreding nooit compenseren", () => {
    const ranked = rankCandidates([
      {
        candidateId: "a",
        label: "Scenario A",
        validationStatus: "REJECTED",
        confirmedHardViolations: 1,
        potentialHardViolations: 0,
        rulesetIncomplete: 0,
        missingCriticalContext: 0,
        overallQualityScore: 97,
      },
      {
        candidateId: "b",
        label: "Scenario B",
        validationStatus: "TECHNICALLY_VALIDATED",
        confirmedHardViolations: 0,
        potentialHardViolations: 0,
        rulesetIncomplete: 0,
        missingCriticalContext: 0,
        overallQualityScore: 82,
      },
    ]);

    expect(ranked[0].candidateId).toBe("b");
    expect(ranked[1].candidateId).toBe("a");
    expect(ranked[1].reason).toContain("kwaliteit weegt hier niet tegenop");
  });

  it("laat kwaliteit ook een mogelijke overtreding niet compenseren", () => {
    const ranked = rankCandidates([
      {
        candidateId: "a",
        label: "A",
        validationStatus: "REJECTED",
        confirmedHardViolations: 0,
        potentialHardViolations: 1,
        rulesetIncomplete: 0,
        missingCriticalContext: 0,
        overallQualityScore: 100,
      },
      {
        candidateId: "b",
        label: "B",
        validationStatus: "REJECTED",
        confirmedHardViolations: 0,
        potentialHardViolations: 0,
        rulesetIncomplete: 5,
        missingCriticalContext: 0,
        overallQualityScore: 10,
      },
    ]);

    expect(ranked[0].candidateId).toBe("b");
  });

  it("rangschikt op kwaliteit zodra rechtmatigheid gelijk staat", () => {
    const ranked = rankCandidates([
      {
        candidateId: "laag",
        label: "Laag",
        validationStatus: "TECHNICALLY_VALIDATED",
        confirmedHardViolations: 0,
        potentialHardViolations: 0,
        rulesetIncomplete: 0,
        missingCriticalContext: 0,
        overallQualityScore: 70,
      },
      {
        candidateId: "hoog",
        label: "Hoog",
        validationStatus: "TECHNICALLY_VALIDATED",
        confirmedHardViolations: 0,
        potentialHardViolations: 0,
        rulesetIncomplete: 0,
        missingCriticalContext: 0,
        overallQualityScore: 90,
      },
    ]);

    expect(ranked[0].candidateId).toBe("hoog");
    expect(ranked[0].reason).toContain("gerangschikt op kwaliteit");
  });
});
