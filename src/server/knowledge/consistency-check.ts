import type { RuleDefinition } from "@/server/rules-engine/ruleset/types";

/**
 * Consistency-checker (§ LYRA MASTER PROGRAM, Fase 10 / opdracht §47) — stap
 * (d) uit `docs/lyra-knowledge/migration-report.md` §4: leest de additieve
 * `conflictsWith`-projectie op `RuleDefinition` (zie `ruleset/types.ts`) en
 * signaleert drift, zonder zelf iets aan het regelbestand te veranderen.
 *
 * ## Wat dit vandaag daadwerkelijk vangt
 *
 * `conflictsWith` is op dit moment op elke regel ongevuld — het vullen ervan
 * is expliciet mens-in-de-lus-werk (migratierapport §4c), niet iets wat deze
 * checker zelf doet. Wat deze checker wél nu al doet: zodra `conflictsWith`
 * ooit gevuld wordt, garandeert hij dat elke genoemde regel-id daadwerkelijk
 * bestaat en dat het conflict wederkerig is vastgelegd (A noemt B ⇒ B noemt
 * A) — twee concrete, structurele fouten die een handmatige invoerfout kan
 * maken zonder dat iemand het opmerkt.
 *
 * ## Wat dit NIET doet
 *
 * Dit is geen vervanging van `resolveRule()`'s eigen, actieve conflict-
 * oplossing (`ruleset/types.ts`) — dat blijft de bron van waarheid voor welke
 * regel bij een botsing wint. Dit is een aparte, read-only inspectielaag
 * erbovenop, voor een toekomstig consistency-rapport of Knowledge-UI-scherm
 * (migratierapport §4d-e, geen van beide vandaag gebouwd).
 *
 * Het CP-SAT-vs-kwaliteitsmodel-gewichtsverschil (`conflict-report.md` §5,
 * "een losse nacht weegt in CP-SAT ongeveer 27× lichter") blijft bewust
 * BUITEN deze checker: dat vraagt optimizer-brede archeologie in de
 * CP-SAT-kostenfunctie om een eerlijke, actuele ratio te berekenen — een
 * losse structurele check zou hier eerder een schijnzekerheid suggereren dan
 * een correcte meting leveren. Nog steeds open, met naam benoemd, niet
 * stilzwijgend weggelaten.
 */

export interface ConflictReferenceIssue {
  readonly ruleId: string;
  readonly kind: "UNKNOWN_TARGET" | "NOT_MUTUAL";
  /** De genoemde regel-id die het probleem veroorzaakt. */
  readonly target: string;
}

/**
 * Valideert `conflictsWith` over een volledige regelset:
 *   - elke genoemde regel-id moet daadwerkelijk in de set voorkomen;
 *   - elk conflict moet wederkerig zijn vastgelegd.
 *
 * Geeft een lege lijst terug zodra er niets gevuld is (de huidige,
 * onveranderde staat van het regelbestand) — dat is geen fout, alleen
 * "nog niets om te controleren".
 */
export function conflictsWithIssues(regels: readonly RuleDefinition[]): readonly ConflictReferenceIssue[] {
  const idsAanwezig = new Set(regels.map((r) => r.id));
  const conflictsPerId = new Map(regels.map((r) => [r.id, new Set(r.conflictsWith ?? [])]));

  const issues: ConflictReferenceIssue[] = [];
  for (const regel of regels) {
    for (const target of regel.conflictsWith ?? []) {
      if (!idsAanwezig.has(target)) {
        issues.push({ ruleId: regel.id, kind: "UNKNOWN_TARGET", target });
        continue;
      }
      const terug = conflictsPerId.get(target);
      if (!terug?.has(regel.id)) {
        issues.push({ ruleId: regel.id, kind: "NOT_MUTUAL", target });
      }
    }
  }
  return issues;
}
