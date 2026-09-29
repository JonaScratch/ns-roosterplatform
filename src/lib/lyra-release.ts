import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * De canonieke Lyra-versiedienst: welke Lyra draait het NS Roosterplatform nu,
 * en hoe wordt dat veranderd zonder half-toestanden.
 *
 * ## Eén schrijver, twee lezers
 *
 * De Demo Room is de enige schrijver (`commitRelease`, na menselijke
 * goedkeuring). Het platform leest (`getActiveLyraVersion`), bij elke
 * aanvraag opnieuw, zodat publiceren en terugdraaien geen herstart vraagt.
 *
 * ## Waarom dit transactioneel is
 *
 * Voorheen schreef activatie twee bestanden na elkaar: eerst de prompttekst,
 * dan de wijzer. Een crash ertussen liet het platform met de tekst van versie
 * B draaien terwijl alles "versie A" zei. Nu:
 *
 *   1. de prompttekst wordt inhoud-geadresseerd weggeschreven
 *      (`prompts/<sha256>.txt`), naast alle eerdere — niets wordt overschreven;
 *   2. de wijzer (`current.json`, met id, hash en generatie) wordt atomisch
 *      vervangen (tmp + rename). Dát is het enige commitmoment;
 *   3. pas daarna het legacybestand `current-prompt.txt` (voor een
 *      `NS_PRODUCTION_PROMPT_FILE` die er nog naar wijst) en het
 *      append-only activatielogboek.
 *
 * Een crash vóór stap 2: de oude versie blijft volledig actief. Na stap 2: de
 * nieuwe is volledig actief. Een lezer die een wijzer ziet waarvan de hash
 * niet klopt met de tekst, gebruikt GEEN van beide en valt terug op de kale
 * standaardinstructie (`integrity: "MISMATCH"`) — liever geen toevoeging dan
 * een ongeverifieerde.
 *
 * Gelijktijdige activaties: `expectedGeneration` (optimistische vergrendeling).
 * Twee mensen die tegelijk op "activeren" drukken, krijgen niet allebei gelijk.
 */

export const RELEASE_SCHEMA = "ns-lyra-release/1";
export const BASELINE_LYRA_VERSION_ID = "lyra-prod-baseline";

export interface ReleaseApproval {
  readonly id: string;
  readonly role: string;
}

export interface ReleasePointer {
  readonly schema?: typeof RELEASE_SCHEMA;
  readonly activeVersionId: string;
  readonly promptSha256?: string;
  readonly generation?: number;
  readonly activatedAt?: string;
  readonly approvedBy?: ReleaseApproval | null;
  readonly reason?: string;
  readonly previousVersionId?: string | null;
  readonly kind?: ReleaseKind;
}

export type ReleaseKind = "ACTIVATE" | "ROLLBACK" | "AUTO_ROLLBACK";

export type ReleaseIntegrity = "OK" | "LEGACY" | "NO_RELEASE" | "MISMATCH";

export interface ActiveLyraVersion {
  readonly versionId: string;
  /** De toevoeging aan de systeeminstructie; `null` = kale standaardinstructie. */
  readonly promptText: string | null;
  readonly promptSha256: string | null;
  readonly generation: number;
  readonly activatedAt: string | null;
  readonly approvedBy: ReleaseApproval | null;
  readonly integrity: ReleaseIntegrity;
  readonly detail: string | null;
}

export interface LyraVersionRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly status: string;
  readonly promptOverrideText: string | null;
  readonly reasonForPromotion?: string;
  readonly [key: string]: unknown;
}

export const sha256 = (tekst: string): string => createHash("sha256").update(tekst, "utf8").digest("hex");

/**
 * Waar de releases staan: `NS_LYRA_RELEASE_DIR`, of anders de map van
 * `NS_PRODUCTION_PROMPT_FILE` (die wees altijd al naar
 * `lyra-versions/current-prompt.txt`). Geen van beide: geen release.
 */
export function releaseDir(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const expliciet = env.NS_LYRA_RELEASE_DIR?.trim();
  if (expliciet) return expliciet;
  const bestand = env.NS_PRODUCTION_PROMPT_FILE?.trim();
  return bestand ? path.dirname(bestand) : null;
}

const pointerPad = (dir: string) => path.join(dir, "current.json");
const promptPad = (dir: string, hash: string) => path.join(dir, "prompts", `${hash}.txt`);
export const LEGACY_PROMPT_FILE = "current-prompt.txt";

function leesPointer(dir: string): ReleasePointer | null {
  const p = pointerPad(dir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ReleasePointer;
  } catch {
    return null;
  }
}

function baseline(integrity: ReleaseIntegrity, detail: string | null, generation = 0): ActiveLyraVersion {
  return { versionId: BASELINE_LYRA_VERSION_ID, promptText: null, promptSha256: null, generation, activatedAt: null, approvedBy: null, integrity, detail };
}

