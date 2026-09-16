/**
 * Roulatielijsten voor beschikbare diensten.
 *
 * Per weekdag bestaat een aparte lijst. Een medewerker kan dus maandag op
 * positie 1 staan, woensdag op 12 en vrijdag op 60 — dat zijn drie los van
 * elkaar roterende lijsten.
 *
 * ## Waarom een offset en geen herschikking
 *
 * De volgorde had elke week herschreven kunnen worden. Dan is achteraf echter
 * niet meer te reconstrueren welke volgorde in week X gold, en dat is precies
 * wat een medewerker die een dienst misliep wil kunnen navragen. In plaats
 * daarvan ligt de basisvolgorde vast en verschuift alleen een teller. De
 * positie van iedereen in elke willekeurige week is dan uit te rekenen, ook
 * jaren later.
 *
 *     positie = ((baseIndex + offset) mod aantal) + 1
 *
 * Elke week gaat de offset een omhoog: wie vorige week eerste stond, staat deze
 * week laatste, en iedereen schuift een plaats op.
 */

/** Een deelnemer aan een roulatielijst. Bewust alleen het personeelsnummer. */
export interface RotationParticipant {
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly baseIndex: number;
}

export interface RotationPlacement extends RotationParticipant {
  /** Positie 1 is bovenaan en heeft voorrang. */
  readonly position: number;
}

/**
 * De volgorde van de lijst bij een gegeven offset.
 *
 * De uitkomst is gesorteerd op positie, zodat een aanroeper de lijst zonder
 * nadenken van boven naar beneden kan aflopen.
 */
export function placementsForOffset(
  participants: readonly RotationParticipant[],
  offset: number,
): readonly RotationPlacement[] {
  const count = participants.length;
  if (count === 0) {
    return [];
  }
  // Modulo in JavaScript kan negatief worden; een negatieve offset (een
  // teruggedraaide rotatie) mag geen negatieve positie opleveren.
  const normalisedOffset = ((offset % count) + count) % count;

  return participants
    .map((participant) => ({
      ...participant,
      position: ((participant.baseIndex + normalisedOffset) % count) + 1,
    }))
    .sort((a, b) => a.position - b.position);
}

/** De positie van een enkele medewerker, zonder de hele lijst op te bouwen. */
export function positionOf(
  baseIndex: number,
  offset: number,
  participantCount: number,
): number {
  if (participantCount <= 0) {
    throw new Error("Een roulatielijst zonder deelnemers heeft geen posities.");
  }
  const normalisedOffset = ((offset % participantCount) + participantCount) % participantCount;
  return ((baseIndex + normalisedOffset) % participantCount) + 1;
}

/**
 * Kiest uit de belangstellenden degene die de dienst krijgt.
 *
 * De regel is eenvoudig en daarmee uitlegbaar: van de medewerkers die zowel
 * belangstelling hebben getoond als roostertechnisch geldig zijn bevonden,
 * wint de hoogst geplaatste op de lijst van díe weekdag.
 *
 * De geschiktheidstoets zit hier niet in. Die hoort in de rules engine; deze
 * functie krijgt de al gefilterde verzameling en doet alleen de ordening.
 */
export function selectWinner(
  placements: readonly RotationPlacement[],
  eligibleEmployeeIds: ReadonlySet<string>,
): RotationPlacement | null {
  for (const placement of placements) {
    if (eligibleEmployeeIds.has(placement.employeeId)) {
      return placement;
    }
  }
  return null;
}

/**
 * De momentopname die bij een toewijzing wordt vastgelegd.
 *
 * Zonder deze is de procedure niet controleerbaar: de offset schuift door en
 * de deelnemerslijst verandert, dus de volgorde van toen is later niet meer af
 * te leiden uit de huidige stand alleen.
 */
export interface RotationSnapshot {
  readonly weekday: number;
  readonly offset: number;
  readonly participantCount: number;
  readonly ranking: readonly {
    readonly position: number;
    readonly employeeNumber: string;
    readonly interested: boolean;
    readonly eligible: boolean;
  }[];
}

export function buildSnapshot(
  weekday: number,
  offset: number,
  placements: readonly RotationPlacement[],
  interestedEmployeeIds: ReadonlySet<string>,
  eligibleEmployeeIds: ReadonlySet<string>,
): RotationSnapshot {
  return {
    weekday,
    offset,
    participantCount: placements.length,
    ranking: placements.map((placement) => ({
      position: placement.position,
      employeeNumber: placement.employeeNumber,
      interested: interestedEmployeeIds.has(placement.employeeId),
      eligible: eligibleEmployeeIds.has(placement.employeeId),
    })),
  };
}
