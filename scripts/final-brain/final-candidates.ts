import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CandidateAssignment } from "@/domain/candidate";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { defaultOptimizerEngine, defaultSearchMode } from "@/server/generation/engine-flag";
import { runGenerationJob } from "@/server/generation/generation-job";
import { describeVariant, engineVariant } from "@/server/generation/adaptive/variant";
import { createRunCore } from "@/server/services/generation-service";
import { evaluateAssignmentsCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { SCENARIOS } from "@/server/services/simulation-service";
import { type CandidateMetrics, METRICS, measureAssignments } from "./metrics";
import type { PhaseMeasurement } from "./measure";

/**
 * De drie reviewpakketten (werkopdracht §26, §27).
 *
 * ## Hoe ze ontstaan
 *
 * Drie gewone generatieruns, precies zoals de knop "Genereren" ze start
 * (`startGeneration`: standaardzoekmachine en rekentijdmodus, drie kandidaten),
 * één per strategie: Evenwichtig, Rust & regelmaat, Eerlijke lasten. Uit die
 * negen kandidaten kiest `select` er drie met regels die hieronder vastliggen,
 * vóórdat er één kandidaat bestaat:
 *
 * - A — beste robuuste kwaliteit uit Evenwichtig;
 * - B — beste menselijk ritme en rust uit Rust & regelmaat: het gemiddelde van
 *   nachten, regelmaat en rust, bij gelijkspel de robuuste kwaliteit;
 * - C — beste eerlijkheid uit Eerlijke lasten, binnen de menselijke
 *   kwaliteitsvloer: geen losse nacht, geen nachtuitgang onder de herstelregel,
 *   en robuust minstens het gemiddelde van v1.0.4. Haalt geen kandidaat die
 *   vloer, dan de beste eerlijkheid met de reden erbij.
 *
 * De andere zes blijven gewone kandidaten in de simulatie; niets wordt gewist.
 *
 * ## Wat per pakket wordt geleverd
 *
 * De weergave (gecontroleerd: elk basisrooster opent, met het
 * beoordelingsformulier), een PDF per basisrooster, één PDF met alle zeven, de
 * metingen als JSON, en een toelichting: sterkste en zwakste vijf punten, en
 * het slechtste van elk soort.
 *
 *   npm run final-brain:candidates -- generate
 *   npm run final-brain:candidates -- select
 *   npm run final-brain:candidates -- export     (ontwikkelserver moet draaien)
 */

const LOCATIE = "DDR";
const ROOSTERJAAR = 2027;
const COMMISSIELID = "900001";
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3300";
const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "v1.0.4-final-brain", "final-candidates");
const RUNS = path.join(MAP, "runs.json");
const KEUZE = path.join(MAP, "selection.json");
const STRATEGIEEN = ["BALANCED", "REST_QUALITY", "FAIR_BURDEN"] as const;

interface RunVerslag {
  readonly strategy: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly engine: string;
  readonly searchMode: string | null;
  readonly variant: unknown;
  readonly candidates: readonly { id: string; number: number; label: string }[];
}

async function commissielid(): Promise<Actor> {
  const account = await prisma.userAccount.findFirstOrThrow({
    where: { employee: { employeeNumber: COMMISSIELID }, status: "ACTIVE" },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });
  if (!account.roles.includes("ROSTER_COMMITTEE")) throw new Error(`${COMMISSIELID} is geen lid van de Roostercommissie.`);
  return {
    sessionId: "final-brain-candidates",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD" as Actor["authLevel"],
    depot: account.employee.depot,
  };
}

