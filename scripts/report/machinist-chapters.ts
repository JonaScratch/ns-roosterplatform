import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Chapter, blok, escape, figuur, nummer, tabel, verschil } from "./layout";
import { KLEUR, groupedBars } from "./charts";

/**
 * Deel II van het Final-Brain-rapport: de ronde "machinist preference
 * intelligence". Alles komt uit `docs/v1.0.4-final-brain/machinist-preferences/`;
 * een ontbrekend bestand staat er als "NOG NIET GEGENEREERD" en wordt door de
 * kwaliteitscontrole afgekeurd.
 *
 * Geen claim dat een rooster beter is voor mensen: het rapport zegt waar de
 * uitkomst meetbaar dichter bij de opgegeven voorkeur en de menselijke roosters
 * ligt, en waar niet.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences");
const lees = (bestand: string): Json | null => {
  const pad = path.join(MAP, bestand);
  return existsSync(pad) ? (JSON.parse(readFileSync(pad, "utf8")) as Json) : null;
};
const ontbreekt = (wat: string) => blok(`NOG NIET GEGENEREERD — ${escape(wat)} ontbreekt.`, "bad");

const NAAM: Record<string, string> = {
  "DDR-V": "Vroeg",
  "DDR-VL": "Vroeg/Laat",
  "DDR-L": "Laat",
  "DDR-LN": "Laat/Nacht",
  "DDR-MIX": "Vroeg/Laat/Nacht",
  "DDR-50MIX": "50+ Mix",
  "DDR-BLM": "BLM",
};
const ROOSTERS = ["DDR-V", "DDR-VL", "DDR-MIX", "DDR-BLM", "DDR-50MIX", "DDR-L", "DDR-LN"];
const naam = (c: string) => NAAM[c] ?? c;
const hm = (m: number | null | undefined) => (m === null || m === undefined ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`);

interface Gegevens {
  readonly official: Json | null;
  readonly baseline: Json | null;
  readonly baselineBalanced: Json | null;
  readonly after: Json | null;
  readonly afterPhase: string;
  readonly m1: Json | null;
  readonly m2: Json | null;
  /** Verkennend, niet beslissend: CP-SAT-voorkeur op schaal 1/3 in de volledige zoekmachine. */
  readonly explore: Json | null;
  readonly decisions: Record<string, Json | null>;
  readonly gates: Json | null;
  readonly rates: Json | null;
  readonly sensitivity: Json | null;
  readonly affinity: Json | null;
  readonly curve: Json | null;
  readonly measureBefore: Json | null;
  readonly measureAfter: Json | null;
  readonly rules: Json | null;
  readonly solverAb: Json | null;
  readonly packages: Json | null;
  readonly tests: Json | null;
  readonly testNotes: Json | null;
}

export function laadMachinist(afterPhase = "mp-after"): Gegevens {
  return {
    official: lees("phases/official.json"),
    baseline: lees("phases/brain-after.json"),
    baselineBalanced: lees("phases/brain-after-BALANCED.json"),
    after: lees(`phases/${afterPhase}.json`),
    afterPhase,
    m1: lees("phases/mp-m1-BALANCED.json"),
    m2: lees("phases/mp-m2-BALANCED.json"),
    explore: lees("phases/mp-x13-BALANCED.json"),
    decisions: Object.fromEntries(["m0", "m1", "m2", "m3"].map((r) => [r, lees(`decision-${r}.json`)])),
    gates: lees("gates.json"),
    rates: lees("exchange-rates.json"),
    sensitivity: lees("assumption-sensitivity.json"),
    affinity: lees("profile-affinity.json"),
    curve: lees("night-preference-curve.json"),
    measureBefore: lees("measure-before.json"),
    measureAfter: lees("measure-after.json"),
    rules: lees("decision-rules.json"),
    solverAb: lees("solver-ab-preference.json"),
    packages: lees("final-candidates/selection.json"),
    tests: lees("test-results.json"),
    testNotes: lees("test-battery-notes.json"),
  };
}

/** Gemiddelde van een profielveld per rooster over alle kandidaten van een fase. */
function perRooster(fase: Json | null, veld: string): Record<string, number | null> {
  if (!fase) return {};
  const kandidaten: Json[] = fase.official ? [fase.official] : fase.candidates;
  return Object.fromEntries(
    ROOSTERS.map((c) => {
      const w = kandidaten.map((k) => k.profiles?.[c]?.[veld]).filter((x): x is number => typeof x === "number");
      return [c, w.length ? w.reduce((a, b) => a + b, 0) / w.length : null];
    }),
  );
}
const gemiddelde = (fase: Json | null, key: string): number | null => (fase ? ((fase.means?.[key] ?? null) as number | null) : null);

/** Een tabel met een ontbrekende bron zegt dat hardop, in plaats van stil "—" te tonen. */
function ontbrekendeBronnen(g: Gegevens): string {
  const weg = [
    g.official ? null : "phases/official.json",
    g.baseline ? null : "phases/brain-after.json",
    g.after ? null : `phases/${g.afterPhase}.json`,
  ].filter((x): x is string => x !== null);
  return weg.length ? ontbreekt(weg.join(", ")) : "";
}

