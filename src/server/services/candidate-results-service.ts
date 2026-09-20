import "server-only";
import {
  type CandidateAssignment,
  type CandidateValidationStatus,
  publicationEligible,
  simulationEligible,
} from "@/domain/candidate";
import { profileBoundFindings } from "@/domain/candidate-acceptance";
import { formatHoursMinutes } from "@/domain/roster-hours";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import type {
  PackageQuality,
  RosterQuality,
  Subscore,
  SubscoreKey,
} from "@/domain/roster-quality";
import { TRANSITION_CATEGORY_LABELS, type TransitionCategory } from "@/domain/roster-quality-config";
import { describeRosterYear, rosterYear } from "@/domain/roster-year";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import type { ReviewableRoster } from "@/domain/candidate";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { NotFoundError, requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import {
  type QualityContext,
  loadQualityContextCore,
  measureAssignmentsCore,
  measureOfficialCore,
} from "@/server/services/roster-quality-service";
import { buildCandidateSheet } from "@/server/services/roster-sheet-service";
import { SCENARIOS, inputDataVersion, scheduleVersion } from "@/server/services/simulation-service";

/**
 * De resultaten van generaties: kandidaten bekijken, openen en vergelijken.
 *
 * ## Waarom hier niets wordt gegenereerd
 *
 * Genereren is een opdracht die minuten loopt en een eigen scherm heeft. Dit is
 * de plek waar de uitkomst wordt beoordeeld. Een generatieknop hier maakte van
 * het resultatenscherm een tweede startpunt, met twee plekken die elk een half
 * beeld hadden van wat er liep.
 *
 * ## Waarom de kwaliteit bij het lezen wordt gemeten
 *
 * Bij het opslaan wordt een momentopname van de kwaliteit bewaard, voor het
 * spoor. Wat het scherm toont, wordt opnieuw gemeten op de huidige diensten en
 * dezelfde meetopzet als het huidige rooster. Anders staat er naast elkaar een
 * getal van vorige maand en een getal van vandaag, en lijkt het verschil een
 * verschil in rooster.
 */

export type CandidateStatusKey = "GEREED" | "NIET_BRUIKBAAR" | "NIET_GETOETST" | "VEROUDERD";
export type StatusTone = "ok" | "warn" | "error" | "neutral" | "info";

export interface CandidateCard {
  readonly id: string;
  readonly label: string;
  /** "Kandidaat 2" binnen de generatie; null bij een oude kandidaat. */
  readonly number: number | null;
  readonly strategyKey: string;
  readonly strategyLabel: string;
  readonly runId: string | null;
  readonly rosterYear: number | null;
  readonly kind: "GENERATE" | "REBUILD" | null;
  readonly generatedAt: Date;
  readonly status: CandidateStatusKey;
  readonly statusLabel: string;
  readonly statusTone: StatusTone;
  readonly statusDetail: string;
  readonly validationState: string;
  readonly preferred: boolean;
  readonly archived: boolean;
  /** Van vóór de generatieopdrachten: geen run, geen kandidaatnummer. */
  readonly legacy: boolean;
  readonly parent: { readonly id: string; readonly label: string } | null;
  readonly coverage: { readonly placed: number; readonly required: number };
  readonly confirmedHardViolations: number | null;
  readonly uncertaintyGroups: number | null;
  readonly publicationEligible: boolean;
  readonly stale: boolean;
  readonly scores: Readonly<Record<SubscoreKey, number | null>>;
  readonly averageHoursDeviationMinutes: number;
  readonly maxHoursDeviationMinutes: number;
  readonly nights: PackageQuality["nights"];
  readonly heavyTransitions: number;
}

export interface RunSummary {
  readonly id: string;
  readonly kind: "GENERATE" | "REBUILD";
  readonly strategy: string;
  readonly strategyLabel: string;
  readonly rosterYear: number;
  readonly periodLabel: string;
  readonly createdAt: Date;
  readonly status: string;
  readonly statusLabel: string;
  readonly statusTone: StatusTone;
  readonly active: boolean;
  readonly requested: number;
  readonly found: number;
  readonly failureReason: string | null;
  readonly stageMessage: string | null;
  readonly parent: { readonly id: string; readonly label: string } | null;
  readonly goals: readonly string[];
  readonly note: string | null;
}

export interface RosterTile {
  readonly code: string;
  readonly name: string;
  readonly profileLabel: string;
  readonly lines: number;
  readonly averageWeek: string;
  readonly deviationMinutes: number;
  readonly early: number;
  readonly late: number;
  readonly night: number;
  readonly shunting: number;
  readonly weekendDuties: number;
  readonly reserveDays: number;
  readonly nightBlocks: readonly number[];
  readonly singleNights: number;
  readonly nightPairs: number;
  readonly heavyTransitions: number;
  readonly stableShare: number | null;
  readonly shortestRestMinutes: number | null;
}

const LEGE_SCORES: Record<SubscoreKey, number | null> = {
  coverage: null,
  hoursBalance: null,
  restQuality: null,
  transitionQuality: null,
  nightClustering: null,
  nightFairness: null,
  shuntingFairness: null,
  weekendFairness: null,
  changeImpact: null,
};

export const WEEKDAY_SHORT = ["ma", "di", "wo", "do", "vr", "za", "zo"] as const;

// ── Gedeelde bouwstenen ──────────────────────────────────────────────────────

type CandidateRow = Awaited<ReturnType<typeof candidateRows>>[number];

async function candidateRows(where: Parameters<typeof prisma.candidateRoster.findMany>[0]) {
  return prisma.candidateRoster.findMany({
    ...where,
    select: {
      id: true,
      scenarioLabel: true,
      optimizerVersion: true,
      generatedAt: true,
      validationState: true,
      validationSummary: true,
      sourceScheduleVersion: true,
      rulesetVersion: true,
      inputDataVersion: true,
      assignments: true,
      generationRunId: true,
      candidateNumber: true,
      parentCandidateId: true,
      preferred: true,
      archivedAt: true,
      locationCode: true,
      generationRun: { select: { strategy: true, strategyLabel: true, rosterYear: true, kind: true } },
    },
  });
}

interface Versies {
  readonly schedule: string;
  readonly input: string;
  readonly ruleset: string;
}

async function versiesVoor(locationCode: string): Promise<Versies> {
  const [schedule, input] = await Promise.all([scheduleVersion(locationCode), inputDataVersion(locationCode)]);
  return { schedule, input, ruleset: activeRuleset().version };
}

function strategieVan(row: CandidateRow): { key: string; label: string } {
  const key = row.generationRun?.strategy ?? row.optimizerVersion.split("+")[1] ?? "";
  const label =
    row.generationRun?.strategyLabel ?? SCENARIOS.find((scenario) => scenario.key === key)?.label ?? "Onbekende strategie";
  return { key, label };
}

function statusVan(
  state: string,
  stale: boolean,
  bevestigd: number | null,
  profielBevindingen = 0,
): { key: CandidateStatusKey; label: string; tone: StatusTone; detail: string } {
  // Strenger dan de eindvalidatie zelf; zie candidate-acceptance.ts.
  if (profielBevindingen > 0 && state !== "NOT_VALIDATED") {
    return {
      key: "NIET_BRUIKBAAR",
      label: "Niet bruikbaar",
      tone: "error",
      detail:
        `${profielBevindingen} dienst(en) buiten het roosterprofiel, bijvoorbeeld een vroege dienst in Laat/Nacht. ` +
        "De eindvalidatie meldt dit als mogelijke overtreding omdat de regel formeel nog niet is bevestigd; " +
        "het platform behandelt het als harde grens.",
    };
  }
  switch (state) {
    case "TAMPERED":
      return {
        key: "NIET_BRUIKBAAR",
        label: "Niet bruikbaar",
        tone: "error",
        detail: "De inhoud komt niet meer overeen met wat er is gegenereerd.",
      };
    case "CONFIRMED_HARD_VIOLATION":
      return {
        key: "NIET_BRUIKBAAR",
        label: "Niet bruikbaar",
        tone: "error",
        detail: `${bevestigd ?? "Een"} bevestigde harde overtreding${bevestigd === 1 ? "" : "en"}.`,
      };
    case "INVALID_STRUCTURE":
      return {
        key: "NIET_BRUIKBAAR",
        label: "Niet bruikbaar",
        tone: "error",
        detail: "Het rooster kon niet volledig worden beoordeeld.",
      };
    case "NOT_VALIDATED":
      return {
        key: "NIET_GETOETST",
        label: "Nog niet getoetst",
        tone: "neutral",
        detail: "Nog niet onafhankelijk gevalideerd.",
      };
  }
  if (!simulationEligible(state as CandidateValidationStatus)) {
    if (state.startsWith("STALE_")) {
      return {
        key: "VEROUDERD",
        label: "Verouderd",
        tone: "warn",
        detail: "Gebaseerd op oudere diensten of regels. Genereer opnieuw voor een actuele vergelijking.",
      };
    }
    return {
      key: "NIET_BRUIKBAAR",
      label: "Niet bruikbaar",
      tone: "neutral",
      detail: "Beoordeeld vóór de huidige indeling van validatie-uitkomsten.",
    };
  }
  if (stale) {
    return {
      key: "VEROUDERD",
      label: "Verouderd",
      tone: "warn",
      detail:
        "Gevalideerd op oudere diensten, roosterstructuur of regels. Bruikbaar als vergelijking; " +
        "genereer opnieuw voor een actuele kandidaat.",
    };
  }
  return {
    key: "GEREED",
    label: "Gereed",
    tone: "ok",
    detail:
      "0 bevestigde harde overtredingen." +
      (state === "TECHNICALLY_VALIDATED" ? "" : " De formele regelbron is nog niet volledig bevestigd."),
  };
}

function kaartVan(
  row: CandidateRow,
  quality: PackageQuality,
  versies: Versies,
  labels: ReadonlyMap<string, string>,
): CandidateCard {
  const samenvatting = row.validationSummary as {
    tally?: ReviewableRoster["tally"];
    uncertainties?: ReviewableRoster["uncertainties"];
    perRule?: ReviewableRoster["perRule"];
  } | null;
  const stale =
    row.sourceScheduleVersion !== versies.schedule ||
    row.rulesetVersion !== versies.ruleset ||
    row.inputDataVersion !== versies.input;
  const bevestigd = samenvatting?.tally?.confirmedHardViolations ?? null;
  const status = statusVan(row.validationState, stale, bevestigd, profileBoundFindings(samenvatting?.perRule));
  const regelbestand = activeRuleset();
  const strategie = strategieVan(row);
  const scores = { ...LEGE_SCORES };
  for (const subscore of quality.subscores) {
    scores[subscore.key] = subscore.score;
  }

  return {
    id: row.id,
    label: row.scenarioLabel,
    number: row.candidateNumber,
    strategyKey: strategie.key,
    strategyLabel: strategie.label,
    runId: row.generationRunId,
    rosterYear: row.generationRun?.rosterYear ?? null,
    kind: row.generationRun?.kind ?? null,
    generatedAt: row.generatedAt,
    status: status.key,
    statusLabel: status.label,
    statusTone: status.tone,
    statusDetail: status.detail,
    validationState: row.validationState,
    preferred: row.preferred,
    archived: row.archivedAt !== null,
    legacy: row.generationRunId === null && row.candidateNumber === null,
    parent: row.parentCandidateId
      ? { id: row.parentCandidateId, label: labels.get(row.parentCandidateId) ?? "Eerdere kandidaat" }
      : null,
    coverage: quality.coverage,
    confirmedHardViolations: bevestigd,
    uncertaintyGroups: samenvatting?.uncertainties?.length ?? null,
    publicationEligible: publicationEligible({
      status: row.validationState as CandidateValidationStatus,
      rulesetLegallyVerified: regelbestand.legalStatus === "LEGAL_RULESET_VERIFIED",
      missingRulePackages: regelbestand.missingPackages.length,
    }),
    stale,
    scores,
    averageHoursDeviationMinutes: quality.hours.averageAbsDeviationMinutes,
    maxHoursDeviationMinutes: quality.hours.maxAbsDeviationMinutes,
    nights: quality.nights,
    heavyTransitions: quality.transitions.heavy,
  };
}

function tegelVan(rooster: RosterQuality): RosterTile {
  return {
    code: rooster.code,
    name: rooster.name,
    profileLabel: rosterProfileLabel(rooster.profile as RosterProfile),
    lines: rooster.lineCount,
    averageWeek: formatHoursMinutes(rooster.hours.averageWeeklyCreditMinutes),
    deviationMinutes: rooster.hours.deviationFromTargetMinutes,
    early: rooster.totals.early,
    late: rooster.totals.late,
    night: rooster.totals.night,
    shunting: rooster.totals.shunting,
    weekendDuties: rooster.totals.weekendDuties,
    reserveDays: rooster.totals.reserveDays,
    nightBlocks: rooster.nights.blocks.map((block) => block.length),
    singleNights: rooster.nights.singletons,
    nightPairs: rooster.nights.pairs,
    heavyTransitions: rooster.transitions.heavy.length,
    stableShare: rooster.transitions.stableShare,
    shortestRestMinutes: rooster.rest.shortestMinutes,
  };
}

const RUN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  QUEUED: { label: "Genereren", tone: "info" },
  RUNNING: { label: "Genereren", tone: "info" },
  COMPLETED: { label: "Gereed", tone: "ok" },
  PARTIAL: { label: "Gereed, minder kandidaten", tone: "warn" },
  FAILED: { label: "Niet gelukt", tone: "error" },
  CANCELLED: { label: "Gestopt", tone: "neutral" },
  INTERRUPTED: { label: "Onderbroken", tone: "warn" },
};

