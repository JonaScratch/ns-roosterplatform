import { z } from "zod";
import { ReservePreferenceKind } from "@/lib/generated/prisma/enums";

/**
 * Validatie van roostervoorkeuren.
 *
 * ## Waarom voorkeuren gestructureerd zijn en geen vrije tekst
 *
 * Vrije tekst in een voorkeurenveld wordt een dossier. "Liever geen vroege
 * dienst op woensdag i.v.m. behandeling in het ziekenhuis" is een
 * gezondheidsgegeven in een roostersysteem, en het staat er zodra het veld
 * bestaat. Gestructureerde velden kunnen dat niet bevatten, zijn machinaal te
 * verwerken door de optimizer, en zijn te aggregeren zonder privacyrisico.
 *
 * Wat een medewerker wél kwijt moet aan zijn leidinggevende, hoort in het
 * gesprek en niet in dit systeem.
 *
 * ## Alles hier is zacht
 *
 * Geen enkele voorkeur in dit bestand is een harde beperking. Ze worden
 * meegewogen door de `soft_constraints` en de optimalisatiedoelen. De harde
 * grenzen liggen in het roosterprofiel, dat de medewerker niet zelf zet.
 */

/**
 * ## Wat hier bewust níet meer in staat
 *
 * Er stonden voorkeuren in over vrije dagen, aaneengesloten blokken, losse
 * werkdagen en hele weekenden. Die zijn verwijderd, en niet omdat ze technisch
 * lastig waren: ze beloofden invloed die er niet is. Wie in een vast rooster
 * zit, rijdt de regel waarop hij staat — welke dagen hij vrij is, volgt uit dat
 * rooster en niet uit een vinkje. Een voorkeurenscherm dat het tegendeel
 * suggereert, laat iemand denken dat er naar hem geluisterd wordt op een punt
 * waar dat niet kan.
 *
 * Wat er wél toe doet — welke dagdelen iemand wil rijden als hij reserve heeft —
 * staat in `reservePreferenceSchema` en geldt alleen voor wie in een
 * reserverooster zit.
 */
export const rosterPreferencesSchema = z.object({
  /**
   * Bereid om beschikbare diensten op te pakken buiten het eigen rooster.
   *
   * Dit is geen roosterwens maar een beschikbaarheidsverklaring: het bepaalt of
   * iemand openstaande diensten aangeboden krijgt. Het heeft dus wél een
   * gevolg dat de medewerker terugziet.
   */
  openVoorExtraDiensten: z.boolean().default(false),
});

export type RosterPreferences = z.infer<typeof rosterPreferencesSchema>;

export const DEFAULT_PREFERENCES: RosterPreferences = rosterPreferencesSchema.parse({});

/**
 * Leest voorkeuren uit de database.
 *
 * Een opgeslagen waarde die niet meer aan het schema voldoet — bijvoorbeeld na
 * een wijziging van de velden — levert de standaardwaarden op in plaats van een
 * fout. Een medewerker die zijn voorkeurenpagina niet meer kan openen omdat er
 * ooit een veld is hernoemd, is een slechtere uitkomst dan een voorkeur die
 * terugvalt op de standaard.
 */
export function parsePreferences(value: unknown): RosterPreferences {
  const result = rosterPreferencesSchema.safeParse(value ?? {});
  return result.success ? result.data : DEFAULT_PREFERENCES;
}

export const reservePreferenceSchema = z.enum(
  Object.values(ReservePreferenceKind) as [string, ...string[]],
);

export const preferencesFormSchema = rosterPreferencesSchema.extend({
  reservevoorkeur: reservePreferenceSchema,
});

/**
 * De dagdelen waaruit een reservemedewerker kan kiezen.
 *
 * Vier, en niet vijf. "Geen voorkeur" staat er niet bij: dat is de waarde
 * waarmee iemand begint, geen keuze die hij maakt. Hem als optie tonen levert
 * een lijst op waarin de meeste mensen niets invullen, en dan weet de
 * dienstindeling nog steeds niets.
 */
export const RESERVE_PREFERENCE_CHOICES = [
  { value: ReservePreferenceKind.VROEG, label: "Vroeg" },
  { value: ReservePreferenceKind.LAAT, label: "Laat" },
  { value: ReservePreferenceKind.VROEG_LAAT, label: "Vroeg/Laat" },
  { value: ReservePreferenceKind.VROEG_LAAT_NACHT, label: "Vroeg/Laat/Nacht" },
] as const;
