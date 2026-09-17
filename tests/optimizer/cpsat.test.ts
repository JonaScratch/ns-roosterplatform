import { describe, expect, it } from "vitest";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import type { OptimizerDuty, OptimizerInput, OptimizerLine } from "@/server/optimizer/contract";

/**
 * De globale oplosser, gemeten op de eigenschappen die ertoe doen.
 *
 * ## Wat hier níet wordt getest
 *
 * Of het rooster juridisch klopt. Dat is niet aan de solver en het is ook niet
 * aan deze tests: de onafhankelijke validator gaat daarover, en die heeft zijn
 * eigen testbestanden. Wat hier wordt vastgelegd, is dat de solver zich aan zijn
 * eigen afspraken houdt — geen dienst kwijtraken, geen anker aanraken, geen
 * dienst dubbel gebruiken, en bij twijfel weigeren in plaats van iets halfs
 * afleveren.
 *
 * ## Waarom deze tests niet flakey zijn
 *
 * Elke run gebruikt een vaste zaadwaarde en één zoekthread. Twee runs met
 * dezelfde invoer horen hetzelfde op te leveren; dat wordt hieronder ook
 * daadwerkelijk getoetst.
 */

function duty(
  code: string,
  start: number,
  eind: number,
  kinds: readonly string[],
  weekdays: readonly number[],
): OptimizerDuty {
  return {
    code,
    kinds: kinds as OptimizerDuty["kinds"],
    startMinute: start,
    endMinute: eind,
    breakMinutes: 40,
    overtimeMinutes: 0,
    depot: "DDR",
    requiredQualifications: [],
    weight: 3,
    weekdays,
  };
}

/** Een lijn uit een patroon: D = dienstdag, R = rust, S = reserve. */
function line(
  code: string,
  profile: OptimizerLine["profile"],
  lineNumber: number,
  patroon: string,
): OptimizerLine {
  return {
    baseRosterCode: code,
    profile,
    lineNumber,
    cycleWeeks: Math.ceil(patroon.length / 7),
    contractHours: 40,
    occupiedBy: null,
    days: [...patroon].map((teken, index) => ({
      weekIndex: Math.floor(index / 7) + 1,
      weekday: (index % 7) + 1,
      positionType: teken === "D" ? "DUTY" : teken === "S" ? "RES" : "RUST",
      dutyCode: null,
    })),
  };
}

function input(
  lines: readonly OptimizerLine[],
  duties: readonly OptimizerDuty[],
  overrides: Partial<OptimizerInput> = {},
): OptimizerInput {
  return {
    depot: "DDR",
    duties,
    rosterProfiles: [...new Set(lines.map((entry) => entry.profile))],
    rosterLines: lines,
    contractualHours: lines.map((entry) => ({
      baseRosterCode: entry.baseRosterCode,
      lineNumber: entry.lineNumber,
      hours: entry.contractHours,
    })),
    hardConstraints: [
      {
        ruleId: "RP_DAILY_REST_PLANNED",
        title: "Dagelijkse rust",
        unit: "HOURS",
        value: 12,
        translatable: true,
      },
      {
        ruleId: "MAX_CONSECUTIVE_SERVICES",
        title: "Aaneengesloten diensten",
        unit: "COUNT",
        value: 5,
        translatable: true,
      },
    ],
    softObjectives: [],
    aggregatedFeedback: [],
    historicalBurden: [],
    sourceScheduleVersion: "s1",
    rulesetVersion: "r1",
    inputDataVersion: "i1",
    mode: "SIMULATION",
    ...overrides,
  };
}

const VROEG_DIENSTEN = [1, 2, 3, 4, 5].map((weekday) =>
  duty(`04${weekday}`, 5 * 60 + 12, 13 * 60 + 20, ["VROEG"], [weekday]),
);
const LATE_DIENSTEN = [1, 2, 3, 4, 5].map((weekday) =>
  duty(`14${weekday}`, 15 * 60, 23 * 60, ["LAAT"], [weekday]),
);

