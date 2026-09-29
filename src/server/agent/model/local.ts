import "server-only";
import { readFileSync } from "node:fs";
import { REBUILD_GOAL_LABELS } from "@/server/optimizer/objective-weights";
import { STRATEGIE_VOOR_DOEL, doelenLijst, isDoel, strategieLabel } from "../doelen";
import { beschrijfVoorstel } from "../voorstel-tekst";
import { begrippenIn } from "../vocabulary";
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
  /**
   * Alleen voor gecontroleerde experimenten (Demo Room): vervangt de
   * systeeminstructie door een sandboxvariant. Door Demo Room gezet voor een
   * benchmark-/experimentaanroep; nooit door `localConfigFromEnv()` zelf.
   */
  readonly systemPromptOverride?: (basis: string, request: PlanRequest) => string;
}

/**
 * De gepubliceerde productievariant, als die er is.
 *
 * ## Waarom een bestand, en geen omgevingsvariabele met de tekst zelf
 *
 * `NS_PRODUCTION_PROMPT_FILE` wijst naar een bestandspad; de INHOUD van dat
 * bestand wordt bij élke aanvraag opnieuw gelezen, niet één keer bij het
 * opstarten. Publiceren en terugdraaien (Demo Room, "safe publish") wordt
 * daarmee het schrijven van een bestand — geen herstart, geen deploy, geen
 * codewijziging. Ontbreekt het bestand, staat de variabele niet, of is het
 * bestand onleesbaar, dan geldt gewoon de standaardinstructie: er is hier
 * geen foutpad dat de agent kan laten uitvallen.
 *
 * Standaard staat `NS_PRODUCTION_PROMPT_FILE` nergens — dit is dus additief
 * en uit tenzij een mens (via Demo Room's publiceerknop, nooit automatisch)
 * het aanzet.
 */
