import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import { type GenerationRunJson, type RunProgress, progressPercentage } from "@/domain/generation-progress";
import { rosterYear as rosterYearOf } from "@/domain/roster-year";
import { toDatabaseDate } from "@/domain/time";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { isRunningHere, runGenerationJob } from "@/server/generation/generation-job";
import { defaultOptimizerEngine, defaultSearchMode } from "@/server/generation/engine-flag";
import { isSearchMode } from "@/server/generation/adaptive/config";
import { type RebuildGoal, REBUILD_GOAL_LABELS } from "@/server/optimizer/objective-weights";
import { NotFoundError, requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import { SCENARIOS } from "@/server/services/simulation-service";

/**
 * Generatieopdrachten: starten, volgen, stoppen, herbouwen.
 *
 * ## Eén opdracht tegelijk per standplaats
 *
 * Een dubbele klik of twee tabbladen mogen geen twee berekeningen starten. De
 * database heeft daar een gedeeltelijke unieke index voor; deze dienst vangt
 * de botsing op en zegt dan dat er al een opdracht loopt, met een verwijzing
 * ernaar.
 *
 * ## Een opdracht die niemand meer uitvoert
 *
 * Stopt het proces halverwege — de laptop gaat dicht, de portable wordt
 * afgesloten — dan blijft een opdracht op "loopt" staan terwijl niemand eraan
 * werkt. Een lopende opdracht meldt zich daarom elke vijf seconden. Blijft dat
 * uit, dan wordt hij bij de eerstvolgende blik als onderbroken gemarkeerd, en
 * blokkeert hij geen nieuwe opdracht meer.
 */

const VERLOPEN_NA_MS = 45_000;

export class ActiveGenerationError extends Error {
  constructor(public readonly runId: string | null) {
    super("Er loopt al een generatie voor deze standplaats. Wacht tot die klaar is, of stop hem eerst.");
    this.name = "ActiveGenerationError";
  }
}

export interface GenerationRunView {
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
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly elapsedSeconds: number | null;
  readonly candidateIds: readonly string[];
  readonly parentCandidateId: string | null;
  readonly adjustment: {
    readonly goals: readonly string[];
    readonly preserveGoodParts: boolean;
    readonly note: string | null;
  } | null;
  readonly cancelRequested: boolean;
  /** Welke zoekmachine en welke rekentijdmodus; leeg bij de klassieke engine. */
  readonly engine: string;
  readonly searchMode: string | null;
  /** Tellers van de adaptieve zoektocht, zodat het scherm kan laten zien wat er gebeurt. */
  readonly search: SearchProgress | null;
}

/** Wat het scherm van de zoektocht laat zien. Alleen tellingen, geen roosters. */
export interface SearchProgress {
  readonly attempts: number;
  readonly starts: number;
  readonly repairs: number;
  readonly variants: number;
  readonly validCandidates: number;
  readonly rejected: number;
  readonly polishSwaps: number;
  readonly bestRobust: number | null;
  readonly elapsedSeconds: number;
  readonly budgetSeconds: number;
  readonly stopReason: string | null;
}

function zoekVoortgang(waarde: unknown): SearchProgress | null {
  if (!waarde || typeof waarde !== "object") {
    return null;
  }
  const c = waarde as Record<string, unknown>;
  const getal = (naam: string) => (typeof c[naam] === "number" ? (c[naam] as number) : 0);
  return {
    attempts: getal("attempts"),
    starts: getal("starts"),
    repairs: getal("repairs"),
    // Elke solverpoging is één rooster; het bijschaven beoordeelt er duizenden.
    variants: getal("attempts") + getal("polishVariants"),
    validCandidates: getal("validCandidates"),
    rejected: getal("rejected"),
    polishSwaps: getal("polishSwaps"),
    bestRobust: typeof c.bestRobust === "number" ? c.bestRobust : null,
    elapsedSeconds: getal("elapsedSeconds"),
    budgetSeconds: getal("budgetSeconds"),
    stopReason: typeof c.stopReason === "string" ? c.stopReason : null,
  };
}

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Genereren",
  RUNNING: "Genereren",
  COMPLETED: "Gereed",
  PARTIAL: "Gereed, minder kandidaten dan gevraagd",
  FAILED: "Niet gelukt",
  CANCELLED: "Gestopt",
  INTERRUPTED: "Onderbroken",
};

// ── Kern: zonder toegangscheck ───────────────────────────────────────────────

