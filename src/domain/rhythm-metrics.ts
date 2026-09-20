import { QUALITY_MODEL_V2 } from "./quality-model";
import type { QualityDuty, QualityRosterInput } from "./roster-quality";
import {
  ADJACENT_TRANSITION_PENALTY,
  OVER_ONE_OFF_DAY_PENALTY,
  type TransitionCategory,
} from "./roster-quality-config";
import {
  type FlowDay,
  flowDays,
  lineBoundaries,
  nightBlocksFlow,
  workBlocks,
  workedPairs,
} from "./roster-flow";

/**
 * Het ritme van een compleet roosterpakket in een handvol getallen.
 *
 * ## Waar de drempels vandaan komen
 *
 * Uit de zeven officiële Dordrechtse roosters (`docs/human-roster-benchmark/`),
 * en uit niets anders. Waar die roosters een patroon tonen dat mensen
 * accepteren, is dat hier de maat; waar ze iets doen wat een aanname tegenspreekt,
 * wint wat ze doen. Twee voorbeelden die dit bestand vormgaven:
 *
 * - Begintijden binnen hetzelfde dagdeel springen in de menselijke roosters
 *   gemiddeld 73 minuten van dag tot dag (mediaan 60, p90 150). Een maat die
 *   elke minuut verschil straft, noemt die roosters slecht. Daarom telt een
 *   sprong pas vanaf een uur, en is hij pas volledig fout boven vier uur.
 * - In 50+ Mix liggen vroege en late diensten qua tijd over elkaar heen (vroeg
 *   begint tot 11:06, laat al vanaf 09:54). Vroeg → laat → vroeg is daar geen
 *   heen-en-weer van de lichaamsklok. Heen-en-weer telt daarom alleen als de
 *   begintijd werkelijk ver verspringt, niet als alleen het etiket wisselt.
 *
 * Alles hier is één steekproef (`DDR_BDU_05_10_2026`). De drempels staan in
 * `RHYTHM_CALIBRATION` zodat ze bij een tweede steekproef opnieuw te ijken zijn.
 */

const V2 = QUALITY_MODEL_V2.components;

/** De ijking, rechtstreeks uit het kwaliteitsmodel: één bron voor beide. */
export const RHYTHM_CALIBRATION = {
  learnedFromBenchmark: QUALITY_MODEL_V2.learnedFromBenchmark,
  /** Begintijdsprong binnen een dagdeel die nog gewoon is (de menselijke mediaan). */
  startJitterFreeMinutes: V2.flow.parts.startJitter.freeMinutes,
  /** Vanaf deze sprong is de strafpost vol (boven het menselijke maximum van 229). */
  startJitterFullMinutes: V2.flow.parts.startJitter.fullMinutes,
  /** Heen-en-weer telt pas als de begintijd meer dan zoveel verspringt (tot en met: alleen een ander etiket). */
  oscillationMinClockSwingMinutes: V2.flow.parts.oscillation.minClockSwingMinutes,
  /** Zoveel heen-en-weer per 100 gewerkte dagen en de maat staat op nul. */
  oscillationZeroPer100WorkedDays: V2.flow.parts.oscillation.zeroAtPer100WorkedDays,
  /**
   * Waarde van een nachtreeks per lengte. Losse nachten en reeksen van twee zijn
   * in de menselijke roosters afwezig; de reeksen die er zijn, zijn 3, 5, 5 en 6.
   */
  nightBlockValue: V2.nights.parts.blocks.valueByLength,
  earlyAfterNightsAcceptableAfterMinutes: V2.nights.parts.exit.earlyAcceptableAfterMinutes,
  nightExitValueTable: V2.nights.parts.exit.valueTable,
} as const;

