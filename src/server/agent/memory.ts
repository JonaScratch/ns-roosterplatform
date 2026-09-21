import "server-only";
import type { MemoryKind, MemoryScope, MemoryStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { AGENT_CAPABILITIES, type AgentGrant, assertAgentMay } from "./capabilities";

/**
 * Het leergeheugen: wat het platform onthoudt, en onder welke voorwaarden.
 *
 * ## Vier lagen die náást elkaar staan
 *
 * PROJECT, LOCATION, NATIONAL en TECHNICAL. Ze schuiven niet in elkaar. Een
 * Dordrechtse voorkeur wordt niet vanzelf Rotterdams, ook niet als hij daar
 * misschien ook zou werken: wat op de ene standplaats prettig is, kan op de
 * andere botsen met afspraken die wij niet kennen. NS-breed worden is een
 * besluit van mensen, geen optelsom van locaties.
 *
 * ## Alleen goedgekeurd telt
 *
 * Een voorstel mag bestaan, gelezen worden en besproken; het raakt geen enkele
 * beslissing tot een mens het goedkeurt. Dat is het verschil tussen een agent
 * die leert en een agent die zichzelf gelijk geeft.
 *
 * ## Intrekken wist niets
 *
 * Een ingetrokken item blijft leesbaar, met de reden en de datum. Zou intrekken
 * betekenen dat het item verdwijnt, dan is achteraf niet meer na te gaan
 * waarom een rooster van vorig jaar is zoals het is.
 *
 * ## Context hoort erbij
 *
 * Elk item draagt het dienstenpakket waarin het is geleerd. Een voorkeur die
 * gaat over diensten die niet meer bestaan, wordt niet stilzwijgend toegepast
 * op een nieuw pakket: hij komt terug mét de waarschuwing dat de context is
 * veranderd.
 */

export interface MemoryItem {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly kind: MemoryKind;
  readonly locationCode: string | null;
  readonly dutyPackageId: string | null;
  readonly statement: string;
  readonly rationale: string | null;
  readonly status: MemoryStatus;
  readonly proposedByAgent: boolean;
  readonly approvedAt: Date | null;
  readonly withdrawnReason: string | null;
  readonly supersededById: string | null;
  readonly createdAt: Date;
  readonly appliedCount: number;
  /** Is de context waarin dit is geleerd nog dezelfde? */
  readonly contextStillCurrent: boolean;
}

interface RecallInput {
  readonly locationCode: string;
  /** Het dienstenpakket waarin nu wordt gewerkt. */
  readonly dutyPackageId?: string | null;
  /** Vrije zoekwoorden; leeg betekent alles wat geldt. */
  readonly query?: string | null;
  readonly includeProposed?: boolean;
  readonly limit?: number;
}

/**
 * Wat geldt er hier?
 *
 * Alleen items van deze standplaats (LOCATION/PROJECT) en NS-brede items die
 * zijn goedgekeurd. Items van een ándere standplaats komen niet mee — ook niet
 * als ze op het eerste gezicht passen.
 */
export async function recall(input: RecallInput): Promise<readonly MemoryItem[]> {
  const rijen = await prisma.agentMemoryItem.findMany({
    where: {
      status: input.includeProposed ? { in: ["APPROVED", "PROPOSED"] } : "APPROVED",
      OR: [
        { scope: { in: ["PROJECT", "LOCATION"] }, locationCode: input.locationCode },
        { scope: "NATIONAL" },
      ],
    },
    orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
    take: input.limit ?? 20,
    select: {
      id: true,
      scope: true,
      kind: true,
      locationCode: true,
      dutyPackageId: true,
      statement: true,
      rationale: true,
      status: true,
      proposedByAgent: true,
      approvedAt: true,
      withdrawnReason: true,
      supersededById: true,
      createdAt: true,
      _count: { select: { applications: true } },
    },
  });

  // Leestekens eraf vóór het splitsen. Zonder dat zoekt "over nachten?" naar
  // het woord "nachten?" inclusief vraagteken, en vindt het niets — gevonden
  // door verify:geheugen, waar de agent een item dat er gewoon stond niet
  // terugvond.
  const woorden = (input.query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúëïöüä\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  return rijen
    .filter((r) => (woorden.length === 0 ? true : woorden.some((w) => `${r.statement} ${r.rationale ?? ""}`.toLowerCase().includes(w))))
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      kind: r.kind,
      locationCode: r.locationCode,
      dutyPackageId: r.dutyPackageId,
      statement: r.statement,
      rationale: r.rationale,
      status: r.status,
      proposedByAgent: r.proposedByAgent,
      approvedAt: r.approvedAt,
      withdrawnReason: r.withdrawnReason,
      supersededById: r.supersededById,
      createdAt: r.createdAt,
      appliedCount: r._count.applications,
      // Geen pakket bij het item? Dan is er niets om te vergelijken en wordt er
      // ook niets beweerd: dat telt als "context onbekend", niet als "geldig".
      contextStillCurrent:
        r.dutyPackageId === null || input.dutyPackageId == null ? r.dutyPackageId === null && input.dutyPackageId == null : r.dutyPackageId === input.dutyPackageId,
    }));
}

