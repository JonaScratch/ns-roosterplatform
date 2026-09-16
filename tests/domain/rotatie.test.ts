import { describe, expect, it } from "vitest";
import {
  type RotationAnchor,
  isoWeekOfDate,
  mondayOfIsoWeek,
  rotationSeries,
  ruleForDate,
  ruleForWeek,
  weeksBetween,
} from "@/domain/roster-rotation";
import { isoWeekKey } from "@/domain/time";

/**
 * De weekrotatie.
 *
 * ## Waarom dit zoveel tests verdient
 *
 * Dit is de rekensom die bepaalt welke dienst iemand over acht maanden rijdt.
 * Hij ziet er eenvoudig uit — optellen en een modulo — en juist daarom is het de
 * plek waar een fout jarenlang onopgemerkt blijft: een rooster dat één week
 * verschoven is, ziet er volstrekt normaal uit.
 *
 * De randen zitten niet in de formule maar in de kalender: week 53, de
 * jaarwisseling, en de zomertijd. Die staan hieronder allemaal apart.
 */

const LAAT_1_LA: RotationAnchor = {
  anchorRuleIndex: 6,
  anchorWeek: "2026-W40",
  lineCount: 12,
};

describe("het voorbeeld uit de opdracht", () => {
  it("loopt van regel 6 door tot regel 12 en dan naar 1", () => {
    const verwacht: Record<string, number> = {
      "2026-W40": 6,
      "2026-W41": 7,
      "2026-W42": 8,
      "2026-W43": 9,
      "2026-W44": 10,
      "2026-W45": 11,
      "2026-W46": 12,
      "2026-W47": 1,
      "2026-W48": 2,
      "2026-W49": 3,
      "2026-W50": 4,
      "2026-W51": 5,
      "2026-W52": 6,
    };
    for (const [week, regel] of Object.entries(verwacht)) {
      expect(ruleForWeek(LAAT_1_LA, week)).toBe(regel);
    }
  });

  it("staat na precies twaalf weken weer op de beginregel", () => {
    const reeks = rotationSeries(LAAT_1_LA, "2026-W40", 13);
    expect(reeks[0].ruleIndex).toBe(6);
    expect(reeks[12].ruleIndex).toBe(6);
    // En elke regel komt in die twaalf weken precies één keer voor.
    const regels = reeks.slice(0, 12).map((week) => week.ruleIndex);
    expect(new Set(regels).size).toBe(12);
  });
});

describe("terug in de tijd", () => {
  it("werkt net zo goed vóór de ankerweek", () => {
    expect(ruleForWeek(LAAT_1_LA, "2026-W39")).toBe(5);
    expect(ruleForWeek(LAAT_1_LA, "2026-W34")).toBe(12);
    expect(ruleForWeek(LAAT_1_LA, "2026-W33")).toBe(11);
  });

  it("levert nooit een regel buiten het rooster op", () => {
    for (let offset = -200; offset <= 200; offset += 1) {
      const week = isoWeekOfDate(
        new Date(Date.UTC(2026, 9, 5) + offset * 7 * 86_400_000).toISOString().slice(0, 10),
      );
      const regel = ruleForWeek(LAAT_1_LA, week);
      expect(regel).toBeGreaterThanOrEqual(1);
      expect(regel).toBeLessThanOrEqual(12);
    }
  });
});

describe("de jaarwisseling", () => {
  it("telt gewoon door van december naar januari", () => {
    // 2026-W53 bestaat niet; 2026 heeft 53 weken? Dat toetst de volgende test.
    const reeks = rotationSeries(LAAT_1_LA, "2026-W51", 6);
    const regels = reeks.map((week) => week.ruleIndex);
    // Zes opeenvolgende weken horen zes opeenvolgende regels te geven, met
    // wikkeling — en de jaargrens verandert daar niets aan.
    for (let index = 1; index < regels.length; index += 1) {
      const verwacht = (regels[index - 1] % 12) + 1;
      expect(regels[index]).toBe(verwacht);
    }
  });

  it("behandelt een jaar met 53 weken zonder sprong", () => {
    // 2026 loopt tot en met W53 (1 januari 2027 valt op een vrijdag).
    const laatsteVan2026 = isoWeekOfDate("2026-12-31");
    const eersteVan2027 = isoWeekOfDate("2027-01-04");
    expect(laatsteVan2026).toBe("2026-W53");
    expect(eersteVan2027).toBe("2027-W01");
    expect(weeksBetween(laatsteVan2026, eersteVan2027)).toBe(1);

    const regelLaatste = ruleForWeek(LAAT_1_LA, laatsteVan2026);
    const regelEerste = ruleForWeek(LAAT_1_LA, eersteVan2027);
    expect(regelEerste).toBe((regelLaatste % 12) + 1);
  });

  it("rekent over een heel jaar precies 52 of 53 stappen", () => {
    const stappen = weeksBetween("2026-W01", "2027-W01");
    expect([52, 53]).toContain(stappen);
  });
});

