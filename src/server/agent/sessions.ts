import "server-only";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * Gesprekken teruglezen.
 *
 * ## Waarom alleen je eigen gesprekken
 *
 * Een gesprek bevat wat iemand zich afvroeg, in welke bewoordingen, en welke
 * twijfel daarachter zat. Dat is werkmateriaal van die persoon en niet iets om
 * over de schouder mee te lezen. Wie een gesprek wil delen, kopieert het
 * antwoord; er is geen scherm dat andermans gesprekken opent.
 *
 * Het auditlogboek legt apart vast dát de agent iets is gevraagd en welke tools
 * daarbij zijn gebruikt — daar gaat het over verantwoording, niet over inhoud.
 */

export interface GesprekSamenvatting {
  readonly id: string;
  readonly title: string;
  readonly lastMessageAt: Date | null;
  readonly messageCount: number;
}

export interface GesprekBerichtRij {
  readonly id: string;
  readonly role: "USER" | "AGENT" | "SYSTEM";
  readonly text: string;
  readonly sources: readonly string[];
  readonly tools: readonly string[];
  readonly model: string | null;
}

/** De gesprekken van deze gebruiker op deze standplaats, nieuwste eerst. */
export async function ownSessions(actor: Actor, locationCode: string, take = 10): Promise<readonly GesprekSamenvatting[]> {
  const rijen = await prisma.agentSession.findMany({
    where: { createdByUserId: actor.userId, locationCode },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take,
    select: { id: true, title: true, lastMessageAt: true, _count: { select: { messages: true } } },
  });
  return rijen.map((r) => ({ id: r.id, title: r.title, lastMessageAt: r.lastMessageAt, messageCount: r._count.messages }));
}

/** De beurten van één gesprek — alleen als het van deze gebruiker is. */
export async function ownSessionMessages(actor: Actor, sessionId: string): Promise<readonly GesprekBerichtRij[]> {
  const sessie = await prisma.agentSession.findFirst({
    where: { id: sessionId, createdByUserId: actor.userId },
    select: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, text: true, sources: true, toolCalls: true, model: true },
      },
    },
  });
  if (!sessie) return [];
  return sessie.messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    sources: Array.isArray(m.sources) ? (m.sources as string[]) : [],
    tools: Array.isArray(m.toolCalls) ? (m.toolCalls as { tool?: string }[]).map((c) => String(c.tool ?? "?")) : [],
    model: m.model,
  }));
}
