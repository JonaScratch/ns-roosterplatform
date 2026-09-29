import { domineert } from "../benchmark/pareto";
import type { CandidatePoint } from "../types";

/**
 * Pareto-archief (Phase L): alle KEEP-kandidaten, met wie wie domineert.
 *
 * Een archief, geen ranglijst: twee kandidaten die elk op iets anders winnen,
 * blijven allebei op het front. Een gedomineerde kandidaat wordt niet
 * verwijderd maar gemarkeerd (met door wie), zodat later te zien is waarom hij
 * afviel. Metrics met `null`-richting tellen niet mee in de dominantie
 * (zelfde afspraak als benchmark/pareto.ts).
 */

export interface ArchiefItem {
  readonly punt: CandidatePoint;
  readonly toegevoegdOp: string;
  readonly gedomineerdDoor: readonly string[];
}

export interface ParetoArchief {
  readonly richting: Readonly<Record<string, boolean | null>>;
  readonly items: readonly ArchiefItem[];
}

export function leegArchief(richting: Readonly<Record<string, boolean | null>>): ParetoArchief {
  return { richting, items: [] };
}

/** Voegt een punt toe en herberekent wie door wie gedomineerd wordt. Idempotent per kandidaat-id. */
export function voegToeAanArchief(archief: ParetoArchief, punt: CandidatePoint, now: string): ParetoArchief {
  const zonder = archief.items.filter((i) => i.punt.id !== punt.id);
  const alle = [...zonder.map((i) => ({ punt: i.punt, toegevoegdOp: i.toegevoegdOp })), { punt, toegevoegdOp: now }];
  return {
    richting: archief.richting,
    items: alle.map((i) => ({
      ...i,
      gedomineerdDoor: alle.filter((j) => j.punt.id !== i.punt.id && domineert(j.punt, i.punt, archief.richting)).map((j) => j.punt.id),
    })),
  };
}

export function front(archief: ParetoArchief): readonly CandidatePoint[] {
  return archief.items.filter((i) => i.gedomineerdDoor.length === 0).map((i) => i.punt);
}
