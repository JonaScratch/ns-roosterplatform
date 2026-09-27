import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beoordeelWerkmapSchoonheid, isWorktreeGeregistreerd, ORCHESTRATOR_OWNED_PATHS, prismaClientAanwezig, PRISMA_CLIENT_MARKERS } from "./subject-worktree";

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
const RESUME_RUN = argument("resume-run");

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
  // Vergelijk genormaliseerd (schuine strepen, hoofdletters) — git geeft paden altijd met "/",
  // ook op Windows, terwijl path.resolve() daar "\" gebruikt. Een kale string-vergelijking
  // miste daardoor een al bestaande worktree na een eerdere --preflight-only-run.
  const geregistreerd = isWorktreeGeregistreerd(lijst, path.resolve(SUBJECT_PATH));

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

// ── Stap: subject-integriteit, VÓÓR de orchestrator zelf ook maar iets schrijft ──
//
// "LOCAL BEFORE BUG #4": een naïeve "git status --porcelain moet leeg zijn"-eis
// faalt zodra de orchestrator zijn EIGEN, noodzakelijke helperbestanden neerzet
// (before-manifest.ts, dit bestand se eigen subject-worktree.ts-kopie,
// smoke-import.ts) — die bestaan niet op de bevroren commit, dus git ziet ze
// terecht als untracked, en een letterlijke leegte-eis zou de worktree dan
// zelf dirty maken en daarna weigeren. De garantie die er echt toe doet is:
// HEAD == baseline EN de GETRACKTE inhoud van die commit is ongewijzigd —
// niet "er staat helemaal niets anders in de map". Deze controle draait
// daarom HIER, vóór node_modules/.env/Prisma/smoke-import, zodat een
// eventuele echte afwijking (een gewijzigd getrackt bestand, of een
// onverwacht vreemd bestand dat niet van de orchestrator zelf is) gevonden
// wordt vóórdat de orchestrator zijn eigen, onschuldige artefacten toevoegt.
function controleerSubjectIntegriteitVoorOrchestratie(): void {
  stap("Subject-integriteit controleren (vóór de orchestrator hier zelf iets schrijft)");
  // --untracked-files=all: zonder deze vlag toont git een volledig niet-getrackte
  // map als ÉÉN regel ("?? scripts/lyra-master/") in plaats van elk bestand apart
  // (scripts/lyra-master/ bestaat immers niet op de bevroren baseline). Zonder
  // deze vlag zou de classifier die verzamelregel nooit matchen met een van de
  // whitelisted orchestrator-paden, en dus ten onrechte als "onverwacht" zien —
  // precies zo ontdekt tijdens het echt testen van deze reparatie in de sandbox.
  const porcelain = git(SUBJECT_PATH, ["status", "--porcelain", "--untracked-files=all"]);
  const beoordeling = beoordeelWerkmapSchoonheid(porcelain);
  if (beoordeling.trackedModifiedPaths.length > 0) {
    mislukt(
      `Getrackte bestanden in de subject-worktree wijken af van de bevroren baseline ${BASELINE}: ${beoordeling.trackedModifiedPaths.join(", ")}. ` +
        `Dit is een integriteitsschending van de bevroren BEFORE-meting. Herstel de worktree (bv. 'git -C "${SUBJECT_PATH}" checkout -- .') ` +
        `of verwijder hem ('git worktree remove "${SUBJECT_PATH}"') en laat dit script hem opnieuw aanmaken.`,
    );
  }
  if (beoordeling.unexpectedUntrackedPaths.length > 0) {
    mislukt(
      `Onverwachte, niet-getrackte bestanden gevonden in de subject-worktree (niet een orchestrator-eigen helperbestand, ` +
        `niet eerdere/huidige benchmark-uitvoer): ${beoordeling.unexpectedUntrackedPaths.join(", ")}. ` +
        `Verwijder ze handmatig, of geef --subject-path <ander pad> voor een schone worktree.`,
    );
  }
  console.log(
    `  Getrackte baseline-inhoud ongewijzigd (HEAD ${BASELINE}). ` +
      `${beoordeling.orchestratorArtifacts.length} orchestrator-eigen helperbestand(en) en ${beoordeling.benchmarkOutputPaths.length} ` +
      `eerdere/huidige benchmark-outputpad(en) getolereerd (verwacht, geen integriteitsschending).`,
  );
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

// ── Stap: gegenereerde Prisma-client in de subject-worktree ──────────────────
//
// `prisma/schema.prisma` genereert naar `../src/lib/generated/prisma`, en die
// map staat in `.gitignore` (`/src/lib/generated`) — een verse `git worktree`
// bevat dus terecht geen gegenereerde client. Zonder deze stap faalt elke
// import van baseline-appcode (bv. `src/server/audit/log.ts`) met
// "Cannot find module '@/lib/generated/prisma/enums'" zodra `before-manifest.ts`
// of `golden-bench.ts` draait. Genereren gebeurt met het BEVROREN
// `prisma/schema.prisma` van de subject-worktree zelf (nooit het schema uit
// control, en er wordt niets uit control se `src/lib/generated` gekopieerd).
function zorgVoorFrozenPrismaClient(): void {
  stap("Gegenereerde Prisma-client controleren/genereren (subject-worktree, bevroren schema)");
  if (prismaClientAanwezig(SUBJECT_PATH)) {
    console.log(`  Gegenereerde Prisma-client al aanwezig in de subject-worktree (${PRISMA_CLIENT_MARKERS.join(", ")}) — hergebruikt.`);
    return;
  }
  console.log("  Gegenereerde Prisma-client ontbreekt (verwacht: gitignored). Genereren met het bevroren schema van de subject-worktree...");
  voerUit(SUBJECT_PATH, "npx", ["prisma", "generate", "--schema", "prisma/schema.prisma"], "npx prisma generate (subject, bevroren schema)");
  if (!prismaClientAanwezig(SUBJECT_PATH)) {
    mislukt(
      `'npx prisma generate' is uitgevoerd in de subject-worktree, maar de verwachte gegenereerde bestanden ontbreken nog steeds ` +
        `(${PRISMA_CLIENT_MARKERS.join(", ")}). Controleer de prisma-versie/het schema op commit ${BASELINE}.`,
    );
  }
  console.log("  Gegenereerde Prisma-client aanwezig en geverifieerd in de subject-worktree.");
}

// ── Stap: snelle smoke-import — resolveert runtime-afhankelijkheden, draait NOG geen benchmarkitem ──
//
// Dit is precies de importketen die eerder pas tijdens de echte manifestgeneratie
// crashte (capabilities.ts -> audit/log.ts -> @/lib/generated/prisma/enums). Door
// hem hier, vóór "PRECHECK PASS", te draaien, vangt de preflight dit soort fouten
// voortaan zelf, in plaats van pas na de dure opstap.
function voerSmokeImportUit(): void {
  stap("Smoke-import subject-runtime (Prisma-client + agent-afhankelijkheden resolveren — nog geen benchmarkitem)");
  const doelDir = path.join(SUBJECT_PATH, "scripts", "lyra-master");
  mkdirSync(doelDir, { recursive: true });
  const smokeBestand = path.join(doelDir, "smoke-import.ts");
  writeFileSync(
    smokeBestand,
    [
      "// Automatisch gegenereerd door run-before-local.ts (untracked, blijft in de subject-worktree).",
      "// Importeert dezelfde module die golden-bench.ts ook importeert (@/server/agent/agent),",
      "// zodat dit precies de importketen test die eerder pas tijdens de manifestgeneratie",
      "// crashte (agent.ts -> capabilities.ts -> audit/log.ts -> @/lib/generated/prisma/enums).",
      "// Voert GEEN benchmarkitem uit en raakt geen data aan.",
      'import "@/server/agent/agent";',
      'console.log("SMOKE_IMPORT_OK");',
      "",
    ].join("\n"),
  );
  voerUit(SUBJECT_PATH, "npx", [...NS_TSX_ARGS, "scripts/lyra-master/smoke-import.ts"], "Smoke-import (subject)");
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

// ── Opruimen: orchestrator-eigen helperbestanden nooit permanent in SUBJECT laten staan ──
//
// Alleen de drie exacte, vooraf bekende paden in ORCHESTRATOR_OWNED_PATHS —
// nooit een brede rm -rf over onbekende inhoud. Draait aan het einde van elke
// aanroep (ook bij --preflight-only en bij een vroege [PRECHECK FAIL]), zodat
// een volgende run op dezelfde worktree weer met een minimale, voorspelbare
// hoeveelheid untracked bestanden begint.
function ruimOrchestratorArtefactenOp(): void {
  if (!existsSync(SUBJECT_PATH)) return;
  stap("Orchestrator-eigen helperbestanden opruimen uit de subject-worktree");
  let iets = false;
  for (const rel of ORCHESTRATOR_OWNED_PATHS) {
    const p = path.join(SUBJECT_PATH, rel);
    if (existsSync(p)) {
      rmSync(p);
      console.log(`  Verwijderd: ${rel}`);
      iets = true;
    }
  }
  if (!iets) console.log("  Niets op te ruimen (geen van de orchestrator-eigen helperbestanden stond er nog).");
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

// ── Bestaande run finaliseren (--resume-run) — NOOIT het bevroren 43-item-benchmark opnieuw draaien ──
//
// "LOCAL BEFORE BUG #5": een echte run kan de volledige bevroren 3×43-meting
// en de aggregatie succesvol afronden, en dan alsnog crashen op een latere,
// puur administratieve stap (zie de zelf-copy-bug hierboven). De ruwe
// resultaten (golden.json/golden-grade.json per replicaat) en het manifest/
// aggregate staan dan al veilig op schijf. Dit opnieuw als een normale run
// starten zou het bevroren 43-item-benchmark een tweede keer draaien — exact
// wat verboden is ("reeds uitgevoerde benchmarkresultaten mogen NIET opnieuw
// gegenereerd, overschreven of achteraf aangepast worden"). --resume-run
// leest daarom uitsluitend de al-bestaande artifacts, verifieert ze, en
// schrijft alleen het ontbrekende verificatiebestand — zonder Ollama, zonder
// database, zonder de subject-worktree opnieuw aan te roepen.
async function resumeRun(runId: string): Promise<number> {
  stap(`Bestaande run finaliseren (--resume-run ${runId}) — het bevroren 43-item-benchmark wordt NIET opnieuw uitgevoerd`);
  rapporteerControlIdentiteit();

  const runDir = path.join(CONTROL_ROOT, "docs", "lyra-knowledge", "benchmarks", "before", runId);
  const manifestPad = path.join(runDir, "manifest.json");
  const verificatiePad = path.join(runDir, "BEFORE-VERIFICATION.json");

  if (!existsSync(manifestPad)) {
    mislukt(
      `Geen manifest.json gevonden voor run ${runId} op ${manifestPad}. --resume-run kan uitsluitend een reeds uitgevoerde run afronden ` +
        `(nooit een nieuwe starten) — controleer de runId.`,
    );
  }
  if (existsSync(verificatiePad)) {
    mislukt(
      `BEFORE-VERIFICATION.json bestaat al voor run ${runId} (${verificatiePad}). Een gefinaliseerde run wordt nooit stilzwijgend ` +
        `overschreven. Verwijder het bestand handmatig als je zeker weet dat het opnieuw moet.`,
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPad, "utf8")) as Record<string, unknown>;
  const manifestGit = (manifest.git ?? {}) as Record<string, unknown>;
  const localModel = (manifest.localModel ?? {}) as Record<string, unknown>;

  // Subject-identiteit hier NOOIT opnieuw live bevragen (de subject-worktree kan
  // intussen zijn opgeruimd of hergebruikt voor een andere run) — uitsluitend
  // lezen uit wat before-manifest.ts destijds, IN de subject-worktree zelf, al
  // vastlegde. Dat is precies wat "verifieer dit uit de artifacts zelf, neem
  // het niet op vertrouwen aan" hier betekent.
  const headMatchesBaseline = manifestGit.headMatchesBaseline === true;
  const trackedBaselineClean = manifestGit.trackedBaselineClean === true;
  console.log(`  manifest.json gelezen: ${manifestPad}`);
  console.log(
    `  baseline (uit manifest)=${manifestGit.baselineHead ?? "onbekend"} headMatchesBaseline=${headMatchesBaseline} ` +
      `trackedBaselineClean=${trackedBaselineClean}`,
  );
  console.log(`  model (uit manifest)=${localModel.model ?? "onbekend"} bereikbaar=${localModel.reachable === true} stubExplicitlyDisabled=${manifest.stubExplicitlyDisabled === true}`);
  if (!headMatchesBaseline) console.error(`  [WAARSCHUWING] manifest.json zegt dat HEAD destijds niet op de baseline stond.`);
  if (!trackedBaselineClean) console.error(`  [WAARSCHUWING] manifest.json zegt dat de getrackte baseline-inhoud destijds gewijzigd was.`);

  const rawDir = path.join(runDir, "raw");
  mkdirSync(rawDir, { recursive: true });

  let alleReplicatenOk = true;
  const ruweBestanden: { pad: string; sha256: string }[] = [];
  for (let r = 1; r <= REPLICATES; r += 1) {
    const meting = `before-${runId}-r${r}`;
    const bronMap = path.join(CONTROL_ROOT, "docs", "v1.0.6", "benchmarks", meting);
    const rawMeting = path.join(rawDir, meting);
    if (!existsSync(bronMap) && !existsSync(rawMeting)) {
      alleReplicatenOk = false;
      console.error(`  [FOUT] Replicaat-map ontbreekt (niet in control, niet al in raw/): ${bronMap}. Er wordt niets opnieuw gegenereerd — deze run kan zo niet volledig geverifieerd worden.`);
      continue;
    }
    // Nooit overschrijven als de raw/-kopie er al staat (bv. van een eerdere, ook-gecrashte finalize-poging).
    if (!existsSync(rawMeting) && existsSync(bronMap)) cpSync(bronMap, rawMeting, { recursive: true });
    for (const naam of ["golden.json", "golden-grade.json"]) {
      const p = path.join(rawMeting, naam);
      if (existsSync(p)) {
        ruweBestanden.push({ pad: `raw/${meting}/${naam}`, sha256: sha256Van(p) });
      } else {
        alleReplicatenOk = false;
        console.error(`  [FOUT] Verwacht ruw bestand ontbreekt: ${p}`);
      }
    }
  }
  console.log(`  ${ruweBestanden.length}/${REPLICATES * 2} verwachte ruwe bestanden gevonden en gehasht (sha256), niets herschreven.`);

  // Aggregatie: dit is een DETERMINISTISCHE SAMENVATTING van reeds bestaande,
  // ongewijzigde grade-bestanden — geen nieuwe benchmark-meting. Alleen
  // (opnieuw) draaien als aggregate.json nog echt ontbreekt; als hij er al
  // staat (zoals bij run 20260927-205217, waar de aggregatie al voor de crash
  // succesvol afrondde), blijft hij ongemoeid.
  let aggregatieOk = true;
  const aggregatePad = path.join(runDir, "aggregate.json");
  if (!existsSync(aggregatePad)) {
    stap("Replicaten aggregeren (aggregate.json ontbrak nog)");
    try {
      voerUit(
        CONTROL_ROOT,
        "npx",
        [...NS_TSX_ARGS, "scripts/lyra-master/aggregate-replicates.ts", "--run", runId, "--replicates", String(REPLICATES), "--phase", "before"],
        "aggregate-replicates.ts",
      );
    } catch {
      aggregatieOk = false;
    }
  } else {
    console.log(`  aggregate.json bestond al (${aggregatePad}) — niet opnieuw berekend, niet overschreven.`);
  }

  // EXTENSION / NON-FROZEN: als nog niet gedraaid voor deze run, alsnog vanuit
  // control — puur additief, raakt de bevroren 43-item-resultaten niet aan.
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
    console.error(
      `  [WAARSCHUWING] EXTENSION/NON-FROZEN-meting faalde: ${fout instanceof Error ? fout.message : String(fout)} — dit blokkeert de officiële BEFORE-meting niet.`,
    );
  }

  const status =
    headMatchesBaseline &&
    trackedBaselineClean &&
    localModel.reachable === true &&
    manifest.stubExplicitlyDisabled === true &&
    alleReplicatenOk &&
    aggregatieOk &&
    ruweBestanden.length === REPLICATES * 2
      ? "PASS"
      : "FAIL";

  const verificatie = {
    schema: "ns-lyra-master-before-verification/2",
    runId,
    phase: "before",
    recordedAt: new Date().toISOString(),
    status,
    finalizedVia: "resume-run",
    controlBranchTouched: false,
    subject: {
      baselineCommitRequested: BASELINE,
      baselineHeadFromManifest: manifestGit.baselineHead ?? null,
      headMatchesBaseline,
      trackedBaselineClean,
      note:
        "Subject-identiteit hier gelezen uit manifest.json (geschreven tijdens de oorspronkelijke run, IN de subject-worktree zelf), " +
        "niet opnieuw live bevraagd — de worktree kan intussen zijn opgeruimd of voor een andere run hergebruikt.",
    },
    model: { name: localModel.model ?? null, reachable: localModel.reachable ?? null },
    stubExplicitlyDisabled: manifest.stubExplicitlyDisabled ?? null,
    replicates: REPLICATES,
    allReplicatesCompleted: alleReplicatenOk,
    gradingCompleted: aggregatieOk,
    extension: {
      ranOk: extensieOk,
      note: "EXTENSION / NON-FROZEN — categorieen L/O, uitgevoerd vanuit control (post-baseline code), NOOIT onderdeel van de officiele bevroren BEFORE-vergelijking.",
    },
    rawArtifacts: ruweBestanden,
    paths: { manifest: "manifest.json", aggregate: "aggregate.json", raw: "raw/" },
  };
  writeFileSync(verificatiePad, `${JSON.stringify(verificatie, null, 2)}\n`);

  console.log(`\nStatus: ${status}`);
  console.log(`Uitvoer: ${runDir}`);
  if (status !== "PASS") {
    console.log("Reden(en) voor FAIL: zie BEFORE-VERIFICATION.json.");
    return 1;
  }
  console.log("\nStuur BEFORE-VERIFICATION.json (of de hele map) terug — dat is het BEFORE-bewijs.");
  return 0;
}

// ── Hoofdprogramma ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (RESUME_RUN) {
    console.log("=== LYRA MASTER PROGRAM - lokale BEFORE-run (finalize/resume) ===");
    let exitCode = 0;
    try {
      exitCode = await resumeRun(RESUME_RUN);
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

  console.log("=== LYRA MASTER PROGRAM - lokale BEFORE-run ===");

  // Eén exitpunt onderaan (via `exitCode`, nooit `process.exit()` middenin de
  // try) zodat de `finally` hieronder — orchestrator-eigen helperbestanden
  // opruimen uit de subject-worktree — altijd draait: bij PRECHECK PASS,
  // bij --preflight-only, bij een vroege [PRECHECK FAIL], en bij een
  // afgeronde echte run (PASS of FAIL). `process.exit()` breekt namelijk
  // synchroon af en zou een latere `finally` overslaan.
  let exitCode = 0;
  try {
    rapporteerControlIdentiteit();
    controleerBaselineBestaat();
    zorgVoorSubjectWorktree();
    controleerSubjectVereisten();
    controleerSubjectIntegriteitVoorOrchestratie();
    zorgVoorSubjectNodeModules();
    zorgVoorSubjectEnv();
    zorgVoorFrozenPrismaClient();
    voerSmokeImportUit();
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
      return;
    }

    // ── Manifest genereren IN de subject-worktree (frozen code leest zijn eigen versies) ──
    stap(`Voor-manifest genereren (run ${runId}, uitgevoerd in de subject-worktree)`);
    const manifestHelperDoel = path.join(SUBJECT_PATH, "scripts", "lyra-master");
    mkdirSync(manifestHelperDoel, { recursive: true });
    // Beide horen bij ORCHESTRATOR_OWNED_PATHS: before-manifest.ts importeert
    // subject-worktree.ts relatief (../lyra-master/subject-worktree), dus die
    // moet hier ook staan, anders faalt de import in de subject-worktree.
    cpSync(path.join(CONTROL_ROOT, "scripts", "lyra-master", "subject-worktree.ts"), path.join(manifestHelperDoel, "subject-worktree.ts"));
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
    // LOCAL BEFORE BUG #5: in het gewone (niet-collisie) geval IS controlAggregateDir
    // hetzelfde pad als outDir (beide `docs/lyra-knowledge/benchmarks/before/<runId>`) —
    // aggregate-replicates.ts schreef aggregate.json dus al rechtstreeks in outDir zelf.
    // Een cpSync van een map naar zichzelf gooit Node's ERR_FS_CP_EINVAL. Alleen kopiëren
    // als het pad daadwerkelijk verschilt (bv. bij een naamcollisie kreeg outDir een
    // "-2"-suffix van nieuweUitvoerDirectory() en is dit wél nodig).
    if (existsSync(controlAggregateDir) && path.resolve(controlAggregateDir) !== path.resolve(outDir)) {
      cpSync(controlAggregateDir, outDir, { recursive: true });
    }

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
      exitCode = 1;
    } else {
      console.log("\nStuur de map hierboven (of push hem) terug — dat is het BEFORE-bewijs.");
    }
  } catch (fout) {
    if (fout instanceof PreflightError) {
      console.error(`\n[PRECHECK FAIL] ${fout.message}`);
      exitCode = 1;
    } else {
      throw fout;
    }
  } finally {
    ruimOrchestratorArtefactenOp();
  }
  process.exit(exitCode);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
