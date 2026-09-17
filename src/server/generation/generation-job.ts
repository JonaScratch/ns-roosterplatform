import "server-only";
import os from "node:os";
import type { CandidateAssignment, CandidateRoster, ReviewableRoster } from "@/domain/candidate";
import { candidateRejection } from "@/domain/candidate-acceptance";
import {
  type PipelineKind,
  type RunProgress,
  planProgress,
  resetCandidate,
  skipRemaining,
  withStep,
} from "@/domain/generation-progress";
import { PREFERRED_NIGHT_BLOCK_LENGTH } from "@/domain/roster-quality-config";
import type { PackageQuality } from "@/domain/roster-quality";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { toJson } from "@/server/data/json";
import { BaselineOptimizer } from "@/server/optimizer/baseline-optimizer";
import {
  type CpSatOutcomeExtras,
  CpSatOptimizer,
  SCENARIO_PROFILES,
  type ScenarioProfile,
} from "@/server/optimizer/cpsat-optimizer";
import {
  BALANCED_WEIGHTS,
  type ObjectiveWeights,
  type RebuildGoal,
  weightsForRebuild,
} from "@/server/optimizer/objective-weights";
import type { OptimizerInput } from "@/server/optimizer/contract";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { nextMonday, validateCandidate } from "@/server/rules-engine/final-validator";
import { prismaCandidateData } from "@/server/rules-engine/final-validator-data";
import {
  type QualityContext,
  loadQualityContextCore,
  measureAssignmentsCore,
} from "@/server/services/roster-quality-service";
import {
  buildOptimizerInput,
  inputDataVersion,
  scheduleVersion,
  validationSummaryJson,
} from "@/server/services/simulation-service";

/**
 * De generatieopdracht, van start tot opgeslagen kandidaten.
 *
 * ## Waarom dit buiten het browserverzoek draait
 *
 * Drie kandidaten doorrekenen, verbeteren en onafhankelijk valideren duurt
 * minuten. Hing dat aan één verzoek, dan stopte het bij verversen, bij een
 * slaapstand of bij een netwerkhapering — en was er van vier minuten rekenen
 * niets over. De opdracht staat daarom in de database, dit proces werkt hem af,
 * en het scherm leest de voortgang terug.
 *
 * ## Waarom hier geen toegangscontrole staat
 *
 * Deze code draait zonder verzoek, dus zonder sessie. Wie de opdracht mocht
 * starten, is gecontroleerd op het moment van starten; de actor van dát moment
 * gaat mee voor het auditspoor. Een toegangscheck hierbinnen zou op een
 * ontbrekende cookie stuklopen.
 *
 * ## Wat een kandidaat moet zijn om bewaard te worden
 *
 * Structureel compleet, alle dienstdagen gevuld, profielgrenzen gerespecteerd,
 * onafhankelijk gevalideerd, nul bevestigde harde overtredingen, en
 * aantoonbaar anders dan de kandidaten die er al zijn. Lukt dat maar twee keer,
 * dan zijn het er twee. Een derde rooster "om het aantal vol te maken" komt er
 * niet.
 */

// ── Instellingen ─────────────────────────────────────────────────────────────

/**
 * Rekentijd voor het opbouwen van één kandidaat.
 *
 * Gemeten op Dordrecht (223 diensten, 7 roosters, 8 zoekdraden): na 60 seconden
 * zijn losse nachten weg en ligt de grootste urenafwijking rond de 20 minuten;
 * 75 seconden leverde geen meetbaar beter rooster op, wel drie keer 15 seconden
 * extra wachten.
 */
export const SOLVE_SECONDS = Number(process.env.NS_SOLVER_SECONDS ?? 60);
/** Rekentijd voor één gerichte verbeterpass. */
export const REPAIR_SECONDS = Number(process.env.NS_REPAIR_SECONDS ?? 30);
/**
 * Vanaf deze urenafwijking in één rooster is een verbeterpass zinvol. Daaronder
 * zit het verschil meestal in de structuur zelf (te weinig dienstminuten voor
 * precies 40:00 in elk rooster), en dat lost opnieuw rekenen niet op.
 */
export const REPAIR_HOURS_THRESHOLD_MINUTES = 30;
/** Hooguit zoveel verbeterpasses per kandidaat. */
export const MAX_REPAIR_PASSES = 1;
/** Hooguit zoveel pogingen boven het gevraagde aantal kandidaten. */
export const EXTRA_ATTEMPTS = 2;
/** Kandidaten verschillen op ten minste dit deel van de dienstdagen. */
export const MIN_DIFFERENT_SHARE = 0.1;
/** Zo vaak meldt een lopende opdracht zich. */
const HEARTBEAT_MS = 5_000;

