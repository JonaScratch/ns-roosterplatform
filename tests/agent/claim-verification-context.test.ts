import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classificeerGezagsClaims, ongedekteGezagsClaims, type ClaimToolResultaat } from "@/server/agent/claim-verification";

/**
 * Regressie AFTER-run 20260929-151948: de claimgrendel hield correcte
 * premiecorrecties tegen (B-DDR-50MIX/LN/MIX/V-omgekeerd) omdat hij de
 * herkomstzin "De bron is officieel en bevestigd." onder een roostertelling
 * las als gezagsclaim over een regel. Deze tests leggen vast:
 *  1. herkomstaanduidingen bij opgehaalde roostergegevens gaan door (≥10 parafrasen);
 *  2. elke claim over regels/CAO/normen blijft zonder VALIDATED tegengehouden,
 *     ook als de beurt alleen roostergegevens ophaalde (≥5 tegenvoorbeelden);
 *  3. een beurt die regelkennis raadpleegde blijft ongewijzigd streng;
 *  4. "door de gebruiker bevestigd" alleen met menselijke herkomst in de data.
 * Geen item-ID's in de logica: de testzinnen zijn parafrasen, plus de letterlijke
 * historische zinnen als bewijs dat het echte faalgeval gedekt is.
 */

const telling: ClaimToolResultaat[] = [
  {
    tool: "dutyKindCounts",
    ok: true,
    data: { counts: { kind: "VROEG", perRoster: { "DDR-50MIX": 11, "DDR-LN": 0, "DDR-MIX": 15, "DDR-V": 41 } }, source: "official" },
  },
];
const regelTranscriptie: ClaimToolResultaat[] = [
  { tool: "ruleLookup", ok: true, data: { rules: [{ ruleId: "RP_DAILY_REST_PLANNED", legalStatus: "SOURCE_TRANSCRIBED", verified: false }] } },
];
const regelGevalideerd: ClaimToolResultaat[] = [
  { tool: "ruleLookup", ok: true, data: { rules: [{ ruleId: "RP_DAILY_REST_PLANNED", legalStatus: "VALIDATED", verified: true }] } },
];
const menselijkeKennis: ClaimToolResultaat[] = [
  { tool: "dutyKindPerLine", ok: true, data: { profile: "MIX", bron: "GEBRUIKER", herkomst: "opgegeven door Jonathan" } },
];

describe("herkomstaanduiding bij roostergegevens is geen gezagsclaim", () => {
  const parafrasen = [
    "DDR-50MIX heeft 11 vroege diensten, dus dat klopt niet. De bron is officieel en bevestigd.",
    "Dat klopt: DDR-LN heeft 0 vroege diensten (bron: official, bevestigd).",
    "DDR-MIX heeft 15 vroege diensten. De gegevens zijn bevestigd door de officiële bron.",
    "DDR-V heeft juist 41 vroege diensten. Dit is bevestigd door de tool dutyKindCounts.",
    "Het aantal is dus bevestigd: 15 vroege diensten in DDR-MIX.",
    "Volgens de telling heeft DDR-LN geen vroege diensten; de bron is bevestigd als officieel.",
    "DDR-V telt 41 vroege diensten. De informatie is bevestigd door het officiële rooster.",
    "In DDR-50MIX staan 11 vroege diensten. De bron is officieel bevestigd.",
    "Regel 2 van DDR-MIX bevat twee rangeerdiensten (bron: official, bevestigd).",
    "DDR-LN heeft 0 vroege en 16 late diensten, bevestigd door de roostergegevens.",
    "De regel is bevestigd door de bron 'official': zaterdag en zondag zijn rust.",
  ];
  for (const zin of parafrasen) {
    it(`gaat door: ${zin}`, () => {
      const claims = classificeerGezagsClaims(zin, telling);
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.every((c) => c.soort === "HERKOMST")).toBe(true);
      expect(ongedekteGezagsClaims(zin, telling)).toEqual([]);
    });
  }

  it("zonder één opgehaald gegeven is ook een herkomstclaim ongedekt", () => {
    expect(ongedekteGezagsClaims("De bron is officieel en bevestigd.", [])).toHaveLength(1);
    expect(ongedekteGezagsClaims("De bron is officieel en bevestigd.", [{ tool: "rosterLine", ok: true, data: { found: false } }])).toHaveLength(1);
    expect(ongedekteGezagsClaims("De bron is officieel en bevestigd.", [{ tool: "rosterLine", ok: false, data: null }])).toHaveLength(1);
  });
});