export function getActiveLyraVersion(dir: string | null = releaseDir()): ActiveLyraVersion {
  if (!dir) return baseline("NO_RELEASE", null);
  const pointer = leesPointer(dir);
  if (!pointer) {
    // Oude opstelling: alleen een promptbestand, geen wijzer.
    const legacy = path.join(dir, LEGACY_PROMPT_FILE);
    const tekst = existsSync(legacy) ? readFileSync(legacy, "utf8").trim() : "";
    return tekst ? { ...baseline("LEGACY", "geen releasewijzer; alleen het promptbestand gelezen"), versionId: "onbekend", promptText: tekst, promptSha256: sha256(tekst) } : baseline("NO_RELEASE", null);
  }
  const algemeen = {
    versionId: pointer.activeVersionId,
    generation: pointer.generation ?? 0,
    activatedAt: pointer.activatedAt ?? null,
    approvedBy: pointer.approvedBy ?? null,
  };
  if (!pointer.promptSha256) {
    // Wijzer uit de tijd vóór deze dienst: het promptbestand ernaast is de tekst.
    const legacy = path.join(dir, LEGACY_PROMPT_FILE);
    const tekst = existsSync(legacy) ? readFileSync(legacy, "utf8").trim() : "";
    return { ...algemeen, promptText: tekst || null, promptSha256: tekst ? sha256(tekst) : null, integrity: "LEGACY", detail: "wijzer zonder hash (van vóór de releasedienst)" };
  }
  const p = promptPad(dir, pointer.promptSha256);
  const tekst = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (tekst === null || sha256(tekst) !== pointer.promptSha256) {
    return { ...baseline("MISMATCH", `versie ${pointer.activeVersionId}: prompttekst ontbreekt of wijkt af van de hash in de wijzer — standaardinstructie gebruikt`, algemeen.generation), versionId: pointer.activeVersionId };
  }
  const schoon = tekst.trim();
  return { ...algemeen, promptText: schoon.length > 0 ? schoon : null, promptSha256: pointer.promptSha256, integrity: "OK", detail: null };
}

export function getLyraVersion(versionId: string, dir: string | null = releaseDir()): LyraVersionRecord | null {
  if (!dir || !/^[A-Za-z0-9._-]+$/.test(versionId)) return null;
  const p = path.join(dir, `${versionId}.json`);
  if (!existsSync(p)) {
    return versionId === BASELINE_LYRA_VERSION_ID ? { id: BASELINE_LYRA_VERSION_ID, createdAt: "2026-01-01T00:00:00.000Z", status: "ACTIVE", promptOverrideText: null } : null;
  }
  return JSON.parse(readFileSync(p, "utf8")) as LyraVersionRecord;
}

export class ReleaseConflict extends Error {}
export class ApprovalRequired extends Error {}

export interface CommitReleaseInput {
  readonly versionId: string;
  readonly promptText: string | null;
  readonly approvedBy: ReleaseApproval;
  readonly reason: string;
  readonly kind: ReleaseKind;
  /** De generatie die de aanroeper zag; wijkt die af, dan heeft iemand anders intussen geactiveerd. */
  readonly expectedGeneration?: number;
  readonly now?: string;
}

function atomisch(bestand: string, inhoud: string): void {
  mkdirSync(path.dirname(bestand), { recursive: true });
  const tmp = `${bestand}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, inhoud, "utf8");
  renameSync(tmp, bestand);
}

export function currentGeneration(dir: string): number {
  return leesPointer(dir)?.generation ?? 0;
}

/** Het enige schrijfpad. Vereist een benoemde mens en een reden. */
export function commitRelease(dir: string, input: CommitReleaseInput, hooks: { naPromptVoorWijzer?: () => void } = {}): ReleasePointer {
  if (!input.approvedBy?.id?.trim() || !input.approvedBy?.role?.trim()) throw new ApprovalRequired("activatie vereist een benoemde mens (id en rol) — nooit automatisch");
  if (!input.reason?.trim()) throw new ApprovalRequired("activatie vereist een reden");
  const vorige = leesPointer(dir);
  const generatie = vorige?.generation ?? 0;
  if (input.expectedGeneration !== undefined && input.expectedGeneration !== generatie) {
    throw new ReleaseConflict(`iemand anders activeerde intussen (generatie ${generatie}, verwacht ${input.expectedGeneration}) — herlaad en beslis opnieuw`);
  }
  const tekst = input.promptText ?? "";
  const hash = sha256(tekst);
  const pp = promptPad(dir, hash);
  if (!existsSync(pp)) atomisch(pp, tekst);
  hooks.naPromptVoorWijzer?.();

  const pointer: ReleasePointer = {
    schema: RELEASE_SCHEMA,
    activeVersionId: input.versionId,
    promptSha256: hash,
    generation: generatie + 1,
    activatedAt: input.now ?? new Date().toISOString(),
    approvedBy: input.approvedBy,
    reason: input.reason,
    previousVersionId: vorige?.activeVersionId ?? null,
    kind: input.kind,
  };
  atomisch(pointerPad(dir), `${JSON.stringify(pointer, null, 2)}\n`); // ← commitmoment
  atomisch(path.join(dir, LEGACY_PROMPT_FILE), tekst);
  appendFileSync(path.join(dir, "activations.jsonl"), `${JSON.stringify(pointer)}\n`, "utf8");
  return pointer;
}

export function releaseHistory(dir: string | null = releaseDir()): readonly ReleasePointer[] {
  if (!dir) return [];
  const p = path.join(dir, "activations.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r) as ReleasePointer);
}
