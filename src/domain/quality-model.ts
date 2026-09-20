/**
 * Het menselijke kwaliteitsmodel voor roosters, versies 1 en 2.
 *
 * ## Wat dit is
 *
 * Eén centrale, geversioneerde beschrijving van hoe de RosterQualityEvaluator
 * een rooster beoordeelt: welke maten, op welke schaal, met welk gewicht en
 * waarom. De evaluator leest uitsluitend deze waarden; er staat geen getal in
 * de rekencode dat hier niet terug te vinden is. `configs/quality-model-v1.json`
 * is een afdruk van dit bestand en wordt door een test gelijk gehouden.
 *
 * ## Wat dit niet is
 *
 * Geen juridisch oordeel. De evaluator beoordeelt alleen kandidaten die hard
 * geldig zijn; een harde overtreding is een afwijzing, geen minpunt. Hij
 * bepaalt ook niets over publicatie.
 *
 * ## Waarom de schalen zijn wat ze zijn
 *
 * Elke schaal is gekozen vóór de ontwikkeling van de adaptieve engine en
 * gekalibreerd op de officiële Dordrechtse roosters en op synthetische
 * voorbeelden (goed tegenover slecht), niet op de uitkomsten van een engine.
 * Wie een schaal wijzigt, maakt een nieuwe modelversie en rekent BEFORE en
 * AFTER allebei opnieuw door.
 */

import { nightBlockWorth } from "./night-rhythm";
import { OPERATIONAL_REQUIREMENTS_V1 } from "./operational-requirements";

export const QUALITY_MODEL_V1 = {
  version: "quality-model-v1",

  components: {
    hours: {
      weight: 0.2,
      rationale: "Veertig uur per week over de cyclus is de afspraak in het contract; per week wisselt het mee met de structuur.",
      parts: {
        contract: { weight: 0.75, zeroAtMinutes: 60, meaning: "|gemiddelde weekomvang van het basisrooster − 40:00|; 0 min = 100, 60 min of meer = 0" },
        week: { weight: 0.25, zeroAtMinutes: 480, meaning: "|weekomvang van één regel − 40:00|, gemiddeld over de regels; 8 uur of meer afwijking = 0" },
      },
    },
    flow: {
      weight: 0.2,
      rationale: "Een rooster rijdt prettiger in reeksen van hetzelfde dagdeel, met de klok mee en zonder heen-en-weer.",
      parts: {
        stable: { weight: 0.4, meaning: "aandeel opeenvolgende gewerkte dagen in hetzelfde dagdeel" },
        penalty: { weight: 0.3, zeroAtPointsPerWorkedDay: 0.5, meaning: "overgangsstrafpunten (centrale matrix) per gewerkte dag; 0,5 of meer = 0" },
        streak: { weight: 0.3, fullAtAverageStreak: 4, meaning: "gemiddelde lengte van een reeks in hetzelfde dagdeel; 1 = 0, 4 of meer = 100" },
      },
    },
    rest: {
      weight: 0.15,
      rationale: "Rust boven het wettelijk minimum is comfort; herstel na nachten en het vermijden van zware overgangen ook.",
      parts: {
        surplus: {
          weight: 0.6,
          meaning: "rust tussen diensten op opeenvolgende dagen, boven de geplande dagelijkse rust (regel RP_DAILY_REST_PLANNED)",
          bands: [
            { upToMinutes: 0, value: 0 },
            { upToMinutes: 60, value: 0.25 },
            { upToMinutes: 180, value: 0.5 },
            { upToMinutes: 360, value: 0.8 },
            { upToMinutes: null, value: 1 },
          ],
        },
        recovery: {
          weight: 0.25,
          meaning: "tijd van het einde van een nachtreeks tot de volgende dienst, ten opzichte van de herstelrust na nachten (regel NIGHT_SEQUENCE_RECOVERY)",
          bands: [
            { upToMinutesAboveRule: 0, value: 0 },
            { upToMinutesAboveRule: 720, value: 0.6 },
            { upToMinutesAboveRule: 1560, value: 0.85 },
            { upToMinutesAboveRule: null, value: 1 },
          ],
        },
        heavy: { weight: 0.15, zeroAtPer100WorkedDays: 5, meaning: "zware overgangen (strafpunten ≥ 3) per 100 gewerkte dagen; 5 of meer = 0" },
      },
    },
    nights: {
      weight: 0.2,
      rationale: "Nachten in reeksen van drie of meer zijn voor de medewerker beter te dragen dan losse nachten.",
      parts: {
        clustering: { weight: 1, meaning: "(nachten in reeksen ≥ 3 + ½ × nachten in reeksen van 2) ÷ alle nachten; een losse nacht telt 0" },
      },
    },
    fairness: {
      weight: 0.15,
      rationale: "Wie in het ene rooster zit, hoort niet structureel zwaarder belast te zijn dan wie in het andere zit.",
      parts: {
        nights: { weight: 0.3, meaning: "variatiecoëfficiënt van nachten per regel tussen de nachtroosters; 100 × (1 − CV)" },
        shunting: { weight: 0.3, meaning: "variatiecoëfficiënt van rangeerdiensten per regel tussen alle roosters" },
        weekend: { weight: 0.25, meaning: "variatiecoëfficiënt van gewerkte weekenddagen per regel tussen alle roosters" },
        longDuties: { weight: 0.15, meaning: "variatiecoëfficiënt van lange diensten per regel (drempel uit regel RP_LONG_DUTY_THRESHOLD)" },
      },
    },
    stability: {
      weight: 0.1,
      rationale: "Continuïteit: wie zijn rooster kent, merkt een verschoven dagdeel meer dan een ander dienstnummer.",
      parts: {
        sameDuty: { weight: 0.4, meaning: "aandeel dienstdagen met hetzelfde dienstnummer als het huidige rooster" },
        sameDaypart: { weight: 0.6, meaning: "aandeel dienstdagen met hetzelfde dagdeel als het huidige rooster" },
      },
    },
  },

  lineScore: {
    rationale: "Eén slechte regel mag niet verdwijnen achter een goed gemiddelde; elke regel krijgt daarom een eigen score.",
    weights: { hours: 0.2, flow: 0.35, rest: 0.25, nights: 0.2 },
  },

  robust: {
    rationale: "De rangschikking kijkt naar het pakket én naar de slechtste regel, met een extra straf voor een uitschieter.",
    overallWeight: 0.85,
    worstLineWeight: 0.15,
    outlierGapPoints: 35,
    outlierPenaltyPerPoint: 0.25,
  },

  patternDistance: {
    rationale:
      "Hoe ver het patroon afwijkt van de officiële roosters: nachtreeksen, overgangen, reekslengtes, rust, weekendbelasting en wisselingen. " +
      "Geen deel van de totaalscore en geen oordeel; een meting van gelijkenis met het menselijke referentierooster.",
    parts: ["nightBlocks", "transitions", "streaks", "restBands", "weekendBurden", "switches"],
  },
} as const;

