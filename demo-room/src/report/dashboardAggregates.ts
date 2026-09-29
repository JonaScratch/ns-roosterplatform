import { listVersions } from "../publish/versions";
import { currentRun, type RunControlState } from "../runControl";
import { listRunLogs, readRunEvents } from "../store/logbook";
import { readAllExperiments } from "../store/runlog";
import type { AgentQualityCategory, ExperimentRecord, LyraVersion } from "../types";

/**
 * Read-only aggregaties voor het herontworpen dashboard (§ UI-redesign-
 * aanvulling, punt 10: "Maak waar nodig kleine read-only API-endpoints/
 * aggregaties. Pas de backend niet aan om fictieve UI-data te produceren.").
 *
 * Niets hier verzint data: elke functie leest uitsluitend de bestaande,
 * echte bronnen (versiestore, benchmarkgeschiedenis, experimentgeheugen,
 * logboek) en geeft `null`/een lege array terug wanneer er simpelweg nog
 * niets gemeten is — nooit een 0 of een verzonnen tussenwaarde.
 */

const LATENCY_KEYS = new Set(["latencyP50", "latencyP95"]);

function aggregateScore(metrics: Record<string, number> | null | undefined): number | null {
  if (!metrics) return null;
  const waarden = Object.entries(metrics)
    .filter(([k]) => !LATENCY_KEYS.has(k))
    .map(([, v]) => v)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  if (waarden.length === 0) return null;
  return waarden.reduce((a, b) => a + b, 0) / waarden.length;
}

export interface VersionPerformancePoint {
  readonly versionId: string;
  readonly displayName: string;
  readonly status: LyraVersion["status"];
  readonly createdAt: string;
  /** Gemiddelde over alle gemeten dimensies bij publicatie (`benchmarkReference.post`) — `null` als er niets gemeten is (bijv. baseline). */
  readonly score: number | null;
  readonly isActive: boolean;
}

/**
 * Weergavenaam voor een versie, chronologisch genummerd (§ UI-aanvulling
 * "Versiebeheer aanpassen: start bij v1.0.0 en daarna per 0.1"): de
 * basisversie (oudste, `createdAt` het vroegst) is v1.0.0, elke volgende
 * gepubliceerde/geactiveerde versie telt de derde plek met 1 op — v1.0.1,
 * v1.0.2, enzovoort. Dit raakt uitsluitend de WEERGAVE; de technische
 * versie-ID (`lyra-prod-YYYY-MM-DD-NN`/`lyra-prod-baseline`) blijft
 * ongewijzigd, zodat al bestaande, lokaal opgeslagen versiebestanden van
 * een eerdere installatie geldig blijven — er is dus geen destructieve
 * migratie nodig.
 */
function displayNameForIndex(i: number): string {
  return `v1.0.${i}`;
}

