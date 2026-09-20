import { type DutyClass, DUTY_CLASS_LABELS, dutyClass, nightWindowExposure } from "./duty-class";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "./roster-quality";

/**
 * Profielaffiniteit: niet "mag deze dienst hier?" maar "hoe graag hier?".
 *
 * ## Twee vragen die het platform eerst niet scheidde
 *
 * De profielgrens (`roster-profiles.ts`) zegt of een dienst in een rooster mag.
 * Dat blijft hard. Deze module zegt hoe goed een toegestane dienst bij het
 * karakter van een profiel past — een zachte voorkeur van machinisten, geen
 * CAO-regel en geen gezondheidsclaim.
 *
 * ## Wat de tabel wel en niet is
 *
 * Drie niveaus: voorkeur, neutraal, minder passend. Alleen de richting heeft een
 * bron — de machinisteninvoer bij de werkopdracht (paragraaf erbij), of voor
 * 50+ Mix, waar die invoer niets over zegt, het menselijke rooster zelf; voor
 * dagachtige diensten de relatieve gewichten van de gebruiker (DAY_DUTY_WEIGHTS).
 * De afstand tussen de niveaus is een aanname; hoe zwaar de voorkeur weegt,
 * bepalen de wisselkoersen en de A/B, niet deze tabel. Waar geen bron is
 * (BLM buiten de dagdiensten, Reserve), is alles neutraal.
 *
 * Met opzet géén monopolie: "extreem vroeg" is voor Vroeg een voorkeur, maar
 * voor Vroeg/Laat en Mix neutraal, niet minder passend — ook zij moeten er een
 * redelijk deel van houden (§5). De verdeling wordt daarnaast bewaakt met de
 * spreiding van de affiniteit en van de blootstelling over de roosters.
 */

export type AffinityLevel = "PREFERRED" | "NEUTRAL" | "LESS";

export const AFFINITY_VALUE: Readonly<Record<AffinityLevel, number>> = { PREFERRED: 1, NEUTRAL: 0.6, LESS: 0.2 };

interface Cel {
  readonly level: AffinityLevel;
  readonly source: string;
}

const N: Cel = { level: "NEUTRAL", source: "geen specifieke voorkeur" };

/**
 * Relatieve gewichten voor dagachtige diensten (dagachtig vroeg en vroege late),
 * opgegeven door de gebruiker (werkopdracht, "dagdiensten — relatieve affinity"):
 * geen percentages, maar gewichten die per concrete dienst genormaliseerd worden
 * over de roosters die hem mogen rijden. Bron: HUMAN_DOMAIN_INPUT.
 *
 * Vroeg staat niet in de opgave. Aanname: 10, gelijk aan Laat — wie voor Vroeg
 * kiest, wil vroeg beginnen én vroeg klaar zijn; een dienst vanaf 09:00 is voor
 * Vroeg wat een vroege late voor Laat is. Gevoeligheid 0 en 20 in het rapport.
 * Reserve staat er ook niet in en heeft in Dordrecht geen rooster; 20 (midden).
 */
export const DAY_DUTY_WEIGHTS: Readonly<Record<string, { readonly weight: number; readonly source: string }>> = {
  LAAT: { weight: 10, source: "HUMAN_DOMAIN_INPUT" },
  MIX: { weight: 20, source: "HUMAN_DOMAIN_INPUT (Vroeg/Laat/Nacht)" },
  VROEG_LAAT: { weight: 20, source: "HUMAN_DOMAIN_INPUT" },
  BLM: { weight: 20, source: "HUMAN_DOMAIN_INPUT" },
  LAAT_NACHT: { weight: 10, source: "HUMAN_DOMAIN_INPUT" },
  MIX_50PLUS: { weight: 40, source: "HUMAN_DOMAIN_INPUT" },
  VROEG: { weight: 10, source: "AANNAME: niet opgegeven; gelijk aan Laat (spiegelbeeld)" },
  RESERVE: { weight: 20, source: "AANNAME: niet opgegeven; midden van de opgave" },
};

/** Dagachtige diensten: overdag begonnen en overdag klaar. */
export const DAY_DUTY_CLASSES: readonly DutyClass[] = ["DAYLIKE_EARLY", "EARLY_LATE"];

const dag = (profiel: string): Cel => {
  const w = DAY_DUTY_WEIGHTS[profiel]?.weight ?? 20;
  // Verhouding tot het hoogste gewicht (50+ Mix, 40): 1 → voorkeur, ½ → neutraal, ¼ → minder.
  const level: AffinityLevel = w >= 40 ? "PREFERRED" : w >= 20 ? "NEUTRAL" : "LESS";
  return { level, source: `dagdienstgewicht ${w} (${DAY_DUTY_WEIGHTS[profiel]?.source ?? "aanname"})` };
};

