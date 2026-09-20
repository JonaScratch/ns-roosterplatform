import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import {
  ADJACENT_TRANSITION_PENALTY,
  HUMAN_ADJACENT_TRANSITION_PENALTY,
  HUMAN_OVER_ONE_OFF_DAY_PENALTY,
  OVER_ONE_OFF_DAY_PENALTY,
  OVER_TWO_OFF_DAYS_PENALTY,
  type TransitionCategory,
} from "@/domain/roster-quality-config";
import { type ObjectiveWeights, STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";
import { humanNightExitTables } from "@/server/optimizer/night-exit-tables";
import { ADAPTIVE_CONFIG } from "@/server/generation/adaptive/config";

/**
 * Wisselkoersen: wat het roosterbrein feitelijk ruilt.
 *
 * ## Twee helften met elk een eigen koers
 *
 * De CP-SAT-solver bouwt de structuur van een pakket: waar de nachtreeksen
 * liggen, welke rosters welke diensten krijgen. Zijn doelfunctie is lineair,
 * dus de prijs van een gebeurtenis ís zijn coëfficiënt: exact, geen schatting.
 * Het bijschaven en de rangschikking sturen daarna op kwaliteitsmodel v2. Dat
 * model is niet lineair; hier staan zijn marginale effecten, analytisch
 * uitgerekend op de grootte van het Dordrechtse pakket, met de formule erbij.
 *
 * Alles wordt uitgedrukt in één munt: minuten per week afwijking van het
 * urengemiddelde van één basisrooster. Dat is de munt waarin de solver het
 * meest betaalt, en de munt waarin mensen het verschil tussen roosters zien.
 *
 *   npm run final-brain:exchange-rates
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "v1.0.4-final-brain");

type Tabel = Readonly<Record<TransitionCategory, Readonly<Record<TransitionCategory, number>>>>;

interface Tabellen {
  readonly naam: string;
  readonly adjacent: Tabel;
  readonly overOffDay: Tabel;
  readonly overTwoOffDays: Tabel | null;
}

const KLASSIEK: Tabellen = { naam: "v1.0.4 bevroren (klassieke tabel)", adjacent: ADJACENT_TRANSITION_PENALTY, overOffDay: OVER_ONE_OFF_DAY_PENALTY, overTwoOffDays: null };
const MENSELIJK: Tabellen = { naam: "menselijk ritme, schaal 1 (H05)", adjacent: HUMAN_ADJACENT_TRANSITION_PENALTY, overOffDay: HUMAN_OVER_ONE_OFF_DAY_PENALTY, overTwoOffDays: OVER_TWO_OFF_DAYS_PENALTY };

interface Gebeurtenis {
  readonly key: string;
  readonly label: string;
  readonly herstel?: string;
  readonly kosten: (w: ObjectiveWeights, t: Tabellen) => number;
  readonly formule: string;
}

const pt = (t: Tabel, van: TransitionCategory, naar: TransitionCategory) => t[van][naar];

/** De gebeurtenissen uit de werkopdracht (§16), plus wat nodig is om ze te lezen. */
const GEBEURTENISSEN: readonly Gebeurtenis[] = [
  { key: "singleton", label: "Losse nacht", kosten: (w) => w.nightSingleton, formule: "nightSingleton" },
  { key: "pair", label: "Reeks van twee nachten", kosten: (w) => w.nightPair, formule: "nightPair" },
  {
    key: "exitRL",
    label: "Nachtreeks → 1 vrije dag → laat",
    herstel: "± 32 u",
    kosten: (w, t) => pt(t.overOffDay, "NIGHT", "LATE") * w.transitions,
    formule: "overOffDay[N][L] × transitions",
  },
  {
    key: "exitRE",
    label: "Nachtreeks → 1 vrije dag → vroeg",
    herstel: "± 24 u",
    kosten: (w, t) => pt(t.overOffDay, "NIGHT", "EARLY") * w.transitions,
    formule: "overOffDay[N][E] × transitions",
  },
  {
    key: "exitRRE",
    label: "Nachtreeks → 2 vrije dagen → vroeg",
    herstel: "± 48 u (boven de regel)",
    kosten: (w, t) => (t.overTwoOffDays ? pt(t.overTwoOffDays, "NIGHT", "EARLY") : 0) * w.transitions,
    formule: "overTwoOffDays[N][E] × transitions",
  },
  {
    key: "exitRRL",
    label: "Nachtreeks → 2 vrije dagen → laat (menselijk)",
    herstel: "± 56 u",
    kosten: (w, t) => (t.overTwoOffDays ? pt(t.overTwoOffDays, "NIGHT", "LATE") : 0) * w.transitions,
    formule: "overTwoOffDays[N][L] × transitions",
  },
  { key: "lateEarly", label: "Laat direct gevolgd door vroeg", kosten: (w, t) => pt(t.adjacent, "LATE", "EARLY") * w.transitions, formule: "adjacent[L][E] × transitions" },
  {
    key: "oscELE",
    label: "Heen-en-weer vroeg → laat → vroeg (direct)",
    kosten: (w, t) => (pt(t.adjacent, "EARLY", "LATE") + pt(t.adjacent, "LATE", "EARLY")) * w.transitions,
    formule: "(adjacent[E][L] + adjacent[L][E]) × transitions",
  },
  {
    key: "oscNLN",
    label: "Nacht → dag → nacht (direct, laat ertussen)",
    kosten: (w, t) => (pt(t.adjacent, "NIGHT", "LATE") + pt(t.adjacent, "LATE", "NIGHT")) * w.transitions,
    formule: "(adjacent[N][L] + adjacent[L][N]) × transitions",
  },
  {
    key: "oscENE",
    label: "Vroeg → nacht → vroeg (direct)",
    kosten: (w, t) => (pt(t.adjacent, "EARLY", "NIGHT") + pt(t.adjacent, "NIGHT", "EARLY")) * w.transitions,
    formule: "(adjacent[E][N] + adjacent[N][E]) × transitions",
  },
  { key: "restMinute", label: "Eén minuut minder dan comfortabele rust", kosten: (w) => w.restComfort, formule: "restComfort" },
  { key: "startJitterMinute", label: "Eén minuut begintijdsprong boven het vrije uur", kosten: (w) => w.startJitter, formule: "startJitter (adaptief: " + String(ADAPTIVE_CONFIG.humanRhythm.startJitterWeight) + ")" },
];

/** Eén minuut per week in één rooster: `hoursBalance × 60` (cyclusminuten × round(w·60/weken) × weken). */
const urenMinuut = (w: ObjectiveWeights) => w.hoursBalance * 60;

// ── Het kwaliteitsmodel (bijschaven en rangschikking) ────────────────────────

interface Pakket {
  readonly rosters: number;
  readonly nights: number;
  readonly nightBlocks: number;
  readonly workedDays: number;
}

function evaluatorKoersen(p: Pakket) {
  const m = QUALITY_MODEL_V2;
  const c = m.components;
  const r = m.robust.overallWeight;
  const blok = c.nights.parts.blocks.valueByLength as Record<number, number>;
  // Uren: één minuut per week in één rooster, binnen de band van het contractdeel.
  const uren = r * c.hours.weight * c.hours.parts.contract.weight * (100 / c.hours.parts.contract.zeroAtMinutes) / p.rosters;
  // Losse nacht: één nacht uit een reeks van vier los gemaakt (4 → 3 + 1).
  const los = (r * c.nights.weight * c.nights.parts.blocks.weight * 100 * (blok[3] * 3 + blok[1] * 1 - blok[4] * 4)) / p.nights;
  // Reeks van twee: een reeks van vijf gesplitst in drie en twee.
  const paar = (r * c.nights.weight * c.nights.parts.blocks.weight * 100 * (blok[3] * 3 + blok[2] * 2 - blok[5] * 5)) / p.nights;
  // Uitgang onder de regel: één van de reeksen van 1 naar 0, plus het herstel in rust (band ≥ 0,6 → 0).
  const uitgang = -(r * c.nights.weight * c.nights.parts.exit.weight * 100) / p.nightBlocks - (r * c.rest.weight * c.rest.parts.recovery.weight * 100 * 0.6) / p.nightBlocks;
  // Is het de slechtste uitgang van het pakket, dan komt het slechtste geval erbij (H10).
  const slechtsteGeval = -m.robust.worstCase.nightExitPoints;
  // Laat → vroeg direct (echte wissel): 4 strafpunten in regelmaat, één zware overgang in rust.
  const straf = c.flow.parts.penalty;
  const zwaar = c.rest.parts.heavy;
  const laatVroeg =
    -(r * c.flow.weight * straf.weight * 100 * (4 / p.workedDays) / straf.zeroAtPointsPerWorkedDay) -
    (r * c.rest.weight * zwaar.weight * 100 * ((100 / p.workedDays) / zwaar.zeroAtPer100WorkedDays));
  // Heen-en-weer: één geval, plus de strafpunten van beide wissels.
  const osc = c.flow.parts.oscillation;
  const heenEnWeer =
    -(r * c.flow.weight * osc.weight * 100 * ((100 / p.workedDays) / osc.zeroAtPer100WorkedDays)) -
    (r * c.flow.weight * straf.weight * 100 * (5 / p.workedDays) / straf.zeroAtPointsPerWorkedDay) -
    (r * c.rest.weight * zwaar.weight * 100 * ((100 / p.workedDays) / zwaar.zeroAtPer100WorkedDays));
  return {
    hoursPerMinutePerWeek: uren,
    events: {
      singleton: los,
      pair: paar,
      exitBelowRule: uitgang,
      exitBelowRuleWorst: uitgang + slechtsteGeval,
      lateEarly: laatVroeg,
      oscillation: heenEnWeer,
    },
    formulas: {
      hours: "0,85 × w_uren × 0,75 × (100/60) / aantal roosters",
      singleton: "0,85 × w_nachten × 0,7 × 100 × (0,9·3 + 0·1 − 0,95·4) / nachten",
      pair: "0,85 × w_nachten × 0,7 × 100 × (0,9·3 + 0,4·2 − 1·5) / nachten",
      exitBelowRule: "0,85 × (w_nachten × 0,3 × 100 + w_rust × 0,25 × 100 × 0,6) / nachtreeksen",
      exitBelowRuleWorst: "idem, plus 1,5 als het de slechtste uitgang van het pakket is (slechtste geval, H10)",
      lateEarly: "0,85 × (w_regelmaat × 0,2 × 100 × (4/gewerkte dagen)/0,5 + w_rust × 0,15 × 100 × (100/gewerkte dagen)/5)",
      oscillation: "0,85 × w_regelmaat × (0,15 × 100 × (100/gewerkt)/5 + 0,2 × 100 × (5/gewerkt)/0,5) + zware overgang in rust",
    },
  };
}

// ── Uitvoer ─────────────────────────────────────────────────────────────────

const f = (x: number, d = 2) => x.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
const tijd = (minuten: number) => (minuten >= 1 ? `${f(minuten, minuten >= 10 ? 0 : 1)} min/week` : `${f(minuten * 60, 0)} s/week`);

function main() {
  const features = JSON.parse(readFileSync(path.join(WORTEL, "docs", "human-roster-benchmark", "official-features.json"), "utf8"));
  const pakket: Pakket = {
    rosters: features.rosters.length,
    nights: Object.entries(features.overall.nightBlocks.lengths as Record<string, number>).reduce((s, [l, n]) => s + Number(l) * n, 0),
    nightBlocks: Object.values(features.overall.nightBlocks.lengths as Record<string, number>).reduce((s, n) => s + n, 0),
    workedDays: features.overall.workedDays,
  };
  const schaal = (ADAPTIVE_CONFIG.humanRhythm as { nightExitScale?: number }).nightExitScale ?? 1;
  const tabellen: Tabellen[] = [KLASSIEK, MENSELIJK, ...(schaal !== 1 ? [{ ...humanNightExitTables(schaal), naam: `menselijk ritme, nachtrij × ${schaal} (huidig)` }] : [])];
  const strategieen = ["BALANCED", "REST_QUALITY", "FAIR_BURDEN"] as const;

  const cpsat = strategieen.map((s) => {
    const w = STRATEGY_WEIGHTS[s];
    return {
      strategy: s,
      hoursUnitPerMinutePerWeek: urenMinuut(w),
      hoursWorstPerMinutePerWeek: w.hoursWorst,
      tables: tabellen.map((t) => ({
        tables: t.naam,
        events: GEBEURTENISSEN.map((g) => {
          const kosten = g.kosten(w, t);
          return { key: g.key, label: g.label, recovery: g.herstel ?? null, cost: kosten, minutesPerWeek: kosten / urenMinuut(w), formula: g.formule };
        }),
      })),
    };
  });
  const evaluator = evaluatorKoersen(pakket);

  mkdirSync(MAP, { recursive: true });
  writeFileSync(
    path.join(MAP, "objective-exchange-rates.json"),
    `${JSON.stringify({ schema: "ns-exchange-rates/1", computedAt: new Date().toISOString(), package: pakket, cpsat, evaluator, qualityModel: QUALITY_MODEL_V2.version }, null, 2)}\n`,
  );

  const B = cpsat[0];
  const regels: string[] = [];
  regels.push("# Wisselkoersen van het roosterbrein");
  regels.push("");
  regels.push("*Gegenereerd door `npm run final-brain:exchange-rates` uit `objective-weights.ts`, de overgangstabellen en kwaliteitsmodel v2. Niets hieronder is met de hand ingevuld.*");
  regels.push("");
  regels.push("## De munt");
  regels.push("");
  regels.push(
    `De CP-SAT-solver betaalt per minuut afwijking van het urengemiddelde van een basisrooster. Omgerekend naar **één minuut per week in één rooster** kost dat \`hoursBalance × 60\` = **${B.hoursUnitPerMinutePerWeek}** (Evenwichtig), onafhankelijk van de cycluslengte; het slechtste rooster kost daarbovenop ${B.hoursWorstPerMinutePerWeek} per minuut per week. Alle koersen hieronder zijn die munt: hoeveel minuten per week urenbalans in één rooster de solver opgeeft om een gebeurtenis te vermijden — of andersom, hoeveel urenwinst hem een gebeurtenis waard is.`,
  );
  regels.push("");
  regels.push("De doelfunctie is lineair, dus deze koersen zijn exact de marginale kosten, geen schatting.");
  regels.push("");
  for (const s of cpsat) {
    regels.push(`## CP-SAT, strategie ${s.strategy} (1 min/week = ${s.hoursUnitPerMinutePerWeek})`);
    regels.push("");
    regels.push(`| Gebeurtenis | Herstel | ${s.tables.map((t) => t.tables).join(" | ")} |`);
    regels.push(`| --- | --- | ${s.tables.map(() => "---:").join(" | ")} |`);
    for (const [i, g] of GEBEURTENISSEN.entries()) {
      regels.push(`| ${g.label} | ${g.herstel ?? ""} | ${s.tables.map((t) => `${f(t.events[i].cost, 0)} = ${tijd(t.events[i].minutesPerWeek)}`).join(" | ")} |`);
    }
    regels.push("");
  }
  const klassiek = B.tables[0].events;
  const menselijk = B.tables[1].events;
  const huidig = B.tables[B.tables.length - 1];
  const e = (lijst: typeof klassiek, key: string) => lijst.find((x) => x.key === key)!;
  regels.push("## Wat het brein feitelijk ruilt (Evenwichtig)");
  regels.push("");
  regels.push(`- CP-SAT accepteert één **losse nacht** als dat ongeveer **${tijd(e(klassiek, "singleton").minutesPerWeek)}** urenbalans in één rooster oplevert.`);
  regels.push(`- Een **reeks van twee nachten**: ${tijd(e(klassiek, "pair").minutesPerWeek)}.`);
  regels.push(`- Een **nachtuitgang onder 46 uur** (nacht → vrij → laat): ${tijd(e(klassiek, "exitRL").minutesPerWeek)} in v1.0.4, ${tijd(e(menselijk, "exitRL").minutesPerWeek)} met de menselijke tabel${B.tables.length > 2 ? `, ${tijd(e(huidig.events, "exitRL").minutesPerWeek)} nu (${huidig.tables})` : ""}.`);
  regels.push(`- **Laat direct gevolgd door vroeg**: ${tijd(e(klassiek, "lateEarly").minutesPerWeek)}.`);
  regels.push(`- **Heen-en-weer vroeg → laat → vroeg**: ${tijd(e(klassiek, "oscELE").minutesPerWeek)}.`);
  regels.push("");
  regels.push(
    "Ter vergelijking: de zeven menselijke roosters wijken per rooster 1 tot 48 minuten per week af van 40:00 (BLM 39:12). De solver behandelt elke minuut daarvan als duurder dan de meeste ritmegebeurtenissen.",
  );
  regels.push("");
  regels.push("## Het kwaliteitsmodel (bijschaven en rangschikking)");
  regels.push("");
  regels.push(
    `Marginale effecten op de robuuste score, analytisch, op de grootte van het Dordrechtse pakket (${pakket.rosters} roosters, ${pakket.nights} nachten in ${pakket.nightBlocks} reeksen, ${pakket.workedDays} gewerkte dagen). Effecten op de slechtste regel komen erbovenop.`,
  );
  regels.push("");
  regels.push("| Gebeurtenis | Robuust | In urenmunt | Formule |");
  regels.push("| --- | ---: | ---: | --- |");
  regels.push(`| Eén minuut/week uren in één rooster | ${f(-evaluator.hoursPerMinutePerWeek, 3)} | 1 min/week | ${evaluator.formulas.hours} |`);
  const labels: Record<string, string> = {
    singleton: "Losse nacht (4 → 3 + 1)",
    pair: "Reeks van twee (5 → 3 + 2)",
    exitBelowRule: "Nachtuitgang onder de herstelregel",
    exitBelowRuleWorst: "… en het is de slechtste van het pakket",
    lateEarly: "Laat direct gevolgd door vroeg",
    oscillation: "Heen-en-weer op de klok",
  };
  for (const [key, waarde] of Object.entries(evaluator.events)) {
    regels.push(`| ${labels[key]} | ${f(waarde, 2)} | ${tijd(-waarde / evaluator.hoursPerMinutePerWeek)} | ${(evaluator.formulas as Record<string, string>)[key]} |`);
  }
  regels.push("");
  regels.push("## Wat dat betekent");
  regels.push("");
  const verhouding = (-evaluator.events.exitBelowRule / evaluator.hoursPerMinutePerWeek) / e(klassiek, "exitRL").minutesPerWeek;
  regels.push(
    `De twee helften van het brein ruilen tegen koersen die ordes van grootte uiteenlopen. Voor een nachtuitgang onder de regel rekent het kwaliteitsmodel ongeveer ${tijd(-evaluator.events.exitBelowRule / evaluator.hoursPerMinutePerWeek)} urenbalans; de solver in v1.0.4 ${tijd(e(klassiek, "exitRL").minutesPerWeek)} — een factor ${f(verhouding, 0)}. Het bijschaven kan zo'n uitgang niet herstellen: rustdagen liggen vast in de structuur, en een nachtreeks verplaatsen kan niet met losse ruilen zonder hem onderweg te breken. Wie waar de nachtreeksen legt, beslist de solver — tegen zijn eigen koers.`,
  );
  regels.push("");
  writeFileSync(path.join(MAP, "objective-exchange-rates.md"), `${regels.join("\n")}\n`);
  console.log(regels.join("\n"));
}

main();
