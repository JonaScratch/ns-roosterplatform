import { describe, expect, it } from "vitest";
import { computeElapsedMs, isTerminalStatus } from "../../demo-room/src/runControl";

/**
 * § "Extra regressiechecks" (round G):
 * - "DONE/FAILED/STOPPED/COMPLETED run: opgeslagen eindtijd/duration blijft
 *   identiek na refresh en na meerdere seconden wachten."
 * - "actieve run: elapsed time blijft live toenemen."
 * - "oude run zonder expliciete endedAt: veilige fallback zonder opnieuw
 *   eeuwig door te tellen."
 *
 * `computeElapsedMs` is de pure functie achter `/api/current-run`s
 * `elapsedMs`-veld — deze tests roepen hem rechtstreeks aan met verschillende
 * `now`-waarden, zonder een echt bestand of proces nodig te hebben.
 */
describe("Demo Room v0.9 — computeElapsedMs (server-berekende verstreken tijd)", () => {
  const startedAt = "2026-09-27T10:00:00.000Z";
  const START_MS = new Date(startedAt).getTime();

  it("loopt live mee zolang de run nog geen eindstatus heeft", () => {
    const state = { startedAt, finishedAt: null, status: "RUNNING" as const };
    const na10s = computeElapsedMs(state, START_MS + 10_000);
    const na20s = computeElapsedMs(state, START_MS + 20_000);
    expect(na10s).toBe(10_000);
    expect(na20s).toBe(20_000);
    expect(na20s).toBeGreaterThan(na10s);
  });

  it("blijft na een eindstatus met finishedAt exact hetzelfde, ongeacht hoe laat of hoe vaak het opnieuw wordt opgevraagd", () => {
    const finishedAt = "2026-09-27T10:05:00.000Z"; // 5 minuten looptijd
    const state = { startedAt, finishedAt, status: "DONE" as const };
    const directNaAfronding = computeElapsedMs(state, new Date(finishedAt).getTime());
    const naEenUurWachten = computeElapsedMs(state, new Date(finishedAt).getTime() + 3_600_000);
    const naEenDagWachten = computeElapsedMs(state, new Date(finishedAt).getTime() + 86_400_000);
    expect(directNaAfronding).toBe(5 * 60_000);
    expect(naEenUurWachten).toBe(5 * 60_000);
    expect(naEenDagWachten).toBe(5 * 60_000);
  });

  it("geldt voor elke eindstatus (DONE/FAILED/STOPPED) — nooit alleen voor DONE", () => {
    const finishedAt = "2026-09-27T10:02:00.000Z";
    for (const status of ["DONE", "FAILED", "STOPPED"] as const) {
      const state = { startedAt, finishedAt, status };
      expect(computeElapsedMs(state, new Date(finishedAt).getTime() + 999_999)).toBe(2 * 60_000);
    }
  });

  it("gebruikt een vast fallback-ijkpunt (nooit `now`) voor een oude/beschadigde eindstatus zonder finishedAt, en telt dus niet eeuwig door", () => {
    const state = { startedAt, finishedAt: null, status: "DONE" as const };
    const fallbackEndMs = START_MS + 42_000; // bijv. mtime van het statusbestand
    const nu = computeElapsedMs(state, fallbackEndMs, fallbackEndMs);
    const veelLaterOpgevraagd = computeElapsedMs(state, fallbackEndMs + 3_600_000, fallbackEndMs);
    expect(nu).toBe(42_000);
    expect(veelLaterOpgevraagd).toBe(42_000);
    expect(veelLaterOpgevraagd).toBe(nu); // blijft identiek, groeit niet mee met `now`
  });

  it("zonder enige fallback (ook geen bestand) valt terug op 0 in plaats van tegen `now` te rekenen", () => {
    const state = { startedAt, finishedAt: null, status: "FAILED" as const };
    expect(computeElapsedMs(state, START_MS + 999_999)).toBe(0);
  });

  it("isTerminalStatus onderscheidt correct STARTING/RUNNING (niet-terminaal) van DONE/FAILED/STOPPED (terminaal)", () => {
    expect(isTerminalStatus("STARTING")).toBe(false);
    expect(isTerminalStatus("RUNNING")).toBe(false);
    expect(isTerminalStatus("DONE")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("STOPPED")).toBe(true);
  });
});
