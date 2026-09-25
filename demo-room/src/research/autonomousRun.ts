import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/data/prisma";
import type { RebuildGoal } from "@/server/optimizer/objective-weights";
import { AGENT_CAPABILITIES } from "@/server/agent/capabilities";
import { startResearchLoop } from "@/server/agent/research";
import { demoRoomActor } from "../actor";
import { budgetFromMinutes, locationCode as defaultLocationCode, type ComputeBudget } from "../config";
import { requireCapability } from "../safety";
import { vindDuplicaat } from "../store/experimentMemory";
import { appendExperiment, readAllExperiments } from "../store/runlog";
import type { ExperimentRecord } from "../types";

/**
 * "RUN LYRA FOR N MINUTES" (§12/§27/§37 van de opdracht) — spoor B.
 *
 * ## Waarom dit geen tweede onderzoekslus bouwt
 *
 * De hoofdapp heeft al een volledige, bevoegdheid-gecontroleerde onderzoekslus
 * (`AgentResearchLoop`/`AgentResearchRound`, aangestuurd door
 * `startResearchLoop()`): baseline meten, een ronde draaien met de echte
 * optimizer, de kandidaat onafhankelijk beoordelen, besluiten of er nog een
 * ronde komt, en op elk moment stoppen zodra de bevoegdheid, de noodrem of het
 * stopverzoek dat zeggen. Deze module vertaalt alleen een gevraagd
 * tijdsbudget (10/30/60 minuten/aangepast) naar de parameters van die lus,
 * bewaakt het compute-budget van de Demo Room erbovenop, en schrijft na
 * afloop het verplichte journaal en HANDOFF.md.
 *
 * ## Wat hier NIET gebeurt
 *
 * Er wordt geen `AgentCapabilityGrant` aangemaakt of verhoogd. Zonder een
 * grant die een mens al op AUTONOMOUS + EXPERIMENT_RUN heeft gezet voor deze
 * standplaats, stopt dit vóór de eerste ronde — zie `safety.ts`.
 */

export interface AutonomousRunRequest {
  readonly minutes: number;
  readonly goal: string;
  readonly goals: readonly RebuildGoal[];
  readonly searchMode: "FAST" | "NORMAL" | "DEEP" | "EXTENSIVE";
  readonly locationCode?: string;
  readonly budgetOverrides?: Partial<ComputeBudget>;
}

export interface AutonomousRunOutcome {
  readonly runId: string;
  readonly loopId: string;
  readonly budget: ComputeBudget;
  readonly baselineScore: number | null;
  readonly bestScore: number | null;
  readonly bestCandidateId: string | null;
  readonly roundsDone: number;
  readonly status: string;
  readonly conclusion: string | null;
}

/** Start de lus en geef meteen het loop-ID terug; de lus loopt in de achtergrond door (zoals `startResearchLoop` dat al doet). */
export async function startAutonomousRun(
  request: AutonomousRunRequest,
): Promise<{ readonly runId: string; readonly loopId: string; readonly budget: ComputeBudget; readonly duplicateWarning: string | null }> {
  const runId = `DR-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}-${randomUUID().slice(0, 6)}`;
  const location = request.locationCode ?? defaultLocationCode();
  const budget = budgetFromMinutes(request.minutes, request.budgetOverrides);

  // §13: voorkom nutteloze herhaling. Blokkeert niets — een bewuste herhaling
  // na een reparatie is legitiem — maar meldt het wél, met de eerdere
  // uitkomst erbij, vóórdat er compute aan wordt besteed.
  const eerdereRuns = readAllExperiments();
  const duplicaat = vindDuplicaat({ hypothesis: request.goal, configuration: { goals: request.goals }, soort: "ENGINE_VARIANT" }, eerdereRuns);
  const duplicateWarning = duplicaat.isDuplicaat ? duplicaat.toelichting : null;

  const { actor, grant } = await requireCapability(await demoRoomActor(), location, AGENT_CAPABILITIES.AUTONOMOUS);

  // Het rondebudget van de lus zelf komt uit de toekenning (maxRounds), niet
  // uit dit tijdsbudget: die twee zijn met opzet gescheiden bewaakt. De Demo
  // Room voegt de wandklok-, model- en optimizerbudgetten van §23 daarbovenop.
  const loopId = await startResearchLoop({
    actor,
    grant,
    locationCode: location,
    goal: `[DEMO-ROOM ${runId}] ${request.goal}`,
    goals: [...request.goals],
    searchMode: request.searchMode,
  });

  appendExperiment(startRecord(runId, request, loopId, duplicateWarning));
  return { runId, loopId, budget, duplicateWarning };
}

