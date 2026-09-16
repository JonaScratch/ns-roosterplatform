/**
 * De ruilmarkt: een dienst aanbieden zonder vooraf een collega te kiezen.
 *
 * ## Waarom hier bijna niets staat
 *
 * De enige echte vraag — mag deze ruil? — wordt nergens hier beantwoord. Die
 * loopt via dezelfde weg als een rechtstreekse ruil: `simulate()` in
 * `swap-service.ts`, die op zijn beurt de rules engine aanroept. Een
 * ruilmarktaanbieding levert alleen de tegenpartij; de toetsing verandert niet
 * mee. Wat hier wél hoort, is de ene afgeleide regel die geen toetsing is: hoe
 * een voorkeur ("graag vroeger", "graag later") de weergavevolgorde bepaalt.
 */

export type SwapListingPreference = "NONE" | "EARLIER" | "LATER";

/**
 * Sorteergewicht van een kandidaat-dienst tegenover de voorkeur van de
 * aanbieder. Lager sorteert eerder in de lijst.
 *
 * Dit filtert nooit: een dienst die niet aan de voorkeur voldoet, krijgt een
 * hoger gewicht en staat verderop, maar blijft gewoon een geldige, kiesbare
 * optie. De voorkeur is een wens van de aanbieder over wat hij liever
 * terugkrijgt, geen regel — die blijft uitsluitend bij de rules engine.
 */
export function preferenceWeight(
  offeredStartMinute: number,
  candidateStartMinute: number,
  preference: SwapListingPreference,
): number {
  if (preference === "NONE") {
    return 0;
  }
  const eerder = candidateStartMinute < offeredStartMinute;
  const later = candidateStartMinute > offeredStartMinute;
  const opTijd = !eerder && !later;
  if (preference === "EARLIER") {
    return eerder ? 0 : opTijd ? 1 : 2;
  }
  return later ? 0 : opTijd ? 1 : 2;
}

const PREFERENCE_LABELS: Readonly<Record<SwapListingPreference, string>> = {
  NONE: "Geen voorkeur",
  EARLIER: "Graag vroeger",
  LATER: "Graag later",
};

export function preferenceLabel(preference: SwapListingPreference): string {
  return PREFERENCE_LABELS[preference];
}
