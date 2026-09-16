import { resolveDayparts } from "@/domain/duty-classification";
import { type ParseIssue, type ParsedDuty, parseDutyPackage } from "@/server/validation/duty-package";
import { readDutyPackagePdf } from "./duty-package-pdf";
import { readDutySheet, toParsedDuties } from "./duty-package-sheet";
import { checkBinaryFile, checkFile, looksLikeFormula, stripBom } from "./file-safety";

/**
 * De importstraat voor dienstenpakketten.
 *
 * ## Waarom hier fases zitten en geen enkele functie
 *
 * Een import die in één keer slaagt of faalt, geeft de planner één antwoord:
 * "er zit een fout in". Daar kan hij niets mee. De levering doorloopt daarom
 * benoemde stappen — ingelezen, genormaliseerd, gevalideerd — en elke stap
 * bewaart wat hij zag. Loopt het ergens vast, dan staat er wát er vastliep en
 * bij welke regel.
 *
 * ## Waarom deze module niets wegschrijft
 *
 * Hier zit geen database. Dat maakt de hele straat toetsbaar op een echt
 * bestand zonder omgeving eromheen, en het houdt de beslissing "mag dit erin"
 * los van de handeling "zet het erin". De service eromheen schrijft weg; deze
 * module oordeelt.
 *
 * ## Wat er met de inhoud gebeurt
 *
 * Niets uitvoerbaars. De inhoud wordt als tekst gesplitst en gelezen. Cellen
 * die een spreadsheet als formule zou opvatten, worden gemeld en niet
 * stilzwijgend geaccepteerd: ze horen niet in een dienstenpakket, en verderop
 * belanden ze in een export die iemand met Excel opent.
 */

export type ImportStage =
  | "UPLOADED"
  | "PARSED"
  | "NORMALIZED"
  | "VALIDATED"
  | "REVIEW_REQUIRED"
  | "REJECTED";

export type ProblemSeverity = "BLOCKING" | "REVIEW" | "NOTICE";

export interface ImportProblem {
  readonly severity: ProblemSeverity;
  readonly line: number;
  readonly code: string;
  readonly message: string;
}

export interface ImportTotals {
  readonly rows: number;
  readonly duties: number;
  readonly vroeg: number;
  readonly laat: number;
  readonly nacht: number;
  readonly rangeer: number;
  readonly reserve: number;
  readonly overMidnight: number;
  readonly withoutBreak: number;
  readonly depots: readonly string[];
  readonly earliestStart: string | null;
  readonly latestEnd: string | null;
  readonly totalMinutes: number;
}

export interface ImportOutcome {
  readonly stage: ImportStage;
  readonly duties: readonly ParsedDuty[];
  readonly totals: ImportTotals;
  readonly problems: readonly ImportProblem[];
  readonly safeFilename: string;
  /** Mag dit pakket, na menselijke bevestiging, worden vastgelegd? */
  readonly importable: boolean;
}

const LEEG_TOTAAL: ImportTotals = {
  rows: 0,
  duties: 0,
  vroeg: 0,
  laat: 0,
  nacht: 0,
  rangeer: 0,
  reserve: 0,
  overMidnight: 0,
  withoutBreak: 0,
  depots: [],
  earliestStart: null,
  latestEnd: null,
  totalMinutes: 0,
};

const WEEKDAGNAMEN = [
  "",
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
  "zondag",
];

function weekdagNaam(weekday: number): string {
  return WEEKDAGNAMEN[weekday] ?? `weekdag ${weekday}`;
}

