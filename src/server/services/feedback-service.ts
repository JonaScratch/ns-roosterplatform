import "server-only";
import type { FeedbackCategory, RosterProfile } from "@/lib/generated/prisma/enums";
import { currentQuarterKey } from "@/domain/time";
import { rosterProfileLabel } from "@/domain/roster-profiles";
import { recordAudit } from "@/server/audit/log";
import { config } from "@/server/config/env";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";

/**
 * Kwartaalfeedback.
 *
 * ## Voor de medewerker
 *
 * Eén keer per kwartaal, over uitsluitend zijn eigen rooster. De begrenzing
 * staat niet alleen in deze service maar ook als unieke sleutel in de database
 * (`employeeId + quarterKey`). Een service kan een fout hebben; een constraint
 * niet.
 *
 * ## Voor de planner
 *
 * Uitsluitend geaggregeerd, en alleen wanneer het cohort groot genoeg is. Wat
 * een planner ziet is:
 *
 *     Vroeg/Laat: 63% wil minder extreem vroege diensten
 *
 * en nooit wie dat vindt. Dat is geen kwestie van de kolom weglaten in de
 * weergave: er bestaat in dit platform geen enkel recht dat individuele
 * feedback zichtbaar maakt, voor niemand.
 *
 * ## De cohortdrempel
 *
 * Een percentage over drie respondenten is geen statistiek maar een aanwijzing.
 * Bij een klein roosterprofiel weet een planner wie erin zit, en dan is
 * "67% wil minder nacht" hetzelfde als twee namen noemen. Onder de drempel
 * (`PRIVACY_MIN_COHORT`) wordt daarom niets getoond — ook geen "te weinig
 * gegevens, namelijk 3", want ook dat aantal is informatie.
 */

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  TEVREDEN: "Tevreden met het huidige rooster",
  TE_VEEL_VROEG: "Te veel vroege diensten",
  TE_VEEL_LAAT: "Te veel late diensten",
  TE_VEEL_NACHT: "Te veel nachtdiensten",
  TE_VEEL_RANGEER: "Te veel rangeerdiensten",
  ONVOLDOENDE_AFWISSELING: "Onvoldoende afwisseling",
  BETERE_WEEKENDVERDELING: "Voorkeur voor betere weekendverdeling",
};

export function feedbackCategoryLabel(category: FeedbackCategory): string {
  return CATEGORY_LABELS[category];
}

export function allFeedbackCategories(): readonly FeedbackCategory[] {
  return Object.keys(CATEGORY_LABELS) as FeedbackCategory[];
}

export interface FeedbackEligibility {
  readonly quarterKey: string;
  readonly alreadySubmitted: boolean;
  readonly submittedAt: Date | null;
}

/** Mag deze medewerker dit kwartaal feedback geven? */
export async function feedbackEligibility(): Promise<FeedbackEligibility> {
  const actor = await requirePermission(PERMISSIONS.FEEDBACK_SUBMIT_OWN);
  const quarter = currentQuarterKey();
  const existing = await prisma.quarterlyFeedback.findUnique({
    where: { employeeId_quarterKey: { employeeId: actor.employeeId, quarterKey: quarter } },
    select: { submittedAt: true },
  });
  return {
    quarterKey: quarter,
    alreadySubmitted: existing !== null,
    submittedAt: existing?.submittedAt ?? null,
  };
}

/** Feedback indienen over het eigen rooster. */
export async function submitFeedback(input: {
  readonly categories: readonly FeedbackCategory[];
  readonly satisfaction: number;
}): Promise<{ readonly ok: boolean; readonly reason?: string }> {
  const actor = await requirePermission(PERMISSIONS.FEEDBACK_SUBMIT_OWN);
  const quarter = currentQuarterKey();

  // Het basisrooster van de medewerker hoort erbij: zonder die context is de
  // feedback niet te aggregeren per profiel, en aggregeren per profiel is de
  // enige manier waarop hij ooit gebruikt wordt.
  const assignment = await prisma.rosterAssignment.findFirst({
    where: {
      employeeId: actor.employeeId,
      validFrom: { lte: new Date() },
      OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
    },
    orderBy: { validFrom: "desc" },
    select: {
      rosterLine: {
        select: { baseRoster: { select: { code: true, profile: true } } },
      },
    },
  });

  if (!assignment) {
    return {
      ok: false,
      reason: "U bent nu niet aan een basisrooster gekoppeld; feedback is daarom niet mogelijk.",
    };
  }

  try {
    await prisma.quarterlyFeedback.create({
      data: {
        employeeId: actor.employeeId,
        quarterKey: quarter,
        baseRosterCode: assignment.rosterLine.baseRoster.code,
        rosterProfile: assignment.rosterLine.baseRoster.profile,
        categories: [...input.categories],
        satisfaction: Math.min(5, Math.max(1, Math.round(input.satisfaction))),
      },
    });
  } catch {
    // De unieke sleutel is hier de enige realistische oorzaak: er is dit
    // kwartaal al feedback gegeven.
    return { ok: false, reason: `U heeft in ${quarter} al feedback gegeven.` };
  }

  // Het auditlog legt vast dát er feedback is gegeven, niet wat erin stond.
  // Anders zou de inhoud alsnog herleidbaar in een logboek staan.
  await recordAudit({
    actor,
    action: "feedback.ingediend",
    objectType: "QuarterlyFeedback",
    newValue: { kwartaal: quarter },
  });

  return { ok: true };
}

