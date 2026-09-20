import type { QualityDuty } from "./roster-quality";

/**
 * Wat voor dienst dit is, op de klok — niet op het nummer.
 *
 * ## Waarom klassen binnen een dagdeel
 *
 * "Vroeg" is niet voor elk profiel even aantrekkelijk, en twee vroege diensten
 * zijn niet hetzelfde: wie bewust in Vroeg zit, wil juist de echt vroege
 * diensten (vroeg begonnen, vroeg klaar); Vroeg/Laat liever vanaf half zes.
 * "Laat" evenmin: Laat wil de echte aflopers, niet de late diensten die al
 * vroeg beginnen en vroeg eindigen (werkopdracht "machinist preference").
 *
 * ## Waar de grenzen vandaan komen
 *
 * Uit de werkelijke tijden van het Dordrechtse pakket, met de voorkeur van
 * machinisten als anker. Een dienstnummer is geen identiteit: dienst 115 begint
 * op donderdag om 09:47 en op dinsdag om 17:19. Alles hier gaat per dienst en
 * weekdag op begin- en eindtijd.
 *
 * - Extreem vroeg: begint vóór 05:30. Machinisten noemen "vanaf ongeveer 05:30"
 *   de gematigd vroege band; in het pakket begint daar een duidelijke cluster
 *   (17 diensten tussen 05:30 en 06:00, 26 ervoor vanaf 04:23).
 * - Daglijk vroeg: een vroege dienst die pas vanaf 09:00 begint (7 van de 80;
 *   het overlapgebied van 50+ Mix).
 * - Vroege late: een late dienst die vóór 21:00 eindigt (25 van de 92, het
 *   onderste derde van de eindtijden).
 * - Echte afloper: een late dienst die na middernacht eindigt (31 van de 92;
 *   101, 102 en 103 eindigen tussen 00:24 en 01:42). Na middernacht werkt hij
 *   bovendien in het nachtvenster 00:00–06:00 van de CAO.
 */

export type DutyClass = "EXTREME_EARLY" | "EARLY" | "DAYLIKE_EARLY" | "EARLY_LATE" | "LATE" | "PREMIUM_LATE" | "NIGHT" | "OTHER";

export const DUTY_CLASS_BOUNDS = {
  /** Begin vóór deze minuut: extreem vroeg. */
  extremeEarlyBefore: 5 * 60 + 30,
  /** Begin vanaf deze minuut: daglijk vroeg. */
  daylikeEarlyFrom: 9 * 60,
  /** Einde vóór deze minuut (van de dienstdag): vroege late. */
  earlyLateEndBefore: 21 * 60,
  /** Einde na deze minuut: echte afloper. */
  premiumLateEndAfter: 24 * 60,
} as const;

export const DUTY_CLASS_LABELS: Readonly<Record<DutyClass, string>> = {
  EXTREME_EARLY: "extreem vroeg",
  EARLY: "gematigd vroeg",
  DAYLIKE_EARLY: "daglijk vroeg",
  EARLY_LATE: "vroege late",
  LATE: "late",
  PREMIUM_LATE: "echte afloper",
  NIGHT: "nacht",
  OTHER: "overig",
};

export function dutyClass(duty: Pick<QualityDuty, "startMinute" | "endMinute" | "kinds">): DutyClass {
  const soort = duty.kinds.includes("NACHT") ? "N" : duty.kinds.includes("LAAT") ? "L" : duty.kinds.includes("VROEG") ? "E" : null;
  if (soort === "N") return "NIGHT";
  if (soort === "E") {
    if (duty.startMinute < DUTY_CLASS_BOUNDS.extremeEarlyBefore) return "EXTREME_EARLY";
    if (duty.startMinute >= DUTY_CLASS_BOUNDS.daylikeEarlyFrom) return "DAYLIKE_EARLY";
    return "EARLY";
  }
  if (soort === "L") {
    if (duty.endMinute > DUTY_CLASS_BOUNDS.premiumLateEndAfter) return "PREMIUM_LATE";
    if (duty.endMinute < DUTY_CLASS_BOUNDS.earlyLateEndBefore) return "EARLY_LATE";
    return "LATE";
  }
  return "OTHER";
}

/** Minuten in het CAO-nachtvenster 00:00–06:00, over beide kalenderdagen. */
export function nightWindowExposure(duty: Pick<QualityDuty, "startMinute" | "endMinute">): number {
  const overlap = (a: number, b: number) => Math.max(0, Math.min(duty.endMinute, b) - Math.max(duty.startMinute, a));
  return overlap(0, 360) + overlap(1440, 1800);
}
