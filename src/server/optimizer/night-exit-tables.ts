import {
  HUMAN_ADJACENT_TRANSITION_PENALTY,
  HUMAN_OVER_ONE_OFF_DAY_PENALTY,
  OVER_TWO_OFF_DAYS_PENALTY,
  type TransitionCategory,
} from "@/domain/roster-quality-config";

type Tabel = Readonly<Record<TransitionCategory, Readonly<Record<TransitionCategory, number>>>>;

/**
 * De menselijke overgangstabellen met de nachtrij geschaald.
 *
 * ## Waarom alleen de nachtrij
 *
 * Wat er na een nachtdienst komt, direct, over één of over twee vrije dagen,
 * bepaalt het herstel na een nachtreeks. De solver beslist waar een reeks ligt,
 * en daarmee hoeveel vrije dagen erop volgen; het bijschaven kan een reeks
 * achteraf niet verplaatsen. Met schaal 1 kost "nacht, vrij, laat" (32 uur) de
 * solver evenveel als acht seconden per week urenbalans in één rooster
 * (`docs/v1.0.4-final-brain/objective-exchange-rates.md`).
 *
 * ## Waarom de hele rij, met één factor
 *
 * De rij is strikt dalend met de rust en vroeg is steeds duurder dan laat bij
 * evenveel vrije dagen (H05). Eén factor over de hele rij laat die volgorde
 * heel; alleen de afzonderlijke vakjes ophogen kan hem breken, en een tabel
 * waarin minder rust goedkoper is, vindt de solver (H04).
 */
export function humanNightExitTables(scale: number): { adjacent: Tabel; overOffDay: Tabel; overTwoOffDays: Tabel } {
  if (!Number.isFinite(scale) || scale < 1) {
    throw new Error(`Schaal van de nachtrij moet minstens 1 zijn, niet ${scale}.`);
  }
  const rij = (tabel: Tabel): Tabel => ({
    ...tabel,
    NIGHT: Object.fromEntries(
      Object.entries(tabel.NIGHT).map(([naar, punten]) => [naar, Math.round(punten * scale)]),
    ) as Record<TransitionCategory, number>,
  });
  return {
    adjacent: rij(HUMAN_ADJACENT_TRANSITION_PENALTY),
    overOffDay: rij(HUMAN_OVER_ONE_OFF_DAY_PENALTY),
    overTwoOffDays: rij(OVER_TWO_OFF_DAYS_PENALTY),
  };
}
