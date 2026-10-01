import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, DEMO_ROOM_ROOT } from "../config";
import { AGENT_CATEGORY_KEYS } from "../proof/decision";
import { STRATEGIEEN, tekstVoorStrategie } from "../develop/generateCandidate";
import { semantischeSleutel } from "../develop/interventies";
import { leesLessen, stand, type Les } from "../develop/lessons";
import { MAX_TEKENS } from "../develop/validator";
import { breidUit, poolVoor, startGolf, type Golf, type Zoekgrenzen, type Zoekstand } from "../develop/zoekruimte";
import { canoniekeMap, schrijfCanoniekeKopie } from "./canoniek";
import { annuleer, claim, leeg, nieuwBudget, onderhoud, planIn, registreerWorker, rondAf, verrekenen, type BudgetManager, type Wachtrij } from "./workers";

/**
 * Hervatbare lange ontwikkelruns (Phase O): 1 uur / 6 uur / 24 uur / handmatig.
 *
 * Verschil met `runAutonomousDevelopmentRun`: die draait in één proces van
 * begin tot eind. Een run van 24 uur overleeft dat niet (herstart, laptop
 * dicht, stroom). Hier:
 *
 *  - Na elke cyclus een checkpoint (atomisch: tmp + rename). Een crash kost
 *    hoogstens de lopende cyclus; die job staat bij hervatten als RUNNING met
 *    een worker die niet meer bestaat, en gaat via `onderhoud()` terug in de
 *    wachtrij (met een pogingenteller, dus geen eindeloze herhaling).
 *  - Pauzeren/stoppen via een controlebestand, gelezen op elke cyclusgrens:
 *    nooit halverwege een meting afbreken. PAUSE laat het proces netjes
 *    eindigen met status PAUSED; `hervat` gaat verder waar het was.
 *  - Het budget telt ACTIEVE minuten: gepauzeerde tijd en tijd dat er geen
 *    proces draaide, tellen niet. Een 6-uursrun die 's nachts pauzeert, krijgt
 *    zijn zes uur werk.
 *  - Elke cyclus is een job met idempotentiesleutel `<runId>:cyclus:<n>`: een
 *    hervatting plant dezelfde cyclus niet dubbel in.
 *
 * Deze module activeert nooit een versie; de cyclusfunctie die hij aanroept
 * (standaard `runDevelopmentCycle`) ook niet.
 */

export type LongRunProfiel = "1h" | "6h" | "24h" | "handmatig" | "aangepast";
/** Actieve minuten per profiel; "aangepast" krijgt zijn minuten uit de opties. */
export const PROFIEL_MINUTEN: Readonly<Record<Exclude<LongRunProfiel, "aangepast">, number>> = { "1h": 60, "6h": 360, "24h": 1440, handmatig: Number.POSITIVE_INFINITY };

/** Het profiel dat bij een aantal minuten hoort (UI-kaartjes "1 uur / 6 uur / 24 uur" en de CLI `--minutes`). */
export function profielVoorMinuten(minuten: number): { profiel: LongRunProfiel; minuten: number | null } {
  if (!Number.isFinite(minuten)) return { profiel: "handmatig", minuten: null };
  const vast = (Object.entries(PROFIEL_MINUTEN) as [LongRunProfiel, number][]).find(([, m]) => m === minuten);
  return vast ? { profiel: vast[0], minuten: null } : { profiel: "aangepast", minuten };
}

/**
 * Verkenningsbudget per profiel (incident DR-UI-202609301449: een 6-uursrun
 * stopte na twee verworpen kandidaten op één zwakte).
 *
 * Een lokaal mislukte aanpak beëindigt een lange run niet. De cyclus
 * (developmentCycle.ts + lessons.ts) kiest na een verwerping een andere
 * strategie, en na de laatste strategie een andere zwakte. Deze grenzen zijn
 * alleen het vangnet:
 *
 *  - `pogingenPerDimensie`: zo vaak mag één zwakte zonder promotie terugkomen
 *    voordat de run haar in déze run lokaal uitgeput verklaart en verder gaat
 *    met een andere. Gelijk aan het aantal strategieën × MAX_ONBESLIST (3 × 2):
 *    meer pogingen kan het leergeheugen zelf nooit vragen.
 *  - `herhalingsTolerantie`: hoe vaak een al verworpen paar zwakte/strategie
 *    tóch terugkomt (dan werd een les niet gerespecteerd) voordat de run dat
 *    als echte fout behandelt. Elk zo'n paar wordt bovendien meteen geblokkeerd.
 *  - `maxCycli`: harde bovengrens tegen eindeloze lussen, ruim boven wat het
 *    tijdbudget toelaat (een echte cyclus duurt minuten).
 *
 * Uitputting van de huidige zoekruimte stopt de run ook niet meer
 * (eindcontrole 20260930: de echte 6-uursrun stopte na 131,5 van 360 minuten
 * omdat drie vaste strategieën × zes zwaktes op waren). Dan maakt de regisseur
 * (develop/zoekruimte.ts) een nieuwe golf hypothesen en tests uit de lessen,
 * begrensd door `zoek`. Alleen tijd, maxCycli, een handmatige stop, een echte
 * fout of een capaciteitsgrens (de regisseur kan niets nieuws meer bedenken,
 * of de zoekgrens is bereikt — `CAPACITEIT_BLOKKADE`, met escalatie) stoppen
 * de run.
 */
