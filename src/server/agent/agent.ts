import "server-only";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { finishActivity, heartbeat, recordEvent, startActivity } from "./activity";
import { AGENT_CAPABILITIES, AgentCapabilityError, agentMay, currentGrant, levelOf } from "./capabilities";
import { type UiContext, resolveContext, uiContextSchema } from "./context";
import { stubModel } from "./model/stub";
import type { AgentAnswer, AgentPlan, ChatModel, PlanRequest } from "./model/types";
import { projectGoals } from "./project-goals";
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
    // Wat er werkelijk overblijft: recht van de vrager én toekenning én de
    // noodrem. Een planner die meer ziet dan dat, belooft wat de
    // rechtencontrole daarna weigert.
    capabilities: grant.capabilities.filter((c) => agentMay(input.actor, grant, c)),
    suspended: grant.suspendedAt !== null,
  };

  // Vanaf hier is er iets te volgen. Het activiteitenpaneel leest mee, ook als
  // dit tabblad wordt gesloten: de stappen staan in de database.
  const activiteit = input.persist === false ? null : await startActivity({
    actor: input.actor,
    locationCode: resolved.locationCode,
    kind: "CHAT",
    title: input.text.length > 70 ? `${input.text.slice(0, 67)}…` : input.text,
    sessionId: input.sessionId ?? null,
    detail: basis.contextUsed,
  });
  const stap = async (kind: Parameters<typeof recordEvent>[0]["kind"], message: string, detail?: Record<string, unknown>) => {
    if (!activiteit) return;
    await recordEvent({ activity: activiteit, locationCode: resolved.locationCode, sessionId: input.sessionId ?? null, kind, message, detail });
  };

  await stap("VRAAG", input.text);

  const ruwPlan = await model.plan(verzoek);
  // Laag 2 hoort in elk voorstel terecht te komen, ook als het model er niet om
  // vroeg: het zijn de doelen die de commissie voor dit project heeft gezet.
  // Het model bedenkt ze niet en kan ze ook niet wegnemen; ze worden hier
  // toegevoegd en in het antwoord genoemd.
  const plan = await metProjectdoelen(ruwPlan, resolved.locationCode);
  await stap("PLAN", plan.reasoning || "geen toelichting", { intent: plan.intent, tools: plan.toolCalls.map((c) => c.tool) });

  const calls: ToolCall[] = [];
  const results: { tool: string; ok: boolean; data: unknown; sources: readonly string[]; error?: string; note?: string }[] = [];
  for (const toolStap of plan.toolCalls) {
    if (activiteit) await heartbeat(activiteit);
    const { result, call, error } = await callTool(input.actor, toolStap.tool, toolStap.input);
    calls.push(call);
    results.push({ tool: toolStap.tool, ok: result !== null, data: result?.data ?? null, sources: result?.sources ?? [], error, note: call.note });
    await stap(
      call.ok ? "TOOL" : "FOUT",
      call.ok ? `${toolStap.tool} geraadpleegd (${call.ms} ms)` : `${toolStap.tool} leverde niets op: ${call.note ?? error ?? "onbekend"}`,
      { sources: result?.sources ?? [] },
    );
  }

  const antwoord = await model.compose({ ...verzoek, plan, results });
  await stap(antwoord.status === "GEWEIGERD" ? "WEIGERING" : "ANTWOORD", antwoord.text.length > 200 ? `${antwoord.text.slice(0, 197)}…` : antwoord.text, {
    status: antwoord.status,
    sources: antwoord.sources,
  });
  if (activiteit) await finishActivity(activiteit, antwoord.status === "FOUT" ? "FAILED" : "DONE");

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

/**
 * De laag-2-doelen van dit project in het voorstel zetten.
 *
 * Ze komen erbij, ze vervangen niets, en ze staan in het voorstel zodat een
 * mens ziet waar zijn "ja" precies op slaat.
 */
async function metProjectdoelen(plan: AgentPlan, locationCode: string): Promise<AgentPlan> {
  if (!plan.proposal) return plan;
  const doelen = await projectGoals(locationCode);
  if (doelen.length === 0) return plan;

  const bestaand = Array.isArray(plan.proposal.goals) ? (plan.proposal.goals as string[]) : [];
  const samen = [...new Set([...bestaand, ...doelen.map((d) => d.goal)])];
  return {
    ...plan,
    proposal: {
      ...plan.proposal,
      goals: samen,
      layerTwoGoals: doelen.map((d) => ({ goal: d.goal, label: d.label, note: d.note })),
      note: `${String(plan.proposal.note ?? "")} (met de extra doelen van de commissie: ${doelen.map((d) => d.label).join(", ")})`.trim(),
    },
    reasoning: `${plan.reasoning}; laag 2 toegevoegd: ${doelen.map((d) => d.goal).join(", ")}`,
  };
}

async function maakSessie(actor: Actor, locationCode: string, eersteVraag: string) {
  const titel = eersteVraag.length > 60 ? `${eersteVraag.slice(0, 57)}…` : eersteVraag;
  return prisma.agentSession.create({ data: { locationCode, title: titel, createdByUserId: actor.userId } });
}
