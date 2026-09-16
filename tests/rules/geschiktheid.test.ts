import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUITABILITY_POLICY,
  type NeighbourDuty,
  assessSuitability,
  suitabilitySummary,
} from "@/domain/suitability";
import { restBetween } from "@/domain/duty-window";

/**
 * De laag tussen "mag het" en "wie krijgt hem".
 *
 * ## Waar deze laag werkelijk bijt
 *
 * De opdracht noemt het geval: dienst 101 op maandag tot 01:24, dinsdag
 * reserve, en dan een dienst van 05:00 aangeboden krijgen. Bij het uitwerken
 * bleek de eerste versie van deze tests een verkeerd voorbeeld te gebruiken: een
 * dienst die op dinsdag om 05:00 begint, valt na een dienst die om 01:24 eindigt
 * al af op de rusttijd zelf — 3 uur 36. Daar is geen tweede laag voor nodig.
 *
 * Het gat zit ergens anders, en op twee plekken:
 *
 *  1. **Met een dag ertussen.** Maandag laat, dinsdag vrij of reserve, woensdag
 *     05:00. Ruim zevenentwintig uur rust, juridisch niets aan de hand, en toch
 *     een ritme dat in één stap wordt omgedraaid.
 *  2. **Net boven het minimum.** Twaalf uur en zes minuten rust is toegestaan.
 *     Als eerste voorstel aan een medewerker is het dat niet: dan wordt het
 *     minimum stilzwijgend de norm.
 *
 * Beide gevallen staan hieronder, en beide heten nadrukkelijk geen overtreding.
 */

function dienst(
  date: string,
  code: string,
  start: number,
  eind: number,
  kinds: readonly string[] = [],
): NeighbourDuty {
  return {
    date,
    code,
    kinds: kinds as NeighbourDuty["kinds"],
    shape: { startMinute: start, endMinute: eind, breakMinutes: 40, overtimeMinutes: 0 },
  };
}

/** Maandag 101: 17:19 tot 01:24 in de nacht naar dinsdag. */
const LATE_MAANDAG = dienst("2026-09-07", "101", 17 * 60 + 19, 25 * 60 + 24, ["LAAT"]);

describe("laat, een dag ertussen, dan zeer vroeg", () => {
  // Woensdag 05:00. Tussen dinsdag 01:24 en woensdag 05:00 zit ruim 27 uur.
  const woensdagVroeg = dienst("2026-09-09", "012", 5 * 60, 13 * 60, ["VROEG"]);
  const uitkomst = assessSuitability({
    previous: LATE_MAANDAG,
    candidate: woensdagVroeg,
    next: null,
    daysSincePrevious: 2,
    daysUntilNext: null,
  });

  it("heeft ruimschoots voldoende rust", () => {
    const rust = restBetween(
      { date: LATE_MAANDAG.date, shape: LATE_MAANDAG.shape },
      { date: woensdagVroeg.date, shape: woensdagVroeg.shape },
    );
    expect(rust).toBeGreaterThan(24 * 60);
  });

  it("wordt tóch niet vanzelf aan de medewerker aangeboden", () => {
    expect(uitkomst.selfServiceSuitable).toBe(false);
  });

  it("noemt het ritme als bezwaar, in gewone taal", () => {
    const ritme = uitkomst.factors.find((factor) => factor.key === "PATTERN");
    expect(ritme?.verdict).toBe("POOR");
    expect(ritme?.detail).toContain("01:24");
    expect(ritme?.detail).toContain("05:00");
  });

  it("noemt ook het terugdraaien van het ritme", () => {
    const rotatie = uitkomst.factors.find((factor) => factor.key === "ROTATION");
    expect(rotatie?.verdict).toBe("POOR");
    expect(rotatie?.detail).toContain("terugdraaien");
  });

  it("zegt nergens dat het verboden is", () => {
    const tekst = [suitabilitySummary(uitkomst), ...uitkomst.concerns].join(" ").toLowerCase();
    expect(tekst).not.toContain("verboden");
    expect(tekst).not.toContain("overtreding");
    expect(uitkomst.policyId).toBe("SELF_SERVICE_PATTERN_COMPATIBILITY");
  });
});

