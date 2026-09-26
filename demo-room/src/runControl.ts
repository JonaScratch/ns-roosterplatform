import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, DEMO_ROOM_ROOT, REPO_ROOT } from "./config";

/**
 * Rungestuurde acties vanuit het dashboard (§5/§6 van v0.2): "Start" spawnt
 * exact dezelfde CLI die ook los vanaf de terminal werkt — er is geen tweede
 * uitvoeringspad. `server.ts` importeert daardoor zelf geen hoofdapp-code en
 * hoeft niet met `--conditions=react-server` te draaien; alleen het gespawnde
 * `cli.ts`-proces doet dat, via het npm-script.
 *
 * De status staat in een bestand (`data/current-run.json`), niet alleen in
 * het geheugen van dit proces: een herstart van het dashboard verliest zo
 * niet uit het oog dat er nog iets draait (al kan een herstart het proces
 * zelf natuurlijk niet terugroepen — het bestand vertelt dan tenminste
 * eerlijk "onbekend, controleer het besturingssysteem").
 */

export interface RunControlState {
  readonly runId: string;
  readonly kind: string;
  readonly command: string;
  readonly startedAt: string;
  readonly pid: number;
  readonly status: "RUNNING" | "DONE" | "FAILED" | "STOPPED";
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly tailOutput: string;
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

/**
 * Start `npx tsx --conditions=react-server demo-room/src/cli.ts <args>` als
 * los proces. Weigert als er al iets loopt — één run tegelijk in v0.1/v0.2
 * (zie `ComputeBudget.maxConcurrentWorkers`, nog altijd 1).
 */
export function startCliRun(runId: string, kind: string, args: readonly string[]): RunControlState {
  const bestaand = readState();
  if (bestaand && bestaand.status === "RUNNING") {
    throw new Error(`Er draait al een run (${bestaand.kind}, gestart ${bestaand.startedAt}). Stop die eerst.`);
  }

  const cliPath = path.join(DEMO_ROOM_ROOT, "src", "cli.ts");
  const child = spawn("npx", ["tsx", "--conditions=react-server", cliPath, ...args], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let state: RunControlState = {
    runId,
    kind,
    command: `cli.ts ${args.join(" ")}`,
    startedAt: new Date().toISOString(),
    pid: child.pid ?? -1,
    status: "RUNNING",
    finishedAt: null,
    exitCode: null,
    tailOutput: "",
  };
  writeState(state);

  const opTail = (chunk: Buffer) => {
    const huidige = readState() ?? state;
    const tail = (huidige.tailOutput + chunk.toString("utf8")).slice(-MAX_TAIL_CHARS);
    writeState({ ...huidige, tailOutput: tail });
  };
  child.stdout?.on("data", opTail);
  child.stderr?.on("data", opTail);

  child.on("exit", (code) => {
    const huidige = readState() ?? state;
    writeState({ ...huidige, status: huidige.status === "STOPPED" ? "STOPPED" : code === 0 ? "DONE" : "FAILED", finishedAt: new Date().toISOString(), exitCode: code });
  });

  child.unref();
  return state;
}

/**
 * Best-effort stoppen: SIGTERM naar het gespawnde proces. Voor een autonome
 * onderzoeksrun is dit grover dan de hoofdapp-eigen `requestStop()` (die de
 * lus netjes op een rondegrens laat stoppen) — dat verfijnen is vervolgwerk;
 * v0.2 stopt het CLI-proces zelf, wat de lus in de database als
 * `INTERRUPTED` achterlaat, precies zoals een crash dat ook al deed (zie
 * `recoverStaleActivities()` in de hoofdapp).
 */
export function stopCurrentRun(): { readonly stopped: boolean; readonly detail: string } {
  const state = readState();
  if (!state || state.status !== "RUNNING") return { stopped: false, detail: "Er draait niets." };
  try {
    process.kill(state.pid, "SIGTERM");
    writeState({ ...state, status: "STOPPED", finishedAt: new Date().toISOString() });
    return { stopped: true, detail: `Stopsignaal gestuurd naar proces ${state.pid}.` };
  } catch (fout) {
    return { stopped: false, detail: fout instanceof Error ? fout.message : String(fout) };
  }
}
