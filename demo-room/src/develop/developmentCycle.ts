import "server-only";
import { locationCode as defaultLocationCode } from "../config";
import * as logbook from "../store/logbook";
import { DEFAULT_AUTONOMY_DEPENDENCIES, type WeaknessProbe } from "../autonomy/capabilityTest";
import { flatten, runProofOfValue, type RunProofOfValueOptions } from "../proof/proofOfValue";
import { createVersion } from "../publish/versions";
import { generateCandidateFromWeakness } from "./generateCandidate";
import type { PromptVariant } from "../variants/promptVariants";
import type { AgentQualityCategory, LyraVersion, ProofOfValueResult } from "../types";

/**
 * De volledige, bewijsbare ontwikkelcyclus van de Development Sandbox
 * (§ SCOPE CORRECTION AANVULLING — "minimaal één volledige end-to-end
 * development cycle"):
 *
 *   baseline candidate → diagnose → agent maakt experimentele wijziging →
 *   nieuwe candidate → benchmark/validator → objectieve vergelijking →
 *   keep/reject → versie/history correct opgeslagen
 *
 * Elke stap hergebruikt bestaande, al geteste bouwstenen — dit bestand voegt
 * uitsluitend de ONTBREKENDE schakels toe (kandidaat-generatie, en de
 * koppeling van een geaccepteerde kandidaat naar `createVersion()`):
 *
 * 1. **diagnose**: `identifyWeakness()` (hergebruikt uit
 *    `autonomy/capabilityTest.ts` — dezelfde echte PRE-meting, geen tweede
 *    meetroute).
 * 2. **agent maakt experimentele wijziging**: `generateCandidateFromWeakness()`
 *    (nieuw, `develop/generateCandidate.ts`) — construeert een NIEUWE
 *    `PromptVariant`, nooit een keuze uit een vaste lijst.
 * 3. **benchmark/validator + objectieve vergelijking**: `runProofOfValue()`
 *    (ongewijzigde PRE→POST(≥2)→holdout→regressiepijplijn), nu met
 *    `options.variant` in plaats van `options.variantId` zodat een
 *    gegenereerde, niet-geregistreerde kandidaat er ook doorheen kan.
 * 4. **keep/reject**: `proof.decision` (`beoordeelProofOfValue()`,
 *    ongewijzigd).
 * 5. **versie/history correct opgeslagen**: bij `PROMOTION_CANDIDATE`, ÉÉN
 *    nieuwe aanroep naar `createVersion()` (nieuw hier) — legt de kandidaat
 *    onveranderlijk vast als een NIET-actieve versie. `activateVersion()`
 *    wordt hier nergens aangeroepen: dat blijft een aparte, mensgekeurde stap
 *    (`publish/safePublish.ts`), dus de actieve productieversie blijft
 *    onaangeraakt, ongeacht de uitkomst van deze cyclus.
 */

export interface DevelopmentCycleOptions {
  readonly runId?: string;
  readonly locationCode?: string;
  /** Kandidaat-id's die deze cyclus niet opnieuw mag genereren (bv. al geprobeerd in een vorige cyclus van dezelfde run). */
  readonly excludedCandidateIds?: readonly string[];
  /**
   * Overschrijft de automatisch gediagnosticeerde zwakste dimensie met een
   * door de gebruiker gekozen focus (§ Development Runs, "Doel"). De echte
   * diagnose wordt nog steeds uitgevoerd en gelogd (nooit verborgen) — alleen
   * welke dimensie de kandidaatgenerator target, wordt hiermee bepaald.
   */
  readonly focusDimension?: keyof AgentQualityCategory;
}

/** Injecteerbaar voor tests — zelfde patroon als `AutonomyTestDependencies`/`PublishSteps`. */
export interface DevelopmentCycleDependencies {
  readonly identifyWeakness: (runId: string, locationCode: string) => Promise<WeaknessProbe>;
  readonly generateCandidate: (weakness: WeaknessProbe, excludedIds: readonly string[]) => PromptVariant;
  readonly runProofOfValue: (options: RunProofOfValueOptions) => Promise<ProofOfValueResult>;
  readonly createVersion: typeof createVersion;
}

export const DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES: DevelopmentCycleDependencies = {
  identifyWeakness: DEFAULT_AUTONOMY_DEPENDENCIES.identifyWeakness,
  generateCandidate: generateCandidateFromWeakness,
  runProofOfValue,
  createVersion,
};

