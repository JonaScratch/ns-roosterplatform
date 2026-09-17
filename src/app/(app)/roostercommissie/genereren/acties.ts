"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SCENARIOS } from "@/server/services/simulation-service";
import {
  ActiveGenerationError,
  cancelGeneration,
  startGeneration,
} from "@/server/services/generation-service";
import { toPublicError } from "@/server/security/authorize";

/**
 * Een generatieopdracht starten en stoppen.
 *
 * ## Waarom hier niets wordt vastgelegd als roosterversie
 *
 * Voorheen legde deze handeling een geslaagde kandidaat meteen vast als
 * roosterversie. Nu levert één opdracht tot drie kandidaten op, en welke
 * daarvan verder gaat is een keuze van de Roostercommissie — niet iets wat de
 * generator beslist. Vastleggen gebeurt daarom vanuit de kandidaat zelf, en
 * alleen wanneer de bestaande publicatiepoort dat toestaat.
 *
 * ## Waarom het antwoord meteen komt
 *
 * De opdracht loopt minuten. Het antwoord op deze handeling is alleen dat hij
 * is gestart, met de verwijzing waarmee het scherm hem volgt.
 */

export type StartState =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly error: string; readonly activeRunId?: string | null };

const scenarioKeys = SCENARIOS.map((scenario) => scenario.key) as [string, ...string[]];

const opdrachtSchema = z.object({
  strategy: z.enum(scenarioKeys),
  rosterYear: z.coerce.number().int().min(2000).max(2100),
});

export async function startGeneratieAction(input: { strategy: string; rosterYear: number }): Promise<StartState> {
  const parsed = opdrachtSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Kies een strategie en een roosterjaar." };
  }
  try {
    const runId = await startGeneration(parsed.data);
    revalidatePath("/roostercommissie/simulatie");
    return { ok: true, runId };
  } catch (error) {
    if (error instanceof ActiveGenerationError) {
      return { ok: false, error: error.message, activeRunId: error.runId };
    }
    return { ok: false, error: melding(error, "De generatie kon niet worden gestart.") };
  }
}

export async function stopGeneratieAction(runId: string): Promise<{ readonly error?: string }> {
  const id = z.uuid().safeParse(runId);
  if (!id.success) {
    return { error: "Ongeldige opdrachtverwijzing." };
  }
  try {
    await cancelGeneration(id.data);
    return {};
  } catch (error) {
    return { error: melding(error, "Stoppen kon niet worden doorgegeven.") };
  }
}

/**
 * Een foutmelding die zegt wat er niet lukte.
 *
 * Toegang en "bestaat niet" hebben een eigen, veilige tekst. Al het andere was
 * voorheen "Er is iets misgegaan", en daar kan een roostermaker niets mee; de
 * handeling staat er nu bij, de technische oorzaak in het serverlogboek.
 */
function melding(error: unknown, handeling: string): string {
  const publiek = toPublicError(error);
  if (publiek.status !== 500) {
    return publiek.message;
  }
  return `${handeling} De technische oorzaak staat in het serverlogboek; probeer het over een moment opnieuw.`;
}
