import { describe, expect, it } from "vitest";
import { diagnoseRepair, rankingScore } from "@/domain/adaptive-search";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { worstCase } from "@/domain/worst-case";
import { humanNightExitTables } from "@/server/optimizer/night-exit-tables";
import { engineVariant } from "@/server/generation/adaptive/variant";
import { diensten, meet, rooster, vul } from "./ritme-fixture";

/**
 * Het slechtste geval (H10), de schaalbare nachtrij in CP-SAT, de gerichte
 * nachtreparatie en de variantschakelaar van de zoekmachine.
 */

const opties = { nightRecoveryMinutes: 46 * 60, labelOnlyMinutes: 60 };

describe("slechtste nachtuitgang", () => {
  it("kost de volle 1,5 punt bij een uitgang onder de herstelregel, niets bij een menselijke", () => {
    const menselijk = meet([rooster("MIX", "MIX", vul("NNNNNRRLL"))]);
    const kort = meet([rooster("MIX", "MIX", vul("NNNNNRLL"))]);
    expect(menselijk.worstCase?.penalty.nightExit).toBe(0);
    expect(kort.worstCase?.nightExitValue).toBe(0);
    expect(kort.worstCase?.penalty.nightExit).toBe(1.5);
    expect(kort.worstCase?.exitsBelowRule).toEqual({ MIX: 1 });
  });

  it("verdunt niet: een extra goede reeks ernaast maakt het slechtste geval niet beter", () => {
    // Eén korte uitgang, en dan dezelfde korte uitgang met een perfecte reeks erbij.
    const alleen = worstCase([rooster("MIX", "MIX", ["NNNRLRR", "RRRRRRR", "RRRRRRR"])], diensten(), opties);
    const metGoede = worstCase([rooster("MIX", "MIX", ["NNNRLRR", "NNNNNRR", "LRRRRRR"])], diensten(), opties);
    expect(metGoede.nightExitValue).toBe(alleen.nightExitValue);
  });

  it("staat in de robuuste score én in de rangschikking", () => {
    const kort = meet([rooster("MIX", "MIX", vul("NNNNNRLL"))]);
    const zonder = rankingScore({ hours: 90, flow: 90, rest: 90, nights: 90, fairness: 90, stability: 90 }, 80, { hours: 1, flow: 1, rest: 1, nights: 1, fairness: 1, stability: 1 }, {}, QUALITY_MODEL_V2.robust, 85);
    const met = rankingScore({ hours: 90, flow: 90, rest: 90, nights: 90, fairness: 90, stability: 90 }, 80, { hours: 1, flow: 1, rest: 1, nights: 1, fairness: 1, stability: 1 }, {}, QUALITY_MODEL_V2.robust, 85, kort.worstCase!.penalty.total);
    expect(zonder - met).toBeCloseTo(kort.worstCase!.penalty.total, 9);
  });

  it("rekent een overgang die alleen van etiket wisselt niet als slechtste overgang", () => {
    // P (vroeg 10:00) → Q (laat 11:00): een uur, alleen een ander etiket.
    const etiket = worstCase([rooster("M", "MIX_50PLUS", ["QPRRRRR"])], diensten(), opties);
    const echt = worstCase([rooster("M", "MIX_50PLUS", ["LPRRRRR"])], diensten(), opties);
    expect(etiket.transitionPenalty).toBe(1);
    expect(echt.transitionPenalty).toBe(4);
  });
});

