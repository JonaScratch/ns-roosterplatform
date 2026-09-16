import { type CalendarDate, addDays, toCalendarDate } from "@/domain/time";

/**
 * De regels rond een CAO-dag.
 *
 * ## De termijn van zes weken
 *
 * Een CAO-dag mag niet eerder worden aangevraagd dan zes weken vooruit. Dat is
 * hier uitgerekend als precies 42 kalenderdagen — niet als "zes maal een week",
 * want dat gaat mis rond de zomer- en wintertijd wanneer je met uren rekent.
 * Kalenderdagen kennen dat probleem niet.
 *
 * ## Waarom dit in het domein staat en niet in het scherm
 *
 * Omdat een uitgeschakelde knop geen regel is. Wie het formulier omzeilt, komt
 * langs dezelfde functie: het scherm gebruikt haar om dagen grijs te maken, de
 * server om een aanvraag te weigeren. Eén berekening, twee gebruikers.
 *
 * ## Waarom de tijdzone erin staat
 *
 * "Vandaag" is in Amsterdam iets anders dan in UTC, en tussen middernacht en
 * twee uur 's nachts schelen die een dag. Een medewerker die om 00:30 een dag
 * aanvraagt die precies op de grens ligt, hoort dezelfde uitkomst te krijgen als
 * om 09:00.
 */

/** Zes weken, uitgedrukt in kalenderdagen. */
export const CAO_DAY_NOTICE_DAYS = 42;

/**
 * Hoeveel CAO-dagen een medewerker in de periode heeft.
 *
 * Dit getal komt uit de productopdracht en niet uit een aangeleverde bron. Er
 * is geen CAO-artikel bij dit platform aangeleverd dat het bevestigt, en dat
 * staat er in het scherm ook bij. Zolang dat zo is, is dit een
 * productinstelling en geen rechtsregel — zie `CAO_DAY_ALLOWANCE_SOURCE`.
 */
export const CAO_DAY_ALLOWANCE = 2;

export const CAO_DAY_ALLOWANCE_SOURCE = "PRODUCT_POLICY_NOT_SOURCE_CONFIRMED" as const;

/** De vroegste datum waarop een CAO-dag mag vallen. */
export function earliestCaoDay(today: CalendarDate): CalendarDate {
  return addDays(today, CAO_DAY_NOTICE_DAYS);
}

/** Vandaag in Europe/Amsterdam, niet in de tijdzone van de server. */
export function todayInAmsterdam(now: Date = new Date()): CalendarDate {
  // `sv-SE` levert een ISO-achtige datum op; de tijdzone doet het werk.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now) as CalendarDate;
}

export type CaoDayRefusal =
  | "TE_VROEG"
  | "AL_AANGEVRAAGD"
  | "GEEN_WERKDAG"
  | "GEEN_ROOSTER"
  | "TEGOED_OP"
  | "AANEENGESLOTEN";

export interface CaoDayCheck {
  readonly allowed: boolean;
  readonly refusal: CaoDayRefusal | null;
  readonly message: string | null;
}

/**
 * Mag deze medewerker deze dag als CAO-dag aanvragen?
 *
 * Zuivere functie: alles wat zij nodig heeft, komt binnen. Zo kan de server
 * hem gebruiken om te weigeren en het scherm om dagen grijs te maken, zonder
 * dat die twee uit elkaar kunnen lopen.
 *
 * ## Waarom de lopende aanvragen als lijst binnenkomen
 *
 * Eerder kwamen hier een `alreadyRequested`-vlag en een `used`-teller binnen,
 * allebei door de aanroeper uitgerekend. Dat werkte tot er een regel bij kwam
 * die naar de dagen ernaast kijkt: twee afgeleide getallen kunnen die vraag niet
 * beantwoorden. Nu gaat de lijst zelf mee en rekent deze functie alle drie de
 * dingen uit. Dat scheelt niet alleen een parameter — het maakt het onmogelijk
 * dat een aanroeper de teller anders opbouwt dan de dagcontrole.
 */
