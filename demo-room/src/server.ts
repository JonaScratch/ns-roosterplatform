import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { dashboardPort, HANDOFF_PATH, REPORTS_DIR } from "./config";
import { CHALLENGES } from "./challenges/catalogue";
import { readAllExperiments, listRunIds, readRunlog } from "./store/runlog";

/**
 * Het lokale dashboard (§20/§21 van de opdracht).
 *
 * Bewust geen framework: één statische pagina (ui/index.html) die een paar
 * JSON-eindpunten pollt. Dat is genoeg om §37 waar te maken ("start, kies
 * challenge, run, kom terug, bekijk rapport") zonder dat de Demo Room een
 * eigen buildstap nodig heeft.
 *
 *   npx tsx --conditions=react-server demo-room/src/server.ts
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveFile(res, path.join(UI_DIR, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (url.pathname === "/api/challenges") {
    json(res, 200, CHALLENGES.map((c) => ({ id: c.id, name: c.name, category: c.category, track: c.track, difficulty: c.difficulty, computeBudgetMinutes: c.computeBudgetMinutes })));
    return;
  }

  if (url.pathname === "/api/runs") {
    json(res, 200, listRunIds());
    return;
  }

  if (url.pathname === "/api/runs/latest-events") {
    const runIds = listRunIds();
    const events = runIds.length > 0 ? readRunlog(runIds[0]) : [];
    json(res, 200, { runId: runIds[0] ?? null, events });
    return;
  }

  if (url.pathname === "/api/experiments") {
    json(res, 200, readAllExperiments());
    return;
  }

  if (url.pathname === "/api/latest-report") {
    const p = path.join(REPORTS_DIR, "latest.json");
    if (!existsSync(p)) {
      json(res, 200, null);
      return;
    }
    json(res, 200, JSON.parse(readFileSync(p, "utf8")));
    return;
  }

  if (url.pathname === "/api/handoff") {
    if (!existsSync(HANDOFF_PATH)) {
      json(res, 200, { markdown: "_(nog geen run uitgevoerd)_" });
      return;
    }
    json(res, 200, { markdown: readFileSync(HANDOFF_PATH, "utf8") });
    return;
  }

  res.writeHead(404);
  res.end("niet gevonden");
});

const port = dashboardPort();
server.listen(port, () => {
  console.log(`Demo Room-dashboard: http://localhost:${port}`);
});
