"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import {
  SCENARIOS,
  type ScenarioKey,
  discardCandidate,
  generateCandidate,
  validateStoredCandidate,
} from "@/server/services/simulation-service";

/**
 * De handelingen op de simulatiepagina.
 *
 * Er staat hier bewust géén publicatieactie. Niet uitgeschakeld, niet
 * afgeschermd: hij bestaat niet. Een knop die "nog niet mag" bestaat op den duur
 * wel, en dan is de enige rem een `if` die iemand kan weghalen. Zolang de
 * juridische bron niet is bevestigd, is de veiligste publicatiecode geen code.
 */

// De keuzemogelijkheden op het scherm komen uit dezelfde `SCENARIOS`-lijst als
// deze validatie. Eerder stond hier een handmatige `z.enum` met alleen de twee
// nulmeting-scenario's: de vijf CP-SAT-scenario's (A–E) op de pagina zelf
// werden daardoor stil geweigerd met "Onbekend scenario" zodra er "Genereren"
// op werd geklikt. Door de sleutels hieruit af te leiden kan dat niet meer
// uit elkaar lopen.
const scenarioKeys = SCENARIOS.map((scenario) => scenario.key) as [string, ...string[]];
const strategySchema = z.object({
  strategy: z.enum(scenarioKeys),
});

const idSchema = z.object({ candidateId: z.string().min(1) });

export async function genereerScenarioAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = strategySchema.safeParse({ strategy: formData.get("strategy") });
  if (!parsed.success) {
    return { error: "Onbekend scenario." };
  }

  try {
    const candidate = await generateCandidate(parsed.data.strategy as ScenarioKey);
    revalidatePath("/roostercommissie/simulatie");
    return {
      notice:
        `Scenario "${candidate.scenarioLabel}" gegenereerd met optimalisatiescore ` +
        `${candidate.scoreBreakdown.overallQualityScore}. Nog niet beoordeeld: ` +
        "een kandidaat is pas iets waard nadat de eindvalidatie hem onafhankelijk heeft nagerekend.",
      resultId: candidate.id,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Genereren mislukt." };
  }
}

export async function valideerKandidaatAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse({ candidateId: formData.get("candidateId") });
  if (!parsed.success) {
    return { error: "Onbekende kandidaat." };
  }

  try {
    const review = await validateStoredCandidate(parsed.data.candidateId);
    revalidatePath("/roostercommissie/simulatie");

    // Inhoudelijk afgewezen: een bewezen overtreding, of een kandidaat waarvan
    // een deel niet kon worden nagerekend. Alleen deze twee zeggen iets over
    // de kwaliteit van het rooster zelf.
    if (!review.simulationEligible) {
      return {
        error:
          review.status === "CONFIRMED_HARD_VIOLATION"
            ? "Technische validatie: bevestigde overtreding gevonden."
            : "Technische validatie: dit scenario kon niet volledig worden beoordeeld.",
        reasons: [...review.reasons.violations, ...review.reasons.structural],
      };
    }

    const onzeker = review.uncertainties.length;
    return {
      notice:
        "Technische validatie voltooid. Geen bevestigde harde overtredingen." +
        // Niet "konden niet worden beoordeeld": de meeste van deze regels zijn
        // juist nagerekend, alleen is hun bron nog niet formeel bevestigd. Wat
        // per regel aan de hand is, staat in de opsomming eronder.
        (onzeker > 0
          ? ` Bij ${onzeker} regels blijft een onzekerheid staan.`
          : " Alle regels volledig nagerekend.") +
        " Formele publicatie blijft geblokkeerd.",
      reasons: [...review.reasons.uncertainty, ...review.reasons.formal],
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Valideren mislukt." };
  }
}

export async function verwerpKandidaatAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse({ candidateId: formData.get("candidateId") });
  if (!parsed.success) {
    return { error: "Onbekende kandidaat." };
  }

  try {
    await discardCandidate(parsed.data.candidateId);
    revalidatePath("/roostercommissie/simulatie");
    return { notice: "Kandidaat verworpen." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Verwerpen mislukt." };
  }
}
