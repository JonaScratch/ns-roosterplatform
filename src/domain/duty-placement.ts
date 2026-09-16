import type { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
import { allowedKindsForProfile, profileAllowsDuty, rosterProfileLabel } from "./roster-profiles";

/**
 * Waar elke dienst uit het pakket terechtkomt.
 *
 * ## Waarom dit een eigen begrip is
 *
 * Na het genereren van een rooster is de vraag niet alleen "klopt het rooster",
 * maar ook "waar is dienst 118 gebleven". Zonder antwoord daarop is een
 * dienstenpakket van 218 diensten en een rooster met 190 plaatsingen een
 * raadsel van 28 diensten: zitten ze in de reservevoorraad, zijn ze niet te
 * plaatsen, of is er iets weggevallen? Dat verschil is precies wat een planner
 * moet weten.
 *
 * ## Vier uitkomsten, geen restcategorie
 *
 *  - `IN_FIXED_ROSTER`   staat in een vaste roosterlijn.
 *  - `IN_RESERVE_STOCK`  niet vast ingeroosterd, maar wel te dekken door de
 *                        dienstindeling vanuit de reservevoorraad.
 *  - `NOT_PLACEABLE`     nergens kwijt te krijgen, met de reden erbij.
 *  - `EXCLUDED`          hoort hier niet thuis en dat is bekend.
 *
 * Er is met opzet geen "overig". Een dienst die nergens in past, moet een
 * uitleg krijgen; een categorie zonder uitleg is een plek waar problemen
 * verdwijnen.
 */

export type PlacementCategory =
  | "IN_FIXED_ROSTER"
  | "IN_RESERVE_STOCK"
  | "NOT_PLACEABLE"
  | "EXCLUDED";

export const PLACEMENT_LABELS: Record<PlacementCategory, string> = {
  IN_FIXED_ROSTER: "In een vast rooster",
  IN_RESERVE_STOCK: "In de reservevoorraad van de dienstindeling",
  NOT_PLACEABLE: "Niet te plaatsen",
  EXCLUDED: "Uitgesloten",
};

export interface PlaceableDuty {
  readonly code: string;
  /** 1 = maandag tot en met 7 = zondag; samen met de code de identiteit. */
  readonly weekday: number;
  readonly kinds: readonly DutyKind[];
  readonly requiredQualifications: readonly string[];
  readonly depot: string;
}

export interface PlacementInput {
  readonly locationCode: string;
  readonly duties: readonly PlaceableDuty[];
/**
   * De diensten die in de vaste roosterlijnen staan, als `nummer|weekdag`.
   *
   * Op alleen het nummer zou dienst 101 van zondag als geplaatst gelden zodra
   * 101 van maandag ergens in een lijn staat — terwijl de zondagdienst dan
   * nergens gereden wordt en niemand dat merkt.
   */
  readonly inFixedRosters: ReadonlySet<string>;
  /** De profielen die er op deze standplaats zijn. */
  readonly profiles: readonly RosterProfile[];
  /** Hoeveel reservedagen er per week beschikbaar zijn. Nul betekent geen reserve. */
  readonly reserveSlotsPerWeek: number;
  /** De bevoegdheden die op deze standplaats daadwerkelijk aanwezig zijn. */
  readonly availableQualifications: ReadonlySet<string>;
}

export interface DutyPlacement {
  readonly code: string;
  readonly weekday: number;
  readonly category: PlacementCategory;
  /** Waarom deze dienst hier staat. Altijd gevuld; ook bij een geslaagde plaatsing. */
  readonly explanation: readonly string[];
}

export interface PlacementSummary {
  readonly placements: readonly DutyPlacement[];
  readonly counts: Record<PlacementCategory, number>;
  /** Diensten die nergens terecht kunnen. De lijst waar het om gaat. */
  readonly notPlaceable: readonly DutyPlacement[];
}

export function categoriseDuties(input: PlacementInput): PlacementSummary {
  const placements = input.duties.map((duty) => categorise(duty, input));
  const counts: Record<PlacementCategory, number> = {
    IN_FIXED_ROSTER: 0,
    IN_RESERVE_STOCK: 0,
    NOT_PLACEABLE: 0,
    EXCLUDED: 0,
  };
  for (const placement of placements) {
    counts[placement.category] += 1;
  }
  return {
    placements,
    counts,
    notPlaceable: placements.filter((placement) => placement.category === "NOT_PLACEABLE"),
  };
}

function categorise(duty: PlaceableDuty, input: PlacementInput): DutyPlacement {
  if (duty.depot !== input.locationCode) {
    return {
      code: duty.code,
      weekday: duty.weekday,
      category: "EXCLUDED",
      explanation: [
        `Hoort bij standplaats ${duty.depot} en niet bij ${input.locationCode}.`,
      ],
    };
  }

  if (input.inFixedRosters.has(`${duty.code}|${duty.weekday}`)) {
    return {
      code: duty.code,
      weekday: duty.weekday,
      category: "IN_FIXED_ROSTER",
      explanation: ["Staat in een vaste roosterlijn."],
    };
  }

  const redenen: string[] = [];

  const passendeProfielen = input.profiles.filter((profile) =>
    profileAllowsDuty(profile, duty.kinds),
  );
  if (passendeProfielen.length === 0) {
    redenen.push(
      "Geen enkel roosterprofiel op deze standplaats staat deze dagdelen toe " +
        `(${duty.kinds.join(", ")}). Beschikbaar: ` +
        input.profiles
          .map(
            (profile) =>
              `${rosterProfileLabel(profile)} (${allowedKindsForProfile(profile).join("/")})`,
          )
          .join(", ") +
        ".",
    );
  }

  const ontbrekend = duty.requiredQualifications.filter(
    (qualification) => !input.availableQualifications.has(qualification),
  );
  if (ontbrekend.length > 0) {
    redenen.push(
      `Vereiste bevoegdheid ${ontbrekend.join(", ")} komt bij geen enkele medewerker ` +
        "van deze standplaats voor.",
    );
  }

  if (redenen.length > 0) {
    return {
      code: duty.code,
      weekday: duty.weekday,
      category: "NOT_PLACEABLE",
      explanation: redenen,
    };
  }

  if (input.reserveSlotsPerWeek <= 0) {
    return {
      code: duty.code,
      weekday: duty.weekday,
      category: "NOT_PLACEABLE",
      explanation: [
        "Staat niet in een vaste roosterlijn en er is geen reservevoorraad om hem " +
          "operationeel uit te dekken.",
      ],
    };
  }

  return {
    code: duty.code,
    weekday: duty.weekday,
    category: "IN_RESERVE_STOCK",
    explanation: [
      "Staat niet vast ingeroosterd; de dienstindeling kan hem vanuit de " +
        `reservevoorraad invullen (${input.reserveSlotsPerWeek} reservedagen per week).`,
    ],
  };
}
