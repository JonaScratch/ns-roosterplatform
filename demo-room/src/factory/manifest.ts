import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config";
import { JUDGE_CRITERIA } from "./judge";

/**
 * Agentic Candidate Factory — manifest en isolatie (Phase K).
 *
 * Elke kandidaat krijgt bij het ontstaan een manifest: wie hem maakte, uit
 * welke zwakte, welke tekst precies (als hash), en — de kern — de hash van de
 * beoordelingscriteria en van de locked holdout OP DAT MOMENT. De rechter
 * (judge.ts) herberekent die hashes vóór zijn oordeel. Is er iets veranderd,
 * dan is de kandidaat tijdens zijn eigen beoordeling aan de meetlat of de
 * holdout gekomen, en is het oordeel REJECT, ongeacht de scores.
 *
 * Daarnaast: lekdetectie. Een kandidaattekst die letterlijke stukken van
 * holdoutvragen bevat, heeft op de toets geleerd in plaats van op het begrip
 * ("Do not memorize exact benchmark prompts").
 */

export interface CandidateManifest {
  readonly schema: "ns-lyra-candidate-manifest/1";
  readonly candidateId: string;
  readonly parentVersionId: string;
  readonly generator: { readonly name: string; readonly version: string };
  readonly hypothesis: string;
  readonly changeKind: "PROMPT" | "TOOL_ROUTING" | "CONTEXT_POLICY" | "ENGINE";
  readonly productionTextSha256: string | null;
  readonly createdAt: string;
  readonly inputs: { readonly weaknessDimension: string | null; readonly devOnly: true };
  readonly isolation: {
    readonly sandboxRoot: string;
    readonly judgeCriteriaHash: string;
    readonly holdoutHash: string;
  };
}

export const sha256 = (tekst: string): string => createHash("sha256").update(tekst).digest("hex");

/** De bestanden die samen de locked holdout vormen. Hun inhoud wordt gehasht, niet gelezen door generatoren. */
export const HOLDOUT_BESTANDEN = ["docs/lyra-knowledge/benchmarks/adversarial-holdout-design.json"] as const;

export function holdoutHash(wortel = REPO_ROOT): string {
  return sha256(
    HOLDOUT_BESTANDEN.map((rel) => {
      const p = path.join(wortel, rel);
      return `${rel}\n${existsSync(p) ? readFileSync(p, "utf8") : "<ontbreekt>"}`;
    }).join("\n---\n"),
  );
}

export function judgeCriteriaHash(criteria: object = JUDGE_CRITERIA): string {
  return sha256(JSON.stringify(criteria));
}

export function maakManifest(invoer: {
  candidateId: string;
  parentVersionId: string;
  generator: { name: string; version: string };
  hypothesis: string;
  changeKind: CandidateManifest["changeKind"];
  productionText: string | null;
  weaknessDimension: string | null;
  sandboxRoot: string;
  now: string;
}): CandidateManifest {
  return {
    schema: "ns-lyra-candidate-manifest/1",
    candidateId: invoer.candidateId,
    parentVersionId: invoer.parentVersionId,
    generator: invoer.generator,
    hypothesis: invoer.hypothesis,
    changeKind: invoer.changeKind,
    productionTextSha256: invoer.productionText === null ? null : sha256(invoer.productionText),
    createdAt: invoer.now,
    inputs: { weaknessDimension: invoer.weaknessDimension, devOnly: true },
    isolation: { sandboxRoot: invoer.sandboxRoot, judgeCriteriaHash: judgeCriteriaHash(), holdoutHash: holdoutHash() },
  };
}

export interface IsolatieControle {
  readonly intact: boolean;
  readonly bevindingen: readonly string[];
}

/** Zijn de meetlat en de holdout nog precies zoals bij het ontstaan van de kandidaat? En is de tekst niet gewijzigd? */
export function controleerIsolatie(
  manifest: CandidateManifest,
  huidig: { judgeCriteriaHash: string; holdoutHash: string; productionText: string | null },
): IsolatieControle {
  const bevindingen: string[] = [];
  if (manifest.isolation.judgeCriteriaHash !== huidig.judgeCriteriaHash) bevindingen.push("de beoordelingscriteria zijn gewijzigd sinds de kandidaat ontstond");
  if (manifest.isolation.holdoutHash !== huidig.holdoutHash) bevindingen.push("de locked holdout is gewijzigd sinds de kandidaat ontstond");
  const tekstHash = huidig.productionText === null ? null : sha256(huidig.productionText);
  if (tekstHash !== manifest.productionTextSha256) bevindingen.push("de kandidaattekst wijkt af van wat in het manifest staat");
  return { intact: bevindingen.length === 0, bevindingen };
}

/**
 * Lekdetectie: een reeks van `n` opeenvolgende woorden die letterlijk in een
 * holdoutvraag voorkomt. Acht woorden is lang genoeg om toevallige
 * overeenkomst ("de langste reeks nachtdiensten") uit te sluiten en kort
 * genoeg om een overgeschreven vraag te vangen.
 */
export function detecteerLekkage(kandidaatTekst: string | null, holdoutTeksten: readonly string[], n = 8): readonly string[] {
  if (!kandidaatTekst) return [];
  const woorden = (t: string) => t.toLowerCase().replace(/[^a-z0-9áéíóúëïöü\s-]/g, " ").split(/\s+/).filter(Boolean);
  const kandidaat = ` ${woorden(kandidaatTekst).join(" ")} `;
  const lekken: string[] = [];
  for (const h of holdoutTeksten) {
    const w = woorden(h);
    for (let i = 0; i + n <= w.length; i += 1) {
      const stuk = w.slice(i, i + n).join(" ");
      if (kandidaat.includes(` ${stuk} `)) {
        lekken.push(stuk);
        break;
      }
    }
  }
  return lekken;
}
