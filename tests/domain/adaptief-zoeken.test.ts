import { describe, expect, it } from "vitest";
import {
  type ComponentScores,
  type PoolCandidate,
  acceptRepair,
  adaptPressure,
  assignmentDistance,
  diagnoseRepair,
  dominates,
  gateFailures,
  gateFromOfficial,
  offerToPool,
  paretoFront,
  plateauReached,
  rankingScore,
  selectFinal,
} from "@/domain/adaptive-search";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CURRENT_QUALITY_MODEL, QUALITY_MODEL_V1 } from "@/domain/quality-model";
import { ADAPTIVE_CONFIG } from "@/server/generation/adaptive/config";
import { STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";

/**
 * De beslissingen van de adaptieve zoekmachine, zonder solver.
 */

const SCORES = (overrides: Partial<Record<keyof ComponentScores, number | null>> = {}): ComponentScores => ({
  hours: 80,
  flow: 80,
  rest: 80,
  nights: 80,
  fairness: 80,
  stability: 50,
  ...overrides,
});

function slots(prefix: string, aantal: number, anders = 0): Map<string, string | null> {
  const kaart = new Map<string, string | null>();
  for (let i = 0; i < aantal; i += 1) {
    kaart.set(`slot-${i}`, i < anders ? `${prefix}-${i}` : `basis-${i}`);
  }
  return kaart;
}

function kandidaat(key: string, ranking: number, verschil = 0, components = SCORES()): PoolCandidate {
  return {
    key,
    attempt: Number(key.replace(/\D/g, "")) || 0,
    robust: ranking,
    overall: ranking,
    ranking,
    components,
    slots: slots(key, 100, verschil),
    facts: { singletonNights: 0, heavyTransitions: 0, maxRosterHoursDeviation: 10, worstLine: 60 },
  };
}

describe("afstand en dubbelen", () => {
  it("telt dienstdagen met een ander dienstnummer", () => {
    expect(assignmentDistance(slots("a", 50, 10), slots("b", 50, 10))).toBe(10);
    expect(assignmentDistance(slots("a", 50), slots("b", 50))).toBe(0);
  });

  it("houdt van twee bijna gelijke kandidaten alleen de betere", () => {
    const eerste = offerToPool([], kandidaat("k1", 80, 0), { maxSize: 5, duplicateDistance: 10, gate: null });
    expect(eerste.verdict).toBe("VALID_ELITE");
    const slechterDubbel = offerToPool(eerste.pool, kandidaat("k2", 79, 3), { maxSize: 5, duplicateDistance: 10, gate: null });
    expect(slechterDubbel.verdict).toBe("DUPLICATE");
    expect(slechterDubbel.pool).toHaveLength(1);
    const beterDubbel = offerToPool(eerste.pool, kandidaat("k3", 82, 3), { maxSize: 5, duplicateDistance: 10, gate: null });
    expect(beterDubbel.verdict).toBe("VALID_ELITE");
    expect(beterDubbel.pool.map((p) => p.key)).toEqual(["k3"]);
  });

  it("laat bij een volle pool de laagst gerangschikte vallen", () => {
    let pool: readonly PoolCandidate[] = [];
    for (let i = 1; i <= 3; i += 1) {
      pool = offerToPool(pool, kandidaat(`k${i}`, 70 + i, 20 * i), { maxSize: 3, duplicateDistance: 5, gate: null }).pool;
    }
    const laag = offerToPool(pool, kandidaat("k9", 60, 90), { maxSize: 3, duplicateDistance: 5, gate: null });
    expect(laag.verdict).toBe("DOMINATED");
    const hoog = offerToPool(pool, kandidaat("k8", 90, 90), { maxSize: 3, duplicateDistance: 5, gate: null });
    expect(hoog.pool.map((p) => p.key)).toEqual(["k8", "k3", "k2"]);
  });
});

describe("Pareto", () => {
  it("domineert alleen wie nergens slechter en ergens beter is", () => {
    expect(dominates(SCORES({ hours: 90 }), SCORES())).toBe(true);
    expect(dominates(SCORES({ hours: 90, rest: 70 }), SCORES())).toBe(false);
    expect(dominates(SCORES(), SCORES())).toBe(false);
  });

  it("bewaart kandidaten die elk op iets anders het beste zijn", () => {
    const a = { components: SCORES({ hours: 95, rest: 70 }) };
    const b = { components: SCORES({ hours: 70, rest: 95 }) };
    const c = { components: SCORES({ hours: 69, rest: 69 }) };
    expect(paretoFront([a, b, c])).toEqual([a, b]);
  });
});

describe("de kwaliteitspoort", () => {
  const poort = gateFromOfficial(
    { robust: 65, facts: { singletonNights: 0, heavyTransitions: 2, maxRosterHoursDeviation: 48, worstLine: 16 } },
    { robustPoints: 10, singletonNights: 2, heavyTransitions: 2, hoursMinutes: 12, hoursFloorMinutes: 30, worstLinePoints: 10 },
  );

  it("volgt het officiële rooster met een tolerantie", () => {
    expect(poort).toEqual({ minRobust: 55, maxSingletonNights: 2, maxHeavyTransitions: 4, maxRosterHoursDeviation: 60, minWorstLine: 6 });
  });

  it("noemt precies welke drempel een kandidaat niet haalt", () => {
    const redenen = gateFailures(
      { robust: 50, facts: { singletonNights: 3, heavyTransitions: 1, maxRosterHoursDeviation: 20, worstLine: 30 } },
      poort,
    );
    expect(redenen).toHaveLength(2);
    expect(redenen.join(" ")).toContain("losse nachten");
  });

  it("houdt een kandidaat onder de poort buiten de pool", () => {
    const slecht = { ...kandidaat("k1", 40), robust: 40 };
    expect(offerToPool([], slecht, { maxSize: 5, duplicateDistance: 5, gate: poort }).verdict).toBe("LOW_QUALITY");
  });
});

describe("reparaties", () => {
  it("aanvaardt geen reparatie die één ding verbetert en een ander veel slechter maakt", () => {
    const uitkomst = acceptRepair(
      { ranking: 80, components: SCORES() },
      { ranking: 82, components: SCORES({ nights: 100, fairness: 60 }) },
      { minRankingGain: 0.1, maxComponentLoss: 2 },
    );
    expect(uitkomst.accepted).toBe(false);
    expect(uitkomst.reason).toContain("fairness");
  });

  it("houdt eerlijkheid strenger vast dan de andere onderdelen", () => {
    // Eén punt minder eerlijkheid mag onder de algemene grens van 2, maar niet
    // onder de bewaking van 0,5 die de rhythm-revisie van v1.0.4 op eerlijkheid zet.
    const kind = { ranking: 82, components: SCORES({ nights: 95, fairness: 79 }) };
    const ruim = acceptRepair({ ranking: 80, components: SCORES() }, kind, { minRankingGain: 0.1, maxComponentLoss: 2 });
    const bewaakt = acceptRepair({ ranking: 80, components: SCORES() }, kind, {
      minRankingGain: 0.1,
      maxComponentLoss: 2,
      componentTolerances: ADAPTIVE_CONFIG.guards.tolerances,
    });
    expect(ruim.accepted).toBe(true);
    expect(bewaakt.accepted).toBe(false);
    expect(bewaakt.reason).toContain("fairness");
  });

  it("laat de klassieke zoekmachine ongemoeid: geen begintijdsterm in de basisgewichten", () => {
    for (const gewichten of Object.values(STRATEGY_WEIGHTS)) {
      expect(gewichten.startJitter).toBe(0);
    }
  });

  it("aanvaardt een reparatie die vooruitgaat zonder verlies", () => {
    const uitkomst = acceptRepair(
      { ranking: 80, components: SCORES() },
      { ranking: 81, components: SCORES({ nights: 90, rest: 79 }) },
      { minRankingGain: 0.1, maxComponentLoss: 2 },
    );
    expect(uitkomst.accepted).toBe(true);
    expect(uitkomst.deltas.nights).toBe(10);
  });

  it("richt de reparatie op de zwakste plek ten opzichte van het officiële rooster", () => {
    const diagnose = diagnoseRepair(
      SCORES({ nights: 60, hours: 85 }),
      SCORES({ nights: 100, hours: 70 }),
      { singletonNights: 1, twoNightBlocks: 2, heavyTransitions: 0, maxRosterHoursDeviation: 20, worstLine: 50 },
      new Set(),
    );
    expect(diagnose[0].target).toBe("NIGHTS");
    const zonderNachten = diagnoseRepair(
      SCORES({ nights: 60 }),
      SCORES(),
      { singletonNights: 1, twoNightBlocks: 0, heavyTransitions: 0, maxRosterHoursDeviation: 20, worstLine: 50 },
      new Set(["NIGHTS"]),
    );
    expect(zonderNachten.some((d) => d.target === "NIGHTS")).toBe(false);
  });
});

describe("plateau en druk", () => {
  it("ziet een plateau pas als de beste score een heel venster stilstaat", () => {
    expect(plateauReached([70, 75, 80], 3, 0.2)).toBe(false);
    expect(plateauReached([70, 80, 80.1, 80.1, 80.1], 3, 0.2)).toBe(true);
    expect(plateauReached([70, 80, 80.1, 80.5, 81], 3, 0.2)).toBe(false);
  });

  it("verhoogt de druk op een zwakke component en laat een sterke terugzakken", () => {
    const druk = adaptPressure(
      SCORES({ nights: 50, hours: 95 }),
      SCORES({ nights: 100, hours: 70 }),
      { hours: 2, nights: 1 },
      { step: 1.5, max: 4, decay: 0.8 },
    );
    expect(druk.nights).toBe(1.5);
    expect(druk.hours).toBe(1.6);
  });
});

describe("de uiteindelijke drie", () => {
  it("kiest de beste en daarna alleen kandidaten die genoeg verschillen", () => {
    const pool = [kandidaat("k1", 90, 0), kandidaat("k2", 89, 5), kandidaat("k3", 85, 40), kandidaat("k4", 80, 80)];
    const keuze = selectFinal(pool, { count: 3, minDistance: 20 });
    expect(keuze.selected.map((c) => c.key)).toEqual(["k1", "k3", "k4"]);
    expect(keuze.skipped.some((s) => s.key === "k2")).toBe(true);
  });

  it("toont er twee als er maar twee genoeg verschillen", () => {
    const pool = [kandidaat("k1", 90, 0), kandidaat("k2", 89, 5), kandidaat("k3", 85, 40)];
    expect(selectFinal(pool, { count: 3, minDistance: 20 }).selected).toHaveLength(2);
  });

  it("rangschikt met de strategiekanteling maar straft een uitschieterregel", () => {
    const gewichten = { hours: 0.2, flow: 0.2, rest: 0.15, nights: 0.2, fairness: 0.15, stability: 0.1 };
    const robuust = { overallWeight: 0.85, worstLineWeight: 0.15, outlierGapPoints: 35, outlierPenaltyPerPoint: 0.25 };
    const zonder = rankingScore(SCORES(), 70, gewichten, {}, robuust, 75);
    const metUitschieter = rankingScore(SCORES(), 20, gewichten, {}, robuust, 75);
    expect(metUitschieter).toBeLessThan(zonder - 7.5);
    const rust = rankingScore(SCORES({ rest: 100 }), 70, gewichten, { rest: 2 }, robuust, 75);
    const gewoon = rankingScore(SCORES({ rest: 100 }), 70, gewichten, {}, robuust, 75);
    expect(rust).toBeGreaterThan(gewoon);
  });
});

describe("de configuratie-afdruk", () => {
  it("staat ongewijzigd in de afdruk van de huidige engineversie", () => {
    // De afdruk is wat later nog te lezen is; loopt hij achter op de code, dan
    // beschrijft het rapport een machine die niet heeft gedraaid.
    const naam = `optimizer-config-${ADAPTIVE_CONFIG.version.replace("adaptive-", "v")}.json`;
    const bestand = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "configs", naam), "utf8"));
    expect(bestand).toEqual(
      JSON.parse(
        JSON.stringify({
          version: ADAPTIVE_CONFIG.version,
          qualityModelVersion: CURRENT_QUALITY_MODEL.version,
          adaptive: ADAPTIVE_CONFIG,
          baseWeights: STRATEGY_WEIGHTS,
        }),
      ),
    );
  });

  it("bewaart de afdruk van v1.0.4 als verslag van waarmee toen is gemeten", () => {
    const oud = JSON.parse(
      readFileSync(path.resolve(__dirname, "..", "..", "configs", "optimizer-config-v1.0.4.json"), "utf8"),
    );
    expect(oud.version).toBe("adaptive-1.0.4");
    expect(oud.qualityModelVersion).toBe(QUALITY_MODEL_V1.version);
  });

  it("geeft elke modus een budget waar ten minste de starts en het bijschaven in passen", () => {
    for (const [naam, modus] of Object.entries(ADAPTIVE_CONFIG.modes)) {
      const nodig =
        modus.minStarts * (modus.startSeconds + modus.polishSeconds + ADAPTIVE_CONFIG.overheadSecondsPerCandidate);
      expect(nodig, `${naam}: budget te krap voor ${modus.minStarts} starts`).toBeLessThanOrEqual(modus.budgetSeconds);
    }
  });
});
