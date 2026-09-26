import "server-only";
import { randomUUID } from "node:crypto";
import { loadSuite } from "../benchmark/run";
import { locationCode as defaultLocationCode } from "../config";
import * as logbook from "../store/logbook";
import { writeAutonomyResult } from "../store/autonomyResults";
import { AGENT_CATEGORY_KEYS } from "../proof/decision";
import { measure, runProofOfValue, type RunProofOfValueOptions } from "../proof/proofOfValue";
import { CONTROL, PROMPT_VARIANTS, type PromptVariant } from "../variants/promptVariants";
import type {
  AgentQualityCategory,
  AutonomyCapabilityTestResult,
  AutonomyCycleResult,
  AutonomyGate,
  CapabilityScorecardEntry,
  ComponentUsageEntry,
  ProofOfValueResult,
} from "../types";

/**
 * De Zelfstandigheidstest / Autonomy Capability Test (finale integratieronde,
 * §7-§13): "Onderzoek zelfstandig waar Lyra aantoonbaar zwak is. Kies één
 * relevante zwakte, formuleer een hypothese, maak een sandboxverbetering,
 * test die tegen dezelfde baseline en holdout, leer van het resultaat en
 * bepaal eerlijk of de variant beter is."
 *
 * ## Wat dit WEL is
 *
 * Een begrensde orkestratie bovenop de bestaande, al geteste bouwstenen: de
 * echte PRE-meting (`measure()`) om een zwakte te vínden zonder menselijke
 * hint, en de bestaande proof-of-value-pijplijn (`runProofOfValue()`, dus
 * PRE→POST(≥2)→holdout→regressiecontrole→besluit, ongewijzigd) om een
 * gekozen hypothese daadwerkelijk te testen. Geen nieuwe meetlogica, geen
 * nieuwe promotiecriteria — alleen: welke van de twee bestaande varianten
 * past bij de zwakste gemeten dimensie, en (als dat niets opleverde) welke
 * andere hypothese daarna, binnen een klein budget.
 *
 * ## Wat dit NIET is
 *
 * Geen model-fine-tuning en geen vrije, ongeleide hypothesegenerator — er
 * zijn twee vaste, al bestaande sandboxvarianten (`variants/promptVariants.ts`);
 * de "autonomie" zit in het zélf kiezen en verantwoorden welke van de twee
 * gezien de echte metingen relevant is, niet in het verzinnen van een derde.
 * §10: dit test agentverbetering (systeeminstructie/contextbeleid), nooit
 * model-weight training — `agentImprovementNote` hieronder zegt dat met
 * zoveel woorden, in elk resultaat.
 */

const MAX_CYCLES = 2; // zoveel losse, niet-CONTROL-varianten zijn er vandaag — zie promptVariants.ts
const DEFAULT_MAX_MINUTES = 10;

export interface AutonomyTestOptions {
  readonly runId?: string;
  readonly maxMinutes?: number;
  readonly locationCode?: string;
}

/** Injecteerbaar voor tests — zie `PublishSteps` in `publish/safePublish.ts` voor hetzelfde patroon. */
export interface AutonomyTestDependencies {
  readonly identifyWeakness: (runId: string, locationCode: string) => Promise<WeaknessProbe>;
  readonly runProofOfValue: (options: RunProofOfValueOptions) => Promise<ProofOfValueResult>;
}

export interface WeaknessProbe {
  readonly executed: boolean;
  readonly notExecutedReason: string | null;
  readonly weakestDimension: keyof AgentQualityCategory | null;
  readonly weakestScore: number | null;
}

async function echteIdentifyWeakness(runId: string, locationCode: string): Promise<WeaknessProbe> {
  const dev = loadSuite("dev");
  try {
    const meting = await measure(runId, "Zelfstandigheidstest — zwakteanalyse (PRE, production Lyra)", dev.items, undefined, locationCode, null, "PROMPT");
    const waarden = AGENT_CATEGORY_KEYS.map((k) => ({ k, v: meting.agent[k] })).filter((x): x is { k: keyof AgentQualityCategory; v: number } => typeof x.v === "number");
    if (waarden.length === 0) return { executed: false, notExecutedReason: "Geen enkele dimensie kon gemeten worden.", weakestDimension: null, weakestScore: null };
    const zwakste = waarden.reduce((a, b) => (b.v < a.v ? b : a));
    return { executed: true, notExecutedReason: null, weakestDimension: zwakste.k, weakestScore: zwakste.v };
  } catch (fout) {
    const reden = `Niet uitgevoerd: ${fout instanceof Error ? fout.message : String(fout)}. Waarschijnlijk ontbreekt een lokaal taalmodel of de database (LOCAL REQUIRED).`;
    logbook.log(runId, { kind: "ERROR", experimentId: null, message: reden });
    return { executed: false, notExecutedReason: reden, weakestDimension: null, weakestScore: null };
  }
}

