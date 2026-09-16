import { type CalendarDate, addDays, dayNumber } from "@/domain/time";
import {
  CONTEXT_SPAN_DAYS,
  type ContextWindow,
  type RuleContext,
  type RuleDefinition,
  type Ruleset,
  type SourceLegalStatus,
  resolveRule,
  ruleMinutes,
} from "../ruleset/types";
import type {
  ContextGap,
  MissingRule,
  OptimizationImpact,
  RuleCoverage,
  RuleViolation,
  UnverifiedFact,
} from "./result";

/**
 * De boekhouding van één validatie.
 *
 * ## Waarom regels niet zelf bij het regelbestand mogen
 *
 * Een controle die zelf `ruleset.rules.find(...)` doet, kan drie dingen fout
 * doen die je niet ziet: een regel gebruiken die voor een andere functiegroep
 * geldt, een regel met een onbruikbare waarde toch toepassen, of een regel
 * overslaan omdat hij niet gevonden werd. Alle drie eindigen in een stil
 * "toegestaan".
 *
 * Daarom loopt elke toegang tot een regel via `require()`. Die functie doet de
 * reikwijdte- en datumcontrole, weigert een onbruikbare waarde, en noteert wat
 * er ontbrak. Een controle die geen regel krijgt, doet niets — en de validatie
 * eindigt dan in `RULESET_INCOMPLETE` in plaats van in goedkeuring.
 *
 * ## Waarom een overtreding hier niet zomaar "hard" heet
 *
 * `violate()` bepaalt zelf of een bevinding bewezen is. Zolang de regel niet is
 * gevalideerd of de bron voorbij zijn contractuele einddatum loopt, kan geen
 * enkele controle een bevestigde overtreding melden — hoe zeker de berekening
 * ook is. Dat oordeel hier centraal maken, en niet per controle, is het verschil
 * tussen een systeem dat consequent voorzichtig is en een systeem waarin één
 * vergeten vlag een bewering te sterk maakt.
 */

export interface UsableRule {
  readonly definition: RuleDefinition;
  /** De waarde in minuten. Alleen zinvol bij MINUTES of HOURS. */
  readonly minutes: number;
  /** De waarde als aantal. Alleen zinvol bij COUNT. */
  readonly count: number;
  /** De juridische status van de bron op de beoordeelde datum. */
  readonly sourceStatus: SourceLegalStatus;
}

export interface ViolationInput {
  readonly calculatedValue: number;
  readonly limit: number;
  readonly message: string;
  /**
   * Het onderliggende feit. Twee bevindingen met dezelfde sleutel zijn hetzelfde
   * probleem, ook wanneer ze bij het valideren van verschillende dagen opduiken.
   */
  readonly occurrenceKey: string;
  readonly details?: Record<string, unknown>;
  /**
   * Toepasselijkheidsvragen die deze controle niet kon beantwoorden — een
   * mogelijke vrijstelling, een collectieve afwijking, een ontbrekend register.
   */
  readonly unverified?: readonly UnverifiedFact[];
}

export class Evaluation {
  private readonly hard: RuleViolation[] = [];
  private readonly soft: RuleViolation[] = [];
  private readonly impacts: OptimizationImpact[] = [];
  private readonly missing = new Map<string, MissingRule>();
  private readonly gaps = new Map<ContextWindow, ContextGap>();
  private readonly coverage = new Map<string, RuleCoverage>();
  private readonly evaluated = new Set<string>();
  /** Regels waarvan de bron voorbij zijn contractuele einddatum loopt. */
  private readonly unverifiedCurrency = new Set<string>();

  constructor(
    private readonly ruleset: Ruleset,
    private readonly lookup: RuleContext,
    private readonly window: { readonly from: CalendarDate; readonly to: CalendarDate },
    private readonly employeeScope: string,
    private readonly anchorDate: CalendarDate,
  ) {}