/** Een voorstel vastleggen. De agent mag voorstellen; goedkeuren doet hij niet. */
export async function proposeMemory(input: {
  readonly actor: Actor;
  readonly grant: AgentGrant;
  readonly scope: MemoryScope;
  readonly kind: MemoryKind;
  readonly locationCode: string | null;
  readonly dutyPackageId?: string | null;
  readonly statement: string;
  readonly rationale?: string | null;
  readonly evidence?: Record<string, unknown>;
  readonly byAgent: boolean;
}): Promise<string> {
  assertAgentMay(input.actor, input.grant, AGENT_CAPABILITIES.MEMORY_WRITE);
  const rij = await prisma.agentMemoryItem.create({
    data: {
      scope: input.scope,
      kind: input.kind,
      locationCode: input.locationCode,
      dutyPackageId: input.dutyPackageId ?? null,
      statement: input.statement.trim(),
      rationale: input.rationale?.trim() || null,
      evidence: (input.evidence ?? {}) as object,
      proposedByAgent: input.byAgent,
      proposedByUserId: input.actor.userId,
      status: "PROPOSED",
    },
    select: { id: true },
  });
  await recordAudit({
    actor: input.actor,
    action: "geheugen.voorgesteld",
    objectType: "AgentMemoryItem",
    objectId: rij.id,
    newValue: { scope: input.scope, kind: input.kind, statement: input.statement, byAgent: input.byAgent },
  });
  return rij.id;
}

/** Goedkeuren of afwijzen. Altijd een mens, altijd met een spoor. */
export async function decideMemory(input: {
  readonly actor: Actor;
  readonly itemId: string;
  readonly approve: boolean;
  readonly reason?: string | null;
}): Promise<void> {
  const rij = await prisma.agentMemoryItem.findUnique({ where: { id: input.itemId }, select: { status: true, statement: true, scope: true } });
  if (!rij) throw new Error("Dat geheugenitem bestaat niet.");
  await prisma.agentMemoryItem.update({
    where: { id: input.itemId },
    data: input.approve
      ? { status: "APPROVED", approvedByUserId: input.actor.userId, approvedAt: new Date(), rejectedReason: null }
      : { status: "REJECTED", rejectedReason: input.reason?.trim() || "geen reden opgegeven" },
  });
  await recordAudit({
    actor: input.actor,
    action: input.approve ? "geheugen.goedgekeurd" : "geheugen.afgewezen",
    objectType: "AgentMemoryItem",
    objectId: input.itemId,
    oldValue: { status: rij.status },
    newValue: { status: input.approve ? "APPROVED" : "REJECTED", reason: input.reason ?? null },
  });
}

/**
 * Intrekken: het item telt niet meer mee, maar blijft leesbaar.
 *
 * Wissen zou betekenen dat een rooster van vorig jaar achteraf onverklaarbaar
 * wordt. Dat is een te hoge prijs voor een opgeruimd scherm.
 */
export async function withdrawMemory(actor: Actor, itemId: string, reason: string): Promise<void> {
  await prisma.agentMemoryItem.update({
    where: { id: itemId },
    data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnReason: reason.trim() || "geen reden opgegeven" },
  });
  await recordAudit({ actor, action: "geheugen.ingetrokken", objectType: "AgentMemoryItem", objectId: itemId, newValue: { reason } });
}

/**
 * Een verkeerd begrepen item corrigeren.
 *
 * De oude lezing wordt niet overschreven maar vervangen: hij blijft staan als
 * SUPERSEDED, met een verwijzing naar de nieuwe. Zo kan de oude interpretatie
 * niet opnieuw actief worden, en blijft zichtbaar dát er een correctie was.
 */
export async function correctMemory(input: {
  readonly actor: Actor;
  readonly grant: AgentGrant;
  readonly itemId: string;
  readonly statement: string;
  readonly rationale?: string | null;
}): Promise<string> {
  const oud = await prisma.agentMemoryItem.findUnique({
    where: { id: input.itemId },
    select: { scope: true, kind: true, locationCode: true, dutyPackageId: true, statement: true },
  });
  if (!oud) throw new Error("Dat geheugenitem bestaat niet.");

  const nieuw = await prisma.agentMemoryItem.create({
    data: {
      scope: oud.scope,
      kind: oud.kind,
      locationCode: oud.locationCode,
      dutyPackageId: oud.dutyPackageId,
      statement: input.statement.trim(),
      rationale: input.rationale?.trim() || `Correctie van een eerdere lezing: "${oud.statement}".`,
      // Een correctie door een mens is meteen geldig: hij ís het oordeel.
      status: "APPROVED",
      approvedByUserId: input.actor.userId,
      approvedAt: new Date(),
      proposedByAgent: false,
      proposedByUserId: input.actor.userId,
    },
    select: { id: true },
  });

  await prisma.agentMemoryItem.update({
    where: { id: input.itemId },
    data: { status: "SUPERSEDED", supersededById: nieuw.id },
  });

  await recordAudit({
    actor: input.actor,
    action: "geheugen.gecorrigeerd",
    objectType: "AgentMemoryItem",
    objectId: input.itemId,
    oldValue: { statement: oud.statement },
    newValue: { statement: input.statement, opvolger: nieuw.id },
  });
  return nieuw.id;
}

/** Vastleggen dát een item een beslissing heeft geraakt. Geteld, niet geschat. */
export async function noteApplication(input: {
  readonly itemId: string;
  readonly context: string;
  readonly generationRunId?: string | null;
  readonly candidateId?: string | null;
  readonly effect?: string | null;
}): Promise<void> {
  await prisma.agentMemoryApplication.create({
    data: {
      itemId: input.itemId,
      context: input.context,
      generationRunId: input.generationRunId ?? null,
      candidateId: input.candidateId ?? null,
      effect: input.effect ?? null,
    },
  });
}
