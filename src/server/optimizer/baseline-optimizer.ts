import { randomUUID } from "node:crypto";
import { DutyKind } from "@/lib/generated/prisma/enums";
import { profileAllowsDuty } from "@/domain/roster-profiles";
import { type CandidateAssignment, sealCandidate } from "@/domain/candidate";
import type {
  OptimizerDuty,
  OptimizerInput,
  OptimizerLine,
  OptimizerOutcome,
  RosterOptimizer,
} from "./contract";
import { dutyIndex, dutyKeyOf, linesFromAssignments, measureLine } from "./metrics";
import { scoreRoster } from "./scoring";

/**
 * De eerste optimizer: eenvoudig, veilig en aantoonbaar.
 *
 * ## Waarom niet meteen een solver
 *
 * Het doel van deze fase is niet een beter rooster maar een aantoonbaar veilige
 * keten: voorstel → onafhankelijke hertoetsing → beoordeelbaar resultaat. Een
 * volwaardige CP-SAT-oplosser erbovenop zou die keten niet beter bewijzen en
 * wel veel meer plaatsen opleveren waar een fout zich kan verstoppen. Deze
 * implementatie doet twee dingen die allebei met de hand na te rekenen zijn.
 *
 * ## Waarom hier geen enkele roosterregel staat
 *
 * De enige domeinfunctie die deze optimizer gebruikt is `profileAllowsDuty` —
 * precies dezelfde functie die de rules engine gebruikt, niet een tweede
 * implementatie ervan. Alle andere grenzen worden hier niet nagerekend. Dat is
 * geen slordigheid: een optimizer die zelf denkt te weten wat mag, is een
 * tweede regelboek. Wat hij voorstelt wordt onafhankelijk hertoetst, en die
 * toetsing is beslissend.
 */

export type BaselineStrategy =
  /** Neemt het bestaande rooster letterlijk over. De veilige nulmeting. */
  | "REPRODUCE"
  /**
   * Verschuift rangeerdiensten tussen lijnen van hetzelfde basisrooster om het
   * verschil tussen de zwaarste en de lichtste lijn te verkleinen.
   */
  | "BALANCE_SHUNTING";

const MAX_SWAPS = 200;

export class BaselineOptimizer implements RosterOptimizer {
  readonly name = "baseline";
  readonly version = "1.0.0";
  readonly describe =
    "Reproduceert het bestaande rooster of verschuift rangeerdiensten tussen lijnen " +
    "van hetzelfde basisrooster om de belasting gelijker te verdelen.";

  constructor(private readonly strategy: BaselineStrategy = "REPRODUCE") {}

  async generate(input: OptimizerInput, scenario: string): Promise<OptimizerOutcome> {
    if (input.rosterLines.length === 0) {
      return { status: "REFUSED", reason: "Er zijn geen roosterlijnen om mee te werken." };
    }

    const duties = dutyIndex(input.duties);
    const proposal =
      this.strategy === "REPRODUCE"
        ? input.rosterLines
        : balanceShunting(input.rosterLines, duties);

    const assignments = toAssignments(proposal);
    const reference = input.rosterLines.map((line) => measureLine(line, duties));
    const scored = scoreRoster(
      linesFromAssignments(assignments, input.rosterLines),
      duties,
      input.aggregatedFeedback,
      reference,
    );

    return {
      status: "CANDIDATE_GENERATED",
      candidate: sealCandidate({
        id: randomUUID(),
        // Het enige wat deze klasse over haar eigen uitkomst mag beweren.
        status: "CANDIDATE_GENERATED",
        optimizerName: this.name,
        optimizerVersion: `${this.version}+${this.strategy}`,
        generatedAt: new Date().toISOString(),
        mode: input.mode,
        // Niet af te leiden uit de kwaliteit van het voorstel: dit volgt de
        // status van het regelbestand en niets anders.
        legalStatus: "SIMULATION_ONLY",
        scenarioLabel: scenario,
        sourceScheduleVersion: input.sourceScheduleVersion,
        rulesetVersion: input.rulesetVersion,
        inputDataVersion: input.inputDataVersion,
        assignments,
        scoreBreakdown: scored.breakdown,
      }),
    };
  }
}

