"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { rosterYear } from "@/domain/roster-year";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import { requirePermission, toPublicError } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import { setProjectGoal } from "@/server/agent/project-goals";
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
import { HUMAN_REVIEW_VERDICTS, PAIRWISE_CHOICES } from "@/domain/human-review";
import {
  ReviewInputError,
  recordLineReview,
  recordPairwisePreference,
} from "@/server/services/human-review-service";

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

// ── Menselijke beoordeling ───────────────────────────────────────────────────
//
// Alleen voor training en foutopsporing. Een oordeel wordt bewaard met de
// versies van het kwaliteitsmodel en de zoekmachine; het verandert geen gewicht
// en geen model. Zie src/domain/human-review.ts.

const oordeelSchema = z.object({
  candidateId: z.uuid(),
  rosterCode: z.string().min(1).max(40),
  lineNumber: z.coerce.number().int().min(1).max(200).nullable(),
  verdict: z.enum(HUMAN_REVIEW_VERDICTS),
  reasons: z.array(z.string().max(60)).max(20),
  note: z.string().max(1000).nullable(),
});

export async function beoordeelRegelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const regel = formData.get("lineNumber");
  const parsed = oordeelSchema.safeParse({
    candidateId: formData.get("candidateId"),
    rosterCode: formData.get("rosterCode"),
    lineNumber: regel === null || regel === "" ? null : regel,
    verdict: formData.get("verdict"),
    reasons: formData.getAll("reasons").map(String),
    note: (formData.get("note") as string | null) || null,
  });
  if (!parsed.success) {
    return { error: "Kies goed, twijfel of slecht." };
  }
  try {
    await recordLineReview(parsed.data);
    revalidatePath(`/roostercommissie/simulatie/${parsed.data.candidateId}`, "layout");
    return { notice: "Oordeel bewaard. Het wordt gebruikt voor de volgende ijking, niet automatisch." };
  } catch (error) {
    if (error instanceof ReviewInputError) return { error: error.message };
    return { error: melding(error, "Het oordeel is niet bewaard.") };
  }
}

const voorkeurSchema = z.object({
  firstCandidateId: z.uuid(),
  secondCandidateId: z.uuid(),
  rosterCode: z.string().min(1).max(40).nullable(),
  choice: z.enum(PAIRWISE_CHOICES),
  reasons: z.array(z.string().max(60)).max(20),
  note: z.string().max(1000).nullable(),
});

export async function kiesVoorkeurAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = voorkeurSchema.safeParse({
    firstCandidateId: formData.get("firstCandidateId"),
    secondCandidateId: formData.get("secondCandidateId"),
    rosterCode: (formData.get("rosterCode") as string | null) || null,
    choice: formData.get("choice"),
    reasons: formData.getAll("reasons").map(String),
    note: (formData.get("note") as string | null) || null,
  });
  if (!parsed.success) {
    return { error: "Kies welke kandidaat u beter vindt, of dat ze gelijk zijn." };
  }
  try {
    await recordPairwisePreference(parsed.data);
    return { notice: "Voorkeur bewaard. Het wordt gebruikt voor de volgende ijking, niet automatisch." };
  } catch (error) {
    if (error instanceof ReviewInputError) return { error: error.message };
    return { error: melding(error, "De voorkeur is niet bewaard.") };
  }
}

/**
 * Een laag-2-doel aan- of uitzetten.
 *
 * Laag 2 staat bóvenop de vaste kwaliteitsmeting en raakt die niet aan; zie
 * src/server/agent/project-goals.ts. Het recht is hetzelfde als voor genereren:
 * wie een opdracht mag geven, mag bepalen waar die opdracht extra op let.
 */
export async function zetProjectdoelAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const gelezen = z
    .object({ goal: z.string().min(2).max(40), active: z.boolean(), locationCode: z.string().min(1).max(8) })
    .safeParse(input);
  if (!gelezen.success) return { ok: false, message: "Dat verzoek kan ik niet lezen." };
  if (!(gelezen.data.goal in REBUILD_GOAL_LABELS)) return { ok: false, message: "Dat doel bestaat niet." };

  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, gelezen.data.locationCode);
  await setProjectGoal(actor, scope.code, gelezen.data.goal as RebuildGoal, gelezen.data.active);
  revalidatePath("/roostercommissie/simulatie");
  return {
    ok: true,
    message: gelezen.data.active
      ? `"${REBUILD_GOAL_LABELS[gelezen.data.goal as RebuildGoal]}" telt mee bij de volgende opdracht.`
      : `"${REBUILD_GOAL_LABELS[gelezen.data.goal as RebuildGoal]}" telt niet meer mee.`,
  };
}
