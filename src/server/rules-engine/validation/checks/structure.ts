import { anchorLockedMessage, assessStructuralChange } from "@/domain/roster-structure";
import { RosterProfile } from "@/lib/generated/prisma/enums";
import { RULE } from "../../ruleset/rule-ids";
import type { Evaluation } from "../evaluation";
import type { AssignmentRequest } from "../subject";

/**
 * De structuur van het basisrooster.
 *
 * ## Waarom dit een regel is en geen schermcontrole
 *
 * "Bij een wijzigingsblad mag je een rustdag niet verplaatsen" is een uitspraak
 * over wat mag, niet over wat de interface aanbiedt. Zit hij in het scherm, dan
 * geldt hij voor wie het scherm gebruikt — en niet voor een importscript, een
 * optimizer of een beheerder met een directe route. Hier zit hij op dezelfde
 * plek als de rusttijden: in de validator waar elke plaatsing langs moet.
 *
 * ## Waarom een uitzondering hier niet bestaat
 *
 * Andere regels kennen een geautoriseerde uitzondering. Deze niet. Een
 * verplaatst anker is geen incident dat je met een handtekening afkoopt maar een
 * wijziging van de afspraak zelf; die hoort thuis in een nieuwe
 * dienstregelingronde. Een beheerder is beheerder, geen roosterregel-bypass.
 */
export function checkStructure(request: AssignmentRequest, evaluation: Evaluation): void {
  checkAnchorLock(request, evaluation);
  checkReserveBase(request, evaluation);
}

// ── Vergrendelde ankers ──────────────────────────────────────────────────────

function checkAnchorLock(request: AssignmentRequest, evaluation: Evaluation): void {
  const changeType = request.changeType ?? "NEW_TIMETABLE";
  if (changeType === "NEW_TIMETABLE") {
    return;
  }

  const rule = evaluation.require(RULE.ROSTER_ANCHOR_LOCKED);
  if (!rule) {
    return;
  }

  const assessment = assessStructuralChange({
    changeType,
    baseline: request.baselineSlot ?? null,
    proposed: { kind: "DUTY", dutyCode: request.candidate.code },
  });

  if (assessment.verdict === "BASELINE_MISSING") {
    // Doorlaten zou betekenen dat de vergrendeling verdwijnt zodra de snapshot
    // ontbreekt — precies de situatie waarin je hem het hardst nodig hebt.
    evaluation.blockOnMissing({
      ruleId: "ROSTER_STRUCTURE_BASELINE",
      title: "Structurele baseline van het vastgestelde jaarrooster",
      status: "NOT_SUPPLIED",
      reason:
        `Voor ${request.date} is geen vastgelegde baseline gevonden. Bij een ` +
        "wijzigingsblad wordt elke plaatsing daartegen getoetst; zonder die " +
        "vastlegging kan niet worden vastgesteld of een structureel anker wordt " +
        "verplaatst.",
    });
    return;
  }
  if (assessment.verdict === "NO_STRUCTURAL_OBJECTION") {
    return;
  }

  const baseline = request.baselineSlot!;
  evaluation.violate(rule, {
    calculatedValue: 0,
    limit: 1,
    occurrenceKey: `anker:${baseline.baseRosterCode}|${baseline.lineNumber}|${baseline.weekIndex}|${baseline.weekday}`,
    message:
      `${anchorLockedMessage(assessment.from, assessment.to)} ` +
      `Voorgesteld op ${request.date}: dienst ${request.candidate.code}.`,
    details: {
      baselineSlotType: assessment.from,
      proposedSlotType: assessment.to,
      proposedDutyCode: request.candidate.code,
      baseRosterCode: baseline.baseRosterCode,
      lineNumber: baseline.lineNumber,
      weekIndex: baseline.weekIndex,
      weekday: baseline.weekday,
    },
  });
}

// ── Het reserverooster ───────────────────────────────────────────────────────

/**
 * Geen dienstnummers in het basisreserverooster.
 *
 * Alleen van toepassing op de basisgeneratie door de roostercommissie. De
 * dienstindeling mag een RES-dag wél operationeel invullen — dat is een laag
 * bovenop het slot en verandert het basisrooster niet.
 */
function checkReserveBase(request: AssignmentRequest, evaluation: Evaluation): void {
  if (request.subject.rosterProfile !== RosterProfile.RESERVE) {
    return;
  }
  if (request.reason !== "BASE_ROSTER_GENERATION") {
    // Operationele invulling door de dienstindeling. Daar is de RES-dag juist
    // voor bedoeld.
    return;
  }

  const rule = evaluation.require(RULE.RESERVE_BASE_WITHOUT_DUTIES);
  if (!rule) {
    return;
  }

  evaluation.violate(rule, {
    calculatedValue: 1,
    limit: 0,
    occurrenceKey: `reserve:${request.date}`,
    message:
      `Dienst ${request.candidate.code} wordt in de basisgeneratie van een ` +
      "reserverooster geplaatst. Het basisreserverooster bevat alleen RES, R, WTV " +
      "en CO; de dienstindeling vult een reservedag later operationeel in.",
    details: { dutyCode: request.candidate.code, profiel: request.subject.rosterProfile },
  });
}
