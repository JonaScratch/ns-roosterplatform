import "server-only";
import { locationCode as defaultLocationCode } from "../config";
import * as logbook from "../store/logbook";
import { currentVersionId, releaseInfo } from "../publish/versions";
import { getDevelopmentRunResult, writeDevelopmentRunResult } from "../store/developmentRuns";
import { draaiLongRun, profielVoorMinuten, type LongRunCheckpoint, type LongRunDeps, type LongRunFase, type LongRunProfiel, type LongRunStopReden } from "../factory/longRun";
import { holdoutTeksten } from "../factory/store";
import { detecteerLekkage } from "../factory/manifest";
import { DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES, runDevelopmentCycle, type DevelopmentCycleDependencies, type DevelopmentCycleResult } from "./developmentCycle";

/**
 * De tijdgebonden autonome ontwikkelrun — nu een dunne laag over de ene,
 * canonieke lange run (factory/longRun.ts).
 *
 * ## Waarom (incident DR-UI-202609301449)
 *
 * Er waren twee motoren. Het kaartje "6 uur" op Dashboard en Development Runs
 * startte deze functie, met een eigen teller: twee verworpen kandidaten op
 * dezelfde zwakte beëindigden de hele run (`NO_PROGRESS_ON_SAME_WEAKNESS`),
 * terwijl het leergeheugen nog een derde strategie en andere zwaktes had. Er
 * kwam geen checkpoint, geen hervatting en niets waar de verifier op kon
 * werken. Het paneel "Lange runs" startte een ándere motor die dat wél had.
 *
 * Nu is er één motor: elke cyclus is `runDevelopmentCycle` binnen
 * `draaiLongRun`, met hetzelfde run-id, checkpoint, verkenningsbudget en
 * dezelfde stopredenen, wie de run ook start. Deze functie levert daarnaast de
 * vertrouwde samenvatting (`AutonomousDevelopmentRunResult`) voor de
 * bestaande pagina's.
 *
 * Activeert NOOIT een versie — het checkpoint legt de productiestand bij start
 * en na elke cyclus vast.
 */

export interface AutonomousDevelopmentRunOptions {
  readonly runId?: string;
  /** Verplicht — actieve minuten; 60/360/1440 worden de profielen 1h/6h/24h, Infinity "handmatig" (tot stop), iets anders "aangepast". */
  readonly maxMinutes: number;
  readonly locationCode?: string;
  /**
   * Na zoveel pogingen zonder promotie wordt een zwakte in déze run lokaal
   * uitgeput verklaard en gaat de run verder met een andere. Stopt de run niet.
   * Standaard het verkenningsbudget van het profiel.
   */
  readonly maxAttemptsPerDimensionWithoutPromotion?: number;
  /** Doorgegeven aan elke cyclus — zie `DevelopmentCycleOptions.focusDimension`. */
  readonly focusDimension?: keyof import("../types").AgentQualityCategory;
  /** Veiligheidsgrens op het aantal cycli (standaard het verkenningsbudget van het profiel). */
  readonly maxCycles?: number;
  /** Grenzen van de dynamische zoekruimte (standaard die van het profiel). */
  readonly zoek?: Partial<import("../develop/zoekruimte").Zoekgrenzen>;
}

export type AutonomousDevelopmentRunStopReason =
  | "MAX_MINUTES_REACHED"
  | "MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE"
  /** Wordt niet meer gegeven; blijft voor het tonen van oude runs. */
  | "NO_PROGRESS_ON_SAME_WEAKNESS"
  /** Het leergeheugen heeft voor geen enkele gemeten dimensie nog een ongeprobeerde strategie. */
  | "ALL_HYPOTHESES_EXHAUSTED"
  | "NOT_EXECUTED"
  | "MANUALLY_STOPPED"
  | "PAUSED"
  | "MAX_CYCLES_REACHED"
  /** Echte fout: een cyclus faalde herhaaldelijk, of een al verworpen strategie bleef terugkomen. */
  | "BLOCKER"
  /** De regisseur kon niets nieuws meer bedenken of de zoekgrens is bereikt: escalatie nodig. Geen succes. */
  | "CAPABILITY_BLOCKER";

export interface TimelineEntry {
  readonly at: string;
  readonly event: string;
}

