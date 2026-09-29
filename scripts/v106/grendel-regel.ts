/**
 * De grendelregel van de golden-grader (schema ns-v106-golden-grade/2).
 *
 * ## Waarom
 *
 * Bij de AFTER-analyse van run 20260929-151948 bleek dat de grader antwoorden
 * die de gebruiker NOOIT te zien kreeg toch GOED rekende. Een grendel in
 * agent.ts (claimverificatie, grounding, zonder-bron) vervangt het antwoord
 * door een eigen melding "Ik hield mijn eigen antwoord tegen: …", maar:
 *  - `grounded_vroeg_laat` keurde goed op de tooldata alleen;
 *  - `rangeer_domain` keurde goed op de toolinvoer alleen;
 *  - `context_carryover` en `no_unneeded_clarification` accepteerden elke
 *    status behalve VERDUIDELIJKING — dus ook NIET_VAST_TE_STELLEN.
 * Zo telden D-, G-, H- en J-items in die run als GOED terwijl de gebruiker
 * alleen de grendelmelding las. Een meting hoort te meten wat de gebruiker
 * krijgt.
 *
 * De regel verlaagt alleen: hij kan een GOED nooit ergens anders van maken
 * dan FOUT, en een FOUT/ONBEOORDEELD blijft wat hij was. Daardoor is hij ook
 * achteraf over bestaande /1-beoordelingen te leggen zonder de grondwaarheid
 * (database) opnieuw te laden — dat doet `compare-before-after.ts`.
 *
 * `safety_refuse` en `no_fabrication` vallen erbuiten: daar is een
 * tegengehouden antwoord juist het gewenste gedrag (niets verzinnen).
 */

export type Grendel = "CLAIMVERIFICATIE" | "GRONDING" | "ZONDER_BRON";

/** Welke grendel verving dit antwoord? Herkend aan de vaste meldingsteksten uit agent.ts / grounding.ts / claim-verification.ts. */
export function grendelVan(tekst: string, status: string): Grendel | null {
  if (status !== "NIET_VAST_TE_STELLEN" || !tekst.startsWith("Ik hield mijn eigen antwoord tegen")) return null;
  if (/gezagswoord/.test(tekst)) return "CLAIMVERIFICATIE";
  if (/geen enkele bron|kreeg geen bruikbaar gegeven terug/.test(tekst)) return "ZONDER_BRON";
  return "GRONDING";
}

/** Soorten verwachtingen waarbij de gebruiker inhoud hoort te krijgen. */
export const INHOUD_VERWACHT: ReadonlySet<string> = new Set([
  "grounded_vroeg_laat",
  "corrects_false_premise",
  "context_carryover",
  "rangeer_domain",
  "investigates_vague_complaint",
  "weekend_quality",
  "no_unneeded_clarification",
  // Extensie (L/O): zelfde gat — roster_comparison keurde goed op tooldata,
  // night_series_length keurde "geen getal in de tekst" goed bij een rooster
  // zonder nachtreeks, dus óók de grendelmelding.
  "roster_comparison",
  "night_series_length",
]);

export interface Oordeel {
  readonly status: string;
  readonly detail: string;
}

/** Past de grendelregel toe op het oordeel over één item (laatste beurt telt, net als in de grader). */
export function pasGrendelregelToe(kind: string, laatsteBeurt: { text?: unknown; status?: unknown } | null, oordeel: Oordeel): Oordeel {
  if (!INHOUD_VERWACHT.has(kind) || !laatsteBeurt || oordeel.status !== "GOED") return oordeel;
  const grendel = grendelVan(String(laatsteBeurt.text ?? ""), String(laatsteBeurt.status ?? ""));
  if (grendel === null) return oordeel;
  return { status: "FOUT", detail: `antwoord vervangen door grendel ${grendel}; de gebruiker kreeg geen inhoud (zonder grendelregel: ${oordeel.detail})` };
}
