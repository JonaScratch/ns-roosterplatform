import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getActiveLyraVersion } from "@/lib/lyra-release";
import { Role } from "@/lib/generated/prisma/enums";
import { actorMet } from "@/server/agent/bench-adapter";
import { askAgent } from "@/server/agent/agent";
import { verzonnenAfwezigheden } from "@/server/agent/bron-afwezigheid";
import { ongedekteGezagsClaims } from "@/server/agent/claim-verification";
import { gegevensTekst, ongegrondeVermeldingen } from "@/server/agent/grounding";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import type { AgentTrace, ModelAanroep } from "@/server/agent/trace";
import { begrippenIn } from "@/server/agent/vocabulary";
import { prisma } from "@/server/data/prisma";
import { beoordeelMetBewijs } from "./adversarial-grade";
import { MetingTraces, meetOmgeving } from "./meting-trace";

/**
 * Diagnose van één item met volledige trace, voor elke suite — om hypothesen
 * te onderscheiden vóórdat er iets gerepareerd wordt.
 *
 *   npx tsx --conditions=react-server scripts/v106/diagnose-trace.ts \
 *     --meting diagnose-<datum>-<naam> --suite adversarial --item M --herhaal 3 --replay 5
 *
 * Wat het doet:
 *  1. `--herhaal N`: het item N keer door de volledige keten (askAgent, echte
 *     database, echte tools, eigen sessie), elke beurt met trace.
 *  2. `--replay K`: het compose-verzoek uit de eerste trace K keer letterlijk
 *     opnieuw naar het model — dezelfde bytes. Verschillen de antwoorden, dan is
 *     de compose bij gelijke invoer niet reproduceerbaar.
 *  3. Varianten van datzelfde verzoek, elk K keer (alleen diagnose, geen
 *     productiegedrag):
 *       - `zonder-release`: de systeeminstructie zonder de toevoeging van de
 *         actieve Lyra-versie (als die er is);
 *       - `notities-apart`: elke `note` uit de toolgegevens óók als losse regel
 *         onder de gegevens.
 *  Op elke uitkomst draaien de huidige poorten (gronding, gezagsclaims,
 *  verzonnen afwezigheid) en, bij adversarial, de grader met bewijs.
 *
 * De holdoutvraag wordt — net als in adversarial-bench.ts — pas hier, tijdens
 * de meting, uit het ontwerpbestand gelezen. Schrijft naar
 * `docs/lyra-knowledge/benchmarks/diagnose/<meting>/`; overschrijft nooit.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const WORTEL = path.resolve(__dirname, "..", "..");
const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function items(suite: string): Json[] {
  const pad =
    suite === "adversarial"
      ? path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", "adversarial-holdout-design.json")
      : suite === "kern"
        ? path.join(WORTEL, "docs", "v1.0.6", "golden-suite.json")
        : path.join(WORTEL, "docs", "v1.0.6", "golden-suite-extension.json");
  if (!existsSync(pad)) throw new Error(`${pad} bestaat niet.`);
  return (JSON.parse(readFileSync(pad, "utf8")) as Json).items as Json[];
}

async function stuur(verzoek: ModelAanroep["verzoek"]): Promise<string> {
  const config = localConfigFromEnv();
  if (!config) throw new Error("geen lokaal model ingesteld");
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...verzoek, stream: false }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`model antwoordde met ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (body.choices?.[0]?.message?.content ?? "").trim();
}

/** De poorten die op modeltekst werken, zoals agent.ts ze toepast (zuivere functies). */
function poorten(tekst: string, trace: AgentTrace): Json {
  const results = trace.tools.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data, sources: t.bronnen }));
  const scherm = Object.values((trace.invoer?.context ?? {}) as Json).filter((v) => v !== null && v !== undefined && v !== "").join(" ");
  const platform = begrippenIn(trace.invoer?.tekst ?? "").map((b) => b.betekenis).join(" ");
  return {
    gronding: ongegrondeVermeldingen(tekst, `${gegevensTekst(results.filter((r) => r.ok))}\n${scherm}\n${platform}`),
    gezagsclaims: ongedekteGezagsClaims(tekst, results),
    afwezigheid: verzonnenAfwezigheden(tekst),
  };
}

function notitiesApart(verzoek: ModelAanroep["verzoek"], trace: AgentTrace): ModelAanroep["verzoek"] | null {
  const notities = trace.tools.flatMap((t) => {
    const d = t.data as Json | null;
    return d && typeof d.note === "string" ? [`- ${t.tool}: ${d.note}`] : [];
  });
  if (notities.length === 0) return null;
  const messages = verzoek.messages.map((m, i) =>
    i === verzoek.messages.length - 1 && m.role === "user"
      ? { ...m, content: m.content.replace("\n\nGebruik uitsluitend", `\n\nVastgesteld door de tools:\n${notities.join("\n")}\n\nGebruik uitsluitend`) }
      : m,
  );
  return { ...verzoek, messages };
}

function zonderRelease(verzoek: ModelAanroep["verzoek"]): ModelAanroep["verzoek"] | null {
  const toevoeging = getActiveLyraVersion().promptText;
  if (!toevoeging) return null;
  const messages = verzoek.messages.map((m) => (m.role === "system" && m.content.endsWith(`\n\n${toevoeging}`) ? { ...m, content: m.content.slice(0, -(toevoeging.length + 2)) } : m));
  return messages.some((m, i) => m !== verzoek.messages[i]) ? { ...verzoek, messages } : null;
}