export const DEFAULT_AUTONOMY_DEPENDENCIES: AutonomyTestDependencies = {
  identifyWeakness: echteIdentifyWeakness,
  runProofOfValue,
};

/** Welke van de twee bestaande sandboxvarianten past bij deze zwakte — expliciet, uitlegbaar, geen verzonnen derde optie. */
function kiesVariantVoorZwakte(dimensie: keyof AgentQualityCategory | null, uitgesloten: readonly string[]): { variant: PromptVariant; motivatie: string } {
  const kandidaten = PROMPT_VARIANTS.filter((v) => v.id !== CONTROL.id && !uitgesloten.includes(v.id));
  if (kandidaten.length === 0) throw new Error("Geen ongeprobeerde sandboxvariant meer over binnen dit budget.");
  if (dimensie === "toolChoice") {
    const toolVariant = kandidaten.find((v) => v.id === "variant-a-tool-hint");
    if (toolVariant) return { variant: toolVariant, motivatie: `Zwakste gemeten dimensie is toolChoice — Variant A dwingt toolgebruik vóór een oordeel dwingender af.` };
  }
  return { variant: kandidaten[0], motivatie: `Zwakste gemeten dimensie is ${dimensie ?? "onbekend (niet uitgevoerd)"} — ${kandidaten[0].label} is de meest relevante resterende, al bestaande sandboxvariant.` };
}

function scoreVoorDimensie(agent: AgentQualityCategory, dimensie: keyof AgentQualityCategory | null): number | null {
  if (!dimensie) return null;
  const v = agent[dimensie];
  return typeof v === "number" ? v : null;
}

