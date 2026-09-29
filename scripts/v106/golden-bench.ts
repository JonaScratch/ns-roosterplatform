import "dotenv/config";

// GEEN NS_AGENT_FORCE_STUB hier. Dat is het hele punt van deze meting: §29
// van de opdracht verbiedt een agentfunctie TESTED te noemen op basis van de
// stub alleen. Deze meting loopt door askAgent() met het echte lokale model,
// echte database, echte tools, echte rechten.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@/lib/generated/prisma/enums";
import { askAgent } from "@/server/agent/agent";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import { prisma } from "@/server/data/prisma";
import type { Actor } from "@/server/auth/session";

/**
 * De golden conversation suite draaien tegen het werkelijke lokale model.
 *
 *   npx tsx --conditions=react-server scripts/v106/golden-bench.ts --meting n0
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
    sessionId: "golden-bench",
    userId: account.id,
    employeeId: account.employeeId,
    employeeNumber: account.employee?.employeeNumber ?? "onbekend",
    roles: account.roles,
    authLevel: "PASSWORD",
    depot: account.employee?.depot ?? "DDR",
  } as unknown as Actor;
}

/** Zoekt de kandidaat die het item met "kandidaat 2" bedoelt: de op-een-na-nieuwste. */
async function kandidaat2(locationCode: string): Promise<string | null> {
  const rijen = await prisma.candidateRoster.findMany({
    where: { locationCode, scenarioLabel: { contains: "kandidaat 2" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
    take: 1,
  });
  return rijen[0]?.id ?? null;
}

async function main(): Promise<void> {
  const meting = argument("meting") ?? "n0";
  const config = localConfigFromEnv();
  if (!config) throw new Error("Geen lokaal model ingesteld (NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL).");
  const beschikbaar = await localModelAvailable(config);
  console.log(`model ${config.model} op ${config.baseUrl}: ${beschikbaar.ok ? "bereikbaar" : "ONBEREIKBAAR"} — ${beschikbaar.detail}`);
  if (!beschikbaar.ok) {
    const map = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting);
    mkdirSync(map, { recursive: true });
    writeFileSync(path.join(map, "golden.json"), `${JSON.stringify({ status: "GEEN_LOKAAL_MODEL", reason: beschikbaar.detail }, null, 2)}\n`);
    console.log("Niet gemeten: geen lokaal model bereikbaar.");
    return;
  }

  const suite = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.6", "golden-suite.json"), "utf8")) as Json;
  const commissie = await actorMet([Role.ROSTER_COMMITTEE]);
  if (!commissie) throw new Error("Geen actief ROSTER_COMMITTEE-account. Draai eerst de seed.");

  const kandidaat2Id = await kandidaat2("DDR");

  const resultaten: Json[] = [];
  const gemaaktSessies: string[] = [];
  let i = 0;

  for (const item of suite.items as Json[]) {
    i += 1;
    process.stdout.write(`\r  ${i}/${suite.items.length} ${item.id.padEnd(28)}`);
    let sessionId: string | null = null;
    const context = { ...item.context, candidateId: item.context.candidateId ?? null, locationCode: "DDR" };
    const beurten: Json[] = [];
    const t0 = Date.now();
    try {
      for (let t = 0; t < item.turns.length; t += 1) {
        let turnContext = { ...context };
        // Voor het G-item over kandidaat 2: de eerste beurt is op het officiële
        // rooster, en de test controleert of de tweede beurt vanzelf naar
        // kandidaat 2 overschakelt — dus de screencontext blijft in beide
        // beurten "official". Wisselt het item expliciet van bron, dan staat
        // dat in de tweede beurt van de context van het item zelf (niet hier).
        if (item.id === "G-kandidaat-vervolg" && t === 1 && kandidaat2Id) {
          // De UI-context verandert hier bewust NIET: de vraag test juist of de
          // agent "kandidaat 2" uit de tekst begrijpt zonder dat het scherm is
          // omgeschakeld. Zou de UI het al doen, dan wordt er niets getest.
        }
        const antwoord = await askAgent({ actor: commissie, text: item.turns[t].text, uiContext: turnContext, sessionId, persist: true });
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
          // Wat een grendel tegenhield (alleen aanwezig als dat gebeurde).
          ...(antwoord.tegengehouden ? { tegengehouden: antwoord.tegengehouden } : {}),
          ...(antwoord.planCorrecties ? { planCorrecties: antwoord.planCorrecties } : {}),
        });
      }
      if (sessionId) gemaaktSessies.push(sessionId);
      resultaten.push({
        id: item.id,
        category: item.category,
        holdout: item.holdout,
        expect: item.expect,
        note: item.note,
        turns: beurten,
        ms: Date.now() - t0,
      });
    } catch (fout) {
      resultaten.push({ id: item.id, category: item.category, holdout: item.holdout, expect: item.expect, error: String(fout), ms: Date.now() - t0 });
    }
  }
  process.stdout.write("\n");

  const map = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting);
  mkdirSync(map, { recursive: true });
  const uit = {
    schema: "ns-v106-golden-bench/1",
    measurement: meting,
    measuredAt: new Date().toISOString(),
    status: "GEMETEN",
    model: { name: config.model, baseUrl: config.baseUrl, temperature: config.temperature, maxTokens: config.maxTokens },
    suiteVersion: suite.version,
    itemCount: (suite.items as Json[]).length,
    results: resultaten,
    timing: {
      p50Ms: percentiel(resultaten.map((r) => r.ms).filter(Boolean), 0.5),
      p95Ms: percentiel(resultaten.map((r) => r.ms).filter(Boolean), 0.95),
    },
  };
  writeFileSync(path.join(map, "golden.json"), `${JSON.stringify(uit, null, 2)}\n`);
  console.log(`Geschreven: ${path.join(map, "golden.json")}`);
  console.log(`  p50 ${uit.timing.p50Ms} ms · p95 ${uit.timing.p95Ms} ms`);

  // Testgesprekken opruimen: deze meting hoort geen gesprekken achter te laten
  // in de echte gesprekkenlijst van de commissie.
  if (gemaaktSessies.length > 0) {
    // Ook de activiteitenrijen: askAgent() start er één per beurt
    // (startActivity), en die stond los van de sessie-opruiming hierboven.
    // Gevonden tijdens het testen van deze meting zelf: elke testvraag bleef
    // in het echte activiteitenpaneel van de gebruikte acteur staan.
    // AgentEvent hangt met onDelete: Cascade aan AgentActivity, dus die volgt
    // vanzelf mee.
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
