import { describe, expect, it } from "vitest";
import { DutyKind } from "@/lib/generated/prisma/enums";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { buildRequest, run } from "./fixture";

/**
 * Arbeidstijd, dienstlengte en pauze.
 *
 * ## Twee kanten per regel
 *
 * Elke regel hieronder wordt twee keer getoetst: op een geval dat hij hoort af
 * te keuren, en op een geval dat hij hoort door te laten. Die tweede kant is de
 * belangrijkste. Een regel die alles afkeurt, komt door de eerste toets zonder
 * moeite — en pas de tweede laat zien dat hij onderscheid maakt.
 *
 * ## Wat "arbeidstijd" hier betekent
 *
 * Dienstlengte is eind min begin. Arbeidstijd is dat minus de pauze. In de
 * notatie hieronder staat de pauze achter een plusteken: `06:00-15:30+40` is
 * een dienst van negen en een half uur met veertig minuten pauze, dus acht uur
 * en vijftig minuten arbeidstijd. Dat onderscheid is precies waar deze regels
 * over gaan, en het is de plek waar een verwisseling niet opvalt.
 */

function overtredingen(result: { hardViolations: readonly { ruleId: string }[] }): string[] {
  return result.hardViolations.map((violation) => violation.ruleId);
}

const evalueer = (spec: Parameters<typeof buildRequest>[0]) =>
  overtredingen(evaluateAssignment(buildRequest(spec)));

describe("maximale arbeidstijd per dienst (9 uur)", () => {
  it("laat precies negen uur arbeidstijd door", () => {
    // 06:00-15:30 is 9:30 dienst, min 30 minuten pauze = 9:00 arbeidstijd.
    expect(evalueer({ date: "2026-03-10", duty: "06:00-15:30+30" })).not.toContain(
      RULE.RP_MAX_WORK_PER_DUTY,
    );
  });

  it("keurt negen uur en één minuut af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "06:00-15:31+30" })).toContain(
      RULE.RP_MAX_WORK_PER_DUTY,
    );
  });

  it("verlaagt de grens wanneer de werkonderbreking langer is dan een half uur", () => {
    // Tien uur op de klok met een uur pauze is negen uur arbeidstijd — precies
    // de grens. Maar bij een onderbreking van meer dan een half uur ligt die
    // grens volgens de bron 2 tot 10 minuten lager, en dan is negen uur te
    // lang. Ook in de ruimste lezing.
    expect(evalueer({ date: "2026-03-10", duty: "06:00-16:00+60" })).toContain(
      RULE.RP_MAX_WORK_PER_DUTY,
    );
  });
});

describe("maximale arbeidstijd inclusief overwerk (12 uur)", () => {
  it("laat twaalf uur inclusief overwerk door", () => {
    // 11:00 arbeidstijd plus 60 minuten overwerk.
    expect(
      evalueer({ date: "2026-03-10", duty: "06:00-17:30+30", overtimeMinutes: 60 }),
    ).not.toContain(RULE.RP_MAX_WORK_INCL_OVERTIME);
  });

  it("keurt twaalf uur en één minuut af", () => {
    expect(
      evalueer({ date: "2026-03-10", duty: "06:00-17:31+30", overtimeMinutes: 60 }),
    ).toContain(RULE.RP_MAX_WORK_INCL_OVERTIME);
  });
});

describe("maximale arbeidstijd bij een start tussen 05:00 en 06:00 (8 uur)", () => {
  it("laat acht uur door bij een start om 05:30", () => {
    expect(evalueer({ date: "2026-03-10", duty: "05:30-14:00+30" })).not.toContain(
      RULE.RP_MAX_WORK_START_0500_0600,
    );
  });

  it("keurt acht uur en één minuut af bij diezelfde start", () => {
    expect(evalueer({ date: "2026-03-10", duty: "05:30-14:01+30" })).toContain(
      RULE.RP_MAX_WORK_START_0500_0600,
    );
  });

  it("geldt niet bij een start buiten dat venster", () => {
    // Dezelfde lengte, maar begonnen om 06:30: dan geldt de gewone grens van
    // negen uur en niet die van acht.
    expect(evalueer({ date: "2026-03-10", duty: "06:30-15:01+30" })).not.toContain(
      RULE.RP_MAX_WORK_START_0500_0600,
    );
  });
});

describe("minimale arbeidstijd per dienst (4 uur)", () => {
  it("laat vier uur arbeidstijd door", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-12:00+0" })).not.toContain(
      RULE.MIN_WORK_PER_DUTY,
    );
  });

  it("keurt drie uur negenenvijftig af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-11:59+0" })).toContain(
      RULE.MIN_WORK_PER_DUTY,
    );
  });
});

describe("minimale dienstlengte rijdend personeel (6 uur)", () => {
  it("laat zes uur dienstlengte door", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-14:00+30" })).not.toContain(
      RULE.RP_MIN_DUTY_DURATION,
    );
  });

  it("keurt vijf uur negenenvijftig af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-13:59+30" })).toContain(
      RULE.RP_MIN_DUTY_DURATION,
    );
  });

  it("kijkt naar de dienstlengte en niet naar de arbeidstijd", () => {
    // Zes uur op de klok met een uur pauze: de dienst is lang genoeg, ook al is
    // de arbeidstijd maar vijf uur.
    expect(evalueer({ date: "2026-03-10", duty: "08:00-14:00+60" })).not.toContain(
      RULE.RP_MIN_DUTY_DURATION,
    );
  });
});