function profielTabel(g: Gegevens, velden: readonly { veld: string; head: string; decimals?: number }[], caption: string, note?: string): string {
  const bronnen = [
    { head: "mens", f: g.official },
    { head: "baseline", f: g.baseline },
    { head: "AFTER", f: g.after },
  ];
  const kolommen = velden.flatMap((v) => bronnen.map((b) => ({ head: `${v.head} · ${b.head}`, numeric: true })));
  const waarden = velden.flatMap((v) => bronnen.map((b) => perRooster(b.f, v.veld)));
  return `${ontbrekendeBronnen(g)}<div class="wide">${tabel({
    caption,
    columns: [{ head: "Rooster" }, ...kolommen],
    rows: ROOSTERS.map((c) => [escape(naam(c)), ...waarden.map((w, i) => nummer(w[c], velden[Math.floor(i / bronnen.length)].decimals ?? 1))]),
    note,
  })}</div>`;
}

function vergelijkRij(g: Gegevens, keys: readonly { key: string; label: string; decimals?: number }[]): string {
  return ontbrekendeBronnen(g) + tabel({
    columns: [{ head: "Maat" }, { head: "Mens", numeric: true }, { head: "Baseline", numeric: true }, { head: "AFTER", numeric: true }, { head: "Δ AFTER − baseline", numeric: true }],
    rows: keys.map((k) => {
      const b = gemiddelde(g.baseline, k.key);
      const a = gemiddelde(g.after, k.key);
      return [escape(k.label), nummer(gemiddelde(g.official, k.key), k.decimals ?? 1), nummer(b, k.decimals ?? 1), nummer(a, k.decimals ?? 1), b !== null && a !== null ? verschil(a - b, k.decimals ?? 1) : "—"];
    }),
  });
}

// ── 24 ──────────────────────────────────────────────────────────────────────

function h24Model(g: Gegevens): Chapter {
  const a = g.affinity;
  return {
    number: 24,
    title: "Het model van machinistenvoorkeur",
    what: "Drie lagen, bronstatus, wat wel en niet in de score gaat",
    body: `
<p>Deel II van dit rapport gaat over de vervolgopdracht: het brein laten begrijpen <em>wat een machinist prettig vindt aan zijn
roosterprofiel</em>. Drie lagen die nooit door elkaar lopen:</p>
${tabel({
  columns: [{ head: "Laag" }, { head: "Vraag" }, { head: "Waar" }, { head: "Status" }],
  rows: [
    ["Profielgeschiktheid", "Mag deze dienst in dit profiel?", "<code>roster-profiles.ts</code>", "hard, ongewijzigd"],
    ["Profielaffiniteit", "Hoe goed past een toegestane dienst?", "<code>profile-affinity.ts</code>", "zacht, MACHINIST_PREFERENCE / HUMAN_DOMAIN_INPUT"],
    ["Pakketeerlijkheid", "Zijn populaire diensten eerlijk verdeeld?", "<code>machinist-preference.ts</code>", "zacht, MACHINIST_PREFERENCE"],
    ["Operationele eisen", "Roostergemiddelde ≤ 40:00; vrijdag vóór vrij weekend uiterlijk 23:59 (nachten uitgezonderd)", "<code>operational-requirements.ts</code>", "hard, USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT"],
  ],
})}
<p>Geen van deze regels is als CAO, ATW, ATB of wet gepresenteerd. Toeslagen staan niet in het platform; blootstelling wordt alleen als
proxy gemeten (hoofdstuk 28), nooit in geld.</p>
${
  a
    ? tabel({
        caption: "Affiniteit per profiel en dienstklasse (op de klok, nooit op het dienstnummer)",
        columns: [{ head: "Profiel" }, ...Object.keys(a.classes).map((k) => ({ head: String(a.classes[k]) }))],
        rows: Object.entries(a.table as Record<string, Record<string, Json>>)
          .filter(([p]) => p !== "RESERVE")
          .map(([p, r]) => [escape(p), ...Object.keys(a.classes).map((k) => (r[k]?.eligible === false ? "mag niet" : escape(({ PREFERRED: "voorkeur", NEUTRAL: "neutraal", LESS: "minder" } as Record<string, string>)[r[k].level] ?? r[k].level)))]),
        note: `Niveaus: voorkeur ${nummer(a.levels.PREFERRED, 1)} · neutraal ${nummer(a.levels.NEUTRAL, 1)} · minder ${nummer(a.levels.LESS, 1)}; alleen de volgorde heeft een bron. De bron per cel staat in <code>profile-affinity.json</code>. Grenzen: extreem vroeg vóór 05:30, dagachtig vroeg vanaf 09:00, vroege late klaar vóór 21:00, echte afloper klaar na middernacht.`,
      })
    : ontbreekt("profile-affinity.json")
}
<p>Kwaliteitsmodel v3 = v2 plus: de operationele eisen als harde geldigheid, een onderdeel <em>voorkeur</em> (gewicht 0,15, over alle
gewichten genormaliseerd) met vijf delen — affiniteit, geen restbak, dagdiensten volgens de opgegeven verhouding, populaire diensten
eerlijk, weekendbegin — en nachtreeksen op ritme min belasting. Versie 2 is byte voor byte ongewijzigd; de Final-Brain-getallen in deel I
blijven daarmee na te rekenen. Ontwerp en aannames: <code>design.md</code>.</p>
${blok("Bewust níet in de score: werkreeksen van 4–5 dagen en aaneengesloten rust. Die liggen vast in de R-, WR-, CO- en RES-dagen van de structuur; de zoekmachine vult alleen dienstdagen. Een score erop zou elke kandidaat evenveel verschuiven. Ze worden gemeten (hoofdstuk 31).", "info")}`,
  };
}

