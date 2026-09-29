import type { AgentPlan } from "./model/types";
import { vraagtOmTeRekenen } from "./request-shape";

/**
 * Plancontrole: twee grenzen die niet van de welwillendheid van een taalmodel
 * mogen afhangen. Zelfde plek en zelfde reden als de grendels in agent.ts —
 * een volgend model komt door dezelfde poort — en zelfde karakter: geen
 * uitzondering per vraag, alleen de vorm van het verzoek en wat het scherm al
 * weet.
 *
 * Aanleiding (AFTER-run 20260929-151948, zie
 * docs/lyra-knowledge/after-analysis-20260929.md):
 *  - E-klacht-3/-4: op een vage klacht met een bekend rooster en een bekende
 *    regel riep het model geen enkele tool aan en vroeg het algemeen door, of
 *    oordeelde het direct. De systeeminstructie zei al "eerst rosterLine";
 *    sturing is geen garantie.
 *  - F-DDR-LN-weekend: "Dit is toch geen lekker vrij weekend zo?" werd een
 *    voorstel om een nieuwe kandidaatreeks te rekenen. Er werd niets gevraagd
 *    uit te rekenen; er werd gevraagd hoe het weekend eruitziet.
 *  - J-geen-verduidelijking-1: het model leverde geen leesbaar plan, en het
 *    noodantwoord was een algemene wedervraag — terwijl het scherm precies
 *    zei over welk rooster het ging.
 *
 * Regels:
 *  1. Een rekenvoorstel zonder rekenverzoek vervalt. Rekenen kost budget en
 *     vraagt een menselijke bevestiging; het hoort alleen voorgesteld te worden
 *     als iemand erom vraagt (`vraagtOmTeRekenen`, dezelfde definitie als de stub).
 *  2. Een onleesbaar plan is geen wedervraag: met bekende context wordt eerst
 *     die context opgezocht.
 *  3. Een plan zonder één tool, terwijl het scherm een rooster (en regel) kent,
 *     zoekt eerst die context op — ook als het model wil doorvragen. Een echte
 *     wedervraag blijft staan (een onbekend begrip, een onduidelijk doel); hij
 *     wordt alleen gesteld ná het kijken, zodat de vraag gericht kan zijn.
 *     Weigeringen, "niet vast te stellen", regelvragen en geheugenvoorstellen
 *     blijven ongemoeid.
 */

export interface PlanContext {
  readonly rosterCode?: string | null;
  readonly lineNumber?: number | null;
}

export interface PlanCorrectie {
  readonly regel: "VOORSTEL_ZONDER_REKENVERZOEK" | "ONLEESBAAR_PLAN" | "ONDERZOEK_VOOR_OORDEEL";
  readonly uitleg: string;
}

const NIET_AANRAKEN: ReadonlySet<string> = new Set(["GEWEIGERD", "REGELVRAAG", "NIET_VAST_TE_STELLEN"]);

/** De opzoeking die bij de bekende schermcontext hoort, als die tool mag. */
function contextOpzoeking(ctx: PlanContext, toegestaan: ReadonlySet<string>): AgentPlan["toolCalls"] {
  if (ctx.rosterCode && ctx.lineNumber && toegestaan.has("rosterLine")) return [{ tool: "rosterLine", input: {} }];
  if (ctx.rosterCode && toegestaan.has("rosterProject")) return [{ tool: "rosterProject", input: {} }];
  return [];
}

export function bewaakPlan(
  plan: AgentPlan,
  vraag: string,
  ctx: PlanContext,
  toegestaan: ReadonlySet<string>,
): { plan: AgentPlan; correcties: readonly PlanCorrectie[] } {
  const correcties: PlanCorrectie[] = [];
  let p = plan;

  if (p.proposal && !vraagtOmTeRekenen(vraag)) {
    correcties.push({ regel: "VOORSTEL_ZONDER_REKENVERZOEK", uitleg: "het model stelde een rekenopdracht voor, maar de vraag vraagt nergens om te rekenen" });
    const { proposal: _weg, ...rest } = p;
    p = { ...rest, intent: p.toolCalls.length > 0 ? p.intent : "ROOSTERVRAAG" };
  }

  if (p.onleesbaar) {
    const opzoeking = contextOpzoeking(ctx, toegestaan);
    if (opzoeking.length > 0) {
      correcties.push({ regel: "ONLEESBAAR_PLAN", uitleg: "geen leesbaar plan; de bekende schermcontext opgezocht in plaats van algemeen door te vragen" });
      const { clarification: _weg, onleesbaar: _ook, ...rest } = p;
      return { plan: { ...rest, intent: "ROOSTERVRAAG", toolCalls: opzoeking, reasoning: "plan onleesbaar; schermcontext opgezocht" }, correcties };
    }
  }

  const alleenPraten =
    p.toolCalls.length === 0 && !p.refusal && !p.proposal && !p.memoryProposal && !p.cannotDetermine && !NIET_AANRAKEN.has(p.intent);
  if (alleenPraten) {
    const opzoeking = contextOpzoeking(ctx, toegestaan);
    if (opzoeking.length > 0) {
      correcties.push({ regel: "ONDERZOEK_VOOR_OORDEEL", uitleg: `geen enkele tool gepland terwijl de context bekend is; eerst ${opzoeking.map((o) => o.tool).join(", ")}` });
      p = { ...p, toolCalls: opzoeking };
    }
  }

  return { plan: p, correcties };
}
