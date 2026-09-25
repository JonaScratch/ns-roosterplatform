import type { BenchmarkRunResult } from "../types";
import type { ExperimentRecord } from "../types";

/**
 * Het menselijk leesbare rapport (§18 van de opdracht): voor Jonathan,
 * ChatGPT én Claude. Eén functie, geen sjabloonbestand elders — zo staat het
 * exacte format bij de data die het invult.
 */

export interface HumanReportInput {
  readonly runId: string;
  readonly durationLabel: string;
  readonly model: string;
  readonly baselineCandidateLabel: string;
  readonly experiments: readonly ExperimentRecord[];
  readonly candidatesGenerated: number;
  readonly hardValidCandidates: number;
  readonly paretoCandidates: number;
  readonly benchmarksBefore: readonly BenchmarkRunResult[];
  readonly benchmarksAfter: readonly BenchmarkRunResult[];
  readonly lessonsLearned: readonly string[];
  readonly whatFailed: readonly string[];
  readonly mostInterestingFinding: string | null;
  readonly regressions: readonly string[];
  readonly recommendation: "PROMOTE" | "DO_NOT_PROMOTE" | "MORE_TESTING_REQUIRED";
}

function scoreTabel(before: readonly BenchmarkRunResult[], after: readonly BenchmarkRunResult[]): string {
  const suites = [...new Set([...before.map((b) => b.suite), ...after.map((b) => b.suite)])];
  if (suites.length === 0) return "_(geen benchmarkmetingen in deze run)_";
  const rows = suites.map((suite) => {
    const v = before.find((b) => b.suite === suite);
    const n = after.find((b) => b.suite === suite);
    const delta = v && n ? (n.passRate - v.passRate).toFixed(1) : "—";
    return `| ${suite} | ${v ? `${v.passRate.toFixed(1)}` : "—"} | ${n ? `${n.passRate.toFixed(1)}` : "—"} | ${delta} |`;
  });
  return ["| Suite | Voor | Na | Verschil |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

export function renderHumanReport(input: HumanReportInput): string {
  const succesvol = input.experiments.filter((e) => e.outcome === "SUCCESS").length;
  const verworpen = input.experiments.filter((e) => e.decision === "REJECTED").length;
  const nuttig = input.experiments.filter((e) => e.decision === "PROMOTION_CANDIDATE" || e.decision === "KEEP_TESTING").length;

  return [
    `# Demo Room Run ${input.runId}`,
    "",
    `Duur: ${input.durationLabel} · Model: ${input.model} · Baseline kandidaat: ${input.baselineCandidateLabel}`,
    "",
    "## Resultaat",
    `- ${input.experiments.length} experimenten`,
    `- ${input.candidatesGenerated} kandidaatpakketten gegenereerd`,
    `- ${input.hardValidCandidates} hard geldig (onafhankelijk gevalideerd)`,
    `- ${input.paretoCandidates} Pareto-kandidaten`,
    `- ${nuttig} nuttige hypotheses`,
    `- ${succesvol} succesvolle bevindingen`,
    `- ${verworpen} verworpen hypothesen`,
    "",
    "## Score",
    scoreTabel(input.benchmarksBefore, input.benchmarksAfter),
    "",
    "## Wat Lyra leerde",
    input.lessonsLearned.length > 0 ? input.lessonsLearned.map((l, i) => `${i + 1}. ${l}`).join("\n") : "_(nog niets vastgelegd)_",
    "",
    "## Wat niet lukte",
    input.whatFailed.length > 0 ? input.whatFailed.map((l, i) => `${i + 1}. ${l}`).join("\n") : "_(niets — of nog niet geanalyseerd)_",
    "",
    "## Interessantste onverwachte ontdekking",
    input.mostInterestingFinding ?? "_(geen)_",
    "",
    "## Regressies",
    input.regressions.length > 0 ? input.regressions.join("; ") : "Geen",
    "",
    "## Advies",
    `**${input.recommendation}**`,
    "",
  ].join("\n");
}
