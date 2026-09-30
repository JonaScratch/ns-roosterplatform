import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config";
import type { LongRunCheckpoint } from "./longRun";

/**
 * De canonieke plek van een lange run in de repository:
 * `docs/lyra-knowledge/long-runs/<runId>/`.
 *
 * Het werkcheckpoint staat in `DATA_DIR/long-runs/<runId>/checkpoint.json`
 * (niet getrackt, daar leest de motor bij hervatten uit). Na elk checkpoint
 * komt er een levende kopie op de canonieke plek, zodat een run die vanuit de
 * UI is gestart — en ook een run die crasht — daar zichtbaar is, en de
 * verifier (`scripts/lyra-master/verify-long-run.ts --run <runId>`) er direct
 * op kan werken. `LONG-RUN-VERIFICATION.json` schrijft alleen de verifier, en
 * die overschrijft nooit.
 */

export function canoniekeMap(runId: string): string {
  return path.join(REPO_ROOT, "docs", "lyra-knowledge", "long-runs", runId.replace(/[^A-Za-z0-9._-]/g, "_"));
}

export function schrijfCanoniekeKopie(c: LongRunCheckpoint, map = canoniekeMap(c.runId)): string {
  mkdirSync(map, { recursive: true });
  const doel = path.join(map, "checkpoint.json");
  const tmp = `${doel}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(c, null, 2)}\n`, "utf8");
  renameSync(tmp, doel);
  return doel;
}
