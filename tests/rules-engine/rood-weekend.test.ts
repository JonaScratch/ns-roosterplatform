import { describe, expect, it } from "vitest";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { assessWeekend } from "@/server/rules-engine/validation/checks/weekend";
import { buildRequest, type DayPlan } from "./fixture";

/**
 * Het rode weekend — CAO art. 102 lid 3.
 *
 * De regel stelt twee eisen aan één en dezelfde rustperiode: minimaal 60 uur
 * aaneengesloten, én de periode zaterdag 00:00 tot en met maandag 04:00 omvatten.
 * Deze tests scheiden die twee expres, want ze zijn los van elkaar te falen:
 * een rust van 72 uur die op maandagnacht eindigt haalt de lengte wel en het
 * venster niet.
 *
 * Zaterdagen in maart 2025: 1, 8, 15, 22, 29.
 */

/** Een weekend zonder dienst, ingeklemd tussen een vrijdag- en een maandagdienst. */
function weekend(saturday: string, friday: string, monday: string): readonly DayPlan[] {
  return [
    { date: addDays(saturday, -1), duty: friday },
    { date: addDays(saturday, 2), duty: monday },
  ];
}

/** Een weekend waarin ook gewerkt wordt. */
function workedWeekend(saturday: string): readonly DayPlan[] {
  return [
    { date: saturday, duty: "08:00-15:00+40" },
    { date: addDays(saturday, 1), duty: "08:00-15:00+40" },
  ];
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function hardIds(result: { hardViolations: readonly { ruleId: string }[] }): string[] {
  return result.hardViolations.map((violation) => violation.ruleId);
}

describe("de twee eisen los van elkaar", () => {
  /** Bouwt één weekend en meet het, los van de driewekelijkse telling. */
  function measure(friday: string, monday: string) {
    const request = buildRequest({
      date: "2025-03-12",
      duty: "08:00-15:00+40",
      around: weekend("2025-03-15", friday, monday),
    });
    return assessWeekend(request.timeline, "2025-03-15", 60 * 60);
  }

  it("keurt een dienstvrij weekend af dat de 60 uur niet haalt", () => {
    // Vrijdag tot 21:30, maandag vanaf 05:00 is 55 uur 30. Beide grenzen van het
    // vereiste venster liggen binnen de rust; alleen de lengte ontbreekt.
    const assessment = measure("14:00-21:30+40", "05:00-12:00+40");

    expect(assessment.saturday00Included).toBe(true);
    expect(assessment.monday04Included).toBe(true);
    expect(assessment.meetsMinimumRest).toBe(false);
    expect(assessment.actualContinuousRest).toBe(55 * 60 + 30);
    expect(assessment.qualifies).toBe(false);
  });

  it("keurt een lange rust af die maandag 04:00 niet omvat", () => {
    // Ruim 78 uur rust, maar de maandagdienst begint om 02:00 en snijdt het
    // vereiste venster af. Lengte alleen is dus niet genoeg.
    const assessment = measure("06:00-14:00+40", "02:00-08:00+40");

    expect(assessment.saturday00Included).toBe(true);
    expect(assessment.monday04Included).toBe(false);
    expect(assessment.meetsMinimumRest).toBe(true);
    expect(assessment.qualifies).toBe(false);
  });

  it("keurt goed wanneer aan beide eisen is voldaan", () => {
    // Vrijdag tot 14:00, maandag vanaf 06:00 is 64 uur, en beide grenzen van het
    // venster liggen binnen die rust.
    const assessment = measure("06:00-14:00+40", "06:00-14:00+40");

    expect(assessment.saturday00Included).toBe(true);
    expect(assessment.monday04Included).toBe(true);
    expect(assessment.meetsMinimumRest).toBe(true);
    expect(assessment.actualContinuousRest).toBe(64 * 60);
    expect(assessment.qualifies).toBe(true);
  });

  it("meldt onbekend wanneer het rooster eromheen ontbreekt", () => {
    const request = buildRequest({
      date: "2025-03-12",
      duty: "08:00-15:00+40",
      coverageDays: 3,
    });
    const assessment = assessWeekend(request.timeline, "2025-03-15", 60 * 60);

    // Zonder gegevens is het antwoord "onbekend" en niet "geen vrij weekend".
    expect(assessment.undetermined).toBe(true);
    expect(assessment.qualifies).toBe(false);
  });
});

describe("de driewekelijkse telling", () => {
  it("meldt niets zolang één van de drie weekenden voldoet", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-12",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          // Dit weekend haalt beide eisen.
          ...weekend("2025-03-15", "06:00-14:00+40", "06:00-14:00+40"),
        ],
      }),
    );

    expect(hardIds(result)).not.toContain(RULE.RED_WEEKEND_MIN_REST);
  });

  it("meldt wanneer geen van de drie weekenden voldoet", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-12",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          ...workedWeekend("2025-03-15"),
        ],
      }),
    );

    expect(hardIds(result)).toContain(RULE.RED_WEEKEND_MIN_REST);
  });

  it("draagt de volledige onderbouwing mee", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-12",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          ...workedWeekend("2025-03-15"),
        ],
      }),
    );

    const violation = result.hardViolations.find(
      (entry) => entry.ruleId === RULE.RED_WEEKEND_MIN_REST,
    );
    const details = violation?.details as
      | {
          threeWeekWindowStart: string;
          threeWeekWindowEnd: string;
          weekenden: readonly {
            saturday: string;
            requiredRestWindow: string;
            actualContinuousRest: number;
            Saturday00Included: boolean;
            Monday04Included: boolean;
            meetsMinimumRest: boolean;
          }[];
          waiverPresent: boolean;
          source: string;
        }
      | undefined;

    expect(details?.threeWeekWindowStart).toBeDefined();
    expect(details?.threeWeekWindowEnd).toBeDefined();
    expect(details?.weekenden).toHaveLength(3);
    expect(details?.weekenden[0].requiredRestWindow).toMatch(/00:00 — .* 04:00$/);
    expect(details?.waiverPresent).toBe(false);
    expect(details?.source).toContain("102");
  });

  it("kan geen bevestigde overtreding zijn zolang de afwijkingen onbekend zijn", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-12",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          ...workedWeekend("2025-03-15"),
        ],
      }),
    );

    const violation = result.hardViolations.find(
      (entry) => entry.ruleId === RULE.RED_WEEKEND_MIN_REST,
    );

    expect(violation?.confidence).toBe("POTENTIAL");
    const open = violation?.unverified.map((fact) => fact.detail).join(" ") ?? "";
    expect(open).toContain("ondernemingsraad");
    expect(open).toContain("Bijlage IV");
  });

  it("past de regel niet toe bij een vastgelegde individuele afwijking", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-12",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          ...workedWeekend("2025-03-15"),
        ],
        protections: [{ type: "RED_WEEKEND_WAIVER", validUntil: "2025-12-31" }],
      }),
    );

    expect(hardIds(result)).not.toContain(RULE.RED_WEEKEND_MIN_REST);
  });

  it("telt drie weekenden als één probleem, niet als één per roosterdag", () => {
    const result = evaluateAssignment(
      buildRequest({
        date: "2025-03-12",
        duty: "08:00-15:00+40",
        around: [
          ...workedWeekend("2025-03-01"),
          ...workedWeekend("2025-03-08"),
          ...workedWeekend("2025-03-15"),
        ],
      }),
    );

    const violations = result.hardViolations.filter(
      (entry) => entry.ruleId === RULE.RED_WEEKEND_MIN_REST,
    );
    expect(violations).toHaveLength(1);
    // De sleutel benoemt de reeks weekenden en niet de beoordeelde dag, zodat
    // elke dag binnen die reeks tot hetzelfde onderliggende feit leidt.
    expect(violations[0].occurrenceKey).toContain("weekendreeks:");
    expect(violations[0].occurrenceKey).not.toContain("2025-03-12|");
  });
});
