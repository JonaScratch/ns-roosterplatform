/**
 * De voortgang van een generatieopdracht, zoals de server hem kent.
 *
 * ## Geen neppercentage
 *
 * De solver meldt tijdens het rekenen niet hoe ver hij is. Een balk die toch
 * oploopt, is verzonnen — en juist wanneer het lang duurt is dat het
 * vervelendst. Het percentage hieronder is daarom het deel van de werkelijke
 * pijplijnstappen dat is afgerond. Staat de oplosser een minuut te rekenen, dan
 * staat de balk die minuut stil, en de tekst zegt wat er gebeurt.
 *
 * ## Waarom per kandidaat en niet per rooster
 *
 * De solver bouwt alle basisroosters in één model tegelijk op: Vroeg eerst en
 * Laat daarna zou het eerste rooster de beste diensten geven. Een stap
 * "Laat/Nacht genereren" bestaat dus niet, en tonen alsof hij bestaat zou een
 * verzinsel zijn. De stappen zijn wat er echt achter elkaar gebeurt: opbouwen,
 * analyseren, zo nodig verbeteren, valideren, opslaan.
 */

export type StepState = "done" | "active" | "pending" | "skipped" | "failed";

export interface ProgressStep {
  readonly key: string;
  readonly label: string;
  readonly state: StepState;
}

export interface RunProgress {
  readonly steps: readonly ProgressStep[];
  readonly candidatesRequested: number;
  readonly candidatesFound: number;
  /** De kandidaat waar nu aan wordt gewerkt, 1-gebaseerd. */
  readonly currentCandidate: number | null;
  /** Hoeveelste poging in totaal. */
  readonly attempt: number;
}

export type PipelineKind = "SOLVER" | "BASELINE" | "REBUILD";

export function candidateStepKeys(index: number): readonly string[] {
  return [`SOLVE_${index}`, `ANALYSE_${index}`, `REPAIR_${index}`, `VALIDATE_${index}`, `STORE_${index}`];
}

export function planProgress(kind: PipelineKind, requested: number): RunProgress {
  const steps: ProgressStep[] = [
    { key: "INPUT", label: "Dienstenpakket controleren", state: "pending" },
    { key: "STRUCTURE", label: "Roosterstructuur voorbereiden", state: "pending" },
  ];
  for (let k = 1; k <= requested; k += 1) {
    const naam = kind === "REBUILD" ? "Herbouw" : requested > 1 ? `Kandidaat ${k}` : "Kandidaat";
    steps.push(
      {
        key: `SOLVE_${k}`,
        label: kind === "BASELINE" ? "Huidig rooster overnemen" : `${naam} opbouwen`,
        state: "pending",
      },
      { key: `ANALYSE_${k}`, label: `${naam} analyseren`, state: "pending" },
      {
        key: `REPAIR_${k}`,
        label: `${naam} gericht verbeteren`,
        // De nulmeting is het huidige rooster; daar wordt niets aan verbeterd.
        state: kind === "BASELINE" ? "skipped" : "pending",
      },
      { key: `VALIDATE_${k}`, label: `${naam} onafhankelijk valideren`, state: "pending" },
      { key: `STORE_${k}`, label: `${naam} opslaan`, state: "pending" },
    );
  }
  steps.push({ key: "FINISH", label: "Resultaten afronden", state: "pending" });
  return {
    steps,
    candidatesRequested: requested,
    candidatesFound: 0,
    currentCandidate: null,
    attempt: 0,
  };
}

export function withStep(progress: RunProgress, key: string, state: StepState): RunProgress {
  return {
    ...progress,
    steps: progress.steps.map((step) => (step.key === key ? { ...step, state } : step)),
  };
}

/** Zet de stappen van een kandidaat terug op "nog te doen", voor een nieuwe poging. */
export function resetCandidate(progress: RunProgress, index: number, baseline: boolean): RunProgress {
  const sleutels = new Set(candidateStepKeys(index));
  return {
    ...progress,
    steps: progress.steps.map((step) =>
      sleutels.has(step.key)
        ? { ...step, state: step.key.startsWith("REPAIR_") && baseline ? "skipped" : "pending" }
        : step,
    ),
  };
}

/** Markeer alles wat nog moest gebeuren als overgeslagen. */
export function skipRemaining(progress: RunProgress): RunProgress {
  return {
    ...progress,
    steps: progress.steps.map((step) =>
      step.state === "pending" || step.state === "active" ? { ...step, state: "skipped" } : step,
    ),
  };
}

/** Het deel van de stappen dat klaar is, als heel percentage. */
export function progressPercentage(progress: RunProgress): number {
  if (progress.steps.length === 0) {
    return 0;
  }
  const klaar = progress.steps.filter((step) => step.state === "done" || step.state === "skipped").length;
  return Math.round((klaar / progress.steps.length) * 100);
}

/**
 * Een generatieopdracht zoals het scherm hem ophaalt.
 *
 * Tijden als ISO-tekst: dit gaat als JSON over de lijn, en een `Date` komt daar
 * aan de andere kant als tekst uit.
 */
export interface GenerationRunJson {
  readonly id: string;
  readonly kind: "GENERATE" | "REBUILD";
  readonly strategy: string;
  readonly strategyLabel: string;
  readonly rosterYear: number;
  readonly status: string;
  readonly statusLabel: string;
  readonly active: boolean;
  readonly stageMessage: string | null;
  readonly percentage: number;
  readonly progress: RunProgress | null;
  readonly requestedCandidates: number;
  readonly foundCandidates: number;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly elapsedSeconds: number | null;
  readonly candidateIds: readonly string[];
  readonly parentCandidateId: string | null;
  readonly cancelRequested: boolean;
}
