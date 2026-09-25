import "server-only";
import { z } from "zod";
import { ADAPTIVE_CONFIG, type SearchMode, isSearchMode } from "@/server/generation/adaptive/config";
import { runGenerationJob } from "@/server/generation/generation-job";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { createRunCore } from "@/server/services/generation-service";
import { SCENARIOS } from "@/server/services/simulation-service";
import { recordEvent, startActivity } from "./activity";
import { noteApplication } from "./memory";
import { AGENT_CAPABILITIES, type AgentGrant, AgentCapabilityError, assertAgentMay } from "./capabilities";

/**
 * Niveau B: de agent mag laten rekenen.
 *
 * ## Voorstellen en starten zijn twee dingen
 *
 * De agent stelt een opdracht voor — welk doel, welke strategie, hoeveel
 * rekentijd — en een mens drukt op start. Dat is niet omslachtig maar het
 * verschil tussen niveau B en C: op B bevestigt iemand elke opdracht, op C mag
 * de agent binnen een budget doorwerken. Wie dat onderscheid weghaalt, heeft
 * niveau C zonder het te hebben toegekend.
 *
 * ## De grenzen staan hier, niet in het model
 *
 * Het model mag voorstellen wat het wil; wat er werkelijk mag, wordt hier
 * gecontroleerd tegen de toekenning: de bevoegdheid zelf, de toegestane
 * strategieën, het rekenbudget en de roosters die met rust gelaten moeten
 * worden. Een voorstel dat daarbuiten valt, wordt geweigerd met de reden erbij.
 *
 * ## Wat de agent nooit doet
 *
 * Publiceren. Een kandidaat goedkeuren. Een bestaand rooster overschrijven.
 * Die drie staan niet in deze code, en er is geen bevoegdheid die ze aanzet.
 */

export const jobProposalSchema = z.object({
  // RESEARCH is niveau C: geen enkele opdracht maar een reeks rondes. Hij loopt
  // langs een andere weg (research.ts) en staat hier alleen in het voorstel.
  kind: z.enum(["GENERATE", "REBUILD", "RESEARCH"]),
  strategy: z.string().min(2).max(40),
  strategyLabel: z.string().min(2).max(120),
  rosterYear: z.number().int().min(2020).max(2100),
  searchMode: z.enum(["FAST", "NORMAL", "DEEP", "EXTENSIVE"]),
  goals: z.array(z.string().min(2).max(40)).max(9),
  parentCandidateId: z.string().min(1).nullable(),
  /** Wat de agent denkt te gaan doen, in gewone taal. */
  note: z.string().min(2).max(400),
  /**
   * Geheugenitems die aan dit voorstel hebben bijgedragen.
   *
   * Ze gaan mee tot in de opdracht, zodat bij het starten geteld kan worden
   * dat dit item werkelijk een beslissing heeft geraakt. Een item dat nooit
   * iets heeft beinvloed, telt volgens de benchmarkmethodiek niet mee als
   * vooruitgang — en dat is alleen vol te houden als het echt wordt geteld.
   */
  memoryGoals: z
    .array(z.object({ itemId: z.string().min(1), goal: z.string().min(2).max(40), scope: z.string().max(20).optional(), statement: z.string().max(500).optional() }))
    .max(20)
    .optional(),
  locationCode: z.string().min(1).max(8),
});

export type JobProposal = z.infer<typeof jobProposalSchema>;

/** Een voorstel in woorden, zodat een mens weet waar hij ja tegen zegt. */
export function describeProposal(proposal: JobProposal): string {
  const budget = ADAPTIVE_CONFIG.modes[proposal.searchMode as SearchMode].budgetSeconds;
  const doelen = proposal.goals.map((g) => REBUILD_GOAL_LABELS[g as RebuildGoal] ?? g);
  const wat =
    proposal.kind === "REBUILD"
      ? `deze kandidaat herbouwen (${doelen.join(", ") || "goede delen behouden"})`
      : `een nieuwe reeks kandidaten laten maken met strategie "${proposal.strategyLabel}"`;
  return `${wat}, rekentijd ${proposal.searchMode.toLowerCase()} (ongeveer ${Math.round(budget / 60)} minuten).`;
}

export class JobLimitError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JobLimitError";
  }
}

/**
 * Past dit voorstel binnen de toekenning?
 *
 * Alle vier de grenzen worden gecontroleerd, ook als ze leeg zijn — een lege
 * lijst betekent "geen beperking", en dat is een besluit van de commissie en
 * geen vergissing van de code.
 */
export function checkAgainstGrant(grant: AgentGrant, proposal: JobProposal): void {
  if (grant.allowedStrategies.length > 0 && !grant.allowedStrategies.includes(proposal.strategy)) {
    throw new JobLimitError(
      `De strategie "${proposal.strategy}" staat niet in de lijst die voor dit project is toegestaan (${grant.allowedStrategies.join(", ")}).`,
    );
  }
  const budget = ADAPTIVE_CONFIG.modes[proposal.searchMode as SearchMode].budgetSeconds;
  if (grant.maxSolverSeconds > 0 && budget > grant.maxSolverSeconds) {
    throw new JobLimitError(
      `Deze rekentijd (${budget} seconden) is meer dan de toegestane ${grant.maxSolverSeconds} seconden. Kies een kortere modus of laat de commissie het budget verruimen.`,
    );
  }
  if (grant.protectedRosters.length > 0 && proposal.kind === "GENERATE") {
    throw new JobLimitError(
      `Een volledige generatie herverdeelt alle basisroosters, en ${grant.protectedRosters.join(", ")} ${grant.protectedRosters.length === 1 ? "is" : "zijn"} als te beschermen aangemerkt. Een gerichte herbouw van één kandidaat kan wel.`,
    );
  }
  if (proposal.kind === "REBUILD" && !proposal.parentCandidateId) {
    throw new JobLimitError("Een herbouw heeft een kandidaat nodig om van uit te gaan.");
  }
}

