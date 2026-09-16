import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/server/config/env";

/**
 * Pseudonimisering van herkomstgegevens.
 *
 * IP-adres en user-agent zijn persoonsgegevens. Ze zijn tegelijk nuttig: een
 * sessie die opeens vanaf een andere plek gebruikt wordt, en een reeks mislukte
 * inlogpogingen, zijn signalen die je wilt kunnen zien.
 *
 * De oplossing is ze niet op te slaan maar wel te kunnen vergelijken. Wat in de
 * database komt is een HMAC met de servergeheime sleutel. Twee verzoeken van
 * dezelfde plek geven dezelfde waarde; uit die waarde is het IP-adres niet
 * terug te rekenen zonder de sleutel, en met de sleutel alleen door te raden.
 *
 * De sleutel roteren maakt oude vingerafdrukken onvergelijkbaar met nieuwe.
 * Dat is aanvaardbaar: het gaat om signalen op korte termijn.
 */

export function clientFingerprint(ip: string | null, userAgent: string | null): string {
  const material = `${ip ?? "onbekend"}|${userAgent ?? "onbekend"}`;
  return createHmac("sha256", config().SESSION_SECRET).update(material).digest("hex").slice(0, 32);
}

/**
 * Het IP-adres uit de headers van het verzoek.
 *
 * `x-forwarded-for` wordt alleen vertrouwd wanneer de applicatie achter een
 * proxy draait die hem zet. Achter een reverse proxy die de header niet
 * overschrijft, is hij door de client te vervalsen; daarom staat hier
 * uitsluitend de eerste waarde en wordt hij nergens voor autorisatie gebruikt.
 */
export function requestIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return headers.get("x-real-ip");
}

/** Vergelijking in constante tijd, voor tokens en hashes. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