describe("pauze bij meer dan 5,5 uur arbeidstijd (30 minuten)", () => {
  it("vraagt geen pauze bij precies vijfeneenhalf uur arbeidstijd", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-13:30+0" })).not.toContain(
      RULE.BREAK_OVER_5H30,
    );
  });

  it("keurt een langere dienst zonder pauze af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-14:30+0" })).toContain(
      RULE.BREAK_OVER_5H30,
    );
  });

  it("laat dezelfde dienst mét dertig minuten pauze door", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-15:00+30" })).not.toContain(
      RULE.BREAK_OVER_5H30,
    );
  });

  it("keurt negenentwintig minuten pauze af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-15:00+29" })).toContain(
      RULE.BREAK_OVER_5H30,
    );
  });
});

describe("pauze bij meer dan 10 uur arbeidstijd (45 minuten)", () => {
  it("laat een dienst van ruim tien uur mét vijfenveertig minuten pauze door", () => {
    // 06:00-17:00 is elf uur; met 45 minuten pauze is de arbeidstijd 10:15.
    expect(evalueer({ date: "2026-03-10", duty: "06:00-17:00+45", overtimeMinutes: 90 })).not.toContain(
      RULE.BREAK_OVER_10H,
    );
  });

  it("keurt dezelfde dienst met veertig minuten pauze af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "06:00-17:00+40", overtimeMinutes: 90 })).toContain(
      RULE.BREAK_OVER_10H,
    );
  });
});

describe("lange diensten per jaar (drempel 9 uur, maximaal 12)", () => {
  /** Een dienst van 9:30 arbeidstijd: boven de drempel voor een lange dienst. */
  const lang = "06:00-16:00+30";

  it("laat de twaalfde lange dienst door", () => {
    // Elf eerder in het jaar, deze is de twaalfde.
    const eerder = Array.from({ length: 11 }, (_unused, index) => ({
      date: `2026-01-${String(index + 5).padStart(2, "0")}`,
      duty: lang,
    }));
    expect(
      evalueer({ date: "2026-06-10", duty: lang, around: eerder, overtimeMinutes: 60 }),
    ).not.toContain(RULE.RP_MAX_LONG_DUTIES_PER_YEAR);
  });

  it("keurt de dertiende af", () => {
    const eerder = Array.from({ length: 12 }, (_unused, index) => ({
      date: `2026-01-${String(index + 5).padStart(2, "0")}`,
      duty: lang,
    }));
    expect(
      evalueer({ date: "2026-06-10", duty: lang, around: eerder, overtimeMinutes: 60 }),
    ).toContain(RULE.RP_MAX_LONG_DUTIES_PER_YEAR);
  });

  it("telt alleen diensten boven de drempel mee", () => {
    // Twaalf diensten van acht uur zijn geen lange diensten; de dertiende
    // korte dienst is dat evenmin.
    const kort = Array.from({ length: 12 }, (_unused, index) => ({
      date: `2026-01-${String(index + 5).padStart(2, "0")}`,
      duty: "08:00-16:30+30",
    }));
    expect(evalueer({ date: "2026-06-10", duty: "08:00-16:30+30", around: kort })).not.toContain(
      RULE.RP_MAX_LONG_DUTIES_PER_YEAR,
    );
  });
});

describe("maximaal aantal diensten achter elkaar (7)", () => {
  it("laat zeven diensten op rij door", () => {
    expect(
      evalueer({
        date: "2026-03-16",
        duty: "08:00-15:00+30",
        around: run("2026-03-10", 6, "08:00-15:00+30"),
      }),
    ).not.toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });

  it("keurt de achtste af", () => {
    expect(
      evalueer({
        date: "2026-03-17",
        duty: "08:00-15:00+30",
        around: run("2026-03-10", 7, "08:00-15:00+30"),
      }),
    ).toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });
});

describe("de standplaats van de dienst", () => {
  it("laat een dienst op de eigen standplaats door", () => {
    expect(evalueer({ date: "2026-03-10", duty: "08:00-15:00+30" })).not.toContain(
      RULE.DEPOT_MATCH,
    );
  });
});

describe("bevoegdheden", () => {
  it("laat een dienst door wanneer de medewerker de bevoegdheid heeft", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "08:00-15:00+30",
        requiredQualifications: ["RANGEER"],
        subject: { qualifications: ["RANGEER"] },
      }),
    ).not.toContain(RULE.QUALIFICATIONS_REQUIRED);
  });

  it("keurt hem af wanneer zij ontbreekt", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "08:00-15:00+30",
        requiredQualifications: ["RANGEER"],
        subject: { qualifications: [] },
      }),
    ).toContain(RULE.QUALIFICATIONS_REQUIRED);
  });
});

describe("de grenzen van het roosterprofiel", () => {
  it("laat een vroege dienst door in een profiel dat vroeg toestaat", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "06:00-14:00+30",
        kinds: [DutyKind.VROEG],
        subject: { rosterProfile: "VROEG" },
      }),
    ).not.toContain(RULE.ROSTER_PROFILE_BOUNDS);
  });
});
