import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { type CalendarDate, toCalendarDate } from "@/domain/time";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { DEFAULT_PRODUCT_PARAMETERS } from "@/server/rules-engine/parameters";
import {
  OUTCOME_LABELS,
  OUTCOME_SYMBOLS,
  type RuleCoverage,
  type RuleViolation,
  type ValidationOutcome,
} from "@/server/rules-engine/validation/result";
import type { AssignmentRequest, Protection } from "@/server/rules-engine/validation/subject";
import type { TimelineDay } from "@/server/rules-engine/validation/timeline";

/**
 * Haalt het rooster dat er staat door de centrale validator.
 *
 * ## Waarom hier uniek geteld wordt
 *
 * Eén te lange dienstreeks raakt zeven roosterdagen. Wordt elke dag afzonderlijk
 * gevalideerd, dan levert dat zeven bevindingen op voor één probleem. Een rapport
 * dat die zeven optelt, maakt van een handjevol roosterfouten een crisis — en
 * daarmee zichzelf onbruikbaar. Elke bevinding draagt daarom een sleutel van het
 * onderliggende feit; die sleutels worden hier ontdubbeld.
 *
 * ## Waarom "overtreding" hier twee soorten kent
 *
 * Een berekende overschrijding is pas bewijs wanneer de regel gevalideerd is,
 * de bron aantoonbaar actueel, en er geen toepasselijkheidsvraag open staat.
 * Zolang dat niet zo is, heet het `POTENTIAL_HARD_VIOLATION`: het blokkeert, maar
 * niemand mag er een rooster op aanpassen zonder de openstaande punten af te
 * werken.
 *
 * Draaien met: npm run verify:rooster
 * Met `--sample=RED_WEEKEND_MIN_REST` wordt een steekproef met volledige
 * onderbouwing per bevinding afgedrukt, om met de hand na te rekenen.
 */

