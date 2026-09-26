import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LOGS_DIR } from "../config";
import type { LogEvent, LogEventKind, RunEndSummary } from "../types";

/**
 * Het permanente, append-only Demo Room-logboek (§ aanvulling "VERPLICHT
 * VOLLEDIG DEMO ROOM LOGBOEK / AUDIT TRAIL").
 *
 * ## Wat dit is, en wat het niet is
 *
 * Dit is de volledige operationele geschiedenis van een run: alles wat er
 * gebeurde, in volgorde, ook afwijzingen en mislukkingen. Het journaal
 * (`store/journal.ts`) blijft bestaan voor *betekenisvolle* experimenten;
 * het rapport blijft de samenvatting; `HANDOFF.md` blijft de actuele
 * ontwikkelkennis. Vier verschillende vragen, vier verschillende bestanden —
 * zie het README voor de exacte scheiding.
 *
 * ## Crash-safe
 *
 * Elke `log()`-aanroep is een synchrone `appendFileSync` — geen buffer, geen
 * batching, geen "schrijf pas aan het einde". Crasht het proces na 47
 * minuten, dan staan die 47 minuten al op schijf.
 *
 * ## Twee bestanden, met opzet
 *
 * `RUN-<tijd>-<id>.txt` is de menselijke bron (leesbaar, downloadbaar,
 * kopieerbaar naar een ChatGPT/Claude-gesprek). `RUN-<tijd>-<id>.jsonl` is
 * hetzelfde, machineleesbaar, één event per regel.
 */

function txtPath(runId: string): string {
  return path.join(LOGS_DIR, `${runId}.txt`);
}
function jsonlPath(runId: string): string {
  return path.join(LOGS_DIR, `${runId}.jsonl`);
}

/**
 * Centrale redactie — geheimen komen nooit op schijf (§ "GEHEIMEN
 * REDACTEREN"). Bewust ruim: liever een vals positief (een onschuldige
 * lange hex-string die wordt afgekapt) dan een gemist wachtwoord.
 */
