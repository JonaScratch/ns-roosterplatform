import { existsSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { endRun, eventKindsIn, listRunLogs, log, readRunEvents, readRunText, redact, runJsonlFilePath, runTxtFilePath, startRun } from "../../demo-room/src/store/logbook";

const testRunIds: string[] = [];
function nieuweRunId(): string {
  const id = `TEST-RUN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  testRunIds.push(id);
  return id;
}

afterEach(() => {
  for (const id of testRunIds) {
    for (const p of [runTxtFilePath(id), runJsonlFilePath(id)]) if (existsSync(p)) rmSync(p, { force: true });
  }
  testRunIds.length = 0;
});

describe("Demo Room — logboek (audit trail)", () => {
  it("redigeert wachtwoorden, tokens en API-keys, maar laat gewone tekst intact", () => {
    expect(redact("DATABASE_URL=postgres://user:hunter2@localhost/db")).not.toContain("hunter2");
    expect(redact("password: zeerGeheim123")).not.toContain("zeerGeheim123");
    expect(redact("Authorization: Bearer abcdef1234567890")).not.toContain("abcdef1234567890");
    expect(redact("api_key=sk-abcdefghijklmnop")).not.toContain("sk-abcdefghijklmnop");
    expect(redact("Dit is een gewone zin over regel 043 op maandag.")).toBe("Dit is een gewone zin over regel 043 op maandag.");
  });

  it("startRun schrijft een leesbare header en een RUN_START-event", () => {
    const runId = nieuweRunId();
    startRun(runId, { kind: "proof", productionVersion: "lyra-prod-baseline", sandboxParent: null, modelConfig: "lokaal:qwen3", challengeOrGoal: "proof-of-value" });
    const tekst = readRunText(runId);
    expect(tekst).toContain(runId);
    expect(tekst).toContain("Production Lyra-versie: lyra-prod-baseline");
    expect(eventKindsIn(runId).has("RUN_START")).toBe(true);
  });

  it("log() is direct zichtbaar (crash-safe: geen buffering) en redigeert ook in latere events", () => {
    const runId = nieuweRunId();
    startRun(runId, { kind: "test", productionVersion: null, sandboxParent: null, modelConfig: null, challengeOrGoal: null });
    log(runId, { kind: "HYPOTHESIS", experimentId: "EXP-1", message: "Hypothese: candidateLabel overschrijft ten onrechte baseRoster." });
    log(runId, { kind: "ERROR", experimentId: null, message: "Verbinding mislukt met token=abcdef1234567890." });
    const tekst = readRunText(runId)!;
    expect(tekst).toContain("Hypothese: candidateLabel overschrijft");
    expect(tekst).not.toContain("abcdef1234567890");
    expect(tekst).toContain("[GEREDIGEERD]");
  });

  it("logt structurele wijzigingen met before/after-versie en rollback-referentie", () => {
    const runId = nieuweRunId();
    startRun(runId, { kind: "publish", productionVersion: "lyra-prod-2026-09-26-01", sandboxParent: "variant-a-tool-hint", modelConfig: "lokaal:qwen3", challengeOrGoal: null });
    log(runId, {
      kind: "CHANGE_APPLIED",
      experimentId: "EXP-42",
      message: "Systeeminstructie bijgewerkt.",
      change: { beforeVersion: "lyra-prod-2026-09-26-01", afterVersion: "lyra-prod-2026-09-26-02", affectedFiles: ["NS_PRODUCTION_PROMPT_FILE"], causedByExperimentId: "EXP-42", rollbackReference: "lyra-prod-2026-09-26-01", diffReference: null },
    });
    const events = readRunEvents(runId);
    const wijziging = events.find((e) => e.kind === "CHANGE_APPLIED");
    expect(wijziging?.change?.beforeVersion).toBe("lyra-prod-2026-09-26-01");
    expect(wijziging?.change?.afterVersion).toBe("lyra-prod-2026-09-26-02");
    expect(wijziging?.change?.rollbackReference).toBe("lyra-prod-2026-09-26-01");
  });

  it("endRun schrijft een duidelijk afsluitend blok met de verplichte velden", () => {
    const runId = nieuweRunId();
    startRun(runId, { kind: "proof", productionVersion: null, sandboxParent: null, modelConfig: null, challengeOrGoal: null });
    endRun(runId, {
      outcome: "RUN_COMPLETED",
      totalDurationMs: 125_000,
      modelCalls: 12,
      experiments: 1,
      optimizerJobs: 0,
      variantsTested: 1,
      accepted: 0,
      rejected: 1,
      bestVariant: null,
      productionChanged: false,
      openHypotheses: [],
      lessonsLearned: ["holdout regresseerde, dus verworpen"],
    });
    const tekst = readRunText(runId)!;
    expect(tekst).toContain("=== RUN_COMPLETED ===");
    expect(tekst).toContain("Modelaanroepen: 12");
    expect(tekst).toContain("holdout regresseerde");
  });

  it("startRun overschrijft een eerder geschreven RUN_START_REQUESTED-event niet (§ 'live logboek moet robuust zijn')", () => {
    const runId = nieuweRunId();
    // Simuleert server.ts: het dashboard logt dit vóórdat het CLI-proces bestaat.
    log(runId, { kind: "RUN_START_REQUESTED", experimentId: null, message: "UI heeft een run aangevraagd (proof)." });
    // Simuleert cli.ts's withRunLogbook(): het CLI-proces schrijft pas hierna zijn eigen RUN_START-header.
    startRun(runId, { kind: "proof", productionVersion: "lyra-prod-baseline", sandboxParent: null, modelConfig: "lokaal:qwen3", challengeOrGoal: "proof-of-value" });
    const events = readRunEvents(runId);
    expect(events.map((e) => e.kind)).toEqual(["RUN_START_REQUESTED", "RUN_START"]);
    expect(readRunText(runId)).toContain("UI heeft een run aangevraagd");
  });

  it("listRunLogs vindt aangemaakte runs terug", () => {
    const runId = nieuweRunId();
    startRun(runId, { kind: "test", productionVersion: null, sandboxParent: null, modelConfig: null, challengeOrGoal: null });
    expect(listRunLogs().some((r) => r.runId === runId)).toBe(true);
  });
});