/**
 * Versie 2: geijkt op de zeven menselijke Dordrechtse roosters.
 *
 * ## Wat er anders is dan in versie 1, en waarom
 *
 * De gewichten van de onderdelen zijn niet veranderd. Veranderd is wat een
 * onderdeel meet, telkens omdat versie 1 een duidelijk menselijk goed patroon
 * slecht noemde of een verschil niet zag. De onderbouwing per wijziging staat
 * in `docs/human-roster-benchmark/human-roster-design-principles.md`.
 *
 * 1. Uren per regel: versie 1 strafte elke regel die van 40:00 afwijkt, met nul
 *    bij acht uur. De menselijke regels wijken een mediaan 5,2 uur af (p95 10,5
 *    uur) terwijl elk rooster als geheel binnen 48 minuten uitkomt. Die spreiding
 *    ligt in de structuur. Versie 2 straft alleen uitschieters buíten de band die
 *    mensen maken.
 * 2. Regelmaat: "gemiddelde reekslengte" is vervangen. Die lengte ligt vast in de
 *    structuur (RES-dagen breken reeksen) en gaf elk menselijk rooster een lage
 *    score. In de plaats: samenhang binnen een blok, wissels via rust, heen-en-
 *    weer op de klok, en de sprong in begintijd.
 * 3. Overgangen op de klok: een wissel van dagdeel die de begintijd minder dan
 *    drie uur verschuift, telt hooguit als lichte overgang. In 50+ Mix overlappen
 *    vroeg en laat; versie 1 noemde daar twee menselijke overgangen zwaar.
 * 4. Nachten: de waarde van een reeks loopt op met de lengte (menselijke reeksen:
 *    3, 5, 5, 6), en wat ná de reeks komt telt mee: alle menselijke reeksen gaan
 *    over rust naar laat, nooit naar vroeg.
 */
