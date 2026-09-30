import { afterEach, describe, expect, it, vi } from "vitest";
import { Role } from "@/lib/generated/prisma/enums";
import { verzonnenAfwezigheden } from "@/server/agent/bron-afwezigheid";
import { ongedekteGezagsClaims } from "@/server/agent/claim-verification";
import { gegevensTekst, ongegrondeVermeldingen } from "@/server/agent/grounding";
import { andereStandplaatsenIn, kennisBereikUit, kennisBereikZinnen, verankerKennisBereik } from "@/server/agent/kennis-bereik";
import type { AgentPlan, ComposeRequest, PlanRequest } from "@/server/agent/model/types";
import { bewaakPlan } from "@/server/agent/plan-guard";
import { toolCatalogue } from "@/server/agent/tools";
import type { Actor } from "@/server/auth/session";
import { notitiesApart } from "../../scripts/v106/diagnose-trace";

/**
 * Deterministisch bereik van een kennisopzoeking (kennis-bereik.ts).
 *
 * diagnose-20260930-m2: bij byte-gelijke verzoeken hing de uitvoer van qwen3:8b
 * af van het vorige verzoek aan de server (na het planverzoek: bereikgrens
 * weggelaten; na herladen: genoemd). Wat de tool vaststelt, hoort daarom door
 * het platform in het antwoord te komen, onafhankelijk van modeltoestand of
 * presentatie. Eigen teksten; geen benchmarktekst.
 */

/** Zoals knowledgeSearch (tools.ts) het teruggeeft. */
const kennis = (items: unknown[] = [], scope = "DDR") => ({
  tool: "knowledgeSearch",
  ok: true,
  data: { implemented: true, dutyPackage: null, items, scopeLocationCode: scope, note: `Deze kennis geldt voor standplaats ${scope} (en NS-breed waar scope NATIONAL staat).` },
  sources: [`leergeheugen ${scope}`],
});
const item = { id: "1", scope: "LOCATION", kind: "PREFERENCE", statement: "liever geen vroege dienst na een nachtblok", status: "APPROVED", locationCode: "DDR" };

describe("kennisBereikUit: alleen wat de tool bewijst", () => {
  it("geen kennisopzoeking, een mislukte, of één zonder bereik → geen bereik", () => {
    expect(kennisBereikUit([{ tool: "rosterLine", ok: true, data: { lines: [] } }])).toBeNull();
    expect(kennisBereikUit([{ ...kennis(), ok: false, data: null }])).toBeNull();
    expect(kennisBereikUit([{ tool: "knowledgeSearch", ok: true, data: { items: [] } }])).toBeNull();
  });
  it("een geslaagde opzoeking met bereik → standplaats met naam, en het aantal items", () => {
    expect(kennisBereikUit([kennis([item])])).toEqual({ code: "DDR", naam: "Dordrecht", aantalItems: 1 });
  });
});

describe("andereStandplaatsenIn", () => {
  it.each([
    ["Werken ze in Utrecht ook zo?", ["UT"]],
    ["Is dat de Amsterdamse werkwijze?", ["ASD"]],
    ["Hoe doet Den Haag Holland Spoor dat?", ["GV"]],
    ["In Zwolle en in Breda is het anders.", ["BD", "ZL"]],
  ])("%s → %j", (tekst, codes) => {
    expect(andereStandplaatsenIn(tekst, "DDR").map((s) => s.code).sort()).toEqual([...codes].sort());
  });
  it.each([
    "Hoe gaat dat hier in Dordrecht?",
    "Staat er UT of VS in het rooster?",
    "Welke afspraak geldt voor de DDR-L?",
    "Utrechtsestraat is geen standplaatsnaam op zich",
  ])("tegenvoorbeeld: %s → geen andere standplaats", (tekst) => {
    expect(andereStandplaatsenIn(tekst, "DDR")).toEqual([]);
  });
});

