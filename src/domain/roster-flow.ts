import {
  type QualityDuty,
  type QualityRosterInput,
  categoryOf,
  dutyKey,
} from "./roster-quality";
import type { TransitionCategory } from "./roster-quality-config";

/**
 * Het ritme van een basisrooster: blokken, wissels, herstel en tijden.
 *
 * ## Waarom een aparte module
 *
 * De menselijke Dordrechtse roosters en de gegenereerde kandidaten moeten met
 * precies dezelfde code worden gemeten. Anders vergelijk je twee meetlatten in
 * plaats van twee roosters. Deze module wordt daarom gebruikt door zowel de
 * benchmark (`scripts/human-benchmark/`) als de kwaliteitsevaluator.
 *
 * ## Wat een dag hier is
 *
 * Een dag heeft één van vijf toestanden: vroeg, laat, nacht (een dienst met
 * dat dagdeel), RES (reserve: beschikbaar, maar zonder vaste tijd) of vrij
 * (rust, WR, CO, verlof, opleiding). RES breekt een werkblok, want er is geen
 * tijd om een overgang op te meten; RES is ook geen vrije dag, want de
 * medewerker moet beschikbaar zijn.
 *
 * ## De cyclus is een cirkel
 *
 * Een medewerker rijdt regel 1, dan regel 2, en na de laatste regel weer
 * regel 1. Zondag van regel N ligt dus direct vóór maandag van regel N+1. Alles
 * hieronder rekent rond: een nachtreeks, een werkblok of een overgang die over
 * de regelgrens loopt, wordt als één geheel gezien.
 */

export type FlowState = "E" | "L" | "N" | "RES" | "OFF";

export interface FlowDay {
  readonly index: number;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: string;
  readonly state: FlowState;
  readonly category: TransitionCategory | null;
  readonly dutyCode: string | null;
  /** Minuten na middernacht van de dienstdag. */
  readonly start: number | null;
  /** Kan voorbij 1440 liggen: de dienst loopt over middernacht. */
  readonly end: number | null;
}

const STATE_OF: Readonly<Record<TransitionCategory, FlowState>> = { EARLY: "E", LATE: "L", NIGHT: "N" };

/** Volgorde van de dagdelen op de klok, voor de richting van een wissel. */
const RANG: Readonly<Record<"E" | "L" | "N", number>> = { E: 0, L: 1, N: 2 };

export function flowDays(
  roster: QualityRosterInput,
  duties: ReadonlyMap<string, QualityDuty>,
): readonly FlowDay[] {
  const gesorteerd = [...roster.days].sort(
    (a, b) => a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday,
  );
  return gesorteerd.map((dag, index) => {
    const duty =
      dag.positionType === "DUTY" && dag.dutyCode ? (duties.get(dutyKey(dag.dutyCode, dag.weekday)) ?? null) : null;
    const category = duty ? categoryOf(duty) : null;
    const state: FlowState =
      dag.positionType === "DUTY"
        ? category
          ? STATE_OF[category]
          : "RES"
        : dag.positionType === "RES"
          ? "RES"
          : "OFF";
    return {
      index,
      lineNumber: dag.lineNumber,
      weekIndex: dag.weekIndex,
      weekday: dag.weekday,
      positionType: dag.positionType,
      state,
      category,
      dutyCode: dag.dutyCode,
      start: duty?.startMinute ?? null,
      end: duty?.endMinute ?? null,
    };
  });
}

const gewerkt = (dag: FlowDay) => dag.state === "E" || dag.state === "L" || dag.state === "N";

/**
 * Aaneengesloten reeksen dagen die aan een voorwaarde voldoen, rond de cyclus.
 *
 * Begint te tellen direct na een dag die niet voldoet, zodat een reeks die over
 * het einde van de cyclus heen loopt als één reeks wordt gezien. Voldoet elke
 * dag, dan is de hele cyclus één reeks.
 */
