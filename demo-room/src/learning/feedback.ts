/**
 * Feedback Learning Engine (Phase G): wat iemand over Lyra of een rooster
 * zegt, vastleggen als `FeedbackEvent` en indelen naar het bereik waarvoor
 * het geldt — zonder dat de toon van de uitspraak het gezag bepaalt.
 *
 * ## De harde grens
 *
 * Feedback van een medewerker kan NOOIT een wettelijke, CAO- of formele
 * NS-regel worden. "Volgens de CAO mag ik na drie nachten niet vroeg" van een
 * machinist wordt vastgelegd als een claim over een regel (`claimsAuthority`),
 * met scope OPERATIONAL of EXPERIMENTAL — nooit als CAO of FORMAL_NS_RULE.
 * Alleen een auteur met de rol NS_FORMEEL mét een formele bronverwijzing kan
 * die scopes bereiken; ook dan is het een concept dat nog getoetst en door een
 * mens geactiveerd moet worden (concepts.ts), geen regel in het regelbestand.
 *
 * ## Waarom regels en geen taalmodel
 *
 * De indeling beslist mee over wat later mag gelden. Een taalmodel dat
 * "officieel" hoort, gaat dat te snel geloven — precies de faalmodus die de
 * claimverificatie bestrijdt. Deze indeling is daarom deterministisch en
 * uitlegbaar: elke beslissing heeft een reden die je kunt nalezen.
 */

export type FeedbackScope =
  | "PERSONAL"
  | "TEAM"
  | "DEPOT"
  | "PROFILE"
  | "GENERAL"
  | "OPERATIONAL"
  | "LOCAL_AGREEMENT"
  | "FORMAL_NS_RULE"
  | "CAO"
  | "EXPERIMENTAL";

/** Wie iets zegt, bepaalt het hoogst mogelijke gezag — niet hoe stellig het klinkt. */
export type AuteurRol = "MACHINIST" | "PLANNER" | "ROOSTERCOMMISSIE" | "NS_FORMEEL" | "ONTWIKKELAAR";

export interface FeedbackEvent {
  readonly id: string;
  readonly receivedAt: string;
  readonly author: { readonly id: string; readonly role: AuteurRol };
  readonly text: string;
  readonly context: {
    readonly locationCode: string;
    readonly rosterCode?: string | null;
    readonly profile?: string | null;
  };
  readonly source: "TEST_ROOM" | "CHAT" | "REVIEW" | "IMPORT";
  /** Verwijzing naar een formeel document (titel/artikel). Alleen relevant voor NS_FORMEEL. */
  readonly formalReference?: string | null;
  /** Het antwoord van Lyra waar deze feedback over gaat, als dat bekend is. */
  readonly linkedAnswerId?: string | null;
}

export interface FeedbackClassification {
  readonly scope: FeedbackScope;
  /** Uitlegbare redenen, in de volgorde waarin ze de beslissing bepaalden. */
  readonly reasons: readonly string[];
  /** De uitspraak beweert dat iets een (CAO-/wets-/NS-)regel is. */
  readonly claimsAuthority: boolean;
  /** Mag hier ooit een regel met juridisch gezag uit voortkomen? Voor medewerkers: altijd false. */
  readonly mayBecomeLegalRule: boolean;
  /** Voorkeur (hoe iemand het wil) of feit (hoe het is). */
  readonly nature: "PREFERENCE" | "FACT" | "SUGGESTION" | "COMPLAINT";
  /** Onderwerpsleutel voor het vinden van tegenstrijdigheden (concepts.ts). */
  readonly subjectKey: string;
  readonly polarity: "POSITIVE" | "NEGATIVE";
}

