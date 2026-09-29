import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
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

export type LongRunProfiel = "1h" | "6h" | "24h" | "handmatig";
export const PROFIEL_MINUTEN: Readonly<Record<LongRunProfiel, number>> = { "1h": 60, "6h": 360, "24h": 1440, handmatig: Number.POSITIVE_INFINITY };

export type LongRunStatus = "RUNNING" | "PAUSED" | "STOPPED" | "DONE";
export type LongRunStopReden = "BUDGET_OP" | "GEEN_DIAGNOSE" | "GEEN_VOORTGANG" | "ALLES_GEPROBEERD" | "HANDMATIG_GESTOPT" | "MAX_CYCLI" | "HERHAALDE_FOUT";

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
  /** Welk model de meting deed — bewijs dat het geen stub was. */
  readonly model?: string | null;
}

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
  readonly cycli: readonly (CyclusUitkomst & { readonly nr: number; readonly klaarOp: string; readonly duurMs: number })[];
  readonly uitgeslotenKandidaten: readonly string[];
  readonly pogingenPerDimensie: Readonly<Record<string, number>>;
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
  readonly cyclus: (ctx: { runId: string; uitgesloten: readonly string[] }) => Promise<CyclusUitkomst>;
  readonly nu: () => number;
  /** Welke productieversie is nu actief (releasedienst)? Voor het bewijs dat de run niets activeerde. */
  readonly productie?: () => ProductieStand;
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
    schrijf({ ...c, status: "STOPPED", stopReden: "HANDMATIG_GESTOPT", bijgewerktOp: op, wachtrij: annuleer(c.wachtrij, `gestopt door ${door}`), gebeurtenissen: [...c.gebeurtenissen, { op, tekst: `Gestopt door ${door} (tijdens pauze).` }] });
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
  /**
   * Vangnet: zo vaak mag één dimensie zonder promotie terugkomen vóór de run
   * stopt. Met het leergeheugen (develop/lessons.ts) wordt dit niet gehaald:
   * na drie strategieën (elk hoogstens twee keer onbeslist) is een dimensie
   * uitgeput en kiest de cyclus een andere, of meldt UITGEPUT. Wordt het wel
   * gehaald, dan klopt er iets niet en stopt de run liever dan eindeloos door te gaan.
   */
  readonly maxPogingenPerDimensie?: number;
  /** Veiligheidsgrens voor `handmatig`: nooit echt oneindig zonder mens. */
  readonly maxCycli?: number;
}

/**
 * Start een nieuwe lange run of hervat een bestaande (zelfde runId). Keert
 * terug zodra de run PAUSED, STOPPED of DONE is.
 */
