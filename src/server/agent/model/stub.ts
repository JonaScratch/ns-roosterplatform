import "server-only";
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

/** Woorden die op een handeling wijzen waarvoor een mens moet tekenen. */
const VERBODEN = [
  { woorden: ["publiceer", "publiceren", "vaststellen als definitief"], uitleg: "Publiceren is een menselijke handeling; de agent heeft die bevoegdheid niet en krijgt die ook niet." },
  { woorden: ["negeer de validator", "negeer validator", "sla de validatie over", "goed genoeg"], uitleg: "De onafhankelijke validator kan ik niet overslaan. Een hoge score maakt een harde overtreding niet geldig." },
  { woorden: ["eigen bevoegdheden", "zet jezelf op niveau", "geef jezelf", "verhoog je rechten"], uitleg: "Ik kan mijn eigen bevoegdheden niet aanpassen. Dat doet een commissielid in het bevoegdhedenpaneel." },
  { woorden: ["verwijder de regel", "schrap de regel", "pas de cao aan"], uitleg: "Formele regels wijzig ik niet. Die komen uit het regelbestand en hebben een bron en een status." },
];

/** Begrippen die in dit dienstenpakket niet bestaan: daar hoort een wedervraag bij. */
const ONBEKENDE_BEGRIPPEN = ["ret", "sprinterdienst", "intercitydienst"];

const weekdagUitTekst = (tekst: string): number | null => {
  for (let i = 1; i <= 7; i += 1) if (tekst.includes(DAG_NAMEN[i])) return i;
  return null;
};

export const stubModel: ChatModel = {
  name: "stub",
  isLanguageModel: false,

  async plan(request: PlanRequest): Promise<AgentPlan> {
    const tekst = request.text.toLowerCase();
    const ctx = request.context;

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
    }

    // Verdelingsvragen over soorten diensten.
    if (bevat(tekst, "rangeer")) {
      return { intent: "VERDELINGSVRAAG", toolCalls: [{ tool: "dutyKindCounts", input: { kind: "RANGEER", locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }], reasoning: "rangeerdiensten per basisrooster tellen" };
    }
    if (bevat(tekst, "afloper", "aflopers")) {
      return { intent: "VERDELINGSVRAAG", toolCalls: [{ tool: "dutyKindCounts", input: { dutyClass: "PREMIUM_LATE", locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }], reasoning: "echte aflopers per basisrooster tellen" };
    }
    if (bevat(tekst, "uren", "urenbalans", "gemiddelde week")) {
      return { intent: "VERDELINGSVRAAG", toolCalls: [{ tool: "rosterHours", input: { locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }], reasoning: "gemiddelde weekomvang per basisrooster" };
    }
    // Vragen over de geselecteerde regel.
    if (ctx.rosterCode && ctx.lineNumber) {
      if (bevat(tekst, "welke dienst", "welke diensten", "wat staat", "hoe laat", "eindtijd", "begintijd", "afgelopen", "begint")) {
        return {
          intent: "ROOSTERVRAAG",
          toolCalls: [{ tool: "rosterLine", input: { rosterCode: ctx.rosterCode, lineNumber: ctx.lineNumber, locationCode: ctx.locationCode, source: ctx.source, candidateId: ctx.candidateId } }],
          reasoning: `regel ${ctx.lineNumber} van ${ctx.rosterCode} ophalen met de echte tijden`,
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

    if (bevat(tekst, "onderzoek", "probeer", "verbeter", "genereer", "bereken")) {
      const mag = request.capabilities.includes("agent:job:create");
      return {
        intent: "OPTIMALISATIEVERZOEK",
        toolCalls: [],
        refusal: mag ? undefined : "Ik mag voor dit project nog geen nieuwe berekening starten. Een commissielid kan die bevoegdheid aanzetten in het bevoegdhedenpaneel.",
        reasoning: mag ? "verbeterdoel formuleren en laten bevestigen" : "bevoegdheid om te rekenen staat uit",
      };
    }

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

    const mislukt = results.find((r) => !r.ok);
    if (mislukt) return { text: `Dat lukte niet: ${mislukt.error ?? "onbekende fout"}.`, data: null, sources: bronnen, status: "FOUT" };

    if (plan.clarification) {
      return { text: plan.clarification, data: { intent: plan.intent }, sources: bronnen, status: "VERDUIDELIJKING" };
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
          zinnen.push(
            `${d.rosterCode} regel ${d.lineNumber} heeft ${diensten.length} ${diensten.length === 1 ? "dienst" : "diensten"}: ` +
              diensten.map((x) => `${x.weekdayName} dienst ${x.dutyCode} (${x.start}–${x.end})`).join(", ") +
              (vast.length ? `. De andere dagen liggen vast in de structuur: ${vast.map((x) => `${x.weekdayName} ${x.positionType.toLowerCase()}`).join(", ")}.` : "."),
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
              `${regel.title ?? regel.ruleId}: ${regel.value} ${eenheid(regel.unit)}. Bron: ${bron?.documentTitle ?? bron?.document ?? "onbekend"}${bron?.article ? `, ${bron.article}` : ""}. ` +
                (regel.verified ? "Deze bron is bevestigd." : "Let op: de juridische status van deze bron is niet formeel geverifieerd."),
            );
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
                      `; daarna ${b.nextDay.dutyCode ? `dienst ${b.nextDay.dutyCode}` : b.nextDay.positionType.toLowerCase()}`,
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
