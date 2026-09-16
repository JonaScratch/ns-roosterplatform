import { describe, expect, it } from "vitest";
import { addDays } from "@/domain/time";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { buildRequest, run } from "./fixture";

/**
 * Rust, vrije dagen en gemiddelden.
 *
 * ## Waarom de tegenproef hier het meeste werk doet
 *
 * Deze regels kijken naar een venster van weken, niet naar één dienst. Een
 * implementatie die het venster te ruim neemt, keurt vrijwel alles af en komt
 * daarmee moeiteloos door een toets die alleen naar overtredingen kijkt. De
 * tegenproef — een rooster dat wél mag en dat ook niet wordt afgekeurd — is
 * daarom bij elke regel hieronder de eigenlijke meting.
 *
 * ## De omgeving is met opzet leeg
 *
 * Wat in `around` niet genoemd wordt, is een rustdag. Elke test zet dus precies
 * de dagen neer die ertoe doen, en de rest van het jaar is rust. Dat maakt het
 * verschil tussen "de regel gaat af door wat ik neerzette" en "de regel gaat af
 * door iets anders in de vulling" zichtbaar.
 */

function overtredingen(result: { hardViolations: readonly { ruleId: string }[] }): string[] {
  return result.hardViolations.map((violation) => violation.ruleId);
}

const evalueer = (spec: Parameters<typeof buildRequest>[0]) =>
  overtredingen(evaluateAssignment(buildRequest(spec)));

/** Een gewone dagdienst van acht uur arbeidstijd. */
const DAG = "08:00-16:30+30";

describe("wekelijkse rust van 72 uur per 14 dagen", () => {
  it("laat een rooster met ruime vrije blokken door", () => {
    // Twee werkweken van vier dagen met steeds drie vrije dagen ertussen: elk
    // vrij blok is ruim 72 uur.
    expect(
      evalueer({
        date: "2026-03-16",
        duty: DAG,
        around: [...run("2026-03-02", 4, DAG), ...run("2026-03-09", 4, DAG)],
      }),
    ).not.toContain(RULE.WEEKLY_REST_72H_PER_14D);
  });

  // De tegenproef — geen enkele variant gehaald, dus de weekregel gaat af —
  // staat in tijd-en-weekend.test.ts, samen met de terugval op deze
  // veertiendaagse variant. Hier niet herhaald.
});

describe("verkorte wekelijkse rust op initiatief van de roostercommissie", () => {
  it("laat een rooster zonder verkorte rust met rust", () => {
    expect(
      evalueer({
        date: "2026-03-16",
        duty: DAG,
        around: [...run("2026-03-02", 4, DAG), ...run("2026-03-09", 4, DAG)],
      }),
    ).not.toContain(RULE.RC_SHORTENED_WEEKLY_REST_MIN);
  });
});

describe("rustdagen", () => {
  it("laat een rustdag van ruim dertig uur na een dienst door", () => {
    // Dienst tot 16:30, dan twee vrije dagen, dan pas weer werk: ruim 30 uur.
    expect(
      evalueer({
        date: "2026-03-12",
        duty: DAG,
        around: [{ date: "2026-03-09", duty: DAG }],
      }),
    ).not.toContain(RULE.R_DAY_ATTACHED_MIN);
  });

  it("laat een rooster met twee rustdagen per week met rust", () => {
    expect(
      evalueer({
        date: "2026-03-16",
        duty: DAG,
        around: [...run("2026-03-02", 5, DAG), ...run("2026-03-09", 5, DAG)],
      }),
    ).not.toContain(RULE.R_DAYS_PER_WEEK_AVG);
  });

  it("keurt een rooster met te weinig rustdagen af", () => {
    // Zesentwintig dagen achter elkaar werken met slechts twee vrije dagen in
    // het geheel: dat haalt het gemiddelde van twee per week niet.
    const bijnaAltijd = Array.from({ length: 26 }, (_unused, index) => ({
      date: addDays("2026-02-18", index),
      duty: DAG,
    }));
    // Deze regel keurt niet af maar blokkeert: één rustdag mag binnen de
    // rouleringsperiode naar een andere week worden overgebracht, en er is geen
    // bron waaruit blijkt of dat hier is gebeurd. "Overtreding" zou dan net zo
    // onjuist zijn als "in orde".
    const uitkomst = evaluateAssignment(
      buildRequest({ date: "2026-03-16", duty: DAG, around: bijnaAltijd }),
    );
    expect(uitkomst.outcome).toBe("POTENTIAL_HARD_VIOLATION");
    expect(uitkomst.missingRules.map((regel) => regel.ruleId)).toContain(
      "R_DAY_TRANSFER_REGISTER",
    );
  });
});

