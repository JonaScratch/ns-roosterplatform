import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, DEMO_ROOM_ROOT, REPO_ROOT } from "./config";
import * as logbook from "./store/logbook";
import type { RunEndSummary } from "./types";

/**
 * Rungestuurde acties vanuit het dashboard: "Start" spawnt exact dezelfde CLI
 * die ook los vanaf de terminal werkt — er is geen tweede uitvoeringspad.
 * `server.ts` importeert daardoor zelf geen hoofdapp-code en hoeft niet met
 * `--conditions=react-server` te draaien; alleen het gespawnde `cli.ts`-proces
 * doet dat, via het npm-script.
 *
 * De status staat in een bestand (`data/current-run.json`), niet alleen in
 * het geheugen van dit proces: een herstart van het dashboard verliest zo
 * niet uit het oog dat er nog iets draait (al kan een herstart het proces
 * zelf natuurlijk niet terugroepen — het bestand vertelt dan tenminste
 * eerlijk "onbekend, controleer het besturingssysteem").
 *
 * ## Windows: waarom niet `spawn("npx", ...)`
 *
 * Op Windows is `npx` in werkelijkheid `npx.cmd`, een batchbestand. Node's
 * `child_process.spawn` kan zo'n `.cmd`-bestand niet rechtstreeks starten
 * zonder `shell: true` (anders: `spawn npx ENOENT`) — en met `shell: true` is
 * elke waarde die uiteindelijk in de argumenten belandt (bijvoorbeeld een
 * vrij ingevulde `goal`-tekst uit het dashboard) een potentieel
 * shell-injectierisico op Windows' `cmd.exe`, zelfs met een argumentenarray.
 * Daarom start dit bestand `node <pad-naar-tsx-cli.mjs> ...` rechtstreeks: dat
 * is precies wat `npx tsx` zelf ook doet, zonder shell, zonder `.cmd`-bestand,
 * op Windows én Linux/macOS identiek.
 */

export interface RunControlState {
  readonly runId: string;
  readonly kind: string;
  readonly command: string;
  readonly startedAt: string;
  readonly pid: number;
  readonly status: "STARTING" | "RUNNING" | "DONE" | "FAILED" | "STOPPED";
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly tailOutput: string;
  /** Korte, concrete foutmelding voor de UI — nooit alleen "geen actieve run" bij een echte fout. */
  readonly errorMessage: string | null;
}

const STATE_FILE = path.join(DATA_DIR, "current-run.json");
const MAX_TAIL_CHARS = 8000;

function readState(): RunControlState | null {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunControlState;
}

