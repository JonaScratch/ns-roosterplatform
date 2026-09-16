import { describe, expect, it } from "vitest";
import { RosterProfile, DutyKind } from "@/lib/generated/prisma/enums";
import { addDays } from "@/domain/time";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { buildRequest, run } from "./fixture";

/**
 * Grenswaarden.
 *
 * Elke harde regel wordt getest op de minuut vóór en de minuut ná de grens. Een
 * test die alleen een duidelijk fout geval afkeurt, bewijst niets over de plek
 * waar het misgaat: dat is precies de grens.
 */

function ruleIds(result: { hardViolations: readonly { ruleId: string }[] }): string[] {
  return result.hardViolations.map((violation) => violation.ruleId);
}

describe("dagelijkse rust", () => {
  const scenario = (endYesterday: string) =>
    evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        around: [{ date: "2025-03-09", duty: `06:00-${endYesterday}+40` }],
      }),
    );

  it("keurt precies twaalf uur rust goed", () => {
    // Dienst eindigt 20:00, volgende start 08:00: exact 12 uur.
    expect(ruleIds(scenario("20:00"))).not.toContain(RULE.RP_DAILY_REST_PLANNED);
  });

  it("keurt elf uur negenenvijftig af", () => {
    expect(ruleIds(scenario("20:01"))).toContain(RULE.RP_DAILY_REST_PLANNED);
  });

  it("kijkt ook naar de rust ná de dienst", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-20:01+40",
        around: [{ date: "2025-03-11", duty: "08:00-15:00+40" }],
      }),
    );
    expect(ruleIds(result)).toContain(RULE.RP_DAILY_REST_PLANNED);
  });

  it("staat acht uur niet toe in een basisrooster, ook niet met uitzondering", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        around: [{ date: "2025-03-09", duty: "06:00-23:30+40" }],
        stage: "BASE_ROSTER",
        exceptions: [
          {
            ruleId: RULE.DAILY_REST_REDUCED_NON_PLANNED,
            grantedByUserId: "planner-1",
            reason: "verstoring",
            grantedAt: "2025-03-09T22:00:00.000Z",
          },
        ],
      }),
    );
    expect(ruleIds(result)).toContain(RULE.RP_DAILY_REST_PLANNED);
  });

  it("staat acht uur wel toe in de operationele fase met vastgelegde uitzondering", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        around: [{ date: "2025-03-09", duty: "06:00-23:30+40" }],
        stage: "POST_DW_OPERATIONAL",
        exceptions: [
          {
            ruleId: RULE.DAILY_REST_REDUCED_NON_PLANNED,
            grantedByUserId: "planner-1",
            reason: "verstoring",
            grantedAt: "2025-03-09T22:00:00.000Z",
          },
        ],
      }),
    );
    expect(ruleIds(result)).not.toContain(RULE.RP_DAILY_REST_PLANNED);
    // En de optimizer krijgt de laagst mogelijke wenselijkheid mee.
    expect(
      result.optimizationImpacts.some(
        (impact) => impact.ruleId === RULE.DAILY_REST_REDUCED_NON_PLANNED && impact.score === 0,
      ),
    ).toBe(true);
  });
});

describe("rust na een nachtdienst", () => {
  it("vraagt veertien uur na een nachtdienst die na 02:00 eindigt", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "16:00-22:00+40",
        kinds: [DutyKind.LAAT],
        subject: { rosterProfile: RosterProfile.LAAT_NACHT },
        around: [{ date: "2025-03-09", duty: "22:00-05:59+40" }],
      }),
    );
    // Einde 05:59, start 16:00: 10:01 rust. Zowel twaalf als veertien uur faalt.
    expect(ruleIds(result)).toContain(RULE.NIGHT_REST_AFTER_0200);
  });

  it("laat precies veertien uur door", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "20:00-23:59+40",
        kinds: [DutyKind.LAAT],
        subject: { rosterProfile: RosterProfile.LAAT_NACHT },
        around: [{ date: "2025-03-09", duty: "22:00-06:00+40" }],
      }),
    );
    expect(ruleIds(result)).not.toContain(RULE.NIGHT_REST_AFTER_0200);
  });
});

