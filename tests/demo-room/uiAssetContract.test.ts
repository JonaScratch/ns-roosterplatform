import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routerPageNames, uiAssetReport } from "../../demo-room/src/uiAssets";

/**
 * Regressietoets voor de "kale HTML"-storing: een Demo Room-server die de
 * routes voor /styles.css en /app.js niet kende (gestart vóór de UI-
 * opsplitsing, commit 790bbde), bleef poort 4173 bezetten en toonde het nieuwe
 * index.html zonder opmaak. Deze tests dwingen het asset-contract af tegen de
 * ÉCHTE server (geen fixture-renderer), plus de zelfdiagnose in index.html die
 * juist bij een verouderde server zichtbaar moet worden.
 */

const REPO = path.resolve(__dirname, "..", "..");
const UI_DIR = path.join(REPO, "demo-room", "ui");

describe("UI-asset-contract (statisch)", () => {
  it("de router kent precies de 7 hoofdroutes plus de drilldown-subpagina", () => {
    expect(routerPageNames(UI_DIR).sort()).toEqual(
      ["candidates", "dashboard", "development-runs", "experiment-detail", "logboek", "test-room", "vergelijken", "versies"].sort(),
    );
  });

  it("elk bestand dat index.html (direct of via imports) nodig heeft, staat op schijf", () => {
    const rapport = uiAssetReport(UI_DIR, routerPageNames(UI_DIR));
    expect(rapport.missing).toEqual([]);
    for (const nodig of ["styles.css", "app.js", "lib/shared.js", "pages/dashboard.js", "pages/experiment-detail.js"]) {
      expect(rapport.required).toContain(nodig);
    }
  });

  it("detecteert een ontbrekend bestand (bv. styles.css) in plaats van het stil te negeren", () => {
    const kopie = mkdtempSync(path.join(os.tmpdir(), "ui-kopie-"));
    try {
      cpSync(UI_DIR, kopie, { recursive: true });
      rmSync(path.join(kopie, "styles.css"));
      rmSync(path.join(kopie, "pages", "logboek.js"));
      const rapport = uiAssetReport(kopie, routerPageNames(kopie));
      expect(rapport.missing).toEqual(["pages/logboek.js", "styles.css"]);
    } finally {
      rmSync(kopie, { recursive: true, force: true });
    }
  });

  it("index.html bevat de zelfdiagnose die ook op een verouderde server werkt", () => {
    const html = readFileSync(path.join(UI_DIR, "index.html"), "utf8");
    // Logo en nav-iconen hebben ook zonder styles.css een beheerste maat.
    expect(html).toMatch(/<img src="\/brand\/ns-logo\.svg"[^>]*width="34"[^>]*height="34"/);
    expect(html).toMatch(/#app-nav svg \{ width: 16px; height: 16px; \}/);
    // Faalde stylesheet/app.js → zichtbare banner met herstelinstructie.
    expect(html).toMatch(/href="\/styles\.css" onerror="__assetFaalt\('\/styles\.css'\)"/);
    expect(html).toMatch(/src="\/app\.js" onerror="__assetFaalt\('\/app\.js'\)"/);
    expect(html).toContain("--demo-room-css");
    expect(html).toContain("taskkill /PID");
  });

  it("styles.css zet de markering die de zelfdiagnose uitleest", () => {
    expect(readFileSync(path.join(UI_DIR, "styles.css"), "utf8")).toMatch(/--demo-room-css:\s*1/);
  });
});

async function vrijePoort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const adres = s.address();
      const p = typeof adres === "object" && adres ? adres.port : 0;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

function startServer(poort: number, stateRoot: string): { proc: ChildProcess; uitvoer: () => string; klaar: Promise<number | null> } {
  let buffer = "";
  const proc = spawn(process.execPath, [path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), "demo-room/src/server.ts"], {
    cwd: REPO,
    env: { ...process.env, DEMO_ROOM_PORT: String(poort), DEMO_ROOM_STATE_ROOT_OVERRIDE: stateRoot },
  });
  proc.stdout?.on("data", (d) => (buffer += String(d)));
  proc.stderr?.on("data", (d) => (buffer += String(d)));
  const klaar = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
  return { proc, uitvoer: () => buffer, klaar };
}

