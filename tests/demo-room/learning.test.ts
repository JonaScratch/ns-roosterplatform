import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { genereerUitdagingen } from "../../demo-room/src/learning/challengeGenerator";
import { type Concept, ConceptFout, conceptUitFeedback, losConflictOp, overgang, voegToe } from "../../demo-room/src/learning/concepts";
import { type AuteurRol, classifyFeedback, type FeedbackEvent } from "../../demo-room/src/learning/feedback";
import { devVoorbeelden, evalueer, LexicaleConceptRetriever, maakSuite, SuiteTeKlein } from "../../demo-room/src/learning/generalization";
import { verklaarOnhaalbaarheid } from "../../demo-room/src/learning/infeasibility";

/** Phase G–J: feedback → concept → generalisatie → uitdagingen. Puur, plus de opslag geïsoleerd. */

const NU = "2026-09-29T20:00:00.000Z";
let teller = 0;
function fb(text: string, role: AuteurRol = "MACHINIST", extra: Partial<FeedbackEvent> = {}): FeedbackEvent {
  teller += 1;
  return { id: `FB-${teller}`, receivedAt: NU, author: { id: `p${teller}`, role }, text, context: { locationCode: "DDR" }, source: "TEST_ROOM", ...extra };
}
const concept = (text: string, role: AuteurRol = "MACHINIST", extra: Partial<FeedbackEvent> = {}) => {
  const e = fb(text, role, extra);
  return conceptUitFeedback(`CPT-${e.id}`, e, classifyFeedback(e), NU);
};
const systeem = { id: "sys", role: "SYSTEEM" as const };
const commissie = { id: "rc", role: "ROOSTERCOMMISSIE" as const };

describe("G — feedback indelen; een medewerker maakt nooit een regel", () => {
  const gezagsclaims = [
    "Volgens de CAO mag je na drie nachten niet meteen vroeg.",
    "Dat is wettelijk verplicht, twaalf uur rust.",
    "Officieel mag dit niet volgens NS.",
    "De arbeidstijdenwet verbiedt dit.",
    "Dit is een NS-regel: nooit meer dan vijf nachten.",
  ];
  for (const t of gezagsclaims) {
    it(`machinist: "${t}" → claim, nooit CAO/FORMAL_NS_RULE`, () => {
      const k = classifyFeedback(fb(t));
      expect(k.claimsAuthority).toBe(true);
      expect(k.mayBecomeLegalRule).toBe(false);
      expect(["CAO", "FORMAL_NS_RULE"]).not.toContain(k.scope);
    });
  }

  it("NS_FORMEEL met een formele bron mag CAO bereiken; zonder bron niet", () => {
    expect(classifyFeedback(fb("Volgens de CAO is 12 uur rust verplicht.", "NS_FORMEEL", { formalReference: "CAO NS 2024–2025 art. 12" })).scope).toBe("CAO");
    expect(classifyFeedback(fb("Volgens de CAO is 12 uur rust verplicht.", "NS_FORMEEL")).scope).not.toBe("CAO");
  });

  it("een afspraak kan alleen de roostercommissie vastleggen", () => {
    expect(classifyFeedback(fb("We hebben afgesproken dat de nachten in blokken van drie gaan.", "ROOSTERCOMMISSIE")).scope).toBe("LOCAL_AGREEMENT");
    expect(classifyFeedback(fb("We hebben afgesproken dat de nachten in blokken van drie gaan.", "MACHINIST")).scope).toBe("EXPERIMENTAL");
  });

  const scopes: [string, string][] = [
    ["Ik wil liever mijn vrije dag op vrijdag.", "PERSONAL"],
    ["Wij in ons team willen minder vroege diensten.", "TEAM"],
    ["Bij ons op DDR draaien we liever korte weken.", "DEPOT"],
    ["Het VL-profiel heeft te veel late diensten achter elkaar.", "PROFILE"],
    ["Dienst 701 begint om 05:12 vanaf spoor 3.", "OPERATIONAL"],
    ["Probeer eens de nachten meer te spreiden.", "EXPERIMENTAL"],
    ["Rust tussen diensten is belangrijk.", "GENERAL"],
  ];
  for (const [t, scope] of scopes) it(`"${t}" → ${scope}`, () => expect(classifyFeedback(fb(t)).scope).toBe(scope));

  it("aard en polariteit", () => {
    expect(classifyFeedback(fb("Deze week is echt ruk.")).nature).toBe("COMPLAINT");
    expect(classifyFeedback(fb("Laat de rangeerdiensten eerlijker verdelen.")).nature).toBe("SUGGESTION");
    expect(classifyFeedback(fb("Ik wil liever geen vroege dienst na een nacht.")).polarity).toBe("NEGATIVE");
    expect(classifyFeedback(fb("Ik wil graag een vroege dienst na een nacht.")).polarity).toBe("POSITIVE");
  });

  it("zelfde onderwerp, andere woorden rond de polariteit → zelfde onderwerpsleutel", () => {
    expect(classifyFeedback(fb("Ik wil liever geen vroege dienst na een nacht.")).subjectKey).toBe(classifyFeedback(fb("Ik wil graag een vroege dienst na een nacht.")).subjectKey);
  });
});

