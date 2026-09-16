import { type CalendarDate, assertCalendarDate, isoWeekday } from "./time";

/**
 * De weekrotatie door een basisrooster.
 *
 * ## Wat een roosterlijn is en waarom hij schuift
 *
 * Een basisrooster van twaalf regels is geen twaalf verschillende roosters maar
 * één rooster van twaalf weken. Wie deze week op regel 6 staat, staat volgende
 * week op regel 7, en na regel 12 weer op regel 1. Zo krijgt iedereen op den
 * duur evenveel nachten, weekenden en vroege diensten.
 *
 * ## Waarom hier niets wordt opgeslagen
 *
 * De verleiding is om elke week `regel = regel + 1` weg te schrijven. Dat werkt
 * precies tot de eerste keer dat iemand de taak niet draait, twee keer draait,
 * of hem in een verkeerde week draait — en dan staat er een getal in de database
 * waarvan niemand meer kan zeggen of het klopt.
 *
 * Hier staat daarom een ankerpunt vast: in wélke week iemand op wélke regel
 * stond. Alle andere weken volgen uit een berekening. Daarmee is de positie voor
 * elke week in verleden en toekomst deterministisch, reproduceerbaar en zonder
 * bijwerking te bepalen.
 *
 * ## Waarom weken en geen dagen
 *
 * Rotatie gaat per ISO-week. Door de weekindex uit de maandag van de ISO-week te
 * berekenen — op 12:00 UTC, ver van elke overgang — speelt zomertijd geen rol,
 * en lopen week 53 en de jaarwisseling vanzelf goed: er wordt geteld in weken,
 * niet in jaren en weeknummers.
 */

/** Een ISO-week, bijvoorbeeld "2026-W40". */
export type IsoWeek = string;

const WEEK_MS = 7 * 86_400_000;
/** Een vast nulpunt: maandag 5 januari 1970, 12:00 UTC. */
const EPOCH_MONDAY_UTC = Date.UTC(1970, 0, 5, 12, 0, 0);

export function isIsoWeek(value: string): value is IsoWeek {
  return /^\d{4}-W\d{2}$/.test(value);
}

export function assertIsoWeek(value: string): IsoWeek {
  if (!isIsoWeek(value)) {
    throw new Error(`Geen geldige ISO-week: ${value}`);
  }
  return value;
}

/**
 * De maandag van de ISO-week waarin deze datum valt.
 *
 * Middernacht UTC zou rond een zomertijdovergang een dag kunnen verschuiven bij
 * conversies; 12:00 UTC ligt overal ver van die grens vandaan.
 */
export function mondayOfWeek(date: CalendarDate): Date {
  const dag = isoWeekday(assertCalendarDate(date));
  const basis = new Date(`${date}T12:00:00Z`);
  basis.setUTCDate(basis.getUTCDate() - (dag - 1));
  return basis;
}

/**
 * Een doorlopende weekteller.
 *
 * Het getal zelf heeft geen betekenis; het verschil tussen twee tellers is het
 * aantal weken ertussen. Precies dát is wat de rotatie nodig heeft, en het is
 * ongevoelig voor weeknummer 53, jaargrenzen en zomertijd.
 */
export function weekIndexOfDate(date: CalendarDate): number {
  return Math.round((mondayOfWeek(date).getTime() - EPOCH_MONDAY_UTC) / WEEK_MS);
}

/** De ISO-weeksleutel als doorlopende teller. */
export function weekIndexOfIsoWeek(week: IsoWeek): number {
  return weekIndexOfDate(mondayOfIsoWeek(week));
}

/** De kalenderdatum van de maandag van een ISO-week. */
export function mondayOfIsoWeek(week: IsoWeek): CalendarDate {
  const [jaarDeel, weekDeel] = assertIsoWeek(week).split("-W");
  const jaar = Number(jaarDeel);
  const weeknummer = Number(weekDeel);

  // De ISO-week waarin 4 januari valt, is per definitie week 1.
  const vierJanuari = new Date(Date.UTC(jaar, 0, 4, 12, 0, 0));
  const dagVanVier = vierJanuari.getUTCDay() === 0 ? 7 : vierJanuari.getUTCDay();
  const maandagWeek1 = new Date(vierJanuari);
  maandagWeek1.setUTCDate(vierJanuari.getUTCDate() - (dagVanVier - 1));

  const doel = new Date(maandagWeek1);
  doel.setUTCDate(maandagWeek1.getUTCDate() + (weeknummer - 1) * 7);
  return doel.toISOString().slice(0, 10);
}

