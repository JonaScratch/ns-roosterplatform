import type { ComponentKey } from "@/domain/quality-model";

/**
 * De configuratie van de adaptieve roosterzoekmachine, versie 1.0.4.
 *
 * Eén plek, geversioneerd. `configs/optimizer-config-v1.0.4.json` is een afdruk
 * van dit bestand; een test houdt beide gelijk. De zachte gewichten van CP-SAT
 * zelf staan in `objective-weights.ts` en gaan onder `baseWeights` mee in de
 * afdruk, zodat één bestand de hele engine beschrijft.
 *
 * ## Rekentijdmodi
 *
 * Budgetten, geen wachttijden. Een modus stopt eerder zodra het zoeken een
 * plateau bereikt of genoeg goede, verschillende kandidaten heeft.
 */

export type SearchMode = "FAST" | "NORMAL" | "DEEP" | "EXTENSIVE";

export interface ModeConfig {
  readonly label: string;
  readonly budgetSeconds: number;
  /** Rekentijd van één volledige start. */
  readonly startSeconds: number;
  /** Rekentijd van één gerichte reparatie op een deel van de roosters. */
  readonly repairSeconds: number;
  /** Rekentijd van het bijschaven met ruildiensten, per kandidaat. */
  readonly polishSeconds: number;
  readonly minStarts: number;
  readonly maxStarts: number;
  /** Deel van het budget dat hooguit aan starts opgaat; de rest is voor reparatie. */
  readonly startShare: number;
  readonly eliteSize: number;
  /** Zoveel reparaties zonder winst van `plateauMinGain` en het zoeken stopt. */
  readonly plateauWindow: number;
}

/**
 * v1.0.4 blijft v1.0.4 (werkopdracht "Final Brain Polish"): dit is een revisie
 * van de zoekmachine binnen die versie, geen nieuwe productversie. "rhythm":
 * gerangschikt op kwaliteitsmodel v2 (geijkt op de menselijke Dordrechtse
 * roosters), de menselijke nachtuitgang in CP-SAT, het slechtste geval in de
 * rangschikking, gerichte reparatie van nachtuitgangen en een bewaking op
 * eerlijkheid, uren en rust. De bevroren v1.0.4 is als profiel te draaien; zie
 * `variant.ts`.
 */
// "adaptive-1.0.4-machinist" sinds de machinistenronde: de configuratie kreeg de
// pariteitsgewichten van de voorkeurstermen erbij. De afdruk van
// "adaptive-1.0.4-rhythm" blijft staan als verslag van de Final-Brain-meting;
// het profiel `rhythm` draagt die versienaam nog (variant.ts).
export const ADAPTIVE_ENGINE_VERSION = "adaptive-1.0.4-machinist";