export function runStatusLabel(status: string, stage: string | null): { label: string; tone: StatusTone } {
  if (status === "RUNNING" && stage?.startsWith("VALIDATE_")) {
    return { label: "Valideren", tone: "info" };
  }
  return RUN_STATUS[status] ?? { label: status, tone: "neutral" };
}

type RunRow = Awaited<ReturnType<typeof runRows>>[number];

async function runRows(locationCode: string, where: { strategy?: string; rosterYear?: number }) {
  return prisma.generationRun.findMany({
    where: { locationCode, ...where },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { adjustment: true },
  });
}

function runSamenvatting(run: RunRow, labels: ReadonlyMap<string, string>): RunSummary {
  const status = runStatusLabel(run.status, run.stage);
  const jaar = rosterYear(run.rosterYear);
  return {
    id: run.id,
    kind: run.kind,
    strategy: run.strategy,
    strategyLabel: run.strategyLabel,
    rosterYear: run.rosterYear,
    periodLabel: describeRosterYear(jaar),
    createdAt: run.createdAt,
    status: run.status,
    statusLabel: status.label,
    statusTone: status.tone,
    active: run.status === "QUEUED" || run.status === "RUNNING",
    requested: run.requestedCandidates,
    found: run.foundCandidates,
    failureReason: run.failureReason,
    stageMessage: run.stageMessage,
    parent: run.parentCandidateId
      ? { id: run.parentCandidateId, label: labels.get(run.parentCandidateId) ?? "Eerdere kandidaat" }
      : null,
    goals: (run.adjustment?.goals ?? []).map((goal) => REBUILD_GOAL_LABELS[goal as RebuildGoal] ?? goal),
    note: run.adjustment?.note ?? null,
  };
}

