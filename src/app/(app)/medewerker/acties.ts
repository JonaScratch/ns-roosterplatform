"use server";

import { markAllRead, markRead } from "@/server/services/notification-service";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import type { ReservePreferenceKind } from "@/lib/generated/prisma/enums";
import {
  registerInterest,
  withdrawInterest,
} from "@/server/services/available-duty-service";
import { cancelCaoDay, requestCaoDay } from "@/server/services/cao-day-service";
import { submitFeedback } from "@/server/services/feedback-service";
import { updateOwnPreferences } from "@/server/services/preferences-service";
import { cancelSwap, proposeSwap, respondToSwap } from "@/server/services/swap-service";
import { claimListing, publishListing, withdrawListing } from "@/server/services/ruilmarkt-service";
import { enrol, withdraw } from "@/server/services/waitlist-service";
import { rosterPreferencesSchema } from "@/server/validation/preferences";

/**
 * De handelingen van een medewerker.
 *
 * ## Waarom hier zo weinig staat
 *
 * Deze acties valideren de invoer en geven hem door. Alle regels, rechten en
 * controles zitten in de services die ze aanroepen. Zo kan het wegvallen van
 * een controle nooit het gevolg zijn van een nieuwe knop in een scherm: de
 * knop kán niet minder controle uitvoeren dan de service doet.
 *
 * Cross-site request forgery wordt afgevangen door Next.js zelf: server actions
 * accepteren alleen POST-verzoeken met een geldige oorsprong. Daar komt de
 * `SameSite=Lax`-sessiecookie bovenop.
 */



const idSchema = z.uuid("Ongeldige verwijzing.");

export async function toonBelangstellingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("availableDutyId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await registerInterest(parsed.data);
  revalidatePath("/medewerker/diensten");

  return result.accepted
    ? { notice: "Uw belangstelling is geregistreerd." }
    : { error: "Belangstelling is niet geregistreerd.", reasons: result.reasons };
}

export async function trekBelangstellingInAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("availableDutyId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }
  await withdrawInterest(parsed.data);
  revalidatePath("/medewerker/diensten");
  return { notice: "Uw belangstelling is ingetrokken." };
}

const swapSchema = z.object({
  ownScheduledDutyId: z.uuid(),
  counterpartyScheduledDutyId: z.uuid(),
  message: z.string().max(500).optional(),
});

export async function stelRuilVoorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = swapSchema.safeParse({
    ownScheduledDutyId: formData.get("ownScheduledDutyId"),
    counterpartyScheduledDutyId: formData.get("counterpartyScheduledDutyId"),
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) {
    return { error: "Kies zowel uw eigen dienst als de dienst van uw collega." };
  }

  const result = await proposeSwap(parsed.data);
  revalidatePath("/medewerker/ruilen");

  return result.created
    ? { notice: "Uw ruilvoorstel is verstuurd." }
    : { error: "Het voorstel is niet verstuurd.", reasons: result.reasons };
}

export async function beantwoordRuilAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("proposalId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }
  const accept = formData.get("antwoord") === "accepteren";

  const result = await respondToSwap(parsed.data, accept);
  revalidatePath("/medewerker/ruilen");
  revalidatePath("/medewerker/rooster");

  if (!result.ok) {
    return { error: "Het antwoord is niet verwerkt.", reasons: result.reasons };
  }
  return { notice: accept ? "De ruil is doorgevoerd." : "Het voorstel is afgewezen." };
}

export async function wachtlijstAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("baseRosterId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  if (formData.get("handeling") === "uitschrijven") {
    await withdraw(parsed.data);
    revalidatePath("/medewerker/wachtlijsten");
    return { notice: "U bent uitgeschreven." };
  }

  const result = await enrol(parsed.data);
  revalidatePath("/medewerker/wachtlijsten");
  return result.ok
    ? { notice: "U bent ingeschreven. Uw positie volgt uit de inschrijfdatum." }
    : { error: result.reason };
}

export async function voorkeurenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const preferences = rosterPreferencesSchema.safeParse({
    openVoorExtraDiensten: formData.get("openVoorExtraDiensten") === "on",
  });

  if (!preferences.success) {
    return { error: "De opgegeven voorkeur is niet geldig." };
  }

  const result = await updateOwnPreferences({
    reservePreference: formData.get("reservevoorkeur") as ReservePreferenceKind,
    preferences: preferences.data,
  });

  revalidatePath("/medewerker/reservevoorkeur");
  // De melding verschijnt pas nadat `updateOwnPreferences` heeft doorgegeven dat
  // de database het heeft vastgelegd. Nooit ervoor: "opgeslagen" op het scherm
  // terwijl er niets is weggeschreven, is de melding waar iemand op vertrouwt.
  return result.ok
    ? { notice: `Opgeslagen ${new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.` }
    : { error: result.reason };
}

const feedbackSchema = z.object({
  categories: z.array(z.string()).min(1, "Kies minimaal één antwoord."),
  satisfaction: z.coerce.number().int().min(1).max(5),
});

