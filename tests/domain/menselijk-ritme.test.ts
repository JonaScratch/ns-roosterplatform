import { describe, expect, it } from "vitest";
import { type EvaluationInput, evaluateQuality } from "@/domain/quality-evaluator";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "@/domain/roster-quality";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { flowDays, nightBlocksFlow, workBlocks } from "@/domain/roster-flow";
import { nightExitValue, rhythmMetrics } from "@/domain/rhythm-metrics";

/**
 * Kwaliteitsmodel v2 op synthetische roosters: de menselijke principes.
 *
 * Elk paar hieronder komt uit de werkopdracht en uit wat de zeven menselijke
 * Dordrechtse roosters laten zien (`docs/human-roster-benchmark/`). Het tweede
 * rooster van elk paar is telkens het patroon dat mensen niet maken. Zet het
 * model dat niet lager, dan stuurt de zoekmachine de verkeerde kant op.
 *
 * Schrijfwijze: per regel een tekst van zeven tekens, maandag tot en met
 * zondag. Hoofdletters zijn diensten (zie SOORTEN), R is rust, S is reserve.
 */

interface Soort {
  readonly start: number;
  readonly eind: number;
  readonly kinds: readonly string[];
}

const SOORTEN: Record<string, Soort> = {
  V: { start: 6 * 60, eind: 14 * 60, kinds: ["VROEG"] },
  L: { start: 14 * 60, eind: 22 * 60, kinds: ["LAAT"] },
  N: { start: 22 * 60, eind: 30 * 60, kinds: ["NACHT"] },
  // Vroeg met een andere begintijd, voor het verspringen binnen een dagdeel.
  A: { start: 4 * 60 + 30, eind: 12 * 60 + 30, kinds: ["VROEG"] },
  B: { start: 9 * 60, eind: 17 * 60, kinds: ["VROEG"] },
  // Laat met vergelijkbare tijden: vier van deze na elkaar is stabiel.
  K: { start: 15 * 60, eind: 23 * 60, kinds: ["LAAT"] },
  // 50+ Mix: vroeg en laat overlappen op de klok.
  P: { start: 10 * 60, eind: 17 * 60 + 30, kinds: ["VROEG"] },
  Q: { start: 11 * 60, eind: 19 * 60, kinds: ["LAAT"] },
};

function diensten(): Map<string, QualityDuty> {
  const kaart = new Map<string, QualityDuty>();
  for (const [letter, soort] of Object.entries(SOORTEN)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const code = `${letter}${weekday}`;
      kaart.set(dutyKey(code, weekday), { code, weekday, startMinute: soort.start, endMinute: soort.eind, kinds: soort.kinds });
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
          positionType: isDienst ? "DUTY" : teken === "S" ? "RES" : "RUST",
          dutyCode: isDienst ? `${teken}${dag + 1}` : null,
        };
      }),
    ),
  };
}

function meet(rosters: readonly QualityRosterInput[]) {
  const input: EvaluationInput = {
    rosters,
    reference: rosters,
    duties: diensten(),
    requiredDutyKeys: rosters.flatMap((r) => r.days.filter((d) => d.dutyCode).map((d) => dutyKey(d.dutyCode!, d.weekday))),
    nightRosterCodes: rosters.filter((r) => r.days.some((d) => d.dutyCode?.startsWith("N"))).map((r) => r.code),
    rules: { minDailyRestMinutes: 720, nightRecoveryMinutes: 46 * 60, longDutyMinutes: 540 },
    model: QUALITY_MODEL_V2,
  };
  return evaluateQuality(input);
}

describe("de cyclus is een cirkel", () => {
  it("herkent een nachtreeks die over de regelgrens doorloopt als één reeks", () => {
    // Zoals Laat/Nacht in Dordrecht: drie nachten vr–zo op regel 1, drie ma–wo op regel 2.
    const dagen = flowDays(rooster("LN", "LAAT_NACHT", ["RRRRNNN", "NNNRRLL"]), diensten());
    const reeksen = nightBlocksFlow(dagen);
    expect(reeksen).toHaveLength(1);
    expect(reeksen[0].length).toBe(6);
    expect(reeksen[0].crossesLineBoundary).toBe(true);
  });

  it("rekent een werkblok over het einde van de cyclus terug naar het begin", () => {
    const blokken = workBlocks(flowDays(rooster("V", "VROEG", ["VVRRRVV"]), diensten()));
    expect(blokken.map((b) => b.length)).toEqual([4]);
  });
});