async function labelsVoor(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rijen = await prisma.candidateRoster.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, scenarioLabel: true },
  });
  return new Map(rijen.map((rij) => [rij.id, rij.scenarioLabel]));
}

// ── Overzicht ────────────────────────────────────────────────────────────────

export interface ResultsFilter {
  readonly strategy?: string | null;
  readonly rosterYear?: number | null;
  readonly status?: CandidateStatusKey | null;
  readonly archived?: boolean;
}

export interface ResultsOverview {
  readonly locationCode: string;
  readonly runs: readonly { readonly run: RunSummary; readonly candidates: readonly CandidateCard[] }[];
  readonly legacy: readonly CandidateCard[];
  readonly archivedCount: number;
  readonly strategies: readonly { readonly key: string; readonly label: string }[];
  readonly years: readonly number[];
  readonly official: Readonly<Record<SubscoreKey, number | null>>;
}

export async function resultsOverview(filter: ResultsFilter = {}): Promise<ResultsOverview> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, null);

  const [context, versies, runs, alleJaren] = await Promise.all([
    loadQualityContextCore(scope.code),
    versiesVoor(scope.code),
    runRows(scope.code, {
      ...(filter.strategy ? { strategy: filter.strategy } : {}),
      ...(filter.rosterYear ? { rosterYear: filter.rosterYear } : {}),
    }),
    prisma.generationRun.findMany({
      where: { locationCode: scope.code },
      distinct: ["rosterYear"],
      select: { rosterYear: true },
      orderBy: { rosterYear: "desc" },
    }),
  ]);

  const rows = await candidateRows({
    where: {
      OR: [{ locationCode: scope.code }, { locationCode: null }],
      ...(filter.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    },
    orderBy: [{ generatedAt: "desc" }],
    take: 120,
  });
  const archivedCount = await prisma.candidateRoster.count({
    where: { OR: [{ locationCode: scope.code }, { locationCode: null }], archivedAt: { not: null } },
  });
  const labels = await labelsVoor([
    ...rows.map((row) => row.parentCandidateId).filter((id): id is string => id !== null),
    ...runs.map((run) => run.parentCandidateId).filter((id): id is string => id !== null),
  ]);

  const kaarten = rows.map((row) =>
    kaartVan(row, measureAssignmentsCore(row.assignments as unknown as CandidateAssignment[], context), versies, labels),
  );
  const pastBij = (kaart: CandidateCard) =>
    (!filter.status || kaart.status === filter.status) &&
    (!filter.strategy || kaart.strategyKey === filter.strategy) &&
    (!filter.rosterYear || kaart.rosterYear === filter.rosterYear);

  const perRun = new Map<string, CandidateCard[]>();
  const legacy: CandidateCard[] = [];
  for (const kaart of kaarten.filter(pastBij)) {
    if (kaart.runId) {
      const lijst = perRun.get(kaart.runId) ?? [];
      lijst.push(kaart);
      perRun.set(kaart.runId, lijst);
    } else if (!filter.rosterYear) {
      legacy.push(kaart);
    }
  }

  const official = { ...LEGE_SCORES };
  for (const subscore of measureOfficialCore(context).subscores) {
    official[subscore.key] = subscore.score;
  }

  return {
    locationCode: scope.code,
    runs: runs
      .map((run) => ({
        run: runSamenvatting(run, labels),
        candidates: (perRun.get(run.id) ?? []).sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      }))
      // Met een statusfilter of in het archief tellen alleen opdrachten met
      // kandidaten die erop passen; anders ook de opdrachten zonder resultaat,
      // want "niet gelukt" is ook een uitkomst.
      .filter((groep) => groep.candidates.length > 0 || (!filter.status && !filter.archived)),
    legacy,
    archivedCount,
    strategies: SCENARIOS.map((scenario) => ({ key: scenario.key, label: scenario.label })),
    years: alleJaren.map((entry) => entry.rosterYear),
    official,
  };
}

