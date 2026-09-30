import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getActiveLyraVersion, releaseDir } from "@/lib/lyra-release";
import { currentGrant, levelOf } from "@/server/agent/capabilities";
import { localConfigFromEnv } from "@/server/agent/model/local";
import { sha256 } from "@/server/agent/trace";

/**
 * Vingerafdruk van de meetomgeving: commit en werkboom, de hash van elk
 * agentbestand zoals het op schijf stond, de actieve Lyra-versie met recente
 * activaties, het model met zijn digest volgens Ollama, en de
 * agentbevoegdheid. Gebruikt door elke meting (scripts/v106/meting-trace.ts)
 * en door elke lange run (per segment in het checkpoint).
 */

const WORTEL = path.resolve(__dirname, "..", "..", "..");

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: WORTEL, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function bestandenOnder(map: string): string[] {
  if (!existsSync(map)) return [];
  return readdirSync(map).flatMap((naam) => {
    const p = path.join(map, naam);
    return statSync(p).isDirectory() ? bestandenOnder(p) : /\.(ts|tsx)$/.test(naam) ? [p] : [];
  });
}

async function modelIdentiteit(): Promise<Record<string, unknown>> {
  const config = localConfigFromEnv();
  if (!config) return { lokaal: false };
  const basis = config.baseUrl.replace(/\/v1$/, "");
  const haal = async (pad: string, init?: RequestInit) => {
    try {
      const res = await fetch(`${basis}${pad}`, { ...init, signal: AbortSignal.timeout(4000) });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : { status: res.status };
    } catch (fout) {
      return { fout: fout instanceof Error ? fout.message : String(fout) };
    }
  };
  const versie = await haal("/api/version");
  const toon = await haal("/api/show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: config.model }) });
  const details = (toon.details ?? null) as Record<string, unknown> | null;
  return {
    lokaal: true,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    systeemToevoeging: Boolean(config.systemPromptOverride),
    ollamaVersie: versie.version ?? versie,
    modelDigest: (toon.digest as string | undefined) ?? null,
    modelDetails: details,
    modelfileSha256: typeof toon.modelfile === "string" ? sha256(toon.modelfile) : null,
    parameters: typeof toon.parameters === "string" ? toon.parameters : null,
  };
}

function releaseOmgeving(): Record<string, unknown> {
  const actief = getActiveLyraVersion();
  const dir = releaseDir();
  const activatiesPad = dir ? path.join(dir, "activations.jsonl") : null;
  const activaties =
    activatiesPad && existsSync(activatiesPad)
      ? readFileSync(activatiesPad, "utf8")
          .split("\n")
          .filter(Boolean)
          .slice(-20)
          .map((r) => {
            try {
              const j = JSON.parse(r) as Record<string, unknown>;
              return { versionId: j.activeVersionId, generation: j.generation, activatedAt: j.activatedAt, promptSha256: j.promptSha256 ?? null };
            } catch {
              return { onleesbaar: true };
            }
          })
      : [];
  return {
    releaseDirIngesteld: Boolean(dir),
    versionId: actief.versionId ?? null,
    generation: actief.generation ?? null,
    activatedAt: actief.activatedAt ?? null,
    integrity: actief.integrity,
    promptSha256: actief.promptSha256 ?? null,
    promptLengte: actief.promptText?.length ?? 0,
    recenteActivaties: activaties,
  };
}

export async function meetOmgeving(locationCode = "DDR"): Promise<Record<string, unknown>> {
  const agentBestanden = [...bestandenOnder(path.join(WORTEL, "src", "server", "agent")), path.join(WORTEL, "src", "lib", "lyra-release.ts")];
  const grant = await currentGrant(locationCode).catch(() => null);
  const status = git("status", "--porcelain");
  return {
    schema: "ns-meting-omgeving/1",
    gemeten: new Date().toISOString(),
    commit: git("rev-parse", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    werkboomSchoon: status === "",
    gewijzigdInWerkboom: status ? status.split("\n").filter((r) => /src\/|scripts\//.test(r)).slice(0, 50) : [],
    // Precies wat de meting importeert: tsx leest de bron van schijf, er is
    // geen build of server tussen. Deze hashes tonen welke inhoud dat was.
    agentCode: Object.fromEntries(agentBestanden.filter(existsSync).map((f) => [path.relative(WORTEL, f).split(path.sep).join("/"), sha256(readFileSync(f, "utf8"))])),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    release: releaseOmgeving(),
    model: await modelIdentiteit(),
    agentBevoegdheid: grant ? { niveau: levelOf(grant), bevoegdheden: [...grant.capabilities], geschorst: grant.suspendedAt !== null } : null,
  };
}