/** De ISO-week waarin deze datum valt. */
export function isoWeekOfDate(date: CalendarDate): IsoWeek {
  const maandag = mondayOfWeek(date);
  const donderdag = new Date(maandag);
  donderdag.setUTCDate(maandag.getUTCDate() + 3);
  const jaar = donderdag.getUTCFullYear();

  const vierJanuari = new Date(Date.UTC(jaar, 0, 4, 12, 0, 0));
  const dagVanVier = vierJanuari.getUTCDay() === 0 ? 7 : vierJanuari.getUTCDay();
  const maandagWeek1 = new Date(vierJanuari);
  maandagWeek1.setUTCDate(vierJanuari.getUTCDate() - (dagVanVier - 1));

  const weeknummer = Math.round((maandag.getTime() - maandagWeek1.getTime()) / WEEK_MS) + 1;
  return `${jaar}-W${String(weeknummer).padStart(2, "0")}`;
}

/** Hoeveel weken liggen er tussen deze twee weken? Negatief mag. */
export function weeksBetween(from: IsoWeek, to: IsoWeek): number {
  return weekIndexOfIsoWeek(to) - weekIndexOfIsoWeek(from);
}

// ── De rotatie zelf ──────────────────────────────────────────────────────────

export interface RotationAnchor {
  /** Op welke regel de medewerker stond in de ankerweek. 1-gebaseerd. */
  readonly anchorRuleIndex: number;
  readonly anchorWeek: IsoWeek;
  /** Het aantal regels van het rooster. */
  readonly lineCount: number;
}

/**
 * Op welke roosterregel staat iemand in een bepaalde week?
 *
 *     regel = ((anker - 1 + verstrekenWeken) mod N) + 1
 *
 * De modulo werkt ook terug in de tijd: een week vóór het anker levert de
 * voorgaande regel op, met de wikkeling naar N. Dat is geen bijvangst maar een
 * eis — een rooster van vorig jaar moet net zo goed te reconstrueren zijn als
 * een van volgend jaar.
 */
export function ruleForWeek(anchor: RotationAnchor, week: IsoWeek): number {
  guard(anchor);
  const verstreken = weeksBetween(anchor.anchorWeek, week);
  const positie = (anchor.anchorRuleIndex - 1 + verstreken) % anchor.lineCount;
  // JavaScript geeft bij een negatieve deling een negatieve rest; die moet
  // terug in het bereik.
  const genormaliseerd = ((positie % anchor.lineCount) + anchor.lineCount) % anchor.lineCount;
  return genormaliseerd + 1;
}

/** De regel voor de week waarin deze datum valt. */
export function ruleForDate(anchor: RotationAnchor, date: CalendarDate): number {
  return ruleForWeek(anchor, isoWeekOfDate(date));
}

export interface RotationWeek {
  readonly week: IsoWeek;
  readonly monday: CalendarDate;
  readonly ruleIndex: number;
}

/** De regels voor een reeks opeenvolgende weken, vanaf een startweek. */
export function rotationSeries(
  anchor: RotationAnchor,
  startWeek: IsoWeek,
  weeks: number,
): readonly RotationWeek[] {
  guard(anchor);
  if (weeks < 0) {
    throw new Error("Een reeks kan geen negatieve lengte hebben.");
  }

  const start = weekIndexOfIsoWeek(startWeek);
  const reeks: RotationWeek[] = [];
  for (let offset = 0; offset < weeks; offset += 1) {
    const maandagDatum = new Date(EPOCH_MONDAY_UTC + (start + offset) * WEEK_MS)
      .toISOString()
      .slice(0, 10);
    const week = isoWeekOfDate(maandagDatum);
    reeks.push({ week, monday: maandagDatum, ruleIndex: ruleForWeek(anchor, week) });
  }
  return reeks;
}

/**
 * In welke week is de medewerker weer terug op zijn beginregel?
 *
 * Voor een rooster van N regels is dat per definitie na N weken. Staat er iets
 * anders, dan klopt de rotatie niet — en dat is precies wat de test hierop
 * bewaakt.
 */
export function cycleLengthWeeks(anchor: RotationAnchor): number {
  guard(anchor);
  return anchor.lineCount;
}

function guard(anchor: RotationAnchor): void {
  if (!Number.isInteger(anchor.lineCount) || anchor.lineCount < 1) {
    throw new Error(`Een rooster met ${anchor.lineCount} regels bestaat niet.`);
  }
  if (
    !Number.isInteger(anchor.anchorRuleIndex) ||
    anchor.anchorRuleIndex < 1 ||
    anchor.anchorRuleIndex > anchor.lineCount
  ) {
    // Regel 13 in een rooster van twaalf is geen randgeval maar een fout in de
    // gegevens; stil doorrekenen zou hem onzichtbaar maken.
    throw new Error(
      `Ankerregel ${anchor.anchorRuleIndex} bestaat niet in een rooster van ` +
        `${anchor.lineCount} regels.`,
    );
  }
  assertIsoWeek(anchor.anchorWeek);
}