// ── Eén kandidaat: het pakket ────────────────────────────────────────────────

export interface CandidatePackageView {
  readonly card: CandidateCard;
  readonly run: RunSummary | null;
  readonly subscores: readonly Subscore[];
  readonly official: readonly Subscore[];
  readonly rosters: readonly RosterTile[];
  readonly validation: {
    readonly state: string;
    readonly uncertainties: ReviewableRoster["uncertainties"];
    readonly reasons: ReviewableRoster["reasons"];
    readonly validatedAt: Date | null;
  };
  readonly lineage: {
    readonly parent: { readonly id: string; readonly label: string; readonly subscores: readonly Subscore[] } | null;
    readonly children: readonly { readonly id: string; readonly label: string; readonly generatedAt: Date; readonly statusLabel: string }[];
  };
  readonly changedFromOfficial: number | null;
  /**
   * Hoe de adaptieve zoekmachine aan deze kandidaat kwam, en waarom hij het
   * haalde. Leeg bij kandidaten uit de klassieke zoekmachine: die bewaren geen
   * herkomst, en er wordt er geen voor verzonnen.
   */
  readonly search: SearchOrigin | null;
}

export interface SearchOrigin {
  readonly mode: string | null;
  readonly modeLabel: string | null;
  readonly attempt: number | null;
  readonly seed: number | null;
  readonly ranking: number | null;
  readonly paretoFront: boolean;
  readonly qualityModelVersion: string | null;
  readonly optimizerModelVersion: string | null;
  /** Waarom deze kandidaat overbleef: drempels gehaald, concurrenten verslagen. */
  readonly whySurvived: readonly string[];
  /** Per zwak punt een uitleg met de maat en het getal erbij. */
  readonly explanations: readonly { readonly title: string; readonly detail: string }[];
  /** De weg ernaartoe: welke poging volgde op welke. */
  readonly lineage: readonly { readonly attempt: number; readonly kind: string; readonly target: string | null }[];
  /** De onderdelen van het kwaliteitsoordeel, zoals de evaluator ze berekende. */
  readonly components: readonly { readonly key: string; readonly label: string; readonly score: number | null }[];
  readonly worstLine: { readonly roster: string; readonly lineNumber: number; readonly score: number | null } | null;
  readonly robust: number | null;
}

const MODUS_LABELS: Record<string, string> = {
  FAST: "Snel",
  NORMAL: "Normaal",
  DEEP: "Grondig",
  EXTENSIVE: "Zeer grondig",
};

