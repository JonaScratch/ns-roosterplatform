import {
  type CandidateAssignment,
  type CandidateRoster,
  type CandidateValidationStatus,
  type ReviewableRoster,
  type UncertaintyKind,
  type ValidationReasons,
  type ValidationTally,
  type ValidationUncertainty,
  isUnmodified,
  publicationEligible,
  simulationEligible,
  technicalStatusOf,
} from "@/domain/candidate";
import { type CalendarDate, addDays, toCalendarDate, isoWeekday } from "@/domain/time";
import type { DutyKind, EmployeeGroup, RosterProfile } from "@/lib/generated/prisma/enums";
import { evaluateAssignment } from "./assignment";
import { activeRuleset } from "./ruleset/index";
import type { Company, Ruleset } from "./ruleset/types";
import type { AssignmentRequest, Protection } from "./validation/subject";
import type { TimelineDay } from "./validation/timeline";

/**
 * De onafhankelijke eindvalidatie van een roosterkandidaat.
 *
 * ## Waarom deze code de optimizer niet kent
 *
 * Er staat hier geen enkele import uit `server/optimizer/`. Dat is de kern van
 * deze fase: zou de validator de vertaalslag van de optimizer hergebruiken, dan
 * zou een fout in die vertaling in beide richtingen dezelfde uitkomst geven en
 * dus onvindbaar zijn. De kandidaat wordt hier opnieuw opgebouwd uit de
 * brongegevens — medewerkers, diensten, contracturen, beperkingen — en langs
 * dezelfde `evaluateAssignment` gehaald die ook een ruil of een
 * reserve-invulling toetst.
 *
 * ## Waarom er een poort tussen zit
 *
 * De gegevens komen binnen via `CandidateDataPort` en niet rechtstreeks uit
 * Prisma. Dat maakt deze validator toetsbaar met verzonnen roosters — en die
 * toetsen zijn hier het punt: een kandidaat met acht diensten op rij hoort te
 * worden afgewezen, en dat moet aantoonbaar zijn zonder database.
 *
 * ## Waarom de cyclus drie keer wordt uitgerold
 *
 * Een basisrooster is een cyclus. De overgang van de laatste week naar de
 * eerste is een echte overgang met echte rusttijden, en precies daar gaat een
 * roosterpatroon stuk. Door drie herhalingen uit te rollen en alleen de
 * middelste te beoordelen, heeft elke beoordeelde dag een volledige cyclus
 * historie vóór zich en een volledige erna.
 */

// ── De poort ─────────────────────────────────────────────────────────────────

export interface ValidatorEmployee {
  readonly id: string;
  readonly employeeNumber: string;
  readonly employeeGroup: EmployeeGroup;
  readonly company: string;
  readonly depot: string;
  readonly rosterProfile: RosterProfile;
  readonly qualifications: readonly string[];
  readonly contractHours: number | null;
  readonly earlyStartProtectionWaived: boolean;
  readonly protections: readonly Protection[];
}

export interface ValidatorRosterLine {
  readonly lineNumber: number;
  /** De medewerker die deze lijn bezet, of niets. */
  readonly occupant: ValidatorEmployee | null;
}

export interface ValidatorRoster {
  readonly code: string;
  readonly cycleWeeks: number;
  readonly lines: readonly ValidatorRosterLine[];
}

export interface ValidatorDuty {
  readonly id: string;
  readonly code: string;
  /**
   * De weekdag waarop deze dienst rijdt, 1 = maandag.
   *
   * Zonder dit veld werd de dienstenlijst op nummer alleen in een Map gezet, en
   * dan houdt 101 van zondag de tijden van 101 van maandag over. De validator
   * rekende dan met de verkeerde begintijd en keurde goed wat hij niet had
   * mogen goedkeuren.
   */
  readonly weekday: number;
  readonly kinds: readonly DutyKind[];
  readonly depot: string;
  readonly requiredQualifications: readonly string[];
  readonly weight: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly breakMinutes: number | null;
  readonly overtimeMinutes: number;
}

export interface CandidateDataPort {
  rosters(codes: readonly string[]): Promise<readonly ValidatorRoster[]>;
  duties(codes: readonly string[]): Promise<readonly ValidatorDuty[]>;
}