export const ADAPTIVE_CONFIG = {
  version: ADAPTIVE_ENGINE_VERSION,
  modes: {
    FAST: {
      label: "Snel",
      budgetSeconds: 120,
      startSeconds: 20,
      repairSeconds: 10,
      polishSeconds: 8,
      minStarts: 3,
      maxStarts: 4,
      startShare: 0.6,
      eliteSize: 8,
      plateauWindow: 3,
    },
    NORMAL: {
      label: "Normaal",
      budgetSeconds: 300,
      startSeconds: 40,
      repairSeconds: 15,
      polishSeconds: 15,
      minStarts: 3,
      maxStarts: 4,
      startShare: 0.55,
      eliteSize: 12,
      plateauWindow: 5,
    },
    DEEP: {
      label: "Grondig",
      budgetSeconds: 900,
      startSeconds: 60,
      repairSeconds: 20,
      polishSeconds: 25,
      minStarts: 5,
      maxStarts: 8,
      startShare: 0.5,
      eliteSize: 20,
      plateauWindow: 8,
    },
    EXTENSIVE: {
      label: "Zeer grondig",
      budgetSeconds: 1800,
      startSeconds: 75,
      repairSeconds: 25,
      polishSeconds: 30,
      minStarts: 8,
      maxStarts: 14,
      startShare: 0.5,
      eliteSize: 20,
      plateauWindow: 12,
    },
  } satisfies Record<SearchMode, ModeConfig>,

  /** Seconden die per kandidaat voor validatie, evaluatie en opslag worden gereserveerd. */
  overheadSecondsPerCandidate: 6,
  plateauMinGain: 0.2,

  diversity: {
    /** Twee kandidaten die op minder dan dit deel van de dienstdagen verschillen, zijn bijna dubbel. */
    duplicateShare: 0.04,
    /** De kandidaten die de Roostercommissie ziet, verschillen op ten minste dit deel. */
    finalMinShare: 0.1,
    /** Een diversificatiestart moet van alle gekozen kandidaten zoveel verschillen. */
    diversifyStartShare: 0.1,
  },

  repair: {
    minRankingGain: 0.1,
    maxComponentLoss: 2,
    /** Vermenigvuldiging van de gewichten die bij het reparatiedoel horen. */
    targetBoost: 4,
    /** Kostenpost per dienstdag die afwijkt van de kandidaat die wordt gerepareerd. */
    keepGoodPartsWeight: 30,
    /**
     * Gerichte reparatie van een nachtuitgang onder de herstelregel
     * (werkopdracht §18). Het bijschaven kan een nachtreeks niet verplaatsen;
     * alleen CP-SAT kan dat, met de nachtrij extra zwaar. Gebouwd en gemeten,
     * maar uit (R2): zie hieronder.
     */
    nightExitRepair: false,
    /**
     * Nachtreparaties vóór alle andere doelen (§19). Uit: beslisregel R2 op de
     * ablaties (decision-r2.json). De nachtuitgangreparatie met nachten-eerst
     * haalde één nachtpoort minder dan zonder (een losse nacht meer); nachten-
     * eerst los van die reparatie is niet gemeten, en twijfel is uit.
     */
    nightFirst: false,
  },

  pressure: { step: 1.5, max: 4, decay: 0.8 },

  /**
   * De ritmevoorkeuren uit de menselijke roosters, ook in CP-SAT.
   *
   * `enabled`: de nachtuitgang zoals mensen hem maken (twee vrije dagen, dan
   * liever laat). Gemeten op de ruwe solveruitkomst, 3 runs met en 3 zonder:
   * robuust 86,0 → 85,5, nachten +2,3, eerlijkheid +2,9, vroeg na nachten 1,0 → 0
   * per kandidaat. Drie runs tonen een richting, geen bewijs; zie de AFTER-meting.
   *
   * `startJitterWeight`: de begintijdsterm staat UIT. Met gewicht 1 (het kleinste
   * gehele getal dat CP-SAT toelaat) haalde hij zijn doel — sprong p90 179 → 106
   * minuten — maar de solver betaalde met nachten −10 en eerlijkheid −7, en werd
   * stijver dan mensen zelf roosteren (hun p90 is 150). Het bijschaven stuurt op
   * begintijden via kwaliteitsmodel v2 en accepteert alleen ruilen die het geheel
   * verbeteren. Zie docs/human-roster-benchmark/solver-ab-uit-aan.json.
   */
  humanRhythm: {
    enabled: true,
    startJitterWeight: 0,
    /**
     * Factor op de nachtrij van de menselijke overgangstabel
     * (`night-exit-tables.ts`). Met 1 kost "nacht, vrij, laat" de solver
     * evenveel als acht seconden per week urenbalans in één rooster
     * (objective-exchange-rates.md). Met × 5 kost hij 1 500, gelijk aan een
     * reeks van twee plus een losse nacht samen. Gekozen met beslisregel R1
     * (vastgelegd vóór de uitslag) uit de A/B op de ruwe solveruitkomst, vijf
     * zaden: nachtuitgangen onder 46 uur 1,2 → 0,2 per oplossing, kortste
     * herstel 28 → 50 uur, eerlijkheid −0,6, uren gelijk. × 8 viel af op
     * eerlijkheid (−2,7). docs/v1.0.4-final-brain/decision-r1.json.
     */
    nightExitScale: 5,
  },

  /** Het slechtste geval (nachtuitgang, overgang, werkblok) telt mee in de rangschikking (§12, §13). */
  worstCaseInRanking: true,

  /**
   * De voorkeurstermen in CP-SAT (machinistenronde), op pariteit met model v3:
   * wat het model voor een gebeurtenis betaalt, in urenminuten per week, maal
   * `hoursBalance × 60` (docs/v1.0.4-final-brain/machinist-preferences/exchange-rates.json).
   * - `affinityPerTenth`: een stap van 0,1 affiniteit op één plaatsing (0,4 = 203);
   * - `dayDutyPerTenth`: een tiende dienst afwijking van het dagdienstdoel van
   *   één rooster (een hele dienst van boven naar onder het doel = 2 291, dus
   *   1 145 per dienst per rooster).
   * De zoekmachine gebruikt ze × `preferenceScale` van de variant; 0 is uit.
   */
  preferenceParity: {
    affinityPerTenth: 51,
    dayDutyPerTenth: 114.5,
  },

  /**
   * De bewaking: winst op regelmaat en nachten mag niet worden betaald met
   * eerlijkheid, uren of rust. Per onderdeel hoeveel punten het tijdens
   * bijschaven of repareren mag zakken ten opzichte van waar de kandidaat
   * begon; elke punt daarboven kost `penaltyPerPoint` in de rangschikking.
   * Eerlijkheid is het strengst: daar leverde v1.0.4 al 1,4 punt op in.
   */
  guards: {
    tolerances: { fairness: 0.5, hours: 1, rest: 1 } as Readonly<Partial<Record<ComponentKey, number>>>,
    penaltyPerPoint: 10,
  },

  /** De kwaliteitspoort: tolerantie ten opzichte van het officiële rooster. */
  gateTolerance: {
    robustPoints: 10,
    singletonNights: 2,
    heavyTransitions: 2,
    hoursMinutes: 12,
    hoursFloorMinutes: 30,
    worstLinePoints: 10,
  },

  /** Kanteling van de rangschikking per strategie; de benchmark gebruikt het ongekantelde model. */
  rankingTilt: {
    BALANCED: {},
    REST_QUALITY: { flow: 1.6, rest: 1.6 },
    FAIR_BURDEN: { fairness: 2 },
    MINIMAL_CHANGE: { stability: 4 },
    COVERAGE: {},
  } as Record<string, Partial<Record<ComponentKey, number>>>,
} as const;

export function isSearchMode(value: unknown): value is SearchMode {
  return typeof value === "string" && value in ADAPTIVE_CONFIG.modes;
}
