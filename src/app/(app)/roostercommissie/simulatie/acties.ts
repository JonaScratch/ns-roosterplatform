"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { rosterYear } from "@/domain/roster-year";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import { toPublicError } from "@/server/security/authorize";
import {
  ActiveGenerationError,
  archiveCandidate,
  markPreferredCandidate,
  startRebuild,
} from "@/server/services/generation-service";
import {
  promoteCandidateToVersions,
  validateStoredCandidate,
} from "@/server/services/simulation-service";

/**
 * De handelingen op de resultaten van een generatie.
 *
 * Er staat hier bewust géén publicatieactie en géén generatieactie. Genereren
 * gebeurt onder Genereren & simulatie; publiceren blijft een aparte handeling
 * achter de bestaande publicatiepoort. Vastleggen als roosterversie kan alleen
 * wanneer diezelfde poort het toestaat — `promoteCandidateToVersions` weigert
 * alles wat niet volledig schoon is gevalideerd.
 */

const idSchema = z.object({ candidateId: z.uuid() });

function melding(error: unknown, handeling: string): string {
  const publiek = toPublicError(error);
  if (publiek.status !== 500) {
    return publiek.message;
  }
  return `${handeling} De technische oorzaak staat in het serverlogboek.`;
}

/** Alleen voor oude kandidaten die nog nooit zijn getoetst; nieuwe zijn dat al. */
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
    if (!review.simulationEligible) {
      return {
        error:
          review.status === "CONFIRMED_HARD_VIOLATION"
            ? "Niet bruikbaar: bevestigde harde overtreding gevonden."
            : "Niet bruikbaar: deze kandidaat kon niet volledig worden beoordeeld.",
        reasons: [...review.reasons.violations, ...review.reasons.structural],
      };
    }
    return {
      notice: "Gevalideerd: geen bevestigde harde overtredingen. Formele publicatie blijft geblokkeerd.",
    };
  } catch (error) {
    return { error: melding(error, "Valideren is niet gelukt.") };
  }
}

export async function voorkeurAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = idSchema.safeParse({ candidateId: formData.get("candidateId") });
  if (!parsed.success) {
    return { error: "Onbekende kandidaat." };
  }
  const aan = formData.get("preferred") === "true";
  try {
    await markPreferredCandidate(parsed.data.candidateId, aan);
    revalidatePath("/roostercommissie/simulatie", "layout");
    return {
      notice: aan
        ? "Gemarkeerd als voorkeurskandidaat. Dit is geen publicatie en geen vastlegging."
        : "Voorkeursmarkering ingetrokken.",
    };
  } catch (error) {
    return { error: melding(error, "Markeren is niet gelukt.") };
  }
}

export async function archiveerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = idSchema.safeParse({ candidateId: formData.get("candidateId") });
  if (!parsed.success) {
    return { error: "Onbekende kandidaat." };
  }
  const archiveren = formData.get("archived") !== "false";
  try {
    await archiveCandidate(parsed.data.candidateId, archiveren);
    revalidatePath("/roostercommissie/simulatie", "layout");
    return {
      notice: archiveren
        ? "Gearchiveerd. De kandidaat blijft bewaard en is terug te vinden onder Archief."
        : "Teruggezet uit het archief.",
    };
  } catch (error) {
    return { error: melding(error, "Archiveren is niet gelukt.") };
  }
}

const herbouwSchema = z.object({
  candidateId: z.uuid(),
  goals: z.array(z.enum(Object.keys(REBUILD_GOAL_LABELS) as [RebuildGoal, ...RebuildGoal[]])),
  preserveGoodParts: z.boolean(),
  note: z.string().max(1000).nullable(),
});

export async function herbouwAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = herbouwSchema.safeParse({
    candidateId: formData.get("candidateId"),
    goals: formData.getAll("goals"),
    preserveGoodParts: formData.get("preserveGoodParts") === "on",
    note: (formData.get("note") as string | null) || null,
  });
  if (!parsed.success) {
    return { error: "Kies ten minste één punt om te verbeteren." };
  }
  if (parsed.data.goals.length === 0) {
    return { error: "Kies ten minste één punt om te verbeteren." };
  }
  let runId: string;
  try {
    runId = await startRebuild({
      parentCandidateId: parsed.data.candidateId,
      goals: parsed.data.goals,
      preserveGoodParts: parsed.data.preserveGoodParts,
      note: parsed.data.note,
    });
  } catch (error) {
    if (error instanceof ActiveGenerationError) {
      return { error: error.message };
    }
    return { error: melding(error, "De herbouw kon niet worden gestart.") };
  }
  revalidatePath("/roostercommissie/genereren");
  // De voortgang staat op het generatiescherm; daar vindt het scherm de lopende
  // opdracht vanzelf terug.
  redirect(`/roostercommissie/genereren?run=${runId}`);
}

const vastleggenSchema = z.object({ candidateId: z.uuid(), rosterYear: z.coerce.number().int() });

export async function legVastAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = vastleggenSchema.safeParse({
    candidateId: formData.get("candidateId"),
    rosterYear: formData.get("rosterYear"),
  });
  if (!parsed.success) {
    return { error: "Onbekende kandidaat of roosterjaar." };
  }
  try {
    const jaar = rosterYear(parsed.data.rosterYear);
    const uitkomst = await promoteCandidateToVersions(parsed.data.candidateId, `Roosterjaar ${jaar.year}`);
    revalidatePath("/roostercommissie/roosters");
    return {
      notice: `Vastgelegd als roosterversie voor ${uitkomst.versions.length} basisrooster(s). Niet gepubliceerd.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : melding(error, "Vastleggen is niet gelukt.") };
  }
}
