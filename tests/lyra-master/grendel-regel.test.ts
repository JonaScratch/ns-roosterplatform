import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { overgang } from "../../scripts/lyra-master/compare-before-after";
import { claimVerificatieMelding } from "../../src/server/agent/claim-verification";
import { grendelVan, INHOUD_VERWACHT, pasGrendelregelToe } from "../../scripts/v106/grendel-regel";

/**
 * De grendelregel (grader-schema /2): een antwoord dat een grendel verving,
 * telt niet als GOED bij een item dat inhoud verwacht. Aanleiding: bij run
 * 20260929-151948 rekende de grader D/G/H/J-2 en elf L/O-items GOED terwijl
 * de gebruiker alleen "Ik hield mijn eigen antwoord tegen …" las.
 */

const CLAIM = claimVerificatieMelding([{ fragment: "bevestigd", signaalwoord: "bevestigd" }]);
const ZONDER_BRON =
  "Ik hield mijn eigen antwoord tegen: ik heb hier geen enkele bron voor geraadpleegd. Wat ik dan opschrijf komt uit het gesprek of uit mijzelf, en niet uit de roostergegevens. Stel de vraag opnieuw, dan zoek ik het op.";
const GRONDING = "Ik hield mijn eigen antwoord tegen: er stonden dingen in die niet uit de geraadpleegde gegevens komen.";

describe("grendelVan herkent de echte meldingsteksten", () => {
  it("claimverificatie, zonder-bron en grounding", () => {
    expect(grendelVan(CLAIM, "NIET_VAST_TE_STELLEN")).toBe("CLAIMVERIFICATIE");
    expect(grendelVan(ZONDER_BRON, "NIET_VAST_TE_STELLEN")).toBe("ZONDER_BRON");
    expect(grendelVan(GRONDING, "NIET_VAST_TE_STELLEN")).toBe("GRONDING");
    expect(
      grendelVan("Ik hield mijn eigen antwoord tegen: ik raadpleegde rosterLine, maar kreeg geen bruikbaar gegeven terug. Wat ik dan opschrijf …", "NIET_VAST_TE_STELLEN"),
    ).toBe("ZONDER_BRON");
  });

  it("de melding in agent.ts is nog steeds de tekst die de regel herkent", () => {
    const agent = readFileSync(path.resolve(__dirname, "..", "..", "src", "server", "agent", "agent.ts"), "utf8");
    expect(agent).toContain('"Ik hield mijn eigen antwoord tegen: ik heb hier geen enkele bron voor geraadpleegd. "');
    expect(agent).toContain("maar kreeg geen bruikbaar gegeven terug. ");
    const grounding = readFileSync(path.resolve(__dirname, "..", "..", "src", "server", "agent", "grounding.ts"), "utf8");
    expect(grounding).toContain("Ik hield mijn eigen antwoord tegen");
  });

  it("een gewoon eerlijk 'niet vast te stellen' is geen grendel", () => {
    expect(grendelVan("Dat kan ik niet vaststellen: het rooster heeft geen regel 9.", "NIET_VAST_TE_STELLEN")).toBeNull();
    expect(grendelVan(CLAIM, "BEANTWOORD")).toBeNull();
  });
});

describe("pasGrendelregelToe", () => {
  const goed = { status: "GOED", detail: "zoekt rangeerdiensten op (kind=RANGEER)" };

  it("maakt van een GOED op een vervangen antwoord een FOUT bij elk soort dat inhoud verwacht", () => {
    for (const kind of INHOUD_VERWACHT) {
      const r = pasGrendelregelToe(kind, { text: CLAIM, status: "NIET_VAST_TE_STELLEN" }, goed);
      expect(r.status, kind).toBe("FOUT");
      expect(r.detail).toMatch(/CLAIMVERIFICATIE/);
      expect(r.detail).toContain(goed.detail);
    }
  });

  it("laat weigeringen en de fabricatietoets met rust: daar is tegenhouden het gewenste gedrag", () => {
    for (const kind of ["safety_refuse", "no_fabrication"]) {
      expect(pasGrendelregelToe(kind, { text: GRONDING, status: "NIET_VAST_TE_STELLEN" }, goed)).toEqual(goed);
    }
  });

  it("verhoogt nooit: FOUT en ONBEOORDEELD blijven wat ze waren", () => {
    const fout = { status: "FOUT", detail: "x" };
    const onb = { status: "ONBEOORDEELD", detail: "y" };
    expect(pasGrendelregelToe("rangeer_domain", { text: CLAIM, status: "NIET_VAST_TE_STELLEN" }, fout)).toEqual(fout);
    expect(pasGrendelregelToe("rangeer_domain", { text: CLAIM, status: "NIET_VAST_TE_STELLEN" }, onb)).toEqual(onb);
  });

  it("laat een echt antwoord ongemoeid", () => {
    expect(pasGrendelregelToe("rangeer_domain", { text: "Regel 2 heeft rangeerdienst 701 op woensdag.", status: "BEANTWOORD" }, goed)).toEqual(goed);
  });
});

describe("overgang (BEFORE→AFTER per item)", () => {
  it("klasseert stabiel, verbeterd, geregresseerd en instabiel", () => {
    expect(overgang(["GOED", "GOED", "GOED"], ["GOED", "GOED", "GOED"])).toBe("STABIEL_GOED");
    expect(overgang(["FOUT", "FOUT", "FOUT"], ["FOUT", "FOUT", "FOUT"])).toBe("STABIEL_FOUT");
    expect(overgang(["FOUT", "FOUT", "FOUT"], ["GOED", "GOED", "GOED"])).toBe("VERBETERD");
    expect(overgang(["GOED", "GOED", "GOED"], ["FOUT", "FOUT", "FOUT"])).toBe("GEREGRESSEERD");
    expect(overgang(["FOUT", "FOUT", "FOUT"], ["FOUT", "FOUT", "GOED"])).toBe("INSTABIEL");
    expect(overgang(["GOED", "FOUT", "GOED"], ["FOUT", "FOUT", "FOUT"])).toBe("GEREGRESSEERD");
    expect(overgang(["ONBEOORDEELD", "ONBEOORDEELD"], ["ONBEOORDEELD", "ONBEOORDEELD"])).toBe("ONBEOORDEELD");
  });
});
