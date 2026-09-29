import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, REPO_ROOT } from "../config";
import { detecteerLekkage, holdoutHash, HOLDOUT_BESTANDEN, judgeCriteriaHash, controleerIsolatie, type CandidateManifest } from "./manifest";
import { oordeel, type JudgeEvidence, type JudgeOordeel } from "./judge";
import { leegArchief, voegToeAanArchief, type ParetoArchief } from "./paretoArchive";
import type { CandidatePoint } from "../types";

/**
 * Opslag van de Candidate Factory: per kandidaat een map met zijn manifest
 * (onveranderlijk: eenmaal geschreven wordt het nooit overschreven) en het
 * oordeel van de rechter; daarnaast één Pareto-archief van alle KEEP's.
 *
 * `sandboxRoot` in het manifest wijst naar de kandidaatmap: alles wat een
 * generator voor die kandidaat wegschrijft, hoort daar en nergens anders.
 */

const DIR = () => path.join(DATA_DIR, "factory");
const kandidaatDir = (id: string) => path.join(DIR(), "candidates", id.replace(/[^A-Za-z0-9._-]/g, "_"));
const ARCHIEF = () => path.join(DIR(), "pareto-archive.json");

function atomisch(bestand: string, inhoud: string): void {
  mkdirSync(path.dirname(bestand), { recursive: true });
  const tmp = `${bestand}.${process.pid}.tmp`;
  writeFileSync(tmp, inhoud, "utf8");
  renameSync(tmp, bestand);
}

export function sandboxVoor(candidateId: string): string {
  const d = kandidaatDir(candidateId);
  mkdirSync(d, { recursive: true });
  return d;
}

export class ManifestBestaatAl extends Error {}

export function bewaarManifest(m: CandidateManifest): void {
  const bestand = path.join(kandidaatDir(m.candidateId), "manifest.json");
  if (existsSync(bestand)) throw new ManifestBestaatAl(`manifest voor ${m.candidateId} bestaat al en wordt niet overschreven`);
  atomisch(bestand, `${JSON.stringify(m, null, 2)}\n`);
}

export function leesManifest(candidateId: string): CandidateManifest | null {
  const bestand = path.join(kandidaatDir(candidateId), "manifest.json");
  return existsSync(bestand) ? (JSON.parse(readFileSync(bestand, "utf8")) as CandidateManifest) : null;
}

export interface OpgeslagenOordeel extends JudgeOordeel {
  readonly candidateId: string;
  readonly beoordeeldOp: string;
  readonly bewijs: JudgeEvidence;
}

/** De teksten van de locked holdout, alleen voor lekdetectie door de rechter — nooit voor generatoren. */
export function holdoutTeksten(wortel = REPO_ROOT): readonly string[] {
  const uit: string[] = [];
  for (const rel of HOLDOUT_BESTANDEN) {
    const p = path.join(wortel, rel);
    if (!existsSync(p)) continue;
    const d = JSON.parse(readFileSync(p, "utf8")) as { items?: { turns?: { text?: string }[] }[] };
    for (const item of d.items ?? []) for (const t of item.turns ?? []) if (t.text) uit.push(t.text);
  }
  return uit;
}

/**
 * Het volledige rechtersoordeel: isolatie herberekenen tegen de huidige
 * criteria/holdout, lekken zoeken, dan beslissen — en het oordeel naast het
 * manifest bewaren.
 */
export function beoordeelEnBewaar(candidateId: string, productionText: string | null, bewijs: JudgeEvidence, now: string): OpgeslagenOordeel {
  const manifest = leesManifest(candidateId);
  if (!manifest) throw new Error(`geen manifest voor ${candidateId}: een kandidaat zonder herkomst wordt niet beoordeeld`);
  const isolatie = controleerIsolatie(manifest, { judgeCriteriaHash: judgeCriteriaHash(), holdoutHash: holdoutHash(), productionText });
  const lekken = detecteerLekkage(productionText, holdoutTeksten());
  const o: OpgeslagenOordeel = { ...oordeel(manifest, isolatie, lekken, bewijs), candidateId, beoordeeldOp: now, bewijs };
  atomisch(path.join(kandidaatDir(candidateId), "judge.json"), `${JSON.stringify(o, null, 2)}\n`);
  return o;
}

export function leesOordeel(candidateId: string): OpgeslagenOordeel | null {
  const bestand = path.join(kandidaatDir(candidateId), "judge.json");
  return existsSync(bestand) ? (JSON.parse(readFileSync(bestand, "utf8")) as OpgeslagenOordeel) : null;
}

export function lijstKandidaten(): readonly { manifest: CandidateManifest; oordeel: OpgeslagenOordeel | null }[] {
  const d = path.join(DIR(), "candidates");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .map((id) => ({ id, manifest: leesManifest(id) }))
    .filter((x): x is { id: string; manifest: CandidateManifest } => x.manifest !== null)
    .map((x) => ({ manifest: x.manifest, oordeel: leesOordeel(x.id) }))
    .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

export function leesArchief(richting: Readonly<Record<string, boolean | null>>): ParetoArchief {
  return existsSync(ARCHIEF()) ? (JSON.parse(readFileSync(ARCHIEF(), "utf8")) as ParetoArchief) : leegArchief(richting);
}

/** Alleen KEEP's komen in het archief. */
export function archiveerKeep(punt: CandidatePoint, o: JudgeOordeel, richting: Readonly<Record<string, boolean | null>>, now: string): ParetoArchief | null {
  if (o.verdict !== "KEEP") return null;
  const a = voegToeAanArchief(leesArchief(richting), punt, now);
  atomisch(ARCHIEF(), `${JSON.stringify(a, null, 2)}\n`);
  return a;
}
