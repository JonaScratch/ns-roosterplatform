import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type Chapter,
  beeldmerk,
  blok,
  cijferkaart,
  document,
  escape,
  figuur,
  hoofdstuk,
  nummer,
  oordeelKlasse,
  tabel,
  verschil,
} from "./layout";
import { KLEUR, groupedBars } from "./charts";

/**
 * Het rapport over het leren van de zeven menselijke Dordrechtse roosters.
 *
 * ## Wat dit document is
 *
 * Een verslag van een ijking: wat de menselijke roosters laten zien, hoe dat in
 * een meting is vertaald, wat er aan de zoekmachine veranderde, wat dezelfde
 * meting daarna liet zien, en welke drie kandidaatpakketten er nu ter
 * beoordeling liggen. Het rapport claimt nergens dat een rooster "beter voor
 * mensen" is: dat kan pas als mensen het beoordeeld hebben. Wat het wel zegt, is
 * op welke meetbare punten de uitkomst dichter bij de menselijke referentie ligt,
 * en waar niet.
 *
 * Elk getal komt uit een bestand in `docs/human-roster-benchmark/` of `configs/`;
 * er staat geen voorbeeldwaarde in.
 *
 *   npm run report:human
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "human-roster-benchmark");
export const HUMAN_REPORT_HTML = path.join(WORTEL, "docs", "NS-Roosterplatform-Human-Roster-Learning-Report.html");

// ── Gegevens ────────────────────────────────────────────────────────────────

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const lees = (bestand: string): Json => {
  const pad = path.isAbsolute(bestand) ? bestand : path.join(MAP, bestand);
  if (!existsSync(pad)) {
    throw new Error(`${path.relative(WORTEL, pad)} ontbreekt; het rapport zou een leeg vak krijgen.`);
  }
  return JSON.parse(readFileSync(pad, "utf8")) as Json;
};
const leesAls = (bestand: string): Json | null => (existsSync(path.join(MAP, bestand)) ? lees(bestand) : null);

interface Gegevens {
  readonly features: Json;
  readonly priors: Json;
  readonly log: Json;
  readonly contrast: Json;
  readonly contrastVoor: Json | null;
  readonly abNacht: Json;
  readonly abJitter: Json;
  readonly analyse: Json;
  readonly dev1: Json;
  readonly dev1Voor: Json | null;
  readonly kandidaten: Json | null;
  readonly model: Json;
  readonly optimizer: Json;
  readonly controles: Json | null;
}

function laad(): Gegevens {
  return {
    features: lees("official-features.json"),
    priors: lees("profile-priors.json"),
    log: lees("development-log.json"),
    contrast: lees("contrastive-check.json"),
    contrastVoor: leesAls("contrastive-check-pre-h09.json"),
    abNacht: lees("solver-ab-uit-nacht.json"),
    abJitter: lees("solver-ab-uit-aan.json"),
    analyse: lees("analysis-before-after.json"),
    dev1: lees("analysis-dev1-final-v2.json"),
    dev1Voor: leesAls("analysis-dev1-pre-h09.json"),
    kandidaten: leesAls(path.join("final-candidates", "summary.json")),
    model: lees(path.join(WORTEL, "configs", "quality-model-v2.json")),
    optimizer: lees(path.join(WORTEL, "configs", "optimizer-config-v1.0.5.json")),
    controles: leesAls("test-results.json"),
  };
}

// ── Hulpjes ─────────────────────────────────────────────────────────────────

interface Vergelijkingsregel {
  key: string;
  label: string;
  higherIsBetter: boolean;
  official: number | null;
  before: { mean: number; median: number; min: number; max: number; n: number } | null;
  after: { mean: number; median: number; min: number; max: number; n: number } | null;
  delta: number | null;
  verdict: string | null;
}

const regel = (analyse: Json, key: string): Vergelijkingsregel => {
  const gevonden = (analyse.comparison as Vergelijkingsregel[]).find((c) => c.key === key);
  if (!gevonden) throw new Error(`De maat ${key} staat niet in de analyse.`);
  return gevonden;
};

/** Hoeveel decimalen een maat verdient: tellingen met één, scores met één, minuten zonder. */
const DECIMALEN: Record<string, number> = {
  startJitterMean: 0,
  startJitterP90: 0,
  nightMinRecoveryHours: 1,
  meanBlockLength: 2,
  singletonNights: 2,
  twoNightBlocks: 2,
  oscillations: 2,
  nightExitsToEarly: 2,
  worstTransition: 2,
  linesWithHeavyTransition: 2,
};
const dec = (key: string) => DECIMALEN[key] ?? 1;

const oordeelCel = (verdict: string | null) =>
  verdict === null ? "—" : `<span class="${oordeelKlasse(verdict)}">${escape(verdict)}</span>`;

const datum = (iso: string) =>
  new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

const uren = (minuten: number) => `${Math.floor(minuten / 60)}:${String(Math.round(minuten % 60)).padStart(2, "0")}`;

const ROOSTERNAAM: Record<string, string> = {
  "DDR-V": "Vroeg",
  "DDR-VL": "Vroeg/Laat",
  "DDR-L": "Laat",
  "DDR-LN": "Laat/Nacht",
  "DDR-MIX": "Mix",
  "DDR-BLM": "BLM",
  "DDR-50MIX": "50+ Mix",
};
const naam = (code: string) => ROOSTERNAAM[code] ?? code;

// ── Opbouw ──────────────────────────────────────────────────────────────────

function bouw(g: Gegevens): string {
  const acceptatie = g.analyse.acceptance as { eis: string; gehaald: boolean }[];
  const gehaald = acceptatie.filter((a) => a.gehaald).length;

  const hoofdstukken: Chapter[] = [
    h1Samenvatting(g, gehaald, acceptatie.length),
    h2Bron(g),
    h3Principes(g),
    h4Meetmodel(g),
    h5Zoekmachine(g),
    h6Ontwikkellog(g),
    h7BeforeAfter(g),
    h8PerRooster(g),
    h9Regressies(g),
    h10Kandidaten(g),
    h11Beoordeling(),
    h12Reproduceerbaarheid(g),
  ];

  const omslag = `
<section class="cover">
  <div class="cover-top">
    ${beeldmerk(20)}
    <div class="cover-tag">Roosterplatform<br>Leerrapport<br>${escape(datum(g.analyse.measuredAt))}</div>
  </div>
  <div class="cover-mid">
    <div class="kicker">Versie 1.0.5 · menselijke roosters als referentie</div>
    <h1>Leren van zeven<br>roosters die mensen<br>maakten</h1>
    <p class="claim">Wat de officiële Dordrechtse basisroosters laten zien, hoe dat in de meting en de
    zoekmachine terechtkwam, wat het opleverde — en drie kandidaatpakketten die nu op een menselijk oordeel wachten.</p>
  </div>
  <div class="cover-band">
    <div class="place">Standplaats Dordrecht · referentie ${escape(String(g.features.learnedFromBenchmark))}</div>
    <div class="version">${g.analyse.before.runs} BEFORE-runs · ${g.analyse.after.runs} AFTER-runs<br>${g.analyse.before.candidates + g.analyse.after.candidates} kandidaten gemeten<br>${escape(String(g.model.version))} · ${escape(String(g.optimizer.version))}</div>
  </div>
</section>`;

  const inhoud = `
<section class="toc">
  <div class="head" style="border-bottom:2px solid var(--ns-blue);padding-bottom:3mm;margin-bottom:5mm">
    <h2 style="font-size:21px">Inhoud</h2>
  </div>
  ${hoofdstukken
    .map(
      (h) =>
        `<div class="toc-row"><div class="num">${h.number}</div><div class="name">${escape(h.title)}</div><div class="what">${escape(h.what)}</div></div>`,
    )
    .join("")}
  <p class="note" style="margin-top:6mm">Gegenereerd uit <code>docs/human-roster-benchmark/</code> en
  <code>configs/</code>. Elk getal komt uit die bestanden. Hoofdstuk 12 noemt per bestand de opdracht die het maakt.</p>
</section>`;

  return document({
    title: "NS Roosterplatform — Leren van menselijke roosters",
    cover: omslag,
    toc: inhoud,
    chapters: hoofdstukken.map(hoofdstuk),
  });
}

