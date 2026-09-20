import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Chapter, beeldmerk, blok, document, escape, figuur, hoofdstuk, nummer, oordeelKlasse, tabel, verschil } from "./layout";
import { KLEUR, flowDiagram, groupedBars } from "./charts";
import { METRICS } from "../final-brain/metrics";
import type { PhaseMeasurement } from "../final-brain/measure";
import { machinistChapters } from "./machinist-chapters";

/**
 * NS-Roosterplatform v1.0.4 — Final Brain Report.
 *
 * ## Wat dit document is
 *
 * Het verslag van de laatste ronde aan het roosterbrein van v1.0.4: wat de
 * zeven menselijke Dordrechtse roosters laten zien, wat het brein feitelijk
 * ruilde, wat er is veranderd, wat daarvan werkte en wat niet, en de drie
 * reviewpakketten. Elk getal komt uit `docs/v1.0.4-final-brain/`; waar een
 * bestand ontbreekt staat dat er, en de kwaliteitscontrole keurt het af.
 *
 * Het rapport zegt nergens dat een rooster beter is voor mensen. Het zegt op
 * welke meetbare punten de uitkomst dichter bij de menselijke referentie ligt,
 * en waar niet. Alleen menselijk oordeel kan meer zeggen.
 *
 *   npm run report:final-brain
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "v1.0.4-final-brain");
export const FINAL_BRAIN_HTML = path.join(WORTEL, "docs", "NS-Roosterplatform-v1.0.4-Final-Brain-Report.html");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const lees = (bestand: string): Json | null => {
  const pad = path.isAbsolute(bestand) ? bestand : path.join(MAP, bestand);
  return existsSync(pad) ? (JSON.parse(readFileSync(pad, "utf8")) as Json) : null;
};
const ontbreekt = (wat: string) => blok(`NOG NIET GEGENEREERD — ${escape(wat)} ontbreekt.`, "bad");

interface Gegevens {
  readonly freeze: Json | null;
  readonly before: PhaseMeasurement | null;
  readonly dev1: PhaseMeasurement | null;
  readonly dev2: PhaseMeasurement | null;
  readonly after: PhaseMeasurement | null;
  readonly gates: Json | null;
  readonly ablations: Json | null;
  readonly solverAb: Json | null;
  readonly rates: Json | null;
  readonly adversarial: Json | null;
  readonly repairs: Json | null;
  readonly log: Json | null;
  readonly selection: Json | null;
  readonly packages: Record<string, Json | null>;
  readonly tests: Json | null;
  readonly features: Json | null;
  readonly contrast: Json | null;
  readonly config: Json | null;
  readonly rules: Json | null;
  readonly r1: Json | null;
  readonly r2: Json | null;
  readonly restAnalysis: Json | null;
  readonly e2eReruns: Json | null;
}

function laad(): Gegevens {
  return {
    freeze: lees("freeze.json"),
    before: lees("before.json") as PhaseMeasurement | null,
    dev1: lees("dev1.json") as PhaseMeasurement | null,
    dev2: lees("dev2.json") as PhaseMeasurement | null,
    after: lees("after.json") as PhaseMeasurement | null,
    gates: lees("gates.json"),
    ablations: lees("ablations.json"),
    solverAb: lees("solver-ab-nightrow.json"),
    rates: lees("objective-exchange-rates.json"),
    adversarial: lees("adversarial.json"),
    repairs: lees("repair-analysis.json"),
    log: lees("development-log.json"),
    selection: lees(path.join("final-candidates", "selection.json")),
    packages: Object.fromEntries(["A", "B", "C"].map((p) => [p, lees(path.join("final-candidates", p, "metrics.json"))])),
    tests: lees("test-results.json"),
    features: lees(path.join(WORTEL, "docs", "human-roster-benchmark", "official-features.json")),
    contrast: lees(path.join(WORTEL, "docs", "human-roster-benchmark", "contrastive-check.json")),
    config: lees(path.join(WORTEL, "configs", "optimizer-config-v1.0.4-rhythm.json")),
    rules: lees("decision-rules.json"),
    r1: lees("decision-r1.json"),
    r2: lees("decision-r2.json"),
    restAnalysis: lees("rest-analysis.json"),
    e2eReruns: lees("e2e-reruns.json"),
  };
}

// ── Hulpjes ─────────────────────────────────────────────────────────────────

const spec = (key: string) => {
  const s = METRICS.find((m) => m.key === key);
  if (!s) throw new Error(`Onbekende maat ${key}`);
  return s;
};
const gem = (m: PhaseMeasurement | null, key: string, strategies?: readonly string[]): number | null => {
  if (!m) return null;
  const s = spec(key);
  const xs = m.runs
    .filter((r) => !strategies || strategies.includes(r.strategy))
    .flatMap((r) => r.candidates.map((k) => s.get(k.metrics)))
    .filter((x): x is number => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const oordeel = (key: string, voor: number | null, na: number | null) => {
  if (voor === null || na === null) return "—";
  const d = na - voor;
  if (Math.abs(d) < 1e-9) return `<span class="same">gelijk</span>`;
  const beter = spec(key).higherIsBetter ? d > 0 : d < 0;
  return `<span class="${oordeelKlasse(beter ? "beter" : "slechter")}">${beter ? "beter" : "slechter"}</span>`;
};
const datum = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const NAAM: Record<string, string> = {
  "DDR-V": "Vroeg",
  "DDR-VL": "Vroeg/Laat",
  "DDR-L": "Laat",
  "DDR-LN": "Laat/Nacht",
  "DDR-MIX": "Mix",
  "DDR-BLM": "BLM",
  "DDR-50MIX": "50+ Mix",
};
const naam = (code: string) => NAAM[code] ?? code;

/** Vergelijkingstabel over een lijst maten en een reeks metingen. */
function vergelijk(kolommen: readonly { head: string; m: PhaseMeasurement | null; strategies?: readonly string[] }[], sleutels: readonly string[], officieel: PhaseMeasurement | null, caption?: string, note?: string): string {
  return tabel({
    caption,
    columns: [{ head: "Maat" }, { head: "Officieel", numeric: true }, ...kolommen.map((k) => ({ head: k.head, numeric: true })), { head: "Laatste t.o.v. eerste" }],
    rows: sleutels.map((key) => {
      const s = spec(key);
      const waarden = kolommen.map((k) => gem(k.m, key, k.strategies));
      return [
        escape(s.label),
        officieel ? nummer(s.get(officieel.official), s.decimals) : "—",
        ...waarden.map((w) => nummer(w, s.decimals)),
        oordeel(key, waarden[0], waarden[waarden.length - 1]),
      ];
    }),
    note,
  });
}

const KERN = ["robust", "worstLine", "nights", "flow", "rest", "hours", "fairness", "singletons", "pairs", "nightBlockValue", "worstNightExit", "minRecoveryHours", "exitsBelowRule", "coherence", "oscillations", "startJitterMean"];

// ── Opbouw ──────────────────────────────────────────────────────────────────

function bouw(g: Gegevens): string {
  const hoofdstukken: Chapter[] = [
    h1Samenvatting(g),
    h2Baseline(g),
    h3Benchmark(g),
    h4Patronen(g),
    h5Nachtarchitectuur(g),
    h6Herstel(g),
    h7Samenhang(g),
    h8Klok(g),
    h9Cyclus(g),
    h10Profielen(g),
    h11UrenEerlijkheid(g),
    h12Wisselkoersen(g),
    h13Reparatie(g),
    h14AB(g),
    h15Afgewezen(g),
    h16BeforeAfter(g),
    h17PerRooster(g),
    h18SlechtsteRegel(g),
    h19Nachten(g),
    h20Rekentijd(g),
    h21Beperkingen(g),
    h22Kandidaten(g),
    h23Reproduceerbaarheid(g),
    // Deel II: de vervolgronde "machinist preference intelligence" (hoofdstuk 24 e.v.).
    ...machinistChapters(),
  ];
  const omslag = `
<section class="cover">
  <div class="cover-top">
    ${beeldmerk(20)}
    <div class="cover-tag">Roosterplatform<br>Engineering report<br>${escape(datum(new Date().toISOString()))}</div>
  </div>
  <div class="cover-mid">
    <div class="kicker">Versie 1.0.4 · final brain</div>
    <h1>Blokken, ritme,<br>herstel</h1>
    <p class="claim">Wat zeven menselijke roosters laten zien, wat het roosterbrein feitelijk ruilde,
    wat er is veranderd en wat dat opleverde — en drie pakketten die op een menselijk oordeel wachten.</p>
  </div>
  <div class="cover-band">
    <div class="place">Standplaats Dordrecht · referentie DDR_BDU_05_10_2026</div>
    <div class="version">${g.before ? `${g.before.runs.length} runs v1.0.4` : "—"} · ${g.after ? `${g.after.runs.length} runs AFTER` : "AFTER ontbreekt"}<br>zoekmachine adaptive-1.0.4-rhythm<br>kwaliteitsmodel ${escape(g.after?.qualityModel ?? g.before?.qualityModel ?? "—")}</div>
  </div>
</section>`;
  const inhoud = `
<section class="toc">
  <div class="head" style="border-bottom:2px solid var(--ns-blue);padding-bottom:3mm;margin-bottom:5mm"><h2 style="font-size:21px">Inhoud</h2></div>
  ${hoofdstukken.map((h) => `<div class="toc-row"><div class="num">${h.number}</div><div class="name">${escape(h.title)}</div><div class="what">${escape(h.what)}</div></div>`).join("")}
  <p class="note" style="margin-top:6mm">Gegenereerd uit <code>docs/v1.0.4-final-brain/</code>. Hoofdstuk 23 noemt per bestand de opdracht die het maakt.</p>
</section>`;
  return document({ title: "NS Roosterplatform v1.0.4 — Final Brain", cover: omslag, toc: inhoud, chapters: hoofdstukken.map(hoofdstuk) });
}

