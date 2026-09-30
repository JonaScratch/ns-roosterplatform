import "server-only";
import { locationCode as defaultLocationCode } from "../config";
import * as logbook from "../store/logbook";
import { DEFAULT_AUTONOMY_DEPENDENCIES, type WeaknessProbe } from "../autonomy/capabilityTest";
import { flatten, runProofOfValue, type RunProofOfValueOptions } from "../proof/proofOfValue";
import { createVersion } from "../publish/versions";
import { generateCandidateFromWeakness, STRATEGIEEN, type Strategie } from "./generateCandidate";
import type { PromptVariant } from "../variants/promptVariants";
import type { AgentQualityCategory, LyraVersion, ProofOfValueResult } from "../types";
import { bewijsUitProof } from "../factory/judge";
import { maakManifest, type CandidateManifest } from "../factory/manifest";
import { archiveerKeep, beoordeelEnBewaar, bewaarManifest, holdoutTeksten, leesManifest, sandboxVoor, type OpgeslagenOordeel } from "../factory/store";
import { kiesDoel, kiesStrategie, leesLessen, voegLesToe, type Les } from "./lessons";
import { valideerKandidaat } from "./validator";
import { currentVersionId } from "../publish/versions";

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
  /** Uitsluitingen van de lange run bovenop het leergeheugen (zie lessons.ts, RunUitsluitingen). */
  readonly runUitsluitingen?: import("./lessons").RunUitsluitingen;
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
  readonly generateCandidate: (weakness: WeaknessProbe, excludedIds: readonly string[], strategie?: Strategie) => PromptVariant;
  readonly runProofOfValue: (options: RunProofOfValueOptions) => Promise<ProofOfValueResult>;
  readonly createVersion: typeof createVersion;
  /**
   * De adversarial holdout voor productie (basis) en kandidaat, als aandeel
   * GOED in procent. Ontbreekt deze stap, dan zegt de rechter
   * NEEDS_MORE_EVIDENCE: een kandidaat zonder adversarial meting is niet
   * volledig beoordeeld.
   */
  readonly runAdversarial?: (runId: string, candidate: PromptVariant) => Promise<{ readonly basis: number; readonly kandidaat: number }>;
}

export const DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES: DevelopmentCycleDependencies = {
  identifyWeakness: DEFAULT_AUTONOMY_DEPENDENCIES.identifyWeakness,
  generateCandidate: generateCandidateFromWeakness,
  runProofOfValue,
  createVersion,
  runAdversarial: async (runId, candidate) => {
    const { meetAdversarial } = await import("../proof/adversarialStage");
    const { chatModelForVariant } = await import("../variants/promptVariants");
    const basis = await meetAdversarial(runId, undefined, "Adversarial (productie, controle)");
    const kandidaat = await meetAdversarial(runId, chatModelForVariant(candidate), `Adversarial (kandidaat ${candidate.id})`);
    return { basis: basis.pct, kandidaat: kandidaat.pct };
  },
};

/**
 * De stappen van één cyclus, in volgorde, elk met zijn eigen bewijs. Dit is
 * wat `scripts/lyra-master/verify-long-run.ts` na een echte run naloopt: elke
 * stap moet er zijn, en de volgende cyclus moet aantoonbaar van de vorige
 * geleerd hebben.
 */
export const STADIA = ["DIAGNOSE", "HYPOTHESE", "KANDIDAAT", "VALIDATOR", "EXPERIMENT", "BENCHMARK", "HOLDOUT", "ADVERSARIAL", "RECHTER", "BESLUIT", "LEREN"] as const;
export type StadiumNaam = (typeof STADIA)[number];

export interface Stadium {
  readonly naam: StadiumNaam;
  readonly status: "OK" | "MISLUKT" | "OVERGESLAGEN";
  readonly at: string;
  readonly detail: string;
  readonly bewijs?: Readonly<Record<string, unknown>>;
}

