import "server-only";
import { locationCode as defaultLocationCode } from "../config";
import * as logbook from "../store/logbook";
import { currentVersionId } from "../publish/versions";
import { writeDevelopmentRunResult } from "../store/developmentRuns";
import { DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES, runDevelopmentCycle, type DevelopmentCycleDependencies, type DevelopmentCycleResult } from "./developmentCycle";

/**
 * De tijdgebonden autonome ontwikkelrun (§ SCOPE CORRECTION —
 * "Develop Lyra for: 1 hour / 6 hours / 24 hours / unlimited/manual stop").
 *
 * Herhaalt `runDevelopmentCycle()` (diagnose → genereer kandidaat →
 * benchmark/validator → keep/reject → versie opslaan) totdat één van drie
 * dingen gebeurt:
 *
 * 1. het wandklokbudget (`maxMinutes`) is op;
 * 2. er is geen echte diagnose mogelijk (LOCAL REQUIRED) — de run stopt
 *    eerlijk in plaats van te gokken;
 * 3. **geen voortgang**: dezelfde gemeten zwakste dimensie wordt
 *    `maxAttemptsPerDimensionWithoutPromotion` keer ACHTEREEN verworpen
 *    zonder promotie. Zonder deze grens zou de lus voor altijd dezelfde
 *    zwakte blijven aanvallen (`identifyWeakness()` meet altijd tegen
 *    PRODUCTIE, dus een niet-gepromoveerde kandidaat verandert niets aan de
 *    volgende diagnose) — een vroege, herkenbare vorm van overfitting op één
 *    dimensie in plaats van brede verbetering. Een promotie op een dimensie
 *    reset zijn eigen teller.
 *
 * Activeert NOOIT een versie — `endVersionId` hoort na elke run gelijk te
 * zijn aan `startVersionId`, ongeacht hoeveel kandidaten geaccepteerd zijn
 * (zie `developmentCycle.ts`: `activateVersion()` wordt hier nergens
 * aangeroepen). Dat is een expliciet geteste invariant, geen aanname.
 */

export interface AutonomousDevelopmentRunOptions {
  readonly runId?: string;
  /** Verplicht — een open-eindige lus mag nooit een verborgen standaardbudget hebben. */
  readonly maxMinutes: number;
  readonly locationCode?: string;
  /** Hoeveel keer dezelfde zwakste dimensie zonder promotie verworpen mag worden vóór de run stopt. Standaard 2. */
  readonly maxAttemptsPerDimensionWithoutPromotion?: number;
  /** Doorgegeven aan elke cyclus — zie `DevelopmentCycleOptions.focusDimension` (§ Development Runs "Doel"). */
  readonly focusDimension?: keyof import("../types").AgentQualityCategory;
}

export type AutonomousDevelopmentRunStopReason =
  | "MAX_MINUTES_REACHED"
  | "MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE"
  | "NO_PROGRESS_ON_SAME_WEAKNESS"
  | "NOT_EXECUTED";

export interface TimelineEntry {
  readonly at: string;
  readonly event: string;
}

export interface AutonomousDevelopmentRunResult {
  readonly runId: string;
  readonly startedAt: string;
  /** Tijdstip van de laatst bekende toestand — bij `inProgress: true` is dit "laatst bijgewerkt", geen echt eindtijdstip. */
  readonly finishedAt: string;
  /** De actieve productieversie bij start van de run. */
  readonly startVersionId: string;
  /** De actieve productieversie bij (tot dusver) laatst bekende toestand — hoort ALTIJD gelijk te zijn aan `startVersionId` (nooit autonome activatie). */
  readonly endVersionId: string;
  readonly cycles: readonly DevelopmentCycleResult[];
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  /** De versie-ID van de laatst geaccepteerde kandidaat, indien die er is — niet automatisch "de beste", alleen "de meest recente promotie". */
  readonly bestCandidateVersionId: string | null;
  /** `null` zolang de run nog loopt (`inProgress: true`) — pas bekend zodra de run echt stopt. */
  readonly stopReason: AutonomousDevelopmentRunStopReason | null;
  readonly timeline: readonly TimelineEntry[];
  /** `true` = een tussentijdse momentopname van een nog lopende run (§ Development Runs, live voortgang); `false` = de definitieve, afgeronde uitkomst. */
  readonly inProgress: boolean;
}