// ── 1 ───────────────────────────────────────────────────────────────────────

function h1Samenvatting(g: Gegevens): Chapter {
  const poorten = (g.gates?.gates ?? []) as Json[];
  const gehaald = poorten.filter((p) => p.pass).length;
  const niet = poorten.filter((p) => !p.pass);
  const rijen = poorten.map((p) => [
    escape(String(p.label)),
    escape(String(p.rule)),
    p.before === null ? "—" : nummer(p.before, 2),
    p.after === null ? "—" : nummer(p.after, 2),
    p.delta === null ? "—" : verschil(p.delta, 2),
    p.ci95 ? `[${nummer(p.ci95[0], 2)}; ${nummer(p.ci95[1], 2)}]` : "—",
    p.pass ? `<span class="better">ja</span>` : `<span class="worse">nee</span>`,
  ]);
  return {
    number: 1,
    title: "Samenvatting",
    what: "Wat er is gedaan, wat de poorten zeggen, wat niet wordt beweerd",
    body: `
<p class="lede">v1.0.4 was technisch sterk maar legde nachtreeksen waar het urenbalans won, niet waar mensen ze leggen. Deze ronde
heeft gemeten wat het brein feitelijk ruilde, de nachtarchitectuur daarop aangepast, elke wijziging apart gemeten, en de
uitkomst met dezelfde twintig-runmeting als v1.0.4 getoetst.</p>
${
  g.gates
    ? blok(
        `AFTER haalt <strong>${gehaald} van de ${poorten.length}</strong> acceptatiepoorten tegenover de bevroren v1.0.4.${niet.length ? ` Niet gehaald: ${niet.map((p) => escape(String(p.label).toLowerCase())).join("; ")}.` : " Alle poorten groen."}`,
        niet.length ? "warn" : "ok",
      ) + tabel({ caption: "Acceptatiepoorten (werkopdracht §25)", columns: [{ head: "Poort" }, { head: "Regel" }, { head: "BEFORE", numeric: true }, { head: "AFTER", numeric: true }, { head: "Verschil", numeric: true }, { head: "95%-interval" }, { head: "Gehaald" }], rows: rijen, note: "Gemiddelden over de kandidaten. Het interval is een bootstrap over de kandidaten (2000 trekkingen, vaste zaadwaarde): ligt nul erbinnen, dan is het verschil niet van ruis te onderscheiden." })
    : ontbreekt("gates.json (AFTER tegen BEFORE)")
}
${
  g.gates
    ? blok(
        g.gates.allPass
          ? "<strong>Besluit: aangenomen.</strong> Alle poorten zijn gehaald."
          : `<strong>Besluit: niet aangenomen als eindstand van deze ronde.</strong> ${gehaald} van de ${poorten.length} poorten. Van de ${niet.length} niet gehaalde poorten ${niet.filter((p) => p.ci95 && (p.ci95[0] > 0 || p.ci95[1] < 0)).length === 1 ? "is er één" : `zijn er ${niet.filter((p) => p.ci95 && (p.ci95[0] > 0 || p.ci95[1] < 0)).length}`} van ruis te onderscheiden. Volgens §26 zijn er daarom geen reviewpakketten gemaakt (hoofdstuk 22); de vervolgronde begint vanaf deze stand.`,
        g.gates.allPass ? "ok" : "bad",
      )
    : ""
}
<h3 class="sec">De belangrijkste inzichten</h3>
<ol>
  <li><strong>De twee helften van het brein ruilden tegen verschillende koersen.</strong> De solver legde de nachtreeksen en gaf een
  nachtuitgang onder de herstelregel op voor enkele seconden per week urenbalans; het kwaliteitsmodel waar het bijschaven op stuurt,
  rekent daar ongeveer een uur per week voor. Het bijschaven kan een nachtreeks niet verplaatsen (hoofdstuk 12).</li>
  <li><strong>Nachtreparaties werkten al, maar werden altijd afgewezen</strong> — in v1.0.4 en de eerste metingen 9 van de 9, omdat rust
  of eerlijkheid zakte (hoofdstuk 13).</li>
  <li><strong>Twee keer beloonde een meetdefinitie minder rust boven meer</strong> (H04, H09), en de zoekmachine vond het gat telkens
  binnen één meting. Monotonie is nu met eigenschapstests vastgelegd, en een Goodhart-jacht hoort bij de controle (hoofdstuk 6).</li>
  <li><strong>Rust en regelmaat trekken in deze meting deels tegen elkaar in.</strong> Het rustoverschot beloont een late dienst na een
  vroeg eindigende late; samenhangende late blokken met gelijke begintijden (afloper na afloper) geven minder overschot. De menselijke
  roosters zitten daar zelf nog lager (rust 79,4). Dat is gemeten en uitgelegd, niet weggepoetst (hoofdstuk 11 en <code>rest-analysis.json</code>).</li>
</ol>
<h3 class="sec">Wat dit rapport niet beweert</h3>
<ul>
  <li>Dat deze roosters beter zijn voor de mensen die ze rijden. De drie pakketten in hoofdstuk 22 zijn door niemand beoordeeld.</li>
  <li>Dat de menselijke principes wetten zijn: één roosterperiode van één standplaats.</li>
  <li>Iets over gezondheid. "Eerst herstel, dan laat" is een voorkeur in roosterontwerp, gemeten aan wat mensen maakten.</li>
</ul>`,
  };
}

// ── 2 ───────────────────────────────────────────────────────────────────────

function h2Baseline(g: Gegevens): Chapter {
  const f = g.freeze;
  const b = g.before;
  return {
    number: 2,
    title: "Baseline: v1.0.4 bevroren",
    what: "Wat bevroren is, hoe dat is aangetoond, en hoe v1.0.4 scoort",
    body: `
<p>v1.0.4 is nooit als geheel gecommit: HEAD is v1.0.3 plus het benchmarkharnas, en de werkmap bevatte v1.0.4 plus later werk.
Een git-commit nu zou dus niet "exact v1.0.4" zijn. Bevroren is wat wél exact v1.0.4 is: de twintig ruwe runs van de v1.0.4-meting,
de configuratie en kwaliteitsmodel v1, met de SHA-256 van elk bestand in <code>freeze.json</code>.</p>
${
  f
    ? blok(
        `Model v1 in de huidige code beoordeelt elke v1.0.4-kandidaat opnieuw: ${f.reproduction.candidatesCompared} kandidaten, grootste verschil met de getallen uit het v1.0.4-rapport <strong>${f.reproduction.maxAbsoluteDifference}</strong>. ${f.reproduction.identical ? "Identiek." : "NIET identiek."}`,
        f.reproduction.identical ? "ok" : "bad",
      )
    : ontbreekt("freeze.json")
}
<p>Het gedrag van v1.0.4 is als profiel te draaien (<code>NS_ENGINE_PROFILE=frozen-1.0.4</code>): rangschikken op model v1, klassieke
overgangstabel, geen bewaking, geen slechtste geval, geen nachtuitgangreparatie. Hoofdstuk 14 toont een reproductie ermee.</p>
<p><strong>Zaadwaarden.</strong> Elke run van een strategie gebruikt dezelfde zaadwaarden (starts 101–105, reparaties 1001 en verder);
de spreiding tussen de twintig runs is dus de niet-determinisme van CP-SAT met acht zoekdraden, geen verschil in zaad. Dat maakt
elke ablatie vanzelf gepaard op zaad.</p>
${b ? vergelijk([{ head: "v1.0.4", m: b }], KERN, b, "v1.0.4, twintig runs (10 Evenwichtig, 5 Rust & regelmaat, 5 Eerlijke lasten)", `Gemeten met ${escape(b.qualityModel)} (definitie ${escape(String((b as Json).qualityModelHash ?? "—"))}). Rekentijd per run gemiddeld ${nummer(b.runtime?.mean, 0)} s.`) : ontbreekt("before.json")}`,
  };
}

