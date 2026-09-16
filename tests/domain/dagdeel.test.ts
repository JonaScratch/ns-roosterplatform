import { describe, expect, it } from "vitest";
import { DutyKind, DutyPeriod, DutyWorkType, RosterProfile } from "@/lib/generated/prisma/enums";
import { classifyDuty, resolveDayparts } from "@/domain/duty-classification";
import { profileAllowsDuty } from "@/domain/roster-profiles";

/**
 * Dagdeel uit de aanvangstijd, en de profielgrenzen die daarop rusten.
 *
 * De aanleiding staat in één regel van een gegenereerd Laat/Nacht-blad: dienst
 * 701, 05:01–13:00. Rangeer had op nummer geen dagdeel, dus geen enkel profiel
 * sloot hem uit. Deze tests houden twee dingen vast: dat zo'n dienst nu wél een
 * dagdeel krijgt, en dat de profielen dat dagdeel ook echt weigeren.
 */

function dienst(code: string, weekday: number, start: string) {
  const [uur, minuut] = start.split(":").map(Number);
  const nummer = classifyDuty(code);
  return {
    code,
    weekday,
    startMinute: uur * 60 + minuut,
    period: nummer.period,
    workType: nummer.workType,
    kinds: nummer.kinds,
  };
}

/** Een klein pakket met de Dordrechtse vensters in grote lijnen. */
const PAKKET = [
  dienst("1", 1, "04:27"),
  dienst("11", 1, "08:49"),
  dienst("101", 1, "17:19"),
  dienst("115", 4, "09:47"),
  dienst("107", 2, "14:36"),
  dienst("201", 1, "21:24"),
  dienst("760", 1, "22:00"),
];

describe("dagdeel uit de aanvangstijd", () => {
  it("geeft rangeerdienst 701 van 05:01 het dagdeel vroeg", () => {
    const { duties } = resolveDayparts([...PAKKET, dienst("701", 2, "05:01")]);
    const zevenhonderdeen = duties.find((entry) => entry.code === "701")!;
    expect(zevenhonderdeen.period).toBe(DutyPeriod.VROEG);
    expect(zevenhonderdeen.kinds).toEqual([DutyKind.VROEG, DutyKind.RANGEER]);
    expect(zevenhonderdeen.workType).toBe(DutyWorkType.RANGEER);
  });

  it("geeft rangeerdienst 732 van 18:00 het dagdeel laat, niet nacht", () => {
    // 18:00 ligt 41 minuten na de laatste late aanvang en drie uur vóór de
    // eerste nachtdienst. Officieel staat 732 in Laat en Laat/Nacht.
    const { duties } = resolveDayparts([...PAKKET, dienst("732", 3, "18:00")]);
    expect(duties.find((entry) => entry.code === "732")!.period).toBe(DutyPeriod.LAAT);
  });

  it("gebruikt de CAO-nachtdefinitie niet voor het dagdeel", () => {
    // Een rangeerdienst van 16:30 loopt tot na 01:00 en is naar de CAO dus
    // een nachtdienst op de klok. Het lokale dagdeel is laat, zoals dienst 101.
    const { duties } = resolveDayparts([...PAKKET, dienst("730", 5, "16:30")]);
    expect(duties.find((entry) => entry.code === "730")!.period).toBe(DutyPeriod.LAAT);
  });

  it("beslist bij overlappende vensters op de mediane aanvangstijd", () => {
    // 11:00 valt tussen de vroegste late (09:47) en een uitschieter van een
    // vroegdienst (11:30): in beide vensters. De late diensten beginnen in de
    // regel veel dichter bij 11:00 dan de vroege.
    const metUitschieter = [
      ...PAKKET,
      // De meeste vroegdiensten beginnen rond half zes, zoals in Dordrecht.
      dienst("2", 1, "05:00"),
      dienst("3", 1, "05:30"),
      dienst("4", 1, "06:00"),
      dienst("71", 3, "11:30"),
      dienst("731", 5, "11:00"),
    ];
    const { duties, unresolved } = resolveDayparts(metUitschieter);
    expect(unresolved).toEqual([]);
    expect(duties.find((entry) => entry.code === "731")!.period).toBe(DutyPeriod.LAAT);
  });

  it("kiest niet bij een werkelijke gelijkstand, maar meldt hem", () => {
    const tweeVensters = [dienst("1", 1, "06:00"), dienst("101", 1, "14:00")];
    const { duties, unresolved } = resolveDayparts([...tweeVensters, dienst("701", 1, "10:00")]);
    expect(duties.find((entry) => entry.code === "701")!.period).toBe(DutyPeriod.GEEN);
    expect(unresolved).toHaveLength(1);
  });

  it("verzint niets als het pakket geen dagdelen op nummer heeft", () => {
    const { duties, unresolved } = resolveDayparts([dienst("701", 1, "05:01")]);
    expect(duties[0].period).toBe(DutyPeriod.GEEN);
    expect(unresolved[0].reason).toMatch(/geen diensten met een dagdeel/);
  });

  it("laat diensten met een dagdeel op nummer ongemoeid", () => {
    const { duties, derived } = resolveDayparts(PAKKET);
    expect(duties).toEqual(PAKKET);
    expect(derived).toEqual([]);
  });

  it("rekent rond middernacht de kortste kant om de klok", () => {
    // 00:30 ligt anderhalf uur na de laatste nachtaanvang (23:00), niet
    // tweeëntwintig uur ervoor.
    const pakket = [...PAKKET, dienst("761", 2, "23:00"), dienst("703", 6, "00:30")];
    const { duties } = resolveDayparts(pakket);
    expect(duties.find((entry) => entry.code === "703")!.period).toBe(DutyPeriod.NACHT);
  });
});

