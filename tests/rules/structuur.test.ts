import { describe, expect, it } from "vitest";
import type { BaselineSlot, ProposedSlot } from "@/domain/roster-structure";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { evaluateCheck } from "@/server/rules-engine/adapter";
import { evaluateStructuralChange } from "@/server/rules-engine/structure-change";
import type { RosterPositionType } from "@/lib/generated/prisma/enums";
import { LATE_DIENST, VROEG_DIENST, medewerker, overtredingen, toets } from "./fixtures";

/**
 * De vergrendeling van de roosterstructuur.
 *
 * ## Wat deze tests werkelijk bewaken
 *
 * Niet dat er een melding komt. Dat een melding komt langs élke route. De
 * verleiding bij deze functie is om hem in het wijzigingsscherm te zetten: daar
 * ziet de planner hem, daar werkt hij, en daar is hij klaar. Maar een
 * wijzigingsblad kan ook uit een import komen, uit een simulatie of uit een
 * beheerdersactie, en die routes zien dat scherm nooit. Vandaar dat hier twee
 * ingangen worden getoetst — de dienstvalidator en de structuurwijziging — en
 * dat ze op dezelfde vergelijking moeten uitkomen.
 */

const DATUM = "2025-09-09";

function baseline(slotType: RosterPositionType, overrides: Partial<BaselineSlot> = {}): BaselineSlot {
  return {
    baseRosterCode: "DDR-V",
    lineNumber: 3,
    weekIndex: 2,
    weekday: 2,
    slotType,
    structuralAnchor: slotType !== "DUTY",
    dutyCode: null,
    ...overrides,
  };
}

/** De structurele bevindingen van een dienstplaatsing. */
function plaats(opties: {
  changeType?: "NEW_TIMETABLE" | "AMENDMENT";
  baselineSlot?: BaselineSlot | null;
}): string[] {
  const uitkomst = evaluateCheck(
    toets({
      date: DATUM,
      changeType: opties.changeType,
      baselineSlot: opties.baselineSlot,
      planningStage: "BASE_ROSTER",
    }),
    "BASE_ROSTER_GENERATION",
  );
  return overtredingen(uitkomst.findings);
}

/** Een slotwijziging zonder dienst: van het ene positietype naar het andere. */
function wijzig(
  from: RosterPositionType,
  to: RosterPositionType,
  changeType: "NEW_TIMETABLE" | "AMENDMENT" = "AMENDMENT",
) {
  const proposed: ProposedSlot = { kind: "POSITION", slotType: to };
  return evaluateStructuralChange({
    changeType,
    date: DATUM,
    baseline: baseline(from),
    proposed,
    employeeGroup: "MACHINIST",
    company: "NSR",
    location: "DDR",
    scope: "DDR-V/3",
  });
}

describe("nieuwe dienstregeling", () => {
  it("laat de structuur opnieuw bepalen: een rustdag mag een dienst worden", () => {
    // De ronde waarin de structuur juist ter discussie staat. Dat de overige
    // regels akkoord zijn, is elders getoetst; hier telt alleen dat de
    // ankervergrendeling zich niet meldt.
    expect(plaats({ changeType: "NEW_TIMETABLE", baselineSlot: baseline("RUST") })).not.toContain(
      RULE.ROSTER_ANCHOR_LOCKED,
    );
  });

  it("laat ook een verschuiving tussen ankers toe", () => {
    expect(wijzig("WR", "RES", "NEW_TIMETABLE").decision).toBe("ALLOW");
  });

  it("geldt als er geen wijzigingssoort is meegegeven", () => {
    // Het veilige gedrag bij een ontbrekende waarde is hier níet blokkeren: de
    // structuur vaststellen hoort bij een nieuwe dienstregeling, en die is de
    // aanname. Wie een wijzigingsblad doet, zegt dat expliciet.
    expect(plaats({ baselineSlot: baseline("RUST") })).not.toContain(RULE.ROSTER_ANCHOR_LOCKED);
  });
});

