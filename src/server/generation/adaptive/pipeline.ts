import "server-only";
import type { CandidateAssignment } from "@/domain/candidate";
import { type RunProgress, planProgress, skipRemaining, withStep } from "@/domain/generation-progress";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { toJson } from "@/server/data/json";
import { SCENARIO_PROFILES, type ScenarioProfile } from "@/server/optimizer/cpsat-optimizer";
import { BALANCED_WEIGHTS, type RebuildGoal, weightsForRebuild } from "@/server/optimizer/objective-weights";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { nextMonday } from "@/server/rules-engine/final-validator";
import { measureAssignmentsCore } from "@/server/services/roster-quality-service";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import {
  buildOptimizerInput,
  inputDataVersion,
  scheduleVersion,
  validationSummaryJson,
} from "@/server/services/simulation-service";
import { ADAPTIVE_CONFIG, ADAPTIVE_ENGINE_VERSION, type SearchMode, isSearchMode } from "./config";
import { type AblationFlag, type SearchPhase, runAdaptiveSearch } from "./engine";

/**
 * De generatieopdracht met de adaptieve engine.
 *
 * Dezelfde opdracht, dezelfde hartslag, hetzelfde stoppen en dezelfde opslag
 * als de v1.0.3-engine; alleen het zoeken zelf is anders. De hartslag en het
 * stopverzoek worden door `runGenerationJob` geregeld en komen hier binnen als
 * `signal`.
 *
 * ## Wat wordt bewaard
 *
 * Alleen de uiteindelijke topkandidaten, in één transactie. Tussentijdse
 * kandidaten staan in het zoekjournaal van de opdracht, niet tussen de
 * resultaten. Stopt het platform halverwege, dan is er geen halve kandidaat
 * als gereed opgeslagen: de opdracht wordt onderbroken gemarkeerd, zoals elke
 * opdracht zonder hartslag.
 */

export const ADAPTIVE_STEP_PHASES: Readonly<Record<SearchPhase, string>> = {
  SEARCH: "SEARCH",
  REPAIR: "REPAIR",
  DIVERSIFY: "DIVERSIFY",
  VALIDATE: "VALIDATE_FINAL",
};

export interface AdaptiveRun {
  readonly id: string;
  readonly locationCode: string;
  readonly strategy: string;
  readonly strategyLabel: string;
  readonly kind: string;
  readonly requestedCandidates: number;
  readonly parentCandidateId: string | null;
  readonly adjustmentId: string | null;
  readonly searchMode: string | null;
  readonly ablation: string | null;
}

