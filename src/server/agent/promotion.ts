import "server-only";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { AGENT_CAPABILITIES, type AgentGrant, assertAgentMay } from "./capabilities";

/**
 * Van lokaal naar NS-breed: wanneer mag iets voor iedereen gaan gelden?
 *
 * ## Waarom dit een voorstel is en nooit een conclusie
 *
 * Twee standplaatsen die hetzelfde hebben afgesproken, zijn geen bewijs dat het
 * overal opgaat. Dordrecht en Rotterdam kunnen dezelfde voorkeur hebben om
 * verschillende redenen, en een derde standplaats kan er goede redenen voor
 * hebben om het anders te doen. NS-breed worden is daarom een besluit van
 * mensen; deze laag levert alleen de waarneming, met de bron erbij.
 *
 * ## Waarom niet op tekstgelijkenis alleen
 *
 * Twee zinnen die op elkaar lijken, betekenen niet hetzelfde. Een voorstel
 * ontstaat daarom alleen wanneer meerdere standplaatsen een item hebben met
 * hetzelfde **optimalisatiedoel** — dat is een keuze die een mens heeft
 * gemaakt, geen gelijkenis die een algoritme heeft gezien. De zinnen komen mee
 * als onderbouwing, zodat de beoordelaar ziet wat er werkelijk staat.
 */

export interface PromotieKandidaat {
  readonly goal: string;
  readonly locations: readonly string[];
  readonly bronnen: readonly { readonly id: string; readonly locationCode: string | null; readonly statement: string; readonly approvedAt: Date | null }[];
  /** Bestaat er al een NS-breed item voor dit doel? Dan hoeft er niets voorgesteld te worden. */
  readonly alLandelijk: boolean;
}

/**
 * Welke doelen komen op meerdere standplaatsen voor?
 *
 * `minLocaties` staat standaard op twee: dat is het laagste aantal waarbij
 * "meerdere" iets betekent. Wie strenger wil zijn, zet hem hoger; de drempel
 * hoort een keuze te zijn en geen verborgen constante.
 */
export async function promotieKandidaten(minLocaties = 2): Promise<readonly PromotieKandidaat[]> {
  const items = await prisma.agentMemoryItem.findMany({
    where: { status: "APPROVED", scope: { in: ["LOCATION", "PROJECT"] }, optimisationGoal: { not: null } },
    select: { id: true, locationCode: true, statement: true, approvedAt: true, optimisationGoal: true },
    orderBy: { approvedAt: "asc" },
  });
  const landelijk = new Set(
    (
      await prisma.agentMemoryItem.findMany({
        where: { scope: "NATIONAL", status: { in: ["APPROVED", "PROPOSED"] }, optimisationGoal: { not: null } },
        select: { optimisationGoal: true },
      })
    ).map((r) => r.optimisationGoal!),
  );

  const perDoel = new Map<string, typeof items>();
  for (const item of items) {
    const doel = item.optimisationGoal!;
    perDoel.set(doel, [...(perDoel.get(doel) ?? []), item]);
  }

  const kandidaten: PromotieKandidaat[] = [];
  for (const [goal, rijen] of perDoel) {
    const locaties = [...new Set(rijen.map((r) => r.locationCode).filter((x): x is string => x !== null))];
    if (locaties.length < minLocaties) continue;
    kandidaten.push({
      goal,
      locations: locaties,
      bronnen: rijen.map((r) => ({ id: r.id, locationCode: r.locationCode, statement: r.statement, approvedAt: r.approvedAt })),
      alLandelijk: landelijk.has(goal),
    });
  }
  return kandidaten;
}

/**
 * Een NS-breed voorstel vastleggen.
 *
 * Status PROPOSED, en dat blijft het tot iemand met de juiste bevoegdheid er
 * naar kijkt. De onderbouwing bevat de bron-items, zodat de beoordelaar de
 * oorspronkelijke zinnen leest en niet alleen de samenvatting.
 */
export async function stelLandelijkVoor(input: {
  readonly actor: Actor;
  readonly grant: AgentGrant;
  readonly kandidaat: PromotieKandidaat;
  readonly statement: string;
  readonly byAgent: boolean;
}): Promise<string> {
  assertAgentMay(input.actor, input.grant, AGENT_CAPABILITIES.PREFERENCE_PROPOSE);
  if (input.kandidaat.alLandelijk) {
    throw new Error(`Voor het doel ${input.kandidaat.goal} bestaat al een NS-breed item.`);
  }

  const rij = await prisma.agentMemoryItem.create({
    data: {
      scope: "NATIONAL",
      kind: "PREFERENCE",
      locationCode: null,
      optimisationGoal: input.kandidaat.goal,
      statement: input.statement.trim(),
      rationale:
        `Voorgesteld omdat ${input.kandidaat.locations.length} standplaatsen (${input.kandidaat.locations.join(", ")}) ` +
        "een goedgekeurde voorkeur met ditzelfde doel hebben. Dat is een waarneming, geen bewijs dat het overal opgaat.",
      evidence: {
        goal: input.kandidaat.goal,
        locations: input.kandidaat.locations,
        sources: input.kandidaat.bronnen.map((b) => ({ id: b.id, locationCode: b.locationCode, statement: b.statement })),
      } as object,
      status: "PROPOSED",
      proposedByAgent: input.byAgent,
      proposedByUserId: input.actor.userId,
    },
    select: { id: true },
  });

  await recordAudit({
    actor: input.actor,
    action: "geheugen.landelijk-voorgesteld",
    objectType: "AgentMemoryItem",
    objectId: rij.id,
    newValue: { goal: input.kandidaat.goal, locations: input.kandidaat.locations, bronnen: input.kandidaat.bronnen.length },
  });
  return rij.id;
}

/**
 * De doelen die op dit moment werkelijk meetellen voor een opdracht.
 *
 * Alleen goedgekeurde items, alleen van deze standplaats of NS-breed, en alleen
 * als er een doel aan hangt. Een NS-breed voorstel dat nog niet is goedgekeurd,
 * komt hier niet uit — dat is precies wat TEST 12 vraagt.
 */
export async function geldendeGeheugenDoelen(locationCode: string): Promise<
  readonly { readonly itemId: string; readonly goal: string; readonly statement: string; readonly scope: string }[]
> {
  const rijen = await prisma.agentMemoryItem.findMany({
    where: {
      status: "APPROVED",
      optimisationGoal: { not: null },
      OR: [{ scope: { in: ["PROJECT", "LOCATION"] }, locationCode }, { scope: "NATIONAL" }],
    },
    select: { id: true, optimisationGoal: true, statement: true, scope: true },
    orderBy: { approvedAt: "desc" },
  });
  return rijen.map((r) => ({ itemId: r.id, goal: r.optimisationGoal!, statement: r.statement, scope: r.scope }));
}
