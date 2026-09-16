import "server-only";
import { createHash } from "node:crypto";
import { DutyPackageStatus, RosterVersionStatus } from "@/lib/generated/prisma/enums";
import type { FeedbackCategory, RosterProfile } from "@/lib/generated/prisma/enums";
import type {
  CandidateAssignment,
  CandidateRoster,
  CandidateValidationStatus,
  ReviewableRoster,
} from "@/domain/candidate";
import { publicationEligible, simulationEligible } from "@/domain/candidate";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { toJson } from "@/server/data/json";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import type { RuleDefinition } from "@/server/rules-engine/ruleset/types";
import {
  type CandidateValidationContext,
  nextMonday,
  validateCandidate,
} from "@/server/rules-engine/final-validator";
import { prismaCandidateData } from "@/server/rules-engine/final-validator-data";
import { requirePermission } from "@/server/security/authorize";
import type { Actor } from "@/server/auth/session";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import { BaselineOptimizer, type BaselineStrategy } from "@/server/optimizer/baseline-optimizer";
import {
  type CpSatOutcomeExtras,
  CpSatOptimizer,
  SCENARIO_PROFILES,
  type ScenarioProfile,
} from "@/server/optimizer/cpsat-optimizer";
import { compareRosters, type RosterComparison } from "@/server/optimizer/comparison";
import { dutyIndex } from "@/server/optimizer/metrics";
import type {
  AggregatedFeedback,
  OptimizerConstraint,
  OptimizerDuty,
  OptimizerInput,
  OptimizerLine,
} from "@/server/optimizer/contract";
import { rankCandidates, type RankedCandidate } from "@/server/optimizer/ranking";

/**
 * De simulatiedienst: genereren, bewaren, onafhankelijk laten toetsen.
 *
 * ## Waar de optimizer wél en niet bij kan
 *
 * De optimizer is een zuivere functie. Hij krijgt een invoerobject en geeft een
 * kandidaat terug; hij heeft geen databaseverbinding en kan er dus ook geen
 * misbruik van maken. Alleen deze laag schrijft, en uitsluitend naar
 * `candidate_rosters`. Een fout in een optimizer kan daardoor een verkeerd
 * vóórstel opleveren en nooit een verkeerde roosterdag.
 *
 * Voor productie hoort daar nog een databaserol bij die alleen op die tabel mag
 * schrijven. Dat is een inrichtingsstap buiten deze codebase; de scheiding in
 * de code staat er nu al, en een test bewaakt haar.
 */

const OPTIMIZER_MODE = "SIMULATION" as const;

export type ScenarioKey = BaselineStrategy | ScenarioProfile;

export interface SimulationScenario {
  readonly key: ScenarioKey;
  readonly label: string;
  readonly description: string;
  /**
   * Wie het scenario maakt. De nulmeting neemt het bestaande rooster over; de
   * overige scenario's laten de constraint solver alle roosters tegelijk
   * herverdelen. Beide leveren een kandidaat op die daarna hetzelfde pad volgt.
   */
  readonly engine: "BASELINE" | "SOLVER";
}

export const SCENARIOS: readonly SimulationScenario[] = [
  {
    key: "REPRODUCE",
    label: "Nulmeting",
    description:
      "Neemt het bestaande rooster letterlijk over. Wat de validator hierover zegt, " +
      "geldt dus ook voor het rooster dat nu draait.",
    engine: "BASELINE",
  },
  {
    key: "BALANCE_SHUNTING",
    label: "Rangeerbelasting gelijker verdelen",
    description:
      "Wisselt rangeerdiensten tussen lijnen van hetzelfde basisrooster tot het " +
      "verschil tussen de zwaarste en de lichtste lijn hooguit één dienst is.",
    engine: "BASELINE",
  },
  ...SCENARIO_PROFILES.map((profile) => ({
    key: profile.key as ScenarioKey,
    label: profile.label,
    description: profile.description,
    engine: "SOLVER" as const,
  })),
];

/**
 * De rekentijd per scenario.
 *
 * Stond op 30 seconden. Sinds volledige dekking een harde eis is in plaats van
 * een kostenpost, moet de oplosser een compleet rooster vínden voordat hij iets
 * mag verbeteren, en dat lukte binnen 30 seconden niet altijd — op een machine
 * die tegelijk iets anders doet kwam er dan "geen afgerond scenario gevonden"
 * uit terwijl er wel degelijk een rooster bestaat. Eén zoekdraad is een bewuste
 * keuze (twee runs met dezelfde invoer moeten hetzelfde opleveren), dus de
 * ruimte moet uit de klok komen.
 */
const SOLVER_TIME_LIMIT_SECONDS = Number(process.env.NS_SOLVER_SECONDS ?? 60);

// ── Genereren ────────────────────────────────────────────────────────────────

