/**
 * Wanneer een gegenereerde kandidaat wordt bewaard, en wanneer niet.
 *
 * ## Waarom de profielgrens hier strenger is dan in de eindvalidatie
 *
 * De eindvalidatie meldt een dienst buiten het roosterprofiel als *mogelijke*
 * overtreding zolang de regel "Grenzen van het roosterprofiel" formeel niet is
 * bevestigd. Dat is eerlijk over de bron, en daar verandert hier niets aan.
 *
 * Voor een generatie is "mogelijk" niet genoeg. Een vroege dienst in Laat/Nacht
 * is precies de fout waarom v1.0.3 bestaat, en de indeling van profielen in
 * dagdelen komt uit de eigen configuratie van het platform, niet uit een
 * onbevestigde CAO-tekst. Een kandidaat met zo'n bevinding wordt daarom niet
 * bewaard, ongeacht de zekerheid. Dit maakt de poort strenger, nooit ruimer:
 * de publicatiepoort en de juridische status van het regelbestand blijven
 * ongemoeid.
 */

export const PROFILE_BOUNDS_RULE_ID = "ROSTER_PROFILE_BOUNDS";

export interface AcceptanceReview {
  readonly tally: { readonly confirmedHardViolations: number };
  readonly simulationEligible: boolean;
  readonly perRule: readonly { readonly ruleId: string; readonly uniqueViolations: number }[];
  readonly reasons: { readonly violations: readonly string[]; readonly structural: readonly string[] };
}

/** Het aantal bevindingen op de profielgrens, bevestigd of niet. */
export function profileBoundFindings(
  perRule: readonly { readonly ruleId: string; readonly uniqueViolations: number }[] | undefined,
): number {
  return (perRule ?? [])
    .filter((entry) => entry.ruleId === PROFILE_BOUNDS_RULE_ID)
    .reduce((som, entry) => som + entry.uniqueViolations, 0);
}

/** Waarom deze kandidaat niet wordt bewaard, of `null` als hij wordt bewaard. */
export function candidateRejection(review: AcceptanceReview): string | null {
  if (review.tally.confirmedHardViolations > 0) {
    return (
      `${review.tally.confirmedHardViolations} bevestigde harde overtreding(en)` +
      (review.reasons.violations[0] ? `: ${review.reasons.violations[0]}` : ".")
    );
  }
  const profiel = profileBoundFindings(review.perRule);
  if (profiel > 0) {
    return (
      `${profiel} dienst(en) buiten het roosterprofiel. Een dienst die het profiel niet toestaat, ` +
      "zoals een vroege dienst in Laat/Nacht, wordt nooit bewaard."
    );
  }
  if (!review.simulationEligible) {
    return `Niet volledig te beoordelen${review.reasons.structural[0] ? `: ${review.reasons.structural[0]}` : "."}`;
  }
  return null;
}
