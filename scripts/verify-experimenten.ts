import "dotenv/config";

// Deze toets meet de experimenteerlaag en niet het taalmodel.
process.env.NS_AGENT_FORCE_STUB = "1";
import {
  AGENT_CAPABILITIES,
  AGENT_LEVELS,
  currentGrant,
  levelOf,
  setAgentLevel,
} from "@/server/agent/capabilities";
import {
  type ExperimentMeting,
  beoordeelExperiment,
  eerdereExperimenten,
  proposeExperiment,
  promotieStappen,
  recordExperimentResult,
} from "@/server/agent/experiments";
import { callTool } from "@/server/agent/tools";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * Fase 8: de technische experimenteeromgeving, echt gedraaid.
 *
 * ## Wat hier bewezen moet worden
 *
 * Drie dingen, en ze liggen niet in elkaars verlengde.
 *
 * 1. **De poorten houden de verkeerde ruil tegen.** Een variant die de
 *    voorkeursscore omhoog brengt ten koste van nachten, eerlijkheid of de
 *    slechtste roosterregel, is geen verbetering. Dat staat letterlijk in
 *    "wat niet meetelt als vooruitgang" en het is de makkelijkste manier om
 *    jezelf voor de gek te houden.
 * 2. **Een afgewezen experiment blijft vindbaar met de reden van toen** —
 *    criterium C2. Niet met een nette hervertelling: met dezelfde tekst.
 * 3. **Niets promoveert zichzelf.** Er hoort geen pad te bestaan waarlangs de
 *    agent een variant in productie krijgt.
 *
 * ## Waarom de poorttoetsen zonder database draaien
 *
 * Omdat het oordeel dan zichtbaar los staat van de opslag. Een poort die alleen
 * "werkt" als er toevallig een rij in een tabel staat, is geen poort.
 *
 * Draaien met: npm run verify:experimenten
 */

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

const LOCATIE = "DDR";

const BASIS: ExperimentMeting = {
  hardValidShare: 1,
  robust: 72.0,
  preference: 64.0,
  nights: 80.0,
  fairness: 70.0,
  worstLine: 55.0,
};

async function actorMet(rol: "ROSTER_COMMITTEE" | "EMPLOYEE"): Promise<Actor> {
  const account = await prisma.userAccount.findFirst({
    where: { roles: { has: rol }, status: "ACTIVE", employee: { depot: LOCATIE } },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });
  if (!account) throw new Error(`Geen actief account met rol ${rol} in ${LOCATIE}.`);
  return {
    sessionId: "verify-experimenten",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD" as Actor["authLevel"],
    depot: account.employee.depot,
  };
}

