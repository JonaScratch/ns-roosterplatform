import { describe, expect, it } from "vitest";
import { RosterProfile, DutyKind } from "@/lib/generated/prisma/enums";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { buildRequest, run } from "./fixture";

/**
 * Tijd die niet is wat de klok zegt, en weekenden.
 *
 * Op de laatste zondag van maart duurt een nacht in Nederland één uur korter dan
 * het rooster suggereert, en op de laatste zondag van oktober één uur langer.
 * Wie met kloktijden rekent, geeft die dagen een verkeerd antwoord — en juist
 * dáár raakt het mensen die 's nachts werken.
 */

function hardIds(result: { hardViolations: readonly { ruleId: string }[] }): string[] {
  return result.hardViolations.map((violation) => violation.ruleId);
}

function warningIds(result: { warnings: readonly { ruleId: string }[] }): string[] {
  return result.warnings.map((warning) => warning.ruleId);
}

describe("zomertijd", () => {
  // In de nacht van 29 op 30 maart 2025 gaat de klok van 02:00 naar 03:00.
  const springForward = (protections: Parameters<typeof buildRequest>[0]["protections"] = []) =>
    evaluateAssignment(
      buildRequest({
        date: "2025-03-30",
        duty: "08:00-15:00+40",
        around: [{ date: "2025-03-29", duty: "14:00-20:00+40" }],
        protections,
      }),
    );

  it("meet rust als werkelijk verstreken tijd, niet als kloktijd", () => {
    const result = springForward();

    // Op de klok twaalf uur rust, in werkelijkheid elf.
    expect(hardIds(result)).toContain(RULE.RP_DAILY_REST_PLANNED);

    const violation = result.hardViolations.find(
      (entry) => entry.ruleId === RULE.RP_DAILY_REST_PLANNED,
    );
    expect(violation?.calculatedValue).toBe(11 * 60);
    expect(violation?.details).toMatchObject({ klokminuten: 12 * 60 });
    expect(violation?.message).toContain("zomertijd");
  });

  it("laat het toe wanneer de medewerker daarmee heeft ingestemd", () => {
    const result = springForward([{ type: "DST_CONSENT", validUntil: "2025-12-31" }]);

    expect(hardIds(result)).not.toContain(RULE.RP_DAILY_REST_PLANNED);
    expect(warningIds(result)).toContain(RULE.RP_DAILY_REST_PLANNED);
  });

  it("rekent een nacht in oktober een uur langer", () => {
    // In de nacht van 25 op 26 oktober 2025 gaat de klok van 03:00 naar 02:00:
    // 22:00–06:30 op de klok is negenenhalf uur in werkelijkheid.
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-10-25",
        duty: "22:00-06:30+40",
        kinds: [DutyKind.NACHT],
        subject: { rosterProfile: RosterProfile.LAAT_NACHT },
      }),
    );

    expect(hardIds(result)).toContain(RULE.NIGHT_MAX_DUTY_DURATION);
    const violation = result.hardViolations.find(
      (entry) => entry.ruleId === RULE.NIGHT_MAX_DUTY_DURATION,
    );
    expect(violation?.calculatedValue).toBe(9 * 60 + 30);
  });
});

describe("wekelijkse arbeidstijd", () => {
  it("keurt meer dan zestig uur in een week af", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-05",
        duty: "07:00-16:30+40",
        around: [
          ...run("2025-03-03", 2, "07:00-16:30+40"),
          ...run("2025-03-06", 4, "07:00-16:30+40"),
        ],
      }),
    );

    // Zeven diensten van 8:50 arbeidstijd is 61:50 in één week.
    expect(hardIds(result)).toContain(RULE.MAX_WEEKLY_HOURS);
  });
});

describe("wekelijkse rust", () => {
  it("valt terug op de variant van 72 uur per veertien dagen", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-05",
        duty: "07:00-15:00+40",
        around: [
          ...run("2025-03-03", 2, "07:00-15:00+40"),
          ...run("2025-03-06", 4, "07:00-15:00+40"),
        ],
      }),
    );

    // In de week zelf haalt niemand 36 uur aaneengesloten rust; de veertien
    // dagen eromheen halen de 72 uur wel. Dat mag, maar niet stilzwijgend.
    expect(hardIds(result)).not.toContain(RULE.WEEKLY_REST_36H_PER_7D);
    expect(warningIds(result)).toContain(RULE.WEEKLY_REST_36H_PER_7D);
  });
});

describe("het driewekelijkse vrije weekend", () => {
  /** Zaterdagen in maart 2025: 1, 8, 15, 22, 29. */
  const workedWeekend = (saturday: string) => [
    { date: saturday, duty: "08:00-15:00+40" },
    { date: addOneDay(saturday), duty: "08:00-15:00+40" },
  ];

  function addOneDay(date: string): string {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  }

  it("keurt drie bezette weekenden achter elkaar af", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-15",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          { date: "2025-03-16", duty: "08:00-15:00+40" },
        ],
      }),
    );

    expect(hardIds(result)).toContain(RULE.RED_WEEKEND_MIN_REST);
  });

  it("laat het door zodra één van de drie weekenden vrij is", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-15",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          { date: "2025-03-16", duty: "08:00-15:00+40" },
        ],
      }),
    );

    expect(hardIds(result)).not.toContain(RULE.RED_WEEKEND_MIN_REST);
  });

  it("past de regel niet toe bij een vastgelegde afwijking", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-15",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          { date: "2025-03-16", duty: "08:00-15:00+40" },
        ],
        protections: [{ type: "RED_WEEKEND_WAIVER", validUntil: "2025-12-31" }],
      }),
    );

    expect(hardIds(result)).not.toContain(RULE.RED_WEEKEND_MIN_REST);
  });
});
