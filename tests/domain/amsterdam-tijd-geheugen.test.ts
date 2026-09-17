import { describe, expect, it } from "vitest";
import { localAsIfUtc, localAsIfUtcViaIntl, zonedInstant } from "@/domain/amsterdam-time";
import { addDays, dayNumber, isCalendarDate } from "@/domain/time";

/**
 * Het geheugen in de tijdrekening mag niets aan de uitkomst veranderen.
 *
 * De offset wordt per UTC-uur onthouden omdat Europe/Amsterdam alleen op hele
 * UTC-uren van offset wisselt. Klopt die aanname ergens niet, dan wijkt de
 * uitkomst af van de rechtstreekse omzetting — en dat moet deze test zien.
 */
describe("tijdrekening met geheugen", () => {
  it("geeft over twee jaar, elke 7 minuten, exact dezelfde lokale tijd als Intl", () => {
    const begin = Date.UTC(2026, 0, 1);
    const einde = Date.UTC(2028, 0, 1);
    let afwijkingen = 0;
    for (let moment = begin; moment < einde; moment += 7 * 60_000 + 13_000) {
      if (localAsIfUtc(moment) !== localAsIfUtcViaIntl(moment)) {
        afwijkingen += 1;
      }
    }
    expect(afwijkingen).toBe(0);
  });

  it("klopt op de minuut rond beide zomertijdovergangen", () => {
    for (const overgang of [Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 9, 25, 1), Date.UTC(2027, 2, 28, 1)]) {
      for (let minuut = -120; minuut <= 120; minuut += 1) {
        const moment = overgang + minuut * 60_000;
        expect(localAsIfUtc(moment)).toBe(localAsIfUtcViaIntl(moment));
      }
    }
  });

  it("verandert de omzetting van wandklok naar moment niet", () => {
    // 02:30 in de voorjaarsnacht bestaat niet; de bestaande keuze blijft.
    expect(new Date(zonedInstant("2026-03-29", 150)).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // 02:30 in de herfstnacht bestaat twee keer; de omzetting kiest (al vóór het
    // geheugen) het tweede voorkomen, in wintertijd.
    expect(new Date(zonedInstant("2026-10-25", 150)).toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("onthoudt datums zonder ongeldige datums geldig te maken", () => {
    expect(isCalendarDate("2026-02-10")).toBe(true);
    expect(isCalendarDate("2026-02-10")).toBe(true);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(dayNumber("2026-02-10")).toBe(dayNumber("2026-02-10"));
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(() => dayNumber("geen-datum")).toThrow();
    expect(() => dayNumber("geen-datum")).toThrow();
  });
});
