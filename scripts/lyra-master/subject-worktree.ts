import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Zuivere, geïsoleerd-testbare hulpfuncties voor `run-before-local.ts`.
 *
 * Losgetrokken uit dat bestand zodat een test dit bestand kan importeren
 * zonder de hele orchestrator (git-worktree aanmaken, Ollama bereiken, enz.)
 * per ongeluk mee te starten — `run-before-local.ts` roept aan het einde
 * onvoorwaardelijk `main()` aan, dit bestand niet.
 */

/**
 * Parseert `git worktree list --porcelain` naar de kale paden.
 *
 * Git schrijft in dit formaat altijd een regel `worktree <pad>` per worktree
 * (met voorwaartse schuine strepen, ook op Windows) — dit leest uitsluitend
 * die regels, zonder verdere aannames over de rest van het formaat.
 */
export function worktreePadenUitPorcelain(porcelain: string): string[] {
  const PREFIX = "worktree ";
  return porcelain
    .split("\n")
    .filter((regel) => regel.startsWith(PREFIX))
    .map((regel) => regel.slice(PREFIX.length).trim());
}

/**
 * Normaliseert een (mogelijk Windows-)pad voor betrouwbare vergelijking.
 *
 * De eerdere bug: `git worktree list --porcelain` geeft paden met `/`, terwijl
 * `path.resolve(...)` op Windows `\` gebruikt — een kale string-`includes`
 * tussen die twee vond dan nooit een match, ook niet als de worktree al
 * daadwerkelijk bestond. Op Windows is het bestandssysteem bovendien niet
 * hoofdlettergevoelig, dus wordt ook lowercased.
 *
 * `platform` is een expliciete parameter (default `process.platform`) zodat
 * dit ook op een niet-Windows CI-machine getest kan worden.
 */
export function genormaliseerdWorktreePad(ruwPad: string, platform: NodeJS.Platform = process.platform): string {
  const metVoorwaartseSlash = ruwPad.replace(/\\/g, "/");
  return platform === "win32" ? metVoorwaartseSlash.toLowerCase() : metVoorwaartseSlash;
}

/**
 * Controleert of een worktree op `pad` al geregistreerd staat bij `cwd`,
 * ongeacht schuine-strepen-stijl of hoofdlettergebruik.
 */
export function isWorktreeGeregistreerd(porcelain: string, pad: string, platform: NodeJS.Platform = process.platform): boolean {
  const doel = genormaliseerdWorktreePad(pad, platform);
  return worktreePadenUitPorcelain(porcelain).some((p) => genormaliseerdWorktreePad(p, platform) === doel);
}

/**
 * Bestandsmarkers die betrouwbaar aantonen dat de gegenereerde Prisma-client
 * (`prisma/schema.prisma`'s `output = "../src/lib/generated/prisma"`) echt
 * aanwezig is — deze map staat in `.gitignore` (`/src/lib/generated`), dus
 * een verse `git worktree` bevat hem nooit vanzelf.
 */
export const PRISMA_CLIENT_MARKERS = [
  path.join("src", "lib", "generated", "prisma", "client.ts"),
  path.join("src", "lib", "generated", "prisma", "enums.ts"),
] as const;

/** Of alle verwachte gegenereerde-Prisma-clientbestanden onder `root` bestaan. */
export function prismaClientAanwezig(root: string): boolean {
  return PRISMA_CLIENT_MARKERS.every((rel) => existsSync(path.join(root, rel)));
}

// ── Werkmap-schoonheid van de subject-worktree ("LOCAL BEFORE BUG #4") ──────
//
// De orchestrator (`run-before-local.ts`) moet zelf een paar bestanden in de
// subject-worktree neerzetten om de bevroren appcode van commit 588c1e5 te
// kunnen aanroepen (`before-manifest.ts`, dit bestand zelf, en een tijdelijke
// `smoke-import.ts`) — geen van die drie bestaat op 588c1e5 zelf, dus
// `git status --porcelain` ziet ze terecht als niet-getrackt. Een naïeve
// "porcelain moet helemaal leeg zijn"-check maakt de worktree daarmee zelf
// dirty en weigert vervolgens zijn eigen orchestratie-artefacten — dat is de
// bug. De echte garantie die telt is niet "porcelain is leeg", maar:
// HEAD == 588c1e5 EN de GETRACKTE inhoud van die commit is ongewijzigd.
//
// Dit bestand zelf hoort daarom ook op de whitelist: het wordt (samen met
// before-manifest.ts) als untracked helper in de subject-worktree gekopieerd
// zodat before-manifest.ts het kan importeren.
export const ORCHESTRATOR_OWNED_PATHS = [
  "scripts/lyra-master/subject-worktree.ts",
  "scripts/lyra-master/before-manifest.ts",
  "scripts/lyra-master/smoke-import.ts",
] as const;

