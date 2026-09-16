import type { RosterPositionType } from "@/lib/generated/prisma/enums";

/**
 * De structuur van een basisrooster opnieuw bepalen.
 *
 * ## Wanneer dit mag
 *
 * Alleen in een NEW_TIMETABLE-ronde. Bij een wijzigingsblad liggen de ankers
 * vast; dat wordt op vier plaatsen afgedwongen en niet hier alleen. Deze module
 * weet daar niets van — zij krijgt een opdracht en levert een raster. Het is de
 * aanroeper die moet vaststellen dat de ronde het toelaat, en die controle staat
 * in `roster-structure-service.ts`.
 *
 * ## Wat "structuur" is
 *
 * Welke dag van welke regel een rustdag is, een reservedag, een WTV-dag of een
 * compensatiedag. Níet welke dienst er op een werkdag komt: dat is de opdracht
 * van de optimizer en gebeurt daarna.
 *
 * ## Waarom dit geen optimizer is
 *
 * De verleiding is om ook dit aan CP-SAT te geven. Dat zou kunnen, maar het
 * levert een raster op dat niemand kan navertellen, voor een beslissing die
 * juist navertelbaar moet zijn: dit gaat over de vrije dagen van 64 mensen. De
 * opzet hieronder is met de hand na te rekenen — de rustdagen schuiven per regel
 * één dag op, en het weekendritme volgt uit het interval dat de regels noemen.
 * Wat er uitkomt, wordt daarna door dezelfde validator beoordeeld als elk ander
 * rooster; het keurt zichzelf niet goed.
 *
 * ## Wat er gebeurt als het niet kan
 *
 * Niets stilzwijgends. Vraagt de opdracht meer vrije dagen dan er dagen in een
 * week zitten, dan komt er geen half raster terug maar een weigering met reden.
 * Een rooster dat "grotendeels" klopt, is een rooster waarin iemand op de
 * verkeerde dag moet rijden.
 */

/** Wat de generator per regel moet neerzetten. */
export interface StructureTargets {
  /** Het aantal regels van dit rooster; tevens de lengte van de rotatiecyclus. */
  readonly lineCount: number;
  /** Rustdagen per week. Komt uit `R_DAYS_PER_WEEK_AVG`. */
  readonly restDaysPerWeek: number;
  /**
   * Reservedagen over de hele cyclus, niet per week.
   *
   * Dit stond eerst als een gemiddelde per week, en dat kostte capaciteit: 15
   * reservedagen over 12 regels is 1,25 per week, afgerond 1, en dan komen er
   * 12 uit in plaats van 15. Drie reservedagen minder is drie dagen waarop de
   * dienstindeling een uitval niet meer kan opvangen — en niets in het systeem
   * zou daarover geklaagd hebben. Een totaal kan niet stilzwijgend krimpen.
   */
  readonly reserveDaysPerCycle: number;
  /** WTV-dagen per cyclus, verdeeld over de regels. */
  readonly wtvDaysPerCycle: number;
  /** Compensatiedagen per cyclus, verdeeld over de regels. */
  readonly compensationDaysPerCycle: number;
  /**
   * Om de hoeveel weken een vrij weekend. Komt uit `RED_WEEKEND_INTERVAL_WEEKS`.
   * Nul of minder betekent: geen weekendritme afdwingen.
   */
  readonly freeWeekendIntervalWeeks: number;
  /** Maximaal aantal diensten op rij, uit `MAX_CONSECUTIVE_SERVICES`. */
  readonly maxConsecutiveServices: number;
}

export interface StructureLine {
  readonly lineNumber: number;
  /** Zeven posities, maandag tot en met zondag. */
  readonly days: readonly RosterPositionType[];
}

export type StructureResult =
  | { readonly ok: true; readonly lines: readonly StructureLine[] }
  | { readonly ok: false; readonly reason: string };

const DAGEN_PER_WEEK = 7;
const ZATERDAG = 5;
const ZONDAG = 6;

/**
 * Een structuurraster voor één basisrooster.
 *
 * Elke regel is één week. Wie deze week op regel 1 staat, staat volgende week op
 * regel 2 — de cyclus zit tússen de regels, en daarom bepaalt de verdeling over
 * de regels ook hoe iemands weken zich over het jaar verhouden.
 */
