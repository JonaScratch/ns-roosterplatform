import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PhaseFile } from "./measure-phases";

/**
 * De beslisregels van de machinistenronde, mechanisch toegepast
 * (docs/v1.0.4-final-brain/machinist-preferences/decision-rules.json, vastgelegd
 * vóór de eerste uitslag). Dit script kiest niets zelf: het leest de metingen,
 * rekent de marges na en schrijft de uitkomst met de getallen erbij.
 *
 *   npx tsx scripts/machinist/decide.ts --rule M0|M1|M2|M3
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences");
const fase = (naam: string): PhaseFile => JSON.parse(readFileSync(path.join(MAP, "phases", `${naam}.json`), "utf8")) as PhaseFile;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** De marges van M1, ook gebruikt door M2 en M3: hoeveel een maat mag verslechteren. */
const MARGES: readonly { key: string; label: string; maxWorse: number; higherIsBetter: boolean }[] = [
  { key: "singletons", label: "losse nachten", maxWorse: 0.34, higherIsBetter: false },
  { key: "pairs", label: "reeksen van twee", maxWorse: 0.34, higherIsBetter: false },
  { key: "worstNightExit", label: "slechtste nachtuitgang", maxWorse: 10, higherIsBetter: true },
  { key: "rest", label: "rust", maxWorse: 1, higherIsBetter: true },
  { key: "worstLineV2", label: "slechtste regel (v2)", maxWorse: 1, higherIsBetter: true },
  { key: "fairness", label: "eerlijkheid", maxWorse: 0.5, higherIsBetter: true },
  { key: "hours", label: "uren", maxWorse: 1, higherIsBetter: true },
];

function toets(voor: Readonly<Record<string, number | null>>, na: Readonly<Record<string, number | null>>, marges = MARGES) {
  return marges.map((m) => {
    const a = voor[m.key];
    const b = na[m.key];
    if (a === null || a === undefined || b === null || b === undefined) return { ...m, before: a ?? null, after: b ?? null, delta: null, ok: true, note: "niet meetbaar" };
    const verslechtering = m.higherIsBetter ? a - b : b - a;
    return { ...m, before: a, after: b, delta: r2(b - a), ok: verslechtering <= m.maxWorse + 1e-9 };
  });
}

function verschillen(voor: Readonly<Record<string, number | null>>, na: Readonly<Record<string, number | null>>) {
  return Object.fromEntries(
    Object.keys(na).map((k) => [k, { before: voor[k], after: na[k], delta: voor[k] === null || na[k] === null ? null : r2((na[k] as number) - (voor[k] as number)) }]),
  );
}

function main() {
  const regel = argument("rule") ?? "M0";
  let uit: Record<string, unknown>;
  if (regel === "M0") {
    const basis = fase("brain-after-BALANCED");
    const m1 = fase("mp-m1-BALANCED");
    uit = {
      rule: "M0",
      question: "Wat kost de harde laag (40:00, vrijdag)? Geen keuze: eis van de gebruiker.",
      baseline: { phase: basis.phase, candidates: basis.candidates.length },
      m1: { phase: m1.phase, candidates: m1.candidates.length, operationalCompliant: m1.candidates.filter((c) => c.operational.compliant).length },
      differences: verschillen(basis.means, m1.means),
      decision: "aan (eis)",
    };
  } else if (regel === "M1" || regel === "M3") {
    // M3 vergelijkt met de configuratie die tot dan toe is aangenomen: M2 als
    // M1 "aan" werd, anders M1 (zie decision-rules.json, "interpretation").
    const voor = fase(argument("before") ?? (regel === "M1" ? "mp-m1-BALANCED" : "mp-m2-BALANCED"));
    const na = fase(argument("after") ?? (regel === "M1" ? "mp-m2-BALANCED" : "mp-m3-BALANCED"));
    const drempel = regel === "M1" ? 2 : 1;
    const winst = (na.means.preference ?? 0) - (voor.means.preference ?? 0);
    const marges = toets(voor.means, na.means);
    const aan = winst >= drempel && marges.every((m) => m.ok);
    uit = {
      rule: regel,
      question: regel === "M1" ? "Model v3 in rangschikking en bijschaven?" : "CP-SAT-voorkeurstermen in de zoekmachine?",
      before: voor.phase,
      after: na.phase,
      preferenceGain: r2(winst),
      requiredGain: drempel,
      margins: marges,
      differences: verschillen(voor.means, na.means),
      decision: aan ? "aan" : "uit",
      reason: aan
        ? `voorkeur +${r2(winst)} (≥ ${drempel}) en alle marges gehaald`
        : [winst < drempel ? `voorkeur +${r2(winst)} (< ${drempel})` : null, ...marges.filter((m) => !m.ok).map((m) => `${m.label} ${m.delta}`)].filter(Boolean).join("; "),
    };
  } else if (regel === "M2") {
    const bestand = path.join(MAP, "solver-ab-preference.json");
    if (!existsSync(bestand)) throw new Error("solver-ab-preference.json ontbreekt");
    const ab = JSON.parse(readFileSync(bestand, "utf8")) as { rows: Record<string, number | null | boolean>[]; scales: number[] };
    const gemiddeld = (schaal: number) => {
      const rijen = ab.rows.filter((r) => r.scale === schaal && r.preference !== undefined);
      const keys = ["preference", "singletons", "pairs", "rest", "hours", "fairness", "worstNightExit", "worstLineV2", "affinity", "dayDuties", "restDuties"];
      return Object.fromEntries(
        keys.map((k) => {
          const w = rijen.map((r) => r[k]).filter((x): x is number => typeof x === "number");
          return [k, w.length ? r2(w.reduce((a, b) => a + b, 0) / w.length) : null];
        }),
      ) as Record<string, number | null>;
    };
    const nul = gemiddeld(0);
    const margesM2 = MARGES.filter((m) => ["singletons", "pairs", "rest", "hours", "fairness"].includes(m.key));
    const per = ab.scales.map((s) => {
      const g = gemiddeld(s);
      const marges = toets(nul, g, margesM2);
      return { scale: s, means: g, margins: marges, eligible: marges.every((m) => m.ok) };
    });
    const geschikt = per.filter((p) => p.eligible && p.means.preference !== null);
    const beste = Math.max(...geschikt.map((p) => p.means.preference as number));
    // De kleinste schaal binnen 0,5 punt van de beste.
    const keuze = geschikt.filter((p) => (p.means.preference as number) >= beste - 0.5).sort((a, b) => a.scale - b.scale)[0];
    uit = { rule: "M2", question: "Schaal van de CP-SAT-voorkeurstermen", perScale: per, decision: keuze?.scale ?? 0, reason: keuze ? `kleinste schaal binnen 0,5 punt van de beste geschikte voorkeur (${beste})` : "geen schaal haalt de marges" };
  } else {
    throw new Error(`Onbekende regel ${regel}`);
  }
  const doel = path.join(MAP, `decision-${regel.toLowerCase()}.json`);
  writeFileSync(doel, `${JSON.stringify({ schema: "ns-machinist-decision/1", decidedAt: new Date().toISOString(), ...uit }, null, 2)}\n`);
  console.log(JSON.stringify(uit, null, 2));
}

main();
