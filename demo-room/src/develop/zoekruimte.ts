import { HOLDOUT_MARGE, REGRESSIEMARGE, VEILIGHEIDSDIMENSIES, VERBETERMARGE } from "../proof/decision";
import { genereerTests, gelijkenis, heeftGrammatica } from "./diagnostischeTests";
import { OPERATOREN, OPERATOR_VOLGORDE, klasseVan, leesSleutel, semantischeSleutel, sleutelVan, type Faalwijze, type InterventieKlasse, type Operator } from "./interventies";
import type { Les } from "./lessons";

/**
 * De regisseur van een lange run: de zoekruimte groeit uit wat er geleerd is.
 *
 * ## Waarom (eindcontrole 20260930)
 *
 * De echte 6-uursrun stopte na 131,5 van 360 actieve minuten met
 * `ALLES_GEPROBEERD`: de drie vaste strategieën × de gemeten zwaktes waren op.
 * De masterprompt zegt wat er bij uitputting en stagnatie moet gebeuren (§55):
 * "changing strategy; widening hypothesis search; generating new unseen tests;
 * switching specialist; stopping that branch; escalating to Claude/human if a
 * new capability is required" — en een lange run is pas klaar als hij "for the
 * budgeted period" betekenisvolle cycli draaide.
 *
 * Dus: raakt de ruimte op (of stagneert de zoektocht), dan maakt de regisseur
 * een nieuwe GOLF. Een golf is begrensd en volledig uitlegbaar:
 *
 *  1. ANALYSE — per zwakte: welke faalwijzen de lessen laten zien (geen effect,
 *     bijwerking op een andere dimensie, holdout- of adversarialdaling, geen
 *     besluit), welke aanpak het dichtst bij winst kwam, en of de meting de
 *     hypothesen überhaupt kan onderscheiden.
 *  2. AANPAK — de "specialist": zwakste eerst, grootste hefboom, bijwerkingen
 *     eerst, of robuustheid eerst. Leverde de vorige golf niets op, dan wisselt
 *     de aanpak; dat bepaalt de volgorde van de zwaktes.
 *  3. VOORSTELLEN — samenstellingen van interventies (interventies.ts), elk
 *     met herkomst: uit welke les, om welke faalwijze, en wat er anders is dan
 *     de dichtstbijzijnde verworpen aanpak.
 *       - COMPOSITIE: een aanpak die het doel verbeterde maar een andere
 *         dimensie liet zakken, samen met de eis van die dimensie;
 *       - GERICHT: operatoren die op de gevonden faalwijze aangrijpen;
 *       - VERBREDING: pas als gericht zoeken niets nieuws meer oplevert, een
 *         nog niet geprobeerde interventieklasse;
 *       - MUTATIE: de laatste verworpen aanpak in een ander jasje — dit is de
 *         naïeve zet die de nieuwheidscontrole hoort te weigeren, en die
 *         weigering wordt vastgelegd.
 *  4. NIEUWHEID — geweigerd wordt: dezelfde sleutel als eerder voorgesteld
 *     (DUPLICAAT), een al verworpen aanpak (AL_VERWORPEN), dezelfde aanpak in
 *     een ander jasje (HERVERPAKT, semantische sleutel), een tekst die bijna
 *     gelijk is aan een verworpen kandidaat (TEKST_TE_GELIJK), of te lang voor
 *     de validator (TE_LANG).
 *  5. TESTS — waar de lessen laten zien dat de meting niet onderscheidt (een
 *     dimensie beweegt nooit, of springt in stappen van ≥ 25pp: een handvol
 *     items), nieuwe diagnostische tests (diagnostischeTests.ts).
 *
 * Levert een golf geen enkele nieuwe hypothese op, dan is dat geen succes maar
 * een capaciteitsgrens: de lange run stopt dan met `CAPACITEIT_BLOKKADE` en
 * zegt wat er nodig is (escalatie naar Claude/mens).
 *
 * Zuiver: geen bestanden, geen model, geen klok — de lange run legt alles in
 * zijn checkpoint vast.
 */

export type Aanpak = "ZWAKSTE_EERST" | "HEFBOOM" | "BIJWERKING_EERST" | "ROBUUSTHEID";
export const AANPAKKEN: readonly Aanpak[] = ["ZWAKSTE_EERST", "HEFBOOM", "BIJWERKING_EERST", "ROBUUSTHEID"];

