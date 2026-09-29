import { describe, expect, it } from "vitest";
import { afwezigheidsMelding, citaatVoorbehoud, nietCiteerbareBronnen, verzonnenAfwezigheden, vraagtOmCitaat } from "@/server/agent/bron-afwezigheid";
import { grondingsMelding, ongegrondeVermeldingen } from "@/server/agent/grounding";
import { begrippenIn } from "@/server/agent/vocabulary";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { bronTekst, letterlijkCiteerbaar } from "@/server/rules-engine/ruleset/source-text";
import { grendelVan } from "../../scripts/v106/grendel-regel";

/**
 * Faalklassen uit AFTER-run 20260929-234655, generiek gerepareerd. Alle
 * zinnen hieronder zijn eigen parafrasen; niets komt uit de locked holdout.
 */

describe("bronstatus per document (source-text.ts)", () => {
  it("elk document in het actieve regelbestand heeft een bekende tekststatus", () => {
    const documenten = new Set(activeRuleset().rules.map((r) => r.source.document));
    for (const d of documenten) expect(bronTekst(d), d).not.toBeNull();
  });
  it("de CAO is citeerbaar; de ondertekende regionale kaders (scan) niet; productbeleid is geen document", () => {
    expect(letterlijkCiteerbaar(bronTekst("CAO-NS-2024-2025"))).toBe(true);
    expect(bronTekst("ROOSTERKADERS-REGIO-WEST-2026")).toMatchObject({ access: "SCAN_NO_TEXT_LAYER", transcriptionStatus: "HUMAN_REVIEW_REQUIRED" });
    expect(letterlijkCiteerbaar(bronTekst("ROOSTERKADERS-REGIO-WEST-2026"))).toBe(false);
    expect(bronTekst("NS-ROOSTERPLATFORM")?.access).toBe("NO_EXTERNAL_DOCUMENT");
    expect(bronTekst("ONBEKEND")).toBeNull();
  });
});

describe("verzonnen afwezigheid", () => {
  it("een document als onderwerp van 'bevat/zegt niets' wordt herkend", () => {
    for (const zin of [
      "De CAO zegt niets over pauzes tijdens een rangeerdienst.",
      "Het brondocument 'Afspraken 2031' bevat geen bepaling over reservedagen.",
      "In de roosterkaders staat niets over het aantal vrije zondagen.",
      "Dit document noemt geen maximum voor opeenvolgende laatdiensten.",
    ]) expect(verzonnenAfwezigheden(zin), zin).toHaveLength(1);
  });
  it("wie zegt wat hij wél of niet kon vinden, doet niets verkeerd", () => {
    for (const zin of [
      "In de gegevens die ik kon raadplegen staat geen tekst uit het document over pauzes.",
      "Ik vond in het regelbestand niets over pauzes tijdens een rangeerdienst.",
      "De regel noemt een minimum van 11 uur rust.",
      "Er is geen wiskundige definitie van de maatstaf.",
    ]) expect(verzonnenAfwezigheden(zin), zin).toEqual([]);
  });
});