export interface VerkenningsBudget {
  readonly pogingenPerDimensie: number;
  readonly herhalingsTolerantie: number;
  readonly maxCycli: number;
  /** Grenzen van de dynamische zoekruimte (ontbreekt in checkpoints van vóór de regisseur). */
  readonly zoek?: Zoekgrenzen;
}
export const STRATEGIE_POGINGEN = 6;
export function verkenningVoor(profiel: LongRunProfiel, minuten: number | null = null): VerkenningsBudget {
  switch (profiel) {
    case "1h":
      return { pogingenPerDimensie: STRATEGIE_POGINGEN, herhalingsTolerantie: 2, maxCycli: 24, zoek: { maxGolven: 6, maxHypothesenPerGolf: 4, maxTestsPerGolf: 2, maxTestsTotaal: 4, stagnatieVenster: 4 } };
    case "6h":
      return { pogingenPerDimensie: STRATEGIE_POGINGEN, herhalingsTolerantie: 3, maxCycli: 144, zoek: { maxGolven: 24, maxHypothesenPerGolf: 6, maxTestsPerGolf: 4, maxTestsTotaal: 8, stagnatieVenster: 6 } };
    case "24h":
      return { pogingenPerDimensie: STRATEGIE_POGINGEN, herhalingsTolerantie: 5, maxCycli: 576, zoek: { maxGolven: 80, maxHypothesenPerGolf: 8, maxTestsPerGolf: 4, maxTestsTotaal: 16, stagnatieVenster: 8 } };
    case "handmatig":
      return { pogingenPerDimensie: STRATEGIE_POGINGEN, herhalingsTolerantie: 5, maxCycli: 500, zoek: { maxGolven: 60, maxHypothesenPerGolf: 8, maxTestsPerGolf: 4, maxTestsTotaal: 16, stagnatieVenster: 8 } };
    case "aangepast": {
      const m = minuten ?? 60;
      return {
        pogingenPerDimensie: STRATEGIE_POGINGEN,
        herhalingsTolerantie: 3,
        maxCycli: Math.min(1000, Math.max(4, Math.ceil(m / 2.5))),
        zoek: { maxGolven: Math.min(100, Math.max(3, Math.ceil(m / 15))), maxHypothesenPerGolf: 6, maxTestsPerGolf: 4, maxTestsTotaal: Math.min(16, Math.max(2, Math.ceil(m / 45))), stagnatieVenster: 6 },
      };
    }
  }
}

export type LongRunStatus = "RUNNING" | "PAUSED" | "STOPPED" | "DONE";
/**
 * `GEEN_VOORTGANG` en `ALLES_GEPROBEERD` worden niet meer gegeven (zie
 * VerkenningsBudget); ze blijven voor het lezen van oude checkpoints.
 * `CAPACITEIT_BLOKKADE`: de regisseur kon geen nieuwe hypothese meer maken, of
 * de zoekgrens is bereikt — een eerlijke blocker met escalatie, geen succes.
 */
export type LongRunStopReden = "BUDGET_OP" | "GEEN_DIAGNOSE" | "GEEN_VOORTGANG" | "ALLES_GEPROBEERD" | "HANDMATIG_GESTOPT" | "MAX_CYCLI" | "HERHAALDE_FOUT" | "CAPACITEIT_BLOKKADE";

/**
 * Wat de run nu doet, voor het scherm: actief onderzoek (met de overgang van
 * de laatste cyclus), of waarom hij stil staat.
 */
export type LongRunFase =
  | "ONDERZOEKT"
  | "NIEUWE_HYPOTHESE"
  | "MEER_BEWIJS"
  | "STRATEGIE_GEWISSELD"
  | "FAMILIE_GEWISSELD"
  | "ZWAKTE_GEWISSELD"
  | "LOKAAL_UITGEPUT"
  | "ZOEKRUIMTE_VERBREED"
  | "AANPAK_GEWISSELD"
  | "GEPAUZEERD"
  | "GLOBAAL_UITGEPUT"
  | "BUDGET_BEREIKT"
  | "MAX_CYCLI"
  | "HANDMATIG_GESTOPT"
  | "FOUT_BLOKKADE"
  | "CAPACITEIT_BLOKKADE";

export type CyclusOvergang = "NIEUWE_HYPOTHESE" | "MEER_BEWIJS" | "STRATEGIE_GEWISSELD" | "FAMILIE_GEWISSELD" | "ZWAKTE_GEWISSELD" | "HERHALING_GEBLOKKEERD" | "NIEUWE_GOLF";

export interface CyclusUitkomst {
  readonly beslissing: string;
  readonly kandidaatId: string | null;
  readonly dimensie: string | null;
  readonly versieId: string | null;
  readonly verdict: string | null;
  /** De stappen van de cyclus met hun bewijs (develop/developmentCycle.ts, STADIA). */
  readonly stadia?: readonly { readonly naam: string; readonly status: string; readonly detail: string; readonly bewijs?: unknown }[];
  /** De les die deze cyclus naliet, en de lessen waarop zijn keuzes rustten. */
  readonly lesId?: string | null;
  readonly geleerdVan?: readonly string[];
  readonly strategie?: string | null;
  /** De kandidaatfamilie (soort wijziging) — een wissel hiervan is iets anders dan een strategiewissel. */
  readonly familie?: string | null;
  /** Dimensies die de diagnose oversloeg, en waarom. */
  readonly overgeslagen?: readonly { readonly dimensie: string; readonly reden: string }[];
  /** Welk model de meting deed — bewijs dat het geen stub was. */
  readonly model?: string | null;
  /** De gemeten scores per dimensie (diagnose) — de regisseur ordent er zwaktes mee. */
  readonly scores?: Readonly<Partial<Record<string, number | null>>> | null;
}

