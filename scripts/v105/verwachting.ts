import "server-only";
import { rosterCredit } from "@/domain/operational-requirements";
import { dutyKey } from "@/domain/roster-quality";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { resolveRule } from "@/server/rules-engine/ruleset/types";
import type { loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";

/**
 * Wat het juiste antwoord is, berekend uit de gegevens op het moment van meten.
 *
 * ## Waarom dit een eigen module is
 *
 * Omdat twee benchmarks hem nodig hebben: de intelligentiebenchmark en de
 * lokale-AI-benchmark. Die tweede deed het eerst zonder — en daardoor kon geen
 * enkel deterministisch antwoord worden nagekeken. De meting zag er compleet
 * uit en was het niet: acht feitelijke vragen kwamen terug als ONBEOORDEELD,
 * wat je makkelijk leest als een tekortkoming van het model in plaats van een
 * gat in het meetharnas.
 *
 * ## Waarom de verwachting niet wordt ingetypt
 *
 * Ze wordt uit de database gehaald op het moment van meten. Wijzigt het
 * dienstenpakket, dan wijzigt de verwachting mee en komt een verouderd "goed"
 * antwoord vanzelf als fout naar voren.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Kloktijd: een dienst die na middernacht eindigt krijgt (+1) erbij, anders leest 25:00 als 01:00. */
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}${m >= 1440 ? " (+1)" : ""}`;
/** Duur: niet afkappen op 24 uur — een roostergemiddelde van 39:59 is geen 15:59. */
const duur = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Het verwachte antwoord, uit de gegevens zelf. Null = niet deterministisch te bepalen. */
export async function verwachting(item: Json, context: Awaited<ReturnType<typeof loadEvaluationContextCore>>): Promise<Json | null> {
  if (item.expect.kind !== "deterministic") return null;
  const rosters = context.quality.official;
  const code = item.context.rosterCode as string | undefined;
  const rooster = code ? rosters.find((r) => r.code === code) : undefined;
  const duties = context.quality.duties;
  switch (item.expect.check) {
    case "line_duties": {
      if (!rooster) return null;
      const weekday = item.expect.params?.weekday as number | undefined;
      const dagen = rooster.days
        .filter((d) => d.lineNumber === item.context.lineNumber && (weekday === undefined || d.weekday === weekday))
        .sort((a, b) => a.weekday - b.weekday)
        .map((d) => {
          const duty = d.dutyCode ? duties.get(dutyKey(d.dutyCode, d.weekday)) : undefined;
          return { weekday: d.weekday, positionType: d.positionType, dutyCode: d.dutyCode, times: duty ? `${hm(duty.startMinute)}–${hm(duty.endMinute)}` : null, kinds: duty?.kinds ?? [] };
        });
      return { days: dagen };
    }
    case "duty_times": {
      if (!rooster) return null;
      const weekday = item.expect.params.weekday as number;
      const dag = rooster.days.find((d) => d.lineNumber === item.context.lineNumber && d.weekday === weekday);
      const duty = dag?.dutyCode ? duties.get(dutyKey(dag.dutyCode, weekday)) : undefined;
      return duty ? { dutyCode: duty.code, start: hm(duty.startMinute), end: hm(duty.endMinute), kinds: duty.kinds } : null;
    }
    case "night_lines": {
      if (!rooster) return null;
      const regels = new Set<number>();
      for (const d of rooster.days) {
        const duty = d.dutyCode ? duties.get(dutyKey(d.dutyCode, d.weekday)) : undefined;
        if (duty?.kinds.includes("NACHT")) regels.add(d.lineNumber);
      }
      return { lines: [...regels].sort((a, b) => a - b) };
    }
    case "rangeer_counts": {
      const uit: Record<string, number> = {};
      for (const r of rosters) {
        let n = 0;
        for (const d of r.days) {
          const duty = d.dutyCode ? duties.get(dutyKey(d.dutyCode, d.weekday)) : undefined;
          if (duty?.kinds.includes("RANGEER")) n += 1;
        }
        uit[r.code] = n;
      }
      return { perRoster: uit };
    }
    case "hours_average": {
      const r = rosters.find((x) => x.code === item.expect.params.rosterCode);
      if (!r) return null;
      const credit = rosterCredit(r, duties);
      return { rosterCode: r.code, averageWeeklyMinutes: credit.averageWeeklyMinutes, formatted: duur(credit.averageWeeklyMinutes) };
    }
    case "rule_value": {
      const resolutie = resolveRule(activeRuleset(), item.expect.params.ruleId, {
        employeeGroup: "MACHINIST",
        company: "NSR",
        location: "DDR",
        onDate: new Date().toISOString().slice(0, 10),
      });
      if (resolutie.kind !== "RESOLVED") return { ruleId: item.expect.params.ruleId, resolved: false, kind: resolutie.kind };
      return {
        ruleId: item.expect.params.ruleId,
        value: resolutie.rule.value,
        unit: resolutie.rule.unit,
        source: resolutie.rule.source,
        legalStatus: resolutie.sourceStatus,
      };
    }
    default:
      return null;
  }
}