export async function generateCandidate(
  strategy: ScenarioKey,
  requestedLocation?: string | null,
): Promise<CandidateRoster> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, requestedLocation);
  const input = await buildOptimizerInput(scope.code);
  const scenario = SCENARIOS.find((entry) => entry.key === strategy);
  const label = scenario?.label ?? strategy;

  // Twee motoren, één pad erna. Welke van de twee het voorstel maakte, doet
  // voor de validatie niets af: hij wordt hoe dan ook opnieuw doorgerekend.
  let extras: CpSatOutcomeExtras | null = null;
  let outcome;
  if (scenario?.engine === "SOLVER") {
    const profiel = SCENARIO_PROFILES.find((entry) => entry.key === strategy);
    if (!profiel) {
      throw new Error(`Onbekend scenario: ${strategy}`);
    }
    const optimizer = new CpSatOptimizer(profiel, SOLVER_TIME_LIMIT_SECONDS, profiel.key === "MINIMAL_CHANGE");
    outcome = await optimizer.generate(input, label);
    extras = optimizer.lastExtras;
  } else {
    outcome = await new BaselineOptimizer(strategy as BaselineStrategy).generate(input, label);
  }

  if (outcome.status === "REFUSED") {
    await recordAudit({
      actor,
      action: "simulatie.generatie-geweigerd",
      objectType: "CandidateRoster",
      result: "FAILED",
      reason: outcome.reason,
      newValue: {
        strategy,
        solverStatus: extras?.solverStatus ?? null,
        knelpunten: extras?.diagnostics ?? [],
      },
    });
    throw new Error(outcome.reason);
  }

  const candidate = outcome.candidate;

  await prisma.candidateRoster.create({
    data: {
      id: candidate.id,
      locationCode: scope.code,
      scenarioLabel: candidate.scenarioLabel,
      optimizerName: candidate.optimizerName,
      optimizerVersion: candidate.optimizerVersion,
      mode: candidate.mode,
      legalStatus: candidate.legalStatus,
      sourceScheduleVersion: candidate.sourceScheduleVersion,
      rulesetVersion: candidate.rulesetVersion,
      inputDataVersion: candidate.inputDataVersion,
      hash: candidate.hash,
      generatedAt: new Date(candidate.generatedAt),
      generatedByUserId: actor.userId,
      assignments: toJson([...candidate.assignments]),
      scoreBreakdown: toJson({ ...candidate.scoreBreakdown }),
      solverRun: extras ? toJson({ ...extras }) : undefined,
    },
  });

  await recordAudit({
    actor,
    action: "simulatie.kandidaat-gegenereerd",
    objectType: "CandidateRoster",
    objectId: candidate.id,
    result: "SUCCESS",
    reason: `Scenario ${candidate.scenarioLabel}`,
    // Geen persoonsgegevens: versies, scores en modus, verder niets.
    newValue: {
      optimizer: `${candidate.optimizerName}@${candidate.optimizerVersion}`,
      sourceScheduleVersion: candidate.sourceScheduleVersion,
      rulesetVersion: candidate.rulesetVersion,
      inputDataVersion: candidate.inputDataVersion,
      overallQualityScore: candidate.scoreBreakdown.overallQualityScore,
      mode: candidate.mode,
      assignments: candidate.assignments.length,
      standplaats: scope.code,
      solverStatus: extras?.solverStatus ?? "n.v.t.",
      optimaliteitBewezen: extras?.optimal ?? null,
      rekentijdSeconden: extras?.wallTimeSeconds ?? null,
      zaadwaarde: extras?.seed ?? null,
      dienstenVerantwoord: extras
        ? extras.accounting.fixedRoster +
          extras.accounting.operationalPool.length +
          extras.accounting.unassignable.length
        : null,
    },
  });

  return candidate;
}

/**
 * De standplaats waar een opgeslagen kandidaat over gaat.
 *
 * Valt terug op de standplaats van de kijker wanneer de kandidaat er geen
 * draagt — die kandidaten stammen van vóór de landelijke standplaatsstructuur,
 * toen er één standplaats was ingericht.
 */
async function locationOfCandidate(candidateId: string, actor: Actor): Promise<string> {
  const row = await prisma.candidateRoster.findUnique({
    where: { id: candidateId },
    select: { locationCode: true },
  });
  const scope = await locationScopeFor(actor, row?.locationCode ?? null);
  return row?.locationCode ?? scope.code;
}

// ── Onafhankelijk valideren ──────────────────────────────────────────────────

