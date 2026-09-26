import { paretoFront } from "./pareto";
import type { CandidatePoint, ParetoResult, RosterQualityCategory } from "../types";

/**
 * Kruisverwijzing van de tien roosteronderzoeksdimensies (§1 van v0.2) naar de
 * bestaande metrics van de hoofdapp (`scripts/benchmark/evaluate.ts`,
 * `METRICS`). Geen nieuwe kwaliteitsmaat: dit hergroepeert alleen wat er al
 * gemeten wordt, zodat een proof-of-value-rapport in dezelfde negen/tien
 * indeling spreekt als de rest van de opdracht.
 *
 * Bewust puur en zonder Prisma/askAgent: de invoer is een platte metrics-bag
 * (`Record<string, number>`), zoals die al op `CandidateRoster.qualityMetrics`
 * staat of uit `evaluateAssignmentsCore()` komt. Ontbreekt een metric, dan
 * blijft de dimensie `null` — nooit een verzonnen 0.
 */

export function rosterQualityFromMetrics(
  metrics: Record<string, number> | null,
  notApplicableReason: string | null,
  paretoCandidates?: readonly CandidatePoint[],
  paretoHigherIsBetter?: Readonly<Record<string, boolean | null>>,
): RosterQualityCategory {
  if (!metrics) {
    return {
      validity: null,
      packageQuality: null,
      profileFit: null,
      restRecovery: null,
      fairness: null,
      weekends: null,
      nightBlocks: null,
      rangeerDistribution: null,
      worstLineQuality: null,
      paretoResult: null,
      notApplicableReason,
    };
  }

  const pareto: ParetoResult | null =
    paretoCandidates && paretoCandidates.length > 0 && paretoHigherIsBetter ? paretoFront(paretoCandidates, paretoHigherIsBetter) : null;

  return {
    validity: metrics.hardValid !== undefined ? metrics.hardValid * 100 : null,
    packageQuality: metrics.overall ?? metrics.robust ?? null,
    // profielovertredingen: lager is beter, hier omgerekend naar een
    // "fit"-percentage zodat alle dimensies dezelfde richting (hoger=beter) hebben.
    profileFit: metrics.profileBreaches !== undefined ? Math.max(0, 100 - metrics.profileBreaches * 10) : null,
    restRecovery: metrics.restRecovery ?? null,
    fairness: metrics.fairness ?? null,
    weekends: metrics.weekendFairness ?? null,
    // Nachtblokken: minder losse nachten en 3+-reeksen is beter; ook hier
    // omgerekend naar een percentage in dezelfde richting als de rest.
    nightBlocks:
      metrics.singletonNights !== undefined || metrics.nightBlocks3plus !== undefined
        ? Math.max(0, 100 - (metrics.singletonNights ?? 0) * 10 - (metrics.nightBlocks3plus ?? 0) * 5)
        : null,
    rangeerDistribution: metrics.shuntingFairness ?? null,
    worstLineQuality: metrics.worstLine ?? null,
    paretoResult: pareto,
    notApplicableReason,
  };
}

/** Waarom roosterkwaliteit voor deze variantcategorie (nog) niet gemeten is — §1: nooit fictieve resultaten. */
export function rosterNotApplicableReason(variantCategory: "PROMPT" | "TOOL_ROUTING" | "CONTEXT_POLICY" | "ENGINE"): string | null {
  if (variantCategory === "ENGINE") return null; // deze categorie raakt de optimizer wél rechtstreeks
  return (
    `Deze variantcategorie (${variantCategory}) wijzigt alleen hoe Lyra als chatbot antwoordt, niet welke ` +
    "kandidaten de optimizer maakt. Roosteronderzoekskwaliteit is daarom hier niet gemeten — pas relevant zodra " +
    "een variant ook de doelen/strategie richting de optimizer verandert (zie ARCHITECTURE.md)."
  );
}
