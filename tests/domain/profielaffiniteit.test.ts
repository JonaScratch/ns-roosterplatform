import { afterAll, describe, expect, it } from "vitest";
import { dutyClass } from "@/domain/duty-class";
import { NIGHT_LOAD, NIGHT_RHYTHM, nightBlockWorth, nightLoad, nightRhythm } from "@/domain/night-rhythm";
import { affinityMetrics, dutyAffinity } from "@/domain/profile-affinity";
import { SOORTEN, diensten, rooster } from "./ritme-fixture";

/**
 * Profielaffiniteit en de twee nachtassen (werkopdracht "machinist
 * preference" §36–39), op synthetische roosters.
 *
 * Extra diensttypen voor deze tests:
 * X extreem vroeg 04:30–11:00 · E gematigd vroeg 06:00–14:00 ·
 * F afloper 17:00–01:00 · G vroege late 11:00–19:30.
 */

// Op moduleniveau, niet in beforeAll: de roosters hieronder worden al bij het
// inlezen van de describe-blokken opgebouwd.
SOORTEN.X = { start: 4 * 60 + 30, eind: 11 * 60, kinds: ["VROEG"] };
SOORTEN.E = { start: 6 * 60, eind: 14 * 60, kinds: ["VROEG"] };
SOORTEN.F = { start: 17 * 60, eind: 25 * 60, kinds: ["LAAT"] };
SOORTEN.G = { start: 11 * 60, eind: 19 * 60 + 30, kinds: ["LAAT"] };
afterAll(() => {
  for (const k of ["X", "E", "F", "G"]) delete SOORTEN[k];
});

describe("dienstklassen op de klok", () => {
  it("deelt in op begin- en eindtijd, niet op het nummer", () => {
    expect(dutyClass({ startMinute: 4 * 60 + 27, endMinute: 11 * 60, kinds: ["VROEG"] })).toBe("EXTREME_EARLY");
    expect(dutyClass({ startMinute: 5 * 60 + 38, endMinute: 11 * 60 + 41, kinds: ["VROEG"] })).toBe("EARLY");
    expect(dutyClass({ startMinute: 16 * 60 + 39, endMinute: 25 * 60 + 24, kinds: ["LAAT"] })).toBe("PREMIUM_LATE");
    // Dienst 115 op donderdag (09:47–18:11) en op dinsdag (17:19–01:09): hetzelfde nummer, twee klassen.
    expect(dutyClass({ startMinute: 9 * 60 + 47, endMinute: 18 * 60 + 11, kinds: ["LAAT"] })).toBe("EARLY_LATE");
    expect(dutyClass({ startMinute: 17 * 60 + 19, endMinute: 25 * 60 + 9, kinds: ["LAAT"] })).toBe("PREMIUM_LATE");
  });
});

describe("tegenvoorbeeld 1 (§36): extreem vroeg naar Vroeg, of eerlijk verdeeld", () => {
  // Twee roosters die allebei vroeg mogen, met samen dezelfde diensten.
  const alles = [rooster("V", "VROEG", ["XXXXRRR", "XXXXRRR"]), rooster("VL", "VROEG_LAAT", ["EEEERRR", "EEEERRR"])];
  const verdeeld = [rooster("V", "VROEG", ["XXXXRRR", "EEEERRR"]), rooster("VL", "VROEG_LAAT", ["XXXXRRR", "EEEERRR"])];

  it("vindt alles naar Vroeg qua voorkeur beter", () => {
    expect(affinityMetrics(alles, diensten()).mean!).toBeGreaterThan(affinityMetrics(verdeeld, diensten()).mean!);
  });

  it("ziet dat de blootstelling dan scheef wordt: Vroeg/Laat houdt niets over", () => {
    const a = affinityMetrics(alles, diensten());
    const b = affinityMetrics(verdeeld, diensten());
    expect(a.perRoster.VL.nightWindowMinutesPerWeek).toBe(0);
    expect(a.exposureSpread!).toBeGreaterThan(b.exposureSpread!);
  });
});