function reeksen(days: readonly FlowDay[], voldoet: (dag: FlowDay) => boolean): FlowDay[][] {
  const n = days.length;
  if (n === 0) return [];
  const eersteBreuk = days.findIndex((dag) => !voldoet(dag));
  if (eersteBreuk < 0) return [days.slice()];
  const uit: FlowDay[][] = [];
  let huidig: FlowDay[] = [];
  for (let stap = 1; stap <= n; stap += 1) {
    const dag = days[(eersteBreuk + stap) % n];
    if (voldoet(dag)) {
      huidig.push(dag);
    } else if (huidig.length > 0) {
      uit.push(huidig);
      huidig = [];
    }
  }
  if (huidig.length > 0) uit.push(huidig);
  return uit;
}

/** Het verschil tussen twee tijden op de klok, rond middernacht. */
export function klokAfstand(a: number, b: number): number {
  const verschil = Math.abs((((a - b) % 1440) + 1440) % 1440);
  return Math.min(verschil, 1440 - verschil);
}

// ── Werkblokken ──────────────────────────────────────────────────────────────

export interface WorkBlock {
  readonly startIndex: number;
  readonly length: number;
  readonly lines: readonly number[];
  readonly states: string;
  /** Aandeel van het meest voorkomende dagdeel in het blok, 0–1. */
  readonly dominantShare: number;
  readonly dominant: "E" | "L" | "N";
  /** Aantal keer dat het dagdeel verandert tussen twee opeenvolgende dagen. */
  readonly switches: number;
  /** Aantal keer dat een wissel de vorige wissel omkeert: vroeg → laat → vroeg. */
  readonly reversals: number;
  /** Verschil in begintijd tussen opeenvolgende dagen met hetzelfde dagdeel. */
  readonly startDeltas: readonly number[];
  readonly endDeltas: readonly number[];
}

export function workBlocks(days: readonly FlowDay[]): readonly WorkBlock[] {
  return reeksen(days, gewerkt).map((blok) => {
    const states = blok.map((dag) => dag.state as "E" | "L" | "N");
    const tel = { E: 0, L: 0, N: 0 };
    for (const s of states) tel[s] += 1;
    const dominant = (Object.entries(tel) as ["E" | "L" | "N", number][]).sort((a, b) => b[1] - a[1])[0][0];
    let switches = 0;
    let reversals = 0;
    let vorigeRichting = 0;
    const startDeltas: number[] = [];
    const endDeltas: number[] = [];
    for (let i = 1; i < blok.length; i += 1) {
      const a = blok[i - 1];
      const b = blok[i];
      if (a.state !== b.state) {
        switches += 1;
        const richting = Math.sign(RANG[b.state as "E" | "L" | "N"] - RANG[a.state as "E" | "L" | "N"]);
        if (vorigeRichting !== 0 && richting === -vorigeRichting) reversals += 1;
        vorigeRichting = richting;
      } else if (a.start !== null && b.start !== null && a.end !== null && b.end !== null) {
        startDeltas.push(klokAfstand(a.start, b.start));
        endDeltas.push(klokAfstand(a.end, b.end));
      }
    }
    return {
      startIndex: blok[0].index,
      length: blok.length,
      lines: [...new Set(blok.map((dag) => dag.lineNumber))],
      states: states.join(""),
      dominantShare: tel[dominant] / blok.length,
      dominant,
      switches,
      reversals,
      startDeltas,
      endDeltas,
    };
  });
}

// ── Vrije blokken ────────────────────────────────────────────────────────────

export interface OffBlock {
  readonly startIndex: number;
  readonly length: number;
  readonly lines: readonly number[];
  readonly includesWeekend: boolean;
}

export function offBlocks(days: readonly FlowDay[]): readonly OffBlock[] {
  return reeksen(days, (dag) => dag.state === "OFF").map((blok) => ({
    startIndex: blok[0].index,
    length: blok.length,
    lines: [...new Set(blok.map((dag) => dag.lineNumber))],
    includesWeekend: blok.some((dag) => dag.weekday >= 6),
  }));
}

// ── Overgangen ───────────────────────────────────────────────────────────────