describe("kennisBereikZinnen: parafrases en tegenvoorbeelden", () => {
  it.each([
    "Welke afspraak geldt hier over ruilen van weekenddiensten?",
    "Is er een vastgelegde voorkeur voor korte diensten?",
    "Wat is hier de gewoonte bij een vrije dag na een nachtblok?",
    "Werken jullie meestal met een vaste pauze?",
  ])("kennisvraag zonder resultaat → afwezigheidszin (%s)", (vraag) => {
    expect(kennisBereikZinnen(vraag, [kennis()])).toEqual(["Opgezocht in het leergeheugen voor standplaats Dordrecht (DDR) en NS-breed: daar is hierover niets goedgekeurd vastgelegd."]);
  });

  it("andere standplaats genoemd, óók als er items zijn → grenszin", () => {
    const [zin] = kennisBereikZinnen("In Utrecht doen ze het zo, klopt dat hier ook?", [kennis([item])]);
    expect(zin).toBe(
      "Een voorkeur of afspraak van Utrecht telt hier niet mee: dit leergeheugen geldt voor standplaats Dordrecht (DDR) en NS-breed, en een voorkeur van een andere standplaats wordt hier niet toegepast of ernaast gelegd.",
    );
  });

  it("kennisvraag zonder resultaat én andere standplaats → beide zinnen, afwezigheid eerst", () => {
    expect(kennisBereikZinnen("Welke voorkeur hanteert Utrecht hiervoor?", [kennis()])).toHaveLength(2);
  });

  it("lokale scope volgt uit de tool, niet uit een aanname", () => {
    const [zin] = kennisBereikZinnen("Welke afspraak geldt hier?", [kennis([], "RTD")]);
    expect(zin).toContain("standplaats Rotterdam (RTD)");
    expect(kennisBereikZinnen("Hoe doen ze dat in Dordrecht?", [kennis([], "RTD")])[0]).toContain("Een voorkeur of afspraak van Dordrecht telt hier niet mee");
  });

  it("tegenvoorbeelden: geen onterechte bereikzin", () => {
    // wél resultaat, geen andere standplaats
    expect(kennisBereikZinnen("Welke afspraak geldt voor pauzes?", [kennis([item])])).toEqual([]);
    // geen kennisvraag, geen andere standplaats (bv. een vraag over een aanduiding)
    expect(kennisBereikZinnen("Is de aanduiding X hetzelfde als profiel Y?", [kennis()])).toEqual([]);
    // tool mislukt: niets bewezen, ook al noemt de vraag een andere standplaats
    expect(kennisBereikZinnen("Welke voorkeur heeft Utrecht?", [{ ...kennis(), ok: false, data: null }])).toEqual([]);
    // geen kennisopzoeking gedaan: het rooster bewijst niets over kennisbereik
    expect(kennisBereikZinnen("Heeft Utrecht meer nachten?", [{ tool: "dutyKindCounts", ok: true, data: { count: 3 } }])).toEqual([]);
  });

  it("verankerKennisBereik: niets bij weigering, fout of voorstel", () => {
    for (const status of ["GEWEIGERD", "FOUT", "VOORSTEL"]) {
      const a = { text: "x", status };
      expect(verankerKennisBereik(a, "Welke afspraak geldt hier?", [kennis()])).toEqual({ antwoord: a, zinnen: [] });
    }
    const v = verankerKennisBereik({ text: "Ik weet het niet.", status: "NIET_VAST_TE_STELLEN" }, "Welke afspraak geldt hier?", [kennis()]);
    expect(v.antwoord.text).toBe("Ik weet het niet.\n\nOpgezocht in het leergeheugen voor standplaats Dordrecht (DDR) en NS-breed: daar is hierover niets goedgekeurd vastgelegd.");
  });
});

