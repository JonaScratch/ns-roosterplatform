import "server-only";
import { activeRuleset } from "@/server/rules-engine";
import { prisma } from "@/server/data/prisma";
import { BLOCKING_STATUSES, type RuleContext, type RuleDefinition, currentLegalStatus, resolveRule } from "@/server/rules-engine/ruleset/types";

/**
 * De regelkennisbank: regels vinden op wat iemand vraagt.
 *
 * ## Waarom zoeken en niet alleen opzoeken
 *
 * Een machinist vraagt niet naar `RP_DAILY_REST_PLANNED`. Hij vraagt hoeveel
 * rust er tussen twee diensten moet zitten, of dat zeven nachten achter elkaar
 * mag. Deze laag vertaalt zulke woorden naar regels uit het regelbestand — en
 * niet naar een antwoord: het antwoord komt altijd uit de regel zelf.
 *
 * ## Wat er altijd meekomt
 *
 * Waarde, eenheid, bron, artikel en status. Die horen bij elkaar. Een waarde
 * zonder status nodigt uit om hem als vaststaand te lezen, terwijl het grootste
 * deel van dit regelbestand letterlijk is overgenomen uit een aangeleverd
 * document en niet formeel is bevestigd. Dat verschil verzwijgen zou de
 * gebruiker een zekerheid geven die er niet is.
 *
 * ## Ontbrekende regels zijn ook kennis
 *
 * Wat niet is aangeleverd, komt terug als ontbrekend pakket, met wat daardoor
 * niet te beoordelen is. Dat is geen leeg antwoord maar het enige eerlijke:
 * fail-closed betekent ook dat je het zegt.
 */

/**
 * Woorden die mensen gebruiken, en waar ze in het regelbestand op slaan.
 *
 * Bewust géén vertaling naar één regel-id: dat zou een keuze zijn die deze
 * laag niet hoort te maken. Het zijn extra zoekwoorden, meer niet.
 */
const SYNONIEMEN: Readonly<Record<string, readonly string[]>> = {
  rust: ["rest", "rust", "daily_rest", "hersteltijd"],
  hersteltijd: ["recovery", "rest", "night_sequence"],
  nacht: ["night", "nacht"],
  nachten: ["night", "nacht", "sequence"],
  nachtdienst: ["night", "nacht"],
  pauze: ["break", "pauze"],
  weekend: ["weekend", "free_weekend"],
  vrij: ["free", "off", "rust"],
  uren: ["hours", "week_hours", "uren"],
  urennorm: ["hours", "week_hours"],
  weekomvang: ["hours", "week_hours"],
  zondag: ["sunday", "weekend"],
  zaterdag: ["saturday", "weekend"],
  reistijd: ["travel", "reis"],
  overstaan: ["layover", "overstaan"],
  rangeer: ["shunting", "rangeer"],
  dienstlengte: ["duty_length", "max_duty", "lengte"],
  maximum: ["max"],
  minimaal: ["min"],
  opeenvolgend: ["consecutive", "sequence"],
  reeks: ["sequence", "reeks"],
  vroeg: ["early", "vroeg"],
  laat: ["late", "laat"],
  verlof: ["leave", "cao_day", "verlof"],
  feestdag: ["holiday", "feestdag"],
};

export interface RuleHit {
  readonly ruleId: string;
  readonly title: string;
  readonly category: string;
  readonly value: number | null;
  readonly unit: string;
  readonly status: string;
  /** Mag deze regel een beslissing dragen, of is hij niet veilig te gebruiken? */
  readonly blocking: boolean;
  readonly rationale: string;
  readonly source: {
    readonly documentTitle: string;
    readonly article: string | null;
    readonly paragraph: string | null;
    readonly legalAuthority: string;
    readonly legalStatus: string;
    readonly userChecked: GebruikersControle | null;
  };
  /** Geldt deze regel voor de gevraagde groep, standplaats en datum? */
  readonly applicable: boolean;
  readonly score: number;
}

