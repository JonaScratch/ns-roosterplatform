import type { RosterPositionType } from "@/lib/generated/prisma/enums";

/**
 * De uren van een rooster.
 *
 * ## Waarom dit één plek is
 *
 * Werkuren, roostercredit en gemiddelde weekomvang komen op vier plaatsen voor:
 * het analysescherm, het generatiescherm, de export en de urenverificatie. Vier
 * sommetjes die hetzelfde bedoelen te berekenen, zijn vier kansen om het net
 * anders te doen — en dan staat er op het roosterblad iets anders dan op het
 * scherm waar de planner naar keek toen hij het vaststelde.
 *
 * ## Werkuren en roosteruren zijn niet hetzelfde
 *
 * Dat onderscheid is de kern van deze module.
 *
 *     werkuren       de tijd van daadwerkelijke diensten
 *     roostercredit  werkuren + de dagen die als arbeidstijd meetellen
 *
 * Een week met vier diensten van acht uur en één WTV-dag is 32 werkuren en 40
 * roosteruren. Wie die twee door elkaar haalt, meldt óf een rooster van 32 uur
 * dat in werkelijkheid vol is, óf 40 werkuren die niemand heeft gereden.
 *
 * ## Waar de creditwaarden vandaan komen
 *
 * Niet uit een aanname. De aangeleverde roosterbladen drukken bij elke RES-,
 * WR- en CO-cel `08:00` af en bij elke R-cel niets. Dat is nagerekend: op alle
 * 64 regels van de zeven bladen telt de som van de celduren exact op tot de
 * weeklengte die het blad zelf bovenaan die regel noemt. De bron behandelt deze
 * dagen dus als credited tijd van acht uur, en R als vrije tijd.
 *
 * Er staat hier daarom uitdrukkelijk géén regel "alles zonder dienstnummer is
 * acht uur". Elk type staat apart, met zijn eigen waarde, zodat een toekomstige
 * bron die er anders over denkt hier zichtbaar wordt aangepast en niet stil
 * meelift.
 *
 * ## Rust wordt gemeten, niet geteld
 *
 * Een rustdag is geen 24 uur. Wie zaterdag om 00:28 klaar is en maandag om
 * 05:27 begint, heeft geen 24 uur rust maar 53 uur. En wie vrijdag om 22:58
 * eindigt en zondag om 04:23 begint, heeft er 29 — allebei "één rustdag". De
 * rustinterval wordt daarom uit de werkelijke dienstgrenzen berekend.
 */

/** Eén dag uit de cyclus, in de volgorde waarin een medewerker hem rijdt. */
export interface CycleDay {
  readonly positionType: RosterPositionType;
  /** Minuten na middernacht van díe dag. Alleen bij een dienstdag. */
  readonly startMinute: number | null;
  /** Kan voorbij 1440 liggen bij een dienst over middernacht. */
  readonly endMinute: number | null;
}

/**
 * Hoeveel arbeidstijd een roosterdag zonder dienstnummer meetelt.
 *
 * Uit de aangeleverde bladen: RES, WR en CO drukken `08:00` af, R drukt niets
 * af. De waarden staan hier per type en niet als één algemene regel, omdat het
 * ook per type een andere afspraak kán zijn.
 */
export const ANCHOR_CREDIT_MINUTES: Readonly<Partial<Record<RosterPositionType, number>>> = {
  RES: 8 * 60,
  WR: 8 * 60,
  CO: 8 * 60,
  // R is vrije tijd en telt niet als arbeidstijd. Uitdrukkelijk hier genoemd
  // en niet weggelaten: een ontbrekende sleutel leest als "vergeten".
  RUST: 0,
};

/** De beoogde gemiddelde weekomvang, in minuten. */
export const TARGET_WEEKLY_MINUTES = 40 * 60;

export interface RosterHours {
  /** Het aantal regels; tevens het aantal weken dat een medewerker doorloopt. */
  readonly lineCount: number;
  /** Weken per regel. Bij de NS-bladen is dat er één. */
  readonly weeksPerLine: number;
  /** De volledige cyclus in weken: lineCount × weeksPerLine. */
  readonly cycleWeeks: number;

  /** Tijd van daadwerkelijke diensten. */
  readonly actualDutyMinutes: number;
  readonly dutyDays: number;

