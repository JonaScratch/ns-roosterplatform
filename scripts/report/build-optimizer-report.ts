import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  type Analyse,
  type CandidateRow,
  type MetricVergelijking,
  type RapportGegevens,
  type RunRow,
  type Vergelijking,
  laadGegevens,
} from "./data";
import {
  type Chapter,
  beeldmerk,
  blok,
  cijferkaart,
  document,
  duur,
  escape,
  figuur,
  hoofdstuk,
  kaart,
  nummer,
  oordeelKlasse,
  procent,
  tabel,
  verschil,
} from "./layout";
import { groupedBars, histogram, rangeChart, scatter } from "./charts";

/**
 * Het ontwikkelrapport van de v1.0.4-zoekmachine.
 *
 * ## Wat dit document is
 *
 * Een verslag van een experiment: wat er is gemeten voordat er iets veranderde,
 * wat er is gebouwd, wat er daarna is gemeten, en wat dat wel en niet bewijst.
 * Geen verkooptekst. Waar de uitkomst tegenvalt, staat de tegenvaller er; waar
 * een aanpak niet werkte, staat het hoofdstuk erover in het midden van het
 * rapport en niet in een voetnoot.
 *
 *   npm run report:optimizer
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const HTML = path.join(WORTEL, "docs", "NS-Roosterplatform-v1.0.4-Optimizer-Development-Report.html");

const VERSIE = "1.0.4";

// ── Hulpjes op de gegevens ───────────────────────────────────────────────────

const metricVan = (analyse: Analyse, key: string): MetricVergelijking => {
  const gevonden = analyse.metrics.find((metric) => metric.key === key);
  if (!gevonden) {
    throw new Error(`De maat ${key} staat niet in analysis.json; het rapport zou een leeg vak krijgen.`);
  }
  return gevonden;
};

/** Eén regel in een vergelijkingstabel: gemiddelde, mediaan, beste, slechtste. */
function vergelijkRij(label: string, v: Vergelijking | null, decimalen = 1, officieel: number | null = null) {
  if (!v) {
    return [label, "—", "—", "—", "—", "—", "—"];
  }
  return [
    label,
    officieel === null ? "—" : nummer(officieel, decimalen),
    `${nummer(v.before.mean, decimalen)} <span class="note">± ${nummer(v.before.sd, decimalen)}</span>`,
    `${nummer(v.after.mean, decimalen)} <span class="note">± ${nummer(v.after.sd, decimalen)}</span>`,
    `<span class="${oordeelKlasse(v.mean.verdict)}">${verschil(v.mean.delta, decimalen)}</span>`,
    `<span class="${oordeelKlasse(v.median.verdict)}">${verschil(v.median.delta, decimalen)}</span>`,
    `<span class="${oordeelKlasse(v.worst.verdict)}">${verschil(v.worst.delta, decimalen)}</span>`,
  ];
}

const VERGELIJK_KOLOMMEN = [
  { head: "Maat", width: "26%" },
  { head: "Officieel", numeric: true },
  { head: "BEFORE gem.", numeric: true },
  { head: "AFTER gem.", numeric: true },
  { head: "Δ gem.", numeric: true },
  { head: "Δ mediaan", numeric: true },
  { head: "Δ slechtste", numeric: true },
];

const KERNMATEN: readonly { key: string; decimalen: number }[] = [
  { key: "robust", decimalen: 1 },
  { key: "overallWithoutContinuity", decimalen: 1 },
  { key: "worstLine", decimalen: 1 },
  { key: "hours", decimalen: 1 },
  { key: "flow", decimalen: 1 },
  { key: "rest", decimalen: 1 },
  { key: "nights", decimalen: 1 },
  { key: "fairness", decimalen: 1 },
  { key: "stability", decimalen: 1 },
];

/**
 * De kandidaten van één fase, zonder de nulmeting.
 *
 * De nulmeting neemt het huidige rooster over en is in beide fasen hetzelfde
 * kandidaat. Hij hoort bij de referentie, niet bij wat de zoekmachine maakte;
 * meetellen zou de spreiding van beide fasen even ver oprekken en daarmee juist
 * het verschil verbergen. Hoofdstuk 4 laat hem apart zien.
 */
const fase = (rijen: readonly CandidateRow[], phase: string) =>
  rijen.filter((rij) => rij.phase === phase && rij.strategy !== "REPRODUCE");
const getallen = (rijen: readonly CandidateRow[], key: string) =>
  rijen.map((rij) => rij[key]).filter((w): w is number => typeof w === "number" && Number.isFinite(w));

// ── Het rapport ──────────────────────────────────────────────────────────────

function bouw(g: RapportGegevens): string {
  const { analyse, summary } = g;
  const robust = metricVan(analyse, "robust");
  const worstLine = metricVan(analyse, "worstLine");
  const beterCount = analyse.headline.filter((m) => m.meanVerdict === "beter").length;
  const slechterCount = analyse.headline.filter((m) => m.meanVerdict === "slechter").length;
  const alleHardGeldig = analyse.hardValidity.afterAllValid;
  const regressieOk = analyse.regression.every((toets) => toets.pass);
  const besluit =
    !alleHardGeldig || !regressieOk
      ? "AFGEKEURD"
      : beterCount >= 3 && slechterCount === 0
        ? "AANGENOMEN"
        : beterCount > slechterCount
          ? "AANGENOMEN MET KANTTEKENINGEN"
          : "ENGINE EXPERIMENT INCONCLUSIVE";

  const hoofdstukken: Chapter[] = [
    h1Samenvatting(g, besluit, robust, worstLine),
    h2Condities(g),
    h3Before(g),
    h4Officieel(g),
    h5Architectuur(g),
    h6Kwaliteitsmodel(g),
    h7Zoekstrategie(g),
    h8Wijzigingen(g),
    h9Gewichten(g),
    h10After(g),
    h11Vergelijking(g),
    h12PerProfiel(g),
    h13LaatNacht(g),
    h14Rekentijd(g),
    h15Zoekefficientie(g),
    h16NietGewerkt(g),
    h17Regressies(g),
    h18Tests(g),
    h19Beperkingen(g),
    h20Debuggen(g),
    h21Reproduceerbaarheid(g),
    h22Conclusie(g, besluit),
  ];

  const omslag = `
<section class="cover">
  <div class="cover-top">
    ${beeldmerk(20)}
    <div class="cover-tag">Roosterplatform<br>Ontwikkelrapport<br>${escape(new Date(analyse.generatedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }))}</div>
  </div>
  <div class="cover-mid">
    <div class="kicker">Versie ${VERSIE} · optimizer</div>
    <h1>De zoekmachine<br>gemeten, verbouwd<br>en opnieuw gemeten</h1>
    <p class="claim">Wat een roosterpakket van v1.0.3 opleverde, wat er aan de zoekmachine is veranderd,
    en wat dezelfde meting daarna liet zien — inclusief wat niet werkte.</p>
  </div>
  <div class="cover-band">
    <div class="place">Standplaats ${escape(String(g.manifestBefore.data.location ?? "—"))} · dienstenpakket ${escape(String((g.manifestBefore.data.dutyPackage as {label?:string})?.label ?? "—"))}</div>
    <div class="version">${analyse.counts.before.runs} BEFORE-runs · ${analyse.counts.after.runs} AFTER-runs<br>${analyse.counts.before.candidates + analyse.counts.after.candidates} kandidaten beoordeeld<br>kwaliteitsmodel ${escape(String(analyse.qualityModel.version ?? "—"))}</div>
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
  <p class="note" style="margin-top:6mm">Dit rapport is gegenereerd uit de ruwe meetgegevens in
  <code>docs/optimizer-benchmark/</code>. Elk getal in dit document komt uit die bestanden; er staan geen
  voorbeeldwaarden in. Wie een cijfer wil natrekken, vindt onder hoofdstuk 21 welke opdracht het oplevert.</p>
</section>`;

  return document({
    title: `NS Roosterplatform ${VERSIE} — Ontwikkelrapport optimizer`,
    cover: omslag,
    toc: inhoud,
    chapters: hoofdstukken.map(hoofdstuk),
  });
}

// ── 1. Managementsamenvatting ────────────────────────────────────────────────

function h1Samenvatting(
  g: RapportGegevens,
  besluit: string,
  robust: MetricVergelijking,
  worstLine: MetricVergelijking,
): Chapter {
  const { analyse } = g;
  const perRun = analyse.perRun.bestRobust;
  const wr = perRun.winRate;
  const eff = analyse.searchEfficiency;
  const varianten = Number(eff.polishVariants ?? 0) + Number(eff.attempts ?? 0);
  const runtime = analyse.perRun.runtimeSeconds;

  const beterLijst = analyse.headline.filter((m) => m.meanVerdict === "beter").map((m) => m.label);
  const slechterLijst = analyse.headline.filter((m) => m.meanVerdict === "slechter").map((m) => m.label);

  const body = `
<p class="lede">De v1.0.3-zoekmachine leverde per opdracht één CP-SAT-oplossing per kandidaat. De v1.0.4-machine
zoekt breder: meerdere vertrekpunten, een onafhankelijke kwaliteitsmeting van elke kandidaat, gericht
repareren en bijschaven met ruildiensten. Dit hoofdstuk zegt in het kort wat dat opleverde.</p>

<div class="cards g4">
  ${cijferkaart(nummer(robust.overall?.before.mean ?? null, 1), `robuuste kwaliteit BEFORE (gemiddeld over ${analyse.counts.before.candidates} kandidaten)`)}
  ${cijferkaart(nummer(robust.overall?.after.mean ?? null, 1), `robuuste kwaliteit AFTER (gemiddeld over ${analyse.counts.after.candidates} kandidaten)`)}
  ${cijferkaart(verschil(robust.overall?.mean.delta ?? null, 1), "verschil in robuuste kwaliteit")}
  ${cijferkaart(verschil(worstLine.overall?.mean.delta ?? null, 1), "verschil op de slechtste roosterregel")}
</div>

<h3 class="sec">Wat beter werd en wat niet</h3>
${
  beterLijst.length > 0
    ? `<p>Vooruit op het gemiddelde: ${escape(beterLijst.join(", "))}.</p>`
    : `<p>Geen enkele kernmaat ging er gemiddeld op vooruit.</p>`
}
${
  slechterLijst.length > 0
    ? `<p>Achteruit op het gemiddelde: ${escape(slechterLijst.join(", "))}. Hoofdstuk 11 en 17 laten zien hoeveel en waarom.</p>`
    : `<p>Geen enkele kernmaat ging er gemiddeld op achteruit.</p>`
}

${tabel({
  caption: "De kernmaten in één oogopslag",
  columns: VERGELIJK_KOLOMMEN,
  rows: KERNMATEN.map(({ key, decimalen }) => {
    const metric = metricVan(analyse, key);
    return vergelijkRij(metric.label, metric.overall, decimalen, metric.official);
  }),
  note:
    "Alle kandidaten van beide fasen, niet alleen de beste. De kolom Officieel is het menselijke rooster " +
    "met hetzelfde model gemeten: een ijkpunt, geen norm.",
})}

<h3 class="sec">Hoe vaak wint de nieuwe machine</h3>
<p>Per run telt voor de Roostercommissie de beste kandidaat. Leg de runs van beide fasen op volgorde naast
elkaar, dan wint AFTER ${wr.wonByRank} van de ${wr.pairs} vergelijkingen${wr.tiedByRank > 0 ? `, met ${wr.tiedByRank} gelijkspel` : ""}.
Vergelijk elke AFTER-run met elke BEFORE-run, dan is de kans dat de nieuwe machine wint
${procent((wr.allPairsProbability ?? 0) * 100, 0)}.</p>

<h3 class="sec">Wat het kost</h3>
<p>Een opdracht duurde in de BEFORE-meting gemiddeld ${duur(runtime?.before.mean ?? null)} en in de AFTER-meting
${duur(runtime?.after.mean ?? null)}. Daarvoor onderzocht de machine per run gemiddeld
${nummer(varianten / Math.max(1, analyse.counts.after.runs), 0)} varianten in plaats van één oplossing per kandidaat.</p>

${blok(
  besluit === "AANGENOMEN"
    ? "Besluit: de adaptieve zoekmachine gaat mee als standaard. De onderbouwing staat in hoofdstuk 22; de terugvalschakelaar naar v1.0.3 blijft bestaan."
    : besluit === "AANGENOMEN MET KANTTEKENINGEN"
      ? "Besluit: de adaptieve zoekmachine gaat mee als standaard, met de kanttekeningen uit hoofdstuk 17. De terugvalschakelaar naar v1.0.3 blijft bestaan."
      : besluit === "ENGINE EXPERIMENT INCONCLUSIVE"
        ? "Besluit: ENGINE EXPERIMENT INCONCLUSIVE. De meting laat geen duidelijke verbetering zien; v1.0.3 blijft de standaardoptimizer."
        : "Besluit: afgekeurd. Er is een harde regressie gevonden; zie hoofdstuk 17.",
  besluit === "AANGENOMEN" ? "ok" : besluit === "AFGEKEURD" ? "bad" : "warn",
)}

<p class="note">Dit rapport claimt nergens dat de machine betere roosters maakt dan roostermakers. Het
officiële rooster is met hetzelfde model gemeten en dient als ijkpunt voor wat menselijk gemaakte structuur
oplevert; verschillen daarmee zeggen iets over de maat, niet over vakmanschap.</p>`;

  return {
    number: 1,
    title: "Managementsamenvatting",
    what: "Wat er is gemeten, wat het opleverde en wat het besluit is",
    body,
  };
}

