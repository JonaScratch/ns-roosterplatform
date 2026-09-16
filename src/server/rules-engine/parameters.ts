/**
 * Productinstellingen van het platform.
 *
 * ## Wat hier bewust níét meer staat
 *
 * Tot en met de vorige fase stonden hier ook grenswaarden: minimumrust, het
 * maximum aantal opeenvolgende werkdagen, de rust na een nachtreeks. Werkbare
 * getallen, maar niet uit een bron — en ze weken af van de CAO-transcriptie die
 * er later naast kwam te staan. Elf uur hier, twaalf uur daar; zes werkdagen
 * hier, zeven daar.
 *
 * Twee regelboeken in één systeem is erger dan één onvolledig regelboek. Het
 * onvolledige boek blokkeert zichtbaar; twee boeken geven allebei een antwoord
 * en achteraf is niet vast te stellen welk antwoord gold. Alle grenswaarden
 * staan daarom nu uitsluitend in `ruleset/`, met bron, artikel, reikwijdte en
 * validatiestatus erbij.
 *
 * Wat hier overblijft zijn keuzes van de applicatie zelf. Die hebben geen
 * juridische bron nodig, want ze doen geen juridische uitspraak: hoe ver een
 * medewerker vooruit mag kiezen is beleid, geen arbeidstijdenregel.
 */

export interface ProductParameters {
  /**
   * Hoeveel dagen roosterhistorie er rond een toetsing wordt geladen.
   *
   * Ruim genomen, want de validator vraagt zelf om wat hij nodig heeft en meldt
   * het als hij het niet krijgt. Te krap laden levert geen fout op maar de
   * uitkomst "niet te beoordelen", en dat is duur op een heel rooster.
   */
  readonly windowDaysBack: number;
  readonly windowDaysForward: number;

  /** Hoe ver vooruit een beschikbare dienst gekozen kan worden. */
  readonly availableDutyHorizonDays: number;

  /** Geldigheidsduur van een ruilvoorstel. */
  readonly swapProposalValidHours: number;

  /**
   * Hoeveel de zwaarte van diensten binnen een periode mag afwijken van het
   * gemiddelde voordat de verdeling scheef heet. Fractie van het gemiddelde.
   * Een wenselijkheidsmaat, geen norm: hij blokkeert niets.
   */
  readonly weightBalanceTolerance: number;
}

export const DEFAULT_PRODUCT_PARAMETERS: ProductParameters = {
  // Een jaar terug, omdat de regel over vrije zondagen over 52 weken kijkt.
  windowDaysBack: 365,
  // Vooruit is 35 dagen genoeg voor de reeks-, rust- en weekendregels.
  windowDaysForward: 35,

  availableDutyHorizonDays: 14,
  swapProposalValidHours: 72,

  weightBalanceTolerance: 0.25,
};

/**
 * De doelstellingen waarop de toekomstige optimizer stuurt.
 *
 * Ze staan hier als gewichten en niet als code, omdat de optimizer zelf nog
 * niet bestaat. Wat wél al vastligt is welke doelen er zijn en hoe zwaar ze ten
 * opzichte van elkaar wegen. Geen van deze gewichten kan een harde regel
 * compenseren: de validator geeft een geblokkeerde plaatsing score nul, en nul
 * blijft nul hoe hoog een doelstelling ook weegt.
 */
export const DEFAULT_OBJECTIVE_WEIGHTS: Readonly<Record<string, number>> = {
  "objective.rustkwaliteit": 1.0,
  "objective.verdeling-dagdelen": 1.0,
  "objective.verdeling-rangeer": 0.8,
  "objective.weekendbelasting": 0.9,
  "objective.dienstzwaarte": 0.7,
  "objective.roosterkarakter": 0.6,
  "objective.reservevoorkeur": 0.5,
  "objective.medewerkerfeedback": 0.6,
};
