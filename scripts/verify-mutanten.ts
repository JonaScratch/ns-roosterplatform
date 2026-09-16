import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * De tests testen.
 *
 * ## Waarom een groene testsuite niets bewijst
 *
 * Een test die altijd slaagt, slaagt ook wanneer de code kapot is. Dat klinkt
 * flauw tot je het meemaakt: in dit project stond in de eindvalidatie een
 * verschuiving van één in de weekindex, de testfixture had dezelfde
 * verschuiving, en de suite stond maandenlang op groen terwijl de validator op
 * echte gegevens nul toewijzingen bekeek. Twee fouten die elkaar opheffen zien
 * er precies zo uit als geen fouten.
 *
 * Dit script breekt de code met opzet en kijkt of de tests dat merken. Elke
 * mutatie hieronder is een fout die iemand echt zou kunnen maken — een
 * omgedraaide vergelijking, een weggelaten controle, een verkeerde sleutel.
 * Blijft de suite groen, dan is dat een gat in de dekking en geen succes.
 *
 * ## Waarom de mutaties in dit bestand staan en niet automatisch worden bedacht
 *
 * Een mutatiegenerator die willekeurig operatoren omdraait, levert honderden
 * mutanten op waarvan de meeste onbereikbaar of betekenisloos zijn, en een
 * percentage dat vooral over de generator gaat. De mutaties hieronder zijn
 * gekozen: het zijn de fouten waar dit systeem echt aan kapot gaat.
 *
 * ## Veiligheid
 *
 * Elk bestand wordt vóór de mutatie ingelezen en daarna onvoorwaardelijk
 * teruggezet, ook wanneer de test crasht. Blijft er toch iets staan, dan meldt
 * het script dat met naam en toenaam — een half gemuteerde broncode is erger
 * dan geen meting.
 *
 * Draaien met: npm run verify:mutanten
 */

const WORTEL = resolve(__dirname, "..");

interface Mutant {
  /** Waar deze mutatie over gaat, in gewone taal. */
  readonly naam: string;
  readonly bestand: string;
  readonly van: string;
  readonly naar: string;
  /** De tests die dit horen te vangen. Leeg betekent: de hele suite. */
  readonly tests: readonly string[];
}