function tijd(minuten: number): string {
  const genormaliseerd = ((minuten % 1440) + 1440) % 1440;
  const uur = Math.floor(genormaliseerd / 60);
  const min = genormaliseerd % 60;
  return `${String(uur).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function blocking(issues: readonly ParseIssue[]): ImportProblem[] {
  return issues.map((issue) => ({
    severity: "BLOCKING" as const,
    line: issue.line,
    code: "PARSE",
    message: issue.message,
  }));
}

/**
 * Loopt de hele straat af.
 *
 * De uitkomst is nooit "geïmporteerd": dat is een handeling van een mens. Het
 * hoogste wat hier uit komt is `VALIDATED` — alles gelezen, alles gecontroleerd,
 * klaar om te bevestigen.
 */
export function runImport(input: {
  readonly filename: string;
  readonly content: string;
  /** De standplaats waar dit pakket voor bedoeld is. */
  readonly locationCode: string;
}): ImportOutcome {
  // ── Fase 1: het bestand zelf ───────────────────────────────────────────────
  const bestand = checkFile(input);
  if (!bestand.ok) {
    return {
      stage: "REJECTED",
      duties: [],
      totals: LEEG_TOTAAL,
      safeFilename: bestand.safeFilename,
      importable: false,
      problems: bestand.problems.map((message) => ({
        severity: "BLOCKING" as const,
        line: 0,
        code: "FILE",
        message,
      })),
    };
  }

  const inhoud = stripBom(input.content);
  const regels = inhoud.split(/\r?\n/).filter((regel) => regel.trim().length > 0);

  // ── Fase 2: lezen ──────────────────────────────────────────────────────────
  const gelezen = parseDutyPackage(inhoud);
  const dagdelen = dagdeelControle(gelezen.duties);
  const parsed = { ...gelezen, duties: dagdelen.duties };
  const problems: ImportProblem[] = [...blocking(parsed.issues), ...dagdelen.problems];

  // Formulecellen worden apart gemeld: het parseren struikelt er niet over,
  // maar ze horen niet in een dienstenpakket en mogen niet ongezien doorlopen
  // naar een export die iemand in Excel opent.
  regels.forEach((regel, index) => {
    regel.split(";").forEach((cel, kolom) => {
      const waarde = cel.trim();
      if (waarde.length > 1 && looksLikeFormula(waarde)) {
        problems.push({
          severity: "BLOCKING",
          line: index + 1,
          code: "FORMULA",
          message:
            `Kolom ${kolom + 1} begint met "${waarde[0]}" en wordt door een spreadsheet als ` +
            "formule uitgevoerd. Verwijder het teken of lever de waarde als tekst aan.",
        });
      }
    });
  });

  if (parsed.duties.length === 0) {
    return {
      stage: "REJECTED",
      duties: [],
      totals: { ...LEEG_TOTAAL, rows: Math.max(regels.length - 1, 0) },
      problems:
        problems.length > 0
          ? problems
          : [
              {
                severity: "BLOCKING",
                line: 0,
                code: "EMPTY",
                message: "Het bestand bevat geen diensten.",
              },
            ],
      safeFilename: bestand.safeFilename,
      importable: false,
    };
  }

  // ── Fase 3: normaliseren en tellen ─────────────────────────────────────────
  const totals = totalsOf(parsed.duties, regels.length - 1);

  // ── Fase 4: valideren tegen wat we van de standplaats weten ────────────────
  const verwacht = input.locationCode.toUpperCase();
  for (const duty of parsed.duties) {
    if (duty.depot !== verwacht) {
      problems.push({
        severity: "BLOCKING",
        line: 0,
        code: "DEPOT",
        message:
          `Dienst ${duty.code} staat op standplaats ${duty.depot}, maar dit pakket wordt ` +
          `geïmporteerd voor ${verwacht}. Diensten van een andere standplaats horen in een ` +
          "eigen pakket.",
      });
    }
    if (duty.endMinute > 1440) {
      // Geen probleem, wel iets om te zien: een dienst over middernacht raakt
      // twee kalenderdagen en telt anders in de rusttijden.
      problems.push({
        severity: "NOTICE",
        line: 0,
        code: "MIDNIGHT",
        message:
          `Dienst ${duty.code} loopt van ${tijd(duty.startMinute)} tot ${tijd(duty.endMinute)} ` +
          "en gaat over middernacht.",
      });
    }
  }

  const dubbel = duplicates(parsed.duties);
  for (const code of dubbel) {
    problems.push({
      severity: "BLOCKING",
      line: 0,
      code: "DUPLICATE",
      message: `Dienstnummer ${code} komt meerdere keren voor.`,
    });
  }

  const blokkerend = problems.filter((problem) => problem.severity === "BLOCKING");
  const teBeoordelen = problems.filter((problem) => problem.severity === "REVIEW");

  if (blokkerend.length > 0) {
    return {
      stage: "REJECTED",
      duties: parsed.duties,
      totals,
      problems,
      safeFilename: bestand.safeFilename,
      importable: false,
    };
  }

  return {
    stage: teBeoordelen.length > 0 ? "REVIEW_REQUIRED" : "VALIDATED",
    duties: parsed.duties,
    totals,
    problems,
    safeFilename: bestand.safeFilename,
    importable: true,
  };
}

/**
 * Dezelfde straat, maar voor een ingevuld Excel-sjabloon.
 *
 * De eerste twee fasen verschillen — een werkmap wordt anders geopend dan een
 * tekstbestand — en vanaf fase drie is het één weg. Dat is met opzet: zou elke
 * aanleverroute zijn eigen validatie krijgen, dan hangt het van het formaat af
 * of een dienst op de verkeerde standplaats wordt opgemerkt.
 */
export function runSheetImport(input: {
  readonly filename: string;
  readonly bytes: Buffer;
  readonly locationCode: string;
}): ImportOutcome {
  const bestand = checkBinaryFile({
    filename: input.filename,
    bytes: input.bytes,
    extension: ".xlsx",
  });
  if (!bestand.ok) {
    return afgewezen(bestand.safeFilename, bestand.problems, "BESTAND");
  }

  const gelezen = readDutySheet(input.bytes, input.locationCode.toUpperCase());
  const omgezet = toParsedDuties(gelezen.duties);
  const problems: ImportProblem[] = [...gelezen.problems, ...omgezet.problems].map(
    (probleem) => ({
      severity: probleem.severity,
      line: probleem.row,
      code: probleem.code,
      message:
        probleem.row > 0
          ? `Rij ${probleem.row}${probleem.column ? `, kolom ${probleem.column}` : ""}: ` +
            probleem.message
          : probleem.message,
    }),
  );

  return gemeenschappelijkeControle({
    duties: omgezet.duties,
    rows: gelezen.rowsRead,
    problems,
    safeFilename: bestand.safeFilename,
    locationCode: input.locationCode,
  });
}

/**
 * Dezelfde straat, maar voor een PDF-document.
 *
 * Deze route eindigt nooit hoger dan `REVIEW_REQUIRED`. Een PDF heeft geen
 * kolommen, alleen tekst op plekken; wat eruit komt is een voorstel dat een
 * mens naast de bron legt. Zie `duty-package-pdf.ts` voor waarom.
 */
export function runPdfImport(input: {
  readonly filename: string;
  readonly bytes: Buffer;
  readonly locationCode: string;
}): ImportOutcome & { readonly skippedLines: readonly string[] } {
  const bestand = checkBinaryFile({
    filename: input.filename,
    bytes: input.bytes,
    extension: ".pdf",
  });
  if (!bestand.ok) {
    return { ...afgewezen(bestand.safeFilename, bestand.problems, "BESTAND"), skippedLines: [] };
  }

  const gelezen = readDutyPackagePdf(input.bytes, input.locationCode.toUpperCase());
  const omgezet = toParsedDuties(gelezen.duties);
  const problems: ImportProblem[] = [...gelezen.problems, ...omgezet.problems].map(
    (probleem) => ({
      severity: probleem.severity,
      line: probleem.row,
      code: probleem.code,
      message: probleem.row > 0 ? `Regel ${probleem.row}: ${probleem.message}` : probleem.message,
    }),
  );

  // De uitkomst wordt hier bewust naar beoordeling getild, ook wanneer er geen
  // enkel probleem is gevonden. "Geen fouten gevonden" en "het klopt" zijn bij
  // een PDF niet hetzelfde.
  problems.push({
    severity: "REVIEW",
    line: 0,
    code: "PDF_ROUTE",
    message:
      `Uit dit document zijn ${gelezen.duties.length} diensten gelezen over ` +
      `${gelezen.pages} pagina's. Een PDF kent geen kolommen, dus loop de voorvertoning na ` +
      "voordat u bevestigt.",
  });

  const uitkomst = gemeenschappelijkeControle({
    duties: omgezet.duties,
    rows: gelezen.duties.length,
    problems,
    safeFilename: bestand.safeFilename,
    locationCode: input.locationCode,
  });
  return { ...uitkomst, skippedLines: gelezen.unreadableLines };
}