/**
 * Zoekdraden voor de solver.
 *
 * Eén proces tegelijk, met een deel van de processorkernen: een normale laptop
 * blijft bruikbaar, en er draaien nooit drie solvers naast elkaar.
 */
export function solverWorkers(): number {
  return Math.max(1, Math.min(8, os.cpus().length - 1));
}

// ── Lopende opdrachten in dit proces ─────────────────────────────────────────

interface LopendeOpdracht {
  readonly controller: AbortController;
}

const REGISTER_KEY = Symbol.for("ns-roosterplatform.generation-jobs");
const register: Map<string, LopendeOpdracht> =
  ((globalThis as Record<symbol, unknown>)[REGISTER_KEY] as Map<string, LopendeOpdracht>) ??
  ((globalThis as Record<symbol, unknown>)[REGISTER_KEY] = new Map<string, LopendeOpdracht>());

export function isRunningHere(runId: string): boolean {
  return register.has(runId);
}

// ── De opdracht ──────────────────────────────────────────────────────────────

interface LogRegel {
  readonly at: string;
  readonly attempt: number;
  readonly candidate: number | null;
  readonly outcome:
    | "ACCEPTED"
    | "REJECTED_SOLVER"
    | "REJECTED_VALIDATION"
    | "REJECTED_DUPLICATE"
    | "REPAIRED"
    | "REPAIR_NOT_BETTER"
    | "CANCELLED";
  readonly reason: string;
  readonly seconds?: number;
}

interface Meting {
  readonly step: string;
  readonly seconds: number;
}