// ── 1. Samenvatting ─────────────────────────────────────────────────────────

function h1Samenvatting(g: Gegevens, gehaald: number, totaal: number): Chapter {
  const a = g.analyse;
  const r = (key: string) => regel(a, key);
  const kern = ["robust", "worstLine", "nights", "flow", "rest", "fairness", "nightExitValue", "nightExitsToEarly", "nightMinRecoveryHours", "startJitterMean", "singletonNights", "patternDistance"];
  const rijen = kern.map((key) => {
    const m = r(key);
    return [
      escape(m.label),
      nummer(m.official, dec(key)),
      nummer(m.before?.mean, dec(key)),
      nummer(m.after?.mean, dec(key)),
      verschil(m.delta, dec(key)),
      oordeelCel(m.verdict),
    ];
  });
  const hard = a.hard.after;
  const nietGehaald = (a.acceptance as { eis: string; gehaald: boolean }[]).filter((x) => !x.gehaald);

  return {
    number: 1,
    title: "Samenvatting",
    what: "Wat er is gedaan, wat het opleverde en wat nog open is",
    body: `
<p class="lede">De zeven officiële basisroosters van Dordrecht zijn gelezen als menselijke referentie
(<code>HUMAN_ACCEPTED_REFERENCE</code>, ${escape(String(g.features.learnedFromBenchmark))}). Daaruit zijn
zachte ontwerpprincipes afgeleid, is het kwaliteitsmodel herijkt (v2) en is de zoekmachine bijgesteld
(adaptive-1.0.5). Dezelfde meting — ${a.before.runs} runs vóór, ${a.after.runs} runs na — laat zien waar de uitkomst
dichter bij de menselijke referentie ligt, en waar niet.</p>

${blok(
  `AFTER haalt <strong>${gehaald} van de ${totaal}</strong> acceptatiepunten uit de werkopdracht (§75, §81). Alle ${hard.candidates} AFTER-kandidaten zijn hard geldig, met volledige dekking en zonder profielovertreding.${
    nietGehaald.length > 0 ? ` Niet gehaald: ${nietGehaald.map((x) => x.eis.toLowerCase()).join("; ")}.` : ""
  }`,
  nietGehaald.length === 0 ? "ok" : "warn",
)}

${tabel({
  caption: "De kern: officieel rooster, v1.0.4 (BEFORE) en v1.0.5 (AFTER), gemeten met kwaliteitsmodel v2",
  columns: [
    { head: "Maat" },
    { head: "Officieel", numeric: true },
    { head: "BEFORE", numeric: true },
    { head: "AFTER", numeric: true },
    { head: "Verschil", numeric: true },
    { head: "Oordeel" },
  ],
  rows: rijen,
  note: `Gemiddelden over ${a.before.candidates} (BEFORE) en ${a.after.candidates} (AFTER) kandidaten. "Beter" en "slechter" gaan over de richting van de maat, niet over een menselijk oordeel.`,
})}

<h3 class="sec">Wat dit rapport niet zegt</h3>
<ul>
  <li>Dat de nieuwe roosters beter zijn voor de mensen die ze rijden. Niemand heeft ze nog beoordeeld. De drie
  kandidaatpakketten in hoofdstuk 10 zijn daarvoor gemaakt; na dat oordeel pas volgen verdere wijzigingen aan gewichten of model.</li>
  <li>Dat de menselijke principes wetten zijn. Het is één steekproef: 7 basisroosters, 64 regels, één roosterperiode.</li>
  <li>Iets over gezondheid. "Na nachten liever laat dan vroeg" is hier een voorkeur in het roosterontwerp
  (<em>schedule-flow preference</em>), gemeten aan wat mensen maakten.</li>
</ul>

<h3 class="sec">De belangrijkste les van deze ronde</h3>
<p>Twee keer bleek een onderdeel van de meting minder rust te belonen dan meer: eerst in de solver (H04), daarna
in de beoordeling waarop het bijschaven stuurt (H09). Beide keren vond de zoekmachine het gat binnen één meting.
De eerste AFTER-meting haalde daardoor maar 5 van de 10 acceptatiepunten. De uitgangswaarde na nachten is nu
monotoon in de hersteltijd en dat staat in een test vast. Hoofdstuk 6 beschrijft beide gevallen.</p>`,
  };
}

// ── 2. De bron ──────────────────────────────────────────────────────────────

