import { writeFileSync } from "node:fs";
import { HANDOFF_PATH } from "../config";
import type { ExperimentRecord } from "../types";

/**
 * HANDOFF.md — het bestand dat bedoeld is om in een nieuwe Claude- of
 * ChatGPT-chat te plakken (zie het aanvullende deel van de opdracht,
 * "AUTOMATISCHE SESSIESAMENVATTING"). Wordt telkens overschreven: het bevat
 * uitsluitend de huidige toestand, geen geschiedenis — die staat al in
 * reports/history/.
 */

export interface HandoffState {
  readonly generatedAt: string;
  readonly bestSandboxVariant: string | null;
  readonly productionVariant: string;
  /** §aanvulling: expliciet "Verschil" tussen Production en Best Sandbox Lyra. */
  readonly bestSandboxDiff: Record<string, number> | null;
  /** §aanvulling: expliciet "Waarom beter". */
  readonly bestSandboxWhyBetter: string | null;
  readonly unpromotedExperiments: readonly ExperimentRecord[];
  readonly bestBenchmarkScore: number | null;
  readonly knownWeaknesses: readonly string[];
  readonly recentExperiments: readonly ExperimentRecord[];
  readonly openHypotheses: readonly string[];
  readonly regressions: readonly string[];
  readonly recommendedNextSteps: readonly string[];
}

function bullets(items: readonly string[], leeg: string): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `_${leeg}_`;
}

export function renderHandoff(state: HandoffState): string {
  const kandidaten = state.unpromotedExperiments.filter((e) => e.decision === "PROMOTION_CANDIDATE");
  return [
    "# HANDOFF — Lyra Demo Room",
    "",
    `Laatst bijgewerkt: ${state.generatedAt}`,
    "",
    "> Plak dit bestand in een nieuwe Claude- of ChatGPT-chat om direct te weten waar dit project staat.",
    "",
    "## Stand van zaken",
    `- Production Lyra: **${state.productionVariant}**`,
    `- Best Sandbox Lyra: **${state.bestSandboxVariant ?? "(nog geen — er is nog geen variant die de controle versloeg)"}**`,
    `- Verschil: ${state.bestSandboxDiff && Object.keys(state.bestSandboxDiff).length > 0 ? Object.entries(state.bestSandboxDiff).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v.toFixed(1)}pp`).join(", ") : "(geen — Best Sandbox is gelijk aan of nog niet gemeten tegen Production)"}`,
    `- Waarom beter: ${state.bestSandboxWhyBetter ?? "(n.v.t.)"}`,
    `- Beste benchmarkscore tot nu toe: ${state.bestBenchmarkScore !== null ? state.bestBenchmarkScore.toFixed(1) : "(nog niet gemeten)"}`,
    "",
    "## Nog niet gepubliceerde verbeteringen",
    state.unpromotedExperiments.length > 0
      ? state.unpromotedExperiments.map((e) => `- \`${e.id}\` (${e.decision}) — ${e.hypothesis}`).join("\n")
      : "_geen_",
    "",
    "## Promotion candidates (wachten op menselijke/Claude-beoordeling)",
    kandidaten.length > 0 ? kandidaten.map((e) => `- \`${e.id}\` — ${e.hypothesis} (${e.nextRecommendation ?? "zie journaal"})`).join("\n") : "_geen_",
    "",
    "## Belangrijkste bekende zwaktes",
    bullets(state.knownWeaknesses, "nog geen zwaktes vastgelegd"),
    "",
    "## Laatste 10 relevante experimenten",
    state.recentExperiments.length > 0
      ? state.recentExperiments
          .slice(0, 10)
          .map((e) => `- \`${e.id}\` (${e.timestamp}, ${e.decision}): ${e.hypothesis} — ${e.outcome}${e.failureReason ? `, ${e.failureReason}` : ""}`)
          .join("\n")
      : "_nog geen experimenten uitgevoerd_",
    "",
    "## Open hypotheses",
    bullets(state.openHypotheses, "geen openstaande hypotheses"),
    "",
    "## Regressies",
    bullets(state.regressions, "geen bekende regressies"),
    "",
    "## Aanbevolen volgende stap(pen)",
    bullets(state.recommendedNextSteps, "geen aanbeveling — start een korte gecontroleerde run"),
    "",
  ].join("\n");
}

export function writeHandoff(state: HandoffState): void {
  writeFileSync(HANDOFF_PATH, renderHandoff(state), "utf8");
}
