import { describe, expect, it } from "vitest";
import { procesLeeft, STARTING_GRACE_MS, verlorenRunCorrectie, type RunControlState } from "../../demo-room/src/runControl";

/**
 * Een "lopende" run waarvan het proces weg is, telt als FAILED — anders meldt
 * het dashboard eeuwig "loopt" en blokkeert het elke nieuwe run. Gevonden bij
 * de visuele controle van 2026-09-29 (2551 min "verstreken" voor een run die
 * al anderhalve dag niet meer bestond).
 */

const START = "2026-09-27T20:58:48.000Z";
const T0 = new Date(START).getTime();
const basis: RunControlState = {
  runId: "DR-X", kind: "development-run", command: "development-run", startedAt: START, pid: 4242,
  status: "RUNNING", finishedAt: null, exitCode: null, tailOutput: "", errorMessage: null,
};
const dood = () => false;
const levend = () => true;

describe("verlorenRunCorrectie", () => {
  it("RUNNING met een levend proces blijft ongemoeid", () => {
    expect(verlorenRunCorrectie(basis, levend, T0 + 3_600_000, T0)).toBeNull();
  });

  it("RUNNING met een verdwenen proces wordt FAILED, met een eerlijke melding en een vaste eindtijd", () => {
    const c = verlorenRunCorrectie(basis, dood, T0 + 42 * 3_600_000, T0 + 8 * 60_000);
    expect(c?.status).toBe("FAILED");
    expect(c?.errorMessage).toMatch(/PID 4242.*bestaat niet meer/);
    // Eindtijd = laatste teken van leven (wijzigingstijd van het statusbestand), niet "nu".
    expect(c?.finishedAt).toBe(new Date(T0 + 8 * 60_000).toISOString());
  });

  it("STARTING zonder PID krijgt een korte gunperiode, daarna FAILED", () => {
    const starting = { ...basis, status: "STARTING" as const, pid: -1 };
    expect(verlorenRunCorrectie(starting, dood, T0 + STARTING_GRACE_MS - 1, T0)).toBeNull();
    const c = verlorenRunCorrectie(starting, dood, T0 + STARTING_GRACE_MS + 1, T0);
    expect(c?.status).toBe("FAILED");
    expect(c?.errorMessage).toMatch(/nooit voorbij het starten/);
  });

  it("een eindstatus wordt nooit aangeraakt", () => {
    for (const status of ["DONE", "FAILED", "STOPPED"] as const) {
      expect(verlorenRunCorrectie({ ...basis, status, finishedAt: START }, dood, T0 + 1e9, T0)).toBeNull();
    }
  });

  it("de eindtijd valt nooit vóór de start (bestand ouder dan de run)", () => {
    const c = verlorenRunCorrectie(basis, dood, T0 + 1000, T0 - 60_000);
    expect(c?.finishedAt).toBe(START);
  });
});

describe("procesLeeft", () => {
  it("herkent het eigen proces als levend en onzin-PID's als dood", () => {
    expect(procesLeeft(process.pid)).toBe(true);
    expect(procesLeeft(-1)).toBe(false);
    expect(procesLeeft(0)).toBe(false);
    expect(procesLeeft(2_147_483_000)).toBe(false);
  });
});