function afgewezen(
  safeFilename: string,
  meldingen: readonly string[],
  code: string,
): ImportOutcome {
  return {
    stage: "REJECTED",
    duties: [],
    totals: LEEG_TOTAAL,
    safeFilename,
    importable: false,
    problems: meldingen.map((message) => ({
      severity: "BLOCKING" as const,
      line: 0,
      code,
      message,
    })),
  };
}

/**
 * Geef reserve- en rangeerdiensten het dagdeel van hun aanvangstijd.
 *
 * Zonder dagdeel sluit geen roosterprofiel ze uit, en belandt een rangeerdienst
 * van 05:01 in Laat/Nacht. Elke aanleverroute loopt hierdoorheen, zodat het
 * dagdeel niet afhangt van het bestandsformaat. Zie `resolveDayparts`.
 */
function dagdeelControle(input: readonly ParsedDuty[]): {
  readonly duties: readonly ParsedDuty[];
  readonly problems: readonly ImportProblem[];
} {
  const uitkomst = resolveDayparts(input);
  const problems: ImportProblem[] = [];
  if (uitkomst.derived.length > 0) {
    const perCode = new Map<string, Set<string>>();
    for (const afgeleid of uitkomst.derived) {
      const set = perCode.get(afgeleid.code) ?? new Set<string>();
      set.add(afgeleid.period.toLowerCase());
      perCode.set(afgeleid.code, set);
    }
    problems.push({
      severity: "NOTICE",
      line: 0,
      code: "DAYPART_FROM_START_TIME",
      message:
        "Dagdeel afgeleid uit de aanvangstijd, omdat het nummer er geen geeft: " +
        [...perCode.entries()]
          .map(([code, dagdeel]) => `${code} (${[...dagdeel].join("/")})`)
          .join(", ") +
        ".",
    });
  }
  for (const onbepaald of uitkomst.unresolved) {
    problems.push({
      severity: "REVIEW",
      line: 0,
      code: "DAYPART_AMBIGUOUS",
      message:
        `Dienst ${onbepaald.code} (weekdag ${onbepaald.weekday}) krijgt geen dagdeel: ` +
        `${onbepaald.reason}. Zonder dagdeel sluit geen roosterprofiel deze dienst uit.`,
    });
  }
  return { duties: uitkomst.duties, problems };
}

