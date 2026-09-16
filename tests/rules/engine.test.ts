import { describe, expect, it } from "vitest";
import { LocalRulesEngine } from "@/server/rules-engine";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import {
  LATE_DIENST,
  NACHTRANGEER_DIENST,
  NACHT_DIENST,
  VROEG_DIENST,
  dienstDag,
  medewerker,
  overtredingen,
  resDag,
  toets,
  venster,
} from "./fixtures";

const engine = new LocalRulesEngine();

/**
 * De engine zoals de rest van de applicatie hem gebruikt.
 *
 * De tests in `tests/rules-engine/` toetsen de validator rechtstreeks, op de
 * minuut. Dit bestand toetst iets anders: dat beschikbare diensten, ruil en
 * reserve-invulling werkelijk langs diezelfde validator lopen en dat er onderweg
 * niets verloren gaat. Zonder deze laag kan de validator kloppen terwijl er in
 * de applicatie niets van terechtkomt.
 */

describe("geschiktheid voor een beschikbare dienst", () => {
  it("laat een passende dienst toe", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets(),
    });
    expect(uitkomst.decision).toBe("ALLOW");
    expect(overtredingen(uitkomst.findings)).toEqual([]);
    expect(uitkomst.outcome).toBe("VALID_WITHIN_VALIDATED_RULESET");
  });

  it("blokkeert een dienst buiten het roosterprofiel", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        employee: medewerker({ rosterProfile: "VROEG" }),
        duty: LATE_DIENST,
      }),
    });
    expect(uitkomst.decision).toBe("BLOCK");
    expect(overtredingen(uitkomst.findings)).toContain(RULE.ROSTER_PROFILE_BOUNDS);
    // Een geblokkeerde situatie krijgt geen score: er valt niets af te wegen.
    expect(uitkomst.score).toBe(0);
  });

  it("blokkeert 760 voor een profiel zonder nacht, ondanks het 700-nummer", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        employee: medewerker({ rosterProfile: "VROEG_LAAT" }),
        duty: NACHTRANGEER_DIENST,
      }),
    });
    expect(overtredingen(uitkomst.findings)).toContain(RULE.ROSTER_PROFILE_BOUNDS);
  });

  it("blokkeert een dienst zonder de vereiste bevoegdheid", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        employee: medewerker({ rosterProfile: "LAAT_NACHT", qualifications: [] }),
        duty: NACHTRANGEER_DIENST,
      }),
    });
    expect(overtredingen(uitkomst.findings)).toContain(RULE.QUALIFICATIONS_REQUIRED);
  });

  it("blokkeert een dienst van een andere standplaats", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({ employee: medewerker({ depot: "AMF" }) }),
    });
    expect(overtredingen(uitkomst.findings)).toContain(RULE.DEPOT_MATCH);
  });
});

