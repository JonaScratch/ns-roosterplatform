import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { REPORTS_DIR } from "../../demo-room/src/config";
import { renderJournalMarkdown, writeJournalEntry } from "../../demo-room/src/store/journal";
import type { JournalEntry } from "../../demo-room/src/types";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    experimentId: "test-exp-1",
    timestamp: "2026-09-25T12:00:00.000Z",
    parentVersion: null,
    runId: "test-run-1",
    problem: "Challenge L1 faalde: geen bron geraadpleegd.",
    hypothesis: "De toolbeschrijving is niet dwingend genoeg.",
    whatChanged: "Systeeminstructie: dwingender toolgebruik-hint toegevoegd.",
    whyChanged: "Om de FOUT op L1 op te lossen.",
    diffReference: null,
    benchmarkBefore: { passRate: 60 },
    benchmarkAfter: { passRate: 75 },
    changePerCategory: { clarification: "ONVERANDERD", correct_false_premise: "BETER" },
    newErrors: [],
    decision: "KEEP_TESTING",
    rollback: "geen codewijziging, alleen een sandboxvariant",
    humanSummary: "Verbetering op correct_false_premise, verder stabiel.",
    ...overrides,
  };
}

const geschreven: string[] = [];

// Deze test schrijft bewust naar de echte reports/-map (dezelfde plek als een
// productierun) — dat is precies wat §"VERPLICHT ONTWIKKELJOURNAAL" toetst:
// dat er een history-bestand en een latest.md/json ontstaan. De testentries
// hebben een herkenbaar "test-"-voorvoegsel en worden na afloop opgeruimd.
afterEach(() => {
  for (const pad of geschreven) if (existsSync(pad)) rmSync(pad, { force: true });
  geschreven.length = 0;
  // latest.md/latest.json zijn met opzet niet in git getrackt (zie .gitignore):
  // elke run — ook deze test — overschrijft ze. Opruimen na de test voorkomt
  // dat een lokale werkkopie testdata als "laatste run" laat zien.
  for (const naam of ["latest.md", "latest.json"]) {
    const pad = `${REPORTS_DIR}/${naam}`;
    if (existsSync(pad)) rmSync(pad, { force: true });
  }
});

describe("Demo Room — ontwikkeljournaal (§ aanvullende opdracht)", () => {
  it("bevat alle 10 verplichte secties", () => {
    const md = renderJournalMarkdown(entry());
    for (const kop of [
      "## 1. Wat was het probleem?",
      "## 2. Wat dacht Lyra dat de oorzaak was?",
      "## 3. Wat is er veranderd?",
      "## 4. Waarom is dat veranderd?",
      "## 5–6. Benchmark vóór en na wijziging",
      "## 7. Verbetering of regressie",
      "## 8. Nieuwe fouten",
      "## 9. Besluit",
      "## 10. Wat moet Jonathan / ChatGPT / Claude weten?",
    ]) {
      expect(md).toContain(kop);
    }
  });

  it("schrijft een history-bestand, latest.md en latest.json", () => {
    const paden = writeJournalEntry(entry());
    geschreven.push(paden.historyPath);
    expect(paden.historyPath.startsWith(REPORTS_DIR)).toBe(true);
    expect(readFileSync(paden.historyPath, "utf8")).toContain("KEEP_TESTING");
    expect(readFileSync(paden.latestMdPath, "utf8")).toContain("test-exp-1");
    const json = JSON.parse(readFileSync(paden.latestJsonPath, "utf8"));
    expect(json.experimentId).toBe("test-exp-1");
  });

  it("twee entries laten allebei een history-bestand staan (nooit overschrijven)", () => {
    const eerste = writeJournalEntry(entry({ experimentId: "test-exp-1", timestamp: "2026-09-25T12:00:00.000Z" }));
    const tweede = writeJournalEntry(entry({ experimentId: "test-exp-2", timestamp: "2026-09-25T12:05:00.000Z" }));
    geschreven.push(eerste.historyPath, tweede.historyPath);
    expect(eerste.historyPath).not.toBe(tweede.historyPath);
    expect(readFileSync(eerste.historyPath, "utf8")).toContain("test-exp-1");
    expect(readFileSync(tweede.historyPath, "utf8")).toContain("test-exp-2");
  });
});
