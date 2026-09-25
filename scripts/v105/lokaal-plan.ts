import "dotenv/config";
import { localConfigFromEnv, localModel } from "@/server/agent/model/local";
import type { PlanRequest } from "@/server/agent/model/types";
import { toolCatalogue } from "@/server/agent/tools";
import type { Actor } from "@/server/auth/session";

/**
 * Wat maakt het lokale model van één vraag?
 *
 * Een kijkglas, geen toets. Bij de doorloop van fase 9 bleef een rekenverzoek
 * een gewoon antwoord opleveren, en dan is er precies één vraag die ertoe doet:
 * kwam de instructie niet aan, of negeert het model hem? Dat is niet te zien in
 * het scherm — daar zie je alleen de uitkomst.
 *
 *   npx tsx --conditions=react-server scripts/v105/lokaal-plan.ts "Laat uitrekenen of de nachten beter geclusterd kunnen worden."
 */

const actor: Actor = {
  sessionId: "lokaal-plan",
  userId: "x",
  employeeId: "x",
  employeeNumber: "900001",
  roles: ["ROSTER_COMMITTEE"],
  authLevel: "PASSWORD",
  depot: "DDR",
} as unknown as Actor;

async function main(): Promise<void> {
  const config = localConfigFromEnv();
  if (!config) throw new Error("Geen lokaal model ingesteld (NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL).");

  const vraag = process.argv[2] ?? "Laat uitrekenen of de nachten beter geclusterd kunnen worden.";
  const request: PlanRequest = {
    text: vraag,
    context: {
      locationCode: "DDR",
      source: "official",
      candidateId: null,
      rosterCode: "DDR-MIX",
      lineNumber: null,
      weekday: null,
      dutyCode: null,
      missing: [],
    },
    tools: toolCatalogue(actor),
    history: [],
    capabilities: ["agent:chat", "agent:job:create"],
    suspended: false,
  };

  const plan = await localModel(config).plan(request);
  console.log(`vraag: ${vraag}`);
  console.log(`model: ${config.model} · temperatuur ${config.temperature}`);
  console.log(`intent: ${plan.intent}`);
  console.log(`tools: ${plan.toolCalls.map((c) => `${c.tool}(${JSON.stringify(c.input)})`).join(", ") || "geen"}`);
  console.log(`voorstel: ${plan.proposal ? JSON.stringify(plan.proposal, null, 2) : "GEEN"}`);
  console.log(`toelichting: ${plan.reasoning}`);
  if (plan.clarification) console.log(`wedervraag: ${plan.clarification}`);
}

main()
  .then(() => process.exit(0))
  .catch((fout) => {
    console.error(fout);
    process.exit(1);
  });
