import { describe, expect, it } from "vitest";
import {
  ATTENTION_LABEL,
  RULE_GROUPS,
  attentionNotice,
  groupForRule,
  ruleEffect,
} from "@/domain/rule-presentation";
import { activeRuleset } from "@/server/rules-engine";
import { BLOCKING_STATUSES, type RuleStatus } from "@/server/rules-engine/ruleset/types";

/**
 * Hoe de regelcatalogus wordt ingedeeld en toegelicht.
 *
 * De indeling is een presentatiekeuze, maar niet vrijblijvend: een regel die in
 * geen enkele groep valt, verdwijnt van het scherm, en een regel die blokkeert
 * en toch onder zijn onderwerp staat, is precies wat iemand over het hoofd
 * ziet. Beide worden hier tegen het échte regelbestand gecontroleerd.
 */

const ALLE_STATUSSEN: readonly RuleStatus[] = [
  "VALIDATED",
  "SOURCE_TRANSCRIBED",
  "UNVALIDATED_LOCAL_PARAMETER",
  "NEEDS_POLICY_VALIDATION",
  "POLICY_PENDING",
  "UNRESOLVED",
  "NOT_SUPPLIED",
];

describe("de indeling", () => {
  const ruleset = activeRuleset();

  it("plaatst elke regel uit het echte regelbestand in een bestaande groep", () => {
    const geldig = new Set(RULE_GROUPS.map((groep) => groep.id));
    for (const rule of ruleset.rules) {
      expect(geldig.has(groupForRule(rule))).toBe(true);
    }
  });

  it("laat geen regel achter buiten de zes groepen", () => {
    const ingedeeld = ruleset.rules.map((rule) => groupForRule(rule));
    expect(ingedeeld).toHaveLength(ruleset.rules.length);
    expect(ruleset.rules.length).toBeGreaterThan(50);
  });

  it("zet elke blokkerende regel bij de nog te bevestigen punten", () => {
    // Dit is de reden dat de status vóór het onderwerp gaat: wie wil weten wat
    // er in de weg staat, hoort niet zes groepen te hoeven openklappen.
    for (const rule of ruleset.rules) {
      if (BLOCKING_STATUSES.includes(rule.status) || rule.value === null) {
        expect(groupForRule(rule)).toBe("TE_BEVESTIGEN");
      }
    }
  });

  it("houdt regels die wél werken uit die groep", () => {
    for (const rule of ruleset.rules) {
      if (groupForRule(rule) === "TE_BEVESTIGEN") {
        expect(BLOCKING_STATUSES.includes(rule.status) || rule.value === null).toBe(true);
      }
    }
  });

  it("zet regionale en lokale regels bij Regio West en Dordrecht", () => {
    const regionaal = ruleset.rules.filter(
      (rule) =>
        (rule.source.layer === "REGIONAL" || rule.source.layer === "LOCAL") &&
        !BLOCKING_STATUSES.includes(rule.status) &&
        rule.value !== null,
    );
    expect(regionaal.length).toBeGreaterThan(0);
    for (const rule of regionaal) {
      expect(groupForRule(rule)).toBe("REGIO");
    }
  });

  it("zet de plaatsingsregels bij Dienstplaatsing", () => {
    for (const id of ["DEPOT_MATCH", "QUALIFICATIONS_REQUIRED", "DAY_AVAILABLE"]) {
      const rule = ruleset.rules.find((kandidaat) => kandidaat.id === id);
      expect(rule, `regel ${id} bestaat`).toBeDefined();
      expect(groupForRule(rule!)).toBe("PLAATSING");
    }
  });

  it("zet de profielgrens bij Roosterprofielen", () => {
    const rule = ruleset.rules.find((kandidaat) => kandidaat.id === "ROSTER_PROFILE_BOUNDS");
    expect(groupForRule(rule!)).toBe("PROFIELEN");
  });

  it("scheidt rusttijden van roosteropbouw", () => {
    const rust = ruleset.rules.find((kandidaat) => kandidaat.id === "WEEKLY_REST_36H_PER_7D");
    const opbouw = ruleset.rules.find((kandidaat) => kandidaat.id === "R_DAYS_PER_WEEK_AVG");
    expect(groupForRule(rust!)).toBe("ARBEID_RUST");
    expect(groupForRule(opbouw!)).toBe("ROOSTER");
  });

  it("vult elke groep die iets bevat met een uitleg in gewone taal", () => {
    for (const groep of RULE_GROUPS) {
      expect(groep.title.length).toBeGreaterThan(3);
      expect(groep.intro.length).toBeGreaterThan(40);
      // Geen technische codes in de uitleg die de commissie leest.
      expect(groep.intro).not.toMatch(/SOURCE_TRANSCRIBED|HARD_CONSTRAINT|[A-Z]{4,}_[A-Z]{3,}/);
    }
  });
});

describe("de waarschuwing bij een regel", () => {
  it("zegt niets bij een regel die gewoon werkt", () => {
    // Zestig van de eenenzeventig regels staan op SOURCE_TRANSCRIBED. Een
    // waarschuwing bij elk daarvan waarschuwt nergens meer voor.
    expect(attentionNotice("SOURCE_TRANSCRIBED")).toBeNull();
    expect(attentionNotice("VALIDATED")).toBeNull();
  });

  it.each(BLOCKING_STATUSES)("geeft bij %s een uitleg in gewone taal", (status) => {
    const tekst = attentionNotice(status);
    expect(tekst).not.toBeNull();
    expect(tekst!.length).toBeGreaterThan(60);
    // Geen enum-namen, geen codes: dit is wat een mens leest.
    expect(tekst!).not.toMatch(/[A-Z]{4,}_[A-Z]{3,}/);
  });

  it("noemt bij een meerduidige bron niet welke lezing gekozen is", () => {
    const tekst = attentionNotice("UNRESOLVED")!;
    expect(tekst).toContain("meer dan één manier");
    expect(tekst).toContain("geblokkeerd");
  });

  it("gebruikt LET OP als etiket en niet de oude formulering", () => {
    expect(ATTENTION_LABEL).toBe("LET OP");
  });

  it("dekt elke status af", () => {
    for (const status of ALLE_STATUSSEN) {
      // Mag null zijn, mag tekst zijn, maar niet undefined: dan is er een
      // status bijgekomen zonder dat iemand de uitleg heeft geschreven.
      expect(attentionNotice(status)).not.toBeUndefined();
    }
  });
});

describe("wat een regel doet", () => {
  it("noemt een bevestigde regel bevestigd", () => {
    expect(ruleEffect({ status: "VALIDATED", value: 1 })).toBe("BEVESTIGD");
  });

  it("noemt een overgenomen regel toegepast", () => {
    expect(ruleEffect({ status: "SOURCE_TRANSCRIBED", value: 12 })).toBe("WORDT_TOEGEPAST");
  });

  it.each(BLOCKING_STATUSES)("noemt %s blokkerend", (status) => {
    expect(ruleEffect({ status, value: 12 })).toBe("BLOKKEERT");
  });

  it("noemt een regel zonder waarde blokkerend, ook als de status goed is", () => {
    // Een bevestigde regel zonder waarde kan niets toetsen. Zou hij als
    // "bevestigd" tellen, dan lijkt er een grens te zijn waar er geen is.
    expect(ruleEffect({ status: "VALIDATED", value: null })).toBe("BLOKKEERT");
  });
});