function writeState(state: RunControlState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function currentRun(): RunControlState | null {
  return readState();
}

const TERMINAL_STATUSSEN: readonly RunControlState["status"][] = ["DONE", "FAILED", "STOPPED"];
export function isTerminalStatus(status: RunControlState["status"]): boolean {
  return TERMINAL_STATUSSEN.includes(status);
}

/**
 * De verstreken tijd is server-berekend, niet client-berekend (§ regressiecheck
 * "Live run: alle getoonde waarden zijn serverdata; alleen elapsed rendering
 * mag client-side worden bijgewerkt") — puur en dus zonder een echt bestand te
 * testen.
 *
 * Regel: zolang de run nog geen `finishedAt` heeft, loopt de tijd mee met
 * `now` (echt "live"). Zodra `finishedAt` bekend is, bevriest de tijd daarop —
 * voor altijd hetzelfde getal, ongeacht hoe vaak of laat dit later opnieuw
 * wordt opgevraagd (de bug die dit verving rekende bij elke opvraging opnieuw
 * `now - startedAt` uit, ook ná afronding, en bleef dus doortellen).
 *
 * Een oude/beschadigde toestand die WEL een eindstatus heeft maar GEEN
 * `finishedAt` (bijvoorbeeld geschreven door een eerdere versie van deze
 * code) mag nooit alsnog tegen `now` aflopen — dat zou hetzelfde
 * "blijft oplopen"-symptoom terugbrengen. `fallbackEndMs` (in de praktijk:
 * de laatste-wijzigingstijd van het statusbestand) geeft dan een vast,
 * niet-groeiend ijkpunt.
 */
export function computeElapsedMs(state: Pick<RunControlState, "startedAt" | "finishedAt" | "status">, now: number, fallbackEndMs?: number): number {
  const start = new Date(state.startedAt).getTime();
  if (state.finishedAt) return Math.max(0, new Date(state.finishedAt).getTime() - start);
  if (isTerminalStatus(state.status)) return Math.max(0, (fallbackEndMs ?? start) - start);
  return Math.max(0, now - start);
}

/** `currentRun()` plus de server-berekende `elapsedMs` — dit is wat `/api/current-run` teruggeeft. */
export function currentRunWithElapsed(): (RunControlState & { readonly elapsedMs: number }) | null {
  const state = readState();
  if (!state) return null;
  const fallbackEndMs = existsSync(STATE_FILE) ? statSync(STATE_FILE).mtimeMs : undefined;
  return { ...state, elapsedMs: computeElapsedMs(state, Date.now(), fallbackEndMs) };
}

/**
 * Vindt tsx's eigen CLI-bestand (`node_modules/tsx/dist/cli.mjs`) zodat we
 * `node <dat bestand> --conditions=react-server <cli.ts> ...` rechtstreeks
 * kunnen starten — functioneel identiek aan `npx tsx --conditions=react-server
 * ...`, maar zonder npx/shell/`.cmd`-resolutie. Bestaat het bestand niet (een
 * ongebruikelijke install-layout), dan faalt dit meteen met een concrete,
 * uitlegbare fout — nooit een stille ENOENT later in een losgekoppeld proces.
 */
function resolveTsxCli(): string {
  const kandidaat = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(kandidaat)) {
    throw new Error(
      `tsx niet gevonden op het verwachte pad (${kandidaat}). Voer 'npm install' uit in de repository-root (${REPO_ROOT}) en probeer opnieuw.`,
    );
  }
  return kandidaat;
}

/** Eerlijke, minimale eindsamenvatting voor een run die nooit écht gestart is (spawn-fout) — geen verzonnen tellers. */
function legeEindsamenvatting(outcome: RunEndSummary["outcome"], reden: string, begin: number): RunEndSummary {
  return {
    outcome,
    totalDurationMs: Date.now() - begin,
    modelCalls: 0,
    experiments: 0,
    optimizerJobs: 0,
    variantsTested: 0,
    accepted: 0,
    rejected: 0,
    bestVariant: null,
    productionChanged: false,
    openHypotheses: [],
    lessonsLearned: [reden],
  };
}

/**
 * Start `node <tsx-cli> --conditions=react-server demo-room/src/cli.ts <args>`
 * als los proces. Weigert als er al iets loopt — één run tegelijk in v0.1-v0.3
 * (zie `ComputeBudget.maxConcurrentWorkers`, nog altijd 1).
 *
 * Statusverloop, altijd zichtbaar voor de UI (§ "Bij klikken wil ik: STARTING
 * → RUNNING → DONE/FAILED/STOPPED"): dit bestand zet `STARTING` vóórdat het
 * proces er is, `RUNNING` zodra het OS bevestigt dat het proces daadwerkelijk
 * draait (Node's `spawn`-event), en anders `FAILED` met de concrete foutmelding
 * — een spawn-fout verdwijnt hier nooit stilzwijgend (§ "Een spawn-fout mag
 * nooit stil verdwijnen").
 */