export function generateStructure(targets: StructureTargets): StructureResult {
  const bezwaar = controleerOpdracht(targets);
  if (bezwaar) {
    return { ok: false, reason: bezwaar };
  }

  const {
    lineCount,
    restDaysPerWeek,
    reserveDaysPerCycle,
    wtvDaysPerCycle,
    compensationDaysPerCycle,
    freeWeekendIntervalWeeks,
  } = targets;

  // Welke regels een vrij weekend krijgen. Bij een interval van 3 is dat elke
  // derde regel: wie de cyclus doorloopt, heeft dan eens in de drie weken een
  // vrij weekend. Dat volgt uit de rotatie en niet uit een aparte kalender.
  const vrijWeekend = new Set<number>();
  if (freeWeekendIntervalWeeks > 0) {
    for (let regel = 1; regel <= lineCount; regel += freeWeekendIntervalWeeks) {
      vrijWeekend.add(regel);
    }
  }

  const lines: StructureLine[] = [];
  for (let regel = 1; regel <= lineCount; regel += 1) {
    const dagen: (RosterPositionType | null)[] = Array.from({ length: DAGEN_PER_WEEK }, () => null);

    // ── 1. Het vrije weekend ───────────────────────────────────────────────
    let restRest = restDaysPerWeek;
    if (vrijWeekend.has(regel) && restRest >= 2) {
      dagen[ZATERDAG] = "RUST";
      dagen[ZONDAG] = "RUST";
      restRest -= 2;
    }

    // ── 2. De overige rustdagen ────────────────────────────────────────────
    // Ze schuiven per regel één dag op. Zonder die verschuiving zou elke regel
    // dezelfde dagen vrij hebben, en dan heeft de hele standplaats op woensdag
    // niemand beschikbaar en op donderdag iedereen.
    let cursor = (regel - 1) % DAGEN_PER_WEEK;
    restRest = plaats(dagen, "RUST", restRest, () => {
      const plek = cursor;
      cursor = (cursor + 3) % DAGEN_PER_WEEK;
      return plek;
    });
    if (restRest > 0) {
      return {
        ok: false,
        reason:
          `Regel ${regel}: er is geen plek voor ${restRest} rustdag(en) naast de overige ` +
          "structuurdagen. De opdracht vraagt meer vrije dagen dan er dagen in een week zijn.",
      };
    }

    // ── 3. WTV en compensatie ──────────────────────────────────────────────
    // Verdeeld over de regels: regel 1 krijgt de eerste WTV-dag, regel 2 de
    // tweede, enzovoort. Zo krijgt niet elke regel er een, en dat klopt ook —
    // het zijn er minder dan er regels zijn.
    let wtvRest = verdeel(wtvDaysPerCycle, lineCount, regel);
    let coRest = verdeel(compensationDaysPerCycle, lineCount, regel);

    let wtvCursor = (regel * 2) % DAGEN_PER_WEEK;
    wtvRest = plaats(dagen, "WR", wtvRest, () => {
      const plek = wtvCursor;
      wtvCursor = (wtvCursor + 1) % DAGEN_PER_WEEK;
      return plek;
    });
    let coCursor = (regel * 4) % DAGEN_PER_WEEK;
    coRest = plaats(dagen, "CO", coRest, () => {
      const plek = coCursor;
      coCursor = (coCursor + 1) % DAGEN_PER_WEEK;
      return plek;
    });
    if (wtvRest > 0 || coRest > 0) {
      return {
        ok: false,
        reason:
          `Regel ${regel}: ${wtvRest} WTV-dag(en) en ${coRest} compensatiedag(en) konden ` +
          "niet worden geplaatst; de week zit vol.",
      };
    }

    // ── 4. De reservedagen ─────────────────────────────────────────────────
    let resRest = verdeel(reserveDaysPerCycle, lineCount, regel);
    let resCursor = (regel * 5) % DAGEN_PER_WEEK;
    resRest = plaats(dagen, "RES", resRest, () => {
      const plek = resCursor;
      resCursor = (resCursor + 1) % DAGEN_PER_WEEK;
      return plek;
    });
    if (resRest > 0) {
      return {
        ok: false,
        reason: `Regel ${regel}: ${resRest} reservedag(en) konden niet worden geplaatst.`,
      };
    }

    // ── 5. De rest is werk ─────────────────────────────────────────────────
    const compleet = dagen.map((dag) => dag ?? ("DUTY" as RosterPositionType));
    lines.push({ lineNumber: regel, days: compleet });
  }

  const reeks = teLangeReeks(lines, targets.maxConsecutiveServices);
  if (reeks) {
    return { ok: false, reason: reeks };
  }

  return { ok: true, lines };
}

