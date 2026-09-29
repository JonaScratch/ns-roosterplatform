import { gezagsClaims } from "../../../src/server/agent/claim-verification";
import { detecteerLekkage } from "../factory/manifest";
import type { PromptVariant } from "../variants/promptVariants";

/**
 * De validator: mag deze kandidaat überhaupt gemeten worden?
 *
 * Een meting kost minuten modeltijd; een kandidaat die al op papier niet mag,
 * hoort die tijd niet te krijgen. Dit zijn statische eisen aan de tekst zelf,
 * zonder model, vóór de benchmark:
 *
 * 1. publiceerbaar: de variant voegt tekst toe aan het eind van de
 *    basisinstructie, precies zoals `NS_PRODUCTION_PROMPT_FILE` dat live doet
 *    — anders is wat gemeten wordt niet wat live kan gaan;
 * 2. begrensd: niet leeg, niet langer dan `MAX_TEKENS`;
 * 3. geen holdout: geen reeks van acht woorden uit een holdoutvraag
 *    (dezelfde lekdetectie als de rechter);
 * 4. geen gezag: de instructie beweert zelf niets als "bevestigd" of
 *    "CAO-verplicht" — dat mag alleen uit een tool komen;
 * 5. geen feiten: geen regelidentificatie, dienstnummer of roostercode in de
 *    instructie. Een prompt die feiten vastzet, leert het model niet zoeken
 *    maar opzeggen.
 */

export const MAX_TEKENS = 1200;

export interface ValidatorUitkomst {
  readonly ok: boolean;
  readonly bevindingen: readonly string[];
}

export function valideerKandidaat(kandidaat: PromptVariant, holdoutTeksten: readonly string[]): ValidatorUitkomst {
  const bevindingen: string[] = [];
  const tekst = kandidaat.productionText ?? "";
  if (tekst.trim().length === 0) bevindingen.push("lege kandidaattekst");
  if (tekst.length > MAX_TEKENS) bevindingen.push(`kandidaattekst te lang (${tekst.length} > ${MAX_TEKENS} tekens)`);
  const basis = "\u0000BASIS\u0000";
  const toegepast = kandidaat.transform(basis, {} as never);
  if (!toegepast.startsWith(basis) || !toegepast.endsWith(tekst)) bevindingen.push("niet publiceerbaar: de variant voegt niet alleen tekst toe aan het eind van de basisinstructie");
  const lekken = detecteerLekkage(tekst, holdoutTeksten);
  if (lekken.length > 0) bevindingen.push(`bevat ${lekken.length} letterlijk(e) holdoutfragment(en)`);
  const claims = gezagsClaims(tekst);
  if (claims.length > 0) bevindingen.push(`bevat een gezagsclaim ("${claims[0].fragment}")`);
  const feit = tekst.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){1,5}\b|\b[0-9]{3}\b|(?<![A-Z0-9-])[A-Z]{3}-[A-Z0-9]{1,4}(?![A-Z0-9-])/);
  if (feit) bevindingen.push(`zet een feit vast in de instructie ("${feit[0]}")`);
  return { ok: bevindingen.length === 0, bevindingen };
}