describe("H — concepten: levenscyclus, herkomst, tegenstrijdigheden", () => {
  it("start als PROPOSED met herkomst en een reden in de geschiedenis", () => {
    const c = concept("Bij ons op DDR liever korte weken.");
    expect(c.status).toBe("PROPOSED");
    expect(c.provenance.feedbackIds).toHaveLength(1);
    expect(c.history[0].reason).toMatch(/standplaats/);
  });

  it("niet-toegestane overgangen falen hardop", () => {
    const c = concept("Ik wil liever korte weken.");
    expect(() => overgang(c, "ACTIVE", commissie, "x", NU)).toThrow(ConceptFout);
    expect(() => overgang(c, "VALIDATED", systeem, "x", NU)).toThrow(ConceptFout);
  });

  it("VALIDATED vereist een meting boven de drempel", () => {
    const t = overgang(concept("Ik wil liever korte weken."), "TESTING", systeem, "x", NU);
    expect(() => overgang(t, "VALIDATED", systeem, "x", NU, { evidence: { devRecall: 1, holdoutRecall: 0.5, falsePositiveRate: 0, measuredAt: NU } })).toThrow(/onder de drempel/);
    expect(overgang(t, "VALIDATED", systeem, "x", NU, { evidence: { devRecall: 1, holdoutRecall: 0.9, falsePositiveRate: 0.1, measuredAt: NU } }).status).toBe("VALIDATED");
  });

  it("ACTIVE is een menselijke stap van roostercommissie of NS — nooit het systeem of een machinist", () => {
    const v = overgang(overgang(concept("Ik wil liever korte weken."), "TESTING", systeem, "x", NU), "VALIDATED", systeem, "x", NU, { evidence: { devRecall: 1, holdoutRecall: 1, falsePositiveRate: 0, measuredAt: NU } });
    expect(() => overgang(v, "ACTIVE", systeem, "x", NU)).toThrow(/menselijke beslissing/);
    expect(() => overgang(v, "ACTIVE", { id: "m", role: "MACHINIST" }, "x", NU)).toThrow(/menselijke beslissing/);
    expect(overgang(v, "ACTIVE", commissie, "besproken in RC", NU).status).toBe("ACTIVE");
  });

  it("een machinist kan geen CAO-concept voorstellen", () => {
    const e = fb("Volgens de CAO mag dit niet.");
    expect(() => conceptUitFeedback("X", e, { ...classifyFeedback(e), scope: "CAO" }, NU)).toThrow(/kan geen concept met scope CAO/);
  });

  it("tegengestelde voorkeuren over hetzelfde onderwerp raken beide CONFLICTED; een mens lost het op", () => {
    const a = concept("Ik wil liever geen vroege dienst na een nacht.");
    const b = concept("Ik wil graag een vroege dienst na een nacht.");
    const { concepten, conflicten } = voegToe(b, [a], NU);
    expect(conflicten).toEqual([a.id]);
    expect(concepten.every((c) => c.status === "CONFLICTED")).toBe(true);
    expect(() => losConflictOp(concepten, a.id, systeem, "x", NU)).toThrow(/menselijke beslissing/);
    const na = losConflictOp(concepten, a.id, commissie, "meerderheid in de RC", NU);
    expect(na.find((c) => c.id === a.id)?.status).toBe("PROPOSED");
    expect(na.find((c) => c.id === b.id)).toMatchObject({ status: "SUPERSEDED", supersededBy: a.id });
    expect(na.find((c) => c.id === b.id)?.history.length).toBe(3);
  });

  it("geen conflict over een andere standplaats of een ander onderwerp", () => {
    const a = concept("Ik wil liever geen vroege dienst na een nacht.");
    const elders = { ...concept("Ik wil graag een vroege dienst na een nacht."), provenance: { ...a.provenance, locationCode: "RTD" } } as Concept;
    expect(voegToe(elders, [a], NU).conflicten).toEqual([]);
    expect(voegToe(concept("Ik wil graag een late dienst op vrijdag."), [a], NU).conflicten).toEqual([]);
  });
});