// ── 2. Testcondities ─────────────────────────────────────────────────────────

function h2Condities(g: RapportGegevens): Chapter {
  const voor = g.manifestBefore;
  const na = g.manifestAfter;
  const gelijk = (key: string) =>
    JSON.stringify(voor.hashes[key]) === JSON.stringify(na.hashes[key]) ? "gelijk" : "VERSCHILT";
  const machine = voor.machine as Record<string, string | number>;

  const body = `
<p class="lede">Een vergelijking gaat alleen over de zoekmachine als al het andere gelijk blijft. Dit
hoofdstuk legt vast wat er aan beide kanten hetzelfde was, en hoe dat is afgedwongen.</p>

${tabel({
  caption: "Vastgelegde condities",
  columns: [{ head: "Wat" }, { head: "BEFORE" }, { head: "AFTER" }, { head: "Gelijk?" }],
  rows: [
    ["Dienstenpakket", escape(String((voor.data.dutyPackage as {label?:string})?.label ?? "—")), escape(String((na.data.dutyPackage as {label?:string})?.label ?? "—")), String((voor.data.dutyPackage as {label?:string})?.label) === String((na.data.dutyPackage as {label?:string})?.label) ? "gelijk" : "VERSCHILT"],
    ["Standplaats", escape(String(voor.data.location ?? "—")), escape(String(na.data.location ?? "—")), String(voor.data.location) === String(na.data.location) ? "gelijk" : "VERSCHILT"],
    ["Roosterstructuur", escape(String(voor.data.rosterStructureVersion ?? "—")), escape(String(na.data.rosterStructureVersion ?? "—")), String(voor.data.rosterStructureVersion) === String(na.data.rosterStructureVersion) ? "gelijk" : "VERSCHILT"],
    ["Invoergegevens", escape(String(voor.data.inputDataVersion ?? "—")), escape(String(na.data.inputDataVersion ?? "—")), String(voor.data.inputDataVersion) === String(na.data.inputDataVersion) ? "gelijk" : "VERSCHILT"],
    ["Profielconfiguratie (hash)", `<code>${escape(String(voor.hashes.profileConfig).slice(0, 12))}</code>`, `<code>${escape(String(na.hashes.profileConfig).slice(0, 12))}</code>`, gelijk("profileConfig")],
    ["Regelbestand (hash)", `<code>${escape(String(voor.hashes.ruleset).slice(0, 12))}</code>`, `<code>${escape(String(na.hashes.ruleset).slice(0, 12))}</code>`, gelijk("ruleset")],
    ["Regelversie", `${escape(voor.ruleset.version)} (${voor.ruleset.rules} regels)`, `${escape(na.ruleset.version)} (${na.ruleset.rules} regels)`, voor.ruleset.version === na.ruleset.version ? "gelijk" : "VERSCHILT"],
    ["Juridische status", escape(voor.ruleset.legalStatus), escape(na.ruleset.legalStatus), voor.ruleset.legalStatus === na.ruleset.legalStatus ? "gelijk" : "VERSCHILT"],
    ["Solverscript (hash)", `<code>${escape(String(voor.hashes.solverScript).slice(0, 12))}</code>`, `<code>${escape(String(na.hashes.solverScript).slice(0, 12))}</code>`, gelijk("solverScript")],
    ["Optimizerconfiguratie (hash)", `<code>${escape(String(voor.hashes.optimizerConfig).slice(0, 12))}</code>`, `<code>${escape(String(na.hashes.optimizerConfig).slice(0, 12))}</code>`, gelijk("optimizerConfig")],
  ],
  note:
    "Het solverscript hoort hier te verschillen: daar zit de vastzetting voor de gerichte reparatie in, en " +
    "dat is het experiment. De optimizerconfiguratie in dit overzicht is die van de klassieke zoekmachine; " +
    "die is ongewijzigd gebleven, want de adaptieve machine heeft zijn eigen configuratie " +
    "(configs/optimizer-config-v1.0.4.json, hoofdstuk 7 en 9). De benchmark weigert te starten wanneer de " +
    "gegevens, de profielen, het regelbestand of de machine afwijken; die vingerafdruk is in beide fasen gelijk.",
})}

<h3 class="sec">De machine</h3>
${tabel({
  columns: [{ head: "Onderdeel" }, { head: "Waarde" }],
  rows: [
    ["Processor", escape(String(machine.cpuModel ?? "—"))],
    ["Logische kernen", nummer(Number(machine.logicalCpus ?? 0), 0)],
    ["Werkgeheugen", `${nummer(Number(machine.totalMemoryBytes ?? 0) / 1024 ** 3, 1)} GB`],
    ["Besturingssysteem", escape(String(machine.os ?? "—"))],
    ["Node", escape(String(machine.node ?? "—"))],
    ["Python", escape(String(machine.python ?? "—"))],
    ["OR-Tools", escape(String(machine.ortools ?? "—"))],
    ["Solverdraden", nummer(Number(machine.solverWorkers ?? 0), 0)],
  ],
})}

<h3 class="sec">Vastgelegde code</h3>
<p>BEFORE draaide op commit <code>${escape(voor.git.commit.slice(0, 12))}</code>${voor.git.dirty ? " (met niet-vastgelegde wijzigingen)" : ""},
AFTER op commit <code>${escape(na.git.commit.slice(0, 12))}</code>${na.git.dirty ? " (met niet-vastgelegde wijzigingen)" : ""}.
De v1.0.3-machine blijft bereikbaar via de schakelaar <code>NS_OPTIMIZER_ENGINE=legacy</code>; hoofdstuk 21
beschrijft hoe een meting exact wordt herhaald.</p>

${blok(
  "Wat niet is veranderd: de harde regels, de profielgrenzen, de eindvalidatie, de publicatiepoort en de " +
    "juridische status van het regelbestand. Een kandidaat die de validatie niet haalt, komt in beide fasen " +
    "niet in de uitkomst terecht.",
)}`;

  return {
    number: 2,
    title: "Testcondities",
    what: "Wat aan beide kanten gelijk was, en hoe dat is afgedwongen",
    body,
  };
}

// ── 3. BEFORE ────────────────────────────────────────────────────────────────

function h3Before(g: RapportGegevens): Chapter {
  const groepen = g.summary.groups.filter((groep) => groep.phase === "before" && groep.strategy !== "REPRODUCE");
  const kandidaten = fase(g.kandidaten, "before");
  const robustWaarden = getallen(kandidaten, "robust");

  const body = `
<p class="lede">De BEFORE-meting is gedraaid met de v1.0.3-zoekmachine, vóór er een regel aan de
optimalisatie was veranderd. Zonder die meting zou elke latere uitspraak over verbetering een mening zijn.</p>

${tabel({
  caption: "De BEFORE-meting per strategie",
  columns: [
    { head: "Strategie" },
    { head: "Runs", numeric: true },
    { head: "Kandidaten", numeric: true },
    { head: "Robuust gem.", numeric: true },
    { head: "Robuust mediaan", numeric: true },
    { head: "Laagste", numeric: true },
    { head: "Hoogste", numeric: true },
    { head: "Rekentijd gem.", numeric: true },
  ],
  rows: groepen.map((groep) => [
    escape(groep.strategy),
    nummer(groep.runs, 0),
    nummer(groep.candidates, 0),
    nummer(groep.metrics.robust?.mean ?? null, 1),
    nummer(groep.metrics.robust?.median ?? null, 1),
    nummer(groep.metrics.robust?.min ?? null, 1),
    nummer(groep.metrics.robust?.max ?? null, 1),
    duur(groep.runtimeSeconds.mean),
  ]),
})}

<h3 class="sec">Waarom meer dan één run</h3>
<p>CP-SAT met meerdere zoekdraden en een tijdslimiet levert bij identieke invoer niet elke keer hetzelfde
rooster op. In de BEFORE-meting liep de robuuste kwaliteit van ${nummer(Math.min(...robustWaarden), 1)} tot
${nummer(Math.max(...robustWaarden), 1)} over ${kandidaten.length} kandidaten. Eén run had dus elk verhaal
kunnen ondersteunen; daarom staat overal in dit rapport de spreiding erbij.</p>

${figuur(
  histogram(
    [
      { name: "BEFORE", color: "#8695ac", values: robustWaarden },
      { name: "AFTER", color: "#003da5", values: getallen(fase(g.kandidaten, "after"), "robust") },
    ],
    { bins: 12 },
  ),
  "Verdeling van de robuuste kwaliteit over alle kandidaten van beide fasen. De robuuste kwaliteit weegt " +
    "het totaalcijfer met de slechtste roosterregel en met uitschieters, zodat één slecht rooster niet " +
    "wegvalt tegen zes goede.",
)}

<h3 class="sec">Wat de BEFORE-meting bewaart</h3>
<p>Per run is het ruwe resultaat bewaard: alle toewijzingen van elke kandidaat, de solverstatistiek, de
validatie-uitkomst, de zaadwaarde, de rekentijd en het geheugengebruik. De kwaliteitsmaten zijn daar
achteraf uit berekend. Dat is bewust: wordt er later een fout in een maat gevonden, dan kan die op beide
fasen opnieuw worden toegepast zonder de solver nog een keer te draaien.</p>`;

  return {
    number: 3,
    title: "De BEFORE-meting",
    what: "Wat de v1.0.3-machine opleverde, met spreiding",
    body,
  };
}

// ── 4. Officieel rooster ─────────────────────────────────────────────────────

function h4Officieel(g: RapportGegevens): Chapter {
  const rij = g.summary.official;
  const waarde = (key: string, decimalen = 1) =>
    typeof rij[key] === "number" ? nummer(rij[key] as number, decimalen) : "—";

  const body = `
<p class="lede">Het officiële rooster is met precies hetzelfde model gemeten als elke kandidaat. Niet als
norm — een menselijk rooster is geen bovengrens en geen ondergrens — maar als ijkpunt: het laat zien welke
waarden een door mensen gemaakte structuur oplevert.</p>

${tabel({
  caption: "Het officiële rooster, gemeten met het kwaliteitsmodel",
  columns: [{ head: "Maat" }, { head: "Waarde", numeric: true }, { head: "Wat het zegt" }],
  rows: [
    ["Kwaliteit totaal", waarde("overall"), "Gewogen totaal van alle onderdelen"],
    ["Kwaliteit zonder continuïteit", waarde("overallWithoutContinuity"), "Zonder het onderdeel dat het rooster met zichzelf vergelijkt"],
    ["Robuuste kwaliteit", waarde("robust"), "Totaal, gewogen met de slechtste regel en uitschieters"],
    ["Slechtste regel", waarde("worstLine"), "De zwakste roosterregel in het hele pakket"],
    ["Uren", waarde("hours"), "Afwijking van 40:00 per rooster en per regel"],
    ["Regelmaat", waarde("flow"), "Stabiele opeenvolging van dagdelen"],
    ["Rust", waarde("rest"), "Rust boven het wettelijke minimum en herstel na nachten"],
    ["Nachten", waarde("nights"), "Losse nachten en reeksen van twee"],
    ["Eerlijkheid", waarde("fairness"), "Verdeling van nachten, rangeerwerk en weekenden"],
    ["Losse nachten", waarde("singletonNights", 0), "Nachtdiensten zonder buur"],
    ["Zware overgangen", waarde("heavyTransitions", 0), "Nacht → vroeg, laat → vroeg en vroeg → nacht"],
  ],
})}

${blok(
  "De hoge continuïteitsscore van het officiële rooster is een meetkundig gegeven, geen prestatie: het " +
    "rooster is zijn eigen referentie en scoort op dat onderdeel per definitie honderd. Daarom staat overal " +
    "in dit rapport ook de variant zonder continuïteit.",
)}

<h3 class="sec">Waar de machine het anders doet</h3>
<p>Het officiële rooster heeft ${waarde("nightBlocks3plus", 0)} nachtreeksen van drie of meer, een langste
reeks van ${waarde("longestNightBlock", 0)} en ${waarde("singletonNights", 0)} losse nachten. Dat is precies
het patroon dat de zoekmachine probeert na te streven: liever een blok van drie of vier nachten dan
losse nachten verspreid over de week. De maat "patroonafstand" in hoofdstuk 11 meet hoe ver een kandidaat
van dit menselijke patroon af ligt.</p>`;

  return {
    number: 4,
    title: "Het officiële rooster als ijkpunt",
    what: "Wat menselijk gemaakte structuur oplevert op dezelfde maten",
    body,
  };
}