describe("normatieve claims blijven tegengehouden, ook in een beurt met alleen roostergegevens", () => {
  const tegenvoorbeelden = [
    "De gegevens zijn bevestigd en voldoen aan de standaardregels.",
    "De kwaliteit van het rooster is bevestigd, en de rustperiodes voldoen aan de regels.",
    "Volgens de CAO is deze rusttijd bevestigd.",
    "Deze rustregel is bevestigd.",
    "Dat mag, dat is bevestigd.",
    "RP_DAILY_REST_PLANNED is bevestigd.",
    "Dit is formeel vastgesteld door NS.",
    "Twaalf uur rust is CAO-verplicht.",
    "Dit is een NS-regel, dus hard.",
    "Volgens art. 12 is dit bevestigd.",
  ];
  for (const zin of tegenvoorbeelden) {
    it(`blijft tegengehouden: ${zin}`, () => {
      const ongedekt = ongedekteGezagsClaims(zin, telling);
      expect(ongedekt.length).toBeGreaterThan(0);
      expect(ongedekt.every((c) => c.soort === "REGELSTATUS")).toBe(true);
    });
  }

  it("de normatieve context van één zin lekt niet naar een herkomstzin ernaast, en omgekeerd", () => {
    const tekst = "DDR-V heeft 41 vroege diensten. De bron is officieel bevestigd. Of dat aan de CAO voldoet, kan ik niet vaststellen.";
    expect(ongedekteGezagsClaims(tekst, telling)).toEqual([]);
    const tekst2 = "DDR-V heeft 41 vroege diensten (bron: official). Dit voldoet aan de CAO, bevestigd.";
    expect(ongedekteGezagsClaims(tekst2, telling)).toHaveLength(1);
  });
});

describe("een beurt die regelkennis raadpleegde blijft ongewijzigd streng", () => {
  it("'bevestigd' over een SOURCE_TRANSCRIBED-regel is een ongedekte statusclaim — ook als de zin 'bron' zegt", () => {
    for (const zin of ["De bron is bevestigd.", "Twaalf uur rust (bron: CAO NS, bevestigd).", "Deze regel is bevestigd."]) {
      const ongedekt = ongedekteGezagsClaims(zin, regelTranscriptie);
      expect(ongedekt, zin).toHaveLength(1);
      expect(ongedekt[0].soort).toBe("REGELSTATUS");
    }
  });

  it("met een VALIDATED-regel in de gegevens is de claim gedekt", () => {
    expect(ongedekteGezagsClaims("Deze regel is door NS bevestigd.", regelGevalideerd)).toEqual([]);
  });

  it("knowledgeSearch en data met legalStatus tellen ook zonder toolnaam als regelkennis", () => {
    expect(ongedekteGezagsClaims("De bron is bevestigd.", [{ tool: "knowledgeSearch", ok: true, data: { items: [{ status: "ACTIVE" }] } }])).toHaveLength(1);
    expect(ongedekteGezagsClaims("De bron is bevestigd.", [{ data: { legalStatus: "SOURCE_TRANSCRIBED" } }])).toHaveLength(1);
  });

  it("eerlijke hedging blijft vrij in elke context", () => {
    for (const res of [telling, regelTranscriptie, []]) {
      expect(ongedekteGezagsClaims("Deze regel is nog niet bevestigd door NS.", res)).toEqual([]);
      expect(ongedekteGezagsClaims("Dat is niet formeel vastgesteld.", res)).toEqual([]);
    }
  });
});