export interface RhythmMetrics {
  readonly workedDays: number;
  readonly workBlocks: number;
  /** Aandeel dagen in het dominante dagdeel van hun werkblok (blokken van 2 of meer). */
  readonly coherence: number | null;
  readonly fullyCoherentBlocks: number;
  readonly multiDayBlocks: number;
  /** Van alle dagdeelwissels tussen opeenvolgende diensten: aandeel met minstens één dag ertussen. */
  readonly changesThroughRest: number | null;
  readonly daypartChanges: number;
  readonly directDaypartChanges: number;
  readonly oscillations: number;
  readonly oscillationsPer100WorkedDays: number;
  readonly labelOnlyOscillations: number;
  readonly startJitter: {
    readonly n: number;
    readonly mean: number | null;
    readonly median: number | null;
    readonly p90: number | null;
    readonly max: number | null;
    readonly over120: number;
    /** Gemiddelde strafpost 0–1 volgens de ijking hierboven. */
    readonly penalty: number | null;
  };
  /** Sprongen in begintijd per band, voor de vergelijking van vorm. */
  readonly startJitterBands: Readonly<Record<string, number>>;
  readonly nights: {
    readonly blocks: number;
    readonly lengths: Readonly<Record<string, number>>;
    readonly value: number | null;
    /** Gemiddelde uitgangswaarde volgens `nightExitValue`: eerst herstel, dan richting. */
    readonly exitValue: number | null;
    readonly exitsToEarly: number;
    /** Het dagdeel van de eerste dienst na elke reeks. */
    readonly exitStates: Readonly<Record<string, number>>;
    readonly minRecoveryHours: number | null;
  };
  readonly boundaries: {
    readonly workedBoth: number;
    readonly daypartChangeAcross: number;
    readonly heavyAcross: number;
  };
  /** Per regel het zwaarste overgangsgewicht dat erin begint. */
  readonly worstTransitionPerLine: readonly { readonly roster: string; readonly lineNumber: number; readonly penalty: number; readonly pattern: string }[];
  readonly worstTransition: number;
  /** Het meest rommelige werkblok: meeste wissels, bij gelijkspel het langste. */
  readonly worstWorkBlock: { readonly roster: string; readonly states: string; readonly switches: number } | null;
}

