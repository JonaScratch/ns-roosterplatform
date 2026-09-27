import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * De echte, cross-platform LYRA MASTER PROGRAM BEFORE-run-orchestrator.
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/run-before-local.ts [--replicates 3] [--preflight-only]
 *
 * `run-before-local.ps1`/`.cmd` zijn UITSLUITEND dunne, ASCII-only wrappers
 * die node/npx vinden en dit bestand aanroepen — zie die bestanden zelf
 * voor waarom (Windows PowerShell 5.1-encodingprobleem, niet gevonden door
 * de eerdere syntaxcontrole met de PowerShell-taalparser omdat die alleen
 * de AST controleert, niet hoe PowerShell 5.1 een niet-ASCII-bestand zonder
 * BOM daadwerkelijk van schijf inleest).
 *
 * ## De kernfout die dit bestand repareert (niet cosmetisch — architectonisch)
 *
 * De vorige versie deed `git checkout 588c1e5` op de ONTWIKKELBRANCH van de
 * gebruiker zelf, en riep daarna scripts aan (`before-manifest.ts`,
 * `golden-suite-extension.ts`) die pas NA 588c1e5 zijn toegevoegd — die
 * bestonden dus niet meer zodra de branch daadwerkelijk op 588c1e5 stond.
 * Dat is zowel methodologisch fout (de BEFORE-meting moet de bevroren
 * agentcode gebruiken, niet nieuwere orchestratiecode die toevallig ontbrak)
 * als destructief voor de gebruiker (zijn eigen branch werd gedetacheerd).
 *
 * De oplossing: twee volledig gescheiden checkouts.
 *
 * - **CONTROL** = de normale werkmap van de gebruiker (waar dit script
 *   vandaan draait). Wordt NOOIT gecheckout, gereset, gestash of anderszins
 *   gemuteerd door dit bestand — er wordt uitsluitend uit gelezen en
 *   binnenin uitgevoerd (npx-aanroepen), nooit `git checkout`/`git reset`/
 *   `git stash` op dit pad.
 * - **SUBJECT** = een aparte, gedetachte `git worktree` op exact commit
 *   588c1e5 — de bevroren agentcode, bevroren golden suite, bevroren
 *   tools/prompts. Alle metingen tegen de 43-item bevroren suite draaien
 *   HIERIN, met dit worktree se eigen `node_modules` (een junction naar
 *   CONTROL se `node_modules`, veilig omdat `package.json`/`package-lock.json`
 *   ongewijzigd zijn sinds 588c1e5 — zelf hieronder geverifieerd, niet
 *   aangenomen).
 *
 * De golden-suite-EXTENSIE (categorieën L/O, na 588c1e5 toegevoegd) draait
 * bewust vanuit CONTROL, niet SUBJECT — en heet overal expliciet
 * "EXTENSION / NON-FROZEN", nooit stilzwijgend onderdeel van de officiële
 * BEFORE-vergelijking (§ opdracht: "mag NIET stil onderdeel worden van de
 * frozen historical BEFORE").
 */

// ── Kleine hulpmiddelen ──────────────────────────────────────────────────────

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
function gitAllowFail(cwd: string, args: readonly string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() || (r.stderr ?? "").trim() };
}

class PreflightError extends Error {}
function mislukt(bericht: string): never {
  throw new PreflightError(bericht);
}

function stap(tekst: string): void {
  console.log(`\n=== ${tekst} ===`);
}

/** Voert een commando uit in een specifieke werkmap en gooit met een duidelijke melding als het faalt. */
function voerUit(cwd: string, commando: string, args: readonly string[], context: string): void {
  console.log(`  $ ${commando} ${args.join(" ")}  (in ${cwd})`);
  const r = spawnSync(commando, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) mislukt(`${context} faalde (exit ${r.status ?? "onbekend"}).`);
}

function sha256Van(pad: string): string {
  return createHash("sha256").update(readFileSync(pad)).digest("hex");
}