  readonly wtvDays: number;
  readonly wtvCreditMinutes: number;
  readonly reserveDays: number;
  readonly reserveCreditMinutes: number;
  readonly compensationDays: number;
  readonly compensationCreditMinutes: number;
  /** Reserve en compensatie samen: alles wat credit is en geen dienst of WTV. */
  readonly otherCreditedMinutes: number;

  /** Werkuren plus alle credited dagen. */
  readonly totalCreditMinutes: number;
  readonly averageWeeklyCreditMinutes: number;
  /** Positief betekent: méér dan de beoogde 40 uur. */
  readonly deviationFromTargetMinutes: number;

  readonly restDays: number;
  /**
   * De som van de werkelijke rustintervallen tussen twee diensten.
   *
   * Gemeten van het einde van de ene dienst tot het begin van de volgende, de
   * cyclusgrens meegerekend. Niet het aantal rustdagen maal 24.
   */
  readonly restIntervalMinutes: number;
  /** De kortste en langste rustperiode in de cyclus. */
  readonly shortestRestMinutes: number | null;
  readonly longestRestMinutes: number | null;

  readonly totalDays: number;
}

/**
 * De uren van één volledige rotatiecyclus.
 *
 * `days` staat in de volgorde waarin een medewerker ze rijdt: eerst alle dagen
 * van zijn ankerregel, dan die van de volgende regel, enzovoort tot de cyclus
 * rond is. Niet zeven dagen van één regel: dat is het rooster dat niemand
 * rijdt.
 */
export function rosterHours(input: {
  readonly days: readonly CycleDay[];
  readonly lineCount: number;
  readonly weeksPerLine: number;
}): RosterHours {
  const { days, lineCount, weeksPerLine } = input;

  let actualDutyMinutes = 0;
  let dutyDays = 0;
  let wtvDays = 0;
  let reserveDays = 0;
  let compensationDays = 0;
  let restDays = 0;

  for (const dag of days) {
    if (dag.positionType === "DUTY" && dag.startMinute !== null && dag.endMinute !== null) {
      actualDutyMinutes += dag.endMinute - dag.startMinute;
      dutyDays += 1;
    } else if (dag.positionType === "WR") {
      wtvDays += 1;
    } else if (dag.positionType === "RES") {
      reserveDays += 1;
    } else if (dag.positionType === "CO") {
      compensationDays += 1;
    } else if (dag.positionType === "RUST") {
      restDays += 1;
    }
  }

  const wtvCreditMinutes = wtvDays * (ANCHOR_CREDIT_MINUTES.WR ?? 0);
  const reserveCreditMinutes = reserveDays * (ANCHOR_CREDIT_MINUTES.RES ?? 0);
  const compensationCreditMinutes = compensationDays * (ANCHOR_CREDIT_MINUTES.CO ?? 0);
  const otherCreditedMinutes = reserveCreditMinutes + compensationCreditMinutes;
  const totalCreditMinutes = actualDutyMinutes + wtvCreditMinutes + otherCreditedMinutes;

  const cycleWeeks = lineCount * weeksPerLine;
  // Naar beneden afgerond, niet naar de dichtstbijzijnde minuut. Dat is wat de
  // aangeleverde bladen zelf doen: 239:11 over zes weken drukken zij af als
  // 39:51 en niet als 39:52. Rond je naar boven, dan wijkt onze gemiddelde
  // weeklengte structureel één minuut af van die op het blad, en dan is de
  // eerste vraag bij elke controle waar dat verschil vandaan komt.
  const averageWeeklyCreditMinutes =
    cycleWeeks > 0 ? Math.floor(totalCreditMinutes / cycleWeeks) : 0;

  const rust = restIntervals(days);

  return {
    lineCount,
    weeksPerLine,
    cycleWeeks,
    actualDutyMinutes,
    dutyDays,
    wtvDays,
    wtvCreditMinutes,
    reserveDays,
    reserveCreditMinutes,
    compensationDays,
    compensationCreditMinutes,
    otherCreditedMinutes,
    totalCreditMinutes,
    averageWeeklyCreditMinutes,
    deviationFromTargetMinutes: averageWeeklyCreditMinutes - TARGET_WEEKLY_MINUTES,
    restDays,
    restIntervalMinutes: rust.total,
    shortestRestMinutes: rust.shortest,
    longestRestMinutes: rust.longest,
    totalDays: days.length,
  };
}

