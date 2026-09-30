import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentPlan, ComposeRequest } from "@/server/agent/model/types";
import { onbekendeKeuzes } from "@/server/agent/tools";

/**
 * Een gevraagd begrip dat als keuzewaarde niet bestaat (bijv. een dienstsoort
 * die het platform niet kent) is een feit, geen storing. Adversarial-
 * verificatie 20260930: de tool faalde met "de invoer klopt niet", en het
 * antwoord was de wedervraag die vóór de opzoeking was geschreven. Eigen
 * voorbeelden; geen benchmarktekst.
 */

const schema = z.object({ kind: z.enum(["VROEG", "LAAT", "NACHT", "RANGEER", "RESERVE"]), lineNumber: z.number().int().optional() });
const fout = (invoer: unknown) => onbekendeKeuzes((schema.safeParse(invoer).error?.issues ?? []) as never, invoer);

describe("onbekendeKeuzes", () => {
  it("een onbestaand begrip wordt benoemd, met de bestaande waarden erbij", () => {
    const [zin] = fout({ kind: "WISSELDIENST" });
    expect(zin).toBe('"WISSELDIENST" is geen dienstsoort in dit platform (veld kind); er is dus niets voor geteld of opgezocht. Wel bestaan: VROEG, LAAT, NACHT, RANGEER, RESERVE.');
  });
  it("tegenvoorbeelden: andere schrijfwijze, een lijst van bestaande waarden, of een typefout zijn geen onbestaand begrip", () => {
    expect(fout({ kind: "vroeg" })).toEqual([]);
    expect(fout({ kind: "VROEG,LAAT" })).toEqual([]);
    expect(fout({ kind: "LAAT", lineNumber: "regel 3" })).toEqual([]);
  });
});

describe("lokale compose met een onbekende waarde", () => {
  afterEach(() => vi.unstubAllGlobals());
  const verzoek = (p: AgentPlan, results: ComposeRequest["results"]): ComposeRequest =>
    ({
      text: "Hoeveel wisseldiensten staan er in dit rooster?",
      context: { locationCode: "DDR", source: "official", candidateId: null, rosterCode: "DDR-X", lineNumber: null, weekday: null, dutyCode: null, missing: [] },
      tools: [],
      history: [],
      capabilities: [],
      suspended: false,
      plan: p,
      results,
    }) as unknown as ComposeRequest;
  const config = { baseUrl: "http://model.test/v1", model: "qwen3:8b", timeoutMs: 1000, temperature: 0, maxTokens: 100 };
  const feit = '"WISSELDIENST" is geen dienstsoort in dit platform (veld kind); er is dus niets voor geteld of opgezocht. Wel bestaan: VROEG, LAAT, NACHT, RANGEER, RESERVE.';
  const plan = (p: Partial<AgentPlan>): AgentPlan => ({ intent: "ROOSTERVRAAG", toolCalls: [], reasoning: "", ...p });

  it("wedervraag zonder geslaagde tool: het feit komt vóór de vraag, zonder modelaanroep", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { localModel } = await import("@/server/agent/model/local");
    const a = await localModel(config).compose(verzoek(plan({ clarification: "Welk diensttype bedoel je?" }), [{ tool: "dutyKindCounts", ok: false, data: null, sources: [], error: feit, note: "onbekende waarde" }]));
    expect(a.text).toBe(`${feit} Welk diensttype bedoel je?`);
    expect(a.status).toBe("VERDUIDELIJKING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tegenvoorbeeld: een gewone ongeldige invoer verandert niets aan de wedervraag", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { localModel } = await import("@/server/agent/model/local");
    const a = await localModel(config).compose(
      verzoek(plan({ clarification: "Welke regel bedoel je?" }), [{ tool: "rosterLine", ok: false, data: null, sources: [], error: "De invoer voor rosterLine klopt niet: lineNumber", note: "ongeldige invoer" }]),
    );
    expect(a.text).toBe("Welke regel bedoel je?");
  });

  it("met het model: het feit gaat mee in de gegevens; een gewone mislukking blijft 'mislukt: null'", async () => {
    let verstuurd = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        verstuurd = init.body;
        return new Response(JSON.stringify({ choices: [{ message: { content: "Dat type bestaat hier niet." } }] }), { status: 200 });
      }),
    );
    const { localModel } = await import("@/server/agent/model/local");
    await localModel(config).compose(
      verzoek(plan({ toolCalls: [{ tool: "dutyKindCounts", input: {} }] }), [
        { tool: "dutyKindCounts", ok: false, data: null, sources: [], error: feit, note: "onbekende waarde" },
        { tool: "rosterLine", ok: false, data: null, sources: [], error: "De invoer voor rosterLine klopt niet: lineNumber", note: "ongeldige invoer" },
      ]),
    );
    expect(verstuurd).toContain("Tool dutyKindCounts (mislukt, onbekende waarde): \\\"WISSELDIENST\\\" is geen dienstsoort");
    expect(verstuurd).toContain("Tool rosterLine (mislukt): null");
    expect(verstuurd).not.toContain("klopt niet: lineNumber");
  });
});