export interface AutonomousDevelopmentRunResult {
  readonly runId: string;
  readonly startedAt: string;
  /** Tijdstip van de laatst bekende toestand — bij `inProgress: true` is dit "laatst bijgewerkt", geen echt eindtijdstip. */
  readonly finishedAt: string;
  readonly startVersionId: string;
  /** Hoort ALTIJD gelijk te zijn aan `startVersionId` (nooit autonome activatie). */
  readonly endVersionId: string;
  readonly cycles: readonly DevelopmentCycleResult[];
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly bestCandidateVersionId: string | null;
  readonly stopReason: AutonomousDevelopmentRunStopReason | null;
  readonly timeline: readonly TimelineEntry[];
  readonly inProgress: boolean;
  /** De canonieke lange run achter deze samenvatting. */
  readonly longRun?: {
    readonly profiel: LongRunProfiel;
    readonly budgetMinuten: number | null;
    readonly actieveMinuten: number;
    readonly status: LongRunCheckpoint["status"];
    readonly stopReden: LongRunStopReden | null;
    readonly fase: LongRunFase | null;
    readonly uitgeslotenDimensies: readonly string[];
    readonly geblokkeerdeParen: readonly { readonly dimensie: string; readonly strategie: string }[];
    /** De dynamische zoekruimte: hoeveel golven, hypothesen en gegenereerde tests. */
    readonly golven: number;
    readonly hypothesen: number;
    readonly gegenereerdeTests: number;
    readonly aanpak: string | null;
  };
}

const STOP_NAAR_RESULTAAT: Readonly<Record<LongRunStopReden, AutonomousDevelopmentRunStopReason>> = {
  BUDGET_OP: "MAX_MINUTES_REACHED",
  ALLES_GEPROBEERD: "ALL_HYPOTHESES_EXHAUSTED",
  GEEN_DIAGNOSE: "NOT_EXECUTED",
  HANDMATIG_GESTOPT: "MANUALLY_STOPPED",
  MAX_CYCLI: "MAX_CYCLES_REACHED",
  HERHAALDE_FOUT: "BLOCKER",
  GEEN_VOORTGANG: "BLOCKER",
  CAPACITEIT_BLOKKADE: "CAPABILITY_BLOCKER",
};

/** Extra's die de CLI invult (klok, productiestand, omgevingsvingerafdruk, canonieke kopie); tests laten ze leeg. */
export type LongRunExtras = Partial<Pick<LongRunDeps, "nu" | "productie" | "omgeving" | "spiegel" | "testToegestaan">>;

