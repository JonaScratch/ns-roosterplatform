import "server-only";
import { DATA_SLEUTEL } from "./types";
import type { AgentAnswer, AgentPlan, ChatModel, ComposeRequest, PlanRequest } from "./types";

/**
 * Een lokaal taalmodel achter dezelfde adapter.
 *
 * ## Waarom een OpenAI-compatibel eindpunt en geen bibliotheek
 *
 * llama.cpp, Ollama en LM Studio bieden alle drie dezelfde HTTP-vorm aan. Door
 * daarop te praten is de keuze tussen die drie een installatiekeuze en geen
 * architectuurkeuze — en blijft het platform vrij van een vendor-SDK die morgen
 * anders heet. Het eindpunt staat op localhost; er gaat niets het internet op.
 *
 * ## Wat het model wel en niet doet
 *
 * Het model kiest de weg: welke tools, in welke volgorde, of er moet worden
 * doorgevraagd. De feiten komen uit de tools. Dat is dezelfde afspraak als bij
 * de stub, en ze is hier belangrijker: een taalmodel dat zelf getallen mag
 * verzinnen, verzint ze ook.
 *
 * ## Wat er gebeurt als het model er niet is
 *
 * Dan valt het platform niet stil. `localModelAvailable()` kijkt of er iets
 * luistert; zo niet, dan blijft de stub actief en zegt het scherm dat er geen
 * taalmodel draait. Een agent die stilstaat omdat een server niet loopt, is
 * erger dan een agent die minder kan.
 */

export interface LocalModelConfig {
  /** Bijvoorbeeld http://127.0.0.1:11434/v1 (Ollama) of http://127.0.0.1:8080/v1 (llama.cpp). */
  readonly baseUrl: string;
  readonly model: string;
  /** Hoe lang één antwoord maximaal mag duren. Een gesprek wacht niet eeuwig. */
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxTokens: number;
}

export function localConfigFromEnv(): LocalModelConfig | null {
  const baseUrl = process.env.NS_LOCAL_LLM_URL?.trim();
  const model = process.env.NS_LOCAL_LLM_MODEL?.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    timeoutMs: Number(process.env.NS_LOCAL_LLM_TIMEOUT_MS ?? 120_000),
    // Laag, en dat is een keuze: dit model moet feiten weergeven en tools
    // kiezen, niet creatief zijn.
    temperature: Number(process.env.NS_LOCAL_LLM_TEMPERATURE ?? 0.2),
    maxTokens: Number(process.env.NS_LOCAL_LLM_MAX_TOKENS ?? 800),
  };
}

