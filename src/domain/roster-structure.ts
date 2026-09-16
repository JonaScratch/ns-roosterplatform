import type { RosterPositionType } from "@/lib/generated/prisma/enums";

/**
 * De structurele ankers van een basisrooster.
 *
 * ## Wat een anker is
 *
 * De dagen die niet over het werk gaan maar over het ritme: rust, de vrije dag,
 * de compensatiedag, de reservedag. Ze zijn met de ondernemingsraad afgestemd en
 * ze staan vast zodra een jaarrooster is vastgesteld. Dienstnummers mogen bij
 * een wijzigingsblad opnieuw worden ingevuld — een woensdag die rust was, blijft
 * rust.
 *
 * ## Waarom dat niet vanzelf spreekt
 *
 * Een wijzigingsblad dat één rustdag naar dinsdag verplaatst omdat dat beter
 * uitkomt, ziet er in de interface uit als een kleine verschuiving. Voor de
 * machinist is het iets anders: zijn vrije dag is verzet buiten de ronde waarin
 * dat hoort te gebeuren. Dat is precies het soort wijziging dat zich per stuk
 * laat verdedigen en over een jaar het hele rooster heeft omgebouwd.
 *
 * ## WTV
 *
 * De opdracht noemt WTV als apart ankertype. In het huidige datamodel wordt de
 * WTV-dag gedragen door de positie `WR`; er is geen aparte `WTV`-waarde. Dat is
 * een naamgevingsvraag aan NS en geen reden om hier een nieuw positietype te
 * verzinnen: het anker is er, alleen de naam is dubbel bezet.
 */
export const STRUCTURAL_ANCHORS: readonly RosterPositionType[] = ["RUST", "RES", "WR", "CO"];

export function isStructuralAnchor(slotType: RosterPositionType | string): boolean {
  return (STRUCTURAL_ANCHORS as readonly string[]).includes(slotType);
}

/** De positietypen die de basisgeneratie van een reserverooster mag bevatten. */
export const RESERVE_BASE_POSITIONS: readonly RosterPositionType[] = [
  "RES",
  "RUST",
  "WR",
  "CO",
];

export function isAllowedInReserveBase(slotType: RosterPositionType | string): boolean {
  return (RESERVE_BASE_POSITIONS as readonly string[]).includes(slotType);
}

/** Wat voor roosterronde dit is. */
export type RosterChangeType = "NEW_TIMETABLE" | "AMENDMENT";

/** Eén dag uit de bevroren structurele baseline. */
export interface BaselineSlot {
  readonly baseRosterCode: string;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly slotType: RosterPositionType;
  readonly structuralAnchor: boolean;
  readonly dutyCode: string | null;
}

export const ANCHOR_LABELS: Readonly<Record<string, string>> = {
  RUST: "rustdag",
  RES: "reservedag",
  WR: "WTV-/vrije dag",
  CO: "compensatiedag",
  DUTY: "dienst",
  VERLOF: "verlof",
  OPLEIDING: "opleiding",
};

export function anchorLabel(slotType: string): string {
  return ANCHOR_LABELS[slotType] ?? slotType;
}

// ── De vergelijking ──────────────────────────────────────────────────────────

/** Het voorgestelde slot. `DUTY` betekent: hier komt een dienstnummer. */
export type ProposedSlot =
  | { readonly kind: "DUTY"; readonly dutyCode: string }
  | { readonly kind: "POSITION"; readonly slotType: RosterPositionType };

export type StructuralAssessment =
  /** Geen structurele bezwaren. Zegt niets over de overige regels. */
  | { readonly verdict: "NO_STRUCTURAL_OBJECTION" }
  /** Een wijzigingsblad zonder vastgelegde baseline is niet te beoordelen. */
  | { readonly verdict: "BASELINE_MISSING" }
  | {
      readonly verdict: "ANCHOR_LOCKED";
      readonly from: RosterPositionType;
      readonly to: string;
    };

/**
 * Verschuift dit voorstel een structureel anker?
 *
 * Eén implementatie voor alle routes. Een dienstplaatsing komt hier via de
 * validator binnen, een slotwijziging via `evaluateStructuralChange`; zou elk
 * van beide zijn eigen vergelijking doen, dan is de kans groot dat er één is die
 * net iets anders beslist — en dat is precies de soort afwijking die niemand
 * ziet tot er een rustdag verdwenen is.
 *
 * Wat hier bewust **niet** in zit: een uitzonderingsparameter. Er is geen
 * aanroep waarmee je deze uitkomst kunt afkopen.
 */
export function assessStructuralChange(input: {
  readonly changeType: RosterChangeType;
  readonly baseline: BaselineSlot | null;
  readonly proposed: ProposedSlot;
}): StructuralAssessment {
  if (input.changeType === "NEW_TIMETABLE") {
    // De ronde waarin de structuur juist opnieuw wordt vastgesteld.
    return { verdict: "NO_STRUCTURAL_OBJECTION" };
  }
  if (!input.baseline) {
    return { verdict: "BASELINE_MISSING" };
  }
  if (!input.baseline.structuralAnchor) {
    // Een dienstdag blijft een dienstdag: het nummer mag wijzigen. Zou hier een
    // anker van worden gemaakt, dan verdwijnt er geen vrije dag maar komt er
    // een bij; dat is een capaciteitsvraag voor de overige regels, geen
    // aantasting van het afgesproken ritme.
    return { verdict: "NO_STRUCTURAL_OBJECTION" };
  }

  const to = input.proposed.kind === "DUTY" ? "DUTY" : input.proposed.slotType;
  if (to === input.baseline.slotType) {
    return { verdict: "NO_STRUCTURAL_OBJECTION" };
  }
  return { verdict: "ANCHOR_LOCKED", from: input.baseline.slotType, to };
}

/** De omschrijving van een geweigerde ankerwijziging, voor mens en logboek. */
export function anchorLockedMessage(from: string, to: string): string {
  return (
    `In het vastgestelde jaarrooster staat hier een ${anchorLabel(from)}. Een ` +
    `wijzigingsblad mag daar geen ${anchorLabel(to)} van maken. Dienstnummers ` +
    "opnieuw invullen mag; een structureel anker verplaatsen kan alleen in een " +
    "nieuwe dienstregelingronde."
  );
}
