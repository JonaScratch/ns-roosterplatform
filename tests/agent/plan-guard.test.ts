import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPlan, ComposeRequest } from "@/server/agent/model/types";
import { bewaakPlan } from "@/server/agent/plan-guard";
import { vraagtOmTeRekenen } from "@/server/agent/request-shape";

/**
 * Plancontrole (plan-guard.ts) — regressie AFTER-run 20260929-151948:
 * E-klacht-3/-4 (vage klacht zonder één opzoeking), F-DDR-LN-weekend (vraag
 * over het weekend werd een rekenvoorstel), J-geen-verduidelijking-1 (onleesbaar
 * plan → algemene wedervraag). Parafrasen en tegenvoorbeelden; geen item-ID's.
 */

const ALLE_TOOLS = new Set(["rosterLine", "rosterProject", "dutyKindCounts", "ruleSearch", "nightStructure"]);
const regelCtx = { rosterCode: "DDR-LN", lineNumber: 1 };
const roosterCtx = { rosterCode: "DDR-L", lineNumber: null };

const plan = (p: Partial<AgentPlan>): AgentPlan => ({ intent: "ROOSTERVRAAG", toolCalls: [], reasoning: "", ...p });
const voorstel = { kind: "GENERATE", goals: ["WEEKEND_FAIRNESS"], strategy: "FAIR_BURDEN" };

describe("vraagtOmTeRekenen — dezelfde definitie als de stub", () => {
  const rekenen = [
    "Laat uitrekenen of de nachten beter geclusterd kunnen worden.",
    "Kun je een nieuwe kandidaat maken met minder vroege diensten?",
    "Start een optimalisatie voor het weekend.",
    "Zoek een verdeling waarin Laat meer aflopers krijgt.",
    "Probeer of het weekend eerlijker kan.",
    "Ga maar drie rondes door om dit rooster te verbeteren.",
    "Genereer een paar varianten.",
    "Kun je dit doorrekenen?",
    "Bereken een betere spreiding van de nachten.",
    "Onderzoek of de rangeerdiensten eerlijker kunnen.",
  ];
  const lezen = [
    "Dit is toch geen lekker vrij weekend zo?",
    "Deze week is echt ruk.",
    "Wat heeft het brein hier nou weer gedaan?",
    "Is dit rooster zwaarder dan de andere roosters?",
    "Hoeveel nachtdiensten heeft dit rooster in totaal?",
    "Welke diensten staan er allemaal in dit rooster?",
    "Ik kom hier kut uit de nacht.",
  ];
  for (const t of rekenen) it(`rekenverzoek: ${t}`, () => expect(vraagtOmTeRekenen(t)).toBe(true));
  for (const t of lezen) it(`geen rekenverzoek: ${t}`, () => expect(vraagtOmTeRekenen(t)).toBe(false));
});

describe("regel 1 — een rekenvoorstel zonder rekenverzoek vervalt", () => {
  const vragen = [
    "Dit is toch geen lekker vrij weekend zo?",
    "Het weekend is hier wel erg vol, hè?",
    "Waarom werk ik op zaterdag en zondag allebei?",
    "Is dit een eerlijk weekend?",
  ];
  for (const v of vragen) {
    it(`"${v}" → kijken naar de regel in plaats van een voorstel`, () => {
      const { plan: p, correcties } = bewaakPlan(plan({ intent: "OPTIMALISATIEVERZOEK", proposal: voorstel }), v, regelCtx, ALLE_TOOLS);
      expect(p.proposal).toBeUndefined();
      expect(p.intent).toBe("ROOSTERVRAAG");
      expect(p.toolCalls).toEqual([{ tool: "rosterLine", input: {} }]);
      expect(correcties.map((c) => c.regel)).toEqual(["VOORSTEL_ZONDER_REKENVERZOEK", "ONDERZOEK_VOOR_OORDEEL"]);
    });
  }

  it("een echt rekenverzoek houdt zijn voorstel, zonder correctie", () => {
    const origineel = plan({ intent: "OPTIMALISATIEVERZOEK", proposal: voorstel });
    const { plan: p, correcties } = bewaakPlan(origineel, "Laat uitrekenen of het weekend eerlijker kan.", regelCtx, ALLE_TOOLS);
    expect(p).toEqual(origineel);
    expect(correcties).toEqual([]);
  });

  it("de geplande tools blijven staan en de intentie ook, als het model al iets opzocht", () => {
    const { plan: p } = bewaakPlan(
      plan({ intent: "VERDELINGSVRAAG", proposal: voorstel, toolCalls: [{ tool: "dutyKindCounts", input: { kind: "NACHT" } }] }),
      "Hoe zijn de nachten verdeeld?",
      roosterCtx,
      ALLE_TOOLS,
    );
    expect(p.intent).toBe("VERDELINGSVRAAG");
    expect(p.toolCalls).toHaveLength(1);
  });
});

describe("regel 2 — een onleesbaar plan wordt geen algemene wedervraag", () => {
  it("met een bekend rooster: opzoeken, geen wedervraag", () => {
    const { plan: p, correcties } = bewaakPlan(
      plan({ intent: "VERDUIDELIJKING_NODIG", clarification: "Ik kom er zo niet uit.", onleesbaar: true, reasoning: "het model leverde geen leesbaar plan" }),
      "Welke diensten staan er allemaal in dit rooster?",
      roosterCtx,
      ALLE_TOOLS,
    );
    expect(p.clarification).toBeUndefined();
    expect(p.onleesbaar).toBeUndefined();
    expect(p.toolCalls).toEqual([{ tool: "rosterProject", input: {} }]);
    expect(correcties[0].regel).toBe("ONLEESBAAR_PLAN");
  });

  it("zonder context blijft de eerlijke wedervraag staan", () => {
    const origineel = plan({ intent: "VERDUIDELIJKING_NODIG", clarification: "Ik kom er zo niet uit.", onleesbaar: true });
    expect(bewaakPlan(origineel, "Hoe zit het?", { rosterCode: null, lineNumber: null }, ALLE_TOOLS).plan).toEqual(origineel);
  });
});

