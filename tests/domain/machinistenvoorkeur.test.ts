import { describe, expect, it } from "vitest";
import { weekendStartValue } from "@/domain/machinist-preference";
import { nightBlockWorth } from "@/domain/night-rhythm";
import { type EvaluationInput, evaluateQuality } from "@/domain/quality-evaluator";
import { QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "@/domain/roster-quality";

/**
 * De adversariële toetsen van de werkopdracht "machinist preference" (1–7 en 9;
 * 8 en 10 staan in operationele-eisen.test.ts), door de volledige evaluator met
 * model v3 — niet alleen de hulpfuncties, want de score is wat de zoekmachine volgt.
 *
 * Alle diensten duren acht uur, zodat uren en rust tussen de varianten gelijk
 * blijven en alleen de verdeling verschilt.
 */

const u = (uur: number, minuut = 0) => uur * 60 + minuut;

const SOORTEN: Record<string, { start: number; eind: number; kinds: string[] }> = {
  // Extreem vroeg (vóór 05:30) en gematigd vroeg.
  X: { start: u(4, 30), eind: u(12, 30), kinds: ["VROEG"] },
  E: { start: u(5, 45), eind: u(13, 45), kinds: ["VROEG"] },
  // Late diensten: afloper (na middernacht), gewone late, vroege late (vóór 21:00).
  F: { start: u(17), eind: u(25), kinds: ["LAAT"] },
  K: { start: u(15), eind: u(23), kinds: ["LAAT"] },
  G: { start: u(12), eind: u(20), kinds: ["LAAT"] },
  // Rangeer: vroeg, zelfde tijden als E.
  S: { start: u(5, 45), eind: u(13, 45), kinds: ["VROEG", "RANGEER"] },
};

function diensten(): Map<string, QualityDuty> {
  const kaart = new Map<string, QualityDuty>();
  for (const [letter, s] of Object.entries(SOORTEN)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      for (let i = 0; i < 12; i += 1) {
        const code = `${letter}${weekday}${i}`;
        kaart.set(dutyKey(code, weekday), { code, weekday, startMinute: s.start, endMinute: s.eind, kinds: s.kinds });
      }
    }
  }
  return kaart;
}

/** Elke letter wordt een eigen dienstinstantie (letter + weekdag + volgnummer). */
function pakket(roosters: readonly { code: string; profile: string; regels: readonly string[] }[]): QualityRosterInput[] {
  const teller = new Map<string, number>();
  return roosters.map((r) => ({
    code: r.code,
    name: r.code,
    profile: r.profile,
    weeksPerLine: 1,
    days: r.regels.flatMap((regel, index) =>
      [...regel].map((teken, dag) => {
        const isDienst = teken in SOORTEN;
        const sleutel = `${teken}${dag + 1}`;
        const n = teller.get(sleutel) ?? 0;
        if (isDienst) teller.set(sleutel, n + 1);
        return {
          lineNumber: index + 1,
          weekIndex: 1,
          weekday: dag + 1,
          positionType: isDienst ? "DUTY" : "RUST",
          dutyCode: isDienst ? `${sleutel}${n}` : null,
        };
      }),
    ),
  }));
}

function v3(rosters: readonly QualityRosterInput[]) {
  const input: EvaluationInput = {
    rosters,
    reference: rosters,
    duties: diensten(),
    requiredDutyKeys: rosters.flatMap((r) => r.days.filter((d) => d.dutyCode).map((d) => dutyKey(d.dutyCode!, d.weekday))),
    nightRosterCodes: [],
    rules: { minDailyRestMinutes: 720, nightRecoveryMinutes: 46 * 60, longDutyMinutes: 540 },
    model: QUALITY_MODEL_V3,
  };
  return evaluateQuality(input);
}