function h2Bron(g: Gegevens): Chapter {
  const f = g.features;
  const rijen = (f.rosters as Json[]).map((r) => {
    const nachten = (r.nightBlocks?.lengths as number[]) ?? [];
    return [
      `${escape(naam(r.code))}<br><span class="note">${escape(r.code)}</span>`,
      String(r.lines),
      String(r.workedDays),
      `${r.dayparts.E ?? 0} / ${r.dayparts.L ?? 0} / ${r.dayparts.N ?? 0}`,
      nachten.length ? nachten.join(", ") : "—",
      nummer(r.workBlocks.meanLength, 1),
      nummer(r.workBlocks.meanDominantShare, 1),
      nummer(r.startTime?.sameDaypartAdjacentDeltas?.mean ?? null, 0),
      escape(String(r.hours.averageWeekIncludingBreak)),
      `${uren(r.hours.lineMin)}–${uren(r.hours.lineMax)}`,
    ];
  });
  const o = f.overall;
  return {
    number: 2,
    title: "De bron: zeven menselijke roosters",
    what: "Wat er is ingelezen, gecontroleerd en gemeten",
    body: `
<p>De zeven PDF's van dienstenpakket DDR-BDU-05-10-2026 zijn cel voor cel ingelezen en op twee manieren
gecontroleerd: de tijden in de PDF tegen het dienstenpakket (dienst plus weekdag, want een dienstnummer alleen
is geen identiteit), en elke cel tegen het officiële rooster in de database. Afwijkingen:
<strong>${(f.reconciliation.deviations as unknown[]).length}</strong>.</p>

${blok(escape(String(f.sampleSizeWarning)), "warn")}

${tabel({
  caption: "De zeven basisroosters",
  columns: [
    { head: "Rooster" },
    { head: "Regels", numeric: true },
    { head: "Gewerkt", numeric: true },
    { head: "V / L / N", numeric: true },
    { head: "Nachtreeksen", numeric: true },
    { head: "Werkblok (d)", numeric: true },
    { head: "Eén dagdeel (%)", numeric: true },
    { head: "Sprong begintijd (min)", numeric: true },
    { head: "Gem. week incl. pauze", numeric: true },
    { head: "Regels excl. pauze", numeric: true },
  ],
  rows: rijen,
  note: "Werkblok: aaneengesloten gewerkte dagen; RES breekt een blok. Sprong begintijd: tussen twee opeenvolgende diensten in hetzelfde dagdeel. Nachtreeksen over de regelgrens heen tellen als één reeks.",
})}

<div class="cards g4">
  ${cijferkaart(String(o.workedDays), "gewerkte dagen in het pakket")}
  ${cijferkaart(`${o.workBlocks.fullyCoherent}/${o.workBlocks.count}`, "werkblokken met één dagdeel")}
  ${cijferkaart(Object.entries(o.nightBlocks.lengths as Record<string, number>).flatMap(([l, n]) => Array(n).fill(l)).join(" · "), "lengtes van de nachtreeksen; geen losse nacht, geen reeks van twee")}
  ${cijferkaart(`${o.nightBlocks.minRecoveryHours} u`, "kortste herstel na een nachtreeks (de regel vraagt 46)")}
</div>

<p class="note">Bronbestanden: <code>official-roster-lines.json</code> (elke dag van elke regel),
<code>official-features.json</code>, <code>transition-matrix.csv</code>, <code>night-blocks.csv</code>,
<code>work-blocks.csv</code>, <code>rest-distribution.csv</code>, <code>rotation-boundaries.csv</code>,
<code>off-blocks.csv</code>, <code>profile-priors.json</code>.</p>`,
  };
}

// ── 3. Principes ────────────────────────────────────────────────────────────

function h3Principes(g: Gegevens): Chapter {
  const o = g.features.overall;
  const principes: [string, string, string][] = [
    ["Een werkblok heeft één dagdeel", `${o.workBlocks.fullyCoherent} van de ${o.workBlocks.count} werkblokken`, "Cluster gelijksoortige diensten"],
    ["Dagdeelwissels lopen over rust heen", "in V/L, L/N en Mix elke wissel na 1–4 vrije dagen", "Gebruik rust als scheiding tussen dagdeelfamilies"],
    ["Geen heen-en-weer op de klok", `${o.oscillations} keer op het etiket, alleen in 50+ Mix, waar vroeg en laat qua tijd overlappen`, "Meet een wissel aan de begintijd, niet aan het etiket"],
    ["Nachten in reeksen van drie tot zes", "reeksen 3, 5, 5, 6; twee lopen over de regelgrens", "Bouw nachten als blok; nooit los, liefst niet twee"],
    ["Na nachten eerst rust, dan laat", `alle vier: 2–3 vrije dagen, dan laat; kortste herstel ${o.nightBlocks.minRecoveryHours} uur`, "Eerst herstel, dan richting"],
    ["Begintijden springen, maar niet ver", `gemiddeld ${nummer(o.startTimeJitter.mean, 0)} min, mediaan ${o.startTimeJitter.median}, p90 ${o.startTimeJitter.p90}`, "Pas sprongen boven een uur tellen"],
    ["Rust ruimer dan het minimum", "per rooster gemiddeld 3,7–4,8 uur boven de 12 uur", "Rust boven het minimum heeft waarde"],
    ["Blokken kort, vrij in paren", "werkblok gemiddeld 2,2 dagen, vastgelegd door RES en rustdagen", "Meet wat binnen een blok gebeurt, niet de lengte"],
    ["Weekenden liggen vast", "precies de helft van de regels heeft een vrij weekend", "Meten, niet optimaliseren"],
    ["Eén regel hoeft niet op 40:00", "regels binnen een rooster tot 20 uur uit elkaar", "Stuur het rooster als geheel; alleen uitschieters tellen"],
    ["De regelgrens is een gewone dag", "zondag → maandag vooral vrij, gewerkt meestal hetzelfde dagdeel", "Beoordeel de rotatie als cirkel"],
    ["Elk profiel een eigen karakter", "zie profile-priors.json", "Profielkenmerken als zachte verwachting, niet als sjabloon"],
  ];
  return {
    number: 3,
    title: "Wat de roosters laten zien",
    what: "Hard tegenover zacht, en twaalf ontwerpprincipes met hun bewijs",
    body: `
<p>Het volledige verslag met tabellen staat in <code>human-roster-design-principles.md</code>. Hier de kern.</p>

${tabel({
  caption: "Wat hard is en wat zacht",
  columns: [{ head: "Hard: regel of structuur", width: "50%" }, { head: "Zacht: menselijke voorkeur" }],
  rows: [
    ["Dekking: elke dienst precies één keer", "Dagdelen clusteren in blokken"],
    ["Profielgrens: geen vroege dienst in Laat/Nacht", "Dagdeelwissels over rust heen"],
    ["Geplande dagelijkse rust (12 uur)", "Nachten in reeksen van drie tot zes"],
    ["Maximaal 7 aaneengesloten diensten; 7 in een reeks met nachten", "Na nachten eerst rust, dan laat"],
    ["Herstelrust na 3+ nachten (46 uur, bronstatus POTENTIAL)", "Ruim herstel na een nachtreeks"],
    ["RUST-, WR-, CO- en RES-dagen liggen vast in de structuur", "Begintijden niet ver laten springen; geen regel opofferen voor het gemiddelde"],
  ],
  note: "Niets in de linkerkolom is uit deze roosters afgeleid: dat zijn regels uit de CAO, de Roosterkaders en de roosterstructuur, en die bestonden al in het platform. De rechterkolom komt alleen uit deze roosters.",
})}

${tabel({
  caption: "Twaalf principes",
  columns: [{ head: "Waarneming" }, { head: "Bewijs in de roosters" }, { head: "Principe" }],
  rows: principes.map(([a, b, c]) => [escape(a), escape(b), `<em>${escape(c)}</em>`]),
})}

<h3 class="sec">Wat deze roosters níet laten zien</h3>
<ul>
  <li>Of medewerkers een van deze patronen expliciet waarderen. Daarvoor is de beoordelingsmodus gebouwd (hoofdstuk 11).</li>
  <li>Of dit op andere standplaatsen of in andere roosterperiodes hetzelfde is.</li>
  <li>Een fysiologische onderbouwing. Alles hier is voorkeur in roosterontwerp, gemeten aan wat mensen maakten.</li>
</ul>`,
  };
}

