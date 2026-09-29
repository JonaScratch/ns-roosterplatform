/**
 * Werkverdeling (Phase N): JobQueue, WorkerRegistry en BudgetManager.
 *
 * Puur en deterministisch (tijd wordt meegegeven), zodat crash- en
 * herstelgedrag te toetsen is zonder echte processen. Dit is bewust alleen
 * de logica; de lange run (longRun.ts) bewaart deze toestand in zijn
 * checkpoint.
 *
 * Kernregels:
 *  - Een job wordt geclaimd met een lease; een worker die geen hartslag meer
 *    geeft, verliest de lease en de job gaat terug in de wachtrij (tot
 *    `maxPogingen`, daarna FAILED met de reden).
 *  - Dezelfde idempotentiesleutel wordt nooit twee keer ingepland.
 *  - Budget wordt gereserveerd vóór het werk begint en afgerekend met het
 *    werkelijke verbruik; wat niet gereserveerd kan worden, start niet.
 */

export type JobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

export interface Job {
  readonly id: string;
  readonly soort: string;
  readonly idempotentieSleutel: string;
  readonly prioriteit: number;
  readonly vereist: readonly string[];
  readonly status: JobStatus;
  readonly pogingen: number;
  readonly maxPogingen: number;
  readonly lease: { readonly worker: string; readonly tot: number } | null;
  readonly reden: string | null;
  readonly budget: { readonly minuten: number; readonly modelCalls: number };
}

export interface Worker {
  readonly id: string;
  readonly vermogens: readonly string[];
  readonly laatsteHartslag: number;
}

export interface Wachtrij {
  readonly jobs: readonly Job[];
  readonly workers: readonly Worker[];
}

export const LEASE_MS = 5 * 60 * 1000;
export const WORKER_TIMEOUT_MS = 2 * 60 * 1000;

export function leeg(): Wachtrij {
  return { jobs: [], workers: [] };
}

export function planIn(q: Wachtrij, job: Omit<Job, "status" | "pogingen" | "lease" | "reden">): Wachtrij {
  if (q.jobs.some((j) => j.idempotentieSleutel === job.idempotentieSleutel && j.status !== "CANCELLED")) return q;
  return { ...q, jobs: [...q.jobs, { ...job, status: "QUEUED", pogingen: 0, lease: null, reden: null }] };
}

export function registreerWorker(q: Wachtrij, id: string, vermogens: readonly string[], nu: number): Wachtrij {
  return { ...q, workers: [...q.workers.filter((w) => w.id !== id), { id, vermogens, laatsteHartslag: nu }] };
}

export function hartslag(q: Wachtrij, workerId: string, nu: number): Wachtrij {
  return {
    workers: q.workers.map((w) => (w.id === workerId ? { ...w, laatsteHartslag: nu } : w)),
    jobs: q.jobs.map((j) => (j.lease?.worker === workerId && j.status === "RUNNING" ? { ...j, lease: { worker: workerId, tot: nu + LEASE_MS } } : j)),
  };
}

/**
 * Onderhoud: dode workers verwijderen en hun verlopen leases terug in de
 * wachtrij zetten. Een job die zijn laatste poging verbruikte, faalt met reden.
 */
export function onderhoud(q: Wachtrij, nu: number): Wachtrij {
  const levend = q.workers.filter((w) => nu - w.laatsteHartslag <= WORKER_TIMEOUT_MS);
  const levendeIds = new Set(levend.map((w) => w.id));
  return {
    workers: levend,
    jobs: q.jobs.map((j) => {
      if (j.status !== "RUNNING" || !j.lease) return j;
      if (j.lease.tot > nu && levendeIds.has(j.lease.worker)) return j;
      const reden = `lease van ${j.lease.worker} verlopen (worker weg of geen hartslag)`;
      return j.pogingen >= j.maxPogingen ? { ...j, status: "FAILED", lease: null, reden: `${reden}; ${j.pogingen}/${j.maxPogingen} pogingen op` } : { ...j, status: "QUEUED", lease: null, reden };
    }),
  };
}

