import "server-only";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";

/**
 * Laag 2: wat deze commissie bóvenop de standaardmeting belangrijk vindt.
 *
 * ## Waarom twee lagen
 *
 * Laag 1 is het kwaliteitsmodel: gemeten, geijkt aan zeven officiële roosters,
 * en niet iets om per project aan te draaien. Zou een scherm die gewichten
 * kunnen verzetten, dan betekent een score volgende maand iets anders dan
 * vandaag en is vergelijken zinloos.
 *
 * Laag 2 staat daarboven en raakt laag 1 niet aan: het zijn extra doelen voor
 * de eerstvolgende opdracht. "Deze ronde willen we vooral betere nachten." Dat
 * is een keuze van mensen, met een naam eraan en een datum, en hij is net zo
 * makkelijk weer uit te zetten.
 *
 * ## Wat de agent ermee doet
 *
 * Hij leest ze en neemt ze mee in zijn voorstel — zichtbaar, zodat te zien is
 * waarom hij iets voorstelt. Hij kan ze niet zelf aanzetten: dat zou betekenen
 * dat hij zijn eigen opdracht schrijft.
 */

export interface ProjectGoal {
  readonly id: string;
  readonly goal: RebuildGoal;
  readonly label: string;
  readonly note: string | null;
  readonly active: boolean;
  readonly createdAt: Date;
}

export async function projectGoals(locationCode: string, onlyActive = true): Promise<readonly ProjectGoal[]> {
  const rijen = await prisma.projectOptimisationGoal.findMany({
    where: { locationCode, ...(onlyActive ? { active: true } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, goal: true, note: true, active: true, createdAt: true },
  });
  return rijen
    .filter((r) => r.goal in REBUILD_GOAL_LABELS)
    .map((r) => ({
      id: r.id,
      goal: r.goal as RebuildGoal,
      label: REBUILD_GOAL_LABELS[r.goal as RebuildGoal],
      note: r.note,
      active: r.active,
      createdAt: r.createdAt,
    }));
}

/** Een doel aan- of uitzetten. Alleen een mens komt hier langs. */
export async function setProjectGoal(
  actor: Actor,
  locationCode: string,
  goal: RebuildGoal,
  active: boolean,
  note?: string | null,
): Promise<void> {
  if (!(goal in REBUILD_GOAL_LABELS)) throw new Error(`Onbekend doel: ${goal}`);
  await prisma.projectOptimisationGoal.upsert({
    where: { locationCode_goal: { locationCode, goal } },
    create: { locationCode, goal, note: note ?? null, active, createdByUserId: actor.userId },
    update: { active, note: note ?? undefined, deactivatedAt: active ? null : new Date() },
  });
  await recordAudit({
    actor,
    action: active ? "laag2.doel.aangezet" : "laag2.doel.uitgezet",
    objectType: "ProjectOptimisationGoal",
    objectId: `${locationCode}:${goal}`,
    newValue: { goal, label: REBUILD_GOAL_LABELS[goal], note: note ?? null },
  });
}
