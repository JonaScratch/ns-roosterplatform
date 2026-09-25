import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPORTS_DIR, REPORTS_HISTORY_DIR } from "../config";
import type { JournalEntry } from "../types";

/**
 * Het verplichte ontwikkeljournaal: één entry per wijziging die de Demo Room
 * aan een Lyra-variant voorstelt of test. Zie het aanvullende deel van de
 * opdracht ("VERPLICHT ONTWIKKELJOURNAAL VOOR ELKE LYRA-WIJZIGING").
 *
 * Elke aanroep van `writeJournalEntry` doet drie dingen, in deze volgorde:
 *   1. een nieuw bestand in reports/history/ — de permanente geschiedenis, nooit overschreven;
 *   2. reports/latest.md herschrijven — het meest recente verslag, leesbaar;
 *   3. reports/latest.json herschrijven — dezelfde inhoud, machineleesbaar.
 *
 * Er is bewust geen functie die een history-bestand verwijdert of aanpast:
 * "nooit stil wijzigen" geldt ook voor het journaal zelf.
 */

function stamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function metricsTabel(before: Record<string, number>, after: Record<string, number>): string {
  const sleutels = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  if (sleutels.length === 0) return "_(geen metingen vastgelegd)_";
  const rows = sleutels.map((k) => {
    const v = before[k];
    const n = after[k];
    const delta = v !== undefined && n !== undefined ? (n - v).toFixed(2) : "—";
    return `| ${k} | ${v?.toFixed(2) ?? "—"} | ${n?.toFixed(2) ?? "—"} | ${delta} |`;
  });
  return ["| Metric | Voor | Na | Verschil |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

export function renderJournalMarkdown(entry: JournalEntry): string {
  return [
    `# Ontwikkeljournaal ${entry.experimentId}`,
    "",
    `Run: \`${entry.runId}\` · Tijdstip: ${entry.timestamp} · Ouderversie: ${entry.parentVersion ?? "(geen — eerste variant)"}`,
    "",
    "## 1. Wat was het probleem?",
    entry.problem,
    "",
    "## 2. Wat dacht Lyra dat de oorzaak was?",
    `_Hypothese, geen vaststaand feit._\n\n${entry.hypothesis}`,
    "",
    "## 3. Wat is er veranderd?",
    entry.whatChanged,
    entry.diffReference ? `\nPatchreferentie: \`${entry.diffReference}\`` : "\n_(geen patchreferentie — puur configuratie, geen codewijziging)_",
    "",
    "## 4. Waarom is dat veranderd?",
    entry.whyChanged,
    "",
    "## 5–6. Benchmark vóór en na wijziging",
    metricsTabel(entry.benchmarkBefore, entry.benchmarkAfter),
    "",
    "## 7. Verbetering of regressie",
    Object.entries(entry.changePerCategory).length > 0
      ? Object.entries(entry.changePerCategory)
          .map(([cat, uitkomst]) => `- **${cat}**: ${uitkomst}`)
          .join("\n")
      : "_(geen categorieën vastgelegd)_",
    "",
    "## 8. Nieuwe fouten",
    entry.newErrors.length > 0 ? entry.newErrors.map((f) => `- ${f}`).join("\n") : "Geen nieuwe fouten waargenomen.",
    "",
    "## 9. Besluit",
    `**${entry.decision}**`,
    "",
    `Rollback: ${entry.rollback}`,
    "",
    "## 10. Wat moet Jonathan / ChatGPT / Claude weten?",
    entry.humanSummary,
    "",
  ].join("\n");
}

export function writeJournalEntry(entry: JournalEntry): { readonly historyPath: string; readonly latestMdPath: string; readonly latestJsonPath: string } {
  mkdirSync(REPORTS_HISTORY_DIR, { recursive: true });
  const historyPath = path.join(REPORTS_HISTORY_DIR, `DR-${stamp(entry.timestamp)}-${entry.experimentId}.md`);
  const markdown = renderJournalMarkdown(entry);
  writeFileSync(historyPath, markdown, "utf8");

  const latestMdPath = path.join(REPORTS_DIR, "latest.md");
  writeFileSync(latestMdPath, markdown, "utf8");

  const latestJsonPath = path.join(REPORTS_DIR, "latest.json");
  writeFileSync(latestJsonPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");

  return { historyPath, latestMdPath, latestJsonPath };
}

export function readLatestJournalEntry(): JournalEntry | null {
  const p = path.join(REPORTS_DIR, "latest.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as JournalEntry;
}