/** Markeer opdrachten waarvan de hartslag is gestopt als onderbroken. */
export async function interruptStaleRunsCore(locationCode: string, now = new Date()): Promise<number> {
  const grens = new Date(now.getTime() - VERLOPEN_NA_MS);
  const kandidaten = await prisma.generationRun.findMany({
    where: {
      locationCode,
      status: { in: ["QUEUED", "RUNNING"] },
      OR: [{ heartbeatAt: { lt: grens } }, { heartbeatAt: null, createdAt: { lt: grens } }],
    },
    select: { id: true },
  });
  let aantal = 0;
  for (const kandidaat of kandidaten) {
    if (isRunningHere(kandidaat.id)) {
      continue;
    }
    const uitkomst = await prisma.generationRun.updateMany({
      where: { id: kandidaat.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "INTERRUPTED",
        finishedAt: now,
        stageMessage:
          "Onderbroken: het platform is gestopt terwijl deze opdracht liep. Kandidaten die al " +
          "volledig waren gevalideerd en opgeslagen, blijven bewaard; een half rooster niet.",
        failureReason: "Het platform werd afgesloten tijdens de generatie.",
      },
    });
    aantal += uitkomst.count;
  }
  return aantal;
}

export async function createRunCore(input: {
  readonly actor: Actor;
  readonly locationCode: string;
  readonly strategy: string;
  readonly strategyLabel: string;
  readonly rosterYear: number;
  readonly requestedCandidates: number;
  readonly kind?: "GENERATE" | "REBUILD";
  readonly parentCandidateId?: string | null;
  readonly adjustment?: { goals: readonly RebuildGoal[]; preserveGoodParts: boolean; note: string | null } | null;
  readonly engine?: string;
  readonly searchMode?: string | null;
  readonly ablation?: string | null;
}): Promise<string> {
  await interruptStaleRunsCore(input.locationCode);

  const jaar = rosterYearOf(input.rosterYear);
  const pakket = await prisma.dutyPackage.findFirst({
    where: { status: "ACTIVE", depot: input.locationCode },
    orderBy: { version: "desc" },
    select: { id: true },
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const opdracht = input.adjustment
        ? await tx.rosterCommitteeAdjustment.create({
            data: {
              parentCandidateId: input.parentCandidateId ?? "",
              goals: [...input.adjustment.goals],
              preserveGoodParts: input.adjustment.preserveGoodParts,
              note: input.adjustment.note,
              createdByUserId: input.actor.userId,
            },
            select: { id: true },
          })
        : null;
      const run = await tx.generationRun.create({
        data: {
          locationCode: input.locationCode,
          kind: input.kind ?? "GENERATE",
          strategy: input.strategy,
          strategyLabel: input.strategyLabel,
          rosterYear: jaar.year,
          periodStart: toDatabaseDate(jaar.start),
          periodEnd: toDatabaseDate(jaar.endExclusive),
          dutyPackageId: pakket?.id ?? null,
          requestedCandidates: input.requestedCandidates,
          engine: input.engine ?? defaultOptimizerEngine(),
          searchMode: input.searchMode ?? null,
          ablation: input.ablation ?? null,
          createdByUserId: input.actor.userId,
          parentCandidateId: input.parentCandidateId ?? null,
          adjustmentId: opdracht?.id ?? null,
          stageMessage: "De opdracht staat klaar.",
          heartbeatAt: new Date(),
        },
        select: { id: true },
      });
      return run.id;
    });
  } catch (fout) {
    if (fout instanceof Prisma.PrismaClientKnownRequestError && fout.code === "P2002") {
      const actief = await prisma.generationRun.findFirst({
        where: { locationCode: input.locationCode, status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
      });
      throw new ActiveGenerationError(actief?.id ?? null);
    }
    throw fout;
  }
}

async function viewOf(id: string): Promise<GenerationRunView | null> {
  const rij = await prisma.generationRun.findUnique({
    where: { id },
    include: {
      candidates: { select: { id: true }, orderBy: { candidateNumber: "asc" } },
      adjustment: true,
    },
  });
  if (!rij) {
    return null;
  }
  const progress = (rij.progress as unknown as RunProgress | null) ?? null;
  const actief = rij.status === "QUEUED" || rij.status === "RUNNING";
  const einde = rij.finishedAt ?? (actief ? new Date() : null);
  return {
    id: rij.id,
    kind: rij.kind,
    strategy: rij.strategy,
    strategyLabel: rij.strategyLabel,
    rosterYear: rij.rosterYear,
    status: rij.status,
    statusLabel:
      rij.status === "RUNNING" && rij.stage?.startsWith("VALIDATE_")
        ? "Valideren"
        : (STATUS_LABELS[rij.status] ?? rij.status),
    active: actief,
    stageMessage: rij.stageMessage,
    percentage: progress ? (actief ? Math.min(99, progressPercentage(progress)) : 100) : 0,
    progress,
    requestedCandidates: rij.requestedCandidates,
    foundCandidates: rij.foundCandidates,
    failureReason: rij.failureReason,
    createdAt: rij.createdAt,
    startedAt: rij.startedAt,
    finishedAt: rij.finishedAt,
    elapsedSeconds: rij.startedAt && einde ? Math.round((einde.getTime() - rij.startedAt.getTime()) / 1000) : null,
    candidateIds: rij.candidates.map((kandidaat) => kandidaat.id),
    parentCandidateId: rij.parentCandidateId,
    adjustment: rij.adjustment
      ? { goals: rij.adjustment.goals, preserveGoodParts: rij.adjustment.preserveGoodParts, note: rij.adjustment.note }
      : null,
    cancelRequested: rij.cancelRequested,
    engine: rij.engine,
    searchMode: rij.searchMode,
    search: zoekVoortgang(rij.searchCounters),
  };
}