describe("test 1 — Vroeg krijgt relatief de extreem vroege diensten", () => {
  // Vijftien extreem vroege en vijftien gematigd vroege diensten over Vroeg,
  // Vroeg/Laat en Mix (twee regels elk). A: Vroeg de meeste, de anderen nog een
  // paar. B: gelijk verdeeld.
  const a = v3(
    pakket([
      { code: "V", profile: "VROEG", regels: ["XXXXXRR", "XXXXXRR"] },
      { code: "VL", profile: "VROEG_LAAT", regels: ["XEEEERR", "XXEEERR"] },
      { code: "MIX", profile: "MIX", regels: ["XEEEERR", "XEEEERR"] },
    ]),
  );
  const b = v3(
    pakket([
      { code: "V", profile: "VROEG", regels: ["XXXEERR", "XXEEERR"] },
      { code: "VL", profile: "VROEG_LAAT", regels: ["XXXEERR", "XXEEERR"] },
      { code: "MIX", profile: "MIX", regels: ["XXXEERR", "XXEEERR"] },
    ]),
  );

  it("A scoort op voorkeur beter dan B", () => {
    expect(a.components.preference.score!).toBeGreaterThan(b.components.preference.score!);
    expect(a.preference.parts.affinity!).toBeGreaterThan(b.preference.parts.affinity!);
  });

  it("maar A heeft geen monopolie: Vroeg/Laat en Mix houden extreem vroege diensten", () => {
    const x = a.preference.popular.perClass.EXTREME_EARLY;
    expect(x.perLine.VL).toBeGreaterThan(0);
    expect(x.perLine.MIX).toBeGreaterThan(0);
  });

  it("nog sterker concentreren scoort op eerlijkheid slechter dan A", () => {
    const monopolie = v3(
      pakket([
        { code: "V", profile: "VROEG", regels: ["XXXXXRR", "XXXXXRR"] },
        { code: "VL", profile: "VROEG_LAAT", regels: ["XXEEERR", "EEEEERR"] },
        { code: "MIX", profile: "MIX", regels: ["XEEEERR", "EEEEERR"] },
      ]),
    );
    expect(monopolie.preference.parts.popularFairness!).toBeLessThan(a.preference.parts.popularFairness!);
  });
});

describe("tests 2 en 3 — 1-1-1-1-1 tegen 1-5-7-4-8", () => {
  const affiniteit = (profiel: string, regel: string) =>
    v3(pakket([{ code: "R", profile: profiel, regels: [regel] }])).preference.perRoster.R.affinity!;

  it("voor Vroeg/Laat scoort het gevarieerde vroege blok hoger", () => {
    expect(affiniteit("VROEG_LAAT", "XEEEERR")).toBeGreaterThan(affiniteit("VROEG_LAAT", "XXXXXRR"));
  });

  it("voor Vroeg is elke dag extreem vroeg juist aanzienlijk aantrekkelijker", () => {
    const verschilVroeg = affiniteit("VROEG", "XXXXXRR") - affiniteit("VROEG", "XEEEERR");
    const verschilVL = affiniteit("VROEG_LAAT", "XXXXXRR") - affiniteit("VROEG_LAAT", "XEEEERR");
    expect(verschilVroeg).toBeGreaterThan(0.2);
    expect(verschilVL).toBeLessThan(0);
  });
});

describe("test 4 — Laat met echte aflopers tegen vroege late diensten", () => {
  it("aflopers geven Laat een hogere affiniteit, bij dezelfde uren", () => {
    const a = v3(pakket([{ code: "L", profile: "LAAT", regels: ["FFFFFRR", "KFFFFRR"] }]));
    const b = v3(pakket([{ code: "L", profile: "LAAT", regels: ["GGGGGRR", "KGGGGRR"] }]));
    expect(a.preference.perRoster.L.affinity!).toBeGreaterThan(b.preference.perRoster.L.affinity!);
    expect(a.components.hours.score).toBe(b.components.hours.score);
    // B maakt van Laat een restbak.
    expect(b.preference.parts.restDuties!).toBeLessThan(a.preference.parts.restDuties!);
  });
});

describe("test 5 — alle aflopers naar Laat", () => {
  const alles = v3(
    pakket([
      { code: "L", profile: "LAAT", regels: ["FFFFFRR", "FFFFFRR"] },
      { code: "VL", profile: "VROEG_LAAT", regels: ["KKKKKRR", "KKKKKRR"] },
      { code: "LN", profile: "LAAT_NACHT", regels: ["KKKKKRR", "KKKKKRR"] },
    ]),
  );
  const verdeeld = v3(
    pakket([
      // Dezelfde tien aflopers: Laat zes, Vroeg/Laat en Laat/Nacht elk twee.
      { code: "L", profile: "LAAT", regels: ["FFFFKRR", "FFKKKRR"] },
      { code: "VL", profile: "VROEG_LAAT", regels: ["FKKKKRR", "FKKKKRR"] },
      { code: "LN", profile: "LAAT_NACHT", regels: ["FKKKKRR", "FKKKKRR"] },
    ]),
  );

  it("geeft Laat de hoogste affiniteit", () => {
    expect(alles.preference.perRoster.L.affinity!).toBeGreaterThan(verdeeld.preference.perRoster.L.affinity!);
  });

  it("maar de eerlijkheid van populaire diensten daalt duidelijk", () => {
    expect(alles.preference.parts.popularFairness!).toBeLessThan(verdeeld.preference.parts.popularFairness! - 0.4);
  });

  it("en de voorkeur als geheel is niet beter", () => {
    expect(alles.components.preference.score!).toBeLessThanOrEqual(verdeeld.components.preference.score!);
  });
});

