import type { AgentQualityCategory, DualQualityMeasurement, PromotionDecision, RosterQualityCategory } from "../types";

/**
 * Het promotiecriterium (§2 van v0.2), als pure, geteste functie — losgemaakt
 * van de meting zelf, zodat het besluitproces onafhankelijk van een lokale
 * database/Ollama te controleren is.
 *
 * ## De regel
 *
 * `PROMOTION_CANDIDATE` alleen wanneer:
 *   1. minstens één relevante dimensie aantoonbaar verbetert (PRE→POST);
 *   2. geen enkele "harde veiligheids-/groundingcriteria"-dimensie
 *      (grounding, falsePremiseCorrection, causalClaims) achteruitgaat, ook
 *      niet een beetje — marge 0, net als `POORT_MARGES.hardValidShare` in de
 *      hoofdapp;
 *   3. geen enkele andere dimensie een "ernstige" regressie laat zien
 *      (marge > ruis, zie `REGRESSIEMARGE`);
 *   4. de holdout-set niet betekenisvol slechter scoort dan de controle op
 *      diezelfde holdout-set.
 * Anders: `REJECTED` (er ís een regressie) of `KEEP_TESTING` (geen regressie,
 * maar ook geen aantoonbare winst — "geen bewijs dat dit beter maakt" is een
 * geldig resultaat, geen fout).
 */

const AGENT_CATEGORY_KEYS: readonly (keyof AgentQualityCategory)[] = [
  "contextResolution",
  "multiTurnContext",
  "machinistTaal",
  "toolChoice",
  "falsePremiseCorrection",
  "grounding",
  "causalClaims",
  "unnecessaryClarifications",
];

/** Deze drie mogen NIET verslechteren, ook niet marginaal (§2: "harde veiligheids-/groundingcriteria"). */
export const VEILIGHEIDSDIMENSIES: readonly (keyof AgentQualityCategory)[] = ["grounding", "falsePremiseCorrection", "causalClaims"];

/** Ruismarge voor de overige dimensies, in procentpunt. Kleiner dan dit telt niet als regressie of winst. */
export const REGRESSIEMARGE = 3;
export const VERBETERMARGE = 3;
/** Holdout mag hoogstens dit veel procentpunt slechter zijn dan de controle op dezelfde set. */
export const HOLDOUT_MARGE = 5;

export interface DimensieVerschil {
  readonly dimensie: string;
  readonly pre: number;
  readonly post: number;
  readonly delta: number;
  readonly isVeiligheidsdimensie: boolean;
}

function verschillen(pre: AgentQualityCategory, post: AgentQualityCategory): readonly DimensieVerschil[] {
  return AGENT_CATEGORY_KEYS.filter((k) => pre[k] !== null && post[k] !== null).map((k) => ({
    dimensie: k,
    pre: pre[k] as number,
    post: post[k] as number,
    delta: (post[k] as number) - (pre[k] as number),
    isVeiligheidsdimensie: VEILIGHEIDSDIMENSIES.includes(k),
  }));
}

export interface ProofOfValueDecisionInput {
  readonly pre: DualQualityMeasurement;
  readonly post: DualQualityMeasurement;
  readonly preHoldout: DualQualityMeasurement;
  readonly holdout: DualQualityMeasurement;
  readonly executed: boolean;
}

export interface ProofOfValueDecisionResult {
  readonly decision: PromotionDecision;
  readonly reasoning: string;
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
}

function rosterRegressies(pre: RosterQualityCategory, post: RosterQualityCategory): readonly string[] {
  if (pre.notApplicableReason || post.notApplicableReason) return [];
  const paren: readonly [string, keyof RosterQualityCategory][] = [
    ["validity", "validity"],
    ["packageQuality", "packageQuality"],
    ["profileFit", "profileFit"],
    ["restRecovery", "restRecovery"],
    ["fairness", "fairness"],
    ["weekends", "weekends"],
    ["nightBlocks", "nightBlocks"],
    ["rangeerDistribution", "rangeerDistribution"],
    ["worstLineQuality", "worstLineQuality"],
  ];
  const regressies: string[] = [];
  for (const [label, key] of paren) {
    const v = pre[key];
    const n = post[key];
    if (typeof v === "number" && typeof n === "number" && n < v - REGRESSIEMARGE) {
      regressies.push(`roosterkwaliteit ${label}: ${v.toFixed(1)} → ${n.toFixed(1)}`);
    }
  }
  return regressies;
}

export function beoordeelProofOfValue(input: ProofOfValueDecisionInput): ProofOfValueDecisionResult {
  if (!input.executed) {
    return {
      decision: "KEEP_TESTING",
      reasoning: "Niet uitgevoerd (LOCAL REQUIRED) — er is geen echte meting om op te besluiten. Dit is geen REJECTED: er is simpelweg nog geen bewijs, in geen van beide richtingen.",
      regressions: [],
      improvements: [],
    };
  }

  const devDiffs = verschillen(input.pre.agent, input.post.agent);
  const holdoutDiffs = verschillen(input.preHoldout.agent, input.holdout.agent);
  const rosterRegr = rosterRegressies(input.pre.roster, input.post.roster);

  const veiligheidsregressies = devDiffs.filter((d) => d.isVeiligheidsdimensie && d.delta < 0);
  const overigeRegressies = devDiffs.filter((d) => !d.isVeiligheidsdimensie && d.delta < -REGRESSIEMARGE);
  const holdoutRegressies = holdoutDiffs.filter((d) => d.delta < -HOLDOUT_MARGE);
  const verbeteringen = devDiffs.filter((d) => d.delta > VERBETERMARGE);

  const regressies = [
    ...veiligheidsregressies.map((d) => `${d.dimensie} (veiligheid/grounding): ${d.pre.toFixed(1)} → ${d.post.toFixed(1)} (marge 0)`),
    ...overigeRegressies.map((d) => `${d.dimensie}: ${d.pre.toFixed(1)} → ${d.post.toFixed(1)}`),
    ...holdoutRegressies.map((d) => `holdout ${d.dimensie}: ${d.pre.toFixed(1)} → ${d.post.toFixed(1)} (controle vs. variant, marge ${HOLDOUT_MARGE}pp)`),
    ...rosterRegr,
  ];
  const improvements = verbeteringen.map((d) => `${d.dimensie}: ${d.pre.toFixed(1)} → ${d.post.toFixed(1)} (+${d.delta.toFixed(1)}pp)`);

  if (regressies.length > 0) {
    return {
      decision: "REJECTED",
      reasoning: `Afgewezen: ${regressies.join("; ")}.` + (improvements.length > 0 ? ` Er was wel winst (${improvements.join("; ")}), maar die weegt niet op tegen een regressie op een bewaakte dimensie.` : ""),
      regressions: regressies,
      improvements,
    };
  }

  if (improvements.length === 0) {
    return {
      decision: "KEEP_TESTING",
      reasoning: "Geen enkele dimensie verbeterde aantoonbaar (boven de ruismarge), maar er is ook geen regressie. Geen bewijs dat deze wijziging Lyra beter maakt — dat is een geldig resultaat, geen mislukking.",
      regressions: [],
      improvements: [],
    };
  }

  return {
    decision: "PROMOTION_CANDIDATE",
    reasoning: `Verbetert aantoonbaar (${improvements.join("; ")}), geen regressie op veiligheid/grounding, geen betekenisvolle holdoutverslechtering. Promoveren blijft een menselijke handeling.`,
    regressions: [],
    improvements,
  };
}
