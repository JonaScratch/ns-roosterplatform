import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RosterProfile, RosterPositionType } from "@/lib/generated/prisma/enums";
import { classifyDuty } from "@/domain/duty-classification";
import { type RosterPdfDocument, dutyInstancesOf, parseRosterPdf } from "@/server/import/roster-pdf";

/**
 * De Dordrechtse werkelijkheid, zoals de zeven aangeleverde bladen haar
 * beschrijven.
 *
 * ## Waarom dit één module is
 *
 * De diensten en de roosters komen uit dezelfde zeven bestanden. Wie ze apart
 * inleest, kan ze uit elkaar laten lopen: een dienst in het pakket die op geen
 * enkele roosterregel staat, of een roosterregel die naar een dienst wijst die
 * niet is geïmporteerd. Door beide in één doorloop op te bouwen kan dat niet
 * gebeuren, en kan het behoud hieronder ook echt worden nagerekend.
 *
 * ## Het behoud
 *
 * Elke dagcel op elk blad komt in precies één van vier bakken terecht:
 *
 *     INVOER = VAST_ROOSTER + OPERATIONELE_POOL + NIET_TOEWIJSBAAR + UITGESLOTEN
 *
 * `conservation()` rekent dat na. Klopt het niet, dan is er onderweg iets
 * verdwenen of verdubbeld, en dat is precies het soort fout dat je nergens
 * anders meer terugziet.
 *
 * ## Wat hier niet gebeurt
 *
 * Er wordt niets aangevuld. Een blad zonder reservedagen krijgt er geen; een
 * dienstnummer dat de indeling niet kent, wordt niet in een bereik geduwd. Wat
 * niet klopt, komt terug in `conflicts` en gaat mee de database in als
 * probleem bij het pakket, zodat het zichtbaar blijft in plaats van te worden
 * weggepoetst.
 */

/** Waar de aangeleverde bestanden staan. */
export const DORDRECHT_BRONMAP = join(
  process.cwd(),
  "tests",
  "fixtures",
  "dordrecht-bronnen",
);

/** Eén dienst: nummer én weekdag, want dat samen is de identiteit. */
export interface SourceDuty {
  readonly code: string;
  readonly numericCode: number;
  readonly weekday: number;
  readonly startMinute: number;
  /** Groter dan 1440 wanneer de dienst over middernacht loopt. */
  readonly endMinute: number;
  readonly durationLabel: string | null;
  /** Van welk blad en welke regel deze dienst komt. Voor de herleidbaarheid. */
  readonly sourceSheet: string;
  readonly sourceLine: number;
  readonly sourceCell: string;
}

export interface SourceRosterLine {
  readonly lineNumber: number;
  readonly weekHoursIncludingBreak: string;
  readonly weekHoursExcludingBreak: string;
  readonly days: readonly {
    readonly weekday: number;
    readonly positionType: RosterPositionType;
    readonly dutyCode: string | null;
  }[];
}

export interface SourceRoster {
  readonly code: string;
  readonly name: string;
  readonly profile: RosterProfile;
  readonly sheet: string;
  /** Het aantal dagcellen dat op het blad stond, vóór enige filtering. */
  readonly cellCount: number;
  readonly lines: readonly SourceRosterLine[];
  readonly meta: RosterPdfDocument["meta"];
}

export interface SourceConflict {
  readonly kind: string;
  readonly detail: string;
}

export interface DordrechtSource {
  readonly duties: readonly SourceDuty[];
  readonly rosters: readonly SourceRoster[];
  /** SHA-256 over alle bladen samen, in vaste volgorde. */
  readonly checksum: string;
  readonly sheetChecksums: readonly { readonly sheet: string; readonly sha256: string }[];
  readonly conflicts: readonly SourceConflict[];
  readonly timetableId: string;
  readonly validFrom: Date;
  readonly validUntil: Date;
}

/**
 * De roosternaam op het blad naar een profiel en een code.
 *
 * Deze afbeelding staat hier en niet verspreid, omdat een verkeerd profiel
 * betekent dat een medewerker in een ander roosterprofiel terechtkomt dan waar
 * hij op staat. Een naam die er niet in staat, levert een conflict op en geen
 * gok: "50+ mix" mag niet stilzwijgend "Mix" worden.
 */
const PROFIEL_PER_BLAD: ReadonlyMap<
  string,
  { readonly code: string; readonly profile: RosterProfile }