export type HerkomstSoort = "STARTRUIMTE" | "COMPOSITIE" | "GERICHT" | "VERBREDING";
export type Weigering = "DUPLICAAT" | "AL_VERWORPEN" | "HERVERPAKT" | "TEKST_TE_GELIJK" | "TE_LANG";

export interface Hypothese {
  readonly id: string;
  readonly golf: number;
  readonly dimensie: string;
  readonly strategie: string;
  readonly semantisch: string;
  readonly familie: InterventieKlasse;
  readonly herkomst: {
    readonly soort: HerkomstSoort;
    readonly reden: string;
    readonly faalwijze: Faalwijze | null;
    readonly lesIds: readonly string[];
    /** De dichtstbijzijnde al verworpen aanpak op deze zwakte, en wat er anders is. */
    readonly verschil: { readonly tov: string | null; readonly toegevoegd: readonly string[]; readonly weggelaten: readonly string[] };
  };
}

export interface GegenereerdeTest {
  readonly id: string;
  readonly golf: number;
  readonly dimensie: string;
  readonly item: Readonly<Record<string, unknown>>;
  readonly herkomst: { readonly reden: string; readonly lesIds: readonly string[] };
}

export interface DimensieAnalyse {
  readonly dimensie: string;
  readonly pogingen: number;
  readonly faalwijzen: Readonly<Partial<Record<Faalwijze, number>>>;
  /** Andere dimensies die zakten, met hoe vaak. */
  readonly bijwerkingen: Readonly<Record<string, number>>;
  /** De les die het doel het meest verbeterde (ook als hij om iets anders verworpen werd). */
  readonly besteDeelwinst: { readonly lesId: string; readonly strategie: string; readonly delta: number } | null;
  readonly onvoldoendeDiscriminerend: boolean;
  readonly discriminatieReden: string | null;
}

export interface Golf {
  readonly nr: number;
  readonly op: string;
  readonly aanleiding: "START" | "POOL_UITGEPUT" | "STAGNATIE";
  /** De laatste cyclus vóór deze golf (0 = bij de start). */
  readonly naCyclus: number;
  readonly aanpak: Aanpak;
  readonly aanpakGewisseld: boolean;
  readonly aanpakReden: string;
  readonly volgorde: readonly string[];
  readonly hypothesen: readonly string[];
  readonly tests: readonly string[];
  readonly geweigerd: readonly { readonly dimensie: string; readonly strategie: string; readonly reden: Weigering; readonly detail: string }[];
  /** De lessen waarop deze golf gebouwd is. */
  readonly lesIds: readonly string[];
  readonly analyse: readonly DimensieAnalyse[];
  /** Dimensies waar nieuwe tests nodig waren maar geen testgrammatica bestaat: een capaciteitsgrens, eerlijk benoemd. */
  readonly testGaten: readonly string[];
  /** Dimensies met een behouden kandidaat: die wachten op een mens en krijgen geen nieuwe hypothesen. */
  readonly wachtOpMens?: readonly string[];
}

export interface Zoekstand {
  readonly golven: readonly Golf[];
  readonly hypothesen: readonly Hypothese[];
  readonly tests: readonly GegenereerdeTest[];
}

export interface Zoekgrenzen {
  readonly maxGolven: number;
  readonly maxHypothesenPerGolf: number;
  readonly maxTestsPerGolf: number;
  readonly maxTestsTotaal: number;
  /** Zoveel gemeten cycli op rij zonder KEEP/promotie/meer-bewijs binnen één golf = stagnatie. */
  readonly stagnatieVenster: number;
}

