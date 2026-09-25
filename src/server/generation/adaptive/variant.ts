import { OPERATIONAL_REQUIREMENTS_V1 } from "@/domain/operational-requirements";
import { type ComponentKey, QUALITY_MODEL_V1, QUALITY_MODEL_V2, type QualityModel, qualityModelByVersion } from "@/domain/quality-model";
import { ADAPTIVE_CONFIG, ADAPTIVE_ENGINE_VERSION } from "./config";

/**
 * Welk gedrag de adaptieve zoekmachine heeft: het huidige, of dat van de
 * bevroren v1.0.4.
 *
 * ## Waarom een variant naast de configuratie
 *
 * v1.0.4 is nooit gecommit, dus "exact v1.0.4 draaien" kan niet met git. Alles
 * wat sindsdien aan de zoekmachine is veranderd, is schakelbaar: het
 * kwaliteitsmodel waarop hij rangschikt, de menselijke overgangstabel in
 * CP-SAT, de bewaking, het slechtste geval in de rangschikking en de gerichte
 * reparatie van nachtuitgangen. Het profiel `frozen-1.0.4` zet ze alle uit en
 * rangschikt op model v1; `docs/v1.0.4-final-brain/freeze.json` toont dat model v1
 * in deze code de v1.0.4-getallen exact reproduceert.
 *
 * ## Ablaties
 *
 * `NS_ENGINE_PROFILE` kiest het profiel, `NS_ENGINE_VARIANT` (JSON) zet daarbovenop
 * losse onderdelen, bijvoorbeeld `{"nightExitScale":5,"worstCase":false}`. Zo
 * verandert een ablatie precies één ding. De variant gaat mee in de herkomst en
 * in de confighash van elke kandidaat. De applicatie zelf zet geen van beide:
 * zonder omgevingsvariabelen is het het profiel `machinist`.
 *
 * ## De profielen
 *
 * - `machinist` (standaard): de stand na de machinistenronde — `rhythm` plus de
 *   operationele eisen van de gebruiker (roostergemiddelde ≤ 40:00, vrijdag vóór
 *   een vrij weekend). Model v3 in de rangschikking en de CP-SAT-voorkeurstermen
 *   staan uit: beslisregels M1 en M2 (docs/v1.0.4-final-brain/machinist-preferences/
 *   decision-m1.json, decision-m2.json) haalden hun vooraf vastgelegde marges niet.
 * - `rhythm`: de stand na de Final-Brain-ronde, vastgepind op model v2.
 * - `frozen-1.0.4`: exact v1.0.4.
 */

export interface EngineVariant {
  readonly profile: string;
  readonly engineVersion: string;
  readonly qualityModel: QualityModel;
  /** De menselijke overgangstabel in CP-SAT (nachtuitgang via rust, dan laat). */
  readonly humanRhythm: boolean;
  /** Factor op de nachtrij van die tabel; 1 is de tabel van H05. */
  readonly nightExitScale: number;
  /** Hoeveel een onderdeel tijdens bijschaven of reparatie mag zakken. */
  readonly guards: Readonly<Partial<Record<ComponentKey, number>>>;
  /** Het slechtste geval (nachtuitgang, overgang, werkblok) in de rangschikking. */
  readonly worstCase: boolean;
  /** Gerichte reparatie van een nachtuitgang onder de herstelregel. */
  readonly nightExitRepair: boolean;
  /** Nachtreparaties vóór alle andere reparatiedoelen. */
  readonly nightFirst: boolean;
  /**
   * De operationele ontwerpeisen van de gebruiker hard in CP-SAT, bijschaven en
   * afwijzing: roostergemiddelde ≤ 40:00 en de vrijdag vóór een vrij weekend
   * (`operational-requirements.ts`). Uit in de profielen van vóór die eisen.
   */
  readonly operational: boolean;
  /**
   * Schaal van de voorkeurstermen in CP-SAT (affiniteit per plaatsing,
   * dagdienstdoel per rooster) ten opzichte van pariteit met model v3; 0 = uit.
   */
  readonly preferenceScale: number;
  /** Wat er via NS_ENGINE_VARIANT is overschreven, voor de herkomst. */
  readonly overrides: Readonly<Record<string, unknown>> | null;
}