export async function runAdaptivePipeline(input: {
  readonly run: AdaptiveRun;
  readonly actor: Actor;
  readonly signal: AbortSignal;
  readonly workers: number;
  readonly feedbackPenalties: Parameters<typeof runAdaptiveSearch>[0]["feedbackPenalties"];
}): Promise<void> {
  const { run, actor } = input;
  const mode: SearchMode = isSearchMode(run.searchMode) ? run.searchMode : "NORMAL";
  let progress: RunProgress = planProgress("ADAPTIVE", run.requestedCandidates);

  const bewaar = async (data: Record<string, unknown>) => {
    await prisma.generationRun.update({
      where: { id: run.id },
      data: { ...data, progress: toJson(progress), heartbeatAt: new Date() },
    });
  };
  const stap = async (key: string, bericht: string) => {
    progress = withStep(progress, key, "active");
    await bewaar({ stage: key, stageMessage: bericht });
  };
  const klaar = async (key: string, state: "done" | "skipped" | "failed" = "done") => {
    progress = withStep(progress, key, state);
    await bewaar({});
  };

  await stap("INPUT", "Het dienstenpakket wordt gecontroleerd.");
  const optimizerInput = await buildOptimizerInput(run.locationCode);
  if (optimizerInput.duties.length === 0) {
    throw new Error("Er is geen actief dienstenpakket voor deze standplaats.");
  }
  await klaar("INPUT");

  await stap("STRUCTURE", "De roosterstructuur, de profielen en het kwaliteitsmodel worden voorbereid.");
  const evaluation = await loadEvaluationContextCore(run.locationCode);
  const validation = {
    sourceScheduleVersion: await scheduleVersion(run.locationCode),
    rulesetVersion: activeRuleset().version,
    inputDataVersion: await inputDataVersion(run.locationCode),
    anchorMonday: nextMonday(),
  };
  const profiel = SCENARIO_PROFILES.find((entry) => entry.key === run.strategy) ?? SCENARIO_PROFILES[0];
  let parent: { id: string; assignments: readonly CandidateAssignment[] } | null = null;
  let baseWeights = profiel.objective;
  if (run.kind === "REBUILD") {
    const rij = await prisma.candidateRoster.findUnique({
      where: { id: run.parentCandidateId ?? "" },
      select: { id: true, assignments: true, optimizerVersion: true },
    });
    const opdracht = run.adjustmentId ? await prisma.rosterCommitteeAdjustment.findUnique({ where: { id: run.adjustmentId } }) : null;
    if (!rij || !opdracht) {
      throw new Error("De kandidaat die herbouwd moet worden, bestaat niet meer.");
    }
    parent = { id: rij.id, assignments: rij.assignments as unknown as CandidateAssignment[] };
    const sleutel = rij.optimizerVersion.split("+")[1] as ScenarioProfile | undefined;
    const basis = SCENARIO_PROFILES.find((entry) => entry.key === sleutel)?.objective ?? BALANCED_WEIGHTS;
    const doelen = [...(opdracht.goals as RebuildGoal[])];
    if (opdracht.preserveGoodParts && !doelen.includes("KEEP_GOOD_PARTS")) doelen.push("KEEP_GOOD_PARTS");
    baseWeights = weightsForRebuild(basis, doelen);
  }
  await klaar("STRUCTURE");

  let laatsteFase: SearchPhase | null = null;
  const faseStap = (fase: SearchPhase) => ADAPTIVE_STEP_PHASES[fase];
  await stap("SEARCH", `Kandidaten zoeken (modus ${ADAPTIVE_CONFIG.modes[mode].label}, budget ${ADAPTIVE_CONFIG.modes[mode].budgetSeconds} s).`);

  const resultaat = await runAdaptiveSearch({
    optimizerInput,
    evaluation,
    validation,
    strategy: run.strategy,
    strategyLabel: run.strategyLabel,
    mode,
    baseWeights,
    workers: input.workers,
    baseSeed: profiel.seed,
    feedbackPenalties: input.feedbackPenalties,
    parent,
    requested: run.requestedCandidates,
    signal: input.signal,
    ablation: (run.ablation as AblationFlag | null) ?? null,
    onProgress: async (update) => {
      if (update.phase !== laatsteFase) {
        const volgorde: SearchPhase[] = ["SEARCH", "REPAIR", "DIVERSIFY", "VALIDATE"];
        for (const eerder of volgorde.slice(0, volgorde.indexOf(update.phase))) {
          const key = faseStap(eerder);
          const huidig = progress.steps.find((s) => s.key === key)?.state;
          if (huidig === "active") progress = withStep(progress, key, "done");
          if (huidig === "pending") progress = withStep(progress, key, "skipped");
        }
        progress = withStep(progress, faseStap(update.phase), "active");
        laatsteFase = update.phase;
      }
      await bewaar({
        stage: faseStap(update.phase),
        stageMessage: update.message,
        searchCounters: toJson(update.counters),
        searchJournal: toJson({ entries: update.journal }),
      });
    },
  });
  progress = withStep(progress, "VALIDATE_FINAL", "done");

  // ── Opslaan ───────────────────────────────────────────────────────────────
  await stap("STORE", `${resultaat.final.length} topkandidaat/kandidaten worden opgeslagen.`);
  await prisma.$transaction(async (tx) => {
    for (const [index, gekozen] of resultaat.final.entries()) {
      const kandidaat = gekozen.candidate;
      await tx.candidateRoster.create({
        data: {
          id: kandidaat.id,
          locationCode: run.locationCode,
          scenarioLabel: kandidaat.scenarioLabel,
          optimizerName: kandidaat.optimizerName,
          optimizerVersion: kandidaat.optimizerVersion,
          mode: kandidaat.mode,
          legalStatus: kandidaat.legalStatus,
          sourceScheduleVersion: kandidaat.sourceScheduleVersion,
          rulesetVersion: kandidaat.rulesetVersion,
          inputDataVersion: kandidaat.inputDataVersion,
          hash: kandidaat.hash,
          generatedAt: new Date(kandidaat.generatedAt),
          generatedByUserId: actor.userId,
          assignments: toJson([...kandidaat.assignments]),
          scoreBreakdown: toJson({ ...kandidaat.scoreBreakdown }),
          solverRun: gekozen.extras ? toJson({ ...gekozen.extras }) : undefined,
          validationState: gekozen.review.status,
          validatedAt: new Date(gekozen.review.validatedAt),
          validationSummary: validationSummaryJson(gekozen.review),
          generationRunId: run.id,
          candidateNumber: index + 1,
          parentCandidateId: parent?.id ?? null,
          qualityMetrics: toJson({ ...measureAssignmentsCore(kandidaat.assignments, evaluation.quality), human: gekozen.report }),
          qualityModelVersion: gekozen.provenance.qualityModelVersion as string,
          optimizerModelVersion: gekozen.provenance.optimizerModelVersion as string,
          provenance: toJson(gekozen.provenance),
        },
      });
    }
    await tx.generationRun.update({ where: { id: run.id }, data: { foundCandidates: resultaat.final.length } });
  });
  await klaar("STORE");

  for (const gekozen of resultaat.final) {
    await recordAudit({
      actor,
      action: "generatie.kandidaat-opgeslagen",
      objectType: "CandidateRoster",
      objectId: gekozen.candidate.id,
      result: "SUCCESS",
      reason: gekozen.candidate.scenarioLabel,
      newValue: {
        run: run.id,
        engine: ADAPTIVE_ENGINE_VERSION,
        poging: gekozen.provenance.attempt,
        robuust: gekozen.report.robust,
        status: gekozen.review.status,
      },
    });
  }

  // ── Afronden ──────────────────────────────────────────────────────────────
  progress = skipRemaining(withStep(progress, "FINISH", "done"));
  const gevonden = resultaat.final.length;
  const c = resultaat.counters;
  const telling = `${c.attempts} varianten onderzocht, ${c.validCandidates} geldige kandidaten, ${gevonden} topkandidaat/kandidaten`;
  const status = resultaat.cancelled ? "CANCELLED" : gevonden === 0 ? "FAILED" : gevonden < run.requestedCandidates ? "PARTIAL" : "COMPLETED";
  const reden =
    status === "COMPLETED"
      ? null
      : status === "CANCELLED"
        ? `Op verzoek gestopt. ${gevonden > 0 ? `${gevonden} volledig gevalideerde topkandidaat/kandidaten tot nu toe bewaard.` : "Er is geen kandidaat bewaard."}`
        : gevonden === 0
          ? `Binnen het tijdsbudget is geen kandidaat gevonden die hard geldig is én de kwaliteitspoort haalt (${telling}).`
          : `${gevonden} van ${run.requestedCandidates} kandidaten gevonden die geldig zijn, de kwaliteitspoort halen en genoeg van elkaar verschillen (${telling}).`;
  await bewaar({
    status,
    stage: "FINISH",
    stageMessage: reden ?? `Klaar: ${telling}. Gestopt omdat: ${resultaat.stopReason}.`,
    failureReason: status === "CANCELLED" ? null : reden,
    finishedAt: new Date(),
    foundCandidates: gevonden,
    searchCounters: toJson({ ...c, stopReason: resultaat.stopReason, gate: resultaat.gate }),
    searchJournal: toJson({ entries: resultaat.journal, stopReason: resultaat.stopReason, gate: resultaat.gate }),
    log: toJson({ entries: [], timings: [{ step: "zoeken", seconds: c.elapsedSeconds }] }),
  });
  await recordAudit({
    actor,
    action: "generatie.afgerond",
    objectType: "GenerationRun",
    objectId: run.id,
    result: status === "FAILED" ? "FAILED" : "SUCCESS",
    reason: reden ?? telling,
    newValue: { status, gevonden, engine: ADAPTIVE_ENGINE_VERSION, modus: mode, tellers: c },
  });
}
