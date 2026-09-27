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
