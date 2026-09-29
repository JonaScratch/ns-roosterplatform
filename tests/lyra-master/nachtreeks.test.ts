import { describe, expect, it } from "vitest";
import { flowDays, nightBlocksFlow } from "@/domain/roster-flow";
import { dutyKey, type QualityDay, type QualityDuty, type QualityRosterInput } from "@/domain/roster-quality";
import type { EvaluationContext } from "@/server/services/quality-evaluation-service";
import { langsteReeksUitTekst } from "../../scripts/v106/nachtreeks-getal";
import { nachtreeksLengtePerRooster } from "../../scripts/v106/waarheid";

/**
 * Categorie O na AFTER-run 20260929-234655.
 *
 * 1. Grondwaarheid: een nachtreeks loopt over de regelgrens heen (zondag van
 *    regel N → maandag van regel N+1), zoals het contract van de functie en
 *    `roster-flow.ts` zeggen. De eerste versie telde per regel.
 * 2. Grader: een regel- of weekdagnummer is geen reekslengte.
 *
 * Alle roosters en zinnen hieronder zijn synthetisch.
 */

const NACHT: QualityDuty = { code: "901", weekday: 0, startMinute: 22 * 60, endMinute: 30 * 60, kinds: ["NACHT"] };
const VROEG: QualityDuty = { code: "101", weekday: 0, startMinute: 6 * 60, endMinute: 14 * 60, kinds: ["VROEG"] };

/** `patroon` per regel: 7 tekens, N = nacht, V = vroeg, R = rust. */
function rooster(code: string, patroon: readonly string[]): { roster: QualityRosterInput; duties: Map<string, QualityDuty> } {
  const days: QualityDay[] = [];
  const duties = new Map<string, QualityDuty>();
  patroon.forEach((week, r) => {
    [...week].forEach((c, d) => {
      const weekday = d + 1;
      const duty = c === "N" ? NACHT : c === "V" ? VROEG : null;
      if (duty) duties.set(dutyKey(duty.code, weekday), { ...duty, weekday });
      days.push({ lineNumber: r + 1, weekIndex: r + 1, weekday, positionType: duty ? "DUTY" : "RUST", dutyCode: duty?.code ?? null });
    });
  });
  return { roster: { code, name: code, profile: "X", weeksPerLine: 1, days }, duties };
}

function ctx(...roosters: ReturnType<typeof rooster>[]): EvaluationContext {
  const duties = new Map<string, QualityDuty>();
  for (const r of roosters) for (const [k, v] of r.duties) duties.set(k, v);
  return { quality: { official: roosters.map((r) => r.roster), duties } } as unknown as EvaluationContext;
}

describe("grondwaarheid nachtreeksLengtePerRooster — cyclisch over regels", () => {
  it("een reeks van vrijdag (regel 2) t/m woensdag (regel 3) is één reeks van 6, niet twee van 3", () => {
    const r = rooster("T-A", ["VVVRRRR", "RRRRNNN", "NNNRRRR", "RRVVVRR"]);
    const reeksen = nachtreeksLengtePerRooster(ctx(r));
    expect(reeksen.map((x) => x.lengte)).toEqual([6]);
    expect(reeksen[0].line).toBe(2);
  });

  it("de laatste regel loopt door naar de eerste", () => {
    const r = rooster("T-B", ["NNRRRRR", "RRVVRRR", "RRRRRNN"]);
    expect(nachtreeksLengtePerRooster(ctx(r)).map((x) => x.lengte)).toEqual([4]);
  });

  it("een reeks binnen één regel blijft gewoon die lengte; geen nachten = geen reeks", () => {
    expect(nachtreeksLengtePerRooster(ctx(rooster("T-C", ["RNNNRRR", "VVRRRRR"]))).map((x) => x.lengte)).toEqual([3]);
    expect(nachtreeksLengtePerRooster(ctx(rooster("T-D", ["VVRRRRR", "RRVVVRR"])))).toEqual([]);
  });

  it("zegt precies hetzelfde als de domeinmodule roster-flow (de meetlat van het platform)", () => {
    for (const patroon of [
      ["RRRRNNN", "NNNRRRR"],
      ["NNRRRRR", "RRVVRRR", "RRRRRNN"],
      ["RNNNRRR", "RRRNNRR", "VVRRRRR"],
      ["RRRRRRN", "NRRRRRN", "NRRRRRR"],
    ]) {
      const r = rooster("T-E", patroon);
      const waarheid = nachtreeksLengtePerRooster(ctx(r)).map((x) => x.lengte).sort();
      const domein = nightBlocksFlow(flowDays(r.roster, r.duties)).map((b) => b.length).sort();
      expect(waarheid.length, patroon.join("|")).toBeGreaterThan(0);
      expect(waarheid, patroon.join("|")).toEqual(domein);
    }
  });
});

describe("grader: welke reekslengte noemt het antwoord", () => {
  it("een regelnummer is geen lengte", () => {
    expect(langsteReeksUitTekst("De langste reeks nachtdiensten in dit rooster is 5 diensten, op regel 8 (maandag). Die reeks op regel 8 dekt 5 dagen.")).toBe(5);
    expect(langsteReeksUitTekst("De langste aaneengesloten reeks is 6 nachten, van vrijdag (weekdag 5) in regel 2 tot woensdag in regel 3.")).toBe(6);
  });

  it("tegenvoorbeeld: een fout antwoord blijft fout, ook als het juiste getal als regelnummer voorkomt", () => {
    expect(langsteReeksUitTekst("De langste reeks telt 8 nachten, op regel 5.")).toBe(8);
    expect(langsteReeksUitTekst("Op regels 3 en 5 staan reeksen; de langste reeks is 4 nachten.")).toBe(4);
  });

  it("getallen als woord, meerdere reeksen zonder 'langste' → de grootste genoemde", () => {
    expect(langsteReeksUitTekst("Regel 4 heeft een reeks van drie nachten.")).toBe(3);
    expect(langsteReeksUitTekst("Er is een blok van 2 nachtdiensten en een blok van 5 nachtdiensten.")).toBe(5);
  });

  it("geen lengte genoemd → null (niet: een regelnummer of een tijd)", () => {
    expect(langsteReeksUitTekst("Op regel 12 staat een nachtdienst die om 22:30 begint.")).toBeNull();
    expect(langsteReeksUitTekst("Er zijn geen nachtdiensten in dit rooster.")).toBeNull();
  });
});
