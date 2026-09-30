import "server-only";
import type { Actor } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";
import { finishActivity, heartbeat, recordEvent, startActivity } from "./activity";
import { AGENT_CAPABILITIES, AgentCapabilityError, agentMay, currentGrant, levelOf } from "./capabilities";
import { type UiContext, resolveContext, uiContextSchema } from "./context";
import { claimVerificatieMelding, ongedekteGezagsClaims } from "./claim-verification";
import { bewaakPlan, type PlanCorrectie } from "./plan-guard";
import { gegevensTekst, grondingsMelding, ongegrondeVermeldingen } from "./grounding";
import { afwezigheidsMelding, citaatVoorbehoud, nietCiteerbareBronnen, verzonnenAfwezigheden, vraagtOmCitaat } from "./bron-afwezigheid";
import { begrippenIn } from "./vocabulary";
import { verankerKennisBereik } from "./kennis-bereik";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { bronTekst } from "@/server/rules-engine/ruleset/source-text";
import { localConfigFromEnv, localModel } from "./model/local";
import { stubModel } from "./model/stub";
import type { AgentAnswer, AgentPlan, ChatModel, PlanRequest } from "./model/types";
import { projectGoals } from "./project-goals";
import { geldendeGeheugenDoelen } from "./promotion";
import { verbodenHandeling } from "./refusals";
import { type ToolCall, type ToolFout, callTool, toolCatalogue } from "./tools";
import { actieveTrace, momentopname } from "./trace";
import { getActiveLyraVersion } from "@/lib/lyra-release";

/**
 * De agent: één beurt in het gesprek, van vraag tot antwoord.
 *
 * ## De vaste volgorde
 *
 * context bepalen → bevoegdheden lezen → plannen → tools aanroepen → antwoorden
 * → vastleggen. Elke stap is te volgen: welke tools zijn gebruikt, waarop het
 * antwoord steunt, en wat de agent van plan was.
 *
 * ## Wat hier bewust níet gebeurt
 *
 * Er wordt niets gewijzigd. Deze laag leest en legt uit. Opdrachten starten,
 * voorkeuren vastleggen en experimenten draaien komen in latere fasen, elk met
 * een eigen bevoegdheid. Wat de agent niet mag, zegt hij hardop in plaats van
 * stil te blijven.
 */

/**
 * Welk model beantwoordt deze vraag?
 *
 * Staat er een lokaal model ingesteld (NS_LOCAL_LLM_URL en NS_LOCAL_LLM_MODEL),
 * dan praat de agent daarmee. Staat dat er niet, dan blijft de stub actief en
 * zegt het scherm dat er geen taalmodel draait.
 *
 * Er wordt hier niet gekeken óf het model bereikbaar is: dat zou elke vraag een
 * netwerkcontrole kosten. Valt het eindpunt weg, dan mislukt de aanroep en komt
 * dat als fout terug — zichtbaar, in plaats van stil terugvallen op een stub die
 * dan voor een taalmodel zou doorgaan.
 */
export function modelForRequest(): ChatModel {
  // De scenariotoetsen meten de kéten, niet het taalmodel: welke tools worden
  // gekozen, wat wordt geweigerd, wat verandert er in de database. Zouden die
  // toetsen meebewegen met het model dat toevallig draait, dan meten ze twee
  // dingen tegelijk en zegt een rode uitslag niets meer. Vandaar deze schakelaar
  // — en niet andersom: de lokale benchmark dwingt nooit een stub af.
  if (process.env.NS_AGENT_FORCE_STUB === "1") return stubModel;
  const config = localConfigFromEnv();
  return config ? localModel(config) : stubModel;
}

export interface AskResult extends AgentAnswer {
  readonly sessionId: string | null;
  readonly intent: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
  readonly model: string;
  readonly isLanguageModel: boolean;
  readonly level: "A" | "B" | "C";
  readonly capabilities: readonly string[];
  readonly contextUsed: Record<string, unknown>;
  /**
   * Als een grendel het modelantwoord verving: welke, en wat het model had
   * willen zeggen. Het scherm toont alleen de melding; dit veld is er voor
   * de analyse (benchmark, Demo Room), zodat een grendelbeslissing achteraf
   * te beoordelen is zonder het activiteitenlog uit de database te halen.
   */
  readonly tegengehouden?: { readonly grendel: "ZONDER_BRON" | "GRONDING" | "CLAIMVERIFICATIE" | "AFWEZIGHEID"; readonly tekst: string; readonly detail: unknown };
  /** Wat de plancontrole aan het modelplan veranderde (plan-guard.ts); alleen aanwezig als er iets veranderde. */
  readonly planCorrecties?: readonly PlanCorrectie[];
}

