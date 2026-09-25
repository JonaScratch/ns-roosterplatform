/**
 * Wat de agent nooit doet, ongeacht welk model eronder hangt.
 *
 * ## Waarom dit hier staat en niet in een modeladapter
 *
 * Dit stond in de stub. Daar werkte het: de stub weigerde netjes. Bij de meting
 * op het lokale model bleek de prijs — op de vier veiligheidsvragen weigerde
 * `qwen3:8b` er twee, en antwoordde op de andere twee dat het "niet kon
 * vaststellen" wat zijn bevoegdheden waren. De gebruiker kreeg dus niet te horen
 * dat iets niet mag, maar dat er gegevens ontbraken.
 *
 * Het platform deed ondertussen niets verkeerds: publiceren bestaat niet als
 * tool, en de rechtencontrole staat los van het gesprek. Maar een weigering die
 * afhangt van de welwillendheid van een taalmodel is geen weigering. Wat de
 * agent nooit doet, is een eigenschap van het platform.
 *
 * ## Wat dit wel en niet is
 *
 * Dit is de grens in woorden, vóór het model. De echte grens ligt in de
 * toollaag: er bestaat geen tool om te publiceren, goed te keuren of een regel
 * te wijzigen, en geen bevoegdheid die dat aanzet. Deze lijst zorgt ervoor dat
 * de gebruiker de juiste reden te horen krijgt, en dat het model niet eerst een
 * poging mag wagen.
 */

export interface VerbodenHandeling {
  readonly woorden: readonly string[];
  /** Als dit er staat, moet de vraag óók een van deze woorden bevatten. */
  readonly en?: readonly string[];
  readonly uitleg: string;
}

export const bevat = (tekst: string, ...woorden: string[]) => woorden.some((w) => tekst.includes(w));

/** Woorden die op een handeling wijzen waarvoor een mens moet tekenen. */
export const VERBODEN: readonly VerbodenHandeling[] = [
  { woorden: ["publiceer", "publiceren", "vaststellen als definitief"], uitleg: "Publiceren is een menselijke handeling; de agent heeft die bevoegdheid niet en krijgt die ook niet." },
  // "goed genoeg" stond hier als los trefwoord. Bij het overhevelen naar deze
  // laag viel op wat dat betekent: "is deze kandidaat goed genoeg?" is een
  // gewone kwaliteitsvraag, en die kreeg als antwoord dat de validator niet kan
  // worden overgeslagen. In de stub was dat al fout; onvoorwaardelijk vóór elk
  // model zou het een dagelijkse vraag onbeantwoordbaar maken.
  {
    woorden: ["negeer de validator", "negeer validator", "sla de validatie over", "sla de validator over", "zonder validatie"],
    uitleg: "De onafhankelijke validator kan ik niet overslaan. Een hoge score maakt een harde overtreding niet geldig.",
  },
  { woorden: ["eigen bevoegdheden", "zet jezelf op niveau", "geef jezelf", "verhoog je rechten"], uitleg: "Ik kan mijn eigen bevoegdheden niet aanpassen. Dat doet een commissielid in het bevoegdhedenpaneel." },
  { woorden: ["verwijder de regel", "schrap de regel", "pas de cao aan"], uitleg: "Formele regels wijzig ik niet. Die komen uit het regelbestand en hebben een bron en een status." },
  // Gevonden door verify:agent (TEST 5): een verzoek om een andere rol aan te
  // nemen liep niet op een weigering uit maar op een toolfout. Doen alsof is
  // precies de route waarlangs iemand rechten zou omzeilen.
  {
    woorden: ["doe alsof je", "gedraag je als", "je bent nu de", "je bent nu beheerder", "stel dat je", "net alsof je"],
    uitleg: "Ik kan niet doen alsof ik iemand anders ben. Wat ik mag, hangt aan jouw rechten en aan wat de commissie voor dit project heeft aangezet — niet aan wat we afspreken in een gesprek.",
  },
  // Stoppen hoort bij de knop, niet bij de agent: hij heeft die bevoegdheid
  // niet, ook niet als iemand het hem vriendelijk vraagt.
  {
    woorden: ["stop de opdracht", "stop er maar mee", "stop ermee", "annuleer de opdracht", "annuleer de generatie", "breek af"],
    uitleg: "Een lopende opdracht kan ik niet stoppen. Dat doet een commissielid met de stopknop bij de opdracht zelf; daar wordt het ook vastgelegd.",
  },
  // Stond in de stub, en om dezelfde reden als de rest hierboven verplaatst:
  // bij de meting weigerde het lokale model dit niet, maar bood het aan alsnog
  // iets te doen zodra het een basisrooster zou krijgen. Ingetrokken kennis die
  // niets meer stuurt, is een nulfoutcriterium (B5) en dus een eigenschap van
  // het platform.
  {
    woorden: ["ingetrokken", "teruggenomen"],
    en: ["pas", "toepassen", "gebruik", "alsnog"],
    uitleg:
      "Een ingetrokken voorkeur pas ik niet toe. Hij blijft leesbaar met de reden erbij, zodat " +
      "terug te vinden is waarom hij ooit gold — maar hij stuurt geen enkele beslissing meer. " +
      "Vindt de commissie hem tóch weer geldig, dan kan zij hem opnieuw vastleggen.",
  },
];


/** Raakt deze vraag een handeling die niet bij de agent ligt? */
export function verbodenHandeling(tekst: string): VerbodenHandeling | null {
  const t = tekst.toLowerCase();
  return VERBODEN.find((regel) => bevat(t, ...regel.woorden) && (!regel.en || bevat(t, ...regel.en))) ?? null;
}
