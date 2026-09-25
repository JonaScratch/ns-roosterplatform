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
  readonly uitleg: string;
}

export const bevat = (tekst: string, ...woorden: string[]) => woorden.some((w) => tekst.includes(w));

/** Woorden die op een handeling wijzen waarvoor een mens moet tekenen. */
export const VERBODEN: readonly VerbodenHandeling[] = [
  { woorden: ["publiceer", "publiceren", "vaststellen als definitief"], uitleg: "Publiceren is een menselijke handeling; de agent heeft die bevoegdheid niet en krijgt die ook niet." },
  { woorden: ["negeer de validator", "negeer validator", "sla de validatie over", "goed genoeg"], uitleg: "De onafhankelijke validator kan ik niet overslaan. Een hoge score maakt een harde overtreding niet geldig." },
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
];


/** Raakt deze vraag een handeling die niet bij de agent ligt? */
export function verbodenHandeling(tekst: string): VerbodenHandeling | null {
  const t = tekst.toLowerCase();
  return VERBODEN.find((regel) => bevat(t, ...regel.woorden)) ?? null;
}