describe("rust die net boven het minimum ligt", () => {
  // 01:24 → 13:30 is 12 uur en 6 minuten: toegestaan, en krap.
  const dinsdagKrap = dienst("2026-09-08", "137", 13 * 60 + 30, 21 * 60 + 40, ["LAAT"]);
  const uitkomst = assessSuitability({
    previous: LATE_MAANDAG,
    candidate: dinsdagKrap,
    next: null,
    daysSincePrevious: 1,
    daysUntilNext: null,
  });

  it("ligt boven de rustnorm", () => {
    const rust = restBetween(
      { date: LATE_MAANDAG.date, shape: LATE_MAANDAG.shape },
      { date: dinsdagKrap.date, shape: dinsdagKrap.shape },
    );
    expect(rust).toBeGreaterThan(12 * 60);
    expect(rust).toBeLessThan(13 * 60);
  });

  it("wordt niet als eerste voorstel getoond", () => {
    expect(uitkomst.selfServiceSuitable).toBe(false);
    expect(uitkomst.concerns.join(" ")).toContain("rust");
  });
});

describe("laat, reserve, opnieuw laat", () => {
  // 01:24 → 15:00 is 13 uur 36: ruim, en het ritme blijft staan.
  const dinsdagLaat = dienst("2026-09-08", "141", 15 * 60, 23 * 60, ["LAAT"]);
  const uitkomst = assessSuitability({
    previous: LATE_MAANDAG,
    candidate: dinsdagLaat,
    next: null,
    daysSincePrevious: 1,
    daysUntilNext: null,
  });

  it("wordt wél aangeboden", () => {
    expect(uitkomst.selfServiceSuitable).toBe(true);
    expect(uitkomst.concerns).toEqual([]);
  });

  it("scoort hoger dan de zeer vroege variant", () => {
    const vroeg = assessSuitability({
      previous: LATE_MAANDAG,
      candidate: dienst("2026-09-09", "012", 5 * 60, 13 * 60, ["VROEG"]),
      next: null,
      daysSincePrevious: 2,
      daysUntilNext: null,
    });
    expect(uitkomst.score).toBeGreaterThan(vroeg.score);
  });
});

describe("de dienst van de volgende dag telt altijd mee", () => {
  // Een late dinsdagdienst met prima rust vooraf, maar woensdag begint 05:00.
  const dinsdagLaat = dienst("2026-09-08", "141", 15 * 60, 23 * 60, ["LAAT"]);
  const woensdagVroeg = dienst("2026-09-09", "015", 5 * 60, 12 * 60, ["VROEG"]);

  const uitkomst = assessSuitability({
    previous: null,
    candidate: dinsdagLaat,
    next: woensdagVroeg,
    daysSincePrevious: null,
    daysUntilNext: 1,
  });

  it("ziet het probleem aan de achterkant", () => {
    const erna = uitkomst.factors.find((factor) => factor.key === "REST_AFTER");
    expect(erna?.verdict).toBe("POOR");
    expect(uitkomst.selfServiceSuitable).toBe(false);
  });

  it("noemt de dienst van de volgende dag met naam", () => {
    expect(uitkomst.concerns.join(" ")).toContain("015");
  });
});

describe("een gewone opeenvolging", () => {
  const maandagVroeg = dienst("2026-09-07", "043", 5 * 60 + 12, 13 * 60 + 20, ["VROEG"]);
  const dinsdagVroeg = dienst("2026-09-08", "044", 5 * 60 + 45, 13 * 60 + 40, ["VROEG"]);

  it("levert geen bezwaren op", () => {
    const uitkomst = assessSuitability({
      previous: maandagVroeg,
      candidate: dinsdagVroeg,
      next: null,
      daysSincePrevious: 1,
      daysUntilNext: null,
    });
    expect(uitkomst.selfServiceSuitable).toBe(true);
    expect(uitkomst.score).toBeGreaterThan(0.9);
  });
});

describe("het beleid is beleid en geen regel", () => {
  const woensdagVroeg = dienst("2026-09-09", "012", 5 * 60, 13 * 60, ["VROEG"]);

  it("draagt een eigen versie mee", () => {
    const uitkomst = assessSuitability({
      previous: null,
      candidate: woensdagVroeg,
      next: null,
      daysSincePrevious: null,
      daysUntilNext: null,
    });
    expect(uitkomst.policyVersion).toBe(DEFAULT_SUITABILITY_POLICY.version);
  });

  it("is per aanroep te vervangen zonder de regels te raken", () => {
    // Een ruimer beleid keurt dezelfde overgang anders. Dat dit kan, is het
    // bewijs dat het een instelling is en geen norm: aan een CAO-bepaling kan
    // een aanroeper niet draaien.
    const soepel = assessSuitability(
      {
        previous: LATE_MAANDAG,
        candidate: woensdagVroeg,
        next: null,
        daysSincePrevious: 2,
        daysUntilNext: null,
      },
      {
        ...DEFAULT_SUITABILITY_POLICY,
        earlyStartBefore: 4 * 60,
        maxBackwardShiftMinutes: 16 * 60,
      },
    );
    expect(soepel.selfServiceSuitable).toBe(true);
  });
});