// ── 3 ───────────────────────────────────────────────────────────────────────

function h3Benchmark(g: Gegevens): Chapter {
  const f = g.features;
  if (!f) return { number: 3, title: "De menselijke benchmark", what: "Zeven officiële roosters", body: ontbreekt("official-features.json") };
  return {
    number: 3,
    title: "De menselijke benchmark",
    what: "Zeven officiële Dordrechtse roosters, ingelezen en gecontroleerd",
    body: `
<p>De zeven PDF's van dienstenpakket DDR-BDU-05-10-2026 zijn cel voor cel ingelezen en tegen twee bronnen gecontroleerd: de tijden
tegen het dienstenpakket (dienst plus weekdag), elke cel tegen het officiële rooster in de database. Afwijkingen:
<strong>${(f.reconciliation.deviations as unknown[]).length}</strong>.</p>
${blok(escape(String(f.sampleSizeWarning)), "warn")}
${tabel({
  columns: [{ head: "Rooster" }, { head: "Regels", numeric: true }, { head: "Gewerkt", numeric: true }, { head: "V / L / N", numeric: true }, { head: "Nachtreeksen" }, { head: "Eén dagdeel (%)", numeric: true }, { head: "Sprong (min)", numeric: true }, { head: "Week incl. pauze", numeric: true }],
  rows: (f.rosters as Json[]).map((r) => [
    escape(naam(r.code)),
    String(r.lines),
    String(r.workedDays),
    `${r.dayparts.E ?? 0} / ${r.dayparts.L ?? 0} / ${r.dayparts.N ?? 0}`,
    ((r.nightBlocks?.lengths as number[]) ?? []).join(", ") || "—",
    nummer(r.workBlocks.meanDominantShare, 1),
    nummer(r.startTime?.sameDaypartAdjacentDeltas?.mean ?? null, 0),
    escape(String(r.hours.averageWeekIncludingBreak)),
  ]),
})}`,
  };
}

// ── 4 ───────────────────────────────────────────────────────────────────────

function h4Patronen(g: Gegevens): Chapter {
  const o = g.before?.official;
  return {
    number: 4,
    title: "Gevonden menselijke patronen",
    what: "Wat de data objectief laat zien, en wat niet",
    body: `
<p>Het volledige bewijs staat in <code>human-pattern-evidence.md</code>. De kern:</p>
${tabel({
  columns: [{ head: "Patroon" }, { head: "In de menselijke roosters" }],
  rows: [
    ["Werkblok van één dagdeel", o ? `${o.coherence.fullyCoherent} van de ${o.coherence.blocks} (${nummer(o.coherence.coherentShare, 1)}%)` : "—"],
    ["Nachtreeksen", o ? `${Object.entries(o.nights.blocks).map(([l, n]) => `${n}× ${l}`).join(", ")}; geen losse nacht, geen reeks van twee` : "—"],
    ["Herstel na een nachtreeks", o ? `kortste ${nummer(o.nights.minRecoveryHours, 0)} uur; altijd 2–3 vrije dagen, dan laat` : "—"],
    ["Begintijdsprong binnen een dagdeel", o ? `gemiddeld ${nummer(o.startJitter.mean, 0)} min, p90 ${nummer(o.startJitter.p90, 0)}` : "—"],
    ["Wissels vooruit / terug op de klok", o ? `${o.transitions.forwardChanges} / ${o.transitions.backwardChanges}` : "—"],
    ["Directe wissel terug (> 1 uur)", o ? String(o.transitions.backwardDirectOver60) : "—"],
    ["Dagdeelwissels via rust", o ? `${nummer(o.transitions.changesThroughRest, 1)}%` : "—"],
  ],
})}
<p><strong>Richting (§7).</strong> Vooruit en terug komen even vaak voor. Het verschil zit in de rust: terug gaat in de menselijke roosters
altijd over rust. Een drempel per richting is op twee voorbeelden per richting niet te onderbouwen en is niet gebouwd; het model meet de
klokverschuiving en de rust.</p>
<h3 class="sec">Wat deze roosters níet laten zien</h3>
<ul><li>Of medewerkers deze patronen expliciet waarderen.</li><li>Of het elders of in een andere periode hetzelfde is.</li><li>Een fysiologische onderbouwing.</li></ul>`,
  };
}

// ── 5 ───────────────────────────────────────────────────────────────────────

function h5Nachtarchitectuur(g: Gegevens): Chapter {
  const c = g.config;
  return {
    number: 5,
    title: "Nachtarchitectuur",
    what: "Waar nachtreeksen ontstaan, en wat er daar is veranderd",
    body: `
<p>Nachtreeksen ontstaan in de CP-SAT-solver. Rust-, WR-, CO- en RES-dagen liggen vast in de roosterstructuur; de solver vult alleen
dienstdagen. Of een reeks via één of twee vrije dagen eindigt, hangt dus af van <em>waar</em> hij ligt. Elk nachtrooster heeft plekken waar
een reeks van drie of meer vlak voor twee vrije dagen eindigt (BLM 5, Laat/Nacht 3, Mix 5); de officiële roosters gebruiken precies die.</p>
<p>Het bijschaven ruilt twee cellen tegelijk en kan een reeks niet verplaatsen zonder hem onderweg te breken (een losse nacht scoort 0).
De Goodhart-jacht bevestigt het: het bijschaven dreef de score op zonder één nachtpatroon slechter te maken (hoofdstuk 6). De hefboom
voor nachtuitgangen zit dus in de solver en in de reparatie.</p>
${tabel({
  caption: "Wat de solver voor nachten kent",
  columns: [{ head: "Term" }, { head: "Wat" }, { head: "Evenwichtig" }],
  rows: [
    ["Losse nacht", "per nacht zonder nacht ervoor of erna, rond over de regelgrens", "900"],
    ["Reeks van twee", "per reeks van precies twee", "700"],
    ["Nachtuitgang", "de nachtrij van de overgangstabel: direct, over één, over twee vrije dagen", `× 40 per strafpunt; nachtrij × ${escape(String(c?.adaptive?.humanRhythm?.nightExitScale ?? "—"))}`],
    ["Nacht buiten een nachtrooster", "per nacht", "400"],
  ],
})}
<p>Geen harde minimumlengte (§"geen harde 3-minimum"): een korte reeks blijft mogelijk als dekking of regels dat afdwingen, maar kost
de solver dan wat hoofdstuk 12 laat zien.</p>`,
  };
}

// ── 6 ───────────────────────────────────────────────────────────────────────

function h6Herstel(g: Gegevens): Chapter {
  const a = g.adversarial;
  return {
    number: 6,
    title: "Herstelmodel",
    what: "Eerst herstel, dan richting; monotonie vastgelegd; het slechtste geval telt",
    body: `
${tabel({
  caption: "Waarde van een nachtuitgang (model v2, H09)",
  columns: [{ head: "Herstel" }, { head: "Laat (of weer nacht)", numeric: true }, { head: "Vroeg", numeric: true }],
  rows: [["onder de herstelregel (46 u)", "0", "0"], ["46–72 u", "1", "0,25"], ["vanaf 72 u", "1", "0,5"]],
  note: "Nooit lager bij meer herstel; laat nooit onder vroeg bij gelijk herstel; elke uitgang onder de regel slechter dan elke uitgang erboven. Een eerste versie gaf nacht-vrij-laat (32 u) 0,5 en nacht-vrij-vrij-vroeg (48 u) 0: minder rust scoorde beter (H09).",
})}
<p><strong>Eigenschapstests (§14).</strong> Vastgelegd in <code>tests/domain/brein-eigenschappen.test.ts</code> en <code>slechtste-geval.test.ts</code>:
meer herstel verlaagt nachten, rust en de robuuste score nooit (0 tot 4 vrije dagen, gevolgd door laat én door vroeg); minder
heen-en-weer scoort nooit lager; een extra losse nacht scoort nooit beter; samenhang nooit slechter dan dezelfde diensten door elkaar;
de nachtrij in de solver houdt bij elke schaal zijn volgorde. De eerste opzet van de hersteltest verschoof ongemerkt een dienst van
regel en mat daarmee de urenverdeling; die fout in de test is gevonden en hersteld.</p>
<p><strong>Het slechtste geval (H10, §13).</strong> De robuuste score trekt 1,5 × (1 − de laagste uitgangswaarde) af: één nachtreeks
met te kort herstel kost evenveel als tien punten op de slechtste regel. Het minimum verdunt niet — een extra goede reeks erbij maakt het
niet beter — dus opknippen levert niets op. Het officiële rooster verliest er niets door.</p>
${
  a
    ? tabel({
        caption: "Goodhart-jacht: de zoekmachine drijft de score op; wordt een menselijk patroon slechter?",
        columns: [{ head: "Start" }, { head: "Robuust", numeric: true }, { head: "Ruilen", numeric: true }, { head: "Slechter geworden" }],
        rows: (a.hunt as Json[]).map((h) => [escape(String(h.start)), `${nummer(h.robustBefore, 1)} → ${nummer(h.robustAfter, 1)}`, String(h.swaps), (h.worsened as Json[]).length ? (h.worsened as Json[]).map((w) => `${escape(String(w.label))} ${w.before} → ${nummer(w.after, 0)}`).join("; ") : "niets"]),
        note: "Ruwe patronen zijn tellingen, geen modeluitkomst: uitgangen onder de regel, losse nachten, reeksen van twee, directe wissels terug op de klok, heen-en-weer, krappe rust, blokken met meer dagdelen, begintijdsprong, urenafwijking, spreiding van nachten en weekenden.",
      }) +
      tabel({
        caption: "Tegenvoorbeelden per principe: ziet het model het?",
        columns: [{ head: "Principe" }, { head: "Ruilen", numeric: true }, { head: "Onderdeel: mens → bedorven", numeric: true }, { head: "Robuust: mens → bedorven", numeric: true }, { head: "Gezien" }],
        rows: (a.negatives as Json[]).map((n) => [escape(String(n.principle)), String(n.swaps), `${escape(String(n.component))} ${nummer(n.componentHuman, 1)} → ${nummer(n.componentNegative, 1)}`, `${nummer(n.robustHuman, 1)} → ${nummer(n.robustNegative, 1)}`, n.seesIt && n.humanHigher ? "ja" : `<span class="worse">nee</span>`]),
      })
    : ontbreekt("adversarial.json")
}`,
  };
}