// ── 25 ──────────────────────────────────────────────────────────────────────

function h25Vroeg(g: Gegevens): Chapter {
  return {
    number: 25,
    title: "Vroeg-affiniteit",
    what: "Extreem vroeg, gematigd vroeg en dagachtig vroeg per profiel",
    body: `
<p>Vroeg wil het vroegst beginnen en het vroegst klaar zijn; Vroeg/Laat wil vroeg, maar niet elke dag extreem vroeg; niemand krijgt een
monopolie. Aantallen per basisrooster, gemiddeld over de kandidaten.</p>
${profielTabel(g, [{ veld: "extremeEarly", head: "extreem" }, { veld: "moderateEarly", head: "gematigd" }, { veld: "daylikeEarly", head: "dagachtig" }], "Vroege diensten per rooster")}
${blok("Afwijking van het menselijke rooster (niet weggepoetst): bij mensen krijgt Vroeg/Laat relatief méér extreem vroege diensten dan Vroeg (lift 1,67 tegen 1,23). De opgegeven voorkeur zegt het omgekeerde. Het model volgt de opgegeven voorkeur; zie human-vs-preference.md.", "warn")}
<p>Toetsen 1–3 (<code>tests/domain/machinistenvoorkeur.test.ts</code>): Vroeg met relatief veel extreem vroeg scoort beter dan een gelijke
verdeling zolang de anderen hun deel houden; voor Vroeg/Laat scoort 1-5-7-4-8 beter dan 1-1-1-1-1, voor Vroeg juist andersom.</p>`,
  };
}

// ── 26 ──────────────────────────────────────────────────────────────────────

function h26Laat(g: Gegevens): Chapter {
  return {
    number: 26,
    title: "Laat-affiniteit",
    what: "Echte aflopers en vroege late diensten per profiel",
    body: `
<p>Laat wil echte late diensten en aflopers (klaar na middernacht), weinig vroege late of dagachtige diensten. Iedereen die aflopers mag
rijden, hoort ze ook te krijgen.</p>
${profielTabel(g, [{ veld: "premiumLate", head: "afloper" }, { veld: "earlyLate", head: "vroege late" }], "Late diensten per rooster")}
${vergelijkRij(g, [{ key: "affinity", label: "Affiniteit (gemiddeld, 0–100)" }, { key: "restDuties", label: "Geen restbak (100 − grootste aandeel 'minder passend')" }])}`,
  };
}

// ── 27 ──────────────────────────────────────────────────────────────────────

function h27Aantrekkelijk(g: Gegevens): Chapter {
  const s = g.sensitivity?.results as Json | undefined;
  return {
    number: 27,
    title: "Aantrekkelijke diensten verdeeld",
    what: "Dagdiensten volgens de opgegeven verhouding; aflopers en extreem vroeg eerlijk",
    body: `
<p>Dagachtige diensten horen niet voornamelijk bij Laat. De opgegeven relatieve gewichten (Laat 10, Vroeg/Laat/Nacht 20, Vroeg/Laat 20,
BLM 20, Laat/Nacht 10, 50+ Mix 40; Vroeg ontbrak, aanname 10) zijn geen percentages: per concrete dienst genormaliseerd over de profielen
die hem mogen rijden.</p>
${profielTabel(g, [{ veld: "dayDuties", head: "dagdiensten" }, { veld: "dayDutyTarget", head: "doel" }], "Dagachtige diensten per rooster tegen de verwachting")}
${vergelijkRij(g, [{ key: "dayDuties", label: "Dagdiensten volgens verhouding (100 − afstand)" }, { key: "popularFairness", label: "Populair eerlijk (aflopers, extreem vroeg)" }])}
${
  s
    ? tabel({
        caption: "Gevoeligheid van de aannames (afstand tot de verhouding; lager = dichter bij)",
        columns: [{ head: "Aanname" }, { head: "Mens", numeric: true }, { head: "Baseline", numeric: true }],
        rows: Object.keys(s.official).map((k) => [escape(k), nummer(s.official[k], 3), nummer(s.baseline[k], 3)]),
        note: "Per profiel genormaliseerd ligt het menselijke rooster dichter bij de verhouding dan per regel; de eerste versie van het ontwerp koos per regel met een niet nagerekend getal. Zie hoofdstuk 35.",
      })
    : ontbreekt("assumption-sensitivity.json")
}`,
  };
}

// ── 28 ──────────────────────────────────────────────────────────────────────

function h28Blootstelling(g: Gegevens): Chapter {
  return {
    number: 28,
    title: "Toeslag- en blootstellingseerlijkheid",
    what: "Proxy: minuten in het CAO-nachtvenster en in het weekend — geen bedragen",
    body: `
${blok("Er staan geen ORT- of toeslagregels in het platform. Hier staat daarom geen enkel bedrag. Gemeten wordt TIME_BAND_EXPOSURE als proxy: minuten tussen 00:00 en 06:00 (het nachtvenster uit de CAO-bron in duty-window.ts) en minuten op zaterdag en zondag, per week.", "warn")}
${profielTabel(g, [{ veld: "nightWindowMinutesPerWeek", head: "00–06 min/w", decimals: 0 }, { veld: "weekendMinutesPerWeek", head: "weekend min/w", decimals: 0 }], "Blootstelling per rooster (proxy)")}`,
  };
}