  /**
   * De regel die hier geldt, of niets.
   *
   * Levert `null` wanneer de regel onbekend, niet van toepassing of onbruikbaar
   * is. In de eerste en de laatste situatie wordt dat als ontbrekende regel
   * genoteerd; "niet van toepassing" is een geldige uitkomst en levert geen
   * bevinding op — die regel gaat eenvoudigweg niet over deze medewerker.
   */
  require(id: string): UsableRule | null {
    const rule = this.optional(id);
    if (rule) {
      return rule;
    }
    const missing = this.describeMissing(id);
    if (missing) {
      this.missing.set(id, missing);
    }
    return null;
  }

  /**
   * Zoekt een regel op zonder een ontbrekende regel te noteren.
   *
   * Voor de gevallen waarin een controle zelf bepaalt of het ontbreken van deze
   * regel er hier werkelijk toe doet — zie `bounds.ts`. Wie dit gebruikt, moet
   * bij een leeg antwoord óf aantoonbaar niets te beslissen hebben, óf zelf
   * `blockOnMissing` aanroepen. Stil doorlopen is geen optie.
   */
  optional(id: string): UsableRule | null {
    const resolution = resolveRule(this.ruleset, id, this.lookup);
    if (resolution.kind !== "RESOLVED") {
      return null;
    }

    if (resolution.sourceStatus === "CURRENT_LEGAL_STATUS_NOT_VERIFIED") {
      // In productiemodus is actuele juridische verificatie vereist: een regel
      // waarvan niet vaststaat dat hij nog geldt, keurt daar niets goed en
      // blokkeert niets. In simulatiemodus wordt hij toegepast en reist de
      // onzekerheid mee tot in de uitkomst.
      if (this.ruleset.mode === "PRODUCTION") {
        return null;
      }
      this.unverifiedCurrency.add(id);
    }

    this.evaluated.add(id);
    return this.usable(resolution.rule, resolution.sourceStatus);
  }

  private usable(definition: RuleDefinition, sourceStatus: SourceLegalStatus): UsableRule {
    return {
      definition,
      minutes:
        definition.unit === "COUNT" || definition.unit === "NONE" ? 0 : ruleMinutes(definition),
      count: definition.value ?? 0,
      sourceStatus,
    };
  }

  /**
   * Waarom deze regel niet bruikbaar is, zonder het te noteren.
   *
   * Levert `null` wanneer de regel hier niet van toepassing is: dat is een
   * geldige uitkomst en geen hiaat — de regel gaat eenvoudigweg niet over deze
   * medewerker.
   */
  describeMissing(id: string): MissingRule | null {
    const resolution = resolveRule(this.ruleset, id, this.lookup);

    if (resolution.kind === "NOT_APPLICABLE") {
      return null;
    }

    if (resolution.kind === "RESOLVED") {
      // Alleen bereikbaar in productiemodus, waar een onbevestigde bron niet
      // wordt toegepast.
      if (resolution.sourceStatus !== "CURRENT_LEGAL_STATUS_NOT_VERIFIED") {
        return null;
      }
      const source = resolution.rule.source;
      return {
        ruleId: id,
        title: resolution.rule.title,
        status: "UNRESOLVED",
        reason:
          `${source.documentTitle} liep contractueel tot en met ${source.contractualEnd}. ` +
          "De bepalingen zijn daarmee niet vervallen — de bron voorziet in verlenging en " +
          "nawerking — maar of deze versie nog de actuele is, is niet geverifieerd. In " +
          "productiemodus is die verificatie vereist.",
        packageId: "CAO_CURRENCY_CONFIRMATION",
      };
    }

    if (resolution.kind === "UNKNOWN") {
      return {
        ruleId: id,
        title: id,
        status: "NOT_SUPPLIED",
        reason:
          "Deze regel staat niet in het regelbestand. Een ontbrekende regel " +
          "betekent niet dat er geen beperking is.",
      };
    }

    if (resolution.kind === "OUT_OF_PERIOD") {
      const source = resolution.rule.source;
      return {
        ruleId: id,
        title: resolution.rule.title,
        status: "UNRESOLVED",
        reason:
          source.supersededBy !== null
            ? `${source.documentTitle} is vervangen door ${source.supersededBy}, en die bron ` +
              "is niet aangeleverd."
            : `${source.documentTitle} treedt pas in werking op ${source.effectiveFrom}; voor ` +
              "de beoordeelde datum is geen voorganger aangeleverd.",
        packageId: "CAO_CURRENCY_CONFIRMATION",
      };
    }

    return {
      ruleId: id,
      title: resolution.rule.title,
      status: resolution.rule.status,
      reason:
        resolution.rule.note ??
        "De waarde van deze regel is niet aangeleverd of niet gevalideerd.",
    };
  }

