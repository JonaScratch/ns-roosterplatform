import { ANCHOR_CREDIT_MINUTES, rosterHours } from "./roster-hours";
import type { QualityDuty, QualityRosterInput } from "./roster-quality";
import type { RosterPositionType } from "@/lib/generated/prisma/enums";

/**
 * Operationele ontwerpeisen die de gebruiker heeft opgegeven.
 *
 * ## Wat dit is, en wat niet
 *
 * Twee eisen uit de werkopdracht "machinist preference intelligence" (19
 * september 2026) die hard moeten zijn, maar geen wet, CAO, ATW of ATB zijn:
 *
 * - het gemiddelde van een basisrooster over al zijn regels is hoogstens 40:00
 *   per week (40:00 mag, 40:01 niet); een losse regel mag erboven;
 * - als zaterdag en zondag een vrij weekend vormen, is de vrijdagdienst
 *   uiterlijk 23:59 klaar — behalve een nachtdienst (besluit van de gebruiker,
 *   19 september 2026: "de vrijdageis geldt niet voor nachten"; een nachtreeks
 *   die vrijdagnacht eindigt en dan RUST, RUST krijgt, is precies wat de
 *   menselijke roosters doen).
 *
 * Bronstatus: `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`. Deze eisen staan
 * daarom níet in de regelmotor, waar elke regel een juridische bron heeft; ze
 * staan hier, met hun eigen bronstatus, en zijn per versie in te stellen.
 *
 * ## Wat de zoekmachine wel en niet kan
 *
 * Rust-, WR-, CO- en RES-dagen liggen vast in de roosterstructuur. Of een vrij
 * weekend RUST + RUST is, ligt dus vast en wordt hier alleen gecontroleerd en
 * gemeld (`structural`). De vrijdagdienst en de uren per rooster bepaalt de
 * zoekmachine wél; die twee zijn harde eisen in het CP-SAT-model, bij elke ruil
 * van het bijschaven en in de harde geldigheid van kwaliteitsmodel v3.
 *
 * ## Urensemantiek
 *
 * Dezelfde als het roosterblad en `rosterHours`: dienstduur (einde − begin,
 * pauze inbegrepen zoals op de bladen), plus acht uur per RES-, WR- en CO-dag,
 * R telt niet. Het weekgemiddelde wordt naar beneden afgerond op hele minuten,
 * zoals de bladen doen. "Hoogstens 40:00" is dus: totaal < 2401 × weken.
 */

export const OPERATIONAL_SOURCE_STATUS = "USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT" as const;

export const OPERATIONAL_REQUIREMENTS_V1 = {
  version: "operational-requirements-v1",
  sourceStatus: OPERATIONAL_SOURCE_STATUS,
  providedOn: "2026-09-19",
  rosterAverageHours: {
    /** Hoogstens dit gemiddelde per week over alle regels van een basisrooster. */
    maxAverageWeeklyMinutes: 40 * 60,
    semantics:
      "floor(roostercredit / cyclusweken) ≤ max; roostercredit = dienstduur + 8:00 per RES/WR/CO, R = 0 (roosterblad, rosterHours)",
  },
  freeWeekendFriday: {
    /** Einde van de vrijdagdienst, in minuten na vrijdag 00:00: 23:59. */
    latestEndMinute: 23 * 60 + 59,
    /** Nachtdiensten vallen erbuiten (besluit van de gebruiker, 19-09-2026). */
    exemptKinds: ["NACHT"] as readonly string[],
    meaning:
      "zaterdag en zondag zonder dienst en zonder reserve: een dag- of late dienst op vrijdag is uiterlijk 23:59 klaar; een nachtdienst mag",
  },
  freeWeekend: {
    /** Dagen die een weekend vrij maken: geen dienst en geen reserve. */
    freeTypes: ["RUST", "WR", "CO"] as readonly string[],
    /** Een vrij weekend hoort RUST + RUST te zijn; ligt vast in de structuur. */
    requiredTypes: ["RUST", "RUST"] as readonly string[],
    structural: true,
  },
} as const;

export type OperationalRequirements = typeof OPERATIONAL_REQUIREMENTS_V1;

/** Het hoogste roostercredit over de hele cyclus dat nog op 40:00 afrondt. */
export function maxTotalCreditMinutes(cycleWeeks: number, req: OperationalRequirements = OPERATIONAL_REQUIREMENTS_V1): number {
  return (req.rosterAverageHours.maxAverageWeeklyMinutes + 1) * cycleWeeks - 1;
}

/** Mag deze dienst op een vrijdag vóór een vrij weekend staan? */
export function fridayDutyAllowed(
  duty: Pick<QualityDuty, "endMinute" | "kinds">,
  req: OperationalRequirements = OPERATIONAL_REQUIREMENTS_V1,
): boolean {
  if (duty.kinds.some((soort) => req.freeWeekendFriday.exemptKinds.includes(soort))) return true;
  return duty.endMinute <= req.freeWeekendFriday.latestEndMinute;
}

