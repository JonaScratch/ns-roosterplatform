import { type AuteurRol, type FeedbackClassification, type FeedbackEvent, type FeedbackScope, maxScopeFor } from "./feedback";

/**
 * Concept Memory (Phase H): wat Lyra uit feedback leert, als concept met een
 * levenscyclus, herkomst en tegenstrijdigheden.
 *
 *   PROPOSED → TESTING → VALIDATED → ACTIVE
 *        ↘         ↘          ↘         ↘
 *        REJECTED  REJECTED   CONFLICTED  SUPERSEDED
 *
 * - PROPOSED: net uit feedback afgeleid; doet nog niets.
 * - TESTING: heeft een generalisatiesuite (generalization.ts) en wordt gemeten.
 * - VALIDATED: haalde de drempel op dev én holdout; nog steeds inactief.
 * - ACTIVE: alleen door een mens (ROOSTERCOMMISSIE of NS_FORMEEL), alleen
 *   vanuit VALIDATED, en nooit als het concept een tegenstrijdigheid heeft.
 * - CONFLICTED: botst met een ander concept over hetzelfde onderwerp; blijft
 *   dat tot een mens kiest (de ander wordt dan SUPERSEDED of REJECTED).
 * - SUPERSEDED / REJECTED: eindtoestanden; de geschiedenis blijft bewaard.
 *
 * Elke overgang staat in `history` met wie, wanneer en waarom. Niets wordt
 * verwijderd: een verworpen concept is ook kennis ("dit hebben we geprobeerd").
 */

export type ConceptStatus = "PROPOSED" | "TESTING" | "VALIDATED" | "ACTIVE" | "CONFLICTED" | "SUPERSEDED" | "REJECTED";

export interface ConceptTransition {
  readonly at: string;
  readonly from: ConceptStatus | null;
  readonly to: ConceptStatus;
  readonly actor: { readonly id: string; readonly role: AuteurRol | "SYSTEEM" };
  readonly reason: string;
}

export interface Concept {
  readonly id: string;
  readonly statement: string;
  readonly scope: FeedbackScope;
  readonly nature: FeedbackClassification["nature"];
  readonly subjectKey: string;
  readonly polarity: FeedbackClassification["polarity"];
  readonly status: ConceptStatus;
  readonly provenance: {
    readonly feedbackIds: readonly string[];
    readonly authors: readonly { readonly id: string; readonly role: AuteurRol }[];
    readonly locationCode: string;
    readonly createdAt: string;
    readonly formalReference: string | null;
  };
  /** Laatste generalisatiemeting (generalization.ts), als die er is. */
  readonly evidence: { readonly devRecall: number; readonly holdoutRecall: number; readonly falsePositiveRate: number; readonly measuredAt: string } | null;
  readonly contradicts: readonly string[];
  readonly supersededBy: string | null;
  readonly history: readonly ConceptTransition[];
}

const TOEGESTAAN: Readonly<Record<ConceptStatus, readonly ConceptStatus[]>> = {
  PROPOSED: ["TESTING", "REJECTED", "CONFLICTED"],
  TESTING: ["VALIDATED", "REJECTED", "CONFLICTED"],
  VALIDATED: ["ACTIVE", "REJECTED", "CONFLICTED", "TESTING"],
  ACTIVE: ["SUPERSEDED", "CONFLICTED", "REJECTED"],
  CONFLICTED: ["PROPOSED", "SUPERSEDED", "REJECTED"],
  SUPERSEDED: [],
  REJECTED: [],
};

/** De drempel om van TESTING naar VALIDATED te mogen (generalization.ts levert de cijfers). */
export const VALIDATIE_DREMPEL = { minHoldoutRecall: 0.8, maxFalsePositiveRate: 0.2 } as const;

export class ConceptFout extends Error {}

export function conceptUitFeedback(id: string, event: FeedbackEvent, klas: FeedbackClassification, now: string): Concept {
  if (!maxScopeFor(event.author.role).includes(klas.scope)) {
    throw new ConceptFout(`${event.author.role} kan geen concept met scope ${klas.scope} voorstellen`);
  }
  return {
    id,
    statement: event.text.trim(),
    scope: klas.scope,
    nature: klas.nature,
    subjectKey: klas.subjectKey,
    polarity: klas.polarity,
    status: "PROPOSED",
    provenance: {
      feedbackIds: [event.id],
      authors: [event.author],
      locationCode: event.context.locationCode,
      createdAt: now,
      formalReference: event.formalReference ?? null,
    },
    evidence: null,
    contradicts: [],
    supersededBy: null,
    history: [{ at: now, from: null, to: "PROPOSED", actor: { id: "systeem", role: "SYSTEEM" }, reason: klas.reasons.join("; ") }],
  };
}

/**
 * Een statusovergang, met alle bewakingen. Gooit `ConceptFout` met een
 * leesbare reden als de overgang niet mag — nooit stil.
 */
