import { describe, expect, it } from "vitest";
import { RosterProfile } from "@/lib/generated/prisma/enums";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { validateCandidate } from "@/server/rules-engine/final-validator";
import {
  EMPLOYEE,
  buildCandidate,
  contextFor,
  firedRules,
  portFor,
  type CandidateSpec,
} from "./fixture";

/**
 * Mutantkandidaten.
 *
 * De kritieke acceptatietest van deze fase. Een optimizer mág een onmogelijk
 * rooster voorstellen — dat is precies waarom er een onafhankelijke validator
 * achter zit. Wat níét mag, is dat zo'n voorstel er ongemerkt doorheen komt.
 *
 * Elke test hieronder bouwt met opzet een kapotte kandidaat en eist twee dingen:
 * de kandidaat komt tot stand, en de validator wijst hem af met de regel die
 * erbij hoort. Alleen "afgewezen" zou te zwak zijn: op dit moment wordt élke
 * kandidaat afgewezen omdat het regelbestand onvolledig is, en dan zou een test
 * kunnen slagen zonder dat de bedoelde regel ooit heeft gekeken.
 */

async function review(spec: CandidateSpec) {
  return validateCandidate(buildCandidate(spec), contextFor(spec), portFor(spec));
}

describe("een kandidaat die de regels overtreedt", () => {
  it("wijst acht diensten achter elkaar af", async () => {
    // Acht dienstdagen op rij in een cyclus van twee weken; het maximum is zeven.
    const result = await review({ lines: [{ pattern: "VVVVVVV VRRRRRR" }] });

    expect(firedRules(result)).toContain(RULE.MAX_CONSECUTIVE_SERVICES);
    // De regel is afgegaan. Of dat een bewezen overtreding is, hangt af van de
    // bron: onder een onbevestigd regelbestand is het een mogelijke bevinding.
    // Beide uitkomsten mogen — wat niet mag, is publiceren.
    expect(["CONFIRMED_HARD_VIOLATION", "TECHNICALLY_VALID_UNVERIFIED_RULES"]).toContain(
      result.status,
    );
    expect(result.publishable).toBe(false);
  });

  it("wijst elf uur negenenvijftig dagelijkse rust af", async () => {
    // Late dienst tot 20:01, de volgende dag een dienst vanaf 08:00.
    const result = await review({ lines: [{ pattern: "PARRRRR RRRRRRR" }] });

    expect(firedRules(result)).toContain(RULE.RP_DAILY_REST_PLANNED);
  });

  it("wijst dertien uur negenenvijftig na een nachtdienst af", async () => {
    // Nacht tot 06:00, daarna een dienst vanaf 19:59 op dezelfde dag.
    const result = await review({ lines: [{ pattern: "NBRRRRR RRRRRRR" }] });

    expect(firedRules(result)).toContain(RULE.NIGHT_REST_AFTER_0200);
  });

  it("wijst vijfenveertig uur negenenvijftig na drie nachtdiensten af", async () => {
    // Drie nachten (dag 1–3, laatste eindigt dag 4 om 06:00), daarna rust en op
    // dag 6 een dienst vanaf 03:59: 45 u 59 herstel waar 46 uur vereist is.
    const result = await review({ lines: [{ pattern: "NNNRRCR RRRRRRR" }] });

    expect(firedRules(result)).toContain(RULE.NIGHT_SEQUENCE_RECOVERY);
  });

  it("wijst een nachtdienst in het profiel Vroeg af", async () => {
    const result = await review({
      lines: [
        {
          pattern: "NRRRRRR RRRRRRR",
          employee: { ...EMPLOYEE, rosterProfile: RosterProfile.VROEG },
        },
      ],
    });

    expect(firedRules(result)).toContain(RULE.ROSTER_PROFILE_BOUNDS);
  });

  // De fout uit het scenario-PDF van v1.0.2: 701 (05:01–13:00) in Laat/Nacht.
  // Een vroege dienst in dat profiel is geen kwaliteitskwestie maar een harde
  // grens, en de eindvalidatie moet hem zelf vinden — niet op de optimizer
  // vertrouwen.
  it("wijst een vroege dienst in het profiel Laat/Nacht af", async () => {
    const result = await review({
      lines: [{ pattern: "VRRRRRR RRRRRRR", employee: { ...EMPLOYEE, rosterProfile: RosterProfile.LAAT_NACHT } }],
    });
    expect(firedRules(result)).toContain(RULE.ROSTER_PROFILE_BOUNDS);
  });

  it("wijst een late dienst in het profiel Vroeg af", async () => {
    const result = await review({
      lines: [{ pattern: "LRRRRRR RRRRRRR", employee: { ...EMPLOYEE, rosterProfile: RosterProfile.VROEG } }],
    });
    expect(firedRules(result)).toContain(RULE.ROSTER_PROFILE_BOUNDS);
  });

  it("wijst een nachtdienst in het profiel Vroeg/Laat af", async () => {
    const result = await review({
      lines: [{ pattern: "NRRRRRR RRRRRRR", employee: { ...EMPLOYEE, rosterProfile: RosterProfile.VROEG_LAAT } }],
    });
    expect(firedRules(result)).toContain(RULE.ROSTER_PROFILE_BOUNDS);
  });

  it("laat een late en een nachtdienst in Laat/Nacht toe", async () => {
    const result = await review({
      lines: [{ pattern: "LRRNRRR RRRRRRR", employee: { ...EMPLOYEE, rosterProfile: RosterProfile.LAAT_NACHT } }],
    });
    expect(firedRules(result)).not.toContain(RULE.ROSTER_PROFILE_BOUNDS);
  });

  it("wijst een dubbele toewijzing op dezelfde cyclusdag af", async () => {
    const spec: CandidateSpec = {
      lines: [{ pattern: "VRRRRRR RRRRRRR" }],
      extraAssignments: [
        {
          baseRosterCode: "DDR-VL",
          lineNumber: 1,
          // Dezelfde cyclusdag als de eerste dag van het patroon: week 1,
          // maandag. De weekindex telt vanaf één, net als in de database.
          weekIndex: 1,
          weekday: 1,
          positionType: "DUTY",
          dutyCode: "141",
        },
      ],
    };
    const result = await validateCandidate(buildCandidate(spec), contextFor(spec), portFor(spec));

    // Twee diensten op één dag is geen roosterprobleem maar een onmogelijkheid.
    // Zonder deze controle zou de laatste stilzwijgend winnen bij het uitrollen.
    expect(result.tally.unvalidatableAssignments).toBeGreaterThan(0);
    expect(result.status).toBe("INVALID_STRUCTURE");
    // Structureel onbeoordeelbaar blokkeert ook de simulatie: een scenario
    // waarvan een deel nooit is nagerekend, mag niet worden vergeleken alsof
    // het compleet is.
    expect(result.simulationEligible).toBe(false);
    expect(result.publishable).toBe(false);
    expect(result.blockingReasons.join(" ")).toContain("meer dan één toewijzing");
  });

  it("wijst een lijn zonder bezetter af in plaats van hem over te slaan", async () => {
    const spec: CandidateSpec = { lines: [{ pattern: "VRRRRRR RRRRRRR" }] };
    const port = portFor(spec);
    const result = await validateCandidate(buildCandidate(spec), contextFor(spec), {
      ...port,
      async rosters() {
        const rosters = await port.rosters([]);
        return rosters.map((roster) => ({
          ...roster,
          lines: roster.lines.map((line) => ({ ...line, occupant: null })),
        }));
      },
    });

    expect(result.tally.unvalidatableAssignments).toBeGreaterThan(0);
    expect(result.tally.checkedAssignments).toBe(0);
    expect(result.status).toBe("INVALID_STRUCTURE");
    expect(result.simulationEligible).toBe(false);
    expect(result.publishable).toBe(false);
  });
});

