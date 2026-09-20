import type { ComponentKey } from "./quality-model";

/**
 * De beslislogica van de adaptieve zoekmachine, zonder solver en zonder database.
 *
 * ## Waarom dit los staat
 *
 * Welke kandidaat in de elitepool komt, wanneer een reparatie wordt aanvaard,
 * wanneer het zoeken ophoudt en welke drie kandidaten de Roostercommissie ziet:
 * dat zijn beslissingen die ook zonder CP-SAT te toetsen moeten zijn. Hier staan
 * ze als zuivere functies, met de getallen uit de engineconfiguratie als
 * invoer. De engine zelf roept de solver aan en voert deze beslissingen uit.
 *
 * ## Harde geldigheid eerst
 *
 * Geen enkele functie hier weegt harde geldigheid af tegen kwaliteit. Een
 * kandidaat komt pas in de pool nadat de eindvalidatie en de kwaliteitsevaluator
 * hem hard geldig hebben verklaard; de rangschikking gaat daarna alleen nog over
 * kwaliteit.
 */

/** Scores per onderdeel; "voorkeur" bestaat alleen vanaf model v3 en mag ontbreken. */
export type ComponentScores = Readonly<Record<Exclude<ComponentKey, "preference">, number | null>> & { readonly preference?: number | null };

export interface PoolCandidate {
  readonly key: string;
  readonly attempt: number;
  readonly robust: number;
  readonly overall: number;
  readonly ranking: number;
  readonly components: ComponentScores;
  /** Dienstdag → dienstnummer, voor de afstand tussen kandidaten. */
  readonly slots: ReadonlyMap<string, string | null>;
  readonly facts: GateFacts;
}

export interface GateFacts {
  readonly singletonNights: number;
  readonly heavyTransitions: number;
  readonly maxRosterHoursDeviation: number;
  readonly worstLine: number | null;
}

export type CandidateVerdict =
  | "HARD_INVALID"
  | "PROFILE_INVALID"
  | "COVERAGE_INCOMPLETE"
  | "DUPLICATE"
  | "LOW_QUALITY"
  | "DOMINATED"
  | "REPAIR_FAILED"
  | "REPAIR_REJECTED"
  | "TIMEOUT"
  | "VALID_ELITE";

// ── Afstand ──────────────────────────────────────────────────────────────────

/** Op hoeveel dienstdagen twee kandidaten een ander dienstnummer hebben. */
export function assignmentDistance(a: ReadonlyMap<string, string | null>, b: ReadonlyMap<string, string | null>): number {
  let anders = 0;
  for (const [slot, code] of a) {
    if (b.get(slot) !== code) anders += 1;
  }
  return anders;
}

// ── Rangschikking ────────────────────────────────────────────────────────────

/**
 * De rangschikkingsscore voor een strategie.
 *
 * Dezelfde componenten als het kwaliteitsmodel, met per strategie een kanteling:
 * "Rust & regelmaat" telt regelmaat en rust zwaarder mee. De benchmark
 * rapporteert altijd het ongekantelde model; deze score bepaalt alleen de
 * volgorde binnen één opdracht.
 */
export function rankingScore(
  components: ComponentScores,
  worstLine: number | null,
  modelWeights: Readonly<Partial<Record<ComponentKey, number>>>,
  tilt: Readonly<Partial<Record<ComponentKey, number>>>,
  robust: { readonly overallWeight: number; readonly worstLineWeight: number; readonly outlierGapPoints: number; readonly outlierPenaltyPerPoint: number },
  medianLine: number | null,
  /**
   * Strafpunten voor het slechtste geval in het pakket (model v2, H10): een
   * extreme nachtuitgang, overgang of werkblok. Dezelfde aftrek als in de
   * robuuste score, zodat rangschikking en rapport hetzelfde zeggen.
   */
  worstCasePenalty = 0,
): number {
  let som = 0;
  let gewicht = 0;
  for (const key of Object.keys(modelWeights) as ComponentKey[]) {
    const waarde = components[key];
    if (waarde === null || waarde === undefined) continue;
    const w = (modelWeights[key] ?? 0) * (tilt[key] ?? 1);
    som += waarde * w;
    gewicht += w;
  }
  const totaal = gewicht > 0 ? som / gewicht : 0;
  if (worstLine === null || medianLine === null) {
    return totaal - worstCasePenalty;
  }
  return (
    robust.overallWeight * totaal +
    robust.worstLineWeight * worstLine -
    robust.outlierPenaltyPerPoint * Math.max(0, medianLine - worstLine - robust.outlierGapPoints) -
    worstCasePenalty
  );
}