/**
 * De controles die voor elke aanleverroute gelden.
 *
 * Standplaats, middernacht en dubbele diensten worden hier één keer nagelopen.
 * Wie een route toevoegt, krijgt ze er vanzelf bij.
 */
function gemeenschappelijkeControle(input: {
  readonly duties: readonly ParsedDuty[];
  readonly rows: number;
  readonly problems: readonly ImportProblem[];
  readonly safeFilename: string;
  readonly locationCode: string;
}): ImportOutcome {
  const problems = [...input.problems];
  const verwacht = input.locationCode.toUpperCase();

  const dagdelen = dagdeelControle(input.duties);
  const duties = dagdelen.duties;
  problems.push(...dagdelen.problems);

  for (const duty of duties) {
    if (duty.depot !== verwacht) {
      problems.push({
        severity: "BLOCKING",
        line: duty.sourceRow,
        code: "DEPOT",
        message:
          `Dienst ${duty.code} staat op standplaats ${duty.depot}, maar dit pakket wordt ` +
          `geïmporteerd voor ${verwacht}.`,
      });
    }
    if (duty.endMinute > 1440) {
      problems.push({
        severity: "NOTICE",
        line: duty.sourceRow,
        code: "MIDNIGHT",
        message:
          `Dienst ${duty.code} loopt van ${tijd(duty.startMinute)} tot ${tijd(duty.endMinute)} ` +
          "en gaat over middernacht.",
      });
    }
  }

  for (const code of duplicates(duties)) {
    problems.push({
      severity: "BLOCKING",
      line: 0,
      code: "DUPLICATE",
      message: `Dienstnummer ${code} komt meerdere keren voor.`,
    });
  }

  const totals = totalsOf(duties, input.rows);
  const blokkerend = problems.some((probleem) => probleem.severity === "BLOCKING");
  const teBeoordelen = problems.some((probleem) => probleem.severity === "REVIEW");

  if (blokkerend || duties.length === 0) {
    if (duties.length === 0 && !blokkerend) {
      problems.push({
        severity: "BLOCKING",
        line: 0,
        code: "EMPTY",
        message: "Er is geen enkele dienst ingelezen.",
      });
    }
    return {
      stage: "REJECTED",
      duties,
      totals,
      problems,
      safeFilename: input.safeFilename,
      importable: false,
    };
  }

  return {
    stage: teBeoordelen ? "REVIEW_REQUIRED" : "VALIDATED",
    duties,
    totals,
    problems,
    safeFilename: input.safeFilename,
    importable: true,
  };
}

/**
 * Diensten die twee keer in dezelfde levering staan.
 *
 * Dubbel is: hetzelfde nummer op dezelfde weekdag. Hetzelfde nummer op een
 * andere weekdag is geen duplicaat maar een andere dienst — in de Dordrechtse
 * bron is dat de regel en niet de uitzondering.
 */
function duplicates(duties: readonly ParsedDuty[]): readonly string[] {
  const gezien = new Set<string>();
  const dubbel = new Set<string>();
  for (const duty of duties) {
    const identiteit = `${duty.code}|${duty.weekday}`;
    if (gezien.has(identiteit)) {
      dubbel.add(`${duty.code} (${weekdagNaam(duty.weekday)})`);
    }
    gezien.add(identiteit);
  }
  return [...dubbel].sort();
}

