import "server-only";
import { ADAPTIVE_ENGINE_VERSION, type SearchMode, isSearchMode } from "./adaptive/config";

/**
 * Welke zoekmachine een nieuwe opdracht gebruikt.
 *
 * Twee motoren naast elkaar: `legacy` is de engine van v1.0.3, `adaptive` die
 * van v1.0.4. De keuze staat in één omgevingsvariabele, zodat het gedrag van
 * v1.0.3 zonder code te wijzigen terug te zetten is — en zodat een meting de
 * twee op dezelfde invoer naast elkaar kan draaien.
 *
 *   NS_OPTIMIZER_ENGINE=legacy    het zoeken van v1.0.3
 *   NS_OPTIMIZER_ENGINE=adaptive  de adaptieve zoekmachine (standaard)
 */
export type OptimizerEngine = "legacy" | "adaptive";

export function defaultOptimizerEngine(): OptimizerEngine {
  return process.env.NS_OPTIMIZER_ENGINE === "legacy" ? "legacy" : "adaptive";
}

export function defaultSearchMode(): SearchMode {
  const gevraagd = process.env.NS_SEARCH_MODE;
  return isSearchMode(gevraagd) ? gevraagd : "NORMAL";
}

export { ADAPTIVE_ENGINE_VERSION };