async function genereer(): Promise<void> {
  const actor = await commissielid();
  const engine = defaultOptimizerEngine();
  const searchMode = engine === "adaptive" ? defaultSearchMode() : null;
  const verslagen: RunVerslag[] = [];
  mkdirSync(MAP, { recursive: true });
  for (const sleutel of STRATEGIEEN) {
    const scenario = SCENARIOS.find((entry) => entry.key === sleutel);
    if (!scenario) throw new Error(`Strategie ${sleutel} ontbreekt.`);
    const runId = await createRunCore({
      actor,
      locationCode: LOCATIE,
      strategy: scenario.key,
      strategyLabel: `${scenario.label} — v1.0.4 eindkandidaten ter beoordeling`,
      rosterYear: ROOSTERJAAR,
      requestedCandidates: 3,
      engine,
      searchMode,
    });
    console.log(`${sleutel}: run ${runId} gestart (${engine}, ${searchMode ?? "—"}).`);
    const begin = new Date();
    await runGenerationJob(runId, actor);
    const einde = new Date();
    const run = await prisma.generationRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, failureReason: true, candidates: { orderBy: { candidateNumber: "asc" }, select: { id: true, candidateNumber: true, scenarioLabel: true } } },
    });
    if (run.status !== "COMPLETED" || run.candidates.length === 0) {
      throw new Error(`${sleutel}: run ${runId} ${run.status}, ${run.candidates.length} kandidaten. ${run.failureReason ?? ""}`);
    }
    verslagen.push({
      strategy: sleutel,
      runId,
      startedAt: begin.toISOString(),
      finishedAt: einde.toISOString(),
      engine,
      searchMode,
      variant: describeVariant(engineVariant()),
      candidates: run.candidates.map((k) => ({ id: k.id, number: k.candidateNumber ?? 0, label: k.scenarioLabel })),
    });
    console.log(`${sleutel}: ${run.candidates.length} kandidaten in ${((einde.getTime() - begin.getTime()) / 1000).toFixed(0)} s`);
    writeFileSync(RUNS, `${JSON.stringify(verslagen, null, 2)}\n`);
  }
}

interface Gemeten {
  readonly strategy: string;
  readonly id: string;
  readonly number: number;
  readonly label: string;
  readonly metrics: CandidateMetrics;
  readonly validationState: string;
  readonly confirmedHardViolations: number | null;
}

async function meetAlle(): Promise<Gemeten[]> {
  const verslagen = JSON.parse(readFileSync(RUNS, "utf8")) as RunVerslag[];
  const context = await loadEvaluationContextCore(LOCATIE);
  const uit: Gemeten[] = [];
  for (const run of verslagen) {
    for (const k of run.candidates) {
      const rij = await prisma.candidateRoster.findUniqueOrThrow({
        where: { id: k.id },
        select: { assignments: true, validationState: true, validationSummary: true },
      });
      const tally = (rij.validationSummary as { tally?: { confirmedHardViolations?: number } } | null)?.tally;
      uit.push({
        strategy: run.strategy,
        id: k.id,
        number: k.number,
        label: k.label,
        metrics: measureAssignments(rij.assignments as unknown as CandidateAssignment[], context),
        validationState: rij.validationState,
        confirmedHardViolations: tally?.confirmedHardViolations ?? null,
      });
    }
  }
  return uit;
}

async function kies(): Promise<void> {
  const alle = await meetAlle();
  const voor = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.4-final-brain", "before.json"), "utf8")) as PhaseMeasurement;
  const vloerRobuust = voor.summary.robust?.mean ?? 0;
  const geldig = (k: Gemeten) => k.metrics.hard.valid && (k.confirmedHardViolations ?? 0) === 0;
  const uit = (strategie: string) => alle.filter((k) => k.strategy === strategie && geldig(k));
  const robuust = (k: Gemeten) => k.metrics.quality.robust ?? -Infinity;
  const ritme = (k: Gemeten) => {
    const c = k.metrics.quality.components;
    return ((c.nights ?? 0) + (c.flow ?? 0) + (c.rest ?? 0)) / 3;
  };
  const vloer = (k: Gemeten) => k.metrics.nights.singletons === 0 && k.metrics.nights.exitsBelowRule === 0 && robuust(k) >= vloerRobuust;

  const a = [...uit("BALANCED")].sort((x, y) => robuust(y) - robuust(x))[0];
  const b = [...uit("REST_QUALITY")].sort((x, y) => ritme(y) - ritme(x) || robuust(y) - robuust(x))[0];
  const cBinnen = [...uit("FAIR_BURDEN")].filter(vloer).sort((x, y) => (y.metrics.quality.components.fairness ?? 0) - (x.metrics.quality.components.fairness ?? 0))[0];
  const c = cBinnen ?? [...uit("FAIR_BURDEN")].sort((x, y) => (y.metrics.quality.components.fairness ?? 0) - (x.metrics.quality.components.fairness ?? 0))[0];
  if (!a || !b || !c) throw new Error("Niet voor elke strategie een geldige kandidaat.");
  const keuze = [
    { package: "A", rule: "beste robuuste kwaliteit uit Evenwichtig", candidate: a },
    { package: "B", rule: "beste gemiddelde van nachten, regelmaat en rust uit Rust & regelmaat", candidate: b },
    {
      package: "C",
      rule: `beste eerlijkheid uit Eerlijke lasten binnen de vloer (geen losse nacht, geen uitgang onder 46 u, robuust ≥ ${vloerRobuust.toFixed(1)})`,
      candidate: c,
      floorMet: cBinnen !== undefined,
    },
  ];
  writeFileSync(
    KEUZE,
    `${JSON.stringify(
      {
        schema: "ns-final-brain-selection/1",
        selectedAt: new Date().toISOString(),
        rulesFixedBeforeGeneration: true,
        packages: keuze.map((x) => ({ package: x.package, rule: x.rule, floorMet: (x as { floorMet?: boolean }).floorMet ?? null, id: x.candidate.id, strategy: x.candidate.strategy, number: x.candidate.number, label: x.candidate.label })),
        all: alle.map((k) => ({ strategy: k.strategy, id: k.id, number: k.number, robust: k.metrics.quality.robust, rhythm: ritme(k), fairness: k.metrics.quality.components.fairness, floor: vloer(k), valid: geldig(k) })),
      },
      null,
      2,
    )}\n`,
  );
  for (const x of keuze) console.log(`${x.package}: ${x.candidate.strategy} kandidaat ${x.candidate.number} (${x.candidate.id}) — robuust ${robuust(x.candidate).toFixed(1)}`);
  if (!cBinnen) console.log("Let op: geen Eerlijke-lasten-kandidaat haalt de vloer; C is de beste eerlijkheid zonder vloer.");
}