/** Per profiel per klasse. Een klasse die een profiel niet mag rijden, staat er niet in. */
export const PROFILE_AFFINITY: Readonly<Record<string, Readonly<Partial<Record<DutyClass, Cel>>>>> = {
  VROEG: {
    EXTREME_EARLY: { level: "PREFERRED", source: "§3–4: vroeg beginnen is vroeg klaar; Vroeg krijgt voorrang op extreem vroeg" },
    EARLY: { level: "NEUTRAL", source: "§30: Vroeg krijgt ook gematigd vroeg, maar niet als hoogste voorkeur" },
    DAYLIKE_EARLY: dag("VROEG"),
  },
  VROEG_LAAT: {
    EXTREME_EARLY: { level: "NEUTRAL", source: "§5, §7: mag zeker voorkomen, ook voor verdeling en toeslagen" },
    EARLY: { level: "PREFERRED", source: "§6–7: vroeg vanaf ongeveer 05:30 heeft hier de voorkeur" },
    DAYLIKE_EARLY: dag("VROEG_LAAT"),
    EARLY_LATE: dag("VROEG_LAAT"),
    LATE: N,
    PREMIUM_LATE: N,
  },
  LAAT: {
    EARLY_LATE: { level: "LESS", source: "§14: vroeg beginnen en vroeg eindigen past minder bij Laat; dagdienstgewicht 10" },
    LATE: N,
    PREMIUM_LATE: { level: "PREFERRED", source: "§12–13, §31: de echte aflopers, lichte structurele voorkeur" },
  },
  LAAT_NACHT: {
    EARLY_LATE: dag("LAAT_NACHT"),
    LATE: N,
    PREMIUM_LATE: { level: "NEUTRAL", source: "§31: houdt genoeg aantrekkelijke late diensten, maar heeft ook nachten" },
    NIGHT: { level: "PREFERRED", source: "profielkarakter: laat plus duidelijke nachtreeksen" },
  },
  MIX: {
    EXTREME_EARLY: { level: "NEUTRAL", source: "§8: extreem vroeg hoeft hier niet de grootste concentratie te hebben" },
    EARLY: { level: "PREFERRED", source: "§7–8, §30: gematigd vroeg relatief aantrekkelijker voor Vroeg/Laat en Vroeg/Laat/Nacht" },
    DAYLIKE_EARLY: dag("MIX"),
    EARLY_LATE: dag("MIX"),
    LATE: N,
    PREMIUM_LATE: N,
    NIGHT: N,
  },
  MIX_50PLUS: {
    EXTREME_EARLY: { level: "LESS", source: "menselijk rooster: 0 van 26 extreem vroege diensten in 50+ Mix" },
    EARLY: N,
    DAYLIKE_EARLY: { level: "PREFERRED", source: "dagdienstgewicht 40 (HUMAN_DOMAIN_INPUT); menselijk rooster: lift 4,9" },
    EARLY_LATE: { level: "PREFERRED", source: "dagdienstgewicht 40 (HUMAN_DOMAIN_INPUT); menselijk rooster: lift 2,2" },
    LATE: N,
    PREMIUM_LATE: { level: "LESS", source: "menselijk rooster: 0 van 36 aflopers in 50+ Mix" },
    NIGHT: { level: "LESS", source: "menselijk rooster: geen nachten in 50+ Mix" },
  },
  BLM: { DAYLIKE_EARLY: dag("BLM"), EARLY_LATE: dag("BLM") },
  RESERVE: {},
};

/** De affiniteitswaarde van een klasse voor een profiel (0,2 / 0,6 / 1), zonder dienst. */
export function affinityValue(profile: string, klasse: DutyClass): number {
  return AFFINITY_VALUE[(PROFILE_AFFINITY[profile]?.[klasse] ?? N).level];
}

export interface DutyAffinity {
  readonly dutyClass: DutyClass;
  readonly level: AffinityLevel;
  readonly value: number;
  readonly source: string;
}

export function dutyAffinity(profile: string, duty: Pick<QualityDuty, "startMinute" | "endMinute" | "kinds">): DutyAffinity {
  const klasse = dutyClass(duty);
  const cel = PROFILE_AFFINITY[profile]?.[klasse] ?? N;
  return { dutyClass: klasse, level: cel.level, value: AFFINITY_VALUE[cel.level], source: cel.source };
}