describe("rust vóór en ná de dienst", () => {
  it("blokkeert een vroege dienst direct na een late", async () => {
    // Late dienst eindigt 8 september 21:30, vroege begint 9 september 05:00:
    // zeven en een half uur.
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: VROEG_DIENST,
        window: venster("2025-09-09", [dienstDag("2025-09-08", LATE_DIENST)]),
      }),
    });
    expect(uitkomst.decision).toBe("BLOCK");
    const rust = uitkomst.findings.find((item) => item.ruleId === RULE.RP_DAILY_REST_PLANNED);
    expect(rust?.message).toContain("vóór");
  });

  it("blokkeert wanneer de dienst dáárna te dicht volgt", async () => {
    // De dienst zelf mag, maar de late dienst van morgen volgt te snel.
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        employee: medewerker({ rosterProfile: "LAAT_NACHT" }),
        date: "2025-09-09",
        duty: NACHT_DIENST,
        window: venster("2025-09-09", [dienstDag("2025-09-10", LATE_DIENST)]),
      }),
    });
    expect(uitkomst.decision).toBe("BLOCK");
    const rust = uitkomst.findings.find((item) => item.ruleId === RULE.NIGHT_REST_AFTER_0200);
    expect(rust?.message).toContain("na");
  });

  it("laat ruime rust toe zonder opmerking", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: VROEG_DIENST,
        window: venster("2025-09-09", [dienstDag("2025-09-07", LATE_DIENST)]),
      }),
    });
    expect(uitkomst.decision).toBe("ALLOW");
  });

  it("keurt elf en een half uur rust af, ook al oogt dat ruim", async () => {
    // Onder de vorige, verzonnen parameters was elf uur de norm en gold dit als
    // "krap maar toegestaan". De CAO-transcriptie noemt twaalf uur. Precies
    // zulke stille verschillen waren de reden om het tweede regelboek te
    // verwijderen.
    const krapper = { ...VROEG_DIENST, startMinute: 9 * 60, endMinute: 15 * 60 };
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: krapper,
        window: venster("2025-09-09", [dienstDag("2025-09-08", LATE_DIENST)]),
      }),
    });
    expect(uitkomst.decision).toBe("BLOCK");
    expect(overtredingen(uitkomst.findings)).toContain(RULE.RP_DAILY_REST_PLANNED);
  });
});

describe("reeksen", () => {
  const reeks = (dagen: readonly string[]) =>
    dagen.map((datum) => dienstDag(datum, VROEG_DIENST));

  it("laat zeven diensten op rij toe", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: VROEG_DIENST,
        window: venster(
          "2025-09-09",
          reeks([
            "2025-09-03",
            "2025-09-04",
            "2025-09-05",
            "2025-09-06",
            "2025-09-07",
            "2025-09-08",
          ]),
        ),
      }),
    });
    expect(overtredingen(uitkomst.findings)).not.toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });

  it("blokkeert de achtste dienst op rij", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: VROEG_DIENST,
        window: venster(
          "2025-09-09",
          reeks([
            "2025-09-02",
            "2025-09-03",
            "2025-09-04",
            "2025-09-05",
            "2025-09-06",
            "2025-09-07",
            "2025-09-08",
          ]),
        ),
      }),
    });
    expect(overtredingen(uitkomst.findings)).toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });

  it("telt een RES-positie mee als werkdag", async () => {
    // Een RES-dag is geen vrije dag: de medewerker is beschikbaar. Zou hij niet
    // meetellen, dan zou een reeks van acht dagen er als zeven uitzien.
    const dagen = [
      ...reeks(["2025-09-02", "2025-09-03", "2025-09-04"]),
      resDag("2025-09-05"),
      ...reeks(["2025-09-06", "2025-09-07", "2025-09-08"]),
    ];
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: VROEG_DIENST,
        window: venster("2025-09-09", dagen),
      }),
    });
    expect(overtredingen(uitkomst.findings)).toContain(RULE.MAX_CONSECUTIVE_SERVICES);
  });
});

describe("de dag zelf", () => {
  it("blokkeert een dag waarop al een andere dienst staat", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: VROEG_DIENST,
        replacedPosition: "DUTY",
        window: venster("2025-09-09", [dienstDag("2025-09-09", NACHT_DIENST)]),
      }),
    });
    expect(overtredingen(uitkomst.findings)).toContain(RULE.DAY_AVAILABLE);
  });

  it("staat de bezette dag wél toe wanneer juist die dienst wordt ingeleverd", async () => {
    // Dit is de ruilsituatie: de dag is bezet met de dienst die weggaat.
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        duty: VROEG_DIENST,
        surrendering: NACHT_DIENST,
        replacedPosition: "DUTY",
        window: venster("2025-09-09", [dienstDag("2025-09-09", NACHT_DIENST)]),
      }),
    });
    expect(overtredingen(uitkomst.findings)).not.toContain(RULE.DAY_AVAILABLE);
  });

  it("blokkeert een dag met verlof", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({ date: "2025-09-09", replacedPosition: "VERLOF" }),
    });
    expect(overtredingen(uitkomst.findings)).toContain(RULE.DAY_AVAILABLE);
  });
});