> = new Map([
  ["Vroeg 1 VA.pdf", { code: "DDR-V", profile: RosterProfile.VROEG }],
  ["Vroeg Laat 1 B.pdf", { code: "DDR-VL", profile: RosterProfile.VROEG_LAAT }],
  ["Laat 1 LA.pdf", { code: "DDR-L", profile: RosterProfile.LAAT }],
  ["Laat Nacht 1 C.pdf", { code: "DDR-LN", profile: RosterProfile.LAAT_NACHT }],
  ["Mix 1 A.pdf", { code: "DDR-MIX", profile: RosterProfile.MIX }],
  ["50+ mix 1.pdf", { code: "DDR-50MIX", profile: RosterProfile.MIX_50PLUS }],
  ["BLM 1.pdf", { code: "DDR-BLM", profile: RosterProfile.BLM }],
]);

/** De bladen die als roosterblad gelden, in vaste volgorde. */
export function sheetNames(bronmap = DORDRECHT_BRONMAP): readonly string[] {
  return readdirSync(bronmap)
    .filter((naam) => naam.endsWith(".pdf") && !/CAO|Roosterkaders/i.test(naam))
    .sort();
}

/** De hele Dordrechtse bron in één keer. */
export function readDordrechtSource(bronmap = DORDRECHT_BRONMAP): DordrechtSource {
  const bladen = sheetNames(bronmap);
  const duties: SourceDuty[] = [];
  const rosters: SourceRoster[] = [];
  const conflicts: SourceConflict[] = [];
  const sheetChecksums: { sheet: string; sha256: string }[] = [];
  const geheel = createHash("sha256");

  const identiteiten = new Map<string, SourceDuty>();

  for (const bladnaam of bladen) {
    const bytes = readFileSync(join(bronmap, bladnaam));
    const sha = createHash("sha256").update(bytes).digest("hex");
    sheetChecksums.push({ sheet: bladnaam, sha256: sha });
    geheel.update(sha);

    const document = parseRosterPdf(bytes);

    for (const ruw of document.unparsed) {
      conflicts.push({
        kind: "CELL_NOT_PARSED",
        detail: `${bladnaam}: een dagcel kon niet worden gelezen (${ruw}).`,
      });
    }

    // ── De diensten ────────────────────────────────────────────────────────
    for (const instantie of dutyInstancesOf(document)) {
      const sleutel = `${instantie.dutyCode}|${instantie.weekday}`;
      const bestaand = identiteiten.get(sleutel);
      if (bestaand) {
        // Dezelfde dienst op twee bladen. Gelijke tijden is normaal (twee
        // roosters rijden dezelfde dienst); ongelijke tijden is een conflict
        // in de bron en mag niet stil worden gladgestreken.
        if (
          bestaand.startMinute !== instantie.startMinute ||
          bestaand.endMinute !== instantie.endMinute
        ) {
          conflicts.push({
            kind: "SOURCE_CONFLICT",
            detail:
              `Dienst ${instantie.dutyCode} op weekdag ${instantie.weekday} heeft op ` +
              `${bestaand.sourceSheet} de tijden ${bestaand.startMinute}-${bestaand.endMinute} ` +
              `en op ${bladnaam} de tijden ${instantie.startMinute}-${instantie.endMinute}.`,
          });
        }
        continue;
      }

      const classificatie = veiligClassificeren(instantie.dutyCode, conflicts, bladnaam);
      if (!classificatie) {
        continue;
      }

      const dienst: SourceDuty = {
        code: instantie.dutyCode,
        numericCode: Number(instantie.dutyCode),
        weekday: instantie.weekday,
        startMinute: instantie.startMinute,
        endMinute: instantie.endMinute,
        durationLabel: instantie.duration,
        sourceSheet: bladnaam,
        sourceLine: instantie.lineNumber,
        sourceCell: `${instantie.dutyCode}|${instantie.duration ?? ""}|${minutenNaarTijd(
          instantie.startMinute,
        )} - ${minutenNaarTijd(instantie.endMinute % (24 * 60))}`,
      };
      identiteiten.set(sleutel, dienst);
      duties.push(dienst);
    }

    // ── Het rooster ────────────────────────────────────────────────────────
    const profiel = PROFIEL_PER_BLAD.get(bladnaam);
    if (!profiel) {
      conflicts.push({
        kind: "UNKNOWN_ROSTER_SHEET",
        detail:
          `Voor blad ${bladnaam} is geen roosterprofiel vastgelegd. Het is niet ` +
          "geïmporteerd; een profiel raden zou een medewerker in het verkeerde rooster zetten.",
      });
      continue;
    }

    rosters.push({
      code: profiel.code,
      name: document.meta.roosterNaam || bladnaam.replace(/\.pdf$/, ""),
      profile: profiel.profile,
      sheet: bladnaam,
      cellCount: document.lines.length * 7,
      meta: document.meta,
      lines: document.lines.map((regel) => ({
        lineNumber: regel.lineNumber,
        weekHoursIncludingBreak: regel.weekHoursIncludingBreak,
        weekHoursExcludingBreak: regel.weekHoursExcludingBreak,
        days: regel.cells.flatMap((cel) => {
          const positie = positieVoorCel(cel.kind);
          if (positie === null) {
            // Uitgesloten met reden, niet stilzwijgend als rustdag ingevuld.
            conflicts.push({
              kind: "CELL_NOT_PARSED",
              detail:
                `${bladnaam} regel ${regel.lineNumber}, weekdag ${cel.weekday}: de cel ` +
                `"${cel.raw}" is niet te duiden en is niet overgenomen.`,
            });
            return [];
          }
          return [
            {
              weekday: cel.weekday,
              positionType: positie,
              dutyCode: cel.kind === "DUTY" ? cel.dutyCode : null,
            },
          ];
        }),
      })),
    });
  }

  const eerste = rosters[0]?.meta;
  return {
    duties,
    rosters,
    checksum: geheel.digest("hex"),
    sheetChecksums,
    conflicts,
    timetableId: eerste?.roostervariant ?? "ONBEKEND",
    validFrom: new Date("2026-10-05T00:00:00.000Z"),
    validUntil: new Date("2026-12-12T00:00:00.000Z"),
  };
}

