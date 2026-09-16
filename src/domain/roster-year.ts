import { todayInAmsterdam } from "./cao-days";
import { type CalendarDate, addDays, daysBetween, isoWeekday } from "./time";

/**
 * Het roosterjaar.
 *
 * ## Wat een roosterjaar is
 *
 * Een roosterjaar loopt van de tweede zondag van december tot de tweede zondag
 * van december daarna. Roosterjaar 2027 begint dus in december 2026 — het jaartal
 * noemt het jaar waarin het grootste deel valt, niet de maand waarin het begint.
 * Dat is verwarrend zolang je het niet weet en vanzelfsprekend zodra je het
 * weet, en daarom staat het overal waar een planner een jaar kiest ook uit
 * welke datums dat oplevert.
 *
 * ## Halfopen intervallen, en waarom
 *
 * Een periode wordt hier vastgelegd als `[start, endExclusive)`: de startdag
 * hoort erbij, de einddag niet. Het einde van het ene roosterjaar is daarmee
 * letterlijk hetzelfde getal als het begin van het volgende.
 *
 * Dat is geen smaakkwestie. Met twee inclusieve grenzen moet iemand ergens een
 * dag optellen of aftrekken, en precies daar ontstaat of een dag die in twee
 * roosterjaren zit, of een dag die in geen enkel roosterjaar zit. Met halfopen
 * intervallen kán dat niet: aansluiting en niet-overlap volgen uit de vorm, niet
 * uit oplettendheid.
 *
 * Wat een mens te zien krijgt is wél de laatste dag zelf (`lastDay`), want
 * "tot en met zaterdag 11 december" leest een planner en "tot 12 december" niet.
 * De omrekening gebeurt hier, op één plek.
 *
 * ## Waarom er in dagnummers wordt gerekend
 *
 * Alles hieronder rekent met kalenderdatums en dagnummers, niet met tijdstippen.
 * Een roosterjaargrens die met uren wordt uitgerekend, verschuift rond de
 * zomertijd. Kalenderdagen kennen dat probleem niet. De enige plek waar een
 * tijdzone meedoet is de vraag "welk roosterjaar is nu bezig", en die kijkt
 * uitdrukkelijk naar de dag in Amsterdam.
 */

/** Het eerste roosterjaar waarvoor gepland kan worden. */
export const FIRST_ROSTER_YEAR = 2024;

/** Hoeveel jaren de keuzelijst vooruit toont. */
export const ROSTER_YEAR_HORIZON = 5;

export interface RosterYear {
  /** Het jaartal waarmee de planner het roosterjaar aanduidt. */
  readonly year: number;
  /** De eerste dag; hoort erbij. */
  readonly start: CalendarDate;
  /** De eerste dag die er niet meer bij hoort. Gelijk aan de start van het jaar erna. */
  readonly endExclusive: CalendarDate;
  /** De laatste dag die er wél bij hoort. Voor weergave. */
  readonly lastDay: CalendarDate;
  readonly days: number;
  readonly weeks: number;
}

/**
 * De tweede zondag van december in een kalenderjaar.
 *
 * Gerekend vanaf 1 december: de eerste zondag ligt nul tot zes dagen verder, de
 * tweede precies een week daarna. Er wordt niet gezocht in een lus, zodat er
 * ook niets te vinden valt bij een randgeval.
 */
export function secondSundayOfDecember(year: number): CalendarDate {
  const eersteDecember = `${year}-12-01` as CalendarDate;
  // isoWeekday: 1 = maandag … 7 = zondag. Van maandag naar zondag is 6 dagen.
  const naarEersteZondag = 7 - isoWeekday(eersteDecember);
  return addDays(eersteDecember, naarEersteZondag + 7);
}

/**
 * Het roosterjaar met dit jaartal.
 *
 * Roosterjaar 2027 begint op de tweede zondag van december 2026 en loopt tot de
 * tweede zondag van december 2027.
 */
export function rosterYear(year: number): RosterYear {
  const start = secondSundayOfDecember(year - 1);
  const endExclusive = secondSundayOfDecember(year);
  const days = daysBetween(start, endExclusive);
  return {
    year,
    start,
    endExclusive,
    lastDay: addDays(endExclusive, -1),
    days,
    weeks: days / 7,
  };
}

/**
 * Het roosterjaar waarin deze dag valt.
 *
 * Elke dag valt in precies één roosterjaar. Dat is geen aanname maar een gevolg
 * van de halfopen intervallen hierboven, en het wordt in `verify:rooster-year`
 * over twintig jaar dag voor dag nagerekend.
 */
export function rosterYearOf(date: CalendarDate): RosterYear {
  const kalenderjaar = Number(date.slice(0, 4));
  // Ligt de dag vóór de grens in december van dit kalenderjaar, dan hoort hij
  // nog bij het roosterjaar met dit jaartal; anders bij het volgende.
  return date < secondSundayOfDecember(kalenderjaar)
    ? rosterYear(kalenderjaar)
    : rosterYear(kalenderjaar + 1);
}

/** Het roosterjaar dat op dit moment loopt, in Nederlandse tijd. */
export function currentRosterYear(now?: Date): RosterYear {
  return rosterYearOf(todayInAmsterdam(now));
}

/**
 * De roosterjaren die een planner mag kiezen.
 *
 * Het lopende jaar staat erbij: een rooster wordt soms halverwege opnieuw
 * gegenereerd. Verder terug dan `FIRST_ROSTER_YEAR` kan niet, want daarvoor is
 * er geen bron.
 */
export function selectableRosterYears(now?: Date): readonly RosterYear[] {
  const huidig = currentRosterYear(now).year;
  const jaren: RosterYear[] = [];
  for (let jaar = Math.max(FIRST_ROSTER_YEAR, huidig - 1); jaar <= huidig + ROSTER_YEAR_HORIZON; jaar += 1) {
    jaren.push(rosterYear(jaar));
  }
  return jaren;
}

const MAANDEN = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

const DAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

/** "zondag 13 december 2026". */
export function formatRosterDate(date: CalendarDate): string {
  const moment = new Date(`${date}T12:00:00Z`);
  return (
    `${DAGEN[moment.getUTCDay()]} ${moment.getUTCDate()} ` +
    `${MAANDEN[moment.getUTCMonth()]} ${moment.getUTCFullYear()}`
  );
}

/**
 * De periode in gewone taal, met de laatste dag die erbij hoort.
 *
 * Uitdrukkelijk "tot en met" en de inclusieve laatste dag: een planner die
 * "tot 13 december" leest, weet niet of die dag meetelt, en dat is de vraag die
 * het scherm hoort te beantwoorden in plaats van op te roepen.
 */
export function describeRosterYear(jaar: RosterYear): string {
  return `${formatRosterDate(jaar.start)} tot en met ${formatRosterDate(jaar.lastDay)}`;
}
