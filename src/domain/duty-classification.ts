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
