import path from "node:path";

/**
 * Instellingen en harde grenzen van de Demo Room.
 *
 * Niets hier is geheim of gevoelig — het is bewust een klein bestand, zodat
 * één blik volstaat om te zien binnen welke grenzen een run draait. Wie een
 * grens wil verruimen, wijzigt dit bestand en niet een losse constante ergens
 * diep in een module.
 */

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DEMO_ROOM_ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(DEMO_ROOM_ROOT, "data");
export const REPORTS_DIR = path.join(DEMO_ROOM_ROOT, "reports");
export const REPORTS_HISTORY_DIR = path.join(REPORTS_DIR, "history");
export const HANDOFF_PATH = path.join(DEMO_ROOM_ROOT, "HANDOFF.md");

/**
 * De standplaats waarop de Demo Room werkt.
 *
 * Standaard DDR (Dordrecht) — hetzelfde echte pakket als de Roostercommissie
 * gebruikt, want de opdracht is nadrukkelijk: test Lyra met dezelfde kennis
 * die zij in het echt heeft, niet met een verarmde kopie. Instelbaar voor het
 * geval een latere standplaats erbij komt.
 */
export function locationCode(): string {
  return process.env.DEMO_ROOM_LOCATION_CODE?.trim() || "DDR";
}

/**
 * Het personeelsnummer van het technische account waarmee de Demo Room draait.
 *
 * Geen automatisch gekozen account: wie de Demo Room drijft moet met naam en
 * personeelsnummer in het auditlogboek staan, net als elke andere gebruiker
 * van de agent. Zonder deze variabele start er niets.
 */
export function actorEmployeeNumber(): string | null {
  return process.env.DEMO_ROOM_ACTOR_EMPLOYEE_NUMBER?.trim() || null;
}

/**
 * Compute-budget voor één run. Elk veld heeft een harde standaardwaarde zodat
 * een vergeten vlag nooit tot een ongelimiteerde lus leidt (§23 van de opdracht).
 */
export interface ComputeBudget {
  readonly maxWallClockMinutes: number;
  readonly maxModelCalls: number;
  readonly maxOptimizerRuns: number;
  readonly maxCandidates: number;
  readonly maxFailedExperiments: number;
  readonly maxConcurrentWorkers: number;
}

export const DEFAULT_BUDGET: ComputeBudget = {
  maxWallClockMinutes: 10,
  maxModelCalls: 60,
  maxOptimizerRuns: 6,
  maxCandidates: 12,
  maxFailedExperiments: 8,
  // v0.1: één Lyra. Het jobschema staat een hoger getal toe zodra er
  // meerdere workers bestaan (§26 van de opdracht) — vandaag betekent een
  // waarde boven 1 nog niets extra's.
  maxConcurrentWorkers: 1,
};

export function budgetFromMinutes(minutes: number, overrides?: Partial<ComputeBudget>): ComputeBudget {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("compute-budget: minuten moet een positief getal zijn");
  // Vuistregel, niet gemeten: ruim voldoende ruimte per rekenopdracht en per
  // modelaanroep, zodat het budget zelden de beperkende factor is vóór de
  // wandklok het is. Een run die dit te ruim vindt, stopt vanzelf op
  // "geen verbetering meer" (STOPPEN_GEEN_VERBETERING uit de onderzoekslus).
  return {
    maxWallClockMinutes: minutes,
    maxModelCalls: Math.max(10, Math.round(minutes * 6)),
    maxOptimizerRuns: Math.max(2, Math.round(minutes / 5)),
    maxCandidates: Math.max(4, Math.round(minutes / 2)),
    maxFailedExperiments: Math.max(4, Math.round(minutes / 4)),
    maxConcurrentWorkers: 1,
    ...overrides,
  };
}

/** Poort waarop het lokale dashboard luistert. */
export function dashboardPort(): number {
  const raw = process.env.DEMO_ROOM_PORT?.trim();
  const n = raw ? Number(raw) : 4173;
  return Number.isFinite(n) && n > 0 ? n : 4173;
}
