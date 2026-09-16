import { describe, expect, it } from "vitest";
import { addDays } from "@/domain/time";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { buildRequest, run } from "./fixture";

/**
 * De nachtbepalingen.
 *
 * ## Wat een nachtdienst is
 *
 * Meer dan één uur arbeid tussen 00:00 en 06:00. Niet het dienstnummer: dat is
 * een operationele indeling. Elke toets hieronder zet daarom een dienst neer met
 * werkelijke tijden, en de tegenproef gebruikt een dienst die net buiten dat
 * venster valt — zodat zichtbaar is dat de regel op de klok let en niet op iets
 * anders.
 *
 * ## Waarom er zoveel nachtgrenzen zijn
 *
 * De bron kent aparte maxima voor nachtdiensten, voor nachtdiensten die tussen
 * 04:00 en 05:01 beginnen, en voor diensten die 02:30 kruisen. Ze gelden naast
 * elkaar en kunnen tegelijk afgaan. Elke grens wordt hier apart getoetst, want
 * een bevinding zonder herkomst helpt een planner niet.
 */

function overtredingen(result: { hardViolations: readonly { ruleId: string }[] }): string[] {
  return result.hardViolations.map((violation) => violation.ruleId);
}

const evalueer = (spec: Parameters<typeof buildRequest>[0]) =>
  overtredingen(evaluateAssignment(buildRequest(spec)));

describe("wanneer een dienst een nachtdienst is", () => {
  it("telt een dienst met meer dan een uur vóór 06:00 als nacht", () => {
    // 04:30-13:00: anderhalf uur in het nachtvenster, en 8:00 arbeidstijd —
    // ruim boven de nachtgrens van 8:30 blijft hij niet, dus hier zou de
    // nachtgrens gelden als hij te lang was. Dat hij niet afgaat, komt doordat
    // hij kort genoeg is.
    expect(evalueer({ date: "2026-03-10", duty: "04:30-13:30+30" })).not.toContain(
      RULE.NIGHT_MAX_WORK,
    );
  });

  it("keurt een te lange nachtdienst af (meer dan 8,5 uur arbeidstijd)", () => {
    // 23:00-08:01: negen uur en één minuut arbeidstijd zonder pauze-aftrek.
    expect(evalueer({ date: "2026-03-10", duty: "23:00-08:01+0" })).toContain(
      RULE.NIGHT_MAX_WORK,
    );
  });

  it("laat precies achtenhalf uur arbeidstijd in de nacht door", () => {
    expect(evalueer({ date: "2026-03-10", duty: "23:00-07:30+0" })).not.toContain(
      RULE.NIGHT_MAX_WORK,
    );
  });

  it("past de nachtgrens niet toe op een dagdienst van dezelfde lengte", () => {
    // 08:00-16:31 is even lang, maar raakt het nachtvenster niet.
    expect(evalueer({ date: "2026-03-10", duty: "08:00-17:01+0" })).not.toContain(
      RULE.NIGHT_MAX_WORK,
    );
  });
});

describe("nachtdienst inclusief overwerk (10 uur)", () => {
  it("laat tien uur inclusief overwerk door", () => {
    // 8:30 arbeidstijd plus 90 minuten overwerk is precies tien uur.
    expect(
      evalueer({ date: "2026-03-10", duty: "23:00-07:30+0", overtimeMinutes: 90 }),
    ).not.toContain(RULE.NIGHT_MAX_WORK_INCL_OVERTIME);
  });

  it("keurt tien uur en één minuut af", () => {
    expect(
      evalueer({ date: "2026-03-10", duty: "23:00-07:31+0", overtimeMinutes: 90 }),
    ).toContain(RULE.NIGHT_MAX_WORK_INCL_OVERTIME);
  });
});

describe("maximale dienstlengte van een nachtdienst (9 uur)", () => {
  it("laat een nachtdienst van precies negen uur door", () => {
    expect(evalueer({ date: "2026-03-10", duty: "22:00-07:00+45" })).not.toContain(
      RULE.NIGHT_MAX_DUTY_DURATION,
    );
  });
});

describe("nachtdienst met een start tussen 04:00 en 05:01", () => {
  it("laat zes en een half uur arbeidstijd door", () => {
    // Start 04:30, dienst tot 11:30 met 30 minuten pauze: 6:30 arbeidstijd en
    // 7:00 dienstlengte — precies beide grenzen.
    const uitkomst = evalueer({ date: "2026-03-10", duty: "04:30-11:30+30" });
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_START_0400_0501_MAX_WORK);
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_START_0400_0501_MAX_DUTY);
  });

  it("keurt een minuut meer arbeidstijd af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "04:30-11:31+30" })).toContain(
      RULE.RP_NIGHT_START_0400_0501_MAX_WORK,
    );
  });

  it("keurt een minuut meer dienstlengte af", () => {
    // Zelfde arbeidstijd, langere dienst: alleen de dienstlengtegrens gaat af.
    expect(evalueer({ date: "2026-03-10", duty: "04:30-11:31+31" })).toContain(
      RULE.RP_NIGHT_START_0400_0501_MAX_DUTY,
    );
  });

  it("geldt niet bij een start na 05:00", () => {
    // 05:30 valt in de andere startband; deze grenzen gelden dan niet.
    const uitkomst = evalueer({ date: "2026-03-10", duty: "05:30-13:00+30" });
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_START_0400_0501_MAX_WORK);
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_START_0400_0501_MAX_DUTY);
  });
});