async function wachtOp(url: string, ms = 20000): Promise<void> {
  const eind = Date.now() + ms;
  while (Date.now() < eind) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // nog niet klaar
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server op ${url} kwam niet op`);
}

describe("UI-asset-contract (echte server)", () => {
  let poort = 0;
  let stateRoot = "";
  let server: ReturnType<typeof startServer> | null = null;

  beforeAll(async () => {
    poort = await vrijePoort();
    stateRoot = mkdtempSync(path.join(os.tmpdir(), "dr-state-"));
    server = startServer(poort, stateRoot);
    await wachtOp(`http://127.0.0.1:${poort}/api/server-info`);
  }, 30000);

  afterAll(() => {
    server?.proc.kill();
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("serveert elk vereist UI-bestand met status 200 en het juiste Content-Type", async () => {
    const rapport = uiAssetReport(UI_DIR, routerPageNames(UI_DIR));
    const verwacht: Record<string, RegExp> = { ".css": /^text\/css/, ".js": /^application\/javascript/ };
    for (const rel of rapport.required) {
      const r = await fetch(`http://127.0.0.1:${poort}/${rel}`);
      expect(r.status, rel).toBe(200);
      expect(r.headers.get("content-type") ?? "", rel).toMatch(verwacht[path.extname(rel)] ?? /.+/);
      const inhoud = await r.text();
      expect(inhoud, rel).toBe(readFileSync(path.join(UI_DIR, rel), "utf8"));
    }
  });

  it("de stylesheet die de server levert bevat echt de headerregel", async () => {
    const css = await (await fetch(`http://127.0.0.1:${poort}/styles.css`)).text();
    expect(css).toMatch(/header\.app-header\s*\{[^}]*background:/);
  });

  it("/api/server-info meldt build, PID en een compleet UI-contract", async () => {
    const info = (await (await fetch(`http://127.0.0.1:${poort}/api/server-info`)).json()) as Record<string, unknown>;
    expect(info.build).toMatch(/^[0-9a-f]{12}$|^onbekend$/);
    expect(typeof info.pid).toBe("number");
    expect(info.uiAssetsMissing).toEqual([]);
  });

  it("/api/chat weigert ongeldige schermcontext vóór er een CLI-proces start", async () => {
    const stuur = (body: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${poort}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hoi", ...body }) });
    for (const [body, fout] of [
      [{ rosterCode: "DDR-VL; rm -rf /" }, "ongeldige roostercode"],
      [{ lineNumber: 0 }, "ongeldig regelnummer"],
      [{ lineNumber: "2abc" }, "ongeldig regelnummer"],
      [{ weekday: 8 }, "ongeldige weekdag"],
      [{ candidateLabel: "x".repeat(61) }, "ongeldig kandidaatlabel"],
    ] as const) {
      const r = await stuur(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe(fout);
    }
  });

  it("Phase G–J via de echte API: feedback → concept → meting → activatie alleen door een mens met bevestiging", async () => {
    const post = async (route: string, body: Record<string, unknown>) => {
      const r = await fetch(`http://127.0.0.1:${poort}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const fb = await post("/api/learning/feedback", { text: "Volgens de CAO mag je na drie nachten niet vroeg.", role: "MACHINIST", authorId: "m1" });
    expect(fb.status).toBe(200);
    expect(fb.body.classification.claimsAuthority).toBe(true);
    expect(fb.body.classification.mayBecomeLegalRule).toBe(false);

    const vk = await post("/api/learning/feedback", { text: "Wij willen liever geen vroege dienst direct na een nachtreeks in Dordrecht.", role: "MACHINIST", authorId: "m2" });
    const id = vk.body.concept.id as string;
    expect((await post("/api/learning/concepts/measure", { id })).body.concept.status).toBe("VALIDATED");
    expect((await post("/api/learning/concepts/activate", { id, role: "ROOSTERCOMMISSIE", actorId: "rc1", reason: "besproken" })).status).toBe(400);
    expect((await post("/api/learning/concepts/activate", { id, role: "MACHINIST", actorId: "m2", reason: "zelf", confirm: true })).status).toBe(409);
    expect((await post("/api/learning/concepts/activate", { id, role: "ROOSTERCOMMISSIE", actorId: "rc1", reason: "besproken in de RC", confirm: true })).body.status).toBe("ACTIVE");

    const concepten = (await (await fetch(`http://127.0.0.1:${poort}/api/learning/concepts`)).json()) as { status: string }[];
    expect(concepten.map((c) => c.status)).toEqual(["PROPOSED", "ACTIVE"]);
    const uitdagingen = (await (await fetch(`http://127.0.0.1:${poort}/api/learning/challenges`)).json()) as { category: string; hiddenInvariants: { description: string }[] }[];
    expect(uitdagingen.map((u) => u.category)).toContain("ADVERSARIAL_USER");
    expect(JSON.stringify(uitdagingen)).not.toContain("check");
  }, 30000);

  it("Phase K–O via de echte API: factory-, arena- en long-runroutes antwoorden; een onbekende run pauzeren is 409", async () => {
    for (const route of ["/api/factory/candidates", "/api/factory/arena", "/api/long-runs"]) {
      const r = await fetch(`http://127.0.0.1:${poort}${route}`);
      expect(r.status, route).toBe(200);
      expect(Array.isArray(await r.json()), route).toBe(true);
    }
    const archief = (await (await fetch(`http://127.0.0.1:${poort}/api/factory/archive`)).json()) as { items: unknown[] };
    expect(archief.items).toEqual([]);
    const pauze = await fetch(`http://127.0.0.1:${poort}/api/long-runs/pause`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: "bestaat-niet" }) });
    expect(pauze.status).toBe(409);
    const hervat = await fetch(`http://127.0.0.1:${poort}/api/long-runs/resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: "bestaat-niet" }) });
    expect(hervat.status).toBe(409);
  }, 30000);

  it("een tweede server op dezelfde poort sterft NIET stil, maar noemt de bezetter en stopt met exitcode 2", async () => {
    const tweede = startServer(poort, stateRoot);
    const code = await tweede.klaar;
    expect(code).toBe(2);
    expect(tweede.uitvoer()).toContain(`Poort ${poort} is al in gebruik`);
    expect(tweede.uitvoer()).toMatch(/PID \d+/);
  }, 30000);
});
