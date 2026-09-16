import { describe, expect, it } from "vitest";
import {
  type RosterDocument,
  SIMULATION_LABEL,
  cellFor,
  escapeHtml,
  renderRosterDocument,
} from "@/server/export/roster-document";

/**
 * Het roosterblad.
 *
 * ## Waarom hier op tekst wordt getoetst en niet op "ziet er goed uit"
 *
 * Een export is een belofte aan iemand die de applicatie niet kan raadplegen.
 * De machinist die dit blad krijgt, kan niet nakijken of het uit een simulatie
 * komt of uit een vastgesteld rooster — hij ziet alleen het papier. Deze tests
 * gaan daarom vooral over wat er op dat papier moet staan en wat er nooit
 * vanaf mag vallen.
 */

const BASIS: RosterDocument = {
  meta: {
    logoDataUri: null,
    locationCode: "DDR",
    locationName: "Dordrecht",
    rosterCode: "DDR-V",
    rosterName: "Vroeg",
    profileLabel: "Vroeg",
    timetableId: "DR2027",
    periodLabel: "2026-12-13 — open",
    changeType: "NEW_TIMETABLE",
    structureState: "STRUCTURE_LOCKED",
    rulesetVersion: "2026.1",
    rulesetMode: "SIMULATION",
    legalStatus: "LEGAL_RULESET_NOT_VERIFIED",
    generatedAt: "2026-09-03 10:00",
    generatedBy: "100001",
    productionSafe: false,
    dutyPackageLabel: "DDR-DR2027-V1",
  },
  lines: [
    { lineNumber: 1, employeeNumber: "100001", weeks: [["043", "043", "R", "R", "118", "RES", "WR"]] },
    { lineNumber: 2, employeeNumber: null, weeks: [["118", "118", "CO", "R", "043", "R", "R"]] },
  ],
};

function render(overrides: Partial<RosterDocument["meta"]> = {}): string {
  return renderRosterDocument({ ...BASIS, meta: { ...BASIS.meta, ...overrides } });
}

describe("het blad vertelt waar het vandaan komt", () => {
  const html = render();

  it("noemt standplaats, rooster en periode", () => {
    expect(html).toContain("DDR");
    expect(html).toContain("Dordrecht");
    expect(html).toContain("DDR-V");
    expect(html).toContain("2026-12-13 — open");
  });

  it("noemt het regelbestand en zijn juridische status", () => {
    expect(html).toContain("2026.1");
    expect(html).toContain("SIMULATION");
    expect(html).toContain("LEGAL_RULESET_NOT_VERIFIED");
  });

  it("noemt het dienstenpakket waaruit de diensten komen", () => {
    expect(html).toContain("DDR-DR2027-V1");
  });

  it("noemt wie het blad heeft opgesteld, met personeelsnummer en niet met naam", () => {
    expect(html).toContain("100001");
  });
});

describe("de export liegt niet", () => {
  it("stempelt een simulatie zichtbaar af", () => {
    const html = render();
    // Drie keer: in de kop, in de metagegevens en over de pagina heen. Wie er
    // één wegknipt, ziet de andere twee nog.
    const treffers = html.split(SIMULATION_LABEL).length - 1;
    expect(treffers).toBeGreaterThanOrEqual(3);
  });

  it("zegt met zoveel woorden dat er geen rechten aan te ontlenen zijn", () => {
    expect(render()).toContain("geen rechten aan worden ontleend");
  });

  it("laat het stempel weg zodra het rooster werkelijk is vastgesteld", () => {
    const html = render({
      productionSafe: true,
      rulesetMode: "PRODUCTION",
      legalStatus: "LEGAL_RULESET_VERIFIED",
    });
    expect(html).not.toContain(SIMULATION_LABEL);
    expect(html).toContain("Vastgesteld roosterblad.");
  });
});

describe("het rooster zelf", () => {
  const html = render();

  it("zet elke lijn met haar bezetting op het blad", () => {
    expect(html).toContain(">1</td><td class=\"mw\">100001</td>");
    // Een onbezette lijn wordt getoond als onbezet en niet weggelaten.
    expect(html).toContain(">2</td><td class=\"mw\">—</td>");
  });

  it("zet elke cyclusdag in het raster", () => {
    const cellen = html.split('class="cel').length - 1;
    expect(cellen).toBe(14);
  });

  it("markeert zaterdag en zondag", () => {
    expect(html).toContain("weekend");
  });

  it("toont ankers als hun code en diensten als hun nummer", () => {
    expect(html).toContain(">RES<");
    expect(html).toContain(">WR<");
    expect(html).toContain(">CO<");
    expect(html).toContain(">043<");
  });
});

describe("celaanduidingen", () => {
  it("zet elk positietype om naar wat op het blad hoort", () => {
    expect(cellFor("DUTY", "043")).toBe("043");
    expect(cellFor("RUST", null)).toBe("R");
    expect(cellFor("RES", null)).toBe("RES");
    expect(cellFor("WR", null)).toBe("WR");
    expect(cellFor("CO", null)).toBe("CO");
  });

  it("laat een dienstdag zonder nummer niet stilzwijgend leeg", () => {
    // Leeg zou als rustdag worden gelezen. Een vraagteken wordt opgemerkt.
    expect(cellFor("DUTY", null)).toBe("?");
  });
});

describe("inhoud uit de database", () => {
  it("wordt ge-escaped en niet als opmaak uitgevoerd", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    const html = renderRosterDocument({
      ...BASIS,
      meta: { ...BASIS.meta, rosterName: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