describe("dienst die 02:30 kruist", () => {
  it("laat acht uur arbeidstijd en achtenhalf uur dienst door", () => {
    // 22:30-07:00 met 30 minuten pauze: 8:30 dienst, 8:00 arbeidstijd.
    const uitkomst = evalueer({ date: "2026-03-10", duty: "22:30-07:00+30" });
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_ACROSS_0230_MAX_WORK);
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_ACROSS_0230_MAX_DUTY);
  });

  it("keurt een minuut meer arbeidstijd af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "22:30-07:01+30" })).toContain(
      RULE.RP_NIGHT_ACROSS_0230_MAX_WORK,
    );
  });

  it("keurt een minuut meer dienstlengte af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "22:30-07:01+31" })).toContain(
      RULE.RP_NIGHT_ACROSS_0230_MAX_DUTY,
    );
  });

  it("geldt niet voor een dienst die vóór 02:30 eindigt", () => {
    const uitkomst = evalueer({ date: "2026-03-10", duty: "18:00-02:29+0" });
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_ACROSS_0230_MAX_WORK);
    expect(uitkomst).not.toContain(RULE.RP_NIGHT_ACROSS_0230_MAX_DUTY);
  });
});

describe("harde nachtdienst mag niet na 07:00 eindigen", () => {
  it("laat een einde om precies 07:00 door", () => {
    expect(evalueer({ date: "2026-03-10", duty: "23:00-07:00+30" })).not.toContain(
      RULE.RP_HARD_NIGHT_LATEST_END,
    );
  });

  it("keurt een einde om 07:01 af", () => {
    expect(evalueer({ date: "2026-03-10", duty: "23:00-07:01+30" })).toContain(
      RULE.RP_HARD_NIGHT_LATEST_END,
    );
  });

  it("geldt niet voor een dienst die 02:00–04:00 niet raakt", () => {
    // Begint om 04:30 en eindigt om 13:00: geen harde nachtdienst, dus het
    // eindtijdstip doet er voor deze regel niet toe.
    expect(evalueer({ date: "2026-03-10", duty: "04:30-13:00+30" })).not.toContain(
      RULE.RP_HARD_NIGHT_LATEST_END,
    );
  });
});

describe("vrijstelling harde nachtdienst vanaf 50 jaar", () => {
  const hardeNacht = "23:00-07:00+30";

  it("keurt een harde nachtdienst af voor wie de vrijstelling heeft ingeroepen", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: hardeNacht,
        protections: [{ type: "HARD_NIGHT_EXEMPTION" }],
      }),
    ).toContain(RULE.AGE50_HARD_NIGHT_EXEMPTION);
  });

  it("laat dezelfde dienst door zonder die bescherming", () => {
    expect(evalueer({ date: "2026-03-10", duty: hardeNacht })).not.toContain(
      RULE.AGE50_HARD_NIGHT_EXEMPTION,
    );
  });

  it("laat een gewone dagdienst door, ook mét de bescherming", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "08:00-16:00+30",
        protections: [{ type: "HARD_NIGHT_EXEMPTION" }],
      }),
    ).not.toContain(RULE.AGE50_HARD_NIGHT_EXEMPTION);
  });
});

describe("reeksen met nachtdiensten", () => {
  const nacht = "23:00-07:00+30";

  it("laat een korte nachtreeks door", () => {
    expect(
      evalueer({
        date: "2026-03-12",
        duty: nacht,
        around: run("2026-03-10", 2, nacht),
      }),
    ).not.toContain(RULE.MAX_CONSECUTIVE_IN_NIGHT_SEQUENCE);
  });

  it("keurt een reeks van meer dan zeven diensten met nachtdiensten erin af", () => {
    expect(
      evalueer({
        date: "2026-03-17",
        duty: nacht,
        around: run("2026-03-10", 7, nacht),
      }),
    ).toContain(RULE.MAX_CONSECUTIVE_IN_NIGHT_SEQUENCE);
  });

  it("vraagt herstelrust na een reeks van meer dan drie nachtdiensten", () => {
    // Vier nachtdiensten en daarna meteen weer een dienst: te weinig herstel.
    expect(
      evalueer({
        date: addDays("2026-03-10", 4),
        duty: "08:00-16:00+30",
        around: run("2026-03-10", 4, nacht),
      }),
    ).toContain(RULE.NIGHT_SEQUENCE_RECOVERY);
  });

  it("vraagt die herstelrust niet na een reeks van drie", () => {
    // Eén dag ertussen, zodat de gewone dagelijkse rust niet in de weg zit: het
    // gaat hier om de herstelrust ná de reeks en niet om de rust tussen twee
    // diensten.
    expect(
      evalueer({
        date: addDays("2026-03-10", 3),
        duty: "08:00-16:00+30",
        around: run("2026-03-10", 2, nacht),
      }),
    ).not.toContain(RULE.NIGHT_SEQUENCE_RECOVERY);
  });
});

describe("aantal nachtdiensten per 16 weken (36)", () => {
  const nacht = "23:00-07:00+30";

  /** Nachtdiensten met genoeg rust ertussen, verspreid over de weken ervóór. */
  function verspreid(aantal: number) {
    return Array.from({ length: aantal }, (_unused, index) => ({
      date: addDays("2026-01-05", index * 3),
      duty: nacht,
    }));
  }

  it("laat de zesendertigste nachtdienst door", () => {
    expect(
      evalueer({ date: "2026-04-22", duty: nacht, around: verspreid(35) }),
    ).not.toContain(RULE.MAX_NIGHT_SERVICES_16W);
  });

  it("keurt de zevenendertigste af", () => {
    expect(evalueer({ date: "2026-04-22", duty: nacht, around: verspreid(36) })).toContain(
      RULE.MAX_NIGHT_SERVICES_16W,
    );
  });
});
