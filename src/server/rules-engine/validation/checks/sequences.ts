import { RULE } from "../../ruleset/rule-ids";
import type { Evaluation } from "../evaluation";
import type { AssignmentRequest } from "../subject";
import { serviceRunAround } from "../timeline";

/**
 * Reeksen aaneengesloten diensten.
 *
 * Een opleidingsdag telt mee: dat is arbeidstijd, geen vrije dag. Een
 * reservedag telt ook mee, want de medewerker is die dag beschikbaar. Een WTV-
 * of RO-dag telt niet mee en breekt de reeks — zie `countsInServiceRun`.
 */
export function checkSequences(request: AssignmentRequest, evaluation: Evaluation): void {
  if (!evaluation.hasContext("DAYS_14", [RULE.MAX_CONSECUTIVE_SERVICES])) {
    return;
  }

  const run = serviceRunAround(request.timeline, request.date);
  if (!run) {
    return;
  }

  const maximum = evaluation.require(RULE.MAX_CONSECUTIVE_SERVICES);
  if (maximum && run.length > maximum.count) {
    evaluation.violate(maximum, {
      calculatedValue: run.length,
      limit: maximum.count,
      message:
        `Deze plaatsing maakt een reeks van ${run.length} aaneengesloten diensten ` +
        `(${run.from} tot en met ${run.to}); het maximum is ${maximum.count}.`,
      occurrenceKey: `reeks:${run.from}..${run.to}`,
    });
  }

  if (run.nightCount === 0) {
    return;
  }

  const nightMaximum = evaluation.require(RULE.MAX_CONSECUTIVE_IN_NIGHT_SEQUENCE);
  if (nightMaximum && run.length > nightMaximum.count) {
    evaluation.violate(nightMaximum, {
      calculatedValue: run.length,
      limit: nightMaximum.count,
      message:
        `De reeks van ${run.from} tot en met ${run.to} bevat ${run.nightCount} ` +
        `nachtdienst${run.nightCount === 1 ? "" : "en"} en telt ${run.length} diensten; ` +
        `in een reeks met nachtdiensten zijn er ten hoogste ${nightMaximum.count} toegestaan.`,
      occurrenceKey: `nachtreeks:${run.from}..${run.to}`,
    });
  }
}
