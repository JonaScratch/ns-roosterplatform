import "server-only";
import { QUALITY_MODEL_V3 } from "@/domain/quality-model";
import type { CandidateAssignment } from "@/domain/candidate";
import type { RebuildGoal } from "@/server/optimizer/objective-weights";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { evaluateAssignmentsCore, evaluateOfficialCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { finishActivity, heartbeat, recordEvent, startActivity, stopRequested } from "./activity";
import { AGENT_CAPABILITIES, type AgentGrant, assertAgentMay, currentGrant } from "./capabilities";
import { type JobProposal, startProposedJob } from "./jobs";

/**
 * Niveau C: meerdere rondes achter elkaar, binnen een budget.
 *
 * ## Wat een ronde is
 *
 * Een opdracht laten rekenen, de uitkomst meten op dezelfde meetlat als alles
 * hier, en dán pas beslissen wat de volgende stap is. Die volgorde is het hele
 * punt: de agent volgt geen vaste reeks stappen, hij kijkt naar wat er uitkwam.
 *
 * ## Waarom stoppen net zo belangrijk is als doorgaan
 *
 * Een zoeklus die altijd doorgaat tot het budget op is, levert bijna altijd
 * "iets", en dat iets is dan het beste van een reeks pogingen die misschien
 * allemaal slechter waren dan wat er al lag. Deze lus stopt zodra twee rondes
 * achter elkaar niets opleveren, en zegt dan wat er is: geen betere geldige
 * kandidaat gevonden. Dat is een uitkomst, geen mislukking.
 *
 * ## Vier manieren waarop de lus eindigt
 *
 * - het budget is op (rondes of rekentijd);
 * - twee rondes achter elkaar leverden niets beters op;
 * - een mens heeft om stoppen gevraagd, of de agent is stilgezet;
 * - een ronde mislukte — en dan heet het mislukt, niet "klaar".
 */

/** Zoveel moet een kandidaat beter zijn om als verbetering te tellen. */
export const VERBETERDREMPEL = 0.25;

/** Na zoveel rondes zonder verbetering houdt de lus op. */
export const PLATEAU_RONDES = 2;

export interface RondeBesluit {
  readonly verbeterd: boolean;
  readonly decision: "DOORGAAN" | "STOPPEN_GEEN_VERBETERING" | "STOPPEN_BUDGET" | "MISLUKT";
  readonly reason: string;
  /** Gezet zodra de lus hier ophoudt; dit is wat een mens te lezen krijgt. */
  readonly conclusion: string | null;
  readonly zonderVerbetering: number;
}

/**
 * Wat betekent deze ronde voor de volgende?
 *
 * Bewust een losse functie zonder database: dit zijn de beslisregels van de
 * lus, en die horen te toetsen te zijn zonder dat er een zoekmachine aan te
 * pas komt. Vier uitkomsten, en "niets beters gevonden" is er één van — geen
 * mislukking, maar een antwoord.
 */
export function rondeBesluit(input: {
  readonly ronde: number;
  readonly maxRondes: number;
  readonly uitgangspunt: number;
  readonly beste: number;
  readonly nieuweScore: number | null;
  readonly zonderVerbeteringTotNu: number;
  readonly heeftKandidaat: boolean;
}): RondeBesluit {
  const delta = input.nieuweScore === null ? null : input.nieuweScore - input.beste;
  const verbeterd = delta !== null && delta >= VERBETERDREMPEL;
  const zonderVerbetering = verbeterd ? 0 : input.zonderVerbeteringTotNu + 1;

  const reason =
    input.nieuweScore === null
      ? "De ronde leverde geen geldige kandidaat op."
      : verbeterd
        ? `Beter: ${input.nieuweScore.toFixed(1)} tegen ${input.beste.toFixed(1)} (+${(delta ?? 0).toFixed(2)}).`
        : `Geen verbetering: ${input.nieuweScore.toFixed(1)} tegen ${input.beste.toFixed(1)}.`;

  const besteNa = verbeterd && input.nieuweScore !== null ? input.nieuweScore : input.beste;
  const heeftBetereDanNu = besteNa - input.uitgangspunt >= VERBETERDREMPEL;

  if (zonderVerbetering >= PLATEAU_RONDES) {
    return {
      verbeterd,
      decision: "STOPPEN_GEEN_VERBETERING",
      reason,
      conclusion: heeftBetereDanNu
        ? `Na ${input.ronde} rondes geen verdere verbetering meer. De beste kandidaat scoort ${besteNa.toFixed(1)} tegen ${input.uitgangspunt.toFixed(1)} voor het huidige rooster.`
        : `Geen betere geldige kandidaat gevonden dan het huidige rooster (${input.uitgangspunt.toFixed(1)}). Na ${input.ronde} rondes lever ik niets op dat beter is; dat is de uitkomst.`,
      zonderVerbetering,
    };
  }

  if (input.ronde >= input.maxRondes) {
    return {
      verbeterd,
      decision: "STOPPEN_BUDGET",
      reason,
      conclusion: heeftBetereDanNu
        ? `Het budget van ${input.maxRondes} rondes is op. De beste kandidaat scoort ${besteNa.toFixed(1)} tegen ${input.uitgangspunt.toFixed(1)} voor het huidige rooster.`
        : `Het budget van ${input.maxRondes} rondes is op en er is niets gevonden dat beter is dan het huidige rooster (${input.uitgangspunt.toFixed(1)}).`,
      zonderVerbetering,
    };
  }

  return { verbeterd, decision: "DOORGAAN", reason, conclusion: null, zonderVerbetering };
}

export interface LoopStart {
  readonly actor: Actor;
  readonly grant: AgentGrant;
  readonly locationCode: string;
  readonly goal: string;
  readonly goals: readonly RebuildGoal[];
  readonly searchMode: "FAST" | "NORMAL" | "DEEP" | "EXTENSIVE";
  readonly sessionId?: string | null;
}

/**
 * De lus opzetten en starten.
 *
 * De bevoegdheid wordt hier gecontroleerd én opnieuw vóór elke ronde. Dat is
 * geen dubbel werk: de commissie kan de agent midden in een lus stilzetten, en
 * dan mag er geen volgende ronde meer komen.
 */
export async function startResearchLoop(input: LoopStart): Promise<string> {
  assertAgentMay(input.actor, input.grant, AGENT_CAPABILITIES.AUTONOMOUS);
  const maxRondes = input.grant.maxRounds > 0 ? input.grant.maxRounds : 3;

  const activiteit = await startActivity({
    actor: input.actor,
    locationCode: input.locationCode,
    kind: "ONDERZOEK",
    title: input.goal,
    sessionId: input.sessionId ?? null,
    detail: { goals: input.goals, maxRounds: maxRondes },
  });

  const lus = await prisma.agentResearchLoop.create({
    data: {
      locationCode: input.locationCode,
      goal: input.goal,
      goals: [...input.goals],
      maxRounds: maxRondes,
      maxSolverSeconds: input.grant.maxSolverSeconds,
      createdByUserId: input.actor.userId,
      activityId: activiteit.id,
      heartbeatAt: new Date(),
    },
    select: { id: true },
  });

  await recordAudit({
    actor: input.actor,
    action: "agent.onderzoek.gestart",
    objectType: "AgentResearchLoop",
    objectId: lus.id,
    newValue: { goal: input.goal, goals: input.goals, maxRounds: maxRondes, maxSolverSeconds: input.grant.maxSolverSeconds },
  });

  // Bewust niet afgewacht: de lus loopt door nadat dit verzoek klaar is.
  void runResearchLoop(lus.id, input);
  return lus.id;
}

/** De score van een kandidaat op de vaste meetlat. Hoger is beter. */
async function scoreVan(candidateId: string, locationCode: string): Promise<number | null> {
  const rij = await prisma.candidateRoster.findUnique({ where: { id: candidateId }, select: { assignments: true } });
  if (!rij) return null;
  const context = await loadEvaluationContextCore(locationCode);
  const rapport = evaluateAssignmentsCore(rij.assignments as unknown as CandidateAssignment[], context, QUALITY_MODEL_V3);
  return rapport.robust;
}

async function wachtOpRun(runId: string, maxMs: number): Promise<{ status: string; stageMessage: string | null } | null> {
  const begin = Date.now();
  while (Date.now() - begin < maxMs) {
    const rij = await prisma.generationRun.findUnique({ where: { id: runId }, select: { status: true, stageMessage: true } });
    if (rij && rij.status !== "RUNNING" && rij.status !== "QUEUED") return rij;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return prisma.generationRun.findUnique({ where: { id: runId }, select: { status: true, stageMessage: true } });
}

/**
 * De lus zelf.
 *
 * Vóór elke ronde wordt opnieuw gekeken of het nog mag: de bevoegdheid, de
 * noodrem en het stopverzoek. Een lus die die drie maar één keer aan het begin
 * controleert, is geen lus met een rem maar een lus met een startknop.
 */
export async function runResearchLoop(loopId: string, input: LoopStart): Promise<void> {
  const activiteit = { id: (await prisma.agentResearchLoop.findUniqueOrThrow({ where: { id: loopId }, select: { activityId: true } })).activityId!, locationCode: input.locationCode };
  const stap = (kind: Parameters<typeof recordEvent>[0]["kind"], message: string, detail?: Record<string, unknown>) =>
    recordEvent({ activity: activiteit, locationCode: input.locationCode, sessionId: input.sessionId ?? null, kind, message, detail });

  const context = await loadEvaluationContextCore(input.locationCode);
  const uitgangspunt = evaluateOfficialCore(context, QUALITY_MODEL_V3).robust;
  if (uitgangspunt === null) {
    // Zonder uitgangswaarde is "beter" niet te bepalen. Dan is doorgaan geen
    // onderzoek maar gokken, en dat zegt de lus liever hardop.
    await beëindig(
      loopId,
      "FAILED",
      "De meetlat leverde geen score op voor het huidige rooster. Zonder uitgangswaarde kan ik niet vaststellen of iets beter is, dus begin ik er niet aan.",
      0,
      null,
    );
    await stap("FOUT", "Geen uitgangswaarde; de lus is niet begonnen.");
    return;
  }
  await prisma.agentResearchLoop.update({ where: { id: loopId }, data: { baselineScore: uitgangspunt, bestScore: uitgangspunt } });
  await stap("STAP", `Uitgangspunt: het huidige rooster scoort ${uitgangspunt.toFixed(1)} op de vaste meetlat.`);

  let beste: number = uitgangspunt;
  let besteKandidaat: string | null = null;
  let zonderVerbetering = 0;

  try {
    // Geen eindconditie in de kop: het budget staat in de database en kan
    // tussentijds veranderen, dus wordt het elke ronde opnieuw gelezen. Het
    // stoppen gebeurt in `rondeBesluit` en bij de drie remmen hieronder.
    for (let ronde = 1; ; ronde += 1) {
      const lus = await prisma.agentResearchLoop.findUniqueOrThrow({ where: { id: loopId }, select: { maxRounds: true, status: true } });
      if (lus.status !== "RUNNING") return;
      if (ronde > lus.maxRounds) {
        await beëindig(loopId, "DONE", `Het budget van ${lus.maxRounds} rondes is op. Beste score: ${beste.toFixed(1)}.`, beste, besteKandidaat);
        await stap("STAP", `Gestopt: budget van ${lus.maxRounds} rondes op.`);
        break;
      }

      // De drie remmen, elke ronde opnieuw.
      const verseGrant = await currentGrant(input.locationCode);
      if (verseGrant.suspendedAt !== null || !verseGrant.capabilities.includes(AGENT_CAPABILITIES.AUTONOMOUS)) {
        await noteerRonde(loopId, ronde, null, null, null, null, "STOPPEN_GEVRAAGD", "De bevoegdheid voor zelfstandig doorwerken is ingetrokken of de agent is stilgezet.");
        await beëindig(loopId, "STOPPED", "Gestopt: de commissie heeft de zelfstandige modus uitgezet.", beste, besteKandidaat);
        await stap("STOP", "Gestopt: de bevoegdheid voor zelfstandig doorwerken is weggehaald.");
        return;
      }
      if (await stopRequested(activiteit)) {
        await noteerRonde(loopId, ronde, null, null, null, null, "STOPPEN_GEVRAAGD", "Een gebruiker heeft om stoppen gevraagd.");
        await beëindig(loopId, "STOPPED", "Gestopt op verzoek van een gebruiker.", beste, besteKandidaat);
        await stap("STOP", "Gestopt op verzoek.");
        return;
      }

      await heartbeat(activiteit);
      await stap("STAP", `Ronde ${ronde} begint.`);

      const voorstel: JobProposal = {
        kind: besteKandidaat ? "REBUILD" : "GENERATE",
        strategy: "BALANCED",
        strategyLabel: "Optimale totaalbalans",
        rosterYear: new Date().getFullYear() + 1,
        searchMode: input.searchMode,
        goals: [...input.goals],
        parentCandidateId: besteKandidaat,
        note: `${input.goal} — ronde ${ronde}`,
        locationCode: input.locationCode,
      };

      let runId: string;
      try {
        const gestart = await startProposedJob({ actor: input.actor, grant: verseGrant, proposal: voorstel, sessionId: input.sessionId ?? null });
        runId = gestart.runId;
      } catch (fout) {
        const reden = fout instanceof Error ? fout.message : String(fout);
        await noteerRonde(loopId, ronde, null, null, null, null, "MISLUKT", reden);
        await beëindig(loopId, "FAILED", `Ronde ${ronde} kon niet starten: ${reden}`, beste, besteKandidaat);
        await stap("FOUT", `Ronde ${ronde} kon niet starten: ${reden}`);
        return;
      }

      const uitkomst = await wachtOpRun(runId, Math.max(input.grant.maxSolverSeconds, 300) * 1000 * 2);
      await heartbeat(activiteit);

      // Een mislukte ronde heet mislukt. Niet "klaar", niet "geen verbetering".
      if (!uitkomst || uitkomst.status === "FAILED" || uitkomst.status === "INTERRUPTED") {
        await noteerRonde(loopId, ronde, runId, null, null, null, "MISLUKT", uitkomst?.stageMessage ?? "De opdracht liep vast.");
        await beëindig(loopId, "FAILED", `Ronde ${ronde} is mislukt: ${uitkomst?.stageMessage ?? "de opdracht liep vast"}.`, beste, besteKandidaat);
        await stap("FOUT", `Ronde ${ronde} mislukt.`);
        return;
      }
      if (uitkomst.status === "CANCELLED") {
        await noteerRonde(loopId, ronde, runId, null, null, null, "STOPPEN_GEVRAAGD", "De opdracht is afgebroken.");
        await beëindig(loopId, "STOPPED", "Gestopt: de lopende opdracht is afgebroken.", beste, besteKandidaat);
        await stap("STOP", `Ronde ${ronde} is afgebroken.`);
        return;
      }

      const kandidaten = await prisma.candidateRoster.findMany({
        where: { generationRunId: runId, archivedAt: null },
        orderBy: { candidateNumber: "asc" },
        select: { id: true },
      });

      // De beste kandidaat van deze ronde, op dezelfde meetlat als alles hier.
      let besteVanRonde: { id: string; score: number } | null = null;
      for (const k of kandidaten) {
        const score = await scoreVan(k.id, input.locationCode);
        if (score !== null && (besteVanRonde === null || score > besteVanRonde.score)) besteVanRonde = { id: k.id, score };
      }

      const lusNu = await prisma.agentResearchLoop.findUniqueOrThrow({ where: { id: loopId }, select: { maxRounds: true } });
      const besluit = rondeBesluit({
        ronde,
        maxRondes: lusNu.maxRounds,
        uitgangspunt,
        beste,
        nieuweScore: besteVanRonde?.score ?? null,
        zonderVerbeteringTotNu: zonderVerbetering,
        heeftKandidaat: besteVanRonde !== null,
      });
      // Het verschil tegen de beste van vóór deze ronde: eerst vastleggen, dan
      // pas de beste bijwerken. Andersom meet je het verschil met jezelf.
      const delta = besteVanRonde ? besteVanRonde.score - beste : null;
      zonderVerbetering = besluit.zonderVerbetering;
      if (besluit.verbeterd && besteVanRonde) {
        beste = besteVanRonde.score;
        besteKandidaat = besteVanRonde.id;
      }

      await noteerRonde(
        loopId,
        ronde,
        runId,
        besteVanRonde?.id ?? null,
        besteVanRonde?.score ?? null,
        delta,
        besluit.decision,
        besluit.reason,
      );
      await stap("STAP", `Ronde ${ronde}: ${besluit.reason}`);

      await prisma.agentResearchLoop.update({
        where: { id: loopId },
        data: { roundsDone: ronde, bestScore: beste, bestCandidateId: besteKandidaat, heartbeatAt: new Date() },
      });

      if (besluit.conclusion !== null) {
        await beëindig(loopId, "DONE", besluit.conclusion, beste, besteKandidaat);
        await stap("ANTWOORD", besluit.conclusion);
        break;
      }
    }
  } catch (fout) {
    await beëindig(loopId, "FAILED", `De lus liep vast: ${fout instanceof Error ? fout.message : String(fout)}`, beste, besteKandidaat);
    await stap("FOUT", "De onderzoekslus liep vast.");
  } finally {
    const eind = await prisma.agentResearchLoop.findUnique({ where: { id: loopId }, select: { status: true } });
    await finishActivity(
      activiteit,
      eind?.status === "DONE" ? "DONE" : eind?.status === "STOPPED" ? "STOPPED" : "FAILED",
    );
  }
}

async function noteerRonde(
  loopId: string,
  roundNumber: number,
  generationRunId: string | null,
  candidateId: string | null,
  score: number | null,
  delta: number | null,
  decision: string,
  reason: string,
): Promise<void> {
  await prisma.agentResearchRound.create({
    data: { loopId, roundNumber, generationRunId, candidateId, score, delta, decision, reason },
  });
}

async function beëindig(
  loopId: string,
  status: "DONE" | "STOPPED" | "FAILED",
  conclusion: string,
  bestScore: number,
  bestCandidateId: string | null,
): Promise<void> {
  await prisma.agentResearchLoop.updateMany({
    where: { id: loopId, status: "RUNNING" },
    data: { status, conclusion, finishedAt: new Date(), bestScore, bestCandidateId },
  });
}

/** De lus zoals het scherm hem leest. */
export async function researchLoop(loopId: string) {
  return prisma.agentResearchLoop.findUnique({
    where: { id: loopId },
    select: {
      id: true,
      goal: true,
      goals: true,
      status: true,
      roundsDone: true,
      maxRounds: true,
      baselineScore: true,
      bestScore: true,
      bestCandidateId: true,
      conclusion: true,
      startedAt: true,
      finishedAt: true,
      rounds: { orderBy: { roundNumber: "asc" }, select: { roundNumber: true, decision: true, reason: true, score: true, delta: true, candidateId: true, at: true } },
    },
  });
}