export interface CandidateValidationContext {
  readonly sourceScheduleVersion: string;
  readonly rulesetVersion: string;
  readonly inputDataVersion: string;
  /** De maandag waarop de cyclus wordt uitgerold. Vast, zodat het herhaalbaar is. */
  readonly anchorMonday: CalendarDate;
}

/**
 * Hoeveel dagen context de zwaarste regel aan één kant vraagt.
 *
 * `CALENDAR_YEAR` kijkt een jaar terug én een jaar vooruit; `WEEKS_52` een jaar
 * terug. Met drie herhalingen van de cyclus — de vorige instelling — kreeg de
 * beoordeelde cyclus aan elke kant maar één cyclus context mee. Voor een
 * rooster van twintig regels is dat 140 dagen, en dus kon geen enkele
 * jaarregel ooit worden nagerekend: elke dienstdag leverde een
 * "onvoldoende roosterhistorie".
 *
 * Dat was geen ontbrekend gegeven maar een te kort uitgerolde tijdlijn. De
 * rotatie ligt vast en herhaalt zich; een jaar vooruit en terug uitrollen is
 * dezelfde deterministische projectie, niet verzonnen historie.
 */
const CONTEXT_DAYS_NEEDED = 366;

/** Bovengrens, zodat een rooster met een korte cyclus niet ontploft in geheugen. */
const MAX_REPETITIONS_PER_SIDE = 60;

/**
 * Hoeveel herhalingen er vóór en ná de beoordeelde cyclus nodig zijn om elke
 * regel zijn venster te kunnen geven.
 */
export function repetitionsPerSide(weeksPerCycle: number): number {
  const dagenPerHerhaling = Math.max(1, weeksPerCycle) * 7;
  return Math.min(
    MAX_REPETITIONS_PER_SIDE,
    Math.max(1, Math.ceil(CONTEXT_DAYS_NEEDED / dagenPerHerhaling)),
  );
}

// ── De validatie ─────────────────────────────────────────────────────────────

export async function validateCandidate(
  candidate: CandidateRoster,
  context: CandidateValidationContext,
  data: CandidateDataPort,
  ruleset: Ruleset = activeRuleset(),
): Promise<ReviewableRoster> {
  const early = staleOrTampered(candidate, context);
  if (early) {
    return shell(candidate, early.status, early.reasons, ruleset.version);
  }

  const structural = structuralProblems(candidate);
  const evaluation = await evaluateRebuilt(candidate, context, data, ruleset);

  const tally: ValidationTally = {
    ...evaluation.tally,
    unvalidatableAssignments: evaluation.tally.unvalidatableAssignments + structural.count,
  };

  const status = technicalStatusOf(tally);

  // De redenen uit elkaar gehaald naar wat ze werkelijk zijn. Structurele
  // problemen zeggen iets over de kandidaat; bevestigde overtredingen zeggen
  // iets over het rooster; onzekerheid en formele bronvalidatie zeggen iets
  // over de staat van ons regelbestand. Eerder stonden ze onder één kop, en
  // dan leest "de Arbeidstijdenwet ontbreekt" als een fout in het rooster.
  const bevestigdeRedenen = evaluation.reasons.filter((reden) =>
    reden.startsWith("Er zijn ") || reden.includes("bevestigde overtredingen"),
  );
  const onzekerheidsRedenen = evaluation.reasons.filter(
    (reden) => !bevestigdeRedenen.includes(reden),
  );
  const reasons: ValidationReasons = {
    structural: [...structural.reasons, ...bevestigdeRedenen.filter((r) => r.startsWith("Er zijn "))],
    violations: bevestigdeRedenen.filter((r) => r.includes("bevestigde overtredingen")),
    uncertainty: onzekerheidsRedenen,
    formal: legalBlockers(ruleset),
  };

  return {
    candidate,
    status,
    // Nooit afgeleid uit de uitkomst van de toetsing: dit volgt de status van
    // het regelbestand. Een schoon rooster onder een onbevestigde CAO is nog
    // steeds simulatie.
    legalStatus: "SIMULATION_ONLY",
    validatedAt: new Date().toISOString(),
    rulesetVersionAtValidation: ruleset.version,
    tally,
    perRule: evaluation.perRule,
    uncertainties: evaluation.uncertainties,
    reasons,
    blockingReasons: [
      ...reasons.structural,
      ...reasons.violations,
      ...reasons.uncertainty,
      ...reasons.formal,
    ],
    simulationEligible: simulationEligible(status),
    // Onveranderd: er is geen pad dat dit waar maakt zolang het regelbestand
    // niet formeel is bevestigd. `publicationEligible` rekent het expliciet uit
    // in plaats van het aan te nemen.
    publishable: publicationEligible({
      status,
      rulesetLegallyVerified: ruleset.legalStatus === "LEGAL_RULESET_VERIFIED",
      missingRulePackages: ruleset.missingPackages.length,
    }),
  };
}

