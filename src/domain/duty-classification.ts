import { DutyKind, DutyPeriod, DutyWorkType } from "@/lib/generated/prisma/enums";

/**
 * Classificatie van diensten op dienstnummer.
 *
 * Dit is de enige plek in de applicatie waar een dienstnummer wordt vertaald
 * naar een dienstsoort. Frontendcomponenten, importroutines en de rules engine
 * roepen deze functies aan; niemand vergelijkt zelf op nummerbereiken.
 *
 * ## Twee eigenschappen, niet één
 *
 * Een dienst heeft een **dagdeel** (`period`) en een **werksoort** (`workType`).
 * Die twee staan los van elkaar, en dat is geen theoretische netheid: 760 en
 * 761 zijn zowel nachtdienst als rangeerwerk. Met één veld moet je kiezen, en
 * die keuze lekt door in rusttijdcontroles, in roosterprofielgrenzen en in de
 * verdeling van nachtdiensten. Beide worden daarom opgeslagen.
 *
 * `kinds` is de afvlakking van die twee tot de etiketten waarmee de regels
 * werken. Hij wordt altijd afgeleid, nooit los ingevuld.
 *
 * ## Uitbreidbaarheid
 *
 * De indeling staat in tabellen, niet in verspreide if-statements. Een nieuwe
 * serie toevoegen is een regel in `DUTY_RANGES`; een nieuwe uitzondering is een
 * regel in `DUTY_EXCEPTIONS`. De rest van de applicatie verandert niet mee.
 *
 * ## Voorlopigheid
 *
 * De grenzen hieronder zijn de voorlopige indeling uit de functionele opdracht
 * en zijn nog niet door NS bevestigd.
 */

/** Wat een dienstnummer over de dienst zegt. */
export interface DutyClassification {
  readonly period: DutyPeriod;
  readonly workType: DutyWorkType;
  /** Afgeleide etiketten voor de regels. Nooit los vast te leggen. */
  readonly kinds: readonly DutyKind[];
}

interface DutyRange {
  readonly from: number;
  readonly to: number;
  readonly period: DutyPeriod;
  readonly workType: DutyWorkType;
  readonly label: string;
}

/**
 * Uitzonderingen op de bereiken, per exact dienstnummer.
 *
 * Wordt vóór de bereiken geraadpleegd: 760 valt binnen de 700-serie maar is
 * uitdrukkelijk ook nachtdienst.
 */
const DUTY_EXCEPTIONS: ReadonlyMap<number, { period: DutyPeriod; workType: DutyWorkType }> =
  new Map([
    [760, { period: DutyPeriod.NACHT, workType: DutyWorkType.RANGEER }],
    [761, { period: DutyPeriod.NACHT, workType: DutyWorkType.RANGEER }],
  ]);

const DUTY_RANGES: readonly DutyRange[] = [
  {
    from: 1,
    to: 99,
    period: DutyPeriod.VROEG,
    workType: DutyWorkType.RIJDEND,
    label: "Vroegdiensten",
  },
  {
    from: 100,
    to: 199,
    period: DutyPeriod.LAAT,
    workType: DutyWorkType.RIJDEND,
    label: "Late diensten",
  },
  {
    from: 200,
    to: 299,
    period: DutyPeriod.NACHT,
    workType: DutyWorkType.RIJDEND,
    label: "Nachtdiensten",
  },
  {
    from: 600,
    to: 699,
    period: DutyPeriod.GEEN,
    workType: DutyWorkType.RESERVE,
    label: "Reservediensten",
  },
  {
    from: 700,
    to: 799,
    period: DutyPeriod.GEEN,
    workType: DutyWorkType.RANGEER,
    label: "Rangeer / RET",
  },
];

/** Geen classificatie mogelijk: een dienstnummer buiten alle bekende bereiken. */
export class UnknownDutyCodeError extends Error {
  constructor(public readonly code: string) {
    super(`Dienstnummer ${code} valt buiten alle bekende bereiken.`);
    this.name = "UnknownDutyCodeError";
  }
}

/**
 * Zet een dienstnummer om naar een getal.
 *
 * Accepteert "043" zowel als "43". Weigert alles wat geen puur nummer is: een
 * dienstcode met letters is geen dienst die deze indeling kent, en stil
 * doorschuiven naar 0 zou een vroege dienst van een onbekende dienst maken.
 */
