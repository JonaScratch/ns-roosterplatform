import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@/lib/generated/prisma/enums";
import { askAgent } from "@/server/agent/agent";
import { actorMet } from "@/server/agent/bench-adapter";
import { prisma } from "@/server/data/prisma";
import type { ChatModel } from "@/server/agent/model/types";
import { beoordeelAdversarialItem } from "../../../scripts/v106/adversarial-grade";
import { REPO_ROOT } from "../config";
import * as logbook from "../store/logbook";

/**
 * De adversarial stap van de ontwikkelcyclus: de locked holdout
 * (`adversarial-holdout-design.json`) met de kandidaat én met productie.
 *
 * Alleen de meet- en rechterkant leest dit bestand, tijdens de meting. De
 * generator ziet het nooit (`lessons.ts`/`generateCandidate.ts` importeren
 * dit niet). Beoordeeld met dezelfde grader als de lokale AFTER-run
 * (`scripts/v106/adversarial-grade.ts`), zodat "adversarial" in een
 * ontwikkelcyclus hetzelfde betekent als in een meting.
 *
 * Productie wordt per run één keer gemeten (de basis verandert binnen een run
 * niet: er wordt nooit iets geactiveerd).
 */

export interface AdversarialMeting {
  readonly goed: number;
  readonly totaal: number;
  readonly pct: number;
  readonly perItem: readonly { readonly id: string; readonly status: string }[];
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const basisPerRun = new Map<string, AdversarialMeting>();

export async function meetAdversarial(runId: string, model: ChatModel | undefined, label: string): Promise<AdversarialMeting> {
  if (!model && basisPerRun.has(runId)) return basisPerRun.get(runId)!;
  const ontwerpPad = path.join(REPO_ROOT, "docs", "lyra-knowledge", "benchmarks", "adversarial-holdout-design.json");
  if (!existsSync(ontwerpPad)) throw new Error(`adversarial holdout ontbreekt: ${ontwerpPad}`);
  const ontwerp = JSON.parse(readFileSync(ontwerpPad, "utf8")) as Json;
  const actor = await actorMet([Role.ROSTER_COMMITTEE]);
  if (!actor) throw new Error("Geen actief ROSTER_COMMITTEE-account voor de adversarial meting (seed ontbreekt?).");

  logbook.log(runId, { kind: "BENCHMARK_START", experimentId: null, message: `${label}: adversarial holdout gestart (${ontwerp.items.length} items).` });
  const perItem: { id: string; status: string }[] = [];
  const sessies: string[] = [];
  for (const item of ontwerp.items as Json[]) {
    const sim = item.context?.toolSimulation as { tool?: string; inject?: string } | undefined;
    const toolFouten = sim?.tool && sim.inject === "TOOL_ERROR" ? { [sim.tool]: "TOOL_ERROR" as const } : undefined;
    const beurten: Json[] = [];
    let sessionId: string | null = null;
    try {
      for (const turn of item.turns as Json[]) {
        const a = await askAgent({ actor, text: turn.text, uiContext: { ...item.context, candidateId: null, locationCode: "DDR" }, sessionId, persist: true, modelOverride: model, toolFouten });
        sessionId = a.sessionId ?? sessionId;
        beurten.push({ text: a.text, status: a.status, tools: a.toolCalls.map((c) => c.tool), toolGesimuleerd: a.toolCalls.map((c) => Boolean(c.gesimuleerd)), data: a.data, sources: a.sources });
      }
      if (sessionId) sessies.push(sessionId);
      perItem.push({ id: item.id, status: beoordeelAdversarialItem({ ...item, turns: beurten }).status });
    } catch (fout) {
      perItem.push({ id: item.id, status: beoordeelAdversarialItem({ ...item, error: String(fout), turns: [] }).status });
    }
  }
  // Gesprekken zijn nodig voor meerbeurtsitems, maar horen niet te blijven staan.
  if (sessies.length > 0) {
    await prisma.agentActivity.deleteMany({ where: { sessionId: { in: sessies } } });
    await prisma.agentMessage.deleteMany({ where: { sessionId: { in: sessies } } });
    await prisma.agentSession.deleteMany({ where: { id: { in: sessies } } });
  }
  const goed = perItem.filter((p) => p.status === "GOED").length;
  const meting: AdversarialMeting = { goed, totaal: perItem.length, pct: perItem.length > 0 ? (goed / perItem.length) * 100 : 0, perItem };
  logbook.log(runId, { kind: "BENCHMARK_RESULT", experimentId: null, message: `${label}: adversarial ${goed}/${perItem.length} GOED (${perItem.map((p) => `${p.id.split("-")[0]}=${p.status}`).join(", ")}).` });
  if (!model) basisPerRun.set(runId, meting);
  return meting;
}
