import "dotenv/config";
import { dutyKey } from "@/domain/roster-quality";
import { type EvaluationContext, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";

/**
 * Grondwaarheid voor de golden conversation suite, berekend op het moment van
 * meten — niet met de hand ingetypt.
 *
 * ## Waarom dit apart staat
 *
 * Dezelfde reden als `v105/verwachting.ts`: een verwachting die in een JSON-
 * bestand wordt ingetypt, veroudert zonder waarschuwing zodra het
 * dienstenpakket verandert. Bij het opzetten van deze suite bleek dat meteen:
 * de BLM-casus uit de opdrachttekst (dienst 760 22:00–06:00, dienst 70 om
 * 04:57, 22u57 rust) bestaat niet in het huidige pakket. Geen enkele
 * nachtdienst wordt hier momenteel binnen 50 uur gevolgd door een vroege
 * dienst. Dat is nagerekend, niet aangenomen — zie `nachtOvergangen()`.
 *
 * §37 van de opdracht verbiedt precies dit soort hardcoding ("hardcoded
 * antwoorden op de BLM-test"). Deze module berekent daarom bij elke meting
 * opnieuw wat er werkelijk in het pakket staat, zodat de golden suite een
 * generieke vaardigheid toetst ("vind de kortste rust na een nachtreeks") en
 * niet een uit-het-hoofd-geleerd getal.
 */

export interface VroegLaatTelling {
  readonly roster: string;
  readonly vroeg: number;
  readonly laat: number;
  readonly nacht: number;
  readonly rangeer: number;
  readonly reserve: number;
  readonly aandeelVroeg: number;
}

/** Vroeg/laat-telling per officieel basisrooster, over de volledige rotatie. */
export function vroegLaatPerRooster(ctx: EvaluationContext): readonly VroegLaatTelling[] {
  return ctx.quality.official.map((roster) => {
    let vroeg = 0;
    let laat = 0;
    let nacht = 0;
    let rangeer = 0;
    let reserve = 0;
    for (const dag of roster.days) {
      if (!dag.dutyCode) continue;
      const duty = ctx.quality.duties.get(dutyKey(dag.dutyCode, dag.weekday));
      if (!duty) continue;
      if (duty.kinds.includes("VROEG")) vroeg += 1;
      if (duty.kinds.includes("LAAT")) laat += 1;
      if (duty.kinds.includes("NACHT")) nacht += 1;
      if (duty.kinds.includes("RANGEER")) rangeer += 1;
      if (duty.kinds.includes("RESERVE")) reserve += 1;
    }
    const noemer = vroeg + laat;
    return { roster: roster.code, vroeg, laat, nacht, rangeer, reserve, aandeelVroeg: noemer > 0 ? vroeg / noemer : 0 };
  });
}

export interface Overgang {
  readonly roster: string;
  readonly line: number;
  readonly van: string;
  readonly naar: string;
  readonly restMinuten: number;
}

/**
 * Elke overgang van een nachtdienst naar een vroege dienst, met de rust
 * ertussen — over de hele rotatie, dus ook over een weekgrens heen.
 *
 * Vindt hij niets, dan bestaat de overgang niet in dit pakket. Dat is een
 * geldig antwoord en geen bug in het script.
 */
export function nachtNaarVroegOvergangen(ctx: EvaluationContext, maxUurVooruit = 96): readonly Overgang[] {
  const uit: Overgang[] = [];
  for (const roster of ctx.quality.official) {
    const perLine = new Map<number, (typeof roster.days)[number][]>();
    for (const dag of roster.days) {
      const arr = perLine.get(dag.lineNumber) ?? [];
      arr.push(dag);
      perLine.set(dag.lineNumber, arr);
    }
    for (const [line, dagen] of perLine) {
      const sorted = dagen.slice().sort((a, b) => a.weekIndex - b.weekIndex || a.weekday - b.weekday);
      for (let i = 0; i < sorted.length; i += 1) {
        const cur = sorted[i];
        if (!cur.dutyCode) continue;
        const curDuty = ctx.quality.duties.get(dutyKey(cur.dutyCode, cur.weekday));
        if (!curDuty || !curDuty.kinds.includes("NACHT")) continue;
        for (let j = i + 1; j < sorted.length; j += 1) {
          const nxt = sorted[j];
          const curEndAbs = (cur.weekIndex * 7 + cur.weekday - 1) * 1440 + curDuty.endMinute;
          const nxtAbsWeekStart = (nxt.weekIndex * 7 + nxt.weekday - 1) * 1440;
          if (nxtAbsWeekStart - curEndAbs > maxUurVooruit * 60) break;
          if (!nxt.dutyCode) continue;
          const nxtDuty = ctx.quality.duties.get(dutyKey(nxt.dutyCode, nxt.weekday));
          if (!nxtDuty || !nxtDuty.kinds.includes("VROEG")) continue;
          const nxtStartAbs = nxtAbsWeekStart + nxtDuty.startMinute;
          uit.push({
            roster: roster.code,
            line,
            van: `${cur.dutyCode} (wk${cur.weekIndex} dag${cur.weekday}, eind ${curDuty.endMinute})`,
            naar: `${nxt.dutyCode} (wk${nxt.weekIndex} dag${nxt.weekday}, start ${nxtDuty.startMinute})`,
            restMinuten: nxtStartAbs - curEndAbs,
          });
          break;
        }
      }
    }
  }
  return uit.sort((a, b) => a.restMinuten - b.restMinuten);
}

export interface RangeerLocatie {
  readonly roster: string;
  readonly lines: readonly number[];
  readonly totaal: number;
}

/** Op welke regels van elk rooster de rangeerdiensten (RET) staan. */
export function rangeerPerRooster(ctx: EvaluationContext): readonly RangeerLocatie[] {
  return ctx.quality.official.map((roster) => {
    const lines = new Set<number>();
    let totaal = 0;
    for (const dag of roster.days) {
      if (!dag.dutyCode) continue;
      const duty = ctx.quality.duties.get(dutyKey(dag.dutyCode, dag.weekday));
      if (duty?.kinds.includes("RANGEER")) {
        lines.add(dag.lineNumber);
        totaal += 1;
      }
    }
    return { roster: roster.code, lines: [...lines].sort((a, b) => a - b), totaal };
  });
}

export async function laadGrondwaarheid(locationCode = "DDR") {
  const ctx = await loadEvaluationContextCore(locationCode);
  return {
    ctx,
    vroegLaat: vroegLaatPerRooster(ctx),
    nachtOvergangen: nachtNaarVroegOvergangen(ctx),
    rangeer: rangeerPerRooster(ctx),
  };
}

if (require.main === module) {
  laadGrondwaarheid().then((g) => {
    console.log("Vroeg/laat per rooster:");
    for (const r of g.vroegLaat) console.log(`  ${r.roster}: ${r.vroeg} vroeg / ${r.laat} laat (${(r.aandeelVroeg * 100).toFixed(0)}% vroeg), ${r.nacht} nacht, ${r.rangeer} rangeer`);
    console.log(`\nNacht→vroeg-overgangen gevonden: ${g.nachtOvergangen.length}`);
    for (const o of g.nachtOvergangen.slice(0, 5)) console.log(`  ${o.roster} regel ${o.line}: ${o.van} → ${o.naar} = ${(o.restMinuten / 60).toFixed(2)}u rust`);
    console.log("\nRangeer per rooster:");
    for (const r of g.rangeer) console.log(`  ${r.roster}: regels ${r.lines.join(", ") || "geen"} (${r.totaal} diensten)`);
    process.exit(0);
  });
}