export async function runGenerationJob(runId: string, actor: Actor): Promise<void> {
  if (register.has(runId)) {
    return;
  }
  const controller = new AbortController();
  register.set(runId, { controller });

  const log: LogRegel[] = [];
  const metingen: Meting[] = [];
  let progress: RunProgress | null = null;

  let run;
  try {
    run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  } catch (fout) {
    register.delete(runId);
    throw fout;
  }

  // Hartslag, en de plek waar een stopverzoek wordt opgepikt.
  const hartslag = setInterval(() => {
    void prisma.generationRun
      .update({
        where: { id: runId },
        data: { heartbeatAt: new Date() },
        select: { cancelRequested: true },
      })
      .then((rij) => {
        if (rij.cancelRequested && !controller.signal.aborted) {
          controller.abort();
        }
      })
      .catch(() => undefined);
  }, HEARTBEAT_MS);

  const baseline = run.strategy === "REPRODUCE" || run.strategy === "BALANCE_SHUNTING";
  const kind: PipelineKind = run.kind === "REBUILD" ? "REBUILD" : baseline ? "BASELINE" : "SOLVER";
  progress = planProgress(kind, run.requestedCandidates);

  const bewaar = async (data: {
    stage?: string;
    stageMessage?: string;
    status?: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
    failureReason?: string | null;
    finishedAt?: Date;
    foundCandidates?: number;
  }) => {
    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        ...data,
        progress: toJson(progress),
        log: toJson({ entries: log, timings: metingen }),
        heartbeatAt: new Date(),
      },
    });
  };

  const stap = async (key: string, bericht: string) => {
    progress = withStep(progress!, key, "active");
    await bewaar({ stage: key, stageMessage: bericht });
  };
  const klaar = async (key: string, state: "done" | "skipped" | "failed" = "done") => {
    progress = withStep(progress!, key, state);
    await bewaar({});
  };
  const gemeten = async <T>(stapNaam: string, werk: () => Promise<T>): Promise<T> => {
    const begin = Date.now();
    try {
      return await werk();
    } finally {
      metingen.push({ step: stapNaam, seconds: Math.round((Date.now() - begin) / 100) / 10 });
    }
  };

  try {
    await prisma.generationRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() },
    });
    await recordAudit({
      actor,
      action: run.kind === "REBUILD" ? "herbouw.gestart" : "generatie.gestart",
      objectType: "GenerationRun",
      objectId: runId,
      result: "SUCCESS",
      reason: `${run.strategyLabel}, roosterjaar ${run.rosterYear}`,
    });

    // ── Invoer ───────────────────────────────────────────────────────────────
    await stap("INPUT", "Het dienstenpakket wordt gecontroleerd.");
    const input = await gemeten("invoer", () => buildOptimizerInput(run.locationCode));
    if (input.duties.length === 0) {
      throw new PipelineStop("Er is geen actief dienstenpakket voor deze standplaats.");
    }
    await klaar("INPUT");

    await stap("STRUCTURE", "De roosterstructuur en de roosterprofielen worden voorbereid.");
    const context = await gemeten("structuur", () => loadQualityContextCore(run.locationCode));
    const validatieContext = {
      sourceScheduleVersion: await scheduleVersion(run.locationCode),
      rulesetVersion: activeRuleset().version,
      inputDataVersion: await inputDataVersion(run.locationCode),
      anchorMonday: nextMonday(),
    };
    await klaar("STRUCTURE");

    const dienstdagen = input.rosterLines.reduce(
      (som, line) => som + line.days.filter((day) => day.positionType === "DUTY").length,
      0,
    );
    const minVerschil = Math.max(1, Math.ceil(dienstdagen * MIN_DIFFERENT_SHARE));

    // ── Herbouw: de ouder en wat de commissie wil ────────────────────────────
    let ouder: { id: string; label: string; assignments: readonly CandidateAssignment[]; quality: PackageQuality } | null =
      null;
    let herbouwGewichten: ObjectiveWeights | null = null;
    if (run.kind === "REBUILD") {
      const rij = await prisma.candidateRoster.findUnique({
        where: { id: run.parentCandidateId ?? "" },
        select: { id: true, scenarioLabel: true, assignments: true, optimizerVersion: true },
      });
      const opdracht = run.adjustmentId
        ? await prisma.rosterCommitteeAdjustment.findUnique({ where: { id: run.adjustmentId } })
        : null;
      if (!rij || !opdracht) {
        throw new PipelineStop("De kandidaat die herbouwd moet worden, bestaat niet meer.");
      }
      const assignments = rij.assignments as unknown as CandidateAssignment[];
      ouder = {
        id: rij.id,
        label: rij.scenarioLabel,
        assignments,
        quality: measureAssignmentsCore(assignments, context),
      };
      const basisSleutel = rij.optimizerVersion.split("+")[1] as ScenarioProfile | undefined;
      const basis = SCENARIO_PROFILES.find((entry) => entry.key === basisSleutel)?.objective ?? BALANCED_WEIGHTS;
      const doelen = [...(opdracht.goals as RebuildGoal[])];
      if (opdracht.preserveGoodParts && !doelen.includes("KEEP_GOOD_PARTS")) {
        doelen.push("KEEP_GOOD_PARTS");
      }
      herbouwGewichten = weightsForRebuild(basis, doelen);
    }

    // ── Kandidaten ───────────────────────────────────────────────────────────
    const geaccepteerd: CandidateRoster[] = [];
    let herbouwUitkomst: string | null = null;
    const maxPogingen = run.requestedCandidates + (baseline ? 0 : EXTRA_ATTEMPTS);
    let poging = 0;

    while (geaccepteerd.length < run.requestedCandidates && poging < maxPogingen) {
      if (controller.signal.aborted) {
        throw new PipelineCancelled();
      }
      poging += 1;
      const k = geaccepteerd.length + 1;
      const naam = run.requestedCandidates > 1 ? `Kandidaat ${k}` : run.kind === "REBUILD" ? "De herbouw" : "Het scenario";
      // Het label hoort bij de vingerafdruk van de kandidaat. Het wordt daarom
      // bij het opbouwen meegegeven en daarna niet meer aangeraakt: een label
      // dat na het verzegelen verandert, maakt de kandidaat "gewijzigd".
      const label =
        run.kind === "REBUILD"
          ? `${ouder!.label} — herbouw`
          : run.requestedCandidates > 1
            ? `${run.strategyLabel} — kandidaat ${k}`
            : run.strategyLabel;
      progress = { ...progress!, currentCandidate: k, attempt: poging };

      // Opbouwen
      await stap(
        `SOLVE_${k}`,
        baseline
          ? "Het huidige rooster wordt als uitgangspunt overgenomen."
          : poging > k
            ? `${naam} wordt opnieuw opgebouwd, met een andere zoekrichting.`
            : `${naam} van ${run.requestedCandidates} wordt opgebouwd over alle basisroosters tegelijk.`,
      );
      const opgebouwd = await gemeten(`opbouwen ${k}.${poging}`, () =>
        bouw({
          run,
          label,
          input,
          context,
          poging,
          baseline,
          geaccepteerd,
          minVerschil,
          ouder,
          herbouwGewichten,
          signal: controller.signal,
        }),
      );
      if (controller.signal.aborted) {
        throw new PipelineCancelled();
      }
      if (opgebouwd.status === "REFUSED") {
        log.push(regel(poging, k, "REJECTED_SOLVER", opgebouwd.reason));
        await klaar(`SOLVE_${k}`, "failed");
        progress = resetCandidate(progress!, k, baseline);
        if (geaccepteerd.length > 0 && opgebouwd.exhausted) {
          break;
        }
        continue;
      }
      let kandidaat = opgebouwd.candidate;
      let extras = opgebouwd.extras;
      await klaar(`SOLVE_${k}`);

      // Analyseren
      await stap(`ANALYSE_${k}`, `Nachtreeksen, overgangen en uren van ${naam.toLowerCase()} worden gemeten.`);
      let kwaliteit = measureAssignmentsCore(kandidaat.assignments, context);
      const bevindingen = verbeterpunten(kwaliteit);
      await klaar(`ANALYSE_${k}`);

      // Gericht verbeteren
      if (!baseline && bevindingen.length > 0 && MAX_REPAIR_PASSES > 0) {
        await stap(
          `REPAIR_${k}`,
          `Verbeterpunten gevonden (${bevindingen.map((b) => b.label).join(", ")}) — ${naam.toLowerCase()} wordt opnieuw geoptimaliseerd.`,
        );
        const verbeterd = await gemeten(`verbeteren ${k}.${poging}`, () =>
          verbeter({
            run,
            label,
            input,
            context,
            kandidaat,
            bevindingen,
            geaccepteerd,
            minVerschil,
            ouder,
            herbouwGewichten,
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) {
          throw new PipelineCancelled();
        }
        if (verbeterd) {
          const nieuweKwaliteit = measureAssignmentsCore(verbeterd.candidate.assignments, context);
          if (probleemScore(nieuweKwaliteit) < probleemScore(kwaliteit)) {
            log.push(
              regel(
                poging,
                k,
                "REPAIRED",
                `${beschrijf(kwaliteit)} → ${beschrijf(nieuweKwaliteit)}`,
              ),
            );
            kandidaat = verbeterd.candidate;
            extras = verbeterd.extras;
            kwaliteit = nieuweKwaliteit;
          } else {
            log.push(regel(poging, k, "REPAIR_NOT_BETTER", `${beschrijf(kwaliteit)}; verbeterpass leverde niets beters`));
          }
        } else {
          log.push(regel(poging, k, "REPAIR_NOT_BETTER", "De verbeterpass vond binnen de rekentijd geen oplossing."));
        }
        await klaar(`REPAIR_${k}`);
      } else if (!baseline) {
        await klaar(`REPAIR_${k}`, "skipped");
      }

      // Onafhankelijk valideren
      await stap(`VALIDATE_${k}`, `${naam} wordt onafhankelijk gevalideerd tegen alle regels.`);
      const review: ReviewableRoster = await gemeten(`valideren ${k}.${poging}`, () =>
        validateCandidate(kandidaat, validatieContext, prismaCandidateData),
      );
      const afwijzing = candidateRejection(review);
      if (afwijzing) {
        log.push(regel(poging, k, "REJECTED_VALIDATION", afwijzing));
        await klaar(`VALIDATE_${k}`, "failed");
        progress = resetCandidate(progress!, k, baseline);
        continue;
      }
      await klaar(`VALIDATE_${k}`);

      // Verschillend genoeg?
      const teGelijk = geaccepteerd.find((ander) => verschil(ander.assignments, kandidaat.assignments) < minVerschil);
      if (teGelijk) {
        log.push(
          regel(poging, k, "REJECTED_DUPLICATE", `Verschilt op minder dan ${minVerschil} dienstdagen van een eerdere kandidaat.`),
        );
        progress = resetCandidate(progress!, k, baseline);
        continue;
      }

      // Opslaan
      await stap(`STORE_${k}`, `${naam} wordt opgeslagen.`);
      const opgeslagen: CandidateRoster = kandidaat;
      await prisma.$transaction(async (tx) => {
        await tx.candidateRoster.create({
          data: {
            id: opgeslagen.id,
            locationCode: run.locationCode,
            scenarioLabel: opgeslagen.scenarioLabel,
            optimizerName: opgeslagen.optimizerName,
            optimizerVersion: opgeslagen.optimizerVersion,
            mode: opgeslagen.mode,
            legalStatus: opgeslagen.legalStatus,
            sourceScheduleVersion: opgeslagen.sourceScheduleVersion,
            rulesetVersion: opgeslagen.rulesetVersion,
            inputDataVersion: opgeslagen.inputDataVersion,
            hash: opgeslagen.hash,
            generatedAt: new Date(opgeslagen.generatedAt),
            generatedByUserId: actor.userId,
            assignments: toJson([...opgeslagen.assignments]),
            scoreBreakdown: toJson({ ...opgeslagen.scoreBreakdown }),
            solverRun: extras ? toJson({ ...extras }) : undefined,
            validationState: review.status,
            validatedAt: new Date(review.validatedAt),
            validationSummary: validationSummaryJson(review),
            generationRunId: runId,
            candidateNumber: k,
            parentCandidateId: ouder?.id ?? null,
            qualityMetrics: toJson({
              ...kwaliteit,
              parent: ouder ? { id: ouder.id, subscores: ouder.quality.subscores } : null,
            }),
          },
        });
        await tx.generationRun.update({
          where: { id: runId },
          data: { foundCandidates: { increment: 1 } },
        });
      });
      geaccepteerd.push(opgeslagen);
      if (ouder) {
        herbouwUitkomst = herbouwVergelijking(ouder.quality, kwaliteit, verschil(ouder.assignments, opgeslagen.assignments));
      }
      progress = { ...progress!, candidatesFound: geaccepteerd.length };
      log.push(regel(poging, k, "ACCEPTED", beschrijf(kwaliteit)));
      await klaar(`STORE_${k}`);
      await recordAudit({
        actor,
        action: "generatie.kandidaat-opgeslagen",
        objectType: "CandidateRoster",
        objectId: opgeslagen.id,
        result: "SUCCESS",
        reason: label,
        newValue: {
          run: runId,
          kandidaat: k,
          bevestigdeOvertredingen: review.tally.confirmedHardViolations,
          status: review.status,
        },
      });
    }

    // ── Afronden ─────────────────────────────────────────────────────────────
    await stap("FINISH", "De resultaten worden afgerond.");
    progress = skipRemaining(withStep(progress!, "FINISH", "done"));
    const gevonden = geaccepteerd.length;
    const status = gevonden === 0 ? "FAILED" : gevonden < run.requestedCandidates ? "PARTIAL" : "COMPLETED";
    const reden =
      status === "COMPLETED"
        ? null
        : gevonden === 0
          ? run.kind === "REBUILD"
            ? "Binnen de beschikbare rekentijd is geen geldige herbouw gevonden die verschilt van de oorspronkelijke kandidaat."
            : "Binnen de beschikbare rekentijd is geen geldige kandidaat gevonden. " + laatsteReden(log)
          : `${gevonden} van ${run.requestedCandidates} geldige kandidaten gevonden. ` +
            `Een ${gevonden === 1 ? "tweede" : "derde"} unieke kandidaat kon binnen de ingestelde rekentijd niet worden gevonden.`;
    await bewaar({
      status,
      stage: "FINISH",
      stageMessage:
        status === "COMPLETED"
          ? herbouwUitkomst
            ? herbouwUitkomst
            : gevonden === 1
            ? "Klaar."
            : `Klaar: ${gevonden} kandidaten gevonden.`
          : reden!,
      failureReason: reden,
      finishedAt: new Date(),
      foundCandidates: gevonden,
    });
    await recordAudit({
      actor,
      action: "generatie.afgerond",
      objectType: "GenerationRun",
      objectId: runId,
      result: status === "FAILED" ? "FAILED" : "SUCCESS",
      reason: reden ?? `${gevonden} kandidaat/kandidaten`,
      newValue: { status, gevonden, pogingen: poging, tijden: metingen },
    });
  } catch (fout) {
    const geannuleerd = fout instanceof PipelineCancelled || controller.signal.aborted;
    const bestaand = await prisma.generationRun.findUnique({ where: { id: runId }, select: { foundCandidates: true } });
    if (progress) {
      progress = skipRemaining(progress);
    }
    if (geannuleerd) {
      log.push(regel(0, null, "CANCELLED", "Op verzoek gestopt."));
    }
    const bericht = geannuleerd
      ? (bestaand?.foundCandidates ?? 0) > 0
        ? `Op verzoek gestopt. ${bestaand!.foundCandidates} volledig gevalideerde kandidaat/kandidaten zijn bewaard.`
        : "Op verzoek gestopt. Er is geen kandidaat bewaard."
      : fout instanceof PipelineStop
        ? fout.message
        : "De generatie is onverwacht gestopt. Er is geen half rooster bewaard.";
    if (!geannuleerd && !(fout instanceof PipelineStop)) {
      console.error("[generatie] onverwachte fout", fout);
    }
    await prisma.generationRun
      .update({
        where: { id: runId },
        data: {
          status: geannuleerd ? "CANCELLED" : "FAILED",
          stageMessage: bericht,
          failureReason: geannuleerd ? null : bericht,
          finishedAt: new Date(),
          progress: progress ? toJson(progress) : undefined,
          log: toJson({ entries: log, timings: metingen }),
        },
      })
      .catch(() => undefined);
    await recordAudit({
      actor,
      action: geannuleerd ? "generatie.gestopt" : "generatie.mislukt",
      objectType: "GenerationRun",
      objectId: runId,
      result: geannuleerd ? "SUCCESS" : "FAILED",
      reason: bericht,
    });
  } finally {
    clearInterval(hartslag);
    register.delete(runId);
  }
}