interface CyclusDag {
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: string;
  readonly dutyCode: string | null;
}

/** De dagen van een rooster in de volgorde waarin een medewerker ze rijdt. */
function cyclus(rooster: QualityRosterInput): CyclusDag[] {
  return [...rooster.days].sort(
    (a, b) => a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday,
  );
}

export interface FreeWeekend {
  readonly roster: string;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly saturday: string;
  readonly sunday: string;
  /** De vrijdag ervoor, als die een dienstdag is. */
  readonly friday: { readonly dutyCode: string | null; readonly endMinute: number | null; readonly night: boolean } | null;
  readonly restRest: boolean;
  readonly fridayCompliant: boolean;
}

/**
 * De vrije weekenden van een rooster, rond de cyclus.
 *
 * Een weekend is vrij als zaterdag én zondag geen dienst en geen reserve zijn.
 * De vrijdag is de dag ervoor in rotatievolgorde — bij een regel van één week
 * de vrijdag van dezelfde regel.
 */
export function freeWeekends(
  rooster: QualityRosterInput,
  duties: ReadonlyMap<string, QualityDuty>,
  req: OperationalRequirements = OPERATIONAL_REQUIREMENTS_V1,
): FreeWeekend[] {
  const dagen = cyclus(rooster);
  const n = dagen.length;
  const vrij = (d: CyclusDag) => req.freeWeekend.freeTypes.includes(d.positionType);
  const uit: FreeWeekend[] = [];
  for (let i = 0; i < n; i += 1) {
    const za = dagen[i];
    const zo = dagen[(i + 1) % n];
    if (za.weekday !== 6 || zo.weekday !== 7 || !vrij(za) || !vrij(zo)) continue;
    const vr = dagen[(i - 1 + n) % n];
    const dienst = vr.weekday === 5 && vr.positionType === "DUTY" && vr.dutyCode ? duties.get(`${vr.dutyCode}|${vr.weekday}`) : undefined;
    const friday =
      vr.weekday === 5 && vr.positionType === "DUTY"
        ? {
            dutyCode: vr.dutyCode,
            endMinute: dienst?.endMinute ?? null,
            night: dienst ? dienst.kinds.some((soort) => req.freeWeekendFriday.exemptKinds.includes(soort)) : false,
          }
        : null;
    uit.push({
      roster: rooster.code,
      lineNumber: za.lineNumber,
      weekIndex: za.weekIndex,
      saturday: za.positionType,
      sunday: zo.positionType,
      friday,
      restRest: za.positionType === req.freeWeekend.requiredTypes[0] && zo.positionType === req.freeWeekend.requiredTypes[1],
      fridayCompliant: !dienst || fridayDutyAllowed(dienst, req),
    });
  }
  return uit;
}

/** Het roostercredit van een rooster en het afgeronde weekgemiddelde. */
export function rosterCredit(
  rooster: QualityRosterInput,
  duties: ReadonlyMap<string, QualityDuty>,
): { readonly totalCreditMinutes: number; readonly cycleWeeks: number; readonly averageWeeklyMinutes: number } {
  const dagen = cyclus(rooster);
  const regels = new Set(dagen.map((d) => d.lineNumber)).size;
  const uren = rosterHours({
    days: dagen.map((d) => {
      const dienst = d.positionType === "DUTY" && d.dutyCode ? duties.get(`${d.dutyCode}|${d.weekday}`) : undefined;
      return {
        positionType: d.positionType as RosterPositionType,
        startMinute: dienst?.startMinute ?? null,
        endMinute: dienst?.endMinute ?? null,
      };
    }),
    lineCount: regels,
    weeksPerLine: rooster.weeksPerLine,
  });
  return { totalCreditMinutes: uren.totalCreditMinutes, cycleWeeks: uren.cycleWeeks, averageWeeklyMinutes: uren.averageWeeklyCreditMinutes };
}