export async function validateStoredCandidate(candidateId: string): Promise<ReviewableRoster> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const candidate = await loadCandidate(candidateId);
  const standplaats = await locationOfCandidate(candidateId, actor);

  const context: CandidateValidationContext = {
    sourceScheduleVersion: await scheduleVersion(standplaats),
    rulesetVersion: activeRuleset().version,
    inputDataVersion: await inputDataVersion(standplaats),
    anchorMonday: nextMonday(),
  };

  const review = await validateCandidate(candidate, context, prismaCandidateData);

  await prisma.candidateRoster.update({
    where: { id: candidateId },
    data: {
      validationState: review.status,
      validatedAt: new Date(review.validatedAt),
      validationSummary: toJson({
        tally: { ...review.tally },
        perRule: review.perRule.map((entry) => ({ ...entry })),
        uncertainties: review.uncertainties.map((entry) => ({ ...entry })),
        reasons: {
          structural: [...review.reasons.structural],
          violations: [...review.reasons.violations],
          uncertainty: [...review.reasons.uncertainty],
          formal: [...review.reasons.formal],
        },
        blockingReasons: [...review.blockingReasons],
        simulationEligible: review.simulationEligible,
        publishable: review.publishable,
        rulesetVersionAtValidation: review.rulesetVersionAtValidation,
      }),
    },
  });

  await recordAudit({
    actor,
    action: "simulatie.kandidaat-gevalideerd",
    objectType: "CandidateRoster",
    objectId: candidateId,
    result: review.status === "TECHNICALLY_VALIDATED" ? "SUCCESS" : "FAILED",
    reason: review.blockingReasons[0] ?? "Geen blokkerende bevindingen.",
    newValue: {
      status: review.status,
      legalStatus: review.legalStatus,
      publishable: review.publishable,
      rulesetVersionAtValidation: review.rulesetVersionAtValidation,
      ...review.tally,
    },
  });

  return review;
}

export async function discardCandidate(candidateId: string): Promise<void> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const candidate = await prisma.candidateRoster.findUnique({
    where: { id: candidateId },
    select: { scenarioLabel: true },
  });
  await prisma.candidateRoster.delete({ where: { id: candidateId } });

  await recordAudit({
    actor,
    action: "simulatie.kandidaat-verworpen",
    objectType: "CandidateRoster",
    objectId: candidateId,
    result: "SUCCESS",
    reason: `Scenario ${candidate?.scenarioLabel ?? candidateId} verworpen door de planner.`,
  });
}

// ── Vastleggen als roosterversie ────────────────────────────────────────────

export interface PromotedVersion {
  readonly baseRosterCode: string;
  readonly baseRosterId: string;
  readonly versionId: string;
  readonly label: string;
  readonly dutyDays: number;
}

export interface PromotionResult {
  readonly versions: readonly PromotedVersion[];
  /** Basisroostercodes uit de kandidaat waarvoor geen basisrooster (meer) bestaat. */
  readonly skippedBaseRosterCodes: readonly string[];
}

/**
 * Een technisch gevalideerde kandidaat vastleggen als roosterversie(s).
 *
 * ## Waarom dit geen publicatie is
 *
 * Er ontstaat hier een `RosterVersion` met status `GENERATED` — zichtbaar
 * onder Roosterversies en bruikbaar in Scenario's vergelijken, maar niet
 * gepubliceerd. Publiceren is en blijft een aparte, expliciete handeling
 * (`publishVersion`) die de planner apart uitvoert. Deze functie kan dat
 * bewust niet: hij schrijft nooit `PUBLISHED`.
 *
 * ## Waarom hier geen gemiddelde-urenberekening staat
 *
 * Een eerlijke "gemiddelde uren na generatie" telt WTV mee als 8:00 en Rust
 * als geen werk — dat rekenwerk hoort bij de roosterstructuur (`StructureTargets`
 * / `proposeStructure`) en gebeurt per basisrooster over de volle cyclus, nooit
 * gemengd. Dat op dit punt zelf benaderen zonder die WTV/Rust-boekhouding erbij
 * te betrekken, zou een getal opleveren dat overtuigend oogt en toch niet klopt
 * — precies het soort schijnbewijs dat deze fase juist moet uitsluiten. Wat hier
 * wél wordt vastgelegd, zijn de tellingen die rechtstreeks en zonder aanname uit
 * de toewijzingen zelf volgen.
 */
