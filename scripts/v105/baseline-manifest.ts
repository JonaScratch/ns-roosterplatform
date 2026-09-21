import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

const fs_mkdir = (dir: string) => mkdirSync(dir, { recursive: true });
import path from "node:path";
import { QUALITY_MODEL_V1, QUALITY_MODEL_V2, QUALITY_MODEL_V3, CURRENT_QUALITY_MODEL } from "@/domain/quality-model";
import { OPERATIONAL_REQUIREMENTS_V1 } from "@/domain/operational-requirements";
import { ADAPTIVE_CONFIG } from "@/server/generation/adaptive/config";
import { describeVariant, engineVariant } from "@/server/generation/adaptive/variant";

/**
 * De uitgangssituatie van v1.0.5, machineleesbaar vastgelegd.
 *
 * ## Waarom dit bestand bestaat
 *
 * Alles van v1.0.4 en de machinistenronde stond tot 20-09-2026 niet in Git
 * (laatste commit: het benchmarkharnas van v1.0.3) en is toen vastgelegd als
 * achteraf-stand op de tak stand/v1.0.4-machinist. Die commit is dus níet de
 * code zoals die tijdens de metingen was. Dit manifest legt vast wat er staat: vingerafdrukken per map en per kritiek
 * bestand, de engineprofielen, de kwaliteitsmodellen, de benchmarkfasen en de
 * bevroren codekopieën. Wie later wil weten of de code sindsdien is veranderd,
 * draait dit opnieuw en vergelijkt.
 *
 *   npx tsx --conditions=react-server scripts/v105/baseline-manifest.ts
 */

const WORTEL = path.resolve(__dirname, "..", "..");
/**
 * Waar het manifest heen gaat.
 *
 * Standaard de baseline van v1.0.5. Met --uit <pad> schrijft het script ergens
 * anders heen: een meting krijgt haar eigen manifest en overschrijft de
 * vastgelegde uitgangssituatie niet. Dat was geen theoretische regel — bij M1
 * overschreef dit script eerst de baseline van M0.
 */
const uitArgument = (() => {
  const i = process.argv.indexOf("--uit");
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
})();
const DOEL = uitArgument ? path.resolve(WORTEL, uitArgument) : path.join(WORTEL, "docs", "v1.0.5", "baseline-manifest.json");

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Alle bestanden onder een map, gesorteerd, met hun hash; plus één hash over het geheel. */
function mapVingerafdruk(map: string, filter = /\.(ts|tsx|py|prisma|json|mjs)$/): { files: number; bytes: number; hash: string } {
  const bestanden: string[] = [];
  const loop = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const naam of readdirSync(dir).sort()) {
      // Gegenereerde code (Prisma-client) telt niet mee: die wordt bij elke bouw
      // opnieuw geschreven en zou de vingerafdruk onbruikbaar maken.
      if (naam === "node_modules" || naam === "__pycache__" || naam === ".next" || naam === "generated") continue;
      const pad = path.join(dir, naam);
      const s = statSync(pad);
      if (s.isDirectory()) loop(pad);
      else if (filter.test(naam)) bestanden.push(pad);
    }
  };
  loop(path.join(WORTEL, map));
  const h = createHash("sha256");
  let bytes = 0;
  for (const b of bestanden) {
    const inhoud = readFileSync(b);
    bytes += inhoud.length;
    h.update(path.relative(WORTEL, b).replace(/\\/g, "/")).update(inhoud);
  }
  return { files: bestanden.length, bytes, hash: h.digest("hex").slice(0, 16) };
}

const bestandHash = (rel: string) => (existsSync(path.join(WORTEL, rel)) ? sha(readFileSync(path.join(WORTEL, rel))).slice(0, 16) : null);

const git = (args: string[]) => execFileSync("git", args, { cwd: WORTEL, encoding: "utf8" }).trim();

