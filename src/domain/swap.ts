import type { CalendarDate } from "./time";

/**
 * Wat er precies verandert wanneer twee medewerkers van dienst ruilen.
 *
 * ## Waarom dit een aparte, pure functie is
 *
 * De eerste versie wisselde simpelweg de dienst tussen de twee betrokken
 * roosterrijen. Dat klopt zolang beide diensten op dezelfde dag vallen, en het
 * klopt niet zodra ze op verschillende dagen vallen — dan blijft iedereen
 * gewoon zijn eigen dag werken en is er niets geruild. In de doorloop was dat
 * te zien: na een "geslaagde" ruil van 9 september tegen 21 september werkten
 * beide medewerkers nog steeds precies hun eigen dagen.
 *
 * De les was niet dat er een `if` bij moest, maar dat de vraag "welke rijen
 * veranderen en waarin" op zichzelf staat en apart getoetst hoort te worden.
 * Vandaar deze functie: geen database, geen Prisma, alleen de redenering.
 *
 * ## De redenering
 *
 * A biedt zijn dienst op dag X aan en krijgt de dienst van B op dag Y terug.
 * Na de ruil geldt:
 *
 *   - A werkt niet meer op dag X en werkt de dienst van B op dag Y;
 *   - B werkt niet meer op dag Y en werkt de dienst van A op dag X.
 *
 * Dat A op dag Y vrij was — en B op dag X — is geen aanname: de harde regel
 * `hard.dag-beschikbaar` heeft dat al afgedwongen voordat het voorstel mocht
 * ontstaan. Een dag die al bezet is met een ándere dienst blokkeert de ruil.
 *
 * Vallen X en Y op dezelfde dag, dan vallen de vier wijzigingen samen tot twee:
 * de twee medewerkers wisselen die dag van dienst. Dat is de klassieke ruil, en
 * hij komt hier uit dezelfde redenering rollen in plaats van uit een apart geval.
 */

export interface SwapParty {
  readonly employeeId: string;
  /** De dag die deze medewerker weggeeft. */
  readonly date: CalendarDate;
  /** De dienst die deze medewerker weggeeft. */
  readonly dutyId: string;
  /** De roosterrij van die dag, wanneer die al bestaat. */
  readonly scheduledDutyId: string;
}

/** Eén wijziging aan het rooster van één medewerker op één dag. */
export interface SwapMutation {
  readonly employeeId: string;
  readonly date: CalendarDate;
  /** De dienst die er komt te staan, of null wanneer de dag vrijkomt. */
  readonly dutyId: string | null;
  readonly positionType: "DUTY" | "RUST";
}

/**
 * De wijzigingen die samen de ruil uitvoeren.
 *
 * Altijd volledig: de aanroeper voert ze in één transactie uit, of geen enkele.
 * Een half uitgevoerde ruil laat één medewerker met een dienst zitten die de
 * ander denkt te hebben afgestaan.
 */
export function planSwap(
  initiator: SwapParty,
  counterparty: SwapParty,
): readonly SwapMutation[] {
  if (initiator.date === counterparty.date) {
    // Zelfde dag: de twee wisselen van dienst, verder verandert er niets.
    return [
      {
        employeeId: initiator.employeeId,
        date: initiator.date,
        dutyId: counterparty.dutyId,
        positionType: "DUTY",
      },
      {
        employeeId: counterparty.employeeId,
        date: counterparty.date,
        dutyId: initiator.dutyId,
        positionType: "DUTY",
      },
    ];
  }

  return [
    // De aanbieder: dag X komt vrij, dag Y wordt gewerkt met de dienst van B.
    {
      employeeId: initiator.employeeId,
      date: initiator.date,
      dutyId: null,
      positionType: "RUST",
    },
    {
      employeeId: initiator.employeeId,
      date: counterparty.date,
      dutyId: counterparty.dutyId,
      positionType: "DUTY",
    },
    // De tegenpartij: dag Y komt vrij, dag X wordt gewerkt met de dienst van A.
    {
      employeeId: counterparty.employeeId,
      date: counterparty.date,
      dutyId: null,
      positionType: "RUST",
    },
    {
      employeeId: counterparty.employeeId,
      date: initiator.date,
      dutyId: initiator.dutyId,
      positionType: "DUTY",
    },
  ];
}

/**
 * Levert deze ruil precies hetzelfde rooster op als ervoor?
 *
 * Zelfde dag én dezelfde dienst: beide medewerkers houden wat ze hadden. Zulke
 * combinaties ontstaan vanzelf wanneer twee collega's op hetzelfde basisrooster
 * zitten. Roostertechnisch is er niets mis mee — de rules engine keurt haar
 * terecht goed — maar zij hoort niet in een keuzelijst en niet in een voorstel.
 */
export function isNoOpSwap(initiator: SwapParty, counterparty: SwapParty): boolean {
  return initiator.date === counterparty.date && initiator.dutyId === counterparty.dutyId;
}