export async function promoteCandidateToVersions(
  candidateId: string,
  rosterYearLabel: string,
): Promise<PromotionResult> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const row = await prisma.candidateRoster.findUnique({ where: { id: candidateId } });
  if (!row) {
    throw new Error(`Onbekende kandidaat: ${candidateId}`);
  }
  if (row.validationState !== "TECHNICALLY_VALIDATED") {
    throw new Error(
      "Deze kandidaat is niet (of niet met een positieve uitkomst) door de onafhankelijke " +
        "eindvalidatie gehaald en kan daarom niet als roosterversie worden vastgelegd.",
    );
  }

  const assignments = row.assignments as unknown as readonly CandidateAssignment[];
  const scoreBreakdown = row.scoreBreakdown as unknown as CandidateRoster["scoreBreakdown"];

  const byRosterCode = new Map<string, CandidateAssignment[]>();
  for (const assignment of assignments) {
    const list = byRosterCode.get(assignment.baseRosterCode);
    if (list) {
      list.push(assignment);
    } else {
      byRosterCode.set(assignment.baseRosterCode, [assignment]);
    }
  }

  const baseRosters = await prisma.baseRoster.findMany({
    where: { code: { in: [...byRosterCode.keys()] } },
    select: { id: true, code: true },
  });
  const baseRosterIdByCode = new Map(baseRosters.map((entry) => [entry.code, entry.id]));

  const versions: PromotedVersion[] = [];
  const skipped: string[] = [];

  for (const [code, days] of byRosterCode) {
    const baseRosterId = baseRosterIdByCode.get(code);
    if (!baseRosterId) {
      // Een kandidaat kan een basisroostercode dragen die inmiddels is
      // hernoemd of verwijderd. Dat is geen reden om de rest van de
      // opdracht stil te laten mislukken — de andere basisroosters worden
      // gewoon vastgelegd, en deze code komt terug in het resultaat.
      skipped.push(code);
      continue;
    }

    const label = `${row.scenarioLabel} · ${rosterYearLabel}`;
    const perLineCounts = countsByLine(days);

    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.rosterVersion.upsert({
        where: { baseRosterId_label: { baseRosterId, label } },
        create: {
          baseRosterId,
          label,
          status: RosterVersionStatus.GENERATED,
          generatedAt: row.generatedAt,
          generatedByUserId: actor.userId,
          parameters: toJson({
            candidateId: row.id,
            scenarioLabel: row.scenarioLabel,
            rosterYear: rosterYearLabel,
            optimizerName: row.optimizerName,
            optimizerVersion: row.optimizerVersion,
            sourceScheduleVersion: row.sourceScheduleVersion,
            rulesetVersion: row.rulesetVersion,
            inputDataVersion: row.inputDataVersion,
            candidateHash: row.hash,
          }),
          metrics: toJson({
            overallQualityScore: scoreBreakdown.overallQualityScore,
            scoreBreakdown: { ...scoreBreakdown },
            perLine: perLineCounts,
          }),
          engineName: row.optimizerName,
          engineVersion: row.optimizerVersion,
        },
        update: {
          status: RosterVersionStatus.GENERATED,
          generatedAt: row.generatedAt,
          generatedByUserId: actor.userId,
          parameters: toJson({
            candidateId: row.id,
            scenarioLabel: row.scenarioLabel,
            rosterYear: rosterYearLabel,
            optimizerName: row.optimizerName,
            optimizerVersion: row.optimizerVersion,
            sourceScheduleVersion: row.sourceScheduleVersion,
            rulesetVersion: row.rulesetVersion,
            inputDataVersion: row.inputDataVersion,
            candidateHash: row.hash,
          }),
          metrics: toJson({
            overallQualityScore: scoreBreakdown.overallQualityScore,
            scoreBreakdown: { ...scoreBreakdown },
            perLine: perLineCounts,
          }),
          engineName: row.optimizerName,
          engineVersion: row.optimizerVersion,
        },
      });

      // Een versie die opnieuw wordt vastgelegd (dezelfde basisroostercode,
      // hetzelfde scenario, hetzelfde roosterjaar) krijgt de dagen van déze
      // kandidaat. De oude dagen horen daarbij niet te blijven staan.
      await tx.rosterVersionDay.deleteMany({ where: { versionId: created.id } });
      await tx.rosterVersionDay.createMany({
        data: days.map((day) => ({
          versionId: created.id,
          lineNumber: day.lineNumber,
          weekIndex: day.weekIndex,
          weekday: day.weekday,
          positionType: day.positionType,
          dutyCode: day.dutyCode,
        })),
      });

      return created;
    });

    versions.push({
      baseRosterCode: code,
      baseRosterId,
      versionId: version.id,
      label,
      dutyDays: days.filter((day) => day.positionType === "DUTY").length,
    });
  }

  await recordAudit({
    actor,
    action: "rooster.kandidaat-vastgelegd-als-versie",
    objectType: "RosterVersion",
    result: versions.length > 0 ? "SUCCESS" : "FAILED",
    reason: `Kandidaat ${row.scenarioLabel} vastgelegd als ${versions.length} roosterversie(s)` +
      (skipped.length > 0 ? `; overgeslagen (onbekend basisrooster): ${skipped.join(", ")}.` : "."),
    newValue: {
      candidateId: row.id,
      rosterYear: rosterYearLabel,
      versions: versions.map((entry) => ({
        baseRosterCode: entry.baseRosterCode,
        versionId: entry.versionId,
        dutyDays: entry.dutyDays,
      })),
      skippedBaseRosterCodes: skipped,
    },
  });

  return { versions, skippedBaseRosterCodes: skipped };
}

function countsByLine(days: readonly CandidateAssignment[]): readonly {
  readonly lineNumber: number;
  readonly dutyDays: number;
  readonly reserveDays: number;
  readonly wtvDays: number;
  readonly compensationDays: number;
  readonly restDays: number;
}[] {
  const byLine = new Map<number, CandidateAssignment[]>();
  for (const day of days) {
    const list = byLine.get(day.lineNumber);
    if (list) {
      list.push(day);
    } else {
      byLine.set(day.lineNumber, [day]);
    }
  }
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lineNumber, lineDays]) => ({
      lineNumber,
      dutyDays: lineDays.filter((day) => day.positionType === "DUTY").length,
      reserveDays: lineDays.filter((day) => day.positionType === "RES").length,
      wtvDays: lineDays.filter((day) => day.positionType === "WR").length,
      compensationDays: lineDays.filter((day) => day.positionType === "CO").length,
      restDays: lineDays.filter((day) => day.positionType === "RUST").length,
    }));
}

