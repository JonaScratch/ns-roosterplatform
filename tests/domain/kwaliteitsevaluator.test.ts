import { describe, expect, it } from "vitest";
import { type EvaluationInput, evaluateQuality } from "@/domain/quality-evaluator";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "@/domain/roster-quality";
import { QUALITY_MODEL_V1 } from "@/domain/quality-model";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * De RosterQualityEvaluator op synthetische roosters: goed tegenover slecht.
 *
 * Elk paar verschilt op één ding. Een model dat het slechte voorbeeld niet
 * lager zet, meet niet wat het zegt te meten — en dan is elke
 * benchmarkuitkomst daarna betekenisloos.
 *
 * Een rooster wordt geschreven als tekst per regel: V/L/N een dienst, R rust,
 * W een WTV-dag, S reserve. Elke letter is per weekdag een eigen dienst.
 */

interface DienstSoort {
  readonly start: number;
  readonly eind: number;
  readonly kinds: readonly string[];
}

const STANDAARD: Record<string, DienstSoort> = {
  V: { start: 6 * 60, eind: 14 * 60, kinds: ["VROEG"] },
  L: { start: 14 * 60, eind: 22 * 60, kinds: ["LAAT"] },
  N: { start: 22 * 60, eind: 30 * 60, kinds: ["NACHT"] },
  // Een late dienst tot 22:00 met een vroege dienst om 10:00 erna: precies 12 uur rust.
  M: { start: 10 * 60, eind: 18 * 60, kinds: ["VROEG"] },
  // Rangeerwerk in de vroege dienst.
  X: { start: 6 * 60, eind: 14 * 60, kinds: ["VROEG", "RANGEER"] },
};

function dienstenkaart(soorten: Record<string, DienstSoort> = STANDAARD): Map<string, QualityDuty> {
  const kaart = new Map<string, QualityDuty>();
  for (const [letter, soort] of Object.entries(soorten)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const code = `${letter}${weekday}`;
      kaart.set(dutyKey(code, weekday), { code, weekday, startMinute: soort.start, endMinute: soort.eind, kinds: soort.kinds });
    }
  }
  return kaart;
}

function rooster(code: string, profile: string, regels: readonly string[], prefix = ""): QualityRosterInput {
  return {
    code,
    name: code,
    profile,
    weeksPerLine: 1,
    days: regels.flatMap((regel, index) =>
      [...regel].map((teken, dag) => {
        const dienst = /[A-Z]/.test(teken) && !["R", "W", "S"].includes(teken);
        return {
          lineNumber: index + 1,
          weekIndex: 1,
          weekday: dag + 1,
          positionType: dienst ? "DUTY" : teken === "W" ? "WR" : teken === "S" ? "RES" : "RUST",
          dutyCode: dienst ? `${prefix}${teken}${dag + 1}` : null,
        };
      }),
    ),
  };
}

function invoer(rosters: readonly QualityRosterInput[], duties = dienstenkaart(), overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  const geplaatst = new Set<string>();
  for (const r of rosters) for (const d of r.days) if (d.dutyCode) geplaatst.add(dutyKey(d.dutyCode, d.weekday));
  return {
    rosters,
    reference: rosters,
    duties,
    requiredDutyKeys: [...geplaatst],
    nightRosterCodes: rosters.filter((r) => r.days.some((d) => d.dutyCode?.startsWith("N"))).map((r) => r.code),
    rules: { minDailyRestMinutes: 720, nightRecoveryMinutes: 46 * 60, longDutyMinutes: 540 },
    ...overrides,
  };
}

describe("regelmaat: een stabiele reeks tegenover heen-en-weer", () => {
  it("beoordeelt dezelfde diensten in reeksen beter dan wisselend", () => {
    const stabiel = evaluateQuality(invoer([rooster("VL", "VROEG_LAAT", ["VVVVVRR", "LLLLLRR"])]));
    const wisselend = evaluateQuality(invoer([rooster("VL", "VROEG_LAAT", ["VLVLVRR", "LVLVLRR"])]));
    expect(stabiel.components.flow.score!).toBeGreaterThan(wisselend.components.flow.score! + 30);
    expect(stabiel.overall!).toBeGreaterThan(wisselend.overall!);
    expect(wisselend.metrics.transitions.lateToEarly).toBeGreaterThan(0);
    // Laat gevolgd door vroeg is een zware overgang; die telling stuurt zowel de
    // diagnose als de kwaliteitspoort, dus hij wordt hier apart vastgelegd.
    expect(wisselend.metrics.transitions.heavy).toBeGreaterThan(0);
    expect(stabiel.metrics.transitions.heavy).toBe(0);
  });
});

