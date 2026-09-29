import { describe, expect, it, vi } from "vitest";

/**
 * Regressietoets voor het gerepareerde `memoryProposal`-gat (§ LYRA MASTER
 * PROGRAM, Fase 7: "memoryProposal werkt alleen in de stub, niet in de echte
 * lokale-modelroute"). Was tot deze reparatie gepind in
 * `tests/knowledge/known-gaps-pin.test.ts` — die pin is hier verwijderd nu
 * het gat gedicht is (zelfde patroon als `jsonUit()`, zie
 * `tests/agent/json-uit-lokaal-model.test.ts`).
 *
 * Twee losse dingen waren stuk, allebei hier gedekt:
 *   1. `planInstructie()` vertelde het model niet dat `memoryProposal` bestaat.
 *   2. `plan()` liet het veld vallen, ook als het model het zelf teruggaf.
 */
describe("memoryProposal — lokale-modelroute op pariteit met de stub", () => {
  it("planInstructie() beschrijft memoryProposal net als proposal", async () => {
    const { planInstructie } = await import("@/server/agent/model/local");
    const instructie = planInstructie();
    expect(instructie).toContain("memoryProposal");
    expect(instructie).toContain("proposal");
  });

  it("memoryProposalUit() geeft niets door zonder agent:memory:write, ook al levert het model een geldig voorstel", async () => {
    const { memoryProposalUit } = await import("@/server/agent/model/local");
    const request = {
      text: "we willen liever geen extreem vroege diensten",
      context: { locationCode: "DDR", source: "official" as const, candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
      tools: [],
      history: [],
      capabilities: [] as const,
      suspended: false,
    };
    const resultaat = memoryProposalUit({ scope: "LOCATION", kind: "PREFERENCE", statement: "geen extreem vroege diensten" }, request);
    expect(resultaat).toBeUndefined();
  });

  it("memoryProposalUit() zet locationCode altijd op het platform-context, nooit op wat het model erbij zet", async () => {
    const { memoryProposalUit } = await import("@/server/agent/model/local");
    const request = {
      text: "we willen liever geen extreem vroege diensten",
      context: { locationCode: "DDR", source: "official" as const, candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
      tools: [],
      history: [],
      capabilities: ["agent:memory:write"] as const,
      suspended: false,
    };
    const resultaat = memoryProposalUit({ scope: "LOCATION", kind: "PREFERENCE", statement: "geen extreem vroege diensten", locationCode: "ROTTERDAM-INGEDICTEERD" }, request);
    expect(resultaat).toEqual({ scope: "LOCATION", kind: "PREFERENCE", statement: "geen extreem vroege diensten", locationCode: "DDR" });
  });

  it("memoryProposalUit() valt terug op LOCATION/PREFERENCE bij een onbekende scope/kind", async () => {
    const { memoryProposalUit } = await import("@/server/agent/model/local");
    const request = {
      text: "test",
      context: { locationCode: "DDR", source: "official" as const, candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
      tools: [],
      history: [],
      capabilities: ["agent:memory:write"] as const,
      suspended: false,
    };
    const resultaat = memoryProposalUit({ scope: "GALAXY", kind: "OPINION", statement: "iets" }, request);
    expect(resultaat).toEqual({ scope: "LOCATION", kind: "PREFERENCE", statement: "iets", locationCode: "DDR" });
  });

  it("memoryProposalUit() geeft niets terug zonder een bruikbare statement", async () => {
    const { memoryProposalUit } = await import("@/server/agent/model/local");
    const request = {
      text: "test",
      context: { locationCode: "DDR", source: "official" as const, candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
      tools: [],
      history: [],
      capabilities: ["agent:memory:write"] as const,
      suspended: false,
    };
    expect(memoryProposalUit({ scope: "LOCATION", kind: "PREFERENCE", statement: "" }, request)).toBeUndefined();
    expect(memoryProposalUit(undefined, request)).toBeUndefined();
    expect(memoryProposalUit(null, request)).toBeUndefined();
  });

  it("plan() geeft memoryProposal nu wél door als het model het zelf teruggeeft (het historische gat, nu gedicht)", async () => {
    const origineleFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "FEEDBACK",
                toolCalls: [],
                reasoning: "test",
                memoryProposal: { scope: "LOCATION", kind: "PREFERENCE", statement: "test-voorkeur" },
              }),
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    try {
      const { localModel } = await import("@/server/agent/model/local");
      const model = localModel({ baseUrl: "http://test-mock", model: "test-model", timeoutMs: 5000, temperature: 0, maxTokens: 500 });
      const plan = await model.plan({
        text: "Onthoud dat we hier liever geen extreem vroege diensten hebben.",
        context: { locationCode: "DDR", source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
        tools: [],
        history: [],
        capabilities: ["agent:memory:write"],
        suspended: false,
      });
      expect(plan.intent).toBe("FEEDBACK");
      expect(plan.memoryProposal).toEqual({ scope: "LOCATION", kind: "PREFERENCE", statement: "test-voorkeur", locationCode: "DDR" });
    } finally {
      global.fetch = origineleFetch;
    }
  });

  it("plan() geeft memoryProposal nog steeds niet door zonder de bevoegdheid, ook als het model het aanbiedt", async () => {
    const origineleFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "FEEDBACK",
                toolCalls: [],
                reasoning: "test",
                memoryProposal: { scope: "LOCATION", kind: "PREFERENCE", statement: "test-voorkeur" },
              }),
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    try {
      const { localModel } = await import("@/server/agent/model/local");
      const model = localModel({ baseUrl: "http://test-mock", model: "test-model", timeoutMs: 5000, temperature: 0, maxTokens: 500 });
      const plan = await model.plan({
        text: "Onthoud dat we hier liever geen extreem vroege diensten hebben.",
        context: { locationCode: "DDR", source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
        tools: [],
        history: [],
        capabilities: [],
        suspended: false,
      });
      expect(plan.memoryProposal).toBeUndefined();
    } finally {
      global.fetch = origineleFetch;
    }
  });
});
