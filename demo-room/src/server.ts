import "dotenv/config";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { CHALLENGES } from "./challenges/catalogue";
import { dashboardPort, HANDOFF_PATH, REPO_ROOT, REPORTS_DIR } from "./config";
import { currentRun, startCliRun, stopCurrentRun } from "./runControl";
import { readBenchmarkHistory } from "./store/benchmarkHistory";
import * as logbook from "./store/logbook";
import { listRunLogs, readRunEvents, readRunText, runJsonlFilePath, runTxtFilePath } from "./store/logbook";
import { readAllExperiments, listRunIds, readRunlog } from "./store/runlog";
import { getAutonomyResult, listAutonomyResults } from "./store/autonomyResults";
import { BASELINE_VERSION_ID, currentVersionId, getVersion, listVersions } from "./publish/versions";

/**
 * Het lokale dashboard (§20/§21 en v0.2 §4-§10).
 *
 * Dit proces importeert bewust GEEN hoofdapp-code: alle lees-endpoints lezen
 * platte bestanden (runlog, benchmarkgeschiedenis, versies, journaal,
 * HANDOFF), en elke actie (run starten, publiceren, herstellen) spawnt
 * `cli.ts` als apart proces (`runControl.ts`) — dezelfde uitvoering als
 * vanaf de terminal, geen tweede pad. Daardoor draait dit bestand zonder
 * `--conditions=react-server` en blijft de dashboardserver zelf licht.
 *
 *   npx tsx demo-room/src/server.ts
 */

const UI_DIR = path.join(path.dirname(__filename), "..", "ui");

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function serveFile(res: http.ServerResponse, filePath: string, contentType: string): void {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("niet gevonden");
    return;
  }
  res.writeHead(200, { "Content-Type": contentType });
  res.end(readFileSync(filePath));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const stukken: Buffer[] = [];
  for await (const stuk of req) stukken.push(stuk as Buffer);
  const tekst = Buffer.concat(stukken).toString("utf8");
  return tekst.length > 0 ? (JSON.parse(tekst) as Record<string, unknown>) : {};
}

// ---- /api/overview ------------------------------------------------------

function apiOverview() {
  const alles = readAllExperiments();
  const kandidaten = alles.filter((e) => e.decision === "PROMOTION_CANDIDATE");
  const besteKandidaat = kandidaten[kandidaten.length - 1] ?? null;
  const geschiedenis = readBenchmarkHistory();
  const laatsteBenchmark = geschiedenis[geschiedenis.length - 1] ?? null;
  const besteScoreOoit = geschiedenis.length > 0 ? Math.max(...geschiedenis.map((h) => h.benchmark.passRate)) : null;
  const productionVersionId = currentVersionId();
  const productionVersion = getVersion(productionVersionId);

  return {
    productionVersion: { id: productionVersionId, variantId: productionVersion?.variantId ?? null, isBaseline: productionVersionId === BASELINE_VERSION_ID },
    bestSandboxVariant: besteKandidaat ? { experimentId: besteKandidaat.id, hypothesis: besteKandidaat.hypothesis, diff: besteKandidaat.comparisonWithBaseline } : null,
    latestBenchmark: laatsteBenchmark ? { label: laatsteBenchmark.label, timestamp: laatsteBenchmark.timestamp, passRate: laatsteBenchmark.benchmark.passRate } : null,
    bestBenchmarkEver: besteScoreOoit,
    activeRun: currentRun(),
    counts: {
      experiments: alles.length,
      promotionCandidates: kandidaten.length,
      rejected: alles.filter((e) => e.decision === "REJECTED").length,
      keepTesting: alles.filter((e) => e.decision === "KEEP_TESTING").length,
    },
  };
}

// ---- /api/progress/* ------------------------------------------------------

function apiBenchmarkTimeline() {
  return readBenchmarkHistory().map((h) => ({
    timestamp: h.timestamp,
    label: h.label,
    dev: h.benchmark.passRate,
    holdout: h.holdoutDualQuality ? averageOfCategory(h.holdoutDualQuality.agent) : null,
  }));
}

function averageOfCategory(agent: unknown): number | null {
  const waarden = Object.entries(agent as Record<string, unknown>)
    .filter(([k]) => k !== "latencyMs")
    .map(([, v]) => v)
    .filter((v): v is number => typeof v === "number");
  return waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : null;
}