const COMPONENT_LABELS: Record<string, string> = {
  hours: "Uren",
  flow: "Regelmaat",
  rest: "Rust",
  nights: "Nachten",
  fairness: "Eerlijke verdeling",
  stability: "Aansluiting op het huidige rooster",
};

const tekstLijst = (waarde: unknown): readonly string[] =>
  Array.isArray(waarde) ? waarde.filter((item): item is string => typeof item === "string") : [];

const ZWAKTE_TITELS: Record<string, string> = {
  HEAVY_TRANSITION: "Zware overgang tussen dagdelen",
  SINGLETON_NIGHT: "Losse nachtdienst",
  TWO_NIGHT_BLOCK: "Nachtreeks van twee",
  HOURS_DEVIATION: "Afwijking van 40:00",
};

/**
 * Eén zwak punt in gewone taal.
 *
 * De zoekmachine legt een zwakte vast als feiten: welk rooster, welke regel,
 * wat er is gemeten en welke kostenpost er in de solver bij hoort. Hier wordt
 * daar een zin van. Er wordt niets bij bedacht: staat er geen feit, dan staat
 * er ook geen uitleg — een ruwe JSON-regel op het scherm is net zo onbruikbaar
 * als een verzonnen verklaring.
 */
function uitlegVan(item: Record<string, unknown>): { title: string; detail: string } {
  const soort = typeof item.kind === "string" ? item.kind : "";
  const plek = [
    typeof item.roster === "string" ? item.roster : null,
    typeof item.lineNumber === "number" ? `regel ${item.lineNumber}` : null,
  ]
    .filter((deel): deel is string => deel !== null)
    .join(" ");
  const feiten = tekstLijst(item.facts);
  const kosten = tekstLijst(item.activeSoftTerms);
  const zin = [plek, feiten.join("; ")].filter((deel) => deel.length > 0).join(" — ");
  return {
    title: ZWAKTE_TITELS[soort] ?? (soort.length > 0 ? soort.toLowerCase().replace(/_/g, " ") : "Toelichting"),
    detail:
      zin.length > 0
        ? `${zin}${kosten.length > 0 ? `. Meegewogen als: ${kosten.join(", ")}.` : "."}`
        : "Geen nadere gegevens vastgelegd.",
  };
}

const getalOfNull = (waarde: unknown): number | null =>
  typeof waarde === "number" && Number.isFinite(waarde) ? waarde : null;

/**
 * De herkomst zoals het scherm hem laat zien.
 *
 * Alles komt uit wat bij de kandidaat is opgeslagen. Ontbreekt een veld, dan
 * blijft het leeg: een uitleg verzinnen bij een kandidaat die er geen heeft, is
 * precies de schijnzekerheid die dit scherm moet vermijden.
 */
function zoekHerkomst(provenance: unknown, kwaliteit: unknown): SearchOrigin | null {
  if (!provenance || typeof provenance !== "object") {
    return null;
  }
  const p = provenance as Record<string, unknown>;
  // Het menselijke kwaliteitsrapport staat onder `human`; daarnaast bewaart
  // hetzelfde veld de oudere pakketmeting, die hier niet wordt getoond.
  const bron =
    kwaliteit && typeof kwaliteit === "object" && "human" in (kwaliteit as Record<string, unknown>)
      ? ((kwaliteit as Record<string, unknown>).human as unknown)
      : null;
  const rapport = (bron && typeof bron === "object" ? (bron as Record<string, unknown>) : {}) as {
    components?: Record<string, { score?: number | null }>;
    robust?: number | null;
    lines?: { worst?: { roster?: string; lineNumber?: number; score?: number | null } | null };
  };
  const mode = typeof p.mode === "string" ? p.mode : null;
  return {
    mode,
    modeLabel: mode ? (MODUS_LABELS[mode] ?? mode) : null,
    attempt: getalOfNull(p.attempt),
    seed: getalOfNull(p.seed),
    ranking: getalOfNull(p.ranking),
    paretoFront: p.paretoFront === true,
    qualityModelVersion: typeof p.qualityModelVersion === "string" ? p.qualityModelVersion : null,
    optimizerModelVersion: typeof p.optimizerModelVersion === "string" ? p.optimizerModelVersion : null,
    whySurvived: tekstLijst(p.whySurvived),
    explanations: Array.isArray(p.explanations)
      ? p.explanations
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map(uitlegVan)
      : [],
    lineage: Array.isArray(p.lineage)
      ? p.lineage
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => ({
            attempt: Number(item.attempt ?? 0),
            kind: String(item.kind ?? ""),
            target: typeof item.target === "string" ? item.target : null,
          }))
      : [],
    components: Object.entries(rapport.components ?? {}).map(([key, waarde]) => ({
      key,
      label: COMPONENT_LABELS[key] ?? key,
      score: getalOfNull(waarde?.score),
    })),
    worstLine: rapport.lines?.worst
      ? {
          roster: String(rapport.lines.worst.roster ?? ""),
          lineNumber: Number(rapport.lines.worst.lineNumber ?? 0),
          score: getalOfNull(rapport.lines.worst.score),
        }
      : null,
    robust: getalOfNull(rapport.robust),
  };
}

async function kandidaatInScope(candidateId: string) {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, null);
  const rows = await candidateRows({ where: { id: candidateId } });
  const row = rows[0];
  if (!row || (row.locationCode !== null && row.locationCode !== scope.code)) {
    throw new NotFoundError("Deze kandidaat bestaat niet (meer).");
  }
  return { row, locationCode: scope.code };
}

