import "server-only";
import { config } from "@/server/config/env";
import { LocalRulesEngine } from "./local-engine";
import { RemoteRulesEngine } from "./remote-engine";
import type { RulesEngine } from "./types";

/**
 * De ingang tot de Rules Engine.
 *
 * Alle services halen hun engine hier op. Welke implementatie zij krijgen is
 * een configuratiekeuze (`RULES_ENGINE_MODE`) en geen codewijziging — dat is de
 * hele reden dat er een interface tussen zit.
 */

let instance: RulesEngine | null = null;

export function rulesEngine(): RulesEngine {
  if (instance) {
    return instance;
  }
  const settings = config();
  instance =
    settings.RULES_ENGINE_MODE === "remote"
      ? new RemoteRulesEngine(settings.RULES_ENGINE_URL, settings.RULES_ENGINE_TOKEN)
      : new LocalRulesEngine();
  return instance;
}

/** Alleen voor tests: vervang de engine. */
export function __setRulesEngineForTests(engine: RulesEngine | null): void {
  instance = engine;
}

export { LocalRulesEngine } from "./local-engine";
export { RemoteRulesEngine, RulesEngineUnavailableError } from "./remote-engine";
export * from "./types";
export { DEFAULT_OBJECTIVE_WEIGHTS, DEFAULT_PRODUCT_PARAMETERS } from "./parameters";
export type { ProductParameters } from "./parameters";
export {
  activeRuleset,
  environmentStatus,
  isReleasedForProduction,
  rulesetBanner,
  type EnvironmentStatus,
} from "./ruleset/index";
export { evaluateAssignment } from "./assignment";
export {
  evaluateStructuralChange,
  type StructuralChangeDecision,
  type StructuralChangeRequest,
} from "./structure-change";
export type {
  ContextGap,
  MissingRule,
  ValidationOutcome,
  ValidationResult,
} from "./validation/result";
export type {
  AssignmentReason,
  AuthorisedException,
  PlanningStage,
  Protection,
} from "./validation/subject";
export type { Company, EmployeeGroup, RuleStatus } from "./ruleset/types";
export { evaluateCheck, evaluateChecks } from "./adapter";
