import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseRosterPdf } from "@/server/import/roster-pdf";
import { prisma } from "@/server/data/prisma";
import { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import type { QualityRosterInput } from "@/domain/roster-quality";
import {
  FLOW_STATES,
  type FlowDay,
  type FlowState,
  flowDays,
  lineBoundaries,
  nightBlocksFlow,
  offBlocks,
  oscillations,
  transitionMatrix,
  weekends,
  workBlocks,
  workedPairs,
} from "@/domain/roster-flow";

/**
 * De menselijke Dordrechtse roosters als meetbare referentie.
 *
 * ## Wat dit doet
 *
 * Leest de zeven officiële roosterbladen rechtstreeks uit de PDF's, controleert
 * ze tegen het dienstenpakket en tegen de roosters in de database, en schrijft
 * alles wat er aan ritme in zit naar `docs/human-roster-benchmark/`.
 *
 * ## Wat dit niet is
 *
 * Een regelboek. Deze roosters zijn door mensen gemaakt en in de praktijk
 * goed bevallen: een goede referentie, niet de enige juiste vorm. Elk getal
 * hieronder komt uit één roosterperiode van één standplaats en draagt dat
 * label (`learnedFromBenchmark`). Wie er een wet van maakt, overfit op één
 * steekproef.
 *
 *   npm run human-benchmark:extract
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const BRON = path.join(WORTEL, "tests", "fixtures", "dordrecht-bronnen");
const DOEL = path.join(WORTEL, "docs", "human-roster-benchmark");
export const BENCHMARK_ID = "DDR_BDU_05_10_2026";

/** Welk blad bij welk basisrooster hoort. De code staat niet op het blad zelf. */
const BLADEN: readonly { file: string; code: string }[] = [
  { file: "Vroeg 1 VA", code: "DDR-V" },
  { file: "Vroeg Laat 1 B", code: "DDR-VL" },
  { file: "Laat 1 LA", code: "DDR-L" },
  { file: "Laat Nacht 1 C", code: "DDR-LN" },
  { file: "Mix 1 A", code: "DDR-MIX" },
  { file: "BLM 1", code: "DDR-BLM" },
  { file: "50+ mix 1", code: "DDR-50MIX" },
];

const POSITIE: Record<string, string> = { DUTY: "DUTY", RES: "RES", R: "RUST", WR: "WR", CO: "CO", WTV: "WR" };

const uurMin = (minuten: string): number => {
  const [u, m] = minuten.split(":").map(Number);
  return u * 60 + m;
};
const hhmm = (m: number | null) =>
  m === null ? "" : `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

const gemiddelde = (xs: readonly number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const mediaan = (xs: readonly number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const sd = (xs: readonly number[]) => {
  const g = gemiddelde(xs);
  return g === null || xs.length < 2 ? null : Math.sqrt(xs.reduce((a, x) => a + (x - g) ** 2, 0) / (xs.length - 1));
};
const verdeling = (xs: readonly (number | string)[]) => {
  const uit: Record<string, number> = {};
  for (const x of xs) uit[String(x)] = (uit[String(x)] ?? 0) + 1;
  return uit;
};
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const csv = (rijen: readonly (readonly (string | number | null | boolean)[])[]) =>
  `${rijen.map((rij) => rij.map((cel) => (cel === null ? "" : typeof cel === "string" && /[",;\n]/.test(cel) ? `"${cel.replace(/"/g, '""')}"` : String(cel))).join(",")).join("\n")}\n`;

async function main() {
  mkdirSync(DOEL, { recursive: true });
  const context = await loadEvaluationContextCore("DDR");
  const officieel = new Map(context.quality.official.map((rooster) => [rooster.code, rooster]));
  const afwijkingen: string[] = [];

  const roosters: {
    code: string;
    name: string;
    profile: string;
    source: { file: string; sha256: string; roosterNaam: string; variant: string };
    meta: Record<string, string>;
    input: QualityRosterInput;
    lineHours: { lineNumber: number; excludingBreak: string; includingBreak: string }[];
  }[] = [];

  for (const blad of BLADEN) {
    const bytes = readFileSync(path.join(BRON, `${blad.file}.pdf`));
    const doc = parseRosterPdf(bytes);
    if (doc.unparsed.length > 0) afwijkingen.push(`${blad.file}: ${doc.unparsed.length} fragment(en) niet geplaatst`);
    const db = officieel.get(blad.code);
    if (!db) throw new Error(`Basisrooster ${blad.code} staat niet in de database.`);

    const days = doc.lines.flatMap((regel) =>
      regel.cells.map((cel) => {
        const positionType = POSITIE[cel.kind];
        if (!positionType) afwijkingen.push(`${blad.file} regel ${regel.lineNumber} dag ${cel.weekday}: onleesbare cel "${cel.raw}"`);
        // Controle tegen het dienstenpakket: dezelfde dienst op dezelfde weekdag
        // moet dezelfde tijden hebben. Anders meet de benchmark iets anders dan
        // wat de evaluator straks van een kandidaat meet.
        if (cel.kind === "DUTY" && cel.dutyCode) {
          const dienst = context.quality.duties.get(`${cel.dutyCode}|${cel.weekday}`);
          if (!dienst) {
            afwijkingen.push(`${blad.file} regel ${regel.lineNumber}: dienst ${cel.dutyCode} op dag ${cel.weekday} staat niet in het pakket`);
          } else if (cel.startMinute !== dienst.startMinute || cel.endMinute !== dienst.endMinute) {
            afwijkingen.push(
              `${blad.file} regel ${regel.lineNumber}: ${cel.dutyCode}@${cel.weekday} blad ${hhmm(cel.startMinute)}-${hhmm(cel.endMinute)} ` +
                `pakket ${hhmm(dienst.startMinute)}-${hhmm(dienst.endMinute)}`,
            );
          }
        }
        return {
          lineNumber: regel.lineNumber,
          weekIndex: 1,
          weekday: cel.weekday,
          positionType: positionType ?? "RUST",
          dutyCode: cel.kind === "DUTY" ? cel.dutyCode : null,
        };
      }),
    );

    // Controle tegen de database: het blad en het opgeslagen officiële rooster
    // moeten dag voor dag gelijk zijn.
    const dbDag = new Map(db.days.map((dag) => [`${dag.lineNumber}|${dag.weekday}`, dag]));
    for (const dag of days) {
      const ander = dbDag.get(`${dag.lineNumber}|${dag.weekday}`);
      if (!ander || ander.positionType !== dag.positionType || (ander.dutyCode ?? null) !== (dag.dutyCode ?? null)) {
        afwijkingen.push(
          `${blad.code} regel ${dag.lineNumber} dag ${dag.weekday}: blad ${dag.positionType}/${dag.dutyCode ?? "-"} database ${ander?.positionType ?? "?"}/${ander?.dutyCode ?? "-"}`,
        );
      }
    }

    roosters.push({
      code: blad.code,
      name: db.name,
      profile: db.profile,
      source: {
        file: `${blad.file}.pdf`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        roosterNaam: doc.meta.roosterNaam,
        variant: doc.meta.roostervariant,
      },
      meta: { ...doc.meta },
      input: { code: blad.code, name: db.name, profile: db.profile, weeksPerLine: 1, days },
      lineHours: doc.lines.map((regel) => ({
        lineNumber: regel.lineNumber,
        excludingBreak: regel.weekHoursExcludingBreak,
        includingBreak: regel.weekHoursIncludingBreak,
      })),
    });
  }

  // ── De dataset zelf ────────────────────────────────────────────────────────
  const dataset = roosters.map((rooster) => {
    const dagen = flowDays(rooster.input, context.quality.duties);
    return {
      code: rooster.code,
      name: rooster.name,
      profile: rooster.profile,
      label: "HUMAN_ACCEPTED_REFERENCE",
      source: rooster.source,
      averageWeekExcludingBreak: rooster.meta.gemiddeldeWeeklengteExclusiefPauze,
      averageWeekIncludingBreak: rooster.meta.gemiddeldeWeeklengteInclusiefPauze,
      contractHoursPerWeek: rooster.meta.contracturenPerWeek,
      lines: rooster.lineHours.map((uren) => ({
        lineNumber: uren.lineNumber,
        weekHoursExcludingBreak: uren.excludingBreak,
        weekHoursIncludingBreak: uren.includingBreak,
        days: dagen
          .filter((dag) => dag.lineNumber === uren.lineNumber)
          .map((dag) => ({
            weekday: dag.weekday,
            positionType: dag.positionType,
            state: dag.state,
            dutyCode: dag.dutyCode,
            start: hhmm(dag.start) || null,
            end: hhmm(dag.end) || null,
            startMinute: dag.start,
            endMinute: dag.end,
          })),
      })),
    };
  });

  // ── Kenmerken per rooster ──────────────────────────────────────────────────
  const perRooster = roosters.map((rooster) => {
    const dagen = flowDays(rooster.input, context.quality.duties);
    const blokken = workBlocks(dagen);
    const vrij = offBlocks(dagen);
    const paren = workedPairs(dagen);
    const nachten = nightBlocksFlow(dagen);
    const heenEnWeer = oscillations(dagen);
    const grenzen = lineBoundaries(dagen);
    const weekend = weekends(dagen);
    const matrix = transitionMatrix(dagen);
    const gewerkt = dagen.filter((dag) => dag.state === "E" || dag.state === "L" || dag.state === "N");
    const perDagdeel = (s: "E" | "L" | "N") => gewerkt.filter((dag) => dag.state === s).map((dag) => dag.start!);
    const uren = rooster.lineHours.map((regel) => uurMin(regel.excludingBreak));
    return {
      rooster,
      dagen,
      blokken,
      vrij,
      paren,
      nachten,
      heenEnWeer,
      grenzen,
      weekend,
      matrix,
      samenvatting: {
        code: rooster.code,
        profile: rooster.profile,
        lines: rooster.lineHours.length,
        workedDays: gewerkt.length,
        dayparts: verdeling(gewerkt.map((dag) => dag.state)),
        resDays: dagen.filter((dag) => dag.state === "RES").length,
        offDays: dagen.filter((dag) => dag.state === "OFF").length,
        workBlocks: {
          count: blokken.length,
          lengthDistribution: verdeling(blokken.map((b) => b.length)),
          meanLength: r1(gemiddelde(blokken.map((b) => b.length))),
          meanDominantShare: r1((gemiddelde(blokken.map((b) => b.dominantShare)) ?? 0) * 100),
          fullyCoherentShare: r1((blokken.filter((b) => b.switches === 0).length / Math.max(1, blokken.length)) * 100),
          switches: blokken.reduce((a, b) => a + b.switches, 0),
          reversalsInBlocks: blokken.reduce((a, b) => a + b.reversals, 0),
          crossLineBlocks: blokken.filter((b) => b.lines.length > 1).length,
        },
        offBlocks: {
          count: vrij.length,
          lengthDistribution: verdeling(vrij.map((b) => b.length)),
          meanLength: r1(gemiddelde(vrij.map((b) => b.length))),
        },
        oscillations: { count: heenEnWeer.length, patterns: verdeling(heenEnWeer.map((o) => o.pattern)) },
        startTime: {
          sameDaypartAdjacentDeltas: {
            n: blokken.flatMap((b) => b.startDeltas).length,
            mean: r1(gemiddelde(blokken.flatMap((b) => b.startDeltas))),
            median: r1(mediaan(blokken.flatMap((b) => b.startDeltas))),
            max: blokken.flatMap((b) => b.startDeltas).length ? Math.max(...blokken.flatMap((b) => b.startDeltas)) : null,
            over60: blokken.flatMap((b) => b.startDeltas).filter((d) => d > 60).length,
            over120: blokken.flatMap((b) => b.startDeltas).filter((d) => d > 120).length,
          },
          endDeltas: {
            mean: r1(gemiddelde(blokken.flatMap((b) => b.endDeltas))),
            max: blokken.flatMap((b) => b.endDeltas).length ? Math.max(...blokken.flatMap((b) => b.endDeltas)) : null,
          },
          dispersionPerDaypart: Object.fromEntries(
            (["E", "L", "N"] as const).map((s) => [
              s,
              { n: perDagdeel(s).length, mean: r1(gemiddelde(perDagdeel(s))), sd: r1(sd(perDagdeel(s))), min: perDagdeel(s).length ? Math.min(...perDagdeel(s)) : null, max: perDagdeel(s).length ? Math.max(...perDagdeel(s)) : null },
            ]),
          ),
        },
        nightBlocks: {
          count: nachten.length,
          lengths: nachten.map((n) => n.length),
          crossLine: nachten.filter((n) => n.crossesLineBoundary).length,
          recoveryHours: nachten.map((n) => (n.recoveryMinutes === null ? null : r1(n.recoveryMinutes / 60))),
          exits: nachten.map((n) => n.exit),
          entries: nachten.map((n) => n.entry),
        },
        rest: {
          adjacent: paren.filter((p) => p.offDaysBetween + p.resDaysBetween === 0).length,
          minRestAdjacentMinutes: Math.min(...paren.filter((p) => p.offDaysBetween + p.resDaysBetween === 0).map((p) => p.restMinutes)),
          meanSurplusAdjacentMinutes: r1(gemiddelde(paren.filter((p) => p.offDaysBetween + p.resDaysBetween === 0).map((p) => p.restMinutes - context.rules.minDailyRestMinutes))),
          surplusBands: verdeling(
            paren
              .filter((p) => p.offDaysBetween + p.resDaysBetween === 0)
              .map((p) => {
                const s = p.restMinutes - context.rules.minDailyRestMinutes;
                return s < 60 ? "<1u" : s < 180 ? "1-3u" : s < 360 ? "3-6u" : ">=6u";
              }),
          ),
        },
        daypartChanges: verdeling(
          paren.filter((p) => p.from !== p.to).map((p) => `${p.from}→${p.to} na ${p.offDaysBetween + p.resDaysBetween} vrij`),
        ),
        boundaries: {
          count: grenzen.length,
          workedBoth: grenzen.filter((g) => g.restMinutes !== null).length,
          transitions: verdeling(grenzen.map((g) => g.transition)),
          minRestMinutes: grenzen.filter((g) => g.restMinutes !== null).length ? Math.min(...grenzen.filter((g) => g.restMinutes !== null).map((g) => g.restMinutes!)) : null,
        },
        weekends: {
          linesFullyOff: weekend.filter((w) => w.fullyOff).length,
          workedDaysPerLine: weekend.map((w) => w.workedDays),
          mean: r1(gemiddelde(weekend.map((w) => w.workedDays))),
        },
        hours: {
          averageWeekExcludingBreak: rooster.meta.gemiddeldeWeeklengteExclusiefPauze,
          averageWeekIncludingBreak: rooster.meta.gemiddeldeWeeklengteInclusiefPauze,
          lineMinutesExcludingBreak: uren,
          lineMin: Math.min(...uren),
          lineMax: Math.max(...uren),
          lineSpreadMinutes: Math.max(...uren) - Math.min(...uren),
          lineSdMinutes: r1(sd(uren)),
        },
        transitionMatrix: matrix,
      },
    };
  });

  // ── Over alle zeven heen ───────────────────────────────────────────────────
  const alle = perRooster;
  const totaalMatrix = Object.fromEntries(
    FLOW_STATES.map((van) => [van, Object.fromEntries(FLOW_STATES.map((naar) => [naar, alle.reduce((a, r) => a + r.matrix[van][naar], 0)]))]),
  ) as Record<FlowState, Record<FlowState, number>>;
  const alleParen = alle.flatMap((r) => r.paren);
  const aangrenzend = alleParen.filter((p) => p.offDaysBetween + p.resDaysBetween === 0);
  const zwaar = (van: string, naar: string) => (van === "N" && naar === "E") || (van === "L" && naar === "E") || (van === "E" && naar === "N");
  const alleBlokken = alle.flatMap((r) => r.blokken);
  const alleNachten = alle.flatMap((r) => r.nachten);
  const alleStartDeltas = alleBlokken.flatMap((b) => b.startDeltas);

  const overzicht = {
    workedDays: alle.reduce((a, r) => a + r.samenvatting.workedDays, 0),
    adjacentWorkedPairs: aangrenzend.length,
    adjacentSameDaypart: aangrenzend.filter((p) => p.from === p.to).length,
    adjacentChanges: verdeling(aangrenzend.filter((p) => p.from !== p.to).map((p) => `${p.from}→${p.to}`)),
    heavyAdjacent: aangrenzend.filter((p) => zwaar(p.from, p.to)).length,
    heavyAfterOneOff: alleParen.filter((p) => p.offDaysBetween + p.resDaysBetween === 1 && zwaar(p.from, p.to)).length,
    bigChangesByGap: verdeling(
      alleParen.filter((p) => p.from !== p.to && (p.from === "N" || p.to === "N" || (p.from === "L" && p.to === "E"))).map((p) => `${p.from}→${p.to} gap ${p.offDaysBetween + p.resDaysBetween}`),
    ),
    oscillations: alle.reduce((a, r) => a + r.heenEnWeer.length, 0),
    oscillationPatterns: verdeling(alle.flatMap((r) => r.heenEnWeer.map((o) => `${r.rooster.code}:${o.pattern}`))),
    workBlocks: {
      count: alleBlokken.length,
      lengthDistribution: verdeling(alleBlokken.map((b) => b.length)),
      fullyCoherent: alleBlokken.filter((b) => b.switches === 0).length,
      meanDominantShare: r1((gemiddelde(alleBlokken.map((b) => b.dominantShare)) ?? 0) * 100),
      reversals: alleBlokken.reduce((a, b) => a + b.reversals, 0),
    },
    nightBlocks: {
      lengths: verdeling(alleNachten.map((n) => n.length)),
      singletons: alleNachten.filter((n) => n.length === 1).length,
      pairs: alleNachten.filter((n) => n.length === 2).length,
      crossLine: alleNachten.filter((n) => n.crossesLineBoundary).length,
      minRecoveryHours: r1(Math.min(...alleNachten.filter((n) => n.recoveryMinutes !== null).map((n) => n.recoveryMinutes! / 60))),
      exitsNextState: verdeling(alleNachten.map((n) => n.nextState ?? "?")),
    },
    startTimeJitter: {
      n: alleStartDeltas.length,
      mean: r1(gemiddelde(alleStartDeltas)),
      median: r1(mediaan(alleStartDeltas)),
      p90: alleStartDeltas.length ? [...alleStartDeltas].sort((a, b) => a - b)[Math.floor(alleStartDeltas.length * 0.9)] : null,
      max: alleStartDeltas.length ? Math.max(...alleStartDeltas) : null,
      within30: alleStartDeltas.filter((d) => d <= 30).length,
      within60: alleStartDeltas.filter((d) => d <= 60).length,
      over120: alleStartDeltas.filter((d) => d > 120).length,
    },
    minAdjacentRestMinutes: Math.min(...aangrenzend.map((p) => p.restMinutes)),
    boundaryTransitions: verdeling(alle.flatMap((r) => r.grenzen.map((g) => g.transition))),
  };

  const features = {
    schema: "ns-human-roster-benchmark/1",
    learnedFromBenchmark: BENCHMARK_ID,
    label: "HUMAN_ACCEPTED_REFERENCE",
    meaning:
      "Door mensen gemaakte, in de praktijk geaccepteerde roosters. Een goede referentie, geen mathematisch optimum en geen regelboek.",
    sampleSizeWarning:
      "Eén roosterperiode van één standplaats (7 basisroosters, 64 regels). Patronen hieronder zijn waarnemingen in deze steekproef, geen algemene wetten.",
    extractedAt: new Date().toISOString(),
    reconciliation: {
      checks: "PDF-tijden tegen het dienstenpakket (dienst + weekdag); PDF-cellen tegen het officiële rooster in de database.",
      deviations: afwijkingen,
    },
    rules: {
      minDailyRestMinutes: context.rules.minDailyRestMinutes,
      nightRecoveryMinutes: context.rules.nightRecoveryMinutes,
      longDutyMinutes: context.rules.longDutyMinutes,
    },
    overall: overzicht,
    rosters: alle.map((r) => r.samenvatting),
  };

  // ── Profielvoorkeuren (zacht) ──────────────────────────────────────────────
  const priors = {
    schema: "ns-human-profile-priors/1",
    learnedFromBenchmark: BENCHMARK_ID,
    use: "SOFT_PRIOR — alleen als zachte voorkeur en diagnostiek, nooit als harde eis en nooit als kopieerpatroon.",
    profiles: Object.fromEntries(
      alle.map((r) => {
        const s = r.samenvatting;
        const aangrenzendHier = r.paren.filter((p) => p.offDaysBetween + p.resDaysBetween === 0);
        return [
          r.rooster.profile,
          {
            roster: r.rooster.code,
            lines: s.lines,
            daypartShare: Object.fromEntries(Object.entries(s.dayparts).map(([k, v]) => [k, r1((v / s.workedDays) * 100)])),
            adjacentTransitionShare: Object.fromEntries(
              Object.entries(verdeling(aangrenzendHier.map((p) => `${p.from}→${p.to}`))).map(([k, v]) => [k, r1((v / Math.max(1, aangrenzendHier.length)) * 100)]),
            ),
            workBlockLengths: s.workBlocks.lengthDistribution,
            meanWorkBlockLength: s.workBlocks.meanLength,
            nightBlockLengths: s.nightBlocks.lengths,
            startTimeSdPerDaypart: Object.fromEntries(Object.entries(s.startTime.dispersionPerDaypart).map(([k, v]) => [k, v.sd])),
            sameDaypartStartJitterMean: s.startTime.sameDaypartAdjacentDeltas.mean,
            oscillations: s.oscillations.count,
            weekendWorkedDaysPerLineMean: s.weekends.mean,
            lineHoursSpreadMinutes: s.hours.lineSpreadMinutes,
          },
        ];
      }),
    ),
  };

  // ── Wegschrijven ───────────────────────────────────────────────────────────
  writeFileSync(path.join(DOEL, "official-roster-lines.json"), `${JSON.stringify({ schema: "ns-human-roster-lines/1", learnedFromBenchmark: BENCHMARK_ID, rosters: dataset }, null, 2)}\n`);
  writeFileSync(path.join(DOEL, "official-features.json"), `${JSON.stringify(features, null, 2)}\n`);
  writeFileSync(path.join(DOEL, "profile-priors.json"), `${JSON.stringify(priors, null, 2)}\n`);

  writeFileSync(
    path.join(DOEL, "transition-matrix.csv"),
    csv([
      ["roster", "from", "to", "count", "shareOfFrom"],
      ...[...alle.map((r) => ({ code: r.rooster.code, matrix: r.matrix })), { code: "ALL", matrix: totaalMatrix }].flatMap(({ code, matrix }) =>
        FLOW_STATES.flatMap((van) => {
          const rijTotaal = FLOW_STATES.reduce((a, naar) => a + matrix[van][naar], 0);
          return FLOW_STATES.map((naar) => [code, van, naar, matrix[van][naar], rijTotaal === 0 ? null : r1((matrix[van][naar] / rijTotaal) * 100)]);
        }),
      ),
    ]),
  );
  writeFileSync(
    path.join(DOEL, "night-blocks.csv"),
    csv([
      ["roster", "profile", "startLine", "startWeekday", "length", "lines", "crossesLineBoundary", "entry", "exit", "recoveryHours", "nextState"],
      ...alle.flatMap((r) =>
        r.nachten.map((n) => [r.rooster.code, r.rooster.profile, r.dagen[n.startIndex].lineNumber, r.dagen[n.startIndex].weekday, n.length, n.lines.join(" "), n.crossesLineBoundary, n.entry, n.exit, n.recoveryMinutes === null ? null : r1(n.recoveryMinutes / 60), n.nextState]),
      ),
    ]),
  );
  writeFileSync(
    path.join(DOEL, "work-blocks.csv"),
    csv([
      ["roster", "profile", "startLine", "startWeekday", "length", "lines", "states", "dominant", "dominantSharePct", "switches", "reversals", "meanStartDeltaMin", "maxStartDeltaMin", "meanEndDeltaMin"],
      ...alle.flatMap((r) =>
        r.blokken.map((b) => [r.rooster.code, r.rooster.profile, r.dagen[b.startIndex].lineNumber, r.dagen[b.startIndex].weekday, b.length, b.lines.join(" "), b.states, b.dominant, r1(b.dominantShare * 100), b.switches, b.reversals, r1(gemiddelde(b.startDeltas)), b.startDeltas.length ? Math.max(...b.startDeltas) : null, r1(gemiddelde(b.endDeltas))]),
      ),
    ]),
  );
  writeFileSync(
    path.join(DOEL, "rest-distribution.csv"),
    csv([
      ["roster", "profile", "fromLine", "fromWeekday", "from", "to", "offDaysBetween", "resDaysBetween", "restMinutes", "surplusOverPlannedMinimum", "startDeltaMin", "crossesLineBoundary"],
      ...alle.flatMap((r) =>
        r.paren.map((p) => [r.rooster.code, r.rooster.profile, r.dagen[p.fromIndex].lineNumber, r.dagen[p.fromIndex].weekday, p.from, p.to, p.offDaysBetween, p.resDaysBetween, p.restMinutes, p.restMinutes - context.rules.minDailyRestMinutes, p.startDelta, p.crossesLineBoundary]),
      ),
    ]),
  );
  writeFileSync(
    path.join(DOEL, "rotation-boundaries.csv"),
    csv([
      ["roster", "profile", "fromLine", "toLine", "sunday", "monday", "transition", "restMinutes"],
      ...alle.flatMap((r) => r.grenzen.map((g) => [r.rooster.code, r.rooster.profile, g.fromLine, g.toLine, g.sunday, g.monday, g.transition, g.restMinutes])),
    ]),
  );
  writeFileSync(
    path.join(DOEL, "off-blocks.csv"),
    csv([
      ["roster", "profile", "startLine", "startWeekday", "length", "lines", "includesWeekend"],
      ...alle.flatMap((r) => r.vrij.map((b) => [r.rooster.code, r.rooster.profile, r.dagen[b.startIndex].lineNumber, r.dagen[b.startIndex].weekday, b.length, b.lines.join(" "), b.includesWeekend])),
    ]),
  );

  // ── Op het scherm ──────────────────────────────────────────────────────────
  console.log(`Afwijkingen bij de controle: ${afwijkingen.length}`);
  for (const regel of afwijkingen.slice(0, 20)) console.log(`  ! ${regel}`);
  console.log(`\nGewerkte dagen ${overzicht.workedDays}, aangrenzende paren ${overzicht.adjacentWorkedPairs}, zelfde dagdeel ${overzicht.adjacentSameDaypart}`);
  console.log(`Wissels direct:`, JSON.stringify(overzicht.adjacentChanges));
  console.log(`Zware overgangen direct ${overzicht.heavyAdjacent}, over één vrije dag ${overzicht.heavyAfterOneOff}`);
  console.log(`Grote wissels naar tussenruimte:`, JSON.stringify(overzicht.bigChangesByGap));
  console.log(`Heen-en-weer: ${overzicht.oscillations}`, JSON.stringify(overzicht.oscillationPatterns));
  console.log(`Werkblokken:`, JSON.stringify(overzicht.workBlocks));
  console.log(`Nachtreeksen:`, JSON.stringify(overzicht.nightBlocks));
  console.log(`Begintijdsprong binnen dagdeel:`, JSON.stringify(overzicht.startTimeJitter));
  console.log(`Kortste rust tussen twee diensten: ${overzicht.minAdjacentRestMinutes} min`);
  console.log(`Regelgrens:`, JSON.stringify(overzicht.boundaryTransitions));
  console.log(`\nGeschreven naar ${path.relative(WORTEL, DOEL)}/`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