export function startCliRun(runId: string, kind: string, args: readonly string[]): RunControlState {
  const bestaand = readState();
  if (bestaand && (bestaand.status === "RUNNING" || bestaand.status === "STARTING")) {
    throw new Error(`Er draait al een run (${bestaand.kind}, gestart ${bestaand.startedAt}). Stop die eerst.`);
  }

  const begin = Date.now();
  let state: RunControlState = {
    runId,
    kind,
    command: `cli.ts ${args.join(" ")}`,
    startedAt: new Date().toISOString(),
    pid: -1,
    status: "STARTING",
    finishedAt: null,
    exitCode: null,
    tailOutput: "",
    errorMessage: null,
  };
  writeState(state);

  let tsxCli: string;
  try {
    tsxCli = resolveTsxCli();
  } catch (fout) {
    const bericht = fout instanceof Error ? fout.message : String(fout);
    state = { ...state, status: "FAILED", finishedAt: new Date().toISOString(), exitCode: null, errorMessage: bericht };
    writeState(state);
    logbook.log(runId, { kind: "ERROR", experimentId: null, message: `Kon het CLI-proces niet starten: ${bericht}` });
    logbook.endRun(runId, legeEindsamenvatting("RUN_FAILED", bericht, begin));
    return state;
  }

  const cliPath = path.join(DEMO_ROOM_ROOT, "src", "cli.ts");
  const child = spawn(process.execPath, [tsxCli, "--conditions=react-server", cliPath, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const opTail = (chunk: Buffer) => {
    const huidige = readState() ?? state;
    const tail = (huidige.tailOutput + chunk.toString("utf8")).slice(-MAX_TAIL_CHARS);
    writeState({ ...huidige, tailOutput: tail });
  };
  child.stdout?.on("data", opTail);
  child.stderr?.on("data", opTail);

  // Bevestigt dat het OS het proces daadwerkelijk gestart heeft (Node ≥15.1).
  child.on("spawn", () => {
    const huidige = readState() ?? state;
    if (huidige.status === "STARTING") writeState({ ...huidige, status: "RUNNING", pid: child.pid ?? -1 });
  });

  // Spawn zelf mislukt (bv. het binaire pad bestaat niet, geen rechten) — dit
  // is precies het geval dat vroeger onopgemerkt bleef: zonder deze handler
  // gooit Node een onafgehandelde 'error' en kan het hele dashboardproces
  // crashen, waarna elke volgende API-aanroep (inclusief "/api/current-run")
  // faalt en de UI permanent op "geen actieve run"/"wordt geladen" blijft
  // hangen — exact het gerapporteerde symptoom.
  child.on("error", (fout) => {
    const huidige = readState() ?? state;
    const bericht = `Kon het CLI-proces niet starten of uitvoeren: ${fout.message}`;
    writeState({ ...huidige, status: "FAILED", finishedAt: new Date().toISOString(), exitCode: null, errorMessage: bericht });
    logbook.log(runId, { kind: "ERROR", experimentId: null, message: bericht });
    logbook.endRun(runId, legeEindsamenvatting("RUN_FAILED", bericht, begin));
  });

  child.on("exit", (code, signaal) => {
    const huidige = readState() ?? state;
    if (huidige.status === "FAILED") return; // al afgehandeld door het 'error'-event hierboven
    const gestopt = huidige.status === "STOPPED";
    const mislukt = !gestopt && code !== 0;
    writeState({
      ...huidige,
      status: gestopt ? "STOPPED" : mislukt ? "FAILED" : "DONE",
      finishedAt: new Date().toISOString(),
      exitCode: code,
      errorMessage: mislukt ? `Proces eindigde met foutcode ${code}${signaal ? ` (signaal ${signaal})` : ""}. Zie procesoutput voor details.` : huidige.errorMessage,
    });
  });

  child.unref();
  return state;
}

/**
 * Best-effort stoppen: SIGTERM naar het gespawnde proces (op Windows forceert
 * Node dit sowieso af, Windows kent geen POSIX-signalen). Voor een autonome
 * onderzoeksrun is dit grover dan de hoofdapp-eigen `requestStop()` (die de
 * lus netjes op een rondegrens laat stoppen) — dat verfijnen is vervolgwerk;
 * v0.2/v0.3 stopt het CLI-proces zelf, wat de lus in de database als
 * `INTERRUPTED` achterlaat, precies zoals een crash dat ook al deed (zie
 * `recoverStaleActivities()` in de hoofdapp).
 */
export function stopCurrentRun(): { readonly stopped: boolean; readonly detail: string } {
  const state = readState();
  if (!state || (state.status !== "RUNNING" && state.status !== "STARTING")) return { stopped: false, detail: "Er draait niets." };
  try {
    process.kill(state.pid, "SIGTERM");
    writeState({ ...state, status: "STOPPED", finishedAt: new Date().toISOString() });
    return { stopped: true, detail: `Stopsignaal gestuurd naar proces ${state.pid}.` };
  } catch (fout) {
    return { stopped: false, detail: fout instanceof Error ? fout.message : String(fout) };
  }
}