export async function candidatePackage(candidateId: string): Promise<CandidatePackageView> {
  const { row, locationCode } = await kandidaatInScope(candidateId);
  const [context, versies, volledig, kinderen, run] = await Promise.all([
    loadQualityContextCore(locationCode),
    versiesVoor(locationCode),
    prisma.candidateRoster.findUniqueOrThrow({
      where: { id: candidateId },
      select: { validatedAt: true, provenance: true, qualityMetrics: true },
    }),
    prisma.candidateRoster.findMany({
      where: { parentCandidateId: candidateId },
      orderBy: { generatedAt: "desc" },
      select: { id: true, scenarioLabel: true, generatedAt: true, validationState: true },
    }),
    row.generationRunId ? prisma.generationRun.findUnique({ where: { id: row.generationRunId }, include: { adjustment: true } }) : null,
  ]);
  const ouderRij = row.parentCandidateId ? (await candidateRows({ where: { id: row.parentCandidateId } }))[0] : null;
  const labels = new Map<string, string>(ouderRij ? [[ouderRij.id, ouderRij.scenarioLabel]] : []);

  const kwaliteit = measureAssignmentsCore(row.assignments as unknown as CandidateAssignment[], context);
  const samenvatting = row.validationSummary as {
    uncertainties?: ReviewableRoster["uncertainties"];
    reasons?: ReviewableRoster["reasons"];
  } | null;

  return {
    card: kaartVan(row, kwaliteit, versies, labels),
    run: run ? runSamenvatting(run, labels) : null,
    subscores: kwaliteit.subscores,
    official: measureOfficialCore(context).subscores,
    rosters: kwaliteit.rosters.map(tegelVan),
    validation: {
      state: row.validationState,
      uncertainties: samenvatting?.uncertainties ?? [],
      reasons: samenvatting?.reasons ?? { structural: [], violations: [], uncertainty: [], formal: [] },
      validatedAt: volledig.validatedAt,
    },
    lineage: {
      parent: ouderRij
        ? {
            id: ouderRij.id,
            label: ouderRij.scenarioLabel,
            subscores: measureAssignmentsCore(ouderRij.assignments as unknown as CandidateAssignment[], context).subscores,
          }
        : null,
      children: kinderen.map((kind) => ({
        id: kind.id,
        label: kind.scenarioLabel,
        generatedAt: kind.generatedAt,
        statusLabel: statusVan(kind.validationState, false, null).label,
      })),
    },
    changedFromOfficial: kwaliteit.changedDutyDays,
    search: zoekHerkomst(volledig.provenance, volledig.qualityMetrics),
  };
}

// ── Eén basisrooster uit een kandidaat ───────────────────────────────────────

export interface ViewerCell {
  readonly weekday: number;
  /** Precies wat het roosterblad in deze cel zet. */
  readonly code: string;
  readonly timeRange: string | null;
  readonly duration: string | null;
  readonly positionType: string;
  readonly category: TransitionCategory | null;
  readonly shunting: boolean;
  readonly reserveDuty: boolean;
  /** De dienst eindigt de volgende kalenderdag. */
  readonly overnight: boolean;
  /** Lengte van de nachtreeks waar deze nacht in staat. */
  readonly nightBlockLength: number | null;
  readonly heavyTransition: {
    readonly toCode: string;
    readonly label: string;
    readonly overOffDay: boolean;
  } | null;
  readonly heavyTransitionTarget: boolean;
}

export interface ViewerLine {
  readonly lineNumber: number;
  readonly hours: string;
  readonly creditMinutes: number;
  readonly early: number;
  readonly late: number;
  readonly night: number;
  readonly shunting: number;
  readonly weekendDuties: number;
  readonly cells: readonly ViewerCell[];
}

export interface CandidateRosterView {
  readonly candidate: CandidateCard;
  readonly roster: RosterTile;
  readonly lines: readonly ViewerLine[];
  readonly nightBlocks: readonly { readonly startLine: number; readonly startWeekday: number; readonly length: number }[];
  readonly heavyTransitions: readonly {
    readonly lineNumber: number;
    readonly weekday: number;
    readonly fromCode: string;
    readonly toCode: string;
    readonly label: string;
    readonly overOffDay: boolean;
  }[];
  readonly rest: RosterQuality["rest"];
  readonly otherRosters: readonly { readonly code: string; readonly name: string }[];
}