/**
 * Een voorlopige controle van een bron door een gebruiker.
 *
 * Dit is geen goedkeuring namens NS en wordt ook nergens als zodanig getoond.
 * Het is precies wat het is: iemand heeft het document nagelopen, op een datum,
 * met een aantekening. Dat is meer dan niets en minder dan bevestigd.
 */
export interface GebruikersControle {
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export interface KnowledgeResult {
  readonly rulesetVersion: string;
  readonly rulesetLegalStatus: string;
  readonly hits: readonly RuleHit[];
  /** Regelpakketten die helemaal niet zijn aangeleverd, maar wel bij de vraag horen. */
  readonly missing: readonly { readonly id: string; readonly title: string; readonly reason: string; readonly blocks: readonly string[] }[];
}

/**
 * Woorden die in elke roostervraag voorkomen en dus niets onderscheiden.
 *
 * Zonder deze lijst matchte "Welke regel geldt er voor pauzes tijdens een
 * dienst?" op elke regel die het woord "dienst" in zijn toelichting heeft — en
 * dan komt er een keurig antwoord over lange diensten terug op een vraag over
 * pauzes. Dat is erger dan geen antwoord.
 */
const STOPWOORDEN = new Set([
  "regel", "regels", "geldt", "gelden", "welke", "welk", "hoeveel", "hoelang", "moet", "moeten",
  "mag", "mogen", "kan", "kunnen", "dienst", "diensten", "tijdens", "voor", "over", "deze", "wordt",
  "worden", "staat", "staan", "heeft", "hebben", "maar", "naar", "bij", "een", "het", "van", "met",
  "dat", "die", "dan", "als", "ook", "wel", "niet", "nog", "per", "aan", "uit", "rooster", "roosters",
]);

const woorden = (tekst: string): string[] =>
  tekst
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúëïöüä\s:_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWOORDEN.has(w));

/** De zoekwoorden van een vraag, aangevuld met wat ze in het regelbestand heten. */
function zoekwoorden(vraag: string): string[] {
  const basis = woorden(vraag);
  const extra = basis.flatMap((w) => SYNONIEMEN[w] ?? []);
  return [...new Set([...basis, ...extra])];
}

/**
 * Hoe goed past deze regel bij de vraag?
 *
 * Titel en identificatie tellen als "raak": daar staat het onderwerp. De
 * toelichting telt mee, maar kan een treffer niet dragen — anders komt een
 * regel bovendrijven omdat het gevraagde woord toevallig in zijn motivering
 * voorkomt. Zonder rake treffer is er geen treffer.
 */
function scoreVan(regel: RuleDefinition, termen: readonly string[]): { score: number; raak: boolean } {
  const titel = regel.title.toLowerCase();
  const id = regel.id.toLowerCase();
  const reden = regel.rationale.toLowerCase();
  let score = 0;
  let raak = false;
  for (const term of termen) {
    if (titel.includes(term)) {
      score += 3;
      raak = true;
    }
    if (id.includes(term)) {
      score += 2;
      raak = true;
    }
    if (reden.includes(term)) score += 1;
  }
  return { score, raak };
}

/**
 * Regels zoeken. Zuiver: geen database, alleen het regelbestand.
 *
 * De gebruikerscontroles komen er van buiten in. Dat is geen preutsheid maar
 * onderhoud: deze functie was met een handvol regels te toetsen zonder database,
 * en die eigenschap is meer waard dan het gemak van hier even een query doen.
 * `searchRulesMetControles` hieronder doet dat wél, aan de rand.
 */
