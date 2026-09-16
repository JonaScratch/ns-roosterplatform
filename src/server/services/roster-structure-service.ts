import "server-only";
import {
  type StructureLine,
  countPositions,
  generateStructure,
} from "@/domain/structure-generation";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { resolveRule } from "@/server/rules-engine/ruleset/types";
import { requirePermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";

/**
 * Een nieuwe roosterstructuur voorstellen voor een dienstregelingronde.
 *
 * ## Waarom dit een voorstel is en geen wijziging
 *
 * Deze dienst schrijft niets naar de bestaande basisroosters. Zij levert een
 * raster terug dat de roostercommissie kan bekijken, doorrekenen en verwerpen.
 * De reden is niet voorzichtigheid maar volgorde: het huidige rooster is
 * ingelezen uit de aangeleverde bladen van NS, en een generator die dat
 * overschrijft, vervangt een echte bron door een berekening. Wat er dan in de
 * database staat, ziet er hetzelfde uit en is iets anders.
 *
 * ## De vier sloten op een wijzigingsblad
 *
 * De ankers van een vastgesteld jaarrooster staan vast. Dat wordt op vier
 * plaatsen afgedwongen, en deze dienst is er daar één van:
 *
 *  1. hier, door een AMENDMENT-ronde botweg te weigeren;
 *  2. in `assessStructuralChange`, per losse dag;
 *  3. in de eindvalidatie, over het hele voorstel;
 *  4. in de bevroren baseline, waar de oorspronkelijke ankers in staan.
 *
 * Vier keer hetzelfde controleren is geen verspilling wanneer de fout die je
 * afvangt betekent dat iemands vrije dag ongemerkt verschuift.
 *
 * ## Waar de getallen vandaan komen
 *
 * Uit het regelbestand, via `resolveRule`. Er staat hier geen enkel getal in de
 * code. Ontbreekt een regel of heeft hij geen waarde, dan wordt er niet
 * gegenereerd — er wordt niet teruggevallen op iets aannemelijks.
 */

export interface StructureProposalLine {
  readonly lineNumber: number;
  readonly days: readonly {
    readonly weekday: number;
    readonly positionType: string;
  }[];
}

export interface StructureProposal {
  readonly baseRosterCode: string;
  readonly baseRosterName: string;
  /** Het huidige aantal regels van dit basisrooster. */
  readonly currentLineCount: number;
  /** Het aantal regels waarmee dit voorstel is doorgerekend. */
  readonly lineCount: number;
  readonly lines: readonly StructureProposalLine[];
  readonly counts: Readonly<Record<string, number>>;
  /** Hoe de huidige structuur eruitziet, om het verschil te kunnen zien. */
  readonly currentCounts: Readonly<Record<string, number>>;
  readonly changedDays: number;
}

export type StructureGenerationResult =
  | {
      readonly ok: true;
      readonly periodId: string;
      readonly proposals: readonly StructureProposal[];
      readonly rulesUsed: readonly { readonly id: string; readonly value: number }[];
    }
  | { readonly ok: false; readonly reason: string; readonly code: string };

/**
 * Genereert een structuurvoorstel voor elk basisrooster van deze standplaats.
 *
 * Weigert wanneer de ronde geen NEW_TIMETABLE is, wanneer de structuur al is
 * vastgezet, of wanneer een benodigde regelwaarde ontbreekt.
 *
 * `lineCountOverrides` laat de roostercommissie per basisroostercode een ander
 * aantal regels doorrekenen dan er nu staan — zonder deze parameter wordt het
 * huidige aantal aangehouden, zoals voorheen. Een opgegeven aantal wordt éérst
 * getoetst aan `DORDRECHT_ROSTER_LINE_DIVISOR` wanneer die regel op deze
 * standplaats van toepassing is: net als bij een ontbrekende regelwaarde levert
 * een aantal dat niet deelbaar is geen half voorstel op, maar een weigering met
 * de regel en de reden erbij.
 */
export async function proposeStructure(
  requestedLocation?: string | null,
  lineCountOverrides?: Readonly<Record<string, number>>,
): Promise<StructureGenerationResult> {
  const actor = await requirePermission(PERMISSIONS.ROSTER_GENERATE);
  const scope = await locationScopeFor(actor, requestedLocation);

  const periode = await prisma.rosterPeriod.findFirst({
    where: { location: { code: scope.code } },
    orderBy: [{ year: "desc" }, { version: "desc" }],
  });
  if (!periode) {
    return {
      ok: false,
      code: "NO_PERIOD",
      reason:
        `Voor standplaats ${scope.code} is geen roosterperiode vastgelegd. Zonder ronde ` +
        "is er niets om structuur voor te bepalen.",
    };
  }

  // Slot 1 van de vier. Deze weigering kent geen parameter om hem te omzeilen.
  if (periode.changeType !== "NEW_TIMETABLE") {
    return {
      ok: false,
      code: "AMENDMENT_ANCHORS_LOCKED",
      reason:
        "Dit is een wijzigingsblad. Daarin liggen de rust-, vrije-, compensatie- en " +
        "reservedagen vast; alleen de dienstnummers mogen opnieuw worden ingevuld. Een " +
        "nieuwe structuur bepalen kan alleen in een nieuwe dienstregelingronde.",
    };
  }
  if (periode.structureState !== "STRUCTURE_EDITABLE") {
    return {
      ok: false,
      code: "STRUCTURE_LOCKED",
      reason:
        "De structuur van deze ronde is al vastgezet. Zij opnieuw bepalen zou de " +
        "bevroren baseline ongeldig maken waaraan latere wijzigingsbladen worden getoetst.",
    };
  }

  // ── De getallen uit het regelbestand ─────────────────────────────────────
  const ruleset = activeRuleset();
  const context = {
    employeeGroup: "MACHINIST" as const,
    company: "NSR" as const,
    location: scope.code,
    onDate: periode.validFrom.toISOString().slice(0, 10),
  };

  const gebruikt: { id: string; value: number }[] = [];
  const waarde = (id: string): number | null => {
    const resolutie = resolveRule(ruleset, id, context);
    if (resolutie.kind !== "RESOLVED" || resolutie.rule.value === null) {
      return null;
    }
    gebruikt.push({ id, value: resolutie.rule.value });
    return resolutie.rule.value;
  };

  const rustPerWeek = waarde("R_DAYS_PER_WEEK_AVG");
  const maxOpRij = waarde("MAX_CONSECUTIVE_SERVICES");
  const weekendInterval = waarde("RED_WEEKEND_INTERVAL_WEEKS");
  // Geen `ontbrekend`-toets voor deze regel: hij geldt alleen voor Dordrecht/
  // Regio West en is elders terecht niet aangeleverd. Resolveert hij niet, dan
  // wordt er ook niet op getoetst — dat is geen aanname maar het toepassen van
  // een regel op precies de reikwijdte waarvoor hij bestaat.
  const lijnDeler = waarde("DORDRECHT_ROSTER_LINE_DIVISOR");

  const ontbrekend = [
    rustPerWeek === null ? "R_DAYS_PER_WEEK_AVG" : null,
    maxOpRij === null ? "MAX_CONSECUTIVE_SERVICES" : null,
    weekendInterval === null ? "RED_WEEKEND_INTERVAL_WEEKS" : null,
  ].filter((id): id is string => id !== null);

  if (ontbrekend.length > 0) {
    // Geen terugval op een aannemelijk getal. Een structuur die op een gok
    // gebouwd is, is niet van een structuur op basis van de CAO te onderscheiden
    // zodra zij eenmaal in de database staat.
    return {
      ok: false,
      code: "RULE_VALUE_MISSING",
      reason:
        `De volgende regelwaarden zijn niet beschikbaar: ${ontbrekend.join(", ")}. ` +
        "Er wordt niet gegenereerd met een aangenomen waarde.",
    };
  }

  // ── De huidige roosters ──────────────────────────────────────────────────
  const roosters = await prisma.baseRoster.findMany({
    where: { depot: scope.code },
    include: { lines: { include: { days: true }, orderBy: { lineNumber: "asc" } } },
    orderBy: { code: "asc" },
  });
  if (roosters.length === 0) {
    return {
      ok: false,
      code: "NO_ROSTERS",
      reason: `Er zijn geen basisroosters voor ${scope.code}.`,
    };
  }

  const proposals: StructureProposal[] = [];
  for (const rooster of roosters) {
    const huidig = rooster.lines.flatMap((regel) => regel.days);
    const huidigeTelling = tel(huidig.map((dag) => dag.positionType));

    // Het aantal reserve-, WTV- en compensatiedagen van dít rooster wordt
    // overgenomen uit wat er nu staat. Dat is geen aanname maar een waarneming:
    // zo veel reservecapaciteit heeft dit rooster nu, en die hoeveelheid is een
    // afspraak die niet in de CAO staat maar wel in het huidige rooster.
    //
    // Bij een ander aantal regels blijft dit absolute totaal bewust ongewijzigd
    // — het wordt over meer of minder regels verdeeld, maar nooit stilzwijgend
    // verkleind of vergroot. Hoeveel reserve-, WTV- en compensatiecapaciteit een
    // ander aantal regels écht zou moeten hebben, is een roosterbeleidskeuze die
    // hier niet wordt aangenomen; `generateStructure` weigert vanzelf wanneer
    // dit totaal niet meer over het gevraagde aantal regels past.
    const reserveTotaal = huidigeTelling.RES ?? 0;

    const gevraagdAantal = lineCountOverrides?.[rooster.code] ?? rooster.lines.length;
    if (!Number.isInteger(gevraagdAantal) || gevraagdAantal < 1) {
      return {
        ok: false,
        code: "INVALID_LINE_COUNT",
        reason: `${rooster.code}: een aantal regels moet een geheel getal van minstens 1 zijn.`,
      };
    }
    if (lijnDeler !== null && gevraagdAantal % lijnDeler !== 0) {
      return {
        ok: false,
        code: "LINE_COUNT_NOT_DIVISIBLE",
        reason:
          `${rooster.code}: ${gevraagdAantal} regels is niet deelbaar door ${lijnDeler} ` +
          "(DORDRECHT_ROSTER_LINE_DIVISOR). Het lokale kader vraagt voor Dordrecht een " +
          "aantal roosterlijnen dat deelbaar is door dit getal.",
      };
    }

    const uitkomst = generateStructure({
      lineCount: gevraagdAantal,
      restDaysPerWeek: rustPerWeek as number,
      reserveDaysPerCycle: reserveTotaal,
      wtvDaysPerCycle: huidigeTelling.WR ?? 0,
      compensationDaysPerCycle: huidigeTelling.CO ?? 0,
      freeWeekendIntervalWeeks: weekendInterval as number,
      maxConsecutiveServices: maxOpRij as number,
    });

    if (!uitkomst.ok) {
      return {
        ok: false,
        code: "GENERATION_REFUSED",
        reason: `${rooster.code}: ${uitkomst.reason}`,
      };
    }

    proposals.push({
      baseRosterCode: rooster.code,
      baseRosterName: rooster.name,
      currentLineCount: rooster.lines.length,
      lineCount: gevraagdAantal,
      lines: uitkomst.lines.map((line) => ({
        lineNumber: line.lineNumber,
        days: line.days.map((positie, index) => ({
          weekday: index + 1,
          positionType: positie,
        })),
      })),
      counts: countPositions(uitkomst.lines),
      currentCounts: huidigeTelling,
      changedDays: verschil(rooster.lines, uitkomst.lines),
    });
  }

  await recordAudit({
    actor,
    action: "roosterstructuur.voorstel-berekend",
    objectType: "RosterPeriod",
    objectId: periode.id,
    newValue: {
      standplaats: scope.code,
      roosters: proposals.map((voorstel) => voorstel.baseRosterCode),
      gewijzigdeDagen: proposals.reduce((som, voorstel) => som + voorstel.changedDays, 0),
      // Uitdrukkelijk vastleggen dat er niets is weggeschreven: wie dit later
      // teruglees, moet niet hoeven raden of het rooster is veranderd.
      weggeschreven: false,
    },
  });

  return { ok: true, periodId: periode.id, proposals, rulesUsed: gebruikt };
}

function tel(waarden: readonly string[]): Readonly<Record<string, number>> {
  const telling: Record<string, number> = {};
  for (const waarde of waarden) {
    telling[waarde] = (telling[waarde] ?? 0) + 1;
  }
  return telling;
}

/** Hoeveel dagen anders zouden worden dan ze nu zijn. */
function verschil(
  huidig: readonly { lineNumber: number; days: readonly { weekday: number; positionType: string }[] }[],
  voorstel: readonly StructureLine[],
): number {
  let anders = 0;
  for (const regel of voorstel) {
    const bestaand = huidig.find((kandidaat) => kandidaat.lineNumber === regel.lineNumber);
    if (!bestaand) {
      anders += regel.days.length;
      continue;
    }
    for (const [index, positie] of regel.days.entries()) {
      const dag = bestaand.days.find((kandidaat) => kandidaat.weekday === index + 1);
      if (!dag || dag.positionType !== positie) {
        anders += 1;
      }
    }
  }
  return anders;
}