const verworpen = (l: Les) => l.verdict === "REJECT" || l.verdict === "VALIDATOR_REJECT";
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Wat ging er mis in deze les? Uit de gestructureerde delta's; oudere lessen via de redenen van de rechter. */
export function faalwijzenVan(l: Les): { readonly faalwijzen: readonly Faalwijze[]; readonly bijwerkingen: readonly string[] } {
  if (l.verdict === "VALIDATOR_REJECT") return { faalwijzen: ["VALIDATOR"], bijwerkingen: [] };
  if (l.verdict === "NEEDS_MORE_EVIDENCE") return { faalwijzen: ["ONBESLIST"], bijwerkingen: [] };
  if (l.verdict === "KEEP") return { faalwijzen: [], bijwerkingen: [] };
  const uit = new Set<Faalwijze>();
  const bij = new Set<string>();
  const veilig = VEILIGHEIDSDIMENSIES as readonly string[];
  if (l.deltas) {
    for (const [d, v] of Object.entries(l.deltas)) {
      if (d === l.dimensie || !Number.isFinite(v)) continue;
      if ((veilig.includes(d) && v < 0) || v < -REGRESSIEMARGE) bij.add(d);
    }
  } else {
    for (const r of l.redenen) {
      const m = /(?:veiligheidsdimensie (\w+) verslechtert|regressie op (\w+))/.exec(r);
      if (m && (m[1] ?? m[2]) !== l.dimensie) bij.add(m[1] ?? m[2]);
    }
  }
  if (bij.size > 0) uit.add("BIJWERKING");
  const holdoutDaalt = l.holdout ? l.holdout.kandidaat < l.holdout.basis - HOLDOUT_MARGE : l.redenen.some((r) => /^holdout .*slechter/.test(r));
  if (holdoutDaalt) uit.add("HOLDOUT_DALING");
  if (l.adversarial && l.adversarial.kandidaat < l.adversarial.basis) uit.add("ADVERSARIAL_DALING");
  if (l.deltaDoel === null || l.deltaDoel < VERBETERMARGE) uit.add("GEEN_EFFECT");
  return { faalwijzen: [...uit], bijwerkingen: [...bij] };
}

/** Alle waargenomen delta's van een dimensie, als doel én als bijwerking. */
function waargenomen(dimensie: string, lessen: readonly Les[]): number[] {
  const uit: number[] = [];
  for (const l of lessen) {
    if (l.dimensie === dimensie && typeof l.deltaDoel === "number") uit.push(l.deltaDoel);
    else if (l.deltas && typeof l.deltas[dimensie] === "number") uit.push(l.deltas[dimensie]);
  }
  return uit;
}

export function analyseer(dimensie: string, lessen: readonly Les[]): DimensieAnalyse {
  const hier = lessen.filter((l) => l.dimensie === dimensie);
  const faalwijzen: Partial<Record<Faalwijze, number>> = {};
  const bijwerkingen: Record<string, number> = {};
  let beste: DimensieAnalyse["besteDeelwinst"] = null;
  for (const l of hier) {
    const f = faalwijzenVan(l);
    for (const x of f.faalwijzen) faalwijzen[x] = (faalwijzen[x] ?? 0) + 1;
    for (const b of f.bijwerkingen) bijwerkingen[b] = (bijwerkingen[b] ?? 0) + 1;
    if (typeof l.deltaDoel === "number" && l.deltaDoel >= VERBETERMARGE && (!beste || l.deltaDoel > beste.delta)) beste = { lesId: l.id, strategie: l.strategie, delta: l.deltaDoel };
  }
  // Onderscheidt de meting de hypothesen? Twee signalen, beide uit de lessen:
  // de dimensie beweegt nooit (≥ 2 metingen, allemaal 0), of ze beweegt alleen
  // in grote stappen (de kleinste verandering ≥ 25pp: hooguit een paar items).
  const w = waargenomen(dimensie, lessen);
  const nietNul = w.filter((x) => Math.abs(x) > 1e-9).map(Math.abs);
  const korrel = nietNul.length > 0 ? Math.min(...nietNul) : null;
  let reden: string | null = null;
  if (w.length >= 2 && nietNul.length === 0) reden = `${w.length} metingen, geen enkele beweging: de meting onderscheidt de hypothesen niet`;
  else if (korrel !== null && korrel >= 25) reden = `kleinste waargenomen verandering ${r1(korrel)}pp: de dimensie hangt aan een handvol items`;
  return { dimensie, pogingen: hier.length, faalwijzen, bijwerkingen, besteDeelwinst: beste, onvoldoendeDiscriminerend: reden !== null, discriminatieReden: reden };
}

