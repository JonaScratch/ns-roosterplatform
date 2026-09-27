import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  beoordeelWerkmapSchoonheid,
  classificeerPorcelainRegel,
  genormaliseerdWorktreePad,
  headMatchtBaseline,
  isWorktreeGeregistreerd,
  ORCHESTRATOR_OWNED_PATHS,
  PRISMA_CLIENT_MARKERS,
  prismaClientAanwezig,
  worktreePadenUitPorcelain,
} from "../../scripts/lyra-master/subject-worktree";

/**
 * Regressietests voor "LOCAL BEFORE BUG #3" (frozen subject miste de
 * gegenereerde Prisma-client) en de daarbij gevonden Windows
 * worktree-pad-normalisatiebug. Dit bestand test alleen de zuivere,
 * side-effect-vrije hulpfuncties uit `subject-worktree.ts` — de echte
 * git-worktree/`prisma generate`-integratie is handmatig geverifieerd in de
 * sandbox (zie `docs/lyra-knowledge/progress.md`), want die vereist een
 * echte git-repository en netwerktoegang tot npm-registries die in een
 * geïsoleerde unit test niet gegarandeerd zijn.
 */

describe("worktreePadenUitPorcelain", () => {
  it("leest alleen de 'worktree <pad>'-regels uit een porcelain-listing", () => {
    const porcelain = [
      "worktree /home/user/ns-roosterplatform",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/ns-roosterplatform-frozen-subject-588c1e5",
      "HEAD 588c1e5abcdef",
      "detached",
      "",
    ].join("\n");
    expect(worktreePadenUitPorcelain(porcelain)).toEqual([
      "/home/user/ns-roosterplatform",
      "/home/user/ns-roosterplatform-frozen-subject-588c1e5",
    ]);
  });

  it("geeft een lege lijst bij een lege of onverwachte listing", () => {
    expect(worktreePadenUitPorcelain("")).toEqual([]);
    expect(worktreePadenUitPorcelain("HEAD abc123\nbranch refs/heads/main\n")).toEqual([]);
  });
});

describe("genormaliseerdWorktreePad", () => {
  it("zet backslashes om naar voorwaartse schuine strepen, ongeacht platform", () => {
    expect(genormaliseerdWorktreePad("C:\\Users\\Jonathan Schram\\ClaudeCode\\subject-588c1e5", "linux")).toBe(
      "C:/Users/Jonathan Schram/ClaudeCode/subject-588c1e5",
    );
  });

  it("lowercast alleen op win32 (bestandssysteem is daar niet hoofdlettergevoelig)", () => {
    const windowsPad = "C:\\Users\\Foo\\Subject-588C1E5";
    expect(genormaliseerdWorktreePad(windowsPad, "win32")).toBe("c:/users/foo/subject-588c1e5");
    expect(genormaliseerdWorktreePad(windowsPad, "linux")).toBe("C:/Users/Foo/Subject-588C1E5");
  });

  it("laat een reeds voorwaarts-slash pad ongemoeid op niet-Windows", () => {
    expect(genormaliseerdWorktreePad("/home/user/x-frozen-subject-588c1e5", "linux")).toBe(
      "/home/user/x-frozen-subject-588c1e5",
    );
  });
});

describe("isWorktreeGeregistreerd", () => {
  it("herkent een bestaande worktree ook als de listing '/' gebruikt en het gevraagde pad '\\\\' gebruikt (de gerapporteerde bug)", () => {
    const porcelain = "worktree C:/Users/Jonathan Schram/ClaudeCode/ns-roosterplatform-demo-room-frozen-subject-588c1e5\nHEAD 588c1e5\ndetached\n";
    const gevraagdPad = "C:\\Users\\Jonathan Schram\\ClaudeCode\\ns-roosterplatform-demo-room-frozen-subject-588c1e5";
    expect(isWorktreeGeregistreerd(porcelain, gevraagdPad, "win32")).toBe(true);
  });

  it("geeft false als er echt geen match is", () => {
    const porcelain = "worktree /home/user/ns-roosterplatform\nHEAD abc\nbranch refs/heads/main\n";
    expect(isWorktreeGeregistreerd(porcelain, "/home/user/ns-roosterplatform-frozen-subject-588c1e5", "linux")).toBe(false);
  });
});

