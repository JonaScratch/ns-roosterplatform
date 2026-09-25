import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AGENT_CAPABILITIES, AGENT_LEVELS, currentGrant } from "@/server/agent/capabilities";
import { localConfigFromEnv, localModelAvailable } from "@/server/agent/model/local";
import { toolCatalogue } from "@/server/agent/tools";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * De uitgangssituatie van v1.0.6, machineleesbaar vastgelegd — vóór er één
 * regel functionele code voor deze ronde is geschreven.
 *
 * §1 van de opdracht vraagt minimaal: commit, databaseversie, dienstenpakket-
 * checksum, engineversie, kwaliteitsmodelversie, regelsetversie, lokale
 * modelnaam, Ollama/runtimeversie, modelinstellingen, temperatuur, hardware,
 * toolcatalogus, actuele capability grants, huidige chatimplementatie, huidige
 * UI, bestaande benchmarkset.
 *
 * Dit bestand hergebruikt niets van `v105/baseline-manifest.ts` door kopiëren:
 * de v1.0.5-baseline blijft het bewijs dat spoor A (de zoekmachine) niet is
 * aangeraakt, en dat mag met dit bestand niet verward worden. Dit bestand
 * voegt toe wat specifiek voor v1.0.6 nieuw is: de agentlaag zelf (toolcatalogus,
 * grants, chatimplementatie) — die v1.0.5-baseline ging daar juist níet over,
 * want de agent bestond toen nog niet.
 *
 *   npx tsx --conditions=react-server scripts/v106/n0-manifest.ts
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const DOEL = path.join(WORTEL, "docs", "v1.0.6", "n0-manifest.json");
const git = (args: string[]) => execFileSync("git", args, { cwd: WORTEL, encoding: "utf8" }).trim();

const actor = (rol: "ROSTER_COMMITTEE"): Actor =>
  ({
    sessionId: "n0-manifest",
    userId: "x",
    employeeId: "x",
    employeeNumber: "900001",
    roles: [rol],
    authLevel: "PASSWORD",
    depot: "DDR",
  }) as unknown as Actor;

async function main(): Promise<void> {
  const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);

  const pakket = await prisma.dutyPackage.findFirst({
    where: { depot: "DDR", status: "ACTIVE" },
    orderBy: { validFrom: "desc" },
    select: { id: true, label: true, sourceChecksum: true, duties: true },
  });

  const config = localConfigFromEnv();
  const beschikbaar = config ? await localModelAvailable(config) : { ok: false, detail: "geen lokaal model ingesteld" };

  let ollamaVersion = "onbekend";
  try {
    ollamaVersion = execFileSync("ollama", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    // Runtime niet op PATH beschikbaar vanuit dit proces; geen harde fout.
  }

  let gpu = "onbekend";
  try {
    gpu = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { encoding: "utf8" }).trim();
  } catch {
    // Geen NVIDIA-tooling beschikbaar; geen harde fout.
  }

  const grant = await currentGrant("DDR");
  const catalogus = toolCatalogue(actor("ROSTER_COMMITTEE"));

  const v105Baseline = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.5", "baseline-manifest.json"), "utf8")) as Record<string, unknown>;

  const uit = {
    schema: "ns-v106-n0-manifest/1",
    recordedAt: new Date().toISOString(),
    purpose:
      "De stand van het platform bij de start van v1.0.6, vastgelegd vóór functionele code voor deze ronde is " +
      "geschreven. §1 van de opdracht vraagt deze vastlegging expliciet; hij komt bovenop de v1.0.5-baseline en " +
      "vervangt haar niet.",
    git: {
      headCommit: git(["rev-parse", "HEAD"]),
      headSubject: git(["log", "-1", "--pretty=%s"]),
      headDate: git(["log", "-1", "--pretty=%cI"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      uncommittedPaths: dirty.length,
    },
    v105EindrapportOordeel: "gedeeltelijk voltooid — zie docs/v1.0.5/eindrapport.md",
    v105Baseline: { headCommit: (v105Baseline.git as Record<string, unknown>)?.headCommit ?? null, note: "ongewijzigd; zie docs/v1.0.5/baseline-manifest.json" },
    dutyPackage: pakket ? { id: pakket.id, label: pakket.label, sourceChecksum: pakket.sourceChecksum, duties: pakket.duties } : null,
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
    chatImplementation: {
      screen: "src/app/(app)/roostercommissie/agent/",
      files: ["page.tsx", "gesprek.tsx", "acties.ts"],
      note:
        "Vaste regelkiezer + weekkiezer boven het gesprek, permanent activiteitenpaneel en bevoegdhedenpaneel " +
        "rechts, geen streaming, geen pin/recent-onderscheid, één AI-werkruimte-chat naast de hoofdchat op " +
        "/roostercommissie/genereren. Dit is het uitgangspunt voor de UI-vereenvoudiging in §5, §12 t/m §18.",
    },
    existingBenchmarkAssets: {
      intelligenceTestset: "docs/v1.0.5/intelligence-testset.json (32 items, versie 2)",
      benchmarkMethodology: "docs/v1.0.5/benchmark-methodology.md",
      acceptanceCriteria: "docs/v1.0.5/acceptance-criteria.json",
      localAiBench: "scripts/v105/lokale-ai-bench.ts",
      acceptatie: "scripts/v105/acceptatie.ts",
      herbeoordeel: "scripts/v105/herbeoordeel.ts",
      note:
        "Deze golden set blijft in gebruik voor deterministische en gedragscontroles. Ze wordt hier niet " +
        "vervangen maar aangevuld: §3 vraagt een aparte, grotere 'golden conversation suite' gericht op " +
        "gespreksgedrag (multi-turn, foutieve aannames, machinistentaal), niet op geïsoleerde feiten.",
    },
    openIssuesFromV105Report: [
      "B7: foutieve gebruikersaanname wordt niet betrouwbaar weersproken (J3, holdout, nulfoutcriterium NIET_GEHAALD)",
      "B4: machinistentaal niet te bepalen — te weinig menselijk beoordeelde items",
      "statusafleiding zet soms 'niet vast te stellen' boven een overigens juist antwoord (één zin triggert de regel)",
      "model hangt soms een ongefundeerde gezagsclaim aan gegevens ('en zijn bevestigd')",
      "deel 3 en 4 van de praktijktest alleen tegen de database gemeten, niet door het scherm doorlopen",
      "geen bewijs dat geheugen tot betere roosterbeslissingen leidt",
      "niveau B/C werkten aanvankelijk niet met een echt taalmodel: inmiddels hersteld, maar de kwetsbaarheid dat elke test de stub afdwingt blijft een structureel risico voor v1.0.6.",
    ],
  };

  mkdirSync(path.dirname(DOEL), { recursive: true });
  writeFileSync(DOEL, `${JSON.stringify(uit, null, 2)}\n`);
  console.log(`Geschreven: ${DOEL}`);
  console.log(`  HEAD ${uit.git.headCommit.slice(0, 8)} (${uit.git.headSubject}) · ${uit.git.uncommittedPaths} niet-vastgelegde paden`);
  console.log(`  lokaal model: ${uit.localModel.model} · bereikbaar: ${uit.localModel.reachable} · ${uit.localModel.detail}`);
  console.log(`  ollama ${ollamaVersion} · ${gpu}`);
  console.log(`  toolcatalogus: ${catalogus.length} tools`);
  process.exit(0);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