describe("test 6 — rangeer is populair, dus eerlijk verdelen", () => {
  it("alles in één rooster verlaagt de eerlijkheid; spreiden is beter", () => {
    const geconcentreerd = v3(
      pakket([
        { code: "A", profile: "VROEG", regels: ["SSSSSRR", "SSSSSRR"] },
        { code: "B", profile: "VROEG", regels: ["EEEEERR", "EEEEERR"] },
        { code: "C", profile: "VROEG", regels: ["EEEEERR", "EEEEERR"] },
      ]),
    );
    const gespreid = v3(
      pakket([
        // Dezelfde tien rangeerdiensten, 3–4–3.
        { code: "A", profile: "VROEG", regels: ["SSEEERR", "SEEEERR"] },
        { code: "B", profile: "VROEG", regels: ["SSEEERR", "SSEEERR"] },
        { code: "C", profile: "VROEG", regels: ["SSEEERR", "SEEEERR"] },
      ]),
    );
    expect(geconcentreerd.components.fairness.parts.shunting!).toBeLessThan(gespreid.components.fairness.parts.shunting!);
    // Rangeer is geen strafdienst: de affiniteit is in beide gelijk.
    expect(geconcentreerd.preference.parts.affinity).toBe(gespreid.preference.parts.affinity);
  });
});

describe("test 7 — vrijdag vóór een vrij weekend: afnemende meeropbrengst", () => {
  const w = (uur: number, minuut = 0) => weekendStartValue({ endMinute: u(uur, minuut), night: false });

  it("17:00 tegen 23:00 is een groot verschil, maar 23:00 is niet extreem slecht", () => {
    expect(w(17) - w(23)).toBeGreaterThanOrEqual(0.25);
    expect(w(23)).toBeGreaterThanOrEqual(0.6);
  });

  it("21:45 tegen 22:00 is een klein verschil", () => {
    expect(w(21, 45) - w(22)).toBeGreaterThan(0);
    expect(w(21, 45) - w(22)).toBeLessThan(0.03);
  });

  it("vroeg klaar is nooit slechter dan later klaar (monotoon)", () => {
    for (let m = u(12); m < u(24); m += 15) {
      expect(weekendStartValue({ endMinute: m, night: false })).toBeGreaterThanOrEqual(weekendStartValue({ endMinute: m + 15, night: false }));
    }
  });

  it("zit in de voorkeursscore van het pakket", () => {
    const vroeg = v3(pakket([{ code: "R", profile: "VROEG", regels: ["EEEEERR"] }]));
    const laat = v3(pakket([{ code: "R", profile: "LAAT", regels: ["KKKKKRR"] }]));
    expect(vroeg.preference.parts.weekendStart!).toBeGreaterThan(laat.preference.parts.weekendStart!);
  });
});

describe("test 9 — nachtreeksen van 1 tot 7 in model v3", () => {
  const tabel = QUALITY_MODEL_V3.components.nights.parts.blocks.valueByLength;

  it("de modeltabel is ritme min belasting", () => {
    for (const l of [1, 2, 3, 4, 5, 6, 7]) expect(tabel[l]).toBeCloseTo(nightBlockWorth(l), 10);
  });

  it("drie nachten is 'net niet lekker': duidelijk onder vier en vijf", () => {
    expect(tabel[3]).toBeLessThan(tabel[4]);
    expect(tabel[4]).toBeLessThan(tabel[5]);
  });

  it("zes en zeven domineren niet: zeven is minder waard dan vijf, zes niet meer dan vijf", () => {
    expect(tabel[7]).toBeLessThan(tabel[5]);
    expect(tabel[6]).toBeLessThanOrEqual(tabel[5]);
  });
});