// ── Met toegangscheck ────────────────────────────────────────────────────────

export async function startGeneration(input: { strategy: string; rosterYear: number; mode?: string | null }): Promise<string> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, null);
  const scenario = SCENARIOS.find((entry) => entry.key === input.strategy);
  if (!scenario) {
    throw new NotFoundError("Deze strategie bestaat niet.");
  }
  // De nulmeting is het huidige rooster als referentie; daar zijn geen drie
  // varianten van. De rangeervariant is één deterministische bewerking.
  const aantal = scenario.engine === "BASELINE" ? 1 : 3;
  const engine = defaultOptimizerEngine();
  const runId = await createRunCore({
    actor,
    locationCode: scope.code,
    strategy: scenario.key,
    strategyLabel: scenario.label,
    rosterYear: input.rosterYear,
    requestedCandidates: aantal,
    engine,
    // De nulmeting en de rangeervariant rekenen niet; een rekentijdmodus zegt
    // daar niets en wordt niet vastgelegd.
    searchMode: engine === "adaptive" && scenario.engine === "SOLVER" ? (isSearchMode(input.mode) ? input.mode : defaultSearchMode()) : null,
  });
  // Bewust niet afgewacht: de opdracht loopt door nadat dit verzoek klaar is.
  void runGenerationJob(runId, actor);
  return runId;
}

export async function startRebuild(input: {
  parentCandidateId: string;
  goals: readonly RebuildGoal[];
  preserveGoodParts: boolean;
  note: string | null;
}): Promise<string> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, null);
  const ouder = await prisma.candidateRoster.findUnique({
    where: { id: input.parentCandidateId },
    select: {
      id: true,
      scenarioLabel: true,
      locationCode: true,
      optimizerVersion: true,
      generationRun: { select: { rosterYear: true, strategy: true, strategyLabel: true } },
    },
  });
  if (!ouder || (ouder.locationCode !== null && ouder.locationCode !== scope.code)) {
    throw new NotFoundError("Deze kandidaat bestaat niet (meer).");
  }
  const goals = input.goals.filter((goal) => goal in REBUILD_GOAL_LABELS);
  if (goals.length === 0 && !input.preserveGoodParts) {
    throw new Error("Kies ten minste één punt om te verbeteren.");
  }
  const strategie = ouder.generationRun?.strategy ?? ouder.optimizerVersion.split("+")[1] ?? "BALANCED";
  const runId = await createRunCore({
    actor,
    locationCode: scope.code,
    strategy: strategie === "REPRODUCE" || strategie === "BALANCE_SHUNTING" ? "BALANCED" : strategie,
    strategyLabel: ouder.generationRun?.strategyLabel ?? ouder.scenarioLabel,
    rosterYear: ouder.generationRun?.rosterYear ?? new Date().getFullYear() + 1,
    requestedCandidates: 1,
    kind: "REBUILD",
    engine: defaultOptimizerEngine(),
    searchMode: defaultOptimizerEngine() === "adaptive" ? defaultSearchMode() : null,
    parentCandidateId: ouder.id,
    adjustment: { goals, preserveGoodParts: input.preserveGoodParts, note: input.note?.trim() || null },
  });
  await recordAudit({
    actor,
    action: "herbouw.aangevraagd",
    objectType: "CandidateRoster",
    objectId: ouder.id,
    result: "SUCCESS",
    reason: goals.map((goal) => REBUILD_GOAL_LABELS[goal]).join(", ") || "goede delen behouden",
    // De vrije opmerking gaat mee naar de geschiedenis, niet naar de optimizer.
    newValue: { run: runId, opmerking: input.note?.trim() || null },
  });
  void runGenerationJob(runId, actor);
  return runId;
}

export async function generationRun(runId: string): Promise<GenerationRunView> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, null);
  await interruptStaleRunsCore(scope.code);
  const rij = await prisma.generationRun.findUnique({ where: { id: runId }, select: { locationCode: true } });
  if (!rij || rij.locationCode !== scope.code) {
    throw new NotFoundError("Deze generatieopdracht bestaat niet.");
  }
  return (await viewOf(runId))!;
}

