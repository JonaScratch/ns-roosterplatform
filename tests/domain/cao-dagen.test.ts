import { describe, expect, it } from "vitest";
import {
  CAO_DAY_ALLOWANCE,
  CAO_DAY_NOTICE_DAYS,
  calendarMonths,
  caoDaySummary,
  checkCaoDay,
  earliestCaoDay,
  formatDutchDate,
  isWorkingDay,
  monthGrid,
  todayInAmsterdam,
} from "@/domain/cao-days";
import { addDays, daysBetween } from "@/domain/time";

/**
 * De regels rond een CAO-dag.
 *
 * Elke harde grens krijgt hier twee gevallen: de dag die net niet mag en de dag
 * die net wel mag. Een test die alleen de ruime kant afdekt, blijft groen
 * wanneer de vergelijking van `>=` naar `>` verschuift, en dat is precies de
 * fout die een medewerker een dag te vroeg zou laten aanvragen.
 */

/** Een werkdag zonder lopende aanvragen: het uitgangspunt van de meeste tests. */
const WERKDAG = { positionType: "DUTY", activeDates: [] as readonly string[] };

describe("de termijn van zes weken", () => {
  it("rekent in kalenderdagen, niet in weken maal uren", () => {
    expect(CAO_DAY_NOTICE_DAYS).toBe(42);
    expect(daysBetween("2026-09-05", earliestCaoDay("2026-09-05"))).toBe(42);
  });

  it("overbrugt de overgang naar wintertijd zonder te verschuiven", () => {
    // 25 oktober 2026 valt binnen dit bereik; met uursrekenwerk zou de uitkomst
    // een dag opschuiven.
    expect(earliestCaoDay("2026-09-20")).toBe("2026-11-01");
    expect(daysBetween("2026-09-20", "2026-11-01")).toBe(42);
  });

  it("weigert de dag vlak vóór de grens", () => {
    const vandaag = "2026-09-05";
    const teVroeg = addDays(earliestCaoDay(vandaag), -1);
    const uitkomst = checkCaoDay({ ...WERKDAG, date: teVroeg, today: vandaag });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("TE_VROEG");
  });

  it("staat de grensdag zelf wél toe", () => {
    const vandaag = "2026-09-05";
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: earliestCaoDay(vandaag),
      today: vandaag,
    });
    expect(uitkomst.allowed).toBe(true);
    expect(uitkomst.refusal).toBeNull();
  });

  it("staat een dag ver vooruit toe", () => {
    const uitkomst = checkCaoDay({ ...WERKDAG, date: "2027-03-01", today: "2026-09-05" });
    expect(uitkomst.allowed).toBe(true);
  });
});

