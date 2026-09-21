import { describe, expect, it } from "vitest";
import { PLATEAU_RONDES, VERBETERDREMPEL, rondeBesluit } from "@/server/agent/research";

/**
 * De beslisregels van de onderzoekslus, zonder zoekmachine.
 *
 * Deze regels bepalen of de agent doorgaat, stopt, of moet toegeven dat hij
 * niets beters heeft gevonden. Ze horen toetsbaar te zijn zonder dat er drie
 * minuten gerekend wordt — anders zijn ze in de praktijk nooit getoetst op het
 * geval dat ertoe doet: het geval waarin er niets te vinden is.
 */

const basis = { ronde: 1, maxRondes: 4, uitgangspunt: 80, beste: 80, zonderVerbeteringTotNu: 0, heeftKandidaat: true };

describe("wanneer de lus doorgaat", () => {
  it("gaat door na een echte verbetering", () => {
    const b = rondeBesluit({ ...basis, nieuweScore: 83 });
    expect(b.verbeterd).toBe(true);
    expect(b.decision).toBe("DOORGAAN");
    expect(b.conclusion).toBeNull();
    expect(b.zonderVerbetering).toBe(0);
  });

  it("telt een verwaarloosbaar verschil niet als verbetering", () => {
    const b = rondeBesluit({ ...basis, nieuweScore: 80 + VERBETERDREMPEL / 2 });
    expect(b.verbeterd).toBe(false);
    expect(b.zonderVerbetering).toBe(1);
  });
});

describe("wanneer de lus stopt", () => {
  it("stopt na twee rondes zonder verbetering", () => {
    const b = rondeBesluit({ ...basis, ronde: 2, nieuweScore: 79.5, zonderVerbeteringTotNu: PLATEAU_RONDES - 1 });
    expect(b.decision).toBe("STOPPEN_GEEN_VERBETERING");
    expect(b.conclusion).toBeTruthy();
  });

  it("zegt eerlijk dat er niets beters is gevonden", () => {
    const b = rondeBesluit({ ...basis, ronde: 2, nieuweScore: 79, zonderVerbeteringTotNu: 1 });
    expect(b.conclusion).toMatch(/geen betere geldige kandidaat gevonden/i);
    expect(b.conclusion).toMatch(/dat is de uitkomst/i);
  });

  it("meldt een gevonden verbetering bij het stoppen, met beide getallen", () => {
    const b = rondeBesluit({ ...basis, ronde: 3, beste: 85, nieuweScore: 84, zonderVerbeteringTotNu: 1 });
    expect(b.conclusion).toMatch(/85\.0/);
    expect(b.conclusion).toMatch(/80\.0/);
  });

  it("stopt bij het rondebudget en noemt dat als reden", () => {
    const b = rondeBesluit({ ...basis, ronde: 4, maxRondes: 4, nieuweScore: 86 });
    expect(b.decision).toBe("STOPPEN_BUDGET");
    expect(b.conclusion).toMatch(/budget van 4 rondes/);
  });

  it("verzwijgt bij een opgebruikt budget niet dat er niets beters was", () => {
    const b = rondeBesluit({ ...basis, ronde: 4, maxRondes: 4, nieuweScore: 80 });
    expect(b.conclusion).toMatch(/niets gevonden dat beter is/i);
  });
});

describe("een ronde zonder kandidaat", () => {
  it("telt als 'geen verbetering' en zegt waarom", () => {
    const b = rondeBesluit({ ...basis, nieuweScore: null, heeftKandidaat: false });
    expect(b.verbeterd).toBe(false);
    expect(b.reason).toMatch(/geen geldige kandidaat/i);
    expect(b.zonderVerbetering).toBe(1);
  });
});
