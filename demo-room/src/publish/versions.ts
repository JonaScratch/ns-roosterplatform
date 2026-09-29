import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import type { LyraVersion } from "../types";
import { commitRelease, currentGeneration, getActiveLyraVersion, releaseHistory, type ActiveLyraVersion, type ReleaseApproval, type ReleaseKind, type ReleasePointer } from "../../../src/lib/lyra-release";

/**
 * De versiegeschiedenis van "productie-Lyra" (§ aanvulling, "HANDMATIGE
 * ROLLBACK IN DE UI" / "lyra-prod-2026-09-26-01").
 *
 * ## Waarom bestanden, en geen Prisma-model
 *
 * Dit is omgevingsstatus van de Demo Room (welk prompt-bestand is nu live),
 * niet roosterdata — het hoort niet in het gedeelde schema van de hoofdapp
 * thuis (§2 van de opdracht: geen onafhankelijke kopieën van *roosterdata*;
 * dit is geen roosterdata). Bestanden onder `demo-room/data/` zijn al niet
 * ingecheckt (zie `.gitignore`); het verhaal — waarom een versie is
 * gepromoveerd — staat wél in git, via het journaal.
 *
 * ## De twee bestanden die er samen toe doen
 *
 * `lyra-versions/<id>.json` — de onveranderlijke inhoud van één versie.
 * Nooit overschreven na aanmaak (op het `status`-veld na).
 * `lyra-versions/current.json` — de wijzer: welke versie is nu live.
 * `lyra-versions/current-prompt.txt` — de daadwerkelijk gelezen bestandsinhoud
 * (waar `NS_PRODUCTION_PROMPT_FILE` naar wijst). Bij elke activatie
 * overschreven; dat overschrijven ís de publicatie.
 */

const VERSIONS_DIR = path.join(DATA_DIR, "lyra-versions");
const CURRENT_POINTER = path.join(VERSIONS_DIR, "current.json");
export const CURRENT_PROMPT_FILE = path.join(VERSIONS_DIR, "current-prompt.txt");

export const BASELINE_VERSION_ID = "lyra-prod-baseline";

function baselineVersion(): LyraVersion {
  return {
    id: BASELINE_VERSION_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE",
    sourceExperimentId: null,
    variantId: null,
    promptOverrideText: null,
    benchmarkReference: null,
    changedFiles: [],
    knownIssues: [],
    reasonForPromotion: "Uitgangspunt: de hardcoded productie-instructie, zonder enige gepubliceerde Demo Room-variant.",
  };
}

/** Puur — geen bestandssysteem — zodat de nummering zelf te testen is. */
export function nextVersionId(existingIds: readonly string[], now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const datum = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const prefix = `lyra-prod-${datum}-`;
  const volgnummers = existingIds
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const volgende = volgnummers.length > 0 ? Math.max(...volgnummers) + 1 : 1;
  return `${prefix}${pad(volgende)}`;
}

function ensureDir(): void {
  mkdirSync(VERSIONS_DIR, { recursive: true });
}

export function listVersions(): readonly LyraVersion[] {
  ensureDir();
  const bestanden = readdirSync(VERSIONS_DIR).filter((f) => f.endsWith(".json") && f !== "current.json" && !f.endsWith(".tmp"));
  const versies = bestanden.map((f) => JSON.parse(readFileSync(path.join(VERSIONS_DIR, f), "utf8")) as LyraVersion);
  if (versies.length === 0) return [baselineVersion()];
  return [...versies].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getVersion(id: string): LyraVersion | null {
  if (id === BASELINE_VERSION_ID) {
    const bestand = path.join(VERSIONS_DIR, `${id}.json`);
    if (!existsSync(bestand)) return baselineVersion();
  }
  const bestand = path.join(VERSIONS_DIR, `${id}.json`);
  if (!existsSync(bestand)) return null;
  return JSON.parse(readFileSync(bestand, "utf8")) as LyraVersion;
}

export function currentVersionId(): string {
  ensureDir();
  if (!existsSync(CURRENT_POINTER)) return BASELINE_VERSION_ID;
  return (JSON.parse(readFileSync(CURRENT_POINTER, "utf8")) as { activeVersionId: string }).activeVersionId;
}

function writeVersion(version: LyraVersion): void {
  ensureDir();
  writeFileSync(path.join(VERSIONS_DIR, `${version.id}.json`), `${JSON.stringify(version, null, 2)}\n`, "utf8");
}

/** Legt een nieuwe, nog niet actieve versie vast. `activateVersion()` maakt hem pas live. */
export function createVersion(input: Omit<LyraVersion, "id" | "createdAt" | "status">): LyraVersion {
  ensureDir();
  const bestaande = readdirSync(VERSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  const version: LyraVersion = { ...input, id: nextVersionId(bestaande, new Date()), createdAt: new Date().toISOString(), status: "SUPERSEDED" };
  writeVersion(version);
  return version;
}

/** Wie besluit tot activatie, en waarom. Zonder dit geen activatie. */
export interface Goedkeuring {
  readonly door: ReleaseApproval;
  readonly reden: string;
  readonly soort?: ReleaseKind;
  /** Optimistische vergrendeling: de releasegeneratie die de beslisser zag. */
  readonly verwachteGeneratie?: number;
}

/** Precies wat het platform ziet: dezelfde leesfunctie, dezelfde map. */
export function releaseInfo(): { readonly actief: ActiveLyraVersion; readonly geschiedenis: readonly ReleasePointer[] } {
  ensureDir();
  return { actief: getActiveLyraVersion(VERSIONS_DIR), geschiedenis: releaseHistory(VERSIONS_DIR) };
}

export function huidigeGeneratie(): number {
  ensureDir();
  return currentGeneration(VERSIONS_DIR);
}

/**
 * Maakt `versionId` live via de canonieke releasedienst
 * (`src/lib/lyra-release.ts`): prompttekst inhoud-geadresseerd, dan één
 * atomische wijzerwissel — nooit een half-toestand. Vereist een benoemde mens.
 * `safePublish.ts` roept dit pas aan ná alle controles. Versiestatussen
 * (ACTIVE/SUPERSEDED) worden ná het commitmoment bijgewerkt; ze zijn afgeleid,
 * de wijzer is de waarheid (`currentVersionId()` leest de wijzer).
 */
export function activateVersion(versionId: string, goedkeuring: Goedkeuring): void {
  ensureDir();
  const versie = getVersion(versionId);
  if (!versie) throw new Error(`Onbekende versie: ${versionId}`);

  const huidigeId = currentVersionId();
  commitRelease(VERSIONS_DIR, {
    versionId,
    promptText: versie.promptOverrideText,
    approvedBy: goedkeuring?.door,
    reason: goedkeuring?.reden,
    kind: goedkeuring?.soort ?? "ACTIVATE",
    expectedGeneration: goedkeuring?.verwachteGeneratie,
  });
  if (huidigeId !== versionId) {
    const huidige = getVersion(huidigeId);
    if (huidige && huidige.id !== BASELINE_VERSION_ID) writeVersion({ ...huidige, status: "SUPERSEDED" });
  }
  if (versie.id !== BASELINE_VERSION_ID) writeVersion({ ...versie, status: "ACTIVE" });
}

export function markVersionStatus(versionId: string, status: LyraVersion["status"]): void {
  const versie = getVersion(versionId);
  if (versie && versie.id !== BASELINE_VERSION_ID) writeVersion({ ...versie, status });
}