/** De eerste golf: de oorspronkelijke drie strategieën per dimensie. */
export function startGolf(dimensies: readonly string[], strategieen: readonly string[], op: string): { golf: Golf; hypothesen: Hypothese[] } {
  const hypothesen: Hypothese[] = [];
  for (const d of dimensies) {
    for (const s of strategieen) {
      hypothesen.push({
        id: `G1-${d}-${s}`,
        golf: 1,
        dimensie: d,
        strategie: s,
        semantisch: semantischeSleutel(s),
        familie: klasseVan(s),
        herkomst: { soort: "STARTRUIMTE", reden: "startruimte: de vaste eerste strategieën", faalwijze: null, lesIds: [], verschil: { tov: null, toegevoegd: [], weggelaten: [] } },
      });
    }
  }
  return {
    golf: {
      nr: 1,
      op,
      aanleiding: "START",
      naCyclus: 0,
      aanpak: "ZWAKSTE_EERST",
      aanpakGewisseld: false,
      aanpakReden: "start: zwakste gemeten dimensie eerst",
      volgorde: [],
      hypothesen: hypothesen.map((h) => h.id),
      tests: [],
      geweigerd: [],
      lesIds: [],
      analyse: [],
      testGaten: [],
    },
    hypothesen,
  };
}

/** De actieve pool per dimensie: de nieuwste golf eerst (de huidige prioriteit van de regisseur), dan de oudere. */
export function poolVoor(stand: Zoekstand, dimensie: string): readonly string[] {
  return [...stand.hypothesen]
    .filter((h) => h.dimensie === dimensie)
    .sort((a, b) => b.golf - a.golf)
    .map((h) => h.strategie);
}

export function volgordeVoor(aanpak: Aanpak, analyse: readonly DimensieAnalyse[], scores: Readonly<Record<string, number>>): string[] {
  const score = (d: string) => (typeof scores[d] === "number" ? scores[d] : Number.POSITIVE_INFINITY);
  const telling = (a: DimensieAnalyse, fs: readonly Faalwijze[]) => fs.reduce((n, f) => n + (a.faalwijzen[f] ?? 0), 0);
  const sleutel: Record<Aanpak, (a: DimensieAnalyse) => number> = {
    ZWAKSTE_EERST: (a) => score(a.dimensie),
    HEFBOOM: (a) => -(a.besteDeelwinst?.delta ?? -1),
    BIJWERKING_EERST: (a) => -telling(a, ["BIJWERKING"]),
    ROBUUSTHEID: (a) => -telling(a, ["HOLDOUT_DALING", "ADVERSARIAL_DALING"]),
  };
  // Eerst verkennen, dan verdiepen: een gemeten zwakte zonder enige poging
  // krijgt haar startruimte vóór een al geprobeerde zwakte een nieuwe golf
  // krijgt — anders verdiept de regisseur eindeloos dezelfde twee zwaktes
  // ("candidate diversity collapsing", §55).
  const onontgonnen = (a: DimensieAnalyse) => (a.pogingen === 0 ? 0 : 1);
  return [...analyse].sort((a, b) => onontgonnen(a) - onontgonnen(b) || sleutel[aanpak](a) - sleutel[aanpak](b) || score(a.dimensie) - score(b.dimensie)).map((a) => a.dimensie);
}

interface Voorstel {
  readonly dimensie: string;
  readonly strategie: string;
  readonly soort: HerkomstSoort | "MUTATIE";
  readonly faalwijze: Faalwijze | null;
  readonly reden: string;
  readonly lesIds: readonly string[];
}

const DOEL_OPERATOREN: readonly Operator[] = OPERATOR_VOLGORDE.filter((o) => OPERATOREN[o].wezenlijk && OPERATOREN[o].klasse !== "BEGRENZING");

