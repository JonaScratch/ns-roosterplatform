import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_REQUIREMENTS_V1,
  checkOperationalRequirements,
  fridayDutyAllowed,
  maxTotalCreditMinutes,
  operationalSwapGuard,
} from "@/domain/operational-requirements";
import { type EvaluationInput, evaluateQuality } from "@/domain/quality-evaluator";
import { QUALITY_MODEL_V2, QUALITY_MODEL_V3, type QualityModel } from "@/domain/quality-model";
import { polishBySwaps } from "@/domain/roster-polish";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "@/domain/roster-quality";

/**
 * De operationele ontwerpeisen van de gebruiker (USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT):
 * werkopdracht "machinist preference", tests 8 en 10.
 *
 * Schrijfwijze per regel: zeven tekens van maandag tot zondag. Hoofdletters zijn
 * diensten (zie SOORTEN), R is rust, W is WR (WTV), S is reserve.
 */

const u = (uur: number, minuut = 0) => uur * 60 + minuut;

const SOORTEN: Record<string, { start: number; eind: number; kinds: string[] }> = {
  V: { start: u(6), eind: u(14), kinds: ["VROEG"] },
  // De late diensten en de nacht duren zeven uur, zodat een week van vijf
  // ervan onder 40:00 blijft en alleen de vrijdageis getoetst wordt. (De eerste
  // versie had late diensten van acht uur; toen brak "LLLLARR" met 41:00 ook de
  // urengrens en telde elke test twee overtredingen.)
  L: { start: u(16), eind: u(23), kinds: ["LAAT"] },
  // Laat tot 23:59, en laat tot precies middernacht.
  M: { start: u(17), eind: u(23, 59), kinds: ["LAAT"] },
  X: { start: u(17), eind: u(24), kinds: ["LAAT"] },
  // Afloper tot 01:00 zaterdag.
  A: { start: u(18), eind: u(25), kinds: ["LAAT"] },
  N: { start: u(23), eind: u(30), kinds: ["NACHT"] },
  // Vroeg van 8:01 en 7:59, voor de urengrens.
  P: { start: u(6), eind: u(14, 1), kinds: ["VROEG"] },
  Q: { start: u(6), eind: u(13, 59), kinds: ["VROEG"] },
};

function diensten(): Map<string, QualityDuty> {
  const kaart = new Map<string, QualityDuty>();
  for (const [letter, s] of Object.entries(SOORTEN)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const code = `${letter}${weekday}`;
      kaart.set(dutyKey(code, weekday), { code, weekday, startMinute: s.start, endMinute: s.eind, kinds: s.kinds });
    }
  }
  return kaart;
}

function rooster(code: string, profile: string, regels: readonly string[]): QualityRosterInput {
  return {
    code,
    name: code,
    profile,
    weeksPerLine: 1,
    days: regels.flatMap((regel, index) =>
      [...regel].map((teken, dag) => {
        const isDienst = teken in SOORTEN;
        return {
          lineNumber: index + 1,
          weekIndex: 1,
          weekday: dag + 1,
          positionType: isDienst ? "DUTY" : teken === "S" ? "RES" : teken === "W" ? "WR" : "RUST",
          dutyCode: isDienst ? `${teken}${dag + 1}` : null,
        };
      }),
    ),
  };
}

const controleer = (rosters: readonly QualityRosterInput[]) => checkOperationalRequirements(rosters, diensten());

function evalueer(rosters: readonly QualityRosterInput[], model: QualityModel) {
  const input: EvaluationInput = {
    rosters,
    reference: rosters,
    duties: diensten(),
    requiredDutyKeys: rosters.flatMap((r) => r.days.filter((d) => d.dutyCode).map((d) => dutyKey(d.dutyCode!, d.weekday))),
    nightRosterCodes: [],
    rules: { minDailyRestMinutes: 720, nightRecoveryMinutes: 46 * 60, longDutyMinutes: 540 },
    model,
  };
  return evaluateQuality(input);
}