// ── Pareto ───────────────────────────────────────────────────────────────────

/** A domineert B: nergens slechter, ergens beter. Componenten zonder waarde tellen niet. */
export function dominates(a: ComponentScores, b: ComponentScores, tolerance = 0): boolean {
  let ergensBeter = false;
  for (const key of Object.keys(a) as ComponentKey[]) {
    const x = a[key] ?? null;
    const y = b[key] ?? null;
    if (x === null || y === null) continue;
    if (x < y - tolerance) return false;
    if (x > y + tolerance) ergensBeter = true;
  }
  return ergensBeter;
}

export function paretoFront<T extends { readonly components: ComponentScores }>(pool: readonly T[], tolerance = 0): T[] {
  return pool.filter((kandidaat) => !pool.some((ander) => ander !== kandidaat && dominates(ander.components, kandidaat.components, tolerance)));
}

// ── De kwaliteitspoort ───────────────────────────────────────────────────────

export interface QualityGate {
  readonly minRobust: number;
  readonly maxSingletonNights: number;
  readonly maxHeavyTransitions: number;
  readonly maxRosterHoursDeviation: number;
  readonly minWorstLine: number;
}

/**
 * De drempels voor presentatie, afgeleid van het officiële rooster.
 *
 * Geen juridische grens en geen absolute norm: een kandidaat die op deze punten
 * duidelijk slechter is dan wat roostermakers nu met de hand maken, wordt niet
 * aan de Roostercommissie voorgelegd. Hij blijft in het zoekjournaal staan.
 */
export function gateFromOfficial(
  official: { readonly robust: number; readonly facts: GateFacts },
  tolerance: {
    readonly robustPoints: number;
    readonly singletonNights: number;
    readonly heavyTransitions: number;
    readonly hoursMinutes: number;
    readonly hoursFloorMinutes: number;
    readonly worstLinePoints: number;
  },
): QualityGate {
  return {
    minRobust: official.robust - tolerance.robustPoints,
    maxSingletonNights: official.facts.singletonNights + tolerance.singletonNights,
    maxHeavyTransitions: official.facts.heavyTransitions + tolerance.heavyTransitions,
    maxRosterHoursDeviation: Math.max(official.facts.maxRosterHoursDeviation, tolerance.hoursFloorMinutes) + tolerance.hoursMinutes,
    minWorstLine: (official.facts.worstLine ?? 0) - tolerance.worstLinePoints,
  };
}

export function gateFailures(candidate: { readonly robust: number; readonly facts: GateFacts }, gate: QualityGate): string[] {
  const redenen: string[] = [];
  if (candidate.robust < gate.minRobust) redenen.push(`robuuste kwaliteit ${candidate.robust.toFixed(1)} < ${gate.minRobust.toFixed(1)}`);
  if (candidate.facts.singletonNights > gate.maxSingletonNights) redenen.push(`${candidate.facts.singletonNights} losse nachten > ${gate.maxSingletonNights}`);
  if (candidate.facts.heavyTransitions > gate.maxHeavyTransitions) redenen.push(`${candidate.facts.heavyTransitions} zware overgangen > ${gate.maxHeavyTransitions}`);
  if (candidate.facts.maxRosterHoursDeviation > gate.maxRosterHoursDeviation) {
    redenen.push(`urenafwijking ${Math.round(candidate.facts.maxRosterHoursDeviation)} min > ${Math.round(gate.maxRosterHoursDeviation)} min`);
  }
  if (candidate.facts.worstLine !== null && candidate.facts.worstLine < gate.minWorstLine) {
    redenen.push(`slechtste regel ${candidate.facts.worstLine.toFixed(1)} < ${gate.minWorstLine.toFixed(1)}`);
  }
  return redenen;
}

// ── De elitepool ─────────────────────────────────────────────────────────────