/** Chronologisch (oudste eerst) — alleen versies die ooit gepubliceerd/geactiveerd zijn, dus met een echte meting eromheen. */
export function versionPerformanceSeries(): readonly VersionPerformancePoint[] {
  const actief = listVersions().find((v) => v.status === "ACTIVE")?.id ?? null;
  const chronologisch = [...listVersions()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return chronologisch.map((v, i) => ({
    versionId: v.id,
    displayName: displayNameForIndex(i),
    status: v.status,
    createdAt: v.createdAt,
    score: aggregateScore(v.benchmarkReference?.post ?? null),
    isActive: v.id === actief,
  }));
}

export interface VersionDelta {
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly fromDisplayName: string;
  readonly toDisplayName: string;
  /** `null` wanneer één van beide versies geen gemeten score heeft — nooit een verzonnen 0-delta. */
  readonly delta: number | null;
}

export function versionDeltas(): readonly VersionDelta[] {
  const serie = versionPerformanceSeries();
  const out: VersionDelta[] = [];
  for (let i = 1; i < serie.length; i += 1) {
    const vorige = serie[i - 1];
    const huidige = serie[i];
    out.push({
      fromVersionId: vorige.versionId,
      toVersionId: huidige.versionId,
      fromDisplayName: vorige.displayName,
      toDisplayName: huidige.displayName,
      delta: vorige.score !== null && huidige.score !== null ? huidige.score - vorige.score : null,
    });
  }
  return out;
}

export interface VersionComparisonRow {
  readonly versionId: string;
  readonly displayName: string;
  readonly status: LyraVersion["status"];
  readonly createdAt: string;
  readonly isActive: boolean;
  /** Alleen dimensies waarvoor voor DEZE versie werkelijk een meting bestaat. */
  readonly metrics: Record<string, number>;
}

export interface VersionComparisonResult {
  readonly benchmarkSet: "dev" | "holdout" | "both";
  readonly base: VersionComparisonRow | null;
  readonly targets: readonly VersionComparisonRow[];
  /** Alleen dimensies die zowel bij base als bij minstens één target gemeten zijn. */
  readonly comparableDimensions: readonly string[];
  readonly warning: string | null;
}

function metricsForSet(v: LyraVersion, set: "dev" | "holdout" | "both"): Record<string, number> {
  const ref = v.benchmarkReference;
  if (!ref) return {};
  // "dev" en "both" gebruiken de dev/post-meting die bij publicatie is vastgelegd; holdout is apart bewaard.
  const bron: Record<string, number> = (set === "holdout" ? ref.holdout : ref.post) ?? {};
  const out: Record<string, number> = {};
  for (const [k, waarde] of Object.entries(bron)) if (!LATENCY_KEYS.has(k)) out[k] = waarde;
  return out;
}

export function compareVersions(baseId: string | null, targetIds: readonly string[], benchmarkSet: "dev" | "holdout" | "both" = "both"): VersionComparisonResult {
  const alle = listVersions();
  const actief = alle.find((v) => v.status === "ACTIVE")?.id ?? null;
  const vind = (id: string): LyraVersion | undefined => alle.find((v) => v.id === id);
  const rij = (v: LyraVersion): VersionComparisonRow => ({
    versionId: v.id,
    displayName: versionPerformanceSeries().find((p) => p.versionId === v.id)?.displayName ?? v.id,
    status: v.status,
    createdAt: v.createdAt,
    isActive: v.id === actief,
    metrics: metricsForSet(v, benchmarkSet),
  });

  const baseVersion = baseId ? vind(baseId) : undefined;
  const base = baseVersion ? rij(baseVersion) : null;
  const targets = targetIds.map(vind).filter((v): v is LyraVersion => v !== undefined).map(rij);

  const dimensiesInBase = new Set(Object.keys(base?.metrics ?? {}));
  const comparableDimensions = [...dimensiesInBase].filter((k) => targets.some((t) => k in t.metrics));

  const geenBenchmarkReferentie = [base, ...targets].filter((r): r is VersionComparisonRow => r !== null).some((r) => Object.keys(r.metrics).length === 0);

  return {
    benchmarkSet,
    base,
    targets,
    comparableDimensions,
    warning: geenBenchmarkReferentie ? "Niet rechtstreeks vergelijkbaar: één of meer geselecteerde versies heeft geen benchmarkreferentie uit dezelfde meting (bijv. de baseline, of een handmatig geactiveerde versie)." : null,
  };
}

export interface RunHistoryEntry {
  readonly runId: string;
  readonly kind: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly outcome: "RUN_COMPLETED" | "RUN_FAILED" | "RUN_INTERRUPTED" | "RUNNING_OF_ONBEKEND";
  /** Alleen aanwezig voor proof-of-value-runs met een bijbehorend experimentrecord. */
  readonly experiment: ExperimentRecord | null;
  /**
   * De productieversie die ACTIEF WAS TOEN DEZE RUN STARTTE (§ regressiecheck
   * "historical run: toont de versie die daadwerkelijk bij die run hoorde,
   * niet automatisch de huidige actieve versie") — gelezen uit het
   * `RUN_START`-event van díe run zelf (vastgelegd op het moment van
   * starten, dus onveranderlijk), nooit uit de huidige `currentVersionId()`.
   * `null` als de run geen productieversie logde (bijv. ouder dan deze
   * velden, of een run-type zonder productieversie).
   */
  readonly productionVersionId: string | null;
  readonly productionVersionDisplayName: string | null;
}

/** Zo lang mag een run zonder RUN_END en buiten current-run.json (bijv. een Test Room-gesprek) nog als "loopt" gelden. */
export const LOSSE_RUN_VENSTER_MS = 10 * 60 * 1000;

/**
 * De uitkomst van een run zonder RUN_END-regel. Tot 2026-09-29 was dat altijd
 * "RUNNING_OF_ONBEKEND", ook voor een run waarvan het proces al dagen weg
 * was. Er kan maar één run tegelijk via current-run.json lopen, en die weet
 * (sinds `verlorenRunCorrectie`) of zijn proces nog leeft. Puur, zodat het te
 * toetsen is.
 */
export function uitkomstZonderEinde(
  runId: string,
  startedAt: string | null,
  huidige: Pick<RunControlState, "runId" | "status"> | null,
  nowMs: number,
): RunHistoryEntry["outcome"] {
  if (huidige && huidige.runId === runId) {
    return huidige.status === "RUNNING" || huidige.status === "STARTING" ? "RUNNING_OF_ONBEKEND" : huidige.status === "FAILED" ? "RUN_INTERRUPTED" : "RUN_COMPLETED";
  }
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  return Number.isFinite(start) && nowMs - start < LOSSE_RUN_VENSTER_MS ? "RUNNING_OF_ONBEKEND" : "RUN_INTERRUPTED";
}

/** Nieuwste eerst — combineert het logboek (alle ooit gestarte runs) met het experimentgeheugen (alleen runs die een experiment opleverden). */
export function runHistory(): readonly RunHistoryEntry[] {
  const experimentenPerRun = new Map<string, ExperimentRecord>();
  for (const e of readAllExperiments()) if (!experimentenPerRun.has(e.runId)) experimentenPerRun.set(e.runId, e);

  const huidige = currentRun();
  const nu = Date.now();
  return listRunLogs().map((r) => {
    const events = readRunEvents(r.runId);
    const startEvent = events.find((e) => e.kind === "RUN_START");
    const endEvent = [...events].reverse().find((e) => e.kind === "RUN_END");
    const kind = (startEvent?.data as { kind?: string } | undefined)?.kind ?? null;
    // `logbook.endRun()` schrijft de RUN_END-regel zelf als `{timestamp, runId,
    // kind: "RUN_END", summary}` — `summary` staat op het toplevel van die regel,
    // NIET onder `data` (dat past niet in het `LogEvent`-type, maar de rauwe
    // JSON-regel bevat het veld gewoon echt; `JSON.parse` behoudt het, alleen de
    // TS-cast als `LogEvent` verbergt het). Via `endEvent.data` lezen gaf hier
    // altijd `undefined` en dus altijd de fallback "RUN_COMPLETED", ongeacht de
    // werkelijke uitkomst (RUN_FAILED/RUN_INTERRUPTED bleven onzichtbaar).
    const outcome: RunHistoryEntry["outcome"] = endEvent
      ? (((endEvent as unknown as { summary?: { outcome?: string } }).summary?.outcome as RunHistoryEntry["outcome"] | undefined) ?? "RUN_COMPLETED")
      : uitkomstZonderEinde(r.runId, startEvent?.timestamp ?? r.startedAt ?? null, huidige, nu);
    // `productionVersion` in de RUN_START-data is `currentProductionVersionLabel()`
    // (zie cli.ts): "<versie-id>" of "<versie-id> (<variantId>)" — het eerste
    // woord is altijd de kale, spatie-vrije technische ID.
    const productionVersionLabel = (startEvent?.data as { productionVersion?: string } | undefined)?.productionVersion ?? null;
    const productionVersionId = productionVersionLabel && productionVersionLabel !== "onbekend" ? productionVersionLabel.split(" ")[0] : null;
    return {
      runId: r.runId,
      kind,
      startedAt: startEvent?.timestamp ?? r.startedAt,
      finishedAt: endEvent?.timestamp ?? null,
      outcome,
      experiment: experimentenPerRun.get(r.runId) ?? null,
      productionVersionId,
      productionVersionDisplayName: productionVersionId ? (displayNameForVersionId(productionVersionId) ?? productionVersionId) : null,
    };
  });
}

export interface PromotionHistoryEntry {
  readonly at: string;
  readonly runId: string;
  readonly kind: "PUBLISH" | "ROLLBACK";
  readonly fromVersionId: string | null;
  readonly toVersionId: string;
  readonly fromDisplayName: string | null;
  readonly toDisplayName: string;
  readonly message: string;
}

/**
 * Echte activatiemomenten van productie-Lyra, oudste eerst (§ Logboek/foto 6
 * "benchmarkontwikkeling-over-tijd toont alleen promotie/activatiemomenten").
 *
 * Bewust NIET gebaseerd op `versionPerformanceSeries()`/`listVersions()`:
 * sinds development-cycle-kandidaten via `createVersion()` aangemaakt worden
 * zonder ooit geactiveerd te zijn (§ Sandbox — een kandidaat wordt pas
 * versie ná menselijke goedkeuring), zou die lijst nooit-geactiveerde
 * kandidaten laten meetellen als "promotie". Een `CHANGE_APPLIED`- of
 * `ROLLBACK`-logboekregel met een `change.afterVersion` bestaat uitsluitend
 * op het moment dat `activateVersion()` daadwerkelijk is aangeroepen (zie
 * `publish/safePublish.ts`) — dat, en alleen dat, is een echt activatiemoment.
 */
export function promotionHistory(): readonly PromotionHistoryEntry[] {
  const out: PromotionHistoryEntry[] = [];
  for (const r of listRunLogs()) {
    for (const e of readRunEvents(r.runId)) {
      if ((e.kind !== "CHANGE_APPLIED" && e.kind !== "ROLLBACK") || !e.change?.afterVersion) continue;
      out.push({
        at: e.timestamp,
        runId: r.runId,
        kind: e.kind === "ROLLBACK" ? "ROLLBACK" : "PUBLISH",
        fromVersionId: e.change.beforeVersion,
        toVersionId: e.change.afterVersion,
        fromDisplayName: e.change.beforeVersion ? (displayNameForVersionId(e.change.beforeVersion) ?? e.change.beforeVersion) : null,
        toDisplayName: displayNameForVersionId(e.change.afterVersion) ?? e.change.afterVersion,
        message: e.message,
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export interface RunsSummary {
  readonly totalRuns: number;
  /** Een run "slaagde technisch" wanneer hij echt uitvoerde (niet LOCAL REQUIRED/spawn-fout) en tot een besluit kwam — KEEP_TESTING telt hierin mee, dat is geen mislukking. */
  readonly technicallyCompleted: number;
  readonly technicallyFailed: number;
  readonly averageBenchmarkDeltaPct: number | null;
  readonly promotionCandidates: number;
  readonly averageRuntimeSeconds: number | null;
}

export function runsSummary(): RunsSummary {
  const geschiedenis = runHistory();
  const technischMislukt = geschiedenis.filter((r) => r.outcome === "RUN_FAILED").length;
  const technischVoltooid = geschiedenis.filter((r) => r.outcome === "RUN_COMPLETED").length;

  const looptijden = geschiedenis
    .filter((r) => r.startedAt && r.finishedAt)
    .map((r) => (new Date(r.finishedAt as string).getTime() - new Date(r.startedAt as string).getTime()) / 1000)
    .filter((s) => Number.isFinite(s) && s >= 0);

  const experimentenMetDiff = readAllExperiments()
    .map((e) => aggregateScore(e.comparisonWithBaseline ?? null))
    .filter((v): v is number => v !== null);

  return {
    totalRuns: geschiedenis.length,
    technicallyCompleted: technischVoltooid,
    technicallyFailed: technischMislukt,
    averageBenchmarkDeltaPct: experimentenMetDiff.length > 0 ? experimentenMetDiff.reduce((a, b) => a + b, 0) / experimentenMetDiff.length : null,
    promotionCandidates: readAllExperiments().filter((e) => e.decision === "PROMOTION_CANDIDATE").length,
    averageRuntimeSeconds: looptijden.length > 0 ? looptijden.reduce((a, b) => a + b, 0) / looptijden.length : null,
  };
}

export interface Finding {
  readonly title: string;
  readonly detail: string;
  readonly direction: "up" | "down";
  readonly basis: string;
  readonly at: string;
}

/** Laatste, betekenisvolle bevindingen — alleen echte dimensieverschillen boven de ruismarge, met vermelding waarop ze gebaseerd zijn. */
export function latestFindings(limit = 6): readonly Finding[] {
  const experimenten = [...readAllExperiments()].reverse();
  const bevindingen: Finding[] = [];
  for (const e of experimenten) {
    if (!e.comparisonWithBaseline) continue;
    for (const [dimensie, delta] of Object.entries(e.comparisonWithBaseline)) {
      if (LATENCY_KEYS.has(dimensie) || typeof delta !== "number" || Math.abs(delta) < 3) continue;
      bevindingen.push({
        title: `${dimensie} ${delta > 0 ? "verbeterd" : "verslechterd"}`,
        detail: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp t.o.v. controle in run ${e.runId}.`,
        direction: delta > 0 ? "up" : "down",
        basis: `Experiment ${e.id.slice(0, 12)} (${e.runId})`,
        at: e.timestamp,
      });
      if (bevindingen.length >= limit) return bevindingen;
    }
  }
  return bevindingen;
}

export type AgentDimensionKey = Exclude<keyof AgentQualityCategory, "latencyMs">;

/** Weergavenaam (v1.0.x) voor een technische versie-ID — `null` als de versie onbekend is. */
export function displayNameForVersionId(versionId: string): string | null {
  return versionPerformanceSeries().find((p) => p.versionId === versionId)?.displayName ?? null;
}
