import { type DutyClass, dutyClass, nightWindowExposure } from "./duty-class";
import { freeWeekends } from "./operational-requirements";
import { DAY_DUTY_CLASSES, DAY_DUTY_WEIGHTS, dutyAffinity } from "./profile-affinity";
import { profileAllowsDuty } from "./roster-profiles";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "./roster-quality";
import type { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";

/**
 * Machinistenvoorkeur op pakketniveau: wat een machinist prettig vindt aan zijn
 * profiel, en of populaire diensten eerlijk over de profielen zijn verdeeld.
 *
 * ## Drie lagen, hier alleen de laatste twee
 *
 * Of een dienst in een profiel mág, staat in `roster-profiles.ts` en blijft
 * hard. Hier: hoe goed hij past (affiniteit, `profile-affinity.ts`) en of de
 * verdeling over het pakket eerlijk is. Bronstatus MACHINIST_PREFERENCE en
 * HUMAN_DOMAIN_INPUT; geen CAO, geen gezondheidsclaim, geen toeslagbedragen.
 *
 * ## De vijf delen
 *
 * - affiniteit: gemiddelde affiniteit van alle dienstdagen;
 * - restdiensten: het grootste aandeel "minder passend" in één rooster — een
 *   gemiddelde mag goed zijn terwijl één profiel de restbak is;
 * - dagdiensten: werkelijke tegen beoogde verdeling van dagachtige diensten,
 *   volgens de relatieve gewichten van de gebruiker;
 * - populair eerlijk: krijgt elk geschikt rooster zijn deel van de aflopers en
 *   de extreem vroege diensten? Voorkeur is geen monopolie;
 * - weekendbegin: hoe vroeg de vrijdagdienst vóór een vrij weekend klaar is,
 *   met afnemende meeropbrengst.
 *
 * Ontwerp en aannames: `docs/v1.0.4-final-brain/machinist-preferences/design.md`.
 */

export const PREFERENCE_CALIBRATION = {
  /** Een geschikt rooster hoort minstens dit deel van het gemiddelde per regel te krijgen. */
  popularFloorShare: 0.5,
  popularClasses: ["PREMIUM_LATE", "EXTREME_EARLY"] as readonly DutyClass[],
  weekendStart: {
    /** Vóór dit einde telt de vrijdag volledig. */
    fullUntilMinute: 17 * 60,
    /** Over dit interval zakt de waarde met `drop`, met exponent `exponent`. */
    spanMinutes: 6 * 60,
    drop: 0.3,
    exponent: 1.5,
  },
} as const;

type Rooster = QualityRosterInput;
type Diensten = ReadonlyMap<string, QualityDuty>;

function dienstDagen(rooster: Rooster, diensten: Diensten) {
  const uit: { lineNumber: number; weekday: number; duty: QualityDuty }[] = [];
  for (const d of rooster.days) {
    if (d.positionType !== "DUTY" || !d.dutyCode) continue;
    const duty = diensten.get(dutyKey(d.dutyCode, d.weekday));
    if (duty) uit.push({ lineNumber: d.lineNumber, weekday: d.weekday, duty });
  }
  return uit;
}

const regels = (rooster: Rooster) => new Set(rooster.days.map((d) => d.lineNumber)).size;
const mag = (rooster: Rooster, duty: QualityDuty) => profileAllowsDuty(rooster.profile as RosterProfile, duty.kinds as DutyKind[]);

export interface DayDutyDistribution {
  readonly total: number;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  /** Totale-variatieafstand tussen werkelijk en verwacht, 0–1. */
  readonly distance: number | null;
}

/**
 * Dagachtige diensten tegen de relatieve gewichten, per profiel genormaliseerd:
 * elke geplaatste dagachtige dienst verdeelt zijn "verwachting" over de roosters
 * die hem mogen rijden, naar hun gewicht ("normaliseer alleen over profielen die
 * de concrete duty mogen rijden").
 *
 * Eerst stond hier "per regel" (gewicht × aantal regels), met als redenering dat
 * een profiel van twaalf regels niet twee keer zo gretig is als een van zes. De
 * meting sprak dat tegen: per profiel ligt het menselijke rooster dichter bij de
 * verdeling (afstand 0,213 tegen 0,246), en het is ook de letterlijke opdracht.
 * Zie assumption-sensitivity.json.
 */
export function dayDutyDistribution(
  rosters: readonly Rooster[],
  diensten: Diensten,
  options: {
    /** Per profiel (standaard) of per regel normaliseren; het tweede alleen voor de gevoeligheidsmeting. */
    readonly perLine?: boolean;
    /** Andere gewichten, alleen voor de gevoeligheidsmeting. */
    readonly weights?: Readonly<Record<string, number>>;
  } = {},
): DayDutyDistribution {
  const perRegel = options.perLine ?? false;
  const gewicht = (r: Rooster) => (options.weights?.[r.profile] ?? DAY_DUTY_WEIGHTS[r.profile]?.weight ?? 20) * (perRegel ? regels(r) : 1);
  const expected: Record<string, number> = Object.fromEntries(rosters.map((r) => [r.code, 0]));
  const actual: Record<string, number> = Object.fromEntries(rosters.map((r) => [r.code, 0]));
  let total = 0;
  for (const rooster of rosters) {
    for (const { duty } of dienstDagen(rooster, diensten)) {
      if (!DAY_DUTY_CLASSES.includes(dutyClass(duty))) continue;
      const geschikt = rosters.filter((r) => mag(r, duty));
      const noemer = geschikt.reduce((s, r) => s + gewicht(r), 0);
      if (noemer === 0) continue;
      total += 1;
      actual[rooster.code] += 1;
      for (const r of geschikt) expected[r.code] += gewicht(r) / noemer;
    }
  }
  const distance =
    total > 0 ? rosters.reduce((s, r) => s + Math.abs(actual[r.code] - expected[r.code]), 0) / (2 * total) : null;
  return { total, expected, actual, distance };
}

export interface PopularFairness {
  readonly score: number | null;
  readonly perClass: Readonly<
    Record<
      string,
      {
        readonly score: number | null;
        readonly perLine: Readonly<Record<string, number>>;
        readonly averagePerLine: number | null;
        readonly maxShare: number | null;
        readonly suitable: readonly string[];
      }
    >
  >;
}

/**
 * Populaire diensten eerlijk verdeeld: een geschikt rooster (mag de dienst rijden
 * én vindt hem niet "minder passend") hoort minstens `popularFloorShare` van het
 * gemiddelde per regel te krijgen. Per rooster min(1, eigen / vloer), gemiddeld.
 */
export function popularFairness(
  rosters: readonly Rooster[],
  diensten: Diensten,
  floorShare: number = PREFERENCE_CALIBRATION.popularFloorShare,
): PopularFairness {
  const perClass: Record<string, PopularFairness["perClass"][string]> = {};
  const scores: number[] = [];
  for (const klasse of PREFERENCE_CALIBRATION.popularClasses) {
    // Welke roosters zijn geschikt? Kijk naar een dienst van deze klasse uit het pakket.
    const voorbeeld = [...diensten.values()].find((d) => dutyClass(d) === klasse);
    if (!voorbeeld) continue;
    const geschikt = rosters.filter((r) => mag(r, voorbeeld) && dutyAffinity(r.profile, voorbeeld).level !== "LESS");
    const tellingen = rosters.map((r) => ({ code: r.code, n: dienstDagen(r, diensten).filter((x) => dutyClass(x.duty) === klasse).length }));
    const totaal = tellingen.reduce((s, x) => s + x.n, 0);
    const perLine: Record<string, number> = {};
    for (const r of geschikt) perLine[r.code] = (tellingen.find((x) => x.code === r.code)?.n ?? 0) / regels(r);
    const regelsGeschikt = geschikt.reduce((s, r) => s + regels(r), 0);
    const inGeschikt = geschikt.reduce((s, r) => s + (tellingen.find((x) => x.code === r.code)?.n ?? 0), 0);
    const gemiddeld = regelsGeschikt > 0 ? inGeschikt / regelsGeschikt : null;
    const score =
      gemiddeld && geschikt.length > 1
        ? geschikt.reduce((s, r) => s + Math.min(1, perLine[r.code] / (floorShare * gemiddeld)), 0) / geschikt.length
        : null;
    if (score !== null) scores.push(score);
    perClass[klasse] = {
      score,
      perLine,
      averagePerLine: gemiddeld,
      maxShare: totaal > 0 ? Math.max(...tellingen.map((x) => x.n)) / totaal : null,
      suitable: geschikt.map((r) => r.code),
    };
  }
  return { score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, perClass };
}

/** De waarde van een vrijdageinde vóór een vrij weekend, 0–1, afnemende meeropbrengst. */
export function weekendStartValue(friday: { readonly endMinute: number | null; readonly night: boolean } | null): number {
  const k = PREFERENCE_CALIBRATION.weekendStart;
  if (!friday || friday.endMinute === null) return 1;
  // Een nachtdienst is uitgezonderd van de vrijdageis; hij krijgt de waarde van
  // het laatst toegestane einde. De nachtreeks zelf telt bij "nachten".
  const einde = friday.night ? 24 * 60 - 1 : friday.endMinute;
  if (einde <= k.fullUntilMinute) return 1;
  const x = Math.min(1, (einde - k.fullUntilMinute) / k.spanMinutes);
  return Math.max(0, 1 - k.drop * x ** k.exponent);
}

export interface PreferenceMetrics {
  /** De vijf delen, 0–1 (null als niet meetbaar). */
  readonly parts: {
    readonly affinity: number | null;
    readonly restDuties: number | null;
    readonly dayDuties: number | null;
    readonly popularFairness: number | null;
    readonly weekendStart: number | null;
  };
  readonly lineAffinity: ReadonlyMap<string, number>;
  readonly perRoster: Readonly<
    Record<
      string,
      {
        readonly profile: string;
        readonly affinity: number | null;
        readonly lessShare: number | null;
        readonly classes: Readonly<Record<string, number>>;
        readonly rangeer: number;
        readonly lines: number;
        readonly nightWindowMinutesPerWeek: number;
        readonly weekendMinutesPerWeek: number;
        readonly weekendStart: number | null;
        /**
         * Diagnose, geen score: een extreem vroege dienst (vóór 05:30) de dag na
         * een dienst die meer dan een uur later begon. "Geleidelijk vroeger is
         * prima, een stap naar extreem vroeg weegt zwaarder" (werkopdracht).
         */
        readonly extremeEarlySteps: number;
      }
    >
  >;
  readonly dayDuties: DayDutyDistribution;
  readonly popular: PopularFairness;
  readonly worstRestRoster: string | null;
}

/** Alles van de voorkeurslaag in één doorgang. */
export function preferenceMetrics(rosters: readonly Rooster[], diensten: Diensten): PreferenceMetrics {
  const perRoster: Record<string, PreferenceMetrics["perRoster"][string]> = {};
  const lineAffinity = new Map<string, number>();
  let som = 0;
  let n = 0;
  let slechtsteRest: { code: string; share: number } | null = null;
  const weekendWaarden: number[] = [];
  for (const r of rosters) {
    const dagen = dienstDagen(r, diensten);
    const perRegel = new Map<number, { s: number; n: number }>();
    const klassen: Record<string, number> = {};
    let rs = 0;
    let minder = 0;
    let rangeer = 0;
    let nacht = 0;
    let weekend = 0;
    for (const { lineNumber, weekday, duty } of dagen) {
      const a = dutyAffinity(r.profile, duty);
      klassen[a.dutyClass] = (klassen[a.dutyClass] ?? 0) + 1;
      rs += a.value;
      if (a.level === "LESS") minder += 1;
      if (duty.kinds.includes("RANGEER")) rangeer += 1;
      nacht += nightWindowExposure(duty);
      if (weekday >= 6) weekend += duty.endMinute - duty.startMinute;
      const x = perRegel.get(lineNumber) ?? { s: 0, n: 0 };
      x.s += a.value;
      x.n += 1;
      perRegel.set(lineNumber, x);
    }
    for (const [regel, x] of perRegel) lineAffinity.set(`${r.code}|${regel}`, x.s / x.n);
    som += rs;
    n += dagen.length;
    const lessShare = dagen.length ? minder / dagen.length : null;
    if (lessShare !== null && (slechtsteRest === null || lessShare > slechtsteRest.share)) slechtsteRest = { code: r.code, share: lessShare };
    const weekenden = freeWeekends(r, diensten).map((w) => weekendStartValue(w.friday));
    // Stap naar extreem vroeg: opeenvolgende dagen in rotatievolgorde.
    const cyclus = [...r.days].sort((a, b) => a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday);
    let stappen = 0;
    for (let i = 0; i < cyclus.length; i += 1) {
      const a = cyclus[i];
      const b = cyclus[(i + 1) % cyclus.length];
      if (a.positionType !== "DUTY" || b.positionType !== "DUTY" || !a.dutyCode || !b.dutyCode) continue;
      const da = diensten.get(dutyKey(a.dutyCode, a.weekday));
      const db = diensten.get(dutyKey(b.dutyCode, b.weekday));
      if (da && db && dutyClass(db) === "EXTREME_EARLY" && da.startMinute - db.startMinute > 60) stappen += 1;
    }
    weekendWaarden.push(...weekenden);
    const weken = regels(r) * r.weeksPerLine || 1;
    perRoster[r.code] = {
      profile: r.profile,
      affinity: dagen.length ? rs / dagen.length : null,
      lessShare,
      classes: klassen,
      rangeer,
      lines: regels(r),
      nightWindowMinutesPerWeek: nacht / weken,
      weekendMinutesPerWeek: weekend / weken,
      weekendStart: weekenden.length ? weekenden.reduce((a, b) => a + b, 0) / weekenden.length : null,
      extremeEarlySteps: stappen,
    };
  }
  const dayDuties = dayDutyDistribution(rosters, diensten);
  const popular = popularFairness(rosters, diensten);
  return {
    parts: {
      affinity: n ? som / n : null,
      restDuties: slechtsteRest ? 1 - slechtsteRest.share : null,
      dayDuties: dayDuties.distance === null ? null : 1 - dayDuties.distance,
      popularFairness: popular.score,
      weekendStart: weekendWaarden.length ? weekendWaarden.reduce((a, b) => a + b, 0) / weekendWaarden.length : null,
    },
    lineAffinity,
    perRoster,
    dayDuties,
    popular,
    worstRestRoster: slechtsteRest?.code ?? null,
  };
}
