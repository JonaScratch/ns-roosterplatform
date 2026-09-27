import type { MemoryStatus } from "@/lib/generated/prisma/enums";
import type { RuleStatus } from "@/server/rules-engine/ruleset/types";

/**
 * Additieve, read-only projectielaag over de drie bestaande, elkaar niet
 * kennende statusmodellen (§ LYRA MASTER PROGRAM, `docs/lyra-knowledge/
 * knowledge-model.md` §4).
 *
 * ## Wat dit NIET is
 *
 * Dit vervangt `RuleStatus`, de operational-requirements-string, noch
 * `MemoryStatus`. Geen van de drie bronsystemen wordt hier veranderd, en
 * niets in `agent.ts`, de rules-engine of het leergeheugen roept deze
 * functies vandaag aan — dit is beschikbare infrastructuur voor een latere
 * Knowledge-UI of consistency-checker, niet een actief onderdeel van de
 * huidige agent-/validatorpijplijn. Bouwen zonder aan te sluiten is bewust:
 * de BEFORE-benchmark van deze ronde moet exact hetzelfde gedrag meten als
 * vóór dit bestand bestond.
 *
 * ## Waarom één gedeeld vocabulaire, en niet drie aparte enums laten staan
 *
 * Een menselijke lezer (of een toekomstig consistency-report) die wil weten
 * "is dit al bevestigd, of nog niet" moet vandaag drie verschillende enums
 * kennen. Dit bestand vertaalt ze naar één as, zodat één rapport ze samen
 * kan tonen zonder de bronsystemen zelf te hoeven aanpassen.
 */
export type CanonicalConfidence =
  /** Door NS of een mens expliciet bevestigd als actueel en juist. */
  | "FORMALLY_CONFIRMED"
  /** Overgenomen uit een bron, nog niet extern bevestigd. */
  | "TRANSCRIBED_UNVALIDATED"
  /** Eigen productparameter — geen externe bron nodig of aanwezig, ook niet als "onbevestigd" bedoeld. */
  | "LOCAL_UNVALIDATED"
  /** Voorgesteld, wacht op een menselijke beslissing. */
  | "PROPOSED"
  /** Door een mens afgewezen. */
  | "REJECTED"
  /** Ingetrokken; blijft leesbaar voor herleidbaarheid. */
  | "WITHDRAWN"
  /** Vervangen door een nieuwere versie. */
  | "SUPERSEDED"
  /** Regel/bron hoort te bestaan maar ontbreekt volledig. */
  | "MISSING";

/** Vertaalt een `RuleDefinition.status` (regelmotor) naar het gedeelde vocabulaire. */
export function fromRuleStatus(status: RuleStatus): CanonicalConfidence {
  switch (status) {
    case "VALIDATED":
      return "FORMALLY_CONFIRMED";
    case "SOURCE_TRANSCRIBED":
      return "TRANSCRIBED_UNVALIDATED";
    case "UNVALIDATED_LOCAL_PARAMETER":
      return "LOCAL_UNVALIDATED";
    case "NEEDS_POLICY_VALIDATION":
    case "POLICY_PENDING":
    case "UNRESOLVED":
      return "PROPOSED";
    case "NOT_SUPPLIED":
      return "MISSING";
  }
}

/**
 * Vertaalt de ad-hoc bronstatus-string van `operational-requirements.ts`.
 * Dit is vandaag een losse, letterlijke string-constante, geen `RuleStatus`-
 * waarde — precies het tweede parallelle systeem uit `knowledge-model.md` §1.
 * Er is bewust maar één invoerwaarde: het is de enige die vandaag bestaat.
 */
export function fromOperationalRequirementSource(source: "USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT"): CanonicalConfidence {
  void source;
  // Een door de gebruiker/roostercommissie gedateerd productbesluit is geen
  // externe (CAO/ATW) bron, maar ook geen onbevestigde gok — het platform
  // stelt deze eis zelf, bewust. Dat is functioneel het dichtst bij
  // "lokaal, niet extern gevalideerd", niet bij "ontbrekend" of "voorgesteld".
  return "LOCAL_UNVALIDATED";
}

/** Vertaalt een `AgentMemoryItem.status` (leergeheugen) naar het gedeelde vocabulaire. */
export function fromMemoryStatus(status: MemoryStatus): CanonicalConfidence {
  switch (status) {
    case "PROPOSED":
      return "PROPOSED";
    case "APPROVED":
      return "FORMALLY_CONFIRMED";
    case "REJECTED":
      return "REJECTED";
    case "WITHDRAWN":
      return "WITHDRAWN";
    case "SUPERSEDED":
      return "SUPERSEDED";
  }
}
