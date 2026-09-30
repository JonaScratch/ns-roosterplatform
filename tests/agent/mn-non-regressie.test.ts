import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, onbekendeKeuzes } from "@/server/agent/tools";

/**
 * Bewijs dat de reparatie van 20260930 (voorbarig "niet vast te stellen" eerst
 * laten opzoeken; een onbestaande keuzewaarde als feit benoemen) de bevroren
 * kern en de extensie niet verandert. Gemeten tegen de opgeslagen toolinvoer en
 * uitkomsten van de laatste twee geldige AFTER-runs (elk drie replicaten).
 */

const MAP = path.join(process.cwd(), "docs", "v1.0.6", "benchmarks");
const RUNS = ["after-20260929-234655", "after-20260930-021137"].flatMap((r) => [1, 2, 3].map((n) => `${r}-r${n}`));
const BESTANDEN = RUNS.flatMap((r) => ["golden.json", "golden-extension.json"].map((b) => path.join(MAP, r, b)));

interface Beurt { status?: string; tools?: string[]; toolInputs?: unknown[]; tegengehouden?: string }
const beurten = (): { bron: string; t: Beurt }[] =>
  BESTANDEN.flatMap((f) => (JSON.parse(readFileSync(f, "utf8")).results as { id: string; turns?: Beurt[] }[]).flatMap((it) => (it.turns ?? []).map((t) => ({ bron: `${path.basename(path.dirname(f))}/${it.id}`, t }))));

describe("kern en extensie onveranderd door de reparatie van 20260930", () => {
  it("alle zes replicaten × twee suites zijn aanwezig", () => {
    expect(BESTANDEN.filter((f) => !existsSync(f))).toEqual([]);
  });

  it("geen enkele kern- of extensiebeurt eindigde in 'niet vast te stellen' zonder één tool — de verscherpte planbewaking raakt er dus geen", () => {
    const geraakt = beurten().filter(({ t }) => t.status === "NIET_VAST_TE_STELLEN" && (t.tools ?? []).length === 0 && !t.tegengehouden);
    expect(geraakt.map((g) => g.bron)).toEqual([]);
  });

  it("geen enkele opgeslagen toolinvoer wordt als 'onbekende waarde' aangemerkt", () => {
    const schema = new Map<string, (typeof AGENT_TOOLS)[number]["input"]>(AGENT_TOOLS.map((t) => [t.name, t.input]));
    let getoetst = 0;
    const gemarkeerd: string[] = [];
    for (const { bron, t } of beurten()) {
      (t.tools ?? []).forEach((naam, i) => {
        const s = schema.get(naam);
        const invoer = t.toolInputs?.[i];
        if (!s || invoer === undefined) return;
        getoetst += 1;
        const r = s.safeParse(invoer);
        if (!r.success && onbekendeKeuzes(r.error.issues as never, invoer).length > 0) gemarkeerd.push(`${bron}:${naam}`);
      });
    }
    expect(getoetst).toBeGreaterThan(100);
    expect(gemarkeerd).toEqual([]);
  });
});