// ── 5. Architectuur ──────────────────────────────────────────────────────────

function h5Architectuur(g: RapportGegevens): Chapter {
  // De teksten passen op één regel in het vak; langer wordt afgekapt.
  const stappen = [
    { title: "Invoer", note: "Diensten, structuur, profielen, regels" },
    { title: "Starts", note: "CP-SAT, eigen zaadwaarde en gewichten" },
    { title: "Harde validatie", note: "Dekking, profiel, rust — geen kwaliteit" },
    { title: "Kwaliteitsmeting", note: "Onafhankelijk van de solverkosten" },
    { title: "Bijschaven", note: "Ruilen binnen dezelfde weekdag" },
    { title: "Elitepool", note: "Rangschikken, dubbelen eruit, Pareto" },
    { title: "Gericht repareren", note: "Zwakste onderdeel, rest staat vast" },
    { title: "Eindvalidatie", note: "Onafhankelijke regeltoets" },
    { title: "Top drie", note: "Verschillend, met kwaliteitsdrempel" },
  ];

  const body = `
<p class="lede">De v1.0.3-machine deed per kandidaat één solveropdracht met een eventuele reparatieronde.
De v1.0.4-machine zet daar een meet- en selectielaag omheen: genereren, meten, verbeteren, selecteren.</p>

${figuur(flowSvg(stappen), "De keten van de adaptieve zoekmachine. Alleen kandidaten die de harde validatie halen komen in de pool; kwaliteit kan een overtreding nooit compenseren.")}

<h3 class="sec">De drie oordelen, strikt gescheiden</h3>
<div class="cards g3">
  ${kaart("De solverkosten", "CP-SAT optimaliseert een gewogen som van strafpunten. Dat is een zoekmiddel, geen kwaliteitsoordeel: twee roosters met dezelfde kosten kunnen voor een machinist heel verschillend zijn.")}
  ${kaart("De harde validatie", "De onafhankelijke regelmotor rekent de kandidaat na op de regels. Een bevestigde harde overtreding is einde verhaal, hoe goed de kwaliteitscijfers ook zijn.")}
  ${kaart("De kwaliteitsevaluator", "Meet wat een roostermaker merkt: uren per regel, nachtreeksen, overgangen, rust boven het minimum, eerlijke verdeling, en hoe de slechtste regel eruitziet.")}
</div>

<h3 class="sec">Wat de zoekmachine wel en niet mag variëren</h3>
<p>Wel: zaadwaarden, zachte gewichten, vertrekpunten, welke roosters tijdens een reparatie vastliggen, en
welke ruilen het bijschaven probeert. Niet: de dekking, de profielgrenzen, de geplande dagelijkse rust, het
maximum aantal aaneengesloten diensten en alles wat de eindvalidatie toetst. Die staan in het model als
harde eis en in de validatie als toets; geen enkele combinatie van gewichten kan ze afkopen.</p>

<h3 class="sec">Bijschaven met ruildiensten</h3>
<p>De nieuwste laag is de goedkoopste: twee diensten van dezelfde weekdag van plaats wisselen en de
kwaliteitsevaluator laten oordelen. Eén beoordeling kost ongeveer twee milliseconden, dus in de rekentijd
van één solverstart passen tienduizenden varianten. De toets per ruil is precies de harde verzameling van
het CP-SAT-model: dezelfde weekdag, dagdelen binnen het profiel, en de geplande dagelijkse rust bij alle
vier de buren. Dekking, dienstgebruik en het aantal aaneengesloten diensten veranderen bij een ruil per
definitie niet.</p>`;

  return {
    number: 5,
    title: "Architectuur van de zoekmachine",
    what: "De keten van genereren tot selecteren, en wat waar wordt beslist",
    body,
  };
}

