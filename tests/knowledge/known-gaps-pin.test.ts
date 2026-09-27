import { describe, expect, it, vi } from "vitest";
import { RosterProfile } from "@/lib/generated/prisma/enums";
import { categoryOf, type QualityDuty } from "@/domain/roster-quality";
import { DAY_DUTY_WEIGHTS } from "@/domain/profile-affinity";
import { rosterProfileLabel } from "@/domain/roster-profiles";

/**
 * Regressie-PINNING voor de vier concrete gaten die de LYRA MASTER PROGRAM
 * fase-0/2-inventaris vaststelde (`docs/lyra-knowledge/conflict-report.md`,
 * `docs/lyra-knowledge/knowledge-gap-report.md`). Deze tests REPAREREN NIETS
 * — §33/§34 van de opdracht verbiedt elke inhoudelijke gedragswijziging
 * vóór de bevroren BEFORE-meting bestaat. Ze leggen het HUIDIGE (nog
 * onopgeloste) gedrag vast, zodat een latere, bewuste reparatie een
 * zichtbare, opzettelijke testwijziging is — niet een stille drift die
 * niemand opmerkt.
 *
 * `jsonUit()` (het vijfde, oorspronkelijk gevonden gat) is BUITEN deze
 * pin-suite gelaten: dat is al met een echte regressietoets gedicht in
 * `tests/agent/json-uit-lokaal-model.test.ts` (commit 588c1e5).
 */

describe("PIN — memoryProposal werkt alleen in de stub, niet in de echte lokale-modelroute", () => {
  it("de JSON-planinstructie van het echte model beschrijft geen 'memoryProposal'-veld", async () => {
    const { planInstructie } = await import("@/server/agent/model/local");
    const instructie = planInstructie();
    expect(instructie).not.toContain("memoryProposal");
    // Ter vergelijking: 'proposal' (het rekenvoorstel) staat er wél in —
    // dit bewijst dat het ontbreken van memoryProposal geen toeval is,
    // maar een structureel verschil in wat het model wordt verteld.
    expect(instructie).toContain("proposal");
  });

  it("plan() geeft memoryProposal niet door, zelfs als het model het zelf in zijn JSON zet", async () => {
    const origineleFetch = global.fetch;
    // Simuleert een Ollama-achtig antwoord waarin het model, hypothetisch,
    // wél zelf een memoryProposal-object teruggeeft — om te bewijzen dat
    // NIET het model het gat veroorzaakt, maar de nabewerking in local.ts
    // die het veld nergens overneemt (in tegenstelling tot 'proposal', dat
    // via voorstelUit() wel expliciet wordt doorgezet).
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
                memoryProposal: { scope: "LOCATION", kind: "PREFERENCE", statement: "test-voorkeur", locationCode: "DDR" },
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
      // Het gat, aangetoond: het model probeerde het, local.ts liet het vallen.
      expect((plan as unknown as Record<string, unknown>).memoryProposal).toBeUndefined();
    } finally {
      global.fetch = origineleFetch;
    }
  });
});

describe("PIN — MIX='Vroeg-Laat-Nacht'-alias wordt in code als vaststaand gepresenteerd", () => {
  it("het dagdienstgewicht van MIX draagt de alias in zijn bronvermelding, zonder onbevestigd-markering", () => {
    // Vergelijk: DAY_DUTY_WEIGHTS.VROEG draagt WEL een AANNAME-markering
    // (zie preference-audit.md) — MIX draagt die niet, terwijl het eigen
    // bronmanifest van dit project (sources/manifest.json) de alias zelf
    // "NIET bevestigd" noemt. Dat verschil is precies het gat.
    expect(DAY_DUTY_WEIGHTS.MIX.source).toBe("HUMAN_DOMAIN_INPUT (Vroeg/Laat/Nacht)");
    expect(DAY_DUTY_WEIGHTS.MIX.source).not.toMatch(/aanname|onbevestigd|unconfirmed/i);
  });

  it("het weergavelabel van MIX bevat de alias als vast onderdeel van de naam", () => {
    expect(rosterProfileLabel(RosterProfile.MIX)).toBe("Mix (Vroeg-Laat-Nacht)");
  });
});

describe("PIN — de 60-minuten klok-vs-label-drempel ontbreekt in categoryOf() (v3-voorkeurslaag)", () => {
  const dienst = (kind: string, startMinute: number, endMinute: number): QualityDuty => ({ code: "T", weekday: 1, startMinute, endMinute, kinds: [kind] });

  it("twee diensten die qua klok bijna identiek zijn (19 min verschil, de echte 50+Mix-casus) krijgen tóch verschillende categorieën", () => {
    // Exact de historische 50+Mix-casus uit human-roster-design-principles.md
    // §3: een "laat" en een "vroeg" die 19 minuten verschillen qua begintijd.
    // De v1/v2-flow-laag (rhythm-metrics.ts/quality-model.ts) behandelt dit
    // terecht als "geen echte wissel" (drempel 60 min); categoryOf() — de
    // v3-voorkeurslaag — kijkt uitsluitend naar het label en ziet hier dus
    // een volwaardige NIGHT/LATE/EARLY-wissel, ook al verschuift de klok
    // nauwelijks.
    const laat = dienst("LAAT", 9 * 60 + 54, 18 * 60); // begint 09:54
    const vroeg = dienst("VROEG", 9 * 60 + 54 - 19, 17 * 60); // begint 19 min eerder: 09:35

    expect(categoryOf(laat)).toBe("LATE");
    expect(categoryOf(vroeg)).toBe("EARLY");
    // Het gat: categoryOf() heeft geen manier om te zien dat dit qua klok
    // bijna dezelfde dienst is — er bestaat geen derde uitkomst als "geen
    // echte wissel". Zodra dit gerepareerd wordt (§ conflict-report.md #3),
    // moet deze test bewust worden aangepast, niet stilzwijgend blijven
    // slagen op de oude aanname.
    expect(categoryOf(laat)).not.toBe(categoryOf(vroeg));
  });
});
