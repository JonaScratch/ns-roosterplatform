import { brandAssets } from "@/server/branding/assets";
import { BrandMark } from "./icons";

/**
 * Het beeldmerk, op één plek.
 *
 * Elke plek in de applicatie en in de export gebruikt dit component. Zodra het
 * aangeleverde bestand in `public/brand/` staat, verschijnt het overal
 * tegelijk — sidebar, aanmeldscherm, alle vier de omgevingen en de
 * printsjablonen — zonder dat er ergens anders iets hoeft te veranderen.
 *
 * ## Waarom er een terugvalvorm is en geen nagetekend logo
 *
 * Zolang het bestand ontbreekt, staat hier de bestaande neutrale vorm. Die is
 * uitdrukkelijk géén NS-teken en pretendeert dat ook niet te zijn. Een
 * nagetekend beeldmerk zou het gat onzichtbaar maken en precies daardoor
 * gevaarlijk zijn: in een exportbestand dat op een NS-roosterblad moet lijken,
 * is "lijkt erop" het verkeerde antwoord.
 */
export function NsLogo({
  on = "light",
  height = 22,
  className,
}: {
  /** De achtergrond waarop het teken staat. Bepaalt welke variant wordt gebruikt. */
  on?: "light" | "dark";
  height?: number;
  className?: string;
}) {
  const assets = brandAssets();
  const source = on === "dark" ? assets.onDark : assets.onLight;

  if (!source) {
    return (
      <BrandMark
        size={Math.round(height * 1.9)}
        className={className}
        aria-label="Roosterplatform"
      />
    );
  }

  return (
    // Bewust een gewone <img> en geen next/image: het bestand is klein, wordt op
    // elke pagina getoond en moet ook in een printsjabloon en een PDF werken,
    // waar de optimalisatiepijplijn van Next niet bij is. Bovendien staat de
    // beeldverhouding pas vast zodra het aangeleverde bestand er is, en
    // next/image wil die vooraf weten.
    // eslint-disable-next-line @next/next/no-img-element -- zie hierboven
    <img
      src={source}
      alt="NS"
      height={height}
      // Geen breedte: die volgt uit de verhoudingen van het aangeleverde
      // bestand. Zo kan het beeldmerk niet vervormen.
      style={{ height, width: "auto" }}
      className={className}
    />
  );
}

/** Ontbreekt het aangeleverde beeldmerk? Voor een zichtbare melding in beheer. */
export function brandAssetMissing(): boolean {
  return brandAssets().missing;
}