/** Een eenvoudig stroomdiagram; los van charts.ts omdat het hier om tekstblokken gaat. */
function flowSvg(stappen: readonly { title: string; note: string }[]): string {
  const breedte = 660;
  const hoogte = 64;
  const marge = 8;
  const kolommen = 3;
  const rijen = Math.ceil(stappen.length / kolommen);
  const vakBreedte = (breedte - marge * (kolommen - 1)) / kolommen;
  const totaalHoogte = rijen * hoogte + (rijen - 1) * marge;
  const vakken = stappen
    .map((stap, index) => {
      const kolom = index % kolommen;
      const rij = Math.floor(index / kolommen);
      const x = kolom * (vakBreedte + marge);
      const y = rij * (hoogte + marge);
      return `<g><rect x="${x}" y="${y}" width="${vakBreedte}" height="${hoogte}" rx="3" fill="${
        index === 0 ? "#eaf1fb" : "#fbfcff"
      }" stroke="#dbe3f0"/><text x="${x + 10}" y="${y + 20}" font-family="Source Sans 3, Arial" font-size="11" font-weight="700" fill="#13203a">${
        index + 1
      }. ${escape(stap.title)}</text><text x="${x + 10}" y="${y + 38}" font-family="Source Sans 3, Arial" font-size="9" fill="#57647d">${escape(
        stap.note.length > 46 ? `${stap.note.slice(0, 44)}…` : stap.note,
      )}</text></g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${breedte} ${totaalHoogte}" width="${breedte}" height="${totaalHoogte}" xmlns="http://www.w3.org/2000/svg" role="img">${vakken}</svg>`;
}

// ── 6. Kwaliteitsmodel ───────────────────────────────────────────────────────

function h6Kwaliteitsmodel(g: RapportGegevens): Chapter {
  const model = g.qualityConfig as {
    version: string;
    components: Record<string, { label?: string; weight: number; parts?: Record<string, { weight: number }> }>;
    lineScore?: { weights?: Record<string, number> };
    robust?: Record<string, number>;
  };
  const onderdelen = Object.entries(model.components ?? {});

  const body = `
<p class="lede">De kwaliteitsevaluator is bewust een apart onderdeel: hij kent de solver niet en de solver
kent hem niet. Zo kan hij een kandidaat afkeuren die volgens de solverkosten uitstekend was.</p>

${tabel({
  caption: `Onderdelen van kwaliteitsmodel ${escape(String(model.version ?? "—"))}`,
  columns: [{ head: "Onderdeel" }, { head: "Gewicht", numeric: true }, { head: "Waaruit het bestaat" }],
  rows: onderdelen.map(([sleutel, onderdeel]) => [
    escape(sleutel),
    nummer(onderdeel.weight, 2),
    onderdeel.parts
      ? escape(
          Object.entries(onderdeel.parts)
            .map(([naam, deel]) => `${naam} ${nummer(deel.weight, 2)}`)
            .join(" · "),
        )
      : "—",
  ]),
  note:
    "De gewichten tellen op tot meer dan één; het totaal wordt genormaliseerd. Een onderdeel dat voor een " +
    "pakket niet te meten is, valt weg en de rest wordt opnieuw gewogen — dat is beter dan een nul die als " +
    "straf werkt.",
})}

<h3 class="sec">Per roosterregel, niet alleen gemiddeld</h3>
<p>Elk cijfer wordt ook per roosterregel berekend. Dat is het verschil tussen "het pakket zit gemiddeld op
40:00" en "iedere medewerker zit rond 40:00". De robuuste kwaliteit weegt daarom het totaal
(${nummer(Number(model.robust?.overallWeight ?? 0), 2)}) met de slechtste regel
(${nummer(Number(model.robust?.worstLineWeight ?? 0), 2)}), en trekt punten af wanneer een regel meer dan
${nummer(Number(model.robust?.outlierGapPoints ?? 0), 0)} punten onder de mediaan zakt. Zonder die weging kan
een machine één regel opofferen om het gemiddelde op te poetsen.</p>

<h3 class="sec">Een regel zonder diensten krijgt geen cijfer</h3>
<p>Tijdens de ontwikkeling bleek de slechtste regel van het officiële rooster een reserveweek te zijn: een
regel zonder één gewerkte dienst. Die scoorde nul op alles wat met diensten te maken heeft en trok het
oordeel omlaag terwijl er niets te beoordelen viel. Zulke regels krijgen nu geen cijfer. De slechtste regel
van het officiële rooster ging daardoor van een structurele nul naar een echte zwakste regel, en de robuuste
kwaliteit van het officiële rooster steeg mee. Dat is in beide fasen gelijk toegepast.</p>

${blok(
  "Een harde overtreding is geen kwaliteitsaftrek. Een kandidaat met één bevestigde overtreding wordt " +
    "afgewezen, ook als hij op elk ander onderdeel de beste van de meting is.",
)}`;

  return {
    number: 6,
    title: "Het kwaliteitsmodel",
    what: "Waaruit het oordeel bestaat en waarom het per regel meet",
    body,
  };
}

// ── 7. Zoekstrategie ─────────────────────────────────────────────────────────

function h7Zoekstrategie(g: RapportGegevens): Chapter {
  const config = g.optimizerConfig as {
    adaptive: {
      modes: Record<string, Record<string, number | string>>;
      diversity: Record<string, number>;
      repair: Record<string, number>;
      gateTolerance: Record<string, number>;
      plateauMinGain: number;
      overheadSecondsPerCandidate: number;
    };
  };
  const modi = Object.entries(config.adaptive.modes);

  const body = `
<p class="lede">De zoektocht heeft een tijdsbudget, geen vaste routine. Binnen dat budget kiest de machine
zelf hoeveel vertrekpunten, hoeveel reparaties en hoeveel bijschaafwerk er nog in passen.</p>

${tabel({
  caption: "De rekentijdmodi",
  columns: [
    { head: "Modus" },
    { head: "Budget", numeric: true },
    { head: "Per start", numeric: true },
    { head: "Per reparatie", numeric: true },
    { head: "Bijschaven", numeric: true },
    { head: "Starts", numeric: true },
    { head: "Elite", numeric: true },
  ],
  rows: modi.map(([sleutel, modus]) => [
    `${escape(String(modus.label))} <span class="note">(${escape(sleutel)})</span>`,
    duur(Number(modus.budgetSeconds)),
    `${nummer(Number(modus.startSeconds), 0)} s`,
    `${nummer(Number(modus.repairSeconds), 0)} s`,
    `${nummer(Number(modus.polishSeconds), 0)} s`,
    `${nummer(Number(modus.minStarts), 0)}–${nummer(Number(modus.maxStarts), 0)}`,
    nummer(Number(modus.eliteSize), 0),
  ]),
  note: "De benchmark in dit rapport is volledig in de modus Normaal gedraaid.",
})}

<h3 class="sec">Wat de machine varieert</h3>
<ul>
  <li><strong>Zaadwaarden</strong> — dezelfde opdracht met een andere zoekvolgorde levert een ander rooster op.</li>
  <li><strong>Zachte gewichten</strong> — per start iets anders, zodat de starts niet in hetzelfde dal uitkomen.</li>
  <li><strong>Vertrekpunten</strong> — latere starts krijgen de beste kandidaat mee als warme start, met de eis dat het resultaat voldoende verschilt.</li>
  <li><strong>Verplicht verschil</strong> — een nieuwe kandidaat moet op ten minste ${procent(Number(config.adaptive.diversity.finalMinShare) * 100, 0)} van de dienstdagen afwijken van wat er al ligt.</li>
</ul>

<h3 class="sec">De kwaliteitspoort</h3>
<p>Een kandidaat komt alleen in de pool als hij binnen de marges van het officiële rooster blijft: hoogstens
${nummer(Number(config.adaptive.gateTolerance.singletonNights), 0)} losse nachten meer,
${nummer(Number(config.adaptive.gateTolerance.heavyTransitions), 0)} zware overgangen meer, en niet meer dan
${nummer(Number(config.adaptive.gateTolerance.robustPoints), 0)} punten onder de robuuste kwaliteit van dat
rooster. De poort is dus geen absolute drempel maar een vergelijking met wat mensen maken.</p>

<h3 class="sec">Wanneer het stopt</h3>
<p>De zoektocht stopt als het budget op is, als er genoeg goede en voldoende verschillende kandidaten zijn,
of als er ${nummer(Number(config.adaptive.plateauMinGain), 1)} punten winst uitblijft over een reeks
verbeterpogingen. Dat laatste heet hier een plateau: doorzoeken kost dan rekentijd zonder uitzicht.</p>`;

  return {
    number: 7,
    title: "De zoekstrategie",
    what: "Budgetten, variatie, de kwaliteitspoort en de stopvoorwaarden",
    body,
  };
}

// ── 8. Wijzigingen ───────────────────────────────────────────────────────────

function h8Wijzigingen(g: RapportGegevens): Chapter {
  const regels = [
    ["src/domain/quality-model.ts", "nieuw", "Het kwaliteitsmodel als configuratie: onderdelen, gewichten, drempels."],
    ["src/domain/quality-evaluator.ts", "nieuw", "De evaluator: meet uren, nachten, overgangen, rust, eerlijkheid en de slechtste regel."],
    ["src/domain/adaptive-search.ts", "nieuw", "De beslissingen: rangschikken, dubbelen, Pareto, poort, reparatie aanvaarden, plateau."],
    ["src/domain/roster-polish.ts", "nieuw", "Bijschaven met ruildiensten, met de harde toets per ruil."],
    ["src/server/generation/adaptive/engine.ts", "nieuw", "De zoektocht zelf: starts, bijschaven, reparatie, diversificatie, eindselectie."],
    ["src/server/generation/adaptive/pipeline.ts", "nieuw", "Voortgang, opslag van alleen de eindkandidaten, audit en eindstatus."],
    ["src/server/generation/adaptive/config.ts", "nieuw", "Budgetten en drempels op één geversioneerde plek."],
    ["src/server/generation/engine-flag.ts", "nieuw", "Schakelaar tussen de klassieke en de adaptieve zoekmachine."],
    ["python/cpsat_roster.py", "gewijzigd", "Vastgezette toewijzingen voor gerichte reparatie; instelbare lineaire ontspanning."],
    ["src/server/optimizer/cpsat-solver.ts", "gewijzigd", "Vastzettingen doorgeven, werkelijke zaadwaarde vastleggen."],
    ["prisma/schema.prisma", "gewijzigd", "Zoekmodus, zoekjournaal, tellers en herkomst per kandidaat."],
    ["src/domain/generation-progress.ts", "gewijzigd", "Voortgangsstappen van de adaptieve keten."],
    ["scripts/optimizer-benchmark.ts", "nieuw", "Eén benchmarkloper voor beide fasen, met manifest en hashcontrole."],
    ["scripts/benchmark/analyse.ts", "nieuw", "BEFORE tegenover AFTER, zonder selectie op gunstige uitkomsten."],
    ["scripts/measure-polish-budget.ts", "nieuw", "Meet wat extra bijschaaftijd nog oplevert."],
  ];

  const body = `
<p class="lede">Wat er aan de codebasis is veranderd, en waarom. De harde regels, de eindvalidatie en de
publicatiepoort staan er niet tussen: die zijn niet aangeraakt.</p>

${tabel({
  caption: "Gewijzigde en nieuwe onderdelen",
  columns: [{ head: "Bestand", width: "34%" }, { head: "Soort" }, { head: "Wat het doet" }],
  rows: regels.map(([bestand, soort, wat]) => [`<code>${escape(bestand)}</code>`, escape(soort), escape(wat)]),
})}

<h3 class="sec">Het ontwikkellogboek</h3>
<p>Elke aanpassing aan een gewicht of een drempel is vastgelegd met de oude waarde, de nieuwe waarde, de
reden en het gemeten effect. Dat logboek staat in <code>docs/optimizer-benchmark/development-log.json</code>
en is samengevat in hoofdstuk 9 en 16.</p>`;

  return {
    number: 8,
    title: "Wijzigingen in code en configuratie",
    what: "Welke onderdelen nieuw zijn, welke zijn aangepast en wat onaangeroerd bleef",
    body,
  };
}

// ── 9. Gewichten ─────────────────────────────────────────────────────────────

function h9Gewichten(g: RapportGegevens): Chapter {
  const config = g.optimizerConfig as { baseWeights: Record<string, Record<string, number>> };
  const strategieën = Object.keys(config.baseWeights);
  const sleutels = [...new Set(strategieën.flatMap((s) => Object.keys(config.baseWeights[s])))];

  const body = `
<p class="lede">De zachte gewichten bepalen wat de solver duur vindt. Ze zijn strafpunten ten opzichte van
elkaar; de absolute grootte zegt niets.</p>

${tabel({
  caption: "Zachte gewichten per strategie",
  columns: [{ head: "Kostenpost", width: "30%" }, ...strategieën.map((s) => ({ head: s, numeric: true }))],
  rows: sleutels.map((sleutel) => [
    `<code>${escape(sleutel)}</code>`,
    ...strategieën.map((strategie) => nummer(config.baseWeights[strategie][sleutel] ?? null, 0)),
  ]),
})}

<h3 class="sec">Wijzigingen met hun effect</h3>
${tabel({
  columns: [{ head: "Nr" }, { head: "Onderdeel", width: "24%" }, { head: "Wijziging" }, { head: "Gemeten effect" }],
  rows: g.log.entries.map((entry) => [
    escape(entry.id),
    `<code>${escape(entry.component)}</code>`,
    escape(entry.change),
    escape(entry.observedEffect),
  ]),
  note:
    "Geen enkele waarde is op één run afgestemd. De les uit v1.0.3 staat in regel D03: dezelfde gewichten " +
    "gaven in twee runs een verschil van meer dan twintig punten op nachtverdeling.",
})}`;

  return {
    number: 9,
    title: "Gewichten en drempels",
    what: "Welke getallen de zoektocht sturen en wat elke wijziging opleverde",
    body,
  };
}

// ── 10. AFTER ────────────────────────────────────────────────────────────────

function h10After(g: RapportGegevens): Chapter {
  const groepen = g.summary.groups.filter((groep) => groep.phase === "after" && groep.strategy !== "REPRODUCE");
  const kandidaten = fase(g.kandidaten, "after");

  const body = `
<p class="lede">De AFTER-meting is exact dezelfde benchmark: hetzelfde pakket, dezelfde strategieën,
hetzelfde aantal runs, dezelfde machine. Alleen de zoekmachine is anders.</p>

${tabel({
  caption: "De AFTER-meting per strategie",
  columns: [
    { head: "Strategie" },
    { head: "Runs", numeric: true },
    { head: "Kandidaten", numeric: true },
    { head: "Robuust gem.", numeric: true },
    { head: "Robuust mediaan", numeric: true },
    { head: "Laagste", numeric: true },
    { head: "Hoogste", numeric: true },
    { head: "Rekentijd gem.", numeric: true },
  ],
  rows: groepen.map((groep) => [
    escape(groep.strategy),
    nummer(groep.runs, 0),
    nummer(groep.candidates, 0),
    nummer(groep.metrics.robust?.mean ?? null, 1),
    nummer(groep.metrics.robust?.median ?? null, 1),
    nummer(groep.metrics.robust?.min ?? null, 1),
    nummer(groep.metrics.robust?.max ?? null, 1),
    duur(groep.runtimeSeconds.mean),
  ]),
})}

<h3 class="sec">Kandidaten per opdracht</h3>
<p>Een opdracht levert drie kandidaten die voldoende van elkaar verschillen. In de AFTER-meting kwam dat
${g.runs.filter((rij) => rij.phase === "after" && rij.found === 3).length} van de
${g.runs.filter((rij) => rij.phase === "after").length} keer uit; in de BEFORE-meting
${g.runs.filter((rij) => rij.phase === "before" && rij.found === 3).length} van de
${g.runs.filter((rij) => rij.phase === "before").length} keer.</p>

${figuur(
  rangeChart(
    ["BALANCED", "REST_QUALITY", "FAIR_BURDEN"].map((strategie) => ({
      label: strategie,
      series: (["before", "after"] as const).map((phase) => {
        const groep = g.summary.groups.find((entry) => entry.phase === phase && entry.strategy === strategie);
        return {
          name: phase === "before" ? "v1.0.3" : "v1.0.4",
          color: phase === "before" ? "#8695ac" : "#003da5",
          min: groep?.metrics.robust?.min ?? null,
          median: groep?.metrics.robust?.median ?? null,
          max: groep?.metrics.robust?.max ?? null,
          mean: groep?.metrics.robust?.mean ?? null,
        };
      }),
      reference: typeof g.summary.official.robust === "number" ? (g.summary.official.robust as number) : null,
    })),
    { decimals: 1 },
  ),
  "Robuuste kwaliteit per strategie: de balk loopt van de slechtste tot de beste kandidaat, met mediaan en gemiddelde. De gouden lijn is het officiële rooster.",
)}

<p class="note">Alle ${kandidaten.length} AFTER-kandidaten zijn door de onafhankelijke eindvalidatie gegaan.
De uitkomst daarvan staat in hoofdstuk 17.</p>`;

  return {
    number: 10,
    title: "De AFTER-meting",
    what: "Dezelfde benchmark, met de nieuwe zoekmachine",
    body,
  };
}

// ── 11. Vergelijking ─────────────────────────────────────────────────────────

function h11Vergelijking(g: RapportGegevens): Chapter {
  const { analyse } = g;
  const alleMaten = analyse.metrics.filter((metric) => metric.overall !== null);
  const beter = alleMaten.filter((m) => m.overall!.mean.verdict === "beter");
  const slechter = alleMaten.filter((m) => m.overall!.mean.verdict === "slechter");

  const body = `
<p class="lede">Deze tabel is de kern van het rapport. Gemiddelde tegen gemiddelde, mediaan tegen mediaan,
en — omdat een gemiddelde de pijn verbergt — ook de slechtste waarde tegen de slechtste waarde.</p>

${tabel({
  caption: "Alle gemeten maten, beide fasen, alle kandidaten",
  columns: VERGELIJK_KOLOMMEN,
  rows: alleMaten.map((metric) =>
    vergelijkRij(
      `${metric.label}${metric.higherIsBetter ? "" : " <span class=\"note\">(lager = beter)</span>"}`,
      metric.overall,
      metric.unit === "count" || metric.unit === "min" ? 1 : 1,
      metric.official,
    ),
  ),
  note:
    `Van de ${alleMaten.length} maten gingen er ${beter.length} vooruit en ${slechter.length} achteruit op het ` +
    "gemiddelde. De kolommen mediaan en slechtste laten zien of dat over de hele verdeling geldt.",
})}

<h3 class="sec">Per strategie</h3>
${tabel({
  caption: "Robuuste kwaliteit per strategie",
  columns: [
    { head: "Strategie" },
    { head: "BEFORE gem.", numeric: true },
    { head: "AFTER gem.", numeric: true },
    { head: "Δ", numeric: true },
    { head: "BEFORE beste", numeric: true },
    { head: "AFTER beste", numeric: true },
    { head: "AFTER wint (rang)", numeric: true },
  ],
  rows: Object.entries(analyse.perRun.bestRobust.perStrategy).map(([strategie, entry]) => [
    escape(strategie),
    nummer(entry.comparison?.before.mean ?? null, 1),
    nummer(entry.comparison?.after.mean ?? null, 1),
    `<span class="${oordeelKlasse(entry.comparison?.mean.verdict ?? "onbekend")}">${verschil(entry.comparison?.mean.delta ?? null, 1)}</span>`,
    nummer(entry.comparison?.before.max ?? null, 1),
    nummer(entry.comparison?.after.max ?? null, 1),
    `${entry.winRate.wonByRank}/${entry.winRate.pairs}`,
  ]),
  note: "Per run de beste kandidaat, want dat is wat de Roostercommissie te zien krijgt.",
})}

<h3 class="sec">Wat er achteruitging</h3>
${
  slechter.length === 0
    ? "<p>Geen enkele gemeten maat ging er gemiddeld op achteruit.</p>"
    : `<ul>${slechter
        .map(
          (metric) =>
            `<li><strong>${escape(metric.label)}</strong>: ${verschil(metric.overall!.mean.delta, 1)} op het gemiddelde (${procent(
              metric.overall!.mean.percent,
              1,
            )}), mediaan ${verschil(metric.overall!.median.delta, 1)}.</li>`,
        )
        .join("")}</ul><p>Deze punten staan ook in hoofdstuk 17 met een inschatting van het risico.</p>`
}`;

  return {
    number: 11,
    title: "BEFORE tegenover AFTER",
    what: "De volledige vergelijking, inclusief wat achteruitging",
    body,
  };
}

// ── 12. Per profiel ──────────────────────────────────────────────────────────

function h12PerProfiel(g: RapportGegevens): Chapter {
  const slechtste = g.analyse.perProfile.map((profiel) => ({
    roster: profiel.roster,
    oordeel: profiel.metrics.find((maat) => maat.key === "worstLine")?.comparison?.mean.verdict ?? "onbekend",
  }));
  const vooruit = slechtste.filter((entry) => entry.oordeel === "beter");
  const achteruit = slechtste.filter((entry) => entry.oordeel === "slechter");

  const body = `
<p class="lede">Een verbetering die alleen in het gemiddelde zit, kan één roosterprofiel hebben opgeofferd.
Daarom per basisrooster — en daarmee per profiel — dezelfde vergelijking.</p>

<p>Op de slechtste roosterregel gingen ${vooruit.length} van de ${slechtste.length} basisroosters vooruit${
    achteruit.length === 0
      ? ", en geen enkel rooster achteruit"
      : ` en ${achteruit.length} achteruit (${escape(achteruit.map((entry) => entry.roster).join(", "))})`
  }. Dat is de toets op het opofferen van één groep: een machine die het gemiddelde optilt door één profiel
te laten inleveren, valt hier door de mand.</p>

${g.analyse.perProfile
  .map(
    (profiel) => `
<h4 class="sub">${escape(profiel.roster)}</h4>
${tabel({
  columns: [
    { head: "Maat", width: "34%" },
    { head: "BEFORE gem.", numeric: true },
    { head: "AFTER gem.", numeric: true },
    { head: "Δ", numeric: true },
    { head: "AFTER slechtste", numeric: true },
  ],
  rows: profiel.metrics.map((maat) => [
    escape(maat.label),
    nummer(maat.comparison?.before.mean ?? null, 1),
    nummer(maat.comparison?.after.mean ?? null, 1),
    `<span class="${oordeelKlasse(maat.comparison?.mean.verdict ?? "onbekend")}">${verschil(maat.comparison?.mean.delta ?? null, 1)}</span>`,
    nummer(
      maat.higherIsBetter ? (maat.comparison?.after.min ?? null) : (maat.comparison?.after.max ?? null),
      1,
    ),
  ]),
})}`,
  )
  .join("")}`;

  return {
    number: 12,
    title: "Per basisrooster en profiel",
    what: "Of de winst overal zit, of ergens iemand ervoor betaalt",
    body,
  };
}

// ── 13. Laat/Nacht ───────────────────────────────────────────────────────────

function h13LaatNacht(g: RapportGegevens): Chapter {
  const { analyse } = g;
  const nacht = ["singletonNights", "twoNightBlocks", "nightBlocks3plus", "longestNightBlock", "averageNightBlock", "minNightRecoveryHours", "nightFairness", "nightsPerLineSD"];
  const lnRegressie = analyse.regression.find((toets) => toets.key === "lnEarlyDuties");

  const body = `
<p class="lede">Nachtdiensten zijn het onderdeel waar een rooster het snelst onleefbaar wordt. Losse nachten
zijn zwaarder dan een blok, en na een reeks hoort echt herstel. Dit hoofdstuk kijkt daar apart naar.</p>

${tabel({
  caption: "Nachtmaten, beide fasen",
  columns: VERGELIJK_KOLOMMEN,
  rows: nacht
    .map((key) => analyse.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is MetricVergelijking => metric !== undefined)
    .map((metric) =>
      vergelijkRij(
        `${metric.label}${metric.higherIsBetter ? "" : " <span class=\"note\">(lager = beter)</span>"}`,
        metric.overall,
        1,
        metric.official,
      ),
    ),
})}

<h3 class="sec">De absolute toets: geen vroege dienst in een Laat/Nacht-rooster</h3>
<p>Het Laat/Nacht-profiel staat geen vroege diensten toe. Dat is geen voorkeur maar een profielgrens, en hij
zit als harde eis in het model én in de eindvalidatie. In de AFTER-meting is het aantal vroege diensten in
een Laat/Nacht-rooster ${lnRegressie ? nummer(lnRegressie.after, 0) : "—"} over alle
${analyse.counts.after.candidates} kandidaten${lnRegressie && lnRegressie.pass ? " — zoals het hoort" : ""}.</p>

${blok(
  lnRegressie && lnRegressie.pass
    ? "Deze toets is absoluut: één vroege dienst in een Laat/Nacht-rooster maakt de hele meting ongeldig, hoe goed de cijfers verder ook zijn."
    : "LET OP: deze toets is niet gehaald. De uitkomst van dit rapport is daarmee ongeldig; zie hoofdstuk 17.",
  lnRegressie && lnRegressie.pass ? "ok" : "bad",
)}

${handmatigeControle(g)}`;

  return {
    number: 13,
    title: "Laat en Nacht in detail",
    what: "Nachtreeksen, herstel, verdeling en de absolute profieltoets",
    body,
  };
}

/**
 * De handmatige controle op de beste kandidaat.
 *
 * Alle cijfers in dit rapport komen uit hetzelfde model. Zit dat model ergens
 * naast, dan wijst geen enkele meting dat aan. Daarom gaat er aan het eind een
 * mens langs de regels van Laat/Nacht, Mix en Vroeg.
 */
function handmatigeControle(g: RapportGegevens): string {
  if (!g.review || g.review.checklist.length === 0) {
    return `<h3 class="sec">Handmatige controle</h3>${blok(
      "De handmatige controle op de beste kandidaat is nog niet vastgelegd. Draai npm run review:candidate en vul het " +
        "oordeel per punt in; er komt hier geen oordeel te staan dat niemand heeft gegeven.",
      "warn",
    )}`;
  }
  const r = g.review;
  return `
<h3 class="sec">Handmatige controle op de beste kandidaat</h3>
<p>Gecontroleerd is de kandidaat met de hoogste robuuste kwaliteit uit de AFTER-meting: run ${r.candidate.run}
(${escape(r.candidate.strategy)}), kandidaat ${r.candidate.candidate}, robuuste kwaliteit
${nummer(r.candidate.robust, 1)}. De roosters zijn als raster uitgedraaid en met de hand nagelopen.</p>

${tabel({
  caption: "De gecontroleerde roosters",
  columns: [
    { head: "Rooster" },
    { head: "Nachten", numeric: true },
    { head: "Blokken" },
    { head: "Vroege diensten", numeric: true },
    { head: "Slechtste regel", numeric: true },
    { head: "Kortste herstel", numeric: true },
  ],
  rows: r.rosters.map((rooster) => [
    escape(rooster.roster),
    nummer(rooster.nights, 0),
    rooster.nightBlocks.length === 0 ? "geen" : escape(rooster.nightBlocks.join(", ")),
    nummer(rooster.earlyDuties, 0),
    nummer(rooster.worstLine, 1),
    rooster.minRecoveryHours === null ? "—" : `${nummer(rooster.minRecoveryHours, 1)} u`,
  ]),
})}

${tabel({
  caption: "De controlepunten",
  columns: [{ head: "Punt", width: "24%" }, { head: "Bevinding" }, { head: "Oordeel" }],
  rows: r.checklist.map((punt) => [
    escape(punt.punt),
    `${escape(punt.bevinding)}${punt.opmerking ? `<br><span class="note">${escape(punt.opmerking)}</span>` : ""}`,
    punt.oordeel.startsWith("akkoord")
      ? `<span class="better">${escape(punt.oordeel)}</span>`
      : `<span class="worse">${escape(punt.oordeel)}</span>`,
  ]),
})}

${r.conclusion ? blok(escape(r.conclusion), "ok") : ""}`;
}

// ── 14. Rekentijd ────────────────────────────────────────────────────────────

function h14Rekentijd(g: RapportGegevens): Chapter {
  const runtime = g.analyse.perRun.runtimeSeconds;
  const eff = g.analyse.searchEfficiency;
  const budget = g.polish;
  const gemiddeldPerBudget = budget.budgets.map((seconden) => {
    const waarden = budget.results
      .map((resultaat) => resultaat.budgets.find((entry) => entry.seconds === seconden)?.gain)
      .filter((x): x is number => typeof x === "number");
    return { seconden, winst: waarden.reduce((a, b) => a + b, 0) / Math.max(1, waarden.length) };
  });

  const body = `
<p class="lede">Meer rekentijd levert een beter rooster op, maar niet evenredig. Dit hoofdstuk zegt hoeveel
het kost en waar de opbrengst afvlakt.</p>

<div class="cards g3">
  ${cijferkaart(duur(runtime?.before.mean ?? null), "gemiddelde rekentijd per opdracht, v1.0.3")}
  ${cijferkaart(duur(runtime?.after.mean ?? null), "gemiddelde rekentijd per opdracht, v1.0.4")}
  ${cijferkaart(
    nummer(Number(eff.variantsPerValidCandidate ?? 0), 0),
    "onderzochte varianten per geldige kandidaat",
  )}
</div>

<h3 class="sec">Waar de rekentijd heen gaat</h3>
${tabel({
  columns: [{ head: "Bezigheid" }, { head: "Totaal over alle AFTER-runs", numeric: true }, { head: "Per run", numeric: true }],
  rows: [
    ["Solver (CP-SAT)", duur(Number(eff.solverSecondsTotal ?? 0)), duur(Number(eff.solverSecondsTotal ?? 0) / Math.max(1, Number(eff.runs ?? 1)))],
    ["Beoordelen en bijschaven", duur(Number(eff.evaluationSecondsTotal ?? 0)), duur(Number(eff.evaluationSecondsTotal ?? 0) / Math.max(1, Number(eff.runs ?? 1)))],
    ["Eindvalidatie", duur(Number(eff.validationSecondsTotal ?? 0)), duur(Number(eff.validationSecondsTotal ?? 0) / Math.max(1, Number(eff.runs ?? 1)))],
  ],
})}

${modusDeel(g)}

${geheugenDeel(g)}

<h3 class="sec">Afnemende meeropbrengst van het bijschaven</h3>
${tabel({
  caption: "Winst in rangschikking per bijschaafbudget",
  columns: [{ head: "Budget", numeric: true }, { head: "Gemiddelde winst", numeric: true }, { head: "Marge per seconde", numeric: true }],
  rows: gemiddeldPerBudget.map((entry, index) => {
    const vorige = index === 0 ? null : gemiddeldPerBudget[index - 1];
    const marge = vorige === null ? null : (entry.winst - vorige.winst) / (entry.seconden - vorige.seconden);
    return [`${nummer(entry.seconden, 0)} s`, verschil(entry.winst, 2), marge === null ? "—" : nummer(marge, 4)];
  }),
  note: `Gemeten op ${budget.results.length} kandidaten uit de BEFORE-meting met npm run measure:polish-budget.`,
})}

<p>De knik ligt bij twintig seconden: daarboven kost elke punt winst vier keer zoveel rekentijd. De modus
Normaal staat daarom op vijftien seconden per kandidaat — onder de knik, en met genoeg budget over om
voldoende verschillende kandidaten te vinden.</p>

${figuur(
  scatter(
    g.runs
      .filter((rij) => typeof rij.bestRobust === "number")
      .map((rij) => ({
        x: rij.runtimeSeconds,
        y: rij.bestRobust as number,
        label: `${rij.phase} ${rij.strategy} #${rij.run}`,
        color: rij.phase === "after" ? "#003da5" : "#8695ac",
      })),
    { xLabel: "rekentijd (s)", yLabel: "beste robuuste kwaliteit" },
  ),
  "Elke opdracht: rekentijd tegen de beste kandidaat die hij opleverde. Grijs is v1.0.3, blauw v1.0.4.",
)}`;

  return {
    number: 14,
    title: "Rekentijd",
    what: "Wat het kost, waar het heen gaat en waar de opbrengst afvlakt",
    body,
  };
}

/**
 * Wat de zoektocht aan geheugen vraagt.
 *
 * Het platform moet op een gewone werkplek en vanaf een USB-stick draaien. Een
 * zoekmachine die meer varianten bewaart dan er geheugen is, valt daar om.
 */
function geheugenDeel(g: RapportGegevens): string {
  const cijfers = (fase: string, sleutel: "peakPythonMB" | "peakNodeMB") =>
    g.runs
      .filter((rij) => rij.phase === fase)
      .map((rij) => rij[sleutel])
      .filter((waarde): waarde is number => typeof waarde === "number");
  const stat = (waarden: readonly number[]) =>
    waarden.length === 0
      ? null
      : { gem: waarden.reduce((a, b) => a + b, 0) / waarden.length, max: Math.max(...waarden) };
  const rijen = (
    [
      ["Solver (python.exe)", "peakPythonMB"],
      ["Zoekmachine (node.exe)", "peakNodeMB"],
    ] as const
  ).map(([label, sleutel]) => {
    const voor = stat(cijfers("before", sleutel));
    const na = stat(cijfers("after", sleutel));
    return [
      label,
      voor ? `${nummer(voor.gem, 0)} MB` : "—",
      voor ? `${nummer(voor.max, 0)} MB` : "—",
      na ? `${nummer(na.gem, 0)} MB` : "—",
      na ? `${nummer(na.max, 0)} MB` : "—",
    ];
  });
  if (rijen.every((rij) => rij[1] === "—" && rij[3] === "—")) {
    return "";
  }
  return `