function startRecord(runId: string, request: AutonomousRunRequest, loopId: string, duplicateWarning: string | null): ExperimentRecord {
  return {
    id: randomUUID(),
    runId,
    timestamp: new Date().toISOString(),
    soort: "ENGINE_VARIANT",
    hypothesis: request.goal,
    reason: `Autonome onderzoeksrun gestart voor ${request.minutes} minuten, doelen: ${request.goals.join(", ")}`,
    configuration: { loopId, goals: request.goals, searchMode: request.searchMode },
    candidateProduced: null,
    validatorResult: null,
    qualityMetrics: null,
    baselineMetrics: null,
    comparisonWithBaseline: null,
    outcome: "INCONCLUSIVE",
    failureReason: null,
    nextRecommendation: duplicateWarning ? `Let op vóór verder onderzoek: ${duplicateWarning}` : null,
    decision: "KEEP_TESTING",
  };
}

/**
 * Poll de lus tot ze klaar is of het wandklokbudget om is, en schrijf dan het
 * eindresultaat weg. Geen eigen polling-interval-configuratie in v0.1: elke
 * 5 seconden is ruim genoeg voor een proces dat minuten tot uren duurt.
 */
export async function awaitAutonomousRun(runId: string, loopId: string, budget: ComputeBudget): Promise<AutonomousRunOutcome> {
  const begin = Date.now();
  const maxMs = budget.maxWallClockMinutes * 60_000 + 30_000; // marge: de lus mag zelf ook nog netjes afronden
  let laatste: Awaited<ReturnType<typeof haalLoopOp>>;
  do {
    laatste = await haalLoopOp(loopId);
    if (laatste.status !== "RUNNING") break;
    await new Promise((r) => setTimeout(r, 5000));
  } while (Date.now() - begin < maxMs);

  const uitkomst: AutonomousRunOutcome = {
    runId,
    loopId,
    budget,
    baselineScore: laatste.baselineScore,
    bestScore: laatste.bestScore,
    bestCandidateId: laatste.bestCandidateId,
    roundsDone: laatste.roundsDone,
    status: laatste.status,
    conclusion: laatste.conclusion,
  };

  appendExperiment(eindRecord(runId, loopId, uitkomst));
  return uitkomst;
}

async function haalLoopOp(loopId: string) {
  const rij = await prisma.agentResearchLoop.findUniqueOrThrow({
    where: { id: loopId },
    select: { status: true, baselineScore: true, bestScore: true, bestCandidateId: true, roundsDone: true, conclusion: true },
  });
  return rij;
}

function eindRecord(runId: string, loopId: string, uitkomst: AutonomousRunOutcome): ExperimentRecord {
  const verbeterd = uitkomst.baselineScore !== null && uitkomst.bestScore !== null && uitkomst.bestScore > uitkomst.baselineScore;
  return {
    id: randomUUID(),
    runId,
    timestamp: new Date().toISOString(),
    soort: "ENGINE_VARIANT",
    hypothesis: `Uitkomst van onderzoekslus ${loopId}`,
    reason: uitkomst.conclusion ?? "(nog geen conclusie — lus mogelijk nog bezig of afgebroken op wandklokbudget)",
    configuration: { loopId },
    candidateProduced: uitkomst.bestCandidateId,
    validatorResult: uitkomst.bestCandidateId ? "VALID" : null, // elke CandidateRoster in AgentResearchRound is al door de onafhankelijke validator gegaan (research.ts)
    qualityMetrics: uitkomst.bestScore !== null ? { robust: uitkomst.bestScore } : null,
    baselineMetrics: uitkomst.baselineScore !== null ? { robust: uitkomst.baselineScore } : null,
    comparisonWithBaseline:
      uitkomst.baselineScore !== null && uitkomst.bestScore !== null ? { robust: uitkomst.bestScore - uitkomst.baselineScore } : null,
    outcome: uitkomst.status === "DONE" ? (verbeterd ? "SUCCESS" : "INCONCLUSIVE") : uitkomst.status === "FAILED" ? "FAILURE" : "INCONCLUSIVE",
    failureReason: uitkomst.status === "FAILED" ? "de onderzoekslus eindigde als FAILED — zie AgentEvent-log in het activiteitenpaneel voor details" : null,
    nextRecommendation: verbeterd
      ? `Kandidaat ${uitkomst.bestCandidateId} is beter dan de baseline (${uitkomst.baselineScore?.toFixed(1)} → ${uitkomst.bestScore?.toFixed(1)}). Beoordeel hem via de gewone Roostercommissie-schermen; de Demo Room promoveert niets automatisch.`
      : "Geen verbetering gevonden binnen dit budget — dat is een geldige, eerlijke uitkomst (§7/§37). Overweeg een ander doel of meer rondes.",
    decision: verbeterd ? "PROMOTION_CANDIDATE" : "REJECTED",
  };
}