const MUTANTEN: readonly Mutant[] = [
  // ── Rotatie ──────────────────────────────────────────────────────────────
  {
    naam: "rotatie: de wikkeling naar het begin van de cyclus valt weg",
    bestand: "src/domain/roster-rotation.ts",
    van: "const genormaliseerd = ((positie % anchor.lineCount) + anchor.lineCount) % anchor.lineCount;",
    naar: "const genormaliseerd = positie % anchor.lineCount;",
    tests: ["tests/domain/rotatie.test.ts"],
  },
  {
    naam: "rotatie: het anker telt vanaf nul in plaats van vanaf één",
    bestand: "src/domain/roster-rotation.ts",
    van: "const positie = (anchor.anchorRuleIndex - 1 + verstreken) % anchor.lineCount;",
    naar: "const positie = (anchor.anchorRuleIndex + verstreken) % anchor.lineCount;",
    tests: ["tests/domain/rotatie.test.ts"],
  },

  // ── Diensten en de bron ──────────────────────────────────────────────────
  {
    naam: "diensten: een dienst over middernacht krijgt geen dagcorrectie",
    bestand: "src/server/import/roster-pdf.ts",
    van: "  if (eind <= start) {\n    eind += 24 * 60;\n  }",
    naar: "  if (eind < -1) {\n    eind += 24 * 60;\n  }",
    tests: ["tests/import/roosterblad-pdf.test.ts"],
  },
  {
    naam: "diensten: lege celfragmenten worden overgeslagen, weekdagen schuiven op",
    bestand: "src/server/import/roster-pdf.ts",
    van: "    const a = rest[index] ?? \"\";",
    naar: "    const a = rest.filter((deel) => deel !== \"\")[index] ?? \"\";",
    tests: ["tests/import/roosterblad-pdf.test.ts"],
  },
  {
    naam: "diensten: een onleesbare cel wordt als rustdag gelezen",
    bestand: "src/server/import/dordrecht-source.ts",
    van: "    default:\n      return null;\n  }\n}",
    naar: "    default:\n      return RosterPositionType.RUST;\n  }\n}",
    tests: ["tests/import/roosterblad-pdf.test.ts"],
  },

  // ── Structuur en ankers ──────────────────────────────────────────────────
  {
    naam: "wijzigingsblad: een ankerdag mag ineens verplaatst worden",
    bestand: "src/domain/roster-structure.ts",
    van: "  return { verdict: \"ANCHOR_LOCKED\", from: input.baseline.slotType, to };",
    naar: "  return { verdict: \"NO_STRUCTURAL_OBJECTION\" };",
    tests: [],
  },
  {
    naam: "structuur: reservedagen worden per week afgerond in plaats van verdeeld",
    bestand: "src/domain/structure-generation.ts",
    van: "    let resRest = verdeel(reserveDaysPerCycle, lineCount, regel);",
    naar: "    let resRest = Math.round(reserveDaysPerCycle / lineCount);",
    tests: ["tests/domain/structuurgeneratie.test.ts"],
  },
  {
    naam: "structuur: de reeks dienstdagen wordt niet over de regelgrens gelezen",
    bestand: "src/domain/structure-generation.ts",
    van: "  const reeks = [...lines, ...lines].flatMap((line) => line.days);",
    naar: "  const reeks = [...lines].flatMap((line) => line.days);",
    tests: ["tests/domain/structuurgeneratie.test.ts"],
  },

  {
    // Twee keer is deze fout gemaakt: in de optimizerinvoer en in het
    // scoremodel. Beide keren kwam er gewoon een getal uit en zag niemand het.
    // Dit is de mutant die hem voortaan vangt.
    naam: "meting: een dienst wordt weer op nummer alleen opgezocht",
    bestand: "src/server/optimizer/metrics.ts",
    van: "      index.set(dutyKeyOf(duty.code, weekday), duty);",
    naar: "      index.set(duty.code, duty);",
    tests: ["tests/optimizer/scoremodel.test.ts", "tests/optimizer/baseline.test.ts"],
  },

  // ── Eindvalidatie ────────────────────────────────────────────────────────
  {
    naam: "eindvalidatie: een dubbele toewijzing op dezelfde dag telt niet meer",
    bestand: "src/server/rules-engine/final-validator.ts",
    van: "    if (seen.has(key)) {\n      duplicates.push(key);\n    }",
    naar: "    if (false) {\n      duplicates.push(key);\n    }",
    tests: ["tests/optimizer/mutanten.test.ts"],
  },
  {
    // Deze mutant hing aan een regel uit de oude verdictfunctie, die één
    // booleaanse uitkomst gaf. Sinds de uitkomst is opgesplitst in vijf
    // toestanden staat die regel er niet meer, en draaide de mutant stil niet
    // meer mee — een uitgezette controle die niemand had uitgezet. Hij is
    // opnieuw verankerd aan de opvolger: het niet-toetsbare deel van een
    // kandidaat moet nog steeds blokkeren.
    naam: "eindvalidatie: een kandidaat waarvan een deel niet is getoetst, geldt als schoon",
    bestand: "src/domain/candidate.ts",
    van: "  if (tally.unvalidatableAssignments > 0) {\n    return \"INVALID_STRUCTURE\";\n  }",
    naar: "  if (false) {\n    return \"INVALID_STRUCTURE\";\n  }",
    tests: ["tests/optimizer/mutanten.test.ts", "tests/domain/kandidaat-status.test.ts"],
  },
  {
    // De nieuwe scheiding zelf: publicatie mag nooit losraken van een bevestigd
    // regelbestand. Zou iemand die voorwaarde weghalen, dan blijft alles groen
    // behalve deze meting.
    naam: "publicatie: een onbevestigd regelbestand blokkeert niet meer",
    bestand: "src/domain/candidate.ts",
    van: "    input.rulesetLegallyVerified &&",
    naar: "    true &&",
    tests: ["tests/domain/kandidaat-status.test.ts"],
  },
  {
    naam: "eindvalidatie: de weekindex telt weer vanaf nul",
    bestand: "src/server/rules-engine/final-validator.ts",
    van: "        const entry = byKey.get(`${week + 1}|${weekday}`);",
    naar: "        const entry = byKey.get(`${week}|${weekday}`);",
    tests: ["tests/optimizer/mutanten.test.ts"],
  },

  // ── Beschikbare diensten ─────────────────────────────────────────────────
  {
    naam: "beschikbare diensten: inschrijven mag ook nadat het venster is gesloten",
    bestand: "src/domain/available-duty-state.ts",
    van: "  return state === \"OPEN\";\n}",
    naar: "  return state !== \"ALLOCATED\";\n}",
    tests: ["tests/domain/beschikbare-dienst-toestand.test.ts"],
  },
  {
    naam: "beschikbare diensten: een toegewezen dienst kan weer opengesteld worden",
    bestand: "src/domain/available-duty-state.ts",
    van: "  ALLOCATED: [],",
    naar: "  ALLOCATED: [\"OPEN\"],",
    tests: ["tests/domain/beschikbare-dienst-toestand.test.ts"],
  },

  // ── Export ───────────────────────────────────────────────────────────────
  {
    naam: "export: het simulatiestempel verdwijnt van het blad",
    bestand: "src/server/export/roster-sheet-layout.ts",
    van: "  if (sheet.simulation) {\n    uit.push({ kind: \"watermark\", value: sheet.simulationLabel });\n  }",
    naar: "  if (false) {\n    uit.push({ kind: \"watermark\", value: sheet.simulationLabel });\n  }",
    tests: ["tests/export/roosterblad-pdf.test.ts"],
  },
  {
    naam: "export: haakjes uit de database worden niet ontsnapt",
    bestand: "src/server/export/pdf-writer.ts",
    van: "    if (teken === \"(\" || teken === \")\" || teken === \"\\\\\") {\n      uit += `\\\\${teken}`;",
    naar: "    if (false) {\n      uit += `\\\\${teken}`;",
    tests: ["tests/export/roosterblad-pdf.test.ts"],
  },
  {
    naam: "export: regels die niet op de pagina passen vallen weg",
    bestand: "src/server/export/roster-sheet-layout.ts",
    van: "  const aantal = Math.max(1, Math.ceil(sheet.lines.length / LINES_PER_SHEET));",
    naar: "  const aantal = 1;",
    tests: ["tests/export/roosterblad-pdf.test.ts"],
  },

  // ── Dienstidentiteit ─────────────────────────────────────────────────────
  {
    naam: "dienstidentiteit: dubbel zijn wordt weer op nummer alleen bepaald",
    bestand: "src/server/validation/duty-package.ts",
    van: "    const identiteit = `${row.code}|${row.weekdag}`;",
    naar: "    const identiteit = row.code;",
    tests: ["tests/import/dienstenpakket.test.ts"],
  },
  {
    naam: "dienstidentiteit: het verschil met de vorige versie kijkt niet naar de weekdag",
    bestand: "src/server/import/duty-import.ts",
    van: "  const sleutel = (duty: ComparableDuty): string => `${duty.code}|${duty.weekday}`;",
    naar: "  const sleutel = (duty: ComparableDuty): string => duty.code;",
    tests: ["tests/import/dienstenpakket.test.ts"],
  },
];