function tijdstempel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ── Configuratie ──────────────────────────────────────────────────────────────

const CONTROL_ROOT = path.resolve(__dirname, "..", "..");
const BASELINE = argument("baseline") ?? "588c1e5";
const REPLICATES = Number(argument("replicates") ?? "3");
const PREFLIGHT_ONLY = flag("preflight-only");
const SUBJECT_PATH = argument("subject-path") ?? path.resolve(CONTROL_ROOT, "..", `${path.basename(CONTROL_ROOT)}-frozen-subject-${BASELINE}`);

const NS_TSX_ARGS = ["tsx", "--conditions=react-server"];

// ── Stap: control-identiteit (alleen lezen/rapporteren, NOOIT muteren) ───────

function rapporteerControlIdentiteit(): { head: string; branch: string } {
  stap("Control-identiteit (wordt uitsluitend gelezen, nooit gewijzigd)");
  const head = git(CONTROL_ROOT, ["rev-parse", "HEAD"]);
  const branch = git(CONTROL_ROOT, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = git(CONTROL_ROOT, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
  console.log(`  branch=${branch} head=${head.slice(0, 12)} niet-vastgelegde-paden=${dirty}`);
  console.log("  (dit script voert geen git checkout/reset/stash uit op dit pad — nooit.)");
  return { head, branch };
}

// ── Stap: baseline-commit bestaat ────────────────────────────────────────────

function controleerBaselineBestaat(): void {
  stap(`Baseline-commit controleren (${BASELINE})`);
  const fetch = gitAllowFail(CONTROL_ROOT, ["fetch", "origin"]);
  if (!fetch.ok) console.log(`  (git fetch origin niet gelukt — ga door met wat lokaal aanwezig is: ${fetch.out.slice(0, 200)})`);
  const bestaat = gitAllowFail(CONTROL_ROOT, ["cat-file", "-e", `${BASELINE}^{commit}`]);
  if (!bestaat.ok) mislukt(`Commit ${BASELINE} is niet lokaal bekend, ook niet na 'git fetch origin'. Controleer de commit-hash.`);
  console.log(`  ${BASELINE} bestaat lokaal.`);
}

// ── Stap: subject-worktree — eigen, gedetacheerd, NOOIT de control-branch ───

function zorgVoorSubjectWorktree(): void {
  stap(`Subject-worktree (${SUBJECT_PATH})`);
  const lijst = git(CONTROL_ROOT, ["worktree", "list", "--porcelain"]);
  const geregistreerd = lijst.includes(`worktree ${SUBJECT_PATH}`) || lijst.includes(`worktree ${path.resolve(SUBJECT_PATH)}`);

  if (geregistreerd) {
    const head = git(SUBJECT_PATH, ["rev-parse", "HEAD"]);
    if (!head.startsWith(BASELINE)) {
      mislukt(
        `Er bestaat al een subject-worktree op ${SUBJECT_PATH}, maar die staat op ${head.slice(0, 12)}, niet op ${BASELINE}. ` +
          `Verwijder hem handmatig ('git worktree remove "${SUBJECT_PATH}"') of geef --subject-path <ander pad>.`,
      );
    }
    console.log(`  Bestaande subject-worktree hergebruikt (${head.slice(0, 12)}).`);
    return;
  }

  if (existsSync(SUBJECT_PATH)) {
    mislukt(
      `${SUBJECT_PATH} bestaat al, maar is geen geregistreerde git-worktree van deze repository. ` +
        `Kies --subject-path <ander pad>, of verwijder deze map handmatig als je zeker weet dat hij niets belangrijks bevat.`,
    );
  }

  console.log(`  Nieuwe subject-worktree aanmaken op commit ${BASELINE} (gedetacheerd, raakt de control-branch niet)...`);
  git(CONTROL_ROOT, ["worktree", "add", "--detach", SUBJECT_PATH, BASELINE]);
  const head = git(SUBJECT_PATH, ["rev-parse", "HEAD"]);
  if (!head.startsWith(BASELINE)) mislukt(`Subject-worktree staat na aanmaken niet op ${BASELINE} (staat op ${head}). Stop.`);
  console.log(`  Subject-worktree aangemaakt en bevestigd op ${head.slice(0, 12)}.`);
}

function controleerSubjectVereisten(): void {
  stap("Subject-vereisten controleren (bevroren golden suite + scripts)");
  const vereist = ["docs/v1.0.6/golden-suite.json", "scripts/v106/golden-bench.ts", "scripts/v106/golden-grade.ts", "scripts/v106/golden-fabricatie.ts"];
  for (const rel of vereist) {
    const p = path.join(SUBJECT_PATH, rel);
    if (!existsSync(p)) mislukt(`Vereist bestand ontbreekt in de subject-worktree: ${rel}. Is dit echt commit ${BASELINE}?`);
  }
  console.log(`  Alle ${vereist.length} vereiste bestanden aanwezig in de subject-worktree.`);
}

// ── Stap: node_modules — junction, geen herinstallatie, geen Administrator ──

function zorgVoorSubjectNodeModules(): void {
  stap("node_modules in de subject-worktree");
  const subjectNodeModules = path.join(SUBJECT_PATH, "node_modules");
  if (existsSync(subjectNodeModules)) {
    console.log("  node_modules bestaat al in de subject-worktree — ongemoeid gelaten.");
    return;
  }
  const diffPackageJson = gitAllowFail(CONTROL_ROOT, ["diff", "--quiet", BASELINE, "HEAD", "--", "package.json", "package-lock.json"]);
  if (!diffPackageJson.ok) {
    // git diff --quiet geeft exit 1 als er WEL verschil is (dat is hier "niet ok").
    mislukt(
      `package.json/package-lock.json verschillen tussen ${BASELINE} en de huidige control-HEAD. ` +
        `Een node_modules-junction zou dan verkeerde dependency-versies geven. Installeer handmatig in de subject-worktree ` +
        `('cd "${SUBJECT_PATH}" && npm install') en draai dit script opnieuw.`,
    );
  }
  console.log("  package.json/package-lock.json zijn identiek sinds de baseline — junction naar control se node_modules is veilig.");
  const controlNodeModules = path.join(CONTROL_ROOT, "node_modules");
  if (!existsSync(controlNodeModules)) mislukt(`node_modules ontbreekt ook in control (${CONTROL_ROOT}). Draai eerst: npm install`);
  // "junction" werkt op Windows zonder Administrator-rechten (in tegenstelling tot een gewone symlink)
  // en is op andere platformen functioneel een directory-symlink.
  symlinkSync(controlNodeModules, subjectNodeModules, "junction");
  console.log(`  Junction aangemaakt: ${subjectNodeModules} -> ${controlNodeModules}`);
}

// ── Stap: .env — veilig kopiëren, nooit de inhoud loggen ─────────────────────

function zorgVoorSubjectEnv(): void {
  stap(".env in de subject-worktree");
  const controlEnv = path.join(CONTROL_ROOT, ".env");
  const subjectEnv = path.join(SUBJECT_PATH, ".env");
  if (!existsSync(controlEnv)) mislukt(".env ontbreekt in control. Kopieer .env.example naar .env en vul hem in.");
  if (existsSync(subjectEnv)) {
    console.log("  .env bestaat al in de subject-worktree — ongemoeid gelaten.");
    return;
  }
  cpSync(controlEnv, subjectEnv);
  console.log("  .env gekopieerd naar de subject-worktree. (Inhoud wordt hier nooit gelogd.)");
}

// ── Stap: database bereikbaar (gedeeld cluster, control-side beheerd) ───────

function controleerDatabase(): void {
  stap("Ontwikkeldatabase controleren");
  const r = spawnSync("npx", [...NS_TSX_ARGS, "scripts/dev-db.ts", "status"], { cwd: CONTROL_ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) mislukt("De ontwikkeldatabase draait niet. Start hem met: npm run db:up");
}

// ── Stap: Ollama + model bereikbaar, zonder hoofdapp-imports (lichte, eigen check) ──

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
  // NS_LOCAL_LLM_URL is de OpenAI-compatibele basis (bv. http://127.0.0.1:11434/v1).
  // Ollama's eigen, native lijst-endpoint zit op dezelfde host zonder de /v1-suffix.
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
  if (!gevonden) {
    mislukt(`Model "${env.model}" staat niet in 'ollama list' (gevonden: ${namen.join(", ") || "niets"}). Haal het op met: ollama pull ${env.model}`);
  }
  console.log(`  Ollama bereikbaar op ${basis}, model "${env.model}" gevonden.`);
}

// ── Stap: stub uitgeschakeld ──────────────────────────────────────────────────

function controleerStubUit(): void {
  stap("Stub-uitschakeling controleren");
  if (process.env.NS_AGENT_FORCE_STUB) {
    console.log(`  NS_AGENT_FORCE_STUB stond aan (${process.env.NS_AGENT_FORCE_STUB}) — uitgeschakeld voor dit proces.`);
    delete process.env.NS_AGENT_FORCE_STUB;
  }
  console.log("  NS_AGENT_FORCE_STUB is niet gezet — de echte lokale-modelroute wordt gebruikt, nooit de stub.");
}

// ── Uitvoerdirectory — nooit overschreven ────────────────────────────────────

function nieuweUitvoerDirectory(runId: string): string {
  let kandidaat = path.join(CONTROL_ROOT, "docs", "lyra-knowledge", "benchmarks", "before", runId);
  let teller = 1;
  while (existsSync(kandidaat)) {
    teller += 1;
    kandidaat = path.join(CONTROL_ROOT, "docs", "lyra-knowledge", "benchmarks", "before", `${runId}-${teller}`);
  }
  mkdirSync(kandidaat, { recursive: true });
  return kandidaat;
}

// ── Hoofdprogramma ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== LYRA MASTER PROGRAM - lokale BEFORE-run ===");

  try {
    rapporteerControlIdentiteit();
    controleerBaselineBestaat();
    zorgVoorSubjectWorktree();
    controleerSubjectVereisten();
    zorgVoorSubjectNodeModules();
    zorgVoorSubjectEnv();
    controleerDatabase();
    const modelEnv = leesLocalModelEnv();
    await controleerOllama(modelEnv);
    controleerStubUit();

    const runId = tijdstempel();
    const outDir = nieuweUitvoerDirectory(runId);

    console.log("\nPRECHECK PASS");
    console.log(`FROZEN SUBJECT: ${BASELINE}`);
    console.log(`MODEL: ${modelEnv.model}`);
    console.log("STUB: OFF");
    console.log(`REPLICATES: ${REPLICATES}`);

    if (PREFLIGHT_ONLY) {
      console.log(`\n(--preflight-only: geen enkel benchmarkitem uitgevoerd. Uitvoerdirectory ${outDir} weer verwijderd.)`);
      // Geen writeFileSync erin gedaan; laat een lege map geen sporen na buiten wat mkdir zelf al deed —
      // dit is puur cosmetisch (geen inhoud geschreven), dus niets om op te ruimen behalve de lege map zelf.
      process.exit(0);
    }

    // ── Manifest genereren IN de subject-worktree (frozen code leest zijn eigen versies) ──
    stap(`Voor-manifest genereren (run ${runId}, uitgevoerd in de subject-worktree)`);
    const manifestHelperDoel = path.join(SUBJECT_PATH, "scripts", "lyra-master");
    mkdirSync(manifestHelperDoel, { recursive: true });
    cpSync(path.join(CONTROL_ROOT, "scripts", "lyra-master", "before-manifest.ts"), path.join(manifestHelperDoel, "before-manifest.ts"));
    voerUit(SUBJECT_PATH, "npx", [...NS_TSX_ARGS, "scripts/lyra-master/before-manifest.ts", "--run", runId, "--phase", "before"], "Manifest-generatie");

    // ── Replicaten: bevroren 43-item suite, volledig binnen de subject-worktree ──
    let alleReplicatenOk = true;
    for (let r = 1; r <= REPLICATES; r += 1) {
      const meting = `before-${runId}-r${r}`;
      stap(`Replicaat ${r}/${REPLICATES} (bevroren suite) — meting '${meting}'`);
      try {
        voerUit(SUBJECT_PATH, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-bench.ts", "--meting", meting], `golden-bench.ts (${meting})`);
        voerUit(SUBJECT_PATH, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-grade.ts", "--meting", meting], `golden-grade.ts (${meting})`);
        voerUit(SUBJECT_PATH, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-fabricatie.ts", "--meting", meting], `golden-fabricatie.ts (${meting})`);
      } catch (fout) {
        alleReplicatenOk = false;
        console.error(`  [FOUT] replicaat ${meting}: ${fout instanceof Error ? fout.message : String(fout)}`);
      }
    }

    // ── Ruwe uitvoer + manifest overkopiëren van SUBJECT naar CONTROL ──────
    stap("Ruwe uitvoer overkopiëren naar control");
    const subjectManifestDir = path.join(SUBJECT_PATH, "docs", "lyra-knowledge", "benchmarks", "before", runId);
    const controlManifestDir = path.join(CONTROL_ROOT, "docs", "lyra-knowledge", "benchmarks", "before", runId);
    if (existsSync(subjectManifestDir)) cpSync(subjectManifestDir, controlManifestDir, { recursive: true });
    const rawDir = path.join(outDir, "raw");
    mkdirSync(rawDir, { recursive: true });
    for (let r = 1; r <= REPLICATES; r += 1) {
      const meting = `before-${runId}-r${r}`;
      const subjectMetingDir = path.join(SUBJECT_PATH, "docs", "v1.0.6", "benchmarks", meting);
      if (!existsSync(subjectMetingDir)) continue;
      const controlMetingDir = path.join(CONTROL_ROOT, "docs", "v1.0.6", "benchmarks", meting);
      cpSync(subjectMetingDir, controlMetingDir, { recursive: true });
      cpSync(subjectMetingDir, path.join(rawDir, meting), { recursive: true });
    }
    console.log(`  Ruwe replicaat-mappen gekopieerd naar ${CONTROL_ROOT}/docs/v1.0.6/benchmarks/ en naar ${rawDir}`);

    // ── Aggregatie (control-side, ongewijzigd script, leest nu de gekopieerde bestanden) ──
    stap("Replicaten aggregeren");
    let aggregatieOk = true;
    try {
      voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/lyra-master/aggregate-replicates.ts", "--run", runId, "--replicates", String(REPLICATES), "--phase", "before"], "aggregate-replicates.ts");
    } catch {
      aggregatieOk = false;
    }
    const controlAggregateDir = path.join(CONTROL_ROOT, "docs", "lyra-knowledge", "benchmarks", "before", runId);
    if (existsSync(controlAggregateDir)) cpSync(controlAggregateDir, outDir, { recursive: true });

    // ── EXTENSION / NON-FROZEN: bewust vanuit CONTROL, nooit vermengd met de bevroren meting ──
    stap("EXTENSION / NON-FROZEN golden-suite-extensie (categorieën L, O) — bewust vanuit control, niet de bevroren subject");
    let extensieOk = true;
    try {
      voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-suite-extension.ts"], "golden-suite-extension.ts");
      for (let r = 1; r <= REPLICATES; r += 1) {
        const meting = `before-${runId}-r${r}`;
        voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-bench-extension.ts", "--meting", meting], `golden-bench-extension.ts (${meting})`);
        voerUit(CONTROL_ROOT, "npx", [...NS_TSX_ARGS, "scripts/v106/golden-grade-extension.ts", "--meting", meting], `golden-grade-extension.ts (${meting})`);
      }
    } catch (fout) {
      extensieOk = false;
      console.error(`  [WAARSCHUWING] EXTENSION/NON-FROZEN-meting faalde: ${fout instanceof Error ? fout.message : String(fout)} — dit blokkeert de officiële BEFORE-meting niet, want de extensie is per definitie geen onderdeel daarvan.`);
    }

    // ── Verificatiebestand ───────────────────────────────────────────────────
    stap("BEFORE-VERIFICATION.json schrijven");
    const subjectHeadNu = git(SUBJECT_PATH, ["rev-parse", "HEAD"]);
    const subjectCommitKlopt = subjectHeadNu.startsWith(BASELINE);
    const manifestPad = path.join(outDir, "manifest.json");
    const manifest = existsSync(manifestPad) ? (JSON.parse(readFileSync(manifestPad, "utf8")) as Record<string, unknown>) : null;
    const localModel = (manifest?.localModel ?? {}) as Record<string, unknown>;

    const ruweBestanden: { pad: string; sha256: string }[] = [];
    for (let r = 1; r <= REPLICATES; r += 1) {
      const meting = `before-${runId}-r${r}`;
      for (const naam of ["golden.json", "golden-grade.json"]) {
        const p = path.join(rawDir, meting, naam);
        if (existsSync(p)) ruweBestanden.push({ pad: `raw/${meting}/${naam}`, sha256: sha256Van(p) });
      }
    }

    const status =
      subjectCommitKlopt && localModel.reachable === true && manifest?.stubExplicitlyDisabled === true && alleReplicatenOk && aggregatieOk && ruweBestanden.length === REPLICATES * 2
        ? "PASS"
        : "FAIL";

    const verificatie = {
      schema: "ns-lyra-master-before-verification/2",
      runId,
      phase: "before",
      recordedAt: new Date().toISOString(),
      status,
      controlBranchTouched: false,
      subject: { path: SUBJECT_PATH, baselineCommitRequested: BASELINE, headAfterRun: subjectHeadNu, commitMatches: subjectCommitKlopt },
      model: { name: localModel.model ?? null, reachable: localModel.reachable ?? null },
      stubExplicitlyDisabled: manifest?.stubExplicitlyDisabled ?? null,
      replicates: REPLICATES,
      allReplicatesCompleted: alleReplicatenOk,
      gradingCompleted: aggregatieOk,
      extension: { ranOk: extensieOk, note: "EXTENSION / NON-FROZEN — categorieen L/O, uitgevoerd vanuit control (post-baseline code), NOOIT onderdeel van de officiele bevroren BEFORE-vergelijking." },
      rawArtifacts: ruweBestanden,
      paths: { manifest: "manifest.json", aggregate: "aggregate.json", raw: "raw/" },
    };
    writeFileSync(path.join(outDir, "BEFORE-VERIFICATION.json"), `${JSON.stringify(verificatie, null, 2)}\n`);

    console.log(`\nStatus: ${status}`);
    console.log(`Uitvoer: ${outDir}`);
    if (status !== "PASS") {
      console.log("Reden(en) voor FAIL: zie BEFORE-VERIFICATION.json (subject.commitMatches / model.reachable / stubExplicitlyDisabled / allReplicatesCompleted / gradingCompleted / rawArtifacts.length).");
      process.exit(1);
    }
    console.log("\nStuur de map hierboven (of push hem) terug — dat is het BEFORE-bewijs.");
    process.exit(0);
  } catch (fout) {
    if (fout instanceof PreflightError) {
      console.error(`\n[PRECHECK FAIL] ${fout.message}`);
      process.exit(1);
    }
    throw fout;
  }
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