describe("de nachtrij in CP-SAT", () => {
  it("houdt bij elke schaal de volgorde: minder rust nooit goedkoper, vroeg nooit goedkoper dan laat", () => {
    for (const schaal of [1, 2, 3, 5, 8]) {
      const t = humanNightExitTables(schaal);
      // Van weinig naar veel herstel: direct, één vrije dag, twee vrije dagen.
      const vroeg = [t.adjacent.NIGHT.EARLY, t.overOffDay.NIGHT.EARLY, t.overTwoOffDays.NIGHT.EARLY];
      const laat = [t.adjacent.NIGHT.LATE, t.overOffDay.NIGHT.LATE, t.overTwoOffDays.NIGHT.LATE];
      for (let i = 1; i < 3; i += 1) {
        expect(vroeg[i]).toBeLessThan(vroeg[i - 1]);
        expect(laat[i]).toBeLessThanOrEqual(laat[i - 1]);
      }
      for (let i = 0; i < 3; i += 1) expect(vroeg[i]).toBeGreaterThan(laat[i] - 1e-9);
      // Herstel eerst: laat na één vrije dag (32 u) duurder dan vroeg na twee (48 u).
      expect(t.overOffDay.NIGHT.LATE).toBeGreaterThan(t.overTwoOffDays.NIGHT.EARLY);
      // Alleen de nachtrij schaalt; een laat → vroeg blijft wat hij was.
      expect(t.adjacent.LATE.EARLY).toBe(humanNightExitTables(1).adjacent.LATE.EARLY);
    }
  });

  it("weigert een schaal onder 1", () => {
    expect(() => humanNightExitTables(0.5)).toThrow();
  });
});

describe("gerichte nachtreparatie", () => {
  const scores = { hours: 90, flow: 90, rest: 90, nights: 85, fairness: 90, stability: 60 };
  const officieel = { hours: 84, flow: 89, rest: 79, nights: 99, fairness: 67, stability: 100 };
  const feiten = { singletonNights: 0, twoNightBlocks: 0, heavyTransitions: 2, maxRosterHoursDeviation: 40, worstLine: 70, nightExitsBelowRule: 1 };

  it("maakt een uitgang onder de regel een eigen doel, en zet nachten vooraan", () => {
    const zonder = diagnoseRepair(scores, officieel, feiten, new Set(), { nightExitRepair: false });
    const met = diagnoseRepair(scores, officieel, feiten, new Set(), { nightExitRepair: true, nightFirst: true });
    expect(zonder.some((d) => d.target === "NIGHT_EXIT")).toBe(false);
    expect(met[0].target).toBe("NIGHT_EXIT");
  });
});

describe("de variant van de zoekmachine", () => {
  it("is zonder omgevingsvariabelen het machinistenprofiel: ritme plus de operationele eisen", () => {
    const v = engineVariant({});
    expect(v.profile).toBe("machinist");
    expect(v.engineVersion).toBe("adaptive-1.0.4-machinist");
    expect(v.qualityModel.version).toBe("quality-model-v2");
    expect(v.operational).toBe(true);
    // Beslisregels M1 en M2: model v3 in de rangschikking en de CP-SAT-voorkeur uit.
    expect(v.preferenceScale).toBe(0);
  });

  it("houdt het ritmeprofiel van de Final-Brain-ronde reproduceerbaar", () => {
    const v = engineVariant({ NS_ENGINE_PROFILE: "rhythm" });
    expect(v.engineVersion).toBe("adaptive-1.0.4-rhythm");
    expect(v.qualityModel.version).toBe("quality-model-v2");
    expect([v.operational, v.preferenceScale]).toEqual([false, 0]);
  });

  it("zet in het bevroren profiel alles uit wat na v1.0.4 kwam", () => {
    const v = engineVariant({ NS_ENGINE_PROFILE: "frozen-1.0.4" });
    expect(v.engineVersion).toBe("adaptive-1.0.4");
    expect(v.qualityModel.version).toBe("quality-model-v1");
    expect([v.humanRhythm, v.worstCase, v.nightExitRepair, v.nightFirst]).toEqual([false, false, false, false]);
    expect(v.guards).toEqual({});
  });

  it("markeert een ablatie in de versie en weigert onbekende onderdelen", () => {
    const v = engineVariant({ NS_ENGINE_PROFILE: "rhythm", NS_ENGINE_VARIANT: JSON.stringify({ nightExitScale: 5 }) });
    expect(v.nightExitScale).toBe(5);
    expect(v.engineVersion).toBe("adaptive-1.0.4-rhythm+ablation");
    expect(() => engineVariant({ NS_ENGINE_VARIANT: JSON.stringify({ hoursBalance: 1 }) })).toThrow();
    expect(() => engineVariant({ NS_ENGINE_PROFILE: "1.0.5" })).toThrow();
  });
});