interface Uitkomst {
  readonly mutant: Mutant;
  readonly gevangen: boolean;
  readonly toelichting: string;
}

/**
 * De testrunner rechtstreeks aanroepen.
 *
 * Niet via `npx`. Op Windows is dat een `.cmd`, en die weigert Node sinds
 * versie 20 te starten zonder shell: `spawnSync npx.cmd EINVAL`. Dat is geen
 * testfout maar een startfout — en omdat deze meting "de testrun mislukte" als
 * "de mutant is gevangen" leest, stond hier achttien van de achttien terwijl er
 * geen enkele test was gedraaid. Precies de valse groene uitkomst waar deze
 * meting tegen bedoeld is, in de meting zelf.
 *
 * Daarom nu het JS-startpunt van vitest met de node die dit script draait. Dat
 * kan niet stilzwijgend niet-starten: gebeurt dat toch, dan is er geen uitvoer,
 * en `beschrijfFalen` zegt dat met zoveel woorden.
 */
function draaiTests(bestanden: readonly string[]): { geslaagd: boolean; uitvoer: string } {
  const vitest = join(WORTEL, "node_modules", "vitest", "vitest.mjs");
  try {
    const uitvoer = execFileSync(
      process.execPath,
      [vitest, "run", ...bestanden],
      { cwd: WORTEL, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 },
    );
    return { geslaagd: true, uitvoer };
  } catch (error) {
    const melding = error as { stdout?: string; stderr?: string; message?: string };
    const uitvoer = `${melding.stdout ?? ""}${melding.stderr ?? ""}`;
    return {
      geslaagd: false,
      uitvoer: uitvoer.trim().length > 0 ? uitvoer : `GEEN UITVOER: ${melding.message ?? ""}`,
    };
  }
}

/**
 * Wat er precies rood werd.
 *
 * Hier stond eerst alleen een telling, en die kwam er als "?" uit: vitest zet
 * kleurcodes tússen het getal en het woord "failed", dus het patroon vond
 * niets. Achttien mutanten met "? tests werden rood" ernaast leest als een
 * geslaagde meting terwijl er niets meetbaars in staat — precies het soort
 * groene uitkomst waar deze hele meting tegen bedoeld is.
 *
 * Er wordt daarom ontkleurd én de naam van de eerste falende test getoond. Een
 * mutant die de suite laat crashen in plaats van een bewering te breken, valt
 * dan op: er staat geen testnaam bij.
 */