function client(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL ontbreekt.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const prisma = client();

const DUTY_SELECT = {
  id: true,
  code: true,
  kinds: true,
  startMinute: true,
  endMinute: true,
  depot: true,
  requiredQualifications: true,
  weight: true,
  breakMinutes: true,
  overtimeMinutes: true,
} as const;

interface DutyRow {
  id: string;
  code: string;
  kinds: readonly string[];
  startMinute: number;
  endMinute: number;
  depot: string;
  requiredQualifications: readonly string[];
  weight: number;
  breakMinutes: number | null;
  overtimeMinutes: number;
}

/**
 * De dekking van één regel over de hele regressie.
 *
 * Alleen de slechtste dekking rapporteren zou onrecht doen aan een regel die op
 * het merendeel van de dagen prima te beoordelen was; alleen de beste zou het
 * omgekeerde doen. Beide, plus het aantal dagen waarop de regel werkelijk
 * bewijsbaar was, geeft het echte beeld.
 */
interface CoverageSummary {
  readonly reference: RuleCoverage;
  worst: number;
  best: number;
  days: number;
  provableDays: number;
}

/** Het onderliggende feit achter een bevinding, ontdubbeld over roosterdagen. */
interface UniqueViolation {
  readonly ruleId: string;
  readonly occurrenceKey: string;
  readonly confidence: RuleViolation["confidence"];
  readonly employees: Set<string>;
  readonly assignments: Set<string>;
  rawCount: number;
  readonly sample: RuleViolation;
}

async function main(): Promise<void> {
  const sampleRule = process.argv
    .find((argument) => argument.startsWith("--sample="))
    ?.slice("--sample=".length);

  const ruleset = activeRuleset();

  const bounds = await prisma.scheduledDuty.aggregate({
    _min: { date: true },
    _max: { date: true },
  });
  if (!bounds._min.date || !bounds._max.date) {
    console.log("Er staat geen rooster in de database.");
    return;
  }

  const coverageFrom = toCalendarDate(bounds._min.date);
  const coverageTo = toCalendarDate(bounds._max.date);

  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE", rosterAssignments: { some: {} } },
    select: {
      id: true,
      employeeNumber: true,
      rosterProfile: true,
      depot: true,
      qualifications: true,
      employeeGroup: true,
      company: true,
      contractHours: true,
      earlyStartProtectionWaived: true,
      protections: true,
    },
    orderBy: { employeeNumber: "asc" },
  });

  const outcomes = new Map<ValidationOutcome, number>();
  const unique = new Map<string, UniqueViolation>();
  const missingPerRule = new Map<string, number>();
  const coveragePerRule = new Map<string, CoverageSummary>();
  const unverifiedCurrency = new Set<string>();
  const evaluated = new Set<string>();
  const samples: RuleViolation[] = [];

  let checked = 0;
  let rawRuleEvaluations = 0;
  const affectedAssignments = new Set<string>();
  const affectedEmployees = new Set<string>();

  for (const employee of employees) {
    const rows = await prisma.scheduledDuty.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: "asc" },
      select: { id: true, date: true, positionType: true, duty: { select: DUTY_SELECT } },
    });

    const days: TimelineDay[] = rows.map((row) => ({
      date: toCalendarDate(row.date),
      positionType: row.positionType,
      duty: row.duty
        ? { dutyId: row.duty.id, code: row.duty.code, shape: toShape(row.duty) }
        : null,
    }));

    for (const row of rows) {
      if (!row.duty) {
        continue;
      }
      const date = toCalendarDate(row.date) as CalendarDate;

      const request: AssignmentRequest = {
        subject: {
          employeeId: employee.id,
          employeeNumber: employee.employeeNumber,
          employeeGroup: employee.employeeGroup,
          company: company(employee.company),
          depot: employee.depot,
          rosterProfile: employee.rosterProfile,
          qualifications: employee.qualifications,
          contractHours: employee.contractHours ? Number(employee.contractHours) : null,
          earlyStartProtectionWaived: employee.earlyStartProtectionWaived,
          protections: (employee.protections as Protection[] | null) ?? [],
        },
        date,
        candidate: {
          dutyId: row.duty.id,
          code: row.duty.code,
          kinds: row.duty.kinds as AssignmentRequest["candidate"]["kinds"],
          depot: row.duty.depot,
          requiredQualifications: [...row.duty.requiredQualifications],
          weight: row.duty.weight,
          shape: toShape(row.duty),
        },
        planningStage: "BASE_ROSTER",
        reason: "REGRESSION_CHECK",
        timeline: { days, coverage: { from: coverageFrom, to: coverageTo } },
        exceptions: [],
      };

      const result = evaluateAssignment(request, ruleset);
      checked += 1;
      outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);

      for (const id of result.evaluatedRules) {
        evaluated.add(id);
      }
      for (const id of result.rulesWithUnverifiedCurrency) {
        unverifiedCurrency.add(id);
      }
      for (const entry of result.contextCoverage) {
        const key = `${entry.ruleId}|${entry.window}`;
        const existing = coveragePerRule.get(key);
        if (existing) {
          existing.worst = Math.min(existing.worst, entry.coveragePercentage);
          existing.best = Math.max(existing.best, entry.coveragePercentage);
          existing.days += 1;
          existing.provableDays += entry.validationPossible ? 1 : 0;
        } else {
          coveragePerRule.set(key, {
            reference: entry,
            worst: entry.coveragePercentage,
            best: entry.coveragePercentage,
            days: 1,
            provableDays: entry.validationPossible ? 1 : 0,
          });
        }
      }

      for (const violation of result.hardViolations) {
        rawRuleEvaluations += 1;
        affectedAssignments.add(`${employee.employeeNumber}|${date}`);
        affectedEmployees.add(employee.employeeNumber);

        const entry = unique.get(violation.occurrenceKey);
        if (entry) {
          entry.rawCount += 1;
          entry.employees.add(employee.employeeNumber);
          entry.assignments.add(`${employee.employeeNumber}|${date}`);
        } else {
          unique.set(violation.occurrenceKey, {
            ruleId: violation.ruleId,
            occurrenceKey: violation.occurrenceKey,
            confidence: violation.confidence,
            employees: new Set([employee.employeeNumber]),
            assignments: new Set([`${employee.employeeNumber}|${date}`]),
            rawCount: 1,
            sample: violation,
          });
        }

        if (sampleRule && violation.ruleId === sampleRule && samples.length < 25) {
          if (!samples.some((entry) => entry.occurrenceKey === violation.occurrenceKey)) {
            samples.push(violation);
          }
        }
      }

      for (const missing of result.missingRules) {
        missingPerRule.set(missing.ruleId, (missingPerRule.get(missing.ruleId) ?? 0) + 1);
      }
    }
  }

  report({
    ruleset,
    coverage: {
      from: coverageFrom,
      to: coverageTo,
      back: DEFAULT_PRODUCT_PARAMETERS.windowDaysBack,
      forward: DEFAULT_PRODUCT_PARAMETERS.windowDaysForward,
    },
    employees: employees.length,
    checked,
    outcomes,
    unique: [...unique.values()],
    rawRuleEvaluations,
    affectedAssignments: affectedAssignments.size,
    affectedEmployees: affectedEmployees.size,
    missingPerRule,
    coveragePerRule: [...coveragePerRule.values()],
    unverifiedCurrency,
    evaluated,
  });

  if (sampleRule) {
    printSample(sampleRule, samples);
  }

  if (checked === 0) {
    console.log("\nEr is niets getoetst. Dit script heeft dus niets aangetoond.");
    process.exitCode = 1;
  }
}

