"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import {
  endTemporaryPlacement,
  placeTemporarily,
} from "@/server/services/roster-membership-service";
import { assignReserve } from "@/server/services/reserve-matching-service";
import { attemptReserveFill, openForEmployees, releaseDuty } from "@/server/services/reserve-service";
import { awardAvailableDuty } from "@/server/services/available-duty-service";
import { registerCaoDay } from "@/server/services/cao-day-service";

/**
 * De handelingen van Dienstindeling.
 *
 * Elke actie geeft de reden van de uitkomst terug, ook bij succes. Dat is geen
 * beleefdheid: wie een dienst toewijst op voorstel van het systeem, moet kunnen
 * zien waaróm dat voorstel er lag — en die reden komt uit de rules engine, niet
 * uit dit bestand.
 */

const idSchema = z.uuid("Ongeldige verwijzing.");

export async function reserveInvullenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("availableDutyId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await attemptReserveFill(parsed.data);
  revalidatePath("/dienstindeling");
  revalidatePath("/dienstindeling/openstaand");
  revalidatePath("/dienstindeling/reserve");

  if (result.outcome === "FILLED") {
    return {
      notice: `Toegewezen aan ${result.filledEmployeeNumber}.`,
      reasons: [result.reason],
    };
  }
  return {
    error: "Reserve bood geen invulling.",
    reasons: [result.reason, "U kunt de dienst nu openstellen voor medewerkers."],
  };
}

export async function dienstOpenstellenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("availableDutyId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await openForEmployees(parsed.data);
  revalidatePath("/dienstindeling");
  revalidatePath("/dienstindeling/openstaand");
  revalidatePath("/dienstindeling/beschikbaar");

  return result.ok ? { notice: result.reason } : { error: result.reason };
}

export async function dienstToewijzenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("availableDutyId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await awardAvailableDuty(parsed.data);
  revalidatePath("/dienstindeling");
  revalidatePath("/dienstindeling/beschikbaar");

  return result.awardedEmployeeNumber
    ? {
        notice: `Toegewezen aan ${result.awardedEmployeeNumber}.`,
        reasons: [result.reason],
      }
    : { error: "Niet toegewezen.", reasons: [result.reason] };
}

const releaseSchema = z.object({
  scheduledDutyId: z.uuid(),
  positionType: z.enum(["VERLOF", "RUST"]),
  reason: z.string().trim().min(3, "Geef een reden op.").max(200),
});

export async function dienstVrijgevenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = releaseSchema.safeParse({
    scheduledDutyId: formData.get("scheduledDutyId"),
    positionType: formData.get("positionType"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await releaseDuty({
    scheduledDutyId: parsed.data.scheduledDutyId,
    newPositionType: parsed.data.positionType,
    reason: parsed.data.reason,
  });
  revalidatePath("/dienstindeling");
  revalidatePath("/dienstindeling/dagplanning");

  return result.ok ? { notice: result.reason } : { error: result.reason };
}

/**
 * Een openstaande dienst koppelen aan een reservemedewerker.
 *
 * De keuze is van de planner; de toets is van het systeem. De service voert de
 * hele beoordeling opnieuw uit op het moment van klikken, dus wat hier gebeurt
 * is niet meer dan doorgeven en de uitkomst tonen.
 */
export async function toewijzenAanReserveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      availableDutyId: z.uuid(),
      employeeId: z.uuid(),
      reden: z.string().trim().min(3, "Noteer kort waarom deze keuze.").max(300),
    })
    .safeParse({
      availableDutyId: formData.get("availableDutyId"),
      employeeId: formData.get("employeeId"),
      reden: formData.get("reden"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await assignReserve({
    availableDutyId: parsed.data.availableDutyId,
    employeeId: parsed.data.employeeId,
    reason: parsed.data.reden,
  });

  revalidatePath("/dienstindeling");
  revalidatePath("/dienstindeling/openstaand");
  revalidatePath("/dienstindeling/reserve");

  return result.ok
    ? { notice: `Dienst toegewezen aan ${result.employeeNumber}.` }
    : { error: result.reason };
}

/**
 * Een medewerker tijdelijk in een ander rooster plaatsen.
 *
 * De service toetst of het doelrooster bestaat, of de regel erin voorkomt, of
 * er geen andere tijdelijke plaatsing overlapt en of de standplaats klopt.
 * Deze actie geeft door en toont de uitkomst.
 */
export async function tijdelijkePlaatsingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      employeeId: z.uuid(),
      doelrooster: z.string().trim().min(2).max(32),
      startregel: z.coerce.number().int().min(1).max(200),
      vanaf: z.string().regex(/^\d{4}-W\d{2}$/, "Gebruik een ISO-week, bijvoorbeeld 2027-W06."),
      totWeek: z.string().regex(/^\d{4}-W\d{2}$/, "Gebruik een ISO-week, bijvoorbeeld 2027-W09."),
      reden: z.string().trim().min(3, "Noteer kort waarom.").max(300),
    })
    .safeParse({
      employeeId: formData.get("employeeId"),
      doelrooster: formData.get("doelrooster"),
      startregel: formData.get("startregel"),
      vanaf: formData.get("vanaf"),
      totWeek: formData.get("totWeek"),
      reden: formData.get("reden"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await placeTemporarily({
    employeeId: parsed.data.employeeId,
    baseRosterCode: parsed.data.doelrooster,
    anchorRuleIndex: parsed.data.startregel,
    fromWeek: parsed.data.vanaf,
    untilWeek: parsed.data.totWeek,
    reason: parsed.data.reden,
  });

  revalidatePath("/dienstindeling/roosters");
  revalidatePath(`/dienstindeling/roosters/${parsed.data.employeeId}`);

  return result.ok ? { notice: result.reason } : { error: result.reason };
}

/** Een lopende tijdelijke plaatsing vroegtijdig beëindigen. */
export async function beeindigPlaatsingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      membershipId: z.uuid(),
      reden: z.string().trim().min(3, "Noteer kort waarom.").max(300),
    })
    .safeParse({
      membershipId: formData.get("membershipId"),
      reden: formData.get("reden"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await endTemporaryPlacement(parsed.data.membershipId, parsed.data.reden);
  revalidatePath("/dienstindeling/roosters");
  return result.ok ? { notice: result.reason } : { error: result.reason };
}

/**
 * Een CAO-dag in het NS-verlofboek zetten.
 *
 * Deze knop heet geen "goedkeuren". Een geldige CAO-dagaanvraag is een recht;
 * wat hier gebeurt is een handeling — de dag is in het verlofboek gezet en dat
 * wordt hier vastgelegd. De versie gaat mee zodat twee gelijktijdige klikken
 * niet twee meldingen aan dezelfde medewerker opleveren.
 */
export async function caoDagVerwerktAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({ id: z.uuid(), versie: z.coerce.number().int().positive() })
    .safeParse({ id: formData.get("id"), versie: formData.get("versie") });
  if (!parsed.success) {
    return { error: "Ongeldige verwijzing." };
  }

  const result = await registerCaoDay(parsed.data.id, parsed.data.versie);
  revalidatePath("/dienstindeling/cao-dagen");
  revalidatePath("/dienstindeling");

  return result.ok
    ? { notice: "De CAO-dag staat als verwerkt in het verlofboek." }
    : { error: result.reason ?? "De aanvraag is niet bijgewerkt." };
}
