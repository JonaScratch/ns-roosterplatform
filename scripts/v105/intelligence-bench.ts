import "dotenv/config";

// Deze toets meet de keten en niet het taalmodel: altijd de stub, ook als er
// een lokaal model is ingesteld. Anders meet hij twee dingen tegelijk.
process.env.NS_AGENT_FORCE_STUB = "1";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { rosterCredit } from "@/domain/operational-requirements";
import { dutyKey } from "@/domain/roster-quality";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { resolveRule } from "@/server/rules-engine/ruleset/types";

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

/** Kloktijd: een dienst die na middernacht eindigt krijgt (+1) erbij, anders leest 25:00 als 01:00. */
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}${m >= 1440 ? " (+1)" : ""}`;
/** Duur: niet afkappen op 24 uur — een roostergemiddelde van 39:59 is geen 15:59. */
const duur = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Het verwachte antwoord, uit de gegevens zelf. Null = niet deterministisch te bepalen. */
async function verwachting(item: Json, context: Awaited<ReturnType<typeof loadEvaluationContextCore>>): Promise<Json | null> {
  if (item.expect.kind !== "deterministic") return null;
  const rosters = context.quality.official;
  const code = item.context.rosterCode as string | undefined;
  const rooster = code ? rosters.find((r) => r.code === code) : undefined;
  const duties = context.quality.duties;
  switch (item.expect.check) {
    case "line_duties": {
      if (!rooster) return null;
      const weekday = item.expect.params?.weekday as number | undefined;
      const dagen = rooster.days
        .filter((d) => d.lineNumber === item.context.lineNumber && (weekday === undefined || d.weekday === weekday))
        .sort((a, b) => a.weekday - b.weekday)
        .map((d) => {
          const duty = d.dutyCode ? duties.get(dutyKey(d.dutyCode, d.weekday)) : undefined;
          return { weekday: d.weekday, positionType: d.positionType, dutyCode: d.dutyCode, times: duty ? `${hm(duty.startMinute)}–${hm(duty.endMinute)}` : null, kinds: duty?.kinds ?? [] };
        });
      return { days: dagen };
    }
    case "duty_times": {
      if (!rooster) return null;
      const weekday = item.expect.params.weekday as number;
      const dag = rooster.days.find((d) => d.lineNumber === item.context.lineNumber && d.weekday === weekday);
      const duty = dag?.dutyCode ? duties.get(dutyKey(dag.dutyCode, weekday)) : undefined;
      return duty ? { dutyCode: duty.code, start: hm(duty.startMinute), end: hm(duty.endMinute), kinds: duty.kinds } : null;
    }
    case "night_lines": {
      if (!rooster) return null;
      const regels = new Set<number>();
      for (const d of rooster.days) {
        const duty = d.dutyCode ? duties.get(dutyKey(d.dutyCode, d.weekday)) : undefined;
        if (duty?.kinds.includes("NACHT")) regels.add(d.lineNumber);
      }
      return { lines: [...regels].sort((a, b) => a - b) };
    }
    case "rangeer_counts": {
      const uit: Record<string, number> = {};
      for (const r of rosters) {
        let n = 0;
        for (const d of r.days) {
          const duty = d.dutyCode ? duties.get(dutyKey(d.dutyCode, d.weekday)) : undefined;
          if (duty?.kinds.includes("RANGEER")) n += 1;
        }
        uit[r.code] = n;
      }
      return { perRoster: uit };
    }
    case "hours_average": {
      const r = rosters.find((x) => x.code === item.expect.params.rosterCode);
      if (!r) return null;
      const credit = rosterCredit(r, duties);
      return { rosterCode: r.code, averageWeeklyMinutes: credit.averageWeeklyMinutes, formatted: duur(credit.averageWeeklyMinutes) };
    }
    case "rule_value": {
      const resolutie = resolveRule(activeRuleset(), item.expect.params.ruleId, {
        employeeGroup: "MACHINIST",
        company: "NSR",
        location: "DDR",
        onDate: new Date().toISOString().slice(0, 10),
      });
      if (resolutie.kind !== "RESOLVED") return { ruleId: item.expect.params.ruleId, resolved: false, kind: resolutie.kind };
      return {
        ruleId: item.expect.params.ruleId,
        value: resolutie.rule.value,
        unit: resolutie.rule.unit,
        source: resolutie.rule.source,
        legalStatus: resolutie.sourceStatus,
      };
    }
    default:
      return null;
  }
}

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