/**
 * Structurele problemen in de kandidaat zelf.
 *
 * Twee toewijzingen voor dezelfde cyclusdag zijn geen roosterprobleem maar een
 * onmogelijkheid. Zonder deze controle zou de laatste stilzwijgend winnen bij
 * het uitrollen, en dan verdwijnt een dubbele toewijzing spoorloos uit de
 * beoordeling — precies het soort fout waarvoor deze hele laag bestaat.
 */
export function structuralProblems(candidate: CandidateRoster): {
  readonly count: number;
  readonly reasons: readonly string[];
} {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const invalid: string[] = [];

  for (const assignment of candidate.assignments) {
    const key = slotKey(assignment);
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);

    // De weekindex telt vanaf één. Hier stond `< 0`, en dat liet een
    // toewijzing in "week 0" ongemoeid — een week die niet bestaat en waarvan
    // de dagen bij het uitrollen nergens terechtkomen.
    if (assignment.weekday < 1 || assignment.weekday > 7 || assignment.weekIndex < 1) {
      invalid.push(key);
    }
    if (assignment.positionType === "DUTY" && assignment.dutyCode === null) {
      invalid.push(`${key} (dienstdag zonder dienstnummer)`);
    }
  }

  const reasons: string[] = [];
  if (duplicates.length > 0) {
    reasons.push(
      `${duplicates.length} cyclusdagen hebben meer dan één toewijzing, bijvoorbeeld ` +
        `${duplicates[0]}. Dat is geen rooster maar een tegenstrijdigheid.`,
    );
  }
  if (invalid.length > 0) {
    reasons.push(
      `${invalid.length} toewijzingen hebben een onmogelijke cyclusdag of een dienstdag ` +
        `zonder dienstnummer, bijvoorbeeld ${invalid[0]}.`,
    );
  }

  return { count: duplicates.length + invalid.length, reasons };
}

function slotKey(assignment: CandidateAssignment): string {
  return `${assignment.baseRosterCode}/lijn ${assignment.lineNumber}/week ${assignment.weekIndex}/dag ${assignment.weekday}`;
}

/**
 * De redenen die niets met dit rooster te maken hebben.
 *
 * Ze staan er altijd bij, ook wanneer de kandidaat verder schoon is. Anders
 * leest een lege lijst als een vrijbrief.
 */
function legalBlockers(ruleset: Ruleset): readonly string[] {
  const reasons: string[] = [];
  if (ruleset.legalStatus !== "LEGAL_RULESET_VERIFIED") {
    reasons.push(
      `Het regelbestand heeft status ${ruleset.legalStatus}. Zolang de actuele ` +
        "juridische bron niet is bevestigd, is publicatie uitgesloten.",
    );
  }
  if (ruleset.missingPackages.length > 0) {
    reasons.push(
      `${ruleset.missingPackages.length} regelpakketten ontbreken, waaronder de ` +
        "Arbeidstijdenwet en het Arbeidstijdenbesluit vervoer.",
    );
  }
  return reasons;
}