export async function runAutonomousDevelopmentRun(
  options: AutonomousDevelopmentRunOptions,
  deps: DevelopmentCycleDependencies = DEFAULT_DEVELOPMENT_CYCLE_DEPENDENCIES,
  extras: LongRunExtras = {},
): Promise<AutonomousDevelopmentRunResult> {
  if (Number.isNaN(options.maxMinutes) || options.maxMinutes < 0) {
    throw new Error("runAutonomousDevelopmentRun: maxMinutes moet een niet-negatief getal zijn — geen verborgen default voor een open-eindige lus. (0 is geldig: budget al op, 0 cycli.)");
  }
  const runId = options.runId ?? `DR-AUTODEV-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const locationCode = options.locationCode ?? defaultLocationCode();
  const { profiel, minuten } = profielVoorMinuten(options.maxMinutes);
  const startVersionId = currentVersionId();

  // Hervatting: de volledige cyclusresultaten van eerdere segmenten staan in de vorige samenvatting.
  const eerder = getDevelopmentRunResult(runId);
  const cycles: DevelopmentCycleResult[] = eerder ? [...eerder.cycles] : [];
  const startedAt = eerder?.startedAt ?? new Date().toISOString();

  logbook.log(runId, {
    kind: "CHALLENGE_OR_GOAL",
    experimentId: null,
    message: `${eerder ? "Autonome ontwikkelrun hervat" : "Autonome ontwikkelrun gestart"} als canonieke lange run (profiel ${profiel}${minuten !== null ? `, ${minuten} min` : ""}; actieve versie bij start: ${startVersionId}).`,
    data: { maxMinutes: options.maxMinutes, profiel, startVersionId },
  });

  const samenvatting = (c: LongRunCheckpoint): AutonomousDevelopmentRunResult => {
    const accepted = cycles.filter((x) => x.decision === "PROMOTION_CANDIDATE");
    const stopReason: AutonomousDevelopmentRunStopReason | null =
      c.status === "RUNNING"
        ? null
        : c.status === "PAUSED"
          ? "PAUSED"
          : c.stopReden === "BUDGET_OP" && c.cycli.length === 0
            ? "MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE"
            : c.stopReden
              ? STOP_NAAR_RESULTAAT[c.stopReden]
              : null;
    return {
      runId,
      startedAt,
      finishedAt: c.bijgewerktOp,
      startVersionId,
      endVersionId: currentVersionId(),
      cycles,
      acceptedCount: accepted.length,
      rejectedCount: cycles.filter((x) => x.decision === "REJECTED" || x.decision === "KEEP_TESTING").length,
      bestCandidateVersionId: [...accepted].reverse().find((x) => x.version)?.version?.id ?? null,
      stopReason,
      timeline: c.gebeurtenissen.map((g) => ({ at: g.op, event: g.tekst })),
      inProgress: c.status === "RUNNING",
      longRun: {
        profiel: c.profiel,
        budgetMinuten: c.budgetMinuten,
        actieveMinuten: Math.round((c.actieveMs / 60000) * 10) / 10,
        status: c.status,
        stopReden: c.stopReden,
        fase: c.fase ?? null,
        uitgeslotenDimensies: c.uitgeslotenDimensies ?? [],
        geblokkeerdeParen: c.geblokkeerdeParen ?? [],
        golven: c.zoekruimte?.golven.length ?? 0,
        hypothesen: c.zoekruimte?.hypothesen.length ?? 0,
        gegenereerdeTests: c.zoekruimte?.tests.length ?? 0,
        aanpak: c.zoekruimte?.golven[c.zoekruimte.golven.length - 1]?.aanpak ?? null,
      },
    };
  };

  const checkpoint = await draaiLongRun(
    { runId, profiel, minuten, maxPogingenPerDimensie: options.maxAttemptsPerDimensionWithoutPromotion, maxCycli: options.maxCycles, zoek: options.zoek },
    {
      nu: extras.nu ?? (() => Date.now()),
      productie:
        extras.productie ??
        (() => {
          const { actief } = releaseInfo();
          return { versionId: actief.versionId, generation: actief.generation };
        }),
      omgeving: extras.omgeving,
      // Een gegenereerde test die op de holdout lijkt, wordt aan de meetkant geweigerd (zelfde lekdetectie als de rechter).
      testToegestaan:
        extras.testToegestaan ??
        (() => {
          let holdout: readonly string[] | null = null;
          return (prompt: string) => {
            holdout ??= holdoutTeksten();
            return detecteerLekkage(prompt, holdout).length === 0;
          };
        })(),
      // Elk checkpoint: ook de samenvatting voor de pagina's bijwerken (live voortgang).
      spiegel: (c) => {
        extras.spiegel?.(c);
        writeDevelopmentRunResult(samenvatting(c));
      },
      cyclus: async ({ runId: id, uitgesloten, runUitsluitingen, zoekruimte }) => {
        const c = await runDevelopmentCycle({ runId: id, locationCode, excludedCandidateIds: uitgesloten, focusDimension: options.focusDimension, runUitsluitingen, zoekruimte }, deps);
        cycles.push(c);
        return {
          beslissing: c.decision,
          kandidaatId: c.candidate?.id ?? null,
          dimensie: c.weakness.weakestDimension ?? null,
          versieId: c.version?.id ?? null,
          verdict: c.judge?.verdict ?? null,
          stadia: c.stadia ?? [],
          lesId: c.les?.id ?? null,
          geleerdVan: c.geleerdVan ?? [],
          strategie: c.candidate?.hypothesis?.strategie ?? null,
          familie: c.candidate?.hypothesis?.familie ?? c.candidate?.category ?? null,
          overgeslagen: c.overgeslagen ?? [],
          model: process.env.NS_LOCAL_LLM_MODEL ?? null,
          scores: c.weakness.scores ?? null,
        };
      },
    },
  );

  const result = samenvatting(checkpoint);
  logbook.log(runId, {
    kind: "INFO",
    experimentId: null,
    message: `Autonome ontwikkelrun ${checkpoint.status === "PAUSED" ? "gepauzeerd" : "afgerond"}: ${checkpoint.stopReden ?? checkpoint.status}. ${result.cycles.length} cyclus/cycli, ${result.acceptedCount} geaccepteerd, ${result.rejectedCount} verworpen. Actieve versie: ${result.endVersionId} (ongewijzigd t.o.v. start: ${result.endVersionId === startVersionId}).`,
    data: { stopReden: checkpoint.stopReden, status: checkpoint.status, cycleCount: result.cycles.length },
  });
  writeDevelopmentRunResult(result);
  return result;
}
