import "server-only";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { AGENT_CAPABILITIES, AgentCapabilityError, agentMay, currentGrant, levelOf } from "./capabilities";
import { type UiContext, resolveContext, uiContextSchema } from "./context";
import { stubModel } from "./model/stub";
import type { AgentAnswer, ChatModel, PlanRequest } from "./model/types";
import { type ToolCall, callTool, toolCatalogue } from "./tools";

/**
 * De agent: één beurt in het gesprek, van vraag tot antwoord.
 *
 * ## De vaste volgorde
 *
 * context bepalen → bevoegdheden lezen → plannen → tools aanroepen → antwoorden
 * → vastleggen. Elke stap is te volgen: welke tools zijn gebruikt, waarop het
 * antwoord steunt, en wat de agent van plan was.
 *
 * ## Wat hier bewust níet gebeurt
 *
 * Er wordt niets gewijzigd. Deze laag leest en legt uit. Opdrachten starten,
 * voorkeuren vastleggen en experimenten draaien komen in latere fasen, elk met
 * een eigen bevoegdheid. Wat de agent niet mag, zegt hij hardop in plaats van
 * stil te blijven.
 */

export function modelForRequest(): ChatModel {
  // Later: een echt taalmodel achter dezelfde adapter, zodra daarover is
  // besloten. Tot dan de lokale stub, en die telt niet als taalvaardigheid.
  return stubModel;
}

export interface AskResult extends AgentAnswer {
  readonly sessionId: string | null;
  readonly intent: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
  readonly model: string;
  readonly isLanguageModel: boolean;
  readonly level: "A" | "B" | "C";
  readonly capabilities: readonly string[];
  readonly contextUsed: Record<string, unknown>;
}

export async function askAgent(input: {
  readonly actor: Actor;
  readonly text: string;
  readonly uiContext: UiContext;
  readonly sessionId?: string | null;
  /** Zonder opslag: voor de benchmark, die geen gesprekken hoort achter te laten. */
  readonly persist?: boolean;
}): Promise<AskResult> {
  const model = modelForRequest();
  const ctx = uiContextSchema.parse(input.uiContext);
  const resolved = await resolveContext(ctx);
  const grant = await currentGrant(resolved.locationCode, ctx.candidateId ? null : null);

  const basis = {
    sessionId: input.sessionId ?? null,
    model: model.name,
    isLanguageModel: model.isLanguageModel,
    level: levelOf(grant),
    capabilities: grant.capabilities,
    contextUsed: {
      source: resolved.source,
      candidateId: resolved.candidate?.id ?? null,
      rosterCode: resolved.roster?.code ?? null,
      lineNumber: resolved.lineNumber,
      weekday: resolved.weekday,
      dutyCode: resolved.duty?.code ?? null,
      missing: resolved.missing,
    },
  };

  if (!agentMay(input.actor, grant, AGENT_CAPABILITIES.CHAT)) {
    const fout = new AgentCapabilityError(AGENT_CAPABILITIES.CHAT, "GEEN_RECHT");
    await recordAudit({ actor: input.actor, action: "agent.vraag.geweigerd", objectType: "AgentSession", objectId: input.sessionId ?? null, result: "DENIED", reason: fout.message });
    return { ...basis, text: fout.message, data: null, sources: [], status: "GEWEIGERD", intent: "GEWEIGERD", reasoning: "geen recht om de agent te gebruiken", toolCalls: [] };
  }

  const geschiedenis = input.sessionId
    ? (
        await prisma.agentMessage.findMany({
          where: { sessionId: input.sessionId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { role: true, text: true },
        })
      )
        .reverse()
        .filter((m) => m.role !== "SYSTEM")
        .map((m) => ({ role: m.role === "USER" ? ("USER" as const) : ("AGENT" as const), text: m.text }))
    : [];

  const verzoek: PlanRequest = {
    text: input.text,
    context: {
      locationCode: resolved.locationCode,
      source: resolved.source,
      candidateId: resolved.candidate?.id ?? null,
      rosterCode: resolved.roster?.code ?? null,
      lineNumber: resolved.lineNumber,
      weekday: resolved.weekday,
      dutyCode: resolved.duty?.code ?? null,
      missing: resolved.missing,
    },
    tools: toolCatalogue(input.actor),
    history: geschiedenis,
    capabilities: grant.capabilities,
  };

  const plan = await model.plan(verzoek);

  const calls: ToolCall[] = [];
  const results: { tool: string; ok: boolean; data: unknown; sources: readonly string[]; error?: string }[] = [];
  for (const stap of plan.toolCalls) {
    const { result, call, error } = await callTool(input.actor, stap.tool, stap.input);
    calls.push(call);
    results.push({ tool: stap.tool, ok: result !== null, data: result?.data ?? null, sources: result?.sources ?? [], error });
  }

  const antwoord = await model.compose({ ...verzoek, plan, results });

  if (input.persist !== false) {
    const sessionId = input.sessionId ?? (await maakSessie(input.actor, resolved.locationCode, input.text)).id;
    await prisma.agentMessage.createMany({
      data: [
        { sessionId, role: "USER", text: input.text, uiContext: basis.contextUsed as object },
        {
          sessionId,
          role: "AGENT",
          text: antwoord.text,
          uiContext: basis.contextUsed as object,
          toolCalls: calls as unknown as object,
          sources: antwoord.sources as unknown as object,
          model: model.name,
        },
      ],
    });
    await prisma.agentSession.update({ where: { id: sessionId }, data: { lastMessageAt: new Date() } });
    await recordAudit({
      actor: input.actor,
      action: "agent.vraag.beantwoord",
      objectType: "AgentSession",
      objectId: sessionId,
      newValue: { intent: plan.intent, status: antwoord.status, tools: calls.map((c) => c.tool), model: model.name },
    });
    return { ...basis, ...antwoord, sessionId, intent: plan.intent, reasoning: plan.reasoning, toolCalls: calls };
  }

  return { ...basis, ...antwoord, intent: plan.intent, reasoning: plan.reasoning, toolCalls: calls };
}

async function maakSessie(actor: Actor, locationCode: string, eersteVraag: string) {
  const titel = eersteVraag.length > 60 ? `${eersteVraag.slice(0, 57)}…` : eersteVraag;
  return prisma.agentSession.create({ data: { locationCode, title: titel, createdByUserId: actor.userId } });
}