export interface DevelopmentCycleResult {
  readonly runId: string;
  readonly weakness: WeaknessProbe;
  /** `null` wanneer de zwakteanalyse niet uitgevoerd kon worden (LOCAL REQUIRED) — er is dan nooit een kandidaat gegenereerd. */
  readonly candidate: PromptVariant | null;
  readonly proof: ProofOfValueResult | null;
  readonly decision: ProofOfValueResult["decision"] | "NOT_EXECUTED";
  /** Niet-`null` uitsluitend wanneer `decision === "PROMOTION_CANDIDATE"` — de nieuwe, NIET-actieve versie. */
  readonly version: LyraVersion | null;
}

export async function runDevelopmentCycle(
  options: DevelopmentCycleOptions = {},
  deps: DevelopmentCycleDependencies = DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES,
): Promise<DevelopmentCycleResult> {
  const runId = options.runId ?? `DR-DEV-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const locationCode = options.locationCode ?? defaultLocationCode();

  logbook.log(runId, {
    kind: "CHALLENGE_OR_GOAL",
    experimentId: null,
    message: "Development cycle gestart: baseline → diagnose → agent genereert kandidaat → benchmark/validator → keep/reject → versie opslaan.",
  });

  const weakness = await deps.identifyWeakness(runId, locationCode);
  logbook.log(runId, {
    kind: "HYPOTHESIS",
    experimentId: null,
    message: weakness.executed
      ? `Zwakte gediagnosticeerd: ${weakness.weakestDimension} (${weakness.weakestScore?.toFixed(1)}%).`
      : `Diagnose niet uitgevoerd (${weakness.notExecutedReason}) — geen kandidaat te genereren zonder een echte meting.`,
  });

  if (!weakness.executed) {
    return { runId, weakness, candidate: null, proof: null, decision: "NOT_EXECUTED", version: null };
  }

  // Handmatige focus (§ Development Runs "Doel") overschrijft welke dimensie de
  // kandidaatgenerator target — de echte diagnose hierboven is al gelogd en
  // wordt nooit verborgen, dit bepaalt alleen de vervolgstap.
  const gerichteZwakte =
    options.focusDimension && options.focusDimension !== weakness.weakestDimension
      ? { ...weakness, weakestDimension: options.focusDimension, weakestScore: null }
      : weakness;
  if (options.focusDimension && options.focusDimension !== weakness.weakestDimension) {
    logbook.log(runId, {
      kind: "INFO",
      experimentId: null,
      message: `Focus handmatig overschreven naar ${options.focusDimension} (automatisch gediagnosticeerde zwakste dimensie was ${weakness.weakestDimension ?? "onbekend"}).`,
    });
  }

  const candidate = deps.generateCandidate(gerichteZwakte, options.excludedCandidateIds ?? []);
  logbook.log(runId, {
    kind: "CANDIDATE_GENERATED",
    experimentId: null,
    message: `Nieuwe kandidaat gegenereerd: ${candidate.id} — ${candidate.description}`,
    data: { variantId: candidate.id, category: candidate.category },
  });

  const proof = await deps.runProofOfValue({ runId, variant: candidate, postRuns: 2, locationCode });

  let version: LyraVersion | null = null;
  if (proof.decision === "PROMOTION_CANDIDATE") {
    version = deps.createVersion({
      sourceExperimentId: proof.id,
      variantId: candidate.id,
      promptOverrideText: candidate.productionText,
      benchmarkReference: { pre: flatten(proof.pre.agent), post: flatten(proof.post.agent), holdout: flatten(proof.holdout.agent) },
      changedFiles: [],
      knownIssues: proof.knownWeaknesses,
      reasonForPromotion: proof.reasoning,
    });
    logbook.log(runId, {
      kind: "INFO",
      experimentId: proof.id,
      message: `Kandidaat ${candidate.id} opgeslagen als nieuwe, NIET-actieve versie ${version.id} (status ${version.status}). Activatie vereist een aparte, mensgekeurde publish-stap.`,
      data: { versionId: version.id },
    });
  } else {
    logbook.log(runId, {
      kind: "VARIANT_REJECTED",
      experimentId: proof.id,
      message: `Kandidaat ${candidate.id} niet gepromoveerd (${proof.decision}): ${proof.reasoning}`,
    });
  }

  return { runId, weakness: gerichteZwakte, candidate, proof, decision: proof.decision, version };
}
