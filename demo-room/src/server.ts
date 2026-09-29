import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { CHALLENGES } from "./challenges/catalogue";
import { dashboardPort, HANDOFF_PATH, REPO_ROOT, REPORTS_DIR } from "./config";
import { currentRun, currentRunWithElapsed, runCliOnceAndCapture, startCliRun, stopCurrentRun } from "./runControl";
import { readBenchmarkHistory } from "./store/benchmarkHistory";
import * as logbook from "./store/logbook";
import { listRunLogs, readRunEvents, readRunText, runJsonlFilePath, runTxtFilePath } from "./store/logbook";
import { readAllExperiments, listRunIds, readRunlog } from "./store/runlog";
import { getAutonomyResult, listAutonomyResults } from "./store/autonomyResults";
import { getDevelopmentRunResult, listAllCandidates, listDevelopmentRunResults } from "./store/developmentRuns";
import { compareVersions, displayNameForVersionId, latestFindings, promotionHistory, runHistory, runsSummary, versionDeltas, versionPerformanceSeries } from "./report/dashboardAggregates";
import { BASELINE_VERSION_ID, currentVersionId, getVersion, listVersions } from "./publish/versions";
import { routerPageNames, uiAssetReport } from "./uiAssets";
import { genereerUitdagingen } from "./learning/challengeGenerator";
import { ConceptFout } from "./learning/concepts";
import type { AuteurRol } from "./learning/feedback";
import { lijstKandidaten, leesArchief } from "./factory/store";
import { leesCheckpoint, lijstLongRuns, PROFIEL_MINUTEN, vraagControle } from "./factory/longRun";
import { arena } from "./factory/arena";
import { activeer, kiesInConflict, leesConcepten, leesFeedback, meetConcept, registreerFeedback, verwerp } from "./learning/store";

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

const UI_DIR = path.resolve(path.dirname(__filename), "..", "ui");
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};
const STATIC_EXTENSIONS = Object.keys(STATIC_CONTENT_TYPES);

const UI_ASSETS = uiAssetReport(UI_DIR, routerPageNames(UI_DIR));

function gitBuild(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "onbekend";
  }
}