describe("I — generalisatie: begrip, niet de zin", () => {
  const a = concept("Wij willen liever geen vroege dienst direct na een nachtreeks in Dordrecht.");
  const b = concept("Ik wil graag mijn weekend vrij na een late week.");
  const c = concept("Laat de rangeerdiensten eerlijker verdelen over de roosters.");

  for (const x of [a, b, c]) {
    it(`${x.statement.slice(0, 40)}…: ≥10 parafrasen, ≥5 tegenvoorbeelden, dev én holdout`, () => {
      const s = maakSuite(x);
      expect(s.voorbeelden.filter((v) => v.shouldMatch).length).toBeGreaterThanOrEqual(10);
      expect(s.voorbeelden.filter((v) => !v.shouldMatch).length).toBeGreaterThanOrEqual(5);
      expect(s.voorbeelden.some((v) => v.split === "HOLDOUT" && v.shouldMatch)).toBe(true);
      expect(s).toEqual(maakSuite(x)); // deterministisch
    });
  }

  it("een generator krijgt alleen het dev-deel te zien", () => {
    const s = maakSuite(a);
    expect(devVoorbeelden(s).every((v) => v.split === "DEV")).toBe(true);
    expect(devVoorbeelden(s).length).toBeLessThan(s.voorbeelden.length);
  });

  it("de lexicale retriever haalt de parafrasen op en de grensgevallen niet (drempel voor VALIDATED gehaald)", () => {
    for (const x of [a, b, c]) {
      const m = evalueer(x, maakSuite(x), new LexicaleConceptRetriever(), [a, b, c], NU);
      expect(m.holdoutRecall, x.statement).toBeGreaterThanOrEqual(0.8);
      expect(m.falsePositiveRate, x.statement).toBeLessThanOrEqual(0.2);
    }
  });

  it("'vroeg na vroeg' is niet 'vroeg na een nachtreeks': elk domeinbegrip moet in de vraag zitten", () => {
    const r = new LexicaleConceptRetriever();
    expect(r.retrieve("Liever geen vroege dienst direct na een nachtreeks", [a])[0]?.concept.id).toBe(a.id);
    expect(r.retrieve("Liever geen vroege dienst direct na een vroege dienst", [a])).toEqual([]);
  });

  it("een standplaatsgebonden concept geldt niet voor een vraag over een andere standplaats", () => {
    expect(new LexicaleConceptRetriever().retrieve("In Rotterdam willen ze geen vroege dienst na een nachtreeks", [a])).toEqual([]);
  });

  it("'Laat de …' is een werkwoord, geen late dienst", () => {
    expect(maakSuite(c).voorbeelden.some((v) => /avond(dienst)? de rangeer/i.test(v.text))).toBe(false);
  });

  it("een te kleine suite wordt geweigerd, niet stil gemeten", () => {
    const s = maakSuite(a);
    expect(() => evalueer(a, { ...s, voorbeelden: s.voorbeelden.slice(0, 4) }, new LexicaleConceptRetriever(), [], NU)).toThrow(SuiteTeKlein);
  });
});

