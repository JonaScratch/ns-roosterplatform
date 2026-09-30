import "dotenv/config";

// GEEN NS_AGENT_FORCE_STUB hier — zelfde reden als golden-bench.ts: §29 van de
// opdracht verbiedt een agentfunctie TESTED te noemen op basis van de stub
// alleen.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@/lib/generated/prisma/enums";
import { askAgent } from "@/server/agent/agent";
import { MetingTraces, meetOmgeving } from "./meting-trace";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import { prisma } from "@/server/data/prisma";
import type { Actor } from "@/server/auth/session";

/**
 * De AANVULLENDE golden-suite draaien (categorieën L, O — zie
 * `golden-suite-extension.ts`) tegen het werkelijke lokale model.
 *
 * Dit is bewust een apart bestand van `golden-bench.ts`, niet een uitbreiding
 * ervan met een `--suite`-vlag: `golden-bench.ts` is onderdeel van de
 * bevroren BEFORE-toolchain (aangeroepen door `run-before-local.ps1`) en
 * wordt in deze ronde niet aangeraakt, ook niet met een in-principe-veilige
 * additieve parameter. Deze duplicatie is de prijs van die garantie.
 *
 *   npx tsx --conditions=react-server scripts/v106/golden-bench-extension.ts --meting before-ext-r1
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
    sessionId: "golden-bench-extension",
    userId: account.id,
    employeeId: account.employeeId,
    employeeNumber: account.employee?.employeeNumber ?? "onbekend",
    roles: account.roles,
    authLevel: "PASSWORD",
    depot: account.employee?.depot ?? "DDR",
  } as unknown as Actor;
}

function percentiel(waarden: number[], p: number): number {
  if (waarden.length === 0) return 0;
  const sorted = [...waarden].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

async function main(): Promise<void> {
  const meting = argument("meting") ?? "ext0";
  const config = localConfigFromEnv();
  if (!config) throw new Error("Geen lokaal model ingesteld (NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL).");
  const beschikbaar = await localModelAvailable(config);
  console.log(`model ${config.model} op ${config.baseUrl}: ${beschikbaar.ok ? "bereikbaar" : "ONBEREIKBAAR"} — ${beschikbaar.detail}`);

  const suitePad = path.join(WORTEL, "docs", "v1.0.6", "golden-suite-extension.json");
  if (!existsSync(suitePad)) {
    throw new Error(`${suitePad} bestaat niet. Draai eerst: npx tsx --conditions=react-server scripts/v106/golden-suite-extension.ts`);
  }
  const map = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting);
  mkdirSync(map, { recursive: true });

  if (!beschikbaar.ok) {
    writeFileSync(path.join(map, "golden-extension.json"), `${JSON.stringify({ status: "GEEN_LOKAAL_MODEL", reason: beschikbaar.detail }, null, 2)}\n`);
    console.log("Niet gemeten: geen lokaal model bereikbaar.");
    return;
  }

  const suite = JSON.parse(readFileSync(suitePad, "utf8")) as Json;
  const commissie = await actorMet([Role.ROSTER_COMMITTEE]);
  if (!commissie) throw new Error("Geen actief ROSTER_COMMITTEE-account. Draai eerst de seed.");
  // Beurttraces en de meetomgeving (commit, agentcode, actieve Lyra-versie,
  // modeldigest, bevoegdheid) gaan naast het meetbestand in traces.json.
  const omgeving = await meetOmgeving();
  const tracer = new MetingTraces(meting);

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
        const antwoord = await tracer.beurt({ item: item.id, beurt: t }, () => askAgent({ actor: commissie, text: item.turns[t].text, uiContext: context, sessionId, persist: true }));
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
          ...(antwoord.tegengehouden ? { tegengehouden: antwoord.tegengehouden } : {}),
          ...(antwoord.planCorrecties ? { planCorrecties: antwoord.planCorrecties } : {}),
        });
      }
      if (sessionId) gemaaktSessies.push(sessionId);
      resultaten.push({ id: item.id, category: item.category, holdout: item.holdout, expect: item.expect, note: item.note, turns: beurten, ms: Date.now() - t0 });
    } catch (fout) {
      resultaten.push({ id: item.id, category: item.category, holdout: item.holdout, expect: item.expect, error: String(fout), ms: Date.now() - t0 });
    }
  }
  process.stdout.write("\n");

  const uit = {
    schema: "ns-v106-golden-bench-extension/1",
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
  writeFileSync(path.join(map, "golden-extension.json"), `${JSON.stringify(uit, null, 2)}\n`);
  tracer.schrijf(map, omgeving);
  console.log(`Geschreven: ${path.join(map, "golden-extension.json")}`);
  console.log(`  p50 ${uit.timing.p50Ms} ms · p95 ${uit.timing.p95Ms} ms`);

  if (gemaaktSessies.length > 0) {
    await prisma.agentActivity.deleteMany({ where: { sessionId: { in: gemaaktSessies } } });
    await prisma.agentMessage.deleteMany({ where: { sessionId: { in: gemaaktSessies } } });
    await prisma.agentSession.deleteMany({ where: { id: { in: gemaaktSessies } } });
    console.log(`  ${gemaaktSessies.length} testgesprek(ken) opgeruimd.`);
  }
  process.exit(0);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