export function parseDutyCode(code: string): number {
  const trimmed = code.trim();
  if (!/^\d{1,4}$/.test(trimmed)) {
    throw new UnknownDutyCodeError(code);
  }
  return Number.parseInt(trimmed, 10);
}

/** De volledige classificatie: dagdeel, werksoort en de afgeleide etiketten. */
export function classifyDuty(code: string | number): DutyClassification {
  const numeric = typeof code === "number" ? code : parseDutyCode(code);

  const exception = DUTY_EXCEPTIONS.get(numeric);
  if (exception) {
    return withKinds(exception.period, exception.workType);
  }

  for (const range of DUTY_RANGES) {
    if (numeric >= range.from && numeric <= range.to) {
      return withKinds(range.period, range.workType);
    }
  }

  throw new UnknownDutyCodeError(String(code));
}

/**
 * De afvlakking van dagdeel en werksoort naar de etiketten van de regels.
 *
 * Rijdend werk levert geen apart etiket op: dat is het normale geval en zou
 * alleen ruis toevoegen aan elke regel die op `kinds` filtert.
 */
function withKinds(period: DutyPeriod, workType: DutyWorkType): DutyClassification {
  const kinds: DutyKind[] = [];
  if (period === DutyPeriod.VROEG) {
    kinds.push(DutyKind.VROEG);
  }
  if (period === DutyPeriod.LAAT) {
    kinds.push(DutyKind.LAAT);
  }
  if (period === DutyPeriod.NACHT) {
    kinds.push(DutyKind.NACHT);
  }
  if (workType === DutyWorkType.RANGEER) {
    kinds.push(DutyKind.RANGEER);
  }
  if (workType === DutyWorkType.RESERVE) {
    kinds.push(DutyKind.RESERVE);
  }
  return { period, workType, kinds };
}

/** De etiketten waartoe dit dienstnummer behoort. Nooit leeg. */
export function classifyDutyCode(code: string | number): readonly DutyKind[] {
  return classifyDuty(code).kinds;
}

/** Classificatie die niet gooit: null wanneer het nummer onbekend is. */
export function tryClassifyDuty(code: string | number): DutyClassification | null {
  try {
    return classifyDuty(code);
  } catch {
    return null;
  }
}

/** Etiketten die niet gooit: null wanneer het nummer onbekend is. */
export function tryClassifyDutyCode(code: string | number): readonly DutyKind[] | null {
  return tryClassifyDuty(code)?.kinds ?? null;
}

const KIND_LABELS: Record<DutyKind, string> = {
  VROEG: "Vroeg",
  LAAT: "Laat",
  NACHT: "Nacht",
  RESERVE: "Reserve",
  RANGEER: "Rangeer",
};

export const PERIOD_LABELS: Record<DutyPeriod, string> = {
  VROEG: "Vroeg",
  LAAT: "Laat",
  NACHT: "Nacht",
  GEEN: "Geen dagdeel",
};

export const WORK_TYPE_LABELS: Record<DutyWorkType, string> = {
  RIJDEND: "Rijdend",
  RANGEER: "Rangeer",
  RESERVE: "Reserve",
};

/** Een leesbaar label voor de gebruikersinterface. */
export function describeDutyKinds(kinds: readonly DutyKind[]): string {
  return kinds.map((kind) => KIND_LABELS[kind]).join(" + ");
}

export function dutyKindLabel(kind: DutyKind): string {
  return KIND_LABELS[kind];
}

/**
 * Is dit een dienst uit de 600-serie?
 *
 * Let op: dat is iets anders dan een RES-positie in een rooster. Een 600-dienst
 * is een echte dienst uit het dienstenpakket; RES is een plek in het rooster
 * die later met een dienst wordt ingevuld.
 */
export function isReserveDuty(code: string | number): boolean {
  return tryClassifyDuty(code)?.workType === DutyWorkType.RESERVE;
}

/** De dagdeelsoorten (vroeg/laat/nacht), zonder reserve en rangeer. */
export function timeOfDayKinds(kinds: readonly DutyKind[]): readonly DutyKind[] {
  const timeOfDay: readonly DutyKind[] = [DutyKind.VROEG, DutyKind.LAAT, DutyKind.NACHT];
  return kinds.filter((kind) => timeOfDay.includes(kind));
}

