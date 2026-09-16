import "server-only";

/**
 * Snelheidsbegrenzing voor gevoelige eindpunten.
 *
 * ## Waarom dit in het geheugen zit, en waarom dat gemarkeerd staat
 *
 * De teller staat in het geheugen van dit proces. Dat werkt voor één instantie
 * en is genoeg voor ontwikkeling en test. Met meerdere instanties achter een
 * load balancer telt elke instantie apart, en dan is de feitelijke grens het
 * aantal instanties maal deze waarde.
 *
 * Dit is dus een placeholder met een echte werking, geen definitieve
 * voorziening. Bij uitrol hoort hier een gedeelde teller (Redis of gelijkwaardig)
 * achter te komen. De interface hieronder verandert daar niet van.
 *
 * De accountblokkade bij herhaald mislukt inloggen staat los hiervan en zit in
 * de database (`UserAccount.failedLoginCount`). Die werkt wél over instanties
 * heen — deze begrenzer is de eerste lijn, niet de enige.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  options: { readonly limit: number; readonly windowSeconds: number },
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowSeconds * 1000 });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= options.limit;
  return {
    allowed,
    remaining: Math.max(0, options.limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Ruimt verlopen tellers op.
 *
 * Zonder dit groeit de map met elk uniek sleutelwoord dat ooit langskwam — bij
 * een sleutel per IP-adres is dat een geheugenlek dat je pas na weken merkt.
 */
export function pruneRateLimits(now = Date.now()): number {
  let removed = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** Alleen voor tests. */
export function __resetRateLimits(): void {
  buckets.clear();
}