export const FLOW_STATES: readonly FlowState[] = ["E", "L", "N", "RES", "OFF"];

/** Hoe vaak toestand A direct wordt gevolgd door toestand B, rond de cyclus. */
export function transitionMatrix(days: readonly FlowDay[]): Record<FlowState, Record<FlowState, number>> {
  const matrix = Object.fromEntries(
    FLOW_STATES.map((van) => [van, Object.fromEntries(FLOW_STATES.map((naar) => [naar, 0]))]),
  ) as Record<FlowState, Record<FlowState, number>>;
  for (let i = 0; i < days.length; i += 1) {
    const a = days[i];
    const b = days[(i + 1) % days.length];
    matrix[a.state][b.state] += 1;
  }
  return matrix;
}

// ── Opeenvolgende diensten: rust, sprongen en de weg ertussen ────────────────

export interface WorkedPair {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly from: "E" | "L" | "N";
  readonly to: "E" | "L" | "N";
  /** Vrije dagen (R, WR, CO) ertussen; RES ertussen telt apart. */
  readonly offDaysBetween: number;
  readonly resDaysBetween: number;
  /** Rust van het einde van de ene dienst tot het begin van de volgende. */
  readonly restMinutes: number;
  readonly startDelta: number;
  readonly crossesLineBoundary: boolean;
}

/** Elke gewerkte dag met de eerstvolgende gewerkte dag, rond de cyclus. */
export function workedPairs(days: readonly FlowDay[]): readonly WorkedPair[] {
  const n = days.length;
  const uit: WorkedPair[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = days[i];
    if (!gewerkt(a) || a.start === null || a.end === null) continue;
    let vrij = 0;
    let res = 0;
    for (let stap = 1; stap < n; stap += 1) {
      const b = days[(i + stap) % n];
      if (gewerkt(b) && b.start !== null) {
        uit.push({
          fromIndex: a.index,
          toIndex: b.index,
          from: a.state as "E" | "L" | "N",
          to: b.state as "E" | "L" | "N",
          offDaysBetween: vrij,
          resDaysBetween: res,
          restMinutes: stap * 1440 + b.start - a.end,
          startDelta: klokAfstand(a.start, b.start),
          crossesLineBoundary: a.lineNumber !== b.lineNumber,
        });
        break;
      }
      if (b.state === "OFF") vrij += 1;
      else res += 1;
    }
  }
  return uit;
}

// ── Nachtreeksen ─────────────────────────────────────────────────────────────

export interface NightBlockFlow {
  readonly startIndex: number;
  readonly length: number;
  readonly lines: readonly number[];
  readonly crossesLineBoundary: boolean;
  /** Wat er vóór de reeks staat, als toestandsletters (dichtstbijzijnde eerst). */
  readonly entry: string;
  /** Wat er na de reeks komt tot en met de eerstvolgende gewerkte dag. */
  readonly exit: string;
  /** Van het einde van de laatste nacht tot het begin van de volgende dienst. */
  readonly recoveryMinutes: number | null;
  readonly nextState: "E" | "L" | "N" | null;
}

export function nightBlocksFlow(days: readonly FlowDay[]): readonly NightBlockFlow[] {
  const n = days.length;
  return reeksen(days, (dag) => dag.state === "N").map((blok) => {
    const laatste = blok[blok.length - 1];
    const eerste = blok[0];
    let exit = "";
    let recovery: number | null = null;
    let next: "E" | "L" | "N" | null = null;
    for (let stap = 1; stap < n; stap += 1) {
      const dag = days[(laatste.index + stap) % n];
      exit += dag.state === "OFF" ? "R" : dag.state;
      if (gewerkt(dag) && dag.start !== null && laatste.end !== null) {
        recovery = stap * 1440 + dag.start - laatste.end;
        next = dag.state as "E" | "L" | "N";
        break;
      }
      if (exit.length > 6) break;
    }
    let entry = "";
    for (let stap = 1; stap <= 3; stap += 1) {
      const dag = days[(eerste.index - stap + n) % n];
      entry += dag.state === "OFF" ? "R" : dag.state;
    }
    return {
      startIndex: eerste.index,
      length: blok.length,
      lines: [...new Set(blok.map((dag) => dag.lineNumber))],
      crossesLineBoundary: new Set(blok.map((dag) => dag.lineNumber)).size > 1,
      entry,
      exit,
      recoveryMinutes: recovery,
      nextState: next,
    };
  });
}