/** Een cyclus zoals het checkpoint hem bewaart. */
export type CyclusRecord = CyclusUitkomst & {
  readonly nr: number;
  readonly klaarOp: string;
  readonly duurMs: number;
  readonly overgangen?: readonly CyclusOvergang[];
  /** In welke golf van de zoekruimte, met welke hypothese. */
  readonly golf?: number;
  readonly hypotheseId?: string | null;
  readonly semantisch?: string | null;
};

export interface LongRunCheckpoint {
  readonly schema: "ns-lyra-long-run/1";
  readonly runId: string;
  readonly profiel: LongRunProfiel;
  readonly budgetMinuten: number | null;
  readonly status: LongRunStatus;
  readonly stopReden: LongRunStopReden | null;
  readonly aangemaaktOp: string;
  readonly bijgewerktOp: string;
  readonly actieveMs: number;
  readonly segmenten: number;
  readonly cycli: readonly CyclusRecord[];
  readonly uitgeslotenKandidaten: readonly string[];
  readonly pogingenPerDimensie: Readonly<Record<string, number>>;
  /** Het verkenningsbudget van dit profiel (vastgelegd bij de start). */
  readonly verkenning?: VerkenningsBudget;
  /** Zwaktes die in déze run lokaal uitgeput zijn verklaard (vangnet naast het leergeheugen). */
  readonly uitgeslotenDimensies?: readonly string[];
  /** Paren zwakte/strategie die in deze run verworpen zijn: worden niet opnieuw gekozen. */
  readonly geblokkeerdeParen?: readonly { readonly dimensie: string; readonly strategie: string }[];
  /** Hoe vaak een al verworpen paar tóch terugkwam. */
  readonly herhalingen?: number;
  /** Wat de run nu doet (voor het scherm). */
  readonly fase?: LongRunFase;
  /** Vingerafdruk van model, configuratie en code, per segment (start en elke hervatting). */
  readonly omgevingen?: readonly { readonly segment: number; readonly op: string; readonly omgeving: unknown }[];
  /** De dynamische zoekruimte: golven, hypothesen (met herkomst) en gegenereerde tests. */
  readonly zoekruimte?: Zoekstand;
  /** De laatst gemeten scores per dimensie. */
  readonly laatsteScores?: Readonly<Record<string, number>>;
  readonly wachtrij: Wachtrij;
  readonly budget: BudgetManager;
  readonly gebeurtenissen: readonly { readonly op: string; readonly tekst: string }[];
  /** De actieve productieversie bij de start en bij de laatste checkpoint: moeten gelijk zijn (nooit autonome activatie). */
  readonly productie?: { readonly bijStart: ProductieStand; readonly laatst: ProductieStand } | null;
}

export interface ProductieStand {
  readonly versionId: string;
  readonly generation: number;
}

export type ControleCommando = "PAUSE" | "STOP";
export interface Controle {
  readonly commando: ControleCommando;
  readonly door: string;
  readonly op: string;
}

export interface LongRunDeps {
  readonly cyclus: (ctx: {
    runId: string;
    uitgesloten: readonly string[];
    runUitsluitingen: { readonly dimensies: readonly string[]; readonly paren: readonly { readonly dimensie: string; readonly strategie: string }[] };
    /** De zoekruimte van de huidige golf (zie DevelopmentCycleOptions.zoekruimte). */
    zoekruimte: ZoekruimteVoorCyclus;
  }) => Promise<CyclusUitkomst>;
  readonly nu: () => number;
  /** Welke productieversie is nu actief (releasedienst)? Voor het bewijs dat de run niets activeerde. */
  readonly productie?: () => ProductieStand;
  /** Vingerafdruk van model, configuratie en code — één keer per segment (start en elke hervatting). */
  readonly omgeving?: () => Promise<unknown> | unknown;
  /** Na elk checkpoint aangeroepen (bijv. de canonieke kopie onder docs/lyra-knowledge/long-runs/). */
  readonly spiegel?: (c: LongRunCheckpoint) => void;
  /** Het leergeheugen (standaard `DATA_DIR/learning/lessons.jsonl`). */
  readonly lessen?: () => readonly Les[];
  /** Weigert een gegenereerde test die op de holdout lijkt (meetkant); de regisseur ziet de holdout nooit. */
  readonly testToegestaan?: (prompt: string) => boolean;
}

export interface ZoekruimteVoorCyclus {
  readonly golf: number;
  readonly aanpak: string;
  readonly pool: Readonly<Record<string, readonly string[]>>;
  readonly volgorde: readonly string[];
  readonly lesIds: readonly string[];
  readonly tests: readonly Record<string, unknown>[];
}

/** De dimensies waarover de zoekruimte gaat (latency is geen gedrag). */
export const ZOEK_DIMENSIES: readonly string[] = AGENT_CATEGORY_KEYS.filter((k) => k !== "latencyMs");

function devPrompts(): readonly string[] {
  try {
    const d = JSON.parse(readFileSync(path.join(DEMO_ROOM_ROOT, "src", "benchmark", "questions", "dev.json"), "utf8")) as { items?: { prompt?: string }[] };
    return (d.items ?? []).map((i) => String(i.prompt ?? ""));
  } catch {
    return [];
  }
}

/** Wat de cyclus van de zoekruimte te zien krijgt. */
export function zoekruimteVoorCyclus(z: Zoekstand): ZoekruimteVoorCyclus {
  const golf = z.golven[z.golven.length - 1];
  const dims = [...new Set(z.hypothesen.map((h) => h.dimensie))];
  return {
    golf: golf.nr,
    aanpak: golf.aanpak,
    pool: Object.fromEntries(dims.map((d) => [d, poolVoor(z, d)])),
    volgorde: golf.volgorde,
    lesIds: golf.lesIds,
    tests: z.tests.map((t) => t.item),
  };
}