describe("wat een geldige kandidaat wél oplevert", () => {
  it("keurt niets goed zolang het regelbestand onvolledig is", async () => {
    // Een rustig rooster: twee diensten per week met ruime rust ertussen.
    const result = await review({ lines: [{ pattern: "VRRVRRR VRRVRRR" }] });

    // Geen bevestigde overtreding — er valt op dit moment niets te bevestigen.
    expect(result.tally.confirmedHardViolations).toBe(0);
    // En toch niet publiceerbaar, met de reden erbij.
    expect(result.publishable).toBe(false);
    expect(result.blockingReasons.join(" ")).toContain("regelpakketten ontbreken");
  });

  it("noemt de juridische status nooit iets anders dan simulatie", async () => {
    const result = await review({ lines: [{ pattern: "VRRVRRR VRRVRRR" }] });
    expect(result.legalStatus).toBe("SIMULATION_ONLY");
  });
});

describe("de validator mag niet goedkeuren wat hij niet heeft bekeken", () => {
  it("beoordeelt elke dienstdag voor elke medewerker die hem rijdt", async () => {
    // Twee regels met elk één dienstdag, allebei bezet. Elke medewerker legt de
    // hele cyclus af langs beide regels, dus elke dienstdag wordt door beide
    // gereden: 2 medewerkers x 2 dienstdagen = 4 beoordelingen.
    //
    // Deze verwachting stond eerst op 2 — het aantal dienstdagen in het
    // patroon. Dat was de fout: het rooster is een cyclus die iedereen
    // doorloopt, niet een regel die één iemand herhaalt. Wie hier 2 verwacht,
    // verwacht precies het rooster dat niemand rijdt.
    const spec: CandidateSpec = {
      lines: [{ pattern: "VRRRRRR RRRRRRR" }, { pattern: "RVRRRRR RRRRRRR" }],
    };
    const result = await validateCandidate(buildCandidate(spec), contextFor(spec), portFor(spec));

    const dienstdagen = buildCandidate(spec).assignments.filter(
      (entry) => entry.positionType === "DUTY" && entry.dutyCode !== null,
    ).length;
    const bezetteRegels = spec.lines.length;
    expect(result.tally.checkedAssignments).toBe(dienstdagen * bezetteRegels);
  });

  it("meldt een tekort als tekort en niet als schoon", async () => {
    // Een dienstenlijst die één van de twee gebruikte nummers niet kent. De
    // andere dienstdag kan dan niet worden opgebouwd en blijft ongetoetst.
    const spec: CandidateSpec = {
      lines: [{ pattern: "VBRRRRR RRRRRRR" }],
    };
    const port = portFor(spec);
    const result = await validateCandidate(buildCandidate(spec), contextFor(spec), {
      ...port,
      async duties(codes) {
        const alle = await port.duties(codes);
        // Alleen de vroegdienst blijft over; de late verdwijnt uit het pakket.
        return alle.filter((duty) => duty.kinds.includes("VROEG"));
      },
    });

    expect(result.tally.unvalidatableAssignments).toBeGreaterThan(0);
    expect(result.status).toBe("INVALID_STRUCTURE");
    expect(result.simulationEligible).toBe(false);
    expect(result.publishable).toBe(false);
    expect(result.blockingReasons.join(" ")).toMatch(/ongetoetst|bestaat niet meer/);
  });
});