describe("citaatverzoek bij een bron zonder tekst", () => {
  const resultaten = [
    { tool: "ruleSearch", data: { hits: [{ title: "Rust tussen diensten", statusText: "letterlijk overgenomen", source: { documentTitle: "Cao X", textAccess: "MACHINE_READABLE" } }, { title: "Zondagen vrij", statusText: "meerdere lezingen", rationale: "Het kader noemt een streefwaarde.", source: { documentTitle: "Kader Y", textAccess: "SCAN_NO_TEXT_LAYER" } }] } },
  ];
  const uitleg = (t: string) => (t === "Kader Y" ? "Het document is een scan zonder tekstlaag; alleen een concept-transcriptie bestaat." : null);

  it("herkent vragen om de letterlijke tekst, niet gewone vragen", () => {
    expect(vraagtOmCitaat("Wat is de letterlijke tekst van dat artikel?")).toBe(true);
    expect(vraagtOmCitaat("Kun je de exacte bewoording geven?")).toBe(true);
    expect(vraagtOmCitaat("Citeer de bepaling over zondagen.")).toBe(true);
    expect(vraagtOmCitaat("Hoeveel uur rust moet er tussen twee diensten zitten?")).toBe(false);
  });
  it("alleen documenten zonder tekstlaag krijgen een voorbehoud", () => {
    const bronnen = nietCiteerbareBronnen(resultaten, uitleg);
    expect(bronnen.map((b) => b.documentTitle)).toEqual(["Kader Y"]);
    expect(citaatVoorbehoud(bronnen)).toMatch(/Kader Y.*scan zonder tekstlaag.*niet als vaststaande tekst/);
    expect(citaatVoorbehoud([])).toBeNull();
  });
  it("de vervangende melding bij een verzonnen afwezigheid zegt wat er wél gevonden is, en de bronstatus", () => {
    const m = afwezigheidsMelding(resultaten, nietCiteerbareBronnen(resultaten, uitleg));
    expect(m.startsWith("Ik hield mijn eigen antwoord tegen")).toBe(true);
    expect(m).toMatch(/Wat ik wel vond: Rust tussen diensten .*Zondagen vrij/);
    expect(m).toMatch(/concept-transcriptie/);
    expect(verzonnenAfwezigheden(m)).toEqual([]);
    expect(grendelVan(m, "NIET_VAST_TE_STELLEN")).toBe("AFWEZIGHEID");
  });
});

describe("domeinwoordenboek: een term binnen een langere dagdeelcombinatie", () => {
  it("'vroeg-laat' en 'laat-nacht' vallen weg binnen een drie-dagdelen-samenstelling", () => {
    expect(begrippenIn("Klopt het dat het profiel ooit vroeg-laat-nacht werd genoemd?")).toEqual([]);
    expect(begrippenIn("Bestaat er een vroeg/laat/nacht-variant?")).toEqual([]);
  });
  it("de gewone treffers blijven: ook met een achtervoegsel dat geen dagdeel is", () => {
    const termen = (t: string) => begrippenIn(t).map((b) => b.termen[0]);
    expect(termen("Hoeveel nachten heeft het Laat/Nacht-rooster?")).toEqual(["ln"]);
    expect(termen("Is vroeg-laat zwaarder dan het BLM-rooster?")).toEqual(["vl", "blm"]);
    expect(termen("Wat is een RET-dienst?")).toContain("ret");
  });
});

describe("grondingsmelding", () => {
  const los = [{ soort: "regelidentificatie", waarde: "FOO_BAR", bestaatWel: false }];
  it("een lege zoekopdracht blijft zichtbaar: niet gevonden is niet bevestigd, en niet uitgesloten", () => {
    const m = grondingsMelding(los, { intent: "REGELVRAAG", nietsGevonden: [{ waar: "het regelbestand", zoekterm: "oude profielnaam" }] });
    expect(m).toMatch(/zocht in het regelbestand naar "oude profielnaam" en vond niets/);
    expect(m).toMatch(/niet bevestigd, maar ook niet uitgesloten/);
    expect(m).not.toMatch(/basisrooster/);
  });
  it("bij een roostervraag blijft de aanwijzing om het rooster te noemen", () => {
    expect(grondingsMelding(los, { intent: "ROOSTERVRAAG" })).toMatch(/basisrooster/);
    expect(grondingsMelding(los)).toMatch(/basisrooster/);
  });
  it("wat het platform zelf aanreikte, geldt als gegrond", () => {
    const vraag = "Is het vroeg-laat-rooster zwaarder?";
    const platform = begrippenIn(vraag).map((b) => b.betekenis).join(" ");
    expect(ongegrondeVermeldingen("Het profiel VROEG_LAAT hoort bij DDR-VL.", "")).not.toEqual([]);
    expect(ongegrondeVermeldingen("Het profiel VROEG_LAAT hoort bij DDR-VL.", platform)).toEqual([]);
  });
});