/** Alle bekende bereiken, voor documentatie- en beheerschermen. */
export function dutyRangeTable(): readonly DutyRange[] {
  return DUTY_RANGES;
}

/** De uitzonderingen, voor documentatie- en beheerschermen. */
export function dutyExceptionTable(): ReadonlyMap<
  number,
  { period: DutyPeriod; workType: DutyWorkType }
> {
  return DUTY_EXCEPTIONS;
}

// ── Dagdeel uit de aanvangstijd, voor diensten zonder dagdeel op nummer ─────

/**
 * Een dienst zoals hij in een pakket staat, met wat er nodig is om zijn dagdeel
 * af te leiden.
 */
export interface DaypartSubject {
  readonly code: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly period: DutyPeriod;
  readonly workType: DutyWorkType;
  readonly kinds: readonly string[];
}

/** Hoe het dagdeel van één dienstinstantie is vastgesteld. */
export interface DerivedDaypart {
  readonly code: string;
  readonly weekday: number;
  readonly period: DutyPeriod;
  /** Afstand in minuten tot het venster van het gekozen dagdeel; 0 = erbinnen. */
  readonly distanceMinutes: number;
}

export interface DaypartResolution<T> {
  readonly duties: readonly T[];
  /** Diensten die hun dagdeel uit de aanvangstijd kregen. */
  readonly derived: readonly DerivedDaypart[];
  /** Diensten waarvoor dat niet eenduidig kon; die houden `GEEN`. */
  readonly unresolved: readonly { readonly code: string; readonly weekday: number; readonly reason: string }[];
}

const DAGDELEN = [DutyPeriod.VROEG, DutyPeriod.LAAT, DutyPeriod.NACHT] as const;
const MINUTEN_PER_DAG = 24 * 60;

/**
 * Geef diensten zonder dagdeel op nummer het dagdeel dat hun aanvangstijd heeft.
 *
 * ## Het probleem
 *
 * De 600- en 700-series krijgen op nummer geen dagdeel: reserve en rangeer zijn
 * een werksoort, geen tijdstip. Maar dienst 701 begint om 05:01 en dienst 732
 * om 18:00. Zonder dagdeel sloot geen enkel profiel ze uit, want
 * `profileAllowsDuty` kijkt alleen naar vroeg/laat/nacht. Het gevolg stond op
 * een gegenereerd Laat/Nacht-blad: dienst 701, 05:01–13:00, in een rooster
 * waarin geen vroege dienst hoort.
 *
 * ## Waarom geen vaste klokgrens
 *
 * Er is geen aangeleverde regel die zegt waar "vroeg" ophoudt, en een grens die
 * hier zou staan, zou verzonnen zijn. Het pakket zelf zegt het wel: de
 * vroegdiensten (1–99) beginnen tussen hun vroegste en laatste aanvangstijd, de
 * late diensten (100–199) tussen de hunne, de nachtdiensten idem. Een dienst
 * zonder dagdeel krijgt het dagdeel van het venster waar zijn aanvangstijd in
 * valt of het dichtst bij ligt — per pakket bepaald, dus een ander pakket met
 * andere tijden levert andere vensters op.
 *
 * Dit is getoetst tegen de officiële Dordrechtse roosters: 701 en 702 staan
 * daar uitsluitend in Vroeg, Vroeg/Laat, Mix en BLM; 730–732 uitsluitend in
 * profielen met late diensten. De afleiding hieronder levert precies die
 * indeling op, en `verify:profielen` bewaakt dat elk officieel rooster onder
 * deze indeling profielgeldig blijft.
 *
 * ## Wat er niet gebeurt
 *
 * De CAO-definitie van nachtdienst (meer dan een uur tussen 00:00 en 06:00)
 * wordt hier niet gebruikt. Dat is een juridische toets op werkelijke tijden;
 * het dagdeel is de lokale indeling waarop roosterprofielen rusten. Dienst 101
 * loopt tot 01:24 en is toch een late dienst. Die twee door elkaar halen zou de
 * late roosters vol "nachtdiensten" zetten.
 *
 * ## Overlappende vensters
 *
 * De vensters kunnen elkaar overlappen: in Dordrecht begint een enkele
 * vroegdienst later dan de vroegste late dienst. Valt een aanvangstijd in meer
 * dan één venster, dan beslist de afstand tot de mediane aanvangstijd van elk
 * dagdeel — het midden van waar dat dagdeel werkelijk begint, niet een uitschieter
 * aan de rand. Dienst 731 op vrijdag (11:00) valt zo onder laat, en staat in de
 * officiële roosters ook uitsluitend in profielen met late diensten.
 *
 * Blijft het daarna nog gelijk, dan wordt niet gekozen: de dienst houdt `GEEN`
 * en wordt gemeld.
 */
