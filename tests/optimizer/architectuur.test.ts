import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * De scheiding tussen voorstellen en beoordelen, als test.
 *
 * ## Waarom dit een test is en geen afspraak
 *
 * "De validator gebruikt de optimizer niet" is precies het soort regel dat
 * overleeft tot iemand haast heeft. Dan wordt er één hulpfunctie hergebruikt,
 * en op dat moment is de tweede toetsing geen tweede toetsing meer: een fout in
 * de constraintvertaling geeft dan aan beide kanten hetzelfde antwoord en is
 * onvindbaar geworden. Deze test loopt de hele importgraaf af en faalt zodra
 * dat gebeurt.
 *
 * ## Waarom de optimizer niet bij de database mag
 *
 * De tweede test bewaakt het omgekeerde: de optimizer is een zuivere functie
 * zonder databaseverbinding. Hij kán dus geen roosterdag wijzigen, ook niet met
 * een bug. Alleen de servicelaag schrijft, en uitsluitend naar de tabel met
 * kandidaten.
 */

const SOURCE_ROOT = resolve(__dirname, "..", "..", "src");

/** Alle importpaden in een bestand, ruw uit de tekst gelezen. */
function importsOf(file: string): readonly string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

/** Vertaalt een importpad naar een bestand binnen `src`, of niets. */
function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SOURCE_ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(from, "..", specifier)
      : null;

  if (base === null) {
    return null;
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/** Alle bestanden die vanuit dit bestand bereikbaar zijn. */
function importClosure(entry: string): readonly string[] {
  const seen = new Set<string>([entry]);
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const specifier of importsOf(file)) {
      const resolved = resolveImport(file, specifier);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return [...seen];
}

function filesIn(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(directory, entry.name)]
        : [],
  );
}

describe("de eindvalidator staat los van de optimizer", () => {
  const validator = join(SOURCE_ROOT, "server", "rules-engine", "final-validator.ts");

  it("importeert nergens in zijn keten iets uit de optimizer", () => {
    const reachable = importClosure(validator);
    const offenders = reachable.filter((file) => file.includes(`${join("server", "optimizer")}`));

    expect(offenders).toEqual([]);
  });

  it("deelt met de optimizer uitsluitend domeintypen", () => {
    const shared = importsOf(validator).filter((specifier) => specifier.startsWith("@/"));

    // De kandidaat zelf woont in `domain/`, juist zodat beide kanten hem kennen
    // zonder elkaar te kennen.
    expect(shared).toContain("@/domain/candidate");
    expect(shared.every((specifier) => !specifier.includes("optimizer"))).toBe(true);
  });
});

describe("de optimizer kan niet bij de database", () => {
  const optimizerFiles = filesIn(join(SOURCE_ROOT, "server", "optimizer"));

  it("heeft bestanden om te controleren", () => {
    expect(optimizerFiles.length).toBeGreaterThan(3);
  });

  it("importeert nergens een databaseclient of de datalaag", () => {
    // De gegenereerde enums zijn losse typen zonder verbinding; die mogen wel.
    // Een client, de datalaag of de servicelaag niet: dat zijn precies de wegen
    // waarlangs een schrijfactie zou kunnen ontstaan.
    const offenders = optimizerFiles.flatMap((file) =>
      importsOf(file)
        .filter(
          (specifier) =>
            specifier.includes("generated/prisma/client") ||
            specifier.startsWith("@prisma/") ||
            specifier.includes("server/data") ||
            specifier.includes("server/services"),
        )
        .map((specifier) => `${file} → ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("bevat geen enkele schrijfactie naar roosterdagen", () => {
    const writes = optimizerFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /scheduledDuty|rosterLineDay|\.create\(|\.update\(|\.delete\(/.test(source)
        ? [file]
        : [];
    });

    expect(writes).toEqual([]);
  });
});
