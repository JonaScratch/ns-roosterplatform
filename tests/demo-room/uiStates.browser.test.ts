import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Browsertest tegen de ÉCHTE Demo Room-server, per toestand (Phase E):
 * leeg, fixture met een mislukte (verloren) run, een actieve run, en een
 * geselecteerde kandidaat. Elke route moet gestyled renderen zonder mislukte
 * verzoeken of paginafouten (`meetRoute` uit demo-room/scripts/ui-smoke.cjs),
 * en elke toestand moet de juiste, eerlijke tekst tonen.
 *
 * Playwright is geen dependency van dit project: zonder Playwright + Chromium
 * slaat deze suite zichzelf over (met reden), in plaats van rood te worden
 * op een machine zonder browser.
 */

const REPO = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(REPO, "tests", "fixtures", "demo-room-state");
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const vereist = createRequire(__filename);
const smoke = vereist(path.join(REPO, "demo-room", "scripts", "ui-smoke.cjs")) as {
  meetRoute: (browser: unknown, basis: string, route: string, uitDir?: string) => Promise<{ route: string; problemen: string[]; meting: { tekst: string; headerTekst: string } }>;
  laadPlaywright: (stil: boolean) => { chromium: { launch: (o: object) => Promise<{ close: () => Promise<void> }> } } | null;
  ROUTES: string[];
};
const playwright = smoke.laadPlaywright(true);
const beschikbaar = Boolean(playwright) && existsSync(CHROMIUM);

async function vrijePoort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const a = s.address();
      const p = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

async function startServer(stateRoot: string): Promise<{ proc: ChildProcess; basis: string }> {
  const poort = await vrijePoort();
  const proc = spawn(process.execPath, [path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), "demo-room/src/server.ts"], {
    cwd: REPO,
    env: { ...process.env, DEMO_ROOM_PORT: String(poort), DEMO_ROOM_STATE_ROOT_OVERRIDE: stateRoot },
    stdio: "ignore",
  });
  const basis = `http://127.0.0.1:${poort}`;
  const eind = Date.now() + 30000;
  while (Date.now() < eind) {
    try {
      if ((await fetch(`${basis}/api/server-info`)).ok) return { proc, basis };
    } catch {
      // nog niet klaar
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error("Demo Room-server kwam niet op");
}

function currentRun(pid: number, status = "RUNNING") {
  return JSON.stringify({
    runId: "DR-FIXTURE-001", kind: "development-run", command: "development-run --minutes 360 --run-id DR-FIXTURE-001",
    startedAt: "2026-09-27T20:58:48.579Z", pid, status, finishedAt: null, exitCode: null, tailOutput: "", errorMessage: null,
  });
}

type Toestand = { naam: string; maak: (dir: string) => void; controles: (tekst: (route: string) => Promise<{ inhoud: string; kop: string }>) => Promise<void> };

let slaper: ChildProcess | null = null;

const TOESTANDEN: Toestand[] = [
  {
    naam: "leeg (nog nooit iets gedraaid)",
    maak: () => {},
    controles: async (lees) => {
      const dash = await lees("dashboard");
      expect(dash.inhoud).toMatch(/Nog geen kandidaat beschikbaar/);
      expect(dash.kop).toMatch(/geen actieve run/);
    },
  },
  {
    naam: "fixture met een verloren run (proces bestaat niet meer)",
    maak: (dir) => {
      cpSync(FIXTURE, dir, { recursive: true });
      writeFileSync(path.join(dir, "data", "current-run.json"), currentRun(2_147_483_000));
    },
    controles: async (lees) => {
      const dr = await lees("development-runs");
      expect(dr.inhoud).toMatch(/mislukt/);
      expect(dr.inhoud).toMatch(/bestaat niet meer/);
      expect(dr.kop).not.toMatch(/loopt:/);
      const lb = await lees("logboek");
      // Alleen de rij van de run zelf — het statusfilter bevat de optie "LOOPT" altijd.
      const rij = lb.inhoud.split("\n").find((regel) => regel.includes("DR-FIXTURE-001")) ?? "";
      expect(rij).toMatch(/ONDERBROKEN/);
      expect(rij).not.toMatch(/LOOPT/);
    },
  },
  {
    naam: "actieve run (levend proces)",
    maak: (dir) => {
      cpSync(FIXTURE, dir, { recursive: true });
      slaper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { stdio: "ignore" });
      writeFileSync(path.join(dir, "data", "current-run.json"), currentRun(slaper.pid ?? -1));
    },
    controles: async (lees) => {
      const dash = await lees("dashboard");
      expect(dash.kop).toMatch(/loopt: development-run/);
      const dr = await lees("development-runs");
      expect(dr.inhoud).toMatch(/loopt/);
    },
  },
  {
    naam: "kandidaat geselecteerd",
    maak: (dir) => cpSync(FIXTURE, dir, { recursive: true }),
    controles: async (lees) => {
      const cd = await lees("candidates?id=experiment-grounding-1");
      expect(cd.inhoud).toMatch(/Kandidaatdetail —\s*experiment-grounding-1/);
      expect(cd.inhoud).toMatch(/WACHT OP MENS/);
      expect(cd.inhoud).not.toMatch(/\bTOEGESTAAN\b(?! )/);
    },
  },
];

describe.skipIf(!beschikbaar)("Demo Room in de browser, per toestand (echte server)", () => {
  let browser: { close: () => Promise<void> } | null = null;

  beforeAll(async () => {
    browser = await playwright!.chromium.launch({ executablePath: CHROMIUM });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    slaper?.kill();
  });

  for (const toestand of TOESTANDEN) {
    it(`${toestand.naam}: elke route gestyled, zonder fouten, met de juiste tekst`, async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "dr-ui-"));
      toestand.maak(dir);
      const { proc, basis } = await startServer(dir);
      try {
        for (const route of smoke.ROUTES) {
          const { problemen } = await smoke.meetRoute(browser, basis, route);
          expect(problemen, `${toestand.naam} · ${route}`).toEqual([]);
        }
        await toestand.controles(async (route) => {
          const { problemen, meting } = await smoke.meetRoute(browser, basis, route);
          expect(problemen, `${toestand.naam} · ${route}`).toEqual([]);
          return { inhoud: meting.tekst, kop: meting.headerTekst };
        });
      } finally {
        proc.kill();
        rmSync(dir, { recursive: true, force: true });
      }
    }, 180000);
  }
});

describe.runIf(!beschikbaar)("Demo Room-browsertest", () => {
  it.skip("overgeslagen: Playwright of Chromium niet gevonden (zet PLAYWRIGHT_MODULE / CHROMIUM_PATH)", () => {});
});
