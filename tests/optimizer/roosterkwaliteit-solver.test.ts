import { describe, expect, it } from "vitest";
import type { CandidateAssignment } from "@/domain/candidate";
import { type QualityDuty, type QualityRosterInput, dutyKey, measureRoster } from "@/domain/roster-quality";
import type { OptimizerDuty, OptimizerInput, OptimizerLine } from "@/server/optimizer/contract";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { BALANCED_WEIGHTS, STRATEGY_WEIGHTS, weightsForRebuild } from "@/server/optimizer/objective-weights";

/**
 * De solver en roosterkwaliteit: nachten in reeksen, rustige overgangen,
 * volledige dekking en echt verschillende kandidaten.
 *
 * ## Hoe deze tests zijn opgezet
 *
 * Twee roosterlijnen van ma–vr, en per weekdag precies zoveel diensten als er
 * dienstdagen zijn. Elke dienst móet dus worden geplaatst, en de enige vrijheid
 * van de solver is wélke lijn welke dienst krijgt. De dagelijkse rust staat laag
 * (zes uur), zodat een slechte verdeling niet al door een harde regel wordt
 * uitgesloten: wat hier wordt getoetst, is dat de zachte doelen het werk doen.
 */

function duty(code: string, start: number, eind: number, kinds: readonly string[], weekday: number): OptimizerDuty {
  return {
    code,
    kinds: kinds as OptimizerDuty["kinds"],
    startMinute: start,
    endMinute: eind,
    breakMinutes: 30,
    overtimeMinutes: 0,
    depot: "DDR",
    requiredQualifications: [],
    weight: 3,
    weekdays: [weekday],
  };
}

function line(code: string, profile: OptimizerLine["profile"], lineNumber: number, patroon: string): OptimizerLine {
  return {
    baseRosterCode: code,
    profile,
    lineNumber,
    cycleWeeks: 1,
    contractHours: 40,
    occupiedBy: null,
    days: [...patroon].map((teken, index) => ({
      weekIndex: 1,
      weekday: index + 1,
      positionType: teken === "D" ? "DUTY" : "RUST",
      dutyCode: null,
    })),
  };
}

function input(lines: readonly OptimizerLine[], duties: readonly OptimizerDuty[]): OptimizerInput {
  return {
    depot: "DDR",
    duties,
    rosterProfiles: [...new Set(lines.map((entry) => entry.profile))],
    rosterLines: lines,
    contractualHours: lines.map((entry) => ({
      baseRosterCode: entry.baseRosterCode,
      lineNumber: entry.lineNumber,
      hours: 40,
    })),
    hardConstraints: [
      { ruleId: "RP_DAILY_REST_PLANNED", title: "Dagelijkse rust", unit: "HOURS", value: 6, translatable: true },
      { ruleId: "MAX_CONSECUTIVE_SERVICES", title: "Aaneengesloten diensten", unit: "COUNT", value: 7, translatable: true },
    ],
    softObjectives: [],
    aggregatedFeedback: [],
    historicalBurden: [],
    sourceScheduleVersion: "s1",
    rulesetVersion: "r1",
    inputDataVersion: "i1",
    mode: "SIMULATION",
  };
}

const WEEKDAGEN = [1, 2, 3, 4, 5];
const LATE = WEEKDAGEN.map((dag) => duty(`14${dag}`, 14 * 60, 22 * 60, ["LAAT"], dag));
const NACHT = WEEKDAGEN.map((dag) => duty(`24${dag}`, 23 * 60, 31 * 60, ["NACHT"], dag));
const VROEG = WEEKDAGEN.map((dag) => duty(`04${dag}`, 6 * 60, 14 * 60, ["VROEG"], dag));