/**
 * Padvoorvoegsels waaronder de orchestrator zelf legitieme meetuitvoer
 * schrijft (manifest/aggregate/BEFORE-VERIFICATION, en de rauwe
 * golden-bench/golden-grade/golden-fabricatie-uitvoer per replicaat). Nieuwe
 * bestanden hieronder — ook van een eerdere run in eenzelfde hergebruikte
 * worktree — zijn verwachte outputs, geen integriteitsschending.
 */
export const BENCHMARK_OUTPUT_PATH_PREFIXES = ["docs/lyra-knowledge/benchmarks/", "docs/v1.0.6/benchmarks/"] as const;

function padValtOnderPrefix(pad: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pad === prefix.replace(/\/$/, "") || pad.startsWith(prefix));
}

export type PorcelainRegelSoort = "tracked-modified" | "orchestrator-artifact" | "benchmark-output" | "onverwacht-untracked";

/**
 * Classificeert één regel uit `git status --porcelain` (zonder `--ignored`,
 * dus gitignored bestanden — `node_modules`, `.env`, `src/lib/generated` —
 * komen hier al niet in voor; git laat die standaard weg).
 *
 * Een regel begint met een 2-tekens statuscode. `??` betekent niet-getrackt;
 * elke andere code (` M`, `M `, `A `, `D `, `R `, …) betekent dat het pad WEL
 * in de index/HEAD zit en gewijzigd/toegevoegd/verwijderd is — dat is per
 * definitie een afwijking van de bevroren getrackte baseline-inhoud, ongeacht
 * welk pad het is.
 */
export function classificeerPorcelainRegel(regel: string): { pad: string; soort: PorcelainRegelSoort } | null {
  if (regel.length < 4) return null;
  const statuscode = regel.slice(0, 2);
  const pad = regel.slice(3).trim();
  if (!pad) return null;
  if (statuscode !== "??") return { pad, soort: "tracked-modified" };
  if ((ORCHESTRATOR_OWNED_PATHS as readonly string[]).includes(pad)) return { pad, soort: "orchestrator-artifact" };
  if (padValtOnderPrefix(pad, BENCHMARK_OUTPUT_PATH_PREFIXES)) return { pad, soort: "benchmark-output" };
  return { pad, soort: "onverwacht-untracked" };
}

export interface WerkmapSchoonheid {
  readonly trackedModifiedPaths: readonly string[];
  readonly orchestratorArtifacts: readonly string[];
  readonly benchmarkOutputPaths: readonly string[];
  readonly unexpectedUntrackedPaths: readonly string[];
}

/**
 * Beoordeelt een volledige `git status --porcelain`-uitvoer in de vier
 * categorieën die er echt toe doen voor de bevroren-BEFORE-garantie:
 * getrackte-baseline-wijziging (altijd een integriteitsschending),
 * orchestrator-eigen helperbestanden (getolereerd), eerdere/huidige
 * benchmark-uitvoer (getolereerd), en al het overige niet-getrackte
 * (onverwacht — blokkeert).
 */
/** Of `headCommit` (volledig of afgekort) de gevraagde bevroren baseline-commit is. */
export function headMatchtBaseline(headCommit: string, baselineCommit: string): boolean {
  return headCommit.startsWith(baselineCommit);
}

export function beoordeelWerkmapSchoonheid(porcelain: string): WerkmapSchoonheid {
  const trackedModifiedPaths: string[] = [];
  const orchestratorArtifacts: string[] = [];
  const benchmarkOutputPaths: string[] = [];
  const unexpectedUntrackedPaths: string[] = [];
  for (const regel of porcelain.split("\n")) {
    const c = classificeerPorcelainRegel(regel);
    if (!c) continue;
    if (c.soort === "tracked-modified") trackedModifiedPaths.push(c.pad);
    else if (c.soort === "orchestrator-artifact") orchestratorArtifacts.push(c.pad);
    else if (c.soort === "benchmark-output") benchmarkOutputPaths.push(c.pad);
    else unexpectedUntrackedPaths.push(c.pad);
  }
  return { trackedModifiedPaths, orchestratorArtifacts, benchmarkOutputPaths, unexpectedUntrackedPaths };
}
