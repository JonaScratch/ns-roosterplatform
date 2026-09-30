import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPlan, ComposeRequest } from "@/server/agent/model/types";
import { metTrace, nieuweTrace } from "@/server/agent/trace";
import { notitiesApart } from "../../scripts/v106/diagnose-trace";

/**
 * Een diagnosevariant die niets verandert, mag nooit als experiment meetellen.
 * diagnose-20260930-m: de variant "notities-apart" zocht een anker dat in het
 * echte compose-verzoek niet voorkomt (lege regels worden eruit gefilterd) en
 * stuurde ongemerkt het originele verzoek. Deze toets bouwt het verzoek met de
 * echte compose en eist dat de variant het werkelijk verandert.
 */

describe("diagnosevariant notities-apart", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("verandert het echte compose-verzoek en zet de notitie als losse regel vóór de instructies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })));
    const { localModel } = await import("@/server/agent/model/local");
    const trace = nieuweTrace();
    const notitie = "Deze kennis geldt voor standplaats DDR.";
    const tools = [{ tool: "knowledgeSearch", ok: true, data: { items: [], note: notitie }, sources: ["leergeheugen DDR"] }];
    const plan: AgentPlan = { intent: "ROOSTERVRAAG", toolCalls: [{ tool: "knowledgeSearch", input: {} }], reasoning: "" };
    await metTrace(trace, () =>
      localModel({ baseUrl: "http://m/v1", model: "qwen3:8b", timeoutMs: 1000, temperature: 0, maxTokens: 10 }).compose({
        text: "Welke afspraken gelden hier?",
        context: { locationCode: "DDR", source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
        tools: [],
        history: [],
        capabilities: [],
        suspended: false,
        plan,
        results: tools,
      } as unknown as ComposeRequest),
    );
    const origineel = trace.modelAanroepen[0].verzoek;
    const variant = notitiesApart(origineel, { tools: tools.map((t) => ({ ...t, invoer: {}, ms: 0, note: null, fout: null, gesimuleerd: false, bronnen: t.sources })) });
    expect(variant).not.toBeNull();
    const voor = origineel.messages.at(-1)?.content ?? "";
    const na = variant?.messages.at(-1)?.content ?? "";
    expect(na).not.toBe(voor);
    expect(na).toContain(`Vastgesteld door de tools:\n- knowledgeSearch: ${notitie}\nGebruik uitsluitend`);
    expect(variant?.messages.slice(0, -1)).toEqual(origineel.messages.slice(0, -1));
  });

  it("zonder anker: geen variant (overgeslagen), nooit stil het origineel", () => {
    const verzoek = { model: "m", temperature: 0, max_tokens: 1, messages: [{ role: "user", content: "iets zonder de instructieregel" }] };
    expect(notitiesApart(verzoek, { tools: [{ tool: "knowledgeSearch", ok: true, data: { note: "n" }, invoer: {}, ms: 0, note: null, fout: null, gesimuleerd: false, bronnen: [] }] })).toBeNull();
  });
});
