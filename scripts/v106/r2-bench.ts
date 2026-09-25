import "dotenv/config";

// Geen stub: §19/§23 vragen expliciet het echte lokale model, zowel voor als
// na de ontwikkeling.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@/lib/generated/prisma/enums";
import { askAgent } from "@/server/agent/agent";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import { prisma } from "@/server/data/prisma";
import type { Actor } from "@/server/auth/session";

/**
 * De R2-vergelijkingsset draaien tegen het werkelijke lokale model.
 *
 * Zelfde opzet als `golden-bench.ts`, met één toevoeging: elke beurt meet nu
 * ook `latencyMs` apart (niet alleen de som over het hele item), want §23.4 en
 * §24 vragen expliciet gemiddelde latency en, straks bij streaming,
 * time-to-first-token naast de totale antwoordtijd.
 *
 *   npx tsx --conditions=react-server scripts/v106/r2-bench.ts --meting r2-pre
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function actorMet(rollen: readonly Role[]): Promise<Actor | null> {
  const account = await prisma.userAccount.findFirst({
    where: { status: "ACTIVE", roles: { hasEvery: [...rollen] } },
    select: { id: true, employeeId: true, roles: true, employee: { select: { employeeNumber: true, depot: true } } },
  });
  if (!account) return null;
  return {
    sessionId: "r2-bench",
    userId: account.id,
    employeeId: account.employeeId,
    employeeNumber: account.employee?.employeeNumber ?? "onbekend",
    roles: account.roles,
    authLevel: "PASSWORD",
    depot: account.employee?.depot ?? "DDR",
  } as unknown as Actor;
}

async function main(): Promise<void> {
  const meting = argument("meting");
  if (!meting) throw new Error("Geef --meting <naam>, bijvoorbeeld r2-pre of n2.");
  const config = localConfigFromEnv();
  if (!config) throw new Error("Geen lokaal model ingesteld (NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL).");
  const beschikbaar = await localModelAvailable(config);
  console.log(`model ${config.model} op ${config.baseUrl}: ${beschikbaar.ok ? "bereikbaar" : "ONBEREIKBAAR"} — ${beschikbaar.detail}`);
  if (!beschikbaar.ok) {
    const map = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting);
    mkdirSync(map, { recursive: true });
    writeFileSync(path.join(map, "r2.json"), `${JSON.stringify({ status: "GEEN_LOKAAL_MODEL", reason: beschikbaar.detail }, null, 2)}\n`);
    console.log("Niet gemeten: geen lokaal model bereikbaar.");
    return;
  }

  const suite = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.6", "r2-suite.json"), "utf8")) as Json;
  const commissie = await actorMet([Role.ROSTER_COMMITTEE]);
  if (!commissie) throw new Error("Geen actief ROSTER_COMMITTEE-account. Draai eerst de seed.");

  const resultaten: Json[] = [];
  const gemaaktSessies: string[] = [];
  let i = 0;

  for (const item of suite.items as Json[]) {
    i += 1;
    process.stdout.write(`\r  ${i}/${suite.items.length} ${item.id.padEnd(28)}`);
    let sessionId: string | null = null;
    const context = { ...item.context, candidateId: item.context.candidateId ?? null, locationCode: "DDR" };
    const beurten: Json[] = [];
    const itemStart = Date.now();
    try {
      for (let t = 0; t < item.turns.length; t += 1) {
        const beurtStart = Date.now();
        const antwoord = await askAgent({ actor: commissie, text: item.turns[t].text, uiContext: context, sessionId, persist: true });
        sessionId = antwoord.sessionId ?? sessionId;
        beurten.push({
          text: antwoord.text,
          status: antwoord.status,
          intent: antwoord.intent,
          reasoning: antwoord.reasoning,
          tools: antwoord.toolCalls.map((c) => c.tool),
          toolInputs: antwoord.toolCalls.map((c) => c.input),
          data: antwoord.data,
          sources: antwoord.sources,
          latencyMs: Date.now() - beurtStart,
        });
      }
      if (sessionId) gemaaktSessies.push(sessionId);
      resultaten.push({
        id: item.id,
        casus: item.casus,
        holdout: item.holdout,
        expect: item.expect,
        note: item.note,
        turns: beurten,
        ms: Date.now() - itemStart,
      });
    } catch (fout) {
      resultaten.push({ id: item.id, casus: item.casus, holdout: item.holdout, expect: item.expect, error: String(fout), ms: Date.now() - itemStart });
    }
  }
  process.stdout.write("\n");

  const map = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting);
  mkdirSync(map, { recursive: true });
  const alleLatencies = resultaten.flatMap((r) => (r.turns ?? []).map((t: Json) => t.latencyMs as number));
  const uit = {
    schema: "ns-v106-r2-bench/1",
    measurement: meting,
    measuredAt: new Date().toISOString(),
    status: "GEMETEN",
    model: { name: config.model, baseUrl: config.baseUrl, temperature: config.temperature, maxTokens: config.maxTokens },
    suiteVersion: suite.version,
    itemCount: (suite.items as Json[]).length,
    results: resultaten,
    timing: {
      p50Ms: percentiel(alleLatencies, 0.5),
      p95Ms: percentiel(alleLatencies, 0.95),
      gemiddeldMs: Math.round(alleLatencies.reduce((a, b) => a + b, 0) / Math.max(1, alleLatencies.length)),
    },
  };
  writeFileSync(path.join(map, "r2.json"), `${JSON.stringify(uit, null, 2)}\n`);
  console.log(`Geschreven: ${path.join(map, "r2.json")}`);
  console.log(`  p50 ${uit.timing.p50Ms} ms · p95 ${uit.timing.p95Ms} ms · gemiddeld ${uit.timing.gemiddeldMs} ms`);

  if (gemaaktSessies.length > 0) {
    await prisma.agentActivity.deleteMany({ where: { sessionId: { in: gemaaktSessies } } });
    await prisma.agentMessage.deleteMany({ where: { sessionId: { in: gemaaktSessies } } });
    await prisma.agentSession.deleteMany({ where: { id: { in: gemaaktSessies } } });
    console.log(`  ${gemaaktSessies.length} testgesprek(ken) opgeruimd.`);
  }
  process.exit(0);
}

function percentiel(waarden: number[], p: number): number {
  if (waarden.length === 0) return 0;
  const sorted = [...waarden].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
