import { CAO_RULES } from "./cao-ns-2024-2025";
import { MISSING_PACKAGES, PRODUCT_RULES, REGIONAL_RULES } from "./regio-west-2026";
import type { LegalStatus, Ruleset, RulesetMode } from "./types";

/**
 * Het actieve regelbestand.
 *
 * ## Waarom de juridische status niet automatisch groen wordt
 *
 * De aangeleverde CAO heet 2024–2025. Voor planning in 2026 mag het systeem
 * niet aannemen dat elke bepaling ongewijzigd geldt, en de Arbeidstijdenwet en
 * het Arbeidstijdenbesluit vervoer zijn helemaal niet aangeleverd. De status
 * blijft daarom `LEGAL_RULESET_NOT_CURRENTLY_VERIFIED` totdat NS bevestigt wat
 * geldt.
 *
 * In die staat draait het platform in modus `SOURCE_RULESET_SIMULATION`:
 * regels worden echt toegepast en beslissingen worden echt geblokkeerd, maar
 * elke uitkomst draagt het label dat hij niet is vrijgegeven voor
 * productieplanning. Dat is geen gebrek maar het gewenste gedrag — het
 * alternatief is een systeem dat mensen inroostert op grond van een
 * onbevestigde regelverzameling.
 *
 * ## Waarom productiemodus niet met een omgevingsvariabele te forceren is
 *
 * `RULESET_MODE=production` alléén is niet genoeg: `activeRuleset()` weigert
 * die modus zolang er blokkerende pakketten ontbreken. Een vlag in een
 * `.env`-bestand mag geen juridische bevestiging kunnen vervangen.
 */

const RULESET_VERSION = "2026.1-cao-2024-2025-transcribed";

/** De pakketten die productiemodus in de weg staan. */
function blockingPackages(): readonly string[] {
  return MISSING_PACKAGES.filter((entry) => entry.blocks.includes("PRODUCTION_MODE")).map(
    (entry) => entry.id,
  );
}

let cached: Ruleset | null = null;

export function activeRuleset(): Ruleset {
  if (cached) {
    return cached;
  }

  const requested: RulesetMode =
    process.env.RULESET_MODE === "production" ? "PRODUCTION" : "SOURCE_RULESET_SIMULATION";

  // Ontbrekende wettelijke pakketten wegen zwaarder dan een omgevingsvariabele.
  const legalStatus: LegalStatus = "LEGAL_RULESET_NOT_CURRENTLY_VERIFIED";
  const mode: RulesetMode =
    requested === "PRODUCTION" && blockingPackages().length === 0
      ? "PRODUCTION"
      : "SOURCE_RULESET_SIMULATION";

  cached = {
    version: RULESET_VERSION,
    mode,
    legalStatus,
    compiledAt: new Date().toISOString(),
    rules: [...CAO_RULES, ...REGIONAL_RULES, ...PRODUCT_RULES],
    missingPackages: MISSING_PACKAGES,
  };
  return cached;
}

/** Alleen voor tests: vervang het regelbestand. */
export function __setRulesetForTests(ruleset: Ruleset | null): void {
  cached = ruleset;
}

/** Mag er op grond van dit regelbestand daadwerkelijk gepland worden? */
export function isReleasedForProduction(ruleset = activeRuleset()): boolean {
  return ruleset.mode === "PRODUCTION" && ruleset.legalStatus === "LEGAL_RULESET_VERIFIED";
}

/** Eén zin voor bovenaan elk plannerscherm. */
export function rulesetBanner(ruleset = activeRuleset()): string {
  if (isReleasedForProduction(ruleset)) {
    return `Regelbestand ${ruleset.version} — vrijgegeven voor productieplanning.`;
  }
  return (
    `Regelbestand ${ruleset.version} — simulatie. Niet vrijgegeven voor ` +
    `productieplanning: ${ruleset.missingPackages.length} regelpakketten ontbreken.`
  );
}

/**
 * De zichtbare omgevingsstatus, voor gewone operationele schermen.
 *
 * ## Waarom dit géén eigen bron van waarheid is
 *
 * Dit is een afgeleide weergave van `ruleset.mode` en `ruleset.legalStatus` —
 * niets hieronder kan onafhankelijk op "PRODUCTION" gezet worden. Een aparte,
 * los instelbare omgevingsvlag zou kunnen gaan afwijken van de echte
 * regelstatus, en dat is precies het risico dat deze functie voorkomt: één
 * plek die PRODUCTION alleen teruggeeft wanneer `isReleasedForProduction` dat
 * ook echt zegt. Op dit moment is dat pad niet bereikbaar (zie
 * `activeRuleset`), dus deze functie geeft nu nooit `"PRODUCTION"` terug.
 */
export type EnvironmentStatus = "DEMO" | "FORMAL_VALIDATION_PENDING" | "PRODUCTION";

export function environmentStatus(ruleset = activeRuleset()): EnvironmentStatus {
  if (isReleasedForProduction(ruleset)) {
    return "PRODUCTION";
  }
  if (ruleset.mode === "PRODUCTION") {
    return "FORMAL_VALIDATION_PENDING";
  }
  return "DEMO";
}

export * from "./types";
export { RULE } from "./rule-ids";
export type { RuleId } from "./rule-ids";
