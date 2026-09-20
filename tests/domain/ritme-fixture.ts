import { type EvaluationInput, evaluateQuality } from "@/domain/quality-evaluator";
import { CURRENT_QUALITY_MODEL, type QualityModel } from "@/domain/quality-model";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "@/domain/roster-quality";

/**
 * Synthetische roosters voor de ritmetests.
 *
 * Schrijfwijze: per regel een tekst van zeven tekens, maandag tot en met
 * zondag. Hoofdletters zijn diensten (zie SOORTEN), R is rust, S is reserve.
 * Alle diensten duren acht uur, zodat twee varianten met evenveel diensten
 * dezelfde uren hebben en alleen in ritme verschillen.
 */

export interface Soort {
  readonly start: number;
  readonly eind: number;
  readonly kinds: readonly string[];
}

export const SOORTEN: Record<string, Soort> = {
  V: { start: 6 * 60, eind: 14 * 60, kinds: ["VROEG"] },
  L: { start: 14 * 60, eind: 22 * 60, kinds: ["LAAT"] },
  N: { start: 22 * 60, eind: 30 * 60, kinds: ["NACHT"] },
  // Vroeg met een andere begintijd, voor het verspringen binnen een dagdeel.
  A: { start: 4 * 60 + 30, eind: 12 * 60 + 30, kinds: ["VROEG"] },
  B: { start: 9 * 60, eind: 17 * 60, kinds: ["VROEG"] },
  // Laat met vergelijkbare tijden: vier van deze na elkaar is stabiel.
  K: { start: 15 * 60, eind: 23 * 60, kinds: ["LAAT"] },
  // 50+ Mix: vroeg en laat overlappen op de klok.
  P: { start: 10 * 60, eind: 17 * 60 + 30, kinds: ["VROEG"] },
  Q: { start: 11 * 60, eind: 19 * 60, kinds: ["LAAT"] },
};

export function diensten(): Map<string, QualityDuty> {
  const kaart = new Map<string, QualityDuty>();
  for (const [letter, soort] of Object.entries(SOORTEN)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const code = `${letter}${weekday}`;
      kaart.set(dutyKey(code, weekday), { code, weekday, startMinute: soort.start, endMinute: soort.eind, kinds: soort.kinds });
    }
  }
  return kaart;
}

export function rooster(code: string, profile: string, regels: readonly string[]): QualityRosterInput {
  return {
    code,
    name: code,
    profile,
    weeksPerLine: 1,
    days: regels.flatMap((regel, index) =>
      [...regel].map((teken, dag) => {
        const isDienst = teken in SOORTEN;
        return {
          lineNumber: index + 1,
          weekIndex: 1,
          weekday: dag + 1,
          positionType: isDienst ? "DUTY" : teken === "S" ? "RES" : "RUST",
          dutyCode: isDienst ? `${teken}${dag + 1}` : null,
        };
      }),
    ),
  };
}

export function meet(rosters: readonly QualityRosterInput[], model: QualityModel = CURRENT_QUALITY_MODEL) {
  const input: EvaluationInput = {
    rosters,
    reference: rosters,
    duties: diensten(),
    requiredDutyKeys: rosters.flatMap((r) => r.days.filter((d) => d.dutyCode).map((d) => dutyKey(d.dutyCode!, d.weekday))),
    nightRosterCodes: rosters.filter((r) => r.days.some((d) => d.dutyCode?.startsWith("N"))).map((r) => r.code),
    rules: { minDailyRestMinutes: 720, nightRecoveryMinutes: 46 * 60, longDutyMinutes: 540 },
    model,
  };
  return evaluateQuality(input);
}

/** Een regel van veertien dagen als tekst: aangevuld met rust tot de lengte klopt. */
export function vul(tekst: string, lengte = 14): string[] {
  const volledig = tekst.padEnd(lengte, "R").slice(0, lengte);
  const regels: string[] = [];
  for (let i = 0; i < volledig.length; i += 7) regels.push(volledig.slice(i, i + 7));
  return regels;
}