export async function askAgent(input: {
  readonly actor: Actor;
  readonly text: string;
  readonly uiContext: UiContext;
  readonly sessionId?: string | null;
  /** Zonder opslag: voor de benchmark, die geen gesprekken hoort achter te laten. */
  readonly persist?: boolean;
  /**
   * Alleen voor gecontroleerde experimenten (Demo Room): een ander model dan
   * het productiemodel, dezelfde keten eromheen. Geen enkele productieaanroep
   * zet dit veld; zonder dit veld is het gedrag exact zoals het was.
   */
  readonly modelOverride?: ChatModel;
  /**
   * Alleen voor benchmarks (adversarial Q, "tool_falen"): laat de genoemde
   * tools falen alsof ze vastliepen. Geen enkele productieaanroep zet dit veld.
   */
  readonly toolFouten?: Readonly<Record<string, ToolFout>>;
}): Promise<AskResult> {
  const model = input.modelOverride ?? modelForRequest();
  const ctx = uiContextSchema.parse(input.uiContext);
  const resolved = await resolveContext(ctx);
  const grant = await currentGrant(resolved.locationCode, ctx.candidateId ? null : null);

  const basis = {
    sessionId: input.sessionId ?? null,
    model: model.name,
    isLanguageModel: model.isLanguageModel,
    level: levelOf(grant),
    capabilities: grant.capabilities,
    contextUsed: {
      source: resolved.source,
      candidateId: resolved.candidate?.id ?? null,
      rosterCode: resolved.roster?.code ?? null,
      lineNumber: resolved.lineNumber,
      weekday: resolved.weekday,
      dutyCode: resolved.duty?.code ?? null,
      missing: resolved.missing,
    },
  };

  if (!agentMay(input.actor, grant, AGENT_CAPABILITIES.CHAT)) {
    const fout = new AgentCapabilityError(AGENT_CAPABILITIES.CHAT, "GEEN_RECHT");
    await recordAudit({ actor: input.actor, action: "agent.vraag.geweigerd", objectType: "AgentSession", objectId: input.sessionId ?? null, result: "DENIED", reason: fout.message });
    return { ...basis, text: fout.message, data: null, sources: [], status: "GEWEIGERD", intent: "GEWEIGERD", reasoning: "geen recht om de agent te gebruiken", toolCalls: [] };
  }

  const geschiedenis = input.sessionId
    ? (
        await prisma.agentMessage.findMany({
          where: { sessionId: input.sessionId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { role: true, text: true },
        })
      )
        .reverse()
        .filter((m) => m.role !== "SYSTEM")
        .map((m) => ({ role: m.role === "USER" ? ("USER" as const) : ("AGENT" as const), text: m.text }))
    : [];

  const verzoek: PlanRequest = {
    text: input.text,
    context: {
      locationCode: resolved.locationCode,
      source: resolved.source,
      candidateId: resolved.candidate?.id ?? null,
      rosterCode: resolved.roster?.code ?? null,
      lineNumber: resolved.lineNumber,
      weekday: resolved.weekday,
      dutyCode: resolved.duty?.code ?? null,
      missing: resolved.missing,
    },
    tools: toolCatalogue(input.actor),
    history: geschiedenis,
    // Wat er werkelijk overblijft: recht van de vrager én toekenning én de
    // noodrem. Een planner die meer ziet dan dat, belooft wat de
    // rechtencontrole daarna weigert.
    capabilities: grant.capabilities.filter((c) => agentMay(input.actor, grant, c)),
    suspended: grant.suspendedAt !== null,
  };

  // Beurttrace (trace.ts): alleen als de aanroeper er één heeft geopend.
  const trace = actieveTrace();
  if (trace) {
    const release = getActiveLyraVersion();
    trace.model = { naam: model.name, taalmodel: model.isLanguageModel, instellingen: model.instellingen ? { ...model.instellingen } : null };
    trace.release = { versionId: release.versionId ?? null, generation: release.generation ?? null, promptSha256: release.promptSha256 ?? null, integrity: release.integrity };
    trace.actor = { rollen: [...input.actor.roles], niveau: String(basis.level), bevoegdheden: [...verzoek.capabilities], geschorst: verzoek.suspended };
    trace.toegestaneTools = verzoek.tools.filter((t) => t.allowed).map((t) => t.name);
    trace.invoer = { tekst: input.text, uiContext: momentopname(input.uiContext), context: momentopname(verzoek.context) };
  }

  // Vanaf hier is er iets te volgen. Het activiteitenpaneel leest mee, ook als
  // dit tabblad wordt gesloten: de stappen staan in de database.
  const activiteit = input.persist === false ? null : await startActivity({
    actor: input.actor,
    locationCode: resolved.locationCode,
    kind: "CHAT",
    title: input.text.length > 70 ? `${input.text.slice(0, 67)}…` : input.text,
    sessionId: input.sessionId ?? null,
    detail: basis.contextUsed,
  });
  const stap = async (kind: Parameters<typeof recordEvent>[0]["kind"], message: string, detail?: Record<string, unknown>) => {
    if (!activiteit) return;
    await recordEvent({ activity: activiteit, locationCode: resolved.locationCode, sessionId: input.sessionId ?? null, kind, message, detail });
  };

  await stap("VRAAG", input.text);

  /**
   * Wat de agent nooit doet, wordt hier geweigerd — vóór het model.
   *
   * Gevonden bij lokaal-4: op de vier veiligheidsvragen weigerde het lokale
   * model er twee, en antwoordde het op de andere twee dat het "niet kon
   * vaststellen" wat zijn bevoegdheden waren. Het platform deed niets
   * verkeerds — publiceren bestaat niet als tool — maar de gebruiker kreeg de
   * verkeerde reden te horen. Een weigering die afhangt van de welwillendheid
   * van een taalmodel is geen weigering.
   */
  const verboden = verbodenHandeling(input.text);
  if (trace) trace.platformWeigering = verboden ? verboden.uitleg : null;
  if (verboden) {
    if (trace) trace.eind = { status: "GEWEIGERD", intent: "GEWEIGERD", tekst: verboden.uitleg, bronnen: [], geheugenvoorstel: { uitPlan: false, naBewaking: false, inAntwoord: false } };
    await stap("WEIGERING", verboden.uitleg, { reden: "verboden handeling", model: model.name });
    if (activiteit) await finishActivity(activiteit, "DONE");
    await recordAudit({
      actor: input.actor,
      action: "agent.verzoek.geweigerd",
      objectType: "AgentSession",
      objectId: input.sessionId ?? null,
      result: "DENIED",
      reason: verboden.uitleg,
      newValue: { vraag: input.text },
    });
    return {
      ...basis,
      text: verboden.uitleg,
      data: null,
      sources: [],
      status: "GEWEIGERD",
      intent: "GEWEIGERD",
      // Zichtbaar in de meting: deze weigering komt van het platform en niet
      // van het model. Anders zou een benchmark een modelverdienste rapporteren
      // die het model niet heeft geleverd.
      reasoning: "geweigerd door het platform, vóór het model: dit raakt een handeling die niet bij de agent ligt",
      toolCalls: [],
    };
  }

  const modelPlan = await model.plan(verzoek);
  // Plancontrole (plan-guard.ts): een voorstel zonder rekenverzoek vervalt, en
  // een plan zonder tool terwijl het scherm de context kent, kijkt eerst.
  const bewaakt = bewaakPlan(
    modelPlan,
    input.text,
    { rosterCode: resolved.roster?.code ?? null, lineNumber: resolved.lineNumber ?? null },
    new Set(verzoek.tools.filter((t) => t.allowed).map((t) => t.name)),
  );
  const ruwPlan = bewaakt.plan;
  if (trace) trace.plan = { ...trace.plan, geparsed: momentopname(modelPlan), bewaking: bewaakt.stappen };
  // Laag 2 hoort in elk voorstel terecht te komen, ook als het model er niet om
  // vroeg: het zijn de doelen die de commissie voor dit project heeft gezet.
  // Het model bedenkt ze niet en kan ze ook niet wegnemen; ze worden hier
  // toegevoegd en in het antwoord genoemd.
  const plan = await metProjectdoelen(ruwPlan, resolved.locationCode);
  if (trace && trace.plan) trace.plan.definitief = momentopname(plan);
  await stap("PLAN", plan.reasoning || "geen toelichting", {
    intent: plan.intent,
    tools: plan.toolCalls.map((c) => c.tool),
    ...(bewaakt.correcties.length > 0 ? { planCorrecties: bewaakt.correcties, modelIntent: modelPlan.intent } : {}),
  });

  /**
   * De context van het scherm in elke toolaanroep.
   *
   * Gevonden bij de eerste lokale meting: het model riep `rosterLine` aan zonder
   * rooster of regel mee te geven, kreeg niets terug, en schreef vervolgens dat
   * de regel geen diensten bevat. Het scherm wist precies welk rooster open
   * stond; dat hoorde nooit van het model af te hangen. Wat het model zelf
   * invult, wint — het mag een ander rooster noemen dan de kiezer.
   */
  const gevuld = (o: Record<string, unknown>): [string, unknown][] =>
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "");

  const schermContext: Record<string, unknown> = {
    locationCode: resolved.locationCode,
    source: resolved.source,
    candidateId: resolved.candidate?.id,
    rosterCode: resolved.roster?.code,
    lineNumber: resolved.lineNumber,
    weekday: resolved.weekday,
    dutyCode: resolved.duty?.code,
  };

  const metContext = (invoer: Record<string, unknown>): Record<string, unknown> =>
    // Alleen wat het scherm werkelijk heeft: een lege waarde als `null` meesturen
    // zou een veld met een standaardwaarde juist laten mislukken.
    Object.fromEntries([...gevuld(schermContext), ...gevuld(invoer)]);

  const calls: ToolCall[] = [];
  const results: { tool: string; ok: boolean; data: unknown; sources: readonly string[]; error?: string; note?: string }[] = [];
  for (const toolStap of plan.toolCalls) {
    if (activiteit) await heartbeat(activiteit);
    const { result, call, error } = await callTool(input.actor, toolStap.tool, metContext(toolStap.input), input.toolFouten?.[toolStap.tool]);
    calls.push(call);
    results.push({ tool: toolStap.tool, ok: result !== null, data: result?.data ?? null, sources: result?.sources ?? [], error, note: call.note });
    trace?.tools.push({
      tool: toolStap.tool,
      invoer: momentopname(call.input),
      ok: call.ok,
      ms: call.ms,
      note: call.note ?? null,
      fout: error ?? null,
      gesimuleerd: Boolean(call.gesimuleerd),
      data: momentopname(result?.data ?? null),
      bronnen: [...(result?.sources ?? [])],
    });
    await stap(
      call.ok ? "TOOL" : "FOUT",
      call.ok ? `${toolStap.tool} geraadpleegd (${call.ms} ms)` : `${toolStap.tool} leverde niets op: ${call.note ?? error ?? "onbekend"}`,
      { sources: result?.sources ?? [] },
    );
  }

  const ruwAntwoord = await model.compose({ ...verzoek, plan, results });
  if (trace) {
    trace.compose = {
      pad: trace.composePad ?? (model.isLanguageModel ? "onbekend" : "stub"),
      status: ruwAntwoord.status,
      tekst: ruwAntwoord.text,
      dataSleutels: Object.keys((ruwAntwoord.data as Record<string, unknown> | null) ?? {}),
      bronnen: [...ruwAntwoord.sources],
    };
  }

  /**
   * De grondingscontrole staat hier, en niet in de modeladapter.
   *
   * Een volgend model — groter, kleiner, van een andere makelij — komt door
   * dezelfde poort. Wat een model belooft in zijn systeeminstructie is sturing;
   * dit is de grendel. Een geweigerd antwoord wordt met rust gelaten: daar
   * staan geen feiten in die gegrond hoeven te zijn.
   */
  // De schermcontext hoort bij de gegevens. Gevonden bij lokaal-3: een antwoord
  // dat keurig "DDR-L regel 4" noemde werd tegengehouden omdat dutyInstance de
  // roostercode niet teruggeeft. De kiezer wéét welk rooster open staat; dat is
  // geen bewering van het model maar een gegeven van het scherm.
  /**
   * Een feitelijke bewering zonder één geraadpleegde bron gaat niet door.
   *
   * Gevonden bij de doorloop van fase 9. Op de vraag of de nachten van DDR-MIX
   * beter geclusterd konden worden, riep het model géén tool aan en antwoordde
   * het dat dit rooster geen nachten heeft — een feit uit een eerdere beurt, over
   * een ánder rooster. Een minuut eerder had het over hetzelfde rooster nog twee
   * nachtblokken van vijf opgesomd.
   *
   * De grondingscontrole hieronder ving dat niet: die kijkt of genoemde
   * identificaties in de gegevens staan, en hier stond er niets in de gegevens om
   * mee te vergelijken. Precies daarom is dit een aparte controle: een antwoord
   * dat nergens op steunt, is erger dan een antwoord dat één ding te veel noemt.
   *
   * Een weigering, een wedervraag, een voorstel of een eerlijk "ik weet het niet"
   * heeft geen bron nodig — die beweren ook niets over het rooster.
   */
  const gelukt = results.filter((r) => r.ok);
  const zonderBron = ruwAntwoord.status === "BEANTWOORD" && gelukt.length === 0;
  if (zonderBron) {
    await stap("FOUT", "Antwoord tegengehouden: beantwoord zonder één geraadpleegde bron.", {
      tegengehoudenTekst: ruwAntwoord.text,
      intent: plan.intent,
    });
  }

  // Wat het platform het model zelf aanreikte (de begrippen uit het
  // domeinwoordenboek bij deze vraag) is geen verzinsel van het model: een
  // profielcode die het woordenboek noemde, mag het antwoord herhalen
  // (AFTER-run 20260929-234655: VROEG_LAAT werd als "verzonnen regel" tegengehouden,
  // terwijl de systeeminstructie hem zelf had genoemd).
  const platformContext = begrippenIn(input.text).map((b) => b.betekenis).join(" ");
  const nietsGevonden = calls.flatMap((c, i) => {
    const data = results[i]?.data as { hits?: unknown[] } | null;
    const zoekterm = (c.input as { query?: unknown } | undefined)?.query;
    return c.tool === "ruleSearch" && results[i]?.ok && Array.isArray(data?.hits) && data.hits.length === 0 && typeof zoekterm === "string"
      ? [{ waar: "het regelbestand", zoekterm }]
      : [];
  });

  const los =
    ruwAntwoord.status === "GEWEIGERD"
      ? []
      : ongegrondeVermeldingen(ruwAntwoord.text, `${gegevensTekst(results)}
${Object.values(schermContext).join(" ")}
${platformContext}`);
  const naGronding: typeof ruwAntwoord = zonderBron
    ? {
        ...ruwAntwoord,
        // Eerlijk over wát er misging: niets opgezocht, of wel opgezocht maar
        // niets bruikbaars teruggekregen (G-regel-vervolg, BEFORE-run
        // 20260927-205217: rosterLine faalde op de vervolgbeurt, en de melding
        // beweerde dat er niets was geraadpleegd).
        text:
          results.length === 0
            ? "Ik hield mijn eigen antwoord tegen: ik heb hier geen enkele bron voor geraadpleegd. " +
              "Wat ik dan opschrijf komt uit het gesprek of uit mijzelf, en niet uit de roostergegevens. " +
              "Stel de vraag opnieuw, dan zoek ik het op."
            : `Ik hield mijn eigen antwoord tegen: ik raadpleegde ${[...new Set(results.map((r) => r.tool))].join(", ")}, maar kreeg geen bruikbaar gegeven terug. ` +
              "Wat ik dan opschrijf komt niet uit de roostergegevens. " +
              "Noem het basisrooster en de regel of dag erbij, dan zoek ik het opnieuw op.",
        status: "NIET_VAST_TE_STELLEN",
      }
    : los.length === 0
      ? ruwAntwoord
      : { ...ruwAntwoord, text: grondingsMelding(los, { intent: plan.intent, nietsGevonden }), status: "NIET_VAST_TE_STELLEN" };
  if (los.length > 0) {
    // De oorspronkelijke tekst gaat niet verloren: hij hoort in het
    // activiteitenlog thuis, waar hij te onderzoeken is, en niet op het scherm,
    // waar hij als feit zou worden gelezen.
    await stap("FOUT", `Antwoord tegengehouden: ${los.map((o) => `${o.soort} ${o.waarde}`).join(", ")} staat niet in de gegevens.`, {
      ongegrond: los,
      tegengehoudenTekst: ruwAntwoord.text,
    });
  }

  /**
   * Een gezagsclaim ("bevestigd", "CAO-verplicht", "officieel") zonder een
   * daadwerkelijk `legalStatus: VALIDATED`-signaal in de gegevens van deze
   * beurt. Loopt pas hierna, ná grounding: alleen zinvol op tekst die nog
   * echt van het model komt (`naGronding.status === "BEANTWOORD"`) — een
   * antwoord dat grounding al verving door een eigen meta-melding bevat geen
   * inhoudelijke gezagsclaim meer om te controleren. Zie claim-verification.ts.
   */
  const ongedekteClaims = naGronding.status === "BEANTWOORD" ? ongedekteGezagsClaims(naGronding.text, results) : [];
  const naClaims: typeof ruwAntwoord =
    ongedekteClaims.length === 0 ? naGronding : { ...naGronding, text: claimVerificatieMelding(ongedekteClaims), status: "NIET_VAST_TE_STELLEN" };

  /**
   * Verzonnen afwezigheid en citaatverzoeken (bron-afwezigheid.ts). Het
   * platform ziet nooit een heel document, alleen gevonden regels; wat een
   * document níet bevat, kan het dus niet weten. En bij een vraag om de
   * letterlijke tekst hoort de gebruiker het als de bron alleen als scan
   * bestaat — ook als het model dat vergeet.
   */
  const uitlegVoor = (titel: string) => {
    const regel = activeRuleset().rules.find((r) => r.source.documentTitle === titel);
    return regel ? (bronTekst(regel.source.document)?.uitleg ?? null) : null;
  };
  const scanBronnen = nietCiteerbareBronnen(results, uitlegVoor);
  const afwezigheden = naClaims.status === "BEANTWOORD" ? verzonnenAfwezigheden(naClaims.text) : [];
  if (afwezigheden.length > 0) {
    await stap("FOUT", `Antwoord tegengehouden: verzonnen afwezigheid ("${afwezigheden[0].slice(0, 120)}").`, {
      afwezigheden,
      tegengehoudenTekst: naClaims.text,
    });
  }
  const naAfwezigheid: typeof ruwAntwoord =
    afwezigheden.length === 0 ? naClaims : { ...naClaims, text: afwezigheidsMelding(results, scanBronnen), status: "NIET_VAST_TE_STELLEN" };
  const voorbehoud = afwezigheden.length === 0 && vraagtOmCitaat(input.text) ? citaatVoorbehoud(scanBronnen) : null;
  const naVoorbehoud: typeof ruwAntwoord = voorbehoud ? { ...naAfwezigheid, text: `${naAfwezigheid.text}\n\n${voorbehoud}` } : naAfwezigheid;
  if (voorbehoud) await stap("STAP", "Bronstatus toegevoegd: citaatverzoek bij een document zonder machineleesbare tekst.", { bronnen: scanBronnen });

  /**
   * Het bereik van een kennisopzoeking (kennis-bereik.ts): wat de tool
   * aantoonbaar vaststelt over waar die kennis voor geldt, staat in het antwoord
   * ongeacht hoe het model het formuleerde. De modeluitvoer hing bij gelijke
   * invoer af van servertoestand (diagnose-20260930-m2); een bereikgrens mag
   * daar niet van afhangen. Niet bij een weigering, fout of voorstel.
   */
  const { antwoord, zinnen: bereikZinnen } = verankerKennisBereik(naVoorbehoud, input.text, results);
  if (bereikZinnen.length > 0) await stap("STAP", "Bereik van de kennisopzoeking toegevoegd.", { zinnen: bereikZinnen });
  if (ongedekteClaims.length > 0) {
    await stap("FOUT", `Antwoord tegengehouden: ongedekte gezagsclaim (${ongedekteClaims.map((c) => c.signaalwoord).join(", ")}).`, {
      ongedekteClaims,
      tegengehoudenTekst: naGronding.text,
    });
  }
  if (trace) {
    const poort = (naam: string, uitkomst: "PASS" | "BLOCK" | "APPEND" | "NVT", reden: string, bewijs: unknown, voor?: string, na?: string) =>
      trace.poorten.push({ naam, uitkomst, reden, bewijs: momentopname(bewijs), ...(voor !== undefined ? { tekstVoor: voor, tekstNa: na } : {}) });
    poort(
      "ZONDER_BRON",
      zonderBron ? "BLOCK" : ruwAntwoord.status === "BEANTWOORD" ? "PASS" : "NVT",
      zonderBron ? "beantwoord zonder één geslaagde tool" : ruwAntwoord.status === "BEANTWOORD" ? `${gelukt.length} geslaagde tool(s)` : `status ${ruwAntwoord.status}: geen bron vereist`,
      { geslaagd: gelukt.map((r) => r.tool) },
      ...(zonderBron ? [ruwAntwoord.text, naGronding.text] : []),
    );
    poort(
      "GRONDING",
      ruwAntwoord.status === "GEWEIGERD" ? "NVT" : los.length > 0 ? "BLOCK" : "PASS",
      ruwAntwoord.status === "GEWEIGERD" ? "weigering" : los.length > 0 ? "vermelding(en) niet in de gegevens" : "alle vermeldingen staan in de gegevens",
      los,
      ...(los.length > 0 && !zonderBron ? [ruwAntwoord.text, naGronding.text] : []),
    );
    poort(
      "CLAIMVERIFICATIE",
      naGronding.status !== "BEANTWOORD" ? "NVT" : ongedekteClaims.length > 0 ? "BLOCK" : "PASS",
      naGronding.status !== "BEANTWOORD" ? `status ${naGronding.status}` : ongedekteClaims.length > 0 ? "ongedekte gezagsclaim" : "geen ongedekte gezagsclaim",
      ongedekteClaims,
      ...(ongedekteClaims.length > 0 ? [naGronding.text, naClaims.text] : []),
    );
    poort(
      "AFWEZIGHEID",
      naClaims.status !== "BEANTWOORD" ? "NVT" : afwezigheden.length > 0 ? "BLOCK" : "PASS",
      naClaims.status !== "BEANTWOORD" ? `status ${naClaims.status}` : afwezigheden.length > 0 ? "verzonnen afwezigheid" : "geen verzonnen afwezigheid",
      afwezigheden,
      ...(afwezigheden.length > 0 ? [naClaims.text, naAfwezigheid.text] : []),
    );
    poort(
      "CITAATVOORBEHOUD",
      voorbehoud ? "APPEND" : "NVT",
      voorbehoud ? "citaatverzoek bij een bron zonder machineleesbare tekst" : vraagtOmCitaat(input.text) ? "citaatverzoek, maar geen scanbron of al tegengehouden" : "geen citaatverzoek",
      scanBronnen,
      ...(voorbehoud ? [naAfwezigheid.text, naVoorbehoud.text] : []),
    );
    poort(
      "KENNISBEREIK",
      bereikZinnen.length > 0 ? "APPEND" : "NVT",
      bereikZinnen.length > 0
        ? "bereik vastgesteld door knowledgeSearch en nodig voor deze vraag"
        : results.some((r) => r.tool === "knowledgeSearch" && r.ok)
          ? "kennisopzoeking, maar geen afwezigheid bij een kennisvraag en geen andere standplaats genoemd"
          : "geen geslaagde kennisopzoeking",
      bereikZinnen,
      ...(bereikZinnen.length > 0 ? [naVoorbehoud.text, antwoord.text] : []),
    );
    const dataUit = (antwoord.data as Record<string, unknown> | null) ?? {};
    trace.eind = {
      status: antwoord.status,
      intent: plan.intent,
      tekst: antwoord.text,
      bronnen: [...antwoord.sources],
      geheugenvoorstel: { uitPlan: Boolean(modelPlan.memoryProposal), naBewaking: Boolean(plan.memoryProposal), inAntwoord: "memoryProposal" in dataUit },
    };
  }
  const tegengehouden: AskResult["tegengehouden"] = afwezigheden.length > 0
    ? { grendel: "AFWEZIGHEID", tekst: naClaims.text, detail: afwezigheden }
    : ongedekteClaims.length > 0
    ? { grendel: "CLAIMVERIFICATIE", tekst: naGronding.text, detail: ongedekteClaims }
    : zonderBron
      ? { grendel: "ZONDER_BRON", tekst: ruwAntwoord.text, detail: { intent: plan.intent } }
      : los.length > 0
        ? { grendel: "GRONDING", tekst: ruwAntwoord.text, detail: los }
        : undefined;
  await stap(antwoord.status === "GEWEIGERD" ? "WEIGERING" : "ANTWOORD", antwoord.text.length > 200 ? `${antwoord.text.slice(0, 197)}…` : antwoord.text, {
    status: antwoord.status,
    sources: antwoord.sources,
  });
  if (activiteit) await finishActivity(activiteit, antwoord.status === "FOUT" ? "FAILED" : "DONE");

  if (input.persist !== false) {
    const sessionId = input.sessionId ?? (await maakSessie(input.actor, resolved.locationCode, input.text)).id;
    await prisma.agentMessage.createMany({
      data: [
        { sessionId, role: "USER", text: input.text, uiContext: basis.contextUsed as object },
        {
          sessionId,
          role: "AGENT",
          text: antwoord.text,
          uiContext: basis.contextUsed as object,
          toolCalls: calls as unknown as object,
          sources: antwoord.sources as unknown as object,
          model: model.name,
        },
      ],
    });
    await prisma.agentSession.update({ where: { id: sessionId }, data: { lastMessageAt: new Date() } });
    await recordAudit({
      actor: input.actor,
      action: "agent.vraag.beantwoord",
      objectType: "AgentSession",
      objectId: sessionId,
      newValue: { intent: plan.intent, status: antwoord.status, tools: calls.map((c) => c.tool), model: model.name },
    });
    return { ...basis, ...antwoord, sessionId, intent: plan.intent, reasoning: plan.reasoning, toolCalls: calls, ...(tegengehouden ? { tegengehouden } : {}), ...(bewaakt.correcties.length > 0 ? { planCorrecties: bewaakt.correcties } : {}) };
  }

  return { ...basis, ...antwoord, intent: plan.intent, reasoning: plan.reasoning, toolCalls: calls, ...(tegengehouden ? { tegengehouden } : {}), ...(bewaakt.correcties.length > 0 ? { planCorrecties: bewaakt.correcties } : {}) };
}

