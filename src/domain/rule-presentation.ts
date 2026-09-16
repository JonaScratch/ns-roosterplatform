import { BLOCKING_STATUSES, type RuleStatus } from "@/server/rules-engine/ruleset/types";

/**
 * Hoe de regelcatalogus aan een mens wordt getoond.
 *
 * ## Waarom dit los staat van het regelbestand
 *
 * Het regelbestand is ingedeeld naar herkomst: uit welke laag komt de regel, wat
 * is de juridische status, welk artikel. Dat is de indeling die je nodig hebt om
 * een beslissing te verantwoorden.
 *
 * Het is niet de indeling waarin iemand een vraag stelt. De Rooster Commissie
 * vraagt "hoeveel mag iemand achter elkaar rijden" en niet "welke regels hebben
 * laag CAO met status SOURCE_TRANSCRIBED". Deze module vertaalt het een naar het
 * ander, zonder aan het regelbestand zelf iets te veranderen: de herkomst blijft
 * volledig bewaard en blijft in het detail en in Beheer zichtbaar.
 *
 * ## Waarom "Nog te bevestigen" voorgaat
 *
 * Een regel die niets mag goedkeuren, is voor de commissie geen rustregel of
 * roosterregel maar een openstaand punt. Hem onder zijn onderwerp wegstoppen
 * betekent dat je alle zes de groepen moet openklappen om te zien wat er
 * blokkeert. Daarom staat de status vóór het onderwerp.
 */

export const RULE_GROUPS = [
  {
    id: "ARBEID_RUST",
    title: "Arbeids- en rustregels",
    intro:
      "Hoe lang iemand mag werken, hoeveel rust ertussen hoort en wat er voor nachtwerk " +
      "extra geldt. Deze regels gaan over de persoon en gelden onafhankelijk van welk " +
      "rooster hij rijdt.",
  },
  {
    id: "ROOSTER",
    title: "Roosterregels",
    intro:
      "Hoe een rooster als geheel in elkaar hoort te zitten: rustdagen, WTV, vrije zondagen, " +
      "rode weekenden en de gemiddelden waar een rooster over zijn cyclus aan moet voldoen.",
  },
  {
    id: "REGIO",
    title: "Regio West en Dordrecht",
    intro:
      "Afspraken die alleen in deze regio of op deze standplaats gelden. Zij komen bovenop de " +
      "landelijke regels en kunnen die niet oprekken.",
  },
  {
    id: "PLAATSING",
    title: "Dienstplaatsing",
    intro:
      "Wanneer een concrete dienst aan een concrete medewerker mag worden toegewezen: " +
      "standplaats, bevoegdheden, beschikbaarheid en de plek in het basisrooster.",
  },
  {
    id: "PROFIELEN",
    title: "Roosterprofielen",
    intro:
      "Welke dagdelen bij welk profiel horen. Dit is een harde grens en geen voorkeur: een " +
      "profiel zonder nacht wijst nachtwerk af, ook als het verder past.",
  },
  {
    id: "TE_BEVESTIGEN",
    title: "Nog te bevestigen",
    intro:
      "Deze regels kunnen op dit moment niets goedkeuren. Er ontbreekt een waarde, een besluit " +
      "of een eenduidige lezing van de bron. Elke beslissing die zo'n regel nodig heeft, wordt " +
      "geblokkeerd in plaats van geraden.",
  },
] as const;

export type RuleGroupId = (typeof RULE_GROUPS)[number]["id"];

/** De onderwerpen per regel, voor zover die niet uit de laag volgen. */
const ROOSTEROPBOUW = new Set([
  "R_DAY_ATTACHED_MIN",
  "R_DAY_DETACHED_MIN",
  "R_DAYS_PER_WEEK_AVG",
  "RO_DVP_COMBINED_MIN",
  "RO_DVP_DETACHED_MIN",
  "HOLIDAY_ATTACHED_MIN",
  "HOLIDAY_DETACHED_MIN",
  "MIN_FREE_SUNDAYS_52W",
  "RED_WEEKEND_INTERVAL_WEEKS",
  "RED_WEEKEND_MIN_REST",
  "WTV_DAYS_PER_YEAR_36H",
  "WTV_DAY_LATEST_START",
  "WITHDRAWN_WTV_GRANT_WITHIN_DAYS",
  "AVG_WEEKLY_HOURS_4W",
  "AVG_WEEKLY_HOURS_16W",
  "AVG_WEEKLY_HOURS_16W_MANY_NIGHTS",
  "MAX_WEEKLY_HOURS",
  "RT_PREFERRED_WINDOW_WEEKS",
  "RC_SHORTENED_WEEKLY_REST_INTERVAL_WEEKS",
  "RC_SHORTENED_WEEKLY_REST_MIN",
  "PARTTIME_DASH_DAY_MIN",
  "INDIVIDUAL_SCHEDULING_RESTRICTION",
]);

