import "server-only";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import type { AgentActivityStatus, AgentEventKind } from "@/lib/generated/prisma/enums";

/**
 * Wat de agent doet, terwijl hij het doet.
 *
 * ## Waarom dit in de database staat en niet in het geheugen
 *
 * Een paneel dat leest uit het geheugen van het proces, liegt zodra dat proces
 * wegvalt: het scherm blijft "bezig" tonen terwijl er niemand meer rekent. Elke
 * activiteit en elke stap staat daarom in de database. Een herstart begint dan
 * niet met een leeg paneel maar met de waarheid, inclusief het oordeel over wat
 * er tijdens de storing is gebeurd.
 *
 * ## Waarom stoppen een vlag is en geen knop
 *
 * Het stopverzoek wordt vastgelegd; de activiteit kijkt er zelf naar en stopt.
 * Een knop die alleen de interface verandert, stopt niets — dan rekent de
 * server vrolijk door terwijl het scherm "gestopt" zegt. Daarom staat de vlag
 * op de activiteit, en niet in de browser.
 *
 * ## Hartslag
 *
 * Een lopende activiteit meldt zich regelmatig. Blijft dat uit, dan is het
 * proces weg: `recoverStaleActivities` zet zulke activiteiten op INTERRUPTED,
 * met een stap in het logboek die zegt waarom. Zo kan een halve activiteit niet
 * eeuwig "bezig" blijven heten.
 */

/** Zo lang mag een activiteit zwijgen voordat hij als weggevallen geldt. */
export const HARTSLAG_GRENS_MS = 90_000;

export interface ActivityHandle {
  readonly id: string;
  readonly locationCode: string;
}

export async function startActivity(input: {
  readonly actor: Actor;
  readonly locationCode: string;
  readonly kind: "CHAT" | "ONDERZOEK" | "JOBBEWAKING";
  readonly title: string;
  readonly sessionId?: string | null;
  readonly generationRunId?: string | null;
  readonly detail?: Record<string, unknown>;
}): Promise<ActivityHandle> {
  const rij = await prisma.agentActivity.create({
    data: {
      locationCode: input.locationCode,
      kind: input.kind,
      title: input.title,
      sessionId: input.sessionId ?? null,
      generationRunId: input.generationRunId ?? null,
      createdByUserId: input.actor.userId,
      heartbeatAt: new Date(),
      detail: (input.detail ?? {}) as object,
    },
    select: { id: true, locationCode: true },
  });
  return rij;
}

export async function recordEvent(input: {
  readonly activity?: ActivityHandle | null;
  readonly locationCode: string;
  readonly sessionId?: string | null;
  readonly kind: AgentEventKind;
  readonly message: string;
  readonly detail?: Record<string, unknown>;
}): Promise<void> {
  await prisma.agentEvent.create({
    data: {
      locationCode: input.locationCode,
      activityId: input.activity?.id ?? null,
      sessionId: input.sessionId ?? null,
      kind: input.kind,
      message: input.message,
      detail: (input.detail ?? {}) as object,
    },
  });
}

export async function heartbeat(activity: ActivityHandle): Promise<void> {
  await prisma.agentActivity.update({ where: { id: activity.id }, data: { heartbeatAt: new Date() } });
}

/** Is er om gestopt gevraagd? Elke lus die tijd kost, hoort dit te vragen. */
export async function stopRequested(activity: ActivityHandle): Promise<boolean> {
  const rij = await prisma.agentActivity.findUnique({ where: { id: activity.id }, select: { stopRequested: true } });
  return rij?.stopRequested === true;
}

export async function finishActivity(
  activity: ActivityHandle,
  status: Extract<AgentActivityStatus, "DONE" | "FAILED" | "STOPPED">,
  note?: string,
): Promise<void> {
  await prisma.agentActivity.update({
    where: { id: activity.id },
    data: { status, finishedAt: new Date(), ...(note ? { detail: { note } } : {}) },
  });
}

/**
 * Een mens drukt op stop. Het verzoek wordt vastgelegd; de activiteit stopt zelf.
 *
 * Hangt er een rekenopdracht aan, dan wordt die ook echt afgebroken. Alleen een
 * vlag op de activiteit zetten zou betekenen dat het paneel "gestopt" zegt
 * terwijl de zoekmachine doorrekent — precies het soort stopknop dat niet mag
 * bestaan.
 */
