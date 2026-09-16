import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { dutyInstancesOf, parseRosterPdf, pdfTextFragments } from "@/server/import/roster-pdf";
import { pdfPages } from "@/server/import/pdf-text";

/**
 * De aangeleverde bronnen: wat is er, en klopt wat we eruit lezen?
 *
 * ## Waarom dit vóór alle andere controles komt
 *
 * Elke bewering verderop in dit platform — 223 diensten, deze roosterlijnen,
 * dit aantal reservedagen — leunt op deze bestanden. Als de lezing van de bron
 * al scheef staat, is elke groene test daarna een groene test over de verkeerde
 * werkelijkheid. Dit script zegt daarom eerst: dit zijn de bestanden, dit is
 * hun vingerafdruk, en dit halen wij eruit.
 *
 * ## Waarom er drie keer geteld wordt
 *
 * Eén telling die op het verwachte getal uitkomt, bewijst vooral dat de teller
 * en de verwachting uit dezelfde pen komen. Daarom telt dit script het aantal
 * diensten op drie manieren die elkaars fouten niet delen:
 *
 *   1. door de ontlede dagcellen te lopen;
 *   2. door in de ruwe brontekst de tijdvakken te tellen, buiten de ontleding om;
 *   3. door per regel de celduren op te tellen en te vergelijken met de
 *      weeklengte die het blad zelf opgeeft.
 *
 * De derde is de scherpste: die merkt een cel die is weggevallen of dubbel is
 * gelezen, ook wanneer het totaal toevallig klopt.
 *
 * ## Waarom het doelgetal hier niet wordt afgedwongen
 *
 * Het verwachte aantal van 223 staat hieronder als vergelijkingspunt, niet als
 * norm. Wijkt de bron ervan af, dan meldt dit script het verschil en faalt het;
 * het past de telling niet aan totdat het uitkomt. Wat de bron zegt, is wat er
 * is.
 *
 * Draaien met: npm run verify:bronnen
 */

const WORTEL = resolve(__dirname, "..");
const BRONMAP = join(WORTEL, "tests", "fixtures", "dordrecht-bronnen");

/**
 * Het eerder vastgestelde canonieke aantal diensten per weekdag.
 *
 * Dit is een vergelijkingspunt uit een eerdere fase. Het is uitdrukkelijk geen
 * waarheid waaraan de bron zich moet aanpassen.
 */
const VERWACHT_PER_WEEKDAG = [0, 34, 36, 34, 35, 33, 26, 25] as const;
const VERWACHT_TOTAAL = 223;