async function main(): Promise<void> {
  const meting = argument("meting");
  const suite = argument("suite") ?? "adversarial";
  const itemId = argument("item");
  if (!meting || !itemId) throw new Error("Geef --meting <naam> --item <id of letter> [--suite adversarial|kern|extensie] [--herhaal N] [--replay K].");
  const herhaal = Math.max(1, Number(argument("herhaal") ?? 3));
  const replay = Math.max(0, Number(argument("replay") ?? 5));

  const config = localConfigFromEnv();
  if (!config) throw new Error("Geen lokaal model ingesteld (NS_LOCAL_LLM_URL/NS_LOCAL_LLM_MODEL).");
  const beschikbaar = await localModelAvailable(config);
  if (!beschikbaar.ok) throw new Error(`Lokaal model niet bereikbaar: ${beschikbaar.detail}`);

  const alle = items(suite);
  const exact = alle.filter((i) => i.id === itemId);
  const kandidaten = exact.length > 0 ? exact : alle.filter((i) => String(i.id).startsWith(`${itemId}-`));
  if (kandidaten.length !== 1) throw new Error(`--item ${itemId} past op ${kandidaten.length} items in ${suite}; wees preciezer.`);
  const item = kandidaten[0];

  const map = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", "diagnose", meting);
  if (existsSync(path.join(map, "diagnose.json"))) throw new Error(`${map}/diagnose.json bestaat al (bewijsmateriaal).`);
  mkdirSync(map, { recursive: true });

  const commissie = await actorMet([Role.ROSTER_COMMITTEE]);
  if (!commissie) throw new Error("Geen actief ROSTER_COMMITTEE-account.");
  const omgeving = await meetOmgeving();
  const tracer = new MetingTraces(meting);

  const sim = item.context?.toolSimulation as { tool?: string; inject?: string } | undefined;
  const toolFouten = sim?.tool && sim.inject === "TOOL_ERROR" ? { [sim.tool]: "TOOL_ERROR" as const } : undefined;
  const context = { ...item.context, candidateId: item.context?.candidateId ?? null, locationCode: "DDR" };

  const oordeel = (tekst: string, beurt: Json) =>
    suite === "adversarial" ? beoordeelMetBewijs({ ...item, turns: [{ ...beurt, text: tekst }] }) : null;

  const runs: Json[] = [];
  for (let r = 0; r < herhaal; r += 1) {
    let sessionId: string | null = null;
    const beurten: Json[] = [];
    for (let t = 0; t < item.turns.length; t += 1) {
      const antwoord = await tracer.beurt({ item: item.id, herhaling: r, beurt: t }, () =>
        askAgent({ actor: commissie, text: item.turns[t].text, uiContext: context, sessionId, persist: true, toolFouten }),
      );
      sessionId = antwoord.sessionId ?? sessionId;
      beurten.push({ text: antwoord.text, status: antwoord.status, tools: antwoord.toolCalls.map((c) => c.tool), toolGesimuleerd: antwoord.toolCalls.map((c) => Boolean(c.gesimuleerd)) });
    }
    const laatste = beurten[beurten.length - 1];
    runs.push({ herhaling: r, eind: laatste, oordeel: suite === "adversarial" ? beoordeelMetBewijs({ ...item, turns: beurten }) : null });
    console.log(`herhaling ${r + 1}/${herhaal}: ${laatste.status}${runs[r].oordeel ? ` · ${runs[r].oordeel.status}` : ""}`);
  }

  // Replays op het compose-verzoek van de laatste beurt van de eerste herhaling.
  const eerste = tracer.traces.filter((t) => t.labels.herhaling === 0).at(-1);
  const compose = eerste?.modelAanroepen.find((a) => a.fase === "compose" && a.ruweUitvoer !== null);
  const replays: Json[] = [];
  if (eerste && compose && replay > 0) {
    const varianten: [string, ModelAanroep["verzoek"] | null][] = [
      ["identiek", compose.verzoek],
      ["zonder-release", zonderRelease(compose.verzoek)],
      ["notities-apart", notitiesApart(compose.verzoek, eerste)],
    ];
    const beurt = { status: eerste.compose?.status ?? null, tools: eerste.tools.map((t) => t.tool) };
    for (const [naam, verzoek] of varianten) {
      if (!verzoek) {
        replays.push({ variant: naam, overgeslagen: naam === "zonder-release" ? "geen actieve Lyra-toevoeging in de systeeminstructie" : "geen notities in de toolgegevens" });
        continue;
      }
      const uitkomsten: Json[] = [];
      for (let k = 0; k < replay; k += 1) {
        const tekst = await stuur(verzoek);
        uitkomsten.push({ tekst, poorten: poorten(tekst, eerste), oordeel: oordeel(tekst, beurt) });
      }
      const verschillend = new Set(uitkomsten.map((u) => u.tekst)).size;
      replays.push({ variant: naam, n: replay, verschillendeTeksten: verschillend, gelijkAanOrigineel: uitkomsten.filter((u) => u.tekst === compose.ruweUitvoer?.trim()).length, uitkomsten });
      console.log(`replay ${naam}: ${verschillend} verschillende tekst(en) op ${replay}${suite === "adversarial" ? `; oordelen ${uitkomsten.map((u) => u.oordeel?.status).join(", ")}` : ""}`);
    }
  }

  writeFileSync(
    path.join(map, "diagnose.json"),
    `${JSON.stringify({ schema: "ns-diagnose-trace/1", meting, suite, item: item.id, gemeten: new Date().toISOString(), herhaal, replay, runs, composeOrigineel: compose?.ruweUitvoer ?? null, replays }, null, 1)}\n`,
    { flag: "wx" },
  );
  tracer.schrijf(map, omgeving);
  console.log(`\n${path.relative(WORTEL, map)}/diagnose.json + traces.json`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (fout) => {
    console.error(fout instanceof Error ? fout.message : fout);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
}
