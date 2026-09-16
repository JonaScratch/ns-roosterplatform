/**
 * De uitkomst van een server action, zoals de interface hem toont.
 *
 * Eén vorm voor alle acties in de applicatie. Dat maakt het mogelijk om
 * terugkoppeling op één plek weer te geven (`ActionForm`) in plaats van in elk
 * scherm opnieuw — en het houdt de belangrijkste eigenschap overeind: een
 * geweigerde handeling komt met de redenen erbij, niet alleen met "mislukt".
 */
export interface ActionState {
  readonly error?: string;
  readonly notice?: string;
  /** De regels of controles die de handeling tegenhielden. */
  readonly reasons?: readonly string[];
  /**
   * Waar de handeling op uitkwam, wanneer dat iets is om naartoe te gaan.
   *
   * Alleen voor de interface: een formulier dat net iets heeft aangemaakt, kan
   * er daarna rechtstreeks naar verwijzen in plaats van de gebruiker terug door
   * het menu te sturen. De handeling zelf wordt er niet anders van.
   */
  readonly resultId?: string;
}