export async function runAutonomyCapabilityTest(options: AutonomyTestOptions = {}, deps: AutonomyTestDependencies = DEFAULT_AUTONOMY_DEPENDENCIES): Promise<AutonomyCapabilityTestResult> {
  const runId = options.runId ?? `DR-AUTONOMY-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const startedAt = new Date().toISOString();
  const begin = Date.now();
  const maxMinutes = options.maxMinutes ?? DEFAULT_MAX_MINUTES;
  const locationCode = options.locationCode ?? defaultLocationCode();

  logbook.log(runId, {
    kind: "CHALLENGE_OR_GOAL",
    experimentId: null,
    message: "Zelfstandigheidstest gestart: onderzoek zelfstandig waar Lyra aantoonbaar zwak is, kies één zwakte, test een sandboxverbetering, leer van het resultaat.",
    data: { maxMinutes },
  });

  const cycles: AutonomyCycleResult[] = [];
  const geprobeerdeVarianten: string[] = [];
  let procesFout: string | null = null;
  let budgetBereiktVoorEersteCyclus = false;

  try {
    for (let i = 0; i < MAX_CYCLES; i += 1) {
      const verstrekenMinuten = (Date.now() - begin) / 60000;
      if (verstrekenMinuten >= maxMinutes) {
        logbook.log(runId, { kind: "BUDGET_REACHED", experimentId: null, message: `Wandklokbudget (${maxMinutes} min) bereikt vóór onderzoekscyclus ${i + 1}.` });
        if (i === 0) budgetBereiktVoorEersteCyclus = true;
        break;
      }

      const probe = await deps.identifyWeakness(runId, locationCode);
      const targetedWeakness = probe.weakestDimension ? `${probe.weakestDimension} (${probe.weakestScore?.toFixed(1)}%)` : "onbekend (zwakteanalyse niet uitgevoerd — LOCAL REQUIRED)";
      logbook.log(runId, {
        kind: "HYPOTHESIS",
        experimentId: null,
        message: probe.executed
          ? `Zwakte gevonden: ${targetedWeakness}.`
          : `Zwakteanalyse niet uitgevoerd (${probe.notExecutedReason}) — kan geen op-meting gebaseerde hypothese vormen.`,
      });

      if (!probe.executed) {
        // Geen echte meting mogelijk (LOCAL REQUIRED) — niets om verder te
        // proberen; de cyclus stopt eerlijk in plaats van een gok te loggen
        // als bewezen hypothese.
        break;
      }

      const { variant, motivatie } = kiesVariantVoorZwakte(probe.weakestDimension, geprobeerdeVarianten);
      geprobeerdeVarianten.push(variant.id);
      const hypothese =
        i === 0
          ? `Hypothese ${String.fromCharCode(65 + i)}: ${motivatie}`
          : `Hypothese ${String.fromCharCode(65 + i)} (na afwijzing van cyclus ${i}): ${motivatie}`;
      logbook.log(runId, { kind: "HYPOTHESIS", experimentId: null, message: hypothese, data: { variantId: variant.id } });

      const proof = await deps.runProofOfValue({ runId, variantId: variant.id, postRuns: 2, locationCode });
      cycles.push({ cycleIndex: i, targetedWeakness, hypothesis: hypothese, variantId: variant.id, variantLabel: variant.label, proof });

      if (proof.decision === "PROMOTION_CANDIDATE") {
        logbook.log(runId, { kind: "PROMOTION_DECISION", experimentId: null, message: `Cyclus ${i + 1}: ${variant.label} is een aantoonbare verbetering. Zelfstandigheidstest stopt hier — geen reden om budget verder te verbruiken.` });
        break;
      }
      logbook.log(runId, {
        kind: "VARIANT_REJECTED",
        experimentId: null,
        message: `Cyclus ${i + 1}: ${variant.label} verworpen/geen aantoonbare winst (${proof.decision}). ${proof.reasoning}`,
      });
      if (!proof.executed) break; // LOCAL REQUIRED — nog een cyclus proberen heeft geen zin zonder lokaal model
    }
  } catch (fout) {
    procesFout = fout instanceof Error ? fout.message : String(fout);
    logbook.log(runId, { kind: "ERROR", experimentId: null, message: `Onverwachte fout in de zelfstandigheidstest-orkestratie: ${procesFout}` });
  }

  const { gate, gateReasons } = bepaalGate(cycles, procesFout, budgetBereiktVoorEersteCyclus);
  const scorecard = bouwScorecard(cycles);
  const componentUsage = bouwComponentUsage(cycles);

  const result: AutonomyCapabilityTestResult = {
    id: randomUUID(),
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    maxMinutes,
    cycles,
    gate,
    gateReasons,
    scorecard,
    componentUsage,
    agentImprovementNote:
      "Dit test en verbetert uitsluitend agentgedrag via bestaande, additieve sandboxmechanismen (systeeminstructie/systemPromptOverride, contextbeleid). Er vindt geen model-weight training of fine-tuning van Qwen plaats — geen enkel resultaat hierboven mag als zodanig gelezen worden.",
    humanSummary: samenvatting(cycles, gate),
  };

  writeAutonomyResult(result);
  logbook.log(runId, { kind: "INFO", experimentId: null, message: `Zelfstandigheidstest afgerond: ${gate}. ${result.humanSummary}` });
  return result;
}

function bepaalGate(cycles: readonly AutonomyCycleResult[], procesFout: string | null, budgetBereiktVoorEersteCyclus: boolean): { gate: AutonomyGate; gateReasons: readonly string[] } {
  if (procesFout) return { gate: "FAILED", gateReasons: [`Onverwachte fout tijdens de test: ${procesFout}`] };
  if (budgetBereiktVoorEersteCyclus) return { gate: "PARTIAL", gateReasons: [`Wandklokbudget was al op vóór er ook maar één onderzoekscyclus kon starten — verhoog het budget en probeer opnieuw.`] };
  if (cycles.length === 0) return { gate: "PARTIAL", gateReasons: ["Geen enkele onderzoekscyclus kon starten — waarschijnlijk geen lokaal model/database bereikbaar (LOCAL REQUIRED)."] };
  const uitgevoerd = cycles.filter((c) => c.proof.executed);
  if (uitgevoerd.length === 0) {
    return { gate: "PARTIAL", gateReasons: ["Onderzoekslogica (zwakte→hypothese→variantkeuze) liep correct, maar geen enkele cyclus kon echt gemeten worden (LOCAL REQUIRED — geen lokaal model/database)."] };
  }
  if (uitgevoerd.length < cycles.length) {
    return {
      gate: "PARTIAL",
      gateReasons: [`${uitgevoerd.length}/${cycles.length} cyclus/cycli echt uitgevoerd; de rest liep vast op LOCAL REQUIRED.`],
    };
  }
  return {
    gate: "AUTONOMY_GATE_PASSED",
    gateReasons: [
      "Zwakte zelfstandig geïdentificeerd uit een echte meting, zonder menselijke hint over de oplossing.",
      "Sandboxvariant zelfstandig gekozen en getest via de bestaande PRE/POST(≥2)/holdout/regressiepijplijn.",
      "Productie is nergens aangeraakt (geen enkele aanroep naar activateVersion()/publishExperiment() in dit pad).",
      cycles.length > 1 ? "Een tweede, andere hypothese is geprobeerd na afwijzing van de eerste — dit is geen éénschots-poging." : "Eén cyclus was voldoende/mogelijk binnen dit budget.",
    ],
  };
}

function bouwScorecard(cycles: readonly AutonomyCycleResult[]): readonly CapabilityScorecardEntry[] {
  const uitgevoerd = cycles.filter((c) => c.proof.executed);
  const executed = uitgevoerd.length > 0;
  const localRequiredDetail = "Niet uitgevoerd: geen lokaal model/database bereikbaar in deze omgeving (LOCAL REQUIRED).";
  const enigeRegressie = uitgevoerd.some((c) => c.proof.regressions.length > 0);
  const enigeAfwijzing = uitgevoerd.some((c) => c.proof.decision !== "PROMOTION_CANDIDATE");
  const enigePromotie = uitgevoerd.find((c) => c.proof.decision === "PROMOTION_CANDIDATE");
  const item = (key: string, label: string, verdict: CapabilityScorecardEntry["verdict"], detail: string): CapabilityScorecardEntry => ({ key, label, verdict, detail });

  return [
    item("askLyra", "Lyra aanspreken", executed ? "JA" : "NEE", executed ? "askAgent() daadwerkelijk aangeroepen (via benchAnswer(), dezelfde weg als productie)." : localRequiredDetail),
    item("useKnowledge", "bestaande kennis gebruiken", executed ? "JA" : "NEE", executed ? "Elke meting liep via het echte antwoordpad van Lyra, inclusief haar bestaande contextkennis." : localRequiredDetail),
    item("useRosterRules", "roosterregels gebruiken", "NEE", "Prompt-/tool-routingvarianten raken de optimizer/roosterregels niet — dat pad is autonomous run/ENGINE_VARIANT, hier niet aangeroepen."),
    item("useMemory", "memory gebruiken", executed ? "JA" : "NEE", executed ? "askAgent() raadpleegt zijn ingebouwde memory-laag voor elk antwoord (dezelfde weg als productie); niet apart geverifieerd of dit tot een write leidde." : localRequiredDetail),
    item("runBenchmark", "benchmark uitvoeren", executed ? "JA" : "NEE", executed ? `${uitgevoerd.length} echte PRE/POST/holdout-meting(en) op de bevroren dev-/holdoutset.` : localRequiredDetail),
    item("identifyWeakness", "zwakte identificeren", executed ? "JA" : "NEE", executed ? `Zwakste gemeten dimensie: ${cycles[0]?.targetedWeakness ?? "onbekend"}.` : localRequiredDetail),
    item("formHypothesis", "hypothese formuleren", cycles.length > 0 && executed ? "JA" : "NEE", cycles.length > 0 && executed ? cycles.map((c) => c.hypothesis).join(" / ") : "Geen hypothese gevormd op basis van een echte meting."),
    item("buildVariant", "sandboxvariant maken", executed ? "JA" : "NEE", executed ? `Variant(en) gebouwd via systemPromptOverride: ${cycles.map((c) => c.variantLabel).join(", ")}.` : localRequiredDetail),
    item("testVariant", "variant werkelijk testen", executed ? "JA" : "NEE", executed ? "PRE→POST(≥2 onafhankelijke runs)→holdout→regressiecontrole daadwerkelijk doorlopen." : localRequiredDetail),
    item("recognizeRegression", "regressie herkennen", enigeRegressie ? "JA" : executed ? "NEE" : "NEE", enigeRegressie ? "Eén of meer cycli lieten een echte regressie zien, correct herkend en geblokkeerd." : executed ? "Geen regressie opgetreden tijdens deze run (geen bewijs tegen de detectielogica zelf — zie tests/demo-room/proofOfValueDecision.test.ts)." : localRequiredDetail),
    item("rejectBadVariant", "slechte variant afwijzen", enigeAfwijzing ? "JA" : executed ? "NEE" : "NEE", enigeAfwijzing ? "Minstens één variant kreeg REJECTED/KEEP_TESTING en is niet gepromoveerd." : executed ? "Iedere geteste variant verbeterde aantoonbaar — er was niets af te wijzen." : localRequiredDetail),
    item("learnFromPrevious", "van vorige experimenten leren", cycles.length > 1 ? "JA" : "NEE", cycles.length > 1 ? "Cyclus 2 koos expliciet een andere variant, gemotiveerd door de afwijzing van cyclus 1." : "Slechts één onderzoekscyclus was nodig of mogelijk binnen dit budget — leren-van-afwijzing kon niet aangetoond worden."),
    item("useOptimizer", "optimizer gebruiken", "NIET_GETEST", "Buiten scope van deze test — de optimizer hoort bij ENGINE_VARIANT/autonome onderzoekslussen, niet bij prompt-proof-of-value."),
    item("useValidator", "validator gebruiken", "NIET_GETEST", "Er is geen kandidaatrooster gegenereerd in deze test — er was niets te valideren."),
    item("generalizeToHoldout", "verbetering generaliseren naar holdout", enigePromotie ? "JA" : executed ? "NIET_GEVONDEN" : "NIET_GEVONDEN", enigePromotie ? `${enigePromotie.variantLabel} generaliseerde naar de holdout (geen betekenisvolle holdoutregressie).` : executed ? "Geen aantoonbare verbetering gevonden binnen dit budget — een geldig, informatief resultaat." : localRequiredDetail),
    item("protectProduction", "productie beschermd houden", "JA", "Dit pad roept nergens activateVersion()/publishExperiment() aan — structureel geverifieerd via proof/proofOfValue.ts, ongeacht de uitkomst hierboven."),
    item("fullLogbook", "volledig logboek produceren", "JA", `Elke stap van deze run staat in demo-room/logs/${cycles[0]?.proof.runId ?? "—"}.txt/.jsonl.`),
  ];
}

function bouwComponentUsage(cycles: readonly AutonomyCycleResult[]): readonly ComponentUsageEntry[] {
  const executed = cycles.some((c) => c.proof.executed);
  const comp = (component: string, usage: ComponentUsageEntry["usage"], detail: string): ComponentUsageEntry => ({ component, usage, detail });
  return [
    comp("askAgent()", executed ? "ACTUALLY_USED" : "FAILED", executed ? "Aangeroepen voor elke PRE/POST/holdout-meting, via benchAnswer()." : "Aanroep mislukte (LOCAL REQUIRED) — zie de ERROR-regel(s) in het logboek."),
    comp("benchAnswer() (bench-adapter)", executed ? "ACTUALLY_USED" : "FAILED", "Dezelfde ingang als de intelligentiebenchmark van de hoofdapp — geen aparte testroute."),
    comp("AgentMemoryItem/memory-laag", executed ? "ACTUALLY_USED" : "NOT_USED", "Onderdeel van askAgent()'s normale pad; niet los geverifieerd."),
    comp("validateCandidate() (validator)", "NOT_USED", "Geen kandidaatrooster gegenereerd — buiten scope van prompt-proof-of-value."),
    comp("CP-SAT-optimizer", "NOT_USED", "Niet aangeroepen — dit is geen ENGINE_VARIANT/autonome-onderzoekslus-test."),
    comp("startResearchLoop()/AgentResearchLoop", "NOT_USED", "Niet aangeroepen — zie hierboven."),
    comp("roosterregels/knowledge-services", "NOT_USED", "Prompt-/tool-routingvarianten raken dit domein niet."),
  ];
}

function samenvatting(cycles: readonly AutonomyCycleResult[], gate: AutonomyGate): string {
  if (cycles.length === 0) return "Geen enkele onderzoekscyclus kon starten.";
  const laatste = cycles[cycles.length - 1];
  const kern = laatste.proof.decision === "PROMOTION_CANDIDATE"
    ? `Vond binnen ${cycles.length} cyclus/cycli een aantoonbare verbetering (${laatste.variantLabel}).`
    : `Vond binnen ${cycles.length} cyclus/cycli geen aantoonbare verbetering — een geldig onderzoeksresultaat.`;
  return `${kern} (${gate})`;
}
