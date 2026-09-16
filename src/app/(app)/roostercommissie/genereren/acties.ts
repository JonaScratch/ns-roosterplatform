"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { describeRosterYear, rosterYear } from "@/domain/roster-year";
import {
  SCENARIOS,
  type ScenarioKey,
  generateCandidate,
  promoteCandidateToVersions,
  validateStoredCandidate,
} from "@/server/services/simulation-service";

/**
 * De echte generatieopdracht.
 *
 * ## Waarom dit één handeling is en geen drie knoppen
 *
 * Genereren, valideren en vastleggen zijn in `/roostercommissie/simulatie`
 * bewust drie aparte stappen — een roostermaker wil daar per kandidaat kunnen
 * afwegen. Hier, op de plek waar "Genereren & simulatie" voorheen een
 * placeholder was, hoort één opdracht die echt van begin tot eind loopt: de
 * planner kiest een scenario en een roosterjaar, en krijgt na één druk op de
 * knop een eerlijk antwoord — gegenereerd, afgewezen, geblokkeerd of een
 * technische fout, nooit een placeholder die "geen rooster gegenereerd" zegt
 * terwijl de motor allang bestaat.
 *
 * Slaagt de generatie én de onafhankelijke eindvalidatie, dan wordt de
 * kandidaat meteen vastgelegd als roosterversie (status GENERATED, geen
 * publicatie) zodat hij zonder extra stap zichtbaar is onder Roosterversies en
 * beschikbaar in Scenario's vergelijken.
 */

const scenarioKeys = SCENARIOS.map((scenario) => scenario.key) as [string, ...string[]];

const opdrachtSchema = z.object({
  strategy: z.enum(scenarioKeys),
  rosterYear: z.coerce.number().int(),
});

export async function genereerEnLegVastAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = opdrachtSchema.safeParse({
    strategy: formData.get("strategy"),
    rosterYear: formData.get("rosterYear"),
  });
  if (!parsed.success) {
    return { error: "Kies een scenario en een roosterjaar." };
  }

  const jaar = rosterYear(parsed.data.rosterYear);
  const jaarLabel = `Roosterjaar ${jaar.year}`;
  const periode = `${jaarLabel}: ${describeRosterYear(jaar)} (${jaar.weeks} weken).`;

  let candidateId: string;
  let scenarioLabel: string;
  try {
    const candidate = await generateCandidate(parsed.data.strategy as ScenarioKey);
    candidateId = candidate.id;
    scenarioLabel = candidate.scenarioLabel;
  } catch (error) {
    // `generateCandidate` gooit met precies de weigeringsreden van de
    // optimizer wanneer die zelf al REFUSED teruggeeft — bijvoorbeeld een
    // dienstdag die zonder dienstnummer zou blijven. Dat is "Geblokkeerd":
    // er is geen kandidaat om te beoordelen, laat staan vast te leggen.
    const reason = error instanceof Error ? error.message : "Onbekende fout in de optimizer.";
    revalidatePath("/roostercommissie/genereren");
    return {
      error: "Geblokkeerd: de optimizer heeft geweigerd een kandidaat te maken.",
      reasons: [periode, reason],
    };
  }

  try {
    const review = await validateStoredCandidate(candidateId);
    revalidatePath("/roostercommissie/simulatie");

    // Inhoudelijk afgewezen: een bewezen overtreding, of een kandidaat waarvan
    // een deel niet is nagerekend. Dit zijn de enige twee uitkomsten die iets
    // zeggen over de kwaliteit van het rooster zelf.
    if (!review.simulationEligible) {
      return {
        error:
          review.status === "CONFIRMED_HARD_VIOLATION"
            ? "Afgewezen: het scenario overtreedt een bevestigde, toepasbare regel."
            : "Afgewezen: dit scenario kon niet volledig worden beoordeeld.",
        reasons: [
          periode,
          `Scenario "${scenarioLabel}".`,
          ...review.reasons.violations,
          ...review.reasons.structural,
        ],
      };
    }

    // Bruikbaar als simulatie, maar niet formeel vastlegbaar. Dat is geen
    // afwijzing: het scenario is doorgerekend, opgeslagen en te vergelijken.
    // Alleen het vastleggen als roosterversie wacht op formele bronvalidatie.
    if (!review.publishable) {
      return {
        notice:
          `Gegenereerd: scenario "${scenarioLabel}", ${periode} ` +
          "Het scenario is opgeslagen en kan worden geanalyseerd en vergeleken onder " +
          "Scenario's vergelijken. Formeel vastleggen als roosterversie kan nog niet: " +
          "de formele regelvalidatie is niet voltooid.",
        reasons: [...review.reasons.uncertainty, ...review.reasons.formal],
      };
    }

    const promotion = await promoteCandidateToVersions(candidateId, jaarLabel);
    revalidatePath("/roostercommissie/roosters");
    revalidatePath("/roostercommissie/simulatie");
    revalidatePath("/roostercommissie/genereren");

    if (promotion.versions.length === 0) {
      return {
        error: "Technische fout: de kandidaat is gevalideerd, maar kon aan geen enkel basisrooster worden gekoppeld.",
        reasons: [periode, `Onbekende basisroostercodes: ${promotion.skippedBaseRosterCodes.join(", ") || "geen"}.`],
      };
    }

    const versieLijst = promotion.versions
      .map((entry) => `${entry.baseRosterCode} (${entry.dutyDays} dienstdagen)`)
      .join(", ");
    return {
      notice:
        `Gegenereerd en gevalideerd: scenario "${scenarioLabel}", ${periode} ` +
        `Vastgelegd als roosterversie voor ${promotion.versions.length} basisrooster(s): ${versieLijst}. ` +
        "Te vinden onder Roosterversies (Basisroosters) en in Scenario's vergelijken." +
        (promotion.skippedBaseRosterCodes.length > 0
          ? ` Let op: overgeslagen (onbekend basisrooster): ${promotion.skippedBaseRosterCodes.join(", ")}.`
          : ""),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Onbekende technische fout.";
    return {
      error: "Technische fout tijdens valideren of vastleggen.",
      reasons: [periode, `Scenario "${scenarioLabel}".`, reason],
    };
  }
}