describe("waarop een CAO-dag kan vallen", () => {
  const vandaag = "2026-09-05";
  const dag = earliestCaoDay(vandaag);

  it("kan op een dienstdag", () => {
    expect(checkCaoDay({ ...WERKDAG, date: dag, today: vandaag }).allowed).toBe(true);
  });

  it("kan op een reservedag: beschikbaar zijn is niet vrij zijn", () => {
    expect(isWorkingDay("RES")).toBe(true);
    const uitkomst = checkCaoDay({
      date: dag,
      today: vandaag,
      positionType: "RES",
      activeDates: [],
    });
    expect(uitkomst.allowed).toBe(true);
  });

  it.each(["RUST", "WTV", "WR", "CO"])("kan niet op %s: die dag is al vrij", (positie) => {
    const uitkomst = checkCaoDay({
      date: dag,
      today: vandaag,
      positionType: positie,
      activeDates: [],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("GEEN_WERKDAG");
  });

  it("kan niet op een dag zonder bekend rooster", () => {
    const uitkomst = checkCaoDay({
      date: dag,
      today: vandaag,
      positionType: null,
      activeDates: [],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("GEEN_ROOSTER");
  });
});

describe("het tegoed", () => {
  const vandaag = "2026-09-05";
  const dag = earliestCaoDay(vandaag);

  it("laat de laatste dag van het tegoed toe", () => {
    // Eén lopende aanvraag, ver genoeg weg om niet aan te sluiten.
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: dag,
      today: vandaag,
      activeDates: [addDays(dag, 30)],
    });
    expect(uitkomst.allowed).toBe(true);
    expect(CAO_DAY_ALLOWANCE).toBe(2);
  });

  it("weigert zodra het tegoed op is", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: dag,
      today: vandaag,
      activeDates: [addDays(dag, 30), addDays(dag, 60)],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("TEGOED_OP");
  });

  it("weigert een dag die al is aangevraagd, ook als er tegoed over is", () => {
    const uitkomst = checkCaoDay({ ...WERKDAG, date: dag, today: vandaag, activeDates: [dag] });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AL_AANGEVRAAGD");
  });

  it("telt een ingetrokken dag niet mee: die zit niet in de lijst", () => {
    // De aanroeper levert alleen lopende aanvragen aan. Deze test legt die
    // afspraak vast: een lege lijst betekent een vol tegoed.
    expect(checkCaoDay({ ...WERKDAG, date: dag, today: vandaag, activeDates: [] }).allowed).toBe(
      true,
    );
  });
});

describe("twee CAO-dagen achter elkaar", () => {
  const vandaag = "2026-09-05";
  // Een maandag ver genoeg vooruit: 21 december 2026.
  const maandag = "2026-12-21";
  const dinsdag = "2026-12-22";
  const zondag = "2026-12-20";
  const woensdag = "2026-12-23";

  it("weigert de dag ná een lopende aanvraag", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: dinsdag,
      today: vandaag,
      activeDates: [maandag],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AANEENGESLOTEN");
    expect(uitkomst.message).toContain("niet op twee opeenvolgende dagen");
  });

  it("weigert de dag vóór een lopende aanvraag", () => {
    // Dezelfde regel de andere kant op: wie dinsdag heeft, mag maandag niet.
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: maandag,
      today: vandaag,
      activeDates: [dinsdag],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AANEENGESLOTEN");
  });

  it("noemt in de melding welke dag ernaast ligt", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: dinsdag,
      today: vandaag,
      activeDates: [maandag],
    });
    expect(uitkomst.message).toContain("maandag 21 december 2026");
  });

  it("staat een dag met één dag ertussen wél toe", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: woensdag,
      today: vandaag,
      activeDates: [maandag],
    });
    expect(uitkomst.allowed).toBe(true);
  });

  it("kijkt naar kalenderdagen en niet naar werkdagen: ook het weekend telt", () => {
    // Zondag naast maandag is aaneengesloten, ook al werkt de medewerker
    // zondag misschien niet.
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: zondag,
      today: vandaag,
      activeDates: [maandag],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AANEENGESLOTEN");
  });

  it("laat het tegoed voorgaan wanneer beide redenen gelden", () => {
    // Met twee lopende aanvragen is elke dag geblokkeerd. Dan is "uw tegoed is
    // op" de bruikbare mededeling: een andere dag kiezen helpt niet.
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: dinsdag,
      today: vandaag,
      activeDates: [maandag, "2027-02-01"],
    });
    expect(uitkomst.refusal).toBe("TEGOED_OP");
  });
});

describe("de jaargrens", () => {
  // Deze vier tests staan er omdat 31 december en 1 januari in twee
  // verschillende jaren staan en dus makkelijk als "niet naast elkaar"
  // worden gezien door code die op maand of jaar vergelijkt.
  const vandaag = "2026-10-01";
  const oudejaar = "2026-12-31";
  const nieuwjaar = "2027-01-01";

  it("ziet 31 december en 1 januari als opeenvolgende dagen", () => {
    expect(addDays(oudejaar, 1)).toBe(nieuwjaar);
    expect(daysBetween(oudejaar, nieuwjaar)).toBe(1);
  });

  it("weigert 1 januari wanneer 31 december al is aangevraagd", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: nieuwjaar,
      today: vandaag,
      activeDates: [oudejaar],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AANEENGESLOTEN");
  });

  it("weigert 31 december wanneer 1 januari al is aangevraagd", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: oudejaar,
      today: vandaag,
      activeDates: [nieuwjaar],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AANEENGESLOTEN");
  });

  it("staat 30 december naast 1 januari wél toe: dat is geen aansluiting", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: "2026-12-30",
      today: vandaag,
      activeDates: [nieuwjaar],
    });
    expect(uitkomst.allowed).toBe(true);
  });

  it("werkt ook over een schrikkeljaargrens: 28 en 29 februari", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: "2028-02-29",
      today: "2027-12-01",
      activeDates: ["2028-02-28"],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AANEENGESLOTEN");
  });

  it("ziet 28 februari en 1 maart in een gewoon jaar als buren", () => {
    const uitkomst = checkCaoDay({
      ...WERKDAG,
      date: "2027-03-01",
      today: "2026-12-01",
      activeDates: ["2027-02-28"],
    });
    expect(uitkomst.allowed).toBe(false);
    expect(uitkomst.refusal).toBe("AANEENGESLOTEN");
  });
});

