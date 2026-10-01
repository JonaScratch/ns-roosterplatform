import type { AgentQualityCategory } from "../types";
import type { PromptVariant } from "../variants/promptVariants";
import type { WeaknessProbe } from "../autonomy/capabilityTest";
import { klasseVan, leesSleutel, tekstVoorSamenstelling } from "./interventies";

/**
 * De kandidaatgenerator van de Development Sandbox (§ SCOPE CORRECTION —
 * "agent maakt experimentele wijziging").
 *
 * ## Waarom dit een eigen bestand is, en niet een derde variant in `promptVariants.ts`
 *
 * `variants/promptVariants.ts` bevat twee VASTE, hand-geschreven varianten —
 * `autonomy/capabilityTest.ts` kiest daar alleen tussen (§"Wat dit NIET is:
 * geen vrije, ongeleide hypothesegenerator"). De Sandbox-fase vraagt om meer
 * dan kiezen uit een vast menu: de ontwikkelkamer moet zelf, op basis van een
 * gemeten zwakte, een NIEUWE kandidaat kunnen constrúéren — dat is precies
 * wat dit bestand doet, additief naast (nooit in plaats van) de bestaande
 * varianten.
 *
 * ## Waarom regelgebaseerd, niet een losse LLM-aanroep
 *
 * Een kandidaatgenerator die zelf een taalmodel aanroept om een prompt-patch
 * te verzinnen is een legitiem vervolgstap (v2), maar zou dit mechanisme in
 * deze omgeving onmiddellijk LOCAL REQUIRED maken en niet-deterministisch
 * testbaar. Deze v1-generator is daarom een pure, deterministische functie:
 * gemeten zwakte → sjabloon → nieuwe, unieke `PromptVariant`. Dat maakt de
 * hele ontwikkelcyclus (diagnose → kandidaat → meten → besluit → versie)
 * volledig test- en reproduceerbaar, ook zonder Ollama/database — precies
 * wat nodig is om de MACHINERIE zelf te bewijzen (§ "disposable/synthetic
 * kandidaten mogen voor technische validatie").
 */

interface Sjabloon {
  readonly category: PromptVariant["category"];
  readonly productionText: string;
  readonly description: string;
}

/**
 * Eén sjabloon per gemeten dimensie — elk direct gemotiveerd door een
 * concreet, al waargenomen faalpatroon (zie `docs/lyra-knowledge/progress.md`,
 * "LOCAL BEFORE BUG #5": `E-klacht-3`/`E-klacht-4` "onderzoekt niets en
 * vraagt niet door, geeft direct een oordeel"; `F-DDR-*-weekend` "geeft een
 * oordeel over het weekend zonder het te onderzoeken").
 */