// ── 29 ──────────────────────────────────────────────────────────────────────

function h29Rangeer(g: Gegevens): Chapter {
  return {
    number: 29,
    title: "Rangeer eerlijk verdeeld",
    what: "Rangeer is populair: geen strafdienst, wel eerlijk spreiden",
    body: `
<p>Rangeerdiensten zijn in de praktijk geliefd. Ze tellen daarom niet als belasting of lage affiniteit; wel mag geen rooster ze allemaal
krijgen en geen geschikt rooster er structureel buiten vallen.</p>
${profielTabel(g, [{ veld: "rangeer", head: "rangeer" }], "Rangeerdiensten per rooster")}
${vergelijkRij(g, [{ key: "rangeerCv", label: "Spreiding per regel (variatiecoëfficiënt, lager = gelijker)", decimals: 3 }, { key: "rangeerMaxShare", label: "Grootste aandeel van één rooster", decimals: 3 }])}
${blok("Hier staat de zoekmachine dichter bij de opgegeven wens dan het menselijke rooster: mensen concentreren rangeer (Vroeg/Laat/Nacht 11 van 39, 50+ Mix 2), de zoekmachine spreidt vrijwel gelijk; zie de variatiecoëfficiënt in de tabel.", "info")}`,
  };
}

// ── 30 ──────────────────────────────────────────────────────────────────────

function h30Weekend(g: Gegevens): Chapter {
  const m = g.measureBefore;
  const weekenden: Json[] = m ? (m.official.perRoster as Json[]).flatMap((r) => (r.weekends as Json[]).map((w) => ({ ...w, code: r.code }))) : [];
  return {
    number: 30,
    title: "Weekendkwaliteit",
    what: "Vrij weekend RUST + RUST, vrijdag vóór 24:00, weekendbegin met afnemende meeropbrengst",
    body: `
<p>Een vrij weekend is RUST + RUST (ligt vast in de structuur: 32 van 32). De vrijdagdienst ervoor is uiterlijk 23:59 klaar — behalve
een nachtdienst (besluit van de gebruiker, 19 september 2026). Binnen die grens telt hoe vroeg: 17:00 tegen 23:00 is een groot verschil,
21:45 tegen 22:00 een klein (toets 7).</p>
${vergelijkRij(g, [{ key: "weekendStart", label: "Weekendbegin (0–100)" }, { key: "operationalViolations", label: "Operationele overtredingen per kandidaat", decimals: 2 }])}
${
  weekenden.length
    ? tabel({
        caption: "Vrije weekenden in het menselijke rooster",
        columns: [{ head: "Rooster" }, { head: "Regel", numeric: true }, { head: "Za/zo" }, { head: "Vrijdag eind" }, { head: "Maandag begin" }, { head: "Rust (u)", numeric: true }],
        rows: weekenden.map((w) => [escape(naam(w.code)), String(w.line), `${escape(w.saturday)} + ${escape(w.sunday)}`, escape(w.fridayEnd ?? "geen dienst"), escape(w.mondayStart ?? "geen dienst"), w.restHours === null ? "n.v.t." : nummer(w.restHours, 1)]),
        note: "Vroeg/Laat/Nacht regel 8 eindigt een nachtreeks op vrijdagnacht (zaterdag 06:00); die mag, en is precies de menselijke nachtuitgang.",
      })
    : ontbreekt("measure-before.json")
}`,
  };
}

// ── 31 ──────────────────────────────────────────────────────────────────────

function h31Reeksen(g: Gegevens): Chapter {
  const m = g.measureBefore;
  const rijen = m
    ? (m.official.perRoster as Json[]).map((r) => [
        escape(naam(r.code)),
        escape(Object.entries(r.workStreaks as Record<string, number>).map(([l, n]) => `${l}×${n}`).join(" · ")),
        escape(Object.entries(r.restStreaks as Record<string, number>).map(([l, n]) => `${l}×${n}`).join(" · ")),
      ])
    : [];
  return {
    number: 31,
    title: "Werk- en rustreeksen",
    what: "4–5 dagen werken, aaneengesloten rust — gemeten, niet geoptimaliseerd",
    body: `
<p>Werkreeksen van ongeveer vier à vijf dagen en aaneengesloten rust hebben menselijke waarde; zes dagen komt voor. Maar de lengte van
werk- en rustreeksen ligt vast in de structuur: R, WR, CO en RES staan op vaste dagen en de zoekmachine vult alleen dienstdagen. Deze ronde
meet ze daarom en optimaliseert er niet op; forceren zou de structuur kapot maken.</p>
${m ? tabel({ caption: "Menselijke roosters: reekslengte × aantal", columns: [{ head: "Rooster" }, { head: "Werkreeksen" }, { head: "Rustreeksen" }], rows: rijen }) : ontbreekt("measure-before.json")}
${blok("Een kandidaat van de zoekmachine heeft per definitie dezelfde reekslengtes als het menselijke rooster (zelfde structuur). Verschil zit alleen in wát er op de dienstdagen staat.", "info")}`,
  };
}