// ── 7 ───────────────────────────────────────────────────────────────────────

function h7Samenhang(g: Gegevens): Chapter {
  return {
    number: 7,
    title: "Samenhang in werkblokken",
    what: "Eén dagdeel per blok, als eigen maat",
    body: `
<p>Per aaneengesloten werkblok (RES breekt een blok): het dominante dagdeel en het aandeel diensten daarin. Twee maten: het aandeel
blokken met één dagdeel (menselijk 98 van 102) en het aandeel dagen in het dominante dagdeel van blokken van twee of meer dagen. Een blok
vroeg-vroeg-vroeg-vroeg scoort 100; vroeg-laat-vroeg-laat 50 én telt als heen-en-weer.</p>
${vergelijk([{ head: "v1.0.4", m: g.before }, { head: "AFTER", m: g.after }], ["coherence", "coherentShare", "oscillations", "changesThroughRest", "worstWorkBlock"], g.before)}`,
  };
}

// ── 8 ───────────────────────────────────────────────────────────────────────

function h8Klok(g: Gegevens): Chapter {
  return {
    number: 8,
    title: "Overgangen op de klok",
    what: "Het etiket is informatie, niet de hele waarheid",
    body: `
<p>In 50+ Mix en BLM overlappen de etiketten vroeg en laat op de klok. Een wissel geldt daarom als echte wissel als de begintijd meer dan
een uur verschuift (de vrije begintijdsprong, gelijk aan de menselijke mediaan); tot en met een uur is het alleen een ander etiket. De
officiële etiketwissels zonder verschuiving zijn 19 en 41 minuten. Met de eerste grens van drie uur liet het bijschaven in BLM een laat
van 09:47 gratis volgen door een vroeg van 07:22 — 13 uur rust, 145 minuten terug op de klok (H09).</p>
${vergelijk([{ head: "v1.0.4", m: g.before }, { head: "Ontwikkeling 1", m: g.dev1 }, { head: "AFTER", m: g.after }], ["heavyClockAware", "worstTransition", "backwardDirectOver60", "oscillations", "startJitterMean", "startJitterP90"], g.before, undefined, "Ontwikkeling 1: de eerste AFTER-meting, met de grens van drie uur. Zwaarste overgang op het etiket gemeten; het officiële rooster haalt daar 4 door de laat → vroeg van 19 en 41 minuten.")}`,
  };
}

// ── 9 ───────────────────────────────────────────────────────────────────────

function h9Cyclus(g: Gegevens): Chapter {
  return {
    number: 9,
    title: "De cyclus als cirkel",
    what: "Zondag van regel N naar maandag van regel N+1, en de laatste regel naar de eerste",
    body: `
<p>Nachtreeksen, werkblokken, begintijdsprongen en rust worden over de regelgrens gemeten, ook van de laatste regel naar de eerste.
Een nachtreeks van zondag naar maandag is één reeks. Tests leggen vast dat een reeks over de grens één reeks is, dat een werkblok rond
het einde van de cyclus doorloopt, en dat een slechte overgang over de grens precies zo telt als dezelfde overgang midden in de week.</p>
${vergelijk([{ head: "v1.0.4", m: g.before }, { head: "AFTER", m: g.after }], ["boundaryHeavy"], g.before)}`,
  };
}

// ── 10 ──────────────────────────────────────────────────────────────────────

function h10Profielen(g: Gegevens): Chapter {
  return {
    number: 10,
    title: "Profielen",
    what: "Karakter per profiel, en waarom er geen aparte functie per profiel is",
    body: `
<p>Eén roosterperiode per profiel is te dun om per profiel een aparte menselijkheidsfunctie te ijken; dat zou één steekproef tot
sjabloon maken. Het profielkarakter wordt opgevangen door wat al profielbewust is: klokbewust meten (50+ Mix, BLM), blokken van één
dagdeel waarderen (Vroeg/Laat, Mix, BLM — vrijheid is geen willekeur), de profielgrens hard, en uren op roosterniveau. Hoofdstuk 17
meet elk basisrooster apart, zodat een profiel dat achteruitgaat niet in het gemiddelde verdwijnt.</p>
${tabel({
  columns: [{ head: "Profiel" }, { head: "Karakter in het menselijke rooster" }],
  rows: [
    ["Vroeg", "alleen vroeg; begintijden 04:23–09:27"],
    ["Laat", "alleen laat; begintijden 11:09–18:08"],
    ["Vroeg/Laat", "elk blok één familie; wissels over 1–4 vrije dagen"],
    ["Laat/Nacht", "laat plus een reeks van zes nachten over de regelgrens; daarna rust, rust, laat"],
    ["Mix", "per regel één familie; twee reeksen van vijf nachten"],
    ["BLM", "vroege blokken, late blokken, één aparte nachtreeks"],
    ["50+ Mix", "daguren; wisselt van etiket, niet van klok"],
  ],
})}`,
  };
}

// ── 11 ──────────────────────────────────────────────────────────────────────

function h11UrenEerlijkheid(g: Gegevens): Chapter {
  const ab = (g.ablations?.ablations ?? []) as Json[];
  const marge: Record<string, string> = { "ab-k5-f025": "0,25", "ab-k5-full": "0,5 (standaard)", "ab-k5-f100": "1,0" };
  const tol = ["ab-k5-f025", "ab-k5-full", "ab-k5-f100"].map((f) => ab.find((x) => x.phase === f && x.status === "gemeten")).filter((x): x is Json => Boolean(x));
  return {
    number: 11,
    title: "Uren en eerlijkheid",
    what: "Uren op cyclusniveau, en wat de eerlijkheidsbewaking kost",
    body: `
<p><strong>Uren.</strong> De solver stuurt per basisrooster naar het contractgemiddelde, niet per regel; het kwaliteitsmodel splitst uren in
het cyclusgemiddelde (0,75) en uitschieters per regel buiten een natuurlijke band van 10,5 uur per week (0,25). Een regel van 32 of 48 uur
is geen fout; een test legt vast dat een regel op precies 40 uur niet wint van een natuurlijke spreiding.</p>
<p><strong>Eerlijkheid.</strong> Winst op ritme mag geen eerlijkheid kopen: het bijschaven en de reparatie mogen eerlijkheid hooguit een marge
laten zakken ten opzichte van de start. De werkopdracht vroeg de marges 0,25, 0,5 en 1,0 te meten.</p>
${
  tol.length
    ? tabel({
        caption: "Eerlijkheidsmarge (Evenwichtig, drie runs per marge)",
        columns: [{ head: "Variant" }, { head: "Eerlijkheid", numeric: true }, { head: "Nachten", numeric: true }, { head: "Uitgangen < 46 u", numeric: true }, { head: "Robuust", numeric: true }, { head: "Poorten" }],
        rows: tol.map((x) => [escape(marge[String(x.phase)] ?? String(x.label)), nummer(x.means.fairness, 1), nummer(x.means.nights, 1), nummer(x.means.exitsBelowRule, 2), nummer(x.means.robust, 1), `${x.gatesPassed}/${x.gatesTotal}`]),
        note: "Alle drie met de gerichte nachtuitgangreparatie aan (de variant waarin de marge werd getest). Beslisregel R2: de meeste poorten; bij gelijkspel 0,5.",
      })
    : ontbreekt("de ablaties van de eerlijkheidsmarge")
}
${vergelijk([{ head: "v1.0.4", m: g.before }, { head: "AFTER", m: g.after }], ["hours", "maxRosterHoursDeviation", "fairness"], g.before)}
<h3 class="sec">Waarom rust zakt</h3>
${
  g.restAnalysis
    ? tabel({
        columns: [{ head: "" }, { head: "Rust", numeric: true }, { head: "Overschot", numeric: true }, { head: "Herstel na nachten", numeric: true }, { head: "Vroeg → vroeg (gem. overschot)", numeric: true }, { head: "Laat → laat (gem. overschot)", numeric: true }],
        rows: (["official", "after", "brain-after"] as const)
          .filter((k) => g.restAnalysis![k])
          .map((k) => {
            const x = g.restAnalysis![k];
            const t = (o: Json | undefined) => (o ? `${nummer(o.count, 1)}× · ${nummer(o.meanSurplusHours, 1)} u` : "—");
            return [{ official: "Officieel", after: "v1.0.4", "brain-after": "AFTER" }[k], nummer(x.rest, 1), nummer(x.surplus, 1), nummer(x.recovery, 1), t(x.adjacentByTransition["E→E"]), t(x.adjacentByTransition["L→L"])];
          }),
        note: "Overschot: rust tussen diensten op opeenvolgende dagen boven de geplande 12 uur, in banden. Het verschil zit in laat → laat: samenhangende late blokken met gelijke begintijden (een afloper na een afloper) laten minder overschot. Het menselijke rooster zit daar het laagst.",
      })
    : ontbreekt("rest-analysis.json")
}`,
  };
}