// ── Aggregatie voor de planner ───────────────────────────────────────────────

export interface FeedbackAggregate {
  readonly rosterProfile: RosterProfile;
  readonly profileLabel: string;
  readonly status: FeedbackStatus;
  /** Alleen gevuld bij `VOLDOENDE`; anders zou het getal zelf al iets verraden. */
  readonly respondents: number | null;
  readonly averageSatisfaction: number | null;
  readonly categories: readonly {
    readonly category: FeedbackCategory;
    readonly label: string;
    readonly share: number;
    readonly count: number;
  }[];
}

/**
 * Waarom er wel of geen cijfers bij een profiel staan.
 *
 * Het onderscheid tussen "niemand heeft gereageerd" en "te weinig mensen hebben
 * gereageerd" is voor de Rooster Commissie een ander signaal: het eerste vraagt
 * om aandacht voor de uitvraag, het tweede is een privacygrens.
 */
export type FeedbackStatus = "VOLDOENDE" | "ONVOLDOENDE_RESPONS" | "GEEN_RESPONS";

export interface FeedbackReport {
  readonly quarterKey: string;
  readonly minimumCohort: number;
  readonly aggregates: readonly FeedbackAggregate[];
  /** Profielen die zijn weggelaten omdat het cohort te klein was. */
  readonly suppressedProfiles: number;
}

/**
 * Geaggregeerde feedback per roosterprofiel.
 *
 * De query haalt geen `employeeId` op. Dat is geen optimalisatie: het is de
 * garantie dat deze functie niets kan teruggeven wat naar een persoon leidt,
 * ook niet per ongeluk bij een latere wijziging.
 */
export async function feedbackReport(quarterKey?: string): Promise<FeedbackReport> {
  const actor = await requirePermission(PERMISSIONS.FEEDBACK_READ_AGGREGATE);
  const quarter = quarterKey ?? currentQuarterKey();
  const minimum = config().PRIVACY_MIN_COHORT;

  const rows = await prisma.quarterlyFeedback.findMany({
    where: { quarterKey: quarter },
    select: { rosterProfile: true, categories: true, satisfaction: true },
  });

  const byProfile = new Map<
    RosterProfile,
    { satisfaction: number[]; categories: Map<FeedbackCategory, number> }
  >();

  for (const row of rows) {
    const bucket = byProfile.get(row.rosterProfile) ?? {
      satisfaction: [],
      categories: new Map<FeedbackCategory, number>(),
    };
    bucket.satisfaction.push(row.satisfaction);
    for (const category of row.categories) {
      bucket.categories.set(category, (bucket.categories.get(category) ?? 0) + 1);
    }
    byProfile.set(row.rosterProfile, bucket);
  }

  // Alle profielen die op de standplaats werkelijk bestaan, en niet alleen de
  // profielen waar toevallig feedback voor binnenkwam.
  //
  // Een profiel weglaten omdat er niets over te melden is, laat de Rooster
  // Commissie in de veronderstelling dat zij alles ziet. Juist het rooster waar
  // niemand op reageert, is er een om naar te kijken — dat is een uitkomst en
  // geen leegte. De privacygrens blijft staan: bestaan wordt getoond, cijfers
  // niet.
  const bestaandeProfielen = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    select: { rosterProfile: true },
    distinct: ["rosterProfile"],
  });
  const alleProfielen = new Set<RosterProfile>([
    ...bestaandeProfielen.map((rij) => rij.rosterProfile),
    ...byProfile.keys(),
  ]);

  const aggregates: FeedbackAggregate[] = [];
  let suppressed = 0;

  for (const profile of alleProfielen) {
    const bucket = byProfile.get(profile);
    const respondents = bucket?.satisfaction.length ?? 0;

    if (respondents === 0 || respondents < minimum) {
      if (respondents > 0) {
        suppressed += 1;
      }
      aggregates.push({
        rosterProfile: profile,
        profileLabel: rosterProfileLabel(profile),
        status: respondents === 0 ? "GEEN_RESPONS" : "ONVOLDOENDE_RESPONS",
        respondents: null,
        averageSatisfaction: null,
        categories: [],
      });
      continue;
    }

    aggregates.push({
      rosterProfile: profile,
      profileLabel: rosterProfileLabel(profile),
      status: "VOLDOENDE",
      respondents,
      averageSatisfaction:
        bucket!.satisfaction.reduce((sum, value) => sum + value, 0) / respondents,
      categories: [...bucket!.categories.entries()]
        .map(([category, count]) => ({
          category,
          label: CATEGORY_LABELS[category],
          count,
          share: count / respondents,
        }))
        .sort((a, b) => b.share - a.share),
    });
  }

  await recordAudit({
    actor,
    action: "feedback.geaggregeerd-ingezien",
    objectType: "QuarterlyFeedback",
    newValue: {
      kwartaal: quarter,
      profielen: aggregates.length,
      metCijfers: aggregates.filter((rij) => rij.status === "VOLDOENDE").length,
      onderdrukt: suppressed,
    },
  });

  return {
    quarterKey: quarter,
    minimumCohort: minimum,
    aggregates: aggregates.sort((a, b) => a.profileLabel.localeCompare(b.profileLabel)),
    suppressedProfiles: suppressed,
  };
}