// ── 32 ──────────────────────────────────────────────────────────────────────

function h32Nachten(g: Gegevens): Chapter {
  const c = g.curve;
  return {
    number: 32,
    title: "Nachtritme tegen totale belasting",
    what: "Twee assen: ritme stijgt en vlakt af, belasting stijgt vanaf zes",
    body: `
${
  c
    ? `${figuur(
        groupedBars(
          (c.curve as Json[]).map((r) => ({
            label: `${r.length} nacht${r.length > 1 ? "en" : ""}`,
            bars: [
              { name: "ritme", value: r.rhythm, color: KLEUR.before },
              { name: "belasting", value: r.load, color: KLEUR.bad },
              { name: "waarde v3", value: r.worthV3, color: KLEUR.after },
              { name: "waarde v2", value: r.valueV2, color: KLEUR.official },
            ],
          })),
          { decimals: 2, min: 0, max: 1 },
        ),
        "Per lengte: ritme (licht), belasting (rood), waarde in model v3 = ritme − belasting (donker), waarde in model v2 (geel).",
      )}
${tabel({ columns: [{ head: "Lengte", numeric: true }, { head: "Machinisten" }, { head: "Ritme", numeric: true }, { head: "Belasting", numeric: true }, { head: "v3", numeric: true }, { head: "v2", numeric: true }], rows: (c.curve as Json[]).map((r) => [String(r.length), escape(String(c.userInput[r.length])), nummer(r.rhythm, 2), nummer(r.load, 2), nummer(r.worthV3, 2), nummer(r.valueV2, 2)]) })}`
    : ontbreekt("night-preference-curve.json")
}
${blok("Praktijk van machinisten, geen medische of fysiologische claim. Het officiële rooster heeft één reeks van drie en verliest in v3 daardoor iets op nachten (98,9 → 93,7); dat is de bedoeling van de opgegeven voorkeur, geen fout.", "info")}
${vergelijkRij(g, [{ key: "singletons", label: "Losse nachten", decimals: 2 }, { key: "pairs", label: "Reeksen van twee", decimals: 2 }, { key: "worstNightExit", label: "Slechtste nachtuitgang (0–100)" }, { key: "minRecoveryHours", label: "Kortste herstel na nachten (u)" }])}`,
  };
}

// ── 33 ──────────────────────────────────────────────────────────────────────

function h33Uren(g: Gegevens): Chapter {
  const o = g.official?.official as Json | undefined;
  return {
    number: 33,
    title: "Urengrens van het roostergemiddelde",
    what: "Hoogstens 40:00 per rooster, gemiddeld over alle regels, in hele minuten",
    body: `
<p>Eis van de gebruiker (USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT): het gemiddelde van een basisrooster over al zijn regels is
hoogstens 40:00 per week — 40:00 mag, 40:01 niet — en ligt dicht onder 40:00. Een losse regel mag erboven (bijvoorbeeld 48 uur).</p>
${tabel({
  caption: "Semantiek — de bestaande platformsemantiek, niet stilletjes veranderd",
  columns: [{ head: "Onderdeel" }, { head: "Telt als" }],
  rows: [
    ["Dienst", "einde − begin, pauze inbegrepen (zoals de roosterbladen)"],
    ["RES, WR (WTV), CO", "8:00 per dag (de bladen drukken 08:00 af)"],
    ["R", "0"],
    ["Weekgemiddelde", "totaal / cyclusweken, naar beneden afgerond op hele minuten (zoals de bladen)"],
    ["Grens", "totaal &lt; 2401 × cyclusweken, in gehele minuten"],
  ],
})}
${
  o
    ? tabel({
        caption: "Menselijk rooster en de grens",
        columns: [{ head: "Maat" }, { head: "Waarde", numeric: true }],
        rows: [
          ["Roosters op of onder 40:00", `${o.operational.hoursCompliant} van 7`],
          ["Hoogste roostergemiddelde", hm(o.operational.maxAverageWeeklyMinutes)],
        ],
      })
    : ontbreekt("phases/official.json")
}
${vergelijkRij(g, [{ key: "hours", label: "Uren (v2-onderdeel)" }])}
<p>Hard in CP-SAT (lineaire bovengrens per basisrooster), bij elke ruil van het bijschaven en in de harde geldigheid van model v3. Toets 10:
39:59 en 40:00 geldig, 40:01 ongeldig, afronding zoals het blad.</p>`,
  };
}

// ── 34 ──────────────────────────────────────────────────────────────────────

