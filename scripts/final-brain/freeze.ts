import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V1 } from "@/domain/quality-model";
import { prisma } from "@/server/data/prisma";
import { evaluateAssignmentsCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Fase A: v1.0.4 bevriezen, en aantonen dát hij bevroren is.
 *
 * ## Waarom geen git-commit
 *
 * De geaccepteerde v1.0.4 is nooit gecommit: HEAD is v1.0.3 met het
 * benchmarkharnas, en de werkmap bevat v1.0.4 plus later werk. Een commit nu
 * zou dus niet "exact v1.0.4" zijn. Wat wél exact v1.0.4 is:
 *
 * - de 20 ruwe runs van de v1.0.4-meting (`docs/optimizer-benchmark/after`),
 *   gemaakt door de ongewijzigde v1.0.4-code op 17–18 september;
 * - `configs/optimizer-config-v1.0.4.json` en `configs/quality-model-v1.json`;
 * - de gegevensvingerafdruk (dienstenpakket, roosterstructuur, regelset).
 *
 * Dit script legt van al die bestanden de SHA-256 vast en toont aan dat de
 * huidige code met model v1 exact dezelfde getallen geeft als het
 * v1.0.4-rapport: elke kandidaat, robuust en slechtste regel, verschil 0.
 *
 *   npm run final-brain:freeze
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const sha = (pad: string) => createHash("sha256").update(readFileSync(path.join(WORTEL, pad))).digest("hex");

async function main() {
  const bestanden = [
    "configs/optimizer-config-v1.0.4.json",
    "configs/quality-model-v1.json",
    "docs/optimizer-benchmark/manifest-after.json",
    ...readdirSync(path.join(WORTEL, "docs", "optimizer-benchmark", "after"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => `docs/optimizer-benchmark/after/${f}`),
  ];
  const manifest = JSON.parse(readFileSync(path.join(WORTEL, "docs", "optimizer-benchmark", "manifest-after.json"), "utf8"));

  // Herberekening met model v1 tegen de tabel van het v1.0.4-rapport.
  const context = await loadEvaluationContextCore("DDR");
  const tabel = JSON.parse(readFileSync(path.join(WORTEL, "docs", "optimizer-benchmark", "tables", "candidates.json"), "utf8")) as {
    phase: string;
    run: number;
    candidate: number;
    robust: number;
    worstLine: number;
  }[];
  let vergeleken = 0;
  let grootsteVerschil = 0;
  for (const run of readRuns("after")) {
    for (const k of run.candidates) {
      const rij = tabel.find((r) => r.phase === "after" && r.run === run.runNumber && r.candidate === k.number);
      if (!rij) continue;
      const rapport = evaluateAssignmentsCore(decodeAssignments(k.roster), context, QUALITY_MODEL_V1);
      grootsteVerschil = Math.max(grootsteVerschil, Math.abs((rapport.robust ?? 0) - rij.robust), Math.abs((rapport.lines.worst?.score ?? 0) - rij.worstLine));
      vergeleken += 1;
    }
  }

  let git: Record<string, unknown> = {};
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: WORTEL, encoding: "utf8" }).trim();
    const vuil = execFileSync("git", ["status", "--short"], { cwd: WORTEL, encoding: "utf8" }).split("\n").filter(Boolean).length;
    git = { head, uncommittedFiles: vuil, note: "v1.0.4 is nooit gecommit; HEAD is v1.0.3 plus benchmarkharnas." };
  } catch {
    git = { note: "git niet beschikbaar" };
  }

  const uit = {
    schema: "ns-final-brain-freeze/1",
    frozenAt: new Date().toISOString(),
    version: "1.0.4",
    engine: "adaptive-1.0.4",
    qualityModel: QUALITY_MODEL_V1.version,
    data: {
      manifestHash: "a0aafaa35dd0ca3f124c5a99410026444047889b7b9450a82996268384e4b0c8",
      location: manifest.data?.location,
      dutyPackage: manifest.data?.dutyPackage,
      rosterStructureVersion: manifest.data?.rosterStructureVersion,
      inputDataVersion: manifest.data?.inputDataVersion,
      ruleset: manifest.ruleset,
    },
    git,
    files: Object.fromEntries(bestanden.map((b) => [b, sha(b)])),
    reproduction: {
      what: "Elke v1.0.4-kandidaat opnieuw beoordeeld met model v1 in de huidige code, tegen docs/optimizer-benchmark/tables/candidates.json",
      candidatesCompared: vergeleken,
      maxAbsoluteDifference: grootsteVerschil,
      identical: grootsteVerschil === 0,
    },
  };
  writeFileSync(path.join(WORTEL, "docs", "v1.0.4-final-brain", "freeze.json"), `${JSON.stringify(uit, null, 2)}\n`);
  console.log(`${bestanden.length} bestanden vastgelegd; ${vergeleken} kandidaten herberekend, grootste verschil ${grootsteVerschil}.`);
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