// ── Lezen ────────────────────────────────────────────────────────────────────

export interface CandidateSummary {
  readonly id: string;
  readonly scenarioLabel: string;
  readonly optimizer: string;
  readonly generatedAt: Date;
  readonly mode: string;
  readonly legalStatus: string;
  readonly validationState: string;
  readonly validatedAt: Date | null;
  readonly overallQualityScore: number;
  /**
   * Hoeveel dienstdagen dit scenario werkelijk heeft toegewezen, en hoeveel er
   * leeg bleven.
   *
   * Geteld uit de toewijzingen zelf, niet uit de boekhouding van de solver. Die
   * boekhouding bestaat alleen bij een CP-SAT-scenario, en de kaart toonde
   * daardoor een streepje bij de nulmeting terwijl de vergelijkingstabel
   * ernaast 223 van 223 zei. Twee antwoorden op dezelfde vraag is erger dan
   * een antwoord dat ontbreekt.
   */
  readonly dutiesPlaced: number;
  readonly dutiesUnfilled: number;
  /** De basisroosters die in dit scenario voorkomen, gesorteerd. */
  readonly rosterCodes: readonly string[];
  readonly tally: ReviewableRoster["tally"] | null;
  readonly blockingReasons: readonly string[];
  /** Per regel gegroepeerd wat er niet beoordeeld kon worden. */
  readonly uncertainties: ReviewableRoster["uncertainties"];
  /** De blokkades, gescheiden naar soort. */
  readonly reasons: ReviewableRoster["reasons"];
  /** Mag dit scenario worden geanalyseerd en vergeleken? */
  readonly simulationEligible: boolean;
  /** Mag dit scenario formeel worden gepubliceerd? Nu altijd false. */
  readonly publicationEligible: boolean;
  readonly stale: boolean;
  /**
   * Wat de solver deed, wanneer een solver het scenario maakte. Null bij de
   * nulmeting en de eenvoudige varianten.
   */
  readonly solver: {
    readonly status: string;
    readonly optimal: boolean;
    readonly seconds: number;
    readonly seed: number;
    readonly variables: number;
    readonly constraints: number;
    readonly dutyInstances: number;
    readonly fixedRoster: number;
    readonly operationalPool: number;
    readonly unassignable: number;
    readonly excluded: number;
    readonly balanced: boolean;
    readonly emptyDutySlots: number;
    readonly dutySlots: number;
    readonly weights: Record<string, number>;
    readonly diagnostics: readonly string[];
  } | null;
}

export async function listCandidates(
  requestedLocation?: string | null,
): Promise<readonly CandidateSummary[]> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const scope = await locationScopeFor(actor, requestedLocation);

  const [rows, schedule, input] = await Promise.all([
    prisma.candidateRoster.findMany({
      // Kandidaten van vóór de standplaatsstructuur horen bij de enige
      // standplaats die er toen was; ze verdwijnen niet uit beeld.
      where: { OR: [{ locationCode: scope.code }, { locationCode: null }] },
      orderBy: { generatedAt: "desc" },
      take: 25,
    }),
    scheduleVersion(scope.code),
    inputDataVersion(scope.code),
  ]);
  const ruleset = activeRuleset().version;

  const regelbestand = activeRuleset();

  return rows.map((row) => {
    const summary = row.validationSummary as {
      tally?: ReviewableRoster["tally"];
      blockingReasons?: string[];
      uncertainties?: ReviewableRoster["uncertainties"];
      reasons?: ReviewableRoster["reasons"];
    } | null;
    const run = row.solverRun as CpSatOutcomeExtras | null;
    const status = row.validationState as CandidateValidationStatus;
    const toewijzingen = (row.assignments ?? []) as unknown as ReadonlyArray<{
      positionType: string;
      dutyCode: string | null;
      baseRosterCode: string;
    }>;

    return {
      id: row.id,
      scenarioLabel: row.scenarioLabel,
      optimizer: `${row.optimizerName}@${row.optimizerVersion}`,
      generatedAt: row.generatedAt,
      mode: row.mode,
      legalStatus: row.legalStatus,
      validationState: row.validationState,
      validatedAt: row.validatedAt,
      overallQualityScore:
        (row.scoreBreakdown as { overallQualityScore?: number } | null)?.overallQualityScore ?? 0,
      dutiesPlaced: toewijzingen.filter(
        (entry) => entry.positionType === "DUTY" && entry.dutyCode !== null,
      ).length,
      dutiesUnfilled: run?.emptyDutySlots ?? 0,
      rosterCodes: [...new Set(toewijzingen.map((entry) => entry.baseRosterCode))].sort(),
      tally: summary?.tally ?? null,
      blockingReasons: summary?.blockingReasons ?? [],
      uncertainties: summary?.uncertainties ?? [],
      reasons:
        summary?.reasons ?? { structural: [], violations: [], uncertainty: [], formal: [] },
      // Beide worden hier opnieuw uitgerekend in plaats van uit de opgeslagen
      // samenvatting gelezen: het regelbestand kan sinds de validatie zijn
      // gewijzigd, en dan hoort publicatie mee te bewegen — nooit de andere
      // kant op dan strenger.
      simulationEligible: simulationEligible(status),
      publicationEligible: publicationEligible({
        status,
        rulesetLegallyVerified: regelbestand.legalStatus === "LEGAL_RULESET_VERIFIED",
        missingRulePackages: regelbestand.missingPackages.length,
      }),
      // Vooraf zichtbaar maken dat een kandidaat verouderd is, zodat niemand
      // eerst een validatie start om dat te ontdekken.
      stale:
        row.sourceScheduleVersion !== schedule ||
        row.rulesetVersion !== ruleset ||
        row.inputDataVersion !== input,
      solver: run
        ? {
            status: run.solverStatus,
            optimal: run.optimal,
            seconds: run.wallTimeSeconds,
            seed: run.seed,
            variables: run.variables,
            constraints: run.constraints,
            dutyInstances: run.accounting.sourceInstances,
            fixedRoster: run.accounting.fixedRoster,
            operationalPool: run.accounting.operationalPool.length,
            unassignable: run.accounting.unassignable.length,
            excluded: run.accounting.excluded.length,
            balanced: run.accounting.balanced,
            emptyDutySlots: run.emptyDutySlots ?? 0,
            dutySlots: run.dutySlots ?? 0,
            weights: run.weights,
            diagnostics: run.diagnostics,
          }
        : null,
    };
  });
}

