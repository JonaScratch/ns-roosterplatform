import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AGENT_CAPABILITIES, AGENT_LEVELS, currentGrant } from "@/server/agent/capabilities";
import { QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import { toolCatalogue } from "@/server/agent/tools";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { sha256 } from "../benchmark/io";
import { beoordeelWerkmapSchoonheid, headMatchtBaseline } from "./subject-worktree";

/**
 * Eén gecombineerd voor-manifest voor de LYRA MASTER PROGRAM BEFORE-run.
 *
 * ## Waarom dit een nieuw bestand is, en geen derde manifest-traditie
 *
 * De fase-0-inventaris (`docs/lyra-knowledge/inventory-benchmark-infrastructure.md`,
 * hoofdstuk "Manifest/freeze-praktijk") stelde vast dat er al TWEE aparte
 * manifest-implementaties bestaan — `scripts/v106/n0-manifest.ts` (agent-kant:
 * sterk op modelconfiguratie/capabilities/tools, geen hash-gebaseerde
 * config-integriteit) en `scripts/optimizer-benchmark.ts`'s manifest
 * (engine-kant: sterk op hash-gebaseerde config-integriteit en
 * machine/ortools-versie, geen taalmodelinformatie) — en dat geen van beide
 * de vier expliciet beloofde velden vult: databaseversie, engineversie,
 * kwaliteitsmodelversie, regelsetversie.
 *
 * Dit bestand combineert het beste van beide (in plaats van een derde,
 * incompatibele traditie te starten) en vult expliciet de vier ontbrekende
 * velden — de bouwstenen daarvoor (Prisma-migratieversie, `QUALITY_MODEL_V3`,
 * `activeRuleset().version`) bestonden al elders in de codebase.
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/before-manifest.ts --run <runId> --phase before
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const BASELINE_HEAD = "588c1e5";
const git = (args: string[]) => execFileSync("git", args, { cwd: WORTEL, encoding: "utf8" }).trim();
const gitToegestaanFalen = (args: string[]): string => {
  try {
    return execFileSync("git", args, { cwd: WORTEL, encoding: "utf8" });
  } catch {
    return "";
  }
};

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

/** Nieuwste Prisma-migratiemap als "databaseversie" — geen los versienummer bestaat vandaag, dit is het dichtstbijzijnde eerlijke equivalent. */
function databaseVersion(): string {
  const migratiesDir = path.join(WORTEL, "prisma", "migrations");
  if (!existsSync(migratiesDir)) return "onbekend (geen prisma/migrations gevonden)";
  const mappen = readdirSync(migratiesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return mappen.length > 0 ? mappen[mappen.length - 1] : "onbekend (geen migraties gevonden)";
}

const actor = (): Actor =>
  ({
    sessionId: "lyra-master-before-manifest",
    userId: "x",
    employeeId: "x",
    employeeNumber: "900001",
    roles: ["ROSTER_COMMITTEE"],
    authLevel: "PASSWORD",
    depot: "DDR",
  }) as unknown as Actor;

async function main(): Promise<void> {
  const runId = argument("run") ?? new Date().toISOString().replace(/[:.]/g, "-");
  const phase = (argument("phase") ?? "before") as "before" | "after";

  const headCommit = git(["rev-parse", "HEAD"]);
  const headMatchesBaseline = headMatchtBaseline(headCommit, BASELINE_HEAD);

  if (phase === "before" && !headMatchesBaseline) {
    console.error(
      `[FOUT] HEAD is ${headCommit.slice(0, 12)}, niet ${BASELINE_HEAD}. De BEFORE-run vereist exact de bevroren codebaseline ` +
        `(commit ${BASELINE_HEAD} — "Lyra Master Program — Fase 0: volledige inventaris bestaande kennisarchitectuur"). ` +
        `Zie run-before-local.ps1: dat script zet dit automatisch goed (aparte subject-worktree op ${BASELINE_HEAD}) vóórdat dit script draait.`,
    );
    process.exit(1);
  }

  // ── Werkmap-integriteit: HEAD == baseline EN getrackte inhoud ongewijzigd ──
  //
  // NIET hetzelfde als "git status --porcelain is helemaal leeg" — de
  // orchestrator zet zelf een paar untracked helperbestanden neer
  // (before-manifest.ts, subject-worktree.ts, smoke-import.ts) om deze
  // bevroren appcode te kunnen aanroepen; dat maakt de worktree niet "dirty"
  // in de zin die hier telt. Zie subject-worktree.ts voor de classificatie.
  // --untracked-files=all: anders toont git een volledig niet-getrackte map
  // (bv. scripts/lyra-master/, dat op de bevroren baseline niet bestaat) als
  // ÉÉN verzamelregel in plaats van elk bestand apart, waardoor de classifier
  // die regel nooit met een whitelisted orchestrator-pad kan matchen.
  const porcelain = git(["status", "--porcelain", "--untracked-files=all"]);
  const schoonheid = beoordeelWerkmapSchoonheid(porcelain);
  const trackedBaselineClean = schoonheid.trackedModifiedPaths.length === 0;
  // Alleen informatief: welke genegeerde runtime-artifacten (node_modules,
  // .env, gegenereerde Prisma-client) daadwerkelijk aanwezig zijn. Git laat
  // deze standaard al buiten `git status --porcelain` (zonder --ignored), dus
  // dit heeft geen invloed op trackedBaselineClean/unexpectedUntrackedPaths —
  // puur ter documentatie in het manifest.
  const generatedIgnoredArtifacts = gitToegestaanFalen(["status", "--porcelain", "--ignored=matching", "--untracked-files=all"])
    .split("\n")
    .filter((r) => r.startsWith("!! "))
    .map((r) => r.slice(3).trim());

  const pakket = await prisma.dutyPackage.findFirst({
    where: { depot: "DDR", status: "ACTIVE" },
    orderBy: { validFrom: "desc" },
    select: { id: true, label: true, sourceChecksum: true },
  });

  const config = localConfigFromEnv();
  const beschikbaar = config ? await localModelAvailable(config) : { ok: false, detail: "geen lokaal model ingesteld (NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL)" };

  let ollamaVersion = "onbekend";
  try {
    ollamaVersion = execFileSync("ollama", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    // Ollama niet op PATH vanuit dit proces; geen harde fout — localModelAvailable() is de echte poort.
  }

  let gpu = "onbekend";
  try {
    gpu = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { encoding: "utf8" }).trim();
  } catch {
    // Geen NVIDIA-tooling; geen harde fout.
  }

  const stubGeforceerd = process.env.NS_AGENT_FORCE_STUB === "1" || process.env.NS_AGENT_FORCE_STUB === "true";

  const grant = await currentGrant("DDR");
  const catalogus = toolCatalogue(actor());
  const ruleset = activeRuleset();

  const golden = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.6", "golden-suite.json"), "utf8")) as {
    version: string;
    items: readonly unknown[];
    counts: Record<string, unknown>;
  };

  const packageJson = JSON.parse(readFileSync(path.join(WORTEL, "package.json"), "utf8")) as { version: string };

  const uit = {
    schema: "ns-lyra-master-before-manifest/1",
    phase,
    runId,
    recordedAt: new Date().toISOString(),
    purpose:
      "Combineert de agent-kant-manifesttraditie (n0-manifest.ts) en de engine-kant-manifesttraditie " +
      "(optimizer-benchmark.ts) tot één voor-manifest voor de LYRA MASTER PROGRAM-ronde, met de vier expliciet " +
      "beloofde-maar-eerder-ontbrekende velden: databaseVersion, engineVersion, qualityModelVersion, rulesetVersion.",
    git: {
      headCommit,
      headSubject: git(["log", "-1", "--pretty=%s"]),
      headDate: git(["log", "-1", "--pretty=%cI"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      baselineHead: BASELINE_HEAD,
      headMatchesBaseline,
      // De echte integriteitsgarantie: HEAD == baseline EN de getrackte inhoud
      // van die commit is ongewijzigd. NIET "git status --porcelain is leeg" —
      // de orchestrator zet zelf bekende, ongevaarlijke helperbestanden neer.
      trackedBaselineClean,
      trackedModifiedPaths: schoonheid.trackedModifiedPaths,
      orchestratorArtifacts: schoonheid.orchestratorArtifacts,
      benchmarkOutputPaths: schoonheid.benchmarkOutputPaths,
      generatedIgnoredArtifacts,
      unexpectedUntrackedPaths: schoonheid.unexpectedUntrackedPaths,
    },
    // De vier expliciet gevraagde, eerder ontbrekende velden:
    databaseVersion: databaseVersion(),
    engineVersion: packageJson.version,
    qualityModelVersion: QUALITY_MODEL_V3.version,
    rulesetVersion: ruleset.version,
    hashes: {
      ruleset: sha256(JSON.stringify(ruleset.rules)),
      toolCatalogue: sha256(JSON.stringify(catalogus.map((t) => ({ name: t.name, allowed: t.allowed, requires: t.requires })))),
      goldenSuite: sha256(JSON.stringify(golden.items)),
    },
    dutyPackage: pakket ? { id: pakket.id, label: pakket.label, sourceChecksum: pakket.sourceChecksum } : null,
    localModel: {
      configured: config !== null,
      url: config?.baseUrl ?? null,
      model: config?.model ?? null,
      temperature: config?.temperature ?? null,
      maxTokens: config?.maxTokens ?? null,
      timeoutMs: config?.timeoutMs ?? null,
      reachable: beschikbaar.ok,
      detail: beschikbaar.detail,
      ollamaVersion,
      gpu,
    },
    stubExplicitlyDisabled: !stubGeforceerd,
    agentCapabilities: {
      all: Object.values(AGENT_CAPABILITIES),
      levels: AGENT_LEVELS,
      currentGrantDDR: {
        capabilities: grant.capabilities,
        maxRounds: grant.maxRounds,
        maxSolverSeconds: grant.maxSolverSeconds,
        allowedStrategies: grant.allowedStrategies,
        protectedRosters: grant.protectedRosters,
        suspendedAt: grant.suspendedAt,
      },
    },
    toolCatalogue: catalogus.map((t) => ({ name: t.name, allowed: t.allowed, requires: t.requires })),
    goldenSuite: { version: golden.version, itemCount: golden.items.length, counts: golden.counts, note: "de bevroren 43-item suite; ongewijzigd sinds v1.0.6" },
  };

  const doelMap = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", phase, runId);
  mkdirSync(doelMap, { recursive: true });
  const doel = path.join(doelMap, "manifest.json");
  writeFileSync(doel, `${JSON.stringify(uit, null, 2)}\n`);

  console.log(`Geschreven: ${doel}`);
  console.log(
    `  HEAD ${uit.git.headCommit.slice(0, 12)} (baseline ${uit.git.headMatchesBaseline ? "OK" : "MISMATCH"}, ` +
      `getrackte inhoud ${uit.git.trackedBaselineClean ? "ongewijzigd" : "GEWIJZIGD"})`,
  );
  if (uit.git.orchestratorArtifacts.length > 0) {
    console.log(`  Orchestrator-eigen helperbestanden getolereerd: ${uit.git.orchestratorArtifacts.join(", ")}`);
  }
  if (uit.git.benchmarkOutputPaths.length > 0) {
    console.log(`  Eerdere/huidige benchmark-outputpaden getolereerd: ${uit.git.benchmarkOutputPaths.length} pad(en)`);
  }
  if (uit.git.unexpectedUntrackedPaths.length > 0) {
    console.log(`  [WAARSCHUWING] Onverwachte niet-getrackte bestanden: ${uit.git.unexpectedUntrackedPaths.join(", ")}`);
  }
  console.log(`  databaseVersion=${uit.databaseVersion} engineVersion=${uit.engineVersion} qualityModelVersion=${uit.qualityModelVersion} rulesetVersion=${uit.rulesetVersion}`);
  console.log(`  lokaal model: ${uit.localModel.model} · bereikbaar: ${uit.localModel.reachable} · ${uit.localModel.detail}`);
  console.log(`  stub expliciet uitgeschakeld: ${uit.stubExplicitlyDisabled}`);
  console.log(`  golden suite: ${uit.goldenSuite.itemCount} items, versie ${uit.goldenSuite.version}`);

  if (phase === "before" && !uit.git.headMatchesBaseline) {
    console.error(`[FOUT] HEAD (${uit.git.headCommit.slice(0, 12)}) komt niet overeen met de bevroren baseline ${BASELINE_HEAD}.`);
    process.exit(1);
  }
  if (phase === "before" && !uit.git.trackedBaselineClean) {
    console.error(
      `[FOUT] Getrackte baseline-bestanden zijn gewijzigd t.o.v. commit ${BASELINE_HEAD}: ${uit.git.trackedModifiedPaths.join(", ")}. ` +
        "Dit is een integriteitsschending van de bevroren BEFORE-meting — de agentcode zelf is niet meer identiek aan de baseline.",
    );
    process.exit(1);
  }
  if (uit.git.unexpectedUntrackedPaths.length > 0) {
    console.error(
      `[FOUT] Onverwachte, niet-getrackte bestanden in de subject-worktree (niet orchestrator-eigen, niet benchmark-output): ` +
        `${uit.git.unexpectedUntrackedPaths.join(", ")}. Verwijder ze, of laat run-before-local.ts een schone worktree aanmaken.`,
    );
    process.exit(1);
  }
  if (!uit.localModel.reachable) {
    console.error(`[FOUT] Lokaal model niet bereikbaar: ${uit.localModel.detail}`);
    process.exit(1);
  }
  if (stubGeforceerd) {
    console.error("[FOUT] NS_AGENT_FORCE_STUB staat aan. De BEFORE-run moet het echte lokale model gebruiken, niet de stub.");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
