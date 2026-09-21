import "dotenv/config";
import { askAgent } from "@/server/agent/agent";
import { currentGrant, levelOf, setAgentLevel } from "@/server/agent/capabilities";
import { correctMemory, decideMemory, proposeMemory, recall, withdrawMemory } from "@/server/agent/memory";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * De geheugenscenario's uit de werkopdracht, echt gedraaid.
 *
 * - TEST 8  Een goedgekeurde Dordrechtse voorkeur wordt bij een later
 *           vergelijkbaar Dordrecht-project teruggevonden.
 * - TEST 9  Diezelfde voorkeur is niet automatisch actief in Rotterdam.
 * - TEST 10 Een tegenstrijdige Rotterdamse voorkeur staat apart en overschrijft
 *           de Dordrechtse niet.
 * - TEST 12 Een niet-goedgekeurde NS-brede voorkeur heeft geen effect.
 * - TEST 13 Een correctie voorkomt dat de oude lezing opnieuw actief wordt.
 * - TEST 21 Een voorkeur uit een ouder dienstenpakket wordt niet blind
 *           toegepast op een nieuw pakket.
 * - TEST 25 Intrekken kan zonder de geschiedenis te vernietigen.
 *
 * Alles wat dit script aanmaakt, ruimt het ook weer op: het geheugen van de
 * demo-omgeving hoort niet vol te lopen met testvoorkeuren.
 *
 * Draaien met: npm run verify:geheugen
 */

let geslaagd = 0;
let mislukt = 0;
const opgeruimd: string[] = [];

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
    sessionId: "verify-geheugen",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD" as Actor["authLevel"],
    depot: account.employee.depot,
  };
}