describe("vrijdag vóór een vrij weekend (test 8)", () => {
  it("een afloper tot zaterdag 01:00 vóór RUST + RUST wordt afgewezen", () => {
    const uit = controleer([rooster("DDR-L", "LAAT", ["LLLLARR"])]);
    expect(uit.violations).toHaveLength(1);
    expect(uit.violations[0]).toContain("01:00 (zaterdag)");
    expect(uit.weekends[0].fridayCompliant).toBe(false);
  });

  it("23:00 mag, 23:59 mag, 24:00 niet", () => {
    expect(controleer([rooster("R", "LAAT", ["LLLLLRR"])]).violations).toHaveLength(0);
    expect(controleer([rooster("R", "LAAT", ["LLLLMRR"])]).violations).toHaveLength(0);
    expect(controleer([rooster("R", "LAAT", ["LLLLXRR"])]).violations).toHaveLength(1);
  });

  it("een nachtdienst op vrijdag mag (besluit van de gebruiker, 19-09-2026)", () => {
    const uit = controleer([rooster("DDR-N", "LAAT_NACHT", ["NNNNNRR"])]);
    expect(uit.violations).toHaveLength(0);
    expect(uit.weekends[0].friday?.night).toBe(true);
    expect(fridayDutyAllowed({ endMinute: u(31), kinds: ["NACHT"] })).toBe(true);
  });

  it("geldt niet als het rooster dat weekend werkt", () => {
    expect(controleer([rooster("R", "LAAT", ["RLLLALR"])]).violations).toHaveLength(0);
    expect(controleer([rooster("R", "LAAT", ["RRLLLLA"])]).weekends).toHaveLength(0);
  });

  it("de vrijdag van een vrij weekend is de dag ervoor in rotatievolgorde", () => {
    // Regel 2 heeft het vrije weekend, regel 2 heeft de afloper op vrijdag;
    // regel 1 heeft de afloper op vrijdag maar werkt het weekend.
    const uit = controleer([rooster("R", "LAAT", ["LLLLALL", "RLLLARR"])]);
    expect(uit.violations).toHaveLength(1);
    expect(uit.violations[0]).toContain("regel 2");
  });

  it("WR + RUST is geen vrij weekend van RUST + RUST: gemeld als structuur, geen afwijzing", () => {
    const uit = controleer([rooster("R", "LAAT", ["LLLRLWR"])]);
    expect(uit.violations).toHaveLength(0);
    expect(uit.structuralFindings).toHaveLength(1);
    expect(uit.weekends[0].restRest).toBe(false);
  });
});

describe("roostergemiddelde hoogstens 40:00 (test 10)", () => {
  // Vijf diensten: 4 × 8:00 plus een vrijdag van 7:59, 8:00 of 8:01.
  it("39:59 en 40:00 zijn geldig, 40:01 niet", () => {
    expect(controleer([rooster("R", "VROEG", ["VVVVQRR"])]).hours[0]).toMatchObject({ averageWeeklyMinutes: u(39, 59), ok: true });
    expect(controleer([rooster("R", "VROEG", ["VVVVVRR"])]).hours[0]).toMatchObject({ averageWeeklyMinutes: u(40), ok: true });
    const boven = controleer([rooster("R", "VROEG", ["VVVVPRR"])]);
    expect(boven.hours[0]).toMatchObject({ averageWeeklyMinutes: u(40, 1), ok: false });
    expect(boven.violations[0]).toContain("40:01");
  });

  it("WR telt als acht uur, R niet", () => {
    expect(controleer([rooster("R", "VROEG", ["VVVVWRR"])]).hours[0].averageWeeklyMinutes).toBe(u(40));
    expect(controleer([rooster("R", "VROEG", ["VVVVPWR"])]).hours[0].ok).toBe(false);
  });

  it("een losse regel mag boven 40:00 als het rooster als geheel eronder blijft", () => {
    // Regel 1: 40:01, regel 2: 39:59 — samen precies 40:00.
    const uit = controleer([rooster("R", "VROEG", ["VVVVPRR", "VVVVQRR"])]);
    expect(uit.hours[0]).toMatchObject({ averageWeeklyMinutes: u(40), ok: true });
  });

  it("naar beneden afgerond zoals het roosterblad: 80:01 over twee weken is 40:00", () => {
    expect(maxTotalCreditMinutes(1)).toBe(2400);
    expect(maxTotalCreditMinutes(2)).toBe(4801);
    // 40:01 + 40:00 = 80:01 → 40:00 op het blad; 40:01 + 40:01 = 80:02 → 40:01.
    expect(controleer([rooster("R", "VROEG", ["VVVVPRR", "VVVVVRR"])]).hours[0].ok).toBe(true);
    expect(controleer([rooster("R", "VROEG", ["VVVVPRR", "VVVVPRR"])]).hours[0].ok).toBe(false);
  });
});

