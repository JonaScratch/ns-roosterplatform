import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getActiveLyraVersion, releaseDir } from "@/lib/lyra-release";
import { currentGrant, levelOf } from "@/server/agent/capabilities";
import { localConfigFromEnv } from "@/server/agent/model/local";
import { type AgentTrace, metTrace, nieuweTrace, ontdubbelSysteem, sha256 } from "@/server/agent/trace";

/**
 * Tracing voor elke meting (kern, extensie, adversarial, r2, diagnose).
 *
 * Twee delen, allebei naast het meetbestand in `traces.json`:
 *  - `omgeving`: wat er op déze machine draaide — commit en werkboomstatus,
 *    de hash van elk agentbestand zoals het op schijf stond, de actieve
 *    Lyra-versie (met hash van de systeemtoevoeging) en de recente activaties,
 *    het model met zijn digest volgens Ollama, en de agentbevoegdheid;
 *  - `traces`: per beurt de volledige keten (src/server/agent/trace.ts).
 *
 * Aanleiding: bij adversarial M (20260930) was achteraf niet vast te stellen of
 * twee metingen met dezelfde code ook dezelfde systeeminstructie gebruikten —
 * de actieve Lyra-versie staat alleen op de meetmachine.
 */

const WORTEL = path.resolve(__dirname, "..", "..");

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

/** Verzamelt de traces van één meting. */
export class MetingTraces {
  private readonly lijst: AgentTrace[] = [];
  constructor(private readonly meting: string) {}

  /** Eén agentbeurt met trace; de trace gaat mee in het meetbestand `traces.json`. */
  async beurt<T>(labels: Record<string, unknown>, werk: () => Promise<T>): Promise<T> {
    const trace = nieuweTrace({ meting: this.meting, ...labels });
    this.lijst.push(trace);
    return metTrace(trace, werk);
  }

  get traces(): readonly AgentTrace[] {
    return this.lijst;
  }

  /** Schrijft `traces.json` (nooit overschrijven: bewijsmateriaal). */
  schrijf(map: string, omgeving: Record<string, unknown>, bestand = "traces.json"): string {
    const uit = path.join(map, bestand);
    const { traces, systeem } = ontdubbelSysteem(this.lijst);
    writeFileSync(uit, `${JSON.stringify({ schema: "ns-meting-traces/1", meting: this.meting, omgeving, systeeminstructies: systeem, traces }, null, 1)}\n`, { flag: "wx" });
    return uit;
  }
}