describe("regel 3 — eerst kijken, dan pas oordelen of doorvragen", () => {
  const klachten = ["Deze week is echt ruk.", "Wat heeft het brein hier nou weer gedaan?", "Deze regel loopt voor geen meter.", "Ik kom hier kut uit de nacht."];
  for (const k of klachten) {
    it(`"${k}" met bekende regel → rosterLine, de wedervraag blijft`, () => {
      const { plan: p } = bewaakPlan(plan({ intent: "FEEDBACK", clarification: "Wat loopt er niet lekker?" }), k, regelCtx, ALLE_TOOLS);
      expect(p.toolCalls).toEqual([{ tool: "rosterLine", input: {} }]);
      expect(p.clarification).toBe("Wat loopt er niet lekker?");
    });
  }

  it("een echte wedervraag over een onbekend begrip blijft staan (en wordt ná het kijken gesteld)", () => {
    const { plan: p } = bewaakPlan(
      plan({ intent: "VERDUIDELIJKING_NODIG", clarification: "Ik kan SPRINTERDIENST niet terugvinden. Wat bedoel je?" }),
      "Waarom rijdt regel 4 geen sprinterdienst?",
      { rosterCode: "DDR-L", lineNumber: 4 },
      ALLE_TOOLS,
    );
    expect(p.clarification).toMatch(/SPRINTERDIENST/);
  });

  const ongemoeid: [string, Partial<AgentPlan>][] = [
    ["weigering", { intent: "GEWEIGERD", refusal: "Publiceren doet een mens." }],
    ["niet vast te stellen", { intent: "UITLEGVRAAG", cannotDetermine: "De solverkeuze is niet vastgelegd." }],
    ["regelvraag", { intent: "REGELVRAAG" }],
    ["geheugenvoorstel", { intent: "FEEDBACK", memoryProposal: { statement: "liever geen vroege diensten" } }],
    ["plan met tools", { toolCalls: [{ tool: "nightStructure", input: {} }] }],
  ];
  for (const [naam, deel] of ongemoeid) {
    it(`laat ${naam} ongemoeid`, () => {
      const origineel = plan(deel);
      const { plan: p, correcties } = bewaakPlan(origineel, "Deze week is echt ruk.", regelCtx, ALLE_TOOLS);
      expect(p).toEqual(origineel);
      expect(correcties).toEqual([]);
    });
  }

  it("zoekt niets op zonder context, en niets met een tool die niet mag", () => {
    expect(bewaakPlan(plan({ intent: "FEEDBACK" }), "Ruk.", { rosterCode: null, lineNumber: null }, ALLE_TOOLS).plan.toolCalls).toEqual([]);
    expect(bewaakPlan(plan({ intent: "FEEDBACK" }), "Ruk.", regelCtx, new Set(["ruleSearch"])).plan.toolCalls).toEqual([]);
  });
});

describe("lokale compose: de wedervraag van het plan gaat niet meer verloren", () => {
  afterEach(() => vi.unstubAllGlobals());

  const basisVerzoek = (p: AgentPlan, results: ComposeRequest["results"]): ComposeRequest =>
    ({
      text: "Deze week is echt ruk.",
      context: { locationCode: "DDR", source: "official", candidateId: null, rosterCode: "DDR-LN", lineNumber: 1, weekday: null, dutyCode: null, missing: [] },
      tools: [],
      history: [],
      capabilities: [],
      suspended: false,
      plan: p,
      results,
    }) as unknown as ComposeRequest;
  const config = { baseUrl: "http://model.test/v1", model: "qwen3:8b", timeoutMs: 1000, temperature: 0, maxTokens: 100 };

  it("zonder gegevens: de wedervraag zelf, zonder het model aan te roepen", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { localModel } = await import("@/server/agent/model/local");
    const a = await localModel(config).compose(basisVerzoek(plan({ intent: "FEEDBACK", clarification: "Wat loopt er niet lekker: de begintijden, de rust of het weekend?" }), []));
    expect(a.status).toBe("VERDUIDELIJKING");
    expect(a.text).toBe("Wat loopt er niet lekker: de begintijden, de rust of het weekend?");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("met gegevens: het model krijgt de opdracht eerst de bevinding te geven en af te sluiten met precies die vraag", async () => {
    let verstuurd = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        verstuurd = init.body;
        return new Response(JSON.stringify({ choices: [{ message: { content: "Regel 1 heeft vier nachten op rij. Wat vind je het zwaarst?" } }] }), { status: 200 });
      }),
    );
    const { localModel } = await import("@/server/agent/model/local");
    const a = await localModel(config).compose(
      basisVerzoek(plan({ intent: "FEEDBACK", clarification: "Wat vind je het zwaarst?", toolCalls: [{ tool: "rosterLine", input: {} }] }), [
        { tool: "rosterLine", ok: true, data: { days: [] }, sources: ["officieel rooster"] },
      ]),
    );
    expect(a.status).toBe("VERDUIDELIJKING");
    expect(verstuurd).toContain("sluit af met precies deze vraag aan de gebruiker: Wat vind je het zwaarst?");
  });
});
