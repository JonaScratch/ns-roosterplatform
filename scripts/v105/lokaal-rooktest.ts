import "dotenv/config";
import { execFileSync } from "node:child_process";
import { askAgent } from "@/server/agent/agent";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * De rooktest van het lokale model: doet het überhaupt iets bruikbaars?
 *
 * Geen benchmark en geen oordeel over kwaliteit — dat is `bench:lokale-ai`.
 * Dit script beantwoordt drie vragen waarop het antwoord "ja" moet zijn
 * voordat meten zin heeft:
 *
 * 1. Is het eindpunt bereikbaar en kent het het model?
 * 2. Komt er een leesbaar plan uit, met een tool die bestaat?
 * 3. Rekent het ding op de videokaart, of stilletjes op de processor?
 *
 * Die derde vraag staat er niet voor de sier: op deze machine is eerder een
 * model stil op de processor teruggevallen terwijl alles "werkte".
 *
 * Draaien met: npm run lokaal:rooktest
 */

const vragen = [
  { tekst: "Welke diensten staan er in regel 4 van DDR-L?", context: { rosterCode: "DDR-L", lineNumber: 4 } },
  { tekst: "Hoeveel rust moet er minimaal tussen twee diensten zitten?", context: {} },
  { tekst: "Waarom heeft LA in roosterregel 4 geen RET-diensten?", context: { rosterCode: "DDR-L", lineNumber: 4 } },
  { tekst: "Publiceer dit rooster.", context: { rosterCode: "DDR-L" } },
];

function gpu(): { usedMiB: number; totalMiB: number } | null {
  try {
    const uit = execFileSync("nvidia-smi", ["--query-gpu=memory.total,memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 5000 });
    const [totaal, gebruikt] = uit.trim().split("\n")[0].split(",").map((x) => Number(x.trim()));
    return { totalMiB: totaal, usedMiB: gebruikt };
  } catch {
    return null;
  }
}

async function main() {
  const config = localConfigFromEnv();
  if (!config) {
    console.log("Geen lokaal model ingesteld. Zet NS_LOCAL_LLM_URL en NS_LOCAL_LLM_MODEL in .env.");
    process.exitCode = 1;
    return;
  }
  const bereikbaar = await localModelAvailable(config);
  console.log(`Eindpunt ${config.baseUrl}, model ${config.model}: ${bereikbaar.ok ? "in orde" : "niet in orde"} — ${bereikbaar.detail}`);
  if (!bereikbaar.ok) {
    process.exitCode = 1;
    return;
  }

  const account = await prisma.userAccount.findFirst({
    where: { roles: { has: "ROSTER_COMMITTEE" }, status: "ACTIVE" },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });
  if (!account) throw new Error("Geen commissieaccount gevonden.");
  const actor: Actor = {
    sessionId: "lokaal-rooktest",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD",
    depot: account.employee.depot,
  };

  const voor = gpu();
  console.log(`GPU vóór: ${voor ? `${voor.usedMiB} van ${voor.totalMiB} MiB` : "onbekend"}\n`);

  for (const vraag of vragen) {
    const t0 = Date.now();
    try {
      const antwoord = await askAgent({
        actor,
        text: vraag.tekst,
        uiContext: {
          source: "official",
          candidateId: null,
          rosterCode: null,
          lineNumber: null,
          weekday: null,
          dutyCode: null,
          locationCode: "DDR",
          ...vraag.context,
        },
        persist: false,
      });
      const ms = Date.now() - t0;
      console.log(`▸ ${vraag.tekst}`);
      console.log(`  status ${antwoord.status} · intent ${antwoord.intent} · ${ms} ms · tools: ${antwoord.toolCalls.map((c) => c.tool).join(", ") || "geen"}`);
      console.log(`  ${antwoord.text.replace(/\n/g, "\n  ").slice(0, 600)}\n`);
    } catch (fout) {
      console.log(`▸ ${vraag.tekst}`);
      console.log(`  MISLUKT na ${Date.now() - t0} ms: ${fout instanceof Error ? fout.message : String(fout)}\n`);
    }
  }

  const na = gpu();
  console.log(`GPU ná: ${na ? `${na.usedMiB} van ${na.totalMiB} MiB` : "onbekend"}`);
  if (voor && na) {
    const opGpu = na.usedMiB - voor.usedMiB > 500 || na.usedMiB > 2500;
    console.log(
      opGpu
        ? `Het model staat op de videokaart (+${na.usedMiB - voor.usedMiB} MiB).`
        : "Let op: het VRAM-gebruik is nauwelijks gestegen. Waarschijnlijk rekent het model op de processor.",
    );
  }
  await prisma.$disconnect();
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
