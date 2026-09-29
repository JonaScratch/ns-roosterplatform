/**
 * Kan er uit dit brondocument letterlijk geciteerd worden?
 *
 * ## Waarom dit naast de juridische status staat
 *
 * `legalStatus` zegt of een regel formeel geldt. Het zegt niets over of wij de
 * tekst van het document überhaupt hebben. Dat zijn twee verschillende vragen:
 * een regel kan "in de oorspronkelijke bewoording" zijn overgenomen uit een
 * document dat alleen als scan bestaat, en dan is die bewoording een
 * overtyping — geen tekst die een machine uit het document las.
 *
 * Zonder dit gegeven kon de agent niet anders dan raden: bij een vraag om een
 * letterlijk citaat zag hij alleen de regel en zijn samenvatting, en zei hij
 * soms dat "het document" iets niet bevatte. Wat het document bevat, weet het
 * platform niet; wat het wél weet, is of het de tekst heeft.
 *
 * ## Herkomst van deze gegevens
 *
 * `docs/source-inventory-phase-o.md` (inventaris van de aangeleverde
 * brondocumenten, met sha256) en `docs/lyra-knowledge/current-state.md`
 * ("Bronstatus — het echte beeld", geverifieerd met `npm run verify:bronnen`).
 * Een wijziging hier hoort bij een nieuwe inventaris van die bronnen.
 */

export type TekstToegang =
  /** De tekst is uit het document zelf gelezen (tekstlaag aanwezig). */
  | "MACHINE_READABLE"
  /** Het document is een scan zonder tekstlaag; wat er aan tekst is, is een overtyping. */
  | "SCAN_NO_TEXT_LAYER"
  /** Geen extern document: beleid van dit platform. */
  | "NO_EXTERNAL_DOCUMENT";

export type LetterlijkCiteren =
  | "FROM_MACHINE_READABLE_TEXT"
  /** Alleen uit een concept-transcriptie die nog door een mens gecontroleerd moet worden. */
  | "UNREVIEWED_TRANSCRIPTION_ONLY"
  | "NOT_APPLICABLE";

export interface BronTekst {
  readonly access: TekstToegang;
  readonly literalQuote: LetterlijkCiteren;
  readonly transcriptionStatus: "HUMAN_REVIEW_REQUIRED" | null;
  /** Eén zin, zoals de agent hem aan een mens mag doorgeven. */
  readonly uitleg: string;
}

const PER_DOCUMENT: Readonly<Record<string, BronTekst>> = {
  "CAO-NS-2024-2025": {
    access: "MACHINE_READABLE",
    literalQuote: "FROM_MACHINE_READABLE_TEXT",
    transcriptionStatus: null,
    uitleg: "De CAO-tekst is machineleesbaar; de regels zijn letterlijk uit die tekst overgenomen (niet formeel bevestigd).",
  },
  "ROOSTERKADERS-REGIO-WEST-2026": {
    access: "SCAN_NO_TEXT_LAYER",
    literalQuote: "UNREVIEWED_TRANSCRIPTION_ONLY",
    transcriptionStatus: "HUMAN_REVIEW_REQUIRED",
    uitleg:
      "Het ondertekende document is een scan zonder tekstlaag (niet machineleesbaar). Er bestaat alleen een concept-transcriptie die nog door een mens gecontroleerd moet worden; wat daarin staat, is geen vaststaande brontekst.",
  },
  "NS-ROOSTERPLATFORM": {
    access: "NO_EXTERNAL_DOCUMENT",
    literalQuote: "NOT_APPLICABLE",
    transcriptionStatus: null,
    uitleg: "Dit is beleid van het platform zelf, geen extern brondocument om uit te citeren.",
  },
};

/** `null` = onbekend: dan beweert het platform er ook niets over. */
export function bronTekst(documentCode: string): BronTekst | null {
  return PER_DOCUMENT[documentCode] ?? null;
}

/** Heeft deze bron een tekst waaruit letterlijk geciteerd kan worden als vaststaande brontekst? */
export function letterlijkCiteerbaar(b: BronTekst | null): boolean {
  return b?.literalQuote === "FROM_MACHINE_READABLE_TEXT";
}