function kwaliteit(
  assignments: readonly CandidateAssignment[],
  duties: readonly OptimizerDuty[],
  code: string,
  profile: string,
) {
  const map = new Map<string, QualityDuty>(
    duties.map((entry) => [
      dutyKey(entry.code, entry.weekdays[0]),
      {
        code: entry.code,
        weekday: entry.weekdays[0],
        startMinute: entry.startMinute,
        endMinute: entry.endMinute,
        kinds: entry.kinds,
      },
    ]),
  );
  const rooster: QualityRosterInput = {
    code,
    name: code,
    profile,
    weeksPerLine: 1,
    days: assignments
      .filter((entry) => entry.baseRosterCode === code)
      .map((entry) => ({
        lineNumber: entry.lineNumber,
        weekIndex: entry.weekIndex,
        weekday: entry.weekday,
        positionType: entry.positionType,
        dutyCode: entry.dutyCode,
      })),
  };
  return measureRoster(rooster, map);
}

async function genereer(
  lines: readonly OptimizerLine[],
  duties: readonly OptimizerDuty[],
  options: ConstructorParameters<typeof CpSatOptimizer>[2] = {},
  profiel = SCENARIO_PROFILES[0],
) {
  const optimizer = new CpSatOptimizer(profiel, 20, { workers: 1, ...options });
  const uitkomst = await optimizer.generate(input(lines, duties), "Test");
  if (uitkomst.status !== "CANDIDATE_GENERATED") {
    throw new Error(`verwachtte een kandidaat: ${uitkomst.reason}`);
  }
  return uitkomst.candidate;
}

describe("nachten", () => {
  const lijnen = [line("LN", "LAAT_NACHT", 1, "DDDDDRR"), line("LN", "LAAT_NACHT", 2, "DDDDDRR")];
  const diensten = [...LATE, ...NACHT];

  it("komen in reeksen: geen losse nacht wanneer een reeks mogelijk is", async () => {
    const kandidaat = await genereer(lijnen, diensten, { nightRosterCodes: ["LN"] });
    const gemeten = kwaliteit(kandidaat.assignments, diensten, "LN", "LAAT_NACHT");
    expect(gemeten.nights.total).toBe(5);
    expect(gemeten.nights.singletons).toBe(0);
    expect(gemeten.nights.threeOrMore).toBeGreaterThanOrEqual(1);
  });

  it("blijven bij elke hoofdstrategie in reeksen", async () => {
    for (const profiel of SCENARIO_PROFILES.filter((entry) => entry.primary)) {
      const kandidaat = await genereer(lijnen, diensten, { nightRosterCodes: ["LN"] }, profiel);
      const gemeten = kwaliteit(kandidaat.assignments, diensten, "LN", "LAAT_NACHT");
      expect(gemeten.nights.singletons, profiel.label).toBe(0);
    }
  });
});

describe("overgangen", () => {
  const lijnen = [line("VL", "VROEG_LAAT", 1, "DDDDDRR"), line("VL", "VROEG_LAAT", 2, "DDDDDRR")];
  const diensten = [...VROEG, ...LATE];

  it("kiest stabiele reeksen boven heen-en-weer tussen vroeg en laat", async () => {
    const kandidaat = await genereer(lijnen, diensten);
    const gemeten = kwaliteit(kandidaat.assignments, diensten, "VL", "VROEG_LAAT");
    expect(gemeten.transitions.heavy).toHaveLength(0);
    // Hooguit één wissel per lijn: vroeg → laat.
    expect(gemeten.transitions.adjacentPairs - gemeten.transitions.stablePairs).toBeLessThanOrEqual(2);
  });
});

describe("dekking blijft hard", () => {
  const lijnen = [line("VL", "VROEG_LAAT", 1, "DDDDDRR"), line("VL", "VROEG_LAAT", 2, "DDDDDRR")];
  const diensten = [...VROEG, ...LATE];

  it("vult elke dienstdag, ook als geen enkel gewicht om dekking vraagt", async () => {
    const nulGewichten = Object.fromEntries(Object.keys(BALANCED_WEIGHTS).map((sleutel) => [sleutel, 0]));
    const kandidaat = await genereer(lijnen, diensten, { objective: nulGewichten as unknown as typeof BALANCED_WEIGHTS });
    const dienstdagen = kandidaat.assignments.filter((entry) => entry.positionType === "DUTY");
    expect(dienstdagen).toHaveLength(10);
    expect(dienstdagen.every((entry) => entry.dutyCode !== null)).toBe(true);
  });

  it("vult elke dienstdag onder de zwaarste kwaliteitsgewichten", async () => {
    const kandidaat = await genereer(lijnen, diensten, { objective: weightsForRebuild(STRATEGY_WEIGHTS.REST_QUALITY, ["REST", "TRANSITIONS", "NIGHT_CLUSTERING"]) });
    expect(kandidaat.assignments.filter((entry) => entry.positionType === "DUTY" && entry.dutyCode === null)).toHaveLength(0);
  });
});