const REDACTIE_PATRONEN: readonly RegExp[] = [
  /(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, // connection string met wachtwoord
  /((?:api|access|secret)[-_ ]?key\s*[:=]\s*)["']?[\w-]{8,}["']?/gi,
  /(bearer\s+)[\w.\-]{10,}/gi,
  /((?:password|wachtwoord|passwd|pwd)\s*[:=]\s*)["']?\S{3,}["']?/gi,
  /(token\s*[:=]\s*)["']?[\w.\-]{10,}["']?/gi,
  /(sk-[a-zA-Z0-9]{10,})/g, // generieke geheime-sleutelvorm
];

export function redact(tekst: string): string {
  let out = tekst;
  for (const patroon of REDACTIE_PATRONEN) {
    out = out.replace(patroon, (_match, prefix?: string) => `${prefix ?? ""}[GEREDIGEERD]`);
  }
  return out;
}

function redactData(data: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = typeof v === "string" ? redact(v) : v;
  return out;
}

function humanLine(event: LogEvent): string {
  const data = event.data
    ? ` | ${Object.entries(event.data)
        .map(([k, v]) => `${k}=${typeof v === "number" ? v : String(v)}`)
        .join(" | ")}`
    : "";
  const exp = event.experimentId ? ` | ${event.experimentId}` : "";
  const wijziging = event.change
    ? ` | before=${event.change.beforeVersion ?? "—"} after=${event.change.afterVersion ?? "—"} files=${event.change.affectedFiles.join(",")}`
    : "";
  return `${event.timestamp}${exp} | ${event.kind} | ${event.message}${data}${wijziging}`;
}

export interface StartRunMeta {
  readonly kind: string;
  readonly productionVersion: string | null;
  readonly sandboxParent: string | null;
  readonly modelConfig: string | null;
  readonly challengeOrGoal: string | null;
}

/**
 * Schrijft het RUN_START-blok. Idempotent met betrekking tot een eerder
 * geschreven bestand: als het dashboard al een `RUN_START_REQUESTED`-event
 * schreef (§ "live logboek moet robuust zijn" — vóórdat het CLI-proces zelf
 * live was), wordt dat NIET overschreven — dit voegt alleen het echte
 * RUN_START-blok eraan toe. Zonder dashboard (losse terminal-aanroep) is dit
 * bestand nog leeg en wordt het gewoon vers aangemaakt.
 */
export function startRun(runId: string, meta: StartRunMeta): void {
  mkdirSync(LOGS_DIR, { recursive: true });
  const header = [
    `=== Demo Room-run ${runId} (${meta.kind}) ===`,
    `Gestart: ${new Date().toISOString()}`,
    `Production Lyra-versie: ${meta.productionVersion ?? "onbekend"}`,
    `Sandbox parent/versie: ${meta.sandboxParent ?? "n.v.t."}`,
    `Model/config: ${meta.modelConfig ?? "onbekend"}`,
    `Challenge/doel: ${meta.challengeOrGoal ?? "n.v.t."}`,
    "",
  ].join("\n");
  if (!existsSync(txtPath(runId))) {
    writeFileSync(txtPath(runId), header, "utf8");
    writeFileSync(jsonlPath(runId), "", "utf8");
  } else {
    appendFileSync(txtPath(runId), `${header}\n`, "utf8");
  }
  log(runId, { kind: "RUN_START", message: `Run gestart (${meta.kind}).`, experimentId: null, data: meta as unknown as Record<string, unknown> });
}

export function log(runId: string, input: Omit<LogEvent, "timestamp" | "runId"> & { readonly experimentId: string | null }): void {
  mkdirSync(LOGS_DIR, { recursive: true });
  const event: LogEvent = {
    timestamp: new Date().toISOString(),
    runId,
    experimentId: input.experimentId,
    kind: input.kind,
    message: redact(input.message),
    data: redactData(input.data),
    change: input.change,
  };
  appendFileSync(txtPath(runId), `${humanLine(event)}\n`, "utf8");
  appendFileSync(jsonlPath(runId), `${JSON.stringify(event)}\n`, "utf8");
}

const aantalOfNietGemeten = (n: number | null | undefined): string => (n === null || n === undefined ? "niet gemeten" : String(n));

export function endRun(runId: string, summary: RunEndSummary): void {
  const dc = summary.detailedCounters;
  const blok = [
    "",
    `=== ${summary.outcome} ===`,
    "--- VOLLEDIGE RUN ACCOUNTING ---",
    `Totale looptijd: ${Math.round(summary.totalDurationMs / 1000)}s`,
    `Modelaanroepen (totaal, beste schatting): ${aantalOfNietGemeten(summary.modelCalls)}`,
    dc ? `  waarvan benchAnswer()-aanroepen: ${aantalOfNietGemeten(dc.benchAnswerCalls)}` : null,
    dc ? `  waarvan directe askAgent()-aanroepen (contextresolutietest): ${aantalOfNietGemeten(dc.askAgentDirectCalls)}` : null,
    dc ? `  waarvan model-inferentiebeurten (turns): ${aantalOfNietGemeten(dc.modelInferenceTurns)}` : null,
    dc ? `  toolaanroepen: ${aantalOfNietGemeten(dc.toolCalls)}` : null,
    dc ? `  retries: ${aantalOfNietGemeten(dc.retries)} · mislukkingen: ${aantalOfNietGemeten(dc.failures)}` : null,
    `Experimenten: ${summary.experiments}`,
    `Optimizerjobs: ${summary.optimizerJobs}`,
    `Geteste varianten: ${summary.variantsTested}`,
    `Geaccepteerd: ${summary.accepted} · Verworpen: ${summary.rejected}`,
    `Beste gevonden variant: ${summary.bestVariant ?? "(geen)"}`,
    `Productie gewijzigd: ${summary.productionChanged ? "ja" : "nee"}`,
    `Openstaande hypotheses: ${summary.openHypotheses.length > 0 ? summary.openHypotheses.join("; ") : "geen"}`,
    `Belangrijkste lessen: ${summary.lessonsLearned.length > 0 ? summary.lessonsLearned.join("; ") : "geen vastgelegd"}`,
    "--- KNOWN WEAKNESSES AFTER RUN ---",
    summary.knownWeaknessesAfterRun && summary.knownWeaknessesAfterRun.length > 0
      ? summary.knownWeaknessesAfterRun.join("; ")
      : "geen expliciet vastgelegd (dat betekent niet automatisch dat er geen zijn — zie de individuele dimensiewaarden hierboven)",
    "",
  ]
    .filter((regel): regel is string => regel !== null)
    .join("\n");
  appendFileSync(txtPath(runId), blok, "utf8");
  appendFileSync(jsonlPath(runId), `${JSON.stringify({ timestamp: new Date().toISOString(), runId, kind: "RUN_END", summary })}\n`, "utf8");
}

export interface RunLogListing {
  readonly runId: string;
  readonly startedAt: string | null;
  readonly outcome: string | null;
}

export function listRunLogs(): readonly RunLogListing[] {
  mkdirSync(LOGS_DIR, { recursive: true });
  const runIds = readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(/\.txt$/, ""))
    .sort()
    .reverse();
  return runIds.map((runId) => {
    const events = readRunEvents(runId);
    const start = events.find((e) => e.kind === "RUN_START");
    const eindRegel = existsSync(jsonlPath(runId))
      ? readFileSync(jsonlPath(runId), "utf8")
          .trim()
          .split("\n")
          .map((r) => {
            try {
              return JSON.parse(r) as { kind?: string };
            } catch {
              return null;
            }
          })
          .find((r) => r?.kind === "RUN_END")
      : null;
    return { runId, startedAt: start?.timestamp ?? null, outcome: eindRegel ? "afgerond" : "loopt (of afgebroken zonder afsluiting)" };
  });
}

export function readRunText(runId: string): string | null {
  return existsSync(txtPath(runId)) ? readFileSync(txtPath(runId), "utf8") : null;
}

export function readRunEvents(runId: string): readonly LogEvent[] {
  if (!existsSync(jsonlPath(runId))) return [];
  return readFileSync(jsonlPath(runId), "utf8")
    .split("\n")
    .filter((r) => r.trim().length > 0)
    .map((r) => {
      try {
        return JSON.parse(r) as LogEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is LogEvent => e !== null);
}

export function runTxtFilePath(runId: string): string {
  return txtPath(runId);
}
export function runJsonlFilePath(runId: string): string {
  return jsonlPath(runId);
}

/** Voor tests: welke event-soorten zijn ooit in dit run-logboek gezien. */
export function eventKindsIn(runId: string): ReadonlySet<LogEventKind> {
  return new Set(readRunEvents(runId).map((e) => e.kind));
}