describe("wijzigingsblad: ankers liggen vast", () => {
  it("blokkeert een dienst op een rustdag", () => {
    const bevindingen = plaats({ changeType: "AMENDMENT", baselineSlot: baseline("RUST") });
    expect(bevindingen).toContain(RULE.ROSTER_ANCHOR_LOCKED);
  });

  it("blokkeert een dienst op een WTV-/vrije dag", () => {
    expect(plaats({ changeType: "AMENDMENT", baselineSlot: baseline("WR") })).toContain(
      RULE.ROSTER_ANCHOR_LOCKED,
    );
  });

  it("blokkeert een dienst op een compensatiedag", () => {
    expect(plaats({ changeType: "AMENDMENT", baselineSlot: baseline("CO") })).toContain(
      RULE.ROSTER_ANCHOR_LOCKED,
    );
  });

  it("blokkeert een dienst op een reservedag", () => {
    expect(plaats({ changeType: "AMENDMENT", baselineSlot: baseline("RES") })).toContain(
      RULE.ROSTER_ANCHOR_LOCKED,
    );
  });

  it("blokkeert WTV → reserve", () => {
    const uitkomst = wijzig("WR", "RES");
    expect(uitkomst.decision).toBe("BLOCK");
    expect(uitkomst.violations.map((v) => v.ruleId)).toContain(RULE.ROSTER_ANCHOR_LOCKED);
  });

  it("blokkeert reserve → rust", () => {
    expect(wijzig("RES", "RUST").decision).toBe("BLOCK");
  });

  it("blokkeert rust → compensatiedag", () => {
    expect(wijzig("RUST", "CO").decision).toBe("BLOCK");
  });

  it("laat een anker dat gelijk blijft ongemoeid", () => {
    expect(wijzig("RUST", "RUST").decision).toBe("ALLOW");
  });

  it("staat een ander dienstnummer op een dienstdag toe: 101 → 105", () => {
    // De dag was al een dienstdag. Welk nummer erop komt, is een vraag voor de
    // overige regels — niet voor de structuur.
    const was = baseline("DUTY", { structuralAnchor: false, dutyCode: "101" });
    const bevindingen = plaats({ changeType: "AMENDMENT", baselineSlot: was });
    expect(bevindingen).not.toContain(RULE.ROSTER_ANCHOR_LOCKED);

    const uitkomst = evaluateStructuralChange({
      changeType: "AMENDMENT",
      date: DATUM,
      baseline: was,
      proposed: { kind: "DUTY", dutyCode: "105" },
      employeeGroup: "MACHINIST",
      company: "NSR",
      location: "DDR",
      scope: "DDR-V/3",
    });
    expect(uitkomst.decision).toBe("ALLOW");
  });

  it("noemt in de melding welk anker het was en wat ervan gemaakt zou worden", () => {
    const uitkomst = evaluateCheck(
      toets({
        date: DATUM,
        changeType: "AMENDMENT",
        baselineSlot: baseline("RUST"),
        planningStage: "BASE_ROSTER",
      }),
      "BASE_ROSTER_GENERATION",
    );
    const melding = uitkomst.findings.find((f) => f.ruleId === RULE.ROSTER_ANCHOR_LOCKED);
    expect(melding?.message).toContain("rustdag");
    expect(melding?.message).toContain(VROEG_DIENST.code);
    expect(melding?.details).toMatchObject({ baselineSlotType: "RUST", proposedSlotType: "DUTY" });
  });
});

describe("wijzigingsblad zonder baseline", () => {
  it("blokkeert in plaats van door te laten", () => {
    // Zonder vastgelegde structuur is niet vast te stellen óf er een anker
    // verschuift. Dat is geen groen licht.
    const uitkomst = evaluateCheck(
      toets({
        date: DATUM,
        changeType: "AMENDMENT",
        baselineSlot: null,
        planningStage: "BASE_ROSTER",
      }),
      "BASE_ROSTER_GENERATION",
    );
    expect(uitkomst.decision).toBe("BLOCK");
    expect(uitkomst.missingRules.map((m) => m.ruleId)).toContain("ROSTER_STRUCTURE_BASELINE");
  });

  it("blokkeert ook bij een slotwijziging", () => {
    const uitkomst = evaluateStructuralChange({
      changeType: "AMENDMENT",
      date: DATUM,
      baseline: null,
      proposed: { kind: "POSITION", slotType: "RES" },
      employeeGroup: "MACHINIST",
      company: "NSR",
      location: "DDR",
      scope: "DDR-V/3",
    });
    expect(uitkomst.decision).toBe("BLOCK");
    expect(uitkomst.outcome).toBe("RULESET_INCOMPLETE");
  });
});

describe("geen bypass", () => {
  it("negeert een uitzondering die op deze regel wordt geprobeerd", () => {
    // Een beheerder kan uitzonderingen vastleggen. Deze regel leest ze niet, en
    // dat is de hele bedoeling: wie een anker wil verplaatsen, start een nieuwe
    // dienstregelingronde.
    const bevindingen = overtredingen(
      evaluateCheck(
        toets({
          date: DATUM,
          changeType: "AMENDMENT",
          baselineSlot: baseline("RUST"),
          planningStage: "BASE_ROSTER",
          exceptions: [
            {
              ruleId: RULE.ROSTER_ANCHOR_LOCKED,
              grantedByUserId: "admin-1",
              reason: "operationeel nodig",
              grantedAt: "2025-09-01T08:00:00.000Z",
            },
          ],
        }),
        "BASE_ROSTER_GENERATION",
      ).findings,
    );
    expect(bevindingen).toContain(RULE.ROSTER_ANCHOR_LOCKED);
  });
});

describe("het basisreserverooster", () => {
  it("bevat geen dienstnummers", () => {
    const bevindingen = overtredingen(
      evaluateCheck(
        toets({
          date: DATUM,
          employee: medewerker({ rosterProfile: "RESERVE", reservePreference: "GEEN_VOORKEUR" }),
          duty: LATE_DIENST,
          planningStage: "BASE_ROSTER",
        }),
        "BASE_ROSTER_GENERATION",
      ).findings,
    );
    expect(bevindingen).toContain(RULE.RESERVE_BASE_WITHOUT_DUTIES);
  });

  it("laat de dienstindeling een reservedag wél operationeel invullen", () => {
    // Dezelfde plaatsing, andere aanleiding. De RES-dag is er juist voor
    // gemaakt; het verschil zit in de laag, niet in de dienst.
    const bevindingen = overtredingen(
      evaluateCheck(
        toets({
          date: DATUM,
          employee: medewerker({ rosterProfile: "RESERVE", reservePreference: "GEEN_VOORKEUR" }),
          duty: LATE_DIENST,
          replacedPosition: "RES",
        }),
        "RESERVE_FILL",
      ).findings,
    );
    expect(bevindingen).not.toContain(RULE.RESERVE_BASE_WITHOUT_DUTIES);
  });

  it("raakt een vast rooster niet", () => {
    const bevindingen = overtredingen(
      evaluateCheck(
        toets({ date: DATUM, duty: LATE_DIENST, planningStage: "BASE_ROSTER" }),
        "BASE_ROSTER_GENERATION",
      ).findings,
    );
    expect(bevindingen).not.toContain(RULE.RESERVE_BASE_WITHOUT_DUTIES);
  });
});