describe("zomertijd", () => {
  it("verschuift de rotatie niet", () => {
    // De zomertijd gaat in de nacht van 28 op 29 maart 2026 in en eindigt op
    // 25 oktober. Een rotatie die in klokuren zou rekenen, loopt daar mis.
    const voorjaar = rotationSeries(LAAT_1_LA, isoWeekOfDate("2026-03-23"), 3);
    const najaar = rotationSeries(LAAT_1_LA, isoWeekOfDate("2026-10-19"), 3);

    for (const reeks of [voorjaar, najaar]) {
      for (let index = 1; index < reeks.length; index += 1) {
        expect(reeks[index].ruleIndex).toBe((reeks[index - 1].ruleIndex % 12) + 1);
      }
    }
  });

  it("houdt elke dag van dezelfde week op dezelfde regel", () => {
    // Zondag hoort bij dezelfde ISO-week als de maandag ervoor; de regel mag
    // binnen een week niet verspringen.
    const maandag = ruleForDate(LAAT_1_LA, "2026-03-23");
    for (const dag of ["2026-03-24", "2026-03-27", "2026-03-28", "2026-03-29"]) {
      expect(ruleForDate(LAAT_1_LA, dag)).toBe(maandag);
    }
    // En de dag erna hoort bij de volgende week.
    expect(ruleForDate(LAAT_1_LA, "2026-03-30")).toBe((maandag % 12) + 1);
  });
});

describe("de weekrekening zelf", () => {
  it("stemt overeen met de bestaande ISO-weeksleutel", () => {
    for (const datum of [
      "2026-01-01",
      "2026-03-29",
      "2026-06-15",
      "2026-12-28",
      "2026-12-31",
      "2027-01-01",
      "2027-01-04",
    ]) {
      expect(isoWeekOfDate(datum)).toBe(isoWeekKey(datum));
    }
  });

  it("vindt de maandag van elke week terug", () => {
    expect(mondayOfIsoWeek("2026-W40")).toBe("2026-09-28");
    expect(mondayOfIsoWeek("2027-W01")).toBe("2027-01-04");
    expect(isoWeekOfDate(mondayOfIsoWeek("2026-W53"))).toBe("2026-W53");
  });
});

describe("een rooster van één regel", () => {
  it("blijft altijd op regel 1", () => {
    const solo: RotationAnchor = { anchorRuleIndex: 1, anchorWeek: "2026-W40", lineCount: 1 };
    for (const week of ["2026-W40", "2026-W41", "2027-W05"]) {
      expect(ruleForWeek(solo, week)).toBe(1);
    }
  });
});

describe("onmogelijke ankers", () => {
  it("weigert een regel die niet in het rooster bestaat", () => {
    expect(() =>
      ruleForWeek({ anchorRuleIndex: 13, anchorWeek: "2026-W40", lineCount: 12 }, "2026-W41"),
    ).toThrow(/bestaat niet/);
  });

  it("weigert een rooster zonder regels", () => {
    expect(() =>
      ruleForWeek({ anchorRuleIndex: 1, anchorWeek: "2026-W40", lineCount: 0 }, "2026-W41"),
    ).toThrow();
  });

  it("weigert een ankerweek die geen week is", () => {
    expect(() =>
      ruleForWeek({ anchorRuleIndex: 1, anchorWeek: "2026-40", lineCount: 12 }, "2026-W41"),
    ).toThrow();
  });
});

describe("een jaar vooruit", () => {
  it("levert 52 weken zonder gat of dubbeling", () => {
    const reeks = rotationSeries(LAAT_1_LA, "2026-W40", 52);
    expect(reeks.length).toBe(52);
    expect(new Set(reeks.map((week) => week.week)).size).toBe(52);

    // Elke regel komt in 52 weken vier of vijf keer voor: 52 / 12 = 4 rest 4.
    const telling = new Map<number, number>();
    for (const week of reeks) {
      telling.set(week.ruleIndex, (telling.get(week.ruleIndex) ?? 0) + 1);
    }
    for (const aantal of telling.values()) {
      expect([4, 5]).toContain(aantal);
    }
  });
});