/**
 * Wat de herbouw opleverde, in één zin.
 *
 * Een herbouw die op geen enkele maat beter scoort, is geen mislukking — de
 * ouder kan al het beste zijn wat binnen de harde regels past — maar dat moet
 * er dan wel staan. Anders lijkt "Klaar." te beloven dat het rooster beter is.
 */
export function herbouwVergelijking(voor: PackageQuality, na: PackageQuality, anders: number): string {
  const beter: string[] = [];
  const slechter: string[] = [];
  for (const sub of na.subscores) {
    const oud = voor.subscores.find((entry) => entry.key === sub.key)?.score;
    if (sub.score === null || oud === null || oud === undefined || sub.key === "changeImpact") {
      continue;
    }
    if (sub.score > oud) beter.push(sub.label.toLowerCase());
    if (sub.score < oud) slechter.push(sub.label.toLowerCase());
  }
  const basis = `Klaar. De herbouw verschilt op ${anders} ${anders === 1 ? "dienstdag" : "dienstdagen"} van het origineel.`;
  if (beter.length === 0 && slechter.length === 0) {
    return `${basis} Op geen enkele maat meetbaar beter of slechter: binnen de harde regels was hier weinig te winnen.`;
  }
  return (
    basis +
    (beter.length > 0 ? ` Beter op: ${beter.join(", ")}.` : " Nergens beter.") +
    (slechter.length > 0 ? ` Minder op: ${slechter.join(", ")}.` : "")
  );
}