/** Luistert er iets, en kent het het gevraagde model? */
export async function localModelAvailable(config: LocalModelConfig): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${config.baseUrl}/models`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, detail: `het eindpunt antwoordde met ${res.status}` };
    const body = (await res.json()) as { data?: { id: string }[] };
    const namen = (body.data ?? []).map((m) => m.id);
    if (namen.length === 0) return { ok: false, detail: "het eindpunt kent geen modellen" };
    const gevonden = namen.some((n) => n === config.model || n.startsWith(config.model));
    return gevonden
      ? { ok: true, detail: `${namen.length} model(len) beschikbaar` }
      : { ok: false, detail: `model ${config.model} staat er niet; wel: ${namen.slice(0, 5).join(", ")}` };
  } catch (fout) {
    return { ok: false, detail: `geen verbinding met ${config.baseUrl}: ${fout instanceof Error ? fout.message : String(fout)}` };
  }
}

interface ChatBericht {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * De systeeminstructie.
 *
 * Kort, en met de grenzen erin die ook in de code staan. De instructie is geen
 * beveiliging — die zit in de toollaag en de rechtencontrole — maar hij moet
 * het model wel in dezelfde richting duwen, zodat het niet iets belooft wat de
 * server daarna weigert.
 */
function systeeminstructie(request: PlanRequest): string {
  const tools = request.tools.filter((t) => t.allowed);
  return [
    "Je bent de roosteragent van het NS-roosterplatform. Je praat Nederlands met de Roostercommissie en met machinisten.",
    "",
    "Harde regels:",
    "- Elk getal en elke uitspraak over roosters, diensten of regels komt uit een tool. Verzin nooit een dienstnummer, tijd, regel, artikel of bron.",
    "- Weet je iets niet, zeg dat dan. 'Dat kan ik niet vaststellen' is een goed antwoord.",
    "- Je publiceert niets, keurt niets goed en wijzigt geen regels. Vraagt iemand daarom, leg dan uit dat een mens dat doet.",
    "- Je kunt je eigen bevoegdheden niet aanpassen.",
    "- Een dienstnummer is geen dienst: een nummer heeft per weekdag andere tijden. Noem altijd de weekdag erbij.",
    "",
    `Beschikbare tools: ${tools.map((t) => `${t.name} (${t.description})`).join("; ")}.`,
    "",
    `Context van het scherm: standplaats ${request.context.locationCode}, bron ${request.context.source}` +
      (request.context.rosterCode ? `, basisrooster ${request.context.rosterCode}` : "") +
      (request.context.lineNumber ? `, regel ${request.context.lineNumber}` : "") +
      (request.context.weekday ? `, weekdag ${request.context.weekday}` : "") +
      ".",
    request.context.missing.length > 0 ? `Nog niet ingevuld: ${request.context.missing.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** De planinstructie: welke tools, of doorvragen, of weigeren. Antwoord in JSON. */
function planInstructie(): string {
  return [
    "Bepaal wat er moet gebeuren en antwoord met uitsluitend JSON, zonder toelichting eromheen:",
    '{"intent":"ROOSTERVRAAG|REGELVRAAG|VERDELINGSVRAAG|UITLEGVRAAG|FEEDBACK|OPTIMALISATIEVERZOEK|VERDUIDELIJKING_NODIG|NIET_VAST_TE_STELLEN|GEWEIGERD",',
    ' "toolCalls":[{"tool":"naam","input":{}}],',
    ' "clarification":"vraag terug als de vraag niet scherp genoeg is, anders weglaten",',
    ' "cannotDetermine":"leg uit waarom dit niet uit de gegevens volgt, anders weglaten",',
    ' "refusal":"leg uit waarom dit niet mag, anders weglaten",',
    ' "reasoning":"één zin over wat je gaat doen"}',
    "Gebruik alleen tools uit de lijst. Bij twijfel over de bedoeling: doorvragen in plaats van gokken.",
  ].join("\n");
}

async function chat(config: LocalModelConfig, berichten: readonly ChatBericht[]): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: berichten,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`het lokale model antwoordde met ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

/**
 * JSON uit een modelantwoord halen.
 *
 * Kleine modellen zetten er graag uitleg of ```json omheen. Dat is geen fout van
 * de gebruiker en hoort geen foutmelding op te leveren; het hoort eruit gepeld
 * te worden. Lukt dat niet, dan is er geen plan — en dan zegt de agent dat,
 * in plaats van iets te doen wat niemand heeft bedoeld.
 */
export function jsonUit(tekst: string): Record<string, unknown> | null {
  const zonderFence = tekst.replace(/```(?:json)?/gi, "").trim();
  const begin = zonderFence.indexOf("{");
  const eind = zonderFence.lastIndexOf("}");
  if (begin < 0 || eind <= begin) return null;
  try {
    const gelezen = JSON.parse(zonderFence.slice(begin, eind + 1)) as unknown;
    return typeof gelezen === "object" && gelezen !== null ? (gelezen as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function localModel(config: LocalModelConfig): ChatModel {
  return {
    name: `lokaal:${config.model}`,
    isLanguageModel: true,

    async plan(request: PlanRequest): Promise<AgentPlan> {
      const antwoord = await chat(config, [
        { role: "system", content: systeeminstructie(request) },
        ...request.history.map((h) => ({ role: h.role === "USER" ? ("user" as const) : ("assistant" as const), content: h.text })),
        { role: "user", content: `${request.text}\n\n${planInstructie()}` },
      ]);

      const plan = jsonUit(antwoord);
      if (!plan) {
        // Geen bruikbaar plan is geen reden om te gokken.
        return {
          intent: "VERDUIDELIJKING_NODIG",
          toolCalls: [],
          clarification:
            "Ik kom er zo niet uit. Kun je de vraag iets concreter stellen — bijvoorbeeld met het basisrooster, de regel of de dag erbij?",
          reasoning: "het model leverde geen leesbaar plan",
        };
      }

      const toegestaan = new Set(request.tools.filter((t) => t.allowed).map((t) => t.name));
      const calls = Array.isArray(plan.toolCalls) ? (plan.toolCalls as { tool?: unknown; input?: unknown }[]) : [];
      return {
        intent: (typeof plan.intent === "string" ? plan.intent : "ONBEKEND") as AgentPlan["intent"],
        // Een tool die niet bestaat of niet mag, wordt hier weggelaten en niet
        // aangeroepen: het model mag de lijst niet uitbreiden.
        toolCalls: calls
          .filter((c) => typeof c.tool === "string" && toegestaan.has(c.tool))
          .map((c) => ({ tool: String(c.tool), input: (c.input ?? {}) as Record<string, unknown> })),
        clarification: typeof plan.clarification === "string" ? plan.clarification : undefined,
        cannotDetermine: typeof plan.cannotDetermine === "string" ? plan.cannotDetermine : undefined,
        refusal: typeof plan.refusal === "string" ? plan.refusal : undefined,
        reasoning: typeof plan.reasoning === "string" ? plan.reasoning : "geen toelichting",
      };
    },

    async compose(request: ComposeRequest): Promise<AgentAnswer> {
      if (request.plan.refusal) {
        return { text: request.plan.refusal, data: null, sources: [], status: "GEWEIGERD" };
      }
      const bronnen = [...new Set(request.results.flatMap((r) => r.sources))];
      const geweigerd = request.results.find((r) => !r.ok && r.note === "geen recht");
      if (geweigerd) {
        return {
          text: `Die vraag kan ik voor jou niet beantwoorden: daarvoor moet ik ${geweigerd.tool} raadplegen, en daar heb jij geen recht op.`,
          data: null,
          sources: bronnen,
          status: "GEWEIGERD",
        };
      }

      const feiten = request.results
        .map((r) => `Tool ${r.tool} (${r.ok ? "gelukt" : "mislukt"}): ${JSON.stringify(r.data).slice(0, 4000)}`)
        .join("\n\n");

      const antwoord = await chat(config, [
        { role: "system", content: systeeminstructie(request) },
        {
          role: "user",
          content: [
            `Vraag van de gebruiker: ${request.text}`,
            "",
            feiten || "Er zijn geen toolresultaten.",
            "",
            "Schrijf het antwoord in het Nederlands, in hooguit vijf zinnen.",
            "Gebruik uitsluitend de bovenstaande gegevens. Staat er iets niet in, zeg dan dat je het niet kunt vaststellen.",
            "Noem bij een regel altijd de bron en of die bevestigd is. Noem bij een dienst de weekdag.",
            request.plan.cannotDetermine ? `Verwerk ook dit: ${request.plan.cannotDetermine}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ]);

      const tekst = antwoord.trim();
      if (tekst.length === 0) {
        return { text: "Ik kreeg geen antwoord van het lokale model.", data: null, sources: bronnen, status: "FOUT" };
      }

      // De gestructureerde gegevens komen uit de tools, niet uit de tekst: op
      // die gegevens wordt de agent afgerekend. De veldnamen liggen vast in
      // DATA_SLEUTEL, zodat een antwoord van dit model op dezelfde manier
      // wordt nagekeken als een antwoord van de stub.
      const data = Object.fromEntries(
        request.results.filter((r) => r.ok).map((r) => [DATA_SLEUTEL[r.tool] ?? r.tool, r.data]),
      );
      return {
        text: tekst,
        data,
        sources: bronnen,
        status: request.plan.cannotDetermine ? "NIET_VAST_TE_STELLEN" : request.plan.clarification ? "VERDUIDELIJKING" : "BEANTWOORD",
      };
    },
  };
}