export interface AffinityMetrics {
  /** Gemiddelde affiniteit over alle dienstdagen, 0–1. */
  readonly mean: number | null;
  /** De regel met de laagste gemiddelde affiniteit. */
  readonly worstLine: { readonly roster: string; readonly lineNumber: number; readonly mean: number } | null;
  /** Grootste verschil tussen roosters in gemiddelde affiniteit: 0 = geen rooster is een restbak. */
  readonly rosterSpread: number | null;
  readonly perRoster: Readonly<
    Record<
      string,
      {
        readonly profile: string;
        readonly mean: number | null;
        readonly classes: Readonly<Record<string, number>>;
        /** Proxy voor toeslagblootstelling, per week: GEEN toeslag (zie duty-class.ts). */
        readonly nightWindowMinutesPerWeek: number;
        readonly weekendMinutesPerWeek: number;
      }
    >
  >;
  /** Spreiding (variatiecoëfficiënt) van de blootstelling per week tussen de roosters. */
  readonly exposureSpread: number | null;
}

export function affinityMetrics(rosters: readonly QualityRosterInput[], duties: ReadonlyMap<string, QualityDuty>): AffinityMetrics {
  const perRooster: Record<string, { profile: string; mean: number | null; classes: Record<string, number>; nightWindowMinutesPerWeek: number; weekendMinutesPerWeek: number }> = {};
  let som = 0;
  let n = 0;
  let slechtste: AffinityMetrics["worstLine"] = null;
  for (const r of rosters) {
    const weken = new Set(r.days.map((d) => `${d.lineNumber}|${d.weekIndex}`)).size || 1;
    const perRegel = new Map<number, { som: number; n: number }>();
    const klassen: Record<string, number> = {};
    let rs = 0;
    let rn = 0;
    let nacht = 0;
    let weekend = 0;
    for (const d of r.days) {
      if (d.positionType !== "DUTY" || !d.dutyCode) continue;
      const dienst = duties.get(dutyKey(d.dutyCode, d.weekday));
      if (!dienst) continue;
      const a = dutyAffinity(r.profile, dienst);
      klassen[a.dutyClass] = (klassen[a.dutyClass] ?? 0) + 1;
      rs += a.value;
      rn += 1;
      const regel = perRegel.get(d.lineNumber) ?? { som: 0, n: 0 };
      regel.som += a.value;
      regel.n += 1;
      perRegel.set(d.lineNumber, regel);
      nacht += nightWindowExposure(dienst);
      if (d.weekday >= 6) weekend += dienst.endMinute - dienst.startMinute;
    }
    som += rs;
    n += rn;
    for (const [regel, x] of perRegel) {
      const g = x.som / x.n;
      if (slechtste === null || g < slechtste.mean) slechtste = { roster: r.code, lineNumber: regel, mean: g };
    }
    perRooster[r.code] = { profile: r.profile, mean: rn ? rs / rn : null, classes: klassen, nightWindowMinutesPerWeek: nacht / weken, weekendMinutesPerWeek: weekend / weken };
  }
  const gemiddelden = Object.values(perRooster).map((r) => r.mean).filter((x): x is number => x !== null);
  const blootstelling = Object.values(perRooster).map((r) => r.nightWindowMinutesPerWeek + r.weekendMinutesPerWeek);
  const gem = blootstelling.reduce((a, b) => a + b, 0) / (blootstelling.length || 1);
  const sd = Math.sqrt(blootstelling.reduce((a, b) => a + (b - gem) ** 2, 0) / (blootstelling.length || 1));
  return {
    mean: n ? som / n : null,
    worstLine: slechtste,
    rosterSpread: gemiddelden.length ? Math.max(...gemiddelden) - Math.min(...gemiddelden) : null,
    perRoster: perRooster,
    exposureSpread: gem > 0 ? sd / gem : null,
  };
}

/** De uitleg bij één toewijzing: waarom hier, in woorden (§41–42). */
export function explainAllocation(input: {
  readonly profile: string;
  readonly profileLabel: string;
  readonly duty: QualityDuty;
  readonly alternatives: readonly { readonly profile: string; readonly label: string }[];
}): string {
  const eigen = dutyAffinity(input.profile, input.duty);
  const hm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const anders = input.alternatives
    .filter((a) => a.profile !== input.profile)
    .map((a) => `${a.label} ${dutyAffinity(a.profile, input.duty).level.toLowerCase()}`)
    .join(", ");
  return `${DUTY_CLASS_LABELS[eigen.dutyClass]} (${hm(input.duty.startMinute)}–${hm(input.duty.endMinute)}); voor ${input.profileLabel} ${eigen.level.toLowerCase()} (${eigen.source})${anders ? `; elders: ${anders}` : ""}`;
}