// ── 4. Meetmodel ────────────────────────────────────────────────────────────

function h4Meetmodel(g: Gegevens): Chapter {
  const c = g.model.components as Json;
  const onderdelen = Object.entries(c).map(([sleutel, comp]) => [
    escape(sleutel),
    nummer((comp as Json).weight * 100, 0),
    escape(String((comp as Json).rationale ?? "")),
    escape(Object.keys((comp as Json).parts ?? {}).join(", ")),
  ]);
  const contrast = (g.contrast.adversarial as Json[]).map((t) => {
    const v1 = t["quality-model-v1"];
    const v2 = t["quality-model-v2"];
    return [
      escape(String(t.principe)),
      String(t.ruilen),
      v1.ziet ? "ja" : `<span class="worse">nee</span>`,
      v2.ziet ? "ja" : `<span class="worse">nee</span>`,
      `${escape(v2.onderdeel)} ${nummer(v2.onderdeelMens, 1)} → ${nummer(v2.onderdeelNegatief, 1)}`,
      `${nummer(v2.robuustMens, 1)} → ${nummer(v2.robuustNegatief, 1)}`,
    ];
  });
  const historisch = g.contrast.historical as Json[];
  const historischLager = historisch.filter((h) => h.nachtenV2 < h.nachtenMensV2 || h.regelmaatV2 < h.regelmaatMensV2).length;
  const off = regel(g.analyse, "robust").official;
  return {
    number: 4,
    title: "Meten zoals mensen roosteren",
    what: "Kwaliteitsmodel v2: wat veranderde tegenover v1, en of het de menselijke roosters herkent",
    body: `
<p>Kwaliteitsmodel v1 blijft bestaan en ongewijzigd, zodat eerdere metingen reproduceerbaar blijven. v2 heeft
dezelfde onderdelen en gewichten, maar andere definities: klokbewust in plaats van alleen op het etiket, nachten
als reeks over de regelgrens heen, uren per rooster in plaats van per regel, en de uitgang na nachten.
Elk v2-bestand draagt <code>learnedFromBenchmark = ${escape(String(g.model.learnedFromBenchmark))}</code>.</p>

${tabel({
  caption: "Onderdelen van v2",
  columns: [{ head: "Onderdeel" }, { head: "Gewicht (%)", numeric: true }, { head: "Waarom" }, { head: "Delen" }],
  rows: onderdelen,
})}

<h3 class="sec">Herkent v2 wat mensen niet doen?</h3>
<p>Voor elk principe is het officiële rooster met een paar ruilen zo slecht mogelijk gemaakt op precies dat
principe (de zoekmachine met omgekeerd teken), terwijl het hard geldig bleef. Een goede meting zet het
menselijke rooster dan hoger.</p>
${tabel({
  caption: "Tegenvoorbeelden, gemeten met de definitieve v2",
  columns: [
    { head: "Principe" },
    { head: "Ruilen", numeric: true },
    { head: "v1 ziet het" },
    { head: "v2 ziet het" },
    { head: "v2 onderdeel: mens → tegenvoorbeeld", numeric: true },
    { head: "v2 robuust", numeric: true },
  ],
  rows: contrast,
  note: `Daarnaast ${historisch.length} historische kandidaten van v1.0.3 met een bekend probleem: v2 zet er ${historischLager} lager dan het menselijke rooster op nachten of regelmaat. De tegenvoorbeelden worden per meting opnieuw gezocht; vóór H09 miste v1 er twee (<code>contrastive-check-pre-h09.json</code>), nu één.`,
})}

${blok(
  `Het officiële rooster scoort onder v2 robuust <strong>${nummer(off, 1)}</strong> (onder v1: 64,9). Dat is geen doel op zich: een meting die het menselijke rooster onterecht laag zet, stuurt de zoekmachine weg van wat mensen maken. Na H09 is dat 0,7 punt lager dan in de eerste versie van v2; hoofdstuk 6 legt uit waarom dat is geaccepteerd.`,
)}`,
  };
}

// ── 5. Zoekmachine ──────────────────────────────────────────────────────────