class PipelineStop extends Error {}
class PipelineCancelled extends Error {}

function regel(
  attempt: number,
  candidate: number | null,
  outcome: LogRegel["outcome"],
  reason: string,
): LogRegel {
  return { at: new Date().toISOString(), attempt, candidate, outcome, reason };
}

function laatsteReden(log: readonly LogRegel[]): string {
  const laatste = [...log].reverse().find((entry) => entry.outcome.startsWith("REJECTED"));
  return laatste ? laatste.reason : "";
}

// ── Opbouwen en verbeteren ───────────────────────────────────────────────────

type Bouwsel =
  | { readonly status: "OK"; readonly candidate: CandidateRoster; readonly extras: CpSatOutcomeExtras | null }
  | { readonly status: "REFUSED"; readonly reason: string; readonly exhausted: boolean };

async function bouw(input: {
  readonly run: { strategy: string; strategyLabel: string; kind: string };
  readonly label: string;
  readonly input: OptimizerInput;
  readonly context: QualityContext;
  readonly poging: number;
  readonly baseline: boolean;
  readonly geaccepteerd: readonly CandidateRoster[];
  readonly minVerschil: number;
  readonly ouder: { readonly assignments: readonly CandidateAssignment[] } | null;
  readonly herbouwGewichten: ObjectiveWeights | null;
  readonly signal: AbortSignal;
}): Promise<Bouwsel> {
  if (input.baseline) {
    const uit = await new BaselineOptimizer(
      input.run.strategy === "BALANCE_SHUNTING" ? "BALANCE_SHUNTING" : "REPRODUCE",
    ).generate(input.input, input.label);
    return uit.status === "CANDIDATE_GENERATED"
      ? { status: "OK", candidate: uit.candidate, extras: null }
      : { status: "REFUSED", reason: uit.reason, exhausted: true };
  }

  const profiel =
    SCENARIO_PROFILES.find((entry) => entry.key === input.run.strategy) ?? SCENARIO_PROFILES[0];
  const optimizer = new CpSatOptimizer(profiel, SOLVE_SECONDS, {
    workers: solverWorkers(),
    seed: profiel.seed * 100 + input.poging,
    objective: input.herbouwGewichten ?? undefined,
    nightRosterCodes: input.context.nightRosterCodes,
    hint: input.ouder?.assignments ?? input.geaccepteerd.at(-1)?.assignments,
    exclude: [
      ...input.geaccepteerd.map((kandidaat) => kandidaat.assignments),
      ...(input.ouder ? [input.ouder.assignments] : []),
    ],
    // Een herbouw moet ten minste iets veranderen; een nieuwe kandidaat moet
    // aantoonbaar een andere oplossing zijn.
    minDifferentSlots: input.ouder && input.geaccepteerd.length === 0 ? 1 : input.minVerschil,
    // De uitleg over lege dienstdagen is alleen zinvol als er nog niets is
    // uitgesloten; bij een diversiteitseis kost hij een tweede rekenronde.
    explainShortfall: input.geaccepteerd.length === 0 && !input.ouder,
    feedbackPenalties: feedbackStraffen(input.input),
    signal: input.signal,
  });
  const uit = await optimizer.generate(input.input, input.label);
  if (uit.status === "CANDIDATE_GENERATED") {
    return { status: "OK", candidate: uit.candidate, extras: optimizer.lastExtras };
  }
  // Onoplosbaar met de diversiteitseis betekent: er is geen andere kandidaat
  // meer te vinden. Opnieuw proberen met een andere zaadwaarde helpt dan niet.
  const uitgeput = opgebruikt(optimizer.lastExtras?.fullCoverageStatus);
  return { status: "REFUSED", reason: uit.reason, exhausted: uitgeput };
}

