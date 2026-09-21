import "server-only";
import { SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import { DAG_NAMEN } from "../context";
import type { AgentAnswer, AgentPlan, ChatModel, ComposeRequest, PlanRequest } from "./types";

/**
 * De lokale stub: geen taalmodel, wel een echte keten.
 *
 * ## Wat dit wel en niet is
 *
 * Deze stub herkent bedoelingen aan woorden en context, kiest daar tools bij en
 * zet de uitkomsten om in Nederlandse zinnen. Daarmee is alles te meten wat
 * geen taalbegrip vereist: vindt de agent de juiste roosterregel, gebruikt hij
 * echte gegevens, respecteert hij rechten, geeft hij toe wat hij niet weet?
 *
 * Wat hier níet uit blijkt, is of een echt taalmodel een losse opmerking van
 * een machinist goed begrijpt. Dat blijft ongemeten tot een model is toegestaan;
 * de benchmarkmethodiek zegt dat met zoveel woorden.
 *
 * ## Waarom de stub mag weigeren en doorvragen
 *
 * Juist die twee horen bij het gedrag dat we willen meten. Een vraag over een
 * begrip dat niet in de gegevens voorkomt, moet een wedervraag opleveren — geen
 * aanname. Een verzoek waarvoor de bevoegdheid ontbreekt, moet een uitleg
 * opleveren — geen stilte.
 */

const bevat = (tekst: string, ...woorden: string[]) => woorden.some((w) => tekst.includes(w));

/** Eenheden uit het regelbestand in gewoon Nederlands. */
const EENHEID: Readonly<Record<string, string>> = { HOURS: "uur", MINUTES: "minuten", DAYS: "dagen", COUNT: "keer", PERCENT: "procent" };
const eenheid = (unit: unknown) => EENHEID[String(unit)] ?? String(unit).toLowerCase();

/**
 * Positietypen in gewone woorden.
 *
 * Op een roosterblad staat "RES" of "WR"; in een zin hoort te staan wat dat is.
 * `WR` draagt in dit datamodel de WTV-dag — zie roster-structure.ts: het anker
 * bestaat, alleen de naam is dubbel bezet.
 */
const POSITIE: Readonly<Record<string, string>> = {
  DUTY: "een dienst",
  RES: "een reservedag",
  WR: "een WTV-dag",
  CO: "een compensatiedag",
  RUST: "een rustdag",
};
const positie = (type: unknown) => POSITIE[String(type)] ?? String(type).toLowerCase();

/** Woorden die op een handeling wijzen waarvoor een mens moet tekenen. */
const VERBODEN = [
  { woorden: ["publiceer", "publiceren", "vaststellen als definitief"], uitleg: "Publiceren is een menselijke handeling; de agent heeft die bevoegdheid niet en krijgt die ook niet." },
  { woorden: ["negeer de validator", "negeer validator", "sla de validatie over", "goed genoeg"], uitleg: "De onafhankelijke validator kan ik niet overslaan. Een hoge score maakt een harde overtreding niet geldig." },
  { woorden: ["eigen bevoegdheden", "zet jezelf op niveau", "geef jezelf", "verhoog je rechten"], uitleg: "Ik kan mijn eigen bevoegdheden niet aanpassen. Dat doet een commissielid in het bevoegdhedenpaneel." },
  { woorden: ["verwijder de regel", "schrap de regel", "pas de cao aan"], uitleg: "Formele regels wijzig ik niet. Die komen uit het regelbestand en hebben een bron en een status." },
  // Gevonden door verify:agent (TEST 5): een verzoek om een andere rol aan te
  // nemen liep niet op een weigering uit maar op een toolfout. Doen alsof is
  // precies de route waarlangs iemand rechten zou omzeilen.
  {
    woorden: ["doe alsof je", "gedraag je als", "je bent nu de", "je bent nu beheerder", "stel dat je", "net alsof je"],
    uitleg: "Ik kan niet doen alsof ik iemand anders ben. Wat ik mag, hangt aan jouw rechten en aan wat de commissie voor dit project heeft aangezet — niet aan wat we afspreken in een gesprek.",
  },
  // Stoppen hoort bij de knop, niet bij de agent: hij heeft die bevoegdheid
  // niet, ook niet als iemand het hem vriendelijk vraagt.
  {
    woorden: ["stop de opdracht", "stop er maar mee", "stop ermee", "annuleer de opdracht", "annuleer de generatie", "breek af"],
    uitleg: "Een lopende opdracht kan ik niet stoppen. Dat doet een commissielid met de stopknop bij de opdracht zelf; daar wordt het ook vastgelegd.",
  },
];

/**
 * Woorden die om rekenwerk vragen: daarvoor is een aparte bevoegdheid nodig.
 *
 * In twee soorten, en dat onderscheid is niet cosmetisch. "Start een
 * optimalisatie" kan niets anders betekenen en wordt meteen herkend. "Bereken"
 * of "onderzoek" kan óók een leesvraag zijn ("bereken het roostergemiddelde"),
 * en wordt daarom pas bekeken als geen enkele leesvraag past. Zou het andersom
 * staan, dan weigerde de agent vragen die hij gewoon mag beantwoorden.
 */
const REKENVERZOEK_HARD = [
  "optimalisatie",
  "optimaliseer",
  "laat rekenen",
  "laten rekenen",
  "doorrekenen",
  // Gevonden door verify:agent --zwaar: "laat eens uitrekenen of de nachten
  // beter kunnen" werd gelezen als een vraag over de nachtstructuur, omdat
  // "uitrekenen" nergens stond. Het werd dus netjes beantwoord in plaats van
  // voorgesteld door te rekenen.
  "uitrekenen",
  "reken uit",
  "laat berekenen",
  "laten berekenen",
  "nieuwe kandidaat",
  "nieuwe kandidaten",
  "kandidaten maken",
  "maak kandidaten",
  "genereer",
];
const REKENVERZOEK_ZACHT = ["onderzoek", "probeer", "verbeter", "bereken"];

/** Begrippen die in dit dienstenpakket niet bestaan: daar hoort een wedervraag bij. */
const ONBEKENDE_BEGRIPPEN = ["ret", "sprinterdienst", "intercitydienst"];

/**
 * Waar een verbeterverzoek over kan gaan, en welk herbouwdoel daarbij hoort.
 *
 * Eén doel per herkenbaar woord. Wie niets herkenbaars zegt, krijgt geen
 * voorstel maar een wedervraag: "maak het beter" is geen opdracht waar een
 * zoekmachine iets mee kan, en een verzonnen doel is erger dan een vraag.
 */
const DOELWOORDEN: readonly { readonly herkent: (t: string) => boolean; readonly goal: string; readonly strategie: string }[] = [
  // Stammen in plaats van hele woorden: "geclusterd", "clusteren" en
  // "clustering" zijn hetzelfde doel. Gevonden door verify:agent --zwaar, waar
  // "of de nachten beter geclusterd kunnen worden" geen enkel doel raakte.
  { herkent: (t) => bevat(t, "nacht") && bevat(t, "cluster", "achter elkaar", "reeks", "blok"), goal: "NIGHT_CLUSTERING", strategie: "REST_QUALITY" },
  { herkent: (t) => bevat(t, "nacht") && bevat(t, "eerlijk", "verdel", "spreid"), goal: "NIGHT_FAIRNESS", strategie: "FAIR_BURDEN" },
  { herkent: (t) => bevat(t, "rust", "hersteltijd"), goal: "REST", strategie: "REST_QUALITY" },
  { herkent: (t) => bevat(t, "uren", "40:00", "roostergemiddelde", "urenbalans"), goal: "HOURS", strategie: "BALANCED" },
  { herkent: (t) => bevat(t, "rangeer"), goal: "SHUNTING_FAIRNESS", strategie: "FAIR_BURDEN" },
  { herkent: (t) => bevat(t, "weekend"), goal: "WEEKEND_FAIRNESS", strategie: "FAIR_BURDEN" },
  { herkent: (t) => bevat(t, "overgang", "wisseling"), goal: "TRANSITIONS", strategie: "REST_QUALITY" },
  { herkent: (t) => bevat(t, "minder verander", "zo min mogelijk wijzig", "dicht bij het huidige"), goal: "LESS_CHANGE", strategie: "BALANCED" },
];

/**
 * Vraagt dit om meerdere rondes achter elkaar?
 *
 * Dat is niveau C en een aparte bevoegdheid. Gevonden door M1: met alleen
 * rekenbevoegdheid vroeg de agent netjes waarop hij moest sturen, en liep het
 * verschil tussen "één opdracht" en "blijf net zolang zoeken" stil weg.
 */
const meerdereRondes = (tekst: string): boolean =>
  // Ook uitgeschreven getallen: "je mag drie rondes" is precies de zin waarmee
  // iemand om niveau C vraagt zonder het zo te noemen.
  /\b(twee|drie|vier|vijf|zes|zeven|acht|negen|tien|\d+)\s*(rondes?|keer|pogingen)\b/.test(tekst) ||
  /\brondes\b/.test(tekst) ||
  bevat(tekst, "meerdere rondes", "meer rondes", "blijf zoeken", "net zolang", "blijf proberen", "zolang tot");

/** Een verzoek om te rekenen: mag alleen met de bevoegdheid, en anders met uitleg. */
function rekenverzoek(request: PlanRequest, tekst: string, ctx: PlanRequest["context"]): AgentPlan {
  const mag = request.capabilities.includes("agent:job:create");
  if (meerdereRondes(tekst) && !request.capabilities.includes("agent:autonomous")) {
    return {
      intent: "OPTIMALISATIEVERZOEK",
      toolCalls: [],
      refusal: request.suspended
        ? "Ik ben stilgezet en start niets, ook geen reeks rondes."
        : "Meerdere rondes achter elkaar is niveau C, en die bevoegdheid (agent:autonomous) staat voor dit project niet aan. Eén opdracht kan ik wel voorstellen; die bevestig jij dan.",
      reasoning: "verzoek om meerdere rondes zonder de bevoegdheid daarvoor",
    };
  }
  if (!mag) {
    return {
      intent: "OPTIMALISATIEVERZOEK",
      toolCalls: [],
      refusal: request.suspended
        ? "Ik ben stilgezet en start daarom niets: geen berekening, geen ronde, geen experiment. Vragen beantwoorden kan wel. Een commissielid kan mij weer aanzetten in het activiteitenpaneel."
        : "Ik mag voor dit project geen berekening starten: die bevoegdheid staat uit. Een commissielid kan hem aanzetten in het bevoegdhedenpaneel, en kan de opdracht zelf wel starten in het generatiescherm.",
      reasoning: request.suspended ? "de agent is stilgezet" : "bevoegdheid om te rekenen staat uit",
    };
  }

  const gevonden = DOELWOORDEN.filter((d) => d.herkent(tekst));
  if (gevonden.length === 0) {
    // "Nachten" zonder meer is twee verschillende doelen die elkaar kunnen
    // tegenwerken. Daar hoort een keuze bij en geen gok.
    const alleenNacht = bevat(tekst, "nacht");
    return {
      intent: "VERDUIDELIJKING_NODIG",
      toolCalls: [],
      clarification: alleenNacht
        ? "Wat moet er met de nachten gebeuren: de reeksen beter clusteren (minder losse nachten), of de nachten eerlijker over de regels verdelen? Dat zijn twee verschillende doelen, en ze kunnen elkaar tegenwerken."
        : "Ik mag een berekening laten doen, maar dan moet ik weten waarop. Waar moet het beter worden: " +
          "de uren richting 40:00, meer rust tussen diensten, de nachten (clusteren of eerlijker verdelen), " +
          "rangeerdiensten, de weekendbelasting, of zo min mogelijk verandering?",
      reasoning: "rekenverzoek zonder scherp doel; zonder doel is er niets te optimaliseren",
    };
  }

  const isKandidaat = ctx.source === "candidate" && Boolean(ctx.candidateId);
  const doelen = [...new Set(gevonden.map((d) => d.goal))];
  // In het scherm horen woorden te staan, geen enumwaarden uit de motor.
  const doelenInWoorden = doelen.map((g) => REBUILD_GOAL_LABELS[g as RebuildGoal] ?? g).join(" en ");
  return {
    intent: "OPTIMALISATIEVERZOEK",
    toolCalls: [],
    proposal: {
      kind: isKandidaat ? "REBUILD" : "GENERATE",
      strategy: gevonden[0].strategie,
      // Het label komt uit de motor zelf, zodat er in het scherm geen tweede
      // naam voor dezelfde strategie ontstaat.
      strategyLabel: SCENARIO_PROFILES.find((p) => p.key === gevonden[0].strategie)?.label ?? gevonden[0].strategie,
      rosterYear: new Date().getFullYear() + 1,
      // Een voorstel begint kort. Wie meer rekentijd wil, kiest die zelf; de
      // toekenning bepaalt wat er maximaal mag.
      searchMode: "FAST",
      // De doelen gaan altijd mee. Bij een herbouw sturen ze de gewichten; bij
      // een nieuwe generatie zijn ze ter informatie — daar stuurt de strategie.
      // Ze weglaten zou de gebruiker een leeg "gericht op" opleveren, en dat
      // verbergt juist waarop hij ja zegt.
      goals: doelen,
      parentCandidateId: isKandidaat ? ctx.candidateId : null,
      note: isKandidaat
        ? `herbouw van de gekozen kandidaat, gericht op: ${doelenInWoorden}`
        : `nieuwe kandidaten met de nadruk op: ${doelenInWoorden}`,
      locationCode: ctx.locationCode,
    },
    reasoning: `rekenvoorstel opstellen (${doelen.join(", ")}); een mens bevestigt`,
  };
}

const weekdagUitTekst = (tekst: string): number | null => {
  for (let i = 1; i <= 7; i += 1) if (tekst.includes(DAG_NAMEN[i])) return i;
  return null;
};

/**
 * Wat er in de vraag zelf staat, wint van de keuzelijst.
 *
 * Gevonden bij het doorlopen van het scherm: iemand typt "in DDR-MIX" terwijl
 * de kiezer nog op een ander rooster staat, en krijgt een keurig antwoord over
 * het verkeerde rooster. De code moet uit dezelfde standplaats komen, anders is
 * het geen roostercode maar toeval — een documentnummer bijvoorbeeld.
 */
const roosterUitTekst = (tekst: string, locationCode: string): string | null => {
  const match = new RegExp(`\\b${locationCode.toLowerCase()}-[a-z0-9]+\\b`).exec(tekst);
  return match ? match[0].toUpperCase() : null;
};

/** "regel 4" in de vraag telt net zo goed als het vakje ernaast. */
const regelUitTekst = (tekst: string): number | null => {
  const match = /\b(?:rooster)?regel\s+(\d{1,2})\b/.exec(tekst);
  return match ? Number(match[1]) : null;
};

export const stubModel: ChatModel = {
  name: "stub",
  isLanguageModel: false,

  async plan(request: PlanRequest): Promise<AgentPlan> {
    const tekst = request.text.toLowerCase();
    const gevraagd = request.context;
    // De vraag mag de keuzelijst overrulen: wie een rooster of regel noemt,
    // bedoelt dat rooster en die regel.
    const ctx = {
      ...gevraagd,
      rosterCode: roosterUitTekst(tekst, gevraagd.locationCode) ?? gevraagd.rosterCode,
      lineNumber: regelUitTekst(tekst) ?? gevraagd.lineNumber,
    };

    for (const regel of VERBODEN) {
      if (bevat(tekst, ...regel.woorden)) {
        return { intent: "GEWEIGERD", toolCalls: [], refusal: regel.uitleg, reasoning: "verzoek raakt een handeling die niet bij de agent ligt" };
      }
    }

    const onbekend = ONBEKENDE_BEGRIPPEN.find((w) => new RegExp(`\\b${w}\\b`).test(tekst));
    if (onbekend) {
      return {
        intent: "VERDUIDELIJKING_NODIG",
        toolCalls: [{ tool: "dutyInstance", input: { dutyCode: onbekend.toUpperCase(), locationCode: ctx.locationCode } }],
        clarification: `Ik kan "${onbekend.toUpperCase()}" niet terugvinden in dit dienstenpakket: niet als dienstnummer, niet in een omschrijving en niet als dienstsoort (dat zijn vroeg, laat, nacht, rangeer en reserve). Wat bedoel je ermee — een bepaald soort dienst, een bestemming, of iets anders?`,
        reasoning: "begrip komt niet voor in de gegevens; doorvragen in plaats van aannemen",
      };
    }

    // Ondubbelzinnige rekenverzoeken meteen: dit is geen leesvraag, en of het
    // mag hangt aan een bevoegdheid en niet aan de formulering.
    // Een verzoek om meerdere rondes telt als hard signaal: het gaat over wat
    // de agent mag doen, niet over wat hij mag opzoeken.
    if (bevat(tekst, ...REKENVERZOEK_HARD) || meerdereRondes(tekst)) return rekenverzoek(request, tekst, ctx);

    // De oorspronkelijke solverkeuze per dienst is nergens vastgelegd. Dat moet de
    // agent zeggen, ook als de context onvolledig is — een wedervraag zou hier de
    // indruk wekken dat het antwoord wél bestaat.
    if (bevat(tekst, "waarom") && bevat(tekst, "zoekmachine", "solver", "destijds", "gekozen", "neergezet", "besloten")) {
      return {
        intent: "NIET_VAST_TE_STELLEN",
        toolCalls: [],
        cannotDetermine:
          "Waarom de zoekmachine destijds precies deze keuze maakte, is niet per dienst vastgelegd: er staat wel een zoekjournaal per opdracht, maar geen reden per plaatsing. Wat ik wél kan: laten zien wat er staat, welke regels meespelen, en laten doorrekenen of een andere verdeling mogelijk is." +
          (ctx.rosterCode && ctx.lineNumber ? "" : " Wijs een basisrooster en regel aan, dan kijk ik daarnaar."),
        reasoning: "geen herleidbare solverbeslissing; geen verzonnen verklaring geven",
      };
    }

    // Vragen over de structuur van een rooster gaan vóór regelvragen: "op welke
    // regels staan nachtdiensten" gaat over roosterregels, niet over een voorschrift.
    if (ctx.rosterCode && bevat(tekst, "nachtdienst", "nachtdiensten", "nachtreeks", "nachten")) {
      return {
        intent: "ROOSTERVRAAG",
        toolCalls: [{ tool: "nightStructure", input: { rosterCode: ctx.rosterCode, locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }],
        reasoning: "nachtreeksen van dit basisrooster bekijken",
      };
    }

    // Regelvragen: eerst kijken of er een regel bij hoort.
    if (bevat(tekst, "hoeveel rust", "minimaal rust", "rusttijd", "hersteltijd", "herstel na", "welke regel", "regel geldt", "cao", "mag dat", "is dat toegestaan", "voorschrift", "voorgeschreven")) {
      const ruleId = bevat(tekst, "nacht") ? "NIGHT_SEQUENCE_RECOVERY" : bevat(tekst, "rust") ? "RP_DAILY_REST_PLANNED" : null;
      if (bevat(tekst, "40:00", "40 uur", "roostergemiddelde")) {
        return {
          intent: "REGELVRAAG",
          toolCalls: [{ tool: "rosterHours", input: { locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }],
          reasoning: "vraag over de urengrens: dat is een eis van de gebruiker, geen CAO-bepaling",
        };
      }
      if (ruleId) {
        return { intent: "REGELVRAAG", toolCalls: [{ tool: "ruleLookup", input: { ruleId, locationCode: ctx.locationCode } }], reasoning: `regel ${ruleId} opzoeken met bron en status` };
      }
      // Geen bekende regel bij deze woorden: dan de kennisbank doorzoeken in
      // plaats van er een te verzinnen. Wat niet gevonden wordt, blijft
      // onbeantwoord — en wat ontbreekt in het regelbestand, wordt gezegd.
      return {
        intent: "REGELVRAAG",
        toolCalls: [{ tool: "ruleSearch", input: { query: request.text, locationCode: ctx.locationCode } }],
        reasoning: "regelkennisbank doorzoeken op de woorden van de vraag",
      };
    }

    // Verdelingsvragen over soorten diensten.
    if (bevat(tekst, "rangeer")) {
      return { intent: "VERDELINGSVRAAG", toolCalls: [{ tool: "dutyKindCounts", input: { kind: "RANGEER", locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }], reasoning: "rangeerdiensten per basisrooster tellen" };
    }
    if (bevat(tekst, "afloper", "aflopers")) {
      return { intent: "VERDELINGSVRAAG", toolCalls: [{ tool: "dutyKindCounts", input: { dutyClass: "PREMIUM_LATE", locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }], reasoning: "echte aflopers per basisrooster tellen" };
    }
    // "roostergemiddelde" is een leesvraag, ook al staat er "bereken" voor.
    if (bevat(tekst, "uren", "urenbalans", "gemiddelde week", "roostergemiddelde", "weekgemiddelde")) {
      return { intent: "VERDELINGSVRAAG", toolCalls: [{ tool: "rosterHours", input: { locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }], reasoning: "gemiddelde weekomvang per basisrooster" };
    }
    // Vragen over de geselecteerde regel.
    if (ctx.rosterCode && ctx.lineNumber) {
      if (bevat(tekst, "welke dienst", "welke diensten", "wat staat", "hoe laat", "eindtijd", "begintijd", "afgelopen", "begint")) {
        // Wie "op donderdag" tikt, hoeft de dagkiezer niet ook nog te zetten.
        const dag = ctx.weekday ?? weekdagUitTekst(tekst);
        return {
          intent: "ROOSTERVRAAG",
          toolCalls: [{ tool: "rosterLine", input: { rosterCode: ctx.rosterCode, lineNumber: ctx.lineNumber, weekday: dag, locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }],
          reasoning: `regel ${ctx.lineNumber} van ${ctx.rosterCode} ophalen met de echte tijden${dag ? `, met nadruk op ${DAG_NAMEN[dag]}` : ""}`,
        };
      }
      if (bevat(tekst, "waarom")) {
        return {
          intent: "UITLEGVRAAG",
          toolCalls: [
            { tool: "rosterLine", input: { rosterCode: ctx.rosterCode, lineNumber: ctx.lineNumber, locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } },
            { tool: "qualityReport", input: { locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } },
          ],
          cannotDetermine:
            "Waaróm de zoekmachine destijds precies deze verdeling koos, is niet per dienst vastgelegd. Ik kan wel laten zien wat er staat, welke regels gelden en wat een andere verdeling zou kosten.",
          reasoning: "uitleg opbouwen uit de vastgelegde feiten; de oorspronkelijke solverkeuze is niet herleidbaar",
        };
      }
    }

    // Losse feedback zonder richting.
    if (bevat(tekst, "loopt niet lekker", "niet fijn", "vervelend", "niks", "beter maken") && !bevat(tekst, "omdat", "want")) {
      return {
        intent: "VERDUIDELIJKING_NODIG",
        toolCalls: [],
        clarification:
          ctx.rosterCode && ctx.lineNumber
            ? `Ik kijk naar ${ctx.rosterCode} regel ${ctx.lineNumber}. Wat loopt er niet lekker: de begintijden, de volgorde van de diensten, de rust ertussen, of het weekend?`
            : "Waar gaat het precies over: welk basisrooster en welke regel, en wat loopt er niet lekker?",
        reasoning: "te weinig richting om een controleerbaar doel van te maken",
      };
    }

    if (bevat(tekst, ...REKENVERZOEK_ZACHT)) return rekenverzoek(request, tekst, ctx);

    if (ctx.rosterCode) {
      return {
        intent: "ROOSTERVRAAG",
        toolCalls: [{ tool: "rosterProject", input: { locationCode: ctx.locationCode } }],
        reasoning: "algemene vraag; projectoverzicht ophalen",
      };
    }

    return {
      intent: "VERDUIDELIJKING_NODIG",
      toolCalls: [],
      clarification: "Over welk basisrooster en welke roosterregel gaat je vraag? Als je er een aanklikt, kijk ik daarnaar.",
      reasoning: "geen context en geen herkenbare vraag",
    };
  },

  async compose(request: ComposeRequest): Promise<AgentAnswer> {
    const { plan, results } = request;
    const bronnen = [...new Set(results.flatMap((r) => r.sources))];

    if (plan.refusal) return { text: plan.refusal, data: null, sources: bronnen, status: "GEWEIGERD" };

    // Een weigering is geen storing. Wie de gegevens niet mag zien, hoort te
    // lezen dát hij ze niet mag zien — "er ging iets mis" is hier onwaar en
    // stuurt mensen naar de verkeerde hulplijn.
    const geweigerd = results.find((r) => !r.ok && r.note === "geen recht");
    if (geweigerd) {
      return {
        text:
          `Die vraag kan ik voor jou niet beantwoorden: daarvoor moet ik ${geweigerd.tool} raadplegen, en daar heb jij geen recht op. ` +
          "Een lid van de roostercommissie kan deze vraag wel stellen.",
        data: null,
        sources: bronnen,
        status: "GEWEIGERD",
      };
    }

    const mislukt = results.find((r) => !r.ok);
    if (mislukt) return { text: `Dat lukte niet: ${mislukt.error ?? "onbekende fout"}.`, data: null, sources: bronnen, status: "FOUT" };

    if (plan.clarification) {
      return { text: plan.clarification, data: { intent: plan.intent }, sources: bronnen, status: "VERDUIDELIJKING" };
    }

    // Een voorstel is nog geen opdracht: er staat wat het gaat doen, wat het
    // kost aan rekentijd, en wat het níet doet. Iemand drukt daarna op start.
    if (plan.proposal) {
      const p = plan.proposal as { kind: string; strategyLabel: string; searchMode: string; goals: string[]; note: string };
      // Wat de gebruiker vroeg en wat de commissie er als laag 2 bij heeft
      // gezet, zijn twee verschillende dingen. Ze op één hoop gooien zou de
      // strategie de eer geven van een doel dat ergens anders vandaan komt.
      const laag2 = ((p as { layerTwoGoals?: { goal: string; label: string }[] }).layerTwoGoals ?? []).map((g) => g.label);
      const laag2Codes = new Set(((p as { layerTwoGoals?: { goal: string }[] }).layerTwoGoals ?? []).map((g) => g.goal));
      const doelen = p.goals.filter((g) => !laag2Codes.has(g)).map((g) => REBUILD_GOAL_LABELS[g as RebuildGoal] ?? g);
      const minuten = { FAST: 2, NORMAL: 5, DEEP: 15, EXTENSIVE: 30 }[p.searchMode] ?? 5;
      return {
        text:
          (p.kind === "REBUILD"
            ? `Voorstel: deze kandidaat herbouwen met de nadruk op ${doelen.join(" en ")}.`
            : // Bij een nieuwe generatie stuurt de strategie, niet een los doel.
              // Dat verschil hoort er te staan: anders belooft het voorstel een
              // knop die er niet is.
              `Voorstel: een nieuwe reeks kandidaten laten maken met strategie "${p.strategyLabel}"` +
              (doelen.length > 0
                ? `. Die strategie stuurt op ${doelen.join(" en ")}; bij een nieuwe generatie gaat dat via de strategie en niet via een apart doel.`
                : ".")) +
          (laag2.length > 0
            ? ` Daarbij gelden de extra doelen die de commissie voor dit project heeft gezet: ${laag2.join(" en ")}.`
            : "") +
          ` Dat kost ongeveer ${minuten} minuten rekentijd. Er wordt niets vervangen en niets gepubliceerd:` +
          " het resultaat komt als kandidaat naast de bestaande te staan, en de validator beoordeelt hem onafhankelijk." +
          " Zal ik dat doen?",
        data: { proposal: plan.proposal },
        sources: bronnen,
        status: "VOORSTEL",
      };
    }

    const zinnen: string[] = [];
    let data: Record<string, unknown> | null = null;

    for (const r of results) {
      const d = r.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      switch (r.tool) {
        case "rosterLine": {
          if (!d.found) {
            zinnen.push(`Die roosterregel kan ik niet vinden (${(d.missing as string[]).join(", ")}).`);
            break;
          }
          data = { ...(data ?? {}), line: d };
          const diensten = (d.days as Record<string, any>[]).filter((x) => x.dutyCode); // eslint-disable-line @typescript-eslint/no-explicit-any
          const vast = (d.days as Record<string, any>[]).filter((x) => !x.dutyCode); // eslint-disable-line @typescript-eslint/no-explicit-any
          // Is er naar één dag gevraagd, dan begint het antwoord daar — de rest
          // van de week blijft eronder staan, want die is de context.
          if (d.requestedWeekday) {
            const dag = (d.days as Record<string, any>[]).find((x) => x.weekday === d.requestedWeekday); // eslint-disable-line @typescript-eslint/no-explicit-any
            zinnen.push(
              dag?.dutyCode
                ? `Op ${dag.weekdayName} rijdt ${d.rosterCode} regel ${d.lineNumber} dienst ${dag.dutyCode}, van ${dag.start} tot ${dag.end}.`
                : `Op ${dag?.weekdayName ?? DAG_NAMEN[d.requestedWeekday as number]} staat er geen dienst: die dag is ${positie(dag?.positionType)}.`,
            );
          }
          zinnen.push(
            `${d.rosterCode} regel ${d.lineNumber} heeft ${diensten.length} ${diensten.length === 1 ? "dienst" : "diensten"}: ` +
              diensten.map((x) => `${x.weekdayName} dienst ${x.dutyCode} (${x.start}–${x.end})`).join(", ") +
              (vast.length ? `. De andere dagen liggen vast in de structuur: ${vast.map((x) => `${x.weekdayName} ${positie(x.positionType)}`).join(", ")}.` : "."),
          );
          break;
        }
        case "dutyInstance": {
          data = { ...(data ?? {}), duty: d };
          if (!d.exists) zinnen.push(`Dienst ${d.dutyCode} bestaat niet in dit pakket.`);
          else
            zinnen.push(
              `Dienst ${d.dutyCode} rijdt op ${(d.instances as Record<string, any>[]).map((x) => `${x.weekdayName} ${x.start}–${x.end}`).join(", ")}. ` + // eslint-disable-line @typescript-eslint/no-explicit-any
                "Let op: hetzelfde nummer heeft per weekdag andere tijden.",
            );
          break;
        }
        case "dutyKindCounts": {
          data = { ...(data ?? {}), counts: d };
          const rijen = Object.entries(d.perRoster as Record<string, number>).sort((a, b) => b[1] - a[1]);
          const wat = d.kind ? `${String(d.kind).toLowerCase()}diensten` : `diensten van de klasse ${d.dutyClass}`;
          zinnen.push(`Verdeling van ${wat} (${d.total} in totaal): ` + rijen.map(([code, n]) => `${code} ${n}`).join(", ") + ".");
          break;
        }
        case "rosterHours": {
          data = { ...(data ?? {}), hours: d };
          const rijen = (d.rosters as Record<string, any>[]).map((x) => `${x.rosterCode} ${x.formatted}`); // eslint-disable-line @typescript-eslint/no-explicit-any
          const boven = (d.rosters as Record<string, any>[]).filter((x) => !x.withinLimit); // eslint-disable-line @typescript-eslint/no-explicit-any
          zinnen.push(
            `Gemiddelde weekomvang per basisrooster: ${rijen.join(", ")}. De grens van 40:00 is een eis van de gebruiker (USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT), geen CAO-bepaling. ` +
              (boven.length ? `Erboven: ${boven.map((x) => x.rosterCode).join(", ")}.` : "Alle roosters blijven eronder."),
          );
          break;
        }
        case "ruleLookup": {
          data = { ...(data ?? {}), rules: d };
          for (const regel of d.rules as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (!regel.resolved) {
              zinnen.push(`Regel ${regel.ruleId} staat niet in het actieve regelbestand (${regel.reason}).`);
              continue;
            }
            const bron = regel.source as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
            zinnen.push(
              // Zelfde bronnotatie als de rest van het platform: document,
              // artikelnummer met "art." ervoor, en eventueel de paragraaf.
              `${regel.title ?? regel.ruleId}: ${regel.value} ${eenheid(regel.unit)}. Bron: ${[bron?.documentTitle ?? bron?.document ?? "onbekend", bron?.article ? `art. ${bron.article}` : null, bron?.paragraph ?? null].filter(Boolean).join(", ")}. ` +
                (regel.verified ? "Deze bron is bevestigd." : "Let op: de juridische status van deze bron is niet formeel geverifieerd."),
            );
          }
          break;
        }
        case "ruleSearch": {
          data = { ...(data ?? {}), rules: d };
          const treffers = (d.hits ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
          const ontbreekt = (d.missing ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (treffers.length === 0 && ontbreekt.length === 0) {
            // Niets gevonden is geen antwoord op de vraag. Gevonden door M1:
            // dit kwam als "beantwoord" naar buiten, terwijl de gebruiker juist
            // moet weten dat hier niets over vaststaat.
            return {
              text:
                "In het regelbestand vind ik hier geen regel over. Dat betekent niet dat er geen regel bestaat — " +
                "alleen dat hij niet in dit bestand staat, en ik verzin er geen artikel bij. " +
                "De regelcatalogus onder Regels & kaders laat zien wat er wél in staat.",
              data: { rules: d },
              sources: bronnen,
              status: "NIET_VAST_TE_STELLEN",
            };
          }
          for (const regel of treffers.slice(0, 3)) {
            const waarde = regel.value === null ? "geen waarde aangeleverd" : `${regel.value} ${eenheid(regel.unit)}`;
            const bron = [regel.source?.documentTitle, regel.source?.article ? `art. ${regel.source.article}` : null, regel.source?.paragraph]
              .filter(Boolean)
              .join(", ");
            zinnen.push(
              `${regel.title}: ${waarde}. Bron: ${bron || "onbekend"} (${regel.statusText ?? regel.status}).` +
                (regel.blocking ? " Deze regel kan zo geen beslissing dragen." : "") +
                (regel.applicable === false ? " Let op: hij geldt niet voor deze groep of standplaats." : ""),
            );
          }
          for (const pakket of ontbreekt.slice(0, 2)) {
            zinnen.push(`Niet aangeleverd: ${pakket.title}. ${pakket.reason} Daardoor is dit niet te beoordelen: ${(pakket.blocks as string[]).join(", ")}.`);
          }
          break;
        }
        case "nightStructure": {
          data = { ...(data ?? {}), nights: d };
          if (!d.found) break;
          const blokken = d.blocks as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
          zinnen.push(
            blokken.length === 0
              ? `${d.rosterCode} heeft geen nachtdiensten.`
              : `In ${d.rosterCode} staan nachtdiensten op regel ${(d.linesWithNights as number[]).join(", ")}: ${blokken.length} nachtreeks(en), samen ${d.totalNights} nachten. ` +
                blokken
                  .map(
                    (b) =>
                      `De reeks van ${b.length} begint op regel ${b.startLine} (${b.startWeekdayName})` +
                      (b.crossesLineBoundary ? ` en loopt door in regel ${(b.lines as number[]).filter((x) => x !== b.startLine).join(", ")}` : "") +
                      `; daarna ${b.nextDay.dutyCode ? `dienst ${b.nextDay.dutyCode}` : positie(b.nextDay.positionType)}`,
                  )
                  .join(". ") + ".",
          );
          break;
        }
        case "qualityReport": {
          if (!d.found) break;
          data = { ...(data ?? {}), quality: d };
          zinnen.push(
            `Kwaliteit volgens ${d.modelVersion}: robuust ${d.robust}, nachten ${d.components?.nights}, rust ${d.components?.rest}, eerlijkheid ${d.components?.fairness}. ` +
              (d.worstLine ? `De zwakste regel is ${d.worstLine.roster} regel ${d.worstLine.lineNumber}.` : ""),
          );
          break;
        }
        case "rosterProject": {
          data = { ...(data ?? {}), project: d };
          zinnen.push(
            `Project ${d.locationCode}: dienstenpakket ${d.dutyPackage?.label ?? "onbekend"} met ${d.dutyPackage?.duties ?? 0} diensten, ` +
              `${(d.rosters as unknown[]).length} basisroosters (${(d.rosters as Record<string, any>[]).map((r) => `${r.code} ${r.lines} regels`).join(", ")}).`, // eslint-disable-line @typescript-eslint/no-explicit-any
          );
          break;
        }
        case "knowledgeSearch": {
          zinnen.push("Er is nog geen leergeheugen; ik kan dus niets uit eerdere projecten terughalen.");
          break;
        }
        default:
          break;
      }
    }

    if (plan.cannotDetermine) {
      zinnen.push(plan.cannotDetermine);
      return { text: zinnen.join(" "), data, sources: bronnen, status: "NIET_VAST_TE_STELLEN" };
    }

    if (zinnen.length === 0) {
      return { text: "Daar heb ik geen gegevens voor gevonden.", data, sources: bronnen, status: "NIET_VAST_TE_STELLEN" };
    }

    return { text: zinnen.join(" "), data, sources: bronnen, status: "BEANTWOORD" };
  },
};