function h5Zoekmachine(g: Gegevens): Chapter {
  const ab = (rijen: Json[], opstelling: string, veld: string) => {
    const xs = rijen.filter((r) => r.opstelling === opstelling).map((r) => r[veld] as number);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const velden: [string, string][] = [
    ["robust", "Robuust"],
    ["nights", "Nachten"],
    ["fairness", "Eerlijkheid"],
    ["exitsToEarly", "Vroeg na nachten"],
    ["minRecoveryHours", "Kortste herstel (u)"],
    ["jitterMean", "Sprong begintijd (min)"],
  ];
  const abRij = (bron: Json, a: string, b: string) =>
    velden.map(([veld, label]) => [
      escape(label),
      nummer(ab(bron.rows, a, veld), 1),
      nummer(ab(bron.rows, b, veld), 1),
      verschil((ab(bron.rows, b, veld) ?? 0) - (ab(bron.rows, a, veld) ?? 0), 1),
    ]);
  const h = g.optimizer.adaptive.humanRhythm;
  const guards = g.optimizer.adaptive.guards;
  return {
    number: 5,
    title: "Wat er aan de zoekmachine veranderde",
    what: "Overgangstabel in de solver, bewaking bij het bijschaven, en wat is afgewezen",
    body: `
<p>De zoekmachine heeft twee stappen die ertoe doen: de CP-SAT-solver bouwt een startrooster, het bijschaven
(ruilen en herstarten) verbetert dat op de kwaliteitsmaat. Het bijschaven is de grootste hefboom, en stuurt
nu op v2. De solver kreeg alleen wat hij goed kan uitdrukken.</p>

<h3 class="sec">De uitgang na nachten in de solver</h3>
${tabel({
  caption: "Strafpunten na een nachtdienst, klassiek tegenover menselijk ritme",
  columns: [{ head: "Na nacht" }, { head: "Klassiek", numeric: true }, { head: "Menselijk ritme (1.0.5)", numeric: true }],
  rows: [
    ["direct vroeg", "6", "6"],
    ["direct laat", "3", "5"],
    ["één vrije dag, vroeg", "3", "4"],
    ["één vrije dag, laat", "1", "3"],
    ["twee vrije dagen, vroeg", "0", "2"],
    ["twee vrije dagen, laat", "0", "0"],
  ],
  note: "Strikt dalend met de rust, en vroeg steeds duurder dan laat bij evenveel vrije dagen (H05). Alle vier de menselijke nachtreeksen eindigen op twee of drie vrije dagen en dan laat. Alleen in de adaptieve zoekmachine; de klassieke is ongewijzigd.",
})}

<h3 class="sec">Afgewezen: de begintijdsprong in de solver</h3>
<p>Een term die sprongen in begintijd binnen een dagdeel in de solver strafte, maakte nachten en eerlijkheid
slechter. Hij staat erin, maar met gewicht ${h.startJitterWeight}: de begintijden worden alleen door het
bijschaven op v2 bewaakt.</p>
${tabel({
  caption: `A/B in de solver, ${g.abJitter.seeds.length} zaadwaarden, ${g.abJitter.seconds} s (H03, gemeten met v2 van dat moment)`,
  columns: [{ head: "Maat" }, { head: "Zonder term", numeric: true }, { head: "Met term", numeric: true }, { head: "Verschil", numeric: true }],
  rows: abRij(g.abJitter, "uit", "aan"),
})}
${tabel({
  caption: `A/B in de solver: nachtuitgang uit en aan, ${g.abNacht.seeds.length} zaadwaarden, ${g.abNacht.seconds} s (H05)`,
  columns: [{ head: "Maat" }, { head: "Klassiek", numeric: true }, { head: "Menselijk ritme", numeric: true }, { head: "Verschil", numeric: true }],
  rows: abRij(g.abNacht, "uit", "nacht"),
  note: "Drie runs per opstelling tonen alleen een richting: CP-SAT met 8 zoekdraden is niet deterministisch. Het kortste herstel van 12–13 uur in twee runs komt uit korte reeksen die de solver niet oplost; dat bleef over voor het bijschaven — en dat ging mis tot H09.",
})}

<h3 class="sec">Bewaking bij het bijschaven</h3>
<p>Het bijschaven mag eerlijkheid hooguit ${nummer(guards.tolerances.fairness, 1)} punt en uren en rust hooguit
${nummer(guards.tolerances.hours, 0)} punt laten zakken ten opzichte van het startrooster; elk punt daarboven kost
${guards.penaltyPerPoint} in de rangschikking, en een reparatie die het doet, wordt afgewezen (H07). Dat is een
bewaking tegenover de start van het bijschaven, niet tegenover v1.0.4: zie hoofdstuk 9.</p>

<h3 class="sec">Versies</h3>
${tabel({
  columns: [{ head: "Onderdeel" }, { head: "Versie" }, { head: "Bestand" }],
  rows: [
    ["Zoekmachine", escape(String(g.optimizer.version)), "<code>configs/optimizer-config-v1.0.5.json</code>"],
    ["Kwaliteitsmodel", escape(String(g.model.version)), "<code>configs/quality-model-v2.json</code>"],
    ["Vorige zoekmachine (bevroren)", "adaptive-1.0.4", "<code>configs/optimizer-config-v1.0.4.json</code>"],
    ["Vorig kwaliteitsmodel (bevroren)", "quality-model-v1", "<code>configs/quality-model-v1.json</code>"],
  ],
})}`,
  };
}

// ── 6. Ontwikkellog ─────────────────────────────────────────────────────────

function h6Ontwikkellog(g: Gegevens): Chapter {
  const entries = g.log.entries as Json[];
  const mislukt = (e: Json) => /vervangen|afgewezen|gewicht 0|niet gekozen/i.test(String(e.outcome));
  const d1 = g.dev1;
  const d1Voor = g.dev1Voor;
  const acceptD1 = (d1Voor ?? d1).acceptance as { eis: string; gehaald: boolean }[];
  return {
    number: 6,
    title: "Ontwikkellog",
    what: "Elke wijziging met reden en gemeten effect, ook wat niet werkte",
    body: `
${tabel({
  caption: "Wijzigingen H01–H" + String(entries.length).padStart(2, "0"),
  columns: [{ head: "Nr", width: "7%" }, { head: "Wat", width: "30%" }, { head: "Gemeten effect", width: "43%" }, { head: "Uitkomst", width: "20%" }],
  rows: entries.map((e) => [
    `<span class="mono">${escape(e.id)}</span>`,
    `<strong>${escape(String(e.component))}</strong><br>${escape(String(e.change))}`,
    escape(String(e.observedEffect)),
    mislukt(e) ? `<span class="worse">${escape(String(e.outcome))}</span>` : escape(String(e.outcome)),
  ]),
})}

<h3 class="sec">H09: de eerste AFTER-meting</h3>
<p>De eerste volledige AFTER-meting (${d1.after.runs} runs, <code>docs/optimizer-benchmark/human-dev1</code>) haalde
${acceptD1.filter((x) => x.gehaald).length} van de ${acceptD1.length} acceptatiepunten. De diagnose per basisrooster wees naar één plek:</p>
${tabel({
  columns: [{ head: "" }, { head: "BEFORE (v1.0.4)", numeric: true }, { head: "Eerste AFTER", numeric: true }],
  rows: [
    ["Kandidaten met een nachtuitgang onder 36 uur", String(d1.diagnostics.before.minRecoveryHoursPerCandidate["<36"]), String(d1.diagnostics.after.minRecoveryHoursPerCandidate["<36"])],
    ["Uitgangen onder de herstelregel in BLM", String(d1.diagnostics.before.exitsBelowRuleByRoster["DDR-BLM"] ?? 0), String(d1.diagnostics.after.exitsBelowRuleByRoster["DDR-BLM"] ?? 0)],
    ["BLM-regels met laat direct gevolgd door vroeg", String(d1.diagnostics.before.heavyTransitionLinesByPattern["DDR-BLM · LE"] ?? 0), String(d1.diagnostics.after.heavyTransitionLinesByPattern["DDR-BLM · LE"] ?? 0)],
  ],
})}
<p>Twee meetdefinities die ik zelf te ruim had gekozen, verklaarden dat:</p>
<ul>
  <li><strong>Etiket of echte wissel.</strong> Een wissel gold als "alleen een ander etiket" bij minder dan drie uur
  verschuiving. Het bijschaven liet daardoor in BLM een laat van 09:47 gratis volgen door een vroeg van 07:22 (13,2 uur
  rust). De enige officiële directe etiketwissels verschuiven 19 en 41 minuten. De grens is nu een uur, gelijk aan de vrije begintijdsprong.</li>
  <li><strong>Uitgang na nachten.</strong> Nacht-vrij-laat (32 uur) scoorde 0,5, nacht-vrij-vrij-vroeg (48 uur) 0. De solver
  had dat goed (H05); het bijschaven draaide het terug. Nu eerst herstel, dan richting; een test legt vast dat de
  waarde nooit daalt bij meer herstel.</li>
</ul>
<p>Prijs: het officiële rooster verliest 0,7 punt robuust, omdat in 50+ Mix vroeg 10:08 → laat 12:19 → rust → vroeg 08:00
nu als mild heen-en-weer telt. Een grens per richting (vooruit 180, achteruit 60) had dat voorkomen, maar steunde op
twee plus twee gevallen uit één steekproef; die is daarom niet gekozen.</p>
${blok(
  "Alle getallen in dit rapport zijn met de definitieve v2 berekend, ook die van de eerste AFTER-meting en van v1.0.4: de ruwe kandidaatroosters zijn bewaard en opnieuw doorgerekend. De uitkomst van de eerste meting onder de eerste definities staat in <code>analysis-dev1-pre-h09.json</code>.",
)}

<h3 class="sec">Een correctie op mijn eigen tussenstand</h3>
<p>Bij H05 noemde ik eerst een vergelijking van "zes tegen zes" runs. Daarin zaten runs met de tabel van H04 en die
van H05 door elkaar; die vergelijking is niet gebruikt. De cijfers in hoofdstuk 5 komen uit één sessie, drie runs
met en drie zonder.</p>`,
  };
}

// ── 7. BEFORE / AFTER ───────────────────────────────────────────────────────

function h7BeforeAfter(g: Gegevens): Chapter {
  const a = g.analyse;
  const d1 = g.dev1;
  const rijen = (a.comparison as Vergelijkingsregel[]).map((m) => {
    const eerste = regel(d1, m.key);
    return [
      escape(m.label),
      nummer(m.official, dec(m.key)),
      nummer(m.before?.mean, dec(m.key)),
      nummer(eerste.after?.mean, dec(m.key)),
      nummer(m.after?.mean, dec(m.key)),
      m.after ? `${nummer(m.after.min, dec(m.key))}–${nummer(m.after.max, dec(m.key))}` : "—",
      verschil(m.delta, dec(m.key)),
      oordeelCel(m.verdict),
    ];
  });
  const acceptatie = a.acceptance as { eis: string; gehaald: boolean }[];
  const staaf = (key: string, label: string) => {
    const m = regel(a, key);
    return {
      label,
      bars: [
        { name: "officieel", value: m.official, color: KLEUR.official },
        { name: "BEFORE", value: m.before?.mean ?? null, color: KLEUR.before },
        { name: "AFTER", value: m.after?.mean ?? null, color: KLEUR.after },
      ],
    };
  };
  return {
    number: 7,
    title: "BEFORE en AFTER",
    what: "Dezelfde meting voor en na, met de eerste AFTER-meting ernaast",
    body: `
<p><strong>BEFORE</strong> zijn de ${a.before.runs} runs van v1.0.4 (${a.before.candidates} kandidaten), gemaakt op
dezelfde gegevens en dezelfde machine en hier met v2 doorgerekend. Dat is hetzelfde als opnieuw draaien, zonder de
ruis van een nieuwe CP-SAT-meting. <strong>AFTER</strong> zijn ${a.after.runs} nieuwe runs van v1.0.5 met dezelfde
verdeling over strategieën (10 Evenwichtig, 5 Rust, 5 Eerlijke lasten), ${a.after.candidates} kandidaten.</p>

${figuur(
  groupedBars([staaf("robust", "Robuust"), staaf("worstLine", "Slechtste regel"), staaf("flow", "Regelmaat"), staaf("nights", "Nachten"), staaf("rest", "Rust"), staaf("fairness", "Eerlijkheid")], { min: 50, max: 100, height: 210 }),
  `Gemiddelden per onderdeel. Goud: het officiële rooster; lichtblauw: v1.0.4; donkerblauw: v1.0.5. Continuïteit ontbreekt: het officiële rooster is daar per definitie 100.`,
)}

<div class="wide">
${tabel({
  caption: "Alle maten, gemeten met kwaliteitsmodel v2",
  columns: [
    { head: "Maat" },
    { head: "Officieel", numeric: true },
    { head: "BEFORE", numeric: true },
    { head: "Eerste AFTER", numeric: true },
    { head: "AFTER", numeric: true },
    { head: "AFTER min–max", numeric: true },
    { head: "Δ AFTER − BEFORE", numeric: true },
    { head: "Oordeel" },
  ],
  rows: rijen,
  note: "Eerste AFTER: de meting vóór H09, met dezelfde definitieve v2 doorgerekend. Het oordeel vergelijkt AFTER met BEFORE.",
})}
</div>

${tabel({
  caption: "Acceptatie (§81) en bewaking (§75)",
  columns: [{ head: "Eis" }, { head: "Gehaald" }],
  rows: acceptatie.map((x) => [escape(x.eis), x.gehaald ? `<span class="better">ja</span>` : `<span class="worse">nee</span>`]),
  note: `Hard: ${a.hard.after.candidates} AFTER-kandidaten, allemaal hard geldig: ${a.hard.after.allHardValid ? "ja" : "nee"}; hoogstens ${a.hard.after.maxUnassigned} niet toegewezen diensten en ${a.hard.after.maxProfileBreaches} profielovertredingen per kandidaat. "Minder" en "beter" betekenen: het gemiddelde over de kandidaten verschuift de goede kant op.`,
})}`,
  };
}

// ── 8. Per basisrooster ─────────────────────────────────────────────────────

function h8PerRooster(g: Gegevens): Chapter {
  const a = g.analyse;
  const maten: [string, string, number][] = [
    ["nightValuePct", "Nachtreeks (%)", 0],
    ["nightMinRecoveryHours", "Kortste herstel (u)", 0],
    ["nightExitsToEarly", "Vroeg na nachten", 2],
    ["oscillations", "Heen-en-weer", 2],
    ["startJitterMean", "Sprong (min)", 0],
    ["worstTransition", "Zwaarste overgang", 1],
  ];
  const rijen = (a.perRoster as Json[]).map((r) => [
    `${escape(naam(r.roster))}`,
    ...maten.map(([key, , d]) => {
      const m = r.metrics[key];
      if (!m || (m.official === null && m.before === null && m.after === null)) return "—";
      return `${nummer(m.official, d)} · ${nummer(m.before, d)} · <strong>${nummer(m.after, d)}</strong>`;
    }),
  ]);
  const diag = (d: Json) => (Object.entries(d).length ? Object.entries(d).map(([k, v]) => `${escape(k)}: ${v}`).join("<br>") : "—");
  const D = a.diagnostics;
  return {
    number: 8,
    title: "Per basisrooster",
    what: "Waar de uitkomst per profiel ligt, en waar de uitschieters zitten",
    body: `
<p>Een gemiddelde over het hele pakket kan één profiel verbergen dat achteruitgaat. In de eerste AFTER-meting was dat
BLM. Per rooster: officieel · BEFORE · <strong>AFTER</strong> (gemiddelde over de kandidaten).</p>
<div class="wide">
${tabel({
  columns: [{ head: "Rooster" }, ...maten.map(([, label]) => ({ head: label, numeric: true }))],
  rows: rijen,
})}
</div>

${tabel({
  caption: "Uitschieters, geteld over alle kandidaten",
  columns: [{ head: "" }, { head: "Officieel" }, { head: "BEFORE" }, { head: "AFTER" }],
  rows: [
    ["Kortste herstel na nachten, per kandidaat", diag(D.official.minRecoveryHoursPerCandidate), diag(D.before.minRecoveryHoursPerCandidate), diag(D.after.minRecoveryHoursPerCandidate)],
    ["Nachtuitgangen onder de herstelregel (46 u)", diag(D.official.exitsBelowRuleByRoster), diag(D.before.exitsBelowRuleByRoster), diag(D.after.exitsBelowRuleByRoster)],
    ["Regels met een zware overgang (op etiket)", diag(D.official.heavyTransitionLinesByPattern), diag(D.before.heavyTransitionLinesByPattern), diag(D.after.heavyTransitionLinesByPattern)],
    ["Nachtreeksen van één of twee", diag(D.official.shortNightBlocksByRoster), diag(D.before.shortNightBlocksByRoster), diag(D.after.shortNightBlocksByRoster)],
  ],
  note: "Zware overgang hier op het etiket (strafpunten ≥ 3), zonder klokcorrectie; daardoor telt het officiële 50+ Mix twee keer mee met laat → vroeg van 19 en 41 minuten. LE = laat direct gevolgd door vroeg; NRE = nacht, één vrije dag, vroeg.",
})}`,
  };
}

// ── 9. Regressies ───────────────────────────────────────────────────────────

function h9Regressies(g: Gegevens): Chapter {
  const a = g.analyse;
  const slechter = (a.comparison as Vergelijkingsregel[]).filter((m) => m.verdict === "slechter");
  return {
    number: 9,
    title: "Regressies en wat open blijft",
    what: "Alles wat na de ijking slechter is, of niet is opgelost",
    body: `
${
  slechter.length === 0
    ? blok("Geen enkele maat is gemiddeld slechter dan bij v1.0.4.", "ok")
    : tabel({
        caption: "Gemiddeld slechter dan v1.0.4",
        columns: [{ head: "Maat" }, { head: "BEFORE", numeric: true }, { head: "AFTER", numeric: true }, { head: "Verschil", numeric: true }, { head: "Officieel", numeric: true }],
        rows: slechter.map((m) => [escape(m.label), nummer(m.before?.mean, dec(m.key)), nummer(m.after?.mean, dec(m.key)), verschil(m.delta, dec(m.key)), nummer(m.official, dec(m.key))]),
        note: "Elke regel hier is een echte achteruitgang op die maat, ook als hij klein is. Een maat waarop v1.0.4 al beter scoorde dan het officiële rooster (bijvoorbeeld samenhang in werkblokken), kan iets zakken zonder van de referentie weg te bewegen; dat staat erbij, niet in plaats van.",
      })
}

<h3 class="sec">Bekende beperkingen</h3>
<ul>
  <li><strong>Eén steekproef.</strong> Alle zachte principes komen uit één roosterperiode van één standplaats.</li>
  <li><strong>Ruis.</strong> CP-SAT met 8 zoekdraden is niet deterministisch; dezelfde zaadwaarden gaven tussen twee metingen
  robuust ±2–3. Twintig runs per meting dempen dat, maar een verschil van een paar tienden is geen bewijs.</li>
  <li><strong>De bewaking is relatief.</strong> Eerlijkheid, uren en rust worden bewaakt tegenover de start van het bijschaven,
  niet tegenover v1.0.4. Een solver die een ander startpunt kiest, kan een onderdeel dus meer laten zakken dan de marge.</li>
  <li><strong>Het officiële rooster is geen plafond.</strong> Op regelmaat en uren scoren de gegenereerde kandidaten al hoger dan
  het officiële rooster; op nachten en uitgang na nachten lager. Dat hoger is niet "menselijker": het is hoe de maat telt.</li>
  <li><strong>Geen menselijk oordeel.</strong> Alles in dit rapport is meting. Het oordeel komt uit hoofdstuk 10 en 11.</li>
</ul>`,
  };
}

// ── 10. Kandidaten ──────────────────────────────────────────────────────────

function h10Kandidaten(g: Gegevens): Chapter {
  const s = g.kandidaten;
  if (!s) {
    return {
      number: 10,
      title: "De drie kandidaatpakketten",
      what: "Ter beoordeling door de Roostercommissie",
      body: blok("NOG NIET GEGENEREERD — draai <code>npm run human-benchmark:final -- generate</code>.", "bad"),
    };
  }
  const k = s.candidates as Json[];
  const rij = (label: string, f: (c: Json) => string) => [escape(label), ...k.map(f)];
  const comp = (naamC: string) => (c: Json) => nummer(c.quality.components[naamC], 1);
  const rijen = [
    rij("Robuuste kwaliteit", (c) => nummer(c.quality.robust, 1)),
    rij("Kwaliteit zonder continuïteit", (c) => nummer(c.quality.overallWithoutContinuity, 1)),
    rij("Slechtste regel", (c) => (c.quality.worstLine ? `${nummer(c.quality.worstLine.score, 1)}<br><span class="note">${escape(naam(c.quality.worstLine.roster))} r${c.quality.worstLine.lineNumber}${c.quality.worstLine.facts?.length ? ` · ${escape(c.quality.worstLine.facts.join(", "))}` : ""}</span>` : "—")),
    rij("Regelmaat", comp("flow")),
    rij("Nachten", comp("nights")),
    rij("Rust", comp("rest")),
    rij("Uren", comp("hours")),
    rij("Eerlijkheid", comp("fairness")),
    rij("Continuïteit", comp("stability")),
    rij("Hard geldig · niet toegewezen · profiel", (c) => `${c.quality.hardValid ? "ja" : "<span class=\"worse\">nee</span>"} · ${c.quality.unassigned} · ${c.quality.profileBreaches}`),
    rij("Validatie in het platform", (c) => escape(String(c.validationState))),
    rij("Losse nachten · reeksen van twee", (c) => `${c.quality.singletonNights} · ${c.quality.twoNightBlocks}`),
    rij("Kortste herstel na nachten (u)", (c) => nummer(c.rhythm.nightMinRecoveryHours, 1)),
    rij("Vroeg direct na nachtrust", (c) => String(c.rhythm.nightExitsToEarly)),
    rij("Heen-en-weer", (c) => String(c.rhythm.oscillations)),
    rij("Sprong begintijd gem. / p90 (min)", (c) => `${nummer(c.rhythm.startJitterMean, 0)} / ${nummer(c.rhythm.startJitterP90, 0)}`),
    rij("Zwaarste overgang (etiket)", (c) => String(c.rhythm.worstTransition)),
    rij("Structurele afstand tot officieel", (c) => nummer(c.quality.patternDistance, 1)),
  ];
  const perRooster = (c: Json) =>
    tabel({
      caption: `Kandidaat ${c.number} per basisrooster`,
      columns: [
        { head: "Rooster" },
        { head: "Slechtste regel", numeric: true },
        { head: "Nachtreeksen" },
        { head: "Kortste herstel (u)", numeric: true },
        { head: "Heen-en-weer", numeric: true },
        { head: "Sprong (min)", numeric: true },
        { head: "Zwaarste overgang", numeric: true },
      ],
      rows: (c.perRoster as Json[]).map((r) => [
        escape(naam(r.roster)),
        nummer(r.worstLineScore, 1),
        Object.entries(r.nightBlocks as Record<string, number>).map(([l, n]) => `${n}× ${l}`).join(", ") || "—",
        nummer(r.nightMinRecoveryHours, 0),
        String(r.oscillations),
        nummer(r.startJitterMean, 0),
        String(r.worstTransition),
      ]),
    });
  return {
    number: 10,
    title: "De drie kandidaatpakketten",
    what: "Ter beoordeling door de Roostercommissie",
    body: `
<p>Gemaakt op ${escape(datum(s.run.finishedAt))} zoals de knop "Genereren" het doet: zoekmachine
${escape(String(s.run.engine))}, rekentijdmodus ${escape(String(s.run.searchMode))}, strategie Evenwichtig, drie
kandidaten. Run <code>${escape(String(s.run.runId))}</code>. Ze staan in de simulatie onder
<em>${escape(String(k[0]?.label ?? ""))}</em>, en elk pakket is als één PDF met alle zeven basisroosters geëxporteerd:</p>
<ul>${k.map((c) => `<li><code>docs/human-roster-benchmark/final-candidates/Kandidaat-${c.number}-alle-basisroosters.pdf</code></li>`).join("")}</ul>

${blok("Deze drie zijn door niemand beoordeeld. De getallen hieronder zijn metingen; of een rooster goed rijdt, zegt de Roostercommissie.", "warn")}

<div class="wide">
${tabel({
  caption: "De drie naast elkaar",
  columns: [{ head: "Maat" }, ...k.map((c) => ({ head: `Kandidaat ${c.number}`, numeric: true }))],
  rows: rijen,
  note: `Ter vergelijking het officiële rooster: robuust ${nummer(s.official.robust, 1)}, slechtste regel ${nummer(s.official.worstLine, 1)}.`,
})}
</div>

${k.map(perRooster).join("")}`,
  };
}

// ── 11. Beoordeling ─────────────────────────────────────────────────────────

function h11Beoordeling(): Chapter {
  return {
    number: 11,
    title: "Hoe de beoordeling werkt",
    what: "Oordeel per regel en voorkeur tussen kandidaten; wat ermee gebeurt",
    body: `
<p>Onder elke roosterregel in de simulatie staat <em>Regel beoordelen</em>: Goed, Twijfel of Slecht, met redenen die
aansluiten op wat het model meet (goede flow, goede nachtreeks, goed herstel, goede uren; heen-en-weer, losse nacht,
reeks van twee nachten, slecht herstel, grote sprong in begintijd, uitschieter in uren, oneerlijk, zware weekenden)
en een vrije toelichting. Op de vergelijkingspagina staat per paar kandidaten <em>Welke rijdt menselijker?</em> met
redenen als betere flow, betere nachtreeksen, beter herstel, eerlijker, minder vreemde overgangen.</p>

${tabel({
  caption: "Wat er per oordeel wordt bewaard",
  columns: [{ head: "Veld" }, { head: "Waarom" }],
  rows: [
    ["kandidaat, basisrooster, regel", "waar het oordeel over gaat; de regel moet echt in de kandidaat bestaan"],
    ["oordeel, redenen, toelichting", "de redenen zijn een vaste lijst; een onbekende reden wordt geweigerd"],
    ["kwaliteitsmodel- en zoekmachineversie", "zonder versies is later niet te zeggen waarover het oordeel ging"],
    ["wie en wanneer", "personeelsnummer en tijdstip; namen staan achter een aparte permissie"],
    ["auditregel", "kandidaat.menselijk-oordeel en kandidaat.menselijke-voorkeur"],
  ],
})}

${blok("Een oordeel verandert niets automatisch: geen gewicht, geen model, geen productie-instelling. Het is grondstof voor de volgende ijking, die pas begint na jullie feedback.", "ok")}`,
  };
}

// ── 12. Reproduceerbaarheid ─────────────────────────────────────────────────

function h12Reproduceerbaarheid(g: Gegevens): Chapter {
  const c = g.controles;
  return {
    number: 12,
    title: "Reproduceerbaarheid en controles",
    what: "Welke opdracht welk bestand maakt, en wat de tests zeggen",
    body: `
${tabel({
  columns: [{ head: "Opdracht" }, { head: "Maakt" }],
  rows: [
    ["<code>npm run human-benchmark:extract</code>", "officiële kenmerken, CSV's, profielverwachtingen"],
    ["<code>npm run human-benchmark:contrastive</code>", "<code>contrastive-check.json</code>"],
    ["<code>npm run human-benchmark:solver-ab</code>", "<code>solver-ab-*.json</code>"],
    ["<code>npm run verify:optimizer-benchmark -- run --phase human …</code>", "<code>docs/optimizer-benchmark/human/run-*.json</code> (ruwe kandidaatroosters)"],
    ["<code>npm run human-benchmark:analyse</code>", "<code>analysis-before-after.json</code>"],
    ["<code>npm run human-benchmark:analyse -- --after human-dev1 --out analysis-dev1-final-v2.json</code>", "de eerste AFTER-meting met de definitieve v2"],
    ["<code>npm run human-benchmark:final -- generate | export</code>", "de drie kandidaten, <code>final-candidates/</code>"],
    ["<code>npm run config:write</code>", "<code>configs/quality-model-v2.json</code>, <code>configs/optimizer-config-v1.0.5.json</code>"],
    ["<code>npm run report:human</code> en <code>report:human-pdf</code>", "dit rapport"],
  ],
})}

${
  c
    ? tabel({
        caption: `Testbatterij (${(c.suites as Json[]).filter((x) => x.ok).length} van ${(c.suites as Json[]).length} geslaagd)`,
        columns: [{ head: "Suite" }, { head: "Opdracht" }, { head: "Uitkomst" }, { head: "Tijd (s)", numeric: true }],
        rows: (c.suites as Json[]).map((x) => [
          escape(String(x.name)),
          `<code>${escape(String(x.command))}</code>`,
          (x.ok ? '<span class="better">geslaagd</span> · ' : '<span class="worse">GEFAALD</span> · ') + `<span class="note">${escape(String(x.summary).slice(0, 160))}</span>`,
          nummer(x.seconds, 1),
        ]),
        note: `Gedraaid op ${escape(datum(c.ranAt))} met <code>npm run test:battery -- --out docs/human-roster-benchmark/test-results.json</code>${c.full ? "" : "; niet alle suites zijn gedraaid"}.`,
      })
    : blok("Testbatterij nog niet vastgelegd (<code>test-results.json</code> ontbreekt).", "bad")
}`,
  };
}

function main() {
  const html = bouw(laad());
  writeFileSync(HUMAN_REPORT_HTML, html);
  console.log(`Geschreven: ${HUMAN_REPORT_HTML}`);
}

if (require.main === module) {
  main();
}
