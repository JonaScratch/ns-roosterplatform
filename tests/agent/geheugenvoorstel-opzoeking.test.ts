import { afterEach, describe, expect, it, vi } from "vitest";
import { Role } from "@/lib/generated/prisma/enums";
import type { AgentPlan, ComposeRequest, PlanRequest } from "@/server/agent/model/types";
import { bewaakPlan } from "@/server/agent/plan-guard";
import { toolCatalogue } from "@/server/agent/tools";
import type { Actor } from "@/server/auth/session";

/**
 * Een geheugenvoorstel ("zal ik dit onthouden?") is geen reden om niet te
 * kijken. Adversarial-verificatie 20260930 (mn2-r1..r3): elk plan dat het
 * opgeslagen spoor reproduceerde — geen tool, alleen de voorstelcorrectie —
 * droeg een geheugenvoorstel, en de planbewaking sloeg zulke plannen over. Het
 * antwoord zei dan dat iets "niet te vinden" was in gegevens die nooit waren
 * opgehaald. Eigen parafrases en tegenvoorbeelden; geen benchmarktekst.
 */

const commissie: Actor = { sessionId: "t", userId: "u", employeeId: "e", employeeNumber: "1", roles: [Role.ROSTER_COMMITTEE], authLevel: "PASSWORD", depot: "DDR" };
const catalogus = toolCatalogue(commissie);
const TOEGESTAAN = new Set(catalogus.filter((t) => t.allowed).map((t) => t.name));
const geen = { rosterCode: null, lineNumber: null };
const geheugen = { scope: "LOCATION", kind: "PREFERENCE", statement: "eigen woorden", locationCode: "DDR" };
const plan = (p: Partial<AgentPlan>): AgentPlan => ({ intent: "FEEDBACK", toolCalls: [], reasoning: "", ...p });

describe("planbewaking: geheugenvoorstel zonder opzoeking", () => {
  it("de commissie mag knowledgeSearch — anders zou deze toets niets bewijzen", () => {
    expect(TOEGESTAAN.has("knowledgeSearch")).toBe(true);
  });

  it.each([
    "Werken we meestal met een vaste pauze rond het middaguur, en houden de roosters daar rekening mee?",
    "Is er al een afspraak vastgelegd over het ruilen van weekenddiensten? Zo niet, onthoud dan dat we dat willen.",
    "Onze gewoonte is om op zondag later te beginnen. Weet het systeem dat al?",
  ])("parafrase: %s → eerst knowledgeSearch, het voorstel blijft staan", (v) => {
    const { plan: p, correcties } = bewaakPlan(plan({ memoryProposal: geheugen }), v, geen, TOEGESTAAN);
    expect(p.toolCalls).toEqual([{ tool: "knowledgeSearch", input: { query: v } }]);
    expect(p.memoryProposal).toEqual(geheugen);
    expect(correcties).toEqual([{ regel: "ONDERZOEK_VOOR_OORDEEL", uitleg: "alleen een geheugenvoorstel, zonder één opzoeking; eerst knowledgeSearch" }]);
  });

  it("het spoor uit de runs: rekenvoorstel + geheugenvoorstel + 'niet vast te stellen' → voorstel weg, opzoeking erbij, oordeel weg", () => {
    const v = "Wat is hier de afspraak over een vrije dag na een lange week, en kun je daar rekening mee houden?";
    const { plan: p, correcties } = bewaakPlan(
      plan({ intent: "OPTIMALISATIEVERZOEK", proposal: { kind: "NEW_CANDIDATE", params: {} }, memoryProposal: geheugen, cannotDetermine: "staat niet in de toolresultaten" }),
      v,
      geen,
      TOEGESTAAN,
    );
    expect(p.proposal).toBeUndefined();
    expect(p.cannotDetermine).toBeUndefined();
    expect(p.toolCalls.map((c) => c.tool)).toEqual(["knowledgeSearch"]);
    expect(correcties.map((c) => c.regel)).toEqual(["VOORSTEL_ZONDER_REKENVERZOEK", "ONDERZOEK_VOOR_OORDEEL"]);
  });

  it("tegenvoorbeelden: een uitgesproken voorkeur zonder onderwerp, een regelvraag, een weigering en een voorstel blijven ongemoeid", () => {
    const los = plan({ memoryProposal: geheugen });
    expect(bewaakPlan(los, "We willen voortaan liever korte diensten.", geen, TOEGESTAAN).plan).toEqual(los);
    const regel = plan({ intent: "REGELVRAAG", memoryProposal: geheugen });
    expect(bewaakPlan(regel, "Welke afspraak geldt voor rusttijd?", geen, TOEGESTAAN).plan).toEqual(regel);
    const weiger = plan({ intent: "GEWEIGERD", refusal: "nee", memoryProposal: geheugen });
    expect(bewaakPlan(weiger, "Leg deze voorkeur vast als regel.", geen, TOEGESTAAN).plan).toEqual(weiger);
  });

  it("tegenvoorbeeld: met een open rooster en regel maar zonder onderwerp geen algemene roosterregel", () => {
    const los = plan({ memoryProposal: geheugen });
    expect(bewaakPlan(los, "We vinden korte diensten prettiger.", { rosterCode: "DDR-X", lineNumber: 2 }, TOEGESTAAN).plan).toEqual(los);
  });
});

