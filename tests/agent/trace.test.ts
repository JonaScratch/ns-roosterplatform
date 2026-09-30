import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPlan, ComposeRequest, PlanRequest } from "@/server/agent/model/types";
import { bewaakPlan } from "@/server/agent/plan-guard";
import { actieveTrace, metTrace, nieuweTrace, ontdubbelSysteem, zetSysteemTerug } from "@/server/agent/trace";

/**
 * De beurttrace (trace.ts) legt vast wat het model kreeg en teruggaf, wat de
 * planbewaking per regel deed, en welke tak de compose nam — generiek, voor
 * elke meting. Buiten een trace wordt niets bewaard.
 */

const ALLE = new Set(["rosterLine", "nightStructure", "knowledgeSearch", "dutyKindCounts", "ruleSearch"]);
const plan = (p: Partial<AgentPlan>): AgentPlan => ({ intent: "ROOSTERVRAAG", toolCalls: [], reasoning: "", ...p });

describe("planbewaking: stappen per regel", () => {
  it("elke regel staat erin, in vaste volgorde, met reden en gewijzigde velden", () => {
    const { stappen, plan: uit } = bewaakPlan(
      plan({ intent: "FEEDBACK", memoryProposal: { statement: "x" }, proposal: { kind: "GENERATE" } }),
      "Welke afspraak geldt hier voor ruilen?",
      { rosterCode: null, lineNumber: null },
      ALLE,
    );
    expect(stappen.map((s) => s.regel)).toEqual(["VOORSTEL_ZONDER_REKENVERZOEK", "ONLEESBAAR_PLAN", "ONDERZOEK_VOOR_OORDEEL", "ONTBREKENDE_ONDERWERPTOOL"]);
    expect(stappen.map((s) => s.getriggerd)).toEqual([true, false, true, false]);
    expect(stappen[0].gewijzigd).toEqual(["intent", "proposal"]);
    expect(stappen[2].gewijzigd).toEqual(["toolCalls"]);
    expect(stappen[2].reden).toContain("alleen een geheugenvoorstel");
    expect(stappen[3].reden).toBe("geen onderwerptool bij deze vraag");
    // Snapshots: de stap vóór regel 3 kent nog geen tool, die erna wel.
    expect((stappen[2].voor as AgentPlan).toolCalls).toEqual([]);
    expect((stappen[2].na as AgentPlan).toolCalls).toEqual(uit.toolCalls);
  });

  it("een regel die niet triggert, zegt waarom niet", () => {
    const { stappen } = bewaakPlan(plan({ toolCalls: [{ tool: "rosterLine", input: {} }] }), "Wat staat er op regel 3?", { rosterCode: "DDR-X", lineNumber: 3 }, ALLE);
    expect(stappen.every((s) => !s.getriggerd && s.gewijzigd.length === 0)).toBe(true);
    expect(stappen[0].reden).toBe("geen rekenvoorstel in het plan");
    expect(stappen[2].reden).toBe("het plan haalt al iets op (rosterLine)");
  });

  it("zonder iets om op te zoeken noemt regel 3 de signalen die ontbraken", () => {
    const { stappen } = bewaakPlan(plan({ memoryProposal: { statement: "x" } }), "We willen voortaan liever korte diensten.", { rosterCode: null, lineNumber: null }, ALLE);
    expect(stappen[2].reden).toBe("niets om op te zoeken (onderwerp: geen, rooster: geen, kennisvraag: nee, knowledgeSearch toegestaan: ja)");
  });

  it("een onleesbaar plan stopt de bewaking, en dat staat er ook", () => {
    const { stappen } = bewaakPlan(plan({ onleesbaar: true, clarification: "?" }), "Hoe ziet regel 2 eruit?", { rosterCode: "DDR-X", lineNumber: 2 }, ALLE);
    expect(stappen.map((s) => [s.regel, s.getriggerd])).toEqual([
      ["VOORSTEL_ZONDER_REKENVERZOEK", false],
      ["ONLEESBAAR_PLAN", true],
      ["ONDERZOEK_VOOR_OORDEEL", false],
      ["ONTBREKENDE_ONDERWERPTOOL", false],
    ]);
    expect(stappen[2].reden).toContain("niet geëvalueerd");
  });
});