function apiCategoryComparison() {
  const geschiedenis = readBenchmarkHistory();
  const laatste = [...geschiedenis].reverse().find((h) => h.preDualQuality && h.dualQuality);
  if (!laatste?.preDualQuality || !laatste.dualQuality) return { available: false, categories: [] };
  const preAgent = laatste.preDualQuality.agent as unknown as Record<string, number | null>;
  const postAgent = laatste.dualQuality.agent as unknown as Record<string, number | null>;
  const keys = Object.keys(postAgent).filter((k) => k !== "latencyMs");
  return {
    available: true,
    label: laatste.label,
    categories: keys.map((k) => ({ key: k, pre: preAgent[k], post: postAgent[k] })),
  };
}

function apiExperimentOutcomes() {
  const alles = readAllExperiments();
  return {
    improved: alles.filter((e) => e.outcome === "SUCCESS").length,
    unchanged: alles.filter((e) => e.outcome === "INCONCLUSIVE").length,
    rejected: alles.filter((e) => e.outcome === "FAILURE").length,
    promotionCandidate: alles.filter((e) => e.decision === "PROMOTION_CANDIDATE").length,
  };
}

function apiRosterQuality() {
  const punten = readAllExperiments()
    .filter((e) => e.soort === "ENGINE_VARIANT" && e.qualityMetrics?.robust !== undefined)
    .map((e) => ({ timestamp: e.timestamp, runId: e.runId, robust: e.qualityMetrics!.robust }));
  return { available: punten.length > 0, points: punten };
}

// ---- /api/versions & publish -------------------------------------------

/**
 * Eén bron van waarheid voor "welke Lyra-versie is nu actief" (§6 van de
 * finale integratieronde): dezelfde velden die zowel Demo Room als, later, de
 * production-koppeling en het NS Roosterplatform zelf technisch kunnen
 * uitlezen — version id, variant id, activated at, source experiment,
 * benchmark reference, status. Niets hiervan is nieuw opgeslagen; het is de
 * bestaande `LyraVersion` uit de versiestore, hier expliciet als canoniek
 * antwoord op "wat is actief" naar buiten gebracht.
 */
function apiActiveVersion() {
  const id = currentVersionId();
  const versie = getVersion(id);
  return {
    versionId: id,
    variantId: versie?.variantId ?? null,
    activatedAt: versie?.createdAt ?? null,
    sourceExperimentId: versie?.sourceExperimentId ?? null,
    benchmarkReference: versie?.benchmarkReference ?? null,
    status: versie?.status ?? "ACTIVE",
    isBaseline: id === BASELINE_VERSION_ID,
  };
}

/** Waarom "Activeren" wel/niet mag (§5 van de finale integratieronde) — nooit een bypass rond de veilige pijplijn. */
function activationEligibility(versie: ReturnType<typeof listVersions>[number], activeVersionId: string): { readonly canActivate: boolean; readonly reason: string | null } {
  if (versie.id === activeVersionId) return { canActivate: false, reason: null };
  if (versie.status === "FAILED") {
    return { canActivate: false, reason: "Deze versie is ooit mislukt bij publicatie (typecheck/smoke-benchmark/groundingscontrole) en kan niet direct opnieuw geactiveerd worden." };
  }
  return { canActivate: true, reason: null };
}

function apiVersions() {
  const actief = currentVersionId();
  const versies = listVersions();
  return {
    activeVersionId: actief,
    versions: versies.map((v) => ({ ...v, ...activationEligibility(v, actief) })),
  };
}

function apiPublishPreview(experimentId: string) {
  const experiment = readAllExperiments().find((e) => e.id === experimentId);
  if (!experiment) return { error: `Experiment ${experimentId} niet gevonden.` };
  const productieId = currentVersionId();
  const productie = getVersion(productieId);
  const geschiedenis = readBenchmarkHistory();
  const bijHorendeMeting = [...geschiedenis].reverse().find((h) => h.runLabel === experiment.runId);
  return {
    experiment,
    currentProduction: productie,
    newVersionPreview: { willBeCreated: true, note: "De nieuwe versie-ID wordt pas bij publiceren zelf toegekend (lyra-prod-JJJJ-MM-DD-NN) — dat is de eerste stap van de pijplijn hieronder." },
    benchmarkDiff: experiment.comparisonWithBaseline ?? {},
    holdout: bijHorendeMeting
      ? {
          pre: flattenAgent(bijHorendeMeting.preDualQuality?.agent as unknown as Record<string, unknown> | undefined),
          variant: flattenAgent(bijHorendeMeting.holdoutDualQuality?.agent as unknown as Record<string, unknown> | undefined),
        }
      : { pre: null, variant: null, note: "Geen bijbehorende holdoutmeting gevonden voor dit experiment." },
    regressions: experiment.failureReason ? [experiment.failureReason] : [],
    warnings: [
      experiment.decision !== "PROMOTION_CANDIDATE" ? "Dit experiment is geen PROMOTION_CANDIDATE — publiceren wordt geweigerd." : null,
      experiment.soort === "ENGINE_VARIANT" ? "ENGINE_VARIANT-experimenten gaan niet via deze pijplijn (zie promotieStappen() in de hoofdapp)." : null,
    ].filter((w): w is string => w !== null),
    rollbackTarget: productieId,
    changedFiles: ["NS_PRODUCTION_PROMPT_FILE (systeeminstructie-toevoeging)"],
    pipeline: ["PREFLIGHT", "BACKUP", "APPLY", "TYPECHECK", "SMOKE_BENCHMARK", "GROUNDING_CHECK", "CONFIRM"],
  };
}

