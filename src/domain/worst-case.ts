import type { QualityDuty, QualityRosterInput } from "./roster-quality";
import { type FlowDay, flowDays, klokAfstand, nightBlocksFlow, workBlocks, workedPairs } from "./roster-flow";
import { ADJACENT_TRANSITION_PENALTY, OVER_ONE_OFF_DAY_PENALTY, type TransitionCategory } from "./roster-quality-config";
import { nightExitValue } from "./rhythm-metrics";

/**
 * Het slechtste geval in een pakket (werkopdracht §12, §13).
 *
 * ## Waarom naast het gemiddelde
 *
 * Eén nachtreeks met 28 uur herstel weegt voor wie hem rijdt zwaarder dan zes
 * reeksen met 60 uur. Een gemiddelde verdunt die ene: met vijf goede uitgangen
 * ernaast is het gemiddelde nog steeds hoog. Het slechtste geval verdunt niet —
 * een extra goede reeks erbij verandert het minimum niet — en is daarom ook
 * niet te bespelen door reeksen op te knippen.
 *
 * Drie slechtste gevallen, alle drie op de klok gemeten zoals de rest van
 * model v2:
 *
 * - de nachtuitgang met de laagste waarde (`nightExitValue`: eerst herstel,
 *   dan richting);
 * - de zwaarste overgang tussen twee diensten, direct of over één vrije dag,
 *   waarbij een wissel die de begintijd hooguit `labelOnlyMinutes` verschuift
 *   alleen een ander etiket is;
 * - het werkblok met de meeste echte dagdeelwissels (ook op de klok).
 */

export interface WorstCase {
  /** Laagste uitgangswaarde na een nachtreeks, 0–1; null zonder nachten. */
  readonly nightExitValue: number | null;
  readonly nightExit: { readonly roster: string; readonly lines: string; readonly recoveryHours: number | null } | null;
  /** Nachtreeksen met minder herstel dan de regel; per basisrooster, voor de gerichte reparatie. */
  readonly exitsBelowRule: Readonly<Record<string, number>>;
  /** Zwaarste overgang in strafpunten, na klokcorrectie. */
  readonly transitionPenalty: number;
  readonly transition: { readonly roster: string; readonly lineNumber: number; readonly pattern: string } | null;
  /** Meeste echte dagdeelwissels binnen één werkblok. */
  readonly blockSwitches: number;
  readonly block: { readonly roster: string; readonly states: string } | null;
}

const CAT: Readonly<Record<"E" | "L" | "N", TransitionCategory>> = { E: "EARLY", L: "LATE", N: "NIGHT" };

export function worstCase(
  rosters: readonly QualityRosterInput[],
  duties: ReadonlyMap<string, QualityDuty>,
  options: { readonly nightRecoveryMinutes: number; readonly labelOnlyMinutes: number },
): WorstCase {
  let exitWaarde: number | null = null;
  let exit: WorstCase["nightExit"] = null;
  const onderRegel: Record<string, number> = {};
  let overgang = 0;
  let overgangWaar: WorstCase["transition"] = null;
  let wissels = 0;
  let blok: WorstCase["block"] = null;

  for (const rooster of rosters) {
    const dagen: readonly FlowDay[] = flowDays(rooster, duties);
    for (const b of nightBlocksFlow(dagen)) {
      const waarde = nightExitValue(b.nextState, b.recoveryMinutes, options.nightRecoveryMinutes);
      if (b.recoveryMinutes !== null && b.recoveryMinutes < options.nightRecoveryMinutes) {
        onderRegel[rooster.code] = (onderRegel[rooster.code] ?? 0) + 1;
      }
      if (exitWaarde === null || waarde < exitWaarde) {
        exitWaarde = waarde;
        exit = {
          roster: rooster.code,
          lines: b.lines.join("+"),
          recoveryHours: b.recoveryMinutes === null ? null : Math.round((b.recoveryMinutes / 60) * 10) / 10,
        };
      }
    }
    for (const p of workedPairs(dagen)) {
      const tussen = p.offDaysBetween + p.resDaysBetween;
      if (tussen > 1 || p.from === p.to) continue;
      const etiket =
        tussen === 0
          ? ADJACENT_TRANSITION_PENALTY[CAT[p.from]][CAT[p.to]]
          : p.offDaysBetween === 1
            ? OVER_ONE_OFF_DAY_PENALTY[CAT[p.from]][CAT[p.to]]
            : 0;
      const a = dagen[p.fromIndex].start;
      const b = dagen[p.toIndex].start;
      const straf = a !== null && b !== null && klokAfstand(a, b) <= options.labelOnlyMinutes ? Math.min(etiket, 1) : etiket;
      if (straf > overgang) {
        overgang = straf;
        overgangWaar = { roster: rooster.code, lineNumber: dagen[p.fromIndex].lineNumber, pattern: `${p.from}${"R".repeat(tussen)}${p.to}` };
      }
    }
    for (const w of workBlocks(dagen)) {
      let echt = 0;
      for (let i = w.startIndex; i < w.startIndex + w.length - 1; i += 1) {
        const x = dagen[i % dagen.length];
        const y = dagen[(i + 1) % dagen.length];
        if (x.state === y.state || x.start === null || y.start === null) continue;
        if (klokAfstand(x.start, y.start) > options.labelOnlyMinutes) echt += 1;
      }
      if (echt > wissels) {
        wissels = echt;
        blok = {
          roster: rooster.code,
          states: Array.from({ length: w.length }, (_, k) => dagen[(w.startIndex + k) % dagen.length].state).join(""),
        };
      }
    }
  }
  return { nightExitValue: exitWaarde, nightExit: exit, exitsBelowRule: onderRegel, transitionPenalty: overgang, transition: overgangWaar, blockSwitches: wissels, block: blok };
}

/** De strafpunten die een slechtste geval kost in de robuuste score. */
export interface WorstCaseWeights {
  /** Per eenheid onder de volle uitgangswaarde (1 − waarde). */
  readonly nightExitPoints: number;
  /** Per strafpunt boven `transitionFreePoints`. */
  readonly transitionPoints: number;
  readonly transitionFreePoints: number;
  /** Per echte wissel boven `blockFreeSwitches`. */
  readonly blockSwitchPoints: number;
  readonly blockFreeSwitches: number;
}

export function worstCasePenalty(w: WorstCase, weights: WorstCaseWeights): { readonly nightExit: number; readonly transition: number; readonly block: number; readonly total: number } {
  const nightExit = w.nightExitValue === null ? 0 : weights.nightExitPoints * (1 - w.nightExitValue);
  const transition = weights.transitionPoints * Math.max(0, w.transitionPenalty - weights.transitionFreePoints);
  const block = weights.blockSwitchPoints * Math.max(0, w.blockSwitches - weights.blockFreeSwitches);
  return { nightExit, transition, block, total: nightExit + transition + block };
}