/**
 * Het behoud: gaat er onderweg niets verloren en komt er niets dubbel?
 *
 * Elke dagcel telt precies één keer mee. `invoer` is het aantal cellen op alle
 * bladen samen; de vier bakken eronder moeten daar samen op uitkomen.
 */
export interface Conservation {
  readonly invoer: number;
  readonly vastRooster: number;
  readonly operationelePool: number;
  readonly nietToewijsbaar: number;
  readonly uitgeslotenMetReden: number;
  readonly sluitend: boolean;
  readonly verdwenen: number;
  readonly dubbel: number;
}

export function conservation(bron: DordrechtSource): Conservation {
  let invoer = 0;
  let vastRooster = 0;
  let operationelePool = 0;
  let nietToewijsbaar = 0;

  for (const rooster of bron.rosters) {
    // De invoer is wat er op het blad stónd, niet wat wij ervan hebben
    // overgehouden. Anders telt een cel die we lieten vallen ook niet mee in
    // het verschil, en sluit de som altijd.
    invoer += rooster.cellCount;
    for (const regel of rooster.lines) {
      for (const dag of regel.days) {
        if (dag.positionType === RosterPositionType.DUTY) {
          // Een dienstdag ligt vast in het rooster.
          vastRooster += 1;
        } else if (dag.positionType === RosterPositionType.RES) {
          // Een reservedag wordt later operationeel ingevuld.
          operationelePool += 1;
        } else {
          // Rust, WTV en compensatie zijn geen werk en dus niet toewijsbaar.
          nietToewijsbaar += 1;
        }
      }
    }
  }

  // Cellen die op een blad staan maar nergens terechtkwamen, met opgaaf van
  // reden. Dat zijn hier de bladen zonder profiel en de onleesbare cellen.
  const uitgeslotenMetReden = bron.conflicts.filter(
    (conflict) => conflict.kind === "CELL_NOT_PARSED" || conflict.kind === "UNKNOWN_ROSTER_SHEET",
  ).length;

  const som = vastRooster + operationelePool + nietToewijsbaar + uitgeslotenMetReden;
  return {
    invoer,
    vastRooster,
    operationelePool,
    nietToewijsbaar,
    uitgeslotenMetReden,
    sluitend: som === invoer,
    verdwenen: Math.max(0, invoer - som),
    dubbel: Math.max(0, som - invoer),
  };
}