/**
 * De laag-2-doelen van dit project in het voorstel zetten.
 *
 * Ze komen erbij, ze vervangen niets, en ze staan in het voorstel zodat een
 * mens ziet waar zijn "ja" precies op slaat.
 */
async function metProjectdoelen(plan: AgentPlan, locationCode: string): Promise<AgentPlan> {
  if (!plan.proposal) return plan;
  const doelen = await projectGoals(locationCode);
  // Wat het leergeheugen bijdraagt: alleen goedgekeurde items met een doel dat
  // een mens eraan heeft gehangen. Een NS-breed voorstel dat nog niet is
  // goedgekeurd, komt hier niet uit.
  const uitGeheugen = await geldendeGeheugenDoelen(locationCode);
  if (doelen.length === 0 && uitGeheugen.length === 0) return plan;

  const bestaand = Array.isArray(plan.proposal.goals) ? (plan.proposal.goals as string[]) : [];
  const samen = [...new Set([...bestaand, ...doelen.map((d) => d.goal), ...uitGeheugen.map((g) => g.goal)])];
  const toelichting = [
    doelen.length > 0 ? `extra doelen van de commissie: ${doelen.map((d) => d.label).join(", ")}` : null,
    uitGeheugen.length > 0 ? `uit het leergeheugen: ${uitGeheugen.map((g) => g.goal).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");

  return {
    ...plan,
    proposal: {
      ...plan.proposal,
      goals: samen,
      layerTwoGoals: doelen.map((d) => ({ goal: d.goal, label: d.label, note: d.note })),
      // De herkomst gaat mee tot in de opdracht: bij het starten wordt
      // vastgelegd dat dit item een beslissing heeft geraakt.
      memoryGoals: uitGeheugen.map((g) => ({ itemId: g.itemId, goal: g.goal, scope: g.scope, statement: g.statement })),
      note: `${String(plan.proposal.note ?? "")} (${toelichting})`.trim(),
    },
    reasoning: `${plan.reasoning}; ${toelichting}`,
  };
}

async function maakSessie(actor: Actor, locationCode: string, eersteVraag: string) {
  const titel = eersteVraag.length > 60 ? `${eersteVraag.slice(0, 57)}…` : eersteVraag;
  return prisma.agentSession.create({ data: { locationCode, title: titel, createdByUserId: actor.userId } });
}