export interface DevelopmentCycleResult {
  readonly runId: string;
  readonly weakness: WeaknessProbe;
  /** `null` wanneer de zwakteanalyse niet uitgevoerd kon worden (LOCAL REQUIRED) — er is dan nooit een kandidaat gegenereerd. */
  readonly candidate: PromptVariant | null;
  readonly proof: ProofOfValueResult | null;
  /**
   * `UITGEPUT`: voor geen enkele gemeten dimensie is er nog een strategie die
   * niet al is verworpen — de cyclus stopt eerlijk in plaats van dezelfde
   * tekst nog eens te proberen.
   */
  readonly decision: ProofOfValueResult["decision"] | "NOT_EXECUTED" | "UITGEPUT";
  /** Niet-`null` uitsluitend wanneer `decision === "PROMOTION_CANDIDATE"` — de nieuwe, NIET-actieve versie. */
  readonly version: LyraVersion | null;
  /** Herkomst van de kandidaat (Phase K) — `null` als er geen kandidaat was. */
  readonly manifest?: CandidateManifest | null;
  /** Oordeel van de onafhankelijke rechter (Phase L) — `null` als er geen meting was. */
  readonly judge?: OpgeslagenOordeel | null;
  /** Elke stap met bewijs, in volgorde. */
  readonly stadia?: readonly Stadium[];
  /** De les die deze cyclus naliet voor de volgende. */
  readonly les?: Les | null;
  /** Welke eerdere lessen de keuze van dimensie en strategie bepaalden. */
  readonly geleerdVan?: readonly string[];
  /** Dimensies die de diagnose oversloeg, en waarom — hieruit leidt de lange run "zwakte gewisseld" en "lokaal uitgeput" af. */
  readonly overgeslagen?: readonly { readonly dimensie: string; readonly reden: string }[];
}

