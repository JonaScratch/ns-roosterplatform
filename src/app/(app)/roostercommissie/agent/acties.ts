"use server";

import { z } from "zod";
import { askAgent } from "@/server/agent/agent";
import { currentActor } from "@/server/auth/session";
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
    level: antwoord.level,
    model: antwoord.model,
    isLanguageModel: antwoord.isLanguageModel,
  };
}