const dirVan = (runId: string) => path.join(DATA_DIR, "long-runs", runId.replace(/[^A-Za-z0-9._-]/g, "_"));
const checkpointBestand = (runId: string) => path.join(dirVan(runId), "checkpoint.json");
const controleBestand = (runId: string) => path.join(dirVan(runId), "control.json");

function atomisch(bestand: string, inhoud: string): void {
  mkdirSync(path.dirname(bestand), { recursive: true });
  const tmp = `${bestand}.${process.pid}.tmp`;
  writeFileSync(tmp, inhoud, "utf8");
  renameSync(tmp, bestand);
}

export function leesCheckpoint(runId: string): LongRunCheckpoint | null {
  const b = checkpointBestand(runId);
  return existsSync(b) ? (JSON.parse(readFileSync(b, "utf8")) as LongRunCheckpoint) : null;
}

function schrijf(c: LongRunCheckpoint): void {
  atomisch(checkpointBestand(c.runId), `${JSON.stringify(c, null, 2)}\n`);
}

export function lijstLongRuns(): readonly LongRunCheckpoint[] {
  const d = path.join(DATA_DIR, "long-runs");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .map((id) => leesCheckpoint(id))
    .filter((c): c is LongRunCheckpoint => c !== null)
    .sort((a, b) => b.aangemaaktOp.localeCompare(a.aangemaaktOp));
}

/** Pauzeer- of stopverzoek; wordt op de eerstvolgende cyclusgrens uitgevoerd. */
export function vraagControle(runId: string, commando: ControleCommando, door: string, op = new Date().toISOString()): void {
  const c = leesCheckpoint(runId);
  if (!c) throw new Error(`onbekende lange run: ${runId}`);
  // Een gepauzeerde run heeft geen proces dat het verzoek kan lezen: stoppen
  // gebeurt dan hier, meteen.
  if (c.status === "PAUSED" && commando === "STOP") {
    const gestopt: LongRunCheckpoint = { ...c, status: "STOPPED", stopReden: "HANDMATIG_GESTOPT", fase: "HANDMATIG_GESTOPT", bijgewerktOp: op, wachtrij: annuleer(c.wachtrij, `gestopt door ${door}`), gebeurtenissen: [...c.gebeurtenissen, { op, tekst: `Gestopt door ${door} (tijdens pauze).` }] };
    schrijf(gestopt);
    // Heeft deze run een canonieke kopie (docs/lyra-knowledge/long-runs/), dan die ook bijwerken.
    const kopie = path.join(canoniekeMap(runId), "checkpoint.json");
    if (existsSync(kopie)) schrijfCanoniekeKopie(gestopt);
    return;
  }
  atomisch(controleBestand(runId), `${JSON.stringify({ commando, door, op } satisfies Controle, null, 2)}\n`);
}

function leesControle(runId: string): Controle | null {
  const b = controleBestand(runId);
  return existsSync(b) ? (JSON.parse(readFileSync(b, "utf8")) as Controle) : null;
}

function wisControle(runId: string, alleen?: ControleCommando): void {
  const b = controleBestand(runId);
  if (!existsSync(b)) return;
  if (alleen && leesControle(runId)?.commando !== alleen) return;
  atomisch(b, "null\n");
}

export interface LongRunOpties {
  readonly runId: string;
  readonly profiel: LongRunProfiel;
  /** Alleen bij profiel "aangepast": het actieve budget in minuten. */
  readonly minuten?: number | null;
  /** Overschrijft `verkenningVoor(profiel).pogingenPerDimensie` (tests). */
  readonly maxPogingenPerDimensie?: number;
  /** Overschrijft `verkenningVoor(profiel).maxCycli`. */
  readonly maxCycli?: number;
  /** Overschrijft grenzen van de zoekruimte (tests, versnelde proef). */
  readonly zoek?: Partial<Zoekgrenzen>;
}

/** Welke overgang maakte deze cyclus ten opzichte van de vorige gemeten cyclus? */
export function overgangenVan(vorige: CyclusUitkomst | null, nu: CyclusUitkomst): CyclusOvergang[] {
  if (!nu.kandidaatId) return [];
  const uit: CyclusOvergang[] = ["NIEUWE_HYPOTHESE"];
  if (!vorige || !vorige.dimensie) return uit;
  if (vorige.dimensie !== nu.dimensie) return [...uit, "ZWAKTE_GEWISSELD"];
  if (vorige.strategie && nu.strategie && vorige.strategie !== nu.strategie) uit.push("STRATEGIE_GEWISSELD");
  if (vorige.familie && nu.familie && vorige.familie !== nu.familie) uit.push("FAMILIE_GEWISSELD");
  if (vorige.strategie && vorige.strategie === nu.strategie) uit.push("MEER_BEWIJS");
  return uit;
}

const FASE_BIJ_STOP: Readonly<Record<LongRunStopReden, LongRunFase>> = {
  CAPACITEIT_BLOKKADE: "CAPACITEIT_BLOKKADE",
  BUDGET_OP: "BUDGET_BEREIKT",
  ALLES_GEPROBEERD: "GLOBAAL_UITGEPUT",
  MAX_CYCLI: "MAX_CYCLI",
  HANDMATIG_GESTOPT: "HANDMATIG_GESTOPT",
  GEEN_DIAGNOSE: "FOUT_BLOKKADE",
  HERHAALDE_FOUT: "FOUT_BLOKKADE",
  GEEN_VOORTGANG: "FOUT_BLOKKADE",
};

/**
 * Start een nieuwe lange run of hervat een bestaande (zelfde runId). Keert
 * terug zodra de run PAUSED, STOPPED of DONE is.
 */
