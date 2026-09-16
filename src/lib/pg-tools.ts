import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Aansturing van het lokale ontwikkelcluster van PostgreSQL.
 *
 * Alleen bedoeld voor ontwikkeling en test. In productie draait de database als
 * beheerde dienst; niets in dit bestand wordt dan gebruikt.
 *
 * ## Waarom pg_ctl en niet de embedded-postgres API
 *
 * De bibliotheek start de postmaster als gewoon kindproces: zodra het startende
 * proces stopt, gaat de database mee. Bovendien importeert zij `async-exit-hook`,
 * dat `process.exitCode` weggooit — waardoor vitest altijd 0 zou teruggeven en
 * een testsuite haar eigen commando niet kan laten falen. `pg_ctl` heeft beide
 * problemen niet en is dezelfde build die de datadirectory heeft aangemaakt.
 */

/** De `bin`-map van de PostgreSQL-build die embedded-postgres installeert. */
export function embeddedBinDir(
  root = path.resolve("node_modules/@embedded-postgres"),
): string | null {
  if (!existsSync(root)) {
    return null;
  }
  for (const entry of readdirSync(root)) {
    const candidate = path.join(root, entry, "native", "bin");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function embeddedTool(tool: string): string | null {
  const dir = embeddedBinDir();
  if (!dir) {
    return null;
  }
  const binary = path.join(dir, process.platform === "win32" ? `${tool}.exe` : tool);
  return existsSync(binary) ? binary : null;
}

export interface ClusterOptions {
  dataDir: string;
  port: number;
  /** Waar de server zijn log schrijft. Zonder logbestand gaat output naar de aanroeper. */
  logFile: string;
}

function pgCtlOrThrow(): string {
  const binary = embeddedTool("pg_ctl");
  if (!binary) {
    throw new Error(
      "De PostgreSQL-binaries van embedded-postgres zijn niet gevonden.\nVoer uit: npm install",
    );
  }
  return binary;
}

/** Accepteert er iets verbindingen op deze poort? */
export function portInUse(port: number, host = "127.0.0.1", timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (inUse: boolean): void => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

/** Wacht tot de poort wel (of juist niet meer) antwoordt. false = opgegeven. */
export async function waitForPort(port: number, expected: boolean, attempts = 40): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await portInUse(port)) === expected) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Is deze datadirectory geïnitialiseerd? */
export function clusterExists(dataDir: string): boolean {
  return existsSync(path.join(dataDir, "PG_VERSION"));
}

/** Vindt pg_ctl dat hier een server draait? Negeert verouderde pid-bestanden. */
export function clusterRunning(dataDir: string): boolean {
  return (
    spawnSync(pgCtlOrThrow(), ["-D", dataDir, "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).status === 0
  );
}

/** Maakt een nieuw cluster aan. UTF-8 en een vaste locale, bewust. */
export function initCluster(options: { dataDir: string; user: string; password: string }): void {
  const initdb = embeddedTool("initdb");
  if (!initdb) {
    throw new Error("initdb van embedded-postgres is niet gevonden.\nVoer uit: npm install");
  }

  // initdb accepteert het superuser-wachtwoord uitsluitend uit een bestand.
  const dir = mkdtempSync(path.join(tmpdir(), "nsr-pg-"));
  const passwordFile = path.join(dir, "pw");
  writeFileSync(passwordFile, `${options.password}\n`, "utf8");

  try {
    const result = spawnSync(
      initdb,
      [
        `--pgdata=${options.dataDir}`,
        "--auth=scram-sha-256",
        `--username=${options.user}`,
        `--pwfile=${passwordFile}`,
        // UTF-8 afdwingen. De Windows-systeemlocale levert anders een WIN1252-
        // cluster op, waarin elke rij met een teken buiten Latin-1 niet ingevoegd
        // kan worden. De codering ligt vast bij initdb: fout hier betekent later
        // het cluster opnieuw opbouwen.
        "--encoding=UTF8",
        "--locale=C",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    if (result.status !== 0) {
      throw new Error(
        `initdb faalde: ${`${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 400)}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Start het cluster en laat het draaien nadat dit proces is gestopt.
 *
 * stdio wordt bewust weggegooid: de postmaster erft de handles van pg_ctl en
 * sluit ze nooit, dus een start met pipes keert terug en wacht vervolgens
 * eeuwig. Waarom een start faalt staat in het serverlog, niet op stdout.
 */
export function startCluster(options: ClusterOptions): void {
  const result = spawnSync(
    pgCtlOrThrow(),
    ["-D", options.dataDir, "-l", options.logFile, "-o", `-p ${options.port}`, "start"],
    { stdio: "ignore", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(
      `pg_ctl kon het cluster in ${options.dataDir} niet starten.\nHet serverlog staat in ${options.logFile}.`,
    );
  }
}

/** Stopt het cluster. Geeft de melding van pg_ctl terug voor de aanroeper. */
export function stopCluster(dataDir: string): { ok: boolean; output: string } {
  const result = spawnSync(pgCtlOrThrow(), ["-D", dataDir, "-m", "fast", "-w", "stop"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}
