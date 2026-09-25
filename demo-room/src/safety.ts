import "server-only";
import type { Actor } from "@/server/auth/session";
import { AGENT_CAPABILITIES, type AgentGrant, agentMay, currentGrant } from "@/server/agent/capabilities";
import { actorHasPermission } from "@/server/security/authorize";

/**
 * De veiligheidsgrens van de Demo Room.
 *
 * ## Het uitgangspunt
 *
 * De Demo Room is standaard read-only richting het hoofdprogramma. Alles wat
 * hier wél mag schrijven, gaat door de bestaande bevoegdhedenlaag van de
 * hoofdapp (`AgentCapabilityGrant`) — dezelfde laag die ook de Roostercommissie
 * gebruikt. De Demo Room verruimt die laag nooit en kent geen eigen achterdeur.
 *
 * ## Wat hier bewust NIET gebeurt
 *
 * Er is geen functie in dit bestand die een AgentCapabilityGrant aanmaakt of
 * verhoogt. Zonder een grant die een mens al heeft gezet — via het bestaande
 * scherm bij `/beheer` of `/roostercommissie/agent` — start de Demo Room
 * simpelweg niets, en zegt dat met de naam van het scherm waar het wél kan
 * worden aangezet.
 */

export class DemoRoomSafetyError extends Error {
  constructor(
    readonly code: DemoRoomSafetyCode,
    message: string,
  ) {
    super(message);
    this.name = "DemoRoomSafetyError";
  }
}

export type DemoRoomSafetyCode =
  | "GEEN_ACTOR"
  | "ACTOR_INACTIEF"
  | "GEEN_RECHT"
  | "GEEN_TOEKENNING"
  | "STILGEZET"
  | "VERBODEN_HANDELING";

/**
 * Handelingen die de Demo Room nooit uitvoert, ook niet als een toekomstige
 * capability dat ooit zou toestaan. Dit is de harde bodem onder §3 en §30 van
 * de opdracht: geen publicatie, geen validatorbypass, geen regelmutatie, geen
 * permissie-escalatie.
 */
export const NOOIT_TOEGESTAAN: readonly string[] = [
  "publiceren",
  "publish",
  "approve-roster",
  "rooster-goedkeuren",
  "regel-wijzigen",
  "rule-mutation",
  "validator-omzeilen",
  "validator-bypass",
  "permissie-verhogen",
  "grant-escalation",
  "capability-self-grant",
];

/** "rooster-goedkeuren", "rooster goedkeuren" en "rooster_goedkeuren" zijn dezelfde handeling. */
function normaliseer(tekst: string): string {
  return tekst.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

/** Gooit als deze naam op de verboden lijst staat — een laatste, expliciete controle vóór elke schrijvende actie. */
export function assertNietVerboden(handeling: string): void {
  const genormaliseerd = normaliseer(handeling);
  if (NOOIT_TOEGESTAAN.some((v) => genormaliseerd.includes(normaliseer(v)))) {
    throw new DemoRoomSafetyError("VERBODEN_HANDELING", `Deze handeling (${handeling}) staat op de lijst die de Demo Room nooit uitvoert, ongeacht toekenning.`);
  }
}

export interface SandboxContext {
  readonly actor: Actor;
  readonly grant: AgentGrant;
  readonly locationCode: string;
}

/**
 * Alles wat nodig is om een schrijvende sandboxactie te mogen starten:
 * een echte acteur, met recht, met een toekenning die dat recht ook aanzet,
 * en de noodrem niet om. Faalt één daarvan, dan stopt de Demo Room vóórdat er
 * iets gebeurt — nooit een stille terugval op minder controle.
 */
export async function requireCapability(
  actor: Actor | null,
  locationCode: string,
  capability: (typeof AGENT_CAPABILITIES)[keyof typeof AGENT_CAPABILITIES],
): Promise<SandboxContext> {
  if (!actor) {
    throw new DemoRoomSafetyError(
      "GEEN_ACTOR",
      "Geen technisch account gevonden. Zet DEMO_ROOM_ACTOR_EMPLOYEE_NUMBER op een actief ADMIN-account (zie demo-room/README.md).",
    );
  }
  if (!actorHasPermission(actor, capability)) {
    throw new DemoRoomSafetyError(
      "GEEN_RECHT",
      `Het account van de Demo Room heeft het recht ${capability} niet. ` +
        "Ken dit recht toe via een rol met dat recht (Admin heeft alle AGENT_*-rechten) — de Demo Room kent zichzelf geen rechten toe.",
    );
  }
  const grant = await currentGrant(locationCode);
  if (grant.suspendedAt) {
    throw new DemoRoomSafetyError(
      "STILGEZET",
      `De agent is stilgezet voor ${locationCode} (${grant.suspendReason ?? "geen reden opgegeven"}). ` +
        "Zet hem weer aan via /roostercommissie/agent voordat de Demo Room verder gaat.",
    );
  }
  if (!agentMay(actor, grant, capability)) {
    throw new DemoRoomSafetyError(
      "GEEN_TOEKENNING",
      `De bevoegdheid ${capability} staat voor ${locationCode} niet aan. ` +
        "Ken die toe via het bestaande scherm /roostercommissie/agent (niveaukiezer) of /beheer — de Demo Room kan en mag dit niet zelf doen.",
    );
  }
  return { actor, grant, locationCode };
}

/**
 * De read-only vraag: mag hier ten minste gelezen worden?
 *
 * Chat/analyse (niveau A, AGENT_CHAT) staat standaard aan zodra er een
 * geldig account is — lezen is geen ingreep, net als in de hoofdapp.
 */
export async function requireReadAccess(actor: Actor | null, locationCode: string): Promise<SandboxContext> {
  return requireCapability(actor, locationCode, AGENT_CAPABILITIES.CHAT);
}