function voorstellenVoor(a: DimensieAnalyse, lessen: readonly Les[], geprobeerd: readonly string[]): Voorstel[] {
  const d = a.dimensie;
  const hier = lessen.filter((l) => l.dimensie === d);
  const uit: Voorstel[] = [];
  const ids = (pred: (l: Les) => boolean) => hier.filter(pred).map((l) => l.id);

  // COMPOSITIE: deelwinst op het doel, maar een andere dimensie zakte.
  for (const l of hier) {
    if (typeof l.deltaDoel !== "number" || l.deltaDoel < VERBETERMARGE) continue;
    const { bijwerkingen } = faalwijzenVan(l);
    const basis = leesSleutel(l.strategie);
    if (!basis || bijwerkingen.length === 0) continue;
    const metBescherming = sleutelVan({ operatoren: basis.operatoren, bescherm: [...basis.bescherm, ...bijwerkingen] });
    uit.push({ dimensie: d, strategie: metBescherming, soort: "COMPOSITIE", faalwijze: "BIJWERKING", lesIds: [l.id], reden: `${l.strategie} verbeterde ${d} met +${r1(l.deltaDoel)}pp maar ${bijwerkingen.join(", ")} zakte → dezelfde aanpak mét de eis van ${bijwerkingen.join(", ")} erbij` });
    uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [...basis.operatoren, "AFBAKENING"], bescherm: [...basis.bescherm, ...bijwerkingen] }), soort: "COMPOSITIE", faalwijze: "BIJWERKING", lesIds: [l.id], reden: `${l.strategie} verbeterde ${d} maar had een bijwerking → bescherming plus afbakening tot waar de vraag erom vraagt` });
  }

  // GERICHT: per faalwijze, meest voorkomend eerst.
  const volgordeFaal = (Object.entries(a.faalwijzen) as [Faalwijze, number][]).sort((x, y) => y[1] - x[1]);
  for (const [f, n] of volgordeFaal) {
    const bronnen = ids((l) => faalwijzenVan(l).faalwijzen.includes(f));
    if (f === "BIJWERKING") {
      const vaakst = Object.entries(a.bijwerkingen).sort((x, y) => y[1] - x[1]).map(([x]) => x);
      if (vaakst.length > 0) {
        uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [], bescherm: [vaakst[0]] }), soort: "GERICHT", faalwijze: f, lesIds: bronnen, reden: `${n}× bijwerking, het vaakst op ${vaakst[0]} (${a.bijwerkingen[vaakst[0]]}×) → de eis samen met die van ${vaakst[0]}` });
        uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: ["AFBAKENING"], bescherm: [vaakst[0]] }), soort: "GERICHT", faalwijze: f, lesIds: bronnen, reden: `${n}× bijwerking → eis beperkt tot waar de vraag erom vraagt, en ${vaakst[0]} bewaakt` });
      }
      continue;
    }
    for (const op of OPERATOR_VOLGORDE.filter((o) => OPERATOREN[o].wezenlijk && OPERATOREN[o].richtOp.includes(f))) {
      uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [op], bescherm: [] }), soort: "GERICHT", faalwijze: f, lesIds: bronnen, reden: `${n}× ${f.toLowerCase().replace("_", " ")} → ${op.toLowerCase()} (${OPERATOREN[op].klasse.toLowerCase()}) grijpt daarop aan` });
    }
    // Twee operatoren uit verschillende klassen die allebei op deze faalwijze aangrijpen.
    const passend = OPERATOR_VOLGORDE.filter((o) => OPERATOREN[o].wezenlijk && OPERATOREN[o].richtOp.includes(f));
    for (let i = 0; i < passend.length; i += 1) {
      for (let j = i + 1; j < passend.length; j += 1) {
        if (OPERATOREN[passend[i]].klasse === OPERATOREN[passend[j]].klasse) continue;
        uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [passend[i], passend[j]], bescherm: [] }), soort: "GERICHT", faalwijze: f, lesIds: bronnen, reden: `${n}× ${f.toLowerCase().replace("_", " ")}; losse ingrepen daarop geprobeerd → combinatie ${passend[i].toLowerCase()} + ${passend[j].toLowerCase()}` });
      }
    }
  }

  // MUTATIE: de laatste verworpen aanpak in een ander jasje. Hoort geweigerd te worden (HERVERPAKT).
  const laatste = [...hier].reverse().find(verworpen);
  const lb = laatste ? leesSleutel(laatste.strategie) : null;
  if (laatste && lb && !lb.operatoren.includes("NADRUK")) {
    uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [...lb.operatoren, "NADRUK"], bescherm: lb.bescherm }), soort: "MUTATIE", faalwijze: null, lesIds: [laatste.id], reden: `mutatie van verworpen ${laatste.strategie}: alleen nadruk toegevoegd` });
  }

  // VERBREDING: nog nooit geprobeerde klassen en paren, pas na het gerichte zoeken.
  const geprobeerdeOps = new Set(geprobeerd.flatMap((s) => leesSleutel(s)?.operatoren ?? []));
  const nieuw = DOEL_OPERATOREN.filter((o) => !geprobeerdeOps.has(o));
  const alle = [...nieuw, ...DOEL_OPERATOREN.filter((o) => geprobeerdeOps.has(o))];
  const bron = hier.map((l) => l.id);
  for (const o of nieuw) uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [o], bescherm: [] }), soort: "VERBREDING", faalwijze: null, lesIds: bron, reden: `verbreding: interventieklasse ${OPERATOREN[o].klasse.toLowerCase()} (${o.toLowerCase()}) is op ${d} nog niet geprobeerd` });
  for (let i = 0; i < alle.length; i += 1) {
    for (let j = i + 1; j < alle.length; j += 1) {
      uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [alle[i], alle[j]], bescherm: [] }), soort: "VERBREDING", faalwijze: null, lesIds: bron, reden: `verbreding: combinatie ${alle[i].toLowerCase()} + ${alle[j].toLowerCase()} nog niet geprobeerd op ${d}` });
    }
  }
  // Laatste verbreding: drie klassen samen, alleen als de paren al op zijn
  // (de volgorde hierboven) — begrensd door de lengte die de validator toelaat.
  const vaakstBij = Object.entries(a.bijwerkingen).sort((x, y) => y[1] - x[1])[0]?.[0];
  for (let i = 0; i < alle.length; i += 1) {
    for (let j = i + 1; j < alle.length; j += 1) {
      for (let k = j + 1; k < alle.length; k += 1) {
        const klassen = new Set([alle[i], alle[j], alle[k]].map((o) => OPERATOREN[o].klasse));
        if (klassen.size < 2) continue;
        uit.push({ dimensie: d, strategie: sleutelVan({ operatoren: [alle[i], alle[j], alle[k]], bescherm: vaakstBij ? [vaakstBij] : [] }), soort: "VERBREDING", faalwijze: vaakstBij ? "BIJWERKING" : null, lesIds: bron, reden: `verbreding: drie klassen samen (${[alle[i], alle[j], alle[k]].map((o) => o.toLowerCase()).join(" + ")})${vaakstBij ? `, met bescherming van ${vaakstBij} (vaakste bijwerking)` : ""}` });
      }
    }
  }
  return uit;
}