/**
 * De werkelijke rustperiodes tussen opeenvolgende diensten.
 *
 * Van het einde van de ene dienst tot het begin van de volgende, over de
 * cyclusgrens heen. Een cyclus zonder diensten heeft geen meetbare rust: dan is
 * er geen begin en geen eind, en dat is iets anders dan nul rust.
 */
export function restIntervals(days: readonly CycleDay[]): {
  readonly total: number;
  readonly shortest: number | null;
  readonly longest: number | null;
  readonly intervals: readonly number[];
} {
  const grenzen: { einde: number; start: number }[] = [];
  for (const [index, dag] of days.entries()) {
    if (dag.positionType === "DUTY" && dag.startMinute !== null && dag.endMinute !== null) {
      grenzen.push({
        einde: index * 1440 + dag.endMinute,
        start: index * 1440 + dag.startMinute,
      });
    }
  }

  if (grenzen.length < 2) {
    return { total: 0, shortest: null, longest: null, intervals: [] };
  }

  const intervals: number[] = [];
  for (let i = 0; i + 1 < grenzen.length; i += 1) {
    intervals.push(grenzen[i + 1].start - grenzen[i].einde);
  }
  // De overgang van de laatste dienst naar de eerste van de volgende ronde.
  // Zonder deze is de cyclus geen cyclus maar een los stuk, en juist daar zit
  // de langste of kortste rust vaak.
  const rondje = days.length * 1440;
  intervals.push(grenzen[0].start + rondje - grenzen[grenzen.length - 1].einde);

  return {
    total: intervals.reduce((som, waarde) => som + waarde, 0),
    shortest: Math.min(...intervals),
    longest: Math.max(...intervals),
    intervals,
  };
}

/** Minuten als `40:00`. Negatief wordt `-01:23`. */
export function formatHoursMinutes(minutes: number): string {
  const teken = minutes < 0 ? "-" : "";
  const absoluut = Math.abs(Math.round(minutes));
  return `${teken}${Math.floor(absoluut / 60)}:${String(absoluut % 60).padStart(2, "0")}`;
}

/**
 * Hoe ver dit rooster van de beoogde veertig uur af zit.
 *
 * Er staat hier geen tolerantie in. Er is geen aangeleverde bron die zegt
 * hoeveel afwijking aanvaardbaar is, en een zelfverzonnen grens zou binnen een
 * week als norm worden gelezen. Wat er wel is: het verschil, in minuten, en de
 * mededeling dát er geen bevestigde grens is.
 */
export type HoursVerdict = "OP_DOEL" | "AFWIJKING" | "GEEN_CYCLUS";

export function hoursVerdict(hours: RosterHours): HoursVerdict {
  if (hours.cycleWeeks === 0) {
    return "GEEN_CYCLUS";
  }
  // Exact op de minuut is de enige grens die niet verzonnen is. Alles daarbuiten
  // heet "afwijking" en krijgt zijn omvang erbij; de lezer beslist of het erg is.
  return hours.deviationFromTargetMinutes === 0 ? "OP_DOEL" : "AFWIJKING";
}

/** Een zin die zegt wat er aan de hand is, zonder een norm te verzinnen. */
export function hoursNotice(hours: RosterHours): string | null {
  if (hours.cycleWeeks === 0) {
    return "Dit rooster heeft geen cyclus; er is geen gemiddelde weekomvang te bepalen.";
  }
  if (hours.deviationFromTargetMinutes === 0) {
    return null;
  }
  const richting = hours.deviationFromTargetMinutes > 0 ? "boven" : "onder";
  return (
    `Gemiddeld ${formatHoursMinutes(hours.averageWeeklyCreditMinutes)} per week: ` +
    `${formatHoursMinutes(Math.abs(hours.deviationFromTargetMinutes))} ${richting} de beoogde ` +
    "40:00. Er is geen aangeleverde bron die zegt hoeveel afwijking aanvaardbaar is; " +
    "dit is het verschil, niet een oordeel."
  );
}