function opgebruikt(status: string | undefined): boolean {
  return status === "INFEASIBLE" || status === "MODEL_INVALID";
}

interface Verbeterpunt {
  readonly soort: "NIGHT_CLUSTERING" | "HOURS" | "TRANSITIONS";
  readonly label: string;
}

/**
 * De verbeterpunten die een gerichte tweede pass rechtvaardigen.
 *
 * Een reeks van twee nachten staat er bewust niet in. Hij is minder wenselijk
 * dan drie, maar in de meting op Dordrecht loste een verbeterpass hem nooit op:
 * de nachten in Mix passen dan niet anders binnen de rust- en diversiteitseisen.
 * Losse nachten en zware overgangen zijn wel reden om opnieuw te rekenen.
 */
export function verbeterpunten(kwaliteit: PackageQuality): readonly Verbeterpunt[] {
  const punten: Verbeterpunt[] = [];
  if (kwaliteit.nights.singletons > 0) {
    punten.push({
      soort: "NIGHT_CLUSTERING",
      label: `${kwaliteit.nights.singletons} losse nacht${kwaliteit.nights.singletons === 1 ? "" : "en"}`,
    });
  }
  if (kwaliteit.hours.maxAbsDeviationMinutes > REPAIR_HOURS_THRESHOLD_MINUTES) {
    punten.push({ soort: "HOURS", label: `een rooster ${kwaliteit.hours.maxAbsDeviationMinutes} minuten van 40:00` });
  }
  if (kwaliteit.transitions.heavy > 0) {
    punten.push({
      soort: "TRANSITIONS",
      label: `${kwaliteit.transitions.heavy} zware overgang${kwaliteit.transitions.heavy === 1 ? "" : "en"}`,
    });
  }
  return punten;
}