describe("modelaanroepen in de trace (lokaal model)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = { baseUrl: "http://model.test/v1", model: "qwen3:8b", timeoutMs: 1000, temperature: 0, maxTokens: 100 };
  const context = { locationCode: "DDR", source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] };
  const verzoek = { text: "Hoeveel late diensten?", context, tools: [], history: [], capabilities: [], suspended: false } as unknown as PlanRequest;
  const antwoord = (inhoud: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: inhoud } }] }), { status: 200 }));

  it("buiten een trace: niets vastgelegd", async () => {
    vi.stubGlobal("fetch", antwoord('{"intent":"ROOSTERVRAAG","toolCalls":[]}'));
    const { localModel } = await import("@/server/agent/model/local");
    await localModel(config).plan(verzoek);
    expect(actieveTrace()).toBeNull();
  });

  it("plan: het exacte verzoek, de ongeparste uitvoer en het parseresultaat", async () => {
    vi.stubGlobal("fetch", antwoord('uitleg vooraf {"intent":"ROOSTERVRAAG","toolCalls":[]}'));
    const { localModel } = await import("@/server/agent/model/local");
    const trace = nieuweTrace({ meting: "t" });
    await metTrace(trace, () => localModel(config).plan(verzoek));
    expect(trace.modelAanroepen).toHaveLength(1);
    const [a] = trace.modelAanroepen;
    expect(a.fase).toBe("plan");
    expect(a.ruweUitvoer).toBe('uitleg vooraf {"intent":"ROOSTERVRAAG","toolCalls":[]}');
    expect(a.verzoek).toMatchObject({ model: "qwen3:8b", temperature: 0, max_tokens: 100 });
    expect(a.verzoek.messages[0].role).toBe("system");
    expect(trace.plan?.parse).toEqual({ ok: true, terugval: null });
  });

  it("plan zonder JSON: de terugval staat in de trace", async () => {
    vi.stubGlobal("fetch", antwoord("geen idee"));
    const { localModel } = await import("@/server/agent/model/local");
    const trace = nieuweTrace();
    const p = await metTrace(trace, () => localModel(config).plan(verzoek));
    expect(p.onleesbaar).toBe(true);
    expect(trace.plan?.parse?.ok).toBe(false);
  });

  it("compose via het model: tak 'model', verzoek met de toolgegevens erin", async () => {
    vi.stubGlobal("fetch", antwoord("Er zijn 12 late diensten."));
    const { localModel } = await import("@/server/agent/model/local");
    const trace = nieuweTrace();
    await metTrace(trace, () =>
      localModel(config).compose({ ...verzoek, plan: plan({ toolCalls: [{ tool: "dutyKindCounts", input: {} }] }), results: [{ tool: "dutyKindCounts", ok: true, data: { count: 12 }, sources: ["DDR"] }] } as unknown as ComposeRequest),
    );
    expect(trace.composePad).toBe("model");
    expect(trace.modelAanroepen[0].fase).toBe("compose");
    expect(trace.modelAanroepen[0].verzoek.messages[1].content).toContain('{"count":12}');
    expect(trace.modelAanroepen[0].ruweUitvoer).toBe("Er zijn 12 late diensten.");
  });

  it("compose zonder model (wedervraag zonder gegevens): tak benoemd, geen modelaanroep", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { localModel } = await import("@/server/agent/model/local");
    const trace = nieuweTrace();
    await metTrace(trace, () => localModel(config).compose({ ...verzoek, plan: plan({ clarification: "Welk rooster?" }), results: [] } as unknown as ComposeRequest));
    expect(trace.composePad).toBe("wedervraag zonder geslaagde tool (geen modelaanroep)");
    expect(trace.modelAanroepen).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("een modelfout staat ook in de trace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("kapot", { status: 500 })));
    const { localModel } = await import("@/server/agent/model/local");
    const trace = nieuweTrace();
    await expect(metTrace(trace, () => localModel(config).plan(verzoek))).rejects.toThrow();
    expect(trace.modelAanroepen[0]).toMatchObject({ fase: "plan", ruweUitvoer: null, fout: "het lokale model antwoordde met 500" });
  });
});

describe("opslag van traces", () => {
  it("systeeminstructies worden per hash één keer bewaard, en verliesvrij teruggezet", () => {
    const t = nieuweTrace();
    const verzoek = (inhoud: string) => ({ model: "m", temperature: 0, max_tokens: 1, messages: [{ role: "system", content: "SYS" }, { role: "user", content: inhoud }] });
    t.modelAanroepen.push({ fase: "plan", verzoek: verzoek("a"), ruweUitvoer: "x", fout: null, ms: 1 }, { fase: "compose", verzoek: verzoek("b"), ruweUitvoer: "y", fout: null, ms: 1 });
    const { traces, systeem } = ontdubbelSysteem([t]);
    expect(Object.values(systeem)).toEqual(["SYS"]);
    expect(traces[0].modelAanroepen[0].verzoek.messages[0].content).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(zetSysteemTerug(traces, systeem)).toEqual([t]);
  });
});
