import "server-only";
import { createHash } from "node:crypto";
import { DutyPackageStatus, RosterVersionStatus } from "@/lib/generated/prisma/enums";
import type { FeedbackCategory, RosterProfile } from "@/lib/generated/prisma/enums";
import type { CandidateAssignment, CandidateRoster, ReviewableRoster } from "@/domain/candidate";
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
import type { BaselineStrategy } from "@/server/optimizer/baseline-optimizer";
import { SCENARIO_PROFILES, type ScenarioProfile } from "@/server/optimizer/cpsat-optimizer";
import type {
  AggregatedFeedback,
  OptimizerConstraint,
  OptimizerDuty,
  OptimizerInput,
  OptimizerLine,
} from "@/server/optimizer/contract";

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
  /**
   * Staat als hoofdtegel op het generatiescherm. De overige strategieën staan
   * onder "Meer strategieën": ze bestaan en werken, maar zijn geen eerste keus.
   */
  readonly primary: boolean;
}

export const SCENARIOS: readonly SimulationScenario[] = [
  {
    key: "REPRODUCE",
    label: "Nulmeting",
    description:
      "Neemt het bestaande rooster letterlijk over. Wat de validator hierover zegt, " +
      "geldt dus ook voor het rooster dat nu draait.",
    engine: "BASELINE",
    primary: true,
  },
  {
    key: "BALANCE_SHUNTING",
    label: "Rangeerbelasting gelijker verdelen",
    description:
      "Wisselt rangeerdiensten tussen lijnen van hetzelfde basisrooster tot het " +
      "verschil tussen de zwaarste en de lichtste lijn hooguit één dienst is.",
    engine: "BASELINE",
    primary: false,
  },
  ...SCENARIO_PROFILES.map((profile) => ({
    key: profile.key as ScenarioKey,
    label: profile.label,
    description: profile.description,
    engine: "SOLVER" as const,
    primary: profile.primary,
  })),
];

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
      validationSummary: validationSummaryJson(review),
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

/**
 * De opgeslagen vorm van een validatie.
 *
 * Eén plek, zodat een kandidaat die tijdens het genereren is getoetst precies
 * dezelfde samenvatting krijgt als een kandidaat die achteraf wordt getoetst.
 */
export function validationSummaryJson(review: ReviewableRoster) {
  return toJson({
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
