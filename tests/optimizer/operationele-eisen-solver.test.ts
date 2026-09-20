import { describe, expect, it } from "vitest";
import { OPERATIONAL_REQUIREMENTS_V1 } from "@/domain/operational-requirements";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import type { OptimizerDuty, OptimizerInput, OptimizerLine } from "@/server/optimizer/contract";

/**
 * De operationele eisen van de gebruiker, hard in het CP-SAT-model.
 *
 * Elke opzet hieronder is zo gebouwd dat de oplosser zónder de eis de andere
 * kant op zou gaan: de urenbalans trekt naar de langere dienst. Anders bewijst
 * een groene test niets — dan kiest de oplosser toevallig goed.
 *
 * Bronstatus van de eisen: USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT.
 */

const u = (uur: number, minuut = 0) => uur * 60 + minuut;

function duty(code: string, start: number, eind: number, kinds: readonly string[], weekday: number): OptimizerDuty {
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
    weekdays: [weekday],
  };
}

function line(code: string, profile: OptimizerLine["profile"], patroon: string): OptimizerLine {
  return {
    baseRosterCode: code,
    profile,
    lineNumber: 1,
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
    contractualHours: lines.map((entry) => ({ baseRosterCode: entry.baseRosterCode, lineNumber: entry.lineNumber, hours: 40 })),
    hardConstraints: [
      { ruleId: "RP_DAILY_REST_PLANNED", title: "Dagelijkse rust", unit: "HOURS", value: 12, translatable: true },
      { ruleId: "MAX_CONSECUTIVE_SERVICES", title: "Aaneengesloten diensten", unit: "COUNT", value: 5, translatable: true },
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

async function vrijdag(lines: readonly OptimizerLine[], duties: readonly OptimizerDuty[], metEis: boolean) {
  const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20, {
    seed: 7,
    workers: 1,
    operational: metEis ? OPERATIONAL_REQUIREMENTS_V1 : undefined,
  });
  const uitkomst = await optimizer.generate(input(lines, duties), "Test");
  if (uitkomst.status !== "CANDIDATE_GENERATED") return { status: uitkomst.status, vrijdag: null, codes: [] as string[] };
  const vr = uitkomst.candidate.assignments.find((a) => a.weekday === 5 && a.dutyCode);
  return {
    status: uitkomst.status,
    vrijdag: vr?.dutyCode ?? null,
    codes: uitkomst.candidate.assignments.filter((a) => a.dutyCode).map((a) => a.dutyCode as string),
  };
}

describe("vrijdag vóór een vrij weekend (test 8)", () => {
  // Ma–do 7 uur: 28 uur. Vrijdag: een late tot 23:00 (8 uur, 36 totaal) of een
  // afloper tot 01:00 zaterdag (9 uur, 37 totaal). De urenbalans wil de afloper.
  const maDo = [1, 2, 3, 4].map((dag) => duty(`L${dag}`, u(16), u(23), ["LAAT"], dag));
  const late = duty("L23", u(15), u(23), ["LAAT"], 5);
  const afloper = duty("A01", u(16), u(25), ["LAAT"], 5);
  const lijnen = [line("DDR-L", "LAAT", "DDDDDRR")];

  it("zonder de eis kiest de urenbalans de afloper — de opzet is dus niet vanzelf goed", async () => {
    const uit = await vrijdag(lijnen, [...maDo, late, afloper], false);
    expect(uit.vrijdag).toBe("A01");
  });

  it("met de eis eindigt de vrijdagdienst vóór middernacht", async () => {
    const uit = await vrijdag(lijnen, [...maDo, late, afloper], true);
    expect(uit.status).toBe("CANDIDATE_GENERATED");
    expect(uit.vrijdag).toBe("L23");
  });

  it("23:59 mag nog, 24:00 niet", async () => {
    const tot2359 = duty("L2359", u(16), u(23, 59), ["LAAT"], 5);
    const tot2400 = duty("L2400", u(16, 1), u(24), ["LAAT"], 5);
    const uit = await vrijdag(lijnen, [...maDo, tot2359, tot2400], true);
    expect(uit.vrijdag).toBe("L2359");
  });

  it("een nachtdienst op vrijdag mag wel (besluit van de gebruiker)", async () => {
    const nachten = [1, 2, 3, 4].map((dag) => duty(`N${dag}`, u(23), u(30), ["NACHT"], dag));
    const nachtVr = duty("N5", u(23), u(31), ["NACHT"], 5);
    const uit = await vrijdag([line("DDR-N", "LAAT_NACHT", "DDDDDRR")], [...nachten, nachtVr], true);
    expect(uit.status).toBe("CANDIDATE_GENERATED");
    expect(uit.vrijdag).toBe("N5");
  });

  it("geldt niet als het rooster dat weekend werkt", async () => {
    // Werkt zaterdag: dan is het geen vrij weekend en mag de afloper.
    const za = duty("L6", u(15), u(23), ["LAAT"], 6);
    const uit = await vrijdag([line("DDR-L", "LAAT", "RDDDDDR")], [...maDo.slice(1), late, afloper, za], true);
    expect(uit.vrijdag).toBe("A01");
  });

  it("zonder toegestane vrijdagdienst weigert de oplosser in plaats van de eis stil te breken", async () => {
    const uit = await vrijdag(lijnen, [...maDo, afloper], true);
    expect(uit.status).toBe("REFUSED");
  });
});

describe("roostergemiddelde hoogstens 40:00 (test 10)", () => {
  // Ma–do 8 uur: 32 uur. De urenbalans kiest op vrijdag wat het dichtst bij
  // 40:00 ligt — ook als dat erboven is.
  const maDo = [1, 2, 3, 4].map((dag) => duty(`V${dag}`, u(6), u(14), ["VROEG"], dag));
  const lijnen = [line("DDR-V", "VROEG", "DDDDDRR")];
  const vr = (code: string, minuten: number) => duty(code, u(6), u(6) + minuten, ["VROEG"], 5);

  it("zonder de eis kiest de urenbalans 40:01 boven 39:50", async () => {
    const uit = await vrijdag(lijnen, [...maDo, vr("V4001", 481), vr("V3950", 470)], false);
    expect(uit.vrijdag).toBe("V4001");
  });

  it("met de eis blijft het rooster op of onder 40:00", async () => {
    const uit = await vrijdag(lijnen, [...maDo, vr("V4001", 481), vr("V3950", 470)], true);
    expect(uit.vrijdag).toBe("V3950");
  });

  it("40:00 precies mag, en wint van 39:59", async () => {
    const uit = await vrijdag(lijnen, [...maDo, vr("V4001", 481), vr("V4000", 480), vr("V3959", 479)], true);
    expect(uit.vrijdag).toBe("V4000");
  });

  it("een losse regel boven 40:00 mag, zolang het rooster als geheel eronder blijft", async () => {
    // Twee regels van één week: 41:00 + 39:00 = gemiddeld 40:00.
    const twee: OptimizerLine[] = [
      { ...line("DDR-V", "VROEG", "DDDDDRR"), lineNumber: 1 },
      {
        ...line("DDR-V", "VROEG", "DDDDDRR"),
        lineNumber: 2,
      },
    ];
    const diensten = [
      ...[1, 2, 3, 4].flatMap((dag) => [duty(`A${dag}`, u(6), u(14), ["VROEG"], dag), duty(`B${dag}`, u(6), u(14), ["VROEG"], dag)]),
      vr("V900", 540),
      vr("V700", 420),
    ];
    const uit = await vrijdag(twee, diensten, true);
    expect(uit.status).toBe("CANDIDATE_GENERATED");
    expect(uit.codes).toContain("V900");
    expect(uit.codes).toContain("V700");
  });
});

describe("voorkeurstermen in CP-SAT (machinistenvoorkeur)", () => {
  // Zelfde lengte (acht uur), zelfde dagdeel: zonder voorkeur is het om het even.
  const late = (code: string, dag: number) => duty(code, u(15), u(23), ["LAAT"], dag);
  // 16:59–00:59: net als de late precies acht uur. (Eerst 16:00–00:59: dan won de
  // urenbalans terecht van de affiniteit en faalde deze toets om de verkeerde reden.)
  const afloper = (code: string, dag: number) => duty(code, u(16, 59), u(24, 59), ["LAAT"], dag);
  const vroegeLate = (code: string, dag: number) => duty(code, u(11), u(19), ["LAAT"], dag);

  async function los(lines: readonly OptimizerLine[], duties: readonly OptimizerDuty[], preference: { affinityWeight: number; dayDutyWeight: number }, seed = 7) {
    const optimizer = new CpSatOptimizer(SCENARIO_PROFILES[0], 20, { seed, workers: 1, preference });
    const uitkomst = await optimizer.generate(input(lines, duties), "Test");
    if (uitkomst.status !== "CANDIDATE_GENERATED") throw new Error(`geen kandidaat: ${uitkomst.status}`);
    return uitkomst.candidate.assignments.filter((a) => a.dutyCode);
  }

  it("affiniteit: de aflopers gaan naar Laat, de gewone late diensten naar Vroeg/Laat", async () => {
    const lijnen = [line("DDR-L", "LAAT", "DDDDDRR"), line("DDR-VL", "VROEG_LAAT", "DDDDDRR")];
    const diensten = [1, 2, 3, 4, 5].flatMap((dag) => [afloper(`A${dag}`, dag), late(`K${dag}`, dag)]);
    for (const seed of [7, 8, 9]) {
      const plaatsing = await los(lijnen, diensten, { affinityWeight: 51, dayDutyWeight: 0 }, seed);
      const inLaat = plaatsing.filter((a) => a.baseRosterCode === "DDR-L").map((a) => a.dutyCode!);
      expect(inLaat.every((code) => code.startsWith("A"))).toBe(true);
    }
  });

  it("dagdienstdoel: een verhouding, geen monopolie — 50+ Mix vier, Laat één", async () => {
    const lijnen = [line("DDR-L", "LAAT", "DDDDDRR"), line("DDR-50", "MIX_50PLUS", "DDDDDRR")];
    const diensten = [1, 2, 3, 4, 5].flatMap((dag) => [vroegeLate(`G${dag}`, dag), late(`K${dag}`, dag)]);
    const plaatsing = await los(lijnen, diensten, { affinityWeight: 0, dayDutyWeight: 115 });
    const dagIn50 = plaatsing.filter((a) => a.baseRosterCode === "DDR-50" && a.dutyCode!.startsWith("G")).length;
    // Laat 10, 50+ Mix 40: per vroege late 0,2 tegen 0,8, over vijf dagen 1 tegen 4.
    expect(dagIn50).toBe(4);
  });
});
