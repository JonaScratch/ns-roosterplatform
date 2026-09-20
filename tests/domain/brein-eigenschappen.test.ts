import { describe, expect, it } from "vitest";
import { rhythmMetrics } from "@/domain/rhythm-metrics";
import { diensten, meet, rooster, vul } from "./ritme-fixture";

/**
 * Eigenschappen die het kwaliteitsmodel nooit mag schenden (werkopdracht §14),
 * en synthetische controles die níet uit de Dordrechtse roosters komen (§22).
 *
 * ## Waarom dit naast de gewone tests staat
 *
 * Het bijschaven zoekt naar wat hoger scoort. Elke plek waar het model een
 * slechter menselijk patroon hoger zet dan een beter, wordt gevonden: dat is in
 * deze ontwikkeling twee keer gebeurd (H04, H09). Een eigenschap hieronder is
 * daarom geen voorbeeld maar een belofte over een hele familie varianten: meer
 * herstel, minder heen-en-weer, geen extra losse nacht, samenhang boven
 * afwisseling. Alle varianten binnen een test hebben evenveel diensten van
 * acht uur, zodat alleen het ritme verschilt.
 *
 * De synthetische controles zijn geen ijkpunten: geen drempel is erop
 * afgesteld. Ze bewaken dat een ijking op de ene menselijke steekproef niet
 * ongemerkt iets anders scheef zet.
 */

const robuust = (regels: readonly string[], profiel = "MIX") => meet([rooster("MIX", profiel, regels)]).robust!;
const onderdeel = (regels: readonly string[], naam: "nights" | "flow" | "rest" | "hours" | "fairness", profiel = "MIX") =>
  meet([rooster("MIX", profiel, regels)]).components[naam].score!;

describe("eigenschap: meer herstel scoort nooit lager", () => {
  for (const volgende of ["L", "V"] as const) {
    it(`na drie nachten, gevolgd door ${volgende === "L" ? "laat" : "vroeg"}`, () => {
      // 0 tot 4 vrije dagen tussen de laatste nacht (zondag, regel 1) en de
      // volgende dienst (regel 2). Elke regel houdt zijn eigen diensten, dus
      // de uren per regel zijn in alle varianten gelijk: alleen het herstel
      // verschilt. (Een eerste opzet schoof de dienst van regel 1 naar regel 2
      // en mat daarmee de urenverdeling in plaats van het herstel.)
      const varianten = [1, 2, 3, 4, 5].map((k) => ["RRRRNNN", `${"R".repeat(k - 1)}${volgende}`.padEnd(7, "R")]);
      const nachten = varianten.map((v) => onderdeel(v, "nights"));
      const rust = varianten.map((v) => onderdeel(v, "rest"));
      const totaal = varianten.map((v) => robuust(v));
      for (let i = 1; i < varianten.length; i += 1) {
        expect(nachten[i]).toBeGreaterThanOrEqual(nachten[i - 1]);
        expect(rust[i]).toBeGreaterThanOrEqual(rust[i - 1]);
        expect(totaal[i]).toBeGreaterThanOrEqual(totaal[i - 1]);
      }
    });
  }

  it("zet eerst herstel, dan richting: vroeg na twee vrije dagen boven laat na één", () => {
    expect(onderdeel(vul("NNNRRV"), "nights")).toBeGreaterThan(onderdeel(vul("NNNRL"), "nights"));
    expect(robuust(vul("NNNRRV"))).toBeGreaterThan(robuust(vul("NNNRL")));
  });
});

describe("eigenschap: minder heen-en-weer scoort nooit lager", () => {
  it("met dezelfde twee vroege en twee late diensten", () => {
    // Van veel naar geen heen-en-weer: afwisselend, één wissel, wissel via rust.
    const volgorde = [["VLVLRRR"], ["VVLLRRR"], ["VVRLLRR"]];
    const regelmaat = volgorde.map((v) => onderdeel(v, "flow", "VROEG_LAAT"));
    const totaal = volgorde.map((v) => robuust(v, "VROEG_LAAT"));
    for (let i = 1; i < volgorde.length; i += 1) {
      expect(regelmaat[i]).toBeGreaterThanOrEqual(regelmaat[i - 1]);
      expect(totaal[i]).toBeGreaterThanOrEqual(totaal[i - 1]);
    }
    expect(rhythmMetrics([rooster("VL", "VROEG_LAAT", ["VLVLRRR"])], diensten()).oscillations).toBeGreaterThan(0);
  });
});

describe("eigenschap: een extra losse nacht scoort nooit beter", () => {
  it("dezelfde reeks, met één late dienst vervangen door een losse nacht", () => {
    const zonder = vul("NNNRRLLRRLRRRR");
    const met = vul("NNNRRLLRRNRRRR");
    expect(onderdeel(met, "nights")).toBeLessThan(onderdeel(zonder, "nights"));
    expect(robuust(met)).toBeLessThan(robuust(zonder));
  });

  it("een reeks van vijf opgeknipt in drie en twee, allebei met een goede uitgang", () => {
    // Twee reeksen betekent twee uitgangen; die mogen de knip niet goedmaken.
    const heel = vul("NNNNNRRLL");
    const geknipt = vul("NNNRRNNRRLL");
    expect(onderdeel(geknipt, "nights")).toBeLessThan(onderdeel(heel, "nights") - 5);
  });
});