export async function draaiLongRun(opties: LongRunOpties, deps: LongRunDeps): Promise<LongRunCheckpoint> {
  const maxPogingen = opties.maxPogingenPerDimensie ?? 7;
  const maxCycli = opties.maxCycli ?? 500;
  const begin = deps.nu();
  const iso = (t: number) => new Date(t).toISOString();
  const workerId = `lokaal-${process.pid}-${begin}`;

  const bestaand = leesCheckpoint(opties.runId);
  if (bestaand && (bestaand.status === "DONE" || bestaand.status === "STOPPED")) return bestaand;

  const budgetMinuten = PROFIEL_MINUTEN[opties.profiel];
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
        wachtrij: registreerWorker(leeg(), workerId, ["cyclus"], begin),
        budget: nieuwBudget(Number.isFinite(budgetMinuten) ? budgetMinuten : 1e9, 1e9),
        gebeurtenissen: [{ op: iso(begin), tekst: `Gestart, profiel ${opties.profiel}.` }],
        productie: deps.productie ? { bijStart: deps.productie(), laatst: deps.productie() } : null,
      };
  // Hervatten heft een pauze op; een stopverzoek blijft staan.
  wisControle(opties.runId, "PAUSE");
  schrijf(c);

  const eindig = (status: LongRunStatus, stopReden: LongRunStopReden | null, tekst: string): LongRunCheckpoint => {
    const t = deps.nu();
    c = {
      ...c,
      status,
      stopReden,
      bijgewerktOp: iso(t),
      wachtrij: status === "PAUSED" ? c.wachtrij : annuleer(c.wachtrij, tekst),
      gebeurtenissen: [...c.gebeurtenissen, { op: iso(t), tekst }],
    };
    schrijf(c);
    return c;
  };

  for (;;) {
    const controle = leesControle(opties.runId);
    if (controle?.commando === "STOP") return eindig("STOPPED", "HANDMATIG_GESTOPT", `Gestopt door ${controle.door}.`);
    if (controle?.commando === "PAUSE") {
      wisControle(opties.runId);
      return eindig("PAUSED", null, `Gepauzeerd door ${controle.door}; actieve tijd tot nu ${(c.actieveMs / 60000).toFixed(1)} min.`);
    }
    if (c.budgetMinuten !== null && c.actieveMs / 60000 >= c.budgetMinuten) return eindig("DONE", "BUDGET_OP", `Actief budget van ${c.budgetMinuten} min op.`);
    if (c.cycli.length >= maxCycli) return eindig("DONE", "MAX_CYCLI", `Veiligheidsgrens van ${maxCycli} cycli bereikt.`);

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
    schrijf(c);

    const start = deps.nu();
    let uitkomst: CyclusUitkomst;
    try {
      uitkomst = await deps.cyclus({ runId: c.runId, uitgesloten: c.uitgeslotenKandidaten });
    } catch (fout) {
      const duur = deps.nu() - start;
      const reden = fout instanceof Error ? fout.message : String(fout);
      const job = geclaimd.job;
      q = job.pogingen >= job.maxPogingen ? rondAf(c.wachtrij, job.id, "FAILED", reden) : { ...c.wachtrij, jobs: c.wachtrij.jobs.map((j) => (j.id === job.id ? { ...j, status: "QUEUED" as const, lease: null, reden } : j)) };
      c = { ...c, actieveMs: c.actieveMs + duur, wachtrij: q, budget: verrekenen(c.budget, job.id, { minuten: duur / 60000, modelCalls: 0 }), gebeurtenissen: [...c.gebeurtenissen, { op: iso(deps.nu()), tekst: `Cyclus ${nr} fout (poging ${job.pogingen}/${job.maxPogingen}): ${reden}` }] };
      schrijf(c);
      if (job.pogingen >= job.maxPogingen) return eindig("STOPPED", "HERHAALDE_FOUT", `Cyclus ${nr} faalde ${job.maxPogingen} keer; run gestopt om niet blind door te gaan.`);
      continue;
    }
    const eind = deps.nu();
    const duur = eind - start;
    const dim = uitkomst.dimensie ?? "onbekend";
    const pogingen = { ...c.pogingenPerDimensie };
    if (uitkomst.beslissing === "PROMOTION_CANDIDATE") delete pogingen[dim];
    else if (uitkomst.beslissing !== "NOT_EXECUTED" && uitkomst.beslissing !== "UITGEPUT") pogingen[dim] = (pogingen[dim] ?? 0) + 1;

    c = {
      ...c,
      actieveMs: c.actieveMs + duur,
      bijgewerktOp: iso(eind),
      cycli: [...c.cycli, { ...uitkomst, nr, klaarOp: iso(eind), duurMs: duur }],
      uitgeslotenKandidaten: uitkomst.kandidaatId ? [...c.uitgeslotenKandidaten, uitkomst.kandidaatId] : c.uitgeslotenKandidaten,
      pogingenPerDimensie: pogingen,
      wachtrij: rondAf(c.wachtrij, geclaimd.job.id, "DONE"),
      budget: verrekenen(c.budget, geclaimd.job.id, { minuten: duur / 60000, modelCalls: 0 }),
      productie: c.productie && deps.productie ? { ...c.productie, laatst: deps.productie() } : c.productie,
      gebeurtenissen: [...c.gebeurtenissen, { op: iso(eind), tekst: `Cyclus ${nr}: ${uitkomst.beslissing}${uitkomst.verdict ? ` (rechter ${uitkomst.verdict})` : ""}${uitkomst.kandidaatId ? `, kandidaat ${uitkomst.kandidaatId}` : ""}.` }],
    };
    schrijf(c);

    if (uitkomst.beslissing === "NOT_EXECUTED") return eindig("DONE", "GEEN_DIAGNOSE", "Geen echte diagnose mogelijk (LOCAL REQUIRED) — run stopt eerlijk.");
    if (uitkomst.beslissing === "UITGEPUT") return eindig("DONE", "ALLES_GEPROBEERD", "Elke gemeten zwakte is met alle strategieën geprobeerd of wacht op een mens — run stopt eerlijk.");
    if ((pogingen[dim] ?? 0) >= maxPogingen) return eindig("DONE", "GEEN_VOORTGANG", `Dimensie ${dim} ${pogingen[dim]}x verworpen zonder promotie.`);
  }
}
