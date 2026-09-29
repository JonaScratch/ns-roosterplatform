import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterStatus } from "./after-status";

/**
 * De echte, lokale LYRA MASTER PROGRAM AFTER-run-orchestrator (Fase 9 + 11 + 12).
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/run-after-local.ts [--replicates 3] [--skip-adversarial] [--preflight-only]
 *
 * `run-after-local.ps1`/`.cmd` zijn dunne wrappers, zelfde reden en vorm als
 * `run-before-local.ps1`/`.cmd`.
 *
 * ## Waarom dit GEEN kopie is van run-before-local.ts se worktree-machinerie
 *
 * De BEFORE-run moet de bevroren codebaseline (commit 588c1e5) meten, dus
 * daar was een apart, gedetacheerd `git worktree` nodig — de gebruiker se
 * eigen branch mag nooit gecheckout worden. De AFTER-run meet precies het
 * TEGENOVERGESTELDE: de HUIDIGE code, op de HUIDIGE branch van de gebruiker.
 * Er is dus geen worktree, geen node_modules-junction, geen gegenereerde-
 * Prisma-client-in-een-aparte-map-stap nodig — dit script draait rechtstreeks
 * in CONTROL (de normale werkmap van de gebruiker), met diens eigen, al
 * werkende `node_modules`/`.env`/Prisma-client.
 *
 * Wat WEL hetzelfde blijft, uit dezelfde bevroren-meting-discipline:
 * - nooit `git checkout`/`git reset`/`git stash` op CONTROL;
 * - de HEAD-commit en of de werkmap getrackt-schoon is, wordt vastgelegd in
 *   het manifest — een AFTER-meting op een vuile werkmap (ongecommitte
 *   getrackte wijzigingen) is geen betrouwbaar "AFTER"-bewijs, dus dat blokkeert;
 * - elke replicaat-meting krijgt een eigen, nooit-overschreven pad;
 * - dezelfde replicate-aggregatie or (`aggregate-replicates.ts`, gewoon
 *   `--phase after` in plaats van `--phase before` — dat bestand was al
 *   phase-neutraal geschreven).
 *
 * ## Fase 9 (golden-suite-extensie, categorieën L/O) zit HIERIN, niet apart
 *
 * `golden-suite-extension.ts` + `golden-bench-extension.ts` +
 * `golden-grade-extension.ts` draaiden bij de BEFORE-run al als "EXTENSION /
 * NON-FROZEN" stap (post-baseline code, dus toen bewust NOOIT onderdeel van
 * de officiële bevroren BEFORE-vergelijking). Voor de AFTER-run bestaat die
 * spanning niet meer — het IS de huidige code — maar categorieën L/O blijven
 * wel apart gerapporteerd van de kern-43-item-vergelijking, want de BEFORE-
 * meting heeft ze nooit gemeten (geen eerlijke voor/na-delta mogelijk, wel
 * een eerste AFTER-only-nulmeting voor toekomstig gebruik).
 *
 * ## Fase 12 (adversarial holdout) zit HIERIN, als aparte stap ná de kernmeting
 *
 * `adversarial-bench.ts` (nieuw, mirror van golden-bench.ts) + het al
 * bestaande `adversarial-grade.ts` — tegen de 9 items uit
 * `adversarial-holdout-design.json`. Schrijft naar zijn eigen
 * `docs/lyra-knowledge/benchmarks/adversarial/<meting>/`, niet vermengd met
 * de kern-golden-suite-uitvoer. Met `--skip-adversarial` over te slaan (bv.
 * om eerst alleen Fase 11 te verifiëren).
 */