const WETTELIJK = /\b(cao|arbeidstijdenwet|atw|wettelijk|wet\b|verplicht|juridisch)/;
const FORMEEL_NS = /\b(ns-regel|formeel|officieel|volgens ns|ns heeft (bepaald|besloten)|beleid van ns)\b/;
const LOKALE_AFSPRAAK = /\b(afgesproken|afspraak|roostercommissie heeft (besloten|afgesproken)|lokaal akkoord|besloten in de (commissie|rc))\b/;
const EXPERIMENTEEL = /\b(probeer|proberen|misschien|zou kunnen|wat als|experiment|testen of)\b/;
const PERSOONLIJK = /\b(ik|mij|mijn|me)\b/;
const TEAM = /\b(wij|we|ons|onze|het team|collega's)\b/;
const STANDPLAATS = /\b(standplaats|depot|hier in|bij ons op|dordrecht|ddr)\b/;
const OPERATIONEEL = /\b(dienst \d{2,4}|materieel|wissel|perron|emplacement|spoor \d+|begint om|eindigt om|\d{1,2}:\d{2})\b/;
const PROFIELEN = /\b(vl|mix|ln|50mix|50\+|blm|vroeg-rooster|laat-rooster|nachtrooster|profiel)\b/;
const VOORKEUR = /\b(liever|voorkeur|prettiger|fijner|beter als|willen|wil|graag)\b/;
/** Een verzoek aan Lyra ("laat …", "kun je …", "zorg dat …") is een suggestie, geen feit. */
const VERZOEK = /^(laat|zorg|maak|verdeel|probeer)\b|\b(kun je|kan je|kunt u|zou je|wil je)\b/;
const KLACHT = /\b(ruk|zwaar|slecht|kut|vervelend|niet lekker|klote|te vol|te druk)\b/;
const NEGATIEF = /\b(geen|niet|nooit|zonder|liever niet|minder)\b/;

const STOPWOORDEN = new Set([
  "ik", "we", "wij", "ons", "onze", "mijn", "mij", "me", "de", "het", "een", "en", "of", "dat", "die", "dit", "is", "zijn",
  "wil", "willen", "liever", "graag", "geen", "niet", "nooit", "zonder", "minder", "meer", "heel", "erg", "hier", "bij",
  "op", "in", "van", "voor", "na", "naar", "met", "om", "te", "als", "dan", "ook", "wel", "zo", "maar", "want",
]);

/**
 * Een onderwerpsleutel zonder polariteit en zonder vulwoorden, zodat "liever
 * geen vroege dienst na een nacht" en "graag een vroege dienst na een nacht"
 * dezelfde sleutel krijgen — de basis voor tegenstrijdigheidsdetectie.
 */
export function onderwerpSleutel(tekst: string): string {
  const woorden = tekst
    .toLowerCase()
    .replace(/[^a-z0-9+\-\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWOORDEN.has(w))
    .map((w) => w.replace(/(en|e|s)$/, ""));
  return [...new Set(woorden)].sort().join(" ");
}

export function classifyFeedback(event: FeedbackEvent): FeedbackClassification {
  const t = event.text.toLowerCase();
  const reasons: string[] = [];
  const claimsAuthority = WETTELIJK.test(t) || FORMEEL_NS.test(t);
  const polarity: FeedbackClassification["polarity"] = NEGATIEF.test(t) ? "NEGATIVE" : "POSITIVE";
  const nature: FeedbackClassification["nature"] = KLACHT.test(t)
    ? "COMPLAINT"
    : EXPERIMENTEEL.test(t) || VERZOEK.test(t)
      ? "SUGGESTION"
      : VOORKEUR.test(t)
        ? "PREFERENCE"
        : "FACT";
  const subjectKey = onderwerpSleutel(event.text);
  const uit = (scope: FeedbackScope, mayBecomeLegalRule = false): FeedbackClassification => ({
    scope, reasons, claimsAuthority, mayBecomeLegalRule, nature, subjectKey, polarity,
  });

  // 1. Formeel gezag: alleen NS_FORMEEL met een formele bron.
  if (claimsAuthority) {
    if (event.author.role === "NS_FORMEEL" && event.formalReference) {
      reasons.push(`formele uitspraak door ${event.author.role} met bronverwijzing "${event.formalReference}"`);
      return uit(WETTELIJK.test(t) ? "CAO" : "FORMAL_NS_RULE", true);
    }
    reasons.push(
      `beweert gezag (${WETTELIJK.test(t) ? "CAO/wet" : "formeel NS"}), maar komt van ${event.author.role}` +
        `${event.formalReference ? "" : " zonder formele bron"} — wordt nooit een regel, alleen een te controleren claim`,
    );
    return uit(OPERATIONEEL.test(t) ? "OPERATIONAL" : "EXPERIMENTAL");
  }

  // 2. Lokale afspraak: alleen de roostercommissie (of formeel NS) kan die vastleggen.
  if (LOKALE_AFSPRAAK.test(t)) {
    if (event.author.role === "ROOSTERCOMMISSIE" || event.author.role === "NS_FORMEEL") {
      reasons.push(`lokale afspraak gemeld door ${event.author.role}`);
      return uit("LOCAL_AGREEMENT");
    }
    reasons.push(`noemt een afspraak, maar ${event.author.role} kan die niet vastleggen — behandeld als voorstel`);
    return uit("EXPERIMENTAL");
  }

  if (EXPERIMENTEEL.test(t)) {
    reasons.push("geformuleerd als iets om te proberen");
    return uit("EXPERIMENTAL");
  }
  if (OPERATIONEEL.test(t) && nature === "FACT") {
    reasons.push("feitelijke operationele uitspraak (dienst, tijd of materieel)");
    return uit("OPERATIONAL");
  }
  if (PROFIELEN.test(t)) {
    reasons.push("gaat over een roosterprofiel");
    return uit("PROFILE");
  }
  if (STANDPLAATS.test(t)) {
    reasons.push(`gaat over de standplaats (${event.context.locationCode})`);
    return uit("DEPOT");
  }
  if (TEAM.test(t)) {
    reasons.push("spreekt namens een groep ('wij', 'ons')");
    return uit("TEAM");
  }
  if (PERSOONLIJK.test(t)) {
    reasons.push("persoonlijke voorkeur of ervaring ('ik', 'mijn')");
    return uit("PERSONAL");
  }
  reasons.push("geen afbakening gevonden; algemeen");
  return uit("GENERAL");
}

/** Het hoogste conceptbereik dat uit deze feedback mag voortkomen. */
export function maxScopeFor(role: AuteurRol): readonly FeedbackScope[] {
  switch (role) {
    case "NS_FORMEEL":
      return ["CAO", "FORMAL_NS_RULE", "LOCAL_AGREEMENT", "DEPOT", "PROFILE", "TEAM", "GENERAL", "OPERATIONAL", "PERSONAL", "EXPERIMENTAL"];
    case "ROOSTERCOMMISSIE":
      return ["LOCAL_AGREEMENT", "DEPOT", "PROFILE", "TEAM", "GENERAL", "OPERATIONAL", "PERSONAL", "EXPERIMENTAL"];
    default:
      return ["DEPOT", "PROFILE", "TEAM", "GENERAL", "OPERATIONAL", "PERSONAL", "EXPERIMENTAL"];
  }
}
