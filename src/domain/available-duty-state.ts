import type { AvailableDutyStatus } from "@/lib/generated/prisma/enums";

/**
 * De toestanden van een vrijgekomen dienst, en wat er tussen mag.
 *
 * ## Waarom dit een tabel is en geen reeks if-statements
 *
 * De overgangen staan verspreid over drie diensten: het reserve-rooster geeft
 * een dienst vrij, de medewerkersdienst neemt belangstelling aan, de
 * dienstindeling wijst toe. Elk van die plekken had zijn eigen `if (status ===
 * ...)`, en drie plekken die hetzelfde denken te controleren, zijn drie plekken
 * die uit elkaar kunnen lopen. De tabel hieronder is de enige waarheid; wie een
 * overgang wil, vraagt het hier.
 *
 * ## De toestanden
 *
 *     RESERVE_PENDING     het reserve-rooster heeft eerst de kans
 *            ↓            (reserve slaagt niet, of slaat over)
 *     OPEN                de inschrijving loopt: geschikte medewerkers kunnen
 *                         belangstelling tonen tot `closesAt`
 *            ↓            (het venster sluit)
 *     ALLOCATION_PENDING  niemand kan zich meer inschrijven; de dienstindeling
 *                         moet nog toewijzen
 *            ↓
 *     ALLOCATED           toegewezen aan een medewerker
 *
 * En de twee eindpunten die geen toewijzing zijn: `CLOSED` (het venster is
 * voorbij en er is niemand toegewezen) en `CANCELLED` (ingetrokken, bijvoorbeeld
 * omdat de oorspronkelijke houder toch rijdt).
 *
 * ## Over de namen
 *
 * De opdracht noemt een toestand `INTEREST_PERIOD`. Die heet hier `OPEN`: het
 * is dezelfde toestand — de dienst staat open én de inschrijving loopt — en er
 * twee namen voor hebben zou betekenen dat er ergens een verschil is dat er niet
 * is. Dat verschil zou vroeg of laat door iemand worden ingevuld.
 *
 * ## Waarom `ALLOCATION_PENDING` er wél apart in staat
 *
 * Zonder die toestand blijft een dienst waarvan het venster gesloten is
 * eeuwig `OPEN`. Hij verdwijnt dan uit de lijst van de medewerker — die filtert
 * op `closesAt` — maar staat bij de dienstindeling nog als openstaand. Twee
 * schermen die iets anders zeggen over dezelfde dienst, en geen van beide is
 * aantoonbaar fout. Nu is het één toestand met één betekenis: het venster is
 * dicht, er moet nog worden toegewezen.
 */

export type AvailableDutyState = AvailableDutyStatus;

/** Vanuit welke toestand welke toestanden bereikbaar zijn. */
const OVERGANGEN: Readonly<Record<AvailableDutyStatus, readonly AvailableDutyStatus[]>> = {
  RESERVE_PENDING: ["OPEN", "ALLOCATED", "CANCELLED"],
  // ALLOCATED vanuit RESERVE_PENDING: het reserve-rooster heeft hem zelf
  // opgevangen. Dat is de bedoelde eerste route en geen omweg.
  OPEN: ["ALLOCATION_PENDING", "ALLOCATED", "CANCELLED"],
  ALLOCATION_PENDING: ["ALLOCATED", "CLOSED", "CANCELLED"],
  ALLOCATED: [],
  CLOSED: [],
  CANCELLED: [],
};

/** De toestanden waarin de dienst nog ergens naartoe kan. */
export const OPEN_STATES: readonly AvailableDutyStatus[] = [
  "RESERVE_PENDING",
  "OPEN",
  "ALLOCATION_PENDING",
];

/** De toestanden waarin niets meer verandert. */
export const FINAL_STATES: readonly AvailableDutyStatus[] = ["ALLOCATED", "CLOSED", "CANCELLED"];

/** Mag een medewerker zich nu inschrijven? Alleen tijdens het venster. */
export function acceptsInterest(state: AvailableDutyStatus): boolean {
  return state === "OPEN";
}

/** Mag de dienstindeling nu toewijzen? */
export function acceptsAllocation(state: AvailableDutyStatus): boolean {
  return state === "OPEN" || state === "ALLOCATION_PENDING";
}

/** Is deze overgang toegestaan? */
export function canTransition(
  from: AvailableDutyStatus,
  to: AvailableDutyStatus,
): boolean {
  return OVERGANGEN[from]?.includes(to) ?? false;
}

/**
 * De overgang, of de reden waarom hij niet mag.
 *
 * De reden is in gewone taal: hij komt in een auditregel en soms op een scherm,
 * en "ongeldige toestandsovergang" vertelt de dienstindeling niet wat er aan de
 * hand is.
 */
export function transitionRefusal(
  from: AvailableDutyStatus,
  to: AvailableDutyStatus,
): string | null {
  if (canTransition(from, to)) {
    return null;
  }
  if (FINAL_STATES.includes(from)) {
    return (
      `Deze dienst is al ${STATE_LABELS[from].toLowerCase()}. Daar valt niets meer aan te ` +
      "veranderen; een nieuwe openstelling is een nieuwe dienst."
    );
  }
  return (
    `Vanuit "${STATE_LABELS[from]}" kan een dienst niet naar "${STATE_LABELS[to]}". ` +
    `Mogelijk vanaf hier: ${OVERGANGEN[from].map((state) => STATE_LABELS[state]).join(", ")}.`
  );
}

export const STATE_LABELS: Readonly<Record<AvailableDutyStatus, string>> = {
  RESERVE_PENDING: "Bij het reserve-rooster",
  OPEN: "Inschrijving open",
  ALLOCATION_PENDING: "Inschrijving gesloten, toewijzing volgt",
  ALLOCATED: "Toegewezen",
  CLOSED: "Gesloten zonder toewijzing",
  CANCELLED: "Ingetrokken",
};

/**
 * In welke toestand hoort deze dienst te staan gezien de klok?
 *
 * Levert null wanneer de klok geen overgang afdwingt. Dit is met opzet een
 * pure functie: de toestand van een dienst mag niet afhangen van wanneer er
 * toevallig een achtergrondtaak heeft gedraaid, maar er moet wel iets zijn dat
 * de overgang uitvoert. Zie `advanceAvailableDuties`.
 */
export function stateByClock(input: {
  readonly state: AvailableDutyStatus;
  readonly closesAt: Date;
  readonly now: Date;
}): AvailableDutyStatus | null {
  if (input.state === "OPEN" && input.now >= input.closesAt) {
    return "ALLOCATION_PENDING";
  }
  return null;
}