describe("prismaClientAanwezig", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("is false in een verse worktree zonder gegenereerde Prisma-client (de gerapporteerde bug)", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "subject-worktree-test-"));
    expect(prismaClientAanwezig(tmp)).toBe(false);
  });

  it("is false als slechts één van de twee verwachte bestanden bestaat", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "subject-worktree-test-"));
    const dir = path.join(tmp, "src", "lib", "generated", "prisma");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "client.ts"), "export {};\n");
    expect(prismaClientAanwezig(tmp)).toBe(false);
  });

  it("is true zodra alle PRISMA_CLIENT_MARKERS aanwezig zijn (na 'prisma generate')", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "subject-worktree-test-"));
    for (const rel of PRISMA_CLIENT_MARKERS) {
      const p = path.join(tmp, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, "export {};\n");
    }
    expect(prismaClientAanwezig(tmp)).toBe(true);
  });

  it("telt een control-worktree (ander pad) nooit mee als substituut voor het subject-pad", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "control-test-"));
    for (const rel of PRISMA_CLIENT_MARKERS) {
      const p = path.join(tmp, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, "export {};\n");
    }
    const andereMap = mkdtempSync(path.join(tmpdir(), "subject-test-"));
    try {
      expect(prismaClientAanwezig(andereMap)).toBe(false);
    } finally {
      rmSync(andereMap, { recursive: true, force: true });
    }
  });
});

/**
 * Regressietests voor "LOCAL BEFORE BUG #4": de orchestrator zet zelf
 * `before-manifest.ts`/`subject-worktree.ts`/`smoke-import.ts` in de subject-
 * worktree neer om de bevroren appcode te kunnen aanroepen — een naïeve
 * "porcelain moet leeg zijn"-eis zag die zelf-geplaatste bestanden en
 * weigerde de meting. `beoordeelWerkmapSchoonheid()` moet onderscheid maken
 * tussen een echte integriteitsschending (een GETRACKT baselinebestand is
 * gewijzigd) en de orchestrator se eigen, onschuldige helpers/uitvoer.
 */
