import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Het officiële beeldmerk, als aangeleverd bestand.
 *
 * ## Waarom hier niets wordt getekend
 *
 * Een logo is een beeldmerk van de organisatie. Het namaken, benaderen of "in
 * de stijl van" tekenen levert iets op dat op het echte lijkt en het niet is —
 * en dat is precies wat je in een exportbestand dat op een roosterblad van NS
 * moet lijken, niet wilt hebben. Deze module doet daarom maar één ding: kijken
 * of het aangeleverde bestand er staat.
 *
 * ## Wat er gebeurt als het er niet staat
 *
 * Dan blijft de bestaande neutrale vorm staan — uitdrukkelijk geen NS-teken —
 * en meldt de applicatie dat de asset ontbreekt. Beter een zichtbaar gat dan een
 * nagetekend logo dat later voor echt wordt aangezien.
 *
 * ## Eén canoniek bestand
 *
 * `public/brand/ns-logo.svg` is het aangeleverde beeldmerk en de enige bron.
 * Er staat bewust geen terugvallijst met andere bestandsnamen meer: zolang die
 * er was, kon een oude asset blijven meedraaien zonder dat iemand het merkte —
 * en dan hangt het van de volgorde in een lijst af welk logo er op een blad
 * belandt.
 *
 * `public/brand/ns-logo-wit.svg` mag ernaast staan voor donkere achtergronden.
 * Ontbreekt die, dan wordt hetzelfde bestand gebruikt; er wordt niets omgekleurd.
 */

const BRAND_DIRECTORY = join(process.cwd(), "public", "brand");

/** De kandidaten per variant, op volgorde van voorkeur. */
const CANDIDATES = {
  onLight: ["ns-logo.svg"],
  onDark: ["ns-logo-wit.svg"],
} as const;

/** De naam van de canonieke asset, voor controles en foutmeldingen. */
export const CANONICAL_LOGO = "ns-logo.svg";

export interface BrandAssets {
  /** Pad vanaf de webroot, of null wanneer het bestand ontbreekt. */
  readonly onLight: string | null;
  readonly onDark: string | null;
  /** Is er helemaal geen aangeleverd beeldmerk? */
  readonly missing: boolean;
}

let cached: BrandAssets | null = null;

export function brandAssets(): BrandAssets {
  if (cached) {
    return cached;
  }

  const onLight = firstExisting(CANDIDATES.onLight);
  // Zonder aparte variant voor donkere achtergronden valt het op de lichte
  // terug. Dat is beter dan niets tonen, en het aangeleverde bestand bepaalt
  // zelf of dat leesbaar is — er wordt hier niets omgekleurd.
  const onDark = firstExisting(CANDIDATES.onDark) ?? onLight;

  cached = { onLight, onDark, missing: onLight === null };
  return cached;
}

function firstExisting(names: readonly string[]): string | null {
  for (const name of names) {
    if (existsSync(join(BRAND_DIRECTORY, name))) {
      return `/brand/${name}`;
    }
  }
  return null;
}

/** Alleen voor tests: leegt de cache. */
export function __resetBrandAssetsForTests(): void {
  cached = null;
  cachedDataUri = undefined;
}

/**
 * Het beeldmerk als data-URI, om in te sluiten in een document.
 *
 * Een roosterblad wordt opgeslagen, gemaild en afgedrukt. Een verwijzing naar
 * `/brand/ns-logo.svg` werkt alleen zolang de server bereikbaar is — precies
 * niet op het moment dat iemand het blad op papier of in zijn mailbox opent.
 * Vandaar ingesloten.
 *
 * Ontbreekt het bestand, dan komt er niets terug en staat er geen beeldmerk.
 * Er wordt niets vervangen.
 */
export function brandLogoDataUri(): string | null {
  if (cachedDataUri !== undefined) {
    return cachedDataUri;
  }
  const assets = brandAssets();
  if (!assets.onLight) {
    cachedDataUri = null;
    return null;
  }
  const bestand = join(BRAND_DIRECTORY, assets.onLight.replace("/brand/", ""));
  try {
    // Altijd SVG: de canonieke asset is er een, en een ander type zou hier
    // alleen kunnen belanden doordat er ergens een oud bestand is blijven staan.
    const inhoud = readFileSync(bestand);
    cachedDataUri = `data:image/svg+xml;base64,${inhoud.toString("base64")}`;
  } catch {
    cachedDataUri = null;
  }
  return cachedDataUri;
}

let cachedDataUri: string | null | undefined;