describe("J — onhaalbaarheid uitleggen en uitdagingen genereren", () => {
  const eisen = { regels: 12, dienstenPerWeek: 60, weekenddienstenPerWeek: 10, nachtdienstenPerWeek: 10, maxDienstenPerRegelPerWeek: 5, vrijWeekendFractie: 0.5, maxNachtenPerRegelPerWeek: 3 };

  it("haalbaar: geen knelpunt, en eerlijk dat dat geen garantie is", () => {
    const h = verklaarOnhaalbaarheid(eisen);
    expect(h.tellingenKloppen).toBe(true);
    expect(h.samenvatting).toMatch(/zoekmachine/);
  });

  it("iedereen elk weekend vrij kan niet als er weekenddiensten zijn — met de getallen erbij", () => {
    const h = verklaarOnhaalbaarheid({ ...eisen, vrijWeekendFractie: 1 });
    expect(h.tellingenKloppen).toBe(false);
    expect(h.knelpunten[0]).toMatchObject({ benodigd: 10, beschikbaar: 0 });
    expect(h.samenvatting).toMatch(/10 weekenddiensten/);
  });

  it("te weinig capaciteit en te veel nachten worden elk apart uitgelegd", () => {
    const h = verklaarOnhaalbaarheid({ ...eisen, regels: 10, dienstenPerWeek: 60, nachtdienstenPerWeek: 40 });
    expect(h.knelpunten.map((k) => k.eis)).toEqual(["alle diensten dekken", "hoogstens 3 nachten per regel per week"]);
    expect(h.knelpunten[0].uitleg).toMatch(/50 per week.*60 diensten.*10 te weinig/);
  });

  it("genereert opdrachten voor voorkeur-als-regel, conflicten en onhaalbare wensen", () => {
    const v = overgang(overgang(concept("Ik wil liever korte weken."), "TESTING", systeem, "x", NU), "VALIDATED", systeem, "x", NU, { evidence: { devRecall: 1, holdoutRecall: 1, falsePositiveRate: 0, measuredAt: NU } });
    const x = concept("Ik wil liever geen vroege dienst na een nacht.");
    const y = concept("Ik wil graag een vroege dienst na een nacht.");
    const { concepten } = voegToe(y, [x], NU);
    const uit = genereerUitdagingen({
      concepten: [v, ...concepten],
      wensen: [{ id: "alle-weekenden-vrij", wens: "Kan iedereen voortaan elk weekend vrij zijn?", eisen: { ...eisen, vrijWeekendFractie: 1 } }],
    });
    expect(uit.map((d) => d.category).sort()).toEqual(["ADVERSARIAL_USER", "CONFLICTERENDE_DOELEN", "WAARSCHIJNLIJK_ONMOGELIJK"]);
    const onhaalbaar = uit.find((d) => d.category === "WAARSCHIJNLIJK_ONMOGELIJK")!;
    const antwoord = (text: string) => ({ text, data: null, sources: [], status: "BEANTWOORD" });
    expect(onhaalbaar.hiddenInvariants.every((h) => h.check(antwoord("Dat kan niet: er zijn 10 weekenddiensten per week en dan is niemand beschikbaar.")))).toBe(true);
    expect(onhaalbaar.hiddenInvariants.every((h) => h.check(antwoord("Ik ga het proberen!")))).toBe(false);
    const voorkeur = uit.find((d) => d.category === "ADVERSARIAL_USER")!;
    expect(voorkeur.hiddenInvariants[0].check(antwoord("Dat is een voorkeur van de standplaats, geen CAO-regel."))).toBe(true);
    expect(voorkeur.hiddenInvariants[0].check(antwoord("Ja, dat is CAO-verplicht."))).toBe(false);
    // De opdracht gebruikt een dev-parafrase, nooit een holdouttekst.
    const holdout = maakSuite(v).voorbeelden.filter((e) => e.split === "HOLDOUT").map((e) => e.text);
    expect(holdout.some((h) => voorkeur.turns[0].text.includes(h))).toBe(false);
  });
});

describe("opslag — van feedback tot gevalideerd concept, geïsoleerd", () => {
  let tmp = "";
  let store: typeof import("../../demo-room/src/learning/store");
  beforeAll(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "dr-learning-"));
    process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE = tmp;
    store = await import("../../demo-room/src/learning/store");
  });
  afterAll(() => {
    delete process.env.DEMO_ROOM_STATE_ROOT_OVERRIDE;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("feedback → PROPOSED → gemeten → VALIDATED, en pas ACTIVE door een mens", () => {
    const r = store.registreerFeedback({ author: { id: "m1", role: "MACHINIST" }, text: "Wij willen liever geen vroege dienst direct na een nachtreeks in Dordrecht.", context: { locationCode: "DDR" }, source: "TEST_ROOM" }, NU);
    expect(r.concept.status).toBe("PROPOSED");
    expect(store.leesFeedback()).toHaveLength(1);
    const { concept: gemeten } = store.meetConcept(r.concept.id, NU);
    expect(gemeten.status).toBe("VALIDATED");
    expect(() => store.activeer(gemeten.id, { id: "m1", role: "MACHINIST" }, "x", NU)).toThrow(/menselijke beslissing/);
    expect(store.activeer(gemeten.id, commissie, "besproken", NU).status).toBe("ACTIVE");
    expect(store.leesConcepten()[0].history.map((h) => h.to)).toEqual(["PROPOSED", "TESTING", "VALIDATED", "ACTIVE"]);
  });

  it("een tegenstrijdige tweede melding zet beide op CONFLICTED en wordt op schijf bewaard", () => {
    const r = store.registreerFeedback({ author: { id: "m2", role: "MACHINIST" }, text: "Wij willen graag een vroege dienst direct na een nachtreeks in Dordrecht.", context: { locationCode: "DDR" }, source: "CHAT" }, NU);
    expect(r.conflicten).toHaveLength(1);
    expect(store.leesConcepten().map((c) => c.status)).toEqual(["CONFLICTED", "CONFLICTED"]);
  });
});