describe("gemiddelde arbeidstijd over 4 weken (55 uur)", () => {
  it("laat een normaal rooster door", () => {
    // Vijf diensten van acht uur per week: veertig uur.
    const vierWeken = [0, 1, 2, 3].flatMap((week) =>
      run(addDays("2026-02-16", week * 7), 5, DAG),
    );
    expect(evalueer({ date: "2026-03-16", duty: DAG, around: vierWeken })).not.toContain(
      RULE.AVG_WEEKLY_HOURS_4W,
    );
  });

  it("keurt vier weken van bijna zestig uur af", () => {
    // Zeven diensten per week van ruim acht uur: ver boven het gemiddelde.
    const zwaar = [0, 1, 2, 3].flatMap((week) =>
      run(addDays("2026-02-16", week * 7), 7, "06:00-15:00+30"),
    );
    expect(evalueer({ date: "2026-03-16", duty: "06:00-15:00+30", around: zwaar })).toContain(
      RULE.AVG_WEEKLY_HOURS_4W,
    );
  });
});

describe("gemiddelde arbeidstijd over 16 weken (48 uur)", () => {
  it("laat een rooster van veertig uur per week door", () => {
    const zestienWeken = Array.from({ length: 16 }, (_unused, week) =>
      run(addDays("2025-12-01", week * 7), 5, DAG),
    ).flat();
    expect(evalueer({ date: "2026-03-16", duty: DAG, around: zestienWeken })).not.toContain(
      RULE.AVG_WEEKLY_HOURS_16W,
    );
  });

  it("keurt zestien weken van zeven lange diensten af", () => {
    const zwaar = Array.from({ length: 16 }, (_unused, week) =>
      run(addDays("2025-12-01", week * 7), 7, "06:00-15:00+30"),
    ).flat();
    expect(evalueer({ date: "2026-03-16", duty: "06:00-15:00+30", around: zwaar })).toContain(
      RULE.AVG_WEEKLY_HOURS_16W,
    );
  });
});

describe("vrije zondagen per 52 weken", () => {
  it("laat een rooster met veel vrije zondagen door", () => {
    // Alleen doordeweeks werken: elke zondag vrij.
    const doordeweeks = Array.from({ length: 40 }, (_unused, week) =>
      run(addDays("2025-06-02", week * 7), 5, DAG),
    ).flat();
    expect(evalueer({ date: "2026-03-16", duty: DAG, around: doordeweeks })).not.toContain(
      RULE.MIN_FREE_SUNDAYS_52W,
    );
  });
});

describe("het vrije weekend", () => {
  it("laat een rooster met regelmatig vrije weekenden door", () => {
    const doordeweeks = Array.from({ length: 12 }, (_unused, week) =>
      run(addDays("2026-01-05", week * 7), 5, DAG),
    ).flat();
    const uitkomst = evalueer({ date: "2026-03-16", duty: DAG, around: doordeweeks });
    expect(uitkomst).not.toContain(RULE.RED_WEEKEND_INTERVAL_WEEKS);
    expect(uitkomst).not.toContain(RULE.RED_WEEKEND_MIN_REST);
  });

  it("keurt een rooster zonder enig vrij weekend af", () => {
    const altijd = Array.from({ length: 70 }, (_unused, index) => ({
      date: addDays("2026-01-05", index),
      duty: DAG,
    }));
    // Het interval bepaalt over hoeveel weekenden er wordt gekeken; wat afgaat
    // is de eis aan het vrije weekend zelf.
    expect(evalueer({ date: "2026-03-16", duty: DAG, around: altijd })).toContain(
      RULE.RED_WEEKEND_MIN_REST,
    );
  });
});

describe("individuele arbeidstijdbeperking", () => {
  it("keurt een dienst af die vóór de vastgelegde vroegste starttijd begint", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "05:00-13:30+30",
        protections: [{ type: "SCHEDULING_RESTRICTION", earliestStartMinute: 7 * 60 }],
      }),
    ).toContain(RULE.INDIVIDUAL_SCHEDULING_RESTRICTION);
  });

  it("laat een dienst door die er precies aan voldoet", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "07:00-15:30+30",
        protections: [{ type: "SCHEDULING_RESTRICTION", earliestStartMinute: 7 * 60 }],
      }),
    ).not.toContain(RULE.INDIVIDUAL_SCHEDULING_RESTRICTION);
  });

  it("laat dezelfde vroege dienst door zonder beperking", () => {
    expect(evalueer({ date: "2026-03-10", duty: "05:00-13:30+30" })).not.toContain(
      RULE.INDIVIDUAL_SCHEDULING_RESTRICTION,
    );
  });
});

