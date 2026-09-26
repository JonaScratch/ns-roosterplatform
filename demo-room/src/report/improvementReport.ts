import type { ExperimentRecord, LyraVersion } from "../types";

/**
 * Het Verbeteringsrapport (§ aanvulling "VERPLICHT — UITLEGBARE
 * VERBETERINGEN"), in drie leesniveaus. Automatisch gegenereerd zodra een
 * experiment `PROMOTION_CANDIDATE` wordt — geen los werk, dezelfde data als
 * het journaal, alleen anders gepresenteerd per doelgroep.
 */

export interface ImprovementReportInput {
  readonly experiment: ExperimentRecord;
  readonly variantLabel: string;
  readonly variantDescription: string;
  readonly preVersion: LyraVersion | null;
  readonly candidateChanges: readonly string[];
}

function categorieVerschillen(before: Record<string, number>, after: Record<string, number>): { beter: string[]; gelijk: string[]; slechter: string[] } {
  const beter: string[] = [];
  const gelijk: string[] = [];
  const slechter: string[] = [];
  for (const k of Object.keys(after)) {
    const v = before[k];
    const n = after[k];
    if (v === undefined) continue;
    if (n > v + 3) beter.push(`${k}: ${v.toFixed(1)} → ${n.toFixed(1)}`);
    else if (n < v - 3) slechter.push(`${k}: ${v.toFixed(1)} → ${n.toFixed(1)}`);
    else gelijk.push(k);
  }
  return { beter, gelijk, slechter };
}

/** 1. Voor Jonathan — gewone taal, geen technische rommel. */
export function renderForJonathan(input: ImprovementReportInput): string {
  const { experiment } = input;
  const { beter, slechter } = categorieVerschillen(experiment.baselineMetrics ?? {}, experiment.qualityMetrics ?? {});
  return [
    `# Wat heeft Lyra geleerd? — ${input.variantLabel}`,
    "",
    "## Wat was het probleem?",
    experiment.reason || "(niet nader omschreven)",
    "",
    "## Wat dacht Lyra dat er mis was?",
    experiment.hypothesis,
    "",
    "## Wat is er veranderd?",
    input.variantDescription,
    "",
    "## Resultaat",
    beter.length > 0 ? `Beter geworden: ${beter.join(", ")}.` : "Geen dimensie ging aantoonbaar vooruit.",
    slechter.length > 0 ? `Let op — deze gingen achteruit: ${slechter.join(", ")}.` : "Niets ging achteruit.",
    "",
    "## Conclusie",
    experiment.nextRecommendation ?? "(geen aanbeveling vastgelegd)",
    "",
    experiment.decision === "PROMOTION_CANDIDATE"
      ? "Dit is veilig genoeg bevonden om aan jou voor te leggen. Publiceren blijft jouw beslissing — zie de knop 'Publish naar Lyra' in het dashboard."
      : "Dit wordt (nog) niet voorgesteld voor publicatie.",
  ].join("\n");
}

/** 2. Voor ChatGPT/Claude — technisch overdraagbaar, met experiment-ID's en configuratieverschillen. */
export function renderForClaude(input: ImprovementReportInput): string {
  const { experiment } = input;
  return [
    `# Technisch verslag — experiment ${experiment.id}`,
    "",
    `runId: \`${experiment.runId}\` · soort: \`${experiment.soort}\` · besluit: \`${experiment.decision}\``,
    `voorgangerversie: \`${input.preVersion?.id ?? "(geen — baseline)"}\``,
    "",
    "## Configuratie van dit experiment",
    "```json",
    JSON.stringify(experiment.configuration, null, 2),
    "```",
    "",
    "## Gewijzigde bestanden/configuraties (kandidaat, nog niet gepubliceerd tenzij hieronder anders vermeld)",
    input.candidateChanges.length > 0 ? input.candidateChanges.map((c) => `- ${c}`).join("\n") : "- (nog geen bestandswijziging — leeft alleen als systemPromptOverride in het geheugen van het testproces)",
    "",
    "## PRE (baseline)",
    "```json",
    JSON.stringify(experiment.baselineMetrics, null, 2),
    "```",
    "## POST (kandidaat)",
    "```json",
    JSON.stringify(experiment.qualityMetrics, null, 2),
    "```",
    "## Verschil",
    "```json",
    JSON.stringify(experiment.comparisonWithBaseline, null, 2),
    "```",
    "",
    "## Bekende onzekerheden",
    "- Holdout-cijfers staan niet in dit `ExperimentRecord` zelf; zie het bijbehorende `ProofOfValueResult` in `reports/history/` voor de volledige PRE/POST/holdout-drieslag.",
    "- Latency is gemeten op deze machine/dit moment en kan lokaal afwijken.",
    "",
    "## Relevante codepaden",
    "- `demo-room/src/proof/proofOfValue.ts` (meting)",
    "- `demo-room/src/proof/decision.ts` (promotiecriterium)",
    "- `demo-room/src/publish/safePublish.ts` (publicatie, indien van toepassing)",
    "- `src/server/agent/model/local.ts` (`productionOverrideFromDisk`, `systemPromptOverride`)",
  ].join("\n");
}

/** 3. Machine-readable — zodat een volgende Demo Room-run dit zelf kan hergebruiken. */
export function buildImprovementReportJson(input: ImprovementReportInput): Record<string, unknown> {
  return {
    schema: "demo-room-improvement-report/1",
    experimentId: input.experiment.id,
    runId: input.experiment.runId,
    variantId: (input.experiment.configuration as { variantId?: string }).variantId ?? null,
    variantLabel: input.variantLabel,
    decision: input.experiment.decision,
    preVersionId: input.preVersion?.id ?? null,
    pre: input.experiment.baselineMetrics,
    post: input.experiment.qualityMetrics,
    comparison: input.experiment.comparisonWithBaseline,
    candidateChanges: input.candidateChanges,
    nextRecommendation: input.experiment.nextRecommendation,
  };
}