function staleOrTampered(
  candidate: CandidateRoster,
  context: CandidateValidationContext,
): { status: CandidateValidationStatus; reasons: readonly string[] } | null {
  if (!isUnmodified(candidate)) {
    return {
      status: "TAMPERED",
      reasons: [
        "De inhoud van de kandidaat komt niet overeen met zijn vingerafdruk. Hij is " +
          "na generatie gewijzigd en wordt niet beoordeeld.",
      ],
    };
  }
  if (candidate.sourceScheduleVersion !== context.sourceScheduleVersion) {
    return {
      status: "STALE_SCHEDULE",
      reasons: [
        `Gegenereerd op bronrooster ${candidate.sourceScheduleVersion}, inmiddels ` +
          `${context.sourceScheduleVersion}. Opnieuw genereren.`,
      ],
    };
  }
  if (candidate.rulesetVersion !== context.rulesetVersion) {
    return {
      status: "STALE_RULESET",
      reasons: [
        `Gegenereerd onder regelbestand ${candidate.rulesetVersion}, inmiddels ` +
          `${context.rulesetVersion}. Opnieuw valideren onder het nieuwe regelbestand.`,
      ],
    };
  }
  if (candidate.inputDataVersion !== context.inputDataVersion) {
    return {
      status: "STALE_INPUT",
      reasons: [
        "Diensten, medewerkers of contractgegevens zijn gewijzigd sinds de generatie " +
          `(${candidate.inputDataVersion} → ${context.inputDataVersion}).`,
      ],
    };
  }
  return null;
}

function shell(
  candidate: CandidateRoster,
  status: CandidateValidationStatus,
  reasons: readonly string[],
  rulesetVersion: string,
): ReviewableRoster {
  return {
    candidate,
    status,
    legalStatus: "SIMULATION_ONLY",
    validatedAt: new Date().toISOString(),
    rulesetVersionAtValidation: rulesetVersion,
    tally: {
      checkedAssignments: 0,
      confirmedHardViolations: 0,
      potentialHardViolations: 0,
      rulesetIncomplete: 0,
      missingCriticalContext: 0,
      uniqueViolations: 0,
      affectedEmployees: 0,
      unvalidatableAssignments: 0,
    },
    perRule: [],
    uncertainties: [],
    // Een verouderde of gemanipuleerde kandidaat is geen onzekerheid over
    // regels: hij is structureel niet te beoordelen. Daarom staan deze redenen
    // onder `structural` en is de simulatie ook geblokkeerd.
    reasons: { structural: reasons, violations: [], uncertainty: [], formal: [] },
    blockingReasons: reasons,
    simulationEligible: false,
    publishable: false,
  };
}

// ── Opnieuw opbouwen en toetsen ──────────────────────────────────────────────

interface EvaluationSummary {
  readonly tally: ValidationTally;
  readonly perRule: ReviewableRoster["perRule"];
  readonly reasons: readonly string[];
  readonly uncertainties: readonly ValidationUncertainty[];
}

/**
 * Onzekerheid bijhouden per regel, met het aantal geraakte toewijzingen erbij.
 *
 * Dezelfde regel komt bij duizenden toewijzingen langs; wat telt is hoe vaak,
 * niet hoe vaak hij is opgeschreven.
 */
function noteUncertainty(
  register: Map<string, ValidationUncertainty & { affectedAssignments: number }>,
  input: {
    readonly kind: UncertaintyKind;
    readonly ruleId: string;
    readonly title: string;
    readonly explanation: string;
  },
): void {
  const key = `${input.kind}|${input.ruleId}`;
  const bestaand = register.get(key);
  if (bestaand) {
    bestaand.affectedAssignments += 1;
    return;
  }
  register.set(key, { ...input, affectedAssignments: 1 });
}

