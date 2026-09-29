import { bevat } from "./refusals";

/**
 * De vorm van een verzoek: vraagt iemand om te rékenen, of om te lezen?
 *
 * Tot de AFTER-analyse van run 20260929-151948 stonden deze lijsten alleen in
 * de stub (`model/stub.ts`). Het lokale model besliste zelf of iets een
 * rekenverzoek was, en deed dat soms bij een gewone vraag over de huidige
 * stand: "Dit is toch geen lekker vrij weekend zo?" werd een voorstel om een
 * nieuwe kandidaatreeks te laten rekenen (F-DDR-LN-weekend) in plaats van een
 * blik op het weekend. Nu is dit de ene definitie die de stub én de
 * plancontrole in agent.ts (`plan-guard.ts`) gebruiken.
 *
 * Alle functies verwachten tekst in kleine letters (zoals de stub die al had)
 * of zetten hem zelf om.
 */

/**
 * Woorden die om rekenwerk vragen: daarvoor is een aparte bevoegdheid nodig.
 *
 * In twee soorten, en dat onderscheid is niet cosmetisch. "Start een
 * optimalisatie" kan niets anders betekenen en wordt meteen herkend. "Bereken"
 * of "onderzoek" kan óók een leesvraag zijn ("bereken het roostergemiddelde"),
 * en wordt daarom pas bekeken als geen enkele leesvraag past. Zou het andersom
 * staan, dan weigerde de agent vragen die hij gewoon mag beantwoorden.
 */
export const REKENVERZOEK_HARD: readonly string[] = [
  "optimalisatie",
  "optimaliseer",
  "laat rekenen",
  "laten rekenen",
  "doorrekenen",
  // Gevonden door verify:agent --zwaar: "laat eens uitrekenen of de nachten
  // beter kunnen" werd gelezen als een vraag over de nachtstructuur, omdat
  // "uitrekenen" nergens stond. Het werd dus netjes beantwoord in plaats van
  // voorgesteld door te rekenen.
  "uitrekenen",
  "reken uit",
  "laat berekenen",
  "laten berekenen",
  "nieuwe kandidaat",
  "nieuwe kandidaten",
  "kandidaten maken",
  "maak kandidaten",
  "genereer",
  // Gevonden bij M3: "Zoek een verdeling waarin Laat meer aflopers krijgt én ..."
  // werd gelezen als een vraag over de huidige verdeling, en netjes beantwoord
  // met de cijfers. Dat is geen antwoord op wat er gevraagd werd. Hele zinsdelen
  // en niet het losse "zoek": "zoek uit waar de nachten staan" blijft een
  // leesvraag.
  "zoek een verdeling",
  "zoek een indeling",
  "zoek een rooster",
  "zoek een variant",
  "zoek een alternatief",
  "vind een verdeling",
  "vind een indeling",
];
export const REKENVERZOEK_ZACHT: readonly string[] = ["onderzoek", "probeer", "verbeter", "bereken"];

/**
 * Vraagt dit om meerdere rondes achter elkaar?
 *
 * Dat is niveau C en een aparte bevoegdheid. Gevonden door M1: met alleen
 * rekenbevoegdheid vroeg de agent netjes waarop hij moest sturen, en liep het
 * verschil tussen "één opdracht" en "blijf net zolang zoeken" stil weg.
 */
export const meerdereRondes = (tekst: string): boolean =>
  // Ook uitgeschreven getallen: "je mag drie rondes" is precies de zin waarmee
  // iemand om niveau C vraagt zonder het zo te noemen.
  /\b(twee|drie|vier|vijf|zes|zeven|acht|negen|tien|\d+)\s*(rondes?|keer|pogingen)\b/.test(tekst) ||
  /\brondes\b/.test(tekst) ||
  bevat(tekst, "meerdere rondes", "meer rondes", "blijf zoeken", "net zolang", "blijf proberen", "zolang tot");

/** Vraagt deze tekst — in welke formulering ook — om een rekenopdracht? */
export function vraagtOmTeRekenen(tekst: string): boolean {
  const t = tekst.toLowerCase();
  return bevat(t, ...REKENVERZOEK_HARD) || bevat(t, ...REKENVERZOEK_ZACHT) || meerdereRondes(t);
}
