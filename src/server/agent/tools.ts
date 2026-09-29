import "server-only";
import { z } from "zod";
import { dutyClass } from "@/domain/duty-class";
import { rosterCredit } from "@/domain/operational-requirements";
import { QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { flowDays, nightBlocksFlow } from "@/domain/roster-flow";
import { dutyKey } from "@/domain/roster-quality";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { STATUS_TEKST, searchRulesMetControles } from "./knowledge";
import { eerdereExperimenten } from "./experiments";
import { recall } from "./memory";
import { prisma } from "@/server/data/prisma";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { resolveRule } from "@/server/rules-engine/ruleset/types";
import { actorHasPermission } from "@/server/security/authorize";
import { PERMISSIONS, type Permission } from "@/server/security/permissions";
import { evaluateAssignmentsCore, evaluateOfficialCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import type { CandidateAssignment } from "@/domain/candidate";
import { DAG_NAMEN, type UiContext, duur, klok, lineDays, resolveContext, uiContextSchema } from "./context";

/**
 * De toollaag: het enige wat de agent mag aanraken.
 *
 * ## Waarom geen vrije toegang
 *
 * De agent krijgt geen database, geen shell en geen bestandssysteem. Hij krijgt
 * deze lijst. Elke tool heeft een getypeerd contract, een vereist recht, een
 * standplaatsgrens en een auditregel. Wat er niet in staat, kan hij niet doen —
 * niet omdat een prompt het verbiedt, maar omdat de functie niet bestaat.
 *
 * ## Rechten van de vrager, niet van de agent
 *
 * Een machinist en een commissielid stellen dezelfde vraag; wat de agent mag
 * opzoeken hangt af van wie het vraagt. Daarom draagt elke tool het recht dat
 * de schermen ook eisen: roosterdata achter `roster:read`, regels achter
 * `rules:read`. Een medewerker krijgt dus regeluitleg, maar geen kandidaten.
 *
 * ## Alles wat hieruit komt is gestructureerd
 *
 * Tools leveren objecten, geen zinnen. Dat is wat de uitlegbaarheid draagt: het
 * antwoord van de agent verwijst naar deze velden, en bij twijfel is na te gaan
 * welke tool welk getal leverde.
 */

export class ToolPermissionError extends Error {
  constructor(readonly tool: string, readonly permission: Permission) {
    super(`Daarvoor heb je het recht ${permission} nodig.`);
    this.name = "ToolPermissionError";
  }
}

export interface ToolCall {
  readonly tool: string;
  readonly input: unknown;
  readonly ok: boolean;
  readonly ms: number;
  readonly note?: string;
  /** Alleen bij een benchmark met foutinjectie (zie `callTool`): deze fout was gesimuleerd. */
  readonly gesimuleerd?: true;
}

/**
 * Een gesimuleerde toolfout, uitsluitend voor benchmarks (adversarial-categorie
 * Q, "tool_falen"): de agent moet een falende tool eerlijk melden en niets
 * reconstrueren. Productie zet dit nooit; zie `askAgent({ toolFouten })`.
 */
export type ToolFout = "TOOL_ERROR";

export interface ToolResult<T = unknown> {
  readonly data: T;
  /** Waar dit op steunt: welke bron, welke kandidaat, welke regel. */
  readonly sources: readonly string[];
}

interface ToolDefinition<I extends z.ZodTypeAny> {
  readonly name: string;
  readonly description: string;
  readonly permission: Permission;
  readonly input: I;
  /**
   * De uitkomst is bewust ongetypeerd aan deze kant: een tool levert per geval
   * een andere vorm (gevonden of niet gevonden), en dat gaat als gegevens naar
   * het model en naar het scherm. De vorm staat in de tool zelf, niet in dit
   * contract.
   */
  readonly run: (actor: Actor, input: z.infer<I>) => Promise<ToolResult>;
}

const tool = <I extends z.ZodTypeAny>(definition: ToolDefinition<I>) => definition;

// ── De tools ────────────────────────────────────────────────────────────────

const rosterProject = tool({
  name: "rosterProject",
  description: "Overzicht van het roosterproject: standplaats, dienstenpakket, basisroosters en hun regels.",
  permission: PERMISSIONS.ROSTER_READ,
  input: z.object({ locationCode: z.string().default("DDR") }),
  run: async (_actor, input) => {
    const [pakket, roosters] = await Promise.all([
      prisma.dutyPackage.findFirst({ where: { depot: input.locationCode, status: "ACTIVE" }, orderBy: { validFrom: "desc" }, select: { id: true, label: true, validFrom: true, _count: { select: { duties: true } } } }),
      prisma.baseRoster.findMany({ where: { depot: input.locationCode, status: { in: ["ACTIVE", "DRAFT"] } }, orderBy: { code: "asc" }, select: { code: true, name: true, profile: true, cycleWeeks: true, status: true, _count: { select: { lines: true } } } }),
    ]);
    return {
      data: {
        locationCode: input.locationCode,
        dutyPackage: pakket ? { label: pakket.label, validFrom: pakket.validFrom.toISOString().slice(0, 10), duties: pakket._count.duties } : null,
        rosters: roosters.map((r) => ({ code: r.code, name: r.name, profile: r.profile, lines: r._count.lines, cycleWeeks: r.cycleWeeks, status: r.status })),
      },
      sources: [pakket ? `dienstenpakket ${pakket.label}` : "geen actief dienstenpakket", `${roosters.length} basisroosters`],
    };
  },
});

const rosterLine = tool({
  name: "rosterLine",
  description: "Eén roosterregel met alle zeven dagen, de dienstnummers en hun werkelijke tijden.",
  permission: PERMISSIONS.ROSTER_READ,
  input: uiContextSchema.extend({ lineNumber: z.number().int().positive() }),
  run: async (_actor, input) => {
    const ctx = await resolveContext(input as UiContext);
    if (!ctx.roster) return { data: { found: false, missing: ctx.missing }, sources: [] };
    const dagen = lineDays(ctx.roster, input.lineNumber, ctx.quality.duties);
    return {
      data: {
        found: true,
        rosterCode: ctx.roster.code,
        profile: ctx.roster.profile,
        lineNumber: input.lineNumber,
        source: ctx.source,
        candidateId: ctx.candidate?.id ?? null,
        // De dag waar de vraag over ging, als die genoemd is. De regel komt
        // altijd compleet terug: zeven dagen zijn de context van die ene dag.
        requestedWeekday: input.weekday ?? null,
        days: dagen.map((d) => ({
          weekday: d.weekday,
          weekdayName: DAG_NAMEN[d.weekday],
          positionType: d.positionType,
          dutyCode: d.dutyCode,
          start: klok(d.startMinute),
          end: klok(d.endMinute),
          kinds: d.kinds,
          dutyClass: d.startMinute !== null && d.endMinute !== null ? dutyClass({ startMinute: d.startMinute, endMinute: d.endMinute, kinds: d.kinds }) : null,
        })),
        dutyDays: dagen.filter((d) => d.dutyCode).length,
      },
      sources: [ctx.candidate ? `kandidaat ${ctx.candidate.id.slice(0, 8)} (${ctx.candidate.label})` : "officieel rooster", `${ctx.roster.code} regel ${input.lineNumber}`],
    };
  },
});

const dutyInstance = tool({
  name: "dutyInstance",
  description: "Eén dienstinstantie: nummer plus weekdag, met de werkelijke begin- en eindtijd. Een nummer alleen is geen dienst.",
  permission: PERMISSIONS.ROSTER_READ,
  input: z.object({ dutyCode: z.string(), weekday: z.number().int().min(1).max(7).nullish(), locationCode: z.string().default("DDR") }),
  run: async (_actor, input) => {
    const ctx = await loadEvaluationContextCore(input.locationCode);
    const dagen = input.weekday ? [input.weekday] : [1, 2, 3, 4, 5, 6, 7];
    const gevonden = dagen
      .map((weekday) => ({ weekday, duty: ctx.quality.duties.get(dutyKey(input.dutyCode, weekday)) }))
      .filter((x) => x.duty)
      .map((x) => ({
        weekday: x.weekday,
        weekdayName: DAG_NAMEN[x.weekday],
        start: klok(x.duty!.startMinute),
        end: klok(x.duty!.endMinute),
        minutes: x.duty!.endMinute - x.duty!.startMinute,
        kinds: x.duty!.kinds,
        dutyClass: dutyClass(x.duty!),
      }));
    return {
      data: { dutyCode: input.dutyCode, instances: gevonden, exists: gevonden.length > 0 },
      sources: [`dienstenpakket van ${input.locationCode}`],
    };
  },
});

const dutyKindCounts = tool({
  name: "dutyKindCounts",
  description:
    "Hoeveel diensten van één soort (VROEG, LAAT, NACHT, RANGEER of RESERVE) elk basisrooster heeft. " +
    "Geef altijd 'kind' mee — zonder kind telt deze tool ALLE diensten bij elkaar op, niet één soort.",
  permission: PERMISSIONS.ROSTER_READ,
  input: uiContextSchema.extend({ kind: z.enum(["VROEG", "LAAT", "NACHT", "RANGEER", "RESERVE"]).nullish(), dutyClass: z.string().nullish() }),
  run: async (_actor, input) => {
    const ctx = await resolveContext(input as UiContext);
    const perRooster: Record<string, number> = {};
    let totaal = 0;
    for (const r of ctx.rosters) {
      let n = 0;
      for (const d of r.days) {
        if (!d.dutyCode) continue;
        const duty = ctx.quality.duties.get(dutyKey(d.dutyCode, d.weekday));
        if (!duty) continue;
        const soortOk = input.kind ? duty.kinds.includes(input.kind) : true;
        const klasseOk = input.dutyClass ? dutyClass(duty) === input.dutyClass : true;
        if (soortOk && klasseOk) n += 1;
      }
      perRooster[r.code] = n;
      totaal += n;
    }
    return {
      data: {
        kind: input.kind ?? null,
        dutyClass: input.dutyClass ?? null,
        perRoster: perRooster,
        total: totaal,
        source: ctx.source,
        // Gevonden bij de N0-meting van v1.0.6: zonder `kind` telt deze tool
        // ALLE diensten, en het lokale model las dat getal een paar keer
        // gewoon als "aantal vroege diensten". Nu staat het er expliciet bij,
        // op de plek waar het antwoord vandaan komt en niet alleen in de
        // toolbeschrijving — die leest het model niet bij elk antwoord terug.
        note:
          input.kind === null || input.kind === undefined
            ? "Geen 'kind' opgegeven: dit is het totaal van ALLE diensten per rooster, niet gefilterd op vroeg, laat, nacht, rangeer of reserve."
            : `Gefilterd op kind=${input.kind}.`,
      },
      sources: [ctx.candidate ? `kandidaat ${ctx.candidate.id.slice(0, 8)}` : "officieel rooster"],
    };
  },
});

const rosterHours = tool({
  name: "rosterHours",
  description: "De gemiddelde weekomvang per basisrooster, met de grens van 40:00 erbij.",
  permission: PERMISSIONS.ROSTER_READ,
  input: uiContextSchema,
  run: async (_actor, input) => {
    const ctx = await resolveContext(input as UiContext);
    const rijen = ctx.rosters.map((r) => {
      const credit = rosterCredit(r, ctx.quality.duties);
      return {
        rosterCode: r.code,
        averageWeeklyMinutes: credit.averageWeeklyMinutes,
        formatted: duur(credit.averageWeeklyMinutes),
        cycleWeeks: credit.cycleWeeks,
        withinLimit: credit.averageWeeklyMinutes <= 2400,
      };
    });
    return {
      data: { rosters: rijen, limit: "40:00 gemiddeld per basisrooster (USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT)" },
      sources: [ctx.candidate ? `kandidaat ${ctx.candidate.id.slice(0, 8)}` : "officieel rooster", "rosterHours (dienstduur + 8:00 per RES/WR/CO)"],
    };
  },
});

const ruleLookup = tool({
  name: "ruleLookup",
  description: "Een regel opzoeken: waarde, eenheid, bron, document en juridische status.",
  permission: PERMISSIONS.RULES_READ,
  input: z.object({ ruleId: z.string().nullish(), keyword: z.string().nullish(), locationCode: z.string().default("DDR") }),
  run: async (_actor, input) => {
    const ruleset = activeRuleset();
    const context = { employeeGroup: "MACHINIST" as const, company: "NSR" as const, location: input.locationCode, onDate: new Date().toISOString().slice(0, 10) };
    const ids = input.ruleId
      ? [input.ruleId]
      : Object.values(RULE).filter((id) => (input.keyword ? id.toLowerCase().includes(input.keyword.toLowerCase()) : false));
    const regels = ids.map((id) => {
      const resolutie = resolveRule(ruleset, id, context);
      if (resolutie.kind !== "RESOLVED") return { ruleId: id, resolved: false, reason: resolutie.kind };
      return {
        ruleId: id,
        resolved: true,
        title: resolutie.rule.title,
        value: resolutie.rule.value,
        unit: resolutie.rule.unit,
        source: resolutie.rule.source,
        legalStatus: resolutie.sourceStatus,
        verified: resolutie.sourceStatus === "IN_ORIGINAL_TERM",
      };
    });
    return {
      data: { rules: regels, rulesetVersion: ruleset.version, note: "Een regel zonder bevestigde bron wordt als onbevestigd gepresenteerd." },
      sources: [`regelbestand ${ruleset.version}`],
    };
  },
});

const dutyKindPerLine = tool({
  name: "dutyKindPerLine",
  description:
    "Waar diensten van één soort (bijvoorbeeld rangeer of nacht) in een basisrooster terechtkwamen: per roosterregel, " +
    "met wat er op de gevraagde regel wél staat. Voor vragen als 'waarom heeft regel 4 geen rangeerdiensten?'.",
  permission: PERMISSIONS.ROSTER_READ,
  input: uiContextSchema.extend({
    kind: z.enum(["RANGEER", "NACHT", "VROEG", "LAAT", "RESERVE"]),
    lineNumber: z.number().int().positive().nullish(),
  }),
  run: async (_actor, input) => {
    const ctx = await resolveContext(input as UiContext);
    if (!ctx.roster) return { data: { found: false, missing: ctx.missing }, sources: [] };

    const perRegel = new Map<number, { total: number; dutyCodes: string[] }>();
    for (const dag of ctx.roster.days) {
      const rij = perRegel.get(dag.lineNumber) ?? { total: 0, dutyCodes: [] };
      if (dag.dutyCode) {
        const duty = ctx.quality.duties.get(dutyKey(dag.dutyCode, dag.weekday));
        if (duty?.kinds.includes(input.kind)) {
          rij.total += 1;
          if (!rij.dutyCodes.includes(dag.dutyCode)) rij.dutyCodes.push(dag.dutyCode);
        }
      }
      perRegel.set(dag.lineNumber, rij);
    }

    const regels = [...perRegel.entries()]
      .map(([lineNumber, x]) => ({ lineNumber, ...x }))
      .sort((a, b) => a.lineNumber - b.lineNumber);
    const metSoort = regels.filter((r) => r.total > 0);

    // Wat staat er op de gevraagde regel dan wél? Zonder dat is "geen" een
    // constatering zonder verklaring.
    const gevraagd = input.lineNumber ?? null;
    const dagenVanRegel = gevraagd ? lineDays(ctx.roster, gevraagd, ctx.quality.duties) : [];

    return {
      data: {
        found: true,
        rosterCode: ctx.roster.code,
        profile: ctx.roster.profile,
        kind: input.kind,
        totalInRoster: regels.reduce((s, r) => s + r.total, 0),
        linesWithKind: metSoort.map((r) => ({ lineNumber: r.lineNumber, count: r.total, dutyCodes: r.dutyCodes })),
        linesWithoutKind: regels.filter((r) => r.total === 0).map((r) => r.lineNumber),
        requestedLine: gevraagd
          ? {
              lineNumber: gevraagd,
              hasKind: (perRegel.get(gevraagd)?.total ?? 0) > 0,
              days: dagenVanRegel.map((d) => ({
                weekday: d.weekday,
                weekdayName: DAG_NAMEN[d.weekday],
                positionType: d.positionType,
                dutyCode: d.dutyCode,
                kinds: d.kinds,
                start: klok(d.startMinute),
                end: klok(d.endMinute),
              })),
              dutyDays: dagenVanRegel.filter((d) => d.dutyCode).length,
              fixedDays: dagenVanRegel.filter((d) => !d.dutyCode).map((d) => `${DAG_NAMEN[d.weekday]} ${d.positionType}`),
            }
          : null,
      },
      sources: [
        ctx.candidate ? `kandidaat ${ctx.candidate.id.slice(0, 8)} (${ctx.candidate.label})` : "officieel rooster",
        `${ctx.roster.code} (${regels.length} regels)`,
      ],
    };
  },
});

const ruleSearch = tool({
  name: "ruleSearch",
  description: "Regels zoeken op wat iemand vraagt (in gewone woorden), met waarde, bron, artikel en status — en wat er ontbreekt.",
  permission: PERMISSIONS.RULES_READ,
  input: z.object({
    query: z.string().min(2).max(300),
    locationCode: z.string().default("DDR"),
    employeeGroup: z.enum(["MACHINIST", "HOOFDCONDUCTEUR"]).default("MACHINIST"),
  }),
  run: async (_actor, input) => {
    const uitkomst = await searchRulesMetControles(input.query, {
      employeeGroup: input.employeeGroup,
      company: "NSR",
      location: input.locationCode,
      onDate: new Date().toISOString().slice(0, 10),
    });
    return {
      data: {
        ...uitkomst,
        hits: uitkomst.hits.map((h) => ({ ...h, statusText: STATUS_TEKST[h.status] ?? h.status })),
        note:
          uitkomst.hits.length === 0
            ? `Niets gevonden met de zoekterm "${input.query}". Dat is geen bewijs dat een document of regel hier niets over zegt: zeg dat je het niet hebt kunnen vinden, niet dat het er niet staat.`
            : "Een waarde zonder bevestigde status is geen juridisch oordeel.",
      },
      sources: [`regelbestand ${uitkomst.rulesetVersion}`],
    };
  },
});

const qualityReport = tool({
  name: "qualityReport",
  description: "De kwaliteitsmeting van een kandidaat of het officiële rooster: onderdelen, slechtste regel en de voorkeurslaag.",
  permission: PERMISSIONS.ROSTER_READ,
  input: uiContextSchema,
  run: async (_actor, input) => {
    const evaluatie = await loadEvaluationContextCore(input.locationCode ?? "DDR");
    let rapport;
    let bron = "officieel rooster";
    if (input.source === "candidate" && input.candidateId) {
      const rij = await prisma.candidateRoster.findUnique({ where: { id: input.candidateId }, select: { assignments: true, scenarioLabel: true } });
      if (!rij) return { data: { found: false }, sources: [] };
      rapport = evaluateAssignmentsCore(rij.assignments as unknown as CandidateAssignment[], evaluatie, QUALITY_MODEL_V3);
      bron = `kandidaat ${input.candidateId.slice(0, 8)} (${rij.scenarioLabel})`;
    } else {
      rapport = evaluateOfficialCore(evaluatie, QUALITY_MODEL_V3);
    }
    return {
      data: {
        found: true,
        modelVersion: rapport.modelVersion,
        hardValid: rapport.hardValidity.hardValid,
        hardReasons: rapport.hardValidity.reasons,
        components: Object.fromEntries(Object.entries(rapport.components).map(([k, v]) => [k, v.score])),
        robust: rapport.robust,
        worstLine: rapport.lines.worst ? { roster: rapport.lines.worst.roster, lineNumber: rapport.lines.worst.lineNumber, score: rapport.lines.worst.score, facts: rapport.lines.worst.facts } : null,
        preference: rapport.preference.parts,
        operationalViolations: rapport.operational.violations,
        nights: { total: rapport.metrics.nights.total, singletons: rapport.metrics.nights.singletons, pairs: rapport.metrics.nights.blocks2 },
        diagnosis: rapport.diagnosis,
      },
      sources: [bron, `kwaliteitsmodel ${rapport.modelVersion}`],
    };
  },
});

const nightStructure = tool({
  name: "nightStructure",
  description: "De nachtreeksen van een basisrooster: waar ze liggen, hoe lang ze zijn en wat erna komt.",
  permission: PERMISSIONS.ROSTER_READ,
  input: uiContextSchema.extend({ rosterCode: z.string() }),
  run: async (_actor, input) => {
    const ctx = await resolveContext(input as UiContext);
    if (!ctx.roster) return { data: { found: false, missing: ctx.missing }, sources: [] };
    const dagen = flowDays(ctx.roster, ctx.quality.duties);
    const blokken = nightBlocksFlow(dagen).map((b) => {
      const start = dagen[b.startIndex];
      const na = dagen[(b.startIndex + b.length) % dagen.length];
      // Welke roosterregels raakt deze reeks? Een reeks loopt over de regelgrens
      // heen: de laatste nacht van regel 2 wordt gevolgd door de eerste van regel 3.
      const regels = [...new Set(Array.from({ length: b.length }, (_, i) => dagen[(b.startIndex + i) % dagen.length].lineNumber))];
      return {
        startLine: start.lineNumber,
        startWeekday: start.weekday,
        startWeekdayName: DAG_NAMEN[start.weekday],
        length: b.length,
        lines: regels,
        crossesLineBoundary: regels.length > 1,
        nextDay: { lineNumber: na.lineNumber, weekday: na.weekday, positionType: na.positionType, dutyCode: na.dutyCode ?? null },
      };
    });
    // Alle regels met minstens één nachtdienst: dat is iets anders dan de regels
    // waar een reeks begint, en het is meestal wat iemand bedoelt.
    const regelsMetNacht = [...new Set(dagen.filter((d) => d.category === "NIGHT").map((d) => d.lineNumber))].sort((a, b) => a - b);
    return {
      data: { found: true, rosterCode: ctx.roster.code, blocks: blokken, linesWithNights: regelsMetNacht, totalNights: blokken.reduce((s, b) => s + b.length, 0) },
      sources: [ctx.candidate ? `kandidaat ${ctx.candidate.id.slice(0, 8)}` : "officieel rooster", `${ctx.roster.code}`],
    };
  },
});

const knowledgeSearch = tool({
  name: "knowledgeSearch",
  description: "Goedgekeurde ervaringen en voorkeuren van dit project, deze standplaats en NS-breed, met herkomst en status.",
  permission: PERMISSIONS.ROSTER_READ,
  input: z.object({ query: z.string().nullish(), locationCode: z.string().default("DDR"), includeProposed: z.boolean().default(false) }),
  run: async (_actor, input) => {
    // Het pakket waarin nú wordt gewerkt, zodat een item dat op een ouder
    // pakket is geleerd niet stilzwijgend als geldig wordt gepresenteerd.
    const pakket = await prisma.dutyPackage.findFirst({
      where: { depot: input.locationCode, status: "ACTIVE" },
      orderBy: { validFrom: "desc" },
      select: { id: true, label: true },
    });
    const items = await recall({
      locationCode: input.locationCode,
      dutyPackageId: pakket?.id ?? null,
      query: input.query ?? null,
      includeProposed: input.includeProposed,
    });
    return {
      data: {
        implemented: true,
        dutyPackage: pakket ? { id: pakket.id, label: pakket.label } : null,
        items: items.map((i) => ({
          id: i.id,
          scope: i.scope,
          kind: i.kind,
          statement: i.statement,
          rationale: i.rationale,
          status: i.status,
          origin: i.proposedByAgent ? "voorgesteld door de agent" : "van een mens",
          approvedAt: i.approvedAt?.toISOString() ?? null,
          appliedCount: i.appliedCount,
          contextStillCurrent: i.contextStillCurrent,
          locationCode: i.locationCode,
        })),
        // De scope staat in de gegevens zelf, niet alleen in de instructie: een
        // model dat een voorkeur van een ándere standplaats hoort ("in Rotterdam
        // doen we…"), moet hier kunnen lezen dat die er niet is en niet geldt.
        scopeLocationCode: input.locationCode,
        note:
          "Alleen goedgekeurde items tellen mee in een beslissing. Een item dat in een ander " +
          `dienstenpakket is geleerd, wordt niet zonder meer toegepast. Deze kennis geldt voor standplaats ${input.locationCode} ` +
          "(en NS-breed waar scope NATIONAL staat). Voor andere standplaatsen zijn hier geen voorkeuren of afspraken vastgelegd: " +
          "een voorkeur van een andere standplaats wordt niet toegepast of ernaast gelegd.",
      },
      sources: [`leergeheugen ${input.locationCode}`, ...(pakket ? [`dienstenpakket ${pakket.label}`] : [])],
    };
  },
});

const experimentHistory = tool({
  name: "experimentHistory",
  description: "Eerder voorgestelde en gemeten experimenten met de zoekmachine, met de oorspronkelijke conclusie en poortuitslagen.",
  permission: PERMISSIONS.ROSTER_READ,
  input: z.object({ hypothesis: z.string().nullish(), locationCode: z.string().default("DDR"), limit: z.number().int().min(1).max(20).default(5) }),
  run: async (_actor, input) => {
    const eerder = await eerdereExperimenten({
      locationCode: input.locationCode,
      hypothesis: input.hypothesis ?? null,
      limit: input.limit,
    });
    return {
      data: {
        implemented: true,
        count: eerder.length,
        experiments: eerder.map((e) => ({
          id: e.id,
          hypothesis: e.hypothesis,
          variant: e.variant,
          status: e.status,
          // Letterlijk zoals hij destijds is vastgelegd. Een nette hervertelling
          // zou de reden kunnen veranderen zonder dat iemand dat merkt.
          conclusion: e.conclusion,
          failedGates: e.gates.filter((g) => !g.gehaald).map((g) => ({ naam: g.naam, waarde: g.waarde, grens: g.grens })),
          createdAt: e.createdAt.toISOString(),
          matchedOn: e.overeenkomst,
        })),
        note:
          "Een afgewezen experiment blijft staan met de reden van toen. Een zelfde voorstel " +
          "opnieuw doen kan, maar dan met een argument waarom die reden nu niet meer geldt.",
      },
      sources: [`experimenten ${input.locationCode}`],
    };
  },
});

export const AGENT_TOOLS = [rosterProject, rosterLine, dutyInstance, dutyKindCounts, dutyKindPerLine, rosterHours, ruleLookup, ruleSearch, qualityReport, nightStructure, knowledgeSearch, experimentHistory] as const;

export type ToolName = (typeof AGENT_TOOLS)[number]["name"];

/** De lijst zoals een taalmodel hem krijgt: naam, wat hij doet, en wat hij nodig heeft. */
/**
 * Wat een tool nodig heeft om te kunnen draaien.
 *
 * Afgeleid uit het schema en niet met de hand bijgehouden: verandert het schema,
 * dan verandert deze lijst mee. Gevonden bij lokaal-4: het model riep
 * `dutyInstance` aan zonder dienstnummer en `dutyKindPerLine` zonder soort,
 * kreeg allebei "ongeldige invoer" terug, en schreef vervolgens dat er geen
 * dienst was. De catalogus noemde alleen naam en omschrijving — nergens stond
 * wát een tool nodig heeft.
 *
 * Ook velden die het scherm meestal levert staan erin. Ze zijn nu eenmaal nodig,
 * en wie ze wél invult is een tweede vraag: staat de kiezer leeg, dan moet het
 * model ze zelf noemen.
 */
function verplichteVelden(schema: z.ZodTypeAny): string[] {
  const vorm = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (!vorm) return [];
  return Object.entries(vorm)
    .filter(([, veld]) => !veld.safeParse(undefined).success)
    .map(([naam]) => naam);
}

export function toolCatalogue(actor: Actor) {
  return AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    permission: t.permission,
    allowed: actorHasPermission(actor, t.permission),
    requires: verplichteVelden(t.input as unknown as z.ZodTypeAny),
  }));
}