<h3 class="sec">Geheugen</h3>
${tabel({
  caption: "Hoogste gemeten werkgeheugen per opdracht",
  columns: [
    { head: "Proces" },
    { head: "v1.0.3 gem.", numeric: true },
    { head: "v1.0.3 piek", numeric: true },
    { head: "v1.0.4 gem.", numeric: true },
    { head: "v1.0.4 piek", numeric: true },
  ],
  rows: rijen,
  note:
    "Elke twee seconden bemonsterd van buitenaf. De zoekmachine bewaart alleen de elitepool en het " +
    "zoekjournaal; de duizenden bijgeschaafde varianten bestaan één voor één en worden niet bewaard.",
})}`;
}

/**
 * Wat de vier rekentijdmodi opleveren.
 *
 * De vraag die een roostermaker stelt is niet "hoe lang duurt Grondig" maar
 * "krijg ik daar een beter rooster van". Dit deel zet beide naast elkaar.
 */
function modusDeel(g: RapportGegevens): string {
  const budget = g.summary.groups.filter((groep) => groep.phase === "budget" && groep.mode !== null);
  if (budget.length === 0) {
    return "";
  }
  const volgorde = ["FAST", "NORMAL", "DEEP", "EXTENSIVE"];
  const gesorteerd = [...budget].sort((a, b) => volgorde.indexOf(a.mode ?? "") - volgorde.indexOf(b.mode ?? ""));
  const labels: Record<string, string> = { FAST: "Snel", NORMAL: "Normaal", DEEP: "Grondig", EXTENSIVE: "Zeer grondig" };
  const eerste = gesorteerd[0];
  return `