export async function draaiLongRun(opties: LongRunOpties, deps: LongRunDeps): Promise<LongRunCheckpoint> {
  const basisVerkenning = verkenningVoor(opties.profiel, opties.minuten ?? null);
  const begin = deps.nu();
  const iso = (t: number) => new Date(t).toISOString();
  const workerId = `lokaal-${process.pid}-${begin}`;

  const bestaand = leesCheckpoint(opties.runId);
  if (bestaand && (bestaand.status === "DONE" || bestaand.status === "STOPPED")) return bestaand;

  const budgetMinuten = opties.profiel === "aangepast" ? Math.max(0, Number(opties.minuten ?? 0)) : PROFIEL_MINUTEN[opties.profiel];
  let c: LongRunCheckpoint = bestaand
    ? {
        ...bestaand,
        status: "RUNNING",
        segmenten: bestaand.segmenten + 1,
        // Het vorige proces bestaat niet meer: al zijn workers zijn dood en
        // hun lopende jobs gaan terug in de wachtrij (of falen na maxPogingen).
        wachtrij: registreerWorker(onderhoud({ ...bestaand.wachtrij, workers: [] }, begin), workerId, ["cyclus"], begin),
        gebeurtenissen: [...bestaand.gebeurtenissen, { op: iso(begin), tekst: `Hervat (segment ${bestaand.segmenten + 1}).` }],
      }
    : {
        schema: "ns-lyra-long-run/1",
        runId: opties.runId,
        profiel: opties.profiel,
        budgetMinuten: Number.isFinite(budgetMinuten) ? budgetMinuten : null,
        status: "RUNNING",
        stopReden: null,
        aangemaaktOp: iso(begin),
        bijgewerktOp: iso(begin),
        actieveMs: 0,
        segmenten: 1,
        cycli: [],
        uitgeslotenKandidaten: [],
        pogingenPerDimensie: {},
        verkenning: {
          ...basisVerkenning,
          ...(opties.maxPogingenPerDimensie ? { pogingenPerDimensie: opties.maxPogingenPerDimensie } : {}),
          ...(opties.maxCycli ? { maxCycli: opties.maxCycli } : {}),
          zoek: { ...basisVerkenning.zoek!, ...(opties.zoek ?? {}) },
        },
        uitgeslotenDimensies: [],
        geblokkeerdeParen: [],
        herhalingen: 0,
        fase: "ONDERZOEKT",
        wachtrij: registreerWorker(leeg(), workerId, ["cyclus"], begin),
        budget: nieuwBudget(Number.isFinite(budgetMinuten) ? budgetMinuten : 1e9, 1e9),
        gebeurtenissen: [{ op: iso(begin), tekst: `Gestart, profiel ${opties.profiel}.` }],
        productie: deps.productie ? { bijStart: deps.productie(), laatst: deps.productie() } : null,
      };
  // Oude checkpoints (van vóór het verkenningsbudget of de regisseur) krijgen bij hervatten de huidige standaard.
  const vk = c.verkenning ?? {
    ...basisVerkenning,
    ...(opties.maxPogingenPerDimensie ? { pogingenPerDimensie: opties.maxPogingenPerDimensie } : {}),
    ...(opties.maxCycli ? { maxCycli: opties.maxCycli } : {}),
  };
  const verkenning: VerkenningsBudget = { ...vk, zoek: vk.zoek ?? { ...basisVerkenning.zoek!, ...(opties.zoek ?? {}) } };
  const zoek = verkenning.zoek!;
  const lessen = deps.lessen ?? leesLessen;
  const zoekruimte: Zoekstand =
    c.zoekruimte ??
    (() => {
      const g = startGolf(ZOEK_DIMENSIES, STRATEGIEEN, iso(begin));
      return { golven: [g.golf], hypothesen: g.hypothesen, tests: [] };
    })();
  c = { ...c, verkenning, zoekruimte, uitgeslotenDimensies: c.uitgeslotenDimensies ?? [], geblokkeerdeParen: c.geblokkeerdeParen ?? [], herhalingen: c.herhalingen ?? 0, fase: "ONDERZOEKT" };
  if (deps.omgeving) {
    try {
      c = { ...c, omgevingen: [...(c.omgevingen ?? []), { segment: c.segmenten, op: iso(begin), omgeving: await deps.omgeving() }] };
    } catch (fout) {
      c = { ...c, omgevingen: [...(c.omgevingen ?? []), { segment: c.segmenten, op: iso(begin), omgeving: { fout: fout instanceof Error ? fout.message : String(fout) } }] };
    }
  }
  const bewaar = (x: LongRunCheckpoint) => {
    schrijf(x);
    deps.spiegel?.(x);
  };
  // Hervatten heft een pauze op; een stopverzoek blijft staan.
  wisControle(opties.runId, "PAUSE");
  bewaar(c);

  const eindig = (status: LongRunStatus, stopReden: LongRunStopReden | null, tekst: string): LongRunCheckpoint => {
    const t = deps.nu();
    c = {
      ...c,
      status,
      stopReden,
      fase: status === "PAUSED" ? "GEPAUZEERD" : stopReden ? FASE_BIJ_STOP[stopReden] : c.fase,
      bijgewerktOp: iso(t),
      wachtrij: status === "PAUSED" ? c.wachtrij : annuleer(c.wachtrij, tekst),
      gebeurtenissen: [...c.gebeurtenissen, { op: iso(t), tekst }],
    };
    bewaar(c);
    return c;
  };

  const succes = (x: CyclusUitkomst) => x.beslissing === "PROMOTION_CANDIDATE" || x.verdict === "KEEP" || x.verdict === "NEEDS_MORE_EVIDENCE";
  const isGemeten = (x: CyclusUitkomst) => x.beslissing !== "NOT_EXECUTED" && x.beslissing !== "UITGEPUT";

  /**
   * Een nieuwe golf van de regisseur (develop/zoekruimte.ts), vastgelegd in
   * het checkpoint vóór de volgende cyclus: een crash daarna verliest hem niet.
   * Een golf met nieuwe hypothesen geeft elke zwakte een vers lokaal budget.
   */
  const verbreed = (aanleiding: "POOL_UITGEPUT" | "STAGNATIE", naCyclus: number): Golf => {
    const z = c.zoekruimte!;
    const huidige = z.golven[z.golven.length - 1];
    const vorigeGolfLeverdeOp = c.cycli.filter((x) => x.nr > huidige.naCyclus).some(succes);
    const ls = lessen();
    const scores = c.laatsteScores ?? {};
    const dimensies = Object.keys(scores).length > 0 ? Object.keys(scores) : [...new Set(ls.map((l) => l.dimensie))];
    const u = breidUit({
      nr: z.golven.length + 1,
      op: iso(deps.nu()),
      aanleiding,
      naCyclus,
      stand: z,
      lessen: ls,
      scores,
      dimensies,
      vorigeGolfLeverdeOp,
      grenzen: zoek,
      tekst: (d, st) => tekstVoorStrategie(d, st),
      maxTekens: MAX_TEKENS,
      bestaandeTestPrompts: devPrompts(),
      testToegestaan: deps.testToegestaan,
    });
    const g = u.golf;
    const telling = Object.entries(g.geweigerd.reduce<Record<string, number>>((a, x) => ({ ...a, [x.reden]: (a[x.reden] ?? 0) + 1 }), {}))
      .map(([r, n]) => `${n}× ${r}`)
      .join(", ");
    const nieuw = u.hypothesen.length > 0;
    const t = deps.nu();
    c = {
      ...c,
      zoekruimte: { golven: [...z.golven, g], hypothesen: [...z.hypothesen, ...u.hypothesen], tests: [...z.tests, ...u.tests] },
      ...(nieuw ? { uitgeslotenDimensies: [], pogingenPerDimensie: {} } : {}),
      fase: nieuw ? (g.aanpakGewisseld ? "AANPAK_GEWISSELD" : "ZOEKRUIMTE_VERBREED") : c.fase,
      bijgewerktOp: iso(t),
      gebeurtenissen: [
        ...c.gebeurtenissen,
        {
          op: iso(t),
          tekst: `Golf ${g.nr} (${aanleiding === "POOL_UITGEPUT" ? "zoekruimte uitgeput" : `stagnatie: ${zoek.stagnatieVenster} cycli zonder resultaat`}): ${u.hypothesen.length} nieuwe hypothese(n)${u.hypothesen.length > 0 ? ` [${u.hypothesen.map((h) => `${h.dimensie}/${h.strategie}`).join(", ")}]` : ""}, ${u.tests.length} nieuwe test(s)${g.testGaten.length > 0 ? ` (geen testgrammatica voor ${g.testGaten.join(", ")})` : ""}, ${g.geweigerd.length} voorstel(len) geweigerd${telling ? ` (${telling})` : ""}; ${g.aanpakReden}; gebouwd op ${g.lesIds.length} les(sen).`,
        },
      ],
    };
    bewaar(c);
    return g;
  };

  for (;;) {
    const controle = leesControle(opties.runId);
    if (controle?.commando === "STOP") return eindig("STOPPED", "HANDMATIG_GESTOPT", `Gestopt door ${controle.door}.`);
    if (controle?.commando === "PAUSE") {
      wisControle(opties.runId);
      return eindig("PAUSED", null, `Gepauzeerd door ${controle.door}; actieve tijd tot nu ${(c.actieveMs / 60000).toFixed(1)} min.`);
    }
    if (c.budgetMinuten !== null && c.actieveMs / 60000 >= c.budgetMinuten) return eindig("DONE", "BUDGET_OP", `Actief budget van ${c.budgetMinuten} min op.`);
    if (c.cycli.length >= verkenning.maxCycli) return eindig("DONE", "MAX_CYCLI", `Veiligheidsgrens van ${verkenning.maxCycli} cycli bereikt.`);

    // §55 "no improvement for N cycles" → verbreden, ook als de huidige ruimte nog niet op is.
    {
      const z = c.zoekruimte!;
      const huidige = z.golven[z.golven.length - 1];
      const inGolf = c.cycli.filter((x) => x.nr > huidige.naCyclus && isGemeten(x));
      if (inGolf.length >= zoek.stagnatieVenster && !inGolf.slice(-zoek.stagnatieVenster).some(succes) && z.golven.length < zoek.maxGolven) verbreed("STAGNATIE", c.cycli.length);
    }

    const nr = c.cycli.length + 1;
    const nuPlan = deps.nu();
    let q = planIn(c.wachtrij, { id: `${c.runId}-c${nr}`, soort: "cyclus", idempotentieSleutel: `${c.runId}:cyclus:${nr}`, prioriteit: 1, vereist: ["cyclus"], maxPogingen: 3, budget: { minuten: 0, modelCalls: 0 } });
    const geclaimd = claim(q, workerId, nuPlan, c.budget);
    if (!geclaimd.job) {
      const gefaald = q.jobs.find((j) => j.idempotentieSleutel === `${c.runId}:cyclus:${nr}` && j.status === "FAILED");
      c = { ...c, wachtrij: q };
      return eindig("STOPPED", "HERHAALDE_FOUT", gefaald ? `Cyclus ${nr} faalde herhaaldelijk: ${gefaald.reden}` : "Geen job te claimen (budget of vermogen).");
    }
    // Checkpoint mét de lopende job: crasht het proces nu, dan ziet de
    // hervatting een RUNNING job van een dode worker.
    c = { ...c, wachtrij: geclaimd.q, budget: geclaimd.budget };
    bewaar(c);

    const start = deps.nu();
    let uitkomst: CyclusUitkomst;
    try {
      uitkomst = await deps.cyclus({
        runId: c.runId,
        uitgesloten: c.uitgeslotenKandidaten,
        runUitsluitingen: { dimensies: c.uitgeslotenDimensies ?? [], paren: c.geblokkeerdeParen ?? [] },
        zoekruimte: zoekruimteVoorCyclus(c.zoekruimte!),
      });
    } catch (fout) {
      const duur = deps.nu() - start;
      const reden = fout instanceof Error ? fout.message : String(fout);
      const job = geclaimd.job;
      q = job.pogingen >= job.maxPogingen ? rondAf(c.wachtrij, job.id, "FAILED", reden) : { ...c.wachtrij, jobs: c.wachtrij.jobs.map((j) => (j.id === job.id ? { ...j, status: "QUEUED" as const, lease: null, reden } : j)) };
      c = { ...c, actieveMs: c.actieveMs + duur, wachtrij: q, budget: verrekenen(c.budget, job.id, { minuten: duur / 60000, modelCalls: 0 }), gebeurtenissen: [...c.gebeurtenissen, { op: iso(deps.nu()), tekst: `Cyclus ${nr} fout (poging ${job.pogingen}/${job.maxPogingen}): ${reden}` }] };
      bewaar(c);
      if (job.pogingen >= job.maxPogingen) return eindig("STOPPED", "HERHAALDE_FOUT", `Cyclus ${nr} faalde ${job.maxPogingen} keer; run gestopt om niet blind door te gaan.`);
      continue;
    }
    const eind = deps.nu();
    const duur = eind - start;
    const dim = uitkomst.dimensie ?? "onbekend";
    const pogingen = { ...c.pogingenPerDimensie };
    const gemeten = uitkomst.beslissing !== "NOT_EXECUTED" && uitkomst.beslissing !== "UITGEPUT";
    if (uitkomst.beslissing === "PROMOTION_CANDIDATE") delete pogingen[dim];
    else if (gemeten) pogingen[dim] = (pogingen[dim] ?? 0) + 1;

    // Verworpen in deze run → dit paar komt in deze run niet terug, ook als het
    // leergeheugen de les zou missen. Kwam een al verworpen paar tóch terug,
    // dan telt dat als herhaling.
    const verworpen = gemeten && uitkomst.beslissing !== "PROMOTION_CANDIDATE" && uitkomst.verdict !== "NEEDS_MORE_EVIDENCE" && uitkomst.verdict !== "KEEP";
    const paar = uitkomst.strategie ? { dimensie: dim, strategie: uitkomst.strategie } : null;
    // Semantisch: dezelfde aanpak in een ander jasje telt als dezelfde aanpak.
    const alGeblokkeerd = paar ? (c.geblokkeerdeParen ?? []).some((p) => p.dimensie === paar.dimensie && semantischeSleutel(p.strategie) === semantischeSleutel(paar.strategie)) : false;
    const herhalingen = (c.herhalingen ?? 0) + (alGeblokkeerd ? 1 : 0);
    const geblokkeerdeParen = paar && verworpen && !alGeblokkeerd ? [...(c.geblokkeerdeParen ?? []), paar] : (c.geblokkeerdeParen ?? []);
    const vorige = [...c.cycli].reverse().find((x) => x.kandidaatId) ?? null;
    const zs = c.zoekruimte!;
    const golfNu = zs.golven[zs.golven.length - 1];
    const eersteInGolf = golfNu.nr > 1 && uitkomst.kandidaatId !== null && !c.cycli.some((x) => x.nr > golfNu.naCyclus && x.kandidaatId);
    const overgangen: CyclusOvergang[] = [...overgangenVan(vorige, uitkomst), ...(eersteInGolf ? (["NIEUWE_GOLF"] as const) : []), ...(alGeblokkeerd ? (["HERHALING_GEBLOKKEERD"] as const) : [])];
    const hyp = uitkomst.strategie ? [...zs.hypothesen].reverse().find((h) => h.dimensie === dim && h.strategie === uitkomst.strategie) : undefined;
    const scoresNu = uitkomst.scores ? Object.fromEntries(Object.entries(uitkomst.scores).filter((e): e is [string, number] => typeof e[1] === "number")) : null;
    // Lokale uitputting: deze zwakte is in deze run vaak genoeg geprobeerd —
    // uitsluiten en doorgaan met een andere, niet de hele run stoppen.
    const lokaalUitgeput = gemeten && (pogingen[dim] ?? 0) >= verkenning.pogingenPerDimensie && !(c.uitgeslotenDimensies ?? []).includes(dim);
    const uitgeslotenDimensies = lokaalUitgeput ? [...(c.uitgeslotenDimensies ?? []), dim] : (c.uitgeslotenDimensies ?? []);
    const extra: { op: string; tekst: string }[] = [
      ...(alGeblokkeerd ? [{ op: iso(eind), tekst: `Herhaling: ${dim}/${uitkomst.strategie} was in deze run al verworpen en kwam toch terug (${herhalingen}/${verkenning.herhalingsTolerantie}).` }] : []),
      ...(lokaalUitgeput ? [{ op: iso(eind), tekst: `Lokaal uitgeput: ${dim} ${pogingen[dim]}x zonder promotie; de run gaat verder met een andere zwakte.` }] : []),
    ];

    c = {
      ...c,
      actieveMs: c.actieveMs + duur,
      bijgewerktOp: iso(eind),
      cycli: [...c.cycli, { ...uitkomst, nr, klaarOp: iso(eind), duurMs: duur, overgangen, golf: golfNu.nr, hypotheseId: hyp?.id ?? null, semantisch: uitkomst.strategie ? semantischeSleutel(uitkomst.strategie) : null }],
      ...(scoresNu && Object.keys(scoresNu).length > 0 ? { laatsteScores: scoresNu } : {}),
      geblokkeerdeParen,
      uitgeslotenDimensies,
      herhalingen,
      fase: lokaalUitgeput ? "LOKAAL_UITGEPUT" : (overgangen.includes("ZWAKTE_GEWISSELD") ? "ZWAKTE_GEWISSELD" : overgangen.includes("FAMILIE_GEWISSELD") ? "FAMILIE_GEWISSELD" : overgangen.includes("STRATEGIE_GEWISSELD") ? "STRATEGIE_GEWISSELD" : overgangen.includes("MEER_BEWIJS") ? "MEER_BEWIJS" : overgangen.includes("NIEUWE_HYPOTHESE") ? "NIEUWE_HYPOTHESE" : "ONDERZOEKT"),
      uitgeslotenKandidaten: uitkomst.kandidaatId ? [...c.uitgeslotenKandidaten, uitkomst.kandidaatId] : c.uitgeslotenKandidaten,
      pogingenPerDimensie: pogingen,
      wachtrij: rondAf(c.wachtrij, geclaimd.job.id, "DONE"),
      budget: verrekenen(c.budget, geclaimd.job.id, { minuten: duur / 60000, modelCalls: 0 }),
      productie: c.productie && deps.productie ? { ...c.productie, laatst: deps.productie() } : c.productie,
      gebeurtenissen: [
        ...c.gebeurtenissen,
        {
          op: iso(eind),
          tekst: `Cyclus ${nr}: ${uitkomst.beslissing}${uitkomst.verdict ? ` (rechter ${uitkomst.verdict})` : ""}${uitkomst.kandidaatId ? `, kandidaat ${uitkomst.kandidaatId}` : ""}${uitkomst.strategie ? `, ${dim}/${uitkomst.strategie}` : ""}${overgangen.length > 0 ? ` [${overgangen.join(", ")}]` : ""}.`,
        },
        ...extra,
      ],
    };
    bewaar(c);

    if (uitkomst.beslissing === "NOT_EXECUTED") return eindig("DONE", "GEEN_DIAGNOSE", "Geen echte diagnose mogelijk (LOCAL REQUIRED) — run stopt eerlijk.");
    if (uitkomst.beslissing === "UITGEPUT") {
      // Uitputting van de huidige zoekruimte is geen einde van de run (§55).
      // Eerst: zwaktes die alleen door het lokale vangnet dicht zitten maar in
      // de pool nog open hypothesen hebben, weer openen.
      const z = c.zoekruimte!;
      const ls = lessen();
      const heropen = (c.uitgeslotenDimensies ?? []).filter((d) => {
        const st = stand(d, ls, poolVoor(z, d), { paren: c.geblokkeerdeParen ?? [] });
        return !st.uitgeput && !st.behouden;
      });
      if (heropen.length > 0) {
        const pg = { ...c.pogingenPerDimensie };
        for (const d of heropen) delete pg[d];
        c = { ...c, uitgeslotenDimensies: (c.uitgeslotenDimensies ?? []).filter((d) => !heropen.includes(d)), pogingenPerDimensie: pg, gebeurtenissen: [...c.gebeurtenissen, { op: iso(deps.nu()), tekst: `Heropend: ${heropen.join(", ")} — lokaal vangnet, maar de zoekruimte heeft er nog open hypothesen.` }] };
        bewaar(c);
        continue;
      }
      if (z.golven.length >= zoek.maxGolven) {
        return eindig("STOPPED", "CAPACITEIT_BLOKKADE", `Zoekgrens bereikt: ${zoek.maxGolven} golven zonder behouden kandidaat, en de huidige zoekruimte is op. Geen succes — escaleer naar Claude/mens: een nieuwe capaciteit (andere interventiesoort, model of meetinstrument) is nodig.`);
      }
      const g = verbreed("POOL_UITGEPUT", nr);
      if (g.hypothesen.length === 0) {
        const alleenMens = g.analyse.length === 0 && (g.wachtOpMens ?? []).length > 0;
        return eindig(
          "STOPPED",
          "CAPACITEIT_BLOKKADE",
          alleenMens
            ? "Elke gemeten zwakte heeft een behouden kandidaat die op een menselijk besluit wacht; er is niets nieuws te onderzoeken tot een mens beslist. Geen succes — escalatie naar een mens."
            : `De regisseur kon uit ${g.lesIds.length} les(sen) geen nieuwe hypothese meer maken (${g.geweigerd.length} voorstel(len) geweigerd als niet nieuw of ongeldig)${g.testGaten.length > 0 ? `; geen testgrammatica voor ${g.testGaten.join(", ")}` : ""}. Geen succes — escaleer naar Claude/mens: een nieuwe capaciteit (andere interventiesoort, model of meetinstrument) is nodig.`,
        );
      }
      continue;
    }
    if (herhalingen > verkenning.herhalingsTolerantie) {
      return eindig("STOPPED", "HERHAALDE_FOUT", `Een al verworpen strategie kwam ${herhalingen}x terug: het leergeheugen wordt niet gerespecteerd — echte fout, run gestopt.`);
    }
  }
}