function beschrijfFalen(uitvoer: string): string {
  const schoon = uitvoer.replace(/\[[0-9;]*m/g, "");
  const telling = /Tests\s+(\d+) failed/.exec(schoon);
  const eerste = /FAIL\s+(.+?)\n/.exec(schoon) ?? /×\s+(.+?)\n/.exec(schoon);
  const naam = eerste ? eerste[1].trim() : null;

  if (!telling) {
    return naam
      ? `de testrun brak af bij ${naam}`
      : "GEEN BEWERING ROOD — de testrun mislukte om een andere reden; dit telt niet als gevangen";
  }
  return `${telling[1]} bewering(en) rood${naam ? `, o.a. ${naam}` : ""}`;
}

/**
 * Is deze mutant werkelijk door een test gevangen?
 *
 * "De testrun eindigde met een foutcode" is niet genoeg. Een runner die niet
 * start, eindigt ook met een foutcode. Er moet een bewering rood zijn geworden;
 * anders is er niets gemeten.
 */
function isGevangen(resultaat: { geslaagd: boolean; uitvoer: string }): boolean {
  if (resultaat.geslaagd) {
    return false;
  }
  const schoon = resultaat.uitvoer.replace(/\[[0-9;]*m/g, "");
  return /Tests\s+\d+ failed/.test(schoon);
}

function main(): void {
  console.log("MUTATIETOETS — DOEN DE TESTS WAT ZE BELOVEN?");
  console.log("═".repeat(76));
  console.log(
    `\n${MUTANTEN.length} opzettelijke fouten. Elke fout hoort minstens één test rood te maken.`,
  );

  const uitkomsten: Uitkomst[] = [];
  const nietToegepast: string[] = [];

  for (const mutant of MUTANTEN) {
    const pad = join(WORTEL, mutant.bestand);
    const origineel = readFileSync(pad, "utf8");

    if (!origineel.includes(mutant.van)) {
      // De code is veranderd en deze mutatie past niet meer. Dat is geen
      // geslaagde toets: hij is helemaal niet uitgevoerd, en dat moet blijken.
      nietToegepast.push(`${mutant.naam} — het fragment staat niet (meer) in ${mutant.bestand}`);
      continue;
    }

    let uitkomst: Uitkomst;
    try {
      writeFileSync(pad, origineel.replace(mutant.van, mutant.naar), "utf8");
      const resultaat = draaiTests(mutant.tests.length > 0 ? mutant.tests : []);
      uitkomst = {
        mutant,
        gevangen: isGevangen(resultaat),
        toelichting: resultaat.geslaagd ? "de tests bleven groen" : beschrijfFalen(resultaat.uitvoer),
      };
    } finally {
      // Onvoorwaardelijk terugzetten, ook wanneer de testrun ontplofte.
      writeFileSync(pad, origineel, "utf8");
      const na = readFileSync(pad, "utf8");
      if (na !== origineel) {
        console.log(`\n  !! ${mutant.bestand} is NIET teruggezet. Controleer dit bestand.`);
      }
    }

    uitkomsten.push(uitkomst);
    console.log(
      `  ${uitkomst.gevangen ? "✓" : "✗"} ${mutant.naam}\n      ${uitkomst.toelichting}`,
    );
  }

  const gevangen = uitkomsten.filter((uitkomst) => uitkomst.gevangen).length;
  const gemist = uitkomsten.filter((uitkomst) => !uitkomst.gevangen);

  console.log(`\n${"═".repeat(76)}`);
  console.log(`${gevangen} van de ${uitkomsten.length} opzettelijke fouten werd gevangen.`);

  if (gemist.length > 0) {
    console.log("\nNIET gevangen — dit zijn gaten in de dekking:");
    for (const uitkomst of gemist) {
      console.log(`  · ${uitkomst.mutant.naam}`);
      console.log(`      ${uitkomst.mutant.bestand}`);
    }
  }
  if (nietToegepast.length > 0) {
    console.log("\nNiet uitgevoerd (de code is veranderd):");
    for (const regel of nietToegepast) {
      console.log(`  · ${regel}`);
    }
  }

  if (gemist.length > 0 || nietToegepast.length > 0) {
    process.exitCode = 1;
  }
}

main();