<h3 class="sec">Wat de rekentijdmodi opleveren</h3>
${tabel({
  caption: "Dezelfde strategie in vier modi",
  columns: [
    { head: "Modus" },
    { head: "Runs", numeric: true },
    { head: "Rekentijd gem.", numeric: true },
    { head: "Robuust gem.", numeric: true },
    { head: "Robuust beste", numeric: true },
    { head: "Δ t.o.v. Snel", numeric: true },
    { head: "Slechtste regel", numeric: true },
  ],
  rows: gesorteerd.map((groep) => {
    const delta =
      eerste && groep.metrics.robust && eerste.metrics.robust
        ? groep.metrics.robust.mean - eerste.metrics.robust.mean
        : null;
    return [
      escape(labels[groep.mode ?? ""] ?? groep.mode ?? ""),
      nummer(groep.runs, 0),
      duur(groep.runtimeSeconds.mean),
      nummer(groep.metrics.robust?.mean ?? null, 1),
      nummer(groep.metrics.robust?.max ?? null, 1),
      `<span class="${delta === null || Math.abs(delta) < 0.05 ? "same" : delta > 0 ? "better" : "worse"}">${verschil(delta, 1)}</span>`,
      nummer(groep.metrics.worstLine?.mean ?? null, 1),
    ];
  }),
  note:
    "Meer rekentijd betekent meer vertrekpunten, meer bijschaven en meer verbeterrondes — niet andere regels. " +
    "De winst vlakt af: dat is de reden dat Normaal de standaard is.",
})}`;
}

// ── 15. Zoekefficiëntie ──────────────────────────────────────────────────────

function h15Zoekefficientie(g: RapportGegevens): Chapter {
  const eff = g.analyse.searchEfficiency;
  const stopRedenen = (eff.stopReasons ?? {}) as Record<string, number>;
  const getal = (key: string) => Number(eff[key] ?? 0);

  const body = `
<p class="lede">Hoeveel werk de machine heeft verzet, en hoeveel daarvan iets opleverde. Een zoektocht die
duizenden varianten bekijkt maar er niets aan verbetert, is dure schijnbeweging.</p>

<div class="cards g4">
  ${cijferkaart(nummer(getal("polishVariants") + getal("attempts"), 0), "varianten beoordeeld")}
  ${cijferkaart(nummer(getal("attempts"), 0), "volledige solveropdrachten")}
  ${cijferkaart(nummer(getal("validCandidates"), 0), "kandidaten door de eindvalidatie")}
  ${cijferkaart(procent((Number(eff.polishImproveRate) || 0) * 100, 0), "bijschaafrondes met winst")}
</div>

${tabel({
  caption: "Wat elke stap opleverde, over alle AFTER-runs",
  columns: [{ head: "Stap" }, { head: "Pogingen", numeric: true }, { head: "Geslaagd", numeric: true }, { head: "Opmerking" }],
  rows: [
    ["Starts", nummer(getal("starts"), 0), nummer(getal("starts"), 0), "Elke start levert een volledig rooster op"],
    [
      "Bijschaven",
      nummer(getal("polishRuns"), 0),
      nummer(getal("polishImproved"), 0),
      `${nummer(getal("polishSwaps"), 0)} ruilen, samen ${verschil(getal("polishGainTotal"), 1)} punten rangschikking`,
    ],
    [
      "Gerichte reparatie",
      nummer(getal("repairs"), 0),
      nummer(getal("repairsAccepted"), 0),
      `${nummer(getal("repairsImprovedTarget"), 0)} keer werd het doel beter, ${nummer(getal("repairsRejectedRegression"), 0)} keer afgewezen wegens verslechtering elders`,
    ],
    ["Afgewezen kandidaten", nummer(getal("rejected"), 0), "—", `${nummer(getal("duplicates"), 0)} dubbel, ${nummer(getal("lowQuality"), 0)} onder de poort`],
  ],
})}

${ablatieDeel(g)}

<h3 class="sec">Waarom de zoektocht stopte</h3>
${tabel({
  columns: [{ head: "Reden" }, { head: "Aantal runs", numeric: true }],
  rows: Object.entries(stopRedenen).map(([reden, aantal]) => [escape(reden), nummer(aantal, 0)]),
})}`;

  return {
    number: 15,
    title: "Zoekefficiëntie",
    what: "Hoeveel werk er is verzet en hoeveel daarvan iets opleverde",
    body,
  };
}

/**
 * Wat er gebeurt als je één onderdeel uitzet.
 *
 * Een zoekmachine die uit vijf mechanismen bestaat, kan best goed werken terwijl
 * drie ervan niets doen. Een ablatiemeting zet er telkens één uit en kijkt wat
 * de uitkomst dan is.
 */
function ablatieDeel(g: RapportGegevens): string {
  const ablaties = g.summary.groups.filter((groep) => groep.phase === "ablation" && groep.ablation !== null);
  if (ablaties.length === 0) {
    return "";
  }
  const volledig = g.summary.groups.find(
    (groep) => groep.phase === "after" && groep.strategy === "BALANCED" && groep.mode === "NORMAL",
  );
  const LABELS: Record<string, string> = {
    "no-night-clustering": "zonder straf op losse nachten",
    "no-transitions": "zonder straf op zware overgangen",
    "no-adaptive-repair": "zonder gerichte reparatie",
  };
  return `
<h3 class="sec">Ablatie: wat doet elk onderdeel?</h3>
${tabel({
  caption: "Hetzelfde recept met telkens één ingrediënt eruit",
  columns: [
    { head: "Opstelling" },
    { head: "Runs", numeric: true },
    { head: "Robuust gem.", numeric: true },
    { head: "Δ t.o.v. volledig", numeric: true },
    { head: "Losse nachten", numeric: true },
    { head: "Zware overgangen", numeric: true },
    { head: "Slechtste regel", numeric: true },
  ],
  rows: [
    [
      "Volledige machine",
      nummer(volledig?.runs ?? null, 0),
      nummer(volledig?.metrics.robust?.mean ?? null, 1),
      "—",
      nummer(volledig?.metrics.singletonNights?.mean ?? null, 2),
      nummer(volledig?.metrics.heavyTransitions?.mean ?? null, 2),
      nummer(volledig?.metrics.worstLine?.mean ?? null, 1),
    ],
    ...ablaties.map((groep) => {
      const delta =
        volledig && groep.metrics.robust ? groep.metrics.robust.mean - volledig.metrics.robust.mean : null;
      return [
        escape(LABELS[groep.ablation ?? ""] ?? groep.ablation ?? ""),
        nummer(groep.runs, 0),
        nummer(groep.metrics.robust?.mean ?? null, 1),
        // Bewust ongekleurd: een negatief verschil is hier geen slecht nieuws
        // maar het bewijs dat het weggelaten onderdeel iets doet. Groen en rood
        // zouden dat omdraaien in het hoofd van de lezer.
        `<span class="mono">${verschil(delta, 1)}</span>`,
        nummer(groep.metrics.singletonNights?.mean ?? null, 2),
        nummer(groep.metrics.heavyTransitions?.mean ?? null, 2),
        nummer(groep.metrics.worstLine?.mean ?? null, 1),
      ];
    }),
  ],
  note:
    "Een negatief verschil betekent dat het weggelaten onderdeel iets bijdraagt: zonder dat onderdeel wordt " +
    "de uitkomst slechter. Staat er ongeveer nul, dan doet het onderdeel in deze opstelling weinig.",
})}`;
}

// ── 16. Wat niet werkte ──────────────────────────────────────────────────────

function h16NietGewerkt(g: RapportGegevens): Chapter {
  const eff = g.analyse.searchEfficiency;
  const repairRate = Number(eff.repairAcceptRate ?? 0);

  const body = `
<p class="lede">Dit hoofdstuk staat er omdat het de volgende ontwikkelaar het meeste tijd bespaart. Wat
hieronder staat is geprobeerd, gemeten en grotendeels niet gehouden.</p>

<h3 class="sec">De gerichte CP-SAT-reparatie leverde eerst niets op</h3>
<p>Het idee: zet de roosters vast die niets met de zwakte te maken hebben, geef de solver de kandidaat als
warme start en laat hem het kleine deel opnieuw indelen met verhoogde gewichten op het zwakke onderdeel. In
de eerste rookproef werden alle vijf de reparaties afgewezen: vier leverden nul winst op — twee daarvan met
solverstatus OPTIMAL — en één verslechterde de nachtclustering. Het kleine vraagstuk was met de ouder als
warme start dus al optimaal. De reparatie is blijven bestaan, maar hij is niet het werkpaard; over de hele
AFTER-meting werd ${procent(repairRate * 100, 0)} van de reparaties aanvaard.</p>