describe("runtimepad onder wisselende modeltoestand", () => {
  afterEach(() => vi.unstubAllGlobals());
  const commissie: Actor = { sessionId: "t", userId: "u", employeeId: "e", employeeNumber: "1", roles: [Role.ROSTER_COMMITTEE], authLevel: "PASSWORD", depot: "DDR" };
  const catalogus = toolCatalogue(commissie);
  const toegestaan = new Set(catalogus.filter((t) => t.allowed).map((t) => t.name));
  const vraag = "In Utrecht is het de gewoonte om na een vroege week niet meteen laat te werken; geldt die afspraak hier ook?";
  const context = { locationCode: "DDR", source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] };
  const config = { baseUrl: "http://model.test/v1", model: "qwen3:8b", timeoutMs: 1000, temperature: 0, maxTokens: 100 };

  /**
   * Nepmodel met toestand, zoals de promptcache in diagnose-20260930-m2: het
   * compose-antwoord hangt af van het vorige verzoek (plan → A, zelfde compose
   * → B, na herladen → C). Alleen C noemt de bereikgrens zelf.
   */
  function nepModelMetToestand() {
    let vorige: "koud" | "plan" | "compose" = "koud";
    const verzoeken: string[] = [];
    const fetch = vi.fn(async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      verzoeken.push(init.body);
      const isPlan = body.messages.at(-1)?.content.includes("antwoord met uitsluitend JSON") ?? false;
      const inhoud = isPlan
        ? JSON.stringify({ intent: "FEEDBACK", toolCalls: [], proposal: { kind: "GENERATE", goals: ["SHUNTING_FAIRNESS"] }, memoryProposal: { statement: "voorkeur" } })
        : vorige === "plan"
          ? "Voor standplaats DDR gelden alleen goedgekeurde items; over deze gewoonte staat niets."
          : vorige === "compose"
            ? "De tool bevat alleen goedgekeurde afspraken voor standplaats DDR."
            : "Voor andere standplaatsen zijn geen afspraken vastgelegd; die gelden hier niet.";
      vorige = isPlan ? "plan" : "compose";
      return new Response(JSON.stringify({ choices: [{ message: { content: inhoud } }] }), { status: 200 });
    });
    return { fetch, verzoeken, herlaad: () => (vorige = "koud"), zet: (t: typeof vorige) => (vorige = t) };
  }

  async function beurt(nep: ReturnType<typeof nepModelMetToestand>, presentatie: "standaard" | "apart" = "standaard") {
    vi.stubGlobal("fetch", nep.fetch);
    const { localModel } = await import("@/server/agent/model/local");
    const model = localModel(config);
    const request = { text: vraag, context, tools: catalogus, history: [], capabilities: ["agent:chat", "agent:memory:write"], suspended: false } as unknown as PlanRequest;
    const { plan } = bewaakPlan(await model.plan(request), vraag, { rosterCode: null, lineNumber: null }, toegestaan);
    const results = [kennis()];
    const composeRequest = { ...request, plan, results } as unknown as ComposeRequest;
    let ruw;
    if (presentatie === "apart") {
      // Zelfde verzoek, maar met de toolnotitie als losse regel (diagnosevariant).
      const origineel = nep.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (u: string, init: { body: string }) => {
          const b = JSON.parse(init.body);
          const variant = notitiesApart(b, { tools: results.map((r) => ({ ...r, invoer: {}, ms: 0, note: null, fout: null, gesimuleerd: false, bronnen: r.sources })) });
          return origineel(u, { body: JSON.stringify({ ...b, ...(variant ?? {}) }) });
        }),
      );
      ruw = await model.compose(composeRequest);
    } else {
      ruw = await model.compose(composeRequest);
    }
    // De poorten zoals agent.ts ze toepast; daarna het bereik.
    const gegevens = `${gegevensTekst(results)}\nDDR official`;
    expect(ongegrondeVermeldingen(ruw.text, gegevens)).toEqual([]);
    expect(ongedekteGezagsClaims(ruw.text, results)).toEqual([]);
    expect(verzonnenAfwezigheden(ruw.text)).toEqual([]);
    return { plan, ruw, eind: verankerKennisBereik(ruw, vraag, results) };
  }

  const GRENS = "een voorkeur van een andere standplaats wordt hier niet toegepast of ernaast gelegd";

  it("warm na het planverzoek (de ketenvolgorde): modeltekst mist de grens, het eindantwoord niet", async () => {
    const nep = nepModelMetToestand();
    const { plan, ruw, eind } = await beurt(nep);
    expect(plan.toolCalls.map((c) => c.tool)).toEqual(["knowledgeSearch"]);
    expect(ruw.text).not.toContain("andere standplaats");
    expect(eind.antwoord.text).toContain(GRENS);
    expect(eind.antwoord.text).toContain("Opgezocht in het leergeheugen voor standplaats Dordrecht (DDR) en NS-breed");
  });

  it("koud/herladen, en warm na een ander verzoek: zelfde verzoeken, andere modeltekst, zelfde bereik", async () => {
    const eindteksten: string[] = [];
    const bereik: string[][] = [];
    const verzoekReeksen: string[][] = [];
    for (const voor of ["plan", "compose", "koud"] as const) {
      const nep = nepModelMetToestand();
      // de modeltoestand vóór de compose: na plan (keten), na een compose, of herladen
      vi.stubGlobal("fetch", nep.fetch);
      const { eind } = await (async () => {
        const r = await beurt({ ...nep, fetch: vi.fn(async (u: string, init: { body: string }) => {
          const isCompose = !init.body.includes("antwoord met uitsluitend JSON");
          if (isCompose && voor !== "plan") (voor === "koud" ? nep.herlaad() : nep.zet("compose"));
          return nep.fetch(u, init);
        }) });
        return r;
      })();
      eindteksten.push(eind.antwoord.text);
      bereik.push(eind.zinnen);
      verzoekReeksen.push(nep.verzoeken);
    }
    // De modelverzoeken zijn in alle drie de toestanden byte-gelijk: het bereik verandert niets aan wat het model krijgt.
    expect(verzoekReeksen[1]).toEqual(verzoekReeksen[0]);
    expect(verzoekReeksen[2]).toEqual(verzoekReeksen[0]);
    // De modeltekst verschilt per toestand …
    expect(new Set(eindteksten).size).toBe(3);
    // … maar de bereikzinnen zijn identiek en staan in elk eindantwoord.
    expect(bereik[1]).toEqual(bereik[0]);
    expect(bereik[2]).toEqual(bereik[0]);
    for (const t of eindteksten) expect(t).toContain(GRENS);
  });

  it("standaard én aparte notitiepresentatie: in beide staat het bereik er deterministisch onder", async () => {
    const standaard = await beurt(nepModelMetToestand(), "standaard");
    const apart = await beurt(nepModelMetToestand(), "apart");
    expect(standaard.eind.zinnen).toEqual(apart.eind.zinnen);
    expect(apart.eind.antwoord.text).toContain(GRENS);
  });

  it("de compose krijgt de toolnotitie in de standaardpresentatie ongewijzigd (geen verandering aan modelverzoeken)", async () => {
    const nep = nepModelMetToestand();
    await beurt(nep);
    const compose = JSON.parse(nep.verzoeken[1]) as { messages: { role: string; content: string }[] };
    expect(compose.messages.at(-1)?.content).toContain('"note":"Deze kennis geldt voor standplaats DDR');
    expect(compose.messages.at(-1)?.content).not.toContain("Vastgesteld door de tools:");
  });
});