function h34Koersen(g: Gegevens): Chapter {
  const r = g.rates;
  return {
    number: 34,
    title: "Wisselkoersen van de voorkeurslaag",
    what: "Wat het model voor een voorkeur betaalt, in urenminuten per week",
    body: r
      ? `
<p>Zelfde munt als hoofdstuk 12: minuten per week afwijking van 40:00 in één basisrooster. Pakket: ${r.package.dutyDays} dienstdagen,
${r.package.dayDuties} dagachtige diensten, ${r.package.freeWeekends} vrije weekenden, ${r.package.nights} nachten.</p>
${tabel({
  columns: [{ head: "Gebeurtenis" }, { head: "Robuust (v3)", numeric: true }, { head: "Urenmunt", numeric: true }, { head: "CP-SAT op pariteit", numeric: true }],
  rows: Object.values(r.events as Record<string, Json>).map((e) => [escape(String(e.label)), nummer(e.robust, 4), `${nummer(e.minutesPerWeek, 2)} min/w`, nummer(e.cpsatParity, 0)]),
  note: "Formules in exchange-rates.json. Een losse nacht kost CP-SAT in Evenwichtig 900; het model rekent er op pariteit ruim 24 000 voor.",
})}
${
  r.empiricalCheck
    ? blok(
        `Empirische controle op het officiële rooster: ${escape(String(r.empiricalCheck.swap))}. Affiniteit ${nummer(r.empiricalCheck.affinityBefore, 4)} → ${nummer(r.empiricalCheck.affinityAfter, 4)} (precies +0,4/223, zoals de formule), maar ${escape(Object.entries(r.empiricalCheck.otherComponentsChanged as Record<string, number>).filter(([, v]) => v !== 0).map(([k, v]) => `${({ hours: "uren", flow: "regelmaat", rest: "rust", nights: "nachten", fairness: "eerlijkheid" } as Record<string, string>)[k] ?? k} ${v > 0 ? "+" : ""}${String(v).replace(".", ",")}`).join(", ") || "geen ander onderdeel verandert")}: deze ene ruil kost netto (robuust ${nummer(r.empiricalCheck.robustBefore, 1)} → ${nummer(r.empiricalCheck.robustAfter, 1)}). Voorkeur weegt licht tegen uren; dat is de opgegeven prioriteit.`,
        "info",
      )
    : ""
}
${blok("Gevolg: op volle pariteit met de uren zou CP-SAT nachten ruilen voor voorkeur, omdat CP-SAT nachten ~27× lichter weegt dan het model. Daarom is vóór de eerste uitslag schaal 1/3 aan de kandidaten van regel M2 toegevoegd (decision-rules.json, 'amended').", "warn")}`
      : ontbreekt("exchange-rates.json"),
  };
}

// ── 35 ──────────────────────────────────────────────────────────────────────

/** Het verschil van één maat uit een beslisbestand, als tekst. */
function verschilUit(d: Json | null, key: string): string {
  const v = d?.differences?.[key]?.delta;
  return typeof v === "number" ? verschil(v, 1) : "—";
}

/** De verkennende run (schaal 1/3 in de volledige zoekmachine) tegen M1; beslist niets. */
function verkenning(g: Gegevens): string {
  if (!g.explore || !g.m1) return ontbreekt("phases/mp-x13-BALANCED.json");
  const a = g.m1.means as Json;
  const b = g.explore.means as Json;
  const d = (k: string, dec = 1) => (typeof a[k] === "number" && typeof b[k] === "number" ? verschil(b[k] - a[k], dec) : "—");
  return `<p><strong>Verkennend, niet beslissend:</strong> dezelfde zoekmachine als M1 met de CP-SAT-voorkeur op schaal 1/3
(fase <code>mp-x13</code>, drie Evenwichtig-runs). Tegen M1: voorkeur ${d("preference")}, dagdiensten ${d("dayDuties")}, affiniteit
${d("affinity")}; losse nachten ${d("singletons", 2)}, reeksen van twee ${d("pairs", 2)}, rust ${d("rest")}, eerlijkheid ${d("fairness")},
slechtste regel ${d("worstLineV2")}, populaire diensten eerlijk verdeeld ${d("popularFairness")}. Het bijschaven verdient de nachtkosten
van de solver deels terug (slechtste nachtuitgang ${d("worstNightExit")}), maar de grootste nieuwe prijs is de verdeling van populaire
diensten: de aflopers en extreem vroege diensten schuiven naar het profiel dat ze het liefst heeft — precies het monopolie dat de
werkopdracht uitsluit. De affiniteitsterm in CP-SAT mist een tegenwicht voor populaire-diensteneerlijkheid. Deze run verandert geen
besluit; hij is onderbouwing voor een menselijke vervolgkeuze.</p>`;
}

/** Poort 7 formeel groen maar niet "duidelijk beter": dat hoort er eerlijk bij. */
function poort7(p: Json): string {
  const x = (p.gates as Json[]).find((q) => q.nr === 7 && String(q.label).startsWith("Voorkeur"));
  if (!x || !x.pass || !x.ci95 || x.ci95[0] >= 1) return "";
  return blok(
    `Poort 7 is formeel groen (interval [${nummer(x.ci95[0], 2)}; ${nummer(x.ci95[1], 2)}] ligt boven nul), maar +${nummer(x.after - x.before, 2)} punt op 100 is niet "duidelijk beter" zoals de werkopdracht vraagt; de vooraf vastgelegde operationalisering (interval boven nul) was zwakker dan die bedoeling. Bovendien komt de winst niet uit voorkeursintelligentie — beide voorkeursmechanismen staan uit — maar als bijeffect van de harde laag: de vrijdageis verbetert het weekendbegin, en er liggen iets minder dagdiensten verkeerd. Dit is geen vooruitgang in machinistenvoorkeur en wordt ook niet zo gepresenteerd.`,
    "warn",
  );
}

