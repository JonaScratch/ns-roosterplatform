import "server-only";
import type { RosterPositionType } from "@/lib/generated/prisma/enums";
import { type CalendarDate, addDays, daysBetween, toCalendarDate, toDatabaseDate } from "@/domain/time";
import { isoWeekOfDate, ruleForDate } from "@/domain/roster-rotation";
import { prisma } from "@/server/data/prisma";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { anchorOf, effectiveMembershipOn } from "./roster-membership-service";

/**
 * Het persoonlijke rooster: één plek waar alle lagen samenkomen.
 *
 * ## Waarom dit één service is
 *
 * Een roosterdag ontstaat uit vier bronnen: het basisrooster via de
 * weekrotatie, een eventuele tijdelijke plaatsing, wat de dienstindeling
 * operationeel heeft ingevuld, en een doorgevoerde ruil. Elk scherm dat die
 * lagen zelf combineert, doet dat na verloop van tijd nét anders — en dan ziet
 * een medewerker op zijn dashboard iets anders dan op zijn roosterpagina.
 *
 * ## Waarom elke dag zijn herkomst draagt
 *
 * "Waarom sta ik hier op dienst 114?" hoort een beantwoordbare vraag te zijn.
 * Elke dag in de projectie zegt daarom waar hij vandaan komt: uit het
 * basisrooster, uit een tijdelijke plaatsing, uit een operationele invulling of
 * uit een ruil. Een dienst zonder herkomst is een dienst waar niemand
 * verantwoordelijk voor is.
 *
 * ## Waarom een lege projectie geen leeg rooster is
 *
 * Als de plaatsing ontbreekt of het rooster niet te lezen valt, staat er niet
 * "geen dienst" maar "niet te bepalen". Het verschil tussen "u bent vrij" en
 * "wij weten het niet" is precies het verschil dat iemand thuis op de bank kan
 * zetten terwijl hij had moeten rijden.
 */

export type DaySource =
  | "BASISROOSTER"
  | "TIJDELIJKE_PLAATSING"
  | "OPERATIONELE_INVULLING"
  | "RUILING"
  | "ONBEKEND";

export interface ProjectedDay {
  readonly date: CalendarDate;
  readonly week: string;
  /** Het rooster waaruit deze dag komt. */
  readonly sourceRoster: string | null;
  readonly sourceRule: number | null;
  /** Wat het basisrooster voor deze dag zegt. */
  readonly baseSlot: RosterPositionType | null;
  readonly baseDutyCode: string | null;
  /** Wat er werkelijk staat, na alle lagen. */
  readonly effectiveSlot: RosterPositionType | null;
  readonly effectiveDutyCode: string | null;
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly sourceType: DaySource;
  /** Of deze dag betrouwbaar te bepalen was. */
  readonly determinate: boolean;
  readonly note: string | null;
}

export interface PersonalProjection {
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly rulesetVersion: string;
  readonly days: readonly ProjectedDay[];
  /** De plaatsing die op de eerste dag van het bereik gold. */
  readonly membership: {
    readonly rosterCode: string;
    readonly rosterName: string;
    readonly ruleIndex: number;
    readonly placementType: string;
    readonly validUntil: CalendarDate | null;
  } | null;
  readonly temporaryActive: boolean;
}

const MAX_DAGEN = 400;

/**
 * Bouwt het persoonlijke rooster voor een periode.
 *
 * Leest per dag welke plaatsing gold, welke roosterregel daaruit volgt, en wat
 * er in die regel op die cyclusdag staat. Daarna komen de operationele
 * invullingen en de doorgevoerde ruilen er als laag overheen.
 */