describe("dienstenruil", () => {
  const a = medewerker({ employeeId: "emp-a", employeeNumber: "100001" });
  const b = medewerker({ employeeId: "emp-b", employeeNumber: "100002" });

  it("keurt een ruil goed die voor beiden klopt", async () => {
    const uitkomst = await engine.evaluateSwap({
      type: "SWAP_PROPOSAL",
      initiator: toets({
        employee: a,
        date: "2025-09-10",
        duty: LATE_DIENST,
        surrendering: VROEG_DIENST,
        window: venster("2025-09-10"),
      }),
      counterparty: toets({
        employee: b,
        date: "2025-09-09",
        duty: VROEG_DIENST,
        surrendering: LATE_DIENST,
        window: venster("2025-09-09"),
      }),
    });
    expect(uitkomst.decision).toBe("ALLOW");
  });

  it("blokkeert de hele ruil wanneer alleen de tegenpartij vastloopt", async () => {
    // De ruil is prima voor A. Bij B staat de dag ervoor een late dienst,
    // waardoor de vroege dienst die hij zou krijgen te snel volgt. Precies dit
    // is waarom beide kanten worden doorgerekend, met de dagen eromheen.
    const uitkomst = await engine.evaluateSwap({
      type: "SWAP_PROPOSAL",
      initiator: toets({
        employee: a,
        date: "2025-09-10",
        duty: LATE_DIENST,
        surrendering: VROEG_DIENST,
        window: venster("2025-09-10"),
      }),
      counterparty: toets({
        employee: b,
        date: "2025-09-09",
        duty: VROEG_DIENST,
        surrendering: LATE_DIENST,
        window: venster("2025-09-09", [dienstDag("2025-09-08", LATE_DIENST)]),
      }),
    });

    expect(uitkomst.decision).toBe("BLOCK");
    const blokkades = uitkomst.findings.filter((item) => item.severity === "VIOLATION");
    expect(blokkades).not.toHaveLength(0);
    // De bevinding noemt wie er vastloopt, met het personeelsnummer en niet
    // met een naam.
    expect(blokkades.every((item) => item.employeeNumber === "100002")).toBe(true);
  });

  it("blokkeert wanneer de dienst ná de ruildag knelt bij de aanbieder", async () => {
    const uitkomst = await engine.evaluateSwap({
      type: "SWAP_PROPOSAL",
      initiator: toets({
        employee: medewerker({
          employeeId: "emp-a",
          employeeNumber: "100001",
          rosterProfile: "LAAT_NACHT",
        }),
        date: "2025-09-10",
        duty: NACHT_DIENST,
        surrendering: VROEG_DIENST,
        window: venster("2025-09-10", [dienstDag("2025-09-11", LATE_DIENST)]),
      }),
      counterparty: toets({
        employee: b,
        date: "2025-09-09",
        duty: VROEG_DIENST,
        surrendering: NACHT_DIENST,
        window: venster("2025-09-09"),
      }),
    });
    expect(uitkomst.decision).toBe("BLOCK");
    expect(
      uitkomst.findings.some(
        (item) =>
          item.ruleId === RULE.NIGHT_REST_AFTER_0200 && item.employeeNumber === "100001",
      ),
    ).toBe(true);
  });
});

