import "dotenv/config";
import { performance } from "node:perf_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { toCalendarDate, addDays } from "@/domain/time";
import { BaselineOptimizer, type BaselineStrategy } from "@/server/optimizer/baseline-optimizer";
import { compareRosters } from "@/server/optimizer/comparison";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import type { OptimizerInput, OptimizerLine } from "@/server/optimizer/contract";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import {
  type CandidateDataPort,
  validateCandidate,
} from "@/server/rules-engine/final-validator";
import { parseProtections } from "@/server/validation/protections";

/**
 * Prestatiemeting op de volledige Dordrecht-dataset.
 *
 * ## Waarom hier geen norm staat
 *
 * Er wordt gemeten, niet beoordeeld. Een SLA verzinnen voordat je weet hoe iets
 * zich gedraagt, levert een getal op dat vervolgens als eis wordt gelezen — en
 * dan wordt er geoptimaliseerd op het getal in plaats van op het probleem. Deze
 * meting is er om straks te kunnen zien of iets langzamer wordt, meer niet.
 *
 * Draaien met: npx tsx --conditions=react-server scripts/measure-optimizer.ts
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  const ruleset = activeRuleset();
  const input = await loadInput();
  const port = await loadPort();

  console.log("PRESTATIEMETING — OPTIMIZER EN EINDVALIDATIE");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`Basisroosters          ${new Set(input.rosterLines.map((l) => l.baseRosterCode)).size}`);
  console.log(`Roosterlijnen          ${input.rosterLines.length}`);
  console.log(`Roosterprofielen       ${input.rosterProfiles.length}`);
  console.log(`Diensten in pakket     ${input.duties.length}`);
  console.log(`Harde constraints      ${input.hardConstraints.length}`);
  console.log(
    `  vertaalbaar          ${input.hardConstraints.filter((c) => c.translatable).length}`,
  );
  console.log(
    `  niet vertaalbaar     ${input.hardConstraints.filter((c) => !c.translatable).length}` +
      "   (blijven volledig bij de eindvalidatie)",
  );
  console.log("");

  for (const strategy of ["REPRODUCE", "BALANCE_SHUNTING"] as BaselineStrategy[]) {
    const optimizer = new BaselineOptimizer(strategy);

    const beforeMemory = process.memoryUsage().heapUsed;
    const startGenerate = performance.now();
    const outcome = await optimizer.generate(input, strategy);
    const generateMs = performance.now() - startGenerate;

    if (outcome.status === "REFUSED") {
      console.log(`${strategy}: geweigerd — ${outcome.reason}\n`);
      continue;
    }

    const candidate = outcome.candidate;

    const startValidate = performance.now();
    const review = await validateCandidate(
      candidate,
      {
        sourceScheduleVersion: candidate.sourceScheduleVersion,
        rulesetVersion: candidate.rulesetVersion,
        inputDataVersion: candidate.inputDataVersion,
        anchorMonday: mondayOf(toCalendarDate(new Date())),
      },
      port,
      ruleset,
    );
    const validateMs = performance.now() - startValidate;

    const startCompare = performance.now();
    compareRosters({
      currentLines: input.rosterLines,
      candidateAssignments: candidate.assignments,
      duties: new Map(input.duties.map((duty) => [duty.code, duty])),
      feedback: input.aggregatedFeedback,
    });
    const compareMs = performance.now() - startCompare;

    const memoryMb = (process.memoryUsage().heapUsed - beforeMemory) / 1024 / 1024;

    console.log(`── ${strategy} ──────────────────────────────────────────`);
    console.log(`  toewijzingen           ${candidate.assignments.length}`);
    console.log(`  generatie              ${generateMs.toFixed(0)} ms`);
    console.log(
      `                         ${Math.round(candidate.assignments.length / (generateMs / 1000))} toewijzingen/s`,
    );
    console.log(`  eindvalidatie          ${validateMs.toFixed(0)} ms`);
    console.log(`    beoordeelde dagen    ${review.tally.checkedAssignments}`);
    console.log(
      `                         ${Math.round(review.tally.checkedAssignments / (validateMs / 1000))} dienstdagen/s`,
    );
    console.log(`  vergelijking           ${compareMs.toFixed(0)} ms`);
    console.log(`  geheugen (heap-delta)  ${memoryMb.toFixed(1)} MB`);
    console.log(`  kwaliteitsscore        ${candidate.scoreBreakdown.overallQualityScore}`);
    console.log(`  uitkomst validatie     ${review.status}`);
    console.log(
      `    bevestigd ${review.tally.confirmedHardViolations} · mogelijk ` +
        `${review.tally.potentialHardViolations} · regels ${review.tally.rulesetIncomplete} · ` +
        `historie ${review.tally.missingCriticalContext} · ongetoetst ` +
        `${review.tally.unvalidatableAssignments}`,
    );
    console.log(`  publiceerbaar          ${review.publishable}`);
    console.log("");
  }

  console.log("── constraint solver ────────────────────────────────────────");
  for (const profiel of SCENARIO_PROFILES) {
    const optimizer = new CpSatOptimizer(profiel, 30);
    const start = performance.now();
    const outcome = await optimizer.generate(input, profiel.label);
    const generateMs = performance.now() - start;
    const extras = optimizer.lastExtras;

    console.log(`\n  ${profiel.label}`);
    console.log(`    solverstatus         ${extras?.solverStatus ?? "onbekend"}`);
    console.log(`    optimaliteit bewezen ${extras?.optimal ? "ja" : "nee"}`);
    console.log(`    rekentijd            ${extras?.wallTimeSeconds ?? 0} s (totaal ${generateMs.toFixed(0)} ms)`);
    console.log(`    model                ${extras?.variables ?? 0} variabelen, ${extras?.constraints ?? 0} constraints`);

    if (extras) {
      const a = extras.accounting;
      const som = a.fixedRoster + a.operationalPool.length + a.unassignable.length;
      console.log(
        `    diensten             ${a.sourceInstances} instanties → ${a.fixedRoster} vast, ` +
          `${a.operationalPool.length} operationele voorraad, ${a.unassignable.length} niet plaatsbaar, ` +
          `${a.excluded.length} uitgesloten`,
      );
      console.log(
        `    sluitend             ${som === a.sourceInstances ? "ja" : `NEE (${som} verantwoord)`}`,
      );
      for (const knelpunt of extras.diagnostics.slice(0, 3)) {
        console.log(`    knelpunt             ${knelpunt}`);
      }
    }

    if (outcome.status === "REFUSED") {
      console.log(`    uitkomst             geweigerd — ${outcome.reason.slice(0, 160)}`);
      continue;
    }

    const startValidate = performance.now();
    const review = await validateCandidate(
      outcome.candidate,
      {
        sourceScheduleVersion: outcome.candidate.sourceScheduleVersion,
        rulesetVersion: outcome.candidate.rulesetVersion,
        inputDataVersion: outcome.candidate.inputDataVersion,
        anchorMonday: mondayOf(toCalendarDate(new Date())),
      },
      port,
      ruleset,
    );
    const validateMs = performance.now() - startValidate;

    console.log(`    kwaliteitsscore      ${outcome.candidate.scoreBreakdown.overallQualityScore}`);
    console.log(`    eindvalidatie        ${validateMs.toFixed(0)} ms → ${review.status}`);
    // Alle vijf de tellers waar het oordeel op steunt, en niet vier. Er stonden
    // er eerst vier: dan staat er REJECTED naast louter nullen, en dat leest
    // als een validator die zonder reden weigert. De vijfde — de toewijzingen
    // die helemaal niet beoordeeld konden worden — was juist degene die het
    // oordeel bepaalde.
    console.log(
      `      bevestigd ${review.tally.confirmedHardViolations} · mogelijk ` +
        `${review.tally.potentialHardViolations} · regels ${review.tally.rulesetIncomplete} · ` +
        `historie ${review.tally.missingCriticalContext} · ongetoetst ` +
        `${review.tally.unvalidatableAssignments} · beoordeeld ` +
        `${review.tally.checkedAssignments}`,
    );
    // En waaróm hij is afgewezen, in de bewoording van de validator zelf.
    //
    // Zonder deze regels staat er een oordeel met tellers eronder en moet
    // iedereen zelf bedenken wat die tellers betekenen. Een afwijzing die niet
    // wordt uitgelegd, wordt na verloop van tijd weggewuifd als "die staat
    // altijd op rood" — en dan is de validator geen rem meer.
    for (const reden of review.blockingReasons.slice(0, 6)) {
      console.log(`      · ${reden}`);
    }
    console.log(`    publiceerbaar        ${review.publishable}`);
  }

  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log("Automatic live roster generation enabled: NO");
  console.log("Production-safe: NO — simulation/development only");
}

function mondayOf(date: string): string {
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(date, offset);
    if (new Date(`${candidate}T00:00:00Z`).getUTCDay() === 1) {
      return candidate;
    }
  }
  return date;
}

async function loadInput(): Promise<OptimizerInput> {
  const rosters = await prisma.baseRoster.findMany({
    orderBy: { code: "asc" },
    select: {
      code: true,
      profile: true,
      depot: true,
      cycleWeeks: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          lineNumber: true,
          days: {
            orderBy: [{ weekIndex: "asc" }, { weekday: "asc" }],
            select: { weekIndex: true, weekday: true, positionType: true, dutyCode: true },
          },
          assignments: {
            where: { validUntil: null },
            take: 1,
            select: { employee: { select: { employeeNumber: true, contractHours: true } } },
          },
        },
      },
    },
  });

  const duties = await prisma.duty.findMany({
    orderBy: { code: "asc" },
    select: {
      code: true,
      kinds: true,
      startMinute: true,
      endMinute: true,
      breakMinutes: true,
      overtimeMinutes: true,
      depot: true,
      requiredQualifications: true,
      weight: true,
      weekday: true,
    },
  });

  // Op welke weekdagen komt elke dienst nu voor in de roosterlijnen?
  const waargenomenWeekdagen = new Map<string, number[]>();
  for (const roster of rosters) {
    for (const line of roster.lines) {
      for (const day of line.days) {
        if (day.positionType === "DUTY" && day.dutyCode) {
          const bestaand = waargenomenWeekdagen.get(day.dutyCode) ?? [];
          if (!bestaand.includes(day.weekday)) {
            bestaand.push(day.weekday);
          }
          waargenomenWeekdagen.set(day.dutyCode, bestaand);
        }
      }
    }
  }

  const lines: OptimizerLine[] = rosters.flatMap((roster) =>
    roster.lines.map((line) => ({
      baseRosterCode: roster.code,
      profile: roster.profile,
      lineNumber: line.lineNumber,
      cycleWeeks: roster.cycleWeeks,
      days: line.days,
      contractHours: line.assignments[0]?.employee.contractHours
        ? Number(line.assignments[0].employee.contractHours)
        : null,
      occupiedBy: line.assignments[0]?.employee.employeeNumber ?? null,
    })),
  );

  const ruleset = activeRuleset();

  return {
    depot: rosters[0]?.depot ?? "DDR",
    // Elke dienst draagt zijn eigen weekdag; die staat sinds de bron per
    // weekdag wordt ingelezen vast in het pakket. Er valt hier niets meer af te
    // leiden en dus ook niets meer te raden.
    duties: duties.map((duty) => ({
      ...duty,
      requiredQualifications: [...duty.requiredQualifications],
      weekdays: [duty.weekday],
    })),
    rosterProfiles: [...new Set(rosters.map((roster) => roster.profile))],
    rosterLines: lines,
    contractualHours: lines.map((line) => ({
      baseRosterCode: line.baseRosterCode,
      lineNumber: line.lineNumber,
      hours: line.contractHours,
    })),
    hardConstraints: ruleset.rules
      .filter((rule) => rule.category === "HARD_CONSTRAINT")
      .map((rule) => ({
        ruleId: rule.id,
        title: rule.title,
        unit: rule.unit,
        value: rule.value,
        translatable: rule.value !== null && rule.unit !== "NONE",
      })),
    softObjectives: [],
    aggregatedFeedback: [],
    historicalBurden: [],
    sourceScheduleVersion: "meting",
    rulesetVersion: ruleset.version,
    inputDataVersion: "meting",
    mode: "SIMULATION",
  };
}

async function loadPort(): Promise<CandidateDataPort> {
  return {
    async rosters(codes) {
      const rows = await prisma.baseRoster.findMany({
        where: { code: { in: [...codes] } },
        select: {
          code: true,
          cycleWeeks: true,
          lines: {
            select: {
              lineNumber: true,
              assignments: {
                where: { validUntil: null },
                take: 1,
                select: {
                  employee: {
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
                  },
                },
              },
            },
          },
        },
      });

      return rows.map((roster) => ({
        code: roster.code,
        cycleWeeks: roster.cycleWeeks,
        lines: roster.lines.map((line) => {
          const employee = line.assignments[0]?.employee;
          return {
            lineNumber: line.lineNumber,
            occupant: employee
              ? {
                  id: employee.id,
                  employeeNumber: employee.employeeNumber,
                  employeeGroup: employee.employeeGroup,
                  company: employee.company,
                  depot: employee.depot,
                  rosterProfile: employee.rosterProfile,
                  qualifications: [...employee.qualifications],
                  contractHours: employee.contractHours ? Number(employee.contractHours) : null,
                  earlyStartProtectionWaived: employee.earlyStartProtectionWaived,
                  protections: parseProtections(employee.protections, employee.employeeNumber),
                }
              : null,
          };
        }),
      }));
    },
    async duties(codes) {
      const rows = await prisma.duty.findMany({
        where: { code: { in: [...codes] } },
        select: {
          id: true,
          code: true,
          weekday: true,
          kinds: true,
          depot: true,
          requiredQualifications: true,
          weight: true,
          startMinute: true,
          endMinute: true,
          breakMinutes: true,
          overtimeMinutes: true,
        },
      });
      return rows.map((duty) => ({ ...duty, requiredQualifications: [...duty.requiredQualifications] }));
    },
  };
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