export interface StartedJob {
  readonly runId: string;
  readonly activityId: string;
  readonly description: string;
}

/**
 * De opdracht werkelijk starten, nadat een mens hem heeft bevestigd.
 *
 * De bevoegdheid wordt hier opnieuw gecontroleerd en niet alleen in het scherm:
 * een server action is een ingang zoals elke andere.
 */
export async function startProposedJob(input: {
  readonly actor: Actor;
  readonly grant: AgentGrant;
  readonly proposal: JobProposal;
  readonly sessionId?: string | null;
}): Promise<StartedJob> {
  const { actor, grant, proposal } = input;
  assertAgentMay(actor, grant, AGENT_CAPABILITIES.JOB_CREATE);
  checkAgainstGrant(grant, proposal);

  const scenario = SCENARIOS.find((s) => s.key === proposal.strategy);
  if (!scenario) throw new JobLimitError(`De strategie "${proposal.strategy}" bestaat niet.`);

  const ouder =
    proposal.kind === "REBUILD" && proposal.parentCandidateId
      ? await prisma.candidateRoster.findUnique({
          where: { id: proposal.parentCandidateId },
          select: { id: true, scenarioLabel: true, locationCode: true, generationRun: { select: { rosterYear: true, strategy: true, strategyLabel: true } } },
        })
      : null;
  if (proposal.kind === "REBUILD" && !ouder) throw new JobLimitError("Die kandidaat bestaat niet (meer).");
  if (ouder && ouder.locationCode !== null && ouder.locationCode !== proposal.locationCode) {
    throw new JobLimitError("Die kandidaat hoort bij een andere standplaats.");
  }

  const activiteit = await startActivity({
    actor,
    locationCode: proposal.locationCode,
    kind: "JOBBEWAKING",
    title: proposal.note,
    sessionId: input.sessionId ?? null,
    detail: { proposal: proposal as unknown as Record<string, unknown> },
  });

  const goals = proposal.goals.filter((g): g is RebuildGoal => g in REBUILD_GOAL_LABELS);
  const runId = await createRunCore({
    actor,
    locationCode: proposal.locationCode,
    strategy: proposal.kind === "REBUILD" ? (ouder?.generationRun?.strategy ?? "BALANCED") : scenario.key,
    strategyLabel: proposal.kind === "REBUILD" ? (ouder?.generationRun?.strategyLabel ?? proposal.strategyLabel) : scenario.label,
    rosterYear: proposal.rosterYear,
    requestedCandidates: proposal.kind === "REBUILD" ? 1 : scenario.engine === "BASELINE" ? 1 : 3,
    kind: proposal.kind === "REBUILD" ? "REBUILD" : "GENERATE",
    engine: "adaptive",
    searchMode: isSearchMode(proposal.searchMode) ? proposal.searchMode : "NORMAL",
    parentCandidateId: ouder?.id ?? null,
    adjustment:
      proposal.kind === "REBUILD"
        ? { goals, preserveGoodParts: goals.length === 0 || goals.includes("KEEP_GOOD_PARTS"), note: `Voorgesteld door de roosteragent: ${proposal.note}` }
        : null,
  });

  await prisma.agentActivity.update({ where: { id: activiteit.id }, data: { generationRunId: runId } });

  // Nu pas telt een geheugenitem als toegepast: niet toen het werd gelezen,
  // maar nu het daadwerkelijk een opdracht stuurt. Dat onderscheid is de hele
  // reden dat toepassingen geteld worden en niet geschat.
  for (const item of proposal.memoryGoals ?? []) {
    await noteApplication({
      itemId: item.itemId,
      context: `opdracht ${proposal.kind.toLowerCase()} · ${proposal.note}`,
      generationRunId: runId,
      effect: `doel ${item.goal} meegegeven aan de zoekmachine`,
    });
  }
  await recordEvent({
    activity: activiteit,
    locationCode: proposal.locationCode,
    sessionId: input.sessionId ?? null,
    kind: "STAP",
    message: `Opdracht gestart: ${describeProposal(proposal)}`,
    detail: { runId, goals },
  });
  await recordAudit({
    actor,
    action: "agent.opdracht.gestart",
    objectType: "GenerationRun",
    objectId: runId,
    newValue: { proposal, activityId: activiteit.id, bevoegdheid: AGENT_CAPABILITIES.JOB_CREATE },
  });

  // Bewust niet afgewacht: de opdracht loopt door nadat dit verzoek klaar is.
  // Het activiteitenpaneel volgt hem; de hartslag bewaakt hem.
  void runGenerationJob(runId, actor);

  return { runId, activityId: activiteit.id, description: describeProposal(proposal) };
}

export { AgentCapabilityError };