const SJABLONEN: Partial<Record<keyof AgentQualityCategory, Sjabloon>> = {
  toolChoice: {
    category: "TOOL_ROUTING",
    description: "Gemeten zwakte: toolgebruik vóór een oordeel. Sjabloon dwingt een expliciete tool-aanroep af vóórdat het model over een rooster/regel/verdeling oordeelt.",
    productionText:
      "HERHALING, want dit gaat weleens mis: je MAG NOOIT een oordeel geven over een rooster, regel of verdeling zonder eerst een tool te hebben aangeroepen die dat oordeel onderbouwt. Twijfel je of een tool nodig is? Roep hem dan aan.",
  },
  falsePremiseCorrection: {
    category: "PROMPT",
    description: "Gemeten zwakte: een foutieve aanname van de gebruiker wordt niet gecorrigeerd vóór het antwoord. Sjabloon eist eerst verifiëren, dan pas antwoorden.",
    productionText:
      "Voordat je een vraag beantwoordt die een aanname van de gebruiker bevat (bijvoorbeeld over een dienst, regel of verdeling), controleer eerst met een tool of die aanname klopt. Klopt hij niet, corrigeer dat expliciet vóór de rest van je antwoord — nooit stilzwijgend meegaan met een foutieve aanname.",
  },
  grounding: {
    category: "PROMPT",
    description: "Gemeten zwakte: een claim zonder toolresultaat als bewijs. Sjabloon eist een expliciete bronvermelding per feitelijke bewering.",
    productionText:
      "Elke feitelijke bewering over een rooster, regel of verdeling moet direct herleidbaar zijn tot een toolresultaat dat je in dit gesprek hebt opgehaald. Kun je geen toolresultaat aanwijzen dat een bewering onderbouwt, zeg dat dan expliciet in plaats van de bewering toch te doen.",
  },
  causalClaims: {
    category: "PROMPT",
    description: "Gemeten zwakte: een oorzakelijk verband wordt beweerd zonder het te onderzoeken. Sjabloon eist onderzoek vóór een oorzakelijke uitspraak.",
    productionText:
      "Beweer nooit dat iets de OORZAAK is van een uitkomst (bijvoorbeeld waarom een dienst, weekend of rooster er zo uitziet) zonder dat eerst met een tool te hebben onderzocht. Ontbreekt dat onderzoek, zeg dan dat de oorzaak niet vastgesteld kan worden — geen giswerk voordoen als verklaring.",
  },
  unnecessaryClarifications: {
    category: "PROMPT",
    description: "Gemeten zwakte: een klacht of vraag krijgt direct een oordeel zonder eerst te onderzoeken (het omgekeerde probleem van onnodig doorvragen: te snel oordelen zonder feiten). Sjabloon eist eerst de relevante feiten ophalen.",
    productionText:
      "Bij een klacht of vraag over eerlijkheid van een rooster of verdeling ('is dit eerlijk?', 'waarom ik?'): onderzoek eerst met de beschikbare tools wat er werkelijk aan de hand is, vóórdat je een oordeel geeft. Een oordeel zonder onderzoek is nooit toegestaan, ook niet als de vraag dringend klinkt.",
  },
  contextResolution: {
    category: "CONTEXT_POLICY",
    description: "Gemeten zwakte: context uit eerdere berichten wordt niet correct herleid (bijvoorbeeld welk rooster/welke dienst 'dit' of 'die' bedoelt). Sjabloon eist expliciet maken welke context is herleid.",
    productionText:
      "Als een vraag verwijst naar iets uit een eerder bericht in dit gesprek (bijvoorbeeld 'dat rooster', 'die dienst', 'daarna'), maak dan eerst voor jezelf expliciet naar welk concreet rooster/welke concrete dienst dit verwijst vóórdat je een tool aanroept — gok nooit welk eerder onderwerp bedoeld wordt.",
  },
  multiTurnContext: {
    category: "CONTEXT_POLICY",
    description: "Gemeten zwakte: informatie uit eerdere beurten in hetzelfde gesprek gaat verloren. Sjabloon eist expliciet vasthouden van eerder vastgestelde feiten.",
    productionText:
      "Feiten die je eerder in dit gesprek al met een tool hebt vastgesteld (bijvoorbeeld een roostercode, dienstnummer of periode) blijven geldig voor de rest van het gesprek — haal ze niet opnieuw op alsof je ze niet weet, en spreek ze niet tegen zonder een nieuwe tool-aanroep die dat rechtvaardigt.",
  },
  machinistTaal: {
    category: "PROMPT",
    description: "Gemeten zwakte: vaktaal/afkortingen worden niet correct gebruikt of uitgelegd. Sjabloon eist consistent, correct vakjargon.",
    productionText:
      "Gebruik de vaktaal van machinisten en planners consistent en correct (bijvoorbeeld 'rangeren', 'omloop', 'reservedienst') — introduceer geen eigen omschrijvingen voor bestaande vakterm en leg een term alleen uit als daarnaar gevraagd wordt.",
  },
};

const GENERIEK_SJABLOON: Sjabloon = {
  category: "PROMPT",
  description: "Geen dimensiespecifiek sjabloon beschikbaar voor deze zwakte — generieke herhaling van de kern-grondingseis.",
  productionText:
    "Controleer bij twijfel altijd eerst met een tool voordat je een oordeel of feitelijke bewering geeft — een aanname is nooit een vervanging voor een toolresultaat.",
};