const PROFIELEN: Readonly<Record<string, Omit<EngineVariant, "profile" | "overrides">>> = {
  // De stand na de Final-Brain-ronde (docs/v1.0.4-final-brain/after.json),
  // vastgepind op model v2: wie deze meting herhaalt, moet hetzelfde krijgen,
  // ook als het huidige model later verandert.
  rhythm: {
    engineVersion: "adaptive-1.0.4-rhythm",
    qualityModel: QUALITY_MODEL_V2,
    humanRhythm: ADAPTIVE_CONFIG.humanRhythm.enabled,
    nightExitScale: ADAPTIVE_CONFIG.humanRhythm.nightExitScale,
    guards: ADAPTIVE_CONFIG.guards.tolerances,
    worstCase: ADAPTIVE_CONFIG.worstCaseInRanking,
    nightExitRepair: ADAPTIVE_CONFIG.repair.nightExitRepair,
    nightFirst: ADAPTIVE_CONFIG.repair.nightFirst,
    operational: false,
    preferenceScale: 0,
  },
  machinist: {
    engineVersion: ADAPTIVE_ENGINE_VERSION,
    qualityModel: QUALITY_MODEL_V2,
    humanRhythm: ADAPTIVE_CONFIG.humanRhythm.enabled,
    nightExitScale: ADAPTIVE_CONFIG.humanRhythm.nightExitScale,
    guards: ADAPTIVE_CONFIG.guards.tolerances,
    worstCase: ADAPTIVE_CONFIG.worstCaseInRanking,
    nightExitRepair: ADAPTIVE_CONFIG.repair.nightExitRepair,
    nightFirst: ADAPTIVE_CONFIG.repair.nightFirst,
    operational: true,
    preferenceScale: 0,
  },
  "frozen-1.0.4": {
    engineVersion: "adaptive-1.0.4",
    qualityModel: QUALITY_MODEL_V1,
    humanRhythm: false,
    nightExitScale: 1,
    guards: {},
    worstCase: false,
    nightExitRepair: false,
    nightFirst: false,
    operational: false,
    preferenceScale: 0,
  },
};

/**
 * Welke velden een variant mag overschrijven.
 *
 * Geëxporteerd omdat de experimenteerlaag een voorstel moet kunnen afwijzen
 * vóórdat er iets draait: een experiment dat een onbekend veld noemt, is geen
 * experiment maar een typefout, en dat hoort bij het voorstel te blijken en
 * niet pas bij het starten van de zoekmachine.
 */
export const VARIANT_VELDEN = new Set(["humanRhythm", "nightExitScale", "guards", "worstCase", "nightExitRepair", "nightFirst", "operational", "qualityModel", "preferenceScale"]);

export function engineVariant(env: Readonly<Record<string, string | undefined>> = process.env): EngineVariant {
  const profiel = env.NS_ENGINE_PROFILE ?? "machinist";
  const basis = PROFIELEN[profiel];
  if (!basis) {
    throw new Error(`Onbekend zoekmachineprofiel ${profiel}; bekend: ${Object.keys(PROFIELEN).join(", ")}.`);
  }
  let overrides: Record<string, unknown> | null = null;
  if (env.NS_ENGINE_VARIANT) {
    overrides = JSON.parse(env.NS_ENGINE_VARIANT) as Record<string, unknown>;
    const onbekend = Object.keys(overrides).filter((k) => !VARIANT_VELDEN.has(k));
    if (onbekend.length > 0) {
      throw new Error(`NS_ENGINE_VARIANT kent ${onbekend.join(", ")} niet; toegestaan: ${[...VARIANT_VELDEN].join(", ")}.`);
    }
  }
  // Het kwaliteitsmodel komt als versienaam binnen ("quality-model-v3").
  const model = typeof overrides?.qualityModel === "string" ? qualityModelByVersion(overrides.qualityModel) : basis.qualityModel;
  if (typeof overrides?.qualityModel === "string" && model.version !== overrides.qualityModel) {
    throw new Error(`NS_ENGINE_VARIANT noemt kwaliteitsmodel ${overrides.qualityModel}; dat bestaat niet.`);
  }
  const variant = { ...basis, ...(overrides ?? {}), qualityModel: model, profile: profiel, overrides } as EngineVariant;
  // Een ablatie is een andere zoekmachine: dat hoort in de versie te staan.
  return overrides ? { ...variant, engineVersion: `${variant.engineVersion}+ablation` } : variant;
}

/** De variant zonder het modelobject, voor herkomst en confighash. */
export function describeVariant(v: EngineVariant) {
  return {
    profile: v.profile,
    engineVersion: v.engineVersion,
    qualityModel: v.qualityModel.version,
    humanRhythm: v.humanRhythm,
    nightExitScale: v.nightExitScale,
    guards: v.guards,
    worstCase: v.worstCase,
    nightExitRepair: v.nightExitRepair,
    nightFirst: v.nightFirst,
    operational: v.operational ? OPERATIONAL_REQUIREMENTS_V1.version : null,
    preferenceScale: v.preferenceScale,
    overrides: v.overrides,
  };
}