function flattenAgent(agent: Record<string, unknown> | null | undefined): Record<string, number> | null {
  if (!agent) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(agent)) if (k !== "latencyMs" && typeof v === "number") out[k] = v;
  return out;
}

function apiImprovement(experimentId: string) {
  const dir = path.join(REPORTS_DIR, "improvements");
  const paths = {
    jonathan: path.join(dir, `${experimentId}-jonathan.md`),
    technisch: path.join(dir, `${experimentId}-technisch.md`),
    machine: path.join(dir, `${experimentId}-machine.json`),
  };
  return {
    jonathan: existsSync(paths.jonathan) ? readFileSync(paths.jonathan, "utf8") : null,
    technisch: existsSync(paths.technisch) ? readFileSync(paths.technisch, "utf8") : null,
    machine: existsSync(paths.machine) ? JSON.parse(readFileSync(paths.machine, "utf8")) : null,
  };
}

// ---- /api/logbook/* --------------------------------------------------------

/**
 * Live voortgang van een proof-of-value-run als vaste stappenrij (v0.3 §1:
 * "PRE → sandboxvariant → POST → holdout → regressiecontrole → beslissing"),
 * afgeleid uit de echte logboekregels van die run — niets hiervan is een
 * schatting.
 */
function deriveProofStages(events: readonly { kind: string; message: string }[]) {
  const heeft = (re: RegExp, kind?: string) => events.some((e) => (kind ? e.kind === kind : true) && re.test(e.message));
  const postResultaten = events.filter((e) => e.kind === "BENCHMARK_RESULT" && /POST-run/.test(e.message));
  const laatstePostMatch = [...events].reverse().find((e) => /POST-run \d+\/\d+/.test(e.message))?.message.match(/POST-run (\d+)\/(\d+)/);
  const besluitEvent = events.find((e) => e.kind === "PROMOTION_DECISION");

  const stages = [
    { key: "pre", label: "PRE", done: heeft(/^PRE \(dev/, "BENCHMARK_RESULT"), active: heeft(/^PRE \(dev/, "BENCHMARK_START") },
    { key: "variant", label: "Sandboxvariant", done: heeft(/Sandbox-ChatModel gebouwd/), active: heeft(/Sandboxvariant gekozen/) },
    {
      key: "post",
      label: laatstePostMatch ? `POST (${postResultaten.length}/${laatstePostMatch[2]})` : "POST",
      done: laatstePostMatch ? postResultaten.length >= Number(laatstePostMatch[2]) : false,
      active: postResultaten.length > 0,
    },
    { key: "holdout", label: "Holdout", done: heeft(/^Holdout \(variant\)/, "BENCHMARK_RESULT"), active: heeft(/^Holdout \(variant\)/, "BENCHMARK_START") },
    { key: "regression", label: "Regressiecontrole", done: heeft(/vergeleken/, "COMPARISON"), active: false },
    { key: "decision", label: "Beslissing", done: Boolean(besluitEvent), active: false, detail: besluitEvent?.message ?? null },
  ];

  let vorigeKlaar = true;
  return stages.map((s) => {
    const status = s.done ? "done" : s.active && vorigeKlaar ? "active" : "pending";
    vorigeKlaar = vorigeKlaar && s.done;
    return { key: s.key, label: s.label, status, detail: (s as { detail?: string | null }).detail ?? null };
  });
}

/**
 * Schrijft direct bij de klik in de UI een `RUN_START_REQUESTED`-regel in het
 * logboek van deze run — vóórdat er ook maar een CLI-proces bestaat (§ "Maak
 * al bij de eerste UI-startactie een RUN_START_REQUESTED-event of equivalent
 * aan, zodat ook failures vóór volledige CLI-initialisatie traceerbaar zijn").
 * `logbook.startRun()` (aangeroepen door het CLI-proces zelf, ná deze regel)
 * overschrijft dit niet — zie de idempotentie-opmerking in `store/logbook.ts`.
 * Zo blijft ook een spawn-fout die het CLI-proces nooit laat starten
 * zichtbaar in Live run/Logboek, in plaats van stil te verdwijnen.
 */
function meldRunAangevraagd(runId: string, type: string, params: Readonly<Record<string, unknown>>): void {
  logbook.log(runId, {
    kind: "RUN_START_REQUESTED",
    experimentId: null,
    message: `UI heeft een run aangevraagd (${type || "onbekend"}).`,
    data: params,
  });
}

// ---- server ---------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  (async () => {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return serveFile(res, path.join(UI_DIR, "index.html"), "text/html; charset=utf-8");
    }
    // NS-branding (§3 van de finale integratieronde): het bestaande, echte
    // bedrijfslogo — geen nieuw of zelf getekend logo, en geen kopie ervan
    // onder demo-room/, gewoon rechtstreeks vanaf zijn eigen plek geserveerd.
    if (req.method === "GET" && url.pathname === "/brand/ns-logo.svg") {
      return serveFile(res, path.join(REPO_ROOT, "public", "brand", "ns-logo.svg"), "image/svg+xml");
    }
    if (req.method !== "GET" && req.method !== "POST") {
      res.writeHead(405);
      return res.end();
    }

    const routesGet: Record<string, () => unknown> = {
      "/api/challenges": () => CHALLENGES.map((c) => ({ id: c.id, name: c.name, category: c.category, track: c.track, difficulty: c.difficulty, computeBudgetMinutes: c.computeBudgetMinutes })),
      "/api/runs": () => listRunIds(),
      "/api/runs/latest-events": () => {
        const runIds = listRunIds();
        return { runId: runIds[0] ?? null, events: runIds.length > 0 ? readRunlog(runIds[0]) : [] };
      },
      "/api/experiments": () => readAllExperiments(),
      "/api/latest-report": () => {
        const p = path.join(REPORTS_DIR, "latest.json");
        return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
      },
      "/api/handoff": () => ({ markdown: existsSync(HANDOFF_PATH) ? readFileSync(HANDOFF_PATH, "utf8") : "_(nog geen run uitgevoerd)_" }),
      "/api/overview": apiOverview,
      "/api/progress/benchmark-timeline": apiBenchmarkTimeline,
      "/api/progress/categories": apiCategoryComparison,
      "/api/progress/experiment-outcomes": apiExperimentOutcomes,
      "/api/progress/roster-quality": apiRosterQuality,
      "/api/versions": apiVersions,
      "/api/versions/active": apiActiveVersion,
      "/api/current-run": () => currentRun(),
      "/api/autonomy/results": () => listAutonomyResults(),
    };
    if (req.method === "GET" && url.pathname in routesGet) return json(res, 200, routesGet[url.pathname]());

    if (req.method === "GET" && url.pathname === "/api/experiments/detail") {
      const id = url.searchParams.get("id");
      const found = id ? readAllExperiments().find((e) => e.id === id) : null;
      return json(res, found ? 200 : 404, found ?? { error: "niet gevonden" });
    }
    if (req.method === "GET" && url.pathname === "/api/versions/detail") {
      const id = url.searchParams.get("id");
      const found = id ? getVersion(id) : null;
      return json(res, found ? 200 : 404, found ?? { error: "niet gevonden" });
    }
    if (req.method === "GET" && url.pathname === "/api/autonomy/detail") {
      const id = url.searchParams.get("id");
      const found = id ? getAutonomyResult(id) : null;
      return json(res, found ? 200 : 404, found ?? { error: "niet gevonden" });
    }
    if (req.method === "GET" && url.pathname === "/api/publish/preview") {
      const id = url.searchParams.get("experimentId");
      if (!id) return json(res, 400, { error: "experimentId ontbreekt" });
      return json(res, 200, apiPublishPreview(id));
    }
    if (req.method === "GET" && url.pathname === "/api/improvement") {
      const id = url.searchParams.get("experimentId");
      if (!id) return json(res, 400, { error: "experimentId ontbreekt" });
      return json(res, 200, apiImprovement(id));
    }
    if (req.method === "GET" && url.pathname === "/api/runlog") {
      const runId = url.searchParams.get("runId");
      const ids = listRunIds();
      const kies = runId ?? ids[0];
      return json(res, 200, { runId: kies ?? null, events: kies ? readRunlog(kies) : [] });
    }
    if (req.method === "GET" && url.pathname === "/api/logbook/runs") {
      return json(res, 200, listRunLogs());
    }
    if (req.method === "GET" && url.pathname === "/api/logbook/text") {
      const runId = url.searchParams.get("runId") ?? currentRun()?.runId ?? listRunLogs()[0]?.runId ?? null;
      return json(res, 200, { runId, text: runId ? readRunText(runId) : null });
    }
    if (req.method === "GET" && url.pathname === "/api/logbook/events") {
      const runId = url.searchParams.get("runId") ?? currentRun()?.runId ?? listRunLogs()[0]?.runId ?? null;
      const events = runId ? readRunEvents(runId) : [];
      return json(res, 200, { runId, events, stages: deriveProofStages(events) });
    }
    if (req.method === "GET" && url.pathname === "/api/logbook/download") {
      const runId = url.searchParams.get("runId");
      const format = url.searchParams.get("format") === "jsonl" ? "jsonl" : "txt";
      if (!runId) return json(res, 400, { error: "runId ontbreekt" });
      const bestand = format === "jsonl" ? runJsonlFilePath(runId) : runTxtFilePath(runId);
      if (!existsSync(bestand)) return json(res, 404, { error: "logboek niet gevonden" });
      res.writeHead(200, {
        "Content-Type": format === "jsonl" ? "application/x-ndjson" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${runId}.${format}"`,
      });
      return res.end(readFileSync(bestand));
    }

    if (req.method === "POST" && url.pathname === "/api/runs/start") {
      const body = await readBody(req);
      const runId = `DR-UI-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;
      try {
        const type = String(body.type ?? "");
        const args =
          type === "proof"
            ? ["proof-of-value", ...(body.variantId ? ["--variant", String(body.variantId)] : []), "--post-runs", String(body.postRuns ?? 2)]
          : type === "challenge" ? ["run-challenge", "--id", String(body.challengeId)]
          : type === "autonomous"
            ? ["autonomous", "--minutes", String(body.minutes ?? 10), "--goal", String(body.goal ?? "Zelfgekozen verbetering"), "--goals", String(body.goals ?? "KEEP_GOOD_PARTS")]
          : type === "autonomy-test"
            ? ["autonomy-test", "--minutes", String(body.minutes ?? 10)]
            : null;
        if (!args) return json(res, 400, { error: `onbekend runtype: ${type}` });
        meldRunAangevraagd(runId, type, body);
        const state = startCliRun(runId, type, [...args, "--run-id", runId]);
        return json(res, 200, state);
      } catch (fout) {
        meldRunAangevraagd(runId, String(body.type ?? ""), body);
        logbook.log(runId, { kind: "ERROR", experimentId: null, message: fout instanceof Error ? fout.message : String(fout) });
        return json(res, 409, { error: fout instanceof Error ? fout.message : String(fout) });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/runs/stop") {
      return json(res, 200, stopCurrentRun());
    }
    if (req.method === "POST" && url.pathname === "/api/publish/execute") {
      const body = await readBody(req);
      const experimentId = String(body.experimentId ?? "");
      if (!experimentId) return json(res, 400, { error: "experimentId ontbreekt" });
      const runId = `DR-PUBLISH-${randomUUID().slice(0, 8)}`;
      try {
        meldRunAangevraagd(runId, "publish", { experimentId });
        const state = startCliRun(runId, "publish", ["publish", "--experiment-id", experimentId, "--confirm", "--run-id", runId]);
        return json(res, 200, state);
      } catch (fout) {
        logbook.log(runId, { kind: "ERROR", experimentId, message: fout instanceof Error ? fout.message : String(fout) });
        return json(res, 409, { error: fout instanceof Error ? fout.message : String(fout) });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/rollback/execute") {
      const body = await readBody(req);
      const versionId = String(body.versionId ?? "");
      if (!versionId) return json(res, 400, { error: "versionId ontbreekt" });
      const runId = `DR-ROLLBACK-${randomUUID().slice(0, 8)}`;
      try {
        meldRunAangevraagd(runId, "rollback", { versionId });
        const state = startCliRun(runId, "rollback", ["rollback", "--version-id", versionId, "--confirm", "--run-id", runId]);
        return json(res, 200, state);
      } catch (fout) {
        logbook.log(runId, { kind: "ERROR", experimentId: null, message: fout instanceof Error ? fout.message : String(fout) });
        return json(res, 409, { error: fout instanceof Error ? fout.message : String(fout) });
      }
    }

    res.writeHead(404);
    res.end("niet gevonden");
  })().catch((fout) => {
    json(res, 500, { error: fout instanceof Error ? fout.message : String(fout) });
  });
});

const port = dashboardPort();
server.listen(port, () => {
  console.log(`Demo Room-dashboard: http://localhost:${port}`);
});