describe("runtimepad: ruw modelplan → lokaal plan() → planbewaking → compose", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = { baseUrl: "http://model.test/v1", model: "qwen3:8b", timeoutMs: 1000, temperature: 0, maxTokens: 100 };
  const vraag = "Hoe gaan we hier om met de gewoonte om na een vroege week een late dienst te vermijden?";
  const context = { locationCode: "DDR", source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] };
  const antwoordVan = (inhoud: unknown) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: typeof inhoud === "string" ? inhoud : JSON.stringify(inhoud) } }] }), { status: 200 }));

  it("een geheugenvoorstel van het model overleeft het parsen én leidt tot een opzoeking; het antwoord steunt op de notitie van die opzoeking", async () => {
    const { localModel } = await import("@/server/agent/model/local");
    vi.stubGlobal(
      "fetch",
      antwoordVan({ intent: "FEEDBACK", toolCalls: [], memoryProposal: { scope: "LOCATION", kind: "PREFERENCE", statement: "late dienst na vroege week vermijden" }, cannotDetermine: "niet te vinden in de toolresultaten" }),
    );
    const request = { text: vraag, context, tools: catalogus, history: [], capabilities: ["agent:chat", "agent:memory:write"], suspended: false } as unknown as PlanRequest;
    const ruw = await localModel(config).plan(request);
    expect(ruw.memoryProposal).toBeDefined();
    expect(ruw.toolCalls).toEqual([]);

    const { plan: bewaakt } = bewaakPlan(ruw, vraag, geen, TOEGESTAAN);
    expect(bewaakt.toolCalls.map((c) => c.tool)).toEqual(["knowledgeSearch"]);
    expect(bewaakt.cannotDetermine).toBeUndefined();

    let verstuurd = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        verstuurd = init.body;
        return new Response(JSON.stringify({ choices: [{ message: { content: "Daarover is voor deze standplaats niets vastgelegd." } }] }), { status: 200 });
      }),
    );
    const notitie = "Voor andere standplaatsen zijn hier geen voorkeuren of afspraken vastgelegd.";
    const a = await localModel(config).compose({
      ...request,
      plan: bewaakt,
      results: [{ tool: "knowledgeSearch", ok: true, data: { implemented: true, items: [], scopeLocationCode: "DDR", note: notitie }, sources: ["leergeheugen DDR"] }],
    } as unknown as ComposeRequest);
    expect(verstuurd).toContain(notitie);
    expect(a.sources).toEqual(["leergeheugen DDR"]);
    expect(a.status).not.toBe("NIET_VAST_TE_STELLEN");
  });
});
