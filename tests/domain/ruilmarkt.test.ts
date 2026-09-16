import { describe, expect, it } from "vitest";
import { preferenceWeight } from "@/domain/ruilmarkt";

/**
 * De sortering van ruilmarktkandidaten op voorkeur.
 *
 * Dit filtert nooit — een kandidaat die niet aan de voorkeur voldoet, krijgt
 * een hoger gewicht en dus een latere plek, maar blijft in de lijst staan.
 * Deze tests bewijzen dat onderscheid: filteren en sorteren zijn twee
 * verschillende dingen, en een voorkeur is geen regel.
 */

describe("preferenceWeight zonder voorkeur", () => {
  it("geeft altijd hetzelfde gewicht, ongeacht de tijden", () => {
    expect(preferenceWeight(600, 300, "NONE")).toBe(0);
    expect(preferenceWeight(600, 900, "NONE")).toBe(0);
    expect(preferenceWeight(600, 600, "NONE")).toBe(0);
  });
});

describe("preferenceWeight met 'graag vroeger'", () => {
  const aangeboden = 17 * 60 + 49; // dienst 101, 17:49

  it("een eerder beginnende dienst krijgt het laagste gewicht", () => {
    const vroeger = preferenceWeight(aangeboden, 8 * 60, "EARLIER");
    const gelijk = preferenceWeight(aangeboden, aangeboden, "EARLIER");
    const later = preferenceWeight(aangeboden, 22 * 60, "EARLIER");
    expect(vroeger).toBeLessThan(gelijk);
    expect(gelijk).toBeLessThan(later);
  });

  it("een latere dienst krijgt niet het gewicht van een vroegere", () => {
    expect(preferenceWeight(aangeboden, 22 * 60, "EARLIER")).not.toBe(
      preferenceWeight(aangeboden, 8 * 60, "EARLIER"),
    );
  });
});

describe("preferenceWeight met 'graag later'", () => {
  const aangeboden = 8 * 60; // een vroege dienst

  it("is het spiegelbeeld van 'graag vroeger'", () => {
    const vroeger = preferenceWeight(aangeboden, 6 * 60, "LATER");
    const gelijk = preferenceWeight(aangeboden, aangeboden, "LATER");
    const later = preferenceWeight(aangeboden, 20 * 60, "LATER");
    expect(later).toBeLessThan(gelijk);
    expect(gelijk).toBeLessThan(vroeger);
  });
});

describe("een voorkeur filtert nooit", () => {
  it("levert voor elke combinatie een eindig gewicht, nooit een uitsluiting", () => {
    for (const preference of ["NONE", "EARLIER", "LATER"] as const) {
      for (const kandidaat of [0, 500, 1000, 1439]) {
        expect(Number.isFinite(preferenceWeight(600, kandidaat, preference))).toBe(true);
      }
    }
  });
});