describe("tegenvoorbeeld 2 (§37): Laat met aflopers of met vroege late diensten", () => {
  it("geeft Laat met echte aflopers een hogere affiniteit", () => {
    const aflopers = affinityMetrics([rooster("L", "LAAT", ["FFFFRRR", "FFFFRRR"])], diensten());
    const vroegeLate = affinityMetrics([rooster("L", "LAAT", ["GGGGRRR", "GGGGRRR"])], diensten());
    expect(aflopers.mean!).toBeGreaterThan(vroegeLate.mean!);
  });

  // De eerste versie van deze toets zei "voor Vroeg/Laat is het andersom": een
  // vroege late zou daar méér waard zijn dan een afloper. Dat staat niet in de
  // invoer. Die zegt dat een vroege late *relatief* beter past bij Vroeg/Laat
  // en gemengde profielen dan bij Laat, en geeft gewichten (Laat 10, Vroeg/Laat
  // 20). Getoetst wordt dus de vergelijking tussen profielen, niet binnen één.
  it("een vroege late past relatief beter bij Vroeg/Laat en Mix dan bij Laat, een afloper andersom", () => {
    const f = { startMinute: 17 * 60, endMinute: 25 * 60, kinds: ["LAAT"] };
    const g = { startMinute: 11 * 60, endMinute: 19 * 60 + 30, kinds: ["LAAT"] };
    expect(dutyAffinity("VROEG_LAAT", g).value).toBeGreaterThan(dutyAffinity("LAAT", g).value);
    expect(dutyAffinity("MIX", g).value).toBeGreaterThan(dutyAffinity("LAAT", g).value);
    expect(dutyAffinity("MIX_50PLUS", g).value).toBeGreaterThan(dutyAffinity("VROEG_LAAT", g).value);
    expect(dutyAffinity("LAAT", f).value).toBeGreaterThan(dutyAffinity("VROEG_LAAT", f).value);
    expect(dutyAffinity("LAAT", f).value).toBeGreaterThan(dutyAffinity("LAAT", g).value);
  });
});

describe("tegenvoorbeeld 3 (§38): nachtreeksen van 1 tot 7", () => {
  const lengtes = [1, 2, 3, 4, 5, 6, 7];

  it("laat het ritme stijgen maar niet lineair: de winst per extra nacht neemt af", () => {
    const r = lengtes.map(nightRhythm);
    for (let i = 1; i < r.length; i += 1) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
    // Van 2 naar 3 wint meer dan van 5 naar 6.
    expect(r[2] - r[1]).toBeGreaterThan(r[5] - r[4]);
    expect(nightRhythm(6)).toBeGreaterThan(nightRhythm(3));
  });

  it("laat de totale belasting wél oplopen met de lengte", () => {
    const l = lengtes.map(nightLoad);
    for (let i = 1; i < l.length; i += 1) expect(l[i]).toBeGreaterThanOrEqual(l[i - 1]);
    expect(nightLoad(7)).toBeGreaterThan(nightLoad(6));
    expect(nightLoad(6)).toBeGreaterThan(nightLoad(5));
  });

  it("geeft zeven nachten geen voorkeur, ondanks het stabielste ritme", () => {
    const waarde = lengtes.map(nightBlockWorth);
    expect(Math.max(...waarde)).toBeGreaterThan(nightBlockWorth(7));
    expect(Object.keys(NIGHT_RHYTHM)).toEqual(Object.keys(NIGHT_LOAD));
  });
});

describe("geen totaalscore-exploit (§39)", () => {
  it("zeven plus vijf is niet beter dan zes plus zes, bij evenveel nachten", () => {
    const perNacht = (reeksen: number[]) => reeksen.reduce((s, l) => s + nightBlockWorth(l) * l, 0) / reeksen.reduce((s, l) => s + l, 0);
    expect(perNacht([7, 5])).toBeLessThan(perNacht([6, 6]));
    // En knippen om de belasting te ontlopen levert ook niets op: 3 + 3 is slechter dan 6.
    expect(perNacht([3, 3])).toBeLessThan(perNacht([6]));
  });
});