  /** Bestaat de regel hier, ongeacht of hij bruikbaar is? Voor toepasselijkheid. */
  applies(id: string): boolean {
    const resolution = resolveRule(this.ruleset, id, this.lookup);
    return resolution.kind !== "NOT_APPLICABLE" && resolution.kind !== "UNKNOWN";
  }

  /**
   * Is de benodigde context volledig geladen?
   *
   * Legt in beide gevallen de dekkingscijfers vast: ook een venster dat wél
   * volledig was, hoort dat te kunnen laten zien. Bij een tekort wordt het
   * hiaat genoteerd met de regels die eronder lijden, en levert deze functie
   * `false`. Een controle die `false` krijgt, doet niets — en het eindoordeel
   * wordt `CONTEXT_INCOMPLETE` in plaats van goedkeuring.
   */
  hasContext(window: ContextWindow, forRules: readonly string[]): boolean {
    const complete = this.recordCoverage(window, forRules);
    if (!complete) {
      this.noteContextGap(window, forRules);
    }
    return complete;
  }

  /**
   * Legt de dekking vast zonder er een hiaat van te maken.
   *
   * Voor controles die zelf, per geval, bepalen of ze genoeg gegevens hebben.
   * Het driewekelijkse vrije weekend is daar het voorbeeld van: dat kijkt naar
   * drie concrete weekenden en heeft voor een reeks die vóór zich uit ligt geen
   * historie nodig. Een blanco eis van vier weken terug zou zo'n reeks
   * ongemerkt overslaan.
   */
  recordCoverage(window: ContextWindow, forRules: readonly string[]): boolean {
    const span = CONTEXT_SPAN_DAYS[window];
    const availableBack = Math.max(
      0,
      Math.min(span.back, dayNumber(this.anchorDate) - dayNumber(this.window.from)),
    );
    const availableForward = Math.max(
      0,
      Math.min(span.forward, dayNumber(this.window.to) - dayNumber(this.anchorDate)),
    );
    const requiredTotal = span.back + span.forward;
    const availableTotal = availableBack + availableForward;
    const complete = availableBack >= span.back && availableForward >= span.forward;

    for (const ruleId of forRules) {
      this.coverage.set(`${ruleId}|${window}`, {
        ruleId,
        window,
        requiredHistoryDays: span.back,
        availableHistoryDays: availableBack,
        requiredFutureDays: span.forward,
        availableFutureDays: availableForward,
        coveragePercentage:
          requiredTotal === 0 ? 100 : Math.round((availableTotal / requiredTotal) * 100),
        validationPossible: complete,
      });
    }

    return complete;
  }

  /** Noteert uitdrukkelijk dat een venster niet te beoordelen viel. */
  noteContextGap(window: ContextWindow, forRules: readonly string[]): void {
    const span = CONTEXT_SPAN_DAYS[window];
    const existing = this.gaps.get(window);
    this.gaps.set(window, {
      window,
      requiredFrom: addDays(this.anchorDate, -span.back),
      requiredTo: addDays(this.anchorDate, span.forward),
      availableFrom: this.window.from,
      availableTo: this.window.to,
      affectedRules: [...new Set([...(existing?.affectedRules ?? []), ...forRules])],
    });
  }