describe("de oplosser verdeelt over alle roosters tegelijk", () => {
  const lines = [
    line("DDR-V", "VROEG", 1, "DDDDDRR"),
    line("DDR-L", "LAAT", 1, "DDDDDRR"),
  ];
  const duties = [...VROEG_DIENSTEN, ...LATE_DIENSTEN];

  it("plaatst elke dienst op een lijn die zijn dagdeel toestaat", async () => {
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    const outcome = await optimizer.generate(input(lines, duties), "Test");

    expect(outcome.status).toBe("CANDIDATE_GENERATED");
    if (outcome.status !== "CANDIDATE_GENERATED") {
      return;
    }

    const vroegLijn = outcome.candidate.assignments.filter(
      (assignment) => assignment.baseRosterCode === "DDR-V" && assignment.dutyCode,
    );
    const laatLijn = outcome.candidate.assignments.filter(
      (assignment) => assignment.baseRosterCode === "DDR-L" && assignment.dutyCode,
    );

    expect(vroegLijn.every((assignment) => assignment.dutyCode!.startsWith("04"))).toBe(true);
    expect(laatLijn.every((assignment) => assignment.dutyCode!.startsWith("14"))).toBe(true);
  });

  it("verantwoordt elke dienstinstantie", async () => {
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    await optimizer.generate(input(lines, duties), "Test");

    const boekhouding = optimizer.lastExtras?.accounting;
    expect(boekhouding).toBeDefined();
    expect(boekhouding!.balanced).toBe(true);
    expect(
      boekhouding!.fixedRoster +
        boekhouding!.operationalPool.length +
        boekhouding!.unassignable.length,
    ).toBe(boekhouding!.sourceInstances);
  });

  it("gebruikt geen dienstinstantie twee keer", async () => {
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    const outcome = await optimizer.generate(input(lines, duties), "Test");
    if (outcome.status !== "CANDIDATE_GENERATED") {
      throw new Error("verwachtte een kandidaat");
    }

    const gebruikt = outcome.candidate.assignments
      .filter((assignment) => assignment.dutyCode)
      .map((assignment) => `${assignment.dutyCode}|${assignment.weekday}`);
    expect(new Set(gebruikt).size).toBe(gebruikt.length);
  });

  it("houdt een dienst op de weekdag waarop hij hoort", async () => {
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    const outcome = await optimizer.generate(input(lines, duties), "Test");
    if (outcome.status !== "CANDIDATE_GENERATED") {
      throw new Error("verwachtte een kandidaat");
    }

    for (const assignment of outcome.candidate.assignments) {
      if (!assignment.dutyCode) {
        continue;
      }
      const bron = duties.find((entry) => entry.code === assignment.dutyCode)!;
      expect(bron.weekdays).toContain(assignment.weekday);
    }
  });
});

describe("structurele ankers", () => {
  it("blijven staan; de oplosser kent ze niet eens als variabele", async () => {
    const lines = [line("DDR-V", "VROEG", 1, "DDRSDRR")];
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    const outcome = await optimizer.generate(input(lines, VROEG_DIENSTEN), "Test");
    if (outcome.status !== "CANDIDATE_GENERATED") {
      throw new Error("verwachtte een kandidaat");
    }

    const ankers = outcome.candidate.assignments.filter(
      (assignment) => assignment.positionType !== "DUTY",
    );
    // Patroon DDRSDRR: rust, reserve, rust, rust — vier ankerdagen.
    expect(ankers.length).toBe(4);
    expect(ankers.every((assignment) => assignment.dutyCode === null)).toBe(true);

    // En de dag die reserve was, is reserve gebleven.
    const woensdag = outcome.candidate.assignments.find(
      (assignment) => assignment.weekday === 4,
    );
    expect(woensdag?.positionType).toBe("RES");
  });
});

describe("reproduceerbaarheid", () => {
  it("geeft bij dezelfde invoer en zaadwaarde dezelfde plaatsingen", async () => {
    const lines = [line("DDR-V", "VROEG", 1, "DDDDDRR"), line("DDR-V", "VROEG", 2, "DDDDDRR")];
    // Twee lijnen vragen samen tien dienstdagen (2 × ma–vr): met maar één
    // dienst per weekdag (VROEG_DIENSTEN) zou de helft van de dienstdagen
    // zonder dienstnummer blijven en de opdracht nu terecht worden geweigerd
    // — zie "geen dienstdag zonder dienstnummer". Voor déze test, die alleen
    // reproduceerbaarheid van een geslaagde plaatsing toetst, is er dus een
    // tweede dienst per weekdag nodig.
    const dubbeleDiensten = [
      ...VROEG_DIENSTEN,
      ...[1, 2, 3, 4, 5].map((weekday) => duty(`05${weekday}`, 5 * 60 + 12, 13 * 60 + 20, ["VROEG"], [weekday])),
    ];
    const eerste = await new CpSatOptimizer(SCENARIO_PROFILES[0], 20).generate(
      input(lines, dubbeleDiensten),
      "Test",
    );
    const tweede = await new CpSatOptimizer(SCENARIO_PROFILES[0], 20).generate(
      input(lines, dubbeleDiensten),
      "Test",
    );

    if (eerste.status !== "CANDIDATE_GENERATED" || tweede.status !== "CANDIDATE_GENERATED") {
      throw new Error("verwachtte twee kandidaten");
    }
    expect(tweede.candidate.assignments).toEqual(eerste.candidate.assignments);
  });
});

describe("wanneer er niets past", () => {
  it("meldt dat een dienst nergens heen kan in plaats van hem te laten verdwijnen", async () => {
    // Een nachtdienst en alleen een Vroeg-rooster: die combinatie bestaat niet.
    const lines = [line("DDR-V", "VROEG", 1, "DDDDDRR")];
    const nacht = duty("241", 22 * 60 + 30, 30 * 60 + 45, ["NACHT"], [1]);

    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    const outcome = await optimizer.generate(input(lines, [...VROEG_DIENSTEN, nacht]), "Test");
    expect(outcome.status).toBe("CANDIDATE_GENERATED");

    const boekhouding = optimizer.lastExtras!.accounting;
    expect(boekhouding.unassignable.map((entry) => entry.key)).toContain("241|1");
    expect(boekhouding.unassignable[0].reason).toContain("dagdeel");
    expect(boekhouding.balanced).toBe(true);
  });

  it("sluit een dienst zonder weekdag uit, met reden", async () => {
    const lines = [line("DDR-V", "VROEG", 1, "DDDDDRR")];
    const zonderDag = duty("999", 6 * 60, 14 * 60, ["VROEG"], []);

    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    await optimizer.generate(input(lines, [...VROEG_DIENSTEN, zonderDag]), "Test");

    const uitgesloten = optimizer.lastExtras!.accounting.excluded;
    expect(uitgesloten.some((entry) => entry.key.startsWith("999"))).toBe(true);
    expect(uitgesloten[0].reason).toContain("weekdagen");
  });
});