export async function candidateRosterView(candidateId: string, rosterCode: string): Promise<CandidateRosterView> {
  const { row, locationCode } = await kandidaatInScope(candidateId);
  const [context, versies, blad] = await Promise.all([
    loadQualityContextCore(locationCode),
    versiesVoor(locationCode),
    // Dezelfde bladregels als de PDF: wat in een cel staat, komt hier vandaan.
    buildCandidateSheet(candidateId, rosterCode),
  ]);
  const toewijzingen = row.assignments as unknown as CandidateAssignment[];
  const kwaliteit = measureAssignmentsCore(toewijzingen, context);
  const rooster = kwaliteit.rosters.find((entry) => entry.code === rosterCode);
  if (!rooster) {
    throw new NotFoundError(`Deze kandidaat bevat geen rooster ${rosterCode}.`);
  }
  const ouderRij = row.parentCandidateId ? (await candidateRows({ where: { id: row.parentCandidateId } }))[0] : null;
  const labels = new Map<string, string>(ouderRij ? [[ouderRij.id, ouderRij.scenarioLabel]] : []);

  const vanRooster = toewijzingen.filter((entry) => entry.baseRosterCode === rosterCode);
  const regels = [...new Set(vanRooster.map((entry) => entry.lineNumber))].sort((a, b) => a - b);
  const plek = new Map(regels.map((regel, index) => [regel, index]));
  const n = regels.length * 7;
  const indexVan = (regel: number, weekdag: number) => (plek.get(regel) ?? 0) * 7 + (weekdag - 1);

  const reeksPerIndex = new Map<number, number>();
  for (const blok of rooster.nights.blocks) {
    for (let stap = 0; stap < blok.length; stap += 1) {
      reeksPerIndex.set((blok.startIndex + stap) % n, blok.length);
    }
  }
  const zwaarVanaf = new Map<number, (typeof rooster.transitions.heavy)[number]>();
  const zwaarNaar = new Set<number>();
  for (const bevinding of rooster.transitions.heavy) {
    const van = indexVan(bevinding.lineNumber, bevinding.weekday);
    zwaarVanaf.set(van, bevinding);
    zwaarNaar.add((van + (bevinding.overOffDay ? 2 : 1)) % n);
  }

  const lijnLast = new Map(rooster.lines.map((line) => [line.lineNumber, line]));
  const lines: ViewerLine[] = blad.sheet.lines.map((bladRegel) => {
    const last = lijnLast.get(bladRegel.lineNumber);
    return {
      lineNumber: bladRegel.lineNumber,
      hours: bladRegel.hoursIncludingBreak,
      creditMinutes: last?.creditMinutes ?? 0,
      early: last?.early ?? 0,
      late: last?.late ?? 0,
      night: last?.night ?? 0,
      shunting: last?.shunting ?? 0,
      weekendDuties: last?.weekendDuties ?? 0,
      cells: bladRegel.cells.map((cel, positie) => {
        const weekdag = positie + 1;
        const dag = vanRooster.find(
          (entry) => entry.lineNumber === bladRegel.lineNumber && entry.weekIndex === 1 && entry.weekday === weekdag,
        );
        const dienst =
          dag?.positionType === "DUTY" && dag.dutyCode ? context.duties.get(`${dag.dutyCode}|${weekdag}`) : undefined;
        const index = indexVan(bladRegel.lineNumber, weekdag);
        const zwaar = zwaarVanaf.get(index);
        const categorie = dienst
          ? dienst.kinds.includes("NACHT")
            ? "NIGHT"
            : dienst.kinds.includes("LAAT")
              ? "LATE"
              : dienst.kinds.includes("VROEG")
                ? "EARLY"
                : null
          : null;
        return {
          weekday: weekdag,
          code: cel.code,
          timeRange: cel.timeRange,
          duration: cel.duration,
          positionType: dag?.positionType ?? "ONBEKEND",
          category: categorie,
          shunting: dienst?.kinds.includes("RANGEER") ?? false,
          reserveDuty: dienst?.kinds.includes("RESERVE") ?? false,
          overnight: dienst ? dienst.endMinute > 1440 : false,
          nightBlockLength: categorie === "NIGHT" ? (reeksPerIndex.get(index) ?? null) : null,
          heavyTransition: zwaar
            ? {
                toCode: zwaar.toCode,
                label: overgangLabel(zwaar.from, zwaar.to, zwaar.overOffDay),
                overOffDay: zwaar.overOffDay,
              }
            : null,
          heavyTransitionTarget: zwaarNaar.has(index),
        };
      }),
    };
  });

  const alleRoosters = kwaliteit.rosters.map((entry) => ({ code: entry.code, name: entry.name }));
  return {
    candidate: kaartVan(row, kwaliteit, versies, labels),
    roster: tegelVan(rooster),
    lines,
    nightBlocks: rooster.nights.blocks.map((blok) => ({
      startLine: blok.startLine,
      startWeekday: blok.startWeekday,
      length: blok.length,
    })),
    heavyTransitions: rooster.transitions.heavy.map((bevinding) => ({
      lineNumber: bevinding.lineNumber,
      weekday: bevinding.weekday,
      fromCode: bevinding.fromCode,
      toCode: bevinding.toCode,
      label: overgangLabel(bevinding.from, bevinding.to, bevinding.overOffDay),
      overOffDay: bevinding.overOffDay,
    })),
    rest: rooster.rest,
    otherRosters: alleRoosters,
  };
}

function overgangLabel(van: TransitionCategory, naar: TransitionCategory, overVrij: boolean): string {
  return `${TRANSITION_CATEGORY_LABELS[van]} → ${overVrij ? "vrij → " : ""}${TRANSITION_CATEGORY_LABELS[naar]}`;
}

// ── Kandidaten naast elkaar ──────────────────────────────────────────────────

export interface CandidateComparison {
  readonly candidates: readonly CandidateCard[];
  readonly subscores: readonly {
    readonly key: SubscoreKey;
    readonly label: string;
    readonly explanation: string;
    readonly values: readonly (number | null)[];
    readonly official: number | null;
    /** Alleen wanneer precies één kandidaat het hoogst scoort. */
    readonly highestIndex: number | null;
  }[];
  readonly hints: readonly string[];
  readonly rosters: readonly {
    readonly code: string;
    readonly name: string;
    readonly official: RosterTile | null;
    readonly perCandidate: readonly (RosterTile | null)[];
  }[];
  readonly differences: readonly { readonly a: number; readonly b: number; readonly changedDutyDays: number }[];
  readonly heavyTransitions: readonly (readonly {
    readonly rosterCode: string;
    readonly lineNumber: number;
    readonly weekday: number;
    readonly fromCode: string;
    readonly toCode: string;
    readonly label: string;
  }[])[];
}

