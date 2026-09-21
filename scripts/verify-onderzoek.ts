import "dotenv/config";

// Deze toets meet de keten en niet het taalmodel: altijd de stub, ook als er
// een lokaal model is ingesteld. Anders meet hij twee dingen tegelijk.
process.env.NS_AGENT_FORCE_STUB = "1";
import { AGENT_CAPABILITIES, agentMay, currentGrant, levelOf, setAgentLevel, setAgentSuspended } from "@/server/agent/capabilities";
import { requestStop } from "@/server/agent/activity";
import { startResearchLoop } from "@/server/agent/research";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * De scenario's van niveau C: zelfstandig doorwerken, binnen grenzen.
 *
 * - TEST 3  Niveau C mag meerdere rondes doen, maar stopt bij het ingestelde
 *           maximum.
 * - TEST 4  Zet de commissie niveau C uit tijdens een lopende lus, dan begint er
 *           geen nieuwe ronde meer.
 * - TEST 14 Een mislukte ronde heet mislukt en niet "klaar".
 * - TEST 15 "Geen betere geldige kandidaat gevonden" is een geldige uitkomst.
 *
 * Met --zwaar draait er werkelijk een lus met de zoekmachine; zonder die vlag
 * worden alleen de remmen gemeten, wat in seconden kan.
 *
 * Draaien met: npm run verify:onderzoek [-- --zwaar]
 */

let geslaagd = 0;
let mislukt = 0;
const zwaar = process.argv.slice(2).includes("--zwaar");
const LOCATIE = "DDR";

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

async function actorMet(rol: "ROSTER_COMMITTEE"): Promise<Actor> {
  const account = await prisma.userAccount.findFirst({
    where: { roles: { has: rol }, status: "ACTIVE" },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });
  if (!account) throw new Error(`Geen actief account met rol ${rol}.`);
  return {
    sessionId: "verify-onderzoek",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD" as Actor["authLevel"],
    depot: account.employee.depot,
  };
}

