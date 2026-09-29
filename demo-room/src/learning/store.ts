import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import { type Concept, ConceptFout, type ConceptTransition, conceptUitFeedback, losConflictOp, overgang, VALIDATIE_DREMPEL, voegToe } from "./concepts";
import { classifyFeedback, type FeedbackClassification, type FeedbackEvent } from "./feedback";
import { evalueer, type GeneralisatieMeting, LexicaleConceptRetriever, maakSuite } from "./generalization";

/**
 * Opslag voor feedback en concepten, in de eigen datamap van de Demo Room
 * (nooit de productiedatabase). Feedback is append-only (JSONL); concepten
 * staan als één bestand met volledige geschiedenis, atomair weggeschreven
 * (tijdelijk bestand + rename), zodat een afgebroken schrijfactie nooit een
 * half bestand achterlaat.
 */

const MAP = () => path.join(DATA_DIR, "learning");
const FEEDBACK = () => path.join(MAP(), "feedback.jsonl");
const CONCEPTEN = () => path.join(MAP(), "concepts.json");

export function leesFeedback(): readonly (FeedbackEvent & { readonly classification: FeedbackClassification })[] {
  if (!existsSync(FEEDBACK())) return [];
  return readFileSync(FEEDBACK(), "utf8").split("\n").filter(Boolean).map((r) => JSON.parse(r));
}

export function leesConcepten(): readonly Concept[] {
  if (!existsSync(CONCEPTEN())) return [];
  return JSON.parse(readFileSync(CONCEPTEN(), "utf8")) as Concept[];
}

function schrijfConcepten(concepten: readonly Concept[]): void {
  mkdirSync(MAP(), { recursive: true });
  const tmp = `${CONCEPTEN()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(concepten, null, 2)}\n`);
  renameSync(tmp, CONCEPTEN());
}

function nieuwId(prefix: string, bestaand: readonly { id: string }[]): string {
  return `${prefix}-${String(bestaand.length + 1).padStart(4, "0")}`;
}

/** Feedback vastleggen, indelen en als PROPOSED-concept toevoegen (met conflictdetectie). */
export function registreerFeedback(
  invoer: Omit<FeedbackEvent, "id" | "receivedAt">,
  now = new Date().toISOString(),
): { readonly event: FeedbackEvent; readonly classification: FeedbackClassification; readonly concept: Concept; readonly conflicten: readonly string[] } {
  const bestaandeFeedback = leesFeedback();
  const event: FeedbackEvent = { ...invoer, id: nieuwId("FB", bestaandeFeedback), receivedAt: now };
  const classification = classifyFeedback(event);
  mkdirSync(MAP(), { recursive: true });
  appendFileSync(FEEDBACK(), `${JSON.stringify({ ...event, classification })}\n`);

  const concepten = leesConcepten();
  const concept = conceptUitFeedback(nieuwId("CPT", concepten), event, classification, now);
  const { concepten: bijgewerkt, conflicten } = voegToe(concept, concepten, now);
  schrijfConcepten(bijgewerkt);
  return { event, classification, concept: bijgewerkt.find((c) => c.id === concept.id)!, conflicten };
}

/**
 * Een concept meten (Phase I) en de uitkomst vastleggen: PROPOSED → TESTING,
 * en bij voldoende generalisatie TESTING → VALIDATED. Nooit verder: ACTIVE is
 * altijd een menselijke stap (`activeer`).
 */
export function meetConcept(id: string, now = new Date().toISOString()): { readonly concept: Concept; readonly meting: GeneralisatieMeting } {
  const concepten = leesConcepten();
  const concept = concepten.find((c) => c.id === id);
  if (!concept) throw new ConceptFout(`onbekend concept ${id}`);
  const systeem = { id: "generalisatie", role: "SYSTEEM" as const };
  const meting = evalueer(concept, maakSuite(concept), new LexicaleConceptRetriever(), concepten, now);
  const evidence = { devRecall: meting.devRecall, holdoutRecall: meting.holdoutRecall, falsePositiveRate: meting.falsePositiveRate, measuredAt: now };
  let bijgewerkt: Concept = concept.status === "PROPOSED" ? overgang(concept, "TESTING", systeem, "generalisatiesuite aangemaakt en gemeten", now, { evidence }) : { ...concept, evidence };
  const haalt = meting.holdoutRecall >= VALIDATIE_DREMPEL.minHoldoutRecall && meting.falsePositiveRate <= VALIDATIE_DREMPEL.maxFalsePositiveRate;
  if (bijgewerkt.status === "TESTING" && haalt) {
    bijgewerkt = overgang(bijgewerkt, "VALIDATED", systeem, `holdout-recall ${meting.holdoutRecall.toFixed(2)}, vals-positief ${meting.falsePositiveRate.toFixed(2)}`, now, { evidence });
  }
  schrijfConcepten(concepten.map((c) => (c.id === id ? bijgewerkt : c)));
  return { concept: bijgewerkt, meting };
}

/** Menselijke activatie: alleen roostercommissie of NS, alleen vanuit VALIDATED, nooit bij een conflict. */
export function activeer(id: string, actor: ConceptTransition["actor"], reden: string, now = new Date().toISOString()): Concept {
  const concepten = leesConcepten();
  const concept = concepten.find((c) => c.id === id);
  if (!concept) throw new ConceptFout(`onbekend concept ${id}`);
  const actief = overgang(concept, "ACTIVE", actor, reden, now);
  schrijfConcepten(concepten.map((c) => (c.id === id ? actief : c)));
  return actief;
}

export function verwerp(id: string, actor: ConceptTransition["actor"], reden: string, now = new Date().toISOString()): Concept {
  const concepten = leesConcepten();
  const concept = concepten.find((c) => c.id === id);
  if (!concept) throw new ConceptFout(`onbekend concept ${id}`);
  const verworpen = overgang(concept, "REJECTED", actor, reden, now);
  schrijfConcepten(concepten.map((c) => (c.id === id ? verworpen : c)));
  return verworpen;
}

export function kiesInConflict(winnaarId: string, actor: ConceptTransition["actor"], reden: string, now = new Date().toISOString()): readonly Concept[] {
  const uit = losConflictOp(leesConcepten(), winnaarId, actor, reden, now);
  schrijfConcepten(uit);
  return uit;
}