describe("de oplosser weigert in plaats van te improviseren", () => {
  it("weigert zonder roosterlijnen", async () => {
    const outcome = await new CpSatOptimizer().generate(input([], VROEG_DIENSTEN), "Leeg");
    expect(outcome.status).toBe("REFUSED");
  });

  it("weigert zonder diensten", async () => {
    const outcome = await new CpSatOptimizer().generate(
      input([line("DDR-V", "VROEG", 1, "DDDDDRR")], []),
      "Leeg",
    );
    expect(outcome.status).toBe("REFUSED");
  });
});

describe("geen dienstdag zonder dienstnummer", () => {
  // Regressie op de fout uit fase P: constraint 1 in de solver zegt "hooguit
  // één dienst per slot", niet "precies één". Twee lijnen die dezelfde
  // weekdag vragen, maar maar één dienst per weekdag in het pakket, laten
  // voorheen stilzwijgend één dienstdag zonder dienstnummer — nog altijd
  // `positionType: "DUTY"`, alleen de onafhankelijke eindvalidatie ving dat.
  // `generate()` moet dat nu zelf al weigeren, vóór er iets wordt opgeslagen.
  it("weigert als er minder diensten dan dienstslots op een weekdag zijn", async () => {
    const lines = [
      line("DDR-V", "VROEG", 1, "DDDDDRR"),
      line("DDR-V", "VROEG", 2, "DDDDDRR"),
    ];
    // Twee lijnen vragen elk vijf dienstdagen (ma–vr), maar er is maar één
    // dienst per weekdag beschikbaar: op elke weekdag blijft één slot over.
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    const outcome = await optimizer.generate(input(lines, VROEG_DIENSTEN), "Tekort");

    expect(outcome.status).toBe("REFUSED");
    if (outcome.status !== "REFUSED") {
      return;
    }
    expect(outcome.reason).toContain("dienstnummer");
    expect(outcome.reason).toContain("DDR-V");
  });

  it("meldt de betrokken lijn, week en weekdag in de diagnose", async () => {
    const lines = [
      line("DDR-V", "VROEG", 1, "DDDDDRR"),
      line("DDR-V", "VROEG", 2, "DDDDDRR"),
    ];
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    await optimizer.generate(input(lines, VROEG_DIENSTEN), "Tekort");

    const diagnostiek = optimizer.lastExtras!.diagnostics;
    expect(diagnostiek.some((regel) => regel.includes("dienstnummer") && regel.includes("DDR-V"))).toBe(
      true,
    );
  });

  it("levert nooit een kandidaat met een dienstdag zonder dienstnummer op", async () => {
    // Zelfde tekort-scenario, maar dan getoetst op het candidate-pad zelf:
    // als dit ooit weer een CANDIDATE_GENERATED zou worden, mag geen enkele
    // DUTY-toewijzing een lege dutyCode hebben.
    const lines = [
      line("DDR-V", "VROEG", 1, "DDDDDRR"),
      line("DDR-V", "VROEG", 2, "DDDDDRR"),
    ];
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20);
    const outcome = await optimizer.generate(input(lines, VROEG_DIENSTEN), "Tekort");

    if (outcome.status === "CANDIDATE_GENERATED") {
      const legeDienstdagen = outcome.candidate.assignments.filter(
        (assignment) => assignment.positionType === "DUTY" && assignment.dutyCode === null,
      );
      expect(legeDienstdagen).toHaveLength(0);
    } else {
      expect(outcome.status).toBe("REFUSED");
    }
  });
});

describe("de scenario's", () => {
  it("verschillen alleen in gewichten, niet in harde grenzen", () => {
    for (const scenario of SCENARIO_PROFILES) {
      expect(Object.keys(scenario.objective).length).toBeGreaterThan(0);
      // Geen enkel scenario mag een sleutel dragen die naar een harde regel
      // verwijst: dan zou een gewicht een grens kunnen verschuiven. Dekking
      // hoort daar sinds v1.0.3 ook bij.
      for (const verboden of ["minRest", "maxConsecutive", "coverage", "profile"]) {
        expect(Object.keys(scenario.objective)).not.toContain(verboden);
      }
    }
  });

  it("levert vijf te kiezen scenario's", () => {
    expect(SCENARIO_PROFILES.length).toBe(5);
    expect(new Set(SCENARIO_PROFILES.map((scenario) => scenario.seed)).size).toBe(5);
  });
});
