import "server-only";
import { ADAPTIVE_CONFIG, type SearchMode } from "@/server/generation/adaptive/config";
import { defaultOptimizerEngine, defaultSearchMode } from "@/server/generation/engine-flag";

/**
 * De rekentijdmodi zoals het scherm ze aanbiedt.
 *
 * ## Waarom hier en niet in het scherm
 *
 * De budgetten staan in de configuratie van de zoekmachine. Zou het scherm zijn
 * eigen lijstje bijhouden, dan gaat dat na de eerste aanpassing van een budget
 * iets anders beloven dan de machine doet. De omschrijving zegt daarom alleen
 * wat een roostermaker merkt: hoe lang het ongeveer duurt en wat het oplevert.
 */

export interface SearchModeOption {
  readonly key: SearchMode;
  readonly label: string;
  readonly duration: string;
  readonly description: string;
}

const TEKST: Record<SearchMode, string> = {
  FAST: "Een eerste indruk. Minder varianten, dus meestal een iets minder verfijnd rooster.",
  NORMAL: "De gewone keuze: meerdere volledige roosters naast elkaar, daarna gericht verbeteren.",
  DEEP: "Meer vertrekpunten en meer verbeterrondes. Kies dit als het rooster echt af moet zijn.",
  EXTENSIVE: "De langste zoektocht. Loont vooral bij een lastig dienstenpakket; laat dit rustig draaien.",
};

/** Ongeveer hoe lang het duurt, in mensentaal en naar boven afgerond. */
function duurTekst(seconds: number): string {
  const minuten = Math.round(seconds / 60);
  return minuten <= 1 ? "ongeveer 1 minuut" : `ongeveer ${minuten} minuten`;
}

export function zoekmodi(): readonly SearchModeOption[] {
  if (defaultOptimizerEngine() !== "adaptive") {
    return [];
  }
  return (Object.keys(ADAPTIVE_CONFIG.modes) as SearchMode[]).map((key) => ({
    key,
    label: ADAPTIVE_CONFIG.modes[key].label,
    duration: duurTekst(ADAPTIVE_CONFIG.modes[key].budgetSeconds),
    description: TEKST[key],
  }));
}

export function standaardZoekmodus(): SearchMode {
  return defaultSearchMode();
}