/**
 * De eerste golf strategieën: drie manieren om dezelfde gemeten zwakte aan te
 * pakken. Het is een echte hypothese over HOE je een model instrueert, niet
 * alleen WAT:
 *
 * - REGEL: de eis als directe regel (het oorspronkelijke sjabloon);
 * - ZELFCONTROLE: dezelfde eis als controle vlak vóór het antwoord;
 * - WAAROM: de eis mét de reden erachter, zodat het model de bedoeling kan
 *   toepassen op gevallen die de regel niet letterlijk noemt.
 *
 * Dit is het BEGIN van de zoekruimte, niet de hele: raakt deze golf op, dan
 * stelt de regisseur (zoekruimte.ts) uit de lessen nieuwe samenstellingen van
 * interventies samen (interventies.ts). Elke strategie is een sleutel die
 * `leesSleutel` begrijpt; de tekst volgt uit de sleutel. Alle varianten voegen
 * tekst toe aan het eind van de basisinstructie, precies zoals publicatie dat
 * doet (`NS_PRODUCTION_PROMPT_FILE`): wat getest is, kan woord voor woord live.
 * Welke strategie per dimensie al verworpen is, weet `lessons.ts`; de
 * generator zelf onthoudt niets.
 */
export const STRATEGIEEN = ["REGEL", "ZELFCONTROLE", "WAAROM"] as const;
/** Een strategiesleutel: een van de drie hierboven, of een samenstelling (interventies.ts). */
export type Strategie = string;

/** De eis van een dimensie, of `null` als er geen dimensiespecifiek sjabloon is. */
export function eisVoorDimensie(dimensie: string): string | null {
  return SJABLONEN[dimensie as keyof AgentQualityCategory]?.productionText ?? null;
}

/** De kandidaattekst voor een dimensie en strategiesleutel — zuiver, ook voor de regisseur (lengtecontrole). */
export function tekstVoorStrategie(dimensie: string | null, strategie: Strategie): string {
  const sjabloon = (dimensie && SJABLONEN[dimensie as keyof AgentQualityCategory]) || GENERIEK_SJABLOON;
  const samenstelling = leesSleutel(strategie);
  if (!samenstelling) throw new Error(`onbekende strategiesleutel: ${strategie}`);
  return tekstVoorSamenstelling(sjabloon.productionText, samenstelling, eisVoorDimensie);
}

let volgnummer = 0;

export function generateCandidateFromWeakness(weakness: WeaknessProbe, uitgeslotenIds: readonly string[] = [], strategie: Strategie = "REGEL"): PromptVariant {
  const dimensie = weakness.weakestDimension;
  const sjabloon = (dimensie && SJABLONEN[dimensie]) ?? GENERIEK_SJABLOON;
  const productionText = tekstVoorStrategie(dimensie ?? null, strategie);
  const familie = klasseVan(strategie);

  let id: string;
  do {
    volgnummer += 1;
    id = strategie === "REGEL" ? `experiment-${dimensie ?? "algemeen"}-${volgnummer}` : `experiment-${dimensie ?? "algemeen"}-${strategie.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${volgnummer}`;
  } while (uitgeslotenIds.includes(id));

  const zwakteBeschrijving = dimensie ? `${dimensie} (${weakness.weakestScore?.toFixed(1) ?? "onbekend"}%)` : "onbekende dimensie";

  return {
    id,
    label: `Gegenereerde kandidaat — ${dimensie ?? "algemeen"} (${strategie})`,
    description: `Autonoom gegenereerd op basis van gemeten zwakte ${zwakteBeschrijving}, strategie ${strategie} (interventieklasse ${familie}). ${sjabloon.description}`,
    category: sjabloon.category,
    productionText,
    transform: (basis) => `${basis}\n\n${productionText}`,
    hypothesis: { dimensie: dimensie ?? "algemeen", strategie, familie },
  };
}