describe("in het kwaliteitsmodel", () => {
  const fout = [rooster("DDR-L", "LAAT", ["LLLLARR"])];

  it("model v3 maakt een overtreding hard ongeldig", () => {
    const rapport = evalueer(fout, QUALITY_MODEL_V3);
    expect(rapport.hardValidity.hardValid).toBe(false);
    expect(rapport.hardValidity.reasons.join(" ")).toContain(OPERATIONAL_REQUIREMENTS_V1.sourceStatus);
  });

  it("model v2 meldt hem, maar blijft rekenen zoals in de Final-Brain-meting", () => {
    const rapport = evalueer(fout, QUALITY_MODEL_V2);
    expect(rapport.hardValidity.hardValid).toBe(true);
    expect(rapport.operational.violations).toHaveLength(1);
  });

  it("v3 laat uren, regelmaat, rust, eerlijkheid en continuïteit van v2 ongemoeid", () => {
    // v3 voegt voorkeur toe en rekent nachtreeksen op ritme min belasting;
    // de andere onderdelen horen exact gelijk te blijven.
    const goed = [rooster("DDR-L", "LAAT", ["LLLLLRR", "RLLLLLR"])];
    const v2 = evalueer(goed, QUALITY_MODEL_V2);
    const v3 = evalueer(goed, QUALITY_MODEL_V3);
    for (const key of ["hours", "flow", "rest", "fairness", "stability"] as const) {
      expect(v3.components[key]).toEqual(v2.components[key]);
    }
    expect(v2.components.preference.score).toBeNull();
    expect(v3.components.preference.score).not.toBeNull();
  });
});

describe("het bijschaven breekt de eisen niet", () => {
  const deadline = () => Date.now() + 5000;

  it("ruilt geen afloper naar de vrijdag vóór een vrij weekend, ook als de score dat beloont", () => {
    // Regel 1 werkt het weekend en heeft de afloper; regel 2 heeft een vrij
    // weekend. De score betaalt voor de afloper op regel 2.
    const rosters = [rooster("R", "LAAT", ["RRLLALL", "LLLLLRR"])];
    const score = (rs: readonly QualityRosterInput[]) =>
      rs[0].days.some((d) => d.lineNumber === 2 && d.dutyCode === "A5") ? 1000 : 0;
    const zonder = polishBySwaps({ rosters, duties: diensten(), minRestMinutes: 720, deadline: deadline(), score, maxKicks: 0 });
    expect(zonder.score).toBe(1000);
    const met = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: 720,
      deadline: deadline(),
      score,
      maxKicks: 0,
      guard: operationalSwapGuard(rosters),
    });
    expect(met.score).toBe(0);
    expect(controleer(met.rosters).violations).toHaveLength(0);
  });

  it("ruilt geen langere dienst naar een rooster dat daarmee boven 40:00 komt", () => {
    // A: vijf keer 8:00 = 40:00. B: 3 × 8:00 + 7:59 + 8:01 = 40:00. De score
    // betaalt voor P5 (8:01) in A; dan komt A op 40:01.
    const rosters = [rooster("A", "VROEG", ["VVVVVRR"]), rooster("B", "VROEG", ["VVVQPRR"])];
    const score = (rs: readonly QualityRosterInput[]) => (rs[0].days.some((d) => d.dutyCode === "P5") ? 1000 : 0);
    const zonder = polishBySwaps({ rosters, duties: diensten(), minRestMinutes: 720, deadline: deadline(), score, maxKicks: 0 });
    expect(zonder.score).toBe(1000);
    const met = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: 720,
      deadline: deadline(),
      score,
      maxKicks: 0,
      guard: operationalSwapGuard(rosters),
    });
    expect(met.score).toBe(0);
    expect(controleer(met.rosters).hours.every((h) => h.ok)).toBe(true);
  });

  it("een ruil die een rooster onder de grens brengt, blijft toegestaan", () => {
    // A zit op 40:01 (ongeldig), B op 39:59. P5 van A naar B: allebei 40:00.
    const rosters = [rooster("A", "VROEG", ["VVVVPRR"]), rooster("B", "VROEG", ["VVVQVRR"])];
    const score = (rs: readonly QualityRosterInput[]) => (rs[1].days.some((d) => d.dutyCode === "P5") ? 1000 : 0);
    const met = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: 720,
      deadline: deadline(),
      score,
      maxKicks: 0,
      guard: operationalSwapGuard(rosters),
    });
    expect(met.score).toBe(1000);
  });
});
