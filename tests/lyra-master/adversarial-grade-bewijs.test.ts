import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { beoordeelAdversarialItem, beoordeelMetBewijs } from "../../scripts/v106/adversarial-grade";

/**
 * De adversarial-grader legt nu per beoordeling vast wélke patronen hij toetste
 * en wat ze raakten (invoer + bewijs). Dat mag geen enkel oordeel veranderen:
 * over elke opgeslagen meting die met grader /2 is beoordeeld, geeft de
 * geïnstrumenteerde grader precies het opgeslagen oordeel.
 */

const MAP = path.join(process.cwd(), "docs", "lyra-knowledge", "benchmarks", "adversarial");
const metingen = readdirSync(MAP).filter((m) => existsSync(path.join(MAP, m, "adversarial.json")) && existsSync(path.join(MAP, m, "adversarial-grade.json")));

describe("adversarial-grader: bewijs zonder ander oordeel", () => {
  const metingenV2 = metingen.filter((m) => JSON.parse(readFileSync(path.join(MAP, m, "adversarial-grade.json"), "utf8")).schema === "ns-lyra-adversarial-grade/2");

  it("er zijn genoeg /2-metingen om dit te toetsen", () => {
    expect(metingenV2.length).toBeGreaterThanOrEqual(10);
  });

  it("elk opgeslagen /2-oordeel komt exact terug, met invoer en bewijs", () => {
    let getoetst = 0;
    for (const m of metingenV2) {
      const opgeslagen = new Map<string, { status: string; detail: string }>(
        JSON.parse(readFileSync(path.join(MAP, m, "adversarial-grade.json"), "utf8")).items.map((i: { id: string; status: string; detail: string }) => [i.id, i]),
      );
      for (const item of JSON.parse(readFileSync(path.join(MAP, m, "adversarial.json"), "utf8")).results) {
        const b = beoordeelMetBewijs(item);
        const s = opgeslagen.get(item.id);
        expect({ meting: m, id: item.id, status: b.status, detail: b.detail }).toEqual({ meting: m, id: item.id, status: s?.status, detail: s?.detail });
        expect({ status: b.status, detail: b.detail }).toEqual(beoordeelAdversarialItem(item));
        expect(b.invoer?.tekst).toBe(item.turns[item.turns.length - 1].text);
        getoetst += 1;
      }
    }
    expect(getoetst).toBeGreaterThanOrEqual(90);
  });

  it("GOED bij een tekstcategorie heeft minstens één rakend patroon als bewijs", () => {
    for (const m of metingenV2) {
      for (const item of JSON.parse(readFileSync(path.join(MAP, m, "adversarial.json"), "utf8")).results) {
        const b = beoordeelMetBewijs(item);
        const structureel = ["ontbrekende_afhankelijkheid", "kandidaat2_verlengd_subtiel"].includes(item.expect?.category);
        if (b.status === "GOED" && !structureel) expect(b.bewijs.some((x) => x.raak), `${m}/${item.id}`).toBe(true);
      }
    }
  });
});
