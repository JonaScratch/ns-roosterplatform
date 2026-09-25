import "server-only";
import { VARIANT_VELDEN } from "@/server/generation/adaptive/variant";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { AGENT_CAPABILITIES, type AgentGrant, assertAgentMay } from "./capabilities";

/**
 * De technische experimenteeromgeving.
 *
 * ## Wat een experiment hier is
 *
 * Een hypothese over de zoekmachine, een variant die dat zou moeten laten zien,
 * en een uitkomst die tegen vooraf vastgelegde poorten wordt gehouden. Meer
 * niet. Een experiment verandert niets aan productie, en er bestaat geen
 * bevoegdheid die dat wél zou doen: promoveren is een menselijke handeling die
 * buiten de agent om loopt.
 *
 * ## Waarom de poorten vooraf vastliggen
 *
 * Omdat een experiment dat achteraf zijn eigen meetlat mag kiezen, altijd
 * slaagt. De poorten hieronder zijn opgeschreven vóórdat er iets gedraaid is,
 * en ze zijn streng op de dingen die niet mogen verslechteren: harde
 * geldigheid, nachten, eerlijkheid en de slechtste roosterregel. Een hogere
 * voorkeursscore weegt daar niet tegenop — dat is precies de ruil die TEST 24
 * moet tegenhouden.
 *
 * ## Waarom dit geen tweede zoekmachine bouwt
 *
 * Het draaien gebeurt met de bestaande engine, in een apart proces met andere
 * omgevingsvariabelen (NS_ENGINE_PROFILE, NS_ENGINE_VARIANT). Deze laag legt
 * vast wát er gedraaid zou worden en wat eruit kwam; ze voert geen eigen
 * optimalisatie uit.
 */

export interface ExperimentMeting {
  /** Harde geldigheid: aandeel kandidaten zonder bewezen overtreding, 0..1. */
  readonly hardValidShare: number;
  /** Robuuste kwaliteit op het vastgepinde model. */
  readonly robust: number;
  /** De voorkeurslaag. */
  readonly preference: number;
  /** Nachtkwaliteit: clustering, hoger is beter. */
  readonly nights: number;
  /** Eerlijkheid over de roosters. */
  readonly fairness: number;
  /** De slechtste roosterregel. */
  readonly worstLine: number;
}

export interface PoortUitslag {
  readonly naam: string;
  readonly gehaald: boolean;
  readonly waarde: number;
  readonly grens: number;
  readonly uitleg: string;
}

/**
 * De poorten, vooraf vastgelegd.
 *
 * `marge` is hoeveel een maat mag zakken voordat het een verslechtering heet.
 * Nul zou elke ruis tot een afwijzing maken; te ruim zou een echte
 * verslechtering laten passeren. Deze waarden komen overeen met de marges die
 * in de eerdere rondes zijn gebruikt.
 */
export const POORT_MARGES = {
  hardValidShare: 0,
  nights: 1.0,
  fairness: 0.5,
  worstLine: 1.0,
} as const;

/**
 * Komt dit experiment door de poorten?
 *
 * Bewust een zuivere functie: hier zit het oordeel, en dat hoort toetsbaar te
 * zijn zonder dat er een zoekmachine draait.
 */