export async function projectPersonalRoster(input: {
  readonly employeeId: string;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}): Promise<PersonalProjection> {
  const dagen = daysBetween(input.from, input.to) + 1;
  if (dagen < 1) {
    throw new Error("De einddatum ligt vóór de begindatum.");
  }
  if (dagen > MAX_DAGEN) {
    throw new Error(`Een projectie van meer dan ${MAX_DAGEN} dagen wordt niet in één keer gemaakt.`);
  }

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, employeeNumber: true, depot: true },
  });
  if (!employee) {
    throw new Error("Onbekende medewerker.");
  }

  // De feitelijke roosterdagen: hier staat wat er nu echt gepland is, inclusief
  // ruilingen en operationele invullingen.
  const feitelijk = await prisma.scheduledDuty.findMany({
    where: {
      employeeId: input.employeeId,
      date: { gte: toDatabaseDate(input.from), lte: toDatabaseDate(input.to) },
    },
    include: {
      duty: { select: { code: true, startMinute: true, endMinute: true } },
      operationalAssignment: { select: { underlyingSlotType: true } },
    },
  });
  const perDatum = new Map(feitelijk.map((dag) => [toCalendarDate(dag.date), dag]));

  const roosterCache = new Map<string, Map<string, { positionType: RosterPositionType; dutyCode: string | null }>>();
  const dienstCache = new Map<string, { startMinute: number; endMinute: number }>();

  const resultaat: ProjectedDay[] = [];
  let eersteMembership: PersonalProjection["membership"] = null;
  let tijdelijkActief = false;

  for (let offset = 0; offset < dagen; offset += 1) {
    const datum = addDays(input.from, offset);
    const plaatsing = await effectiveMembershipOn(input.employeeId, datum);

    if (!plaatsing) {
      resultaat.push(leeg(datum, "Er is voor deze dag geen roosterplaatsing vastgelegd."));
      continue;
    }
    if (plaatsing.placementType === "TEMPORARY") {
      tijdelijkActief = true;
    }

    const regel = ruleForDate(anchorOf(plaatsing), datum);
    const cyclus = await cyclusVoorRooster(plaatsing.baseRosterId, roosterCache);
    const cyclusWeek = cyclusWeekVoor(plaatsing, datum, regel);
    const sleutel = `${regel}|${cyclusWeek.weekIndex}|${cyclusWeek.weekday}`;
    const basis = cyclus.get(sleutel);

    if (offset === 0) {
      eersteMembership = {
        rosterCode: plaatsing.baseRoster.code,
        rosterName: plaatsing.baseRoster.name,
        ruleIndex: regel,
        placementType: plaatsing.placementType,
        validUntil: plaatsing.validUntil ? toCalendarDate(plaatsing.validUntil) : null,
      };
    }

    if (!basis) {
      resultaat.push(
        leeg(
          datum,
          `Regel ${regel} van rooster ${plaatsing.baseRoster.code} heeft geen dag voor ` +
            `week ${cyclusWeek.weekIndex}, dag ${cyclusWeek.weekday}.`,
        ),
      );
      continue;
    }

    const werkelijk = perDatum.get(datum);
    const basisDienst = basis.dutyCode
      ? await dienstTijden(basis.dutyCode, employee.depot, dienstCache)
      : null;

    // Welke laag deze dag bepaalt, en waarom.
    let bron: DaySource =
      plaatsing.placementType === "TEMPORARY" ? "TIJDELIJKE_PLAATSING" : "BASISROOSTER";
    let effectiefSlot: RosterPositionType | null = basis.positionType;
    let effectieveCode: string | null = basis.dutyCode;
    let start = basisDienst?.startMinute ?? null;
    let eind = basisDienst?.endMinute ?? null;

    if (werkelijk) {
      const afwijkend =
        werkelijk.positionType !== basis.positionType ||
        (werkelijk.duty?.code ?? null) !== basis.dutyCode;

      if (werkelijk.operationalAssignment) {
        bron = "OPERATIONELE_INVULLING";
      } else if (afwijkend && werkelijk.source === "SWAP") {
        bron = "RUILING";
      } else if (afwijkend) {
        // Een afwijking zonder herkomst noemen we niet stilzwijgend basis.
        bron = werkelijk.source === "BASE" ? bron : "ONBEKEND";
      }

      effectiefSlot = werkelijk.positionType;
      effectieveCode = werkelijk.duty?.code ?? null;
      start = werkelijk.duty?.startMinute ?? null;
      eind = werkelijk.duty?.endMinute ?? null;
    }

    resultaat.push({
      date: datum,
      week: isoWeekOfDate(datum),
      sourceRoster: plaatsing.baseRoster.code,
      sourceRule: regel,
      baseSlot: basis.positionType,
      baseDutyCode: basis.dutyCode,
      effectiveSlot: effectiefSlot,
      effectiveDutyCode: effectieveCode,
      startMinute: start,
      endMinute: eind,
      sourceType: bron,
      determinate: true,
      note:
        werkelijk?.operationalAssignment
          ? `Basis ${werkelijk.operationalAssignment.underlyingSlotType}, operationeel ingevuld.`
          : null,
    });
  }

  return {
    employeeId: employee.id,
    employeeNumber: employee.employeeNumber,
    from: input.from,
    to: input.to,
    rulesetVersion: activeRuleset().version,
    days: resultaat,
    membership: eersteMembership,
    temporaryActive: tijdelijkActief,
  };
}