const WEEKDAG = ["", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

/** Wat een bestand werkelijk is, los van wat de naam belooft. */
const HANDTEKENINGEN: readonly { readonly hex: string; readonly soort: string }[] = [
  { hex: "25504446", soort: "PDF" },
  { hex: "89504e47", soort: "PNG" },
  { hex: "504b0304", soort: "ZIP (OOXML, bijv. .docx)" },
  { hex: "ffd8ff", soort: "JPEG" },
  { hex: "3c737667", soort: "SVG (XML)" },
  { hex: "3c3f786d", soort: "XML (mogelijk SVG)" },
];

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function werkelijkeSoort(bytes: Buffer): string {
  const kop = bytes.subarray(0, 8).toString("hex");
  for (const handtekening of HANDTEKENINGEN) {
    if (kop.startsWith(handtekening.hex)) {
      return handtekening.soort;
    }
  }
  return `onbekend (${kop})`;
}

function minuten(waarde: string | null): number {
  if (!waarde) {
    return 0;
  }
  const treffer = /^(\d+):(\d{2})$/.exec(waarde.trim());
  return treffer ? Number(treffer[1]) * 60 + Number(treffer[2]) : Number.NaN;
}

function uurNotatie(totaal: number): string {
  return `${Math.floor(totaal / 60)}:${String(totaal % 60).padStart(2, "0")}`;
}

function main(): void {
  console.log("AANGELEVERDE BRONNEN");
  console.log("═".repeat(74));

  if (!existsSync(BRONMAP)) {
    console.log(
      `\nBLOCKED_BY_MISSING_SOURCE — de bronmap ${BRONMAP} bestaat niet. Er is niets om te lezen.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── 1. Wat is er aangeleverd ─────────────────────────────────────────────
  console.log("\n1. Inventaris");
  const bestanden = readdirSync(BRONMAP).sort();
  if (bestanden.length === 0) {
    console.log("  BLOCKED_BY_MISSING_SOURCE — de bronmap is leeg.");
    process.exitCode = 1;
    return;
  }
  for (const naam of bestanden) {
    const pad = join(BRONMAP, naam);
    const bytes = readFileSync(pad);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const soort = werkelijkeSoort(bytes);
    const extensie = naam.slice(naam.lastIndexOf(".") + 1).toUpperCase();
    const klopt = soort.startsWith(extensie) || (extensie === "DOCX" && soort.startsWith("ZIP"));
    console.log(
      `  ${naam}\n      ${Math.round(statSync(pad).size / 1024)} kB · ${soort}` +
        `${klopt ? "" : `  ⚠ de extensie .${extensie.toLowerCase()} belooft iets anders`}` +
        `\n      sha256 ${hash}`,
    );
  }

  // ── 2. De roosterbladen ──────────────────────────────────────────────────
  console.log("\n2. De roosterbladen");
  const bladnamen = bestanden.filter(
    (naam) => naam.endsWith(".pdf") && !/CAO|Roosterkaders/i.test(naam),
  );
  if (bladnamen.length === 0) {
    console.log("  BLOCKED_BY_MISSING_SOURCE — er is geen enkel roosterblad aangeleverd.");
    process.exitCode = 1;
    return;
  }

  const perWeekdagUitCellen = [0, 0, 0, 0, 0, 0, 0, 0];
  let tijdvakkenInBron = 0;
  let regelsMetAfwijkendeSom = 0;
  let regelsTotaal = 0;
  let cellenTotaal = 0;
  let onleesbareCellen = 0;
  const instanties: {
    blad: string;
    dutyCode: string;
    weekday: number;
    startMinute: number;
    endMinute: number;
  }[] = [];

  for (const naam of bladnamen) {
    const bytes = readFileSync(join(BRONMAP, naam));
    const document = parseRosterPdf(bytes);
    const diensten = dutyInstancesOf(document);

    const soorten: Record<string, number> = {};
    for (const regel of document.lines) {
      for (const cel of regel.cells) {
        soorten[cel.kind] = (soorten[cel.kind] ?? 0) + 1;
      }
    }

    // Telling 2: de tijdvakken zoals ze letterlijk in de bron staan, zonder
    // tussenkomst van de ontleding. Een dienstcel heeft er precies één; een
    // rust-, reserve- of WTV-cel heeft er geen.
    const tijdvakken = pdfTextFragments(bytes).filter((deel) =>
      /^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*$/.test(deel),
    ).length;
    tijdvakkenInBron += tijdvakken;

    console.log(`\n  ${naam}`);
    console.log(
      `      "${document.meta.roosterNaam}" · ${document.meta.standplaats} · rol ${document.meta.rol}`,
    );
    console.log(
      `      variant ${document.meta.roostervariant} · ${document.meta.startdatum} t/m ` +
        `${document.meta.einddatum} · ${document.meta.status}`,
    );
    console.log(
      `      ${document.lines.length} regels · ${document.lines.length * 7} cellen · ` +
        `${diensten.length} diensten · ${JSON.stringify(soorten)}`,
    );

    regelsTotaal += document.lines.length;
    cellenTotaal += document.lines.length * 7;
    onleesbareCellen += document.unparsed.length;
    if (document.unparsed.length > 0) {
      console.log(`      onleesbaar: ${JSON.stringify(document.unparsed.slice(0, 8))}`);
    }

    // Telling 3: de celduren van een regel moeten optellen tot de weeklengte
    // die het blad zelf noemt.
    for (const regel of document.lines) {
      const som = regel.cells.reduce((totaal, cel) => totaal + minuten(cel.duration), 0);
      const opgegeven = minuten(regel.weekHoursIncludingBreak);
      if (som !== opgegeven) {
        regelsMetAfwijkendeSom += 1;
        console.log(
          `      regel ${regel.lineNumber}: celduren ${uurNotatie(som)} tegenover ` +
            `opgegeven ${regel.weekHoursIncludingBreak}`,
        );
      }
    }

    for (const dienst of diensten) {
      perWeekdagUitCellen[dienst.weekday] += 1;
      instanties.push({ blad: naam, ...dienst });
    }
  }

  // ── 3. De drie tellingen ─────────────────────────────────────────────────
  console.log("\n3. De tellingen");
  const totaalUitCellen = perWeekdagUitCellen.reduce((a, b) => a + b, 0);
  console.log(`  telling 1 (ontlede dagcellen):        ${totaalUitCellen}`);
  console.log(`  telling 2 (tijdvakken in de ruwe bron): ${tijdvakkenInBron}`);
  console.log(
    `  telling 3 (urenbehoud per regel):     ${regelsTotaal - regelsMetAfwijkendeSom}/${regelsTotaal} regels sluitend`,
  );

  toets(
    "de ontleding en de ruwe bron komen op hetzelfde aantal diensten uit",
    totaalUitCellen === tijdvakkenInBron,
    `${totaalUitCellen} tegenover ${tijdvakkenInBron}`,
  );
  toets(
    "op elke regel tellen de celduren op tot de weeklengte die het blad opgeeft",
    regelsMetAfwijkendeSom === 0,
    `${regelsMetAfwijkendeSom} van ${regelsTotaal} regels sluiten niet`,
  );
  toets(
    "elke dagcel is gelezen; geen enkele is als onbekend blijven staan",
    onleesbareCellen === 0,
    `${onleesbareCellen} van ${cellenTotaal} cellen konden niet worden geplaatst`,
  );

  // ── 4. Naast het canonieke aantal ────────────────────────────────────────
  console.log("\n4. Naast het eerder vastgestelde aantal");
  let afwijkendeDagen = 0;
  for (let weekdag = 1; weekdag <= 7; weekdag += 1) {
    const gemeten = perWeekdagUitCellen[weekdag];
    const verwacht = VERWACHT_PER_WEEKDAG[weekdag];
    const gelijk = gemeten === verwacht;
    if (!gelijk) {
      afwijkendeDagen += 1;
    }
    console.log(
      `  ${WEEKDAG[weekdag].padEnd(10)} bron ${String(gemeten).padStart(3)} · ` +
        `eerder vastgesteld ${String(verwacht).padStart(3)} ${gelijk ? "✓" : "✗"}`,
    );
  }
  console.log(
    `  ${"totaal".padEnd(10)} bron ${String(totaalUitCellen).padStart(3)} · ` +
      `eerder vastgesteld ${String(VERWACHT_TOTAAL).padStart(3)}`,
  );
  toets(
    "de aangeleverde bron komt per weekdag uit op de eerder vastgestelde telling",
    afwijkendeDagen === 0 && totaalUitCellen === VERWACHT_TOTAAL,
    "SOURCE_CONFLICT: de bron wijkt af van het eerder vastgestelde aantal. Niet de telling " +
      "aanpassen; eerst uitzoeken welke van de twee de werkelijkheid is.",
  );

  // ── 5. Identiteit: niets dubbel, niets tegenstrijdig ─────────────────────
  console.log("\n5. Dienstidentiteit");
  const perIdentiteit = new Map<string, typeof instanties>();
  for (const instantie of instanties) {
    const sleutel = `${instantie.dutyCode}|${instantie.weekday}`;
    const bestaand = perIdentiteit.get(sleutel);
    if (bestaand) {
      bestaand.push(instantie);
    } else {
      perIdentiteit.set(sleutel, [instantie]);
    }
  }

  const dubbel: string[] = [];
  const tegenstrijdig: string[] = [];
  for (const [sleutel, groep] of perIdentiteit) {
    if (groep.length > 1) {
      dubbel.push(`${sleutel} op ${[...new Set(groep.map((x) => x.blad))].join(", ")}`);
    }
    const tijden = new Set(groep.map((x) => `${x.startMinute}-${x.endMinute}`));
    if (tijden.size > 1) {
      tegenstrijdig.push(`${sleutel}: ${[...tijden].join(" / ")}`);
    }
  }

  console.log(`  unieke dienstnummers over de week: ${new Set(instanties.map((x) => x.dutyCode)).size}`);
  console.log(`  unieke identiteiten (nummer + weekdag): ${perIdentiteit.size}`);
  toets(
    "geen dienst komt twee keer voor in de bron",
    dubbel.length === 0,
    dubbel.slice(0, 6).join(" · "),
  );
  toets(
    "dezelfde dienst heeft overal dezelfde tijden",
    tegenstrijdig.length === 0,
    tegenstrijdig.slice(0, 6).join(" · "),
  );

  // ── 6. Nachtdiensten ─────────────────────────────────────────────────────
  console.log("\n6. Diensten over middernacht");
  const overMiddernacht = instanties.filter((x) => x.endMinute > 24 * 60);
  console.log(`  ${overMiddernacht.length} diensten eindigen na middernacht`);
  for (const dienst of overMiddernacht.slice(0, 5)) {
    console.log(
      `      ${dienst.dutyCode} op ${WEEKDAG[dienst.weekday]}: ` +
        `${uurNotatie(dienst.startMinute)} → ${uurNotatie(dienst.endMinute % (24 * 60))} (volgende dag)`,
    );
  }
  toets(
    "geen enkele dienst heeft een negatieve of nul-duur",
    instanties.every((x) => x.endMinute > x.startMinute),
    "een eindtijd ligt niet ná de begintijd; de middernachtcorrectie klopt niet",
  );

  // ── 7. De normatieve bronnen ─────────────────────────────────────────────
  console.log("\n7. De normatieve bronnen");
  for (const naam of bestanden.filter((n) => /CAO|Roosterkaders/i.test(n))) {
    const bytes = readFileSync(join(BRONMAP, naam));
    const paginas = pdfPages(bytes);
    const tekens = paginas.join("").replace(/\s+/g, "").length;
    const leesbaar = tekens > 0;
    console.log(
      `  ${naam}\n      ${paginas.length} pagina's · ${tekens} tekens tekst · ` +
        `${leesbaar ? "machineleesbaar" : "SOURCE_PRESENT_NOT_MACHINE_READABLE"}`,
    );
    if (!leesbaar) {
      // Uitdrukkelijk geen fout: het bestand is er wél. Het is alleen een scan,
      // en daar valt zonder menselijke overname niets uit over te nemen. Wat
      // hier níet mag gebeuren, is dat iemand de inhoud "ongeveer" invult.
      console.log(
        "      Dit bestand bevat geen tekstlaag; het is beeldmateriaal. De regels " +
          "hierin mogen niet worden overgenomen zonder menselijke transcriptie.",
      );
    }
  }
  toets(
    "de CAO is machineleesbaar en kan tegen de regels worden gelegd",
    (() => {
      const cao = bestanden.find((n) => /CAO/i.test(n));
      return cao !== undefined && pdfPages(readFileSync(join(BRONMAP, cao))).join("").length > 1000;
    })(),
    "de CAO levert geen bruikbare tekst op",
  );

  console.log(`\n${"═".repeat(74)}`);
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main();
