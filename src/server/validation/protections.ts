import { z } from "zod";
import type { Protection } from "@/server/rules-engine/validation/subject";

/**
 * De vorm van `Employee.protections`.
 *
 * ## Waarom dit gevalideerd wordt en niet gecast
 *
 * Het veld is JSON in de database. Een `as Protection[]` zou werken tot iemand
 * er een keer iets anders in zet, en dan rekent de engine met een beperking die
 * hij niet begrijpt — of erger, negeert er stilzwijgend een. Een beperking die
 * verdwijnt omdat een veld anders heet, is precies de fout die niemand ziet
 * gebeuren.
 *
 * ## Waarom er geen reden in staat
 *
 * Er is geen veld voor "waarom". Niet vergeten, maar geweigerd: de grond voor
 * een individuele beperking is vrijwel altijd medisch of privé, en die hoort
 * niet in een planningssysteem. Wat de engine moet weten is wát er niet mag.
 */

const minuteOfDay = z.number().int().min(0).max(1440);

const schedulingRestriction = z.object({
  type: z.literal("SCHEDULING_RESTRICTION"),
  earliestStartMinute: minuteOfDay.optional(),
  latestEndMinute: minuteOfDay.optional(),
  maxConsecutiveServices: z.number().int().min(1).max(14).optional(),
  overtimeAllowed: z.boolean().optional(),
});

const dated = (type: string) =>
  z.object({
    type: z.literal(type),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Verwacht een datum als JJJJ-MM-DD."),
  });

export const protectionSchema = z.union([
  schedulingRestriction,
  z.object({ type: z.literal("HARD_NIGHT_EXEMPTION") }),
  z.object({ type: z.literal("VERY_EARLY_START_EXEMPTION") }),
  dated("RED_WEEKEND_WAIVER"),
  dated("DST_CONSENT"),
]);

export const protectionsSchema = z.array(protectionSchema);

/**
 * Leest het opgeslagen veld.
 *
 * Een onleesbare waarde levert een lege lijst op én een melding. Stil een lege
 * lijst teruggeven zou een vastgelegde bescherming laten verdwijnen; een
 * uitzondering gooien zou het hele rooster onbereikbaar maken omdat één
 * medewerker een corrupt veld heeft. De melding is het signaal dat er iets te
 * repareren valt.
 */
export function parseProtections(value: unknown, employeeNumber: string): readonly Protection[] {
  if (value === null || value === undefined) {
    return [];
  }
  const parsed = protectionsSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data as readonly Protection[];
  }
  console.error(
    `Beschermingsconstraints van medewerker ${employeeNumber} zijn niet leesbaar en ` +
      "worden genegeerd. Dit moet worden hersteld.",
    parsed.error.issues,
  );
  return [];
}
