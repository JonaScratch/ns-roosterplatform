import "dotenv/config";

// GEEN NS_AGENT_FORCE_STUB hier — zelfde reden als golden-bench.ts: dit
// bewijst echt agentgedrag, niet stubgedrag.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@/lib/generated/prisma/enums";
import { askAgent } from "@/server/agent/agent";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import { prisma } from "@/server/data/prisma";
import type { Actor } from "@/server/auth/session";

/**
 * De adversarial-holdoutlaag (§56, Fase 12) draaien tegen het werkelijke
 * lokale model — het ontbrekende stuk vóór `scripts/v106/adversarial-grade.ts`
 * iets te beoordelen heeft. Zelfde architectuur als `golden-bench.ts`
 * (`askAgent()`, echte database, echte tools, echte rechten, geen stub),
 * hier tegen `docs/lyra-knowledge/benchmarks/adversarial-holdout-design.json`
 * in plaats van de gewone golden suite.
 *
 * ## Freeze-/leesregel (adversarial-holdout-design.md §2.2)
 *
 * Dit bestand voert het ontwerp uit zoals het ná de tweede batch vaststond
 * (9 items) — het wijzigt zelf geen `expect`/`turns`/`context`/`note`-velden.
 * Zodra dit voor het eerst is gedraaid en gecommit, geldt de freeze/audit-
 * regel uit §4 van dat document.
 *
 * ## Item Q (`Q-DDR-BLM-NIGHTSTRUCTURE-TOOLFOUT`) — bewust NIET uitgevoerd
 *
 * Dit item vereist dat de `nightStructure`-toolaanroep zelf faalt (een echte
 * timeout/foutcode, niet een lege/onbekende uitkomst) — `context.toolSimulation`
 * in het ontwerpbestand beschrijft dit expliciet. Er bestaat vandaag geen
 * fault-injection-mechanisme in `src/server/agent/tools.ts` om dat na te
 * bootsen, en dit script bouwt er ook geen: dat zou een aparte, op zichzelf
 * te beoordelen wijziging aan de echte toolaanroepketen zijn, geen
 * benchmarkscript. Item Q wordt daarom overgeslagen met een eerlijke,
 * expliciete `error` — nooit stilzwijgend zonder de simulatie gedraaid (dat
 * zou een misleidende GOED/FOUT-uitslag opleveren voor de verkeerde reden).
 *
 *   npx tsx --conditions=react-server scripts/v106/adversarial-bench.ts --meting adversarial-<runId>
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
    sessionId: "adversarial-bench",
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
  if (!meting) throw new Error("Geef --meting <naam>.");

  const config = localConfigFromEnv();
  if (!config) throw new Error("Geen lokaal model ingesteld (NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL).");
  const beschikbaar = await localModelAvailable(config);
  console.log(`model ${config.model} op ${config.baseUrl}: ${beschikbaar.ok ? "bereikbaar" : "ONBEREIKBAAR"} — ${beschikbaar.detail}`);

  const map = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", "adversarial", meting);
  mkdirSync(map, { recursive: true });

  if (!beschikbaar.ok) {
    writeFileSync(path.join(map, "adversarial.json"), `${JSON.stringify({ status: "GEEN_LOKAAL_MODEL", reason: beschikbaar.detail }, null, 2)}\n`);
    console.log("Niet gemeten: geen lokaal model bereikbaar.");
    return;
  }

  const ontwerpPad = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", "adversarial-holdout-design.json");
  if (!existsSync(ontwerpPad)) throw new Error(`Ontwerpbestand ontbreekt: ${ontwerpPad}`);
  const ontwerp = JSON.parse(readFileSync(ontwerpPad, "utf8")) as Json;

  const commissie = await actorMet([Role.ROSTER_COMMITTEE]);
  if (!commissie) throw new Error("Geen actief ROSTER_COMMITTEE-account. Draai eerst de seed.");

  const resultaten: Json[] = [];
  const gemaaktSessies: string[] = [];
  let i = 0;

  for (const item of ontwerp.items as Json[]) {
    i += 1;
    process.stdout.write(`\r  ${i}/${ontwerp.items.length} ${item.id.padEnd(36)}`);
    const t0 = Date.now();

    if (item.context?.toolSimulation) {
      resultaten.push({
        id: item.id,
        category: item.category,
        holdout: item.holdout,
        context: item.context,
        expect: item.expect,
        error: `TOOL_SIMULATION_NIET_GEÏMPLEMENTEERD: dit item vereist een gesimuleerde toolfout (${JSON.stringify(item.context.toolSimulation)}) — geen fault-injection-mechanisme aanwezig in tools.ts, zie de docstring bovenaan dit bestand.`,
        ms: 0,
      });
      continue;
    }

    let sessionId: string | null = null;
    const context = { ...item.context, candidateId: item.context.candidateId ?? null, locationCode: "DDR" };
    const beurten: Json[] = [];
    try {
      for (let t = 0; t < item.turns.length; t += 1) {
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
          ...(antwoord.tegengehouden ? { tegengehouden: antwoord.tegengehouden } : {}),
        });
      }
      if (sessionId) gemaaktSessies.push(sessionId);
      resultaten.push({
        id: item.id,
        category: item.category,
        holdout: item.holdout,
        context: item.context,
        expect: item.expect,
        note: item.note,
        turns: beurten,
        ms: Date.now() - t0,
      });
    } catch (fout) {
      resultaten.push({ id: item.id, category: item.category, holdout: item.holdout, context: item.context, expect: item.expect, error: String(fout), ms: Date.now() - t0 });
    }
  }
  process.stdout.write("\n");

  const uit = {
    schema: "ns-v106-adversarial-bench/1",
    measurement: meting,
    measuredAt: new Date().toISOString(),
    status: "GEMETEN",
    model: { name: config.model, baseUrl: config.baseUrl, temperature: config.temperature, maxTokens: config.maxTokens },
    designVersion: ontwerp.version,
    itemCount: (ontwerp.items as Json[]).length,
    results: resultaten,
  };
  writeFileSync(path.join(map, "adversarial.json"), `${JSON.stringify(uit, null, 2)}\n`);
  console.log(`Geschreven: ${path.join(map, "adversarial.json")}`);

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
