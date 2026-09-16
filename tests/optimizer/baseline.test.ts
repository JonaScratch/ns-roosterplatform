import { describe, expect, it } from "vitest";
import { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
import { BaselineOptimizer } from "@/server/optimizer/baseline-optimizer";
import type { OptimizerDuty, OptimizerInput, OptimizerLine } from "@/server/optimizer/contract";
import { dutyIndex, measureLine } from "@/server/optimizer/metrics";
import { balanceWithinRosters } from "@/server/optimizer/scoring";
import { linesFromAssignments } from "@/server/optimizer/metrics";

/**
 * De eerste optimizer.
 *
 * Twee dingen worden hier bewezen. Dat het verdelen werkelijk verdeelt — op de
 * huidige dataset is de rangeerbelasting al gelijk, dus daar zou het scenario
 * terecht niets doen en zou een meting niets aantonen. En dat een kandidaat
 * nooit iets over zijn eigen rechtmatigheid beweert.
 */

const RANGEER: OptimizerDuty = {
  code: "711",
  kinds: [DutyKind.VROEG, DutyKind.RANGEER],
  startMinute: 6 * 60,
  endMinute: 14 * 60,
  breakMinutes: 40,
  overtimeMinutes: 0,
  depot: "DDR",
  requiredQualifications: [],
  weight: 4,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};

const RIJDEND: OptimizerDuty = { ...RANGEER, code: "041", kinds: [DutyKind.VROEG] };
const DUTIES = dutyIndex([RANGEER, RIJDEND]);

function line(pattern: string, lineNumber: number): OptimizerLine {
  const tokens = pattern.replace(/\s+/g, "").split("");
  return {
    baseRosterCode: "DDR-VL",
    profile: RosterProfile.VROEG_LAAT,
    lineNumber,
    cycleWeeks: Math.ceil(tokens.length / 7),
    contractHours: 40,
    occupiedBy: `10000${lineNumber}`,
    days: tokens.map((token, index) => ({
      weekIndex: Math.floor(index / 7),
      weekday: (index % 7) + 1,
      positionType: token === "R" ? "RUST" : "DUTY",
      dutyCode: token === "G" ? "711" : token === "V" ? "041" : null,
    })),
  };
}

function inputWith(lines: readonly OptimizerLine[]): OptimizerInput {
  return {
    depot: "DDR",
    duties: [RANGEER, RIJDEND],
    rosterProfiles: [RosterProfile.VROEG_LAAT],
    rosterLines: lines,
    contractualHours: lines.map((entry) => ({
      baseRosterCode: entry.baseRosterCode,
      lineNumber: entry.lineNumber,
      hours: 40,
    })),
    hardConstraints: [],
    softObjectives: [],
    aggregatedFeedback: [],
    historicalBurden: [],
    sourceScheduleVersion: "s1",
    rulesetVersion: "r1",
    inputDataVersion: "i1",
    mode: "SIMULATION",
  };
}

describe("de verdelende variant", () => {
  it("verkleint een scheve rangeerbelasting", async () => {
    // Lijn 1 rijdt alle rangeerdiensten, lijn 2 geen enkele.
    const lines = [line("GGGGRRR", 1), line("VVVVRRR", 2)];
    const before = lines.map((entry) => measureLine(entry, DUTIES).shunting);
    expect(before).toEqual([4, 0]);

    const outcome = await new BaselineOptimizer("BALANCE_SHUNTING").generate(
      inputWith(lines),
      "Test",
    );
    if (outcome.status !== "CANDIDATE_GENERATED") {
      throw new Error("verwachtte een kandidaat");
    }

    const after = linesFromAssignments(outcome.candidate.assignments, lines).map(
      (entry) => measureLine(entry, DUTIES).shunting,
    );

    expect(Math.max(...after) - Math.min(...after)).toBeLessThanOrEqual(1);
    // Er verdwijnt geen werk: alleen de verdeling verandert.
    expect(after.reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it("laat een al gelijke verdeling met rust", async () => {
    const lines = [line("GVGVRRR", 1), line("VGVGRRR", 2)];
    const outcome = await new BaselineOptimizer("BALANCE_SHUNTING").generate(
      inputWith(lines),
      "Test",
    );
    if (outcome.status !== "CANDIDATE_GENERATED") {
      throw new Error("verwachtte een kandidaat");
    }

    const after = linesFromAssignments(outcome.candidate.assignments, lines).map(
      (entry) => measureLine(entry, DUTIES).shunting,
    );
    expect(after).toEqual([2, 2]);
  });
});

describe("wat een optimizer over zichzelf mag zeggen", () => {
  it("beweert niets over rechtmatigheid", async () => {
    const outcome = await new BaselineOptimizer("REPRODUCE").generate(
      inputWith([line("GGGGRRR", 1)]),
      "Test",
    );
    if (outcome.status !== "CANDIDATE_GENERATED") {
      throw new Error("verwachtte een kandidaat");
    }

    expect(outcome.candidate.status).toBe("CANDIDATE_GENERATED");
    expect(outcome.candidate.legalStatus).toBe("SIMULATION_ONLY");
    expect(outcome.candidate.mode).toBe("SIMULATION");
  });

  it("weigert wanneer er niets te roosteren valt", async () => {
    const outcome = await new BaselineOptimizer("REPRODUCE").generate(inputWith([]), "Leeg");
    expect(outcome.status).toBe("REFUSED");
  });
});

describe("verdeling wordt binnen een basisrooster gemeten", () => {
  it("rekent profielen niet tegen elkaar af", () => {
    // Een lijn in Vroeg heeft nul nachtdiensten en een lijn in Laat/Nacht tien.
    // Dat verschil is de bedoeling; het mag geen scheefheid heten.
    const vroeg = measureLine(line("VVVVRRR", 1), DUTIES);
    const nacht = { ...vroeg, baseRosterCode: "DDR-LN", night: 10 };

    expect(balanceWithinRosters([vroeg, nacht], (entry) => entry.night)).toBe(100);
  });

  it("meldt scheefheid binnen hetzelfde basisrooster wél", () => {
    const zwaar = { ...measureLine(line("GGGGRRR", 1), DUTIES), shunting: 6 };
    const licht = { ...measureLine(line("VVVVRRR", 2), DUTIES), shunting: 0 };

    expect(balanceWithinRosters([zwaar, licht], (entry) => entry.shunting)).toBeLessThan(100);
  });
});