// ── 12 ──────────────────────────────────────────────────────────────────────

function h12Wisselkoersen(g: Gegevens): Chapter {
  const r = g.rates;
  if (!r) return { number: 12, title: "Wisselkoersen", what: "Wat het brein ruilt", body: ontbreekt("objective-exchange-rates.json") };
  const b = (r.cpsat as Json[])[0];
  const kolommen = (b.tables as Json[]).map((t) => String(t.tables));
  const rijen = ((b.tables as Json[])[0].events as Json[]).map((e, i) => [
    escape(String(e.label)),
    escape(String(e.recovery ?? "")),
    ...(b.tables as Json[]).map((t) => {
      const x = (t.events as Json[])[i];
      return `${nummer(x.cost, 0)}<br><span class="note">${x.minutesPerWeek >= 1 ? `${nummer(x.minutesPerWeek, 1)} min/w` : `${nummer(x.minutesPerWeek * 60, 0)} s/w`}</span>`;
    }),
  ]);
  const ev = r.evaluator as Json;
  return {
    number: 12,
    title: "Wisselkoersen",
    what: "Hoeveel minuten urenbalans het brein opgeeft voor een ritmegebeurtenis",
    body: `
<p>De doelfunctie van CP-SAT is lineair, dus de prijs van een gebeurtenis is exact zijn coëfficiënt. Uitgedrukt in één munt: minuten per
week afwijking van het urengemiddelde van één basisrooster (<code>hoursBalance × 60</code> = ${b.hoursUnitPerMinutePerWeek} in Evenwichtig).
Volledig: <code>objective-exchange-rates.md</code>.</p>
<div class="wide">${tabel({ caption: "CP-SAT, Evenwichtig", columns: [{ head: "Gebeurtenis" }, { head: "Herstel" }, ...kolommen.map((k) => ({ head: k, numeric: true }))], rows: rijen })}</div>
${tabel({
  caption: `Het kwaliteitsmodel, marginaal (${r.package.rosters} roosters, ${r.package.nights} nachten in ${r.package.nightBlocks} reeksen, ${r.package.workedDays} gewerkte dagen)`,
  columns: [{ head: "Gebeurtenis" }, { head: "Robuust", numeric: true }, { head: "In urenmunt", numeric: true }],
  rows: [
    ["1 min/week uren in één rooster", nummer(-ev.hoursPerMinutePerWeek, 3), "1 min/w"],
    ...Object.entries(ev.events as Record<string, number>).map(([k, v]) => [escape(({ singleton: "Losse nacht", pair: "Reeks van twee", exitBelowRule: "Nachtuitgang onder de regel", lateEarly: "Laat → vroeg", oscillation: "Heen-en-weer" } as Record<string, string>)[k] ?? k), nummer(v, 2), `${nummer(-v / ev.hoursPerMinutePerWeek, 0)} min/w`]),
  ],
  note: "Effecten op de slechtste regel en het slechtste geval komen erbovenop.",
})}
${blok("Voor een nachtuitgang onder de herstelregel rekent het kwaliteitsmodel ongeveer een uur per week urenbalans, de solver van v1.0.4 enkele seconden. Het brein bouwde de structuur tegen een koers die het zelf, een stap later, niet deelde.", "warn")}`,
  };
}

// ── 13 ──────────────────────────────────────────────────────────────────────

function h13Reparatie(g: Gegevens): Chapter {
  const r = (g.repairs?.phases ?? []) as Json[];
  return {
    number: 13,
    title: "Reparatiearchitectuur",
    what: "Starts, gerichte reparatie, bijschaven — en waarom nachtreparaties faalden",
    body: `
${figuur(flowDiagram([
  { title: "Starts (CP-SAT)", note: "volledige pakketten; hier ontstaat de structuur, ook waar de nachtreeksen liggen" },
  { title: "Bijschaven (ruilen)", note: "per kandidaat, op het kwaliteitsmodel; kan geen reeks verplaatsen" },
  { title: "Gerichte reparatie (CP-SAT op enkele roosters)", note: "nachten eerst: losse nachten, reeksen van twee, nachtuitgang" },
  { title: "Aanvaarden of afwijzen", note: "rangschikking omhoog, geen onderdeel onder zijn marge" },
  { title: "Diversificatie en keuze", note: "drie verschillende kandidaten" },
]), "De zoekstappen in volgorde. In rekentijdmodus Normaal zijn dat drie starts en twee à drie reparaties per run.")}
${tabel({
  caption: "Reparatietypen",
  columns: [{ head: "Werkopdracht" }, { head: "In de zoekmachine" }],
  rows: [
    ["NIGHT_SINGLETON_REPAIR, NIGHT_PAIR_REPAIR", "NIGHTS: bestond al; vrije roosters: de nachtroosters en roosters met een korte reeks"],
    ["NIGHT_EXIT_REPAIR", "NIGHT_EXIT: nieuw. Doel bij een uitgang onder de regel; nachtrij × reparatieversterking, reeksgewichten én rustcomfort omhoog"],
    ["OSCILLATION_REPAIR, HEAVY_TRANSITION_REPAIR", "TRANSITIONS: bestond al"],
    ["HOURS_OUTLIER_REPAIR", "HOURS: bestond al (uren op roosterniveau)"],
    ["START_JITTER_REPAIR", "geen eigen reparatie: de solverterm maakte nachten en eerlijkheid slechter (H03); het bijschaven stuurt erop"],
    ["Nachten eerst (§19)", "nightFirst: nachtdoelen gaan vóór alle andere, ongeacht ernst"],
    ["Structuur vasthouden (§20)", "zacht: een reparatie kost 30 per dienstdag die afwijkt van de ouder. Een harde vergrendeling van nachtdagen is niet gebouwd (hoofdstuk 21)"],
  ],
})}
${
  r.length
    ? r
        .map((f) =>
          tabel({
            caption: `Reparaties in ${escape(String(f.phase))} (${f.runs} runs, ${nummer(f.repairsPerRun, 1)} per run)`,
            columns: [{ head: "Doel" }, { head: "Pogingen", numeric: true }, { head: "Aanvaard", numeric: true }, { head: "Afgewezen", numeric: true }, { head: "Mislukt", numeric: true }],
            rows: Object.entries(f.repairsByTarget as Record<string, Json>).map(([doel, x]) => [escape(doel), String(x.attempts), String(x.accepted), String(x.rejected), String(x.failed)]),
          }),
        )
        .join("")
    : ontbreekt("repair-analysis.json")
}
<p>In v1.0.4 en de eerste metingen werd élke nachtreparatie afgewezen, hoewel ze nachten 1 tot 10 punten verbeterden: rust zakte 2,8 tot 5,5
punt, of eerlijkheid 2,2 tot 5,9. Een minuut rustcomfort kost de solver 1, een minuut per week urenbalans 900. De nachtuitgangreparatie
zet daarom rustcomfort mee omhoog.</p>`,
  };
}

// ── 14 ──────────────────────────────────────────────────────────────────────