describe("verkorte dagelijkse rust die niet planmatig is", () => {
  it("gaat niet af bij een gewone planmatige rust", () => {
    expect(
      evalueer({
        date: "2026-03-10",
        duty: DAG,
        around: [{ date: "2026-03-09", duty: DAG }],
      }),
    ).not.toContain(RULE.DAILY_REST_REDUCED_NON_PLANNED);
  });
});

describe("de lengte van een rustdag", () => {
  it("keurt een rustdag af die op een dienstenreeks aansluit en geen dertig uur oplevert", () => {
    // Twee dagen werken, waarvan de tweede een nachtdienst die pas de volgende
    // ochtend om 07:00 eindigt. De dag daarna is vrij, en om 06:00 begint alweer
    // een dienst: drieëntwintig uur rust. Een rustdag die op een dienst aansluit
    // moet er dertig opleveren.
    expect(
      evalueer({
        date: "2026-03-14",
        duty: "06:00-14:00+30",
        around: [
          { date: "2026-03-11", duty: "06:00-14:00+30" },
          { date: "2026-03-12", duty: "22:00-07:00+30" },
        ],
      }),
    ).toContain(RULE.R_DAY_ATTACHED_MIN);
  });

  it("laat dezelfde rustdag door wanneer de volgende dienst later begint", () => {
    // Nu begint de dienst erna pas om 14:00: eenendertig uur rust, en dat haalt
    // de norm wél.
    expect(
      evalueer({
        date: "2026-03-14",
        duty: "14:00-22:00+30",
        around: [
          { date: "2026-03-11", duty: "06:00-14:00+30" },
          { date: "2026-03-12", duty: "22:00-07:00+30" },
        ],
      }),
    ).not.toContain(RULE.R_DAY_ATTACHED_MIN);
  });

  // De losstaande variant (24 uur) is dezelfde toets met een andere norm: hij
  // geldt wanneer de dag vóór de rustdag géén werkdag is. In een rooster met
  // hele kalenderdagen levert zo'n rustdag altijd ruim meer dan vierentwintig
  // uur op, en er is dus geen situatie waarin hij kán afgaan. Dat staat als
  // zodanig in de dekkingsmeting en niet als "nog te testen".
});
describe("vrije zondagen per 52 weken (minimaal 13)", () => {
  it("keurt een jaar met te weinig vrije zondagen af", () => {
    // Elke zondag van het jaar gewerkt: dan zijn er nul vrije zondagen.
    const alleZondagen = Array.from({ length: 52 }, (_unused, week) => ({
      date: addDays("2025-03-16", week * 7),
      duty: DAG,
    }));
    expect(
      evalueer({ date: "2026-03-15", duty: DAG, around: alleZondagen }),
    ).toContain(RULE.MIN_FREE_SUNDAYS_52W);
  });
});

describe("verkorte dagelijkse rust buiten de planning", () => {
  it("keurt te korte rust ook af wanneer er een uitzondering ligt maar de planning gewoon loopt", () => {
    // De verkorte norm geldt alleen in de operationele fase. In een
    // basisrooster blijft de gewone rust van twaalf uur staan, ook mét de
    // vastgelegde uitzondering — anders zou een uitzondering voor de operatie
    // stilzwijgend het rooster oprekken.
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "06:00-14:00+30",
        around: [{ date: "2026-03-09", duty: "10:00-20:00+30" }],
        exceptions: [
          {
            ruleId: RULE.DAILY_REST_REDUCED_NON_PLANNED,
            grantedByUserId: "dienstindeling-1",
            reason: "verstoring in de uitvoering",
            grantedAt: "2026-03-09",
          },
        ],
      }),
    ).toContain(RULE.RP_DAILY_REST_PLANNED);
  });
});

describe("verkorte dagelijkse rust in de operationele fase", () => {
  it("laat acht uur rust toe wanneer de uitzondering is verleend en de dag al loopt", () => {
    // Dezelfde te korte rust als hierboven, maar nu ná de DW-vergrendeling en
    // met een verleende uitzondering: dan geldt de verkorte norm van acht uur
    // en is elf uur ruim genoeg.
    expect(
      evalueer({
        date: "2026-03-10",
        duty: "06:00-14:00+30",
        around: [{ date: "2026-03-09", duty: "10:00-19:00+30" }],
        stage: "POST_DW_OPERATIONAL",
        exceptions: [
          {
            ruleId: RULE.DAILY_REST_REDUCED_NON_PLANNED,
            grantedByUserId: "dienstindeling-1",
            reason: "verstoring in de uitvoering",
            grantedAt: "2026-03-09",
          },
        ],
      }),
    ).not.toContain(RULE.DAILY_REST_REDUCED_NON_PLANNED);
  });
});