export const QUALITY_MODEL_V2 = {
  version: "quality-model-v2",
  basedOn: "quality-model-v1",
  learnedFromBenchmark: "DDR_BDU_05_10_2026",

  components: {
    hours: {
      weight: 0.2,
      rationale:
        "Het basisrooster als geheel hoort op het contractgemiddelde uit te komen; per regel wisselt het mee met de structuur, zoals in de menselijke roosters.",
      parts: {
        contract: { weight: 0.75, zeroAtMinutes: 60, meaning: "|gemiddelde weekomvang van het basisrooster − 40:00|; 0 min = 100, 60 min of meer = 0" },
        outliers: {
          weight: 0.25,
          naturalBandMinutes: 630,
          zeroBeyondBandMinutes: 240,
          meaning:
            "per regel: binnen ±10:30 van 40:00 (p95 van de menselijke regels) geen aftrek; daarbuiten lineair tot nul 4 uur verder",
        },
      },
    },
    flow: {
      weight: 0.2,
      rationale:
        "Dagdelen in blokken, wissels over rust heen, geen heen-en-weer van de klok en begintijden die niet ver springen — zoals in de menselijke roosters.",
      parts: {
        coherence: { weight: 0.25, meaning: "aandeel dagen in het dominante dagdeel van hun werkblok (blokken van twee of meer dagen)" },
        throughRest: { weight: 0.2, meaning: "aandeel dagdeelwissels tussen opeenvolgende diensten met minstens één dag ertussen" },
        oscillation: {
          weight: 0.15,
          zeroAtPer100WorkedDays: 5,
          // H09: was 180. Zie `penalty.minClockShiftMinutes`.
          minClockSwingMinutes: 60,
          meaning: "heen-en-weer A → B → A (hoogstens één dag ertussen per stap) waarbij de begintijd telkens meer dan een uur verspringt; 5 per 100 gewerkte dagen = 0",
        },
        penalty: {
          weight: 0.2,
          zeroAtPointsPerWorkedDay: 0.5,
          // H09: was 180. De enige officiële etiketwissels zonder echte
          // verschuiving zijn 19 en 41 minuten (50+MIX, laat → vroeg); elke
          // andere officiële directe wissel met meer dan 1 strafpunt verschuift
          // ruim 3 uur. Met 180 mocht de zoekmachine een laat van 09:47 gratis
          // laten volgen door een vroeg van 07:22 (13 uur rust), wat in geen
          // menselijk rooster voorkomt. 60 is de vrije begintijdsprong.
          minClockShiftMinutes: 60,
          meaning:
            "overgangsstrafpunten per gewerkte dag; een wissel die de begintijd hooguit een uur verschuift, is alleen een ander etiket en telt hooguit 1 punt",
        },
        startJitter: {
          weight: 0.2,
          freeMinutes: 60,
          fullMinutes: 240,
          meaning:
            "sprong in begintijd tussen opeenvolgende diensten in hetzelfde dagdeel; tot 60 min (de menselijke mediaan) geen aftrek, vanaf 240 min volledig",
        },
      },
    },
    rest: {
      weight: 0.15,
      rationale: "Rust boven het wettelijk minimum is comfort; herstel na nachten en het vermijden van zware overgangen ook.",
      parts: {
        surplus: {
          weight: 0.6,
          meaning: "rust tussen diensten op opeenvolgende dagen, boven de geplande dagelijkse rust (regel RP_DAILY_REST_PLANNED)",
          bands: [
            { upToMinutes: 0, value: 0 },
            { upToMinutes: 60, value: 0.25 },
            { upToMinutes: 180, value: 0.5 },
            { upToMinutes: 360, value: 0.8 },
            { upToMinutes: null, value: 1 },
          ],
        },
        recovery: {
          weight: 0.25,
          meaning: "tijd van het einde van een nachtreeks tot de volgende dienst, ten opzichte van de herstelrust na nachten (regel NIGHT_SEQUENCE_RECOVERY)",
          bands: [
            { upToMinutesAboveRule: 0, value: 0 },
            { upToMinutesAboveRule: 720, value: 0.6 },
            { upToMinutesAboveRule: 1560, value: 0.85 },
            { upToMinutesAboveRule: null, value: 1 },
          ],
        },
        heavy: { weight: 0.15, zeroAtPer100WorkedDays: 5, meaning: "zware overgangen (strafpunten ≥ 3, op de klok gemeten) per 100 gewerkte dagen; 5 of meer = 0" },
      },
    },
    nights: {
      weight: 0.2,
      rationale:
        "Nachten in reeksen, liefst van vijf of zes, en daarna eerst rust en dan geen vroege dienst — zoals in alle vier de menselijke nachtreeksen.",
      parts: {
        blocks: {
          weight: 0.7,
          valueByLength: { 1: 0, 2: 0.4, 3: 0.9, 4: 0.95, 5: 1 } as Readonly<Record<number, number>>,
          meaning: "waarde per reeks naar lengte (5 of meer = 1), gewogen naar het aantal nachten",
        },
        exit: {
          weight: 0.3,
          earlyAcceptableAfterMinutes: 4320,
          /**
           * H09: eerst de herstelrust, dan pas de richting. Elke uitgang met
           * minder herstel dan de regel (NIGHT_SEQUENCE_RECOVERY) is 0, ook als
           * er laat volgt; met genoeg herstel is laat 1 en vroeg 0,25 (0,5 na
           * 72 uur). De eerste versie gaf "nacht, vrij, laat" (30 uur) 0,5 en
           * "nacht, vrij, vrij, vroeg" (48 uur) 0: minder rust scoorde beter,
           * dezelfde fout als H04 maar nu in de meting, en het bijschaven
           * volgde die.
           */
          valueTable: {
            belowRule: { late: 0, early: 0 },
            atLeastRule: { late: 1, early: 0.25 },
            afterEarlyAcceptable: { late: 1, early: 0.5 },
          },
          meaning:
            "eerst herstel, dan richting: minder dan de herstelrust uit de regel = 0; daarna laat (of weer nacht) 1, vroeg 0,25 en na 72 uur 0,5",
        },
      },
    },
    fairness: QUALITY_MODEL_V1.components.fairness,
    stability: QUALITY_MODEL_V1.components.stability,
  },

  lineScore: {
    rationale: "Eén slechte regel mag niet verdwijnen achter een goed gemiddelde; elke regel krijgt daarom een eigen score.",
    weights: { hours: 0.2, flow: 0.35, rest: 0.25, nights: 0.2 },
  },

  robust: {
    ...QUALITY_MODEL_V1.robust,
    /**
     * H10 (werkopdracht §12, §13): het slechtste geval, naast het gemiddelde en
     * de slechtste regel. Eén extreem geval kost ongeveer wat tien punten op de
     * slechtste regel kost (0,15 × 10 = 1,5). Een uitgang na nachten telt
     * volledig; een overgang pas boven twee strafpunten en een werkblok pas
     * vanaf de tweede echte wissel, omdat het officiële rooster daar zelf zit
     * (laat → vroeg van 41 minuten in 50+ Mix; één wissel in BLM). Het
     * officiële rooster verliest hierdoor niets.
     */
    worstCase: {
      nightExitPoints: 1.5,
      transitionPoints: 0.5,
      transitionFreePoints: 2,
      blockSwitchPoints: 0.5,
      blockFreeSwitches: 1,
    },
  },

  patternDistance: {
    rationale:
      "Hoe ver de structuur afwijkt van de menselijke roosters: nachtreeksen, overgangen, rust, weekendbelasting, wissels, samenhang, sprongen in begintijd en wat er na nachten komt. " +
      "Geen deel van de totaalscore; een meting van gelijkenis in vorm, niet van gelijke dienstnummers.",
    parts: ["nightBlocks", "transitions", "restBands", "weekendBurden", "switches", "coherence", "startJitterBands", "nightExits"],
  },
} as const;