function verschilMet(strategie: string, verworpenSleutels: readonly string[]): Hypothese["herkomst"]["verschil"] {
  const s = leesSleutel(strategie);
  if (!s || verworpenSleutels.length === 0) return { tov: null, toegevoegd: [], weggelaten: [] };
  const delen = (x: string) => {
    const p = leesSleutel(x);
    return p ? [...p.operatoren.filter((o) => OPERATOREN[o].wezenlijk), ...p.bescherm.map((b) => `BESCHERM:${b}`)] : [x];
  };
  const eigen = delen(strategie);
  let beste: { tov: string; toegevoegd: string[]; weggelaten: string[] } | null = null;
  for (const v of verworpenSleutels) {
    const ander = delen(v);
    const toegevoegd = eigen.filter((x) => !ander.includes(x));
    const weggelaten = ander.filter((x) => !eigen.includes(x));
    if (!beste || toegevoegd.length + weggelaten.length < beste.toegevoegd.length + beste.weggelaten.length) beste = { tov: v, toegevoegd, weggelaten };
  }
  return beste ?? { tov: null, toegevoegd: [], weggelaten: [] };
}

export interface UitbreidInvoer {
  readonly nr: number;
  readonly op: string;
  readonly aanleiding: "POOL_UITGEPUT" | "STAGNATIE";
  readonly naCyclus: number;
  readonly stand: Zoekstand;
  readonly lessen: readonly Les[];
  /** Laatst gemeten scores per dimensie (voor de aanpak "zwakste eerst"). */
  readonly scores: Readonly<Record<string, number>>;
  /** Welke dimensies onderzocht worden (gemeten, of al lessen). */
  readonly dimensies: readonly string[];
  /** Leverde de vorige golf een KEEP, promotie of meer-bewijs op? Zo niet: aanpak wisselen. */
  readonly vorigeGolfLeverdeOp: boolean;
  readonly grenzen: Zoekgrenzen;
  /** De kandidaattekst per dimensie en strategie (generateCandidate.ts), voor nieuwheid en lengte. */
  readonly tekst: (dimensie: string, strategie: string) => string;
  readonly maxTekens: number;
  /** Prompts van de gewone dev-set (nooit de holdout): nieuwe tests mogen daar niet op lijken. */
  readonly bestaandeTestPrompts: readonly string[];
  /** Weigert een gegenereerde test die op de holdout lijkt (meetkant); ontbreekt = alles toegestaan. */
  readonly testToegestaan?: (prompt: string) => boolean;
}