  /**
   * Noteert een harde bevinding.
   *
   * De zekerheid wordt hier bepaald en niet door de aanroeper. Een controle kan
   * wel melden wat zij zelf niet kon nagaan, maar niet beweren dat er verder
   * niets open staat.
   */
  violate(rule: UsableRule, input: ViolationInput): void {
    const unverified: UnverifiedFact[] = [...(input.unverified ?? [])];

    if (rule.definition.status !== "VALIDATED") {
      unverified.push({
        kind: "RULE_STATUS",
        detail:
          `De regel heeft status ${rule.definition.status}; hij is niet door de bevoegde ` +
          "partij bevestigd als juist en actueel.",
      });
    }
    if (rule.sourceStatus !== "IN_ORIGINAL_TERM") {
      unverified.push({
        kind: "SOURCE_STATUS",
        detail:
          `${rule.definition.source.documentTitle} is op deze datum ` +
          `${rule.sourceStatus}; de actuele juridische status is niet geverifieerd.`,
      });
    }

    this.hard.push({
      ruleId: rule.definition.id,
      title: rule.definition.title,
      source: rule.definition.source,
      severity: "HARD",
      confidence: unverified.length === 0 ? "CONFIRMED" : "POTENTIAL",
      unverified,
      occurrenceKey: `${rule.definition.id}|${this.employeeScope}|${input.occurrenceKey}`,
      employeeScope: this.employeeScope,
      calculatedValue: input.calculatedValue,
      limit: input.limit,
      unit: rule.definition.unit,
      message: input.message,
      details: input.details,
    });
  }

  /** Noteert een zachte bevinding. Blokkeert nooit. */
  warn(rule: UsableRule, input: ViolationInput): void {
    this.soft.push({
      ruleId: rule.definition.id,
      title: rule.definition.title,
      source: rule.definition.source,
      severity: "SOFT",
      confidence: "POTENTIAL",
      unverified: [...(input.unverified ?? [])],
      occurrenceKey: `${rule.definition.id}|${this.employeeScope}|${input.occurrenceKey}`,
      employeeScope: this.employeeScope,
      calculatedValue: input.calculatedValue,
      limit: input.limit,
      unit: rule.definition.unit,
      message: input.message,
      details: input.details,
    });
  }

  impact(input: OptimizationImpact): void {
    this.impacts.push(input);
  }

  /**
   * Noteert dat een beslissing van een ontbrekende regel afhangt.
   *
   * Voor gevallen waarin een controle zelf vaststelt dat de onzekerheid het
   * oordeel bepaalt — bijvoorbeeld een arbeidstijd die zo dicht bij de grens
   * ligt dat een niet-aangeleverde correctie de uitkomst zou omslaan.
   */
  blockOnMissing(input: MissingRule): void {
    this.missing.set(input.ruleId, input);
  }

  build(): {
    readonly hardViolations: readonly RuleViolation[];
    readonly warnings: readonly RuleViolation[];
    readonly optimizationImpacts: readonly OptimizationImpact[];
    readonly missingRules: readonly MissingRule[];
    readonly contextGaps: readonly ContextGap[];
    readonly contextCoverage: readonly RuleCoverage[];
    readonly evaluatedRules: readonly string[];
    readonly rulesWithUnverifiedCurrency: readonly string[];
  } {
    return {
      hardViolations: this.hard,
      warnings: this.soft,
      optimizationImpacts: this.impacts,
      missingRules: [...this.missing.values()],
      contextGaps: [...this.gaps.values()],
      contextCoverage: [...this.coverage.values()].sort((a, b) =>
        `${a.ruleId}${a.window}`.localeCompare(`${b.ruleId}${b.window}`),
      ),
      evaluatedRules: [...this.evaluated].sort(),
      rulesWithUnverifiedCurrency: [...this.unverifiedCurrency].sort(),
    };
  }
}