export function beoordeelExperiment(baseline: ExperimentMeting, resultaat: ExperimentMeting): {
  readonly gates: readonly PoortUitslag[];
  readonly geslaagd: boolean;
  readonly conclusie: string;
} {
  const gates: PoortUitslag[] = [
    {
      naam: "harde geldigheid",
      waarde: resultaat.hardValidShare,
      grens: baseline.hardValidShare - POORT_MARGES.hardValidShare,
      gehaald: resultaat.hardValidShare >= baseline.hardValidShare - POORT_MARGES.hardValidShare,
      uitleg: "een variant mag nooit minder geldige kandidaten opleveren",
    },
    {
      naam: "nachten",
      waarde: resultaat.nights,
      grens: baseline.nights - POORT_MARGES.nights,
      gehaald: resultaat.nights >= baseline.nights - POORT_MARGES.nights,
      uitleg: "de nachtstructuur mag niet meetbaar slechter worden",
    },
    {
      naam: "eerlijkheid",
      waarde: resultaat.fairness,
      grens: baseline.fairness - POORT_MARGES.fairness,
      gehaald: resultaat.fairness >= baseline.fairness - POORT_MARGES.fairness,
      uitleg: "de verdeling over de roosters mag niet verslechteren",
    },
    {
      naam: "slechtste roosterregel",
      waarde: resultaat.worstLine,
      grens: baseline.worstLine - POORT_MARGES.worstLine,
      gehaald: resultaat.worstLine >= baseline.worstLine - POORT_MARGES.worstLine,
      uitleg: "een hogere totaalscore mag geen slechtere slechtste regel verbergen",
    },
  ];

  const gevallen = gates.filter((g) => !g.gehaald);
  const winst = resultaat.preference - baseline.preference;
  const geslaagd = gevallen.length === 0 && winst > 0;

  const conclusie = geslaagd
    ? `De variant haalt alle poorten en wint ${winst.toFixed(2)} op de voorkeurslaag. Dat is een resultaat om voor te leggen, geen besluit: promoveren doet een mens.`
    : gevallen.length > 0
      ? `Afgewezen: ${gevallen.map((g) => `${g.naam} ${g.waarde.toFixed(2)} tegen grens ${g.grens.toFixed(2)}`).join("; ")}.` +
        (winst > 0
          ? ` De voorkeursscore ging wél omhoog (+${winst.toFixed(2)}), maar die winst weegt niet op tegen een verslechtering op deze maten.`
          : "")
      : `Afgewezen: geen winst op de voorkeurslaag (${winst.toFixed(2)}). Alle poorten gehaald, maar er is niets gewonnen.`;

  return { gates, geslaagd, conclusie };
}

/** Een voorstel vastleggen. De agent mag dit; draaien en promoveren niet. */
export async function proposeExperiment(input: {
  readonly actor: Actor;
  readonly grant: AgentGrant;
  readonly locationCode: string;
  readonly hypothesis: string;
  readonly variant: Record<string, unknown>;
  readonly byAgent: boolean;
}): Promise<string> {
  assertAgentMay(input.actor, input.grant, AGENT_CAPABILITIES.EXPERIMENT_PROPOSE);

  // Een onbekend veld is geen experiment maar een typefout, en dat hoort hier
  // te blijken en niet pas als de zoekmachine start.
  const onbekend = Object.keys(input.variant).filter((k) => !VARIANT_VELDEN.has(k));
  if (onbekend.length > 0) {
    throw new Error(`Deze variant kent ${onbekend.join(", ")} niet; toegestaan: ${[...VARIANT_VELDEN].join(", ")}.`);
  }
  if (Object.keys(input.variant).length === 0) {
    throw new Error("Een experiment zonder variant verandert niets en meet dus niets.");
  }

  const rij = await prisma.agentExperiment.create({
    data: {
      locationCode: input.locationCode,
      hypothesis: input.hypothesis.trim(),
      variant: input.variant as object,
      proposedByAgent: input.byAgent,
      proposedByUserId: input.actor.userId,
      status: "PROPOSED",
    },
    select: { id: true },
  });
  await recordAudit({
    actor: input.actor,
    action: "experiment.voorgesteld",
    objectType: "AgentExperiment",
    objectId: rij.id,
    newValue: { hypothesis: input.hypothesis, variant: input.variant, byAgent: input.byAgent },
  });
  return rij.id;
}

/** De uitkomst vastleggen en tegen de poorten houden. */
export async function recordExperimentResult(input: {
  readonly actor: Actor;
  readonly experimentId: string;
  readonly baseline: ExperimentMeting;
  readonly result: ExperimentMeting;
}): Promise<{ readonly geslaagd: boolean; readonly conclusie: string }> {
  const oordeel = beoordeelExperiment(input.baseline, input.result);
  await prisma.agentExperiment.update({
    where: { id: input.experimentId },
    data: {
      status: oordeel.geslaagd ? "PASSED" : "REJECTED",
      baseline: input.baseline as unknown as object,
      result: input.result as unknown as object,
      gateResults: oordeel.gates as unknown as object,
      conclusion: oordeel.conclusie,
      reviewedByUserId: input.actor.userId,
      reviewedAt: new Date(),
    },
  });
  await recordAudit({
    actor: input.actor,
    action: oordeel.geslaagd ? "experiment.door-de-poorten" : "experiment.afgewezen",
    objectType: "AgentExperiment",
    objectId: input.experimentId,
    newValue: { gates: oordeel.gates, conclusie: oordeel.conclusie },
  });
  return { geslaagd: oordeel.geslaagd, conclusie: oordeel.conclusie };
}