/**
 * Versie 3: de ronde "machinist preference intelligence" (september 2026).
 *
 * Versie 2 blijft ongewijzigd: de Final-Brain-metingen zijn daarmee gedaan en
 * moeten na te rekenen blijven. Versie 3 voegt toe (ontwerp:
 * `docs/v1.0.4-final-brain/machinist-preferences/design.md`):
 *
 * 1. De operationele ontwerpeisen van de gebruiker als harde geldigheid
 *    (`operational-requirements.ts`, USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT —
 *    geen wet of CAO): roostergemiddelde ≤ 40:00, vrijdag vóór een vrij weekend
 *    uiterlijk 23:59 (nachten uitgezonderd).
 * 2. Een onderdeel *voorkeur*: past de dienst bij het profiel, is geen rooster
 *    de restbak, liggen dagdiensten waar machinisten ze willen, krijgt elk
 *    geschikt rooster zijn deel van de populaire diensten, en begint het vrije
 *    weekend op tijd (`machinist-preference.ts`, MACHINIST_PREFERENCE en
 *    HUMAN_DOMAIN_INPUT). Het totaal wordt over de gewichten genormaliseerd, dus
 *    de onderlinge verhouding van de v2-onderdelen blijft gelijk.
 * 3. Nachtreeksen op ritme min belasting (`night-rhythm.ts`): drie nachten
 *    "vaak net niet lekker" (0,70, was 0,90), zeven niet structureel gewenst.
 * 4. De regelscore telt de affiniteit van de regel mee.
 */
