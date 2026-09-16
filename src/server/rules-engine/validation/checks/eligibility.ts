
import { describeDutyKinds } from "@/domain/duty-classification";
import { hasPendingProfileRules, profileAllowsDuty, rosterProfileLabel } from "@/domain/roster-profiles";
import {
  coversFullHardNight,
  isHardNightService,
  startMinuteOfDay,
  endMinuteOfDay,
} from "@/domain/duty-window";
import { formatClock } from "@/domain/amsterdam-time";
import { RULE } from "../../ruleset/rule-ids";
import type { Evaluation } from "../evaluation";
import { type AssignmentRequest, protection } from "../subject";
import { dayAt, serviceRunAround } from "../timeline";

/**
 * Geschiktheid: mag deze medewerker deze dienst überhaupt rijden?
 *
 * De goedkoopste controles en tegelijk de meest bepalende: wat hier afvalt,
 * verschijnt niet in een keuzelijst en wordt niet toegewezen.
 */
export function checkEligibility(request: AssignmentRequest, evaluation: Evaluation): void {
  checkProfile(request, evaluation);
  checkDepot(request, evaluation);
  checkDayAvailable(request, evaluation);
  checkQualifications(request, evaluation);
  checkIndividualProtections(request, evaluation);
}

/** Het roosterprofiel is een harde grens, geen voorkeur. */
function checkProfile(request: AssignmentRequest, evaluation: Evaluation): void {
  const rule = evaluation.require(RULE.ROSTER_PROFILE_BOUNDS);
  if (!rule) {
    return;
  }

  const { rosterProfile } = request.subject;
  if (!profileAllowsDuty(rosterProfile, request.candidate.kinds)) {
    evaluation.violate(rule, {
      calculatedValue: 0,
      limit: 1,
      message:
        `Dienst ${request.candidate.code} (${describeDutyKinds(request.candidate.kinds)}) past ` +
        `niet in roosterprofiel ${rosterProfileLabel(rosterProfile)}.`,
      occurrenceKey: `${request.date}|${request.candidate.dutyId}`,
    });
    return;
  }

  // De bijzondere regels voor Mix, 50+ Mix en BLM zijn niet aangeleverd. Voor
  // die profielen kan een plaatsing dus niet volledig worden beoordeeld; er
  // worden geen grenzen verzonnen om dat gat te vullen.
  if (hasPendingProfileRules(rosterProfile)) {
    evaluation.require(RULE.MIX_PROFILE_SPECIAL_RULES);
  }
}

function checkDepot(request: AssignmentRequest, evaluation: Evaluation): void {
  const rule = evaluation.require(RULE.DEPOT_MATCH);
  if (!rule) {
    return;
  }
  if (request.candidate.depot !== request.subject.depot) {
    evaluation.violate(rule, {
      calculatedValue: 0,
      limit: 1,
      message:
        `Dienst ${request.candidate.code} hoort bij standplaats ${request.candidate.depot}, ` +
        `de medewerker bij ${request.subject.depot}.`,
      occurrenceKey: `${request.date}|${request.candidate.dutyId}`,
    });
  }
}

/** De dag mag niet al bezet zijn met iets anders. */
function checkDayAvailable(request: AssignmentRequest, evaluation: Evaluation): void {
  const rule = evaluation.require(RULE.DAY_AVAILABLE);
  if (!rule) {
    return;
  }
  if (!evaluation.hasContext("ADJACENT_DUTIES", [RULE.DAY_AVAILABLE])) {
    return;
  }

  // De tijdlijn bevat de kandidaat al; wat er vóór de plaatsing stond, staat in
  // `replacedPosition`. Zonder dat gegeven is er niets te controleren.
  const day = dayAt(request.timeline, request.date);
  if (!day?.replacedPosition) {
    return;
  }

  // Een reservepositie is juist bedoeld om ingevuld te worden, en een rustdag
  // mag met een dienst worden bezet zolang de rustregels dat toelaten. De rest
  // niet: een dienst die er al staat wordt niet stilzwijgend overschreven, en
  // verlof, opleiding, een WTV-dag of een compensatiedag zijn geen vrije ruimte
  // voor de planning.
  const blocking: readonly string[] = ["DUTY", "VERLOF", "OPLEIDING", "WR", "CO"];
  if (blocking.includes(day.replacedPosition)) {
    evaluation.violate(rule, {
      calculatedValue: 0,
      limit: 1,
      message:
        day.replacedPosition === "DUTY"
          ? `Op ${request.date} staat al een dienst. Die wordt niet overschreven; wie ` +
            "hem inlevert, doet dat via een ruil."
          : `Op ${request.date} staat ${day.replacedPosition}; die dag is niet inzetbaar.`,
      occurrenceKey: `${request.date}|dagbezetting`,
    });
  }
}

/**
 * Bevoegdheden.
 *
 * De formele kwalificatiematrix is niet aangeleverd. De controle gebruikt de
 * codes die in het systeem staan; zodra een dienst een bevoegdheid vraagt,
 * wordt daarnaast gemeld dat de bron niet gevalideerd is. Een dienst zonder
 * bevoegdheidseis wordt niet onnodig geblokkeerd.
 */