export async function feedbackAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = feedbackSchema.safeParse({
    categories: formData.getAll("categories").map(String),
    satisfaction: formData.get("satisfaction"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await submitFeedback({
    categories: parsed.data.categories as never,
    satisfaction: parsed.data.satisfaction,
  });

  revalidatePath("/medewerker/feedback");
  return result.ok
    ? { notice: "Bedankt. Uw feedback is geregistreerd en wordt geaggregeerd verwerkt." }
    : { error: result.reason };
}


/**
 * Een melding als gelezen markeren.
 *
 * De service kijkt of de melding van deze gebruiker is; deze actie geeft alleen
 * door. Een melding van iemand anders wordt niet gevonden — en die poging komt
 * in het beveiligingslog.
 */
export async function meldingGelezenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.uuid().safeParse(formData.get("notificationId"));
  if (!parsed.success) {
    return { error: "Ongeldige verwijzing." };
  }
  await markRead(parsed.data);
  revalidatePath("/medewerker/meldingen");
  revalidatePath("/medewerker");
  return {};
}

export async function alleMeldingenGelezenAction(): Promise<ActionState> {
  const aantal = await markAllRead();
  revalidatePath("/medewerker/meldingen");
  revalidatePath("/medewerker");
  return { notice: aantal === 0 ? "Er was niets ongelezen." : `${aantal} meldingen gelezen.` };
}

/**
 * Een eigen ruilverzoek intrekken.
 *
 * Alleen de aanvrager, alleen zolang het verzoek openstaat. De service
 * controleert beide; deze actie geeft door en toont de uitkomst.
 */
export async function trekRuilInAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("proposalId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await cancelSwap(parsed.data);
  revalidatePath("/medewerker/ruilen");
  revalidatePath("/medewerker/meldingen");

  return result.ok ? { notice: result.reason } : { error: result.reason };
}

// ── Ruilmarkt ────────────────────────────────────────────────────────────────

const publiceerSchema = z.object({
  scheduledDutyId: z.uuid(),
  preference: z.enum(["NONE", "EARLIER", "LATER"]),
});

export async function plaatsInRuilmarktAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = publiceerSchema.safeParse({
    scheduledDutyId: formData.get("scheduledDutyId"),
    preference: formData.get("preference") || "NONE",
  });
  if (!parsed.success) {
    return { error: "Kies een eigen dienst om aan te bieden." };
  }

  const result = await publishListing(parsed.data);
  revalidatePath("/medewerker/ruilen");

  return result.ok
    ? { notice: "Uw dienst staat in de ruilmarkt." }
    : { error: result.reason };
}

export async function trekRuilmarktplaatsingInAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("listingId"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await withdrawListing(parsed.data);
  revalidatePath("/medewerker/ruilen");

  return result.ok ? { notice: result.reason } : { error: result.reason };
}

const claimSchema = z.object({
  listingId: z.uuid(),
  ownScheduledDutyId: z.uuid(),
  message: z.string().max(500).optional(),
});

export async function claimRuilmarktplaatsingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = claimSchema.safeParse({
    listingId: formData.get("listingId"),
    ownScheduledDutyId: formData.get("ownScheduledDutyId"),
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) {
    return { error: "Kies welke eigen dienst u hiertegenover aanbiedt." };
  }

  const result = await claimListing(parsed.data);
  revalidatePath("/medewerker/ruilen");

  return result.created
    ? { notice: "Uw ruilvoorstel is verstuurd." }
    : { error: "Het voorstel is niet verstuurd.", reasons: result.reasons };
}

/**
 * Een CAO-dag aanvragen.
 *
 * De datum wordt hier alleen op vorm gecontroleerd. Of hij mag — zes weken
 * vooruit, een werkdag, binnen het tegoed — bepaalt de service, in Amsterdamse
 * tijd en met dezelfde functie waarmee het scherm zijn vakjes grijs maakt.
 * De melding "aangevraagd" verschijnt pas nadat de service de commit heeft
 * bevestigd.
 */
export async function caoDagAanvragenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Kies een datum in de kalender.")
    .safeParse(formData.get("datum"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await requestCaoDay(parsed.data);
  revalidatePath("/medewerker/cao-dagen");
  revalidatePath("/medewerker");

  return result.ok
    ? { notice: "Uw CAO-dag is aangevraagd en staat bij de dienstindeling." }
    : { error: result.reason ?? "De aanvraag is niet vastgelegd." };
}

/** Een eigen CAO-dagaanvraag intrekken, zolang hij nog niet verwerkt is. */
export async function caoDagIntrekkenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = idSchema.safeParse(formData.get("id"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const result = await cancelCaoDay(parsed.data);
  revalidatePath("/medewerker/cao-dagen");

  return result.ok
    ? { notice: "Uw aanvraag is ingetrokken." }
    : { error: result.reason ?? "De aanvraag is niet ingetrokken." };
}
