import "dotenv/config";
import { execFileSync } from "node:child_process";
import { totalmem } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { verwachting } from "./verwachting";

/**
 * De lokale-AI-benchmark: wat kan het model dat hier werkelijk draait?
 *
 * ## Waarom dit niet dezelfde meting is als de intelligentiebenchmark
 *
 * Die meet de kéten: context, toolkeuze, rechten, gegevens. Dat kan met een
 * stub, en dat is ook precies wat daar gebeurt. Deze meting gaat over het
 * taalmodel zelf: begrijpt het Nederlands, snapt het machinistentaal, roept het
 * de juiste tools aan, en hoe lang doet het erover op déze machine.
 *
 * ## Waarom dit script weigert zonder model
 *
 * Omdat een stubresultaat hier een leugen zou zijn. De opdracht is ondubbelzinnig:
 * een deterministische stub mag uitsluitend de infrastructuur testen en nooit
 * als bewijs voor de intelligentie van het lokale model worden gepresenteerd.
 * Draait er geen model, dan is de uitkomst "niet gemeten" — geen nul, geen
 * schatting.
 *
 * Draaien met:
 *   NS_LOCAL_LLM_URL=http://127.0.0.1:11434/v1 NS_LOCAL_LLM_MODEL=<model> \
 *   npx tsx --conditions=react-server scripts/v105/lokale-ai-bench.ts --meting lokaal-1
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const WORTEL = path.resolve(__dirname, "..", "..");
const TESTSET = path.join(WORTEL, "docs", "v1.0.5", "intelligence-testset.json");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Wat de videokaart op dit moment doet. Null als er geen nvidia-smi is. */
function gpuStand(): { totalMiB: number; usedMiB: number; name: string } | null {
  try {
    const uit = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const [naam, totaal, gebruikt] = uit.trim().split("\n")[0].split(",").map((x) => x.trim());
    return { name: naam, totalMiB: Number(totaal), usedMiB: Number(gebruikt) };
  } catch {
    return null;
  }
}

/**
 * Taalvragen die niets met de database te maken hebben.
 *
 * Ze meten wat de rest van de benchmark bewust niet meet: of het model
 * Nederlands schrijft dat een machinist zou gebruiken, en of het toegeeft wat
 * het niet weet. De beoordeling is hier noodzakelijk grover — een mens moet er
 * naar kijken, en dat staat ook in de uitvoer.
 */
const TAALITEMS: readonly { readonly id: string; readonly prompt: string; readonly let_op: string }[] = [
  { id: "T1", prompt: "Leg in twee zinnen uit wat een afloper is voor een machinist.", let_op: "Nederlands, vaktaal, geen Engelse termen" },
  { id: "T2", prompt: "Een collega zegt: 'die reeks van vijf nachten zit me niet lekker'. Wat bedoelt hij waarschijnlijk?", let_op: "begrijpt spreektaal, gokt niet te stellig" },
  { id: "T3", prompt: "Wat is het verschil tussen een rustdag en een WTV-dag?", let_op: "correct onderscheid of eerlijk 'dat weet ik niet'" },
  { id: "T4", prompt: "Schrijf één zin waarin je een machinist uitlegt dat je zijn voorkeur hebt vastgelegd maar dat een commissielid hem nog moet goedkeuren.", let_op: "gewone taal, geen jargon uit de code" },
];

