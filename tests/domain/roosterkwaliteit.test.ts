import { describe, expect, it } from "vitest";
import {
  type QualityDuty,
  type QualityRosterInput,
  dutyKey,
  measurePackage,
  measureRoster,
  nightRosterCodesOf,
} from "@/domain/roster-quality";
import { HEAVY_TRANSITION_PENALTY } from "@/domain/roster-quality-config";

/**
 * Roosterkwaliteit: de maten waarmee een kandidaat wordt beoordeeld en
 * vergeleken.
 *
 * Een rooster wordt hier geschreven als tekst per regel, één teken per dag:
 * V/L/N een vroege, late of nachtdienst, R rust, W een WTV-dag, S reserve.
 * Zo is in de test te lezen welk rooster er wordt gemeten.
 */

const DIENSTEN: Record<string, { start: number; eind: number; kinds: string[] }> = {
  V: { start: 6 * 60, eind: 14 * 60, kinds: ["VROEG"] },
  L: { start: 14 * 60, eind: 22 * 60, kinds: ["LAAT"] },
  N: { start: 22 * 60, eind: 30 * 60, kinds: ["NACHT"] },
};

function diensten(): Map<string, QualityDuty> {
  const map = new Map<string, QualityDuty>();
  for (const [letter, dienst] of Object.entries(DIENSTEN)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const code = `${letter}${weekday}`;
      map.set(dutyKey(code, weekday), {
        code,
        weekday,
        startMinute: dienst.start,
        endMinute: dienst.eind,
        kinds: dienst.kinds,
      });
    }
  }
  return map;
}

function rooster(code: string, profile: string, regels: readonly string[]): QualityRosterInput {
  return {
    code,
    name: code,
    profile,
    weeksPerLine: 1,
    days: regels.flatMap((regel, index) =>
      [...regel].map((teken, dag) => {
        const weekday = dag + 1;
        const dienst = teken === "V" || teken === "L" || teken === "N";
        return {
          lineNumber: index + 1,
          weekIndex: 1,
          weekday,
          positionType: dienst ? "DUTY" : teken === "W" ? "WR" : teken === "S" ? "RES" : "RUST",
          dutyCode: dienst ? `${teken}${weekday}` : null,
        };
      }),
    ),
  };
}

describe("nachtreeksen", () => {
  it("telt een reeks door over de grens van twee regels heen", () => {
    // Za en zo van regel 1, dan ma van regel 2: één reeks van drie.
    const gemeten = measureRoster(rooster("LN", "LAAT_NACHT", ["LLLRRNN", "NRLLLRR"]), diensten());
    expect(gemeten.nights.blocks).toHaveLength(1);
    expect(gemeten.nights.blocks[0]).toMatchObject({ length: 3, startLine: 1, startWeekday: 6 });
    expect(gemeten.nights.singletons).toBe(0);
  });

  it("telt een reeks door van de laatste regel terug naar de eerste", () => {
    // Zo van regel 2, dan ma en di van regel 1: de cyclus is rond.
    const gemeten = measureRoster(rooster("LN", "LAAT_NACHT", ["NNRLLRR", "LLLRRRN"]), diensten());
    expect(gemeten.nights.blocks.map((blok) => blok.length)).toEqual([3]);
    expect(gemeten.nights.blocks[0]).toMatchObject({ startLine: 2, startWeekday: 7 });
  });

  it("onderscheidt losse nachten, paren en reeksen van drie of meer", () => {
    const gemeten = measureRoster(rooster("MIX", "MIX", ["NRNNRRR", "NNNRRRR"]), diensten());
    expect(gemeten.nights.singletons).toBe(1);
    expect(gemeten.nights.pairs).toBe(1);
    expect(gemeten.nights.threeOrMore).toBe(1);
    expect(gemeten.nights.total).toBe(6);
    expect(gemeten.nights.perLine).toEqual([3, 3]);
  });
});

describe("overgangen", () => {
  it("rekent nacht → vroeg op de volgende dag als zware overgang", () => {
    const gemeten = measureRoster(rooster("MIX", "MIX", ["NVRRRRR"]), diensten());
    expect(gemeten.transitions.heavy).toHaveLength(1);
    expect(gemeten.transitions.heavy[0]).toMatchObject({
      lineNumber: 1,
      weekday: 1,
      from: "NIGHT",
      to: "EARLY",
      overOffDay: false,
    });
    expect(gemeten.transitions.heavy[0].penalty).toBeGreaterThanOrEqual(HEAVY_TRANSITION_PENALTY);
  });

  it("ziet nacht → vrij → vroeg ook als zwaar, maar lichter dan zonder vrije dag", () => {
    const direct = measureRoster(rooster("MIX", "MIX", ["NVRRRRR"]), diensten());
    const overVrij = measureRoster(rooster("MIX", "MIX", ["NRVRRRR"]), diensten());
    expect(overVrij.transitions.heavy).toHaveLength(1);
    expect(overVrij.transitions.heavy[0].overOffDay).toBe(true);
    expect(overVrij.transitions.penaltyTotal).toBeLessThan(direct.transitions.penaltyTotal);
  });

  it("vindt met de klok mee (vroeg → laat) geen zware overgang", () => {
    const gemeten = measureRoster(rooster("VL", "VROEG_LAAT", ["VVLLLRR"]), diensten());
    expect(gemeten.transitions.heavy).toHaveLength(0);
    expect(gemeten.transitions.penaltyTotal).toBeGreaterThan(0);
    expect(gemeten.transitions.stablePairs).toBe(3);
    expect(gemeten.transitions.adjacentPairs).toBe(4);
  });

  it("geeft een stabiel rooster een stabiel aandeel van 1", () => {
    const gemeten = measureRoster(rooster("V", "VROEG", ["VVVVVRR"]), diensten());
    expect(gemeten.transitions.stableShare).toBe(1);
  });
});

