/**
 * Een nachtreeks op twee assen: ritme en totale belasting.
 *
 * ## Waarom niet één schaal
 *
 * Machinisten beschrijven de lengte van een nachtreeks niet als "hoe langer,
 * hoe zwaarder" (werkopdracht "machinist preference" §18):
 *
 * - 1 nacht: zeer onprettig;
 * - 2 nachten: alleen als het nodig is;
 * - 3 nachten: vaak net niet lekker — je raakt in het nachtpatroon en moet er
 *   alweer uit;
 * - 4 nachten: prima, maar liever niet steeds;
 * - 5 nachten: goed te doen qua ritme;
 * - 6 nachten: qua ritme vaak nog beter, maar meer totale belasting;
 * - 7 nachten: zeer stabiel ritme, maar als structurele oplossing niet gewenst
 *   door de totale belasting.
 *
 * Eén schaal kan dat niet uitdrukken. Daarom twee: `NIGHT_RHYTHM` stijgt met de
 * lengte en vlakt af; `NIGHT_LOAD` is nul tot en met vijf en stijgt daarna. De
 * waarde van een reeks is ritme min belasting. Zo scoort zes op ritme beter dan
 * drie, en krijgt zeven toch geen voorkeur (§19, §39). Voorkeur van machinisten
 * in roosterontwerp, geen fysiologische uitspraak (§20).
 *
 * De volgorde komt uit de beschrijving hierboven; de afstanden zijn een
 * aanname, uitgedrukt in stappen die de volgorde volgen. Het officiële rooster
 * heeft reeksen van 3, 5, 5 en 6. Zeven is ook het wettelijke maximum van
 * diensten in een reeks met nachten; langer bestaat niet.
 */

export const NIGHT_RHYTHM: Readonly<Record<number, number>> = { 1: 0, 2: 0.35, 3: 0.7, 4: 0.85, 5: 0.95, 6: 1, 7: 1 };
export const NIGHT_LOAD: Readonly<Record<number, number>> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0.05, 7: 0.3 };

const tabel = (t: Readonly<Record<number, number>>, lengte: number) => t[Math.max(1, Math.min(7, Math.round(lengte)))];

export function nightRhythm(length: number): number {
  return tabel(NIGHT_RHYTHM, length);
}

export function nightLoad(length: number): number {
  return tabel(NIGHT_LOAD, length);
}

/** Waarde van een reeks: ritme min belasting, 0–1. */
export function nightBlockWorth(length: number): number {
  return Math.max(0, nightRhythm(length) - nightLoad(length));
}
