import "dotenv/config";

// Deze toets meet de keten en niet het taalmodel: altijd de stub, ook als er
// een lokaal model is ingesteld. Anders meet hij twee dingen tegelijk.
process.env.NS_AGENT_FORCE_STUB = "1";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "@/server/data/prisma";
import { verwachting } from "./verwachting";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";

/**
 * Spoor B van het benchmarkprogramma: wat begrijpt, onthoudt en weigert de agent?
 *
 * ## Hoe dit eerlijk blijft
 *
 * De verwachte antwoorden worden hier niet ingetypt maar uit de database gehaald op het
 * moment van meten. Wijzigt het dienstenpakket, dan wijzigt de verwachting mee en komt
 * een verouderd "goed" antwoord vanzelf als fout naar voren.
 *
 * Bestaat de agent nog niet, dan is de uitkomst per test NIET_GEIMPLEMENTEERD — geen
 * nul, geen fout, maar "hier is nog niets". Dat is precies wat M0 moet vastleggen.
 *
 *   npx tsx --conditions=react-server scripts/v105/intelligence-bench.ts --meting m0
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const WORTEL = path.resolve(__dirname, "..", "..");
const TESTSET = path.join(WORTEL, "docs", "v1.0.5", "intelligence-testset.json");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** De agent, als die er is. Nu nog niet: fase 1 levert hem. */
async function laadAgent(): Promise<null | {
  answer: (item: Json) => Promise<Json>;
  pinLevel: (level: "A" | "B" | "C") => Promise<string>;
  restoreLevel: (level: string) => Promise<void>;
  seedMemory: () => Promise<void>;
  clearMemory: () => Promise<void>;
}> {
  const pad = path.join(WORTEL, "src", "server", "agent", "bench-adapter.ts");
  if (!existsSync(pad)) return null;
  // Pad als variabele: TypeScript mag een module die nog niet bestaat niet willen oplossen.
  const mod = (await import(pathToFileURL(pad).href)) as {
    benchAnswer?: (item: Json) => Promise<Json>;
    benchPinLevel?: (level: "A" | "B" | "C") => Promise<string>;
    benchRestoreLevel?: (level: string) => Promise<void>;
    benchSeedMemory?: () => Promise<void>;
    benchClearMemory?: () => Promise<void>;
  };
  if (!mod.benchAnswer || !mod.benchPinLevel || !mod.benchRestoreLevel || !mod.benchSeedMemory || !mod.benchClearMemory) return null;
  return { answer: mod.benchAnswer, pinLevel: mod.benchPinLevel, restoreLevel: mod.benchRestoreLevel, seedMemory: mod.benchSeedMemory, clearMemory: mod.benchClearMemory };
}

async function main() {
  const meting = argument("meting") ?? "m0";
  const bestand = argument("bestand") ?? "intelligence.json";
  const map = path.join(WORTEL, "docs", "v1.0.5", "benchmarks", meting);
  mkdirSync(map, { recursive: true });
  const testset = JSON.parse(readFileSync(TESTSET, "utf8")) as Json;
  const context = await loadEvaluationContextCore("DDR");
  const agent = await laadAgent();

  /**
   * Het niveau van de agent wordt vastgezet op B.
   *
   * Gevonden bij M1: de uitkomst hing af van wat er toevallig in de omgeving
   * aan stond. Op niveau A werd élk rekenverzoek geweigerd, waardoor een test
   * over "meerdere rondes zonder de bevoegdheid" om de verkeerde reden groen
   * stond. B is het niveau waarop het verschil tussen één opdracht (mag) en een
   * reeks rondes (mag niet) werkelijk gemeten wordt.
   */
  const niveauVoor = agent ? await agent.pinLevel("B") : null;

  // Een vaste geheugenset, zodat de geheugentests niet het toevallige geheugen
  // van de demo-omgeving meten. Na afloop wordt hij opgeruimd.
  const geheugenGezet = agent !== null && argument("geheugen") !== "nee";
  if (agent && geheugenGezet) await agent.seedMemory();

  const resultaten: Json[] = [];
  for (const item of testset.items as Json[]) {
    const verwacht = await verwachting(item, context);
    if (!agent) {
      resultaten.push({ id: item.id, category: item.category, holdout: item.holdout, expectKind: item.expect.kind, expected: verwacht, answer: null, status: "NIET_GEIMPLEMENTEERD", reason: "er is nog geen agent (src/server/agent/bench-adapter.ts ontbreekt)" });
      continue;
    }
    try {
      const antwoord = await agent.answer({ ...item, expected: verwacht });
      resultaten.push({ id: item.id, category: item.category, holdout: item.holdout, expectKind: item.expect.kind, expected: verwacht, answer: antwoord, status: antwoord.status ?? "ONBEOORDEELD" });
    } catch (fout) {
      resultaten.push({ id: item.id, category: item.category, holdout: item.holdout, expectKind: item.expect.kind, expected: verwacht, answer: null, status: "FOUT", reason: String(fout) });
    }
  }

  const perCategorie: Record<string, Record<string, number>> = {};
  for (const r of resultaten) {
    const c = (perCategorie[r.category] ??= {});
    c[r.status] = (c[r.status] ?? 0) + 1;
  }
  const uit = {
    schema: "ns-v105-intelligence-result/1",
    measurement: meting,
    measuredAt: new Date().toISOString(),
    testsetVersion: testset.version,
    agentPresent: agent !== null,
    agentLevel: agent ? "B" : null,
    memoryFixture: geheugenGezet,
    model: agent ? (process.env.NS_AGENT_MODEL ?? "stub") : null,
    items: resultaten.length,
    byCategory: perCategorie,
    results: resultaten,
  };
  writeFileSync(path.join(map, bestand), `${JSON.stringify(uit, null, 2)}\n`);
  console.log(`${meting}: ${resultaten.length} tests · agent aanwezig: ${agent ? "ja" : "nee"}`);
  for (const [cat, tellingen] of Object.entries(perCategorie).sort()) console.log(`  ${cat}: ${Object.entries(tellingen).map(([s, n]) => `${s} ${n}`).join(", ")}`);
  const deterministisch = resultaten.filter((r) => r.expectKind === "deterministic");
  console.log(`  deterministisch te controleren: ${deterministisch.length}, waarvan verwachting berekend: ${deterministisch.filter((r) => r.expected !== null).length}`);
  if (agent && geheugenGezet) await agent.clearMemory();
  if (agent && niveauVoor) await agent.restoreLevel(niveauVoor);
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
