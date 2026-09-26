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

export const AGENT_CATEGORY_KEYS: readonly (keyof AgentQualityCategory)[] = [
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
/** §3 van de aanvullende opdracht: minimaal twee onafhankelijke POST-runs wanneer modelgedrag onderdeel is van de wijziging. */
export const MIN_POST_RUNS = 2;

/**
 * De dimensie die een variantcategorie beweert te verbeteren — en die dus
 * daadwerkelijk gemeten moet zijn, wil promotie ooit iets bewijzen (§ flight
 * recorder-aanvulling, "ZEER BELANGRIJK: TEST MOET BIJ VARIANT PASSEN"). Een
 * eerste echte run promoveerde `variant-a-tool-hint` (categorie
 * `TOOL_ROUTING`) puur op een groundingwinst, terwijl `toolChoice` `null`
 * bleef omdat geen enkel benchmarkitem een `expectedTools`-veld had — de
 * variant bewees dus nooit dat tool-routing zelf verbeterde. `PROMPT` heeft
 * bewust geen vaste primaire dimensie (een algemene systeeminstructie-tweak
 * is niet aan één dimensie gebonden); alleen categorieën met een duidelijke,
 * eigen claim staan hieronder.
 */
export const PRIMAIRE_DIMENSIE_PER_CATEGORIE: Partial<Record<"PROMPT" | "TOOL_ROUTING" | "CONTEXT_POLICY" | "ENGINE", keyof AgentQualityCategory>> = {
  TOOL_ROUTING: "toolChoice",
  CONTEXT_POLICY: "contextResolution",
};

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

/**
 * Per dimensie het gemiddelde en het slechtste van alle POST-runs.
 *
 * Twee verschillende meetlatten, met opzet: winst wordt beoordeeld op het
 * gemiddelde (één toevallige uitschieter naar boven mag geen promotie
 * opleveren), regressie wordt beoordeeld op de slechtste run (één
 * toevallige uitschieter naar beneden — vooral op een veiligheidsdimensie —
 * mag nooit worden weggemiddeld). "Nooit de beste run cherry-picken" geldt
 * dus in twee richtingen tegelijk.
 */
function meanEnMinOverRuns(runs: readonly AgentQualityCategory[]): { mean: AgentQualityCategory; min: AgentQualityCategory } {
  const dimensie = (k: keyof AgentQualityCategory): { mean: number | null; min: number | null } => {
    const waarden = runs.map((r) => r[k]).filter((v): v is number => typeof v === "number");
    if (waarden.length === 0) return { mean: null, min: null };
    return { mean: waarden.reduce((a, b) => a + b, 0) / waarden.length, min: Math.min(...waarden) };
  };
  const mean = {} as Record<keyof AgentQualityCategory, number | null>;
  const min = {} as Record<keyof AgentQualityCategory, number | null>;
  for (const k of AGENT_CATEGORY_KEYS) {
    const d = dimensie(k);
    mean[k] = d.mean;
    min[k] = d.min;
  }
  return {
    mean: { ...mean, latencyMs: runs.find((r) => r.latencyMs)?.latencyMs ?? null } as AgentQualityCategory,
    min: { ...min, latencyMs: runs.find((r) => r.latencyMs)?.latencyMs ?? null } as AgentQualityCategory,
  };
}

export interface ProofOfValueDecisionInput {
  readonly pre: DualQualityMeasurement;
  /**
   * Alle onafhankelijke POST-runs (§3 van de aanvullende opdracht: "geen
   * promotie op één toevallige modelrun"). Minimaal 1, maar de aanroeper
   * hoort er minimaal 2 te geven zodra modelgedrag onderdeel is van de
   * wijziging — dat controleert deze functie zelf niet af, dat is een
   * verantwoordelijkheid van `proofOfValue.ts` (`MIN_POST_RUNS`).
   */
  readonly postRuns: readonly DualQualityMeasurement[];
  readonly preHoldout: DualQualityMeasurement;
  readonly holdout: DualQualityMeasurement;
  readonly executed: boolean;
  /** Bepaalt of een primaire-dimensie-eis geldt (zie `PRIMAIRE_DIMENSIE_PER_CATEGORIE`). Ontbreekt: geen eis. */
  readonly variantCategory?: "PROMPT" | "TOOL_ROUTING" | "CONTEXT_POLICY" | "ENGINE";
}

export interface ProofOfValueDecisionResult {
  readonly decision: PromotionDecision;
  readonly reasoning: string;
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
  /** §"KNOWN WEAKNESSES AFTER RUN": dimensies die ondanks dit besluit zwak blijven (< 50%, en niet zelf net verbeterd). Nooit verborgen door een promotie. */
  readonly knownWeaknesses: readonly string[];
}

const ZWAKTE_DREMPEL = 50;
function bepaalBekendeZwaktes(postMean: AgentQualityCategory, alGenoemd: readonly DimensieVerschil[]): readonly string[] {
  return AGENT_CATEGORY_KEYS.filter((k) => {
    const v = postMean[k];
    return typeof v === "number" && v < ZWAKTE_DREMPEL && !alGenoemd.some((d) => d.dimensie === k);
  }).map((k) => `${k}=${(postMean[k] as number).toFixed(0)}%`);
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
      knownWeaknesses: [],
    };
  }

  if (input.postRuns.length === 0) throw new Error("beoordeelProofOfValue: postRuns mag niet leeg zijn");
  const { mean: postMean, min: postMin } = meanEnMinOverRuns(input.postRuns.map((r) => r.agent));

  // Winst: op het gemiddelde van alle POST-runs (§3 — één toevallige goede
  // run mag geen promotie opleveren). Regressie: op de slechtste run per
  // dimensie (§3 — "kritieke grounding/factual-integrity regressies blijven
  // blokkerend", ook als een andere run daarop wél goed scoorde).
  const winstDiffs = verschillen(input.pre.agent, postMean);
  const regressieDiffs = verschillen(input.pre.agent, postMin);
  const holdoutDiffs = verschillen(input.preHoldout.agent, input.holdout.agent);
  const rosterRegr = rosterRegressies(input.pre.roster, input.postRuns[0].roster);

  const veiligheidsregressies = regressieDiffs.filter((d) => d.isVeiligheidsdimensie && d.delta < 0);
  const overigeRegressies = regressieDiffs.filter((d) => !d.isVeiligheidsdimensie && d.delta < -REGRESSIEMARGE);
  const holdoutRegressies = holdoutDiffs.filter((d) => d.delta < -HOLDOUT_MARGE);
  const verbeteringen = winstDiffs.filter((d) => d.delta > VERBETERMARGE);

  const meervoud = input.postRuns.length > 1 ? ` (slechtste van ${input.postRuns.length} POST-runs)` : "";
  const regressies = [
    ...veiligheidsregressies.map((d) => `${d.dimensie} (veiligheid/grounding): ${d.pre.toFixed(1)} → ${d.post.toFixed(1)}${meervoud} (marge 0)`),
    ...overigeRegressies.map((d) => `${d.dimensie}: ${d.pre.toFixed(1)} → ${d.post.toFixed(1)}${meervoud}`),
    ...holdoutRegressies.map((d) => `holdout ${d.dimensie}: ${d.pre.toFixed(1)} → ${d.post.toFixed(1)} (controle vs. variant, marge ${HOLDOUT_MARGE}pp)`),
    ...rosterRegr,
  ];
  const improvements = verbeteringen.map(
    (d) => `${d.dimensie}: ${d.pre.toFixed(1)} → ${d.post.toFixed(1)}${input.postRuns.length > 1 ? ` (gemiddeld over ${input.postRuns.length} runs)` : ""} (+${d.delta.toFixed(1)}pp)`,
  );
  // §"KNOWN WEAKNESSES AFTER RUN": een verbetering elders mag nooit verbergen
  // dat andere dimensies zwak blijven (< 50%, en zelf niet net verbeterd).
  const knownWeaknesses = bepaalBekendeZwaktes(postMean, verbeteringen);

  if (regressies.length > 0) {
    return {
      decision: "REJECTED",
      reasoning: `Afgewezen: ${regressies.join("; ")}.` + (improvements.length > 0 ? ` Er was wel winst (${improvements.join("; ")}), maar die weegt niet op tegen een regressie op een bewaakte dimensie.` : ""),
      regressions: regressies,
      improvements,
      knownWeaknesses,
    };
  }

  if (improvements.length === 0) {
    return {
      decision: "KEEP_TESTING",
      reasoning: "Geen enkele dimensie verbeterde aantoonbaar (boven de ruismarge), maar er is ook geen regressie. Geen bewijs dat deze wijziging Lyra beter maakt — dat is een geldig resultaat, geen mislukking.",
      regressions: [],
      improvements: [],
      knownWeaknesses,
    };
  }

  // §"TEST MOET BIJ VARIANT PASSEN": een TOOL_ROUTING/CONTEXT_POLICY-variant
  // mag nooit promoveren op winst elders terwijl de dimensie die de variant
  // beweert te verbeteren zelf niet eens gemeten is (null) — anders bewijst
  // de promotie niet wat hij claimt te bewijzen.
  const primaireDimensie = input.variantCategory ? PRIMAIRE_DIMENSIE_PER_CATEGORIE[input.variantCategory] : undefined;
  if (primaireDimensie && postMean[primaireDimensie] === null) {
    return {
      decision: "KEEP_TESTING",
      reasoning:
        `Wel winst elders (${improvements.join("; ")}), maar de primaire dimensie voor deze variantcategorie ` +
        `(${input.variantCategory} → ${primaireDimensie}) is niet gemeten (geen benchmarkitem met een relevant verwacht ` +
        `criterium voor deze dimensie in de bevroren set) — dit bewijst dus niet dat de variant doet wat hij belooft. ` +
        `Voeg eerst een echt testgeval toe dat ${primaireDimensie} meetbaar maakt vóór promotie.`,
      regressions: [],
      improvements,
      knownWeaknesses,
    };
  }

  return {
    decision: "PROMOTION_CANDIDATE",
    reasoning:
      `Verbetert aantoonbaar (${improvements.join("; ")}), geen regressie op veiligheid/grounding, geen betekenisvolle holdoutverslechtering. ` +
      `Waarom PROMOTION_CANDIDATE: minstens één dimensie verbetert boven de ruismarge, geen enkele bewaakte of overige dimensie regresseert, en holdout laat geen betekenisvolle verslechtering zien. ` +
      `Welke onzekerheden blijven bestaan: ${knownWeaknesses.length > 0 ? knownWeaknesses.join(", ") + " blijven zwak ondanks deze verbetering." : "geen dimensie onder de " + ZWAKTE_DREMPEL + "%-drempel."} ` +
      `PROMOTION_CANDIDATE betekent uitsluitend "geschikt voor menselijke evaluatie", nooit "Lyra is nu bewezen algemeen beter". Promoveren blijft een menselijke handeling.`,
    regressions: [],
    improvements,
    knownWeaknesses,
  };
}