export function searchRules(
  vraag: string,
  context: RuleContext,
  opties: { readonly limit?: number; readonly checks?: ReadonlyMap<string, GebruikersControle> } = {},
): KnowledgeResult {
  const limit = opties.limit ?? 5;
  const controles = opties.checks ?? new Map<string, GebruikersControle>();
  const ruleset = activeRuleset();
  const termen = zoekwoorden(vraag);

  const gescoord = ruleset.rules
    .map((regel) => ({ regel, ...scoreVan(regel, termen) }))
    .filter((r) => r.raak)
    .sort((a, b) => b.score - a.score);

  // Dezelfde regel kan in meerdere lagen bestaan; het gaat om de regel die
  // hier geldt, dus per id één keer, via de normale voorrangsregels.
  const gezien = new Set<string>();
  const hits: RuleHit[] = [];
  for (const { regel, score } of gescoord) {
    if (gezien.has(regel.id)) continue;
    gezien.add(regel.id);
    const resolutie = resolveRule(ruleset, regel.id, context);
    const geldend = resolutie.kind === "RESOLVED" ? resolutie.rule : regel;
    hits.push({
      ruleId: geldend.id,
      title: geldend.title,
      category: geldend.category,
      value: geldend.value,
      unit: geldend.unit,
      status: geldend.status,
      blocking: BLOCKING_STATUSES.includes(geldend.status),
      rationale: geldend.rationale,
      source: {
        documentTitle: geldend.source.documentTitle,
        article: geldend.source.article ?? null,
        paragraph: geldend.source.paragraph ?? null,
        legalAuthority: geldend.source.legalAuthority,
        legalStatus: currentLegalStatus(geldend.source, context.onDate),
        /** Voorlopig nagelopen door een mens; nadrukkelijk geen NS-bevestiging. */
        userChecked: controles.get(geldend.source.document) ?? null,
      },
      applicable: resolutie.kind === "RESOLVED",
      score,
    });
    if (hits.length >= limit) break;
  }

  // Ontbrekende pakketten die bij de vraag horen: wat er niet is, is ook een
  // antwoord — en vaak het belangrijkste.
  const ontbrekend = ruleset.missingPackages.filter((pakket) => {
    const tekst = `${pakket.id} ${pakket.title} ${pakket.reason} ${pakket.blocks.join(" ")}`.toLowerCase();
    return termen.some((t) => tekst.includes(t));
  });

  return {
    rulesetVersion: ruleset.version,
    rulesetLegalStatus: ruleset.legalStatus,
    hits,
    missing: ontbrekend.map((p) => ({ id: p.id, title: p.title, reason: p.reason, blocks: p.blocks })),
  };
}

/**
 * Dezelfde zoektocht, met de voorlopige controles van mensen erbij.
 *
 * Een controle door een gebruiker is nadrukkelijk geen goedkeuring namens NS.
 * Hij wordt daarom apart bijgehouden en apart getoond; de status van de regel
 * zelf verandert er niet door.
 */
export async function searchRulesMetControles(vraag: string, context: RuleContext, limit = 5): Promise<KnowledgeResult> {
  const rijen = await prisma.ruleSourceCheck.findMany({
    select: { document: true, checkedByName: true, checkedAt: true, note: true },
    orderBy: { checkedAt: "desc" },
  });
  const checks = new Map<string, GebruikersControle>();
  for (const rij of rijen) {
    if (!checks.has(rij.document)) {
      checks.set(rij.document, { by: rij.checkedByName, at: rij.checkedAt.toISOString().slice(0, 10), note: rij.note });
    }
  }
  return searchRules(vraag, context, { limit, checks });
}

/** De statussen in gewone taal, voor het antwoord aan de gebruiker. */
export const STATUS_TEKST: Readonly<Record<string, string>> = {
  VALIDATED: "door NS bevestigd",
  SOURCE_TRANSCRIBED: "letterlijk overgenomen uit de aangeleverde bron, niet formeel bevestigd",
  UNVALIDATED_LOCAL_PARAMETER: "de waarde voor deze standplaats is niet aangeleverd",
  NEEDS_POLICY_VALIDATION: "de juridische status moet NS nog vaststellen",
  POLICY_PENDING: "aangekondigd, inhoudelijk nog niet uitgewerkt",
  UNRESOLVED: "de bron laat meerdere lezingen toe",
  NOT_SUPPLIED: "niet aangeleverd",
};