function checkQualifications(request: AssignmentRequest, evaluation: Evaluation): void {
  const rule = evaluation.require(RULE.QUALIFICATIONS_REQUIRED);
  if (!rule) {
    return;
  }

  const required = request.candidate.requiredQualifications;
  if (required.length === 0) {
    return;
  }

  const held = new Set(request.subject.qualifications);
  const missing = required.filter((code) => !held.has(code));

  if (missing.length > 0) {
    evaluation.violate(rule, {
      calculatedValue: required.length - missing.length,
      limit: required.length,
      message: `Ontbrekende bevoegdheden voor dienst ${request.candidate.code}: ${missing.join(", ")}.`,
      occurrenceKey: `${request.date}|${request.candidate.dutyId}|bevoegdheden`,
    });
    return;
  }

  evaluation.blockOnMissing({
    ruleId: "QUALIFICATION_MATRIX",
    title: "Kwalificatiematrix",
    status: "NOT_SUPPLIED",
    reason:
      `Dienst ${request.candidate.code} vereist bevoegdheden (${required.join(", ")}). De ` +
      "aanwezige codes komen niet uit een gevalideerd bronsysteem, dus of de " +
      "medewerker werkelijk bevoegd is, staat niet vast.",
    packageId: "QUALIFICATION_MATRIX",
  });
}

/**
 * Individuele beschermingsconstraints.
 *
 * De engine kent de beperking en niet de reden. Dat is geen beleefdheid maar
 * dataminimalisatie: een medische grond hoort niet in een planningssysteem
 * terecht te komen, ook niet in een logregel.
 */
function checkIndividualProtections(request: AssignmentRequest, evaluation: Evaluation): void {
  const shape = request.candidate.shape;

  const restriction = protection(request.subject, "SCHEDULING_RESTRICTION");
  if (restriction) {
    const rule = evaluation.require(RULE.INDIVIDUAL_SCHEDULING_RESTRICTION);
    if (rule) {
      const start = startMinuteOfDay(shape);
      const end = endMinuteOfDay(shape);

      if (restriction.earliestStartMinute !== undefined && start < restriction.earliestStartMinute) {
        evaluation.violate(rule, {
          calculatedValue: start,
          limit: restriction.earliestStartMinute,
          message:
            `Deze medewerker heeft een vastgelegde beperking: geen dienst vóór ` +
            `${formatClock(restriction.earliestStartMinute)}. Deze dienst start om ${formatClock(start)}.`,
          occurrenceKey: `${request.date}|beperking-starttijd`,
        });
      }
      if (restriction.latestEndMinute !== undefined && end > restriction.latestEndMinute) {
        evaluation.violate(rule, {
          calculatedValue: end,
          limit: restriction.latestEndMinute,
          message:
            `Deze medewerker heeft een vastgelegde beperking: geen dienst na ` +
            `${formatClock(restriction.latestEndMinute)}. Deze dienst eindigt om ${formatClock(end)}.`,
          occurrenceKey: `${request.date}|beperking-eindtijd`,
        });
      }
      if (restriction.overtimeAllowed === false && shape.overtimeMinutes > 0) {
        evaluation.violate(rule, {
          calculatedValue: shape.overtimeMinutes,
          limit: 0,
          message: "Deze medewerker heeft een vastgelegde beperking: geen overwerk.",
          occurrenceKey: `${request.date}|beperking-overwerk`,
        });
      }
      if (
        restriction.maxConsecutiveServices !== undefined &&
        evaluation.hasContext("DAYS_14", [RULE.INDIVIDUAL_SCHEDULING_RESTRICTION])
      ) {
        const run = serviceRunAround(request.timeline, request.date);
        if (run && run.length > restriction.maxConsecutiveServices) {
          evaluation.violate(rule, {
            calculatedValue: run.length,
            limit: restriction.maxConsecutiveServices,
            message:
              `Deze plaatsing maakt ${run.length} aaneengesloten diensten; voor deze ` +
              `medewerker geldt een vastgelegd maximum van ${restriction.maxConsecutiveServices}.`,
            occurrenceKey: `reeks:${run.from}..${run.to}|individueel`,
          });
        }
      }
    }
  }

  if (protection(request.subject, "HARD_NIGHT_EXEMPTION") && isHardNightService(shape)) {
    const rule = evaluation.require(RULE.AGE50_HARD_NIGHT_EXEMPTION);
    if (rule) {
      evaluation.violate(rule, {
        calculatedValue: 1,
        limit: 0,
        message:
          `Dienst ${request.candidate.code} raakt de periode 02:00–04:00. Voor deze ` +
          "medewerker is een vrijstelling van harde nachtdiensten vastgelegd.",
        occurrenceKey: `${request.date}|harde-nacht`,
        details: { volledigeHardeNacht: coversFullHardNight(shape) },
      });
    }
  }

  if (protection(request.subject, "VERY_EARLY_START_EXEMPTION")) {
    const start = startMinuteOfDay(shape);
    if (start >= 4 * 60 && start < 6 * 60) {
      // De bron laat in het midden of dit blokkeert of zwaar ontmoedigt. Tot NS
      // dat vaststelt, blokkeert het — en `require` meldt de openstaande
      // beleidsvraag, zodat de status zichtbaar blijft.
      evaluation.require(RULE.AGE55_VERY_EARLY_EXEMPTION);
    }
  }
}