describe("absolute profielgrenzen", () => {
  const vroegeRangeer = [DutyKind.VROEG, DutyKind.RANGEER];
  const lateRangeer = [DutyKind.LAAT, DutyKind.RANGEER];

  it("Laat/Nacht weigert een vroege dienst, ook als het rangeerwerk is", () => {
    expect(profileAllowsDuty(RosterProfile.LAAT_NACHT, [DutyKind.VROEG])).toBe(false);
    expect(profileAllowsDuty(RosterProfile.LAAT_NACHT, vroegeRangeer)).toBe(false);
    expect(profileAllowsDuty(RosterProfile.LAAT_NACHT, lateRangeer)).toBe(true);
    expect(profileAllowsDuty(RosterProfile.LAAT_NACHT, [DutyKind.NACHT, DutyKind.RANGEER])).toBe(true);
  });

  it("Vroeg weigert late en nachtdiensten", () => {
    expect(profileAllowsDuty(RosterProfile.VROEG, [DutyKind.LAAT])).toBe(false);
    expect(profileAllowsDuty(RosterProfile.VROEG, [DutyKind.NACHT])).toBe(false);
    expect(profileAllowsDuty(RosterProfile.VROEG, lateRangeer)).toBe(false);
    expect(profileAllowsDuty(RosterProfile.VROEG, vroegeRangeer)).toBe(true);
  });

  it("Vroeg/Laat weigert nachtdiensten", () => {
    expect(profileAllowsDuty(RosterProfile.VROEG_LAAT, [DutyKind.NACHT])).toBe(false);
    expect(profileAllowsDuty(RosterProfile.VROEG_LAAT, [DutyKind.NACHT, DutyKind.RANGEER])).toBe(false);
    expect(profileAllowsDuty(RosterProfile.VROEG_LAAT, vroegeRangeer)).toBe(true);
    expect(profileAllowsDuty(RosterProfile.VROEG_LAAT, lateRangeer)).toBe(true);
  });

  it("Laat weigert vroege en nachtdiensten", () => {
    expect(profileAllowsDuty(RosterProfile.LAAT, vroegeRangeer)).toBe(false);
    expect(profileAllowsDuty(RosterProfile.LAAT, [DutyKind.NACHT])).toBe(false);
    expect(profileAllowsDuty(RosterProfile.LAAT, lateRangeer)).toBe(true);
  });
});
