import { describe, expect, it } from "vitest";
import { jsonUit } from "@/server/agent/model/local";

/**
 * Regressietoets voor `jsonUit()` (§ LYRA MASTER PROGRAM, fase 0-inventarisatie:
 * "JSON-parser voor dubbele modelobjecten — fix aanwezig, geen enkele
 * regressietest"). De functie zelf is puur (tekst → object), heeft geen
 * database of Ollama nodig — precies waarom dit gat zo makkelijk te dichten
 * was zodra het eenmaal was opgemerkt.
 *
 * Het historische scenario staat met zoveel woorden in de docstring van
 * `jsonUit()` zelf: qwen3 leverde het plan soms als twee JSON-objecten
 * achter elkaar (het intentie-object, en na een komma een object met alleen
 * `proposal`) — allebei op zichzelf geldig JSON, maar de oude lezing pakte
 * alles van de eerste `{` tot de laatste `}` en faalde daarop.
 */
describe("jsonUit() — dubbele JSON-objecten uit het lokale model", () => {
  it("leest één gewoon object gewoon", () => {
    expect(jsonUit('{"intent":"ANSWER","toolCalls":[]}')).toEqual({ intent: "ANSWER", toolCalls: [] });
  });

  it("pelt een ```json-codeblok eromheen weg", () => {
    expect(jsonUit('```json\n{"intent":"ANSWER"}\n```')).toEqual({ intent: "ANSWER" });
  });

  it("leest twee losse, geldige objecten achter elkaar (het historische qwen3-scenario) en voegt ze samen", () => {
    const tekst = '{"intent":"CALCULATE","toolCalls":[]}, {"proposal":{"expression":"40*7","result":280}}';
    expect(jsonUit(tekst)).toEqual({
      intent: "CALCULATE",
      toolCalls: [],
      proposal: { expression: "40*7", result: 280 },
    });
  });

  it("laat een al gevuld veld uit het eerste object niet overschrijven door het tweede", () => {
    const tekst = '{"intent":"ANSWER","reasoning":"eerste"}, {"reasoning":"tweede"}';
    expect(jsonUit(tekst)?.reasoning).toBe("eerste");
  });

  it("vult een leeg/ontbrekend veld uit het eerste object aan vanuit het tweede", () => {
    const tekst = '{"intent":"ANSWER","clarification":null}, {"clarification":"welke regel bedoel je?"}';
    expect(jsonUit(tekst)?.clarification).toBe("welke regel bedoel je?");
  });

  it("telt accolades binnen een string niet mee voor de diepte (bijv. een uitleg met een letterlijke { erin)", () => {
    const tekst = '{"intent":"ANSWER","reasoning":"een voorbeeld: { \\"x\\": 1 }"}, {"proposal":{"expression":"1+1","result":2}}';
    const resultaat = jsonUit(tekst);
    expect(resultaat?.reasoning).toBe('een voorbeeld: { "x": 1 }');
    expect(resultaat?.proposal).toEqual({ expression: "1+1", result: 2 });
  });

  it("slaat een onleesbaar stuk over en gebruikt de rest, in plaats van alles te verwerpen", () => {
    const tekst = '{"intent":"ANSWER"} {niet geldige json} {"reasoning":"toch nog iets bruikbaars"}';
    expect(jsonUit(tekst)).toEqual({ intent: "ANSWER", reasoning: "toch nog iets bruikbaars" });
  });

  it("geeft null terug als er helemaal geen leesbaar object in zit — nooit een verzonnen leeg plan", () => {
    expect(jsonUit("Dit is gewoon uitleg zonder enige JSON.")).toBeNull();
    expect(jsonUit("")).toBeNull();
  });
});
