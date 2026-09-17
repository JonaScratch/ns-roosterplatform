import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CandidateAssignment } from "@/domain/candidate";
import { allowedKindsForProfile } from "@/domain/roster-profiles";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import {
  EXTRA_ATTEMPTS,
  MIN_DIFFERENT_SHARE,
  REPAIR_HOURS_THRESHOLD_MINUTES,
  REPAIR_SECONDS,
  SOLVE_SECONDS,
  runGenerationJob,
  solverWorkers,
  verschil,
} from "@/server/generation/generation-job";
import { STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { createRunCore } from "@/server/services/generation-service";
import { SCENARIOS, inputDataVersion, scheduleVersion } from "@/server/services/simulation-service";
import {
  BENCHMARK_ROOT,
  type Phase,
  type RawRun,
  encodeAssignments,
  readJson,
  runFile,
  sha256,
  writeJson,
} from "./benchmark/io";

/**
 * De optimizerbenchmark: één harnas voor BEFORE en AFTER.
 *
 * ## Waarom één script
 *
 * Twee scripts met elk hun eigen logica meten twee verschillende dingen, en dan
 * zegt het verschil tussen BEFORE en AFTER ook iets over de scripts. Hier gaat
 * elke run langs dezelfde weg: dezelfde generatieopdracht die de Roostercommissie
 * start, dezelfde eindvalidatie, hetzelfde bestandsformaat. Alleen de engine en
 * de rekentijdmodus verschillen, en die staan in het bestand.
 *
 * ## Opdrachten
 *
 *   manifest --phase before|after          legt data, regels, configuratie en machine vast
 *   run --phase before --engine legacy --strategy BALANCED --runs 10 --first 1
 *   run --phase after --engine adaptive --mode NORMAL --strategy BALANCED --runs 10 --first 1
 *   evaluate                               rekent alle ruwe runs door met de kwaliteitsevaluator
 *
 * Een AFTER-run weigert te starten als de gegevens niet dezelfde zijn als bij de
 * BEFORE: dan zou het verschil niet over de engine gaan.
 *
 * Draaien met: npm run verify:optimizer-benchmark -- <opdracht> …
 */

const LOCATIE = "DDR";
const ROOSTERJAAR = 2027;
const WORTEL = path.resolve(__dirname, "..");

function argument(naam: string): string | null {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

// ── Het manifest ─────────────────────────────────────────────────────────────

export interface Manifest {
  readonly schema: "ns-optimizer-benchmark-manifest/1";
  readonly phase: Phase;
  readonly createdAt: string;
  readonly version: string;
  readonly git: { readonly commit: string; readonly dirty: boolean; readonly branch: string };
  readonly data: {
    readonly location: string;
    readonly dutyPackage: { id: string; label: string | null; timetableId: string; sourceChecksum: string; duties: number };
    readonly rosterStructureVersion: string;
    readonly inputDataVersion: string;
    readonly rosters: readonly { code: string; profile: string; lines: number; cycleWeeks: number }[];
  };
  readonly hashes: {
    readonly profileConfig: string;
    readonly ruleset: string;
    readonly optimizerConfig: string;
    readonly solverScript: string;
  };
  readonly ruleset: { readonly version: string; readonly legalStatus: string; readonly rules: number };
  readonly optimizerConfig: Record<string, unknown>;
  readonly machine: {
    readonly cpuModel: string;
    readonly logicalCpus: number;
    readonly totalMemoryBytes: number;
    readonly os: string;
    readonly node: string;
    readonly python: string;
    readonly ortools: string;
    readonly solverWorkers: number;
  };
}

async function maakManifest(phase: Phase): Promise<Manifest> {
  const git = (args: string[]) => spawnSync("git", args, { cwd: WORTEL, encoding: "utf8" }).stdout.trim();
  const pakket = await prisma.dutyPackage.findFirstOrThrow({
    where: { status: "ACTIVE", depot: LOCATIE },
    orderBy: { version: "desc" },
    select: { id: true, label: true, timetableId: true, sourceChecksum: true, _count: { select: { duties: true } } },
  });
  const roosters = await prisma.baseRoster.findMany({
    where: { depot: LOCATIE, status: { in: ["ACTIVE", "DRAFT"] } },
    orderBy: { code: "asc" },
    select: { code: true, profile: true, cycleWeeks: true, _count: { select: { lines: true } } },
  });
  const ruleset = activeRuleset();
  const python = spawnSync(process.env.NS_PYTHON ?? (process.platform === "win32" ? "py" : "python3"), [
    "-c",
    "import sys, ortools; print(sys.version.split()[0]); print(ortools.__version__)",
  ], { encoding: "utf8" }).stdout.trim().split(/\r?\n/);
  const solverScript = readFileSync(path.join(WORTEL, "python", "cpsat_roster.py"));
  const optimizerConfig = {
    solveSeconds: SOLVE_SECONDS,
    repairSeconds: REPAIR_SECONDS,
    repairHoursThresholdMinutes: REPAIR_HOURS_THRESHOLD_MINUTES,
    extraAttempts: EXTRA_ATTEMPTS,
    minDifferentShare: MIN_DIFFERENT_SHARE,
    strategyWeights: STRATEGY_WEIGHTS,
  };
  const profielen = roosters.map((rooster) => ({
    code: rooster.code,
    profile: rooster.profile,
    allowed: allowedKindsForProfile(rooster.profile as RosterProfile),
  }));
  const pkg = readJson<{ version: string }>(path.join(WORTEL, "package.json"));

  return {
    schema: "ns-optimizer-benchmark-manifest/1",
    phase,
    createdAt: new Date().toISOString(),
    version: pkg.version,
    git: {
      commit: git(["rev-parse", "HEAD"]),
      dirty: git(["status", "--porcelain"]).length > 0,
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    },
    data: {
      location: LOCATIE,
      dutyPackage: {
        id: pakket.id,
        label: pakket.label,
        timetableId: pakket.timetableId,
        sourceChecksum: pakket.sourceChecksum,
        duties: pakket._count.duties,
      },
      rosterStructureVersion: await scheduleVersion(LOCATIE),
      inputDataVersion: await inputDataVersion(LOCATIE),
      rosters: roosters.map((rooster) => ({
        code: rooster.code,
        profile: rooster.profile,
        lines: rooster._count.lines,
        cycleWeeks: rooster.cycleWeeks,
      })),
    },
    hashes: {
      profileConfig: sha256(JSON.stringify(profielen)),
      ruleset: sha256(JSON.stringify(ruleset.rules)),
      optimizerConfig: sha256(JSON.stringify(optimizerConfig)),
      solverScript: sha256(solverScript),
    },
    ruleset: { version: ruleset.version, legalStatus: ruleset.legalStatus, rules: ruleset.rules.length },
    optimizerConfig,
    machine: {
      cpuModel: os.cpus()[0]?.model ?? "onbekend",
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
      python: python[0] ?? "onbekend",
      ortools: python[1] ?? "onbekend",
      solverWorkers: solverWorkers(),
    },
  };
}

/** De gegevens die voor BEFORE en AFTER gelijk moeten zijn. */
function vergelijkbaar(manifest: Manifest): string {
  return sha256(
    JSON.stringify({
      data: manifest.data,
      profile: manifest.hashes.profileConfig,
      ruleset: manifest.hashes.ruleset,
      machine: [manifest.machine.cpuModel, manifest.machine.logicalCpus],
    }),
  );
}

// ── Een run ──────────────────────────────────────────────────────────────────

async function actor(): Promise<Actor> {
  const account = await prisma.userAccount.findFirstOrThrow({
    where: { roles: { has: "ROSTER_COMMITTEE" }, status: "ACTIVE", employee: { depot: LOCATIE } },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });
  return {
    sessionId: "optimizer-benchmark",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD" as Actor["authLevel"],
    depot: account.employee.depot,
  };
}

/**
 * Het werkgeheugen van de solverprocessen, van buitenaf bemonsterd.
 *
 * Voor BEFORE en AFTER op dezelfde manier: elke twee seconden de som van alle
 * python.exe-processen. Een ander Pythonproces op de machine telt mee; dat staat
 * zo in het rapport.
 */
function geheugenMeter(): { stop: () => { python: number | null; node: number } } {
  let python: number | null = null;
  let node = process.memoryUsage().rss;
  const meet = () => {
    node = Math.max(node, process.memoryUsage().rss);
    if (process.platform !== "win32") {
      return;
    }
    const uit = spawnSync("tasklist", ["/FI", "IMAGENAME eq python.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" });
    let som = 0;
    for (const regel of uit.stdout.split(/\r?\n/)) {
      const velden = regel.match(/"([^"]*)"/g);
      if (!velden || velden.length < 5) continue;
      som += Number(velden[4].replace(/[^0-9]/g, "")) * 1024;
    }
    if (som > 0) {
      python = Math.max(python ?? 0, som);
    }
  };
  const timer = setInterval(meet, 2000);
  return {
    stop: () => {
      clearInterval(timer);
      meet();
      return { python, node };
    },
  };
}

async function voerRunUit(opties: {
  phase: Phase;
  runNumber: number;
  engine: string;
  mode: string | null;
  strategy: string;
  manifestHash: string;
  ablation: string | null;
}): Promise<RawRun> {
  const wie = await actor();
  const scenario = SCENARIOS.find((entry) => entry.key === opties.strategy);
  if (!scenario) {
    throw new Error(`Onbekende strategie ${opties.strategy}`);
  }
  const label = `Benchmark ${opties.phase} ${opties.strategy} #${opties.runNumber}`;
  const runId = await createRunCore({
    actor: wie,
    locationCode: LOCATIE,
    strategy: scenario.key,
    strategyLabel: label,
    rosterYear: ROOSTERJAAR,
    requestedCandidates: scenario.engine === "BASELINE" ? 1 : 3,
    ...(opties.engine !== "legacy" ? { engine: opties.engine, searchMode: opties.mode, ablation: opties.ablation } : {}),
  } as Parameters<typeof createRunCore>[0]);

  const meter = geheugenMeter();
  const begin = new Date();
  await runGenerationJob(runId, wie);
  const einde = new Date();
  const geheugen = meter.stop();

  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { candidates: { orderBy: { candidateNumber: "asc" } } },
  });
  const extra = run as unknown as { searchJournal?: unknown; searchCounters?: unknown };
  const kandidaten = run.candidates.map((kandidaat) => {
    const samenvatting = kandidaat.validationSummary as {
      tally?: { confirmedHardViolations: number };
      perRule?: { ruleId: string; uniqueViolations: number; confidence: string }[];
    } | null;
    const herkomst = kandidaat as unknown as { provenance?: Record<string, unknown> | null };
    return {
      number: kandidaat.candidateNumber ?? 0,
      candidateId: kandidaat.id,
      label: kandidaat.scenarioLabel,
      validationState: kandidaat.validationState,
      confirmedHardViolations: samenvatting?.tally?.confirmedHardViolations ?? null,
      perRule: samenvatting?.perRule ?? [],
      solver: (kandidaat.solverRun as Record<string, unknown> | null) ?? null,
      provenance: herkomst.provenance ?? null,
      roster: encodeAssignments(kandidaat.assignments as unknown as CandidateAssignment[]),
    };
  });
  const diversiteit: RawRun["diversity"][number][] = [];
  for (let a = 0; a < run.candidates.length; a += 1) {
    for (let b = a + 1; b < run.candidates.length; b += 1) {
      diversiteit.push({
        a: a + 1,
        b: b + 1,
        changedDutyDays: verschil(
          run.candidates[a].assignments as unknown as CandidateAssignment[],
          run.candidates[b].assignments as unknown as CandidateAssignment[],
        ),
      });
    }
  }

  const raw: RawRun = {
    schema: "ns-optimizer-benchmark-run/1",
    phase: opties.phase,
    runNumber: opties.runNumber,
    engine: opties.engine,
    mode: opties.mode,
    strategy: opties.strategy,
    label,
    manifestHash: opties.manifestHash,
    startedAt: begin.toISOString(),
    finishedAt: einde.toISOString(),
    runtimeSeconds: Math.round((einde.getTime() - begin.getTime()) / 100) / 10,
    generationRun: {
      id: run.id,
      status: run.status,
      requested: run.requestedCandidates,
      found: run.foundCandidates,
      stageMessage: run.stageMessage,
      failureReason: run.failureReason,
      log: run.log,
      searchJournal: extra.searchJournal ?? null,
      counters: extra.searchCounters ?? null,
    },
    candidates: kandidaten,
    diversity: diversiteit,
    resources: {
      peakPythonWorkingSetBytes: geheugen.python,
      peakNodeRssBytes: geheugen.node,
      logicalCpus: os.cpus().length,
    },
    ablation: opties.ablation,
  };

  // De ruwe uitkomst staat nu in het bestand; de opdracht en zijn kandidaten
  // horen niet tussen de resultaten van de Roostercommissie.
  await prisma.candidateRoster.deleteMany({ where: { generationRunId: runId } });
  await prisma.generationRun.delete({ where: { id: runId } });
  return raw;
}