function h14AB(g: Gegevens): Chapter {
  const s = g.solverAb;
  const varianten = s ? (s.variants as string[]) : [];
  const per = (v: string, veld: string) => {
    const xs = ((s?.rows ?? []) as Json[]).filter((r) => r.variant === v && typeof r[veld] === "number").map((r) => r[veld] as number);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const ab = (g.ablations?.ablations ?? []) as Json[];
  const regels = (g.rules?.rules ?? []) as Json[];
  const bevroren = ab.find((x) => x.phase === "ab-frozen" && x.status === "gemeten");
  return {
    number: 14,
    title: "A/B-experimenten en ablaties",
    what: "Elke wijziging apart gemeten",
    body: `
<p>Elke keuze tussen varianten volgt een regel die vóór de uitslag is vastgelegd (<code>decision-rules.json</code>), zodat er achteraf
niet naar een gewenste uitkomst te redeneren valt.</p>
${tabel({ caption: "Beslisregels", columns: [{ head: "Regel" }, { head: "Waarover" }, { head: "Vastgelegd vóór" }, { head: "Regel" }], rows: regels.map((x) => [escape(String(x.id)), escape(String(x.about)), escape(String(x.recordedBefore)), escape(String(x.rule))]) })}
${g.r1 ? blok(`R1 kiest <strong>nachtrij × ${g.r1.chosenScale}</strong>.`, "info") : ontbreekt("decision-r1.json")}
${bevroren ? blok(`<strong>De ruisvloer.</strong> Drie runs van exact de bevroren v1.0.4 halen ${bevroren.gatesPassed} van de ${bevroren.gatesTotal} poorten tegen de twintig-runmeting van diezelfde v1.0.4. Een ablatie van drie runs die een poort mist, zegt dus weinig; een ablatie die er meer haalt dan de bevroren versie zelf, zegt iets.`, "warn") : ""}
${
  s
    ? tabel({
        caption: `De nachtrij in de solver: ruwe CP-SAT-uitkomst, ${s.seeds.length} zaden × ${s.seconds} s`,
        columns: [{ head: "Tabel" }, { head: "Uitgangen < 46 u", numeric: true }, { head: "Kortste herstel (u)", numeric: true }, { head: "Los / twee", numeric: true }, { head: "Uren", numeric: true }, { head: "Grootste afwijking (min/w)", numeric: true }, { head: "Eerlijkheid", numeric: true }, { head: "Rust", numeric: true }, { head: "Robuust", numeric: true }],
        rows: varianten.map((v) => [escape(v), nummer(per(v, "exitsBelowRule"), 2), nummer(per(v, "minRecoveryHours"), 1), `${nummer(per(v, "singletons"), 1)} / ${nummer(per(v, "pairs"), 1)}`, nummer(per(v, "hours"), 1), nummer(per(v, "maxRosterHoursDeviation"), 0), nummer(per(v, "fairness"), 1), nummer(per(v, "rest"), 1), nummer(per(v, "robust"), 1)]),
        note: "Alleen de solver: geen bijschaven, reparatie of rangschikking. klassiek = v1.0.4; mensN = de menselijke tabel met de nachtrij × N.",
      })
    : ontbreekt("solver-ab-nightrow.json")
}
${
  ab.length
    ? `<div class="wide">${tabel({
        caption: "Ablaties van de zoekmachine (Evenwichtig; tegen v1.0.4 op dezelfde strategie)",
        columns: [{ head: "Variant" }, { head: "Wat anders" }, { head: "Kand.", numeric: true }, { head: "Robuust", numeric: true }, { head: "< 46 u", numeric: true }, { head: "Kortste (u)", numeric: true }, { head: "Slechtste uitgang", numeric: true }, { head: "Los", numeric: true }, { head: "Twee", numeric: true }, { head: "Rust", numeric: true }, { head: "Eerlijk", numeric: true }, { head: "Poorten" }],
        rows: ab.map((x) =>
          x.status !== "gemeten"
            ? [escape(String(x.label)), escape(String(x.change)), "—", "—", "—", "—", "—", "—", "—", "—", "—", escape(String(x.status))]
            : [escape(String(x.label)), escape(String(x.change)), String(x.candidates), nummer(x.means.robust, 1), nummer(x.means.exitsBelowRule, 2), nummer(x.means.minRecoveryHours, 1), nummer(x.means.worstNightExit, 1), nummer(x.means.singletons, 2), nummer(x.means.pairs, 2), nummer(x.means.rest, 1), nummer(x.means.fairness, 1), `${x.gatesPassed}/${x.gatesTotal}`],
        ),
        note: "Drie runs per variant (negen kandidaten): een richting, geen bewijs. De toets is de AFTER-meting van twintig runs. De ablaties draaiden uit een bevroren kopie van de code (vingerafdruk 551aca67512aac1f), zodat ontwikkelwerk ernaast ze niet kon raken.",
      })}</div>`
    : ontbreekt("ablations.json")
}
${
  g.r2
    ? tabel({
        caption: "Beslisregel R2: wat aan blijft",
        columns: [{ head: "Onderdeel" }, { head: "Met (nacht / bewaking)", numeric: true }, { head: "Zonder (nacht / bewaking)", numeric: true }, { head: "Besluit" }],
        rows: [
          ...(g.r2.decisions as Json[]).map((d) => [escape(String(d.component)), d.onCounts ? `${d.onCounts.night} / ${d.onCounts.guard}` : "—", d.offCounts ? `${d.offCounts.night} / ${d.offCounts.guard}` : "—", `<strong>${escape(String(d.decision))}</strong>`]),
          ["Eerlijkheidsmarge", (g.r2.fairnessTolerance.options as Json[]).map((o) => `${nummer(o.tolerance, 2)}: ${o.counts?.all ?? "—"}`).join(" · "), "", `<strong>${nummer(g.r2.fairnessTolerance.chosen, 2)}</strong>`],
        ],
        note: "Nachtpoorten: losse nachten, reeksen van twee, waarde nachtreeksen, slechtste uitgang, kortste herstel. De eindconfiguratie is daarmee precies de geteste variant 'slechtste geval' (ab-k5-wc).",
      })
    : ontbreekt("decision-r2.json")
}`,
  };
}

// ── 15 ──────────────────────────────────────────────────────────────────────

function h15Afgewezen(g: Gegevens): Chapter {
  const entries = (g.log?.entries ?? []) as Json[];
  const afgewezen = entries.filter((e) => /vervangen|afgewezen|gewicht 0|niet gekozen|NIET opgelost/i.test(`${e.outcome} ${e.observedEffect}`));
  return {
    number: 15,
    title: "Wat niet werkte",
    what: "Afgewezen en vervangen experimenten, zonder achteraf herschrijven",
    body: `
${tabel({
  columns: [{ head: "Nr", width: "7%" }, { head: "Wat" }, { head: "Wat er gebeurde" }, { head: "Uitkomst" }],
  rows: afgewezen.map((e) => [`<span class="mono">${escape(String(e.id))}</span>`, `<strong>${escape(String(e.component))}</strong><br>${escape(String(e.change))}`, escape(String(e.observedEffect)), escape(String(e.outcome))]),
})}
${g.dev1 && g.dev2 ? vergelijk([{ head: "v1.0.4", m: g.before }, { head: "Ontwikkeling 1 (H01–H08)", m: g.dev1 }, { head: "Ontwikkeling 2 (H09)", m: g.dev2 }], ["robust", "exitsBelowRule", "minRecoveryHours", "worstNightExit", "singletons", "pairs", "rest", "fairness", "backwardDirectOver60"], g.before, "Twee volledige AFTER-metingen die niet slaagden", "Beide met de definitieve meetlat herrekend. Ontwikkeling 2 dichtte het etiketgat (directe wissels terug naar 0) maar maakte nachtuitgangen slechter.") : ontbreekt("dev1.json / dev2.json")}
<p><strong>Correctie op mijn eigen tussenstand.</strong> Bij H05 noemde ik eerst een vergelijking van "zes tegen zes" runs waarin runs met twee
verschillende tabellen door elkaar zaten; die is niet gebruikt.</p>`,
  };
}

// ── 16 ──────────────────────────────────────────────────────────────────────

function h16BeforeAfter(g: Gegevens): Chapter {
  const staaf = (key: string, label: string) => ({
    label,
    bars: [
      { name: "officieel", value: g.before ? spec(key).get(g.before.official) : null, color: KLEUR.official },
      { name: "BEFORE", value: gem(g.before, key), color: KLEUR.before },
      { name: "AFTER", value: gem(g.after, key), color: KLEUR.after },
    ],
  });
  return {
    number: 16,
    title: "BEFORE tegenover AFTER",
    what: "Dezelfde twintig-runmeting, alle maten",
    body: g.after
      ? `
${figuur(groupedBars([staaf("robust", "Robuust"), staaf("worstLine", "Slechtste regel"), staaf("nights", "Nachten"), staaf("flow", "Regelmaat"), staaf("rest", "Rust"), staaf("fairness", "Eerlijkheid")], { min: 50, max: 100, height: 210 }), "Gemiddelden. Goud: het officiële rooster; lichtblauw: v1.0.4; donkerblauw: AFTER.")}
<div class="wide">${vergelijk([{ head: "v1.0.4", m: g.before }, { head: "AFTER", m: g.after }], METRICS.map((m) => m.key), g.before, "Alle maten", `Hard: ${g.after.hard.candidates} kandidaten, allemaal geldig: ${g.after.hard.allValid ? "ja" : "nee"}; niet toegewezen max ${g.after.hard.maxUnassigned}; profielovertredingen max ${g.after.hard.maxProfileBreaches}.`)}</div>
${tabel({ caption: "Kortste herstel na nachten, per kandidaat", columns: [{ head: "" }, ...Object.keys(g.before?.minRecoveryBuckets ?? {}).map((k) => ({ head: k, numeric: true }))], rows: [["v1.0.4", ...Object.values(g.before?.minRecoveryBuckets ?? {}).map(String)], ["AFTER", ...Object.keys(g.before?.minRecoveryBuckets ?? {}).map((k) => String(g.after!.minRecoveryBuckets[k] ?? 0))]] })}`
      : ontbreekt("after.json"),
  };
}

// ── 17 ──────────────────────────────────────────────────────────────────────

function h17PerRooster(g: Gegevens): Chapter {
  const pr = (g.after?.perRoster ?? null) as Json | null;
  const bpr = (g.before?.perRoster ?? null) as Json | null;
  const velden: [string, string, number][] = [
    ["worstLine", "Slechtste regel", 1],
    ["exitsBelowRule", "Uitgangen < 46 u", 2],
    ["minRecoveryHours", "Kortste herstel (u)", 0],
    ["coherence", "Samenhang (%)", 1],
    ["oscillations", "Heen-en-weer", 2],
    ["startJitterMean", "Sprong (min)", 0],
    ["weeklyDeviation", "Afwijking (min/w)", 0],
  ];
  return {
    number: 17,
    title: "Per basisrooster",
    what: "Officieel · v1.0.4 · AFTER, per rooster",
    body:
      pr && bpr
        ? `<div class="wide">${tabel({
            columns: [{ head: "Rooster" }, ...velden.map(([, l]) => ({ head: l, numeric: true }))],
            rows: Object.keys(pr).map((code) => [escape(naam(code)), ...velden.map(([k, , d]) => `${nummer(pr[code][k]?.official, d)} · ${nummer(bpr[code]?.[k]?.mean, d)} · <strong>${nummer(pr[code][k]?.mean, d)}</strong>`)]),
            note: "Per cel: officieel · v1.0.4 · AFTER (vet), gemiddeld over de kandidaten.",
          })}</div>`
        : ontbreekt("de meting per basisrooster (after.json / before.json)"),
  };
}

// ── 18 ──────────────────────────────────────────────────────────────────────

function h18SlechtsteRegel(g: Gegevens): Chapter {
  const tel = (m: PhaseMeasurement | null) => {
    const t: Record<string, number> = {};
    for (const r of m?.runs ?? []) for (const k of r.candidates) {
      const code = k.metrics.quality.worstLine.roster ?? "—";
      t[code] = (t[code] ?? 0) + 1;
    }
    return t;
  };
  const voor = tel(g.before);
  const na = tel(g.after);
  const codes = [...new Set([...Object.keys(voor), ...Object.keys(na)])].sort();
  return {
    number: 18,
    title: "De slechtste regel",
    what: "Geen regel opofferen voor een mooi gemiddelde",
    body: `
${vergelijk([{ head: "v1.0.4", m: g.before }, { head: "AFTER", m: g.after }], ["worstLine", "worstNightExit", "worstTransition", "worstWorkBlock"], g.before)}
${tabel({ caption: "In welk rooster de slechtste regel ligt (aantal kandidaten)", columns: [{ head: "Rooster" }, { head: "v1.0.4", numeric: true }, { head: "AFTER", numeric: true }], rows: codes.map((c) => [escape(naam(c)), String(voor[c] ?? 0), String(na[c] ?? 0)]) })}`,
  };
}

// ── 19 ──────────────────────────────────────────────────────────────────────

function h19Nachten(g: Gegevens): Chapter {
  const hist = (m: PhaseMeasurement | null) => {
    const t: Record<string, number> = {};
    for (const r of m?.runs ?? []) for (const k of r.candidates) for (const [l, n] of Object.entries(k.metrics.nights.blocks)) t[l] = (t[l] ?? 0) + n;
    return t;
  };
  const uitgang = (m: PhaseMeasurement | null) => {
    const t: Record<string, number> = {};
    for (const r of m?.runs ?? []) for (const k of r.candidates) for (const [code, p] of Object.entries(k.metrics.perRoster ?? {})) t[code] = (t[code] ?? 0) + ((p as Json).exitsBelowRule ?? 0);
    return t;
  };
  const hb = hist(g.before);
  const ha = hist(g.after);
  const ub = uitgang(g.before);
  const ua = uitgang(g.after);
  return {
    number: 19,
    title: "Nachten",
    what: "Reekslengtes, uitgangen en herstel",
    body: `
${vergelijk([{ head: "v1.0.4", m: g.before }, { head: "AFTER", m: g.after }], ["singletons", "pairs", "nightBlockValue", "nightExitValue", "worstNightExit", "minRecoveryHours", "exitsBelowRule", "exitsToEarly"], g.before)}
${tabel({ caption: "Nachtreeksen naar lengte, opgeteld over alle kandidaten", columns: [{ head: "Lengte" }, { head: "v1.0.4", numeric: true }, { head: "AFTER", numeric: true }], rows: ["1", "2", "3", "4", "5+"].map((l) => [l, String(hb[l] ?? 0), String(ha[l] ?? 0)]) })}
${tabel({ caption: "Uitgangen onder 46 uur per basisrooster, opgeteld", columns: [{ head: "Rooster" }, { head: "v1.0.4", numeric: true }, { head: "AFTER", numeric: true }], rows: [...new Set([...Object.keys(ub), ...Object.keys(ua)])].filter((c) => (ub[c] ?? 0) + (ua[c] ?? 0) > 0).sort().map((c) => [escape(naam(c)), String(ub[c] ?? 0), String(ua[c] ?? 0)]), note: "BLM heeft weinig nachten en weinig plekken waar een reeks vlak voor twee vrije dagen eindigt; daar zit het grootste deel van de resterende korte uitgangen." })}`,
  };
}

// ── 20 ──────────────────────────────────────────────────────────────────────

function h20Rekentijd(g: Gegevens): Chapter {
  const ab = (g.ablations?.ablations ?? []) as Json[];
  return {
    number: 20,
    title: "Rekentijd",
    what: "Per run, per variant",
    body: tabel({
      columns: [{ head: "Meting" }, { head: "Gemiddeld per run (s)", numeric: true }],
      rows: [
        ["v1.0.4", nummer(g.before?.runtime?.mean, 0)],
        ["AFTER", nummer(g.after?.runtime?.mean, 0)],
        ...ab.filter((x) => x.status === "gemeten").map((x) => [escape(String(x.label)), nummer(x.runtimeMeanSeconds, 0)]),
      ],
      note: "Rekentijdmodus Normaal heeft een budget van 300 seconden; de zoekmachine stopt eerder bij een plateau. Een verschil hier is dus vooral een verschil in hoe vaak het budget op raakt.",
    }),
  };
}

// ── 21 ──────────────────────────────────────────────────────────────────────

function h21Beperkingen(_g: Gegevens): Chapter {
  return {
    number: 21,
    title: "Wat nog beperkt is",
    what: "Open punten, eerlijk opgesomd",
    body: `
<ul>
  <li><strong>Eén steekproef.</strong> Alle zachte principes komen uit één roosterperiode van één standplaats.</li>
  <li><strong>Ruis.</strong> Elke strategie draait met dezelfde zaden; de spreiding is het niet-determinisme van CP-SAT. Ablaties van drie runs
  tonen een richting.</li>
  <li><strong>Weinig reparaties.</strong> In rekentijdmodus Normaal zijn het er twee à drie per run; de gerichte nachtreparatie heeft daardoor
  weinig kansen.</li>
  <li><strong>Geen harde structuurvergrendeling.</strong> Een reparatie houdt goede nachtreeksen alleen zacht vast (kosten per gewijzigde dag);
  een vergrendeling van nachtdagen bij reparaties op andere doelen is niet gebouwd.</li>
  <li><strong>De bewaking is relatief.</strong> Eerlijkheid, uren en rust worden bewaakt ten opzichte van de start van het bijschaven, niet
  ten opzichte van v1.0.4.</li>
  <li><strong>De herstelregel na nachten</strong> (46 uur) heeft bronstatus POTENTIAL en is geen harde eis; het model gebruikt hem als drempel.</li>
  <li><strong>Geen menselijk oordeel.</strong> Alles hier is meting.</li>
  <li><strong>Machinistenvoorkeur nog niet in dit brein.</strong> De aanvulling over profielaffiniteit, nachtritme tegenover totale belasting,
  weekendstart en de urengrens is op verzoek naar een vervolgronde verplaatst, die pas begint als deze ronde is afgerond. De eerste
  bouwstenen (dienstklassen op de klok, de affiniteitstabel, de twee nachtassen) bestaan al als losse modules, maar zijn niet
  aangesloten en hebben op geen enkele meting in dit rapport invloed.</li>
</ul>`,
  };
}

// ── 22 ──────────────────────────────────────────────────────────────────────

function h22Kandidaten(g: Gegevens): Chapter {
  const s = g.selection;
  const poorten = (g.gates?.gates ?? []) as Json[];
  if (!s && g.gates && !g.gates.allPass) {
    const niet = poorten.filter((p) => !p.pass);
    return {
      number: 22,
      title: "De drie eindkandidaten",
      what: "Niet gegenereerd in deze ronde — en waarom",
      body: `
${blok(`De werkopdracht bindt de drie reviewpakketten aan de poorten: "Pas NADAT de AFTER benchmark de gates haalt" (§26). AFTER haalt ${poorten.length - niet.length} van de ${poorten.length}. Daarom zijn er in deze ronde <strong>geen</strong> eindkandidaten gemaakt.`, "warn")}
${tabel({ caption: "De poorten die niet zijn gehaald", columns: [{ head: "Poort" }, { head: "BEFORE", numeric: true }, { head: "AFTER", numeric: true }, { head: "95%-interval van het verschil" }, { head: "Van ruis te onderscheiden" }], rows: niet.map((p) => [escape(String(p.label)), nummer(p.before, 2), nummer(p.after, 2), p.ci95 ? `[${nummer(p.ci95[0], 2)}; ${nummer(p.ci95[1], 2)}]` : "—", p.ci95 && (p.ci95[0] > 0 || p.ci95[1] < 0) ? "ja" : "nee"]) })}
<p>De vervolgronde (machinistenvoorkeur) begint vanaf deze stand als baseline en maakt de drie pakketten zodra al haar poorten groen zijn.
Het script daarvoor (<code>npm run final-brain:candidates</code>, met vooraf vastgelegde keuzeregels voor A, B en C) staat klaar.</p>`,
    };
  }
  if (!s) return { number: 22, title: "De drie eindkandidaten", what: "Ter menselijke beoordeling", body: ontbreekt("final-candidates/selection.json") };
  const pk = s.packages as Json[];
  const m = (p: string) => g.packages[p]?.metrics as Json | undefined;
  const rij = (label: string, f: (x: Json) => string) => [escape(label), ...pk.map((p) => (m(p.package) ? f(m(p.package)!) : "—"))];
  return {
    number: 22,
    title: "De drie eindkandidaten",
    what: "Ter menselijke beoordeling — gekozen met vooraf vastgelegde regels",
    body: `
${blok("Deze drie zijn door niemand beoordeeld. Onder elke roosterregel in de simulatie staat het beoordelingsformulier; een oordeel verandert geen gewicht en geen model.", "warn")}
${tabel({ caption: "Hoe gekozen", columns: [{ head: "Pakket" }, { head: "Regel" }, { head: "Strategie" }, { head: "Kandidaat" }], rows: pk.map((p) => [escape(String(p.package)), escape(String(p.rule)), escape(String(p.strategy)), `${p.number}<br><span class="note mono">${escape(String(p.id))}</span>`]) })}
<div class="wide">${tabel({
  columns: [{ head: "" }, ...pk.map((p) => ({ head: `Pakket ${p.package}`, numeric: true }))],
  rows: [
    rij("Robuust", (x) => nummer(x.quality.robust, 1)),
    rij("Slechtste regel", (x) => `${nummer(x.quality.worstLine.score, 1)} (${escape(naam(String(x.quality.worstLine.roster)))} r${x.quality.worstLine.line})`),
    rij("Nachten · regelmaat · rust", (x) => `${nummer(x.quality.components.nights, 1)} · ${nummer(x.quality.components.flow, 1)} · ${nummer(x.quality.components.rest, 1)}`),
    rij("Uren · eerlijkheid", (x) => `${nummer(x.quality.components.hours, 1)} · ${nummer(x.quality.components.fairness, 1)}`),
    rij("Losse nachten · reeksen van twee", (x) => `${x.nights.singletons} · ${x.nights.pairs}`),
    rij("Kortste herstel na nachten (u)", (x) => nummer(x.nights.minRecoveryHours, 1)),
    rij("Slechtste nachtuitgang", (x) => (x.nights.worstExit ? `${escape(naam(String(x.nights.worstExit.roster)))} ${escape(String(x.nights.worstExit.pattern))}` : "—")),
    rij("Zwaarste overgang (op de klok)", (x) => `${x.transitions.heavyClockAware} zwaar`),
    rij("Rommeligste werkblok", (x) => `${escape(String(x.worstWorkBlock.states ?? "—"))}`),
    rij("Hard geldig · profiel", (x) => `${x.hard.valid ? "ja" : "NEE"} · ${x.hard.profileBreaches}`),
  ],
})}</div>
<p>Per pakket in <code>docs/v1.0.4-final-brain/final-candidates/&lt;pakket&gt;/</code>: een PDF per basisrooster, <code>alle-basisroosters.pdf</code>,
<code>metrics.json</code> en <code>toelichting.md</code> met de sterkste en zwakste vijf punten. In de applicatie: Simulatie, run "… — v1.0.4
eindkandidaten ter beoordeling".</p>`,
  };
}

// ── 23 ──────────────────────────────────────────────────────────────────────

function h23Reproduceerbaarheid(g: Gegevens): Chapter {
  const t = g.tests;
  return {
    number: 23,
    title: "Reproduceerbaarheid",
    what: "Welke opdracht welk bestand maakt, en de testbatterij",
    body: `
${tabel({
  columns: [{ head: "Opdracht" }, { head: "Maakt" }],
  rows: [
    ["<code>npm run final-brain:freeze</code>", "<code>freeze.json</code>"],
    ["<code>npm run final-brain:measure -- --phase after --out before.json</code>", "de baseline"],
    ["<code>npm run final-brain:exchange-rates</code>", "<code>objective-exchange-rates.md/.json</code>"],
    ["<code>npm run final-brain:adversarial</code>", "<code>adversarial.json</code>"],
    ["<code>npm run final-brain:solver-ab -- …</code>", "<code>solver-ab-nightrow.json</code>"],
    ["<code>NS_ENGINE_VARIANT=… npm run verify:optimizer-benchmark -- run --phase ab-…</code>", "de ablatieruns"],
    ["<code>npm run final-brain:ablations</code>", "<code>ablations.json</code>"],
    ["<code>npm run final-brain:repair-analysis -- …</code>", "<code>repair-analysis.json</code>"],
    ["<code>npm run final-brain:gate -- --before before.json --after after.json --out gates.json</code>", "de poorten"],
    ["<code>npm run final-brain:candidates -- generate | select | export</code>", "<code>final-candidates/</code>"],
    ["<code>npm run report:final-brain</code>, <code>report:final-brain-pdf</code>, <code>report:final-brain-qa</code>", "dit rapport"],
  ],
})}
${
  t
    ? tabel({
        caption: `Testbatterij (${(t.suites as Json[]).filter((x) => x.ok).length} van ${(t.suites as Json[]).length} geslaagd)`,
        columns: [{ head: "Suite" }, { head: "Uitkomst" }, { head: "Tijd (s)", numeric: true }],
        rows: (t.suites as Json[]).map((x) => [escape(String(x.name)), (x.ok ? '<span class="better">geslaagd</span> · ' : '<span class="worse">GEFAALD</span> · ') + `<span class="note">${escape(String(x.summary).slice(0, 150))}</span>`, nummer(x.seconds, 1)]),
      })
    : blok("Testbatterij nog niet vastgelegd (<code>test-results.json</code> ontbreekt).", "bad")
}
${
  g.e2eReruns
    ? `<h3 class="sec">De doorloop (e2e), drie keer</h3>
<p>${escape(String(g.e2eReruns.why))}</p>
${tabel({ columns: [{ head: "Run" }, { head: "Afgedekt", numeric: true }, { head: "Wat faalde" }], rows: (g.e2eReruns.runs as Json[]).map((x) => [String(x.run), escape(String(x.covered)), escape(String(x.detail))]) })}
${blok(escape(String(g.e2eReruns.conclusion)), "warn")}`
    : ""
}`,
  };
}

function main() {
  writeFileSync(FINAL_BRAIN_HTML, bouw(laad()));
  console.log(`Geschreven: ${FINAL_BRAIN_HTML}`);
}

if (require.main === module) main();