// ── Heen en weer ─────────────────────────────────────────────────────────────

export interface Oscillation {
  readonly index: number;
  readonly pattern: string;
  readonly lineNumber: number;
}

/**
 * Heen-en-weer tussen dagdelen: A → B → A binnen een korte reeks.
 *
 * Opeenvolgende gewerkte dagen tellen als één reeks zolang er hoogstens één
 * vrije dag tussen zit. Eén dag vrij tussen vroeg en laat en dan weer vroeg is
 * voor het lichaam nauwelijks anders dan zonder die vrije dag.
 */
export function oscillations(days: readonly FlowDay[]): readonly Oscillation[] {
  const paren = workedPairs(days);
  const volgende = new Map(paren.map((paar) => [paar.fromIndex, paar]));
  const uit: Oscillation[] = [];
  for (const eerste of paren) {
    if (eerste.from === eerste.to || eerste.offDaysBetween + eerste.resDaysBetween > 1) continue;
    const tweede = volgende.get(eerste.toIndex);
    if (!tweede || tweede.offDaysBetween + tweede.resDaysBetween > 1) continue;
    if (tweede.to === eerste.from && tweede.from === eerste.to) {
      uit.push({
        index: eerste.fromIndex,
        pattern: `${eerste.from}${eerste.to}${tweede.to}`,
        lineNumber: days[eerste.fromIndex].lineNumber,
      });
    }
  }
  return uit;
}

// ── De regelgrens ────────────────────────────────────────────────────────────

export interface Boundary {
  readonly fromLine: number;
  readonly toLine: number;
  readonly sunday: FlowState;
  readonly monday: FlowState;
  readonly restMinutes: number | null;
  readonly transition: string;
}

/** Zondag van regel N naar maandag van regel N+1, en van de laatste naar de eerste. */
export function lineBoundaries(days: readonly FlowDay[]): readonly Boundary[] {
  const regels = [...new Set(days.map((dag) => dag.lineNumber))].sort((a, b) => a - b);
  const uit: Boundary[] = [];
  for (let i = 0; i < regels.length; i += 1) {
    const van = regels[i];
    const naar = regels[(i + 1) % regels.length];
    const zondag = [...days].reverse().find((dag) => dag.lineNumber === van && dag.weekday === 7);
    const maandag = days.find((dag) => dag.lineNumber === naar && dag.weekday === 1);
    if (!zondag || !maandag) continue;
    const rust =
      gewerkt(zondag) && gewerkt(maandag) && zondag.end !== null && maandag.start !== null
        ? 1440 + maandag.start - zondag.end
        : null;
    uit.push({
      fromLine: van,
      toLine: naar,
      sunday: zondag.state,
      monday: maandag.state,
      restMinutes: rust,
      transition: `${zondag.state}→${maandag.state}`,
    });
  }
  return uit;
}

// ── Weekenden ────────────────────────────────────────────────────────────────

export interface WeekendLine {
  readonly lineNumber: number;
  readonly workedDays: number;
  readonly resDays: number;
  readonly fullyOff: boolean;
}

export function weekends(days: readonly FlowDay[]): readonly WeekendLine[] {
  const regels = [...new Set(days.map((dag) => dag.lineNumber))].sort((a, b) => a - b);
  return regels.map((regel) => {
    const weekend = days.filter((dag) => dag.lineNumber === regel && dag.weekday >= 6);
    return {
      lineNumber: regel,
      workedDays: weekend.filter(gewerkt).length,
      resDays: weekend.filter((dag) => dag.state === "RES").length,
      fullyOff: weekend.length > 0 && weekend.every((dag) => dag.state === "OFF"),
    };
  });
}
