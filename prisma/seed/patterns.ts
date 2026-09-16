import type { RosterProfile } from "../../src/lib/generated/prisma/enums";

/**
 * De roosterpatronen van de voorbeeldbasisroosters.
 *
 * Elk patroon is 28 dagen: vier weken van maandag tot en met zondag. De
 * letters:
 *
 *   V  vroege dienst      L  late dienst        N  nachtdienst
 *   R  rangeerdienst      E  RES-positie        -  rustdag
 *
 * ## Waarom deze patronen er zo uitzien
 *
 * Ze zijn opgebouwd rond de harde regels, niet ernaast. Drie dingen die je in
 * elk patroon terugziet:
 *
 *  1. Nooit een vroege dienst direct na een late. Van 21:30 naar 05:00 de
 *     volgende ochtend is zeven en een half uur — onder de absolute ondergrens.
 *  2. Nooit een late dienst direct na een nacht. Zelfde rekensom, andere kant.
 *  3. De rustdagen schuiven per week op, zodat een lijn niet elk weekend werkt.
 *     Zonder die verschuiving zou dezelfde lijn vier weekenden op rij draaien
 *     en de regel over opeenvolgende weekenden overtreden.
 *
 * Het resultaat is een testomgeving waarin de regels niet overal alarm slaan,
 * en waarin een ruil of een beschikbare dienst dus iets kan betekenen.
 */

export type PatternDay = "V" | "L" | "N" | "R" | "E" | "-";

export interface SeedBaseRoster {
  readonly code: string;
  readonly name: string;
  readonly profile: RosterProfile;
  readonly lines: number;
  /** 28 dagen, beginnend op maandag van week 1. */
  readonly pattern: readonly PatternDay[];
}

function pattern(...weeks: string[]): readonly PatternDay[] {
  const days = weeks.join(" ").split(/\s+/).filter(Boolean) as PatternDay[];
  if (days.length !== 28) {
    throw new Error(`Een roosterpatroon moet 28 dagen tellen, dit telt er ${days.length}.`);
  }
  return days;
}

export const SEED_BASE_ROSTERS: readonly SeedBaseRoster[] = [
  {
    code: "DDR-V",
    name: "Utrecht Vroeg",
    profile: "VROEG",
    lines: 6,
    pattern: pattern(
      "V V V V V - -",
      "- V V V V V -",
      "V V E - - V V",
      "- - V V V V -",
    ),
  },
  {
    code: "DDR-VL",
    name: "Utrecht Vroeg/Laat",
    profile: "VROEG_LAAT",
    lines: 8,
    pattern: pattern(
      "V V E - L L -",
      "V V - L L - -",
      "V V V - - L L",
      "- L L - V V -",
    ),
  },
  {
    code: "DDR-L",
    name: "Utrecht Laat",
    profile: "LAAT",
    lines: 5,
    pattern: pattern(
      "L L L L E - -",
      "- L L L L L -",
      "L L L - - L L",
      "- - L L L L -",
    ),
  },
  {
    code: "DDR-LN",
    name: "Utrecht Laat/Nacht",
    profile: "LAAT_NACHT",
    lines: 5,
    pattern: pattern(
      "L L L - N N -",
      "- L E L - - -",
      "N N N - - L L",
      "- - L L N N -",
    ),
  },
  {
    code: "DDR-MIX",
    name: "Utrecht Mix (Vroeg-Laat-Nacht)",
    profile: "MIX",
    lines: 6,
    pattern: pattern(
      "- V V E V - -",
      "L L L - R R -",
      "N N N - - V V",
      "- - L L - V V",
    ),
  },
];

/** De positie in het rooster die bij een patroonletter hoort. */
export function positionTypeFor(day: PatternDay): "DUTY" | "RES" | "RUST" {
  if (day === "-") {
    return "RUST";
  }
  return day === "E" ? "RES" : "DUTY";
}