describe("uren: gelijk gemiddelde, andere spreiding", () => {
  it("beoordeelt alle roosters binnen 5 minuten beter dan ±60 minuten", () => {
    const kort: DienstSoort = { start: 6 * 60, eind: 14 * 60 - 12, kinds: ["VROEG"] };
    const lang: DienstSoort = { start: 6 * 60, eind: 14 * 60 + 12, kinds: ["VROEG"] };
    const precies: DienstSoort = { start: 6 * 60, eind: 14 * 60 + 1, kinds: ["VROEG"] };
    const kaart = dienstenkaart({ K: kort, G: lang, P: precies });
    const binnen5 = evaluateQuality(invoer([rooster("A", "VROEG", ["PPPPPRR"]), rooster("B", "VROEG", ["PPPPPRR"], "")], kaart));
    const spreiding = evaluateQuality(invoer([rooster("A", "VROEG", ["GGGGGRR"]), rooster("B", "VROEG", ["KKKKKRR"])], kaart));
    expect(binnen5.metrics.hours.rosterStats.max).toBeLessThanOrEqual(5);
    expect(spreiding.metrics.hours.rosterStats.max).toBeGreaterThanOrEqual(60);
    // Het gemiddelde van de afwijkingen met teken is in beide gevallen ongeveer nul.
    const metTeken = spreiding.metrics.hours.rosters.reduce((som, r) => som + r.deviationMinutes, 0);
    expect(Math.abs(metTeken)).toBeLessThanOrEqual(1);
    expect(binnen5.components.hours.score!).toBeGreaterThan(spreiding.components.hours.score! + 30);
  });

  it("straft te weinig uren even hard als te veel", () => {
    // Beide roosters wijken evenveel van 40:00 af, het ene naar boven en het
    // andere naar beneden. Wie de afwijking met teken meet, geeft het te korte
    // rooster gratis punten — en dan kan een machine het gemiddelde oppoetsen
    // door één rooster structureel te kort te maken.
    const lang: DienstSoort = { start: 6 * 60, eind: 14 * 60 + 12, kinds: ["VROEG"] };
    const kort: DienstSoort = { start: 6 * 60, eind: 14 * 60 - 12, kinds: ["VROEG"] };
    const kaart = dienstenkaart({ G: lang, K: kort });
    const teVeel = evaluateQuality(invoer([rooster("A", "VROEG", ["GGGGGRR"])], kaart));
    const teWeinig = evaluateQuality(invoer([rooster("A", "VROEG", ["KKKKKRR"])], kaart));
    expect(teVeel.metrics.hours.rosters[0].deviationMinutes).toBe(-teWeinig.metrics.hours.rosters[0].deviationMinutes);
    expect(teVeel.components.hours.score).toBe(teWeinig.components.hours.score);
  });
});

describe("nachten: reeksen tegenover losse nachten (model v1)", () => {
  // Deze twee tests leggen de exacte waarden van model v1 vast. Kandidaten die met
  // v1 zijn beoordeeld, moeten met v1 na te rekenen blijven.
  it("beoordeelt 3+3 duidelijk beter dan zes losse nachten", () => {
    const reeksen = evaluateQuality(invoer([rooster("LN", "LAAT_NACHT", ["NNNRRRR", "NNNRRRR"])], undefined, { model: QUALITY_MODEL_V1 }));
    const los = evaluateQuality(invoer([rooster("LN", "LAAT_NACHT", ["NRNRNRR", "NRNRNRR"])], undefined, { model: QUALITY_MODEL_V1 }));
    expect(reeksen.metrics.nights.total).toBe(los.metrics.nights.total);
    expect(reeksen.components.nights.score).toBe(100);
    expect(los.components.nights.score).toBe(0);
    expect(los.metrics.nights.singletons).toBe(6);
    expect(reeksen.overall!).toBeGreaterThan(los.overall! + 10);
  });

  it("geeft een reeks van twee half zoveel waarde als een reeks van drie", () => {
    const paren = evaluateQuality(invoer([rooster("LN", "LAAT_NACHT", ["NNRRNNR", "RRRRRRR"])], undefined, { model: QUALITY_MODEL_V1 }));
    expect(paren.components.nights.score).toBe(50);
  });
});

describe("rust: net boven het minimum tegenover ruim", () => {
  it("ziet het verschil tussen twee kandidaten die allebei aan de regel voldoen", () => {
    const ruim = evaluateQuality(invoer([rooster("A", "VROEG_LAAT", ["LLLLLRR"])]));
    const krap = evaluateQuality(invoer([rooster("A", "VROEG_LAAT", ["LMLMLRR"])]));
    expect(krap.metrics.rest.shortestSurplusMinutes).toBe(0);
    expect(ruim.components.rest.parts.surplus!).toBeGreaterThan(krap.components.rest.parts.surplus! + 20);
  });
});