describe("nachten (§67)", () => {
  it("geeft een reeks van vijf de volle waarde en drie bijna", () => {
    const vijf = meet([rooster("MIX", "MIX", ["NNNNNRR", "RRLLRRR"])]);
    const drie = meet([rooster("LN", "LAAT_NACHT", ["NNNRRRR", "RRLLLRR"])]);
    expect(vijf.components.nights.parts.blocks).toBe(100);
    expect(drie.components.nights.parts.blocks).toBe(90);
  });

  it("zet losse nachten en reeksen van twee duidelijk lager", () => {
    const blok = meet([rooster("LN", "LAAT_NACHT", ["NNNNRRR", "RRLLRRR"])]);
    const twee = meet([rooster("LN", "LAAT_NACHT", ["NNRRNNR", "RRLLRRR"])]);
    const los = meet([rooster("LN", "LAAT_NACHT", ["NRNRNRN", "RRLLRRR"])]);
    expect(blok.components.nights.score!).toBeGreaterThan(twee.components.nights.score! + 30);
    expect(twee.components.nights.score!).toBeGreaterThan(los.components.nights.score!);
  });
});

describe("heen-en-weer (§68)", () => {
  it("zet vroeg-laat-vroeg-laat duidelijk lager dan vroeg-vroeg-laat-laat", () => {
    const blokken = meet([rooster("VL", "VROEG_LAAT", ["VVRLLRR", "VVRLLRR"])]);
    const wisselend = meet([rooster("VL", "VROEG_LAAT", ["VLVLRRR", "VLVLRRR"])]);
    expect(blokken.components.flow.score!).toBeGreaterThan(wisselend.components.flow.score! + 20);
    expect(rhythmMetrics(
      [rooster("VL", "VROEG_LAAT", ["VLVLRRR", "VLVLRRR"])],
      diensten(),
    ).oscillations).toBeGreaterThan(0);
  });

  it("noemt een wissel van etiket zonder verschuiving op de klok geen heen-en-weer", () => {
    // Zoals in 50+ Mix: vroeg om 10:00, laat om 11:00, weer vroeg om 10:00.
    const m = rhythmMetrics([rooster("M50", "MIX_50PLUS", ["PQPRRRR"])], diensten());
    expect(m.oscillations).toBe(0);
    expect(m.labelOnlyOscillations).toBe(1);
    const r = meet([rooster("M50", "MIX_50PLUS", ["PQPRRRR"])]);
    expect(r.metrics.transitions.heavy).toBe(0);
    expect(r.metrics.transitions.lateToEarly).toBe(0);
  });
});

describe("wissel via rust (§69)", () => {
  it("zet vroeg-vroeg-rust-nachten hoger dan vroeg-vroeg-nachten", () => {
    const viaRust = meet([rooster("MIX", "MIX", ["VVRNNNR", "RRRRRRR"])]);
    const direct = meet([rooster("MIX", "MIX", ["VVNNNRR", "RRRRRRR"])]);
    expect(viaRust.components.flow.score!).toBeGreaterThan(direct.components.flow.score!);
    expect(viaRust.components.flow.parts.throughRest).toBe(100);
    // Twee wissels: vroeg → nacht direct, en — de cyclus is rond — nacht → vroeg
    // na negen vrije dagen. De helft gaat dus via rust.
    expect(direct.components.flow.parts.throughRest).toBe(50);
  });
});