/** Per benchmarkfase: hoeveel runs, welke engine en welke variant erin zitten. */
function fasen(): Record<string, unknown> {
  const wortel = path.join(WORTEL, "docs", "optimizer-benchmark");
  const uit: Record<string, unknown> = {};
  for (const naam of readdirSync(wortel).sort()) {
    const map = path.join(wortel, naam);
    if (!statSync(map).isDirectory()) continue;
    const runs = readdirSync(map).filter((f) => /^run-\d+\.json$/.test(f));
    if (runs.length === 0) continue;
    const eerste = JSON.parse(readFileSync(path.join(map, runs[0]), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const strategieën = new Map<string, number>();
    for (const f of runs) {
      const j = JSON.parse(readFileSync(path.join(map, f), "utf8")) as { strategy: string };
      strategieën.set(j.strategy, (strategieën.get(j.strategy) ?? 0) + 1);
    }
    uit[naam] = {
      runs: runs.length,
      strategies: Object.fromEntries(strategieën),
      engine: eerste.engine,
      mode: eerste.mode,
      manifestHash: eerste.manifestHash,
      variant: eerste.variant ?? null,
      firstRunAt: eerste.startedAt,
    };
  }
  return uit;
}

function main() {
  const manifest = JSON.parse(readFileSync(path.join(WORTEL, "docs", "optimizer-benchmark", "manifest.json"), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  const uit = {
    schema: "ns-v105-baseline-manifest/1",
    recordedAt: new Date().toISOString(),
    purpose:
      "De stand van het platform bij de start van v1.0.5, met vingerafdrukken die controleerbaar maken of er sindsdien iets aan de code is veranderd.",
    git: {
      headCommit: git(["rev-parse", "HEAD"]),
      headSubject: git(["log", "-1", "--pretty=%s"]),
      headDate: git(["log", "-1", "--pretty=%cI"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      tags: git(["tag"]).split("\n").filter(Boolean),
      uncommittedPaths: dirty.length,
      warning:
        "De code van v1.0.4, de menselijke ijking, de Final-Brain-ronde en de machinistenronde stond tot 20-09-2026 niet in Git. Op die datum is de werkmap vastgelegd als commit op de tak stand/v1.0.4-machinist, uitdrukkelijk als achteraf vastgelegde stand: het is niet de code zoals die tijdens de metingen was. De meetbasis (dienstpakket, regels, machine) is wel aantoonbaar ongewijzigd ten opzichte van het BEFORE-manifest.",
      snapshotCommit: "cf8a0e3 op stand/v1.0.4-machinist (20-09-2026)",
    },
    packageVersion: JSON.parse(readFileSync(path.join(WORTEL, "package.json"), "utf8")).version,
    code: {
      src: mapVingerafdruk("src"),
      scripts: mapVingerafdruk("scripts"),
      python: mapVingerafdruk("python"),
      configs: mapVingerafdruk("configs"),
      prisma: mapVingerafdruk("prisma"),
      tests: mapVingerafdruk("tests"),
      criticalFiles: Object.fromEntries(
        [
          "python/cpsat_roster.py",
          "src/server/optimizer/cpsat-optimizer.ts",
          "src/server/optimizer/objective-weights.ts",
          "src/server/generation/adaptive/config.ts",
          "src/server/generation/adaptive/engine.ts",
          "src/server/generation/adaptive/variant.ts",
          "src/domain/quality-model.ts",
          "src/domain/quality-evaluator.ts",
          "src/domain/operational-requirements.ts",
          "src/domain/machinist-preference.ts",
          "src/domain/profile-affinity.ts",
          "src/domain/night-rhythm.ts",
          "src/server/rules-engine/final-validator.ts",
          "prisma/schema.prisma",
        ].map((f) => [f, bestandHash(f)]),
      ),
    },
    engine: {
      configVersion: ADAPTIVE_CONFIG.version,
      defaultVariant: describeVariant(engineVariant({})),
      profiles: ["machinist (standaard)", "rhythm (Final-Brain-stand, model v2)", "frozen-1.0.4 (exact v1.0.4)"],
      configPrints: {
        "configs/optimizer-config-v1.0.4-machinist.json": bestandHash("configs/optimizer-config-v1.0.4-machinist.json"),
        "configs/optimizer-config-v1.0.4-rhythm.json": bestandHash("configs/optimizer-config-v1.0.4-rhythm.json"),
        "configs/optimizer-config-v1.0.4.json": bestandHash("configs/optimizer-config-v1.0.4.json"),
      },
    },
    qualityModels: {
      current: CURRENT_QUALITY_MODEL.version,
      versions: Object.fromEntries(
        [QUALITY_MODEL_V1, QUALITY_MODEL_V2, QUALITY_MODEL_V3].map((m) => [m.version, sha(JSON.stringify(m)).slice(0, 16)]),
      ),
      prints: Object.fromEntries(["v1", "v2", "v3"].map((v) => [`configs/quality-model-${v}.json`, bestandHash(`configs/quality-model-${v}.json`)])),
      note: "v3 bevat de voorkeurslaag en de operationele eisen; de zoekmachine rangschikt op v2 (beslisregel M1 stond v3 niet toe).",
    },
    operationalRequirements: OPERATIONAL_REQUIREMENTS_V1,
    data: { ...manifest.data, hashes: manifest.hashes, ruleset: manifest.ruleset, machine: manifest.machine },
    benchmarkPhases: fasen(),
    frozenCopies: [
      { path: "C:/Users/Jonathan Schram/ClaudeCode/ns-roosterplatform-ablatie", purpose: "Final-Brain-ablaties", fingerprint: "551aca67512aac1f" },
      { path: "C:/Users/Jonathan Schram/ClaudeCode/ns-roosterplatform-mp", purpose: "machinisten-A/B M1 en M2", fingerprint: "3b0bc8e6d3f22ac7" },
      { path: "C:/Users/Jonathan Schram/ClaudeCode/ns-roosterplatform-mp2", purpose: "machinisten-AFTER en verkennende run", fingerprint: "1d9d5f1febd6093d" },
    ],
    acceptedResults: {
      finalBrain: "docs/v1.0.4-final-brain/gates.json — 12 van 16 poorten; geen reviewpakketten (§26 van die werkopdracht).",
      machinist: "docs/v1.0.4-final-brain/machinist-preferences/gates.json — 18 van 19 poorten; eerlijkheid −0,55 tegen marge 0,5; geen reviewpakketten.",
      report: "docs/NS-Roosterplatform-v1.0.4-Final-Brain-Report.pdf (deel I Final Brain, deel II machinistenvoorkeur).",
    },
  };
  fs_mkdir(path.dirname(DOEL));
  writeFileSync(DOEL, `${JSON.stringify(uit, null, 2)}\n`);
  console.log(`Geschreven: ${DOEL}`);
  console.log(`  HEAD ${uit.git.headCommit.slice(0, 8)} (${uit.git.headSubject}) · ${uit.git.uncommittedPaths} niet-vastgelegde paden`);
  console.log(`  src ${uit.code.src.files} bestanden ${uit.code.src.hash} · python ${uit.code.python.hash} · configs ${uit.code.configs.hash}`);
  console.log(`  benchmarkfasen: ${Object.keys(uit.benchmarkPhases).length}`);
}

main();
