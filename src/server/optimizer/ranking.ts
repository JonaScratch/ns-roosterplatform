import type { CandidateValidationStatus } from "@/domain/candidate";

/**
 * De rangschikking van scenario's.
 *
 * ## Waarom hier niet met gewichten wordt gerekend
 *
 * De verleiding is om een overtreding een hoge kostprijs te geven en het geheel
 * op te tellen. Dat is elegant en fout: er bestaat dan een aantal
 * kwaliteitspunten waarvoor een wettelijke overtreding te koop is. Dat het een
 * hoog aantal is, verandert daar niets aan — het bestaat.
 *
 * Daarom is dit een lexicografische ordening. Kwaliteit doet pas mee wanneer
 * twee kandidaten op rechtmatigheid gelijk staan. Een kandidaat met één
 * bevestigde overtreding komt nooit boven een kandidaat zonder, ook niet bij
 * 97 tegen 82 punten.
 */

export interface RankableCandidate {
  readonly candidateId: string;
  readonly label: string;
  readonly validationStatus: CandidateValidationStatus;
  readonly confirmedHardViolations: number;
  readonly potentialHardViolations: number;
  readonly rulesetIncomplete: number;
  readonly missingCriticalContext: number;
  readonly overallQualityScore: number;
}

export interface RankedCandidate extends RankableCandidate {
  readonly rank: number;
  /** Waarom deze kandidaat op deze plaats staat. */
  readonly reason: string;
}

export function rankCandidates(
  candidates: readonly RankableCandidate[],
): readonly RankedCandidate[] {
  const sorted = [...candidates].sort(compare);
  return sorted.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    reason: reasonFor(candidate),
  }));
}

/**
 * De vergelijking, in vaste volgorde van zwaarte.
 *
 * Elke stap wordt pas bekeken wanneer de vorige gelijk staat. Zo kan een lager
 * criterium een hoger nooit overstemmen.
 */
function compare(a: RankableCandidate, b: RankableCandidate): number {
  return (
    a.confirmedHardViolations - b.confirmedHardViolations ||
    a.potentialHardViolations - b.potentialHardViolations ||
    a.rulesetIncomplete - b.rulesetIncomplete ||
    a.missingCriticalContext - b.missingCriticalContext ||
    // Pas hier telt kwaliteit mee, en hoger is beter.
    b.overallQualityScore - a.overallQualityScore ||
    a.label.localeCompare(b.label)
  );
}

function reasonFor(candidate: RankableCandidate): string {
  if (candidate.confirmedHardViolations > 0) {
    return `${candidate.confirmedHardViolations} bevestigde overtredingen — kwaliteit weegt hier niet tegenop.`;
  }
  if (candidate.potentialHardViolations > 0) {
    return `${candidate.potentialHardViolations} mogelijke overtredingen; die blokkeren tot ze zijn opgehelderd.`;
  }
  if (candidate.rulesetIncomplete > 0 || candidate.missingCriticalContext > 0) {
    return "Niet volledig te beoordelen: ontbrekende regels of roosterhistorie.";
  }
  return `Geen blokkerende bevindingen; gerangschikt op kwaliteit (${candidate.overallQualityScore}).`;
}