export async function runAutonomousDevelopmentRun(
  options: AutonomousDevelopmentRunOptions,
  deps: DevelopmentCycleDependencies = DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES,
): Promise<AutonomousDevelopmentRunResult> {
  if (!Number.isFinite(options.maxMinutes) || options.maxMinutes < 0) {
    throw new Error("runAutonomousDevelopmentRun: maxMinutes moet een niet-negatief getal zijn — geen verborgen default voor een open-eindige lus. (0 is geldig: budget al op, 0 cycli.)");
  }
  const runId = options.runId ?? `DR-AUTODEV-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const locationCode = options.locationCode ?? defaultLocationCode();
  const maxAttempts = options.maxAttemptsPerDimensionWithoutPromotion ?? 2;
  const startedAt = new Date().toISOString();
  const begin = Date.now();
  const startVersionId = currentVersionId();

  logbook.log(runId, {
    kind: "CHALLENGE_OR_GOAL",
    experimentId: null,
    message: `Autonome ontwikkelrun gestart (budget ${options.maxMinutes} minuten, actieve versie bij start: ${startVersionId}).`,
    data: { maxMinutes: options.maxMinutes, startVersionId },
  });

  const cycles: DevelopmentCycleResult[] = [];
  const timeline: TimelineEntry[] = [`Run gestart. Actieve versie bij start: ${startVersionId}.`].map((event) => ({ at: startedAt, event }));
  const attemptsPerDimension = new Map<string, number>();
  const excludedCandidateIds: string[] = [];
  let bestCandidateVersionId: string | null = null;
  let stopReason: AutonomousDevelopmentRunStopReason = "MAX_MINUTES_REACHED";

  // Bouwt de huidige (tussentijdse of definitieve) momentopname en slaat hem
  // meteen op — zonder dit zou de Development Runs-pagina pas na afloop van
  // de HELE run (mogelijk uren) ook maar iets kunnen tonen. `writeDevelopmentRunResult()`
  // overschrijft eerder bestand voor dezelfde `runId` telkens opnieuw (bestandsnaam = runId).
  function slaLopendeVoortgangOp(): void {
    writeDevelopmentRunResult({
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      startVersionId,
      endVersionId: currentVersionId(),
      cycles,
      acceptedCount: cycles.filter((c) => c.decision === "PROMOTION_CANDIDATE").length,
      rejectedCount: cycles.filter((c) => c.decision === "REJECTED" || c.decision === "KEEP_TESTING").length,
      bestCandidateVersionId,
      stopReason: null,
      timeline,
      inProgress: true,
    });
  }

  let iteratie = 0;
  for (;;) {
    const verstrekenMinuten = (Date.now() - begin) / 60000;
    if (verstrekenMinuten >= options.maxMinutes) {
      stopReason = iteratie === 0 ? "MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE" : "MAX_MINUTES_REACHED";
      logbook.log(runId, { kind: "BUDGET_REACHED", experimentId: null, message: `Wandklokbudget (${options.maxMinutes} min) bereikt vóór cyclus ${iteratie + 1}.` });
      break;
    }
    iteratie += 1;

    const cycle = await runDevelopmentCycle({ runId, locationCode, excludedCandidateIds, focusDimension: options.focusDimension }, deps);
    cycles.push(cycle);

    if (cycle.decision === "NOT_EXECUTED") {
      stopReason = "NOT_EXECUTED";
      timeline.push({ at: new Date().toISOString(), event: `Cyclus ${iteratie}: geen echte diagnose mogelijk (LOCAL REQUIRED) — run stopt eerlijk, geen gok.` });
      slaLopendeVoortgangOp();
      break;
    }

    if (cycle.candidate) excludedCandidateIds.push(cycle.candidate.id);
    const dimensie = cycle.weakness.weakestDimension ?? "onbekend";

    if (cycle.decision === "PROMOTION_CANDIDATE") {
      attemptsPerDimension.delete(dimensie); // opgelost (voor nu) — teller reset, geen "voortgang"-straf voor een succesvolle dimensie.
      bestCandidateVersionId = cycle.version?.id ?? bestCandidateVersionId;
      timeline.push({ at: new Date().toISOString(), event: `Cyclus ${iteratie}: kandidaat ${cycle.candidate?.id} GEACCEPTEERD als versie ${cycle.version?.id} (dimensie ${dimensie}).` });
      slaLopendeVoortgangOp();
      continue;
    }

    const teller = (attemptsPerDimension.get(dimensie) ?? 0) + 1;
    attemptsPerDimension.set(dimensie, teller);
    timeline.push({ at: new Date().toISOString(), event: `Cyclus ${iteratie}: kandidaat ${cycle.candidate?.id} verworpen (${cycle.decision}) — dimensie ${dimensie}, poging ${teller}/${maxAttempts}.` });

    if (teller >= maxAttempts) {
      stopReason = "NO_PROGRESS_ON_SAME_WEAKNESS";
      logbook.log(runId, {
        kind: "INFO",
        experimentId: null,
        message: `Geen voortgang: dimensie ${dimensie} is ${teller}x verworpen zonder promotie — run stopt om eindeloos op dezelfde zwakte te blijven proberen (vroege overfitting-bescherming) te voorkomen.`,
      });
      slaLopendeVoortgangOp();
      break;
    }
    slaLopendeVoortgangOp();
  }

  const endVersionId = currentVersionId();
  const finishedAt = new Date().toISOString();
  const acceptedCount = cycles.filter((c) => c.decision === "PROMOTION_CANDIDATE").length;
  const rejectedCount = cycles.filter((c) => c.decision === "REJECTED" || c.decision === "KEEP_TESTING").length;

  logbook.log(runId, {
    kind: "INFO",
    experimentId: null,
    message: `Autonome ontwikkelrun afgerond: ${stopReason}. ${cycles.length} cyclus/cycli, ${acceptedCount} geaccepteerd, ${rejectedCount} verworpen. Actieve versie: ${endVersionId} (ongewijzigd t.o.v. start: ${endVersionId === startVersionId}).`,
    data: { stopReason, cycleCount: cycles.length, acceptedCount, rejectedCount },
  });

  const result: AutonomousDevelopmentRunResult = {
    runId,
    startedAt,
    finishedAt,
    startVersionId,
    endVersionId,
    cycles,
    acceptedCount,
    rejectedCount,
    bestCandidateVersionId,
    stopReason,
    timeline,
    inProgress: false,
  };
  // Zonder dit zou het resultaat alleen in het geheugen van dit proces bestaan
  // en spoorloos verdwijnen zodra het (via `startCliRun()`) gespawnde CLI-proces
  // stopt — de Dashboard/Development Runs/Candidates-pagina's kunnen een
  // afgeronde run dan nooit meer terugvinden. Zelfde patroon als
  // `autonomy/capabilityTest.ts`'s eigen `writeAutonomyResult(result)`.
  writeDevelopmentRunResult(result);
  return result;
}