export const QUALITY_MODEL_V3 = {
  ...QUALITY_MODEL_V2,
  version: "quality-model-v3",
  basedOn: "quality-model-v2",
  components: {
    ...QUALITY_MODEL_V2.components,
    nights: {
      ...QUALITY_MODEL_V2.components.nights,
      parts: {
        ...QUALITY_MODEL_V2.components.nights.parts,
        blocks: {
          weight: 0.7,
          valueByLength: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((l) => [l, nightBlockWorth(l)])) as Readonly<Record<number, number>>,
          source: "MACHINIST_PREFERENCE: ritme min belasting (night-rhythm.ts); geen fysiologische claim",
          meaning: "waarde per reeks: ritme min totale belasting; 1 = 0, 2 = 0,35, 3 = 0,70, 4 = 0,85, 5 = 0,95, 6 = 0,95, 7 = 0,70; gewogen naar het aantal nachten",
        },
      },
    },
    preference: {
      weight: 0.15,
      rationale:
        "Wat een machinist prettig vindt aan zijn profiel, en of populaire diensten eerlijk over de profielen zijn verdeeld. Voorkeur, geen monopolie.",
      sourceStatus: "MACHINIST_PREFERENCE / HUMAN_DOMAIN_INPUT",
      parts: {
        affinity: { weight: 0.3, meaning: "gemiddelde dienstaffiniteit (voorkeur 1, neutraal 0,6, minder passend 0,2; profile-affinity.ts)" },
        restDuties: { weight: 0.15, meaning: "1 − het grootste aandeel 'minder passend' in één rooster: geen profiel als restbak" },
        dayDuties: { weight: 0.2, meaning: "1 − afstand tussen werkelijke en beoogde verdeling van dagachtige diensten (relatieve gewichten, per regel genormaliseerd)" },
        popularFairness: { weight: 0.2, meaning: "elk geschikt rooster krijgt minstens de helft van het gemiddelde per regel aan aflopers en extreem vroege diensten" },
        weekendStart: { weight: 0.15, meaning: "eindtijd van de vrijdagdienst vóór een vrij weekend; 17:00 = 1, 23:00 = 0,7, afnemende meeropbrengst" },
      },
    },
  },
  lineScore: {
    ...QUALITY_MODEL_V2.lineScore,
    weights: { ...QUALITY_MODEL_V2.lineScore.weights, preference: 0.15 },
  },
  hard: {
    operational: OPERATIONAL_REQUIREMENTS_V1,
  },
} as const;

export type QualityModel = typeof QUALITY_MODEL_V1 | typeof QUALITY_MODEL_V2 | typeof QUALITY_MODEL_V3;
export type QualityModelVersion = QualityModel["version"];
/** Alle onderdelen die een model kán hebben; v1 en v2 kennen "voorkeur" niet (score null, gewicht 0). */
export type ComponentKey = keyof (typeof QUALITY_MODEL_V3)["components"];
export const COMPONENT_KEYS = Object.keys(QUALITY_MODEL_V3.components) as ComponentKey[];

/** Het gewicht van een onderdeel in dit model; 0 als het model het onderdeel niet kent. */
export function componentWeight(model: QualityModel, key: ComponentKey): number {
  const c = model.components as Readonly<Record<string, { readonly weight: number } | undefined>>;
  return c[key]?.weight ?? 0;
}

/** Het model waarmee nieuwe kandidaten worden beoordeeld en de zoekmachine rangschikt. */
export const CURRENT_QUALITY_MODEL = QUALITY_MODEL_V2;

export function qualityModelByVersion(version: string | null | undefined): QualityModel {
  if (version === QUALITY_MODEL_V1.version) return QUALITY_MODEL_V1;
  if (version === QUALITY_MODEL_V3.version) return QUALITY_MODEL_V3;
  return QUALITY_MODEL_V2;
}

export const COMPONENT_LABELS: Readonly<Record<ComponentKey, string>> = {
  hours: "Uren",
  flow: "Regelmaat",
  rest: "Rust",
  nights: "Nachten",
  fairness: "Eerlijkheid",
  stability: "Continuïteit",
  preference: "Voorkeur",
};
