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

describe("onderwerptool — nachtreeksen horen bij nightStructure (run 20260929-193436, O-items)", async () => {
  const { onderwerpTool } = await import("@/server/agent/request-shape");
  const reeksvragen = [
    "Wat is de langste reeks nachten in dit rooster?",
    "Hoeveel nachten achter elkaar draai ik hier maximaal?",
    "Hoe lang is het langste blok nachtdiensten?",
    "Zijn de nachtdiensten aaneengesloten of verspreid?",
    "Hoeveel opeenvolgende nachtdiensten zitten erin?",
    "Hoeveel nachten op rij komen er voor?",
    "Liggen de nachten in één cluster?",
    "Welke nachtreeksen zitten in DDR-LN?",
    "Volgen de nachten direct op elkaar?",
    "Draai ik de nachten na elkaar of met rust ertussen?",
  ];
  const geenReeks = [
    "Hoeveel nachtdiensten heeft dit rooster in totaal?",
    "Welke regels hebben een nachtdienst?",
    "Hoe laat begint de nachtdienst op dinsdag?",
    "Is dit rooster zwaarder dan de andere?",
    "Wat staat er op regel 3?",
  ];
  for (const v of reeksvragen) it(`herkent: ${v}`, () => expect(onderwerpTool(v)?.tool).toBe("nightStructure"));
  for (const v of geenReeks) it(`geen reeksvraag: ${v}`, () => expect(onderwerpTool(v)).toBeNull());
});

describe("regel 4 en de nieuwe contextopzoeking", () => {
  const rooster = { rosterCode: "DDR-MIX", lineNumber: null };

  it("vult nightStructure aan naast een tool die de reeks niet kent", () => {
    const { plan: p, correcties } = bewaakPlan(plan({ toolCalls: [{ tool: "dutyKindPerLine", input: { kind: "NACHT" } }] }), "Wat is de langste aaneengesloten reeks nachtdiensten?", rooster, ALLE_TOOLS);
    expect(p.toolCalls.map((c) => c.tool)).toEqual(["dutyKindPerLine", "nightStructure"]);
    expect(correcties.map((c) => c.regel)).toEqual(["ONTBREKENDE_ONDERWERPTOOL"]);
  });

  it("laat een regelvraag over nachten achter elkaar met rust", () => {
    const origineel = plan({ intent: "REGELVRAAG", toolCalls: [{ tool: "ruleSearch", input: { query: "nachten achter elkaar" } }] });
    expect(bewaakPlan(origineel, "Mag ik na drie nachten achter elkaar meteen vroeg?", rooster, ALLE_TOOLS).plan).toEqual(origineel);
  });

  it("zonder bekend rooster vult hij niets aan", () => {
    const origineel = plan({ toolCalls: [{ tool: "dutyKindCounts", input: { kind: "NACHT" } }] });
    expect(bewaakPlan(origineel, "Wat is de langste reeks nachten?", { rosterCode: null, lineNumber: null }, ALLE_TOOLS).plan).toEqual(origineel);
  });

  it("een onleesbaar plan over nachtreeksen zoekt nightStructure op, niet het algemene rosterProject", () => {
    const { plan: p } = bewaakPlan(plan({ intent: "VERDUIDELIJKING_NODIG", clarification: "?", onleesbaar: true }), "Wat is de langste aaneengesloten reeks nachtdiensten in DDR-LN?", { rosterCode: "DDR-LN", lineNumber: null }, ALLE_TOOLS);
    expect(p.toolCalls).toEqual([{ tool: "nightStructure", input: {} }]);
  });

  it("met alleen een rooster en geen onderwerp injecteert regel 3 niets (geen misleidend pakketoverzicht)", () => {
    const origineel = plan({ intent: "VERDUIDELIJKING_NODIG", clarification: "Wat bedoel je met die term?" });
    const { plan: p, correcties } = bewaakPlan(origineel, "Hoeveel van die bijzondere diensten zitten erin?", { rosterCode: "DDR-50MIX", lineNumber: null }, ALLE_TOOLS);
    expect(p).toEqual(origineel);
    expect(correcties).toEqual([]);
  });
});