describe("herstel na een reeks nachtdiensten", () => {
  it("vraagt 46 uur na drie nachtdiensten", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-12",
        duty: "08:00-15:00+40",
        subject: { rosterProfile: RosterProfile.MIX },
        around: [
          { date: "2025-03-08", duty: "22:00-06:00+40" },
          { date: "2025-03-09", duty: "22:00-06:00+40" },
          { date: "2025-03-10", duty: "22:00-06:00+40" },
        ],
      }),
    );
    // Laatste nacht eindigt 11-03 06:00; kandidaat start 12-03 08:00 = 26 uur.
    expect(ruleIds(result)).toContain(RULE.NIGHT_SEQUENCE_RECOVERY);
  });

  it("laat de reeks door zodra de herstelrust lang genoeg is", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-13",
        duty: "08:00-15:00+40",
        subject: { rosterProfile: RosterProfile.MIX },
        around: [
          { date: "2025-03-08", duty: "22:00-06:00+40" },
          { date: "2025-03-09", duty: "22:00-06:00+40" },
          { date: "2025-03-10", duty: "22:00-06:00+40" },
        ],
      }),
    );
    // Einde 11-03 06:00 tot 13-03 08:00 = 50 uur.
    expect(ruleIds(result)).not.toContain(RULE.NIGHT_SEQUENCE_RECOVERY);
  });
});

describe("aaneengesloten diensten", () => {
  it("laat zeven diensten achter elkaar toe", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        around: run("2025-03-04", 6, "08:00-15:00+40"),
      }),
    );
    expect(ruleIds(result)).not.toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });

  it("keurt de achtste af", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        around: run("2025-03-03", 7, "08:00-15:00+40"),
      }),
    );
    expect(ruleIds(result)).toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });

  it("telt een opleidingsdag mee in de reeks", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        around: [
          ...run("2025-03-04", 6, "08:00-15:00+40"),
          { date: "2025-03-03", position: "OPLEIDING" },
        ],
      }),
    );
    expect(ruleIds(result)).toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });

  it("laat een WTV-dag de reeks breken", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-15:00+40",
        around: [
          ...run("2025-03-04", 6, "08:00-15:00+40"),
          { date: "2025-03-03", position: "WR" },
        ],
      }),
    );
    expect(ruleIds(result)).not.toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });
});

describe("dienstlengte en arbeidstijd", () => {
  it("keurt een dienst van precies 9:30 goed", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "08:00-17:30+40" }),
    );
    expect(ruleIds(result)).not.toContain(RULE.RP_MAX_DUTY_DURATION);
  });

  it("keurt 9:31 af", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "08:00-17:31+40" }),
    );
    expect(ruleIds(result)).toContain(RULE.RP_MAX_DUTY_DURATION);
  });

  it("hanteert de kortere grens bij een start tussen 05:00 en 06:00", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "05:30-14:01+40" }),
    );
    expect(ruleIds(result)).toContain(RULE.RP_MAX_DUTY_START_0500_0600);
  });

  it("laat 8:30 bij diezelfde start staan", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "05:30-14:00+40" }),
    );
    expect(ruleIds(result)).not.toContain(RULE.RP_MAX_DUTY_START_0500_0600);
  });
});

describe("tellers over langere vensters", () => {
  it("laat tien vroege starts in vier weken toe", () => {
    const around = Array.from({ length: 9 }, (_unused, index) => ({
      date: addDays("2025-03-10", -2 - index * 3),
      duty: "05:30-13:00+40",
    }));
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "05:30-13:00+40", around }),
    );
    expect(ruleIds(result)).not.toContain(RULE.RP_MAX_EARLY_STARTS_0500_0600_PER_4W);
  });

  it("keurt de elfde af", () => {
    const around = Array.from({ length: 10 }, (_unused, index) => ({
      date: addDays("2025-03-10", -2 - index * 2),
      duty: "05:30-13:00+40",
    }));
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-10", duty: "05:30-13:00+40", around }),
    );
    expect(ruleIds(result)).toContain(RULE.RP_MAX_EARLY_STARTS_0500_0600_PER_4W);
  });

  it("past de grens niet toe wanneer de medewerker de bescherming heeft opgegeven", () => {
    const around = Array.from({ length: 10 }, (_unused, index) => ({
      date: addDays("2025-03-10", -2 - index * 2),
      duty: "05:30-13:00+40",
    }));
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "05:30-13:00+40",
        around,
        subject: { earlyStartProtectionWaived: true },
      }),
    );
    expect(ruleIds(result)).not.toContain(RULE.RP_MAX_EARLY_STARTS_0500_0600_PER_4W);
  });
});

describe("harde overtredingen zijn niet te compenseren", () => {
  it("levert score nul op, ongeacht hoe goed de rest is", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-10",
        duty: "08:00-17:31+40",
      }),
    );
    expect(result.outcome).toBe("POTENTIAL_HARD_VIOLATION");
    expect(result.score).toBe(0);
    expect(result.valid).toBe(false);
  });
});