export interface OperationalCheck {
  readonly version: string;
  readonly sourceStatus: typeof OPERATIONAL_SOURCE_STATUS;
  readonly hours: readonly { roster: string; averageWeeklyMinutes: number; totalCreditMinutes: number; maxTotalCreditMinutes: number; ok: boolean }[];
  readonly weekends: readonly FreeWeekend[];
  /** Harde overtredingen die de zoekmachine had kunnen voorkomen. */
  readonly violations: readonly string[];
  /** Wat in de vaste structuur ligt: gemeld, geen afwijzing. */
  readonly structuralFindings: readonly string[];
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Controleer een pakket roosters op de operationele eisen. */
export function checkOperationalRequirements(
  rosters: readonly QualityRosterInput[],
  duties: ReadonlyMap<string, QualityDuty>,
  req: OperationalRequirements = OPERATIONAL_REQUIREMENTS_V1,
): OperationalCheck {
  const violations: string[] = [];
  const structuralFindings: string[] = [];
  const hours = rosters.map((rooster) => {
    const credit = rosterCredit(rooster, duties);
    const max = maxTotalCreditMinutes(credit.cycleWeeks, req);
    const ok = credit.totalCreditMinutes <= max;
    if (!ok) {
      violations.push(
        `${rooster.code}: roostergemiddelde ${hm(credit.averageWeeklyMinutes)} boven ${hm(req.rosterAverageHours.maxAverageWeeklyMinutes)} (${OPERATIONAL_SOURCE_STATUS})`,
      );
    }
    return { roster: rooster.code, averageWeeklyMinutes: credit.averageWeeklyMinutes, totalCreditMinutes: credit.totalCreditMinutes, maxTotalCreditMinutes: max, ok };
  });
  const weekends = rosters.flatMap((rooster) => freeWeekends(rooster, duties, req));
  for (const w of weekends) {
    if (!w.fridayCompliant && w.friday?.endMinute != null) {
      const eind = w.friday.endMinute;
      violations.push(
        `${w.roster} regel ${w.lineNumber}: vrijdagdienst ${w.friday.dutyCode} eindigt ${hm(eind % 1440)}${eind > 1440 ? " (zaterdag)" : ""} vóór een vrij weekend (${OPERATIONAL_SOURCE_STATUS})`,
      );
    }
    if (!w.restRest) {
      structuralFindings.push(`${w.roster} regel ${w.lineNumber}: vrij weekend ${w.saturday} + ${w.sunday}, niet RUST + RUST (vaste structuur)`);
    }
  }
  return { version: req.version, sourceStatus: OPERATIONAL_SOURCE_STATUS, hours, weekends, violations, structuralFindings };
}

/**
 * Wat een ruil in het bijschaven niet mag breken.
 *
 * Het bijschaven ruilt twee diensten van dezelfde weekdag. Daarbij kan een
 * late afloper op een vrijdag vóór een vrij weekend belanden, of kan een
 * rooster door langere diensten boven 40:00 uitkomen. Deze bewaker maakt die
 * twee eisen hier even hard als in het CP-SAT-model.
 */
export interface SwapGuard {
  /** Mag deze dienst op deze dienstdag staan? */
  readonly slotAllows: (slot: { roster: string; lineNumber: number; weekIndex: number; weekday: number }, duty: QualityDuty) => boolean;
  /** Het hoogste roostercredit per rooster, of null zonder grens. */
  readonly maxTotalMinutes: (roster: string) => number | null;
  /** Het vaste credit van een rooster: alles wat geen dienstdag is. */
  readonly fixedCreditMinutes: (roster: string) => number;
}

export function operationalSwapGuard(
  rosters: readonly QualityRosterInput[],
  req: OperationalRequirements = OPERATIONAL_REQUIREMENTS_V1,
): SwapGuard {
  const vrijdagen = new Set<string>();
  const max = new Map<string, number>();
  const vast = new Map<string, number>();
  for (const rooster of rosters) {
    const dagen = cyclus(rooster);
    const n = dagen.length;
    const vrij = (d: CyclusDag) => req.freeWeekend.freeTypes.includes(d.positionType);
    for (let i = 0; i < n; i += 1) {
      const za = dagen[i];
      const zo = dagen[(i + 1) % n];
      const vr = dagen[(i - 1 + n) % n];
      if (za.weekday === 6 && zo.weekday === 7 && vrij(za) && vrij(zo) && vr.weekday === 5 && vr.positionType === "DUTY") {
        vrijdagen.add(`${rooster.code}|${vr.lineNumber}|${vr.weekIndex}|${vr.weekday}`);
      }
    }
    const weken = new Set(dagen.map((d) => d.lineNumber)).size * rooster.weeksPerLine;
    max.set(rooster.code, maxTotalCreditMinutes(weken, req));
    vast.set(
      rooster.code,
      dagen.reduce((som, d) => som + (d.positionType === "DUTY" ? 0 : (ANCHOR_CREDIT_MINUTES[d.positionType as RosterPositionType] ?? 0)), 0),
    );
  }
  return {
    slotAllows: (slot, duty) =>
      !vrijdagen.has(`${slot.roster}|${slot.lineNumber}|${slot.weekIndex}|${slot.weekday}`) || fridayDutyAllowed(duty, req),
    maxTotalMinutes: (roster) => max.get(roster) ?? null,
    fixedCreditMinutes: (roster) => vast.get(roster) ?? 0,
  };
}