function toShape(duty: DutyRow) {
  return {
    startMinute: duty.startMinute,
    endMinute: duty.endMinute,
    breakMinutes: duty.breakMinutes,
    overtimeMinutes: duty.overtimeMinutes,
  };
}

function company(value: string): AssignmentRequest["subject"]["company"] {
  const known = ["NSR", "NS_INTERNATIONAL", "NEDTRAIN", "OVERIG"] as const;
  return known.find((entry) => entry === value) ?? "OVERIG";
}

/** Het soort feit achter een sleutel, voor de telling van betrokken vensters. */
function factKind(occurrenceKey: string): "VENSTER" | "PLAATSING" {
  const tail = occurrenceKey.split("|").slice(2).join("|");
  return /^(venster|week|weekendreeks|reeks|nachtreeks|kalenderjaar|rust):/.test(tail)
    ? "VENSTER"
    : "PLAATSING";
}

const ORDER: readonly ValidationOutcome[] = [
  "VALID_WITHIN_VALIDATED_RULESET",
  "VALID_WITH_WARNINGS",
  "CONTEXT_INCOMPLETE",
  "RULESET_INCOMPLETE",
  "POTENTIAL_HARD_VIOLATION",
  "CONFIRMED_HARD_VIOLATION",
];

function report(input: {
  ruleset: ReturnType<typeof activeRuleset>;
  coverage: { from: string; to: string; back: number; forward: number };
  employees: number;
  checked: number;
  outcomes: Map<ValidationOutcome, number>;
  unique: readonly UniqueViolation[];
  rawRuleEvaluations: number;
  affectedAssignments: number;
  affectedEmployees: number;
  missingPerRule: Map<string, number>;
  coveragePerRule: readonly CoverageSummary[];
  unverifiedCurrency: Set<string>;
  evaluated: Set<string>;
}): void {
  const hardRules = input.ruleset.rules.filter((rule) => rule.category === "HARD_CONSTRAINT");
  const validated = hardRules.filter((rule) => rule.status === "VALIDATED");

  console.log("REGRESSIE OVER HET BESTAANDE ROOSTER");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`Regelbestand           ${input.ruleset.version}`);
  console.log(`Modus                  ${input.ruleset.mode}`);
  console.log(`Juridische status      ${input.ruleset.legalStatus}`);
  console.log(`Harde regels           ${hardRules.length}, waarvan ${validated.length} gevalideerd`);
  console.log(`Ontbrekende pakketten  ${input.ruleset.missingPackages.length}`);
  console.log("");
  console.log(`Roosterdekking         ${input.coverage.from} t/m ${input.coverage.to}`);
  console.log(
    `Vensterbehoefte        ${input.coverage.back} dagen terug, ${input.coverage.forward} vooruit`,
  );
  console.log(`Medewerkers            ${input.employees}`);
  console.log(`Getoetste dienstdagen  ${input.checked}`);
  console.log("");

  console.log("Uitkomst per dienstdag:");
  for (const outcome of ORDER) {
    const count = input.outcomes.get(outcome) ?? 0;
    const share = input.checked === 0 ? 0 : Math.round((count / input.checked) * 100);
    console.log(
      `  ${OUTCOME_SYMBOLS[outcome]} ${OUTCOME_LABELS[outcome].padEnd(34)} ` +
        `${String(count).padStart(6)}  ${String(share).padStart(3)}%`,
    );
  }

  const confirmed = input.unique.filter((entry) => entry.confidence === "CONFIRMED");
  const potential = input.unique.filter((entry) => entry.confidence === "POTENTIAL");
  const windows = input.unique.filter((entry) => factKind(entry.occurrenceKey) === "VENSTER");

  console.log("\nTelling van bevindingen:");
  console.log(`  rawRuleEvaluations   ${input.rawRuleEvaluations}   (bevindingen bij het toetsen)`);
  console.log(`  uniqueViolations     ${input.unique.length}   (onderliggende feiten)`);
  console.log(`    confirmed          ${confirmed.length}`);
  console.log(`    potential          ${potential.length}`);
  console.log(`  affectedAssignments  ${input.affectedAssignments}`);
  console.log(`  affectedEmployees    ${input.affectedEmployees}`);
  console.log(`  affectedWindows      ${windows.length}`);
  console.log(
    `\nDaadwerkelijk doorgerekende regels: ${input.evaluated.size}` +
      (input.unverifiedCurrency.size > 0
        ? `, waarvan ${input.unverifiedCurrency.size} uit een bron waarvan de actuele status ` +
          "niet is geverifieerd"
        : ""),
  );

  printViolations("BEVESTIGDE OVERTREDINGEN", confirmed, [
    "Regel gevalideerd, bron actueel, toepasselijkheid vastgesteld. Hierop mag",
    "een rooster worden aangepast.",
  ]);
  printViolations("MOGELIJKE OVERTREDINGEN — eerst verifiëren", potential, [
    "De berekening wijst op een overschrijding, maar bron of toepasselijkheid",
    "staat niet vast. Dit blokkeert wél en is géén bewijs. Wat er per regel",
    "openstaat, staat achter de regel.",
  ]);

  if (input.missingPerRule.size > 0) {
    console.log("\nONTBREKENDE REGELS OF PARAMETERS");
    console.log("────────────────────────────────────────────────────────────");
    console.log("  Op te lossen door aanlevering, niet door roosterwijziging.\n");
    for (const [id, count] of [...input.missingPerRule.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(6)} dienstdagen  ${id}`);
    }
  }

  console.log("\nCONTEXTDEKKING PER REGEL");
  console.log("────────────────────────────────────────────────────────────");
  console.log(
    "  Een regel met een venster dat niet volledig in de gegevens past, kan\n" +
      "  nooit een bevestigde uitkomst opleveren — ook geen bevestigd 'geldig'.\n",
  );
  console.log(
    `  ${"regel".padEnd(38)} ${"venster".padEnd(16)} ${"nodig".padEnd(12)} ` +
      `${"dekking".padEnd(12)} bewijsbaar op`,
  );
  for (const entry of [...input.coveragePerRule].sort((a, b) => a.best - b.best)) {
    const needed = `${entry.reference.requiredHistoryDays}+${entry.reference.requiredFutureDays}d`;
    console.log(
      `  ${entry.reference.ruleId.padEnd(38)} ${entry.reference.window.padEnd(16)} ` +
        `${needed.padEnd(12)} ` +
        `${`${entry.worst}–${entry.best}%`.padEnd(12)} ` +
        `${entry.provableDays}/${entry.days} dienstdagen`,
    );
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("Production-safe: NO — simulation/development only");
}

function printViolations(
  title: string,
  violations: readonly UniqueViolation[],
  explanation: readonly string[],
): void {
  console.log(`\n${title}`);
  console.log("────────────────────────────────────────────────────────────");
  for (const line of explanation) {
    console.log(`  ${line}`);
  }
  if (violations.length === 0) {
    console.log("\n  Geen.");
    return;
  }
  console.log("");

  const perRule = new Map<
    string,
    { unique: number; raw: number; employees: Set<string>; open: readonly string[] }
  >();
  for (const entry of violations) {
    const existing = perRule.get(entry.ruleId);
    if (existing) {
      existing.unique += 1;
      existing.raw += entry.rawCount;
      for (const employee of entry.employees) {
        existing.employees.add(employee);
      }
    } else {
      perRule.set(entry.ruleId, {
        unique: 1,
        raw: entry.rawCount,
        employees: new Set(entry.employees),
        open: entry.sample.unverified.map((fact) => fact.kind),
      });
    }
  }

  console.log(`  ${"regel".padEnd(40)} ${"uniek".padStart(6)} ${"ruw".padStart(6)} ${"mw".padStart(4)}  openstaand`);
  for (const [id, entry] of [...perRule.entries()].sort((a, b) => b[1].unique - a[1].unique)) {
    console.log(
      `  ${id.padEnd(40)} ${String(entry.unique).padStart(6)} ${String(entry.raw).padStart(6)} ` +
        `${String(entry.employees.size).padStart(4)}  ${[...new Set(entry.open)].join(", ")}`,
    );
  }
}

/**
 * De steekproef.
 *
 * Bedoeld om met de hand na te rekenen. Daarom staat er per bevinding precies
 * wat de regel eist, wat er gemeten is, en welke vragen open blijven — niet een
 * samenvatting maar de invoer van de redenering.
 */
function printSample(ruleId: string, samples: readonly RuleViolation[]): void {
  console.log(`\n\nSTEEKPROEF — ${ruleId} (${samples.length} unieke bevindingen)`);
  console.log("════════════════════════════════════════════════════════════");
  samples.forEach((violation, index) => {
    console.log(`\n[${index + 1}] medewerker ${violation.employeeScope}`);
    console.log(`    sleutel   ${violation.occurrenceKey}`);
    console.log(`    zekerheid ${violation.confidence}`);
    console.log(`    melding   ${violation.message}`);
    console.log(`    details   ${JSON.stringify(violation.details, null, 2).replace(/\n/g, "\n    ")}`);
    for (const fact of violation.unverified) {
      console.log(`    open      [${fact.kind}] ${fact.detail}`);
    }
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