export interface Uitbreiding {
  readonly golf: Golf;
  readonly hypothesen: readonly Hypothese[];
  readonly tests: readonly GegenereerdeTest[];
}

export function breidUit(inv: UitbreidInvoer): Uitbreiding {
  const vorige = inv.stand.golven[inv.stand.golven.length - 1];
  const vorigeAanpak = vorige?.aanpak ?? "ZWAKSTE_EERST";
  const wissel = inv.aanleiding === "STAGNATIE" || !inv.vorigeGolfLeverdeOp;
  const aanpak = wissel ? AANPAKKEN[(AANPAKKEN.indexOf(vorigeAanpak) + 1) % AANPAKKEN.length] : vorigeAanpak;
  const aanpakReden = wissel
    ? `${inv.aanleiding === "STAGNATIE" ? `${inv.grenzen.stagnatieVenster} cycli op rij zonder resultaat` : "de vorige golf leverde niets op"} met aanpak ${vorigeAanpak.toLowerCase()} → wissel naar ${aanpak.toLowerCase()}`
    : `aanpak ${aanpak.toLowerCase()} blijft: de vorige golf leverde resultaat op`;

  // Een zwakte met een behouden kandidaat wacht op een mens: daar komt niets bovenop.
  const wachtOpMens = inv.dimensies.filter((d) => inv.lessen.some((l) => l.dimensie === d && l.verdict === "KEEP"));
  const analyse = inv.dimensies.filter((d) => !wachtOpMens.includes(d)).map((d) => analyseer(d, inv.lessen));
  const volgorde = volgordeVoor(aanpak, analyse, inv.scores);
  const nogNietGeprobeerd = analyse.filter((a) => a.pogingen === 0).map((a) => a.dimensie);
  const perDim = new Map(analyse.map((a) => [a.dimensie, a]));

  const geweigerd: Golf["geweigerd"][number][] = [];
  const aanvaard: Hypothese[] = [];
  const perDimVoorstellen = new Map<string, Voorstel[]>();
  for (const d of volgorde) {
    const a = perDim.get(d)!;
    // Zonder eigen les is er geen bewijs om een hypothese op te bouwen: die
    // zwakte heeft eerst haar startruimte nodig, geen gok van de regisseur.
    if (a.pogingen === 0) continue;
    const geprobeerd = inv.lessen.filter((l) => l.dimensie === d).map((l) => l.strategie);
    perDimVoorstellen.set(d, voorstellenVoor(a, inv.lessen, geprobeerd));
  }

  const toets = (v: Voorstel): { ok: true } | { ok: false; reden: Weigering; detail: string } => {
    const d = v.dimensie;
    const sem = semantischeSleutel(v.strategie);
    const inPool = [...inv.stand.hypothesen, ...aanvaard].filter((h) => h.dimensie === d);
    const verworpenHier = inv.lessen.filter((l) => l.dimensie === d && verworpen(l));
    if (verworpenHier.some((l) => l.strategie === v.strategie)) return { ok: false, reden: "AL_VERWORPEN", detail: `${v.strategie} is op ${d} al verworpen` };
    const zelfde = verworpenHier.find((l) => semantischeSleutel(l.strategie) === sem);
    if (zelfde) return { ok: false, reden: "HERVERPAKT", detail: `${v.strategie} is in wezen ${zelfde.strategie} (verworpen, les ${zelfde.id})` };
    if (inPool.some((h) => h.strategie === v.strategie || h.semantisch === sem)) return { ok: false, reden: "DUPLICAAT", detail: `${v.strategie} staat al in de zoekruimte voor ${d}` };
    const tekst = inv.tekst(d, v.strategie);
    if (tekst.length > inv.maxTekens) return { ok: false, reden: "TE_LANG", detail: `${tekst.length} > ${inv.maxTekens} tekens` };
    for (const l of verworpenHier) {
      const g = gelijkenis(tekst, inv.tekst(d, l.strategie));
      if (g >= 0.9) return { ok: false, reden: "TEKST_TE_GELIJK", detail: `tekst ${Math.round(g * 100)}% gelijk aan verworpen ${l.strategie}` };
    }
    return { ok: true };
  };

  // Round-robin over de zwaktes in de volgorde van de aanpak: de golf blijft
  // begrensd en valt niet in zijn geheel op één zwakte.
  const cursors = new Map(volgorde.map((d) => [d, 0]));
  let voortgang = true;
  while (aanvaard.length < inv.grenzen.maxHypothesenPerGolf && voortgang) {
    voortgang = false;
    for (const d of volgorde) {
      if (aanvaard.length >= inv.grenzen.maxHypothesenPerGolf) break;
      const lijst = perDimVoorstellen.get(d) ?? [];
      let i = cursors.get(d) ?? 0;
      while (i < lijst.length) {
        const v = lijst[i];
        i += 1;
        const t = toets(v);
        if (!t.ok) {
          if (!geweigerd.some((g) => g.dimensie === d && g.strategie === v.strategie)) geweigerd.push({ dimensie: d, strategie: v.strategie, reden: t.reden, detail: t.detail });
          continue;
        }
        if (v.soort === "MUTATIE") continue; // een mutatie die tóch nieuw is, telt niet als hypothese: ze voegt niets wezenlijks toe
        const verworpenSleutels = inv.lessen.filter((l) => l.dimensie === d && verworpen(l)).map((l) => l.strategie);
        aanvaard.push({
          id: `G${inv.nr}-${d}-${aanvaard.filter((h) => h.dimensie === d).length + 1}`,
          golf: inv.nr,
          dimensie: d,
          strategie: v.strategie,
          semantisch: semantischeSleutel(v.strategie),
          familie: klasseVan(v.strategie),
          herkomst: { soort: v.soort, reden: v.reden, faalwijze: v.faalwijze, lesIds: v.lesIds, verschil: verschilMet(v.strategie, verworpenSleutels) },
        });
        voortgang = true;
        break;
      }
      cursors.set(d, i);
    }
  }

  // Nieuwe tests waar de meting niet onderscheidt — begrensd per golf en per run.
  const tests: GegenereerdeTest[] = [];
  const testGaten: string[] = [];
  const bestaand = [...inv.bestaandeTestPrompts, ...inv.stand.tests.map((t) => String(t.item.prompt ?? ""))];
  let ruimte = Math.min(inv.grenzen.maxTestsPerGolf, inv.grenzen.maxTestsTotaal - inv.stand.tests.length);
  for (const d of volgorde) {
    const a = perDim.get(d)!;
    if (!a.onvoldoendeDiscriminerend || ruimte <= 0) continue;
    if (!heeftGrammatica(d)) {
      testGaten.push(d);
      continue;
    }
    const aantal = Math.min(2, ruimte);
    const nieuw = genereerTests(d, aantal + 2, `${inv.nr}|${inv.naCyclus}`, [...bestaand, ...tests.map((t) => String(t.item.prompt))], `GEN-G${inv.nr}`)
      .filter((t) => (inv.testToegestaan ? inv.testToegestaan(String(t.item.prompt)) : true))
      .slice(0, aantal);
    for (const t of nieuw) {
      tests.push({ id: t.id, golf: inv.nr, dimensie: d, item: t.item, herkomst: { reden: a.discriminatieReden ?? "", lesIds: inv.lessen.filter((l) => l.dimensie === d || (l.deltas && d in l.deltas)).map((l) => l.id).slice(-8) } });
    }
    ruimte -= nieuw.length;
  }

  // Alle lessen die de analyse las: daarop rust de volgorde én de keuze van de hypothesen.
  const gelezen = inv.lessen.filter((l) => inv.dimensies.includes(l.dimensie)).map((l) => l.id);
  const lesIds = [...new Set([...gelezen, ...aanvaard.flatMap((h) => h.herkomst.lesIds), ...tests.flatMap((t) => t.herkomst.lesIds)])];
  return {
    golf: {
      nr: inv.nr,
      op: inv.op,
      aanleiding: inv.aanleiding,
      naCyclus: inv.naCyclus,
      aanpak,
      aanpakGewisseld: aanpak !== vorigeAanpak,
      aanpakReden: nogNietGeprobeerd.length > 0 ? `${aanpakReden}; eerst nog niet geprobeerde zwaktes (${nogNietGeprobeerd.join(", ")})` : aanpakReden,
      volgorde,
      hypothesen: aanvaard.map((h) => h.id),
      tests: tests.map((t) => t.id),
      geweigerd,
      lesIds,
      analyse,
      testGaten,
      wachtOpMens,
    },
    hypothesen: aanvaard,
    tests,
  };
}