async function evaluateRebuilt(
  candidate: CandidateRoster,
  context: CandidateValidationContext,
  data: CandidateDataPort,
  ruleset: Ruleset,
): Promise<EvaluationSummary> {
  const codes = [...new Set(candidate.assignments.map((entry) => entry.baseRosterCode))];
  const rosters = await data.rosters(codes);
  const duties = await data.duties(dutyCodesOf(candidate));
  const dutyByCode = new Map(duties.map((duty) => [`${duty.code}|${duty.weekday}`, duty]));

  const cycleWeeksByCode = new Map(rosters.map((roster) => [roster.code, roster.cycleWeeks]));
  const occupantByLine = new Map<string, ValidatorEmployee | null>(
    rosters.flatMap((roster) =>
      roster.lines.map(
        (line) => [`${roster.code}|${line.lineNumber}`, line.occupant] as [string, ValidatorEmployee | null],
      ),
    ),
  );

  const reasons: string[] = [];
  const uniqueKeys = new Map<
    string,
    { ruleId: string; title: string; confidence: "CONFIRMED" | "POTENTIAL" }
  >();
  const affectedEmployees = new Set<string>();
  const onzekerheden = new Map<
    string,
    ValidationUncertainty & { affectedAssignments: number }
  >();

  let checked = 0;
  let confirmed = 0;
  let potential = 0;
  let incomplete = 0;
  let contextGaps = 0;
  let unvalidatable = 0;

  // Per rooster het aantal regels: dat is de lengte van de rotatiecyclus.
  const lineCountByRoster = new Map(rosters.map((roster) => [roster.code, roster.lines.length]));
  const byLine = groupByLine(candidate);

  // Hoeveel dienstdagen er beoordeeld hóren te worden.
  //
  // Elke bezette regel legt de hele cyclus af langs alle regels van zijn
  // rooster. Wat er in dat middelste rondje aan dienstdagen langskomt, is de
  // som van alle dienstdagen van dat rooster — één keer, want elke regel komt
  // precies één keer aan de beurt. Wie dit op "het aantal toewijzingen van de
  // eigen regel" zou zetten, krijgt een verwachting die met de fout meebeweegt.
  let verwachteBeoordelingen = 0;
  for (const [key] of byLine) {
    const [rosterCode] = key.split("|");
    if (!occupantByLine.get(key) || !cycleWeeksByCode.get(rosterCode)) {
      continue;
    }
    verwachteBeoordelingen += candidate.assignments.filter(
      (entry) =>
        entry.baseRosterCode === rosterCode &&
        entry.positionType === "DUTY" &&
        entry.dutyCode !== null,
    ).length;
  }

  for (const [key, assignments] of byLine) {
    const [rosterCode, lineNumberText] = key.split("|");
    const cycleWeeks = cycleWeeksByCode.get(rosterCode);
    const lineCount = lineCountByRoster.get(rosterCode) ?? 0;
    const employee = occupantByLine.get(key) ?? null;

    if (!cycleWeeks || lineCount === 0) {
      unvalidatable += assignments.length;
      reasons.push(
        `Basisrooster ${rosterCode} bestaat niet; lijn ${lineNumberText} is niet te beoordelen.`,
      );
      continue;
    }
    if (!employee) {
      unvalidatable += assignments.length;
      reasons.push(
        `Lijn ${lineNumberText} van ${rosterCode} heeft geen bezetter; die toewijzingen zijn ` +
          "niet te beoordelen en tellen daarom niet als goedgekeurd.",
      );
      continue;
    }

    // De cyclus van een medewerker is niet zijn eigen regel die zich herhaalt,
    // maar de reis langs álle regels van het rooster: wie deze week op regel 6
    // staat, staat volgende week op regel 7. Het rooster één regel lang
    // herhalen levert een tijdlijn op waarin een machinist elke week dezelfde
    // dagen rijdt — en dan gaan juist de regels over reeksen, rustdagen per
    // week en vrije weekenden over een rooster dat niemand ooit rijdt.
    const weeksPerCycle = cycleWeeks * lineCount;
    // Genoeg herhalingen vóór en ná de beoordeelde cyclus om ook de jaarregels
    // hun venster te geven. Zie `repetitionsPerSide`.
    const perSide = repetitionsPerSide(weeksPerCycle);
    const repetitions = perSide * 2 + 1;
    const days = expandRotation({
      anchorLine: Number(lineNumberText),
      lineCount,
      cycleWeeks,
      assignmentsByLine: byLine,
      rosterCode,
      anchorMonday: context.anchorMonday,
      duties: dutyByCode,
      repetitions,
    });
    const coverage = {
      from: context.anchorMonday,
      to: addDays(context.anchorMonday, repetitions * weeksPerCycle * 7 - 1),
    };
    const middleFrom = addDays(context.anchorMonday, perSide * weeksPerCycle * 7);
    const middleTo = addDays(middleFrom, weeksPerCycle * 7 - 1);

    for (const day of days) {
      if (!day.duty || day.date < middleFrom || day.date > middleTo) {
        continue;
      }
      const duty = dutyByCode.get(`${day.duty.code}|${isoWeekday(day.date)}`);
      if (!duty) {
        unvalidatable += 1;
        reasons.push(`Dienst ${day.duty.code} bestaat niet meer in het dienstpakket.`);
        continue;
      }

      const request: AssignmentRequest = {
        subject: {
          employeeId: employee.id,
          employeeNumber: employee.employeeNumber,
          employeeGroup: employee.employeeGroup,
          company: companyOf(employee.company),
          depot: employee.depot,
          rosterProfile: employee.rosterProfile,
          qualifications: employee.qualifications,
          contractHours: employee.contractHours,
          earlyStartProtectionWaived: employee.earlyStartProtectionWaived,
          protections: employee.protections,
        },
        date: day.date,
        candidate: {
          dutyId: duty.id,
          code: duty.code,
          kinds: duty.kinds,
          depot: duty.depot,
          requiredQualifications: duty.requiredQualifications,
          weight: duty.weight,
          shape: day.duty.shape,
        },
        // Een kandidaat is per definitie een basisrooster: niet-planmatige
        // uitzonderingen bestaan hier niet.
        planningStage: "BASE_ROSTER",
        reason: "BASE_ROSTER_GENERATION",
        timeline: { days, coverage },
        exceptions: [],
      };

      const result = evaluateAssignment(request, ruleset);
      checked += 1;

      if (result.missingRules.length > 0) {
        incomplete += 1;
        // Ook vastleggen wélke regel het was. Zonder dit blijft er alleen een
        // aantal over, en een aantal vertelt niemand wat hij moet regelen.
        for (const ontbrekend of result.missingRules) {
          noteUncertainty(onzekerheden, {
            kind: "MISSING_RULE_CONTEXT",
            ruleId: ontbrekend.ruleId,
            title: ontbrekend.title,
            explanation: ontbrekend.reason,
          });
        }
      }
      if (result.contextGaps.length > 0) {
        contextGaps += 1;
        for (const gat of result.contextGaps) {
          for (const ruleId of gat.affectedRules) {
            noteUncertainty(onzekerheden, {
              kind: "INSUFFICIENT_HISTORY",
              ruleId,
              title: ruleId,
              explanation:
                `Deze regel kijkt over een venster van ${gat.window}. Beschikbaar is ` +
                `${gat.availableFrom} t/m ${gat.availableTo}; nodig is ` +
                `${gat.requiredFrom} t/m ${gat.requiredTo}.`,
            });
          }
        }
      }
      for (const ruleId of result.rulesWithUnverifiedCurrency) {
        noteUncertainty(onzekerheden, {
          kind: "UNVERIFIED_RULE_SOURCE",
          ruleId,
          title: ruleId,
          explanation:
            "De regel is toegepast, maar de bron is niet bevestigd als actueel. " +
            "Een bevinding hieronder is daarom geen bewijs.",
        });
      }
      for (const violation of result.hardViolations) {
        affectedEmployees.add(employee.employeeNumber);
        if (violation.confidence === "CONFIRMED") {
          confirmed += 1;
        } else {
          potential += 1;
        }
        uniqueKeys.set(violation.occurrenceKey, {
          ruleId: violation.ruleId,
          title: violation.title,
          confidence: violation.confidence,
        });
      }
    }
  }

  const perRuleMap = new Map<
    string,
    { title: string; count: number; confidence: "CONFIRMED" | "POTENTIAL" }
  >();
  for (const entry of uniqueKeys.values()) {
    const existing = perRuleMap.get(entry.ruleId);
    if (existing) {
      existing.count += 1;
    } else {
      perRuleMap.set(entry.ruleId, {
        title: entry.title,
        count: 1,
        confidence: entry.confidence,
      });
    }
  }

  // De meldingen benoemen nu wat een bevinding wél en niet is, en hoeveel
  // regels erachter zitten. "180 overschrijdingen" las als bewezen fouten in
  // het rooster; het waren berekeningen onder regels waarvan de bron niet
  // bevestigd is. Dat verschil hoort in de zin zelf te staan, niet in een
  // voetnoot eronder.
  // Het aantal regels dat werkelijk iets heeft gevonden — niet het aantal
  // regels waarvan de bron onbevestigd is. Dat laatste is bijna het hele
  // regelbestand en zegt niets over deze kandidaat.
  const regelsMetBevinding = new Set(
    [...uniqueKeys.values()]
      .filter((entry) => entry.confidence === "POTENTIAL")
      .map((entry) => entry.ruleId),
  ).size;
  const regelsZonderParameter = new Set(
    [...onzekerheden.values()]
      .filter((entry) => entry.kind === "MISSING_RULE_CONTEXT")
      .map((entry) => entry.ruleId),
  ).size;
  const regelsZonderHistorie = new Set(
    [...onzekerheden.values()]
      .filter((entry) => entry.kind === "INSUFFICIENT_HISTORY")
      .map((entry) => entry.ruleId),
  ).size;

  if (confirmed > 0) {
    reasons.push(`${confirmed} bevestigde overtredingen van gevalideerde, actuele regels.`);
  }
  if (potential > 0) {
    reasons.push(
      `${potential} mogelijke bevindingen onder ${regelsMetBevinding} ` +
        `${regelsMetBevinding === 1 ? "regel" : "regels"} waarvan bron of toepasselijkheid nog ` +
        "niet formeel is bevestigd. Geen bewezen overtreding; wel reden om publicatie tegen " +
        "te houden.",
    );
  }
  if (incomplete > 0) {
    reasons.push(
      `${regelsZonderParameter || 1} regels konden niet volledig worden beoordeeld omdat een ` +
        `parameter of bron ontbreekt (${incomplete} toewijzingen geraakt).`,
    );
  }
  if (contextGaps > 0) {
    reasons.push(
      `${regelsZonderHistorie || 1} regels vragen meer roosterhistorie dan beschikbaar is ` +
        `(${contextGaps} toewijzingen geraakt).`,
    );
  }

  // ── Is er beoordeeld wat er beoordeeld moest worden? ────────────────────
  //
  // "Er is íets getoetst" is niet genoeg. Een validator die van de 2206
  // dienstdagen er drie bekijkt en dan schoon meldt, is net zo misleidend als
  // een die er nul bekijkt — hij is alleen moeilijker te betrappen.
  //
  // Het verwachte aantal volgt uit de kandidaat zelf: elke dienstdag van elke
  // regel, één keer per rotatieperiode. Wijkt het werkelijke aantal daarvan af,
  // dan is het verschil ongetoetst en telt het als zodanig.
  //
  // Dit is geen theoretisch geval. Een verschuiving van één in de weekindex
  // liet de validator maandenlang nul toewijzingen bekijken, en elke kandidaat
  // kwam er groen uit.
  const dienstdagen = candidate.assignments.filter(
    (entry) => entry.positionType === "DUTY" && entry.dutyCode !== null,
  ).length;
  const tekort = Math.max(0, verwachteBeoordelingen - checked);
  if (tekort > 0 && dienstdagen > 0) {
    unvalidatable += tekort;
    reasons.push(
      `Er zijn ${checked} van de verwachte ${verwachteBeoordelingen} dienstdagen beoordeeld; ` +
        `${tekort} bleven ongetoetst. Een kandidaat waarvan niet alles is getoetst, wordt ` +
        "niet goedgekeurd.",
    );
  }

  return {
    tally: {
      checkedAssignments: checked,
      confirmedHardViolations: confirmed,
      potentialHardViolations: potential,
      rulesetIncomplete: incomplete,
      missingCriticalContext: contextGaps,
      uniqueViolations: uniqueKeys.size,
      affectedEmployees: affectedEmployees.size,
      unvalidatableAssignments: unvalidatable,
    },
    perRule: [...perRuleMap.entries()]
      .map(([ruleId, entry]) => ({
        ruleId,
        title: entry.title,
        uniqueViolations: entry.count,
        confidence: entry.confidence,
      }))
      .sort((a, b) => b.uniqueViolations - a.uniqueViolations),
    reasons,
    uncertainties: [...onzekerheden.values()].sort(
      (a, b) => b.affectedAssignments - a.affectedAssignments,
    ),
  };
}