describe("voorkeuren en afspraken — kennis opzoeken, ook zonder rooster (AFTER-run 20260930-021137)", () => {
  const MET_KENNIS = new Set([...ALLE_TOOLS, "knowledgeSearch"]);
  const geen = { rosterCode: null, lineNumber: null };

  it("een weggehaald voorstel laat geen leeg plan achter: eerst de goedgekeurde kennis", () => {
    const v = "Bij ons is de afspraak dat je na een late dienst nooit vroeg begint. Nemen jullie die werkwijze over?";
    const { plan: p, correcties } = bewaakPlan(plan({ intent: "OPTIMALISATIEVERZOEK", proposal: voorstel }), v, geen, MET_KENNIS);
    expect(p.proposal).toBeUndefined();
    expect(p.toolCalls).toEqual([{ tool: "knowledgeSearch", input: { query: v } }]);
    expect(correcties.map((c) => c.regel)).toEqual(["VOORSTEL_ZONDER_REKENVERZOEK", "ONDERZOEK_VOOR_OORDEEL"]);
  });

  it("ook bij een plan zonder tools en zonder voorstel, en ook met een rooster maar zonder regel", () => {
    const v = "Welke voorkeuren gelden hier voor het weekend?";
    expect(bewaakPlan(plan({}), v, geen, MET_KENNIS).plan.toolCalls).toEqual([{ tool: "knowledgeSearch", input: { query: v } }]);
    expect(bewaakPlan(plan({}), v, roosterCtx, MET_KENNIS).plan.toolCalls).toEqual([{ tool: "knowledgeSearch", input: { query: v } }]);
  });

  it("tegenvoorbeelden: geen voorkeursvraag, een plan dat al opzoekt, een weigering, of kennis niet toegestaan", () => {
    expect(bewaakPlan(plan({}), "Hoe laat begint dienst 201?", geen, MET_KENNIS).plan.toolCalls).toEqual([]);
    const opzoekend = plan({ toolCalls: [{ tool: "ruleSearch", input: { query: "rust" } }] });
    expect(bewaakPlan(opzoekend, "Welke afspraken gelden voor rust?", geen, MET_KENNIS).plan.toolCalls).toEqual(opzoekend.toolCalls);
    expect(bewaakPlan(plan({ refusal: "nee" }), "Pas mijn voorkeur aan in het rooster.", geen, MET_KENNIS).plan.toolCalls).toEqual([]);
    expect(bewaakPlan(plan({}), "Welke voorkeuren gelden hier?", geen, ALLE_TOOLS).plan.toolCalls).toEqual([]);
  });

  it("met een bekende regel blijft rosterLine voorgaan (de kennisterugval vult alleen een leeg plan)", () => {
    expect(bewaakPlan(plan({}), "Past deze regel bij mijn voorkeur?", regelCtx, MET_KENNIS).plan.toolCalls).toEqual([{ tool: "rosterLine", input: {} }]);
  });
});

describe("de kennisterugval raakt de bevroren kern niet", () => {
  it("geen enkele vraag uit de bevroren golden suite gaat over voorkeuren of afspraken", async () => {
    const { readFileSync } = await import("node:fs");
    const { vraagtNaarKennis } = await import("@/server/agent/request-shape");
    const suite = JSON.parse(readFileSync("docs/v1.0.6/golden-suite.json", "utf8")) as { items: { id: string; turns: { text: string }[] }[] };
    expect(suite.items.length).toBe(43);
    expect(suite.items.filter((i) => i.turns.some((t) => vraagtNaarKennis(t.text))).map((i) => i.id)).toEqual([]);
  });
});