/** Hoe ernstig de verbeterpunten samen zijn; lager is beter. */
export function probleemScore(kwaliteit: PackageQuality): number {
  return (
    kwaliteit.nights.singletons * 3 +
    kwaliteit.nights.pairs +
    kwaliteit.transitions.heavy * 2 +
    Math.max(0, kwaliteit.hours.maxAbsDeviationMinutes - REPAIR_HOURS_THRESHOLD_MINUTES) / 10
  );
}

function beschrijf(kwaliteit: PackageQuality): string {
  const nachten = kwaliteit.nights;
  return (
    `nachten: ${nachten.threeOrMore} reeks(en) van ${PREFERRED_NIGHT_BLOCK_LENGTH}+, ${nachten.pairs} van twee, ` +
    `${nachten.singletons} los; zware overgangen ${kwaliteit.transitions.heavy}; ` +
    `grootste urenafwijking ${kwaliteit.hours.maxAbsDeviationMinutes} min`
  );
}

async function verbeter(input: {
  readonly run: { strategy: string; strategyLabel: string };
  readonly label: string;
  readonly input: OptimizerInput;
  readonly context: QualityContext;
  readonly kandidaat: CandidateRoster;
  readonly bevindingen: readonly Verbeterpunt[];
  readonly geaccepteerd: readonly CandidateRoster[];
  readonly minVerschil: number;
  readonly ouder: { readonly assignments: readonly CandidateAssignment[] } | null;
  readonly herbouwGewichten: ObjectiveWeights | null;
  readonly signal: AbortSignal;
}): Promise<{ candidate: CandidateRoster; extras: CpSatOutcomeExtras | null } | null> {
  const profiel =
    SCENARIO_PROFILES.find((entry) => entry.key === input.run.strategy) ?? SCENARIO_PROFILES[0];
  const doelen: RebuildGoal[] = ["KEEP_GOOD_PARTS"];
  for (const punt of input.bevindingen) {
    doelen.push(punt.soort === "NIGHT_CLUSTERING" ? "NIGHT_CLUSTERING" : punt.soort === "HOURS" ? "HOURS" : "TRANSITIONS");
  }
  const gewichten = weightsForRebuild(input.herbouwGewichten ?? profiel.objective, doelen);
  const optimizer = new CpSatOptimizer(profiel, REPAIR_SECONDS, {
    workers: solverWorkers(),
    seed: profiel.seed * 1000 + 7,
    objective: gewichten,
    nightRosterCodes: input.context.nightRosterCodes,
    hint: input.kandidaat.assignments,
    // Dezelfde diversiteitseis als bij het opbouwen: een verbeterde kandidaat
    // mag niet stilletjes op een eerdere kandidaat gaan lijken.
    exclude: [
      ...input.geaccepteerd.map((kandidaat) => kandidaat.assignments),
      ...(input.ouder ? [input.ouder.assignments] : []),
    ],
    minDifferentSlots: input.geaccepteerd.length > 0 ? input.minVerschil : input.ouder ? 1 : 0,
    explainShortfall: false,
    feedbackPenalties: feedbackStraffen(input.input),
    signal: input.signal,
  });
  const uit = await optimizer.generate(input.input, input.label);
  return uit.status === "CANDIDATE_GENERATED" ? { candidate: uit.candidate, extras: optimizer.lastExtras } : null;
}