export function totalsOf(duties: readonly ParsedDuty[], rows: number): ImportTotals {
  const heeft = (duty: ParsedDuty, kind: string) => duty.kinds.includes(kind);
  return {
    rows,
    duties: duties.length,
    vroeg: duties.filter((duty) => heeft(duty, "VROEG")).length,
    laat: duties.filter((duty) => heeft(duty, "LAAT")).length,
    nacht: duties.filter((duty) => heeft(duty, "NACHT")).length,
    rangeer: duties.filter((duty) => heeft(duty, "RANGEER")).length,
    reserve: duties.filter((duty) => heeft(duty, "RESERVE")).length,
    overMidnight: duties.filter((duty) => duty.endMinute > 1440).length,
    // De pauzeduur is standplaatsafhankelijk en wordt niet aangeleverd. Dat is
    // een bekend gat, geen importfout — maar het hoort wel geteld te worden.
    withoutBreak: duties.length,
    depots: [...new Set(duties.map((duty) => duty.depot))].sort(),
    earliestStart: tijd(Math.min(...duties.map((duty) => duty.startMinute))),
    latestEnd: tijd(Math.max(...duties.map((duty) => duty.endMinute))),
    totalMinutes: duties.reduce((sum, duty) => sum + (duty.endMinute - duty.startMinute), 0),
  };
}

// ── Het verschil met de vorige versie ────────────────────────────────────────

export interface PackageDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly {
    readonly code: string;
    readonly field: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly unchanged: number;
}

export interface ComparableDuty {
  readonly code: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly weight: number;
  readonly requiredQualifications: readonly string[];
}

/**
 * Wat er verandert ten opzichte van de vorige versie.
 *
 * Zonder dit is een nieuwe pakketversie een blinde vervanging: 218 diensten
 * eruit, 221 erin, en niemand die weet of dat drie nieuwe diensten zijn of een
 * heel ander aanbod. De planner die dit leest, moet kunnen zien welke diensten
 * verdwijnen — want dat zijn de roosterlijnen die opnieuw gevuld moeten worden.
 */
export function diffPackages(
  previous: readonly ComparableDuty[],
  next: readonly ComparableDuty[],
): PackageDiff {
  // De sleutel is nummer + weekdag. Op alleen het nummer vergelijken zou
  // zeggen dat er niets verandert wanneer dienst 101 van donderdag verdwijnt,
  // zolang 101 van maandag er nog staat.
  // Wat de planner leest, moet de dienst aanwijzen die hij moet opvangen. Dat
  // is "101 (donderdag)" en niet "101": op dat laatste kan hij niet zien welke
  // roosterregel er een gat krijgt.
  const sleutel = (duty: ComparableDuty): string => `${duty.code}|${duty.weekday}`;
  const noem = (duty: ComparableDuty): string =>
    `${duty.code} (${weekdagNaam(duty.weekday)})`;
  const vorige = new Map(previous.map((duty) => [sleutel(duty), duty]));
  const nieuwe = new Map(next.map((duty) => [sleutel(duty), duty]));

  const added = [...nieuwe.entries()]
    .filter(([key]) => !vorige.has(key))
    .map(([, duty]) => noem(duty))
    .sort();
  const removed = [...vorige.entries()]
    .filter(([key]) => !nieuwe.has(key))
    .map(([, duty]) => noem(duty))
    .sort();

  const changed: { code: string; field: string; from: string; to: string }[] = [];
  let unchanged = 0;
  for (const [key, na] of nieuwe) {
    const code = noem(na);
    const voor = vorige.get(key);
    if (!voor) {
      continue;
    }
    const velden: [string, string, string][] = [
      ["begintijd", tijd(voor.startMinute), tijd(na.startMinute)],
      ["eindtijd", tijd(voor.endMinute), tijd(na.endMinute)],
      ["standplaats", voor.depot, na.depot],
      ["zwaarte", String(voor.weight), String(na.weight)],
      [
        "bevoegdheden",
        [...voor.requiredQualifications].sort().join(", ") || "geen",
        [...na.requiredQualifications].sort().join(", ") || "geen",
      ],
    ];
    const verschillen = velden.filter(([, from, to]) => from !== to);
    if (verschillen.length === 0) {
      unchanged += 1;
      continue;
    }
    for (const [field, from, to] of verschillen) {
      changed.push({ code, field, from, to });
    }
  }

  return { added, removed, changed, unchanged };
}
