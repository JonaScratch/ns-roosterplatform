/**
 * Onhaalbaarheid uitleggen (Phase J): als een wens niet kan, zeg wáárom — met
 * getallen, niet met "helaas".
 *
 * Een roosterwens kan onhaalbaar zijn zonder dat er één regel wordt
 * geschonden: er zijn simpelweg te weinig mensen-dagen om de diensten te
 * dekken onder de gevraagde voorwaarden. Dit bestand rekent dat na met
 * eenvoudige, controleerbare capaciteitssommen. Het is geen optimizer: een
 * "haalbaar" hier betekent alleen dat de tellingen niet tegen zijn, niet dat er
 * een rooster bestaat. Een "onhaalbaar" is wél hard: dan past het niet, welk
 * rooster je ook maakt.
 */

export interface RoosterEisen {
  /** Aantal roosterregels (≈ mensen) in de groep. */
  readonly regels: number;
  /** Te dekken diensten per week, totaal. */
  readonly dienstenPerWeek: number;
  /** Waarvan op zaterdag + zondag samen. */
  readonly weekenddienstenPerWeek: number;
  /** Waarvan nachtdiensten per week. */
  readonly nachtdienstenPerWeek: number;
  /** Maximaal aantal diensten per regel per week (bv. 5). */
  readonly maxDienstenPerRegelPerWeek: number;
  /** Gewenst deel van de weekenden dat een regel vrij is (0 = geen eis, 1 = elk weekend vrij). */
  readonly vrijWeekendFractie: number;
  /** Maximaal aantal nachten per regel per week. */
  readonly maxNachtenPerRegelPerWeek: number;
}

export interface Knelpunt {
  readonly eis: string;
  readonly benodigd: number;
  readonly beschikbaar: number;
  readonly uitleg: string;
}

export interface Haalbaarheid {
  /** false = zeker onhaalbaar; true = de tellingen zijn niet tegen (geen garantie dat een rooster bestaat). */
  readonly tellingenKloppen: boolean;
  readonly knelpunten: readonly Knelpunt[];
  readonly samenvatting: string;
}

const rond = (n: number) => Math.round(n * 10) / 10;

export function verklaarOnhaalbaarheid(e: RoosterEisen): Haalbaarheid {
  const knelpunten: Knelpunt[] = [];

  const capaciteit = e.regels * e.maxDienstenPerRegelPerWeek;
  if (capaciteit < e.dienstenPerWeek) {
    knelpunten.push({
      eis: "alle diensten dekken",
      benodigd: e.dienstenPerWeek,
      beschikbaar: capaciteit,
      uitleg: `${e.regels} regels × max ${e.maxDienstenPerRegelPerWeek} diensten = ${capaciteit} per week, maar er zijn ${e.dienstenPerWeek} diensten te dekken (${e.dienstenPerWeek - capaciteit} te weinig).`,
    });
  }

  // Elke weekenddienst vraagt iemand die dat weekend niet vrij is. Gemiddeld
  // werkt een regel in (1 − vrijWeekendFractie) van de weekenden, twee dagen.
  const weekendCapaciteit = rond(e.regels * 2 * (1 - e.vrijWeekendFractie));
  if (weekendCapaciteit < e.weekenddienstenPerWeek) {
    knelpunten.push({
      eis: `${Math.round(e.vrijWeekendFractie * 100)}% van de weekenden vrij`,
      benodigd: e.weekenddienstenPerWeek,
      beschikbaar: weekendCapaciteit,
      uitleg:
        e.vrijWeekendFractie >= 1
          ? `Als iedereen elk weekend vrij is, is er niemand voor de ${e.weekenddienstenPerWeek} weekenddiensten per week.`
          : `Met ${Math.round(e.vrijWeekendFractie * 100)}% vrije weekenden zijn er gemiddeld ${weekendCapaciteit} weekend-mensdagen per week, voor ${e.weekenddienstenPerWeek} weekenddiensten.`,
    });
  }

  const nachtCapaciteit = e.regels * e.maxNachtenPerRegelPerWeek;
  if (nachtCapaciteit < e.nachtdienstenPerWeek) {
    knelpunten.push({
      eis: `hoogstens ${e.maxNachtenPerRegelPerWeek} nachten per regel per week`,
      benodigd: e.nachtdienstenPerWeek,
      beschikbaar: nachtCapaciteit,
      uitleg: `${e.regels} regels × max ${e.maxNachtenPerRegelPerWeek} nachten = ${nachtCapaciteit}, voor ${e.nachtdienstenPerWeek} nachtdiensten per week.`,
    });
  }

  return {
    tellingenKloppen: knelpunten.length === 0,
    knelpunten,
    samenvatting:
      knelpunten.length === 0
        ? "De tellingen zijn niet tegen deze wens; of er ook echt een rooster bestaat, moet de zoekmachine uitwijzen."
        : `Dit kan niet, welk rooster je ook maakt: ${knelpunten.map((k) => k.uitleg).join(" ")}`,
  };
}
