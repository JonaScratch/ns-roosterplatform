import { describe, expect, it } from "vitest";
import { stubModel } from "@/server/agent/model/stub";
import type { PlanRequest } from "@/server/agent/model/types";

/**
 * Hoe de agent over het leergeheugen praat.
 *
 * Het geheugen zelf wordt met de database gemeten (npm run verify:geheugen).
 * Hier staat wat er hoe dan ook in het antwoord hoort te staan: waar een item
 * vandaan komt, of het geldt, en of de context nog dezelfde is.
 */

const vraag = (text: string): PlanRequest => ({
  text,
  context: { locationCode: "DDR", source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
  tools: [],
  history: [],
  capabilities: ["agent:chat"],
  suspended: false,
});

describe("het leergeheugen in een antwoord", () => {
  it("raadpleegt het geheugen bij een vraag naar wat er eerder is geleerd", async () => {
    const plan = await stubModel.plan(vraag("Wat hebben we hier eerder geleerd over nachten?"));
    expect(plan.toolCalls[0]?.tool).toBe("knowledgeSearch");
  });

  it("zegt het eerlijk als er niets in staat", async () => {
    const v = vraag("Wat weten we hier al over?");
    const plan = await stubModel.plan(v);
    const antwoord = await stubModel.compose({
      ...v,
      plan,
      results: [{ tool: "knowledgeSearch", ok: true, sources: ["leergeheugen DDR"], data: { items: [], implemented: true } }],
    });
    expect(antwoord.text).toMatch(/staat hier nog niets over/);
    expect(antwoord.text).toMatch(/pas ik ook niet toe/);
  });

  it("noemt herkomst, bereik en hoe vaak een item is toegepast", async () => {
    const v = vraag("Wat weten we hier al over?");
    const plan = await stubModel.plan(v);
    const antwoord = await stubModel.compose({
      ...v,
      plan,
      results: [
        {
          tool: "knowledgeSearch",
          ok: true,
          sources: ["leergeheugen DDR"],
          data: {
            items: [
              {
                statement: "Liever vijf nachten aaneen.",
                scope: "LOCATION",
                locationCode: "DDR",
                origin: "van een mens",
                status: "APPROVED",
                appliedCount: 2,
                contextStillCurrent: true,
              },
            ],
          },
        },
      ],
    });
    expect(antwoord.text).toMatch(/standplaats DDR/);
    expect(antwoord.text).toMatch(/van een mens/);
    expect(antwoord.text).toMatch(/2× toegepast/);
  });

  it("waarschuwt bij een item uit een ander dienstenpakket", async () => {
    const v = vraag("Wat weten we nog van vorig jaar?");
    const plan = await stubModel.plan(v);
    const antwoord = await stubModel.compose({
      ...v,
      plan,
      results: [
        {
          tool: "knowledgeSearch",
          ok: true,
          sources: ["leergeheugen DDR"],
          data: {
            items: [
              {
                statement: "Dienst 115 op donderdag is zwaar.",
                scope: "LOCATION",
                locationCode: "DDR",
                origin: "van een mens",
                status: "APPROVED",
                appliedCount: 0,
                contextStillCurrent: false,
              },
            ],
          },
        },
      ],
    });
    expect(antwoord.text).toMatch(/ander dienstenpakket/);
    expect(antwoord.text).toMatch(/nog nooit toegepast/);
  });

  it("markeert een voorstel als iets dat niet meetelt", async () => {
    const v = vraag("Wat weten we hier al over?");
    const plan = await stubModel.plan(v);
    const antwoord = await stubModel.compose({
      ...v,
      plan,
      results: [
        {
          tool: "knowledgeSearch",
          ok: true,
          sources: ["leergeheugen DDR"],
          data: {
            items: [
              {
                statement: "NS-breed: vijf nachten aaneen is beter.",
                scope: "NATIONAL",
                locationCode: null,
                origin: "voorgesteld door de agent",
                status: "PROPOSED",
                appliedCount: 0,
                contextStillCurrent: true,
              },
            ],
          },
        },
      ],
    });
    expect(antwoord.text).toMatch(/NS-breed/);
    expect(antwoord.text).toMatch(/telt dus niet mee/);
  });
});