/**
 * Zet `aantal` dagen van dit type neer op de plekken die `volgende` aanwijst.
 *
 * Levert terug hoeveel er niet geplaatst konden worden. Een bezette plek wordt
 * overgeslagen, nooit overschreven: anders zou een compensatiedag stilletjes een
 * rustdag opeten en klopt de telling verderop niet meer.
 */
function plaats(
  dagen: (RosterPositionType | null)[],
  type: RosterPositionType,
  aantal: number,
  volgende: () => number,
): number {
  let over = aantal;
  // Hooguit één ronde langs alle dagen per te plaatsen dag; daarna is het vol.
  for (let poging = 0; poging < DAGEN_PER_WEEK * Math.max(1, aantal) && over > 0; poging += 1) {
    const plek = volgende();
    if (dagen[plek] === null) {
      dagen[plek] = type;
      over -= 1;
    }
  }
  return over;
}

/**
 * Het aandeel van één regel in een totaal dat over alle regels verdeeld wordt.
 *
 * Negen compensatiedagen over zeven regels wordt 2, 2, 1, 1, 1, 1, 1 — de rest
 * gaat naar de eerste regels. De som over alle regels is exact het totaal; er
 * verdwijnt of ontstaat niets door afronding.
 */
function verdeel(totaal: number, regels: number, regel: number): number {
  if (totaal <= 0 || regels <= 0) {
    return 0;
  }
  return Math.floor(totaal / regels) + (regel <= totaal % regels ? 1 : 0);
}

function controleerOpdracht(targets: StructureTargets): string | null {
  if (targets.lineCount < 1) {
    return "Een rooster zonder regels is geen rooster.";
  }
  if (targets.restDaysPerWeek < 0 || targets.reserveDaysPerCycle < 0) {
    return "Een negatief aantal vrije of reservedagen is geen opdracht.";
  }
  // De zwaarst belaste regel bepaalt of het kan: bij een oneven verdeling
  // krijgen de eerste regels er één meer, en die moeten passen.
  const zwaarste = verdeel(targets.reserveDaysPerCycle, targets.lineCount, 1);
  const perWeek = targets.restDaysPerWeek + zwaarste;
  if (perWeek > DAGEN_PER_WEEK) {
    return (
      `Er worden ${targets.restDaysPerWeek} rustdagen en ${zwaarste} reservedagen ` +
      "op één regel gevraagd; samen meer dan de zeven dagen die een week heeft."
    );
  }
  if (targets.maxConsecutiveServices < 1) {
    return "Een maximum van minder dan één dienst op rij laat geen enkel rooster toe.";
  }
  return null;
}

/**
 * Loopt er een reeks dienstdagen door die te lang is?
 *
 * De reeks loopt door over de regelgrens heen: wie op regel 1 op zondag rijdt en
 * op regel 2 op maandag, heeft twee opeenvolgende dienstdagen. Dat is precies de
 * plek waar een regel-voor-regel controle niets ziet en de machinist elf dagen
 * achter elkaar werkt.
 */
export function teLangeReeks(
  lines: readonly StructureLine[],
  maximum: number,
): string | null {
  if (lines.length === 0) {
    return null;
  }
  // Twee cycli achter elkaar: dan zit de overgang van de laatste regel naar de
  // eerste er ook in.
  const reeks = [...lines, ...lines].flatMap((line) => line.days);
  let lopend = 0;
  let langste = 0;
  for (const dag of reeks) {
    lopend = dag === "DUTY" ? lopend + 1 : 0;
    langste = Math.max(langste, lopend);
  }
  if (langste > maximum) {
    return (
      `Er ontstaat een reeks van ${langste} dienstdagen achter elkaar; het maximum is ` +
      `${maximum}. De structuur is niet gegenereerd.`
    );
  }
  return null;
}

/** Hoeveel dagen van elk type er in het raster staan. Voor de verantwoording. */
export function countPositions(
  lines: readonly StructureLine[],
): Readonly<Record<string, number>> {
  const telling: Record<string, number> = {};
  for (const line of lines) {
    for (const dag of line.days) {
      telling[dag] = (telling[dag] ?? 0) + 1;
    }
  }
  return telling;
}