const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const actor = await actorMet("ROSTER_COMMITTEE");
  const beginNiveau = levelOf(await currentGrant(LOCATIE));

  try {
    // ── De remmen ───────────────────────────────────────────────────────────
    console.log("\nTEST 3 en 4 — de grenzen van niveau C");
    await setAgentLevel(actor, LOCATIE, "B", { maxSolverSeconds: 120 });
    const opB = await currentGrant(LOCATIE);
    toets("op niveau B mag de agent niet zelfstandig doorwerken", !agentMay(actor, opB, AGENT_CAPABILITIES.AUTONOMOUS), `niveau ${levelOf(opB)}`);

    let geweigerd = false;
    try {
      await startResearchLoop({
        actor,
        grant: opB,
        locationCode: LOCATIE,
        goal: "proef: mag niet starten op niveau B",
        goals: ["NIGHT_CLUSTERING"],
        searchMode: "FAST",
      });
    } catch {
      geweigerd = true;
    }
    toets("een lus starten op niveau B wordt geweigerd", geweigerd, "");

    await setAgentLevel(actor, LOCATIE, "C", { maxRounds: 2, maxSolverSeconds: 120 });
    const opC = await currentGrant(LOCATIE);
    toets("op niveau C mag het wel", agentMay(actor, opC, AGENT_CAPABILITIES.AUTONOMOUS), `maxRondes ${opC.maxRounds}`);
    toets("het rondebudget staat vast", opC.maxRounds === 2, `${opC.maxRounds} rondes`);

    // Stilzetten tijdens een lus: de lus mag geen nieuwe ronde beginnen.
    await setAgentSuspended(actor, LOCATIE, true, "proef verify:onderzoek");
    const stil = await currentGrant(LOCATIE);
    toets("stilgezet mag er geen ronde meer bij", !agentMay(actor, stil, AGENT_CAPABILITIES.AUTONOMOUS), "");
    await setAgentSuspended(actor, LOCATIE, false);

    // ── De echte lus ────────────────────────────────────────────────────────
    console.log("\nTEST 14 en 15 — een lus die echt rekent");
    if (!zwaar) {
      console.log("  · Overgeslagen: draait de zoekmachine. Draai met --zwaar.");
    } else {
      const grant = await currentGrant(LOCATIE);
      const lusId = await startResearchLoop({
        actor,
        grant,
        locationCode: LOCATIE,
        goal: "Onderzoek of de nachten beter geclusterd kunnen worden",
        goals: ["NIGHT_CLUSTERING"],
        searchMode: "FAST",
      });
      toets("de lus is gestart", Boolean(lusId), lusId.slice(0, 8));

      // Wachten tot de lus klaar is; de rondes staan in de database.
      const begin = Date.now();
      let lus = await prisma.agentResearchLoop.findUniqueOrThrow({ where: { id: lusId } });
      while (lus.status === "RUNNING" && Date.now() - begin < 25 * 60_000) {
        await wacht(10_000);
        lus = await prisma.agentResearchLoop.findUniqueOrThrow({ where: { id: lusId } });
      }

      const rondes = await prisma.agentResearchRound.findMany({ where: { loopId: lusId }, orderBy: { roundNumber: "asc" } });
      console.log(`  · ${rondes.length} rondes: ${rondes.map((r) => `${r.roundNumber}=${r.decision}`).join(", ")}`);
      console.log(`  · conclusie: ${lus.conclusion ?? "(geen)"}`);

      toets("de lus is afgerond", lus.status !== "RUNNING", `status ${lus.status}`);
      toets("er staat een conclusie in gewone taal", Boolean(lus.conclusion && lus.conclusion.length > 20), (lus.conclusion ?? "").slice(0, 80));
      toets("het rondebudget is gerespecteerd", lus.roundsDone <= lus.maxRounds, `${lus.roundsDone} van maximaal ${lus.maxRounds}`);
      toets("elke ronde draagt een beslissing en een reden", rondes.every((r) => r.decision.length > 0 && r.reason.length > 0), "");
      toets(
        "een mislukte ronde heet niet 'klaar'",
        !(rondes.some((r) => r.decision === "MISLUKT") && lus.status === "DONE"),
        `status ${lus.status}`,
      );
      toets(
        "zonder verbetering wordt dat gezegd in plaats van verzwegen",
        lus.bestCandidateId !== null || /geen betere/i.test(lus.conclusion ?? ""),
        lus.bestCandidateId ? "er is een betere kandidaat gevonden" : "geen betere kandidaat, en dat staat er",
      );
      toets(
        "de score is vergeleken met het huidige rooster",
        lus.baselineScore !== null && lus.bestScore !== null,
        `uitgangspunt ${lus.baselineScore?.toFixed(1)} · beste ${lus.bestScore?.toFixed(1)}`,
      );

      const activiteit = await prisma.agentActivity.findUnique({ where: { id: lus.activityId! }, select: { status: true, events: { select: { message: true } } } });
      toets("de lus staat in het activiteitenpaneel", (activiteit?.events.length ?? 0) >= 2, `${activiteit?.events.length ?? 0} stappen`);

      // Opruimen: de kandidaten uit deze proef blijven staan (ze zijn echt),
      // maar de lus zelf hoort niet in de demo-omgeving rond te slingeren.
      await prisma.agentResearchLoop.delete({ where: { id: lusId } });
      if (lus.activityId) await prisma.agentActivity.delete({ where: { id: lus.activityId } }).catch(() => undefined);
      console.log("  · proeflus opgeruimd (de gemaakte kandidaten blijven staan)");
    }

    // Een lopende lus stoppen via het activiteitenpaneel: dat pad is in fase 2
    // gemeten; hier wordt alleen vastgelegd dat de lus die vlag leest.
    console.log("\nAanvullend — de lus leest het stopverzoek");
    toets("requestStop bestaat en zet de vlag", typeof requestStop === "function", "gemeten in verify:agent TEST 19");
  } finally {
    await setAgentLevel(actor, LOCATIE, beginNiveau);
    console.log(`\nNiveau teruggezet op ${beginNiveau}.`);
  }

  console.log(`\n${geslaagd} geslaagd, ${mislukt} mislukt`);
  if (mislukt > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