/**
 * Waar het dienstnummer iets anders belooft dan de tijden laten zien.
 *
 * De indeling op nummerbereik komt uit de functionele opdracht en is door NS
 * nog niet bevestigd. De aangeleverde bron is wél echt. Waar die twee elkaar
 * tegenspreken, wordt dat hier opgesomd — niet opgelost. Welke van de twee de
 * werkelijkheid is, is geen vraag die deze code mag beantwoorden.
 */
export function classificationConflicts(
  bron: DordrechtSource,
): readonly { readonly duty: SourceDuty; readonly detail: string }[] {
  const uit: { duty: SourceDuty; detail: string }[] = [];

  for (const dienst of bron.duties) {
    const belooft = classifyDuty(dienst.code).period;
    const tegenspraak = tegenspraakMetDeTijden(belooft, dienst);
    if (tegenspraak) {
      uit.push({
        duty: dienst,
        detail:
          `Dienst ${dienst.code} (weekdag ${dienst.weekday}) is op nummer ingedeeld als ` +
          `${belooft}, maar loopt van ${minutenNaarTijd(dienst.startMinute)} tot ` +
          `${minutenNaarTijd(dienst.endMinute % (24 * 60))}: ${tegenspraak}`,
      });
    }
  }
  return uit;
}

/**
 * Alleen de onmiskenbare tegenspraken.
 *
 * De grenzen hieronder zijn ruim gekozen en dat is de bedoeling. Er is geen
 * aangeleverde regel die zegt waar "vroeg" ophoudt, dus elke scherpe grens die
 * hier zou staan, zou een regel zijn die ik zelf verzonnen heb. Wat overblijft
 * zijn de gevallen waarover geen redelijk verschil van mening bestaat: een
 * vroegdienst die 's avonds begint, een late dienst die 's nachts begint, een
 * nachtdienst die overdag klaar is.
 *
 * Een lege uitkomst betekent dus niet dat de indeling klopt — alleen dat de
 * bron haar niet aantoonbaar tegenspreekt.
 */
function tegenspraakMetDeTijden(belooft: string, dienst: SourceDuty): string | null {
  const startUur = dienst.startMinute / 60;
  if (belooft === "VROEG" && startUur >= 12) {
    return "een vroegdienst die na het middaguur begint.";
  }
  if (belooft === "LAAT" && startUur < 8) {
    return "een late dienst die vóór acht uur 's ochtends begint.";
  }
  if (belooft === "NACHT" && dienst.endMinute <= 24 * 60) {
    return "een nachtdienst die vóór middernacht is afgelopen.";
  }
  return null;
}

// ── Hulpmiddelen ─────────────────────────────────────────────────────────────

function veiligClassificeren(
  code: string,
  conflicts: SourceConflict[],
  bladnaam: string,
): ReturnType<typeof classifyDuty> | null {
  try {
    return classifyDuty(code);
  } catch {
    conflicts.push({
      kind: "UNKNOWN_DUTY_CODE",
      detail:
        `Dienstnummer ${code} op ${bladnaam} valt buiten alle bekende bereiken en is niet ` +
        "geïmporteerd. Een nummer in een bereik duwen dat er niet bij hoort, verandert de " +
        "regels die erop van toepassing zijn.",
    });
    return null;
  }
}

/**
 * Wat een cel in het rooster betekent.
 *
 * Er staat met opzet geen `default` in deze switch die op rust uitkomt. Een
 * onleesbare cel is geen rustdag: dat verschil zet iemand thuis op een dag dat
 * hij had moeten rijden, en niets in het systeem zou daar nog over klagen.
 * Onbekend levert daarom null op, en de aanroeper moet er iets mee.
 */
export function positieVoorCel(kind: string): RosterPositionType | null {
  switch (kind) {
    case "DUTY":
      return RosterPositionType.DUTY;
    case "RES":
      return RosterPositionType.RES;
    case "WR":
    case "WTV":
      return RosterPositionType.WR;
    case "CO":
      return RosterPositionType.CO;
    case "R":
      return RosterPositionType.RUST;
    default:
      return null;
  }
}

export function minutenNaarTijd(minuten: number): string {
  const uren = Math.floor(minuten / 60) % 24;
  return `${String(uren).padStart(2, "0")}:${String(minuten % 60).padStart(2, "0")}`;
}