export async function comparisonFor(candidateId: string): Promise<RosterComparison> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_COMPARE);
  const candidate = await loadCandidate(candidateId);
  // De standplaats van de kandidaat zelf, niet die van de kijker: anders wordt
  // een Dordrechtse kandidaat vergeleken met een Rotterdams rooster.
  const opgeslagen = await prisma.candidateRoster.findUnique({
    where: { id: candidateId },
    select: { locationCode: true },
  });
  const scope = await locationScopeFor(actor, opgeslagen?.locationCode ?? null);
  const input = await buildOptimizerInput(opgeslagen?.locationCode ?? scope.code);

  return compareRosters({
    currentLines: input.rosterLines,
    candidateAssignments: candidate.assignments,
    duties: dutyIndex(input.duties),
    feedback: input.aggregatedFeedback,
  });
}

export async function rankStoredCandidates(): Promise<readonly RankedCandidate[]> {
  const candidates = await listCandidates();
  return rankCandidates(
    candidates.map((entry) => ({
      candidateId: entry.id,
      label: entry.scenarioLabel,
      validationStatus: entry.validationState as RankedCandidate["validationStatus"],
      confirmedHardViolations: entry.tally?.confirmedHardViolations ?? 0,
      potentialHardViolations: entry.tally?.potentialHardViolations ?? 0,
      rulesetIncomplete: entry.tally?.rulesetIncomplete ?? 0,
      missingCriticalContext: entry.tally?.missingCriticalContext ?? 0,
      overallQualityScore: entry.overallQualityScore,
    })),
  );
}

async function loadCandidate(candidateId: string): Promise<CandidateRoster> {
  const row = await prisma.candidateRoster.findUnique({ where: { id: candidateId } });
  if (!row) {
    throw new Error(`Onbekende kandidaat: ${candidateId}`);
  }

  return {
    id: row.id,
    status: "CANDIDATE_GENERATED",
    optimizerName: row.optimizerName,
    optimizerVersion: row.optimizerVersion,
    generatedAt: row.generatedAt.toISOString(),
    mode: OPTIMIZER_MODE,
    legalStatus: "SIMULATION_ONLY",
    scenarioLabel: row.scenarioLabel,
    sourceScheduleVersion: row.sourceScheduleVersion,
    rulesetVersion: row.rulesetVersion,
    inputDataVersion: row.inputDataVersion,
    assignments: row.assignments as unknown as CandidateRoster["assignments"],
    scoreBreakdown: row.scoreBreakdown as unknown as CandidateRoster["scoreBreakdown"],
    hash: row.hash,
  };
}

// ── De invoer ────────────────────────────────────────────────────────────────

