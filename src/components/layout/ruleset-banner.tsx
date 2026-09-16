import Link from "next/link";
import { activeRuleset, isReleasedForProduction } from "@/server/rules-engine";

/**
 * De regelstatus, bovenaan elk scherm.
 *
 * ## Waarom dit niet één keer op een instellingenpagina staat
 *
 * Zonder deze balk ziet een medewerker "geen diensten beschikbaar" en een
 * planner een lege lijst, en beiden concluderen dat er niets is. In werkelijkheid
 * is er van alles, maar kan het systeem niet aantonen dat het mag. Dat verschil
 * verdwijnt zodra je het één klik verderop zet.
 *
 * De balk verdwijnt vanzelf zodra het regelbestand is vrijgegeven: hij is geen
 * vaste waarschuwing die mensen wegkijken, maar de weergave van een toestand.
 */
export function RulesetBanner() {
  const ruleset = activeRuleset();
  if (isReleasedForProduction(ruleset)) {
    return null;
  }

  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
      <span className="font-semibold">Simulatie — niet vrijgegeven voor productieplanning.</span>{" "}
      Het regelbestand is niet bevestigd als actueel en {ruleset.missingPackages.length}{" "}
      regelpakketten ontbreken. Beslissingen worden echt geblokkeerd, maar een lege lijst
      betekent hier vaak &quot;niet te beoordelen&quot; en niet &quot;niets beschikbaar&quot;.{" "}
      <Link href="/regels" className="font-semibold underline">
        Wat ontbreekt er
      </Link>
      .
    </div>
  );
}