function dutyCodesOf(candidate: CandidateRoster): readonly string[] {
  return [
    ...new Set(
      candidate.assignments
        .map((entry) => entry.dutyCode)
        .filter((code): code is string => code !== null),
    ),
  ];
}

function groupByLine(candidate: CandidateRoster): Map<string, CandidateAssignment[]> {
  const grouped = new Map<string, CandidateAssignment[]>();
  for (const assignment of candidate.assignments) {
    const key = `${assignment.baseRosterCode}|${assignment.lineNumber}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(assignment);
    } else {
      grouped.set(key, [assignment]);
    }
  }
  return grouped;
}

/**
 * De tijdlijn van één medewerker, langs alle regels van zijn rooster.
 *
 * De medewerker begint in de ankerweek op `anchorLine` en schuift elke
 * cyclusperiode één regel op:
 *
 *     regel = ((anker - 1 + verstrekenPerioden) mod N) + 1
 *
 * Dat is dezelfde formule als in `src/domain/roster-rotation.ts`. Zij staat hier
 * opnieuw en wordt niet geïmporteerd: deze validator hoort een tweede lezing te
 * zijn van dezelfde werkelijkheid, en een gedeelde functie zou een fout in die
 * formule in beide richtingen even onzichtbaar maken.
 */
function expandRotation(input: {
  readonly anchorLine: number;
  readonly lineCount: number;
  readonly cycleWeeks: number;
  readonly assignmentsByLine: ReadonlyMap<string, readonly CandidateAssignment[]>;
  readonly rosterCode: string;
  readonly anchorMonday: CalendarDate;
  readonly duties: ReadonlyMap<string, ValidatorDuty>;
  /** Hoe vaak de hele cyclus wordt uitgerold. Oneven: het midden wordt beoordeeld. */
  readonly repetitions: number;
}): TimelineDay[] {
  const { anchorLine, lineCount, cycleWeeks, anchorMonday, duties } = input;
  const days: TimelineDay[] = [];

  const totaalPerioden = input.repetitions * lineCount;
  for (const periode of range(totaalPerioden)) {
    const regel = ((anchorLine - 1 + periode) % lineCount) + 1;
    const regelDagen = input.assignmentsByLine.get(`${input.rosterCode}|${regel}`) ?? [];
    const byKey = new Map(regelDagen.map((entry) => [`${entry.weekIndex}|${entry.weekday}`, entry]));

    for (const week of range(cycleWeeks)) {
      for (let weekday = 1; weekday <= 7; weekday += 1) {
        const offset = (periode * cycleWeeks + week) * 7 + (weekday - 1);
        const date = addDays(anchorMonday, offset);
        const entry = byKey.get(`${week + 1}|${weekday}`);
        const duty = entry?.dutyCode ? duties.get(`${entry.dutyCode}|${weekday}`) : undefined;

        days.push({
          date,
          positionType: entry?.positionType ?? "RUST",
          duty: duty
            ? {
                dutyId: duty.id,
                code: duty.code,
                shape: {
                  startMinute: duty.startMinute,
                  endMinute: duty.endMinute,
                  breakMinutes: duty.breakMinutes,
                  overtimeMinutes: duty.overtimeMinutes,
                },
              }
            : null,
        });
      }
    }
  }
  return days;
}

function range(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}


function companyOf(value: string): Company {
  const known: readonly Company[] = ["NSR", "NS_INTERNATIONAL", "NEDTRAIN", "OVERIG"];
  return known.find((entry) => entry === value) ?? "OVERIG";
}

/** De ankermaandag: de eerstvolgende maandag vanaf vandaag. */
export function nextMonday(from: Date = new Date()): CalendarDate {
  const today = toCalendarDate(from);
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(today, offset);
    if (new Date(`${candidate}T00:00:00Z`).getUTCDay() === 1) {
      return candidate;
    }
  }
  return today;
}