/** De hoogste prioriteit die deze worker kán doen (op vermogen) en waarvoor budget te reserveren is. */
export function claim(q: Wachtrij, workerId: string, nu: number, budget: BudgetManager): { q: Wachtrij; job: Job | null; budget: BudgetManager } {
  const worker = q.workers.find((w) => w.id === workerId);
  if (!worker) return { q, job: null, budget };
  const kandidaten = q.jobs
    .filter((j) => j.status === "QUEUED" && j.vereist.every((v) => worker.vermogens.includes(v)))
    .sort((a, b) => b.prioriteit - a.prioriteit || a.id.localeCompare(b.id));
  for (const job of kandidaten) {
    const r = reserveer(budget, job.id, job.budget);
    if (!r.ok) continue;
    const geclaimd: Job = { ...job, status: "RUNNING", pogingen: job.pogingen + 1, lease: { worker: workerId, tot: nu + LEASE_MS }, reden: null };
    return { q: { ...q, jobs: q.jobs.map((j) => (j.id === job.id ? geclaimd : j)) }, job: geclaimd, budget: r.budget };
  }
  return { q, job: null, budget };
}

export function rondAf(q: Wachtrij, jobId: string, uitkomst: "DONE" | "FAILED", reden: string | null = null): Wachtrij {
  return { ...q, jobs: q.jobs.map((j) => (j.id === jobId ? { ...j, status: uitkomst, lease: null, reden } : j)) };
}

export function annuleer(q: Wachtrij, reden: string): Wachtrij {
  return { ...q, jobs: q.jobs.map((j) => (j.status === "QUEUED" ? { ...j, status: "CANCELLED", reden } : j)) };
}

// ── BudgetManager ─────────────────────────────────────────────────────────

export interface BudgetManager {
  readonly limiet: { readonly minuten: number; readonly modelCalls: number };
  readonly verbruikt: { readonly minuten: number; readonly modelCalls: number };
  readonly gereserveerd: Readonly<Record<string, { readonly minuten: number; readonly modelCalls: number }>>;
}

export function nieuwBudget(minuten: number, modelCalls: number): BudgetManager {
  return { limiet: { minuten, modelCalls }, verbruikt: { minuten: 0, modelCalls: 0 }, gereserveerd: {} };
}

function vrij(b: BudgetManager): { minuten: number; modelCalls: number } {
  const res = Object.values(b.gereserveerd);
  return {
    minuten: b.limiet.minuten - b.verbruikt.minuten - res.reduce((s, r) => s + r.minuten, 0),
    modelCalls: b.limiet.modelCalls - b.verbruikt.modelCalls - res.reduce((s, r) => s + r.modelCalls, 0),
  };
}

export function reserveer(b: BudgetManager, id: string, nodig: { minuten: number; modelCalls: number }): { ok: boolean; budget: BudgetManager; reden?: string } {
  const v = vrij(b);
  if (nodig.minuten > v.minuten || nodig.modelCalls > v.modelCalls) {
    return { ok: false, budget: b, reden: `onvoldoende budget: nodig ${nodig.minuten} min/${nodig.modelCalls} calls, vrij ${v.minuten.toFixed(1)} min/${v.modelCalls} calls` };
  }
  return { ok: true, budget: { ...b, gereserveerd: { ...b.gereserveerd, [id]: nodig } } };
}

/** Afrekenen met het werkelijke verbruik; de reservering vervalt. */
export function verrekenen(b: BudgetManager, id: string, werkelijk: { minuten: number; modelCalls: number }): BudgetManager {
  const { [id]: _weg, ...rest } = b.gereserveerd;
  return { ...b, gereserveerd: rest, verbruikt: { minuten: b.verbruikt.minuten + werkelijk.minuten, modelCalls: b.verbruikt.modelCalls + werkelijk.modelCalls } };
}

export function vrijBudget(b: BudgetManager): { minuten: number; modelCalls: number } {
  return vrij(b);
}