export async function runDevelopmentCycle(
  options: DevelopmentCycleOptions = {},
  deps: DevelopmentCycleDependencies = DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES,
): Promise<DevelopmentCycleResult> {
  const runId = options.runId ?? `DR-DEV-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const locationCode = options.locationCode ?? defaultLocationCode();
  const stadia: Stadium[] = [];
  const stadium = (naam: StadiumNaam, status: Stadium["status"], detail: string, bewijs?: Record<string, unknown>) => {
    stadia.push({ naam, status, at: new Date().toISOString(), detail, ...(bewijs ? { bewijs } : {}) });
  };

  logbook.log(runId, {
    kind: "CHALLENGE_OR_GOAL",
    experimentId: null,
    message:
      "Development cycle gestart: diagnose → hypothese → kandidaat → validator → experiment (benchmark + holdout) → adversarial → onafhankelijke rechter → keep/reject → leren.",
  });

  // 1. DIAGNOSE — de echte meting, daarna gewogen met wat eerdere cycli leerden.
  const weakness = await deps.identifyWeakness(runId, locationCode);
  if (!weakness.executed) {
    stadium("DIAGNOSE", "MISLUKT", weakness.notExecutedReason ?? "niet uitgevoerd");
    logbook.log(runId, { kind: "HYPOTHESIS", experimentId: null, message: `Diagnose niet uitgevoerd (${weakness.notExecutedReason}) — geen kandidaat te genereren zonder een echte meting.` });
    return { runId, weakness, candidate: null, proof: null, decision: "NOT_EXECUTED", version: null, stadia, les: null, geleerdVan: [] };
  }
  const lessen = leesLessen();
  const scores = weakness.scores ?? (weakness.weakestDimension ? { [weakness.weakestDimension]: weakness.weakestScore ?? 0 } : {});
  const doel = kiesDoel(scores, lessen, STRATEGIEEN, options.focusDimension, options.runUitsluitingen);
  if (!doel) {
    stadium("DIAGNOSE", "OK", `gemeten zwakste: ${weakness.weakestDimension}; elke gemeten dimensie is uitgeput of wacht op een mens`, { scores });
    logbook.log(runId, { kind: "INFO", experimentId: null, message: "Geen dimensie meer met een ongeprobeerde strategie — de cyclus stopt eerlijk (UITGEPUT)." });
    return { runId, weakness, candidate: null, proof: null, decision: "UITGEPUT", version: null, stadia, les: null, geleerdVan: lessen.map((l) => l.id) };
  }
  const gekozen = doel.waarde as keyof AgentQualityCategory;
  const gerichteZwakte: WeaknessProbe = { ...weakness, weakestDimension: gekozen, weakestScore: gekozen === weakness.weakestDimension ? weakness.weakestScore : (scores[gekozen] ?? null) };
  stadium("DIAGNOSE", "OK", doel.reden, { gemetenZwakste: weakness.weakestDimension, gekozen, scores, lessenGewogen: doel.lesIds.length });
  if (options.focusDimension && gekozen === options.focusDimension && gekozen !== weakness.weakestDimension) {
    logbook.log(runId, {
      kind: "INFO",
      experimentId: null,
      message: `Focus handmatig overschreven naar ${options.focusDimension} (automatisch gediagnosticeerde zwakste dimensie was ${weakness.weakestDimension ?? "onbekend"}).`,
    });
  }
  logbook.log(runId, { kind: "HYPOTHESIS", experimentId: null, message: `Diagnose: ${doel.reden} (echte meting: zwakste ${weakness.weakestDimension} ${weakness.weakestScore?.toFixed(1)}%).` });

  // 2. HYPOTHESE — welke strategie, gegeven wat al verworpen is.
  const strategie = kiesStrategie(gekozen, lessen, STRATEGIEEN, options.runUitsluitingen);
  if (!strategie) {
    stadium("HYPOTHESE", "MISLUKT", `geen strategie meer voor ${gekozen}`);
    return { runId, weakness: gerichteZwakte, candidate: null, proof: null, decision: "UITGEPUT", version: null, stadia, les: null, geleerdVan: doel.lesIds, overgeslagen: doel.overgeslagen ?? [] };
  }
  const geleerdVan = [...new Set([...doel.lesIds, ...strategie.lesIds])];
  stadium("HYPOTHESE", "OK", strategie.reden, { dimensie: gekozen, strategie: strategie.waarde, meerReplicaten: strategie.meerReplicaten, lesIds: strategie.lesIds });

  // 3. KANDIDAAT
  const candidate = deps.generateCandidate(gerichteZwakte, options.excludedCandidateIds ?? [], strategie.waarde as Strategie);
  stadium("KANDIDAAT", "OK", `${candidate.id}: ${candidate.label}`, { candidateId: candidate.id, strategie: strategie.waarde, tekstLengte: candidate.productionText?.length ?? 0 });
  logbook.log(runId, {
    kind: "CANDIDATE_GENERATED",
    experimentId: null,
    message: `Nieuwe kandidaat gegenereerd: ${candidate.id} — ${candidate.description}`,
    data: { variantId: candidate.id, category: candidate.category, strategie: strategie.waarde },
  });

  // Phase K: het manifest legt de herkomst en de hashes van meetlat en
  // holdout vast VÓÓR er gemeten wordt. Een kandidaat-id dat al een manifest
  // heeft (herhaalde run), houdt zijn oorspronkelijke manifest.
  const manifest =
    leesManifest(candidate.id) ??
    (() => {
      const m = maakManifest({
        candidateId: candidate.id,
        parentVersionId: currentVersionId(),
        generator: { name: "generateCandidateFromWeakness", version: "2" },
        hypothesis: candidate.description,
        changeKind: candidate.category,
        productionText: candidate.productionText,
        weaknessDimension: gerichteZwakte.weakestDimension ?? null,
        sandboxRoot: sandboxVoor(candidate.id),
        now: new Date().toISOString(),
      });
      bewaarManifest(m);
      return m;
    })();

  const leer = (verdict: Les["verdict"], beslissing: string, redenen: readonly string[], deltaDoel: number | null, adversarial: Les["adversarial"]): Les => {
    const les = voegLesToe({ runId, dimensie: gekozen, strategie: strategie.waarde, kandidaatId: candidate.id, verdict, beslissing, redenen, deltaDoel, adversarial });
    stadium("LEREN", "OK", `les vastgelegd: ${gekozen}/${strategie.waarde} → ${verdict}`, { lesId: les.id, verdict });
    logbook.log(runId, { kind: "INFO", experimentId: null, message: `Geleerd: ${gekozen} met strategie ${strategie.waarde} → ${verdict}. De volgende cyclus weegt dit mee.`, data: { lesId: les.id } });
    return les;
  };

  // 4. VALIDATOR — statisch, vóór er modeltijd aan besteed wordt.
  const validatie = valideerKandidaat(candidate, holdoutTeksten());
  logbook.log(runId, { kind: "VALIDATOR_RESULT", experimentId: null, message: validatie.ok ? `Validator: ${candidate.id} mag gemeten worden.` : `Validator: ${candidate.id} afgewezen — ${validatie.bevindingen.join("; ")}` });
  if (!validatie.ok) {
    stadium("VALIDATOR", "MISLUKT", validatie.bevindingen.join("; "));
    for (const n of ["EXPERIMENT", "BENCHMARK", "HOLDOUT", "ADVERSARIAL", "RECHTER"] as const) stadium(n, "OVERGESLAGEN", "validator wees de kandidaat af");
    stadium("BESLUIT", "OK", "REJECTED (validator)");
    const les = leer("VALIDATOR_REJECT", "REJECTED", validatie.bevindingen, null, null);
    return { runId, weakness: gerichteZwakte, candidate, proof: null, decision: "REJECTED", version: null, manifest, judge: null, stadia, les, geleerdVan, overgeslagen: doel.overgeslagen ?? [] };
  }
  stadium("VALIDATOR", "OK", "publiceerbaar, begrensd, geen holdoutlek, geen gezagsclaim, geen vastgezet feit");

  // 5–7. EXPERIMENT: benchmark (PRE vs POST×n) en holdout.
  const postRuns = strategie.meerReplicaten ? 3 : 2;
  const proof = await deps.runProofOfValue({ runId, variant: candidate, postRuns, locationCode });
  stadium(proof.executed ? "EXPERIMENT" : "EXPERIMENT", proof.executed ? "OK" : "MISLUKT", proof.executed ? `proof-of-value ${proof.id}: PRE + ${proof.postRuns.length}× POST + holdout` : (proof.notExecutedReason ?? "niet uitgevoerd"), {
    proofId: proof.id,
    postRuns: proof.postRuns.length,
    frozenSetId: proof.frozenSetId,
  });
  const bewijsZonderAdv = proof.executed ? bewijsUitProof(proof, gekozen) : null;
  const deltaDoel = bewijsZonderAdv ? (() => {
    const d = bewijsZonderAdv.dimensies[gekozen];
    return d ? d.kandidaat.reduce((a, b) => a + b, 0) / d.kandidaat.length - d.basis.reduce((a, b) => a + b, 0) / d.basis.length : null;
  })() : null;
  stadium("BENCHMARK", proof.executed ? "OK" : "MISLUKT", proof.executed ? `${gekozen}: Δ ${deltaDoel === null ? "niet gemeten" : `${deltaDoel >= 0 ? "+" : ""}${deltaDoel.toFixed(1)}pp`}; regressies: ${proof.regressions.length}` : "niet gemeten", {
    deltaDoel,
    regressies: proof.regressions,
  });
  stadium("HOLDOUT", bewijsZonderAdv?.holdout ? "OK" : "MISLUKT", bewijsZonderAdv?.holdout ? `holdout ${bewijsZonderAdv.holdout.basis.toFixed(1)} → ${bewijsZonderAdv.holdout.kandidaat.toFixed(1)}` : "niet gemeten", {
    holdout: bewijsZonderAdv?.holdout ?? null,
  });

  // 8. ADVERSARIAL — de locked holdout, alleen aan de meetkant.
  let adversarial: { basis: number; kandidaat: number } | null = null;
  if (proof.executed && deps.runAdversarial) {
    try {
      adversarial = await deps.runAdversarial(runId, candidate);
      stadium("ADVERSARIAL", "OK", `adversarial ${adversarial.basis.toFixed(0)}% → ${adversarial.kandidaat.toFixed(0)}%`, { adversarial });
    } catch (fout) {
      stadium("ADVERSARIAL", "MISLUKT", fout instanceof Error ? fout.message : String(fout));
      logbook.log(runId, { kind: "ERROR", experimentId: null, message: `Adversarial meting mislukt: ${fout instanceof Error ? fout.message : String(fout)}` });
    }
  } else {
    stadium("ADVERSARIAL", "OVERGESLAGEN", proof.executed ? "geen adversarial stap beschikbaar" : "experiment niet uitgevoerd");
  }

  // 9. RECHTER — kan een positieve proof tegenhouden, nooit er een afdwingen.
  const judge = proof.executed ? beoordeelEnBewaar(candidate.id, candidate.productionText, bewijsUitProof(proof, gekozen, adversarial), new Date().toISOString()) : null;
  if (judge) {
    stadium("RECHTER", "OK", `${judge.criteriaVersie}: ${judge.verdict} — ${judge.redenen.join("; ")}`, { verdict: judge.verdict, criteriaVersie: judge.criteriaVersie });
    logbook.log(runId, {
      kind: "INFO",
      experimentId: proof.id,
      message: `Rechter (${judge.criteriaVersie}) over ${candidate.id}: ${judge.verdict} — ${judge.redenen.join("; ")}`,
      data: { verdict: judge.verdict },
    });
    archiveerKeep(
      { id: candidate.id, label: candidate.label, metrics: Object.fromEntries(Object.entries(judge.deltas).filter(([, v]) => Number.isFinite(v))) },
      judge,
      Object.fromEntries(Object.keys(judge.deltas).map((k) => [k, true])),
      new Date().toISOString(),
    );
  } else {
    stadium("RECHTER", "OVERGESLAGEN", "geen meting om te beoordelen");
  }
  const rechterVeto = judge?.verdict === "REJECT";

  // 10. BESLUIT — keep (niet-actieve versie) of reject. Nooit activeren.
  let version: LyraVersion | null = null;
  if (proof.decision === "PROMOTION_CANDIDATE" && !rechterVeto) {
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
      message: rechterVeto && proof.decision === "PROMOTION_CANDIDATE"
        ? `Kandidaat ${candidate.id} niet gepromoveerd: proof-of-value was positief, maar de rechter verwierp hem (${judge?.redenen.join("; ")}).`
        : `Kandidaat ${candidate.id} niet gepromoveerd (${proof.decision}): ${proof.reasoning}`,
    });
  }
  const decision = rechterVeto && proof.decision === "PROMOTION_CANDIDATE" ? "REJECTED" : proof.decision;
  stadium("BESLUIT", "OK", version ? `${decision}: niet-actieve versie ${version.id}` : `${decision}`, { decision, versionId: version?.id ?? null });

  // 11. LEREN — de les voor de volgende cyclus. Zonder meting geen les: dan
  // is er niets geleerd over de strategie, alleen over de omgeving.
  const les = judge ? leer(judge.verdict, decision, judge.redenen, deltaDoel, adversarial) : null;
  if (!les) stadium("LEREN", "OVERGESLAGEN", "geen oordeel, dus geen les over deze strategie");

  return { runId, weakness: gerichteZwakte, candidate, proof, decision, version, manifest, judge, stadia, les, geleerdVan, overgeslagen: doel.overgeslagen ?? [] };
}