const gemiddelde = (xs: readonly number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const kwantiel = (xs: readonly number[], q: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};
const CAT: Readonly<Record<"E" | "L" | "N", TransitionCategory>> = { E: "EARLY", L: "LATE", N: "NIGHT" };

export function jitterPenalty(deltaMinutes: number): number {
  const vrij = RHYTHM_CALIBRATION.startJitterFreeMinutes;
  const vol = RHYTHM_CALIBRATION.startJitterFullMinutes;
  return Math.min(1, Math.max(0, deltaMinutes - vrij) / (vol - vrij));
}

/**
 * Wat er na een nachtreeks komt.
 *
 * In alle vier de menselijke reeksen: twee of drie vrije dagen, dan laat (56–80
 * uur herstel). Een vroege dienst na nachten is niet verboden, maar pas na ruim
 * herstel gewoon.
 *
 * ## Eerst herstel, dan richting
 *
 * De waarde daalt nooit als er meer herstel is, en een uitgang onder de
 * herstelrust uit de regel is altijd slechter dan elke uitgang erboven. Dat moet:
 * het bijschaven zoekt naar wat hier hoger scoort, en een tabel waarin minder
 * rust beter scoort, wordt gevonden (H04 in de solver, H09 hier).
 *
 * Zonder bekende herstelregel valt alleen de richting te beoordelen; dan telt
 * de uitgang zoals na genoeg herstel.
 */
export function nightExitValue(
  next: "E" | "L" | "N" | null,
  recoveryMinutes: number | null,
  ruleRecoveryMinutes?: number,
): number {
  const tabel = RHYTHM_CALIBRATION.nightExitValueTable;
  const richting = next === "E" ? "early" : "late";
  if (ruleRecoveryMinutes !== undefined && recoveryMinutes !== null && recoveryMinutes < ruleRecoveryMinutes) {
    return tabel.belowRule[richting];
  }
  if (recoveryMinutes !== null && recoveryMinutes >= RHYTHM_CALIBRATION.earlyAfterNightsAcceptableAfterMinutes) {
    return tabel.afterEarlyAcceptable[richting];
  }
  return tabel.atLeastRule[richting];
}

export function nightBlockValue(length: number): number {
  const tabel = RHYTHM_CALIBRATION.nightBlockValue;
  return length >= 5 ? tabel[5] : (tabel[length] ?? 0);
}

/** De ritmematen van één rooster, voor wie per profiel wil vergelijken. */
export function rosterRhythm(days: readonly FlowDay[], code: string) {
  const blokken = workBlocks(days);
  const paren = workedPairs(days);
  const nachten = nightBlocksFlow(days);
  const grenzen = lineBoundaries(days);
  return { code, days, blokken, paren, nachten, grenzen };
}

export function rhythmMetrics(
  rosters: readonly QualityRosterInput[],
  duties: ReadonlyMap<string, QualityDuty>,
  /** Herstelrust na nachten uit het regelbestand; zonder deze waarde telt alleen of het vroeg is. */
  rules?: { readonly nightRecoveryMinutes: number },
): RhythmMetrics {
  const perRooster = rosters.map((rooster) => rosterRhythm(flowDays(rooster, duties), rooster.code));
  const alleDagen = perRooster.flatMap((r) => r.days);
  const gewerkt = alleDagen.filter((dag) => dag.state === "E" || dag.state === "L" || dag.state === "N").length;
  const blokken = perRooster.flatMap((r) => r.blokken.map((b) => ({ ...b, roster: r.code })));
  const meerdaags = blokken.filter((b) => b.length >= 2);
  const coherent = meerdaags.reduce((som, b) => som + b.dominantShare * b.length, 0);
  const meerdaagsDagen = meerdaags.reduce((som, b) => som + b.length, 0);

  const paren = perRooster.flatMap((r) => r.paren.map((p) => ({ ...p, roster: r.code, days: r.days })));
  const wissels = paren.filter((p) => p.from !== p.to);
  const direct = wissels.filter((p) => p.offDaysBetween + p.resDaysBetween === 0);

  // Heen-en-weer: A → B → A met hoogstens één dag ertussen, per stap.
  let heenEnWeer = 0;
  let alleenEtiket = 0;
  for (const r of perRooster) {
    const volgende = new Map(r.paren.map((p) => [p.fromIndex, p]));
    for (const eerste of r.paren) {
      if (eerste.from === eerste.to || eerste.offDaysBetween + eerste.resDaysBetween > 1) continue;
      const tweede = volgende.get(eerste.toIndex);
      if (!tweede || tweede.offDaysBetween + tweede.resDaysBetween > 1) continue;
      if (tweede.from !== eerste.to || tweede.to !== eerste.from) continue;
      const grens = RHYTHM_CALIBRATION.oscillationMinClockSwingMinutes;
      // Tot en met de grens is het alleen een ander etiket, zoals bij de begintijdsprong.
      if (eerste.startDelta > grens && tweede.startDelta > grens) heenEnWeer += 1;
      else alleenEtiket += 1;
    }
  }

  const sprongen = blokken.flatMap((b) => b.startDeltas);
  const nachten = perRooster.flatMap((r) => r.nachten);
  const nachtWaarde =
    nachten.length === 0
      ? null
      : nachten.reduce((som, b) => som + nightBlockValue(b.length) * b.length, 0) /
        nachten.reduce((som, b) => som + b.length, 0);
  const lengtes: Record<string, number> = {};
  for (const b of nachten) lengtes[String(b.length)] = (lengtes[String(b.length)] ?? 0) + 1;

  const grenzen = perRooster.flatMap((r) => r.grenzen);
  const gewerktBeide = grenzen.filter((g) => ["E", "L", "N"].includes(g.sunday) && ["E", "L", "N"].includes(g.monday));

  // Zwaarste overgang per regel: direct volgend, of over precies één vrije dag.
  const zwaarste = new Map<string, { roster: string; lineNumber: number; penalty: number; pattern: string }>();
  for (const p of paren) {
    const tussen = p.offDaysBetween + p.resDaysBetween;
    const straf =
      tussen === 0
        ? ADJACENT_TRANSITION_PENALTY[CAT[p.from]][CAT[p.to]]
        : tussen === 1 && p.offDaysBetween === 1
          ? OVER_ONE_OFF_DAY_PENALTY[CAT[p.from]][CAT[p.to]]
          : 0;
    const regel = p.days[p.fromIndex].lineNumber;
    const sleutel = `${p.roster}|${regel}`;
    const was = zwaarste.get(sleutel);
    if (!was || straf > was.penalty) {
      zwaarste.set(sleutel, { roster: p.roster, lineNumber: regel, penalty: straf, pattern: `${p.from}${"R".repeat(tussen)}${p.to}` });
    }
  }
  const perRegel = [...zwaarste.values()];
  const slechtsteBlok = [...blokken].sort((a, b) => b.switches - a.switches || b.length - a.length)[0];

  return {
    workedDays: gewerkt,
    workBlocks: blokken.length,
    coherence: meerdaagsDagen > 0 ? coherent / meerdaagsDagen : null,
    fullyCoherentBlocks: meerdaags.filter((b) => b.switches === 0).length,
    multiDayBlocks: meerdaags.length,
    changesThroughRest: wissels.length > 0 ? (wissels.length - direct.length) / wissels.length : null,
    daypartChanges: wissels.length,
    directDaypartChanges: direct.length,
    oscillations: heenEnWeer,
    oscillationsPer100WorkedDays: gewerkt > 0 ? (heenEnWeer / gewerkt) * 100 : 0,
    labelOnlyOscillations: alleenEtiket,
    startJitter: {
      n: sprongen.length,
      mean: gemiddelde(sprongen),
      median: kwantiel(sprongen, 0.5),
      p90: kwantiel(sprongen, 0.9),
      max: sprongen.length ? Math.max(...sprongen) : null,
      over120: sprongen.filter((d) => d > 120).length,
      penalty: gemiddelde(sprongen.map(jitterPenalty)),
    },
    startJitterBands: sprongen.reduce<Record<string, number>>((per, d) => {
      const band = d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 120 ? "61-120" : d <= 180 ? "121-180" : ">180";
      per[band] = (per[band] ?? 0) + 1;
      return per;
    }, {}),
    nights: {
      blocks: nachten.length,
      lengths: lengtes,
      value: nachtWaarde,
      exitValue: nachten.length === 0 ? null : nachten.reduce((som, b) => som + nightExitValue(b.nextState, b.recoveryMinutes, rules?.nightRecoveryMinutes), 0) / nachten.length,
      exitsToEarly: nachten.filter((b) => b.nextState === "E").length,
      exitStates: nachten.reduce<Record<string, number>>((per, b) => {
        const s = b.nextState ?? "geen";
        per[s] = (per[s] ?? 0) + 1;
        return per;
      }, {}),
      minRecoveryHours: nachten.some((b) => b.recoveryMinutes !== null)
        ? Math.min(...nachten.filter((b) => b.recoveryMinutes !== null).map((b) => b.recoveryMinutes as number)) / 60
        : null,
    },
    boundaries: {
      workedBoth: gewerktBeide.length,
      daypartChangeAcross: gewerktBeide.filter((g) => g.sunday !== g.monday).length,
      heavyAcross: gewerktBeide.filter(
        (g) => ADJACENT_TRANSITION_PENALTY[CAT[g.sunday as "E" | "L" | "N"]][CAT[g.monday as "E" | "L" | "N"]] >= 3,
      ).length,
    },
    worstTransitionPerLine: perRegel,
    worstTransition: perRegel.reduce((max, r) => Math.max(max, r.penalty), 0),
    worstWorkBlock: slechtsteBlok ? { roster: slechtsteBlok.roster, states: slechtsteBlok.states, switches: slechtsteBlok.switches } : null,
  };
}