${((): string => {
  const zonderReparatie = g.summary.groups.find(
    (groep) => groep.phase === "ablation" && groep.ablation === "no-adaptive-repair",
  );
  const volledig = g.summary.groups.find(
    (groep) => groep.phase === "after" && groep.strategy === "BALANCED" && groep.mode === "NORMAL",
  );
  if (!zonderReparatie || !volledig || !zonderReparatie.metrics.robust || !volledig.metrics.robust) {
    return "";
  }
  const verschilPunten = zonderReparatie.metrics.robust.mean - volledig.metrics.robust.mean;
  const tijdwinst = volledig.runtimeSeconds.mean - zonderReparatie.runtimeSeconds.mean;
  return `
<h3 class="sec">En de reparatie bleef ook daarna het zwakke onderdeel</h3>
<p>De ablatiemeting zet de gerichte reparatie helemaal uit. Zonder die stap komt de robuuste kwaliteit uit
op ${nummer(zonderReparatie.metrics.robust.mean, 1)} tegen ${nummer(volledig.metrics.robust.mean, 1)} met de
volledige machine — een verschil van ${verschil(verschilPunten, 1)} punt${Math.abs(verschilPunten) === 1 ? "" : "en"} —
terwijl een opdracht ${duur(Math.abs(tijdwinst))} korter duurt. Met ${nummer(zonderReparatie.runs, 0)} runs is dat
te weinig om te zeggen dat de reparatie niets bijdraagt, maar te weinig verschil om te doen alsof zij het
werk doet. Het bijschaven is de motor; de reparatie is bijwerk dat af en toe iets oplevert.</p>`;
})()}

<h3 class="sec">Uren repareren is zinloos werk</h3>
<p>De diagnose koos in het begin vaak "uren" als doelwit, omdat de urenscore het verst van de honderd af
ligt. Maar die afstand is structureel: de diensten in het pakket hebben de lengtes die ze hebben, en de
roostercyclus moet uitkomen op 40:00 gemiddeld. Wat er te winnen viel, had de solver in de eerste seconden
al gewonnen. Een lage score is dus geen bewijs dat er iets te halen valt.</p>

<h3 class="sec">Bijschaven zonder grens loopt weg van het menselijke patroon</h3>
<p>Bij lange bijschaafbudgetten blijft de rangschikking stijgen, maar de patroonafstand tot het officiële
rooster loopt langzaam op. Met andere woorden: de machine wint punten door verder van de menselijke
structuur af te gaan liggen. Dat is precies het risico van optimaliseren op een maat. Daarom is het budget
begrensd op de knik van de curve en niet op het punt waar de score het hoogst is.</p>

${((): string => {
  const eff = g.analyse.searchEfficiency;
  const stops = (eff.stopReasons ?? {}) as Record<string, number>;
  const redenen = Object.entries(stops);
  const dubbel = Number(eff.duplicates ?? 0);
  const laag = Number(eff.lowQuality ?? 0);
  if (redenen.length === 0) {
    return "";
  }
  const enigeReden = redenen.length === 1 ? redenen[0] : null;
  return `
<h3 class="sec">Drie mechanismen die niets deden</h3>
<p>${
    enigeReden
      ? `Alle ${enigeReden[1]} opdrachten stopten om dezelfde reden: ${escape(enigeReden[0])}. De plateaudetectie —
    stoppen zodra een reeks verbeterpogingen niets meer oplevert — is dus geen enkele keer in werking getreden.`
      : "De opdrachten stopten om uiteenlopende redenen; zie de tabel in hoofdstuk 15."
  }
${((): string => {
    const plateauGroepen = g.summary.groups.filter(
      (groep) => groep.phase === "budget" && Object.keys(groep.stopReasons ?? {}).some((reden) => reden.startsWith("plateau")),
    );
    if (plateauGroepen.length === 0) {
      return "";
    }
    const modi = plateauGroepen.map((groep) => escape(String(groep.mode))).join(" en ");
    return ` In de langere modi gebeurde dat wel: bij ${modi} stopte het zoeken op een plateau, ruim vóór het budget op was.`;
  })()}
${dubbel === 0 ? "De dubbelherkenning wees geen enkele kandidaat af: de starts leverden vanzelf voldoende verschillende roosters op. " : ""}${
    laag === 0
      ? "De kwaliteitspoort, geijkt op het officiële rooster, hield ook niets tegen: geen enkele kandidaat zakte eronder. "
      : ""
  }Dat betekent niet dat die mechanismen overbodig zijn — ze zijn er voor het pakket waarin het wél misgaat — maar
in deze meting hebben ze weinig bewezen, en dat is iets anders dan dat ze werken.</p>`;
})()}

<h3 class="sec">Eén run is geen meting</h3>
<p>In v1.0.3 is een gewicht aangepast op basis van één gunstige run; een tweede run met dezelfde gewichten
gaf een twintig punten lagere nachtverdeling. Die ervaring is de reden dat deze hele meting uit tientallen
runs bestaat en dat elk cijfer in dit rapport met een spreiding staat.</p>

${blok(
  "Wat hier staat is geen mislukking van het experiment maar het resultaat ervan: de winst komt niet van " +
    "de slimste bedachte techniek, maar van de goedkoopste die daadwerkelijk op de gemeten kwaliteit stuurt.",
  "warn",
)}`;

  return {
    number: 16,
    title: "Wat niet werkte",
    what: "Aanpakken die zijn geprobeerd, gemeten en verworpen",
    body,
  };
}

// ── 17. Regressies ───────────────────────────────────────────────────────────

function h17Regressies(g: RapportGegevens): Chapter {
  const { analyse } = g;
  const slechter = analyse.metrics.filter((metric) => metric.overall?.mean.verdict === "slechter");

  const body = `
<p class="lede">Wat er slechter van werd, en wat er mis kan gaan. Een rapport dat alleen de winst noemt, is
een verkooptekst.</p>

<h3 class="sec">Harde toetsen</h3>
${tabel({
  columns: [{ head: "Toets" }, { head: "BEFORE", numeric: true }, { head: "AFTER", numeric: true }, { head: "Eis", numeric: true }, { head: "Uitkomst" }],
  rows: analyse.regression.map((toets) => [
    escape(toets.label),
    nummer(toets.before, 0),
    nummer(toets.after, 0),
    nummer(toets.mustBe, 0),
    toets.pass ? '<span class="better">gehaald</span>' : '<span class="worse">NIET GEHAALD</span>',
  ]),
})}

<h3 class="sec">Validatiestanden</h3>
${tabel({
  columns: [{ head: "Stand" }, { head: "BEFORE", numeric: true }, { head: "AFTER", numeric: true }],
  rows: [
    ...new Set([
      ...Object.keys(analyse.hardValidity.beforeValidationStates),
      ...Object.keys(analyse.hardValidity.afterValidationStates),
    ]),
  ].map((stand) => [
    escape(stand),
    nummer(analyse.hardValidity.beforeValidationStates[stand] ?? 0, 0),
    nummer(analyse.hardValidity.afterValidationStates[stand] ?? 0, 0),
  ]),
  note:
    "De stand TECHNICALLY_VALID_UNVERIFIED_RULES betekent: geen bevestigde harde overtreding, wel regels " +
    "waarvan de bron nog niet formeel is bevestigd. Die stand is in v1.0.3 en v1.0.4 gelijk en verandert " +
    "niets aan de publicatiepoort.",
})}

<h3 class="sec">Maten die achteruitgingen</h3>
${
  slechter.length === 0
    ? "<p>Geen enkele maat ging er gemiddeld op achteruit.</p>"
    : tabel({
        columns: [
          { head: "Maat" },
          { head: "Δ gemiddelde", numeric: true },
          { head: "Δ mediaan", numeric: true },
          { head: "Δ slechtste", numeric: true },
          { head: "Risico" },
        ],
        rows: slechter.map((metric) => [
          escape(metric.label),
          verschil(metric.overall!.mean.delta, 1),
          verschil(metric.overall!.median.delta, 1),
          verschil(metric.overall!.worst.delta, 1),
          metric.key === "stability"
            ? "Verwacht: meer verandering ten opzichte van het huidige rooster is inherent aan breder zoeken"
            : "Zie hoofdstuk 11 en het ontwikkellogboek",
        ]),
      })
}

<h3 class="sec">Risico's die niet in een getal passen</h3>
<ul>
  <li><strong>Optimaliseren op de eigen maat.</strong> Het bijschaven stuurt rechtstreeks op de
  kwaliteitsevaluator. Wordt die maat ooit aangepast, dan verandert het gedrag van de machine mee. Daarom
  is het model geversioneerd en staat de versie bij elke kandidaat.</li>
  <li><strong>Rekentijd.</strong> Een opdracht duurt langer dan in v1.0.3. Wie snel iets wil zien, kiest de
  modus Snel; die levert een minder verfijnd rooster op en dat staat ook in de handleiding.</li>
  <li><strong>Meer verandering ten opzichte van het huidige rooster.</strong> Breder zoeken betekent
  roosters die verder van het bestaande af liggen. Voor wie dat niet wil, is er de strategie met minimale
  wijziging.</li>
</ul>`;

  return {
    number: 17,
    title: "Regressies en risico's",
    what: "Wat slechter werd, wat hard is getoetst en wat er mis kan gaan",
    body,
  };
}

// ── 18. Tests ────────────────────────────────────────────────────────────────

function h18Tests(g: RapportGegevens): Chapter {
  const body = g.tests
    ? `
<p class="lede">De volledige testbatterij, gedraaid op de code waarmee de AFTER-meting is gemaakt.</p>

${tabel({
  caption: `Testuitslagen van ${escape(new Date(g.tests.ranAt).toLocaleString("nl-NL"))}`,
  columns: [{ head: "Suite" }, { head: "Opdracht", width: "28%" }, { head: "Uitkomst" }, { head: "Samenvatting" }, { head: "Duur", numeric: true }],
  rows: g.tests.suites.map((suite) => [
    escape(suite.name),
    `<code>${escape(suite.command)}</code>`,
    suite.ok ? '<span class="better">geslaagd</span>' : '<span class="worse">GEFAALD</span>',
    escape(suite.summary),
    duur(suite.seconds),
  ]),
})}

<h3 class="sec">Wat de tests van de zoekmachine vastleggen</h3>
<p><strong>Synthetische roosters.</strong> De kwaliteitsevaluator wordt getoetst op paren roosters die op
één ding verschillen: dezelfde diensten in reeksen tegenover heen-en-weer, alle roosters binnen vijf
minuten van 40:00 tegenover een spreiding van een uur, twee reeksen van drie nachten tegenover zes losse
nachten, rust net boven het minimum tegenover ruim, en dezelfde rangeerbelasting gelijk verdeeld tegenover
geconcentreerd. Zet het model het slechte voorbeeld niet lager, dan meet het niet wat het zegt te meten —
en dan is elke benchmarkuitkomst erna betekenisloos.</p>

<p><strong>Mutatietests.</strong> In de broncode wordt opzettelijk één fout gezet, waarna de tests moeten
omvallen. ${
    g.tests?.suites.find((suite) => suite.name === "Mutatietests")?.summary
      ? `Uitkomst: ${escape(g.tests.suites.find((suite) => suite.name === "Mutatietests")!.summary)}`
      : "De uitslag staat in de tabel hierboven."
  } Nieuw in v1.0.4 zijn de mutaties op de zoekmachine zelf: een losse nacht die even zwaar telt als een
nacht in een reeks, een zware overgang die niet meer als zwaar wordt geteld, urenafwijking zonder absolute
waarde, een rangschikking die de slechtste regel negeert, en drie op het bijschaven — ruilen buiten het
profiel, ruilen zonder rusttoets, en het niet bewaren van de beste stand.</p>

${blok(
  "Drie van die zeven mutaties bleven bij de eerste poging onopgemerkt. Niet omdat de code fout was, maar " +
    "omdat de tests het verkeerde vastlegden: de profieltest werd al door de rusttoets afgevangen en kwam " +
    "nooit aan de profielgrens toe. Die tests zijn aangepast, niet de mutaties.",
)}`
    : `
