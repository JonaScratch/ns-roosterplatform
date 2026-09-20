import "server-only";
import {
  type HumanReviewVerdictKey,
  type PairwiseChoiceKey,
  isHumanReviewReason,
  isPairwiseReason,
} from "@/domain/human-review";
import { prisma } from "@/server/data/prisma";
import { recordAudit } from "@/server/audit/log";
import { NotFoundError, requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * Menselijke oordelen over kandidaten vastleggen.
 *
 * ## Waarom dit bestaat
 *
 * De zoekmachine is geijkt op zeven menselijke roosters. Of de uitkomst ook
 * voelt als een menselijk rooster, kan alleen een mens zeggen. Hier worden die
 * oordelen bewaard — per regel, per basisrooster of als keuze tussen twee
 * kandidaten — samen met de versies van het kwaliteitsmodel en de zoekmachine
 * waarmee de kandidaat werd gemaakt. Zonder die versies is later niet meer te
 * zeggen waarover het oordeel ging.
 *
 * ## Wat hier niet gebeurt
 *
 * Er wordt geen gewicht aangepast en geen model bijgesteld. Een oordeel is
 * grondstof voor een volgende meting, geen knop die iets verstelt.
 */

/** Een oordeel dat zo niet klopt: onbekende reden, twee keer dezelfde kandidaat. */
export class ReviewInputError extends Error {}

async function kandidaatInScope(candidateId: string) {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, null);
  const kandidaat = await prisma.candidateRoster.findUnique({
    where: { id: candidateId },
    select: { id: true, locationCode: true, qualityModelVersion: true, optimizerModelVersion: true, assignments: true },
  });
  if (!kandidaat || (kandidaat.locationCode !== null && kandidaat.locationCode !== scope.code)) {
    throw new NotFoundError("Deze kandidaat bestaat niet (meer).");
  }
  return { actor, kandidaat };
}

function schoneRedenen(redenen: readonly string[], toegestaan: (reden: string) => boolean): string[] {
  const onbekend = redenen.filter((reden) => !toegestaan(reden));
  if (onbekend.length > 0) {
    throw new ReviewInputError(`Onbekende reden: ${onbekend.join(", ")}.`);
  }
  return [...new Set(redenen)];
}

export async function recordLineReview(input: {
  readonly candidateId: string;
  readonly rosterCode: string;
  readonly lineNumber: number | null;
  readonly verdict: HumanReviewVerdictKey;
  readonly reasons: readonly string[];
  readonly note: string | null;
}): Promise<string> {
  const { actor, kandidaat } = await kandidaatInScope(input.candidateId);
  // De regel moet echt in de kandidaat bestaan; anders is het oordeel nergens
  // meer aan terug te koppelen.
  const toewijzingen = (kandidaat.assignments as { baseRosterCode: string; lineNumber: number }[]) ?? [];
  const bestaat = toewijzingen.some(
    (entry) => entry.baseRosterCode === input.rosterCode && (input.lineNumber === null || entry.lineNumber === input.lineNumber),
  );
  if (!bestaat) {
    throw new NotFoundError("Dit basisrooster of deze regel hoort niet bij de kandidaat.");
  }
  const rij = await prisma.humanLineReview.create({
    data: {
      candidateId: kandidaat.id,
      rosterCode: input.rosterCode,
      lineNumber: input.lineNumber,
      verdict: input.verdict,
      reasons: schoneRedenen(input.reasons, isHumanReviewReason),
      note: input.note?.trim() ? input.note.trim().slice(0, 1000) : null,
      qualityModelVersion: kandidaat.qualityModelVersion,
      optimizerModelVersion: kandidaat.optimizerModelVersion,
      reviewerId: actor.userId,
    },
    select: { id: true },
  });
  await recordAudit({
    actor,
    action: "kandidaat.menselijk-oordeel",
    objectType: "CandidateRoster",
    objectId: kandidaat.id,
    result: "SUCCESS",
    reason: `${input.rosterCode}${input.lineNumber === null ? "" : ` regel ${input.lineNumber}`}: ${input.verdict}`,
  });
  return rij.id;
}

export async function lineReviewsFor(candidateId: string) {
  await kandidaatInScope(candidateId);
  return prisma.humanLineReview.findMany({
    where: { candidateId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      rosterCode: true,
      lineNumber: true,
      verdict: true,
      reasons: true,
      note: true,
      createdAt: true,
      // Namen staan achter een aparte permissie (identity:read); het
      // personeelsnummer volstaat om te zien wie oordeelde.
      reviewer: { select: { employee: { select: { employeeNumber: true } } } },
    },
  });
}

export async function recordPairwisePreference(input: {
  readonly firstCandidateId: string;
  readonly secondCandidateId: string;
  readonly rosterCode: string | null;
  readonly choice: PairwiseChoiceKey;
  readonly reasons: readonly string[];
  readonly note: string | null;
}): Promise<string> {
  if (input.firstCandidateId === input.secondCandidateId) {
    throw new ReviewInputError("Kies twee verschillende kandidaten.");
  }
  const eerste = await kandidaatInScope(input.firstCandidateId);
  const tweede = await kandidaatInScope(input.secondCandidateId);
  const rij = await prisma.humanPairwisePreference.create({
    data: {
      firstCandidateId: eerste.kandidaat.id,
      secondCandidateId: tweede.kandidaat.id,
      rosterCode: input.rosterCode,
      choice: input.choice,
      reasons: schoneRedenen(input.reasons, isPairwiseReason),
      note: input.note?.trim() ? input.note.trim().slice(0, 1000) : null,
      firstQualityModelVersion: eerste.kandidaat.qualityModelVersion,
      secondQualityModelVersion: tweede.kandidaat.qualityModelVersion,
      firstOptimizerModelVersion: eerste.kandidaat.optimizerModelVersion,
      secondOptimizerModelVersion: tweede.kandidaat.optimizerModelVersion,
      reviewerId: eerste.actor.userId,
    },
    select: { id: true },
  });
  await recordAudit({
    actor: eerste.actor,
    action: "kandidaat.menselijke-voorkeur",
    objectType: "CandidateRoster",
    objectId: eerste.kandidaat.id,
    result: "SUCCESS",
    reason: `tegenover ${tweede.kandidaat.id}: ${input.choice}`,
  });
  return rij.id;
}
