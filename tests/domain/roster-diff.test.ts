import { describe, expect, it } from "vitest";
import { diffRosterDays } from "@/domain/roster-diff";

/**
 * De celvergelijking die `compareVersions` (opgeslagen versies) en
 * `compareRosterSelections` (officieel/kandidaat, §19-§20 van v1.0.6) delen.
 *
 * Vastgelegd bij het herbouwen van "Roosters vergelijken": de vorige versie
 * vergeleek uitsluitend `RosterVersion`-rijen, die pas ontstaan bij publicatie
 * — in een omgeving zonder publicaties bleef het scherm dus altijd leeg. Deze
 * toets legt vast wat de vergelijking zelf hoort te doen, los van waar de
 * dagen vandaan komen.
 */

const dag = (lineNumber: number, weekIndex: number, weekday: number, positionType: string, dutyCode: string | null) => ({
  lineNumber,
  weekIndex,
  weekday,
  positionType,
  dutyCode,
});

describe("diffRosterDays", () => {
  it("markeert een gewijzigde dienst op dezelfde cel als gewijzigd", () => {
    const links = { label: "officieel", days: [dag(1, 1, 1, "DUTY", "112")] };
    const rechts = { label: "kandidaat", days: [dag(1, 1, 1, "DUTY", "107")] };
    const diff = diffRosterDays(links, rechts);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({ lineNumber: 1, weekIndex: 1, weekday: 1, before: "112", after: "107" });
    expect(diff.unchangedCount).toBe(0);
  });

  it("telt een gelijke cel als ongewijzigd, niet als verschil", () => {
    const links = { label: "officieel", days: [dag(1, 1, 1, "DUTY", "112")] };
    const rechts = { label: "kandidaat", days: [dag(1, 1, 1, "DUTY", "112")] };
    const diff = diffRosterDays(links, rechts);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchangedCount).toBe(1);
  });

  it("een cel die alleen links bestaat, telt als 'alleen links' en niet als gewijzigd", () => {
    const links = { label: "officieel", days: [dag(1, 1, 1, "DUTY", "112")] };
    const rechts = { label: "kandidaat", days: [] };
    const diff = diffRosterDays(links, rechts);
    expect(diff.onlyInLeft).toBe(1);
    expect(diff.onlyInRight).toBe(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("verschillende rotatielengtes geven geen verschoven diff, alleen een eerlijke telling per kant", () => {
    // Links: twee lijnen. Rechts: alleen lijn 1, maar met een extra lijn 3
    // die links niet heeft. Dat is precies de situatie uit §19: een kandidaat
    // met een andere rotatielengte dan het officiële rooster.
    const links = { label: "officieel", days: [dag(1, 1, 1, "DUTY", "112"), dag(2, 1, 1, "DUTY", "107")] };
    const rechts = { label: "kandidaat", days: [dag(1, 1, 1, "DUTY", "112"), dag(3, 1, 1, "DUTY", "201")] };
    const diff = diffRosterDays(links, rechts);
    expect(diff.leftLines).toBe(2);
    expect(diff.rightLines).toBe(2); // lijn 1 en lijn 3
    expect(diff.unchangedCount).toBe(1); // lijn 1
    expect(diff.onlyInLeft).toBe(1); // lijn 2
    expect(diff.onlyInRight).toBe(1); // lijn 3
    expect(diff.changed).toHaveLength(0);
  });

  it("een rustdag die een dienst wordt, toont de positietypes en niet 'null'", () => {
    const links = { label: "officieel", days: [dag(1, 1, 2, "RUST", null)] };
    const rechts = { label: "kandidaat", days: [dag(1, 1, 2, "DUTY", "115")] };
    const diff = diffRosterDays(links, rechts);
    expect(diff.changed[0].before).toBe("RUST");
    expect(diff.changed[0].after).toBe("115");
  });
});