// ── Opdrachten ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opdracht = process.argv[2];
  const phase = (argument("phase") ?? "before") as Phase;

  if (opdracht === "manifest") {
    const manifest = await maakManifest(phase);
    const doel = path.join(BENCHMARK_ROOT, phase === "before" ? "manifest.json" : `manifest-${phase}.json`);
    writeJson(doel, manifest);
    if (phase === "before") {
      writeJson(path.join(BENCHMARK_ROOT, `benchmark-v${manifest.version}.json`), manifest);
    }
    console.log(`Manifest ${phase}: ${doel}`);
    console.log(`  commit ${manifest.git.commit}${manifest.git.dirty ? " (met niet-vastgelegde wijzigingen)" : ""}`);
    console.log(`  pakket ${manifest.data.dutyPackage.label} (${manifest.data.dutyPackage.duties} diensten)`);
    console.log(`  ${manifest.machine.cpuModel}, ${manifest.machine.logicalCpus} threads, Python ${manifest.machine.python}, OR-Tools ${manifest.machine.ortools}`);
    return;
  }

  if (opdracht === "run") {
    const engine = argument("engine") ?? "legacy";
    const mode = argument("mode");
    const strategy = argument("strategy") ?? "BALANCED";
    const runs = Number(argument("runs") ?? 1);
    const first = Number(argument("first") ?? 1);
    const ablation = argument("ablation");

    const huidig = await maakManifest(phase);
    const beforeManifest = path.join(BENCHMARK_ROOT, "manifest.json");
    if (phase !== "before") {
      if (!existsSync(beforeManifest)) {
        throw new Error("Er is geen BEFORE-manifest. Geen AFTER zonder BEFORE.");
      }
      const voor = readJson<Manifest>(beforeManifest);
      if (vergelijkbaar(voor) !== vergelijkbaar(huidig)) {
        throw new Error(
          "De gegevens, profielen, regels of machine wijken af van de BEFORE-meting. " +
            "Een vergelijking zou dan niet over de engine gaan; de run is niet gestart.",
        );
      }
    }
    const manifestHash = vergelijkbaar(huidig);

    for (let i = 0; i < runs; i += 1) {
      const runNumber = first + i;
      const bestand = runFile(phase, runNumber);
      if (existsSync(bestand)) {
        console.log(`run ${runNumber}: bestaat al, overgeslagen (${bestand})`);
        continue;
      }
      console.log(`run ${runNumber}: ${engine}${mode ? ` ${mode}` : ""} ${strategy}${ablation ? ` zonder ${ablation}` : ""} …`);
      const raw = await voerRunUit({ phase, runNumber, engine, mode, strategy, manifestHash, ablation });
      writeJson(bestand, raw);
      console.log(
        `run ${runNumber}: ${raw.generationRun.status} ${raw.generationRun.found}/${raw.generationRun.requested} in ${raw.runtimeSeconds} s`,
      );
    }
    return;
  }

  if (opdracht === "evaluate") {
    const { evaluateBenchmark } = await import("./benchmark/evaluate");
    await evaluateBenchmark();
    return;
  }

  throw new Error("Gebruik: manifest | run | evaluate (zie de toelichting bovenin het script).");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (fout) => {
    console.error(fout);
    await prisma.$disconnect();
    process.exit(1);
  });