describe("reserve-invulling", () => {
  it("blokkeert wie die dag niet op een RES-positie staat", async () => {
    const uitkomst = await engine.evaluateReserveFill({
      type: "RESERVE_FILL",
      check: toets({ date: "2025-09-09", window: venster("2025-09-09") }),
      onReservePosition: false,
    });
    expect(uitkomst.decision).toBe("BLOCK");
    expect(overtredingen(uitkomst.findings)).toContain("PRODUCT_RESERVE_POSITION");
  });

  it("laat een reservemedewerker toe; de voorkeur filtert niets weg", async () => {
    const uitkomst = await engine.evaluateReserveFill({
      type: "RESERVE_FILL",
      check: toets({
        employee: medewerker({ rosterProfile: "LAAT_NACHT", reservePreference: "VROEG" }),
        date: "2025-09-09",
        duty: NACHT_DIENST,
        replacedPosition: "RES",
        window: venster("2025-09-09", [resDag("2025-09-09")]),
      }),
      onReservePosition: true,
    });

    expect(uitkomst.decision).not.toBe("BLOCK");
  });
});

describe("waarborgen van de engine zelf", () => {
  it("weigert een venster dat de betrokken dag niet bevat", async () => {
    await expect(
      engine.evaluateDutyEligibility({
        type: "DUTY_ELIGIBILITY",
        check: toets({
          date: "2025-09-09",
          window: { from: "2025-10-01", to: "2025-10-10", days: [] },
        }),
      }),
    ).rejects.toThrow(/venster/i);
  });

  it("keurt niets goed op grond van een te smal venster", async () => {
    // Vroeger wierp dit een uitzondering. Nu levert het een uitkomst op die
    // precies benoemt welke vensters ontbraken — informatiever, en het
    // blokkeert net zo goed.
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({
        date: "2025-09-09",
        window: { from: "2025-09-08", to: "2025-09-10", days: [] },
      }),
    });
    expect(uitkomst.decision).toBe("BLOCK");
    expect(uitkomst.outcome).toBe("CONTEXT_INCOMPLETE");
    expect(uitkomst.contextGaps.length).toBeGreaterThan(0);
  });

  it("geeft dezelfde invoer dezelfde vingerafdruk", async () => {
    const eerste = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets(),
    });
    const tweede = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets(),
    });
    expect(eerste.inputDigest).toBe(tweede.inputDigest);

    const andere = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets({ duty: LATE_DIENST }),
    });
    expect(andere.inputDigest).not.toBe(eerste.inputDigest);
  });

  it("draagt de regelversie en de juridische status mee in elke uitkomst", async () => {
    const uitkomst = await engine.evaluateDutyEligibility({
      type: "DUTY_ELIGIBILITY",
      check: toets(),
    });
    expect(uitkomst.rulesetVersion).not.toBe("");
    expect(uitkomst.legalStatus).toBe("LEGAL_RULESET_NOT_CURRENTLY_VERIFIED");
    expect(uitkomst.rulesetMode).toBe("SOURCE_RULESET_SIMULATION");
  });

  it("levert geen rooster op zolang de optimizer niet bestaat", async () => {
    // Een placeholder die iets teruggeeft wat op een rooster lijkt, is
    // gevaarlijker dan een die weigert.
    const uitkomst = await engine.generateRoster({
      type: "ROSTER_GENERATION",
      baseRosterIds: ["r1", "r2"],
      employees: [medewerker()],
      duties: [VROEG_DIENST],
      horizon: { from: "2025-09-01", to: "2025-12-01" },
      aggregatedFeedback: [],
      objectiveWeights: {},
    });
    expect(uitkomst.status).toBe("NOT_IMPLEMENTED");
    expect(uitkomst.versionId).toBeUndefined();
  });

  it("beschrijft de regels rechtstreeks uit het regelbestand", () => {
    const regels = engine.describeRules();
    expect(regels.length).toBeGreaterThan(50);
    // Elke regel heeft een uitleg: de catalogus is bedoeld om aan mensen te
    // laten zien, niet alleen om af te vinken.
    expect(regels.every((regel) => regel.rationale.length > 20)).toBe(true);
    expect(regels.map((regel) => regel.id)).toContain(RULE.RP_DAILY_REST_PLANNED);
  });
});
