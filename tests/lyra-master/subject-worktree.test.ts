import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  genormaliseerdWorktreePad,
  isWorktreeGeregistreerd,
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
