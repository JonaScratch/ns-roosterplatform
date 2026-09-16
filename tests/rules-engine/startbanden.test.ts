import { describe, expect, it } from "vitest";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { buildRequest } from "./fixture";

/**
 * De twee startbanden, op de minuut.
 *
 * De bron kent twee bepalingen over de dienstlengte bij een vroege start:
 * "vanaf 04:00 en vóór 05:01 maximaal 7 uur" en "ná 05:00 en vóór 06:00
 * maximaal 8,5 uur". Bij minuutprecisie sluiten die op elkaar aan zonder
 * overlap. Een eerdere versie las de tweede band als `[05:00, 06:00)`, waardoor
 * 05:00 in beide viel.
 *
 * Elke starttijd hieronder wordt met dezelfde dienst van acht uur getoetst: te
 * lang voor de eerste band, ruim binnen de tweede. Daarmee is aan de uitkomst
 * direct af te lezen in welke band een starttijd valt.
 */

const EIGHT_HOURS = {
  "03:59": "03:59-11:59+40",
  "04:00": "04:00-12:00+40",
  "04:59": "04:59-12:59+40",
  "05:00": "05:00-13:00+40",
  "05:01": "05:01-13:01+40",
  "05:59": "05:59-13:59+40",
  "06:00": "06:00-14:00+40",
} as const;

function rulesFiredAt(start: keyof typeof EIGHT_HOURS): readonly string[] {
  const result = evaluateAssignment(
    buildRequest({ date: "2025-03-11", duty: EIGHT_HOURS[start] }),
  );
  return result.hardViolations.map((violation) => violation.ruleId);
}

describe("de band 04:00 tot en met 05:00 — maximaal 7 uur", () => {
  it.each(["04:00", "04:59", "05:00"] as const)(
    "geldt bij een start om %s",
    (start) => {
      expect(rulesFiredAt(start)).toContain(RULE.RP_MAX_DUTY_START_0400_0501);
    },
  );

  it.each(["03:59", "05:01", "05:59", "06:00"] as const)(
    "geldt niet bij een start om %s",
    (start) => {
      expect(rulesFiredAt(start)).not.toContain(RULE.RP_MAX_DUTY_START_0400_0501);
    },
  );
});

describe("de band 05:01 tot en met 05:59 — maximaal 8,5 uur", () => {
  it.each(["05:01", "05:59"] as const)("geldt bij een start om %s", (start) => {
    // Acht uur past binnen 8,5 uur, dus deze band levert hier geen bevinding op.
    // Dat hij geldt, blijkt uit het uitblijven van de 7-uursbevinding hierboven.
    expect(rulesFiredAt(start)).not.toContain(RULE.RP_MAX_DUTY_START_0500_0600);
    expect(rulesFiredAt(start)).not.toContain(RULE.RP_MAX_DUTY_START_0400_0501);
  });

  it("geldt niet bij een start om 05:00", () => {
    // De kern van de correctie: 05:00 hoort bij de eerste band en mag daarom
    // niet de ruimere grens van 8,5 uur krijgen.
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-11", duty: "05:00-14:00+40" }),
    );
    const fired = result.hardViolations.map((violation) => violation.ruleId);

    // Negen uur dienstlengte: te lang voor 7 uur én voor 8,5 uur. Zou 05:00 in
    // de tweede band vallen, dan zou alleen de 8,5-uursregel afgaan.
    expect(fired).toContain(RULE.RP_MAX_DUTY_START_0400_0501);
    expect(fired).not.toContain(RULE.RP_MAX_DUTY_START_0500_0600);
  });

  it("laat de 8,5-uursgrens wél afgaan vanaf 05:01", () => {
    const result = evaluateAssignment(
      buildRequest({ date: "2025-03-11", duty: "05:01-14:01+40" }),
    );
    const fired = result.hardViolations.map((violation) => violation.ruleId);

    expect(fired).toContain(RULE.RP_MAX_DUTY_START_0500_0600);
    expect(fired).not.toContain(RULE.RP_MAX_DUTY_START_0400_0501);
  });
});

describe("de brondata is minuutprecies", () => {
  it("kent geen seconden om stil op af te ronden", () => {
    // `startMinute` is een geheel aantal minuten; er bestaat geen plek waar een
    // seconde wordt weggerond. Zou de bron ooit seconden bevatten, dan is dat
    // een bron- en beleidsvraag en geen implementatiedetail.
    const request = buildRequest({ date: "2025-03-11", duty: "05:00-13:00+40" });
    expect(Number.isInteger(request.candidate.shape.startMinute)).toBe(true);
    expect(Number.isInteger(request.candidate.shape.endMinute)).toBe(true);
  });
});