describe("classificeerPorcelainRegel / beoordeelWerkmapSchoonheid (LOCAL BEFORE BUG #4)", () => {
  it("een pristiene, volledig schone frozen subject-worktree levert nul bevindingen in elke categorie (PASS)", () => {
    const beoordeling = beoordeelWerkmapSchoonheid("");
    expect(beoordeling).toEqual({
      trackedModifiedPaths: [],
      orchestratorArtifacts: [],
      benchmarkOutputPaths: [],
      unexpectedUntrackedPaths: [],
    });
  });

  it("smoke-import.ts (orchestrator-eigen helper) telt als orchestrator-artifact, niet als onverwacht (PASS)", () => {
    const beoordeling = beoordeelWerkmapSchoonheid("?? scripts/lyra-master/smoke-import.ts\n");
    expect(beoordeling.orchestratorArtifacts).toEqual(["scripts/lyra-master/smoke-import.ts"]);
    expect(beoordeling.unexpectedUntrackedPaths).toEqual([]);
    expect(beoordeling.trackedModifiedPaths).toEqual([]);
  });

  it("before-manifest.ts (gekopieerde orchestrator-eigen helper) telt als orchestrator-artifact, niet als onverwacht (PASS)", () => {
    const beoordeling = beoordeelWerkmapSchoonheid("?? scripts/lyra-master/before-manifest.ts\n?? scripts/lyra-master/subject-worktree.ts\n");
    expect([...beoordeling.orchestratorArtifacts].sort()).toEqual(["scripts/lyra-master/before-manifest.ts", "scripts/lyra-master/subject-worktree.ts"]);
    expect(beoordeling.unexpectedUntrackedPaths).toEqual([]);
  });

  it("elk pad in ORCHESTRATOR_OWNED_PATHS wordt herkend als orchestrator-artifact", () => {
    for (const rel of ORCHESTRATOR_OWNED_PATHS) {
      const c = classificeerPorcelainRegel(`?? ${rel}`);
      expect(c).toEqual({ pad: rel, soort: "orchestrator-artifact" });
    }
  });

  it("gegenereerde/genegeerde Prisma-clientbestanden verschijnen niet in 'git status --porcelain' (zonder --ignored) en leveren dus geen bevinding op (PASS/genegeerd)", () => {
    // git laat gitignored paden (node_modules, .env, src/lib/generated) standaard
    // al buiten --porcelain weg, dus een lege/onaangeraakte porcelain-regel voor
    // die paden is hier het correcte, verwachte signaal — niets te classificeren.
    const beoordeling = beoordeelWerkmapSchoonheid("");
    expect(beoordeling.unexpectedUntrackedPaths).toEqual([]);
    expect(beoordeling.trackedModifiedPaths).toEqual([]);
  });

  it("een eerdere/huidige benchmark-outputmap onder docs/lyra-knowledge/benchmarks/ of docs/v1.0.6/benchmarks/ telt als benchmark-output (PASS)", () => {
    const beoordeling = beoordeelWerkmapSchoonheid(
      ["?? docs/lyra-knowledge/benchmarks/before/20260928-1200/manifest.json", "?? docs/v1.0.6/benchmarks/before-20260928-1200-r1/golden.json", ""].join("\n"),
    );
    expect([...beoordeling.benchmarkOutputPaths].sort()).toEqual([
      "docs/lyra-knowledge/benchmarks/before/20260928-1200/manifest.json",
      "docs/v1.0.6/benchmarks/before-20260928-1200-r1/golden.json",
    ]);
    expect(beoordeling.unexpectedUntrackedPaths).toEqual([]);
  });

  it("een gewijzigd GETRACKT baselinebestand telt als tracked-modified (FAIL) — de echte integriteitsgarantie", () => {
    const beoordeling = beoordeelWerkmapSchoonheid(" M src/server/agent/agent.ts\n");
    expect(beoordeling.trackedModifiedPaths).toEqual(["src/server/agent/agent.ts"]);
  });

  it("een verwijderd of nieuw-toegevoegd (staged) getrackt bestand telt ook als tracked-modified (FAIL)", () => {
    const beoordeling = beoordeelWerkmapSchoonheid("D  src/server/agent/agent.ts\nA  scripts/random-nieuw-bestand.ts\n");
    expect([...beoordeling.trackedModifiedPaths].sort()).toEqual(["scripts/random-nieuw-bestand.ts", "src/server/agent/agent.ts"]);
  });

  it("een onverwacht, niet-orchestrator-eigen untracked bestand telt als onverwacht (FAIL)", () => {
    const beoordeling = beoordeelWerkmapSchoonheid("?? scripts/iets-vreemds-dat-hier-niet-hoort.ts\n");
    expect(beoordeling.unexpectedUntrackedPaths).toEqual(["scripts/iets-vreemds-dat-hier-niet-hoort.ts"]);
    expect(beoordeling.orchestratorArtifacts).toEqual([]);
  });

  it("een volledig niet-getrackte map verzameld tot één regel (git zonder --untracked-files=all) matcht GEEN losse whitelist-pad — orchestrator moet daarom altijd --untracked-files=all gebruiken", () => {
    // scripts/lyra-master/ bestaat niet op de bevroren baseline 588c1e5; git
    // toont zo'n volledig-nieuwe map standaard als ÉÉN regel, niet per bestand.
    // Dit is precies wat tijdens het echt testen van deze reparatie in de
    // sandbox werd ontdekt: zonder --untracked-files=all zou de classifier
    // "scripts/lyra-master/" als onverwacht zien, ondanks dat de losse
    // bestanden erin stuk voor stuk op de whitelist staan.
    const beoordeling = beoordeelWerkmapSchoonheid("?? scripts/lyra-master/\n");
    expect(beoordeling.unexpectedUntrackedPaths).toEqual(["scripts/lyra-master/"]);
    expect(beoordeling.orchestratorArtifacts).toEqual([]);
  });

  it("mengt correct: getolereerde helpers/output naast een echte schending worden apart gerapporteerd, niet gemaskeerd", () => {
    const beoordeling = beoordeelWerkmapSchoonheid(
      ["?? scripts/lyra-master/smoke-import.ts", " M src/server/agent/agent.ts", "?? docs/v1.0.6/benchmarks/before-x-r1/golden.json", "?? scripts/iets-vreemds.ts", ""].join(
        "\n",
      ),
    );
    expect(beoordeling.orchestratorArtifacts).toEqual(["scripts/lyra-master/smoke-import.ts"]);
    expect(beoordeling.trackedModifiedPaths).toEqual(["src/server/agent/agent.ts"]);
    expect(beoordeling.benchmarkOutputPaths).toEqual(["docs/v1.0.6/benchmarks/before-x-r1/golden.json"]);
    expect(beoordeling.unexpectedUntrackedPaths).toEqual(["scripts/iets-vreemds.ts"]);
  });
});

describe("headMatchtBaseline (verkeerde HEAD → FAIL)", () => {
  it("is true als HEAD (volledig of afgekort) met de baseline begint", () => {
    expect(headMatchtBaseline("588c1e5a0d5bd8488fa9a46bc605695e579c6f4d", "588c1e5")).toBe(true);
    expect(headMatchtBaseline("588c1e5", "588c1e5")).toBe(true);
  });

  it("is false bij een andere commit — de echte 'verkeerde HEAD'-regressie", () => {
    expect(headMatchtBaseline("c229789e8d8e1aab1ec8c6287e8fd5f178ade900", "588c1e5")).toBe(false);
  });
});