export function overgang(concept: Concept, naar: ConceptStatus, actor: ConceptTransition["actor"], reden: string, now: string, extra: Partial<Pick<Concept, "supersededBy" | "evidence">> = {}): Concept {
  if (!TOEGESTAAN[concept.status].includes(naar)) {
    throw new ConceptFout(`${concept.status} → ${naar} is geen toegestane overgang`);
  }
  if (naar === "VALIDATED") {
    const e = extra.evidence ?? concept.evidence;
    if (!e) throw new ConceptFout("VALIDATED vereist een generalisatiemeting");
    if (e.holdoutRecall < VALIDATIE_DREMPEL.minHoldoutRecall || e.falsePositiveRate > VALIDATIE_DREMPEL.maxFalsePositiveRate) {
      throw new ConceptFout(
        `generalisatie onder de drempel (holdout-recall ${e.holdoutRecall.toFixed(2)} < ${VALIDATIE_DREMPEL.minHoldoutRecall} of vals-positief ${e.falsePositiveRate.toFixed(2)} > ${VALIDATIE_DREMPEL.maxFalsePositiveRate})`,
      );
    }
  }
  if (naar === "ACTIVE") {
    if (actor.role !== "ROOSTERCOMMISSIE" && actor.role !== "NS_FORMEEL") {
      throw new ConceptFout(`activeren is een menselijke beslissing van de roostercommissie of NS, niet van ${actor.role}`);
    }
    if (concept.contradicts.length > 0) throw new ConceptFout("een concept met een open tegenstrijdigheid kan niet actief worden");
    if ((concept.scope === "CAO" || concept.scope === "FORMAL_NS_RULE") && !concept.provenance.formalReference) {
      throw new ConceptFout("een CAO- of formeel NS-concept vereist een formele bronverwijzing");
    }
  }
  if (naar === "SUPERSEDED" && !extra.supersededBy) throw new ConceptFout("SUPERSEDED vereist het concept dat het vervangt");
  return {
    ...concept,
    ...extra,
    status: naar,
    history: [...concept.history, { at: now, from: concept.status, to: naar, actor, reason: reden }],
  };
}

/**
 * Tegenstrijdigheden: zelfde onderwerp, zelfde standplaats, tegengestelde
 * polariteit, en geen van beide al afgehandeld. Beide raken CONFLICTED; een
 * mens lost het op (`losConflictOp`).
 */
export function vindTegenstrijdigheden(nieuw: Concept, bestaand: readonly Concept[]): readonly Concept[] {
  return bestaand.filter(
    (c) =>
      c.id !== nieuw.id &&
      c.subjectKey === nieuw.subjectKey &&
      c.provenance.locationCode === nieuw.provenance.locationCode &&
      c.polarity !== nieuw.polarity &&
      !["SUPERSEDED", "REJECTED"].includes(c.status),
  );
}

/** Voegt een nieuw concept toe aan de verzameling en markeert botsingen aan beide kanten. */
export function voegToe(nieuw: Concept, bestaand: readonly Concept[], now: string): { concepten: readonly Concept[]; conflicten: readonly string[] } {
  const botsend = vindTegenstrijdigheden(nieuw, bestaand);
  if (botsend.length === 0) return { concepten: [...bestaand, nieuw], conflicten: [] };
  const systeem = { id: "systeem", role: "SYSTEEM" as const };
  const idsBotsend = new Set(botsend.map((c) => c.id));
  const bijgewerkt = bestaand.map((c) =>
    idsBotsend.has(c.id)
      ? { ...overgang(c, "CONFLICTED", systeem, `botst met ${nieuw.id} (zelfde onderwerp, tegengestelde voorkeur)`, now), contradicts: [...c.contradicts, nieuw.id] }
      : c,
  );
  const nieuwConflict = { ...overgang(nieuw, "CONFLICTED", systeem, `botst met ${botsend.map((c) => c.id).join(", ")}`, now), contradicts: botsend.map((c) => c.id) };
  return { concepten: [...bijgewerkt, nieuwConflict], conflicten: botsend.map((c) => c.id) };
}

/** Een mens kiest in een conflict: de winnaar gaat terug naar PROPOSED, de rest wordt SUPERSEDED. */
export function losConflictOp(concepten: readonly Concept[], winnaarId: string, actor: ConceptTransition["actor"], reden: string, now: string): readonly Concept[] {
  if (actor.role !== "ROOSTERCOMMISSIE" && actor.role !== "NS_FORMEEL") throw new ConceptFout("een conflict oplossen is een menselijke beslissing");
  const winnaar = concepten.find((c) => c.id === winnaarId);
  if (!winnaar || winnaar.status !== "CONFLICTED") throw new ConceptFout(`${winnaarId} is geen concept in conflict`);
  const verliezers = new Set(winnaar.contradicts);
  return concepten.map((c) => {
    if (c.id === winnaarId) return { ...overgang(c, "PROPOSED", actor, `conflict opgelost: ${reden}`, now), contradicts: [] };
    if (verliezers.has(c.id)) return { ...overgang(c, "SUPERSEDED", actor, `vervangen door ${winnaarId}: ${reden}`, now, { supersededBy: winnaarId }), contradicts: [] };
    return c;
  });
}
