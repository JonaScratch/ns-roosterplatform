import { describe, expect, it } from "vitest";
import { gezagsClaims, isGedektDoorGegevens, ongedekteGezagsClaims } from "@/server/agent/claim-verification";

/**
 * § LYRA MASTER PROGRAM, fase 8 (claim-verificatie, voorbereiding). Puur
 * functioneel — geen database, geen model. Dekt exact het gat dat de fase-0-
 * inventaris vaststelde: de bestaande regressietoets in scripts/verify-
 * agent.ts bevat het woord "bevestigd" in de testinvoer zonder het als
 * claim te herkennen. Deze tests bewijzen dat de nieuwe detector dat wél
 * doet — en, minstens zo belangrijk, dat hij een eerlijk gehedgede zin NIET
 * ten onrechte afkeurt.
 */
describe("gezagsClaims — positieve gezagsclaims herkennen", () => {
  it("herkent 'is bevestigd'", () => {
    const claims = gezagsClaims("Deze regel over het artikel 'Reserverooster' is bevestigd.");
    expect(claims).toHaveLength(1);
    expect(claims[0].signaalwoord).toBe("bevestigd");
  });

  it("herkent 'formeel vastgesteld'", () => {
    const claims = gezagsClaims("Dit is formeel vastgesteld door NS.");
    expect(claims.some((c) => c.signaalwoord === "formeel")).toBe(true);
  });

  it("herkent 'officieel bevestigd'", () => {
    const claims = gezagsClaims("De regel is officieel bevestigd.");
    expect(claims.some((c) => c.signaalwoord === "officieel" || c.signaalwoord === "bevestigd")).toBe(true);
  });

  it("herkent 'CAO-verplicht'", () => {
    const claims = gezagsClaims("Deze rusttijd is CAO-verplicht.");
    expect(claims.some((c) => c.signaalwoord === "verplicht")).toBe(true);
  });

  it("herkent 'dit is een CAO-regel'", () => {
    const claims = gezagsClaims("Dit is een CAO-regel, dus hard.");
    expect(claims.some((c) => c.signaalwoord === "CAO-regel")).toBe(true);
  });

  it("vindt niets in een gewone, feitelijke zin zonder gezagstaal", () => {
    expect(gezagsClaims("Dit rooster heeft 41 vroege diensten en 0 late diensten.")).toHaveLength(0);
  });
});

describe("gezagsClaims — negatie ontkracht de claim (geen vals alarm op eerlijke hedging)", () => {
  it("'nog niet bevestigd' wordt NIET als claim gezien", () => {
    expect(gezagsClaims("Deze regel is nog niet bevestigd door NS.")).toHaveLength(0);
  });

  it("'niet formeel vastgesteld' wordt NIET als claim gezien", () => {
    expect(gezagsClaims("Dit is niet formeel vastgesteld.")).toHaveLength(0);
  });

  it("'geen officiële bevestiging' bevat het patroon niet (ander woordvorm) en levert dus terecht niets op", () => {
    expect(gezagsClaims("Er is geen officiële bevestiging van deze regel.")).toHaveLength(0);
  });

  it("de letterlijke historische testzin uit scripts/verify-agent.ts (artikel 'Reserverooster', bevestigd) — bewust WEL een claim, want niet ontkracht", () => {
    // Dit is exact de zin die de fase-0-inventaris citeerde als gemist geval.
    const claims = gezagsClaims("...artikel 'Reserverooster', bevestigd");
    expect(claims.length).toBeGreaterThan(0);
  });
});

describe("isGedektDoorGegevens / ongedekteGezagsClaims — dekking via een echt VALIDATED-toolresultaat", () => {
  const gevalideerdResultaat = [{ data: { ruleId: "RP_TEST", legalStatus: "VALIDATED", statusText: "door NS bevestigd" } }];
  const nietGevalideerdResultaat = [{ data: { ruleId: "RP_TEST", legalStatus: "SOURCE_TRANSCRIBED", statusText: "letterlijk overgenomen, niet formeel bevestigd" } }];

  it("isGedektDoorGegevens is waar bij een VALIDATED-signaal", () => {
    expect(isGedektDoorGegevens(gevalideerdResultaat)).toBe(true);
  });

  it("isGedektDoorGegevens is onwaar zonder VALIDATED-signaal", () => {
    expect(isGedektDoorGegevens(nietGevalideerdResultaat)).toBe(false);
    expect(isGedektDoorGegevens([])).toBe(false);
  });

  it("ongedekteGezagsClaims geeft niets terug als een VALIDATED-toolresultaat de claim dekt", () => {
    expect(ongedekteGezagsClaims("Deze regel is bevestigd.", gevalideerdResultaat)).toHaveLength(0);
  });

  it("ongedekteGezagsClaims geeft de claim terug als er geen VALIDATED-toolresultaat is — het exacte gat uit de fase-0-inventaris", () => {
    const ongedekt = ongedekteGezagsClaims("Deze regel is bevestigd.", nietGevalideerdResultaat);
    expect(ongedekt).toHaveLength(1);
    expect(ongedekt[0].signaalwoord).toBe("bevestigd");
  });

  it("ongedekteGezagsClaims geeft niets terug als er simpelweg geen gezagstaal in de tekst staat, ook zonder toolresultaten", () => {
    expect(ongedekteGezagsClaims("Dit rooster heeft 41 vroege diensten.", [])).toHaveLength(0);
  });
});
