import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Do not expose locked holdout prompts" — afgedwongen, niet alleen beloofd.
 *
 * Geen enkel code- of testbestand mag een reeks van zes opeenvolgende woorden
 * uit een holdoutvraag bevatten. De holdout wordt uitsluitend tijdens een
 * meting uit zijn JSON-bestand gelezen (bench en grader), nooit in code
 * overgeschreven. Aanleiding: in een eerdere ronde stond een holdoutvraag
 * vrijwel letterlijk in een lektest (tests/demo-room/factory.test.ts).
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const woorden = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúëïöü\s-]/g, " ").split(/\s+/).filter(Boolean);

describe("geen holdouttekst in code", () => {
  it("geen 6-gram uit een holdoutvraag in src, scripts, tests of demo-room", () => {
    const ontwerp = JSON.parse(readFileSync(path.join(WORTEL, "docs/lyra-knowledge/benchmarks/adversarial-holdout-design.json"), "utf8")) as {
      items: { turns?: { text?: string }[] }[];
    };
    const grams = new Set<string>();
    for (const item of ontwerp.items) {
      for (const t of item.turns ?? []) {
        const w = woorden(t.text ?? "");
        for (let i = 0; i + 6 <= w.length; i += 1) grams.add(w.slice(i, i + 6).join(" "));
      }
    }
    expect(grams.size).toBeGreaterThan(0);
    const bestanden = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "src", "scripts", "tests", "demo-room/src", "demo-room/ui"], { cwd: WORTEL, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));
    const lekken: string[] = [];
    for (const f of bestanden) {
      let inhoud: string;
      try {
        inhoud = ` ${woorden(readFileSync(path.join(WORTEL, f), "utf8")).join(" ")} `;
      } catch {
        continue;
      }
      for (const g of grams) if (inhoud.includes(` ${g} `)) lekken.push(`${f}: "${g.slice(0, 20)}…"`);
    }
    expect(lekken).toEqual([]);
  });
});
