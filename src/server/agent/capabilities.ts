import "server-only";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
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
  /** De noodrem: staat hier een tijdstip, dan start de agent niets meer. */
  readonly suspendedAt: Date | null;
  readonly suspendReason: string | null;
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
  suspendedAt: null,
  suspendReason: null,
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
    suspendedAt: rij.suspendedAt,
    suspendReason: rij.suspendReason,
  };
}

/**
 * De noodrem omzetten.
 *
 * Stoppen mag iedereen die de agent mag aansturen; het is de veilige kant op.
 * Weer aanzetten is een bewuste handeling van een commissielid, en beide komen
 * in het auditlogboek terecht. Een lopende opdracht wordt hier niet gestopt —
 * daarvoor is de stopknop bij die opdracht; dit voorkomt dat er een nieuwe bij
 * komt.
 */
export async function setAgentSuspended(actor: Actor, locationCode: string, suspended: boolean, reason?: string): Promise<void> {
  const rij = await prisma.agentCapabilityGrant.findFirst({ where: { locationCode, revokedAt: null }, orderBy: { grantedAt: "desc" }, select: { id: true } });
  if (rij) {
    await prisma.agentCapabilityGrant.update({
      where: { id: rij.id },
      data: suspended
        ? { suspendedAt: new Date(), suspendedByUserId: actor.userId, suspendReason: reason ?? null }
        : { suspendedAt: null, suspendedByUserId: null, suspendReason: null },
    });
  } else if (suspended) {
    // Zonder toekenning geldt niveau A. Om die te kunnen stilzetten is er wel
    // een regel nodig: anders zou de noodrem niets hebben om vast te houden.
    await prisma.agentCapabilityGrant.create({
      data: {
        locationCode,
        capabilities: [...AGENT_LEVELS.A],
        grantedByUserId: actor.userId,
        suspendedAt: new Date(),
        suspendedByUserId: actor.userId,
        suspendReason: reason ?? null,
        note: "Aangemaakt om de agent stil te zetten.",
      },
    });
  }
  await recordAudit({
    actor,
    action: suspended ? "agent.stilgezet" : "agent.hervat",
    objectType: "AgentCapabilityGrant",
    objectId: rij?.id ?? null,
    newValue: { locationCode, reason: reason ?? null },
  });
}

export class AgentCapabilityError extends Error {
  constructor(
    readonly capability: AgentCapability,
    readonly cause_: "GEEN_RECHT" | "NIET_TOEGEKEND" | "STILGEZET",
  ) {
    super(
      cause_ === "GEEN_RECHT"
        ? `Je hebt het recht ${capability} niet.`
        : cause_ === "STILGEZET"
          ? "De agent is stilgezet. Zolang dat zo is, start hij niets: geen berekening, geen ronde, geen experiment. Een commissielid kan hem weer aanzetten."
          : `De bevoegdheid ${capability} staat voor dit project niet aan. Een commissielid moet die eerst toekennen.`,
    );
    this.name = "AgentCapabilityError";
  }
}

/**
 * Handelingen die de agent wérk laten doen. Juist deze liggen stil zodra de
 * noodrem om is; vragen beantwoorden blijft kunnen, want lezen is geen ingreep.
 */
const STARTENDE_BEVOEGDHEDEN: readonly AgentCapability[] = [
  AGENT_CAPABILITIES.JOB_CREATE,
  AGENT_CAPABILITIES.AUTONOMOUS,
  AGENT_CAPABILITIES.EXPERIMENT_RUN,
  AGENT_CAPABILITIES.EXPERIMENT_PROPOSE,
  AGENT_CAPABILITIES.PREFERENCE_PROPOSE,
  AGENT_CAPABILITIES.MEMORY_WRITE,
];

const stilgezet = (grant: AgentGrant, capability: AgentCapability): boolean =>
  grant.suspendedAt !== null && STARTENDE_BEVOEGDHEDEN.includes(capability);

/** Mag deze handeling door? Beide sloten open, en de noodrem niet om. */
export function agentMay(actor: Actor, grant: AgentGrant, capability: AgentCapability): boolean {
  if (stilgezet(grant, capability)) return false;
  return actorHasPermission(actor, capability as Permission) && grant.capabilities.includes(capability);
}

/** Zelfde vraag, maar met een uitlegbare weigering — dat is wat de gebruiker moet lezen. */
export function assertAgentMay(actor: Actor, grant: AgentGrant, capability: AgentCapability): void {
  if (stilgezet(grant, capability)) throw new AgentCapabilityError(capability, "STILGEZET");
  if (!actorHasPermission(actor, capability as Permission)) throw new AgentCapabilityError(capability, "GEEN_RECHT");
  if (!grant.capabilities.includes(capability)) throw new AgentCapabilityError(capability, "NIET_TOEGEKEND");
}

/** Welk niveau komt het dichtst bij deze toekenning? Alleen voor de weergave. */
export function levelOf(grant: AgentGrant): "A" | "B" | "C" {
  if (grant.capabilities.includes(AGENT_CAPABILITIES.AUTONOMOUS)) return "C";
  if (grant.capabilities.includes(AGENT_CAPABILITIES.JOB_CREATE)) return "B";
  return "A";
}