describe("rust en uren", () => {
  it("rekent WTV als 8:00 en rust als 0 in het weekgemiddelde", () => {
    // Vier diensten van 8 uur en één WTV-dag: 40:00.
    const gemeten = measureRoster(rooster("V", "VROEG", ["VVVVWRR"]), diensten());
    expect(gemeten.hours.averageWeeklyCreditMinutes).toBe(40 * 60);
    expect(gemeten.hours.deviationFromTargetMinutes).toBe(0);
  });

  it("meet het herstel na een nachtreeks tot de volgende dienst", () => {
    // Laatste nacht eindigt di 06:00 (N van ma loopt tot di), volgende dienst do 14:00.
    const gemeten = measureRoster(rooster("LN", "LAAT_NACHT", ["NRRLRRR"]), diensten());
    expect(gemeten.rest.recoveryAfterNightBlocks).toEqual([3 * 1440 + 14 * 60 - 30 * 60]);
  });

  it("classificeert rust tussen twee opeenvolgende diensten", () => {
    // L eindigt 22:00, V begint 06:00: acht uur, onder de krappe grens.
    const krap = measureRoster(rooster("VL", "VROEG_LAAT", ["LVRRRRR"]), diensten());
    expect(krap.rest.belowTight).toBe(1);
    const ruim = measureRoster(rooster("V", "VROEG", ["VVRRRRR"]), diensten());
    expect(ruim.rest.comfortable).toBe(1);
  });
});

describe("dienstidentiteit", () => {
  it("meet een dienstnummer met de tijden van zijn eigen weekdag", () => {
    const map = diensten();
    // Hetzelfde nummer op dinsdag, maar een uur langer dan op maandag.
    map.set(dutyKey("X", 1), { code: "X", weekday: 1, startMinute: 6 * 60, endMinute: 14 * 60, kinds: ["VROEG"] });
    map.set(dutyKey("X", 2), { code: "X", weekday: 2, startMinute: 6 * 60, endMinute: 15 * 60, kinds: ["VROEG"] });
    const invoer: QualityRosterInput = {
      code: "V",
      name: "V",
      profile: "VROEG",
      weeksPerLine: 1,
      days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        lineNumber: 1,
        weekIndex: 1,
        weekday,
        positionType: weekday <= 2 ? "DUTY" : "RUST",
        dutyCode: weekday <= 2 ? "X" : null,
      })),
    };
    expect(measureRoster(invoer, map).hours.actualDutyMinutes).toBe(8 * 60 + 9 * 60);
  });
});

describe("het pakket", () => {
  it("onderscheidt geclusterde nachten van verspreide nachten", () => {
    const map = diensten();
    const opties = { requiredDuties: 0, nightRosterCodes: ["MIX"] };
    const geclusterd = measurePackage([rooster("MIX", "MIX", ["NNNRRLL", "LLRRRLL"])], map, opties);
    const verspreid = measurePackage([rooster("MIX", "MIX", ["NRNRNLL", "LLRRRLL"])], map, opties);
    const score = (kwaliteit: typeof geclusterd, sleutel: string) =>
      kwaliteit.subscores.find((entry) => entry.key === sleutel)!.score!;
    expect(score(geclusterd, "nightClustering")).toBe(100);
    expect(score(verspreid, "nightClustering")).toBe(0);
    expect(verspreid.nights.singletons).toBe(3);
  });

  it("geeft een gelijke nachtbelasting per regel een eerlijkheid van 100", () => {
    const map = diensten();
    const kwaliteit = measurePackage(
      [rooster("LN", "LAAT_NACHT", ["NNNRRLL", "LLRRRLL"]), rooster("MIX", "MIX", ["NNNRRVV", "VVRRRLL"])],
      map,
      { requiredDuties: 0, nightRosterCodes: ["LN", "MIX"] },
    );
    expect(kwaliteit.subscores.find((entry) => entry.key === "nightFairness")!.score).toBe(100);
  });

  it("verlaagt de eerlijkheid wanneer één rooster alle nachten per regel draagt", () => {
    const map = diensten();
    const kwaliteit = measurePackage(
      [rooster("LN", "LAAT_NACHT", ["NNNRRNN", "NRRRRLL"]), rooster("MIX", "MIX", ["NRRRRVV", "VVRRRLL"])],
      map,
      { requiredDuties: 0, nightRosterCodes: ["LN", "MIX"] },
    );
    expect(kwaliteit.subscores.find((entry) => entry.key === "nightFairness")!.score!).toBeLessThan(100);
  });

  it("geeft het referentierooster zelf een wijzigingsimpact van 100", () => {
    const map = diensten();
    const huidig = [rooster("V", "VROEG", ["VVVVVRR"])];
    const kwaliteit = measurePackage(huidig, map, { requiredDuties: 5, nightRosterCodes: [], reference: huidig });
    expect(kwaliteit.changedDutyDays).toBe(0);
    expect(kwaliteit.subscores.find((entry) => entry.key === "changeImpact")!.score).toBe(100);
    expect(kwaliteit.subscores.find((entry) => entry.key === "coverage")!.score).toBe(100);
  });

  it("noemt een rooster alleen nachtrooster als het profiel nachten toestaat én er nu nachten in staan", () => {
    const map = diensten();
    const codes = nightRosterCodesOf(
      [
        rooster("LN", "LAAT_NACHT", ["NNNRRLL"]),
        rooster("MIX50", "MIX_50PLUS", ["VVLLRRR"]),
        rooster("V", "VROEG", ["VVVVVRR"]),
      ],
      map,
      (profile) => profile !== "VROEG",
    );
    expect(codes).toEqual(["LN"]);
  });
});
