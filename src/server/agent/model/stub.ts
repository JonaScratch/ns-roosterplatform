import "server-only";
import { SCENARIO_PROFILES } from "@/server/optimizer/cpsat-optimizer";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import { DAG_NAMEN } from "../context";
import { bevat, verbodenHandeling } from "../refusals";
import { begripIn } from "../vocabulary";
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

/**
 * Begrippen die in dit dienstenpakket niet bestaan: daar hoort een wedervraag bij.
 *
 * "ret" stond hier tot 21 september 2026 ook tussen. Dat was juist zolang
 * niemand wist wat het betekende; nu staat het in het domeinwoordenboek
 * (rangeerdienst, opgegeven door de gebruiker) en wordt de vraag beantwoord in
 * plaats van teruggekaatst.
 */
const ONBEKENDE_BEGRIPPEN = ["sprinterdienst", "intercitydienst"];

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
  const magRondes = request.capabilities.includes("agent:autonomous");

  // Met de autonome bevoegdheid wordt een verzoek om meerdere rondes een
  // onderzoekslus: de agent rekent door tot het budget op is of tot er niets
  // beters meer komt, en zegt daarna wat hij heeft gevonden.
  if (meerdereRondes(tekst) && magRondes && mag) {
    const doelen = [...new Set(DOELWOORDEN.filter((d) => d.herkent(tekst)).map((d) => d.goal))];
    if (doelen.length === 0) {
      return {
        intent: "VERDUIDELIJKING_NODIG",
        toolCalls: [],
        clarification:
          "Meerdere rondes kan, maar dan moet ik weten waarop ik moet sturen. Waar moet het beter worden: " +
          "de uren, de rust, de nachten (clusteren of eerlijker verdelen), rangeerdiensten, het weekend, " +
          "of zo min mogelijk verandering?",
        reasoning: "onderzoekslus zonder doel; zonder doel is er niets te vergelijken",
      };
    }
    return {
      intent: "OPTIMALISATIEVERZOEK",
      toolCalls: [],
      proposal: {
        kind: "RESEARCH",
        strategy: "BALANCED",
        strategyLabel: "Optimale totaalbalans",
        rosterYear: new Date().getFullYear() + 1,
        searchMode: "FAST",
        goals: doelen,
        parentCandidateId: ctx.source === "candidate" ? ctx.candidateId : null,
        note: `onderzoekslus: ${doelen.map((g) => REBUILD_GOAL_LABELS[g as RebuildGoal] ?? g).join(" en ")}`,
        locationCode: ctx.locationCode,
      },
      reasoning: `onderzoekslus voorstellen (${doelen.join(", ")}); een mens bevestigt en kan stoppen`,
    };
  }

  if (meerdereRondes(tekst) && !magRondes) {
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

    // De verboden handelingen worden nu vóór het model gecontroleerd, in
    // askAgent. Dit vangnet blijft staan voor aanroepen die rechtstreeks met de
    // stub praten, zoals de unittests.
    const verboden = verbodenHandeling(tekst);
    if (verboden) {
      return { intent: "GEWEIGERD", toolCalls: [], refusal: verboden.uitleg, reasoning: "verzoek raakt een handeling die niet bij de agent ligt" };
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

    // "Waarom heeft regel 4 geen rangeerdiensten?" — een waaromvraag over iets
    // wat er níet staat. Die is te beantwoorden uit de gegevens: waar de
    // diensten van die soort wél terechtkwamen, en wat er op die regel staat.
    const gevraagdBegrip = begripIn(tekst);
    if (
      gevraagdBegrip?.verwijst.soort === "DIENSTSOORT" &&
      bevat(tekst, "geen", "waarom", "mist", "ontbreek") &&
      ctx.rosterCode
    ) {
      return {
        intent: "UITLEGVRAAG",
        toolCalls: [
          {
            tool: "dutyKindPerLine",
            input: {
              kind: gevraagdBegrip.verwijst.kind,
              lineNumber: ctx.lineNumber,
              rosterCode: ctx.rosterCode,
              locationCode: ctx.locationCode,
              source: ctx.source,
              candidateId: ctx.candidateId,
            },
          },
        ],
        reasoning: `uitzoeken waar de ${gevraagdBegrip.verwijst.kind.toLowerCase()}diensten van ${ctx.rosterCode} staan${ctx.lineNumber ? ` en wat er op regel ${ctx.lineNumber} staat` : ""}`,
      };
    }

    // "Waarom zakte de eerlijkheid toen we de voorkeurstermen in de solver
    // zetten?" — een waaromvraag over een eerdere ingreep. Het antwoord daarop
    // ligt vast in de experimenten, met de reden van toen erbij. Zelf een
    // verklaring bedenken zou hier het makkelijkst en het schadelijkst zijn:
    // een plausibel verhaal over iets wat gemeten is.
    if (
      (bevat(tekst, "waarom", "hoe kwam", "hoe komt") &&
        bevat(tekst, "zakte", "daalde", "verslechterde", "ging.*omlaag", "achteruit", "minder werd")) ||
      bevat(tekst, "eerder geprobeerd", "al eens geprobeerd", "eerder onderzocht", "eerder experiment", "vorig experiment")
    ) {
      return {
        intent: "UITLEGVRAAG",
        toolCalls: [{ tool: "experimentHistory", input: { hypothesis: request.text, locationCode: ctx.locationCode } }],
        reasoning: "eerdere experimenten nalezen en de oorspronkelijke conclusie erbij halen",
      };
    }

    // Ingetrokken kennis alsnog toepassen. Dat is precies wat intrekken moet
    // voorkomen: het item blijft leesbaar, maar het stuurt niets meer.
    // Geldt een voorkeur van de ene standplaats ook op de andere? Nee, en dat
    // is geen technische beperking maar een inhoudelijke: wat hier prettig is,
    // kan daar botsen met afspraken die wij niet kennen.
    if (bevat(tekst, "ook in", "ook voor", "geldt.*ook") && bevat(tekst, "rotterdam", "andere standplaats", "elders", "utrecht", "amsterdam")) {
      return {
        intent: "UITLEGVRAAG",
        toolCalls: [{ tool: "knowledgeSearch", input: { query: request.text, locationCode: ctx.locationCode } }],
        cannotDetermine:
          "Een voorkeur van deze standplaats geldt niet automatisch in Rotterdam of elders. Elke standplaats " +
          "legt haar eigen voorkeuren vast; een andere standplaats kan zelfs het tegenovergestelde hebben " +
          "afgesproken. NS-breed maken is een apart besluit en geen optelsom van locaties.",
        reasoning: "bereikvraag: lagen staan náást elkaar, niet in elkaar",
      };
    }

    // Iemand spreekt een voorkeur uit. Dat is geen vraag maar een gegeven, en
    // het is het enige moment waarop het platform iets kan leren. De agent
    // biedt aan het vast te leggen — als voorstel, want goedkeuren doet een
    // mens.
    if (
      request.capabilities.includes("agent:memory:write") &&
      bevat(tekst, "we willen liever", "we vinden", "voortaan", "liever niet", "we hebben liever", "vinden we prettiger", "onthoud dat") &&
      !bevat(tekst, "?")
    ) {
      return {
        intent: "FEEDBACK",
        toolCalls: [],
        memoryProposal: {
          scope: "LOCATION",
          kind: "PREFERENCE",
          statement: request.text.trim(),
          locationCode: ctx.locationCode,
        },
        reasoning: "uitgesproken voorkeur; aanbieden om vast te leggen als voorstel",
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

    // Vragen naar wat er eerder is geleerd. Dit gaat vóór de regelvraag: "wat
    // weten we hierover" is geen vraag naar een voorschrift.
    if (bevat(tekst, "eerder geleerd", "vorige keer", "wat weten we", "leergeheugen", "geheugen", "eerdere ervaring", "afgesproken", "vorig jaar")) {
      return {
        intent: "UITLEGVRAAG",
        toolCalls: [{ tool: "knowledgeSearch", input: { query: request.text, locationCode: ctx.locationCode } }],
        reasoning: "leergeheugen raadplegen; alleen goedgekeurde items tellen mee",
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

    // Een uitgesproken voorkeur: aanbieden om te onthouden, niet zelf besluiten.
    if (plan.memoryProposal) {
      const m = plan.memoryProposal as { statement: string };
      return {
        text:
          `Zal ik dit onthouden voor deze standplaats: "${m.statement}"? ` +
          "Ik leg het dan vast als voorstel. Het telt pas mee zodra een commissielid het goedkeurt, " +
          "en het blijft met herkomst en datum terug te vinden.",
        data: { memoryProposal: plan.memoryProposal },
        sources: bronnen,
        status: "VOORSTEL",
      };
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
          (p.kind === "RESEARCH"
            ? // Niveau C: geen losse opdracht maar een reeks rondes, met een
              // budget en een conclusie. Dat verschil hoort in de zin te staan.
              `Voorstel: ik ga hier zelfstandig aan rekenen, gericht op ${doelen.join(" en ")}. ` +
              "Na elke ronde meet ik of het beter is geworden en beslis ik of een volgende ronde zin heeft. " +
              "Ik stop vanzelf bij het rondebudget of zodra twee rondes niets opleveren, en zeg dan wat ik heb gevonden — " +
              "ook als dat is dat er niets beters is."
            : p.kind === "REBUILD"
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
          // Een voorstel dat alleen succes beschrijft, wekt een verwachting die
          // de zoekmachine niet kan waarmaken. Bij doelen die elkaar tegenspreken
          // is "niets beters" de eerlijke uitkomst, en die hoort vooraf genoemd
          // te worden en niet pas als teleurstelling achteraf.
          " Het kan ook zijn dat er niets beters uitkomt dan wat er nu ligt; dan is dat de uitkomst, en niet een mislukking." +
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
        case "dutyKindPerLine": {
          data = { ...(data ?? {}), kindPerLine: d };
          if (!d.found) {
            zinnen.push(`Dat basisrooster kan ik niet vinden (${(d.missing as string[]).join(", ")}).`);
            break;
          }
          const soort = String(d.kind).toLowerCase();
          const metSoort = (d.linesWithKind ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
          const gevraagd = d.requestedLine as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any

          if (gevraagd && !gevraagd.hasKind) {
            const diensten = (gevraagd.days as Record<string, any>[]).filter((x) => x.dutyCode); // eslint-disable-line @typescript-eslint/no-explicit-any
            zinnen.push(
              `In ${d.rosterCode} staat regel ${gevraagd.lineNumber} inderdaad zonder ${soort}dienst. ` +
                `Die regel heeft ${diensten.length} ${diensten.length === 1 ? "dienst" : "diensten"}: ` +
                (diensten.map((x) => `${x.weekdayName} ${x.dutyCode}`).join(", ") || "geen enkele") +
                `; de overige dagen liggen vast (${(gevraagd.fixedDays as string[]).join(", ")}).`,
            );
            zinnen.push(
              metSoort.length > 0
                ? `De ${d.totalInRoster} ${soort}diensten van dit rooster staan op regel ` +
                  metSoort.map((r) => `${r.lineNumber} (${r.count}× ${r.dutyCodes.join("/")})`).join(", ") +
                  ". Ze zijn er dus wel; ze kwamen op andere regels terecht."
                : `Dit hele basisrooster heeft geen enkele ${soort}dienst.`,
            );
            zinnen.push(
              "Waaróm de zoekmachine ze daar heeft neergelegd en niet hier, is niet per dienst vastgelegd. " +
                "Wat ik wel kan: laten uitrekenen wat het kost om ze anders te verdelen.",
            );
          } else if (gevraagd) {
            zinnen.push(
              `Regel ${gevraagd.lineNumber} van ${d.rosterCode} heeft wél ${soort}diensten: ` +
                `${(metSoort.find((r) => r.lineNumber === gevraagd.lineNumber)?.dutyCodes ?? []).join(", ")}.`,
            );
          } else {
            zinnen.push(
              `${d.rosterCode} heeft ${d.totalInRoster} ${soort}diensten, verdeeld over regel ` +
                metSoort.map((r) => `${r.lineNumber} (${r.count}×)`).join(", ") +
                ".",
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
            // Een voorlopige controle door een mens is geen NS-bevestiging, en
            // die twee mogen in één zin niet door elkaar lopen.
            const controle = regel.source?.userChecked as { by: string; at: string; note: string | null } | null | undefined;
            zinnen.push(
              `${regel.title}: ${waarde}. Bron: ${bron || "onbekend"} (${regel.statusText ?? regel.status}).` +
                (controle ? ` Voorlopig nagelopen door ${controle.by} op ${controle.at}; dat is geen formele bevestiging namens NS.` : "") +
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
        case "experimentHistory": {
          data = { ...(data ?? {}), experiments: d };
          const proeven = (d.experiments ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (proeven.length === 0) {
            // Niets gevonden is een antwoord. Hier alsnog een verklaring
            // bedenken is precies wat criterium C2 uitsluit.
            zinnen.push(
              "Ik vind hier geen eerder experiment over. Ik heb dus geen gemeten verklaring, en ik ga er geen bedenken.",
            );
            break;
          }
          for (const proef of proeven.slice(0, 2)) {
            const gezakt = (proef.failedGates ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
            zinnen.push(
              `Dit is eerder onderzocht: "${proef.hypothesis}" (${String(proef.status).toLowerCase()}, ${String(proef.createdAt).slice(0, 10)}).` +
                // Letterlijk de conclusie van toen. Een nette hervertelling zou
                // de reden ongemerkt kunnen veranderen.
                (proef.conclusion ? ` De conclusie van toen: ${proef.conclusion}` : " Er is geen conclusie vastgelegd.") +
                (gezakt.length > 0
                  ? ` Gezakt op ${gezakt.map((g) => `${g.naam} (${g.waarde} tegen grens ${g.grens})`).join(" en ")}.`
                  : ""),
            );
          }
          break;
        }
        case "knowledgeSearch": {
          data = { ...(data ?? {}), memory: d };
          const items = (d.items ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (items.length === 0) {
            zinnen.push("In het leergeheugen staat hier nog niets over. Wat niet is vastgelegd en goedgekeurd, pas ik ook niet toe.");
            break;
          }
          for (const item of items.slice(0, 4)) {
            const waar = item.scope === "NATIONAL" ? "NS-breed" : item.scope === "LOCATION" ? `standplaats ${item.locationCode}` : "dit project";
            zinnen.push(
              `${item.statement} (${waar}, ${item.origin}, ${item.appliedCount === 0 ? "nog nooit toegepast" : `${item.appliedCount}× toegepast`})` +
                (item.status !== "APPROVED" ? ` — let op: ${String(item.status).toLowerCase()}, telt dus niet mee in een beslissing.` : "") +
                // Dit is de kern van T21: een les uit een ander dienstenpakket
                // gaat niet zonder meer op voor het pakket dat nu draait.
                (item.contextStillCurrent === false
                  ? " Dit is geleerd in een ander dienstenpakket; of het nu nog opgaat, is niet vastgesteld."
                  : ""),
            );
          }
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