describe("eerlijkheid: gelijk verdeeld tegenover geconcentreerd", () => {
  it("geeft dezelfde totale rangeerbelasting verdeeld de voorkeur", () => {
    const verdeeld = evaluateQuality(invoer([rooster("A", "VROEG", ["XVVVVRR"]), rooster("B", "VROEG", ["XVVVVRR"])]));
    const geconcentreerd = evaluateQuality(invoer([rooster("A", "VROEG", ["XXVVVRR"]), rooster("B", "VROEG", ["VVVVVRR"])]));
    expect(verdeeld.components.fairness.parts.shunting).toBe(100);
    expect(geconcentreerd.components.fairness.parts.shunting!).toBeLessThan(10);
  });
});

describe("de slechtste regel", () => {
  it("wijst de regel met het heen-en-weer aan en drukt de robuuste score", () => {
    const alleGoed = evaluateQuality(invoer([rooster("VL", "VROEG_LAAT", ["VVVVVRR", "LLLLLRR", "VVVVVRR", "LLLLLRR"])]));
    const eenSlecht = evaluateQuality(invoer([rooster("VL", "VROEG_LAAT", ["VVVVVRR", "LLLLLRR", "VVVVVRR", "LVLVLRR"])]));
    expect(eenSlecht.lines.worst?.lineNumber).toBe(4);
    expect(eenSlecht.robust!).toBeLessThan(alleGoed.robust!);
    expect(eenSlecht.robust! - eenSlecht.overall!).toBeLessThan(alleGoed.robust! - alleGoed.overall!);
  });

  it("geeft een regel zonder gewerkte dienst geen score: die ligt vast in de structuur", () => {
    const rapport = evaluateQuality(invoer([rooster("V", "VROEG", ["VVVVVRR", "SSSSRRR"])]));
    expect(rapport.lines.all.find((l) => l.lineNumber === 2)?.score).toBeNull();
    expect(rapport.lines.worst?.lineNumber).toBe(1);
  });
});

describe("harde geldigheid staat los van de score", () => {
  it("noemt een vroege dienst in Laat/Nacht geen minpunt maar ongeldig", () => {
    const rapport = evaluateQuality(invoer([rooster("LN", "LAAT_NACHT", ["LLLVLRR"])]));
    expect(rapport.hardValidity.hardValid).toBe(false);
    expect(rapport.hardValidity.profileBreaches).toHaveLength(1);
    expect(rapport.hardValidity.reasons.join(" ")).toContain("roosterprofiel");
  });

  it("noemt een niet-geplaatste of dubbele dienst ongeldig", () => {
    const kandidaat = rooster("V", "VROEG", ["VVVVRRR", "VRRRRRR"]);
    const vereist = [...new Set([1, 2, 3, 4, 5].map((dag) => dutyKey(`V${dag}`, dag)))];
    const rapport = evaluateQuality(invoer([kandidaat], dienstenkaart(), { requiredDutyKeys: vereist }));
    expect(rapport.hardValidity.coverage.unassigned).toBe(1);
    expect(rapport.hardValidity.coverage.duplicates).toBe(1);
    expect(rapport.hardValidity.hardValid).toBe(false);
  });

  it("zoekt een dienst op nummer én weekdag, nooit op nummer alleen", () => {
    const kaart = new Map<string, QualityDuty>([
      [dutyKey("701", 1), { code: "701", weekday: 1, startMinute: 300, endMinute: 780, kinds: ["VROEG"] }],
      [dutyKey("701", 2), { code: "701", weekday: 2, startMinute: 900, endMinute: 1380, kinds: ["LAAT"] }],
    ]);
    const kandidaat: QualityRosterInput = {
      code: "LN",
      name: "LN",
      profile: "LAAT_NACHT",
      weeksPerLine: 1,
      days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        lineNumber: 1,
        weekIndex: 1,
        weekday,
        positionType: weekday === 2 ? "DUTY" : "RUST",
        dutyCode: weekday === 2 ? "701" : null,
      })),
    };
    // 701 op dinsdag is een late dienst: toegestaan in Laat/Nacht.
    const rapport = evaluateQuality({ ...invoer([kandidaat], kaart), requiredDutyKeys: [dutyKey("701", 2)] });
    expect(rapport.hardValidity.profileBreaches).toHaveLength(0);
    expect(rapport.metrics.hours.lines[0].dutyMinutes).toBe(480);
  });
});

describe("het model zelf", () => {
  it("heeft gewichten die per laag optellen tot 1", () => {
    const som = (waarden: readonly number[]) => Math.round(waarden.reduce((a, b) => a + b, 0) * 1000) / 1000;
    const componenten = Object.values(QUALITY_MODEL_V1.components);
    expect(som(componenten.map((c) => c.weight))).toBe(1);
    for (const component of componenten) {
      expect(som(Object.values(component.parts).map((p) => p.weight))).toBe(1);
    }
    expect(som(Object.values(QUALITY_MODEL_V1.lineScore.weights))).toBe(1);
  });

  it("staat ongewijzigd in configs/quality-model-v1.json", () => {
    const bestand = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "configs", "quality-model-v1.json"), "utf8"));
    expect(bestand).toEqual(JSON.parse(JSON.stringify(QUALITY_MODEL_V1)));
  });
});