async function main(): Promise<void> {
  const actor = await actorMet("ROSTER_COMMITTEE");
  const beginNiveau = levelOf(await currentGrant("DDR"));
  // Geheugen schrijven hoort bij niveau B.
  await setAgentLevel(actor, "DDR", "B");
  const grant = await currentGrant("DDR");

  const pakket = await prisma.dutyPackage.findFirst({
    where: { depot: "DDR", status: "ACTIVE" },
    orderBy: { validFrom: "desc" },
    select: { id: true, label: true },
  });

  try {
    // ── TEST 8 ──────────────────────────────────────────────────────────────
    console.log("\nTEST 8 — een goedgekeurde voorkeur komt terug bij een volgend project");
    const ddrId = await proposeMemory({
      actor,
      grant,
      scope: "LOCATION",
      kind: "PREFERENCE",
      locationCode: "DDR",
      dutyPackageId: pakket?.id ?? null,
      statement: "In Dordrecht liever vijf nachten aaneen dan twee losse nachten in dezelfde week.",
      rationale: "Uit de kwartaalfeedback van 2026-Q2 en twee commissiebesprekingen.",
      byAgent: false,
    });
    opgeruimd.push(ddrId);

    const voorGoedkeuring = await recall({ locationCode: "DDR" });
    toets(
      "een voorstel telt nog niet mee",
      !voorGoedkeuring.some((i) => i.id === ddrId),
      `${voorGoedkeuring.length} goedgekeurde items`,
    );

    await decideMemory({ actor, itemId: ddrId, approve: true });
    const naGoedkeuring = await recall({ locationCode: "DDR", dutyPackageId: pakket?.id ?? null });
    const gevonden = naGoedkeuring.find((i) => i.id === ddrId);
    toets("na goedkeuring wordt hij teruggevonden", Boolean(gevonden), gevonden?.statement.slice(0, 60) ?? "niet gevonden");
    toets("de herkomst staat erbij", gevonden?.proposedByAgent === false, "van een mens");
    toets("de context is nog dezelfde", gevonden?.contextStillCurrent === true, `pakket ${pakket?.label ?? "onbekend"}`);

    // En de agent vindt hem ook, via de gewone weg.
    const viaAgent = await askAgent({
      actor,
      text: "Wat hebben we hier eerder geleerd over nachten?",
      uiContext: { source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, locationCode: "DDR" },
      persist: false,
    });
    toets("de agent haalt hem op", viaAgent.text.includes("vijf nachten aaneen"), `tools: ${viaAgent.toolCalls.map((c) => c.tool).join(", ")}`);

    // ── TEST 9 en 10 ────────────────────────────────────────────────────────
    console.log("\nTEST 9 en 10 — een andere standplaats erft niets en overschrijft niets");
    const rtdId = await proposeMemory({
      actor,
      grant,
      scope: "LOCATION",
      kind: "PREFERENCE",
      locationCode: "RTD",
      statement: "In Rotterdam juist liever twee korte nachtreeksen dan één lange.",
      rationale: "Tegenstrijdig met Dordrecht; bewust apart vastgelegd.",
      byAgent: false,
    });
    opgeruimd.push(rtdId);
    await decideMemory({ actor, itemId: rtdId, approve: true });

    const rtd = await recall({ locationCode: "RTD" });
    const ddr = await recall({ locationCode: "DDR" });
    toets("Rotterdam ziet de Dordrechtse voorkeur niet", !rtd.some((i) => i.id === ddrId), `${rtd.length} items in RTD`);
    toets("Dordrecht ziet de Rotterdamse voorkeur niet", !ddr.some((i) => i.id === rtdId), `${ddr.length} items in DDR`);
    toets("beide bestaan naast elkaar", rtd.some((i) => i.id === rtdId) && ddr.some((i) => i.id === ddrId), "geen van beide overschreven");

    // ── TEST 12 ─────────────────────────────────────────────────────────────
    console.log("\nTEST 12 — een niet-goedgekeurde NS-brede voorkeur doet niets");
    const nsId = await proposeMemory({
      actor,
      grant,
      scope: "NATIONAL",
      kind: "PREFERENCE",
      locationCode: null,
      statement: "NS-breed: nachtreeksen van vijf zijn te verkiezen boven losse nachten.",
      rationale: "Voorstel op grond van twee standplaatsen; nog niet vastgesteld.",
      byAgent: true,
    });
    opgeruimd.push(nsId);
    const zonderGoedkeuring = await recall({ locationCode: "DDR" });
    toets("hij telt niet mee", !zonderGoedkeuring.some((i) => i.id === nsId), "alleen goedgekeurde items");
    const metVoorstellen = await recall({ locationCode: "DDR", includeProposed: true });
    const voorstel = metVoorstellen.find((i) => i.id === nsId);
    toets("hij is wel leesbaar als voorstel", Boolean(voorstel), `status ${voorstel?.status}`);
    toets("de herkomst zegt dat de agent hem voorstelde", voorstel?.proposedByAgent === true, "");

    // ── TEST 13 ─────────────────────────────────────────────────────────────
    console.log("\nTEST 13 — een correctie maakt de oude lezing definitief inactief");
    const nieuwId = await correctMemory({
      actor,
      grant,
      itemId: ddrId,
      statement: "In Dordrecht liever vijf nachten aaneen, maar niet in de week vóór een vrij weekend.",
      rationale: "De oorspronkelijke lezing was te algemeen.",
    });
    opgeruimd.push(nieuwId);
    const naCorrectie = await recall({ locationCode: "DDR", dutyPackageId: pakket?.id ?? null });
    toets("de oude lezing is niet meer actief", !naCorrectie.some((i) => i.id === ddrId), "");
    toets("de nieuwe lezing is actief", naCorrectie.some((i) => i.id === nieuwId), "");
    const oud = await prisma.agentMemoryItem.findUnique({ where: { id: ddrId }, select: { status: true, supersededById: true } });
    toets("de oude lezing bestaat nog, met verwijzing naar de nieuwe", oud?.status === "SUPERSEDED" && oud.supersededById === nieuwId, `status ${oud?.status}`);

    // ── TEST 21 ─────────────────────────────────────────────────────────────
    console.log("\nTEST 21 — een les uit een ouder dienstenpakket geldt niet zomaar");
    const oudPakketId = await proposeMemory({
      actor,
      grant,
      scope: "LOCATION",
      kind: "LESSON",
      locationCode: "DDR",
      dutyPackageId: "pakket-van-vorig-jaar",
      statement: "Dienst 115 op donderdag is zwaar; hem naast een vroege dienst zetten viel slecht.",
      rationale: "Uit de ronde van vorig jaar.",
      byAgent: false,
    });
    opgeruimd.push(oudPakketId);
    await decideMemory({ actor, itemId: oudPakketId, approve: true });
    const metPakket = await recall({ locationCode: "DDR", dutyPackageId: pakket?.id ?? null });
    const les = metPakket.find((i) => i.id === oudPakketId);
    toets("de les komt wel terug", Boolean(les), "hij wordt niet verzwegen");
    toets("maar met de waarschuwing dat de context anders was", les?.contextStillCurrent === false, `pakket ${les?.dutyPackageId} vs ${pakket?.id}`);

    const uitleg = await askAgent({
      actor,
      text: "Wat weten we nog van vorig jaar over dienst 115?",
      uiContext: { source: "official", candidateId: null, rosterCode: null, lineNumber: null, weekday: null, dutyCode: null, locationCode: "DDR" },
      persist: false,
    });
    toets(
      "de agent zegt er zelf bij dat het pakket anders was",
      /ander dienstenpakket/i.test(uitleg.text),
      uitleg.text.slice(0, 110),
    );

    // ── TEST 25 ─────────────────────────────────────────────────────────────
    console.log("\nTEST 25 — intrekken zonder de geschiedenis te vernietigen");
    await withdrawMemory(actor, rtdId, "De Rotterdamse commissie heeft dit teruggenomen.");
    const naIntrekken = await recall({ locationCode: "RTD" });
    const rij = await prisma.agentMemoryItem.findUnique({ where: { id: rtdId }, select: { status: true, withdrawnReason: true, withdrawnAt: true, statement: true } });
    toets("hij telt niet meer mee", !naIntrekken.some((i) => i.id === rtdId), "");
    toets("hij bestaat nog", Boolean(rij), "");
    toets("met reden en datum", Boolean(rij?.withdrawnReason && rij.withdrawnAt), rij?.withdrawnReason ?? "");
    toets("en met de oorspronkelijke tekst", (rij?.statement ?? "").includes("twee korte nachtreeksen"), "");

    const auditRegels = await prisma.auditLogEntry.count({
      where: { objectType: "AgentMemoryItem", occurredAt: { gte: new Date(Date.now() - 10 * 60_000) } },
    });
    toets("elke stap staat in het auditlogboek", auditRegels >= 6, `${auditRegels} regels`);
  } finally {
    // Opruimen: eerst de opvolgers losmaken, anders blokkeert de verwijzing.
    await prisma.agentMemoryItem.updateMany({ where: { id: { in: opgeruimd } }, data: { supersededById: null } });
    await prisma.agentMemoryItem.deleteMany({ where: { id: { in: opgeruimd } } });
    await setAgentLevel(actor, "DDR", beginNiveau);
    console.log(`\n${opgeruimd.length} testitems opgeruimd; niveau teruggezet op ${beginNiveau}.`);
  }

  console.log(`\n${geslaagd} geslaagd, ${mislukt} mislukt`);
  console.log("Niet gemeten: TEST 11 (een gedeelde voorkeur NS-breed voorstellen) hoort bij fase 7.");
  if (mislukt > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