function productionOverrideFromDisk(): ((basis: string, request: PlanRequest) => string) | undefined {
  const file = process.env.NS_PRODUCTION_PROMPT_FILE?.trim();
  if (!file) return undefined;
  let toevoeging: string;
  try {
    toevoeging = readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
  if (toevoeging.length === 0) return undefined;
  return (basis: string) => `${basis}\n\n${toevoeging}`;
}

export function localConfigFromEnv(): LocalModelConfig | null {
  const baseUrl = process.env.NS_LOCAL_LLM_URL?.trim();
  const model = process.env.NS_LOCAL_LLM_MODEL?.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    systemPromptOverride: productionOverrideFromDisk(),
    timeoutMs: Number(process.env.NS_LOCAL_LLM_TIMEOUT_MS ?? 120_000),
    // Nul, en dat is een keuze: dit model moet feiten weergeven en tools
    // kiezen, niet formuleren. Het stond op 0,2, en dat bleek duur bij het
    // meten: twee metingen van dezelfde code verschilden op zeven van de
    // 32 items. Dan meet je de dobbelsteen en niet de verbetering.
    temperature: Number(process.env.NS_LOCAL_LLM_TEMPERATURE ?? 0),
    // Ruim, en dat is geen luxe: qwen3 denkt hardop voordat het antwoordt, en
    // dat denken telt mee. Op 800 liep het plan van een rekenverzoek halverwege
    // de JSON leeg, en kwam er "het model leverde geen leesbaar plan" uit — wat
    // eruitziet als een model dat de instructie niet snapt, terwijl het gewoon
    // door zijn tokens heen was. Gevonden bij de doorloop van fase 9.
    maxTokens: Number(process.env.NS_LOCAL_LLM_MAX_TOKENS ?? 2000),
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
 * Het domeinwoordenboek, maar alleen de termen die in déze vraag voorkomen.
 *
 * ## Waarom dit bestond en toch niet werkte
 *
 * `vocabulary.ts` kent RET als rangeerdienst sinds de beslissing van 21
 * september 2026. De stub gebruikt dat woordenboek al die tijd al
 * (`begripIn()` in `model/stub.ts`). Het lokale model kreeg het nooit te zien
 * — geen enkele regel in deze systeeminstructie verwees ernaar. Bij de
 * N0-meting van v1.0.6 viel dat meteen op: alle zeven RET-vragen liepen via
 * `ruleSearch` met de letterlijke zoekterm "RET", vonden niets, en de agent
 * concludeerde eerlijk maar verkeerd dat het onbekend was.
 *
 * ## Waarom alleen de relevante termen, en niet het hele woordenboek
 *
 * Een systeeminstructie die bij elke vraag alle twaalf begrippen opsomt, kost
 * tokens die de plan-stap dan weer mist — en dat was precies de oorzaak van de
 * lege-JSON-fout uit v1.0.5. Alleen wat in de vraag zelf voorkomt hoeft
 * genoemd te worden.
 */
function domeinwoordenboek(tekst: string): string[] {
  const gevonden = begrippenIn(tekst);
  if (gevonden.length === 0) return [];
  return [
    "",
    "Begrippen in deze vraag:",
    ...gevonden.map((b) => {
      // Een begrip dat naar een dienstsoort verwijst, is meteen een kind-
      // waarde voor dutyKindCounts/dutyKindPerLine. Dat hardop zeggen scheelt
      // de stap waarin het model zelf moet bedenken dat "RET" en "RANGEER"
      // hetzelfde filter zijn.
      const toolHint = b.verwijst.soort === "DIENSTSOORT" ? ` Gebruik kind=${b.verwijst.kind} bij dutyKindCounts of dutyKindPerLine.` : "";
      return `- "${b.termen[0]}" = ${b.betekenis}${toolHint}`;
    }),
  ];
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
    // Mét wat elke tool verplicht nodig heeft. Zonder dat riep het model
    // dutyInstance aan zonder dienstnummer, kreeg "ongeldige invoer" terug en
    // concludeerde dat er geen dienst was.
    "Beschikbare tools:",
    ...tools.map((t) => {
      // Alleen wat dít scherm níet levert. Bij lokaal-5 stond de volledige lijst
      // erbij, inclusief velden die de server allang invult, en ging het model
      // ze zelf invullen — fout, en zijn waarde wint van die van de server.
      // A1 ging daardoor van goed naar "er staan geen diensten op deze regel".
      const zelf = t.requires.filter((veld) => !heeftContext(request, veld));
      return `- ${t.name}: ${t.description}` + (zelf.length > 0 ? ` Zelf invullen: ${zelf.join(", ")}.` : "");
    }),
    "",
    // Gevonden bij de eerste lokale meting: het model koos ruleSearch op een
    // vraag over de nachtstructuur. Een korte kaart van vraagsoort naar tool
    // kost weinig en scheelt een verkeerde bron. Sturing, geen grendel — welke
    // tools écht mogen, bepaalt de rechtencontrole hierboven.
    "Kies je tool bij de vraag:",
    "- wat staat er op deze regel / welke diensten op een dag → rosterLine",
    "- hoe laat begint of eindigt dienst X → dutyInstance",
    "- hoeveel nachten/vroege/late/rangeer-/reservediensten → dutyKindCounts MET kind erbij (VROEG, LAAT, NACHT, RANGEER of RESERVE). Zonder kind krijg je het totaal van alles door elkaar, en dat is bijna nooit het antwoord op de vraag.",
    "- op welke regels staan die diensten → dutyKindPerLine",
    "- uren, contractnorm, te veel of te weinig, of 'is dit rooster zwaarder/lichter dan de andere' → rosterHours; die geeft altijd alle basisroosters tegelijk terug, dus hij vergelijkt vanzelf",
    "- nachten en hun opeenvolging in een basisrooster → nightStructure",
    "- mag dit wel volgens de regels / hoeveel rust is verplicht → ruleSearch, of ruleLookup als je het regelnummer al weet",
    "- hoe goed is deze kandidaat → qualityReport",
    "- wat is hier eerder over afgesproken → knowledgeSearch",
    // Gevonden bij dezelfde meting: op "is dit een lekker vrij weekend?" en op
    // vage klachten ("deze regel loopt voor geen meter") riep het model soms
    // geen enkele tool aan en concludeerde dat er "geen tool" voor bestond, of
    // gaf meteen een oordeel. Er is geen aparte weekendtool nodig — het zit al
    // in de dagen van de regel — maar het model moet weten dat het die moet
    // opzoeken vóór het oordeelt.
    "- vraag over het weekend (vrijdag/zaterdag/zondag, 'lekker vrij') → rosterLine op de bekende regel, en kijk zelf naar vrijdag t/m zondag in het resultaat; er is geen aparte weekendtool",
    "- vage klacht zonder concrete vraag ('loopt voor geen meter', 'kut uit de nacht', 'wat heeft het brein gedaan') → eerst rosterLine (en zo nodig dutyKindCounts/nightStructure) op de bekende context, dan pas een bevinding melden. Nooit meteen oordelen zonder iets te hebben opgezocht, en nooit een regelnummer noemen dat je niet hebt gevonden.",
    "",
    "Wat het scherm levert, zet de server voor je in de toolaanroep; noem die velden niet zelf, want jouw waarde wint van die van de server. Staat er bij een tool \"Zelf invullen\", dan heeft hij dat écht van jou nodig — laat je het weg, dan draait de tool niet en krijg je niets terug. Vraagt de gebruiker om een ánder rooster of een andere regel, noem die dan wél zelf.",
    // Gevonden bij dezelfde meting: "en kandidaat 2?" leverde geen enkele
    // toolaanroep op — het model kent het echte database-ID van "kandidaat 2"
    // niet, en mag dat ook niet verzinnen. candidateLabel bestaat precies
    // hiervoor: de server zoekt de kandidaat erbij op.
    "Wil de gebruiker een ándere kandidaat dan waar nu naar gekeken wordt (\"en kandidaat 2?\", \"vergelijk met de derde\"), zet dan source=\"candidate\" en candidateLabel op wat de gebruiker zei (bijvoorbeeld \"kandidaat 2\") in de toolaanroep. Je hoeft het echte ID niet te kennen; de server zoekt het op. Vindt de server niets, dan hoor je dat terug via 'missing' in het toolresultaat.",
    "",
    `Context van het scherm: standplaats ${request.context.locationCode}, bron ${request.context.source}` +
      (request.context.rosterCode ? `, basisrooster ${request.context.rosterCode}` : "") +
      (request.context.lineNumber ? `, regel ${request.context.lineNumber}` : "") +
      (request.context.weekday ? `, weekdag ${request.context.weekday}` : "") +
      ".",
    request.context.missing.length > 0 ? `Nog niet ingevuld: ${request.context.missing.join(", ")}.` : "",
    ...domeinwoordenboek(request.text),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Levert de schermcontext dit veld al?
 *
 * Zo ja, dan hoeft het model het niet te noemen — en hoort het dat ook niet te
 * doen, want de server weet het beter dan het model het raadt.
 */
function heeftContext(request: PlanRequest, veld: string): boolean {
  const c = request.context as unknown as Record<string, unknown>;
  if (!(veld in c)) return false;
  const waarde = c[veld];
  return waarde !== null && waarde !== undefined && waarde !== "";
}

/** De planinstructie: welke tools, of doorvragen, of weigeren. Antwoord in JSON. */
/**
 * Geëxporteerd (was module-privé) zodat `tests/agent/model-local-pin.test.ts`
 * de huidige instructietekst rechtstreeks kan pinnen — puur leesbaar maken,
 * geen enkele gedragswijziging: de functie zelf is ongewijzigd.
 */
export function planInstructie(): string {
  return [
    "Bepaal wat er moet gebeuren en antwoord met uitsluitend JSON, zonder toelichting eromheen:",
    '{"intent":"ROOSTERVRAAG|REGELVRAAG|VERDELINGSVRAAG|UITLEGVRAAG|FEEDBACK|OPTIMALISATIEVERZOEK|VERDUIDELIJKING_NODIG|NIET_VAST_TE_STELLEN|GEWEIGERD",',
    ' "toolCalls":[{"tool":"naam","input":{}}],',
    ' "clarification":"vraag terug als de vraag niet scherp genoeg is, anders weglaten",',
    ' "cannotDetermine":"leg uit waarom dit niet uit de gegevens volgt, anders weglaten",',
    ' "refusal":"leg uit waarom dit niet mag, anders weglaten",',
    ' "reasoning":"één zin over wat je gaat doen"}',
    "Gebruik alleen tools uit de lijst. Bij twijfel over de bedoeling: doorvragen in plaats van gokken.",
    "",
    // Zonder dit blok kan een taalmodel geen opdracht voorstellen, en dan is
    // niveau B onbereikbaar zodra er een echt model onder hangt. Dat was zo tot
    // de doorloop van fase 9 het aan het licht bracht: elke test draaide op de
    // stub, en de stub kon het wél.
    "Vraagt iemand om te rékenen — laten uitrekenen, een nieuwe kandidaat, zoeken naar een betere verdeling — dan is dat geen toolvraag maar een voorstel. Zet er dan dit bij, naast of in plaats van toolCalls:",
    ' "proposal":{"kind":"GENERATE|REBUILD|RESEARCH","goals":["DOELCODE"],"searchMode":"FAST|NORMAL|DEEP|EXTENSIVE","note":"één zin over wat je gaat doen"}',
    `Toegestane doelcodes: ${doelenLijst()}.`,
    "REBUILD is een bestaande kandidaat verbeteren, GENERATE een nieuwe reeks, RESEARCH meerdere rondes achter elkaar.",
    "Noem alleen doelen uit die lijst. Past het gevraagde doel er niet bij, laat proposal dan weg en vraag door: de zoekmachine kan er niet op sturen.",
    "Je voert niets uit. Een mens bevestigt het voorstel, en de server controleert het daarna opnieuw tegen de bevoegdheden.",
    "",
    // Zonder dit blok herhaalt zich exact wat er bij proposal misging: het
    // model kan een voorkeur niet aanbieden om te onthouden zolang niets het
    // ooit heeft geleerd dat dat veld bestaat — gepind in
    // tests/knowledge/known-gaps-pin.test.ts totdat dit blok er stond.
    "Spreekt iemand een voorkeur uit over hoe hier gewerkt wordt — 'we willen liever', 'voortaan', 'we vinden', 'onthoud dat' — dan is dat geen vraag maar een gegeven. Bied dan aan het vast te leggen, naast of in plaats van toolCalls:",
    ' "memoryProposal":{"scope":"LOCATION","kind":"PREFERENCE","statement":"de voorkeur in eigen woorden, één zin"}',
    "scope is LOCATION tenzij iemand uitdrukkelijk een NS-breed besluit bedoelt (NATIONAL) of het uitsluitend dit roosterproject betreft (PROJECT). kind is meestal PREFERENCE; FACT voor een feit, DECISION voor een besluit van de commissie, LESSON voor een les uit een eerdere ronde.",
    "Je slaat nooit zelf iets op: een mens keurt dit voorstel later goed, net als bij proposal.",
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

  // Alle objecten op het buitenste niveau, elk op zichzelf gelezen.
  //
  // Gevonden bij de doorloop van fase 9: qwen3 leverde het plan in twee
  // objecten achter elkaar — het intentie-object en, na een komma, een object
  // met alleen `proposal`. Allebei geldig JSON. De oude lezing pakte alles van
  // de eerste accolade tot de laatste en probeerde dat als één object te
  // lezen; dat faalde, en de agent meldde "het model leverde geen leesbaar
  // plan". Het model had zich keurig uitgedrukt, ik las het verkeerd.
  const stukken: Record<string, unknown>[] = [];
  let diepte = 0;
  let begin = -1;
  let inTekst = false;
  let ontsnapt = false;
  for (let i = 0; i < zonderFence.length; i += 1) {
    const teken = zonderFence[i];
    if (inTekst) {
      if (ontsnapt) ontsnapt = false;
      else if (teken === "\\") ontsnapt = true;
      else if (teken === '"') inTekst = false;
      continue;
    }
    if (teken === '"') inTekst = true;
    else if (teken === "{") {
      if (diepte === 0) begin = i;
      diepte += 1;
    } else if (teken === "}") {
      diepte -= 1;
      if (diepte === 0 && begin >= 0) {
        try {
          const gelezen = JSON.parse(zonderFence.slice(begin, i + 1)) as unknown;
          if (typeof gelezen === "object" && gelezen !== null) stukken.push(gelezen as Record<string, unknown>);
        } catch {
          // Een stuk dat niet te lezen is, slaan we over; de rest kan nog kloppen.
        }
        begin = -1;
      }
    }
  }

  if (stukken.length === 0) return null;
  // Samenvoegen, waarbij een later stuk een leeg veld uit een eerder stuk niet
  // overschrijft: het tweede object vulde juist aan wat in het eerste ontbrak.
  const uit: Record<string, unknown> = {};
  for (const stuk of stukken) {
    for (const [sleutel, waarde] of Object.entries(stuk)) {
      if (waarde === null || waarde === undefined || waarde === "") continue;
      if (uit[sleutel] === undefined) uit[sleutel] = waarde;
    }
  }
  return uit;
}

/**
 * Zegt deze tekst zelf dat het antwoord niet vaststaat?
 *
 * Bewust een korte lijst van eenduidige formuleringen, en bewust alleen in deze
 * richting: een tekst die zegt het niet te weten mag nooit als beantwoord
 * binnenkomen. Andersom durven we niet — een tekst die stellig klinkt is daarmee
 * nog niet juist, en dat oordeel hoort bij de gegevens, niet bij de toon.
 */
export function zegtHetNietTeWeten(tekst: string): boolean {
  const t = tekst.toLowerCase();
  return [
    "kan ik niet vaststellen",
    "kan niet vastgesteld worden",
    "kan niet worden vastgesteld",
    "niet vast te stellen",
    "is niet bekend uit de gegevens",
    "staat niet in de gegevens",
    "geen gegevens over",
    "geen informatie beschikbaar",
  ].some((zin) => t.includes(zin));
}

/**
 * Een voorstel van het model omzetten naar een voorstel dat de server kent.
 *
 * Het model mag zeggen wát iemand wil: welk soort opdracht, welke doelen, hoe
 * lang. Het mag niet zeggen wélke strategie, welk roosterjaar of welke
 * kandidaat — dat zijn gegevens van het platform, en een model dat ze invult,
 * vult ze vroeg of laat verkeerd in. Alles wat hier niet herkend wordt, valt
 * weg; blijft er geen doel over, dan is er geen voorstel.
 *
 * Wat hier doorkomt is nog steeds maar een voorstel. `startProposedJob`
 * controleert het daarna opnieuw tegen de toekenning: de bevoegdheid, de
 * toegestane strategieën, het rekenbudget en de beschermde roosters.
 */
/**
 * Een voorstel dat het model in woorden gaf in plaats van in velden.
 *
 * Gevonden bij de doorloop van fase 9. Op "laat uitrekenen of de
 * rangeerdiensten eerlijker verdeeld kunnen worden" zette qwen3:8b de intentie
 * goed (OPTIMALISATIEVERZOEK) en schreef het in zijn toelichting letterlijk
 * "wat onder de doelcode SHUNTING_FAIRNESS valt" — maar het veld `proposal`
 * bleef leeg. Dan is er een voorstel bedacht en niet opgeschreven, en de
 * gebruiker krijgt niets.
 *
 * Dit is een toegift aan kleine modellen, en bewust een smalle: het doel moet
 * er letterlijk staan als geldige code, en de intentie moet al op een
 * rekenverzoek staan. Er wordt niets geraden — wat het model niet noemt, komt
 * er ook niet in.
 */
function uitDeToelichting(plan: Record<string, unknown>): Record<string, unknown> | undefined {
  if (String(plan.intent ?? "").toUpperCase() !== "OPTIMALISATIEVERZOEK") return undefined;
  const tekst = [plan.reasoning, plan.clarification, plan.cannotDetermine]
    .filter((x): x is string => typeof x === "string")
    .join(" ");
  const doelen = Object.keys(REBUILD_GOAL_LABELS).filter((code) => tekst.includes(code));
  if (doelen.length === 0) return undefined;
  return { kind: "GENERATE", goals: doelen, searchMode: "NORMAL", note: typeof plan.reasoning === "string" ? plan.reasoning : "" };
}
export function voorstelUit(ruw: unknown, request: PlanRequest): Record<string, unknown> | undefined {
  if (!ruw || typeof ruw !== "object") return undefined;
  const v = ruw as Record<string, unknown>;

  const soort = String(v.kind ?? "").toUpperCase();
  if (soort !== "GENERATE" && soort !== "REBUILD" && soort !== "RESEARCH") return undefined;

  const doelen = [...new Set((Array.isArray(v.goals) ? v.goals : []).filter(isDoel))];
  if (doelen.length === 0) return undefined;

  const modus = String(v.searchMode ?? "").toUpperCase();
  const searchMode = modus === "FAST" || modus === "NORMAL" || modus === "DEEP" || modus === "EXTENSIVE" ? modus : "NORMAL";

  const strategie = STRATEGIE_VOOR_DOEL[doelen[0]];
  const opKandidaat = request.context.source === "candidate" && Boolean(request.context.candidateId);

  // Twee correcties op wat het model voorstelt, allebei om te voorkomen dat er
  // iets wordt aangeboden dat daarna wordt geweigerd:
  //
  //   1. Een herbouw zonder kandidaat bestaat niet; dan is het een nieuwe reeks.
  //   2. Een onderzoekslus is niveau C. Stelt het model er een voor terwijl die
  //      bevoegdheid uitstaat, dan zou de gebruiker pas ná het bevestigen te
  //      horen krijgen dat het niet mag. De stub doet dit al zo; bij de doorloop
  //      stelde het lokale model een RESEARCH voor op niveau B.
  const magRondes = request.capabilities.includes("agent:autonomous");
  const gevraagd = soort === "REBUILD" && !opKandidaat ? "GENERATE" : soort;
  const kind = gevraagd === "RESEARCH" && !magRondes ? (opKandidaat ? "REBUILD" : "GENERATE") : gevraagd;

  return {
    kind,
    strategy: strategie,
    strategyLabel: strategieLabel(strategie),
    // Het roosterjaar komt van het platform en niet uit een zin.
    rosterYear: new Date().getFullYear() + 1,
    searchMode,
    goals: doelen,
    parentCandidateId: kind === "REBUILD" ? (request.context.candidateId ?? null) : null,
    note: typeof v.note === "string" && v.note.trim().length > 1 ? v.note.trim().slice(0, 400) : `gericht op ${doelen.join(", ")}`,
    locationCode: request.context.locationCode,
  };
}

const MEMORY_SCOPES = new Set(["PROJECT", "LOCATION", "NATIONAL"]);
const MEMORY_KINDS = new Set(["PREFERENCE", "FACT", "DECISION", "LESSON"]);

/**
 * Zelfde soort validatie als voorstelUit() hierboven, voor het andere voorstel
 * dat een taalmodel kan doen: iets vastleggen in het leergeheugen. `locationCode`
 * komt net als bij voorstelUit() altijd van het platform, nooit van het model —
 * en dit voorstel wordt sowieso pas iets ná een menselijke goedkeuring (zie
 * memoryProposal in model/types.ts).
 */
export function memoryProposalUit(ruw: unknown, request: PlanRequest): Record<string, unknown> | undefined {
  if (!request.capabilities.includes("agent:memory:write")) return undefined;
  if (!ruw || typeof ruw !== "object") return undefined;
  const v = ruw as Record<string, unknown>;

  const statement = typeof v.statement === "string" ? v.statement.trim() : "";
  if (statement.length === 0) return undefined;

  const scope = typeof v.scope === "string" && MEMORY_SCOPES.has(v.scope.toUpperCase()) ? v.scope.toUpperCase() : "LOCATION";
  const kind = typeof v.kind === "string" && MEMORY_KINDS.has(v.kind.toUpperCase()) ? v.kind.toUpperCase() : "PREFERENCE";

  return {
    scope,
    kind,
    statement: statement.slice(0, 400),
    locationCode: request.context.locationCode,
  };
}

function instructieVoor(config: LocalModelConfig, request: PlanRequest): string {
  const basis = systeeminstructie(request);
  return config.systemPromptOverride ? config.systemPromptOverride(basis, request) : basis;
}

export function localModel(config: LocalModelConfig): ChatModel {
  return {
    name: config.systemPromptOverride ? `lokaal:${config.model}:variant` : `lokaal:${config.model}`,
    isLanguageModel: true,

    async plan(request: PlanRequest): Promise<AgentPlan> {
      const antwoord = await chat(config, [
        { role: "system", content: instructieVoor(config, request) },
        ...request.history.map((h) => ({ role: h.role === "USER" ? ("user" as const) : ("assistant" as const), content: h.text })),
        { role: "user", content: `${request.text}\n\n${planInstructie()}` },
      ]);

      // Met NS_LOCAL_LLM_DEBUG=1 komt het ruwe antwoord in de serverlog. Zonder
      // dat is "het model leverde geen leesbaar plan" een doodlopend spoor: je
      // ziet dát het misging en nooit waaróm.
      if (process.env.NS_LOCAL_LLM_DEBUG === "1") {
        console.log("[lokaal model] ruw plan:", antwoord.slice(0, 1500));
      }

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
        proposal: voorstelUit(plan.proposal ?? uitDeToelichting(plan), request),
        memoryProposal: memoryProposalUit(plan.memoryProposal, request),
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

      // Een voorstel is geen tekst die het model nog moet schrijven: het staat
      // al vast in het plan, en het scherm hangt er een bevestigingsknop aan.
      // Zonder deze tak plande het model netjes een opdracht die daarna in de
      // antwoordstap werd weggegooid — en dan is niveau B onbereikbaar zodra er
      // een echt model onder hangt.
      if (request.plan.proposal) {
        return {
          text: beschrijfVoorstel(request.plan.proposal),
          data: { proposal: request.plan.proposal },
          sources: bronnen,
          status: "VOORSTEL",
        };
      }
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
        { role: "system", content: instructieVoor(config, request) },
        {
          role: "user",
          content: [
            `Vraag van de gebruiker: ${request.text}`,
            "",
            feiten || "Er zijn geen toolresultaten.",
            "",
            "Gebruik uitsluitend de bovenstaande gegevens. Staat er iets niet in, zeg dan dat je het niet kunt vaststellen.",
            // "Regel" is in het Nederlands óók een roosterregel. De oude zin ("Noem bij
            // een regel altijd de bron en of die bevestigd is") liet het model onder
            // elke roostertelling "De bron is officieel en bevestigd." zetten — een
            // gezagswoord zonder regel erachter (AFTER-run 20260929-151948, zie
            // claim-verification.ts). Regelstatus hoort alleen bij het regelbestand.
            "Noem bij een regel uit het regelbestand (ruleLookup of ruleSearch) altijd de bron en de status precies zoals de tool die geeft.",
            "Roostergegevens (tellingen, roosterregels, diensten) zijn geen regels: noem daar alleen of ze uit het officiële rooster of uit een kandidaat komen, zonder woorden als 'bevestigd'. Noem bij een dienst de weekdag.",
            "Schrijf het antwoord in het Nederlands, in hooguit vijf zinnen.",
            request.plan.cannotDetermine ? `Verwerk ook dit: ${request.plan.cannotDetermine}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ]);

      // Geprobeerd en teruggedraaid: dit antwoord als JSON laten leveren, met de
      // status erin. Bij lokaal-5 kostte dat meer dan het opleverde — één vraag
      // kwam helemaal leeg terug (het model raakte door zijn tokens heen vóór
      // het einde van de JSON) en de geheugenantwoorden verloren hun herkomst
      // en status omdat er geen ruimte meer was. Eén criterium won, drie
      // verloren. Het blijft dus platte tekst.
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
        // Het plan wint: wat vooraf is vastgesteld, staat vast. Zegt de tekst
        // zelf dat iets niet vaststaat, dan volgt de status dat — een scherm dat
        // "beantwoord" meldt boven een tekst die zegt van niet, liegt.
        status: request.plan.cannotDetermine
          ? "NIET_VAST_TE_STELLEN"
          : request.plan.clarification
            ? "VERDUIDELIJKING"
            : zegtHetNietTeWeten(tekst)
              ? "NIET_VAST_TE_STELLEN"
              : "BEANTWOORD",
      };
    },
  };
}