function beslissing(d: Json | null, regel: string): string[] {
  if (!d) return [regel, "—", "NOG NIET GEGENEREERD"];
  return [regel, escape(String(d.question ?? "")), `<strong>${escape(String(d.decision))}</strong>${d.reason ? ` — ${escape(String(d.reason))}` : ""}`];
}

function h35AB(g: Gegevens): Chapter {
  const d = g.decisions;
  const fasen = [
    { head: "baseline (Evenwichtig)", m: g.baselineBalanced },
    { head: "M1 harde laag", m: g.m1 },
    { head: "M2 + model v3", m: g.m2 },
    { head: "verkennend: + CP-SAT-voorkeur × 1/3 (beslist niets)", m: g.explore },
  ];
  const keys = [
    ["preference", "Voorkeur (v3)"],
    ["affinity", "Affiniteit"],
    ["restDuties", "Geen restbak"],
    ["dayDuties", "Dagdiensten"],
    ["popularFairness", "Populair eerlijk"],
    ["singletons", "Losse nachten"],
    ["pairs", "Reeksen van twee"],
    ["worstNightExit", "Slechtste nachtuitgang"],
    ["rest", "Rust"],
    ["worstLineV2", "Slechtste regel (v2)"],
    ["hours", "Uren"],
    ["fairness", "Eerlijkheid"],
    ["operationalViolations", "Operationele overtredingen"],
  ];
  return {
    number: 35,
    title: "A/B, beslissingen en afgewezen experimenten",
    what: "Vooraf vastgelegde regels, mechanisch toegepast; wat niet werkte",
    body: `
<p>De beslisregels M0–M5 zijn vastgelegd vóór de eerste uitslag (<code>decision-rules.json</code>) en worden door
<code>scripts/machinist/decide.ts</code> toegepast. De A/B draaide uit een bevroren codekopie
(<code>ns-roosterplatform-mp</code>), omdat CP-SAT het Python-model bij elke oplossing opnieuw leest.</p>
${tabel({ columns: [{ head: "Regel" }, { head: "Vraag" }, { head: "Uitkomst" }], rows: [beslissing(d.m0, "M0"), beslissing(d.m1, "M1"), beslissing(d.m2, "M2"), beslissing(d.m3, "M3")] })}
${g.m1 && g.m2 && g.explore && g.baselineBalanced ? "" : ontbreekt("een of meer A/B-fasen (brain-after-BALANCED, mp-m1, mp-m2, mp-x13)")}
<div class="wide">${tabel({
  caption: "Drie Evenwichtig-runs per stap (baseline: tien)",
  columns: [{ head: "Maat" }, ...fasen.map((f) => ({ head: f.head, numeric: true }))],
  rows: keys.map(([k, l]) => [escape(l), ...fasen.map((f) => (f.m ? nummer(f.m.means?.[k] ?? null, k === "singletons" || k === "pairs" || k === "operationalViolations" ? 2 : 1) : "—"))]),
})}</div>
<h3>Waarom beide voorkeursmechanismen uit staan</h3>
<p><strong>M1 — model v3 in rangschikking en bijschaven.</strong> De voorkeur steeg ${verschilUit(d.m1, "preference")} punt (drempel 2), met
dagdiensten ${verschilUit(d.m1, "dayDuties")}, geen restbak ${verschilUit(d.m1, "restDuties")} en populair eerlijk
${verschilUit(d.m1, "popularFairness")}; de slechtste nachtuitgang verbeterde zelfs (${verschilUit(d.m1, "worstNightExit")}). Maar de slechtste
regel volgens v2 zakte ${verschilUit(d.m1, "worstLineV2")} tegen een marge van 1. Mogelijk speelt ruis mee — de referentie M1 lag op dit punt
opvallend hoog — maar er is ook een mechanisme: de regelscore van v3 telt affiniteit mee, dus rangschikken op v3 kiest andere regels dan v2
als slechtste zou zien. De regel zegt bij twijfel: uit.</p>
<p><strong>M2 — voorkeurstermen in CP-SAT.</strong> Op de ruwe solveruitkomst deden de termen precies wat ze moesten voor de voorkeur
(dagdiensten van ongeveer 66 naar 96, affiniteit van 66 naar 78), maar geen enkele schaal bleef binnen de marges: op 1/3 kwamen er losse
nachten en reeksen van twee bij en zakte rust 3 punten, op 1 en 3 zakte vooral eerlijkheid, 6 tot 10 punten. De nieuwe kostenposten
verdringen wat in CP-SAT relatief licht weegt. Voor nachten is dat gemeten (een losse nacht weegt in CP-SAT ~27× lichter dan in het model);
voor eerlijkheid is die verhouding niet gemeten. Schaal 0; M3 verviel daarmee.</p>
${verkenning(g)}
<h3>Wat niet werkte of niet klopte</h3>
<ul>
<li><strong>Normalisering per regel</strong> voor dagdiensten. Gekozen met een getal (0,20 tegen 0,22) dat niet op alle dagachtige diensten
was berekend. Gemeten: per profiel 0,213, per regel 0,246. Vervangen door per profiel, de letterlijke opdracht.</li>
<li><strong>"Voor Vroeg/Laat is het andersom"</strong> — een oude toets zei dat Vroeg/Laat een vroege late liever heeft dan een afloper. Dat
staat niet in de invoer (die zegt: relatief beter dan bij Laat). De toets is herschreven naar de vergelijking tussen profielen.</li>
<li><strong>Testopzetten</strong> die om de verkeerde reden faalden: late diensten van acht uur maakten "LLLLARR" ook te lang (41:00), en een
afloper van 8:59 tegen een late van 8:00 liet de urenbalans terecht van de affiniteit winnen. Beide opzetten zijn gelijkgetrokken; de
correctie staat in de toets.</li>
<li><strong>Dubbele schaal</strong> in de eerste meting van de slechtste nachtuitgang (×100 op een waarde die al 0–100 was): 3 917 in plaats
van 39,2. Gevonden doordat de baseline de Final-Brain-AFTER exact moest reproduceren.</li>
</ul>`,
  };
}