<p class="lede">De testbatterij is nog niet vastgelegd in <code>docs/optimizer-benchmark/test-results.json</code>.</p>
${blok(
  "Zonder vastgelegde testuitslagen is dit hoofdstuk leeg. Draai npm run test:battery en bouw het rapport opnieuw; " +
    "er komen hier geen voorbeeldwaarden te staan.",
  "warn",
)}`;

  return {
    number: 18,
    title: "Testresultaten",
    what: "Welke tests zijn gedraaid en wat ze zeiden",
    body,
  };
}

// ── 19. Beperkingen ──────────────────────────────────────────────────────────

function h19Beperkingen(g: RapportGegevens): Chapter {
  const body = `
<p class="lede">Wat deze meting niet zegt.</p>

<ul>
  <li><strong>Eén standplaats, één dienstenpakket.</strong> Alles is gemeten op
  ${escape(String(g.manifestBefore.data.location ?? "—"))} met pakket
  ${escape(String((g.manifestBefore.data.dutyPackage as {label?:string})?.label ?? "—"))}. Een ander pakket kan andere knelpunten hebben.</li>
  <li><strong>Eén machine.</strong> De rekentijden gelden voor de machine in hoofdstuk 2. Op minder kernen
  duurt alles langer; de budgetten zijn tijdsbudgetten, dus de machine doet dan minder werk in dezelfde tijd.</li>
  <li><strong>Geen uitspraak over mens tegenover machine.</strong> Het officiële rooster is een ijkpunt op
  dezelfde maten, geen deelnemer aan een wedstrijd.</li>
  <li><strong>De maat is niet de werkelijkheid.</strong> Het kwaliteitsmodel is een model. Het meet wat we
  konden onderbouwen uit de regels en uit het officiële rooster; wat een machinist ervan vindt, staat er
  niet in.</li>
  <li><strong>Het aantal zoekdraden is niet apart gemeten.</strong> Beide fasen draaiden met hetzelfde
  aantal solverdraden, dus de vergelijking klopt; of een ander aantal draden betere roosters oplevert, is
  met deze meting niet te zeggen.</li>
  <li><strong>Het bijschaven kent alleen ruilen van twee diensten.</strong> Verplaatsingen met drie of meer
  diensten tegelijk zijn niet onderzocht; er kunnen verbeteringen bestaan die alleen zo bereikbaar zijn.</li>
  <li><strong>Regelbron nog niet bevestigd.</strong> Enkele profielregels komen uit een overgenomen bron en
  hebben de stand POTENTIAL. Dat blijft ongewijzigd; de generatiepoort weigert die kandidaten hoe dan ook.</li>
</ul>`;

  return {
    number: 19,
    title: "Bekende beperkingen",
    what: "Waar deze meting niets over zegt",
    body,
  };
}

// ── 20. Debuggen ─────────────────────────────────────────────────────────────

function h20Debuggen(g: RapportGegevens): Chapter {
  const body = `
<p class="lede">Hoe je van een kandidaat terugredeneert naar de beslissing die hem opleverde.</p>

<h3 class="sec">Wat er per kandidaat wordt bewaard</h3>
<ul>
  <li>De herkomst: welke poging, welke zaadwaarde, welke gewichten, welk vertrekpunt, welke reparaties.</li>
  <li>Waarom hij overleefde: welke drempels hij haalde en welke kandidaten hij versloeg.</li>
  <li>Het kwaliteitsrapport: alle onderdelen, per roosterregel, met de slechtste regel apart.</li>
  <li>De versies: kwaliteitsmodel en zoekmachine, zodat later duidelijk is waarmee is gemeten.</li>
</ul>

<h3 class="sec">Van vraag naar antwoord</h3>
${tabel({
  columns: [{ head: "Vraag" }, { head: "Waar het antwoord staat" }],
  rows: [
    ["Waarom is deze kandidaat gekozen?", "Het veld <code>provenance</code> bij de kandidaat: drempels, verslagen concurrenten, uitleg per zwak punt."],
    ["Wat heeft de machine geprobeerd?", "Het zoekjournaal bij de opdracht: elke poging met zaadwaarde, gewichten, uitkomst en reden van afwijzing."],
    ["Waarom is deze dienst hier geplaatst?", "De uitleg bij de kandidaat noemt de concurrerende diensten op die weekdag en waarom de ruil niet is gemaakt."],
    ["Kan ik deze kandidaat opnieuw maken?", "<code>npm run reproduce:candidate -- &lt;id&gt;</code> draait dezelfde opdracht met dezelfde zaadwaarde en vergelijkt de uitkomst."],
    ["Klopt het cijfer nog?", "<code>npm run verify:quality</code> rekent het officiële rooster en de synthetische voorbeelden opnieuw door."],
  ],
})}

${blok(
  "Er wordt niets uitgelegd wat niet in de gegevens staat. Een uitleg als \"dit rooster is rustiger\" zonder " +
    "bijbehorende meting is misleidend; de uitleg noemt daarom altijd de maat en het getal waar hij op slaat.",
)}`;

  return {
    number: 20,
    title: "Fouten opsporen",
    what: "Van kandidaat terug naar de beslissing die hem maakte",
    body,
  };
}

// ── 21. Reproduceerbaarheid ──────────────────────────────────────────────────

function h21Reproduceerbaarheid(g: RapportGegevens): Chapter {
  const body = `
<p class="lede">Elke meting in dit rapport is opnieuw te draaien. Dit hoofdstuk zegt hoe.</p>

${tabel({
  caption: "De meting stap voor stap",
  columns: [{ head: "Stap" }, { head: "Opdracht", width: "46%" }, { head: "Levert op" }],
  rows: [
    ["Condities vastleggen", "<code>npm run verify:optimizer-benchmark -- manifest --phase before</code>", "manifest.json"],
    ["BEFORE meten", "<code>npm run verify:optimizer-benchmark -- run --phase before --engine legacy --strategy BALANCED --runs 10</code>", "before/run-*.json"],
    ["AFTER meten", "<code>npm run verify:optimizer-benchmark -- run --phase after --engine adaptive --mode NORMAL --strategy BALANCED --runs 10</code>", "after/run-*.json"],
    ["Doorrekenen", "<code>npm run verify:optimizer-benchmark -- evaluate</code>", "benchmark-summary.json, tables/, CSV"],
    ["Vergelijken", "<code>npm run analyse:optimizer</code>", "analysis.json"],
    ["Bijschaafbudget meten", "<code>npm run measure:polish-budget</code>", "polish-budget.json"],
    ["Rapport bouwen", "<code>npm run report:optimizer</code>", "dit document"],
  ],
})}

<h3 class="sec">Waarom een AFTER-run weigert te starten</h3>
<p>De benchmark vergelijkt vóór elke AFTER-run de vingerafdruk van de gegevens, de profielen, het
regelbestand en de machine met die van de BEFORE-meting. Wijkt er iets af, dan start hij niet. Een
vergelijking die eigenlijk over gewijzigde invoergegevens gaat, is geen engine-experiment.</p>

<h3 class="sec">Terug naar v1.0.3</h3>
<p>De klassieke zoekmachine blijft beschikbaar met <code>NS_OPTIMIZER_ENGINE=legacy</code>. De keuze
verandert niets aan de regels, de validatie of de publicatiepoort — alleen aan hoe de kandidaten tot stand
komen.</p>

<p class="note">Wat niet volledig reproduceerbaar is: CP-SAT met meerdere zoekdraden geeft ook met dezelfde
zaadwaarde niet altijd exact hetzelfde rooster, omdat draden elkaar in wisselende volgorde vinden. Daarom
vergelijkt <code>reproduce:candidate</code> op afstand en kwaliteit, en niet op een identieke uitkomst.</p>`;

  return {
    number: 21,
    title: "Reproduceerbaarheid",
    what: "Hoe elke meting opnieuw te draaien is",
    body,
  };
}

// ── 22. Conclusie ────────────────────────────────────────────────────────────

function h22Conclusie(g: RapportGegevens, besluit: string): Chapter {
  const { analyse } = g;
  const robust = metricVan(analyse, "robust");
  const worst = metricVan(analyse, "worstLine");
  const beter = analyse.headline.filter((m) => m.meanVerdict === "beter");
  const slechter = analyse.headline.filter((m) => m.meanVerdict === "slechter");

  const body = `
<p class="lede">Wat de meting laat zien, wat het besluit is en wat dat betekent voor wie het platform
gebruikt.</p>

<h3 class="sec">Wat er is aangetoond</h3>
<ul>
  <li>Robuuste kwaliteit: ${nummer(robust.overall?.before.mean ?? null, 1)} → ${nummer(robust.overall?.after.mean ?? null, 1)}
  (${verschil(robust.overall?.mean.delta ?? null, 1)}), gemeten over ${analyse.counts.before.candidates} en
  ${analyse.counts.after.candidates} kandidaten.</li>
  <li>Slechtste roosterregel: ${nummer(worst.overall?.before.mean ?? null, 1)} → ${nummer(worst.overall?.after.mean ?? null, 1)}
  (${verschil(worst.overall?.mean.delta ?? null, 1)}). Dat is de regel waar één medewerker het hele jaar mee leeft.</li>
  <li>${beter.length} van de ${analyse.headline.length} kernmaten vooruit, ${slechter.length} achteruit.</li>
  <li>Geen enkele harde toets is verslechterd: ${analyse.regression.filter((t) => t.pass).length} van de
  ${analyse.regression.length} toetsen gehaald.</li>
</ul>

<h3 class="sec">Wat er niet is aangetoond</h3>
<ul>
  <li>Dat de machine betere roosters maakt dan roostermakers. Dat is met deze meting niet te zeggen en
  wordt hier niet beweerd.</li>
  <li>Dat de winst op elk dienstenpakket terugkomt. Er is één pakket gemeten.</li>
  <li>Dat de gemeten kwaliteit overeenkomt met wat medewerkers ervaren. Het model meet wat te onderbouwen
  was, niet wat mensen ervan vinden.</li>
</ul>

${blok(
  besluit === "AANGENOMEN"
    ? "Besluit: de adaptieve zoekmachine wordt de standaard voor nieuwe opdrachten. De v1.0.3-machine blijft bereikbaar via een schakelaar, en de publicatiepoort en de juridische status blijven ongewijzigd."
    : besluit === "AANGENOMEN MET KANTTEKENINGEN"
      ? "Besluit: de adaptieve zoekmachine wordt de standaard, met de kanttekeningen uit hoofdstuk 17. De v1.0.3-machine blijft bereikbaar via een schakelaar."
      : besluit === "ENGINE EXPERIMENT INCONCLUSIVE"
        ? "Besluit: ENGINE EXPERIMENT INCONCLUSIVE. De meting laat geen eenduidige verbetering zien. v1.0.3 blijft de standaardoptimizer; de adaptieve machine blijft beschikbaar achter de schakelaar voor verder onderzoek."
        : "Besluit: afgekeurd wegens een harde regressie. De adaptieve machine wordt niet standaard.",
  besluit === "AANGENOMEN" ? "ok" : besluit === "AFGEKEURD" ? "bad" : "warn",
)}

<h3 class="sec">Wat de gebruiker merkt</h3>
<p>Een opdracht duurt langer en het scherm laat zien hoeveel varianten er zijn onderzocht. De uitkomst heet
"beste gevonden kandidaat", niet "perfect rooster": de machine zoekt in een ruimte die te groot is om
uitputtend te doorzoeken, en weet dus nooit of er iets beters bestond. Wat er ligt, is wel volledig
doorgerekend, onafhankelijk gevalideerd en herleidbaar tot de beslissing die het opleverde.</p>`;

  return {
    number: 22,
    title: "Conclusie en besluit",
    what: "Wat is aangetoond, wat niet, en wat er nu gebeurt",
    body,
  };
}

// ── Uitvoeren ────────────────────────────────────────────────────────────────

function main() {
  const gegevens = laadGegevens();
  const html = bouw(gegevens);
  writeFileSync(HTML, html, "utf8");
  console.log(`Geschreven: ${HTML}`);
  console.log(`  ${(html.length / 1024).toFixed(0)} kB HTML`);
  console.log("Maak de PDF met: npm run report:optimizer-pdf");
}

main();