/** Identiteit van dít serverproces — laat de UI en een tweede opstart zien welke code er werkelijk draait. */
const SERVER_INFO = {
  build: gitBuild(),
  startedAt: new Date().toISOString(),
  pid: process.pid,
  uiAssetHash: UI_ASSETS.hash,
};

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
    activeRun: currentRunWithElapsed(),
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
    displayName: displayNameForVersionId(id) ?? id,
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
    versions: versies.map((v) => ({ ...v, displayName: displayNameForVersionId(v.id) ?? v.id, ...activationEligibility(v, actief) })),
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
    if (req.method === "GET" && url.pathname === "/api/server-info") {
      return json(res, 200, { ...SERVER_INFO, uiAssetsMissing: UI_ASSETS.missing });
    }
    if (req.method === "GET" && url.pathname === "/brand/ns-logo.svg") {
      return serveFile(res, path.join(REPO_ROOT, "public", "brand", "ns-logo.svg"), "image/svg+xml");
    }
    // Generieke statische-bestandenserver voor de UI-modules (§ UI/UX REBUILD:
    // de vroegere monolithische index.html is opgesplitst in aparte CSS/JS-
    // modulebestanden onder ui/ — deze route serveert ze op hun eigen pad,
    // uitsluitend binnen UI_DIR (geen ..-padtraversal) en uitsluitend bekende,
    // veilige extensies (geen willekeurig bestand van schijf serveren).
    if (req.method === "GET" && STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext))) {
      const relatief = url.pathname.replace(/^\/+/, "");
      const bestand = path.resolve(UI_DIR, relatief);
      if (!bestand.startsWith(UI_DIR)) {
        res.writeHead(403);
        return res.end();
      }
      const ext = path.extname(bestand);
      return serveFile(res, bestand, STATIC_CONTENT_TYPES[ext] ?? "application/octet-stream");
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
      "/api/versions/performance": versionPerformanceSeries,
      "/api/versions/deltas": versionDeltas,
      "/api/current-run": () => currentRunWithElapsed(),
      "/api/autonomy/results": () => listAutonomyResults(),
      "/api/development-runs": () => listDevelopmentRunResults(),
      "/api/candidates": () => listAllCandidates(),
      // Phase G–J: feedback, concepten en daaruit gegenereerde uitdagingen.
      "/api/factory/candidates": () => lijstKandidaten(),
      "/api/factory/archive": () => leesArchief({}),
      "/api/factory/arena": () =>
        // Arena over wat de rechter al mat: per kandidaat per dimensie de
        // delta tegen de basis, genormaliseerd naar 0–1. Geen nieuwe meting.
        arena(
          lijstKandidaten().flatMap((k) =>
            Object.entries(k.oordeel?.deltas ?? {})
              .filter(([, d]) => Number.isFinite(d))
              .map(([dim, d]) => ({ kandidaat: k.manifest.candidateId, opgave: dim, score: Math.max(0, Math.min(1, 0.5 + d / 100)) })),
          ),
        ),
      "/api/long-runs": () => lijstLongRuns(),
      "/api/learning/feedback": () => leesFeedback(),
      "/api/learning/concepts": () => leesConcepten(),
      "/api/learning/challenges": () =>
        genereerUitdagingen({ concepten: leesConcepten() }).map((d) => ({
          id: d.id, name: d.name, category: d.category, difficulty: d.difficulty, visibleTask: d.visibleTask,
          turns: d.turns, expectedInvariants: d.expectedInvariants,
          // De checkfuncties zelf gaan niet over de lijn; alleen hun beschrijving.
          hiddenInvariants: d.hiddenInvariants.map((h) => ({ id: h.id, description: h.description })),
        })),
      "/api/runs/history": runHistory,
      "/api/runs/summary": runsSummary,
      "/api/logbook/promotions": promotionHistory,
      "/api/findings": () => latestFindings(),
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
    if (req.method === "GET" && url.pathname === "/api/versions/compare") {
      const base = url.searchParams.get("base");
      const targets = url.searchParams.getAll("target");
      const set = (url.searchParams.get("set") as "dev" | "holdout" | "both" | null) ?? "both";
      return json(res, 200, compareVersions(base, targets, set));
    }
    if (req.method === "GET" && url.pathname === "/api/autonomy/detail") {
      const id = url.searchParams.get("id");
      const found = id ? getAutonomyResult(id) : null;
      return json(res, found ? 200 : 404, found ?? { error: "niet gevonden" });
    }
    if (req.method === "GET" && url.pathname === "/api/development-runs/detail") {
      const id = url.searchParams.get("id");
      const found = id ? getDevelopmentRunResult(id) : null;
      return json(res, found ? 200 : 404, found ?? { error: "niet gevonden" });
    }
    if (req.method === "GET" && url.pathname === "/api/candidates/detail") {
      const id = url.searchParams.get("id");
      const found = id ? listAllCandidates().find((c) => c.candidateId === id) : null;
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
          : type === "development-run"
            ? ["development-run", "--minutes", String(body.minutes ?? 360), ...(body.focusDimension ? ["--focus-dimension", String(body.focusDimension)] : [])]
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
    if (req.method === "POST" && url.pathname.startsWith("/api/long-runs/")) {
      const body = await readBody(req);
      try {
        if (url.pathname === "/api/long-runs/start" || url.pathname === "/api/long-runs/resume") {
          const hervat = url.pathname.endsWith("resume");
          const runId = hervat ? String(body.runId ?? "") : `DR-LONG-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;
          const bestaand = hervat ? leesCheckpoint(runId) : null;
          if (hervat && bestaand?.status !== "PAUSED") return json(res, 409, { error: `alleen een gepauzeerde run kan hervat worden (status: ${bestaand?.status ?? "onbekend"})` });
          const profiel = String(bestaand?.profiel ?? body.profiel ?? "1h");
          if (!(profiel in PROFIEL_MINUTEN)) return json(res, 400, { error: "onbekend profiel" });
          meldRunAangevraagd(runId, "long-run", { profiel, hervat });
          return json(res, 200, startCliRun(runId, "long-run", ["long-run", "--profiel", profiel, "--run-id", runId]));
        }
        if (url.pathname === "/api/long-runs/pause" || url.pathname === "/api/long-runs/stop") {
          const runId = String(body.runId ?? "");
          vraagControle(runId, url.pathname.endsWith("pause") ? "PAUSE" : "STOP", String(body.actorId ?? "dashboard").slice(0, 60));
          return json(res, 200, leesCheckpoint(runId));
        }
        return json(res, 404, { error: "onbekende long-run-route" });
      } catch (fout) {
        return json(res, 409, { error: fout instanceof Error ? fout.message : String(fout) });
      }
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/learning/")) {
      const body = await readBody(req);
      const ROLLEN: readonly AuteurRol[] = ["MACHINIST", "PLANNER", "ROOSTERCOMMISSIE", "NS_FORMEEL", "ONTWIKKELAAR"];
      const rol = String(body.role ?? "") as AuteurRol;
      try {
        if (url.pathname === "/api/learning/feedback") {
          const text = String(body.text ?? "").trim();
          if (text.length < 3 || text.length > 1000) return json(res, 400, { error: "text ontbreekt of is te lang" });
          if (!ROLLEN.includes(rol)) return json(res, 400, { error: "onbekende rol" });
          return json(res, 200, registreerFeedback({
            author: { id: String(body.authorId ?? "onbekend").slice(0, 60), role: rol },
            text,
            context: { locationCode: String(body.locationCode ?? "DDR").slice(0, 10), rosterCode: body.rosterCode ? String(body.rosterCode).slice(0, 32) : null },
            source: "TEST_ROOM",
            formalReference: body.formalReference ? String(body.formalReference).slice(0, 200) : null,
          }));
        }
        const id = String(body.id ?? "");
        if (url.pathname === "/api/learning/concepts/measure") return json(res, 200, meetConcept(id));
        // Menselijke beslissingen: altijd met expliciete bevestiging en een benoemd persoon.
        if (body.confirm !== true) return json(res, 400, { error: "menselijke beslissing vereist confirm: true" });
        const actor = { id: String(body.actorId ?? "").slice(0, 60), role: rol };
        if (!actor.id || !ROLLEN.includes(rol)) return json(res, 400, { error: "actorId en rol zijn verplicht" });
        const reden = String(body.reason ?? "").trim();
        if (reden.length < 3) return json(res, 400, { error: "een reden is verplicht" });
        if (url.pathname === "/api/learning/concepts/activate") return json(res, 200, activeer(id, actor, reden));
        if (url.pathname === "/api/learning/concepts/reject") return json(res, 200, verwerp(id, actor, reden));
        if (url.pathname === "/api/learning/concepts/resolve") return json(res, 200, kiesInConflict(id, actor, reden));
        return json(res, 404, { error: "onbekende learning-route" });
      } catch (fout) {
        return json(res, fout instanceof ConceptFout ? 409 : 500, { error: fout instanceof Error ? fout.message : String(fout) });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text ontbreekt" });
      const args = ["chat", "--text", text];
      if (body.sessionId) args.push("--session-id", String(body.sessionId));
      if (body.versionId) args.push("--version-id", String(body.versionId));
      if (body.locationCode) args.push("--location-code", String(body.locationCode));
      // Schermcontext, strikt gevalideerd vóór hij als CLI-argument meegaat.
      const roosterCode = typeof body.rosterCode === "string" ? body.rosterCode.trim() : "";
      if (roosterCode) {
        if (!/^[A-Za-z0-9-]{1,32}$/.test(roosterCode)) return json(res, 400, { error: "ongeldige roostercode" });
        args.push("--roster-code", roosterCode.toUpperCase());
      }
      if (body.lineNumber !== undefined && body.lineNumber !== null && body.lineNumber !== "") {
        const regel = Number(body.lineNumber);
        if (!Number.isInteger(regel) || regel < 1 || regel > 999) return json(res, 400, { error: "ongeldig regelnummer" });
        args.push("--line-number", String(regel));
      }
      if (body.weekday !== undefined && body.weekday !== null && body.weekday !== "") {
        const dag = Number(body.weekday);
        if (!Number.isInteger(dag) || dag < 1 || dag > 7) return json(res, 400, { error: "ongeldige weekdag" });
        args.push("--weekday", String(dag));
      }
      const kandidaatLabel = typeof body.candidateLabel === "string" ? body.candidateLabel.trim() : "";
      if (kandidaatLabel) {
        if (kandidaatLabel.length > 60) return json(res, 400, { error: "ongeldig kandidaatlabel" });
        args.push("--candidate-label", kandidaatLabel);
      }
      try {
        const { stdout, stderr, exitCode } = await runCliOnceAndCapture(args);
        if (exitCode !== 0) return json(res, 502, { error: `Test Room-bericht mislukte (afsluitcode ${exitCode}).`, detail: stderr.slice(-2000) || stdout.slice(-2000) });
        const laatsteRegel = stdout.trim().split("\n").pop() ?? "";
        try {
          return json(res, 200, JSON.parse(laatsteRegel));
        } catch {
          return json(res, 502, { error: "Kon het antwoord van het chatproces niet lezen.", detail: stdout.slice(-2000) });
        }
      } catch (fout) {
        return json(res, 502, { error: fout instanceof Error ? fout.message : String(fout) });
      }
    }

    res.writeHead(404);
    res.end("niet gevonden");
  })().catch((fout) => {
    json(res, 500, { error: fout instanceof Error ? fout.message : String(fout) });
  });
});

const port = dashboardPort();

// Een oudere server die de poort nog vasthoudt, serveert het nieuwe
// index.html van schijf maar kent de asset-routes niet: de pagina rendert
// dan als kale HTML terwijl deze nieuwe server stil sterft op EADDRINUSE.
// Daarom hier nooit stil falen, maar zeggen wie de poort heeft en hoe je
// hem stopt.
server.on("error", (fout: NodeJS.ErrnoException) => {
  if (fout.code !== "EADDRINUSE") throw fout;
  void (async () => {
    let wie = null as { pid?: number; build?: string; startedAt?: string } | null;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/server-info`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) wie = (await res.json()) as typeof wie;
    } catch {
      // geen antwoord: iets anders dan (een recente) Demo Room-server
    }
    console.error(`\n[FOUT] Poort ${port} is al in gebruik — deze Demo Room-server start NIET.`);
    if (wie?.pid) {
      const verouderd = wie.build !== SERVER_INFO.build ? ` (build ${wie.build}, deze code is ${SERVER_INFO.build} — VEROUDERD)` : "";
      console.error(`Er draait al een Demo Room-server: PID ${wie.pid}, gestart ${wie.startedAt}${verouderd}.`);
      console.error(`Sluit dat venster, of stop hem met: ${process.platform === "win32" ? `taskkill /PID ${wie.pid} /F` : `kill ${wie.pid}`}`);
    } else {
      console.error("Het proces op die poort geeft geen /api/server-info — waarschijnlijk een Demo Room-server van vóór de UI-opsplitsing,");
      console.error("die de pagina zonder opmaak toont (/styles.css en /app.js geven daar 404). Zoek en stop hem met:");
      console.error(process.platform === "win32" ? `  netstat -ano | findstr :${port}    en daarna    taskkill /PID <pid> /F` : `  lsof -i :${port}    en daarna    kill <pid>`);
    }
    process.exit(2);
  })();
});

server.listen(port, () => {
  console.log(`Demo Room-dashboard: http://localhost:${port}  (build ${SERVER_INFO.build}, PID ${process.pid})`);
  if (UI_ASSETS.missing.length > 0) {
    console.error(`[FOUT] UI-bestanden ontbreken: ${UI_ASSETS.missing.join(", ")} — de pagina zal niet correct renderen.`);
  } else {
    console.log(`  UI-assets compleet: ${UI_ASSETS.required.length} bestanden (hash ${UI_ASSETS.hash}).`);
  }
});