export async function buildOptimizerInput(locationCode: string): Promise<OptimizerInput> {
  // De simulatie draait op één standplaats. Roosters en diensten van
  // verschillende standplaatsen in één kandidaat mengen zou een rooster
  // opleveren dat nergens bestaat, en dat vervolgens netjes valideren.
  const [rosters, duties, feedback] = await Promise.all([
    prisma.baseRoster.findMany({
      where: { status: { in: ["ACTIVE", "DRAFT"] }, depot: locationCode },
      orderBy: { code: "asc" },
      select: {
        code: true,
        profile: true,
        depot: true,
        cycleWeeks: true,
        lines: {
          orderBy: { lineNumber: "asc" },
          select: {
            lineNumber: true,
            days: {
              orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }],
              select: { weekIndex: true, weekday: true, positionType: true, dutyCode: true },
            },
            assignments: {
              where: { validUntil: null },
              orderBy: { validFrom: "desc" },
              take: 1,
              select: {
                employee: {
                  select: { employeeNumber: true, contractHours: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.duty.findMany({
      where: { package: { status: DutyPackageStatus.ACTIVE }, depot: locationCode },
      orderBy: { code: "asc" },
      select: {
        code: true,
        weekday: true,
        kinds: true,
        startMinute: true,
        endMinute: true,
        breakMinutes: true,
        overtimeMinutes: true,
        depot: true,
        requiredQualifications: true,
        weight: true,
      },
    }),
    prisma.quarterlyFeedback.findMany({
      select: { rosterProfile: true, categories: true },
    }),
  ]);

  const lines: OptimizerLine[] = rosters.flatMap((roster) =>
    roster.lines.map((line) => ({
      baseRosterCode: roster.code,
      profile: roster.profile,
      lineNumber: line.lineNumber,
      cycleWeeks: roster.cycleWeeks,
      days: line.days.map((day) => ({
        weekIndex: day.weekIndex,
        weekday: day.weekday,
        positionType: day.positionType,
        dutyCode: day.dutyCode,
      })),
      contractHours: line.assignments[0]?.employee.contractHours
        ? Number(line.assignments[0].employee.contractHours)
        : null,
      occupiedBy: line.assignments[0]?.employee.employeeNumber ?? null,
    })),
  );

  const optimizerDuties: OptimizerDuty[] = duties.map((duty) => ({
    code: duty.code,
    kinds: duty.kinds,
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    breakMinutes: duty.breakMinutes,
    overtimeMinutes: duty.overtimeMinutes,
    depot: duty.depot,
    requiredQualifications: [...duty.requiredQualifications],
    weight: duty.weight,
    // De weekdag staat bij de dienst zelf. Hij werd hier eerder afgeleid uit de
    // roosterlijnen op dienstnummer, en dat is precies de fout waartegen het
    // schema waarschuwt: een dienstnummer is geen dienst. Dienst 101 van
    // maandag en dienst 101 van donderdag hebben andere tijden en zijn twee
    // rijen; op nummer zoeken gaf ze allebei dezelfde zeven weekdagen. Het
    // gevolg was 1251 "dienstinstanties" uit 223 diensten, waarvan er 1028 een
    // sleutel deelden met een andere. De CP-SAT-boekhouding kon daardoor niet
    // sluiten en elk scenario A–E werd geweigerd — terecht, want er raakte werk
    // zoek. Eén rij is één dienst op één weekdag.
    weekdays: [duty.weekday],
  }));

  const aggregated = aggregateFeedback(feedback);

  return {
    depot: rosters[0]?.depot ?? "DDR",
    duties: optimizerDuties,
    rosterProfiles: [...new Set(rosters.map((roster) => roster.profile))],
    rosterLines: lines,
    contractualHours: lines.map((line) => ({
      baseRosterCode: line.baseRosterCode,
      lineNumber: line.lineNumber,
      hours: line.contractHours,
    })),
    hardConstraints: constraintsFromCatalog(),
    softObjectives: activeRuleset()
      .rules.filter((rule) => rule.category !== "HARD_CONSTRAINT")
      .map((rule) => ({ id: rule.id, weight: 1 })),
    aggregatedFeedback: aggregated,
    // Bewust leeg: met 91 dagen historie is elke uitspraak over historische
    // belasting ruis. Het contract staat klaar, de gegevens niet.
    historicalBurden: [],
    sourceScheduleVersion: await scheduleVersion(locationCode),
    rulesetVersion: activeRuleset().version,
    inputDataVersion: await inputDataVersion(locationCode),
    mode: OPTIMIZER_MODE,
  };
}

/**
 * De harde constraints, uit de centrale catalogus.
 *
 * De optimizer krijgt ze te zien maar formuleert ze niet. Een regel zonder
 * bruikbare waarde of met een eenheid die geen solverconstraint oplevert, gaat
 * mee als "niet te vertalen" — met de reden erbij. Zo is achteraf zichtbaar
 * welk deel van het regelbestand de optimizer níét heeft kunnen meenemen, en
 * dus volledig op de eindvalidatie leunt.
 */
export function constraintsFromCatalog(): readonly OptimizerConstraint[] {
  return activeRuleset()
    .rules.filter((rule) => rule.category === "HARD_CONSTRAINT")
    .map((rule) => ({
      ruleId: rule.id,
      title: rule.title,
      unit: rule.unit,
      value: rule.value,
      translatable: isTranslatable(rule),
      untranslatableReason: isTranslatable(rule) ? undefined : untranslatableReason(rule),
    }));
}

function isTranslatable(rule: RuleDefinition): boolean {
  return rule.value !== null && rule.status !== "NOT_SUPPLIED" && rule.unit !== "NONE";
}

function untranslatableReason(rule: RuleDefinition): string {
  if (rule.value === null) {
    return "Geen waarde aangeleverd; er valt niets te begrenzen zonder er een te verzinnen.";
  }
  if (rule.unit === "NONE") {
    return "Geen numerieke grens maar een toepasselijkheidsregel; alleen de validator kan die beoordelen.";
  }
  return `Status ${rule.status}: de waarde mag niet worden gebruikt om iets goed te keuren.`;
}

// ── Versies ──────────────────────────────────────────────────────────────────

/**
 * De versie van het bronrooster.
 *
 * Een vingerafdruk over alle basisroosters, lijnen en cyclusdagen. Verandert er
 * één dienstnummer op één cyclusdag, dan is elke eerder gegenereerde kandidaat
 * verouderd — en dat hoort zo: hij is gemaakt voor een rooster dat niet meer
 * bestaat.
 */
export async function scheduleVersion(locationCode: string): Promise<string> {
  const rows = await prisma.rosterLineDay.findMany({
    where: { rosterLine: { baseRoster: { depot: locationCode } } },
    orderBy: [{ rosterLineId: "asc" }, { weekIndex: "asc" }, { weekday: "asc" }],
    select: {
      rosterLineId: true,
      weekIndex: true,
      weekday: true,
      positionType: true,
      dutyCode: true,
    },
  });
  return digest(
    rows.map(
      (row) =>
        `${row.rosterLineId}|${row.weekIndex}|${row.weekday}|${row.positionType}|${row.dutyCode ?? ""}`,
    ),
  );
}

/**
 * De versie van de invoergegevens.
 *
 * Diensten, contracturen, bevoegdheden en beschermingsconstraints. Alles wat de
 * uitkomst van een validatie kan veranderen zonder dat het rooster zelf
 * verandert.
 */
export async function inputDataVersion(locationCode: string): Promise<string> {
  // Per standplaats. Een wijziging in Rotterdam hoort een Dordrechtse
  // kandidaat niet verouderd te verklaren, en andersom hoort een wijziging in
  // Dordrecht niet onder te sneeuwen tussen landelijke ruis.
  const [duties, employees] = await Promise.all([
    prisma.duty.findMany({
      where: { depot: locationCode },
      orderBy: { code: "asc" },
      select: {
        code: true,
        startMinute: true,
        endMinute: true,
        breakMinutes: true,
        overtimeMinutes: true,
        kinds: true,
        requiredQualifications: true,
        depot: true,
      },
    }),
    prisma.employee.findMany({
      where: { depot: locationCode },
      orderBy: { employeeNumber: "asc" },
      select: {
        employeeNumber: true,
        rosterProfile: true,
        depot: true,
        qualifications: true,
        contractHours: true,
        earlyStartProtectionWaived: true,
        protections: true,
        employeeGroup: true,
        company: true,
      },
    }),
  ]);

  return digest([
    ...duties.map(
      (duty) =>
        `D|${duty.code}|${duty.startMinute}|${duty.endMinute}|${duty.breakMinutes ?? ""}|` +
        `${duty.overtimeMinutes}|${duty.kinds.join(",")}|${duty.requiredQualifications.join(",")}|${duty.depot}`,
    ),
    ...employees.map(
      (employee) =>
        `E|${employee.employeeNumber}|${employee.rosterProfile}|${employee.depot}|` +
        `${employee.qualifications.join(",")}|${employee.contractHours ?? ""}|` +
        `${employee.earlyStartProtectionWaived}|${JSON.stringify(employee.protections)}|` +
        `${employee.employeeGroup}|${employee.company}`,
    ),
  ]);
}

/**
 * Feedback samenvatten per profiel en categorie.
 *
 * Uitsluitend aantallen. Er gaat geen personeelsnummer langs, en het aandeel
 * wordt berekend binnen het profiel — niet over alle profielen heen, want dan
 * zou een groot profiel de signalen van een klein profiel wegdrukken.
 */
function aggregateFeedback(
  rows: readonly { rosterProfile: RosterProfile; categories: readonly FeedbackCategory[] }[],
): readonly AggregatedFeedback[] {
  const perProfile = new Map<RosterProfile, { total: number; counts: Map<string, number> }>();

  for (const row of rows) {
    const entry = perProfile.get(row.rosterProfile) ?? { total: 0, counts: new Map() };
    entry.total += 1;
    for (const category of row.categories) {
      entry.counts.set(category, (entry.counts.get(category) ?? 0) + 1);
    }
    perProfile.set(row.rosterProfile, entry);
  }

  const signals: AggregatedFeedback[] = [];
  for (const [profile, entry] of perProfile) {
    for (const [category, count] of entry.counts) {
      signals.push({
        rosterProfile: profile,
        category: FEEDBACK_TO_BURDEN[category] ?? category,
        share: entry.total === 0 ? 0 : count / entry.total,
        respondents: entry.total,
      });
    }
  }
  return signals;
}

/** Van feedbackcategorie naar de belasting waar het scoremodel op stuurt. */
const FEEDBACK_TO_BURDEN: Readonly<Record<string, string>> = {
  TE_VEEL_VROEG: "VROEGE_DIENSTEN",
  TE_VEEL_NACHT: "NACHTDIENSTEN",
  TE_VEEL_RANGEER: "RANGEERDIENSTEN",
  BETERE_WEEKENDVERDELING: "WEEKENDBELASTING",
};

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}