/**
 * Een tool aanroepen: recht controleren, invoer valideren, uitvoeren, vastleggen.
 * Faalt de rechtencontrole, dan is dat geen fout maar een antwoord: de agent
 * moet aan de gebruiker kunnen uitleggen wát hij niet mag.
 */
export async function callTool(actor: Actor, name: string, rawInput: unknown, gesimuleerdeFout?: ToolFout): Promise<{ result: ToolResult | null; call: ToolCall; error?: string }> {
  const t0 = Date.now();
  const definitie = AGENT_TOOLS.find((x) => x.name === name);
  if (!definitie) {
    return { result: null, call: { tool: name, input: rawInput, ok: false, ms: 0, note: "onbekende tool" }, error: `De tool ${name} bestaat niet.` };
  }
  if (!actorHasPermission(actor, definitie.permission)) {
    await recordAudit({ actor, action: "agent.tool.geweigerd", objectType: "AgentTool", objectId: name, result: "DENIED", reason: definitie.permission });
    return { result: null, call: { tool: name, input: rawInput, ok: false, ms: Date.now() - t0, note: "geen recht" }, error: new ToolPermissionError(name, definitie.permission).message };
  }
  const geparsed = definitie.input.safeParse(rawInput);
  if (!geparsed.success) {
    return { result: null, call: { tool: name, input: rawInput, ok: false, ms: Date.now() - t0, note: "ongeldige invoer" }, error: `De invoer voor ${name} klopt niet: ${geparsed.error.issues.map((i) => i.path.join(".")).join(", ")}` };
  }
  if (gesimuleerdeFout) {
    // Voor het model precies dezelfde uitkomst als een echte crash hieronder;
    // alleen het auditlog en de aanroep zelf zeggen dat het gesimuleerd was.
    await recordAudit({ actor, action: "agent.tool.mislukt", objectType: "AgentTool", objectId: name, result: "FAILED", reason: `gesimuleerde toolfout (${gesimuleerdeFout}) — benchmark` });
    return { result: null, call: { tool: name, input: geparsed.data, ok: false, ms: Date.now() - t0, note: "fout", gesimuleerd: true }, error: `De tool ${name} liep vast.` };
  }
  try {
    // De invoer is al gevalideerd door het schema van deze tool zelf; TypeScript
    // ziet hier alleen de doorsnede van alle toolschemas, vandaar de cast.
    const uitvoeren = definitie.run as (a: Actor, i: unknown) => Promise<ToolResult>;
    const result = await uitvoeren(actor, geparsed.data);
    await recordAudit({ actor, action: "agent.tool.gebruikt", objectType: "AgentTool", objectId: name, newValue: { input: geparsed.data, sources: result.sources } });
    return { result, call: { tool: name, input: geparsed.data, ok: true, ms: Date.now() - t0 } };
  } catch (fout) {
    await recordAudit({ actor, action: "agent.tool.mislukt", objectType: "AgentTool", objectId: name, result: "FAILED", reason: String(fout) });
    return { result: null, call: { tool: name, input: geparsed.data, ok: false, ms: Date.now() - t0, note: "fout" }, error: `De tool ${name} liep vast.` };
  }
}