function toAssignments(lines: readonly OptimizerLine[]): readonly CandidateAssignment[] {
  return lines.flatMap((line) =>
    line.days.map((day) => ({
      baseRosterCode: line.baseRosterCode,
      lineNumber: line.lineNumber,
      weekIndex: day.weekIndex,
      weekday: day.weekday,
      positionType: day.positionType,
      dutyCode: day.dutyCode,
    })),
  );
}

/**
 * Verschuift rangeerdiensten van de zwaarste naar de lichtste lijn.
 *
 * Wisselt telkens één dienst tussen twee lijnen van hetzelfde basisrooster op
 * dezelfde cyclusdag. Daardoor blijft elke lijn evenveel dienstdagen houden en
 * blijft elke dienst even vaak gereden; alleen de verdeling verandert. Wat de
 * ruil met de rusttijden doet, weet deze functie niet en hoort zij ook niet te
 * weten — dat stelt de validator vast.
 */
function balanceShunting(
  lines: readonly OptimizerLine[],
  duties: ReadonlyMap<string, OptimizerDuty>,
): readonly OptimizerLine[] {
  const working = lines.map((line) => ({ ...line, days: [...line.days] }));

  for (const code of new Set(working.map((line) => line.baseRosterCode))) {
    const group = working.filter((line) => line.baseRosterCode === code);
    if (group.length < 2) {
      continue;
    }

    for (let swap = 0; swap < MAX_SWAPS; swap += 1) {
      const counts = group.map((line) => shuntingCount(line, duties));
      const heaviest = group[counts.indexOf(Math.max(...counts))];
      const lightest = group[counts.indexOf(Math.min(...counts))];
      if (Math.max(...counts) - Math.min(...counts) <= 1 || heaviest === lightest) {
        break;
      }
      if (!swapOnce(heaviest, lightest, duties)) {
        break;
      }
    }
  }

  return working;
}

function shuntingCount(
  line: { readonly days: readonly { dutyCode: string | null; weekday: number }[] },
  duties: ReadonlyMap<string, OptimizerDuty>,
): number {
  return line.days.filter((day) => {
    const duty = day.dutyCode ? duties.get(dutyKeyOf(day.dutyCode, day.weekday)) : null;
    return duty?.kinds.includes(DutyKind.RANGEER) ?? false;
  }).length;
}

/** Eén ruil tussen twee lijnen op dezelfde cyclusdag. Levert false als er niets past. */
function swapOnce(
  heavy: { profile: OptimizerLine["profile"]; days: OptimizerLine["days"][number][] },
  light: { profile: OptimizerLine["profile"]; days: OptimizerLine["days"][number][] },
  duties: ReadonlyMap<string, OptimizerDuty>,
): boolean {
  const lightByKey = new Map(light.days.map((day, index) => [`${day.weekIndex}|${day.weekday}`, index]));

  for (const [heavyIndex, heavyDay] of heavy.days.entries()) {
    const heavyDuty = heavyDay.dutyCode
      ? duties.get(dutyKeyOf(heavyDay.dutyCode, heavyDay.weekday))
      : null;
    if (!heavyDuty?.kinds.includes(DutyKind.RANGEER)) {
      continue;
    }

    const lightIndex = lightByKey.get(`${heavyDay.weekIndex}|${heavyDay.weekday}`);
    if (lightIndex === undefined) {
      continue;
    }
    const lightDay = light.days[lightIndex];
    const lightDuty = lightDay.dutyCode
      ? duties.get(dutyKeyOf(lightDay.dutyCode, lightDay.weekday))
      : null;
    if (!lightDuty || lightDuty.kinds.includes(DutyKind.RANGEER)) {
      continue;
    }

    // De enige regel die hier wordt geraadpleegd, en met dezelfde functie die de
    // rules engine gebruikt: past de dienst binnen het profiel van de lijn?
    if (
      !profileAllowsDuty(light.profile, heavyDuty.kinds) ||
      !profileAllowsDuty(heavy.profile, lightDuty.kinds)
    ) {
      continue;
    }

    heavy.days[heavyIndex] = { ...heavyDay, dutyCode: lightDuty.code };
    light.days[lightIndex] = { ...lightDay, dutyCode: heavyDuty.code };
    return true;
  }

  return false;
}
