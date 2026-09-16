/**
 * Redactie van waarden die het auditlog in gaan.
 *
 * Het auditlog bewaart oude en nieuwe waarden zodat een wijziging naderhand
 * uitlegbaar is. Precies dat maakt het ook een plek waar per ongeluk van alles
 * belandt: een wachtwoordhash omdat het hele account-object werd meegegeven,
 * een e-mailadres omdat het in de gewijzigde rij zat.
 *
 * Deze filter draait op elke waarde vóór opslag. Hij werkt op veldnamen, want
 * dat is wat je betrouwbaar kunt herkennen. Onbekende velden gaan ongewijzigd
 * door — de filter is een vangnet, geen vervanging voor bewust kiezen wat je
 * meegeeft.
 *
 * ## Waarom namen ook worden weggehaald
 *
 * Het auditlog werkt op personeelsnummers. Een weergavenaam die er via een
 * gewijzigd object in sluipt, maakt van een operationeel logboek stilletjes een
 * persoonsregister met een bewaartermijn van jaren.
 */

/** Velden die nooit in het auditlog thuishoren, ongeacht de context. */
const FORBIDDEN_KEYS: readonly RegExp[] = [
  /password/i,
  /wachtwoord/i,
  /passwordhash/i,
  /token/i,
  /secret/i,
  /geheim/i,
  /^hash$/i,
  /tokenhash/i,
  /email/i,
  /e-?mailadres/i,
  /displayname/i,
  /weergavenaam/i,
  /\bnaam\b/i,
  /firstname|lastname|achternaam|voornaam/i,
  /telefoon|phone/i,
  /bsn/i,
];

const PLACEHOLDER = "[geredigeerd]";
const MAX_DEPTH = 6;

function isForbidden(key: string): boolean {
  return FORBIDDEN_KEYS.some((pattern) => pattern.test(key));
}

/**
 * Maakt een waarde geschikt voor opslag in het auditlog.
 *
 * Diepte is begrensd: een diep genest of cyclisch object mag het schrijven van
 * een logregel niet laten vastlopen. Wat te diep zit wordt vervangen door een
 * markering, zodat zichtbaar blijft dát er meer was.
 */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (depth > MAX_DEPTH) {
    return "[te diep genest]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForAudit(item, depth + 1));
  }

  const primitive = typeof value;
  if (primitive === "string" || primitive === "number" || primitive === "boolean") {
    return value;
  }
  if (primitive === "bigint") {
    return String(value);
  }
  if (primitive !== "object") {
    // Functies en symbolen horen hier niet en worden niet stilzwijgend
    // omgezet naar iets dat op data lijkt.
    return "[niet-serialiseerbaar]";
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isForbidden(key) ? PLACEHOLDER : redactForAudit(item, depth + 1);
  }
  return output;
}

/** Alleen voor tests en documentatie: welke veldnamen worden geweerd. */
export function forbiddenAuditKeys(): readonly RegExp[] {
  return FORBIDDEN_KEYS;
}