function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET ontbreekt.");
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** Sterkste en zwakste punten: waar de kandidaat het verst boven of onder v1.0.4 zit, in standaarddeviaties. */
function toelichting(pakket: string, regel: string, k: Gemeten, voor: PhaseMeasurement, officieel: CandidateMetrics): string {
  const scores = METRICS.filter((m) => m.key !== "robustV1").map((m) => {
    const v = m.get(k.metrics);
    const s = voor.summary[m.key];
    if (v === null || !s) return null;
    const spreiding = Math.max(s.sd, Math.abs(s.mean) * 0.02, 0.05);
    const z = ((v - s.mean) / spreiding) * (m.higherIsBetter ? 1 : -1);
    return { m, v, s, z };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  const f = (x: number | null | undefined, d: number) => (x === null || x === undefined ? "—" : x.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const lijn = (x: (typeof scores)[number]) => `- **${x.m.label}**: ${f(x.v, x.m.decimals)} (v1.0.4 gemiddeld ${f(x.s.mean, x.m.decimals)}; officieel ${f(x.m.get(officieel), x.m.decimals)})`;
  const sterk = [...scores].sort((a, b) => b.z - a.z).slice(0, 5);
  const zwak = [...scores].sort((a, b) => a.z - b.z).slice(0, 5);
  const m = k.metrics;
  const wc = m.nights.worstExit;
  return [
    `# Pakket ${pakket} — ${k.label}`,
    "",
    `*Gekozen als: ${regel}. Strategie ${k.strategy}, kandidaat ${k.number}. Nog door niemand beoordeeld; dit zijn metingen, geen oordeel over hoe het rooster rijdt.*`,
    "",
    "## Sterkste vijf punten (ten opzichte van v1.0.4)",
    ...sterk.map(lijn),
    "",
    "## Zwakste vijf punten (ten opzichte van v1.0.4)",
    ...zwak.map(lijn),
    "",
    "## Het slechtste van elk soort",
    `- **Slechtste regel**: ${m.quality.worstLine.roster ?? "—"} regel ${m.quality.worstLine.line ?? "—"}, score ${f(m.quality.worstLine.score, 1)}`,
    `- **Zwaarste overgang** (op etiket): ${f(m.transitions.worstLabel, 0)} strafpunten; op de klok ${m.transitions.heavyClockAware} zware overgang(en)`,
    `- **Slechtste nachtuitgang**: ${wc ? `${wc.roster} regel ${wc.lines}, ${wc.pattern}, ${f(wc.hours, 1)} uur herstel` : "geen nachten"}`,
    `- **Rommeligste werkblok**: ${m.worstWorkBlock.states ?? "—"} (${m.worstWorkBlock.switches} wissel(s))`,
    "",
    "## Kerngetallen",
    `- Losse nachten: ${m.nights.singletons} · reeksen van twee: ${m.nights.pairs} · nachtreeksen: ${JSON.stringify(m.nights.blocks)}`,
    `- Kortste herstel na een nachtreeks: ${f(m.nights.minRecoveryHours, 1)} uur · uitgangen onder 46 uur: ${m.nights.exitsBelowRule}`,
    `- Eerlijkheid: ${f(m.quality.components.fairness, 1)} · uren: ${f(m.quality.components.hours, 1)} (grootste afwijking ${f(m.hours.maxRosterDeviation, 0)} min/week)`,
    `- Robuuste kwaliteit: ${f(m.quality.robust, 1)} · hard geldig: ${m.hard.valid ? "ja" : "nee"} · profielovertredingen: ${m.hard.profileBreaches}`,
    "",
  ].join("\n");
}

async function exporteer(): Promise<void> {
  const keuze = JSON.parse(readFileSync(KEUZE, "utf8")) as { packages: { package: string; rule: string; id: string }[] };
  const alle = await meetAlle();
  const voor = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.4-final-brain", "before.json"), "utf8")) as PhaseMeasurement;
  const actor = await commissielid();
  const token = randomBytes(32).toString("base64url");
  const nu = Date.now();
  const sessie = await prisma.session.create({
    data: { userId: actor.userId, tokenHash: hashToken(token), expiresAt: new Date(nu + 20 * 60_000), absoluteExpiry: new Date(nu + 40 * 60_000), clientFingerprint: "final-brain-candidates" },
    select: { id: true },
  });
  const kop = { cookie: `nsr_session=${token}` };
  const context = await loadEvaluationContextCore(LOCATIE);
  const codes = context.quality.official.map((r) => r.code).sort();
  const officieelMeting = voor.official;
  const fouten: string[] = [];
  const pdfOk = async (url: string, bestand: string) => {
    const antwoord = await fetch(`${BASE_URL}${url}`, { headers: kop, redirect: "manual" });
    const bytes = Buffer.from(await antwoord.arrayBuffer());
    if (antwoord.status !== 200 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      fouten.push(`${url}: HTTP ${antwoord.status}`);
      return 0;
    }
    writeFileSync(bestand, bytes);
    return bytes.length;
  };
  try {
    for (const p of keuze.packages) {
      const k = alle.find((x) => x.id === p.id)!;
      const map = path.join(MAP, p.package);
      mkdirSync(map, { recursive: true });
      for (const code of codes) {
        const weergave = await fetch(`${BASE_URL}/roostercommissie/simulatie/${p.id}/${code}`, { headers: kop, redirect: "manual" });
        const html = weergave.status === 200 ? await weergave.text() : "";
        if (weergave.status !== 200) fouten.push(`${p.package} ${code} weergave: HTTP ${weergave.status}`);
        else if (!html.includes("beoordelen")) fouten.push(`${p.package} ${code}: geen beoordelingsformulier`);
        await pdfOk(`/roostercommissie/roosterblad/${code}?formaat=pdf&kandidaat=${p.id}`, path.join(map, `${code}.pdf`));
      }
      const totaal = await pdfOk(`/roostercommissie/simulatie/${p.id}/pdf`, path.join(map, "alle-basisroosters.pdf"));
      const rapport = evaluateAssignmentsCore(
        ((await prisma.candidateRoster.findUniqueOrThrow({ where: { id: p.id }, select: { assignments: true } })).assignments as unknown) as CandidateAssignment[],
        context,
      );
      writeFileSync(
        path.join(map, "metrics.json"),
        `${JSON.stringify({ package: p.package, rule: p.rule, candidateId: p.id, strategy: k.strategy, number: k.number, viewer: `/roostercommissie/simulatie/${p.id}`, metrics: k.metrics, worstCase: rapport.worstCase, lines: rapport.lines.all.map((l) => ({ roster: l.roster, line: l.lineNumber, score: l.score, facts: l.facts })) }, null, 2)}\n`,
      );
      writeFileSync(path.join(map, "toelichting.md"), toelichting(p.package, p.rule, k, voor, officieelMeting));
      console.log(`${p.package}: ${codes.length} weergaven, ${codes.length} roosterbladen, pakket-PDF ${(totaal / 1024).toFixed(0)} kB`);
    }
  } finally {
    await prisma.session.update({ where: { id: sessie.id }, data: { revokedAt: new Date(), revokedReason: "exportscript klaar" } });
  }
  if (fouten.length > 0) throw new Error(`Export niet schoon:\n  ${fouten.join("\n  ")}`);
}

async function main() {
  const opdracht = process.argv[2];
  if (opdracht === "generate") await genereer();
  else if (opdracht === "select") await kies();
  else if (opdracht === "export") await exporteer();
  else throw new Error("Gebruik: generate | select | export");
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});