function leeg(datum: CalendarDate, reden: string): ProjectedDay {
  return {
    date: datum,
    week: isoWeekOfDate(datum),
    sourceRoster: null,
    sourceRule: null,
    baseSlot: null,
    baseDutyCode: null,
    effectiveSlot: null,
    effectiveDutyCode: null,
    startMinute: null,
    endMinute: null,
    sourceType: "ONBEKEND",
    // Uitdrukkelijk niet "vrij": onbekend is iets anders dan niets.
    determinate: false,
    note: `Roosterprojectie kan niet betrouwbaar worden bepaald. ${reden}`,
  };
}

/** De cyclusdagen van een rooster, per regel en cyclusdag. */
async function cyclusVoorRooster(
  baseRosterId: string,
  cache: Map<string, Map<string, { positionType: RosterPositionType; dutyCode: string | null }>>,
) {
  const bestaand = cache.get(baseRosterId);
  if (bestaand) {
    return bestaand;
  }
  const lines = await prisma.rosterLine.findMany({
    where: { baseRosterId },
    include: { days: true },
  });
  const kaart = new Map<string, { positionType: RosterPositionType; dutyCode: string | null }>();
  for (const line of lines) {
    for (const dag of line.days) {
      kaart.set(`${line.lineNumber}|${dag.weekIndex}|${dag.weekday}`, {
        positionType: dag.positionType,
        dutyCode: dag.dutyCode,
      });
    }
  }
  cache.set(baseRosterId, kaart);
  return kaart;
}

/**
 * Welke cyclusweek en weekdag hoort bij deze kalenderdag?
 *
 * De roosterregel bepaalt wélke lijn, de cyclusweek bepaalt wélke week binnen
 * die lijn. Een rooster met een cyclus van vier weken heeft per regel vier
 * weken; de regel schuift wekelijks op, en daarmee schuift ook de cyclusweek
 * mee — anders zou iedereen elke week dezelfde week uit de cyclus rijden.
 */
function cyclusWeekVoor(
  plaatsing: { anchorWeek: string; lineCount: number; baseRoster: { cycleWeeks?: number } },
  datum: CalendarDate,
  regel: number,
): { weekIndex: number; weekday: number } {
  const weekdag = new Date(`${datum}T12:00:00Z`).getUTCDay();
  const isoDag = weekdag === 0 ? 7 : weekdag;

  const cyclusWeken = plaatsing.baseRoster.cycleWeeks ?? 1;
  // Bij een rooster waarin het aantal regels een veelvoud is van de cyclus,
  // hoort regel r bij cyclusweek ((r - 1) mod cyclusWeken) + 1. Dat is de
  // gangbare opzet: de regels lopen de cyclus rond.
  const weekIndex = ((regel - 1) % cyclusWeken) + 1;
  return { weekIndex, weekday: isoDag };
}

/**
 * De tijden van een dienstnummer binnen deze standplaats.
 *
 * Het basisrooster noemt alleen een nummer; de tijden staan in het
 * dienstenpakket. Staat het nummer daar niet in, dan komt er niets terug — en
 * dan toont de projectie het nummer zonder tijden in plaats van een verzonnen
 * begintijd.
 */
async function dienstTijden(
  code: string,
  depot: string,
  cache: Map<string, { startMinute: number; endMinute: number }>,
): Promise<{ startMinute: number; endMinute: number } | null> {
  const sleutel = `${depot}|${code}`;
  const bestaand = cache.get(sleutel);
  if (bestaand) {
    return bestaand;
  }
  const duty = await prisma.duty.findFirst({
    where: { code, depot },
    orderBy: { package: { version: "desc" } },
    select: { startMinute: true, endMinute: true },
  });
  if (!duty) {
    return null;
  }
  cache.set(sleutel, duty);
  return duty;
}