export interface PoolInsert {
  readonly verdict: CandidateVerdict;
  readonly reason: string;
  readonly pool: readonly PoolCandidate[];
  readonly nearest: { readonly key: string; readonly distance: number } | null;
}

/**
 * Een hard geldige, beoordeelde kandidaat aanbieden aan de pool.
 *
 * Bijna-dubbelen worden niet naast elkaar bewaard: de betere van de twee blijft.
 * Is de pool vol, dan valt de laagst gerangschikte af — tenzij de nieuwe zelf de
 * laagste is.
 */
export function offerToPool(
  pool: readonly PoolCandidate[],
  candidate: PoolCandidate,
  options: { readonly maxSize: number; readonly duplicateDistance: number; readonly gate: QualityGate | null },
): PoolInsert {
  if (options.gate) {
    const redenen = gateFailures(candidate, options.gate);
    if (redenen.length > 0) {
      return { verdict: "LOW_QUALITY", reason: redenen.join("; "), pool, nearest: dichtsbij(pool, candidate) };
    }
  }
  const nearest = dichtsbij(pool, candidate);
  if (nearest && nearest.distance < options.duplicateDistance) {
    const bestaand = pool.find((entry) => entry.key === nearest.key)!;
    if (bestaand.ranking >= candidate.ranking) {
      return {
        verdict: "DUPLICATE",
        reason: `verschilt op ${nearest.distance} dienstdagen van poging ${bestaand.attempt} en is niet beter`,
        pool,
        nearest,
      };
    }
    const zonder = pool.filter((entry) => entry.key !== nearest.key);
    return { verdict: "VALID_ELITE", reason: `vervangt de bijna gelijke poging ${bestaand.attempt}`, pool: sorteer([...zonder, candidate]), nearest };
  }
  const nieuw = sorteer([...pool, candidate]);
  if (nieuw.length <= options.maxSize) {
    return { verdict: "VALID_ELITE", reason: "opgenomen in de elitepool", pool: nieuw, nearest };
  }
  const laatste = nieuw[nieuw.length - 1];
  if (laatste.key === candidate.key) {
    return { verdict: "DOMINATED", reason: "de pool is vol en deze kandidaat rangschikt het laagst", pool, nearest };
  }
  return { verdict: "VALID_ELITE", reason: `opgenomen; poging ${laatste.attempt} viel uit de pool`, pool: nieuw.slice(0, options.maxSize), nearest };
}

function sorteer(pool: readonly PoolCandidate[]): PoolCandidate[] {
  return [...pool].sort((a, b) => b.ranking - a.ranking || a.attempt - b.attempt);
}

function dichtsbij(pool: readonly PoolCandidate[], candidate: PoolCandidate): { key: string; distance: number } | null {
  let beste: { key: string; distance: number } | null = null;
  for (const entry of pool) {
    const afstand = assignmentDistance(entry.slots, candidate.slots);
    if (!beste || afstand < beste.distance) beste = { key: entry.key, distance: afstand };
  }
  return beste;
}

// ── Reparatie ────────────────────────────────────────────────────────────────

/**
 * NIGHTS: losse nachten en reeksen van twee. NIGHT_EXIT: een nachtreeks met
 * minder herstel dan de regel (werkopdracht §18). TRANSITIONS: zware overgangen
 * en heen-en-weer. De begintijden hebben geen eigen reparatie: CP-SAT kon ze
 * niet sturen zonder nachten en eerlijkheid te laten zakken (H03); het
 * bijschaven op model v2 doet het.
 */
export type RepairTarget = "NIGHTS" | "NIGHT_EXIT" | "TRANSITIONS" | "HOURS" | "FAIRNESS" | "REST";

export interface RepairDiagnosis {
  readonly target: RepairTarget;
  readonly severity: number;
  readonly reason: string;
}

/**
 * Welke zwakte van een kandidaat een gerichte reparatie het meest waard is.
 *
 * Alleen op berekende feiten, afgezet tegen het officiële rooster: een
 * component die al beter is dan officieel, is geen reparatie waard zolang er een
 * component is die slechter is.
 */