export async function activeGenerationRun(): Promise<GenerationRunView | null> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, null);
  await interruptStaleRunsCore(scope.code);
  const rij = await prisma.generationRun.findFirst({
    where: { locationCode: scope.code, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  return rij ? viewOf(rij.id) : null;
}

export async function recentGenerationRuns(limit = 10): Promise<readonly GenerationRunView[]> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, null);
  await interruptStaleRunsCore(scope.code);
  const rijen = await prisma.generationRun.findMany({
    where: { locationCode: scope.code },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  const views = await Promise.all(rijen.map((rij) => viewOf(rij.id)));
  return views.filter((view): view is GenerationRunView => view !== null);
}

export async function cancelGeneration(runId: string): Promise<void> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, null);
  const uitkomst = await prisma.generationRun.updateMany({
    where: { id: runId, locationCode: scope.code, status: { in: ["QUEUED", "RUNNING"] } },
    data: { cancelRequested: true, stageMessage: "Stoppen gevraagd — de lopende berekening wordt beëindigd." },
  });
  if (uitkomst.count === 0) {
    throw new NotFoundError("Er loopt geen opdracht met deze verwijzing.");
  }
  await recordAudit({
    actor,
    action: "generatie.stoppen-gevraagd",
    objectType: "GenerationRun",
    objectId: runId,
    result: "SUCCESS",
  });
}

/**
 * Markeer de kandidaat waarmee de Roostercommissie verder wil.
 *
 * Eén per standplaats. Dit is geen publicatie en geen vastlegging: de
 * publicatiepoort staat hier los van en verandert niet mee.
 */
export async function markPreferredCandidate(candidateId: string, preferred: boolean): Promise<void> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, null);
  const kandidaat = await prisma.candidateRoster.findUnique({
    where: { id: candidateId },
    select: { id: true, locationCode: true, scenarioLabel: true },
  });
  if (!kandidaat || (kandidaat.locationCode !== null && kandidaat.locationCode !== scope.code)) {
    throw new NotFoundError("Deze kandidaat bestaat niet (meer).");
  }
  await prisma.$transaction(async (tx) => {
    if (preferred) {
      await tx.candidateRoster.updateMany({
        where: { OR: [{ locationCode: scope.code }, { locationCode: null }], preferred: true },
        data: { preferred: false },
      });
    }
    await tx.candidateRoster.update({ where: { id: candidateId }, data: { preferred } });
  });
  await recordAudit({
    actor,
    action: preferred ? "kandidaat.voorkeur-gemarkeerd" : "kandidaat.voorkeur-ingetrokken",
    objectType: "CandidateRoster",
    objectId: candidateId,
    result: "SUCCESS",
    reason: kandidaat.scenarioLabel,
  });
}

export async function archiveCandidate(candidateId: string, archived: boolean): Promise<void> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, null);
  const uitkomst = await prisma.candidateRoster.updateMany({
    where: { id: candidateId, OR: [{ locationCode: scope.code }, { locationCode: null }] },
    data: { archivedAt: archived ? new Date() : null, ...(archived ? { preferred: false } : {}) },
  });
  if (uitkomst.count === 0) {
    throw new NotFoundError("Deze kandidaat bestaat niet (meer).");
  }
  await recordAudit({
    actor,
    action: archived ? "kandidaat.gearchiveerd" : "kandidaat.teruggezet",
    objectType: "CandidateRoster",
    objectId: candidateId,
    result: "SUCCESS",
  });
}

/** Voor over de lijn: tijden als tekst, de rest ongewijzigd. */
export function runJson(view: GenerationRunView): GenerationRunJson {
  return {
    id: view.id,
    kind: view.kind,
    strategy: view.strategy,
    strategyLabel: view.strategyLabel,
    rosterYear: view.rosterYear,
    status: view.status,
    statusLabel: view.statusLabel,
    active: view.active,
    stageMessage: view.stageMessage,
    percentage: view.percentage,
    progress: view.progress,
    requestedCandidates: view.requestedCandidates,
    foundCandidates: view.foundCandidates,
    failureReason: view.failureReason,
    createdAt: view.createdAt.toISOString(),
    startedAt: view.startedAt?.toISOString() ?? null,
    finishedAt: view.finishedAt?.toISOString() ?? null,
    elapsedSeconds: view.elapsedSeconds,
    candidateIds: view.candidateIds,
    parentCandidateId: view.parentCandidateId,
    cancelRequested: view.cancelRequested,
    engine: view.engine,
    searchMode: view.searchMode,
    search: view.search,
  };
}