/**
 * Geaggregeerde medewerkersfeedback als kostenpost per rooster.
 *
 * Alleen aandelen per profiel, nooit een individueel antwoord. Hoe groter het
 * aandeel dat "te veel nachtdiensten" aangeeft, hoe zwaarder een nacht in
 * roosters van dat profiel weegt.
 */
function feedbackStraffen(input: OptimizerInput) {
  const soort: Record<string, "NIGHT" | "EARLY" | "SHUNTING" | "WEEKEND"> = {
    NACHTDIENSTEN: "NIGHT",
    VROEGE_DIENSTEN: "EARLY",
    RANGEERDIENSTEN: "SHUNTING",
    WEEKENDBELASTING: "WEEKEND",
  };
  const codesPerProfiel = new Map<string, Set<string>>();
  for (const line of input.rosterLines) {
    const set = codesPerProfiel.get(line.profile) ?? new Set<string>();
    set.add(line.baseRosterCode);
    codesPerProfiel.set(line.profile, set);
  }
  return input.aggregatedFeedback.flatMap((signaal) => {
    const burden = soort[signaal.category];
    if (!burden || signaal.respondents < 3 || signaal.share < 0.2) {
      return [];
    }
    return [...(codesPerProfiel.get(signaal.rosterProfile) ?? [])].map((rosterCode) => ({
      rosterCode,
      burden,
      weight: Math.round(signaal.share * 150),
    }));
  });
}

/** Op hoeveel dienstdagen twee kandidaten een ander dienstnummer hebben. */
export function verschil(a: readonly CandidateAssignment[], b: readonly CandidateAssignment[]): number {
  const sleutel = (entry: CandidateAssignment) =>
    `${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|${entry.weekday}`;
  const van = new Map(a.filter((entry) => entry.positionType === "DUTY").map((entry) => [sleutel(entry), entry.dutyCode]));
  let anders = 0;
  for (const entry of b) {
    if (entry.positionType !== "DUTY") continue;
    if (van.get(sleutel(entry)) !== entry.dutyCode) anders += 1;
  }
  return anders;
}
