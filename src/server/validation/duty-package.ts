import { z } from "zod";
import type { DutyPeriod, DutyWorkType } from "@/lib/generated/prisma/enums";
import { classifyDuty, parseDutyCode } from "@/domain/duty-classification";

/**
 * Inlezen en valideren van een aangeleverd dienstenpakket.
 *
 * ## Het formaat
 *
 * Puntkomma-gescheiden regels met een kopregel:
 *
 *     dienst;start;eind;standplaats;zwaarte;bevoegdheden;omschrijving
 *     043;05:12;13:20;UT;3;;Sprinter Utrecht - Amersfoort
 *     760;23:10;07:20;UT;4;RANGEER;Nachtrangeren
 *
 * `eind` vóór `start` betekent dat de dienst over middernacht loopt; dat wordt
 * omgerekend naar minuten voorbij 1440. Meerdere bevoegdheden scheiden met een
 * komma.
 *
 * ## Waarom import alles-of-niets is
 *
 * Een pakket met vijf ongeldige regels half inlezen levert een rooster op dat
 * lijkt te kloppen en dat op vijf plekken diensten mist. De import geeft daarom
 * ofwel het complete pakket terug, ofwel een lijst met alle fouten — inclusief
 * regelnummer, zodat het aanleveren te corrigeren is.
 */

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Tijd moet HH:MM zijn.")
  .transform((value) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  });

export const dutyRowSchema = z.object({
  code: z.string().trim().min(1, "Dienstnummer ontbreekt."),
  weekdag: z.coerce
    .number()
    .int()
    .min(1, "Weekdag moet 1 (maandag) tot en met 7 (zondag) zijn.")
    .max(7, "Weekdag moet 1 (maandag) tot en met 7 (zondag) zijn."),
  start: timeSchema,
  eind: timeSchema,
  standplaats: z.string().trim().min(1, "Standplaats ontbreekt."),
  zwaarte: z.coerce.number().int().min(1).max(5).default(3),
  bevoegdheden: z.string().trim().default(""),
  omschrijving: z.string().trim().max(200).default(""),
});

export interface ParsedDuty {
  readonly code: string;
  /** 1 = maandag tot en met 7 = zondag. Samen met de code de identiteit. */
  readonly weekday: number;
  readonly numericCode: number;
  readonly period: DutyPeriod;
  readonly workType: DutyWorkType;
  readonly kinds: readonly string[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly weight: number;
  readonly requiredQualifications: readonly string[];
  readonly description: string | null;
  /** De regel in het aangeleverde bestand, 1-gebaseerd inclusief de kopregel. */
  readonly sourceRow: number;
  /** Wat er letterlijk in de cellen stond, vóór normalisatie. */
  readonly sourceValues: Readonly<Record<string, string>>;
}

export interface ParseIssue {
  readonly line: number;
  readonly message: string;
}

export interface ParseResult {
  readonly duties: readonly ParsedDuty[];
  readonly issues: readonly ParseIssue[];
}

const EXPECTED_HEADER = [
  "dienst",
  "weekdag",
  "start",
  "eind",
  "standplaats",
  "zwaarte",
  "bevoegdheden",
  "omschrijving",
];

export function parseDutyPackage(content: string): ParseResult {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { duties: [], issues: [{ line: 0, message: "Het bestand is leeg." }] };
  }

  const header = lines[0].split(";").map((cell) => cell.trim().toLowerCase());
  if (EXPECTED_HEADER.some((expected, index) => header[index] !== expected)) {
    return {
      duties: [],
      issues: [
        {
          line: 1,
          message: `De kopregel moet zijn: ${EXPECTED_HEADER.join(";")}`,
        },
      ],
    };
  }

  const duties: ParsedDuty[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const cells = lines[index].split(";").map((cell) => cell.trim());
    const parsed = dutyRowSchema.safeParse({
      code: cells[0],
      weekdag: cells[1],
      start: cells[2],
      eind: cells[3],
      standplaats: cells[4],
      zwaarte: cells[5] || undefined,
      bevoegdheden: cells[6] ?? "",
      omschrijving: cells[7] ?? "",
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ line: lineNumber, message: `${issue.path.join(".")}: ${issue.message}` });
      }
      continue;
    }

    const row = parsed.data;

    let numericCode: number;
    let classification: ReturnType<typeof classifyDuty>;
    try {
      numericCode = parseDutyCode(row.code);
      classification = classifyDuty(numericCode);
    } catch (error) {
      issues.push({
        line: lineNumber,
        message: error instanceof Error ? error.message : "Onbekend dienstnummer.",
      });
      continue;
    }

    // Dezelfde dienst op dezelfde weekdag is dubbel; dezelfde dienst op een
    // andere weekdag is een andere dienst.
    const identiteit = `${row.code}|${row.weekdag}`;
    if (seen.has(identiteit)) {
      issues.push({
        line: lineNumber,
        message: `Dienstnummer ${row.code} komt op weekdag ${row.weekdag} dubbel voor.`,
      });
      continue;
    }
    seen.add(identiteit);

    // Eindtijd vóór begintijd betekent: de dienst loopt door tot de volgende dag.
    const endMinute = row.eind <= row.start ? row.eind + 1440 : row.eind;
    if (endMinute - row.start > 16 * 60) {
      issues.push({
        line: lineNumber,
        message: `Dienst ${row.code} duurt langer dan 16 uur; controleer begin- en eindtijd.`,
      });
      continue;
    }

    duties.push({
      code: row.code,
      weekday: row.weekdag,
      numericCode,
      period: classification.period,
      workType: classification.workType,
      kinds: classification.kinds,
      startMinute: row.start,
      endMinute,
      depot: row.standplaats.toUpperCase(),
      weight: row.zwaarte,
      requiredQualifications: row.bevoegdheden
        ? row.bevoegdheden.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean)
        : [],
      description: row.omschrijving || null,
      // De bron blijft meereizen. Zonder dit kan niemand later nagaan waar
      // dienst 101 vandaan komt en of er onderweg iets is veranderd.
      sourceRow: lineNumber,
      sourceValues: {
        dienst: cells[0] ?? "",
        start: cells[1] ?? "",
        eind: cells[2] ?? "",
        standplaats: cells[3] ?? "",
        zwaarte: cells[4] ?? "",
        bevoegdheden: cells[5] ?? "",
        omschrijving: cells[6] ?? "",
      },
    });
  }

  return { duties, issues };
}

/** Een voorbeeldbestand, voor de importpagina. */
export const DUTY_PACKAGE_EXAMPLE = [
  EXPECTED_HEADER.join(";"),
  "043;05:12;13:20;UT;3;;Sprinter Utrecht - Amersfoort",
  "118;13:40;21:55;UT;3;;Intercity Utrecht - Den Haag",
  "212;22:45;06:30;UT;4;;Nachtnet Randstad",
  "604;06:00;14:00;UT;2;;Reservedienst vroeg",
  "712;07:15;15:30;UT;3;RANGEER;Rangeren opstelterrein",
  "760;23:10;07:20;UT;4;RANGEER;Nachtrangeren",
].join("\n");