describe("verschillende kandidaten", () => {
  const lijnen = [line("VL", "VROEG_LAAT", 1, "DDDDDRR"), line("VL", "VROEG_LAAT", 2, "DDDDDRR")];
  const diensten = [...VROEG, ...LATE];

  function verschil(a: readonly CandidateAssignment[], b: readonly CandidateAssignment[]): number {
    const sleutel = (entry: CandidateAssignment) => `${entry.lineNumber}|${entry.weekday}`;
    const van = new Map(a.map((entry) => [sleutel(entry), entry.dutyCode]));
    return b.filter((entry) => entry.positionType === "DUTY" && van.get(sleutel(entry)) !== entry.dutyCode).length;
  }

  it("levert na uitsluiting een kandidaat die op ten minste het gevraagde aantal dagen verschilt", async () => {
    const eerste = await genereer(lijnen, diensten);
    const tweede = await genereer(lijnen, diensten, { exclude: [eerste.assignments], minDifferentSlots: 4 });
    expect(verschil(eerste.assignments, tweede.assignments)).toBeGreaterThanOrEqual(4);
  });

  it("weigert eerlijk wanneer er geen andere kandidaat meer bestaat", async () => {
    // Eén lijn en precies één dienst per dag: er is maar één rooster mogelijk.
    const enkel = [line("V", "VROEG", 1, "DDDDDRR")];
    const eerste = await genereer(enkel, VROEG);
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20, {
      workers: 1,
      exclude: [eerste.assignments],
      minDifferentSlots: 1,
    });
    const uitkomst = await optimizer.generate(input(enkel, VROEG), "Test");
    expect(uitkomst.status).toBe("REFUSED");
    // De toelichtende tweede poging mag zelf OPTIMAL melden; de poging mét
    // volledige dekking is wat de generatie gebruikt om te stoppen met zoeken.
    expect(optimizer.lastExtras?.fullCoverageStatus).toBe("INFEASIBLE");
  });

  it("slaat de toelichtende tweede poging over als daarom wordt gevraagd", async () => {
    const enkel = [line("V", "VROEG", 1, "DDDDDRR")];
    const eerste = await genereer(enkel, VROEG);
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20, {
      workers: 1,
      exclude: [eerste.assignments],
      minDifferentSlots: 1,
      explainShortfall: false,
    });
    await optimizer.generate(input(enkel, VROEG), "Test");
    expect(optimizer.lastExtras?.solverStatus).toBe("INFEASIBLE");
    expect(optimizer.lastExtras?.fullCoverageStatus).toBe("INFEASIBLE");
  });
});

describe("herbouwgewichten", () => {
  it("versterken alleen de gekozen doelen en raken geen harde grens", () => {
    const basis = STRATEGY_WEIGHTS.BALANCED;
    const herbouw = weightsForRebuild(basis, ["NIGHT_CLUSTERING"]);
    expect(herbouw.nightSingleton).toBeGreaterThan(basis.nightSingleton);
    expect(herbouw.hoursBalance).toBe(basis.hoursBalance);
    for (const verboden of ["minRest", "maxConsecutive", "coverage", "profile"]) {
      expect(Object.keys(herbouw)).not.toContain(verboden);
    }
  });

  it("zetten bij 'goede delen behouden' een kostenpost op afwijken van de ouder", () => {
    expect(weightsForRebuild(STRATEGY_WEIGHTS.BALANCED, ["KEEP_GOOD_PARTS"]).preserveHint).toBeGreaterThan(0);
    expect(STRATEGY_WEIGHTS.BALANCED.preserveHint).toBe(0);
  });
});