export async function requestStop(actor: Actor, activityId: string): Promise<void> {
  await prisma.agentActivity.update({
    where: { id: activityId },
    data: { stopRequested: true, stopRequestedByUserId: actor.userId, stopRequestedAt: new Date() },
  });
  const rij = await prisma.agentActivity.findUnique({
    where: { id: activityId },
    select: { locationCode: true, sessionId: true, generationRunId: true },
  });
  if (rij?.generationRunId) {
    const afgebroken = await prisma.generationRun.updateMany({
      where: { id: rij.generationRunId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { cancelRequested: true, stageMessage: "Stoppen gevraagd — de lopende berekening wordt beëindigd." },
    });
    if (afgebroken.count > 0) {
      await recordAudit({ actor, action: "generatie.stoppen-gevraagd", objectType: "GenerationRun", objectId: rij.generationRunId });
    }
  }
  if (rij) {
    await recordEvent({
      activity: { id: activityId, locationCode: rij.locationCode },
      locationCode: rij.locationCode,
      sessionId: rij.sessionId,
      kind: "STOP",
      message: "Een gebruiker heeft om stoppen gevraagd.",
    });
  }
  await recordAudit({ actor, action: "agent.activiteit.stopverzoek", objectType: "AgentActivity", objectId: activityId });
}

/**
 * Een activiteit die een rekenopdracht bewaakt, volgt die opdracht.
 *
 * ## Waarom niet met een eigen hartslag
 *
 * De opdracht heeft er al een. Een tweede hartslag ernaast zou twee waarheden
 * geven die uit elkaar kunnen lopen — en dat deed hij ook: de opdracht liep
 * prima, terwijl het paneel de activiteit na anderhalve minuut "onderbroken"
 * noemde omdat niemand die tweede hartslag gaf. De opdracht is de bron; de
 * activiteit neemt zijn uitkomst over.
 */
const STATUS_VAN_RUN: Readonly<Record<string, AgentActivityStatus>> = {
  COMPLETED: "DONE",
  PARTIAL: "DONE",
  CANCELLED: "STOPPED",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
};

export async function syncJobActivities(locationCode: string): Promise<number> {
  const lopend = await prisma.agentActivity.findMany({
    where: { locationCode, status: "RUNNING", generationRunId: { not: null } },
    select: { id: true, generationRunId: true, sessionId: true },
  });
  let bijgewerkt = 0;
  for (const rij of lopend) {
    const run = await prisma.generationRun.findUnique({
      where: { id: rij.generationRunId! },
      select: { status: true, stageMessage: true, foundCandidates: true, heartbeatAt: true },
    });
    if (!run) continue;
    if (run.status === "RUNNING" || run.status === "QUEUED") {
      // Zolang de opdracht ademt, ademt de activiteit mee.
      await prisma.agentActivity.update({ where: { id: rij.id }, data: { heartbeatAt: run.heartbeatAt ?? new Date() } });
      continue;
    }
    const status = STATUS_VAN_RUN[run.status] ?? "FAILED";
    await prisma.agentActivity.update({ where: { id: rij.id }, data: { status, finishedAt: new Date() } });
    await recordEvent({
      activity: { id: rij.id, locationCode },
      locationCode,
      sessionId: rij.sessionId,
      kind: status === "DONE" ? "STAP" : status === "STOPPED" ? "STOP" : "FOUT",
      message:
        status === "DONE"
          ? `De opdracht is afgerond: ${run.stageMessage ?? `${run.foundCandidates} kandidaten`}.`
          : status === "STOPPED"
            ? "De opdracht is op verzoek gestopt."
            : `De opdracht eindigde als ${run.status.toLowerCase()}.`,
    });
    bijgewerkt += 1;
  }
  return bijgewerkt;
}

/**
 * Wat er tijdens een storing is blijven hangen.
 *
 * Draait bij het openen van het paneel en bij het starten van een nieuwe
 * activiteit. Wat niet meer ademt, heet vanaf dan onderbroken — niet "bezig",
 * en zeker niet "klaar".
 */
export async function recoverStaleActivities(locationCode: string, now = new Date()): Promise<number> {
  // Eerst de bewakers bijwerken: een opdracht die nog loopt, mag niet als
  // verdwenen gelden alleen omdat de activiteit zelf niet klopt.
  await syncJobActivities(locationCode);
  const grens = new Date(now.getTime() - HARTSLAG_GRENS_MS);
  const verdwenen = await prisma.agentActivity.findMany({
    where: { locationCode, status: "RUNNING", OR: [{ heartbeatAt: { lt: grens } }, { heartbeatAt: null, startedAt: { lt: grens } }] },
    select: { id: true, title: true, sessionId: true },
  });
  for (const rij of verdwenen) {
    await prisma.agentActivity.update({ where: { id: rij.id }, data: { status: "INTERRUPTED", finishedAt: now } });
    await recordEvent({
      activity: { id: rij.id, locationCode },
      locationCode,
      sessionId: rij.sessionId,
      kind: "FOUT",
      message: "Deze activiteit is onderbroken: het proces meldde zich niet meer. Er is niets half afgemaakt vastgelegd.",
    });
  }
  return verdwenen.length;
}

export interface ActivityView {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: AgentActivityStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly stopRequested: boolean;
  readonly generationRunId: string | null;
  readonly events: readonly { readonly id: string; readonly kind: AgentEventKind; readonly message: string; readonly at: string }[];
}

/** Het paneel: de laatste activiteiten met hun stappen, nieuwste eerst. */
export async function recentActivity(locationCode: string, take = 8): Promise<readonly ActivityView[]> {
  const rijen = await prisma.agentActivity.findMany({
    where: { locationCode },
    orderBy: { startedAt: "desc" },
    take,
    select: {
      id: true,
      kind: true,
      title: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      stopRequested: true,
      generationRunId: true,
      events: { orderBy: { createdAt: "asc" }, take: 20, select: { id: true, kind: true, message: true, createdAt: true } },
    },
  });
  return rijen.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    stopRequested: r.stopRequested,
    generationRunId: r.generationRunId,
    events: r.events.map((e) => ({ id: e.id, kind: e.kind, message: e.message, at: e.createdAt.toISOString() })),
  }));
}
