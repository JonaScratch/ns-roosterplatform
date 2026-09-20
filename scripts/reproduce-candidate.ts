import "dotenv/config";
import type { CandidateAssignment } from "@/domain/candidate";
import { assignmentDistance } from "@/domain/adaptive-search";
import { prisma } from "@/server/data/prisma";
import { CpSatOptimizer, SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { evaluateAssignmentsCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { buildOptimizerInput, inputDataVersion, scheduleVersion } from "@/server/services/simulation-service";

/**
 * Een kandidaat opnieuw proberen te maken.
 *
 * ## Waarvoor
 *
 * Als later iemand vraagt "waarom staat deze dienst hier?", moet een kandidaat
 * terug te halen zijn: dezelfde invoer, dezelfde zaadwaarde, dezelfde gewichten,
 * hetzelfde vertrekpunt en dezelfde vastgezette roosters. Dit script haalt die
 * gegevens uit de herkomst van de kandidaat (of, bij een v1.0.3-kandidaat, uit
 * de solverstatistiek) en draait de solver opnieuw.
 *
 * ## Wat reproduceerbaar is en wat niet
 *
 * CP-SAT met meerdere zoekdraden en een tijdslimiet is niet bit-voor-bit
 * herhaalbaar: welke draad het eerst een oplossing vindt, hangt van de machine
 * af. Met `--workers 1` ligt het zoekpad wél vast, maar de tijdslimiet blijft
 * een klok. Dit script rapporteert daarom hoe ver de herhaling van het origineel
 * af ligt — in dienstdagen en in kwaliteit — en beweert nooit meer dan dat.
 *
 * Draaien met: npm run reproduce:candidate -- <kandidaat-id> [--workers 1]
 */

function argument(naam: string): string | null {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

interface Herkomst {
  readonly seed?: number;
  readonly workers?: number;
  readonly timeLimitSeconds?: number;
  readonly weights?: Record<string, number>;
  readonly freeRosters?: string[] | null;
  readonly attempt?: number;
  readonly strategy?: string;
  readonly mode?: string;
  readonly versions?: { sourceScheduleVersion?: string; rulesetVersion?: string; inputDataVersion?: string; configHash?: string };
}

function decodeer(compact: Record<string, Record<string, string[]>>): CandidateAssignment[] {
  const uit: CandidateAssignment[] = [];
  for (const [code, regels] of Object.entries(compact)) {
    for (const [sleutel, cellen] of Object.entries(regels)) {
      const [lineNumber, weekIndex] = sleutel.split("|").map(Number);
      cellen.forEach((cel, index) => {
        const structureel = cel.startsWith("~");
        uit.push({
          baseRosterCode: code,
          lineNumber,
          weekIndex,
          weekday: index + 1,
          positionType: (structureel ? (cel === "~LEEG" ? "DUTY" : cel.slice(1)) : "DUTY") as CandidateAssignment["positionType"],
          dutyCode: structureel ? null : cel,
        });
      });
    }
  }
  return uit;
}

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id || id.startsWith("--")) {
    throw new Error("Geef de kandidaat-id op: npm run reproduce:candidate -- <id>");
  }
  const rij = await prisma.candidateRoster.findUnique({
    where: { id },
    include: { generationRun: true },
  });
  if (!rij) {
    throw new Error(`Kandidaat ${id} bestaat niet (meer).`);
  }
  const extra = rij as unknown as { provenance: Herkomst | null; qualityModelVersion: string | null; optimizerModelVersion: string | null };
  const run = rij.generationRun as unknown as
    | { id: string; strategy: string; searchMode: string | null; engine: string; searchJournal: { entries?: Record<string, unknown>[] } | null }
    | null;
  const solver = rij.solverRun as { seed?: number; weights?: Record<string, number>; workers?: number; wallTimeSeconds?: number } | null;
  const herkomst = extra.provenance ?? {};

  console.log(`Kandidaat ${id}`);
  console.log(`  ${rij.scenarioLabel} · ${rij.optimizerName}@${rij.optimizerVersion} · ${extra.optimizerModelVersion ?? "v1.0.3-engine"}`);
  console.log(`  opdracht ${run?.id ?? "—"} (${run?.engine ?? "legacy"}${run?.searchMode ? `, ${run.searchMode}` : ""})`);
  console.log(`  kwaliteitsmodel ${extra.qualityModelVersion ?? "—"}`);

  const locatie = rij.locationCode ?? "DDR";
  const nu = {
    scheduleVersion: await scheduleVersion(locatie),
    inputDataVersion: await inputDataVersion(locatie),
    rulesetVersion: activeRuleset().version,
  };
  const toen = {
    scheduleVersion: herkomst.versions?.sourceScheduleVersion ?? rij.sourceScheduleVersion,
    inputDataVersion: herkomst.versions?.inputDataVersion ?? rij.inputDataVersion,
    rulesetVersion: herkomst.versions?.rulesetVersion ?? rij.rulesetVersion,
  };
  const gelijk = (Object.keys(nu) as (keyof typeof nu)[]).filter((sleutel) => nu[sleutel] !== toen[sleutel]);
  console.log("\nGegevens:");
  for (const sleutel of Object.keys(nu) as (keyof typeof nu)[]) {
    console.log(`  ${sleutel.padEnd(20)} ${nu[sleutel] === toen[sleutel] ? "gelijk" : `AFWIJKEND (toen ${toen[sleutel]?.slice(0, 12)}…, nu ${nu[sleutel].slice(0, 12)}…)`}`);
  }
  if (gelijk.length > 0) {
    console.log("  De invoer is sinds deze kandidaat veranderd; een exacte herhaling is dan niet mogelijk.");
  }

  const seed = herkomst.seed ?? solver?.seed;
  const gewichten = (herkomst.weights ?? solver?.weights) as Record<string, number> | undefined;
  const seconden = herkomst.timeLimitSeconds ?? Math.round(solver?.wallTimeSeconds ?? 60);
  const workers = Number(argument("workers") ?? herkomst.workers ?? solver?.workers ?? 1);
  if (seed === undefined || !gewichten) {
    throw new Error("Deze kandidaat draagt geen zaadwaarde of gewichten; herhalen kan niet.");
  }
  console.log(`\nHerhalen met zaadwaarde ${seed}, ${seconden} s, ${workers} zoekdra(a)d(en)${herkomst.freeRosters ? `, vrije roosters ${herkomst.freeRosters.join(", ")}` : ""}.`);

  const strategie = herkomst.strategy ?? run?.strategy ?? rij.optimizerVersion.split("+")[1] ?? "BALANCED";
  const profiel = SCENARIO_PROFILES.find((entry) => entry.key === strategie) ?? SCENARIO_PROFILES[0];
  const invoer = await buildOptimizerInput(locatie);
  const context = await loadEvaluationContextCore(locatie);

  // Het vertrekpunt en de vastgezette roosters van een reparatie staan in het
  // zoekjournaal van de opdracht.
  const journaal = (run?.searchJournal?.entries ?? []) as unknown as {
    attempt: number;
    hintAttempt: number | null;
    excludedAttempts: number[];
    assignments: Record<string, Record<string, string[]>> | null;
  }[];
  const eigen = journaal.find((entry) => entry.attempt === herkomst.attempt);
  const uitJournaal = (attempt: number | null | undefined) => {
    const gevonden = journaal.find((entry) => entry.attempt === attempt && entry.assignments);
    return gevonden?.assignments ? decodeer(gevonden.assignments) : null;
  };
  const hint = uitJournaal(eigen?.hintAttempt);
  const uitgesloten = (eigen?.excludedAttempts ?? []).map(uitJournaal).filter((a): a is CandidateAssignment[] => a !== null);
  const vast =
    herkomst.freeRosters && hint
      ? hint.filter((entry) => entry.positionType === "DUTY" && entry.dutyCode && !herkomst.freeRosters!.includes(entry.baseRosterCode))
      : [];

  const optimizer = new CpSatOptimizer(profiel, seconden, {
    workers,
    seed,
    objective: gewichten as never,
    nightRosterCodes: context.quality.nightRosterCodes,
    hint: hint ?? undefined,
    exclude: uitgesloten,
    fixedAssignments: vast,
    explainShortfall: false,
  });
  const begin = Date.now();
  const uitkomst = await optimizer.generate(invoer, `Herhaling van ${rij.scenarioLabel}`);
  const duur = Math.round((Date.now() - begin) / 100) / 10;
  if (uitkomst.status !== "CANDIDATE_GENERATED") {
    console.log(`\nDe herhaling leverde geen kandidaat op: ${uitkomst.reason}`);
    await prisma.$disconnect();
    process.exit(2);
  }

  const origineel = rij.assignments as unknown as CandidateAssignment[];
  const sleutel = (entry: CandidateAssignment) => `${entry.baseRosterCode}|${entry.lineNumber}|${entry.weekIndex}|${entry.weekday}`;
  const kaart = (lijst: readonly CandidateAssignment[]) =>
    new Map(lijst.filter((entry) => entry.positionType === "DUTY").map((entry) => [sleutel(entry), entry.dutyCode]));
  const afstand = assignmentDistance(kaart(origineel), kaart(uitkomst.candidate.assignments));
  const dienstdagen = origineel.filter((entry) => entry.positionType === "DUTY").length;
  const oud = evaluateAssignmentsCore(origineel, context);
  const nieuw = evaluateAssignmentsCore(uitkomst.candidate.assignments, context);

  console.log(`\nHerhaling klaar in ${duur} s (solver ${optimizer.lastExtras?.solverStatus}).`);
  console.log(`  verschil met het origineel: ${afstand} van ${dienstdagen} dienstdagen`);
  console.log(`  kwaliteit origineel  overall ${oud.overall} robuust ${oud.robust}`);
  console.log(`  kwaliteit herhaling  overall ${nieuw.overall} robuust ${nieuw.robust}`);
  console.log(
    afstand === 0
      ? "  IDENTIEK: dezelfde toewijzingen."
      : Math.abs((nieuw.robust ?? 0) - (oud.robust ?? 0)) <= 1
        ? `  VERGELIJKBAAR: een ander rooster met dezelfde kwaliteit (${workers} zoekdraden; met --workers 1 ligt het zoekpad vast).`
        : "  AFWIJKEND: zie het verschil hierboven; controleer of invoer, gewichten en vertrekpunt gelijk zijn.",
  );
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(String(fout));
  await prisma.$disconnect();
  process.exit(1);
});