describe("bevestiging toegeschreven aan een mens", () => {
  it("is gedekt als de gegevens die menselijke herkomst dragen", () => {
    const zin = "MIX betekent Vroeg/Laat/Nacht; dat is door de gebruiker bevestigd.";
    expect(classificeerGezagsClaims(zin, menselijkeKennis)[0].soort).toBe("MENSELIJK");
    expect(ongedekteGezagsClaims(zin, menselijkeKennis)).toEqual([]);
  });

  it("is ongedekt als de gegevens geen menselijke herkomst hebben — dan is de toeschrijving verzonnen", () => {
    expect(ongedekteGezagsClaims("Dat is door de planner bevestigd.", telling)).toHaveLength(1);
  });

  it("'door de gebruiker en NS bevestigd' is geen menselijke toeschrijving maar een NS-claim", () => {
    const c = classificeerGezagsClaims("Dit is door de gebruiker en NS bevestigd.", menselijkeKennis);
    expect(c[0].soort).not.toBe("MENSELIJK");
  });
});

describe("teruggespeeld over alle bewaarde ruwe antwoorden (docs/v1.0.6/benchmarks)", () => {
  // Bewijsmateriaal, niet aangepast: dit zijn de echte antwoorden van het
  // lokale model uit eerdere metingen, met de echte toolnamen en -data.
  const root = path.resolve(__dirname, "..", "..", "docs", "v1.0.6", "benchmarks");
  type Beurt = { status: string; text: string; tools?: string[]; data?: unknown };
  const beurten: { id: string; beurt: Beurt }[] = [];
  for (const meting of readdirSync(root)) {
    for (const f of readdirSync(path.join(root, meting)).filter((x) => x.endsWith(".json") && !x.includes("grade"))) {
      const j = JSON.parse(readFileSync(path.join(root, meting, f), "utf8")) as { results?: { id: string; turns?: Beurt[] }[] };
      for (const r of j.results ?? []) for (const t of r.turns ?? []) if (t.status === "BEANTWOORD" && typeof t.text === "string") beurten.push({ id: `${meting}/${r.id}`, beurt: t });
    }
  }
  const resultaten = (t: Beurt): ClaimToolResultaat[] => (t.tools ?? []).map((tool) => ({ tool, ok: true, data: t.data }));
  const metClaim = beurten.filter(({ beurt }) => classificeerGezagsClaims(beurt.text, resultaten(beurt)).length > 0);
  const tegengehouden = metClaim.filter(({ beurt }) => ongedekteGezagsClaims(beurt.text, resultaten(beurt)).length > 0);

  it("de oude grendel had hier tientallen correcte antwoorden tegengehouden", () => {
    expect(metClaim.length).toBeGreaterThanOrEqual(30);
  });

  it("alleen antwoorden met een echte normatieve overclaim blijven tegengehouden", () => {
    expect(tegengehouden.map((t) => t.id).sort()).toEqual(["n0/J-geen-verduidelijking-1", "n1/F-DDR-L-weekend"]);
    for (const { beurt } of tegengehouden) {
      expect(ongedekteGezagsClaims(beurt.text, resultaten(beurt)).every((c) => /regels\b/i.test(c.zin))).toBe(true);
    }
  });

  it("de premiecorrecties uit de B-regressie komen weer door", () => {
    const b = metClaim.filter((t) => /\/B-DDR-(50MIX|LN|MIX|V)-omgekeerd$/.test(t.id));
    expect(b.length).toBeGreaterThanOrEqual(4);
    for (const { id, beurt } of b) expect(ongedekteGezagsClaims(beurt.text, resultaten(beurt)), id).toEqual([]);
  });
});

describe("de instructie aan het lokale model veroorzaakt de herkomstzin niet meer", () => {
  it("regelstatus alleen bij het regelbestand; roostergegevens zonder 'bevestigd'", () => {
    const bron = readFileSync(path.resolve(__dirname, "..", "..", "src", "server", "agent", "model", "local.ts"), "utf8");
    expect(bron).not.toContain('"Noem bij een regel altijd de bron en of die bevestigd is.');
    expect(bron).toMatch(/regel uit het regelbestand \(ruleLookup of ruleSearch\)/);
    expect(bron).toMatch(/Roostergegevens \(tellingen, roosterregels, diensten\) zijn geen regels/);
  });
});
