import "server-only";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { actorHasPermission } from "@/server/security/authorize";
import { PERMISSIONS, type Permission } from "@/server/security/permissions";

/**
 * Wat de roosteragent mag, en van wie.
 *
 * ## Twee sloten op dezelfde deur
 *
 * Een handeling van de agent kan alleen doorgaan als twee dingen waar zijn:
 *
 * 1. de **gebruiker** heeft het recht (`PERMISSIONS.AGENT_*`, via zijn rollen);
 * 2. de **commissie** heeft die bevoegdheid voor dit project aangezet
 *    (`AgentCapabilityGrant`).
 *
 * Het eerste slot bepaalt wie iets ooit mag; het tweede of het hier en nu aan
 * staat. De agent kan geen van beide zelf omzetten: hij leest ze, en de
 * toekenning verloopt via een scherm waar een mens op drukt.
 *
 * ## Niveaus zijn voorinstellingen, geen schakelaar
 *
 * A, B en C uit de werkopdracht zijn presets boven de losse capabilities. Wie
 * niveau C kiest, krijgt niet automatisch het recht om voorkeuren goed te
 * keuren of experimenten te draaien: die staan apart en blijven apart.
 */

export const AGENT_CAPABILITIES = {
  CHAT: PERMISSIONS.AGENT_CHAT,
  JOB_CREATE: PERMISSIONS.AGENT_JOB_CREATE,
  AUTONOMOUS: PERMISSIONS.AGENT_AUTONOMOUS,
  MEMORY_WRITE: PERMISSIONS.AGENT_MEMORY_WRITE,
  PREFERENCE_PROPOSE: PERMISSIONS.AGENT_PREFERENCE_PROPOSE,
  PREFERENCE_APPROVE: PERMISSIONS.AGENT_PREFERENCE_APPROVE,
  CROSSLOCATION_READ: PERMISSIONS.AGENT_CROSSLOCATION_READ,
  EXPERIMENT_PROPOSE: PERMISSIONS.AGENT_EXPERIMENT_PROPOSE,
  EXPERIMENT_RUN: PERMISSIONS.AGENT_EXPERIMENT_RUN,
} as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[keyof typeof AGENT_CAPABILITIES];

/** De drie voorinstellingen. Elke capability blijft daarnaast los aan of uit te zetten. */
export const AGENT_LEVELS: Readonly<Record<"A" | "B" | "C", readonly AgentCapability[]>> = {
  A: [AGENT_CAPABILITIES.CHAT],
  B: [AGENT_CAPABILITIES.CHAT, AGENT_CAPABILITIES.JOB_CREATE, AGENT_CAPABILITIES.MEMORY_WRITE],
  C: [AGENT_CAPABILITIES.CHAT, AGENT_CAPABILITIES.JOB_CREATE, AGENT_CAPABILITIES.MEMORY_WRITE, AGENT_CAPABILITIES.AUTONOMOUS],
};

export const AGENT_LEVEL_LABELS: Readonly<Record<"A" | "B" | "C", string>> = {
  A: "Analyseren en uitleggen",
  B: "Kandidaten laten berekenen",
  C: "Zelfstandig meerdere rondes",
};

export interface AgentGrant {
  readonly id: string | null;
  readonly locationCode: string;
  readonly rosterPeriodId: string | null;
  readonly capabilities: readonly AgentCapability[];
  readonly maxRounds: number;
  readonly maxSolverSeconds: number;
  readonly allowedStrategies: readonly string[];
  readonly protectedRosters: readonly string[];
  readonly grantedAt: Date | null;
}

/** Niveau A staat altijd aan: vragen beantwoorden is geen ingreep. */
export const DEFAULT_GRANT = (locationCode: string): AgentGrant => ({
  id: null,
  locationCode,
  rosterPeriodId: null,
  capabilities: AGENT_LEVELS.A,
  maxRounds: 0,
  maxSolverSeconds: 0,
  allowedStrategies: [],
  protectedRosters: [],
  grantedAt: null,
});

/** De geldende toekenning voor dit project; zonder toekenning geldt niveau A. */
export async function currentGrant(locationCode: string, rosterPeriodId?: string | null): Promise<AgentGrant> {
  const rij = await prisma.agentCapabilityGrant.findFirst({
    where: { locationCode, revokedAt: null, ...(rosterPeriodId ? { OR: [{ rosterPeriodId }, { rosterPeriodId: null }] } : {}) },
    orderBy: [{ rosterPeriodId: "desc" }, { grantedAt: "desc" }],
  });
  if (!rij) return DEFAULT_GRANT(locationCode);
  return {
    id: rij.id,
    locationCode: rij.locationCode,
    rosterPeriodId: rij.rosterPeriodId,
    capabilities: [...new Set<AgentCapability>([...AGENT_LEVELS.A, ...(rij.capabilities as AgentCapability[])])],
    maxRounds: rij.maxRounds,
    maxSolverSeconds: rij.maxSolverSeconds,
    allowedStrategies: rij.allowedStrategies,
    protectedRosters: rij.protectedRosters,
    grantedAt: rij.grantedAt,
  };
}

export class AgentCapabilityError extends Error {
  constructor(
    readonly capability: AgentCapability,
    readonly cause_: "GEEN_RECHT" | "NIET_TOEGEKEND",
  ) {
    super(
      cause_ === "GEEN_RECHT"
        ? `Je hebt het recht ${capability} niet.`
        : `De bevoegdheid ${capability} staat voor dit project niet aan. Een commissielid moet die eerst toekennen.`,
    );
    this.name = "AgentCapabilityError";
  }
}

/** Mag deze handeling door? Beide sloten open, anders niet. */
export function agentMay(actor: Actor, grant: AgentGrant, capability: AgentCapability): boolean {
  return actorHasPermission(actor, capability as Permission) && grant.capabilities.includes(capability);
}

/** Zelfde vraag, maar met een uitlegbare weigering — dat is wat de gebruiker moet lezen. */
export function assertAgentMay(actor: Actor, grant: AgentGrant, capability: AgentCapability): void {
  if (!actorHasPermission(actor, capability as Permission)) throw new AgentCapabilityError(capability, "GEEN_RECHT");
  if (!grant.capabilities.includes(capability)) throw new AgentCapabilityError(capability, "NIET_TOEGEKEND");
}

/** Welk niveau komt het dichtst bij deze toekenning? Alleen voor de weergave. */
export function levelOf(grant: AgentGrant): "A" | "B" | "C" {
  if (grant.capabilities.includes(AGENT_CAPABILITIES.AUTONOMOUS)) return "C";
  if (grant.capabilities.includes(AGENT_CAPABILITIES.JOB_CREATE)) return "B";
  return "A";
}