describe("vandaag in Amsterdam", () => {
  it("is de Nederlandse dag en niet de UTC-dag", () => {
    // 00:30 in Amsterdam in de zomer is 22:30 UTC van de dag ervóór. Wie hier
    // met de UTC-datum zou rekenen, geeft deze aanvrager een dag speling die de
    // aanvrager om 09:00 niet krijgt.
    const middernachtPlusHalf = new Date("2026-07-14T22:30:00Z");
    expect(todayInAmsterdam(middernachtPlusHalf)).toBe("2026-07-15");
  });

  it("klopt ook in de wintertijd", () => {
    const winter = new Date("2026-01-14T23:30:00Z");
    expect(todayInAmsterdam(winter)).toBe("2026-01-15");
  });

  it("geeft dezelfde uitkomst midden op de dag", () => {
    expect(todayInAmsterdam(new Date("2026-07-15T09:00:00Z"))).toBe("2026-07-15");
  });
});

describe("de kalender", () => {
  it("begint bij de maand van de eerste geldige dag, niet bij deze maand", () => {
    const maanden = calendarMonths("2026-09-05", 3);
    // 5 september + 42 dagen = 17 oktober.
    expect(earliestCaoDay("2026-09-05")).toBe("2026-10-17");
    expect(maanden).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
  });

  it("loopt over de jaargrens door", () => {
    expect(calendarMonths("2026-11-20", 3)).toEqual(["2027-01-01", "2027-02-01", "2027-03-01"]);
  });

  it("laat elke maand op maandag beginnen", () => {
    // 1 oktober 2026 is een donderdag: drie lege plekken ervóór.
    const vakjes = monthGrid("2026-10-01");
    expect(vakjes.slice(0, 3)).toEqual([null, null, null]);
    expect(vakjes[3]).toBe("2026-10-01");
    expect(vakjes).toHaveLength(3 + 31);
  });

  it("kent de lengte van februari in een schrikkeljaar", () => {
    expect(monthGrid("2028-02-01").filter(Boolean)).toHaveLength(29);
    expect(monthGrid("2027-02-01").filter(Boolean)).toHaveLength(28);
  });

  it("zet een maand die op maandag begint zonder lege plekken neer", () => {
    // 1 juni 2026 is een maandag.
    expect(monthGrid("2026-06-01")[0]).toBe("2026-06-01");
  });
});

describe("de weergave", () => {
  it("schrijft de datum voluit in het Nederlands", () => {
    expect(formatDutchDate("2026-10-23")).toBe("vrijdag 23 oktober 2026");
  });

  it("noemt de eerste geldige dag in gewone taal en niet als getalcode", () => {
    const uitkomst = checkCaoDay({ ...WERKDAG, date: "2026-09-06", today: "2026-09-05" });
    expect(uitkomst.message).toContain("zaterdag 17 oktober 2026");
  });

  it("noemt op het bevestigingsscherm de dienst die vervalt", () => {
    const regels = caoDaySummary({
      date: "2026-10-23",
      rosterName: "50+ mix",
      lineNumber: 4,
      dutyCode: "101",
      timeRange: "13:08 - 21:41",
      positionType: "DUTY",
    });
    expect(regels.map((regel) => regel.label)).toEqual([
      "Datum",
      "Basisrooster",
      "Regel",
      "Dienst",
      "Tijden",
    ]);
    expect(regels.find((regel) => regel.label === "Dienst")?.value).toBe("101");
  });

  it("noemt een reservedag als zodanig wanneer er geen dienstnummer is", () => {
    const regels = caoDaySummary({
      date: "2026-10-23",
      rosterName: null,
      lineNumber: null,
      dutyCode: null,
      timeRange: null,
      positionType: "RES",
    });
    expect(regels.map((regel) => regel.value)).toContain("Reservedienst");
  });
});
