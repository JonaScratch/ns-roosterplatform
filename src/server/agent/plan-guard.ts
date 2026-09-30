import type { AgentPlan } from "./model/types";
import { onderwerpTool, vraagtNaarKennis, vraagtOmTeRekenen } from "./request-shape";

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
 *  4. Hoort bij het onderwerp één bepaalde tool (`ONDERWERP_TOOLS`, bv.
 *     nachtreeksen → nightStructure) en ontbreekt die, dan wordt hij aangevuld.
 */

export interface PlanContext {
  readonly rosterCode?: string | null;
  readonly lineNumber?: number | null;
}

export interface PlanCorrectie {
  readonly regel: "VOORSTEL_ZONDER_REKENVERZOEK" | "ONLEESBAAR_PLAN" | "ONDERZOEK_VOOR_OORDEEL" | "ONTBREKENDE_ONDERWERPTOOL";
  readonly uitleg: string;
}

const NIET_AANRAKEN: ReadonlySet<string> = new Set(["GEWEIGERD", "REGELVRAAG", "NIET_VAST_TE_STELLEN"]);

/**
 * De opzoeking die bij de bekende context en het onderwerp van de vraag hoort.
 *
 * Met een bekende regel: die regel (`rosterLine`), plus de onderwerptool.
 * Met alleen een rooster: uitsluitend de onderwerptool. Een vraag over
 * voorkeuren of afspraken zonder andere opzoeking: `knowledgeSearch`, ook
 * zonder rooster. Een algemeen
 * `rosterProject` gaf daar in run 20260929-193436 geen antwoord maar wel een
 * misleidende bijzin ("223 diensten in DDR-50MIX" — dat is het hele pakket).
 * `metAlgemeen` staat dat overzicht alleen toe als noodgreep bij een
 * onleesbaar plan zonder onderwerp (J-1: "welke diensten staan er in dit rooster").
 */
function contextOpzoeking(ctx: PlanContext, vraag: string, toegestaan: ReadonlySet<string>, metAlgemeen: boolean, alleenOnderwerp = false): AgentPlan["toolCalls"] {
  const onderwerp = onderwerpTool(vraag);
  const calls: { tool: string; input: Record<string, unknown> }[] = [];
  if (!alleenOnderwerp && ctx.rosterCode && ctx.lineNumber && toegestaan.has("rosterLine")) calls.push({ tool: "rosterLine", input: {} });
  if (ctx.rosterCode && onderwerp && toegestaan.has(onderwerp.tool)) calls.push({ tool: onderwerp.tool, input: {} });
  // Voorkeuren en afspraken staan in de goedgekeurde kennis, niet in een
  // rooster: die opzoeking kan ook zonder gekozen rooster.
  if (calls.length === 0 && vraagtNaarKennis(vraag) && toegestaan.has("knowledgeSearch")) calls.push({ tool: "knowledgeSearch", input: { query: vraag.slice(0, 300) } });
  if (calls.length === 0 && metAlgemeen && ctx.rosterCode && toegestaan.has("rosterProject")) calls.push({ tool: "rosterProject", input: {} });
  return calls;
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
    const opzoeking = contextOpzoeking(ctx, vraag, toegestaan, true);
    if (opzoeking.length > 0) {
      correcties.push({ regel: "ONLEESBAAR_PLAN", uitleg: "geen leesbaar plan; de bekende schermcontext opgezocht in plaats van algemeen door te vragen" });
      const { clarification: _weg, onleesbaar: _ook, ...rest } = p;
      return { plan: { ...rest, intent: "ROOSTERVRAAG", toolCalls: opzoeking, reasoning: "plan onleesbaar; schermcontext opgezocht" }, correcties };
    }
  }

  // "Niet vast te stellen" zonder één opzoeking is geen eerlijk "ik weet het
  // niet" maar een oordeel vóór het kijken: het model zegt dat iets niet in
  // de gegevens staat die het nooit heeft opgehaald (AFTER-verificatie
  // 20260930, drie runs: "niet te vinden in de huidige toolresultaten" zonder
  // één tool). Dan eerst opzoeken, en het voorbarige oordeel laten vallen: het
  // antwoord volgt uit wat de opzoeking oplevert. Kan er niets opgezocht
  // worden, dan blijft het oordeel staan.
  const alleenPraten =
    p.toolCalls.length === 0 && !p.refusal && !p.proposal && !p.memoryProposal && (p.cannotDetermine ? p.intent !== "GEWEIGERD" && p.intent !== "REGELVRAAG" : !NIET_AANRAKEN.has(p.intent));
  if (alleenPraten) {
    // Bij "niet vast te stellen" telt alleen een opzoeking die over het
    // onderwerp van de vraag gaat: een algemene roosterregel bewijst niets
    // over bijvoorbeeld een solverkeuze, en dan blijft het oordeel staan.
    const opzoeking = contextOpzoeking(ctx, vraag, toegestaan, false, Boolean(p.cannotDetermine));
    if (opzoeking.length > 0) {
      const voorbarig = Boolean(p.cannotDetermine);
      correcties.push({
        regel: "ONDERZOEK_VOOR_OORDEEL",
        uitleg: voorbarig
          ? `"niet vast te stellen" zonder één opzoeking; eerst ${opzoeking.map((o) => o.tool).join(", ")}`
          : `geen enkele tool gepland terwijl er iets op te zoeken is; eerst ${opzoeking.map((o) => o.tool).join(", ")}`,
      });
      const { cannotDetermine: _voorbarig, ...rest } = p;
      p = { ...(voorbarig ? rest : p), toolCalls: opzoeking, ...(voorbarig ? { intent: p.intent === "NIET_VAST_TE_STELLEN" ? "ROOSTERVRAAG" : p.intent } : {}) };
    }
  }

  // Regel 4: de tool die bij het onderwerp hoort ontbreekt in een plan dat wél
  // gegevens ophaalt. Aanvullen, niets weghalen. Regelvragen, voorstellen en
  // weigeringen blijven ongemoeid: "mag ik na drie nachten achter elkaar…" is
  // een vraag over de regel, niet over dit rooster.
  const onderwerp = onderwerpTool(vraag);
  const regelvraag = p.intent === "REGELVRAAG" || p.toolCalls.some((c) => c.tool === "ruleSearch" || c.tool === "ruleLookup");
  if (
    onderwerp &&
    ctx.rosterCode &&
    toegestaan.has(onderwerp.tool) &&
    p.toolCalls.length > 0 &&
    !p.toolCalls.some((c) => c.tool === onderwerp.tool) &&
    !regelvraag &&
    !p.refusal &&
    !p.proposal
  ) {
    correcties.push({ regel: "ONTBREKENDE_ONDERWERPTOOL", uitleg: `de vraag gaat over ${onderwerp.onderwerp.toLowerCase()}; ${onderwerp.tool} aangevuld naast ${p.toolCalls.map((c) => c.tool).join(", ")}` });
    p = { ...p, toolCalls: [...p.toolCalls, { tool: onderwerp.tool, input: {} }] };
  }

  return { plan: p, correcties };
}