function argument(naam: string): string | null {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
function flag(naam: string): boolean {
  return process.argv.includes(`--${naam}`);
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

class PreflightError extends Error {}
function mislukt(bericht: string): never {
  throw new PreflightError(bericht);
}

function stap(tekst: string): void {
  console.log(`\n=== ${tekst} ===`);
}

function voerUit(cwd: string, commando: string, args: readonly string[], context: string): void {
  console.log(`  $ ${commando} ${args.join(" ")}  (in ${cwd})`);
  const r = spawnSync(commando, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) mislukt(`${context} faalde (exit ${r.status ?? "onbekend"}).`);
}

function voerUitAllowFail(cwd: string, commando: string, args: readonly string[], context: string): boolean {
  console.log(`  $ ${commando} ${args.join(" ")}  (in ${cwd})`);
  const r = spawnSync(commando, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`  [WAARSCHUWING] ${context} faalde (exit ${r.status ?? "onbekend"}) — zie hierboven.`);
    return false;
  }
  return true;
}

function sha256Van(pad: string): string {
  return createHash("sha256").update(readFileSync(pad)).digest("hex");
}

function tijdstempel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const CONTROL_ROOT = path.resolve(__dirname, "..", "..");
const REPLICATES = Number(argument("replicates") ?? "3");
const PREFLIGHT_ONLY = flag("preflight-only");
const SKIP_ADVERSARIAL = flag("skip-adversarial");
/** De bevroren BEFORE-run waartegen elke AFTER-run item voor item wordt vergeleken (grader /1 én streng /2). */
const BEFORE_RUN_ID = (() => {
  const i = process.argv.indexOf("--before");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "20260927-205217";
})();
const NS_TSX_ARGS = ["tsx", "--conditions=react-server"];

function rapporteerControlIdentiteit(): { head: string; branch: string; dirty: number } {
  stap("Control-identiteit (wordt uitsluitend gelezen, nooit gewijzigd)");
  const head = git(CONTROL_ROOT, ["rev-parse", "HEAD"]);
  const branch = git(CONTROL_ROOT, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = git(CONTROL_ROOT, ["status", "--porcelain"]);
  const dirty = porcelain.split("\n").filter(Boolean).length;
  console.log(`  branch=${branch} head=${head.slice(0, 12)} niet-vastgelegde-paden=${dirty}`);
  console.log("  (dit script voert geen git checkout/reset/stash uit — nooit.)");
  return { head, branch, dirty };
}

/**
 * Een AFTER-meting op een werkmap met ongecommitte, GETRACKTE wijzigingen is
 * geen betrouwbaar bewijs (welke code werd er nu eigenlijk gemeten?). Nieuwe,
 * niet-getrackte benchmark-uitvoer van een eerdere run blokkeert niet — dat
 * is verwachte eigen output, geen vuile broncode. Alleen regels die NIET met
 * "??" beginnen (getrackt-en-gewijzigd) tellen als een echte blokkade.
 */
function controleerWerkmapSchoonGenoeg(): void {
  stap("Werkmap-schoonheid controleren (getrackte wijzigingen blokkeren, nieuwe benchmark-uitvoer niet)");
  const porcelain = git(CONTROL_ROOT, ["status", "--porcelain"]);
  const trackedGewijzigd = porcelain
    .split("\n")
    .filter(Boolean)
    .filter((regel) => !regel.startsWith("??"));
  if (trackedGewijzigd.length > 0) {
    mislukt(
      `Er staan ongecommitte, getrackte wijzigingen in de werkmap: ${trackedGewijzigd.map((r) => r.trim()).join(", ")}. ` +
        `Commit of stash deze eerst — de AFTER-meting moet een exacte, herleidbare commit meten.`,
    );
  }
  console.log("  Geen ongecommitte getrackte wijzigingen — de gemeten HEAD-commit is eenduidig.");
}

function controleerDatabase(): void {
  stap("Ontwikkeldatabase controleren");
  const r = spawnSync("npx", [...NS_TSX_ARGS, "scripts/dev-db.ts", "status"], { cwd: CONTROL_ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) mislukt("De ontwikkeldatabase draait niet. Start hem met: npm run db:up");
}

interface LocalModelEnv {
  readonly url: string;
  readonly model: string;
}

function leesLocalModelEnv(): LocalModelEnv {
  const envTekst = readFileSync(path.join(CONTROL_ROOT, ".env"), "utf8");
  const lees = (sleutel: string): string | null => {
    const regel = envTekst.split("\n").find((r) => r.trim().startsWith(`${sleutel}=`));
    if (!regel) return null;
    return regel.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  };
  const url = lees("NS_LOCAL_LLM_URL");
  const model = lees("NS_LOCAL_LLM_MODEL");
  if (!url || !model) mislukt("NS_LOCAL_LLM_URL en/of NS_LOCAL_LLM_MODEL ontbreken in .env.");
  return { url, model };
}

async function controleerOllama(env: LocalModelEnv): Promise<void> {
  stap("Ollama-bereikbaarheid en modelbeschikbaarheid controleren");
  const basis = env.url.replace(/\/v1\/?$/, "");
  let tags: { models?: { name?: string }[] };
  try {
    const res = await fetch(`${basis}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) mislukt(`Ollama antwoordde met HTTP ${res.status} op ${basis}/api/tags.`);
    tags = (await res.json()) as typeof tags;
  } catch (fout) {
    mislukt(`Ollama is niet bereikbaar op ${basis} (${fout instanceof Error ? fout.message : String(fout)}). Start Ollama (ollama serve) en probeer opnieuw.`);
  }
  const namen = (tags.models ?? []).map((m) => m.name ?? "");
  const gevonden = namen.some((n) => n === env.model || n.startsWith(`${env.model.split(":")[0]}:`));
  if (!gevonden) mislukt(`Model "${env.model}" staat niet in 'ollama list' (gevonden: ${namen.join(", ") || "niets"}). Haal het op met: ollama pull ${env.model}`);
  console.log(`  Ollama bereikbaar op ${basis}, model "${env.model}" gevonden.`);
}

function controleerStubUit(): void {
  stap("Stub-uitschakeling controleren");
  if (process.env.NS_AGENT_FORCE_STUB) {
    console.log(`  NS_AGENT_FORCE_STUB stond aan (${process.env.NS_AGENT_FORCE_STUB}) — uitgeschakeld voor dit proces.`);
    delete process.env.NS_AGENT_FORCE_STUB;
  }
  console.log("  NS_AGENT_FORCE_STUB is niet gezet — de echte lokale-modelroute wordt gebruikt, nooit de stub.");
}

function nieuweUitvoerDirectory(runId: string): string {
  let kandidaat = path.join(CONTROL_ROOT, "docs", "lyra-knowledge", "benchmarks", "after", runId);
  let teller = 1;
  while (existsSync(kandidaat)) {
    teller += 1;
    kandidaat = path.join(CONTROL_ROOT, "docs", "lyra-knowledge", "benchmarks", "after", `${runId}-${teller}`);
  }
  mkdirSync(kandidaat, { recursive: true });
  return kandidaat;
}

async function main(): Promise<void> {
  console.log("=== LYRA MASTER PROGRAM - lokale AFTER-run (Fase 9 + 11 + 12) ===");

  let exitCode = 0;
  try {
    const identiteit = rapporteerControlIdentiteit();
    controleerWerkmapSchoonGenoeg();
    controleerDatabase();
    const modelEnv = leesLocalModelEnv();
    await controleerOllama(modelEnv);
    controleerStubUit();

    const runId = tijdstempel();
    const outDir = nieuweUitvoerDirectory(runId);

    console.log("\nPRECHECK PASS");
    console.log(`HEAD (AFTER-subject): ${identiteit.head.slice(0, 12)} op branch ${identiteit.branch}`);
    console.log(`MODEL: ${modelEnv.model}`);
    console.log("STUB: OFF");
    console.log(`REPLICATES: ${REPLICATES}`);

    if (PREFLIGHT_ONLY) {
      console.log(`\n(--preflight-only: geen enkel benchmarkitem uitgevoerd. Uitvoerdirectory ${outDir} weer verwijderd.)`);
      return;
    }

    // ── Manifest (fase "after", zelfde bestand als de BEFORE-run — al phase-neutraal) ──
    stap(`Na-manifest genereren (run ${runId})`);
    voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/lyra-master/before-manifest.ts", "--run", runId, "--phase", "after"], "Manifest-generatie (after)");

    // ── Fase 11: replicaten van de kern-43-item-suite, tegen de huidige code ──
    let alleReplicatenOk = true;
    for (let r = 1; r <= REPLICATES; r += 1) {
      const meting = `after-${runId}-r${r}`;
      stap(`Replicaat ${r}/${REPLICATES} (kern golden suite) — meting '${meting}'`);
      try {
        voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-bench.ts", "--meting", meting], `golden-bench.ts (${meting})`);
        voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-grade.ts", "--meting", meting], `golden-grade.ts (${meting})`);
        voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-fabricatie.ts", "--meting", meting], `golden-fabricatie.ts (${meting})`);
      } catch (fout) {
        alleReplicatenOk = false;
        console.error(`  [FOUT] replicaat ${meting}: ${fout instanceof Error ? fout.message : String(fout)}`);
      }
    }

    stap("Replicaten aggregeren (Fase 11)");
    let aggregatieOk = true;
    try {
      voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/lyra-master/aggregate-replicates.ts", "--run", runId, "--replicates", String(REPLICATES), "--phase", "after"], "aggregate-replicates.ts");
    } catch {
      aggregatieOk = false;
    }

    // ── Fase 9: golden-suite-extensie (categorieën L, O) — apart gerapporteerd; BEFORE-tegenhanger is NON-FROZEN ──
    stap("Golden-suite-extensie (categorieën L, O) — Fase 9, voor het eerst daadwerkelijk uitgevoerd");
    let extensieOk = true;
    try {
      voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-suite-extension.ts"], "golden-suite-extension.ts");
      for (let r = 1; r <= REPLICATES; r += 1) {
        const meting = `after-${runId}-r${r}`;
        voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-bench-extension.ts", "--meting", meting], `golden-bench-extension.ts (${meting})`);
        voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-grade-extension.ts", "--meting", meting], `golden-grade-extension.ts (${meting})`);
      }
    } catch (fout) {
      extensieOk = false;
      console.error(`  [WAARSCHUWING] golden-suite-extensie faalde: ${fout instanceof Error ? fout.message : String(fout)} — blokkeert Fase 11 niet.`);
    }

    // ── Fase 12: adversarial holdout ──────────────────────────────────────
    let adversarialOk: boolean | "SKIPPED" = "SKIPPED";
    const adversarialMeting = `adversarial-${runId}`;
    if (!SKIP_ADVERSARIAL) {
      stap("Adversarial holdout (Fase 12) — 9 items uit adversarial-holdout-design.json");
      adversarialOk = voerUitAllowFail(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/adversarial-bench.ts", "--meting", adversarialMeting], "adversarial-bench.ts");
      if (adversarialOk) {
        adversarialOk = voerUitAllowFail(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/adversarial-grade.ts", "--meting", adversarialMeting], "adversarial-grade.ts");
      }
    } else {
      console.log("\n(--skip-adversarial: Fase 12 overgeslagen.)");
    }

    // ── BEFORE→AFTER per item (golden + extensie), grader /1 en streng /2 ──
    stap(`BEFORE ${BEFORE_RUN_ID} → AFTER ${runId} vergelijken (compare-before-after.ts)`);
    const vergelijkingOk = {
      golden: voerUitAllowFail(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/lyra-master/compare-before-after.ts", "--before", BEFORE_RUN_ID, "--after", runId, "--replicates", String(REPLICATES)], "compare-before-after.ts (golden)"),
      extension: extensieOk
        ? voerUitAllowFail(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/lyra-master/compare-before-after.ts", "--before", BEFORE_RUN_ID, "--after", runId, "--replicates", String(REPLICATES), "--suite", "extension"], "compare-before-after.ts (extensie)")
        : false,
    };

    // ── Verificatiebestand ───────────────────────────────────────────────
    stap("AFTER-VERIFICATION.json schrijven");
    const manifestPad = path.join(outDir, "manifest.json");
    const manifest = existsSync(manifestPad) ? (JSON.parse(readFileSync(manifestPad, "utf8")) as Record<string, unknown>) : null;
    const localModel = (manifest?.localModel ?? {}) as Record<string, unknown>;

    const ruweBestanden: { pad: string; sha256: string }[] = [];
    for (let r = 1; r <= REPLICATES; r += 1) {
      const meting = `after-${runId}-r${r}`;
      for (const naam of ["golden.json", "golden-grade.json", "golden-extension.json", "golden-grade-extension.json"]) {
        const p = path.join(CONTROL_ROOT, "docs", "v1.0.6", "benchmarks", meting, naam);
        // Relatief aan de map van AFTER-VERIFICATION.json zelf (zoals BEFORE's
        // "raw/…"). Tot run 20260929-151948 stond hier een vaste
        // "../../v1.0.6/…", die alleen klopte vanaf docs/lyra-knowledge/benchmarks.
        if (existsSync(p)) ruweBestanden.push({ pad: path.relative(outDir, p).split(path.sep).join("/"), sha256: sha256Van(p) });
      }
    }

    const { status, redenen } = afterStatus({
      replicaten: REPLICATES,
      modelBereikbaar: localModel.reachable === true,
      stubUit: manifest?.stubExplicitlyDisabled === true,
      alleReplicatenOk,
      aggregatieOk,
      ruweBestandsnamen: ruweBestanden.map((b) => path.posix.basename(b.pad)),
      extensieGedraaid: extensieOk,
    });

    const verificatie = {
      schema: "ns-lyra-master-after-verification/1",
      runId,
      phase: "after",
      recordedAt: new Date().toISOString(),
      status,
      failReasons: redenen,
      subject: { headCommit: identiteit.head, branch: identiteit.branch, trackedClean: true },
      model: { name: localModel.model ?? null, reachable: localModel.reachable ?? null },
      stubExplicitlyDisabled: manifest?.stubExplicitlyDisabled ?? null,
      replicates: REPLICATES,
      allReplicatesCompleted: alleReplicatenOk,
      gradingCompleted: aggregatieOk,
      rawArtifacts: ruweBestanden,
      extension: {
        ranOk: extensieOk,
        note: "Golden-suite-extensie (categorieën L, O) — Fase 9. De BEFORE-run 20260927-205217 mat deze categorieën alleen als EXTENSION / NON-FROZEN (post-baseline code); vergelijken kan met scripts/lyra-master/compare-before-after.ts --suite extension, maar het is geen bevroren BEFORE-vergelijking.",
      },
      adversarial: {
        ranOk: adversarialOk,
        meting: SKIP_ADVERSARIAL ? null : adversarialMeting,
        path: SKIP_ADVERSARIAL ? null : `../adversarial/${adversarialMeting}/`,
        note:
          "Fase 12 — 9 items uit adversarial-holdout-design.json. Item Q draait sinds de AFTER-analyse van 20260929 met een echte, gesimuleerde toolfout (askAgent({ toolFouten }), zichtbaar als toolGesimuleerd in adversarial.json).",
      },
      comparison: {
        before: BEFORE_RUN_ID,
        golden: vergelijkingOk.golden ? `../../comparisons/before-${BEFORE_RUN_ID}__after-${runId}.json` : null,
        extension: vergelijkingOk.extension ? `../../comparisons/before-${BEFORE_RUN_ID}__after-${runId}.extension.json` : null,
        note: "Streng (/2) is leidend: een antwoord dat een grendel verving, telt niet als GOED. Zie docs/lyra-knowledge/after-analysis-20260929.md §2.",
      },
      paths: { manifest: "manifest.json", aggregate: "aggregate.json" },
    };
    writeFileSync(path.join(outDir, "AFTER-VERIFICATION.json"), `${JSON.stringify(verificatie, null, 2)}\n`);

    console.log(`\nStatus: ${status}`);
    console.log(`Uitvoer: ${outDir}`);
    if (status !== "PASS") {
      console.log(`Reden(en) voor FAIL:\n${redenen.map((r) => `  - ${r}`).join("\n")}\n(ook vastgelegd als failReasons in AFTER-VERIFICATION.json)`);
      exitCode = 1;
    } else {
      console.log("\nCommit en push de nieuwe map(pen) onder docs/lyra-knowledge/benchmarks/after/, docs/lyra-knowledge/benchmarks/adversarial/, docs/lyra-knowledge/benchmarks/comparisons/ en docs/v1.0.6/benchmarks/ terug naar deze branch — dat is het AFTER-bewijs.");
    }
  } catch (fout) {
    if (fout instanceof PreflightError) {
      console.error(`\n[PRECHECK FAIL] ${fout.message}`);
      exitCode = 1;
    } else {
      throw fout;
    }
  }
  process.exit(exitCode);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
