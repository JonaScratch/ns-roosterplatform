import "server-only";
import { randomUUID } from "node:crypto";
import { askAgent } from "@/server/agent/agent";
import { demoRoomActor } from "../actor";
import * as logbook from "../store/logbook";
import { appendExperiment } from "../store/runlog";
import { requireReadAccess } from "../safety";
import type { ExperimentRecord } from "../types";
import type { ChallengeDefinition } from "./types";

/**
 * De Challenge Engine — spoor A (chatbot). Spoor B (onderzoeker) draait via
 * `research/autonomousRun.ts`, dat dezelfde onderliggende onderzoekslus van de
 * hoofdapp aanstuurt (`startResearchLoop`) in plaats van hier een tweede
 * uitvoeringspad te bouwen.
 *
 * Bewust géén verborgen "success"-berekening die naar een mooi dashboard
 * toewerkt (§7/§33): het resultaat is exact wat de hidden invariants meten,
 * niet meer en niet minder. Een mislukte challenge wordt net zo vastgelegd als
 * een geslaagde.
 */

export interface ChallengeTurnResult {
  readonly text: string;
  readonly status: string;
  readonly sources: readonly string[];
  readonly toolCalls: readonly string[];
  readonly modelName: string;
  readonly ms: number;
}

export interface ChallengeRunResult {
  readonly challengeId: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly turns: readonly ChallengeTurnResult[];
  readonly hiddenInvariantResults: readonly { readonly id: string; readonly description: string; readonly passed: boolean }[];
  readonly allHiddenInvariantsPassed: boolean;
}

export async function runChatbotChallenge(challenge: ChallengeDefinition, runId: string): Promise<ChallengeRunResult> {
  if (challenge.track !== "CHATBOT") throw new Error(`${challenge.id} is geen CHATBOT-challenge; gebruik autonomousRun voor RESEARCHER-challenges`);

  const { actor } = await requireReadAccess(await demoRoomActor(), challenge.datasetLocationCode);
  logbook.log(runId, { kind: "CHALLENGE_OR_GOAL", experimentId: null, message: `Challenge: ${challenge.id} — ${challenge.name} (${challenge.category}, niveau ${challenge.difficulty}).` });

  const startedAt = new Date().toISOString();
  const turns: ChallengeTurnResult[] = [];
  let sessionId: string | null = null;
  let laatsteAntwoord: Awaited<ReturnType<typeof askAgent>> | null = null;

  for (const [i, turn] of challenge.turns.entries()) {
    logbook.log(runId, { kind: "TEST_START", experimentId: null, message: `Beurt ${i + 1}/${challenge.turns.length}: "${turn.text.slice(0, 80)}"` });
    const t0 = Date.now();
    const antwoord = await askAgent({
      actor,
      text: turn.text,
      persist: false,
      sessionId,
      uiContext: {
        source: challenge.startCandidate,
        candidateId: null,
        candidateLabel: null,
        rosterCode: null,
        lineNumber: null,
        weekday: null,
        dutyCode: null,
        locationCode: challenge.datasetLocationCode,
      },
    });
    sessionId = antwoord.sessionId ?? sessionId;
    laatsteAntwoord = antwoord;
    turns.push({
      text: antwoord.text,
      status: antwoord.status,
      sources: antwoord.sources,
      toolCalls: antwoord.toolCalls.map((c) => c.tool),
      modelName: antwoord.model,
      ms: Date.now() - t0,
    });
    logbook.log(runId, { kind: "TEST_RESULT", experimentId: null, message: `Beurt ${i + 1} beantwoord (${antwoord.status}, ${antwoord.toolCalls.length} toolaanroep(en)).`, data: { status: antwoord.status, tools: antwoord.toolCalls.map((c) => c.tool).join(",") } });
  }

  const laatsteVoorControle = { text: laatsteAntwoord?.text ?? "", data: laatsteAntwoord?.data ?? null, sources: laatsteAntwoord?.sources ?? [], status: laatsteAntwoord?.status ?? "FOUT" };
  const hiddenInvariantResults = challenge.hiddenInvariants.map((h) => ({ id: h.id, description: h.description, passed: h.check(laatsteVoorControle) }));
  for (const h of hiddenInvariantResults) {
    logbook.log(runId, { kind: h.passed ? "VALIDATOR_RESULT" : "VARIANT_REJECTED", experimentId: null, message: `Verborgen criterium "${h.id}": ${h.passed ? "gehaald" : "NIET gehaald"} — ${h.description}` });
  }

  const finishedAt = new Date().toISOString();
  const resultaat: ChallengeRunResult = {
    challengeId: challenge.id,
    runId,
    startedAt,
    finishedAt,
    turns,
    hiddenInvariantResults,
    allHiddenInvariantsPassed: hiddenInvariantResults.every((h) => h.passed),
  };

  appendExperiment(challengeResultToExperimentRecord(challenge, resultaat));
  return resultaat;
}

function challengeResultToExperimentRecord(challenge: ChallengeDefinition, result: ChallengeRunResult): ExperimentRecord {
  const gefaald = result.hiddenInvariantResults.filter((h) => !h.passed);
  return {
    id: randomUUID(),
    runId: result.runId,
    timestamp: result.finishedAt,
    soort: "CHALLENGE",
    hypothesis: `Challenge ${challenge.id}: ${challenge.name}`,
    reason: challenge.visibleTask,
    configuration: { challengeId: challenge.id, difficulty: challenge.difficulty, track: challenge.track },
    candidateProduced: null,
    validatorResult: null,
    qualityMetrics: null,
    baselineMetrics: null,
    comparisonWithBaseline: null,
    outcome: result.allHiddenInvariantsPassed ? "SUCCESS" : "FAILURE",
    failureReason: gefaald.length > 0 ? gefaald.map((h) => h.description).join("; ") : null,
    nextRecommendation: gefaald.length > 0 ? `Herzie hoe Lyra reageert op "${challenge.name}" — zie de gefaalde verborgen criteria.` : null,
    decision: result.allHiddenInvariantsPassed ? "KEEP_TESTING" : "REJECTED",
  };
}