async function main() {
  const meting = argument("meting") ?? "lokaal-1";
  const map = path.join(WORTEL, "docs", "v1.0.5", "benchmarks", meting);
  mkdirSync(map, { recursive: true });

  const config = localConfigFromEnv();
  if (!config) {
    console.log("Geen lokaal model ingesteld (NS_LOCAL_LLM_URL en NS_LOCAL_LLM_MODEL ontbreken).");
    console.log("Deze meting wordt niet gedraaid: een stubresultaat zou hier als modelkwaliteit worden gelezen.");
    writeFileSync(
      path.join(map, "lokale-ai.json"),
      `${JSON.stringify(
        {
          schema: "ns-v105-local-ai-result/1",
          measurement: meting,
          measuredAt: new Date().toISOString(),
          status: "NIET_GEMETEN",
          reason: "er draait geen lokaal taalmodel; de stub telt hier niet",
          hardware: { gpu: gpuStand(), ramTotalGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10 },
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 0;
    return;
  }

  const bereikbaar = await localModelAvailable(config);
  console.log(`model ${config.model} op ${config.baseUrl}: ${bereikbaar.ok ? "bereikbaar" : "niet bereikbaar"} — ${bereikbaar.detail}`);
  if (!bereikbaar.ok) {
    writeFileSync(
      path.join(map, "lokale-ai.json"),
      `${JSON.stringify(
        { schema: "ns-v105-local-ai-result/1", measurement: meting, measuredAt: new Date().toISOString(), status: "NIET_GEMETEN", reason: bereikbaar.detail, config: { baseUrl: config.baseUrl, model: config.model } },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const gpuVoor = gpuStand();
  const testset = JSON.parse(readFileSync(TESTSET, "utf8")) as Json;
  const context = await loadEvaluationContextCore("DDR");

  const adapter = (await import(pathToFileURL(path.join(WORTEL, "src", "server", "agent", "bench-adapter.ts")).href)) as {
    benchAnswer: (item: Json) => Promise<Json>;
    benchPinLevel: (level: "A" | "B" | "C") => Promise<string>;
    benchRestoreLevel: (level: string) => Promise<void>;
    benchSeedMemory: () => Promise<void>;
    benchClearMemory: () => Promise<void>;
  };

  const niveauVoor = await adapter.benchPinLevel("B");
  await adapter.benchSeedMemory();

  const resultaten: Json[] = [];
  try {
    // Spoor 1: dezelfde testset als de intelligentiebenchmark, nu op het model.
    for (const item of testset.items as Json[]) {
      const t0 = Date.now();
      try {
        // De verwachting hoort mee: zonder haar is geen enkel feitelijk antwoord
        // na te kijken, en komt een meetgat eruit te zien als een modelfout.
        const verwacht = await verwachting(item, context);
        const antwoord = await adapter.benchAnswer({ ...item, expected: verwacht });
        // `answered` en `reasoning` staan er los van het oordeel bij: `status`
        // is de uitslag van de poort en overschrijft de antwoordstatus. Zonder
        // die twee is een gedragsitem achteraf niet opnieuw te beoordelen, en
        // dat bleek bij het repareren van de poorten een echte beperking.
        resultaten.push({
          id: item.id,
          category: item.category,
          holdout: item.holdout,
          kind: item.expect.kind,
          expected: verwacht,
          status: antwoord.status,
          detail: antwoord.detail,
          answered: antwoord.answered,
          reasoning: antwoord.reasoning,
          text: antwoord.text,
          data: antwoord.data,
          tools: antwoord.tools,
          sources: antwoord.sources,
          ms: Date.now() - t0,
        });
      } catch (fout) {
        resultaten.push({ id: item.id, category: item.category, kind: item.expect.kind, status: "FOUT", detail: String(fout), ms: Date.now() - t0 });
      }
      process.stdout.write(".");
    }

    // Spoor 2: losse taalvragen, voor menselijke beoordeling.
    const taal: Json[] = [];
    for (const item of TAALITEMS) {
      const t0 = Date.now();
      const antwoord = await adapter.benchAnswer({
        id: item.id,
        category: "TAAL",
        prompt: item.prompt,
        context: { source: "official" },
        expect: { kind: "rubric" },
      });
      taal.push({ id: item.id, prompt: item.prompt, letOp: item.let_op, text: antwoord.text, ms: Date.now() - t0, status: "ONBEOORDEELD" });
      process.stdout.write("+");
    }
    console.log("");

    const tijden = resultaten.map((r) => r.ms as number).sort((a, b) => a - b);
    const p = (q: number) => (tijden.length ? tijden[Math.min(tijden.length - 1, Math.floor(tijden.length * q))] : null);
    const perCategorie: Record<string, Record<string, number>> = {};
    for (const r of resultaten) {
      const c = (perCategorie[r.category] ??= {});
      c[r.status] = (c[r.status] ?? 0) + 1;
    }

    const gpuNa = gpuStand();
    const uit = {
      schema: "ns-v105-local-ai-result/1",
      measurement: meting,
      measuredAt: new Date().toISOString(),
      status: "GEMETEN",
      model: { name: config.model, endpoint: config.baseUrl, temperature: config.temperature, maxTokens: config.maxTokens },
      isLanguageModel: true,
      hardware: {
        gpuBefore: gpuVoor,
        gpuAfter: gpuNa,
        // Rekent het model werkelijk op de kaart? Een model dat volledig op de
        // processor draait, laat het VRAM ongemoeid — en dat is precies de val
        // waar dit project eerder is ingelopen.
        gpuInUse: gpuVoor && gpuNa ? gpuNa.usedMiB - gpuVoor.usedMiB > 500 || gpuNa.usedMiB > 2000 : null,
        ramTotalGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      },
      timing: { items: tijden.length, p50Ms: p(0.5), p95Ms: p(0.95), maxMs: tijden.at(-1) ?? null, totalMs: tijden.reduce((a, b) => a + b, 0) },
      byCategory: perCategorie,
      results: resultaten,
      language: taal,
      note:
        "Categorie TAAL is niet automatisch beoordeeld: taalkwaliteit vraagt een menselijk oordeel. " +
        "De overige categorieën zijn beoordeeld zoals in de intelligentiebenchmark.",
    };
    writeFileSync(path.join(map, "lokale-ai.json"), `${JSON.stringify(uit, null, 2)}\n`);

    console.log(`\n${meting}: ${resultaten.length} tests op ${config.model}`);
    for (const [cat, tellingen] of Object.entries(perCategorie).sort()) {
      console.log(`  ${cat}: ${Object.entries(tellingen).map(([s, n]) => `${s} ${n}`).join(", ")}`);
    }
    console.log(`  tijd: p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · traagste ${tijden.at(-1)} ms`);
    console.log(`  GPU: ${gpuNa ? `${gpuNa.usedMiB} van ${gpuNa.totalMiB} MiB in gebruik` : "onbekend"}`);
    console.log(`  taalvragen: ${taal.length}, alle ONBEOORDEELD — die horen door een mens te worden gelezen.`);
  } finally {
    await adapter.benchClearMemory();
    await adapter.benchRestoreLevel(niveauVoor);
    await prisma.$disconnect();
  }
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