export function resolveDayparts<T extends DaypartSubject>(duties: readonly T[]): DaypartResolution<T> {
  const startsPerDagdeel = new Map<DutyPeriod, number[]>();
  for (const dienst of duties) {
    if (!(DAGDELEN as readonly DutyPeriod[]).includes(dienst.period)) {
      continue;
    }
    const lijst = startsPerDagdeel.get(dienst.period) ?? [];
    lijst.push(normaliseerMinuut(dienst.startMinute));
    startsPerDagdeel.set(dienst.period, lijst);
  }
  const vensters = new Map<DutyPeriod, { lo: number; hi: number; median: number }>();
  for (const [period, starts] of startsPerDagdeel) {
    const gesorteerd = [...starts].sort((a, b) => a - b);
    const midden = Math.floor(gesorteerd.length / 2);
    const median =
      gesorteerd.length % 2 === 1
        ? gesorteerd[midden]
        : (gesorteerd[midden - 1] + gesorteerd[midden]) / 2;
    vensters.set(period, { lo: gesorteerd[0], hi: gesorteerd[gesorteerd.length - 1], median });
  }

  const derived: DerivedDaypart[] = [];
  const unresolved: { code: string; weekday: number; reason: string }[] = [];

  const uitkomst = duties.map((dienst) => {
    if (dienst.period !== DutyPeriod.GEEN) {
      return dienst;
    }
    if (vensters.size === 0) {
      unresolved.push({
        code: dienst.code,
        weekday: dienst.weekday,
        reason: "het pakket bevat geen diensten met een dagdeel op nummer om mee te vergelijken",
      });
      return dienst;
    }

    const start = normaliseerMinuut(dienst.startMinute);
    const afstanden = [...vensters.entries()]
      .map(([period, venster]) => ({
        period,
        afstand: afstandTotVenster(start, venster),
        totMediaan: klokafstand(start, venster.median),
      }))
      .sort((a, b) => a.afstand - b.afstand || a.totMediaan - b.totMediaan);

    if (
      afstanden.length > 1 &&
      afstanden[0].afstand === afstanden[1].afstand &&
      afstanden[0].totMediaan === afstanden[1].totMediaan
    ) {
      unresolved.push({
        code: dienst.code,
        weekday: dienst.weekday,
        reason:
          `de aanvangstijd ligt even ver van ${afstanden[0].period.toLowerCase()} als van ` +
          `${afstanden[1].period.toLowerCase()}`,
      });
      return dienst;
    }

    const gekozen = afstanden[0];
    derived.push({
      code: dienst.code,
      weekday: dienst.weekday,
      period: gekozen.period,
      distanceMinutes: gekozen.afstand,
    });
    const classificatie = withKinds(gekozen.period, dienst.workType);
    return { ...dienst, period: classificatie.period, kinds: classificatie.kinds };
  });

  return { duties: uitkomst, derived, unresolved };
}

function normaliseerMinuut(minuut: number): number {
  return ((minuut % MINUTEN_PER_DAG) + MINUTEN_PER_DAG) % MINUTEN_PER_DAG;
}

/** Afstand van een tijdstip tot een venster op de klok, rond middernacht heen. */
function afstandTotVenster(minuut: number, venster: { lo: number; hi: number }): number {
  if (minuut >= venster.lo && minuut <= venster.hi) {
    return 0;
  }
  return Math.min(klokafstand(minuut, venster.lo), klokafstand(minuut, venster.hi));
}

/** Afstand tussen twee kloktijden in minuten, de kortste kant om de klok. */
function klokafstand(a: number, b: number): number {
  const verschil = Math.abs(a - b);
  return Math.min(verschil, MINUTEN_PER_DAG - verschil);
}