describe("na de nachten (§70)", () => {
  it("zet nachten-rust-rust-laat hoger dan nachten gevolgd door vroeg", () => {
    const laat = meet([rooster("MIX", "MIX", ["NNNRRLR", "RRRRRRR"])]);
    const vroeg = meet([rooster("MIX", "MIX", ["NNNRVRR", "RRRRRRR"])]);
    expect(laat.components.nights.parts.exit).toBe(100);
    expect(vroeg.components.nights.parts.exit).toBe(0);
    expect(laat.components.nights.score!).toBeGreaterThan(vroeg.components.nights.score! + 20);
  });

  it("zet een snelle late uitgang niet boven een vroege na ruimer herstel (H09)", () => {
    // Nacht, één vrije dag, laat: 32 uur. Nacht, twee vrije dagen, vroeg: 48 uur.
    // De eerste versie van v2 gaf de eerste 0,5 en de tweede 0, en het
    // bijschaven koos toen de kortere rust.
    const snelLaat = meet([rooster("MIX", "MIX", ["NNNRLRR", "RRRRRRR"])]);
    const ruimVroeg = meet([rooster("MIX", "MIX", ["NNNRRVR", "RRRRRRR"])]);
    expect(snelLaat.components.nights.parts.exit).toBe(0);
    expect(ruimVroeg.components.nights.parts.exit!).toBeGreaterThan(snelLaat.components.nights.parts.exit!);
  });

  it("daalt nooit bij meer herstel en zet laat nooit onder vroeg (H04, H09)", () => {
    const regel = 46 * 60;
    const uren = [8, 24, 32, 45, 46, 48, 56, 71, 72, 80, 120];
    for (const richting of ["E", "L", "N"] as const) {
      for (let i = 1; i < uren.length; i += 1) {
        expect(nightExitValue(richting, uren[i] * 60, regel)).toBeGreaterThanOrEqual(nightExitValue(richting, uren[i - 1] * 60, regel));
      }
    }
    for (const u of uren) {
      expect(nightExitValue("L", u * 60, regel)).toBeGreaterThanOrEqual(nightExitValue("E", u * 60, regel));
    }
    // Onder de herstelrust uit de regel is elke uitgang slechter dan elke erboven.
    const onder = Math.max(...uren.filter((u) => u < 46).flatMap((u) => [nightExitValue("L", u * 60, regel), nightExitValue("E", u * 60, regel)]));
    const boven = Math.min(...uren.filter((u) => u >= 46).flatMap((u) => [nightExitValue("L", u * 60, regel), nightExitValue("E", u * 60, regel)]));
    expect(onder).toBeLessThan(boven);
  });
});

describe("etiket of echte wissel (H09)", () => {
  it("rekent laat om 09:47 gevolgd door vroeg om 07:22 als zware overgang", () => {
    // Het patroon dat het bijschaven in DDR-BLM zocht zolang een verschuiving
    // tot drie uur als 'alleen een ander etiket' gold.
    SOORTEN.X = { start: 9 * 60 + 47, eind: 18 * 60 + 11, kinds: ["LAAT"] };
    SOORTEN.Y = { start: 7 * 60 + 22, eind: 15 * 60 + 22, kinds: ["VROEG"] };
    try {
      const r = meet([rooster("BLM", "BLM", ["XYRRRRR"])]);
      expect(r.metrics.transitions.heavy).toBe(1);
    } finally {
      delete SOORTEN.X;
      delete SOORTEN.Y;
    }
  });
});

describe("begintijden (§71, §72)", () => {
  it("beloont vier late diensten met gelijke tijden", () => {
    const r = meet([rooster("L", "LAAT", ["KKKKRRR"])]);
    expect(r.components.flow.parts.startJitter).toBe(100);
  });

  it("straft sterk wisselende begintijden binnen hetzelfde dagdeel licht tot middelmatig", () => {
    const stabiel = meet([rooster("V", "VROEG", ["VVVVRRR"])]);
    const springerig = meet([rooster("V", "VROEG", ["ABABRRR"])]);
    expect(springerig.components.flow.parts.startJitter!).toBeLessThan(stabiel.components.flow.parts.startJitter!);
    // Een sprong van 4,5 uur is volledig fout, maar het blijft één onderdeel van
    // de regelmaat: het rooster valt er niet om.
    expect(springerig.components.flow.parts.startJitter!).toBe(0);
    expect(springerig.components.flow.score!).toBeGreaterThan(60);
  });

  it("laat een sprong van een uur ongemoeid, zoals in de menselijke roosters", () => {
    const soort = { ...SOORTEN.V };
    const r = rhythmMetrics([rooster("V", "VROEG", ["VVRRRRR"])], diensten());
    expect(soort.start).toBe(360);
    expect(r.startJitter.penalty).toBe(0);
  });
});

describe("uren per regel (§22, §23)", () => {
  it("laat een regel van 32 uur ongemoeid als het rooster als geheel klopt", () => {
    // Twee regels: één van vier diensten, één van vijf en een reservedag.
    const r = meet([rooster("V", "VROEG", ["VVVVRRR", "VVVVVSR"])]);
    expect(r.components.hours.parts.outliers).toBe(100);
  });
});