/**
 * Wat er nodig is om een variant in productie te nemen.
 *
 * Geen functie die het doet — een beschrijving van de stappen. Promoveren
 * betekent hier: de standaard van de zoekmachine veranderen, en dat gebeurt
 * door een mens die `NS_ENGINE_PROFILE` verzet en de uitkomst opnieuw meet.
 * Er is bewust geen code die dat namens de agent kan doen; dat is het verschil
 * tussen een experiment en een stille wijziging.
 */
export function promotieStappen(experimentId: string): readonly string[] {
  return [
    `Lees het experiment ${experimentId.slice(0, 8)} en de poortuitslagen door.`,
    "Laat een tweede persoon de meting controleren.",
    "Draai de volledige benchmark op de voorgestelde variant, niet alleen de betrokken maat.",
    "Verzet NS_ENGINE_PROFILE in de omgeving en leg vast wie dat wanneer deed.",
    "Meet opnieuw en vergelijk met de vastgelegde baseline.",
  ];
}

/**
 * Wat is hier eerder geprobeerd?
 *
 * Zonder deze kant is een afgewezen experiment alleen een rij in een tabel.
 * Criterium C2 vraagt dat een eerdere afwijzing wordt teruggevonden *met de
 * oorspronkelijke reden* — niet met een nieuwe samenvatting ervan, want dan
 * staat er iets anders dan er destijds is gemeten.
 *
 * De overeenkomst gaat op woorden uit de hypothese en op de velden van de
 * variant. Grof, maar eerlijk grof: hij vindt liever één experiment te veel dan
 * dat hij een eerdere afwijzing mist en de agent hetzelfde nog eens voorstelt.
 */
export async function eerdereExperimenten(input: {
  readonly locationCode: string;
  readonly hypothesis?: string | null;
  readonly variantVelden?: readonly string[];
  readonly limit?: number;
}): Promise<
  readonly {
    readonly id: string;
    readonly hypothesis: string;
    readonly variant: Record<string, unknown>;
    readonly status: string;
    readonly conclusion: string | null;
    readonly gates: readonly PoortUitslag[];
    readonly createdAt: Date;
    readonly overeenkomst: readonly string[];
  }[]
> {
  const rijen = await prisma.agentExperiment.findMany({
    where: { locationCode: input.locationCode },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, hypothesis: true, variant: true, status: true, conclusion: true, gateResults: true, createdAt: true },
  });

  const woorden = (input.hypothesis ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    // Vier letters, niet vijf: "rust" en "duur" zijn hier echte zoekwoorden, en
    // met een drempel van vijf viel "is meer rust eerder geprobeerd?" terug op
    // alleen "geprobeerd" — dat matcht met geen enkele hypothese, en dan meldt
    // de agent dat er niets is geprobeerd terwijl er van alles ligt.
    .filter((w) => w.length >= 4);
  const velden = new Set(input.variantVelden ?? []);

  const beoordeeld = rijen.map((r) => {
    const variant = (r.variant ?? {}) as Record<string, unknown>;
    const tekst = r.hypothesis.toLowerCase();
    const raak = [
      ...woorden.filter((w) => tekst.includes(w)),
      ...Object.keys(variant).filter((k) => velden.has(k)),
    ];
    return {
      id: r.id,
      hypothesis: r.hypothesis,
      variant,
      status: r.status as string,
      // De oorspronkelijke tekst, onaangeraakt. Hem hier herschrijven zou het
      // criterium formeel halen en inhoudelijk breken.
      conclusion: r.conclusion,
      gates: ((r.gateResults ?? []) as unknown as PoortUitslag[]) ?? [],
      createdAt: r.createdAt,
      overeenkomst: [...new Set(raak)],
    };
  });

  const relevant = woorden.length > 0 || velden.size > 0 ? beoordeeld.filter((b) => b.overeenkomst.length > 0) : beoordeeld;
  return relevant
    .sort((a, b) => b.overeenkomst.length - a.overeenkomst.length || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, input.limit ?? 5);
}
