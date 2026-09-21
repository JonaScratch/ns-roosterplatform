"use server";

import { z } from "zod";
import { askAgent } from "@/server/agent/agent";
import { requestStop } from "@/server/agent/activity";
import { setAgentSuspended } from "@/server/agent/capabilities";
import { currentActor } from "@/server/auth/session";
import { requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import { cancelGeneration } from "@/server/services/generation-service";
import type { AgentAntwoordJson } from "./types";

/**
 * Eén vraag stellen aan de roosteragent.
 *
 * Hier staat alleen validatie en doorgeven. De rechten zitten in de agent zelf
 * en in elke tool afzonderlijk: dit scherm kan niets openzetten wat daar dicht
 * staat. Wie geen recht heeft, krijgt geen lege pagina maar een antwoord waarin
 * staat wat er ontbreekt — dat is het verschil tussen "stuk" en "mag niet".
 */

const invoerSchema = z.object({
  tekst: z.string().trim().min(2, "Stel een vraag.").max(2000),
  sessionId: z.string().min(1).nullish(),
  context: z.object({
    source: z.enum(["official", "candidate"]).default("official"),
    candidateId: z.string().min(1).nullish(),
    rosterCode: z.string().min(1).nullish(),
    lineNumber: z.number().int().positive().nullish(),
    weekday: z.number().int().min(1).max(7).nullish(),
    dutyCode: z.string().min(1).nullish(),
    locationCode: z.string().min(1).default("DDR"),
  }),
});

export async function vraagAgentAction(invoer: unknown): Promise<AgentAntwoordJson> {
  const leeg = {
    ok: false,
    sessionId: null,
    intent: "ONBEKEND",
    reasoning: "",
    sources: [],
    tools: [],
    contextUsed: { source: "official", rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, missing: [] },
    usedRosterCode: null,
    level: "A" as const,
    model: "geen",
    isLanguageModel: false,
  };

  const actor = await currentActor();
  if (!actor) {
    return { ...leeg, text: "Je sessie is verlopen. Meld je opnieuw aan.", status: "FOUT" };
  }

  const gelezen = invoerSchema.safeParse(invoer);
  if (!gelezen.success) {
    return { ...leeg, text: gelezen.error.issues[0]?.message ?? "Die vraag kan ik zo niet lezen.", status: "FOUT" };
  }

  const antwoord = await askAgent({
    actor,
    text: gelezen.data.tekst,
    sessionId: gelezen.data.sessionId ?? null,
    uiContext: {
      source: gelezen.data.context.source,
      candidateId: gelezen.data.context.candidateId ?? null,
      rosterCode: gelezen.data.context.rosterCode ?? null,
      lineNumber: gelezen.data.context.lineNumber ?? null,
      weekday: gelezen.data.context.weekday ?? null,
      dutyCode: gelezen.data.context.dutyCode ?? null,
      locationCode: gelezen.data.context.locationCode,
    },
  });

  const ctx = antwoord.contextUsed as AgentAntwoordJson["contextUsed"];
  return {
    ok: antwoord.status !== "FOUT",
    sessionId: antwoord.sessionId,
    text: antwoord.text,
    status: antwoord.status,
    intent: antwoord.intent,
    reasoning: antwoord.reasoning,
    sources: antwoord.sources,
    tools: antwoord.toolCalls.map((c) => ({ tool: c.tool, ok: c.ok, durationMs: c.ms })),
    contextUsed: ctx,
    usedRosterCode: gebruiktRooster(antwoord.toolCalls) ?? ctx.rosterCode,
    level: antwoord.level,
    model: antwoord.model,
    isLanguageModel: antwoord.isLanguageModel,
  };
}

/**
 * Welk rooster is er werkelijk geraadpleegd?
 *
 * Uit de toolaanroepen, want dat is wat er echt is gebeurd — niet uit wat het
 * scherm had ingesteld. Die twee kunnen verschillen zodra iemand in zijn vraag
 * een rooster noemt.
 */
function gebruiktRooster(calls: readonly { readonly input: unknown }[]): string | null {
  for (const call of calls) {
    const input = call.input as { rosterCode?: unknown } | null;
    if (input && typeof input.rosterCode === "string") return input.rosterCode;
  }
  return null;
}

/**
 * De noodrem, vanuit het activiteitenpaneel.
 *
 * Stoppen kan iedereen met AGENT_STOP; het is de veilige kant op. Wat hier
 * gebeurt is echt: de vlag staat in de database, de agent leest hem voordat hij
 * iets start, en een lopende opdracht wordt apart afgebroken. Een knop die
 * alleen het scherm verandert, zou niets stoppen.
 */
export async function zetAgentStilAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const gelezen = z
    .object({ suspended: z.boolean(), reason: z.string().trim().max(200).optional(), locationCode: z.string().min(1).optional() })
    .safeParse(input);
  if (!gelezen.success) return { ok: false, message: "Dat verzoek kan ik niet lezen." };

  const actor = await requirePermission(PERMISSIONS.AGENT_STOP);
  const scope = await locationScopeFor(actor, gelezen.data.locationCode ?? null);
  await setAgentSuspended(actor, scope.code, gelezen.data.suspended, gelezen.data.reason);
  return {
    ok: true,
    message: gelezen.data.suspended
      ? "De agent is stilgezet. Hij beantwoordt nog vragen, maar start niets meer."
      : "De agent staat weer aan.",
  };
}

/** Een lopende activiteit van de agent stoppen. */
export async function stopActiviteitAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const gelezen = z.object({ activityId: z.uuid() }).safeParse(input);
  if (!gelezen.success) return { ok: false, message: "Onbekende activiteit." };
  const actor = await requirePermission(PERMISSIONS.AGENT_STOP);
  await requestStop(actor, gelezen.data.activityId);
  return { ok: true, message: "Het stopverzoek is vastgelegd; de activiteit stopt bij de eerstvolgende stap." };
}

/** De lopende generatieopdracht afbreken, vanuit hetzelfde paneel. */
export async function stopOpdrachtAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const gelezen = z.object({ runId: z.uuid() }).safeParse(input);
  if (!gelezen.success) return { ok: false, message: "Onbekende opdracht." };
  await cancelGeneration(gelezen.data.runId);
  return { ok: true, message: "De opdracht wordt afgebroken." };
}