describe("eigenschap: samenhang scoort nooit slechter dan afwisseling", () => {
  it("dezelfde vier vroege en vier late diensten, per blok of door elkaar", () => {
    const blokken = ["VVVVRRR", "LLLLRRR"];
    const doorElkaar = ["VLVLRRR", "LVLVRRR"];
    expect(onderdeel(blokken, "flow", "VROEG_LAAT")).toBeGreaterThan(onderdeel(doorElkaar, "flow", "VROEG_LAAT"));
    expect(robuust(blokken, "VROEG_LAAT")).toBeGreaterThan(robuust(doorElkaar, "VROEG_LAAT"));
  });
});

describe("synthetische controles (§22)", () => {
  it("een perfecte nachtreeks: vijf nachten, twee vrije dagen, laat", () => {
    const r = meet([rooster("MIX", "MIX", vul("NNNNNRRLL"))]);
    expect(r.components.nights.parts.blocks).toBe(100);
    expect(r.components.nights.parts.exit).toBe(100);
  });

  it("een losse nacht", () => {
    const r = meet([rooster("MIX", "MIX", vul("NRRRLLL"))]);
    expect(r.components.nights.parts.blocks).toBe(0);
    expect(r.components.nights.score!).toBeLessThan(40);
  });

  it("een samenhangend vroeg blok", () => {
    const r = meet([rooster("V", "VROEG", ["VVVVRRR"])]);
    expect(r.components.flow.parts.coherence).toBe(100);
    expect(r.components.flow.score!).toBeGreaterThanOrEqual(95);
  });

  it("een heen-en-weer blok", () => {
    const heen = meet([rooster("VL", "VROEG_LAAT", ["VLVLRRR"])]);
    const blok = meet([rooster("VL", "VROEG_LAAT", ["VVVVRRR"])]);
    expect(heen.components.flow.score!).toBeLessThan(blok.components.flow.score! - 15);
  });

  it("een grote klokverschuiving binnen hetzelfde etiket", () => {
    // Vroeg om 04:30, dan om 09:00: dezelfde naam, vier en een half uur verschil.
    const r = meet([rooster("V", "VROEG", ["ABABRRR"])]);
    expect(r.components.flow.parts.coherence).toBe(100);
    expect(r.components.flow.parts.startJitter).toBe(0);
  });

  it("een slechte overgang over de regelgrens telt als elke andere", () => {
    // Laat op zondag van regel 1, vroeg op maandag van regel 2 — en dezelfde
    // overgang midden in de week.
    const overGrens = meet([rooster("VL", "VROEG_LAAT", ["RRRRRRL", "PRRRRRR"])]);
    const inWeek = meet([rooster("VL", "VROEG_LAAT", ["RRRRRLP", "RRRRRRR"])]);
    expect(overGrens.metrics.transitions.heavy).toBe(1);
    expect(overGrens.metrics.transitions.heavy).toBe(inWeek.metrics.transitions.heavy);
    expect(overGrens.components.flow.parts.penalty).toBe(inWeek.components.flow.parts.penalty);
    expect(rhythmMetrics([rooster("VL", "VROEG_LAAT", ["RRRRRRL", "PRRRRRR"])], diensten()).boundaries.heavyAcross).toBe(1);
  });

  it("uitstekend herstel: drie vrije dagen na de nachten", () => {
    const ruim = meet([rooster("MIX", "MIX", vul("NNNRRRL"))]);
    const menselijk = meet([rooster("MIX", "MIX", vul("NNNRRL"))]);
    expect(ruim.components.nights.parts.exit).toBe(100);
    expect(ruim.components.rest.parts.recovery!).toBeGreaterThanOrEqual(menselijk.components.rest.parts.recovery!);
  });
});

describe("tegenvoorbeelden (§14)", () => {
  it("uren: een regel op precies 40 uur wint niet van een natuurlijke spreiding", () => {
    // Beide roosters komen gemiddeld op 40 uur; alleen de verdeling over de regels verschilt.
    const gelijk = meet([rooster("V", "VROEG", ["VVVVVRR", "VVVVVRR"])]);
    const gespreid = meet([rooster("V", "VROEG", ["VVVVRRR", "VVVVVVR"])]);
    expect(gespreid.components.hours.score).toBe(gelijk.components.hours.score);
  });

  it("rust: twaalf uur tussen laat en vroeg scoort lager dan een vrije dag ertussen", () => {
    const krap = meet([rooster("VL", "VROEG_LAAT", ["LPRRRRR"])]);
    const ruim = meet([rooster("VL", "VROEG_LAAT", ["LRPRRRR"])]);
    expect(krap.components.rest.score!).toBeLessThan(ruim.components.rest.score!);
  });

  it("etiketten: een laat die op de klok vroeg is, ontloopt de overgang niet", () => {
    // P (vroeg) en Q (laat) liggen een uur uit elkaar: alleen een ander etiket.
    // L → P ligt acht uur uit elkaar: een echte wissel, wat het etiket ook zegt.
    expect(meet([rooster("M", "MIX_50PLUS", ["PQRRRRR"])]).metrics.transitions.heavy).toBe(0);
    expect(meet([rooster("M", "MIX_50PLUS", ["LPRRRRR"])]).metrics.transitions.heavy).toBe(1);
  });
});