// ── 36 ──────────────────────────────────────────────────────────────────────

/** De testbatterij van deze ronde, met de verklaring per rode suite. */
function testbatterij(g: Gegevens): string {
  const t = g.tests;
  if (!t) return ontbreekt("test-results.json");
  const suites = t.suites as Json[];
  const noten = (g.testNotes?.notes as Json[] | undefined) ?? [];
  return `${tabel({
    caption: `${suites.filter((s) => s.ok).length} van ${suites.length} suites geslaagd`,
    columns: [{ head: "Suite" }, { head: "Uitslag" }, { head: "Seconden", numeric: true }],
    rows: suites.map((s) => [escape(String(s.name)), s.ok ? '<span class="ok">geslaagd</span>' : '<span class="bad">GEFAALD</span>', nummer(s.seconds, 0)]),
  })}
${noten.map((n) => blok(`<strong>${escape((n.suites as string[]).join(", "))} — ${escape(String(n.status))}.</strong> ${escape(String(n.cause))}`, String(n.status).startsWith("GEFAALD") ? "bad" : "info")).join("\n")}`;
}

function h36Poorten(g: Gegevens): Chapter {
  const p = g.gates;
  return {
    number: 36,
    title: "Poorten en reviewpakketten",
    what: "AFTER tegen de baseline; pakketten alleen als alles groen is",
    body: p
      ? `
<p>AFTER: ${p.after.candidates} kandidaten (fase <code>${escape(String(p.after.phase))}</code>) tegen de baseline (${p.before.candidates}).
${p.sameModel ? "Zelfde modelvingerafdruk." : "<strong>Let op: verschillende modelvingerafdruk.</strong>"}</p>
<div class="wide">${tabel({
  columns: [{ head: "#", numeric: true }, { head: "Poort" }, { head: "Baseline", numeric: true }, { head: "AFTER", numeric: true }, { head: "95%-interval" }, { head: "Uitslag" }],
  rows: (p.gates as Json[]).map((x) => [String(x.nr), escape(String(x.label)), x.before === null ? "n.v.t." : nummer(x.before, 2), x.after === null ? "n.v.t." : nummer(x.after, 2), x.ci95 ? `[${nummer(x.ci95[0], 2)}; ${nummer(x.ci95[1], 2)}]` : "", x.pass ? '<span class="ok">groen</span>' : '<span class="bad">GEFAALD</span>']),
})}</div>
${
  p.allGreen
    ? g.packages
      ? blok(`Alle ${p.total} poorten groen. De drie reviewpakketten staan in <code>final-candidates/</code>; daarna is gestopt, zonder verder bijstellen.`, "ok")
      : ontbreekt("final-candidates/selection.json")
    : blok(`${p.green} van ${p.total} poorten groen. Volgens regel M5 zijn er géén reviewpakketten gemaakt.`, "bad")
}
${poort7(p)}
<h3>Testbatterij</h3>
${testbatterij(g)}
<h3>Wat deze ronde wél heeft opgeleverd</h3>
<ul>
<li>De operationele eisen van de gebruiker gelden nu hard in de zoekmachine: elke kandidaat van de AFTER voldoet (was 4 van 60), zonder
meetbare prijs in nachten, rust of de slechtste regel — wél zakte eerlijkheid 0,55 punt, net over de marge van poort 6.</li>
<li>Een kwaliteitsmodel (v3) dat voorkeur meetbaar en uitlegbaar maakt, met adversariële toetsen. Het officiële rooster scoort er hoger op
dan de baseline en de aangenomen configuratie; alleen de verkennende run met CP-SAT-voorkeur komt erboven, en die doet dat met een
scheve verdeling van populaire diensten.</li>
<li>Een gemeten richting voor de volgende stap: de voorkeurstermen in CP-SAT werken voor affiniteit en dagdiensten, maar vragen twee
tegenwichten die er nu niet zijn — de nachtweging in CP-SAT op pariteit met het model, en eerlijkheid van populaire diensten in CP-SAT.
Dat is een menselijke keuze, geen automatische bijstelling.</li>
</ul>`
      : ontbreekt("gates.json"),
  };
}

export function machinistChapters(g: Gegevens = laadMachinist()): Chapter[] {
  return [h24Model(g), h25Vroeg(g), h26Laat(g), h27Aantrekkelijk(g), h28Blootstelling(g), h29Rangeer(g), h30Weekend(g), h31Reeksen(g), h32Nachten(g), h33Uren(g), h34Koersen(g), h35AB(g), h36Poorten(g)];
}