async function main(): Promise<void> {
  // ── De poorten, zonder database ───────────────────────────────────────────
  console.log("\nTEST 24 — een hogere voorkeursscore koopt geen verslechtering af");

  const ruil = beoordeelExperiment(BASIS, { ...BASIS, preference: 69.0, nights: 74.0 });
  toets("nachten 6 punten omlaag wordt afgewezen ondanks +5 voorkeur", !ruil.geslaagd, ruil.conclusie.slice(0, 110));
  toets("de afwijzing noemt de maat die zakte", ruil.conclusie.includes("nachten"), ruil.conclusie.slice(0, 80));
  toets(
    "de afwijzing verzwijgt de winst niet",
    ruil.conclusie.includes("+5.00"),
    "een afwijzing die de winst weglaat, nodigt uit hem opnieuw te proberen",
  );

  const slechtsteRegel = beoordeelExperiment(BASIS, { ...BASIS, preference: 70.0, worstLine: 52.0 });
  toets("een slechtere slechtste regel wordt afgewezen ondanks +6 voorkeur", !slechtsteRegel.geslaagd, slechtsteRegel.conclusie.slice(0, 90));

  const geldigheid = beoordeelExperiment(BASIS, { ...BASIS, preference: 80.0, hardValidShare: 0.98 });
  toets("minder geldige kandidaten wordt afgewezen, ook bij +16 voorkeur", !geldigheid.geslaagd, "harde geldigheid heeft marge 0");

  const ruis = beoordeelExperiment(BASIS, { ...BASIS, preference: 66.0, nights: 79.5, fairness: 69.8 });
  toets("beweging binnen de marge telt niet als verslechtering", ruis.geslaagd, ruis.conclusie.slice(0, 90));

  const nietsGewonnen = beoordeelExperiment(BASIS, { ...BASIS, nights: 85.0 });
  toets(
    "alle poorten gehaald maar geen winst op de voorkeurslaag is geen succes",
    !nietsGewonnen.geslaagd && nietsGewonnen.conclusie.includes("geen winst"),
    nietsGewonnen.conclusie.slice(0, 90),
  );

  const echteWinst = beoordeelExperiment(BASIS, { ...BASIS, preference: 67.0, nights: 81.0 });
  toets("een echte verbetering komt erdoor", echteWinst.geslaagd, echteWinst.conclusie.slice(0, 100));
  toets(
    "en wordt gepresenteerd als voorstel, niet als besluit",
    echteWinst.conclusie.includes("promoveren doet een mens"),
    echteWinst.conclusie.slice(-70),
  );

  // ── Bevoegdheid ───────────────────────────────────────────────────────────
  console.log("\nTEST 16 — experimenteren is een aparte bevoegdheid");
  for (const niveau of ["A", "B", "C"] as const) {
    toets(
      `niveau ${niveau} bevat EXPERIMENT_PROPOSE niet uit zichzelf`,
      !AGENT_LEVELS[niveau].includes(AGENT_CAPABILITIES.EXPERIMENT_PROPOSE),
      `${AGENT_LEVELS[niveau].length} bevoegdheden`,
    );
  }

  const commissie = await actorMet("ROSTER_COMMITTEE");
  const beginNiveau = levelOf(await currentGrant(LOCATIE));
  await setAgentLevel(commissie, LOCATIE, "C");
  const grantC = await currentGrant(LOCATIE);

  let geweigerd = false;
  try {
    await proposeExperiment({
      actor: commissie,
      grant: grantC,
      locationCode: LOCATIE,
      hypothesis: "Zonder toekenning mag dit niet.",
      variant: { preferenceScale: 1.2 },
      byAgent: true,
    });
  } catch (fout) {
    geweigerd = true;
    toets("zonder de bevoegdheid komt er geen experiment", true, (fout as Error).name);
  }
  if (!geweigerd) toets("zonder de bevoegdheid komt er geen experiment", false, "het voorstel werd tóch aangemaakt");

  // Nu mét de bevoegdheid, expliciet toegekend naast niveau C.
  const metRecht = { ...grantC, capabilities: [...grantC.capabilities, AGENT_CAPABILITIES.EXPERIMENT_PROPOSE] };

  let onbekendVeld = false;
  try {
    await proposeExperiment({
      actor: commissie,
      grant: metRecht,
      locationCode: LOCATIE,
      hypothesis: "Een veld dat niet bestaat.",
      variant: { verzonnenKnop: 3 },
      byAgent: true,
    });
  } catch (fout) {
    onbekendVeld = (fout as Error).message.includes("verzonnenKnop");
  }
  toets("een onbekend variantveld wordt meteen afgewezen", onbekendVeld, "niet pas als de zoekmachine start");

  let leeg = false;
  try {
    await proposeExperiment({ actor: commissie, grant: metRecht, locationCode: LOCATIE, hypothesis: "Niets veranderen.", variant: {}, byAgent: true });
  } catch {
    leeg = true;
  }
  toets("een experiment zonder variant wordt afgewezen", leeg, "dat meet niets");

  // ── C2: de reden van toen ─────────────────────────────────────────────────
  console.log("\nCRITERIUM C2 — een afgewezen experiment wordt teruggevonden met de oorspronkelijke reden");

  const hypothese = `Een sterkere nachtuitloopweging verbetert de nachtclustering (toets ${Date.now()}).`;
  const id = await proposeExperiment({
    actor: commissie,
    grant: metRecht,
    locationCode: LOCATIE,
    hypothesis: hypothese,
    variant: { nightExitScale: 1.4 },
    byAgent: true,
  });
  const uitslag = await recordExperimentResult({
    actor: commissie,
    experimentId: id,
    baseline: BASIS,
    result: { ...BASIS, preference: 68.5, fairness: 66.0 },
  });
  toets("het experiment werd afgewezen", !uitslag.geslaagd, uitslag.conclusie.slice(0, 100));

  const terug = await eerdereExperimenten({ locationCode: LOCATIE, hypothesis: "nachtuitloopweging nachtclustering", limit: 5 });
  const gevonden = terug.find((e) => e.id === id);
  toets("het experiment wordt teruggevonden op de hypothese", gevonden !== undefined, `${terug.length} treffer(s)`);
  toets(
    "de conclusie is letterlijk die van toen",
    gevonden?.conclusion === uitslag.conclusie,
    gevonden?.conclusion ? "identiek" : "conclusie ontbreekt",
  );
  toets(
    "de gezakte poort staat er met waarde en grens bij",
    (gevonden?.gates ?? []).some((g) => !g.gehaald && g.naam === "eerlijkheid"),
    (gevonden?.gates ?? []).filter((g) => !g.gehaald).map((g) => g.naam).join(", ") || "geen",
  );
  toets("de status is REJECTED", gevonden?.status === "REJECTED", gevonden?.status ?? "onbekend");

  // Dezelfde vraag, maar nu langs de tool die de agent werkelijk gebruikt.
  const viaTool = await callTool(commissie, "experimentHistory", { locationCode: LOCATIE, hypothesis: "nachtuitloopweging nachtclustering", limit: 5 });
  const uitTool = (viaTool.result?.data as { experiments?: { id: string; conclusion: string | null }[] } | undefined)?.experiments ?? [];
  toets("de agent kan er zelf bij via experimentHistory", uitTool.some((e) => e.id === id), `${uitTool.length} treffer(s), tool ok: ${viaTool.call.ok}`);
  toets(
    "en krijgt dezelfde tekst te zien",
    uitTool.find((e) => e.id === id)?.conclusion === uitslag.conclusie,
    "een hervertelling zou de reden ongemerkt kunnen veranderen",
  );

  const medewerker = await actorMet("EMPLOYEE");
  const zonderRecht = await callTool(medewerker, "experimentHistory", { locationCode: LOCATIE, limit: 5 });
  toets(
    "een medewerker zonder leesrecht krijgt de experimenten niet",
    zonderRecht.result === null && zonderRecht.call.note === "geen recht",
    `note: ${zonderRecht.call.note ?? "geen"}`,
  );

  // ── Niets promoveert zichzelf ─────────────────────────────────────────────
  console.log("\nTEST 16 — promoveren is mensenwerk");
  const moduleExports = Object.keys(await import("@/server/agent/experiments"));
  const promoveert = moduleExports.filter((n) => /^promoteExperiment$|^applyExperiment$|^activateVariant$/.test(n));
  toets("de module kent geen functie die een variant in productie zet", promoveert.length === 0, `exports: ${moduleExports.join(", ")}`);
  const stappen = promotieStappen(id);
  toets("er is wel een beschreven route voor een mens", stappen.length >= 4, `${stappen.length} stappen`);
  toets(
    "en die route bevat een tweede paar ogen",
    stappen.some((s) => s.toLowerCase().includes("tweede persoon")),
    stappen[1] ?? "",
  );

  const naStatus = await prisma.agentExperiment.findUnique({ where: { id }, select: { status: true } });
  toets("het afgewezen experiment blijft afgewezen", naStatus?.status === "REJECTED", naStatus?.status ?? "weg");

  await setAgentLevel(commissie, LOCATIE, beginNiveau);
  console.log(`\nNiveau teruggezet op ${beginNiveau}.`);
  console.log(`\n${geslaagd} geslaagd, ${mislukt} mislukt`);
  if (mislukt > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