const PROFIELEN = new Set(["ROSTER_PROFILE_BOUNDS", "MIX_PROFILE_SPECIAL_RULES"]);

/**
 * In welke groep hoort deze regel op het scherm?
 *
 * De status gaat voor: wat niets kan goedkeuren, staat bij de openstaande
 * punten. Daarna beslist het onderwerp, en pas als laatste de laag.
 */
export function groupForRule(rule: {
  readonly id: string;
  readonly status: RuleStatus;
  readonly value: number | null;
  readonly source: { readonly layer: string };
}): RuleGroupId {
  if (BLOCKING_STATUSES.includes(rule.status) || rule.value === null) {
    return "TE_BEVESTIGEN";
  }
  if (PROFIELEN.has(rule.id)) {
    return "PROFIELEN";
  }
  if (rule.source.layer === "REGIONAL" || rule.source.layer === "LOCAL") {
    return "REGIO";
  }
  if (rule.source.layer === "PRODUCT_POLICY") {
    return "PLAATSING";
  }
  if (ROOSTEROPBOUW.has(rule.id)) {
    return "ROOSTER";
  }
  return "ARBEID_RUST";
}

/**
 * De waarschuwing die bij een regel hoort, in gewone taal.
 *
 * Geeft `null` wanneer er niets te melden valt. Dat is uitdrukkelijk het geval
 * bij `SOURCE_TRANSCRIBED`: dat is de normale toestand van bijna elke regel in
 * dit bestand, en een waarschuwing bij 60 van de 71 regels waarschuwt nergens
 * meer voor. Dat het regelbestand als geheel nog niet formeel is bevestigd,
 * staat één keer bovenaan het scherm — niet zestig keer in een tabel.
 */
export function attentionNotice(status: RuleStatus): string | null {
  switch (status) {
    case "UNRESOLVED":
      return (
        "De aangeleverde tekst is op meer dan één manier te lezen en het verschil maakt uit " +
        "voor de uitkomst. Er wordt niet gekozen: elke beslissing die deze regel nodig heeft, " +
        "wordt geblokkeerd totdat NS aangeeft welke lezing juist is."
      );
    case "UNVALIDATED_LOCAL_PARAMETER":
      return (
        "De regel bestaat, maar de waarde die voor deze standplaats geldt is niet aangeleverd. " +
        "Zonder die waarde valt niet vast te stellen of iets binnen de grens blijft."
      );
    case "NEEDS_POLICY_VALIDATION":
      return (
        "NS moet nog vaststellen of deze regel hard is of een afweging. Zolang dat niet " +
        "vaststaat, wordt hij niet toegepast om iets goed te keuren en ook niet overgeslagen."
      );
    case "POLICY_PENDING":
      return (
        "De regel is wel aangekondigd maar inhoudelijk nog niet uitgewerkt. Er is dus nog niets " +
        "om aan te toetsen."
      );
    case "NOT_SUPPLIED":
      return (
        "Deze regel hoort te bestaan maar is niet aangeleverd. Hij is niet ingevuld met een " +
        "aanname: wat ontbreekt, blijft zichtbaar ontbreken."
      );
    case "VALIDATED":
    case "SOURCE_TRANSCRIBED":
      return null;
  }
}

/** Het korte etiket bij een regel die aandacht vraagt. */
export const ATTENTION_LABEL = "LET OP";

/**
 * Wat een regel op dit moment kan.
 *
 * Drie uitkomsten, en het verschil is voor de commissie het enige dat telt:
 * de regel doet mee, de regel blokkeert, of de regel is bevestigd.
 */
export type RuleEffect = "BEVESTIGD" | "WORDT_TOEGEPAST" | "BLOKKEERT";

export function ruleEffect(rule: {
  readonly status: RuleStatus;
  readonly value: number | null;
}): RuleEffect {
  if (BLOCKING_STATUSES.includes(rule.status) || rule.value === null) {
    return "BLOKKEERT";
  }
  return rule.status === "VALIDATED" ? "BEVESTIGD" : "WORDT_TOEGEPAST";
}

export const EFFECT_LABELS: Readonly<Record<RuleEffect, string>> = {
  BEVESTIGD: "Bevestigd door NS",
  WORDT_TOEGEPAST: "Wordt toegepast",
  BLOKKEERT: "Blokkeert beslissingen",
};