export function diagnoseRepair(
  components: ComponentScores,
  official: ComponentScores,
  facts: GateFacts & { readonly twoNightBlocks: number; readonly nightExitsBelowRule?: number },
  skip: ReadonlySet<RepairTarget>,
  options: {
    /** Een uitgang onder de herstelregel is een eigen reparatiedoel. */
    readonly nightExitRepair?: boolean;
    /** Nachtdoelen gaan vóór alle andere, ongeacht hun ernst (§19). */
    readonly nightFirst?: boolean;
  } = {},
): RepairDiagnosis[] {
  const kandidaten: RepairDiagnosis[] = [];
  const tekort = (key: ComponentKey) => {
    const eigen = components[key];
    if (eigen === null || eigen === undefined) return 0;
    const ref = official[key] ?? 100;
    // Ruimte tot 100, zwaarder als de kandidaat onder het officiële rooster zit.
    return (100 - eigen) + Math.max(0, ref - eigen);
  };
  if (facts.singletonNights > 0 || facts.twoNightBlocks > 0) {
    kandidaten.push({
      target: "NIGHTS",
      severity: tekort("nights") + facts.singletonNights * 10,
      reason: `${facts.singletonNights} losse nacht(en), ${facts.twoNightBlocks} reeks(en) van twee`,
    });
  }
  const uitgangen = facts.nightExitsBelowRule ?? 0;
  if (options.nightExitRepair && uitgangen > 0) {
    kandidaten.push({
      target: "NIGHT_EXIT",
      severity: tekort("nights") + uitgangen * 12,
      reason: `${uitgangen} nachtuitgang(en) met minder herstel dan de regel`,
    });
  }
  if (facts.heavyTransitions > 0 || (components.flow ?? 100) < 90) {
    kandidaten.push({ target: "TRANSITIONS", severity: tekort("flow") + facts.heavyTransitions * 8, reason: `${facts.heavyTransitions} zware overgang(en), regelmaat ${components.flow}` });
  }
  kandidaten.push({ target: "HOURS", severity: tekort("hours"), reason: `grootste urenafwijking ${Math.round(facts.maxRosterHoursDeviation)} min, urenscore ${components.hours}` });
  kandidaten.push({ target: "FAIRNESS", severity: tekort("fairness"), reason: `eerlijkheid ${components.fairness}` });
  kandidaten.push({ target: "REST", severity: tekort("rest") * 0.8, reason: `rust ${components.rest}` });
  const nacht = (t: RepairTarget) => (options.nightFirst && (t === "NIGHTS" || t === "NIGHT_EXIT") ? 1 : 0);
  return kandidaten
    .filter((k) => !skip.has(k.target) && k.severity > 1)
    .sort((a, b) => nacht(b.target) - nacht(a.target) || b.severity - a.severity);
}

export interface RepairAcceptance {
  readonly accepted: boolean;
  readonly reason: string;
  readonly deltas: Readonly<Record<string, number | null>>;
}

/**
 * Geen destructieve reparatie.
 *
 * Een reparatie wordt alleen aanvaard als de rangschikking vooruitgaat én geen
 * enkele component meer dan de tolerantie achteruitgaat. Een betere nachtreeks
 * die drie andere dingen slechter maakt, blijft in het journaal staan als
 * afgewezen — met de verschillen erbij.
 */
export function acceptRepair(
  parent: { readonly ranking: number; readonly components: ComponentScores },
  child: { readonly ranking: number; readonly components: ComponentScores },
  options: {
    readonly minRankingGain: number;
    readonly maxComponentLoss: number;
    /**
     * Strengere grens per onderdeel. Eerlijkheid mag bijvoorbeeld nauwelijks
     * zakken: v1.0.4 leverde daar al 1,4 punt op in.
     */
    readonly componentTolerances?: Readonly<Partial<Record<ComponentKey, number>>>;
  },
): RepairAcceptance {
  const deltas: Record<string, number | null> = { ranking: round1(child.ranking - parent.ranking) };
  const verliezen: string[] = [];
  for (const key of Object.keys(parent.components) as ComponentKey[]) {
    const a = parent.components[key] ?? null;
    const b = child.components[key] ?? null;
    deltas[key] = a === null || b === null ? null : round1(b - a);
    const grens = options.componentTolerances?.[key] ?? options.maxComponentLoss;
    if (a !== null && b !== null && b < a - grens) {
      verliezen.push(`${key} ${round1(b - a)}`);
    }
  }
  if (verliezen.length > 0) {
    return { accepted: false, reason: `verslechtert ${verliezen.join(", ")}`, deltas };
  }
  if (child.ranking < parent.ranking + options.minRankingGain) {
    return { accepted: false, reason: `rangschikking ${round1(child.ranking - parent.ranking)} (minder dan ${options.minRankingGain} winst)`, deltas };
  }
  return { accepted: true, reason: `rangschikking +${round1(child.ranking - parent.ranking)}`, deltas };
}