export const MAX_COMPARED = 3;

export async function compareCandidates(candidateIds: readonly string[]): Promise<CandidateComparison> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, null);
  const ids = [...new Set(candidateIds)].slice(0, MAX_COMPARED);
  const rijen = await candidateRows({
    where: { id: { in: ids }, OR: [{ locationCode: scope.code }, { locationCode: null }] },
  });
  const rows = ids.map((id) => rijen.find((row) => row.id === id)).filter((row): row is CandidateRow => Boolean(row));
  if (rows.length === 0) {
    throw new NotFoundError("Geen van deze kandidaten bestaat (nog).");
  }
  const [context, versies] = await Promise.all([loadQualityContextCore(scope.code), versiesVoor(scope.code)]);
  const labels = await labelsVoor(rows.map((row) => row.parentCandidateId).filter((id): id is string => id !== null));

  const kwaliteiten = rows.map((row) => measureAssignmentsCore(row.assignments as unknown as CandidateAssignment[], context));
  const officieel = measureOfficialCore(context);
  const kaarten = rows.map((row, index) => kaartVan(row, kwaliteiten[index], versies, labels));

  const subscores = officieel.subscores.map((referentie) => {
    const values = kwaliteiten.map(
      (kwaliteit) => kwaliteit.subscores.find((entry) => entry.key === referentie.key)?.score ?? null,
    );
    const getallen = values.filter((value): value is number => value !== null);
    const hoogste = getallen.length > 0 ? Math.max(...getallen) : null;
    const metHoogste = values.filter((value) => value === hoogste).length;
    return {
      key: referentie.key,
      label: referentie.label,
      explanation: referentie.explanation,
      values,
      official: referentie.score,
      highestIndex: rows.length > 1 && hoogste !== null && metHoogste === 1 ? values.indexOf(hoogste) : null,
    };
  });

  const naam = (index: number) => {
    const kaart = kaarten[index];
    return kaart.kind === "REBUILD" ? `Herbouw (${kaart.label})` : kaart.number !== null ? `Kandidaat ${kaart.number}` : kaart.label;
  };
  const hints = subscores
    .filter((entry) => entry.highestIndex !== null)
    .map((entry) => `Hoogste score op ${entry.label.toLowerCase()}: ${naam(entry.highestIndex!)}`);

  const codes = officieel.rosters.map((rooster) => ({ code: rooster.code, name: rooster.name }));
  const verschillen: { a: number; b: number; changedDutyDays: number }[] = [];
  for (let a = 0; a < rows.length; a += 1) {
    for (let b = a + 1; b < rows.length; b += 1) {
      verschillen.push({
        a,
        b,
        changedDutyDays: aantalVerschillend(
          rows[a].assignments as unknown as CandidateAssignment[],
          rows[b].assignments as unknown as CandidateAssignment[],
        ),
      });
    }
  }

  return {
    candidates: kaarten,
    subscores,
    hints,
    rosters: codes.map(({ code, name }) => ({
      code,
      name,
      official: tegelOf(officieel, code),
      perCandidate: kwaliteiten.map((kwaliteit) => tegelOf(kwaliteit, code)),
    })),
    differences: verschillen,
    heavyTransitions: kwaliteiten.map((kwaliteit) =>
      kwaliteit.rosters.flatMap((rooster) =>
        rooster.transitions.heavy.map((bevinding) => ({
          rosterCode: rooster.code,
          lineNumber: bevinding.lineNumber,
          weekday: bevinding.weekday,
          fromCode: bevinding.fromCode,
          toCode: bevinding.toCode,
          label: overgangLabel(bevinding.from, bevinding.to, bevinding.overOffDay),
        })),
      ),
    ),
  };
}

function tegelOf(kwaliteit: PackageQuality, code: string): RosterTile | null {
  const rooster = kwaliteit.rosters.find((entry) => entry.code === code);
  return rooster ? tegelVan(rooster) : null;
}

function aantalVerschillend(a: readonly CandidateAssignment[], b: readonly CandidateAssignment[]): number {
  const sleutel = (entry: CandidateAssignment) =>
    `${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|${entry.weekday}`;
  const van = new Map(a.filter((entry) => entry.positionType === "DUTY").map((entry) => [sleutel(entry), entry.dutyCode]));
  let anders = 0;
  for (const entry of b) {
    if (entry.positionType === "DUTY" && van.get(sleutel(entry)) !== entry.dutyCode) {
      anders += 1;
    }
  }
  return anders;
}

/** De strategieën met hun tegelindeling, voor het generatiescherm. */
export function strategyTiles() {
  return SCENARIOS.map((scenario) => ({
    key: scenario.key,
    label: scenario.label,
    description: scenario.description,
    primary: scenario.primary,
    candidates: scenario.engine === "BASELINE" ? 1 : 3,
  }));
}

export type { QualityContext };

/** De kandidaten van één generatieopdracht, voor "vergelijken met de andere kandidaten". */
export async function candidateIdsForRun(runId: string): Promise<readonly string[]> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, null);
  const run = await prisma.generationRun.findUnique({
    where: { id: runId },
    select: { locationCode: true, candidates: { where: { archivedAt: null }, orderBy: { candidateNumber: "asc" }, select: { id: true } } },
  });
  if (!run || run.locationCode !== scope.code) {
    throw new NotFoundError("Deze generatieopdracht bestaat niet.");
  }
  return run.candidates.map((candidate) => candidate.id);
}