export function checkCaoDay(input: {
  readonly date: CalendarDate;
  readonly today: CalendarDate;
  /** Wat er die dag in het rooster staat. Null wanneer er geen rooster is. */
  readonly positionType: string | null;
  /** De dagen waarvoor deze medewerker al een lopende aanvraag heeft. */
  readonly activeDates: readonly CalendarDate[];
}): CaoDayCheck {
  const lopend = new Set(input.activeDates);

  if (lopend.has(input.date)) {
    return {
      allowed: false,
      refusal: "AL_AANGEVRAAGD",
      message: "Voor deze dag staat al een CAO-dagaanvraag.",
    };
  }

  const vroegste = earliestCaoDay(input.today);
  if (input.date < vroegste) {
    return {
      allowed: false,
      refusal: "TE_VROEG",
      message:
        `Een CAO-dag kan niet eerder dan zes weken vooruit worden aangevraagd. ` +
        `De eerste dag die kan, is ${formatDutchDate(vroegste)}.`,
    };
  }

  if (lopend.size >= CAO_DAY_ALLOWANCE) {
    return {
      allowed: false,
      refusal: "TEGOED_OP",
      message: `U heeft de ${CAO_DAY_ALLOWANCE} CAO-dagen van deze periode al aangevraagd.`,
    };
  }

  // De dag ervóór en de dag erna. `addDays` rekent in dagnummers, dus 31
  // december en 1 januari zijn hier vanzelf buren — de jaargrens is geen
  // uitzondering die iemand kan vergeten.
  const buur = [addDays(input.date, -1), addDays(input.date, 1)].find((dag) => lopend.has(dag));
  if (buur) {
    return {
      allowed: false,
      refusal: "AANEENGESLOTEN",
      message:
        "CAO-dagen mogen niet op twee opeenvolgende dagen worden opgenomen. " +
        `U heeft al een CAO-dag op ${formatDutchDate(buur)}.`,
    };
  }

  if (input.positionType === null) {
    return {
      allowed: false,
      refusal: "GEEN_ROOSTER",
      message:
        "Voor deze dag is geen rooster bekend. Zonder rooster is niet vast te stellen " +
        "waarvoor u vrij vraagt.",
    };
  }

  if (!isWorkingDay(input.positionType)) {
    return {
      allowed: false,
      refusal: "GEEN_WERKDAG",
      message:
        "U bent deze dag al vrij volgens uw rooster. Een CAO-dag is dan niet nodig.",
    };
  }

  return { allowed: true, refusal: null, message: null };
}

/**
 * Is dit een dag waarop de medewerker zou werken?
 *
 * Een reservedag telt mee: die staat voor beschikbaarheid, en wie beschikbaar
 * moet zijn, is niet vrij. Rust, WTV en compensatie zijn dat wel — daar heeft
 * een CAO-dag geen functie, en hem toch toestaan zou iemand een dag van zijn
 * tegoed kosten zonder dat hij er iets voor terugkrijgt.
 */
export function isWorkingDay(positionType: string): boolean {
  return positionType === "DUTY" || positionType === "RES";
}

/** Wat er op het bevestigingsscherm hoort te staan. */
export function caoDaySummary(input: {
  readonly date: CalendarDate;
  readonly rosterName: string | null;
  readonly lineNumber: number | null;
  readonly dutyCode: string | null;
  readonly timeRange: string | null;
  readonly positionType: string | null;
}): readonly { readonly label: string; readonly value: string }[] {
  const regels: { label: string; value: string }[] = [
    { label: "Datum", value: formatDutchDate(input.date) },
  ];
  if (input.rosterName) {
    regels.push({ label: "Basisrooster", value: input.rosterName });
  }
  if (input.lineNumber !== null) {
    regels.push({ label: "Regel", value: String(input.lineNumber) });
  }
  if (input.dutyCode) {
    regels.push({ label: "Dienst", value: input.dutyCode });
  }
  if (input.timeRange) {
    regels.push({ label: "Tijden", value: input.timeRange });
  }
  if (!input.dutyCode && input.positionType === "RES") {
    regels.push({ label: "Roosterpositie", value: "Reservedienst" });
  }
  return regels;
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

const DAGEN = [
  "zondag",
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
];

/** "vrijdag 23 oktober 2026". */
export function formatDutchDate(date: CalendarDate): string {
  const moment = new Date(`${date}T12:00:00Z`);
  return (
    `${DAGEN[moment.getUTCDay()]} ${moment.getUTCDate()} ` +
    `${MAANDEN[moment.getUTCMonth()]} ${moment.getUTCFullYear()}`
  );
}

/** De maanden die de kalender moet tonen, vanaf de eerste geldige dag. */
export function calendarMonths(today: CalendarDate, count = 3): readonly CalendarDate[] {
  const start = earliestCaoDay(today);
  const eerste = new Date(`${start.slice(0, 7)}-01T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const maand = new Date(eerste);
    maand.setUTCMonth(maand.getUTCMonth() + index);
    return toCalendarDate(maand);
  });
}

/** De dagen van een maand, met lege plekken zodat maandag links begint. */
export function monthGrid(month: CalendarDate): readonly (CalendarDate | null)[] {
  const eerste = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  const jaar = eerste.getUTCFullYear();
  const maand = eerste.getUTCMonth();
  const dagen = new Date(Date.UTC(jaar, maand + 1, 0, 12)).getUTCDate();

  // ISO: maandag is 1. `getUTCDay()` geeft zondag 0, dus omrekenen.
  const eersteWeekdag = ((eerste.getUTCDay() + 6) % 7) + 1;

  const cellen: (CalendarDate | null)[] = Array.from(
    { length: eersteWeekdag - 1 },
    () => null,
  );
  for (let dag = 1; dag <= dagen; dag += 1) {
    cellen.push(toCalendarDate(new Date(Date.UTC(jaar, maand, dag, 12))));
  }
  return cellen;
}