// ── Plateau ──────────────────────────────────────────────────────────────────

/** Is de beste score in de laatste `window` iteraties minder dan `minGain` verbeterd? */
export function plateauReached(bestHistory: readonly number[], window: number, minGain: number): boolean {
  if (bestHistory.length <= window) return false;
  const nu = bestHistory[bestHistory.length - 1];
  const toen = bestHistory[bestHistory.length - 1 - window];
  return nu - toen < minGain;
}

// ── Adaptieve druk ───────────────────────────────────────────────────────────

/**
 * Hoeveel extra druk elke zachte doelgroep krijgt in de volgende start.
 *
 * Kijkt naar de beste kandidaat tot nu toe: waar die duidelijk onder het
 * officiële rooster of onder de rest van zijn eigen componenten zit, gaat de
 * druk omhoog; waar hij al goed is, zakt de druk terug naar 1. Harde grenzen
 * hebben geen gewicht en komen hier dus niet voor.
 */
export function adaptPressure(
  best: ComponentScores,
  official: ComponentScores,
  previous: Readonly<Record<string, number>>,
  options: { readonly step: number; readonly max: number; readonly decay: number },
): Record<string, number> {
  const druk: Record<string, number> = { ...previous };
  const waarden = (Object.values(best).filter((v) => v !== null) as number[]);
  const gemiddeld = waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : 100;
  for (const key of ["hours", "flow", "rest", "nights", "fairness"] as const) {
    const eigen = best[key];
    const huidig = druk[key] ?? 1;
    if (eigen === null) {
      druk[key] = huidig;
      continue;
    }
    const ref = official[key] ?? eigen;
    const zwak = eigen < ref - 1 || eigen < gemiddeld - 8;
    druk[key] = zwak ? Math.min(options.max, huidig * options.step) : Math.max(1, huidig * options.decay);
  }
  return druk;
}

// ── De uiteindelijke drie ────────────────────────────────────────────────────

export interface FinalSelection {
  readonly selected: readonly PoolCandidate[];
  readonly skipped: readonly { readonly key: string; readonly reason: string }[];
}

/**
 * Kies tot drie kandidaten: de beste, daarna zo verschillend mogelijk.
 *
 * De eerste is de hoogst gerangschikte. De volgende komen bij voorkeur uit het
 * Pareto-front (niet gedomineerd) en moeten van elke al gekozen kandidaat op
 * ten minste `minDistance` dienstdagen verschillen. Halen er maar twee de
 * drempel, dan zijn het er twee.
 */
export function selectFinal(pool: readonly PoolCandidate[], options: { readonly count: number; readonly minDistance: number }): FinalSelection {
  const gesorteerd = sorteer(pool);
  const front = new Set(paretoFront(gesorteerd).map((entry) => entry.key));
  const gekozen: PoolCandidate[] = [];
  const overgeslagen: { key: string; reason: string }[] = [];
  const volgorde = [
    ...gesorteerd.filter((entry) => front.has(entry.key)),
    ...gesorteerd.filter((entry) => !front.has(entry.key)),
  ];
  if (gesorteerd.length > 0) {
    gekozen.push(gesorteerd[0]);
  }
  for (const kandidaat of volgorde) {
    if (gekozen.length >= options.count) break;
    if (gekozen.some((entry) => entry.key === kandidaat.key)) continue;
    const afstand = Math.min(...gekozen.map((entry) => assignmentDistance(entry.slots, kandidaat.slots)));
    if (afstand < options.minDistance) {
      overgeslagen.push({ key: kandidaat.key, reason: `verschilt op ${afstand} dienstdagen, minder dan ${options.minDistance}` });
      continue;
    }
    gekozen.push(kandidaat);
  }
  return { selected: gekozen, skipped: overgeslagen };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
