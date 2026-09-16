import { DutyKind, ReservePreferenceKind, RosterProfile } from "@/lib/generated/prisma/enums";

/**
 * Roosterprofielen en reservevoorkeuren.
 *
 * Het onderscheid dat dit bestand bewaakt:
 *
 *   - Een **roosterprofiel** is een harde grens. Een medewerker in het profiel
 *     Vroeg rijdt geen late dienst, punt. Overtreding is een `hard_constraint`.
 *   - Een **reservevoorkeur** is een wens. Het systeem probeert eraan te
 *     voldoen, maar mag haar overrulen. Overtreding is een `soft_constraint`.
 *
 * Beide staan hier naast elkaar zodat de asymmetrie zichtbaar is en niemand
 * per ongeluk een voorkeur als filter gebruikt.
 */

/**
 * De dagdeelsoorten die een profiel toestaat.
 *
 * Voor 50+ Mix en BLM staat hier hetzelfde als voor Mix. Dat is geen aanname
 * dat ze gelijk zijn: wat die profielen extra beperken is niet aangeleverd, en
 * een verzonnen engere grens is even fout als een te ruime. De begrenzing komt
 * hier dus niet vandaan maar van MIX_PROFILE_SPECIAL_RULES, die zolang de
 * regels ontbreken elke plaatsing in deze profielen onbeoordeelbaar houdt.
 *
 * Reserve staat alle dagdelen toe. Een reservemedewerker wordt operationeel
 * ingevuld en zijn reservevoorkeur is uitdrukkelijk een wens, geen filter; die
 * voorkeur hoort de invulling te sturen, niet te bepalen wat mag.
 */
const PROFILE_ALLOWED_KINDS: Record<RosterProfile, readonly DutyKind[]> = {
  VROEG: [DutyKind.VROEG],
  VROEG_LAAT: [DutyKind.VROEG, DutyKind.LAAT],
  LAAT: [DutyKind.LAAT],
  LAAT_NACHT: [DutyKind.LAAT, DutyKind.NACHT],
  MIX: [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT],
  MIX_50PLUS: [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT],
  BLM: [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT],
  RESERVE: [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT],
};

/** De profielen waarvoor de bijzondere regels nog niet zijn aangeleverd. */
export const PROFILES_WITH_PENDING_RULES: readonly RosterProfile[] = [
  RosterProfile.MIX,
  RosterProfile.MIX_50PLUS,
  RosterProfile.BLM,
];

export function hasPendingProfileRules(profile: RosterProfile): boolean {
  return PROFILES_WITH_PENDING_RULES.includes(profile);
}

const PROFILE_LABELS: Record<RosterProfile, string> = {
  VROEG: "Vroeg",
  VROEG_LAAT: "Vroeg/Laat",
  LAAT: "Laat",
  LAAT_NACHT: "Laat/Nacht",
  MIX: "Mix (Vroeg-Laat-Nacht)",
  MIX_50PLUS: "50+ Mix",
  BLM: "BLM",
  RESERVE: "Reserve",
};

export function rosterProfileLabel(profile: RosterProfile): string {
  return PROFILE_LABELS[profile];
}

export function allowedKindsForProfile(profile: RosterProfile): readonly DutyKind[] {
  return PROFILE_ALLOWED_KINDS[profile];
}

/**
 * Mag een medewerker met dit profiel deze dienst rijden?
 *
 * Alleen de dagdeelsoorten tellen. Reserve (600) en rangeer (700) zijn geen
 * dagdeel en worden door het profiel niet uitgesloten — een rangeerdienst zit in
 * elk profiel. Voor 760/761 gebeurt precies wat de bedoeling is: die dienst is
 * ook NACHT, dus een profiel zonder nacht wijst haar af.
 */
export function profileAllowsDuty(
  profile: RosterProfile,
  dutyKinds: readonly DutyKind[],
): boolean {
  const allowed = PROFILE_ALLOWED_KINDS[profile];
  const timeOfDay: readonly DutyKind[] = [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT];
  const relevant = dutyKinds.filter((kind) => timeOfDay.includes(kind));

  // Een dienst zonder dagdeel (zuiver rangeer of zuiver reserve) is voor elk
  // profiel toegestaan; het profiel zegt niets over dat soort werk.
  if (relevant.length === 0) {
    return true;
  }
  return relevant.every((kind) => allowed.includes(kind));
}

/** Welke dagdeelsoorten een profiel juist uitsluit — voor uitleg in de interface. */
export function forbiddenKindsForProfile(profile: RosterProfile): readonly DutyKind[] {
  const timeOfDay: readonly DutyKind[] = [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT];
  const allowed = PROFILE_ALLOWED_KINDS[profile];
  return timeOfDay.filter((kind) => !allowed.includes(kind));
}

// ── Reservevoorkeuren ────────────────────────────────────────────────────────

const PREFERENCE_KINDS: Record<ReservePreferenceKind, readonly DutyKind[]> = {
  VROEG: [DutyKind.VROEG],
  LAAT: [DutyKind.LAAT],
  VROEG_LAAT: [DutyKind.VROEG, DutyKind.LAAT],
  VROEG_LAAT_NACHT: [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT],
  GEEN_VOORKEUR: [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT],
};

const PREFERENCE_LABELS: Record<ReservePreferenceKind, string> = {
  VROEG: "Voorkeur vroeg",
  LAAT: "Voorkeur laat",
  VROEG_LAAT: "Voorkeur vroeg/laat",
  VROEG_LAAT_NACHT: "Voorkeur vroeg/laat/nacht",
  GEEN_VOORKEUR: "Geen voorkeur",
};

export function reservePreferenceLabel(preference: ReservePreferenceKind): string {
  return PREFERENCE_LABELS[preference];
}

/**
 * Sluit de dienst aan bij de reservevoorkeur?
 *
 * Uitdrukkelijk geen filter. De uitkomst is invoer voor een `soft_constraint`
 * die de invulling stuurt; hij mag nooit bepalen of iets is toegestaan.
 * De naamgeving houdt dat vast: `matches`, niet `allows`.
 */
export function preferenceMatches(
  preference: ReservePreferenceKind,
  dutyKinds: readonly DutyKind[],
): boolean {
  const wanted = PREFERENCE_KINDS[preference];
  const timeOfDay: readonly DutyKind[] = [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT];
  const relevant = dutyKinds.filter((kind) => timeOfDay.includes(kind));
  if (relevant.length === 0) {
    return true;
  }
  return relevant.every((kind) => wanted.includes(kind));
}

/**
 * Hoe goed de dienst bij de voorkeur past, op een schaal van 0 tot 1.
 *
 * Wordt gebruikt om kandidaten te ordenen, niet om ze uit te sluiten.
 */
export function preferenceFit(
  preference: ReservePreferenceKind,
  dutyKinds: readonly DutyKind[],
): number {
  if (preference === ReservePreferenceKind.GEEN_VOORKEUR) {
    return 1;
  }
  const wanted = PREFERENCE_KINDS[preference];
  const timeOfDay: readonly DutyKind[] = [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT];
  const relevant = dutyKinds.filter((kind) => timeOfDay.includes(kind));
  if (relevant.length === 0) {
    return 1;
  }
  const hits = relevant.filter((kind) => wanted.includes(kind)).length;
  return hits / relevant.length;
}
