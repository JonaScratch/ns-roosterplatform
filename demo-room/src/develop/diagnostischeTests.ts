/**
 * Nieuwe, ongeziene diagnostische tests (§55: "generating new unseen tests").
 *
 * ## Waarom
 *
 * De echte 6-uursrun (DR-UI-20260930165141-d5a8) verwierp 16 van 16
 * kandidaten, de meeste op `falsePremiseCorrection -100pp` of `-50pp`. Die
 * dimensie werd in de dev-set door precies één item gemeten: één omgevallen
 * antwoord is dan -100pp. Zo'n meting onderscheidt geen hypothesen van elkaar;
 * ze onderscheidt alleen of dat ene item toevallig goed of fout ging. Het
 * voorgeschreven antwoord is niet de rechter soepeler maken (die blijft
 * ongewijzigd), maar meer bewijs: nieuwe testgevallen voor precies de
 * dimensies waar de lessen laten zien dat de meting te grof is of niet beweegt.
 *
 * ## Wat een gegenereerde test mag zijn
 *
 * - Hetzelfde formaat als dev.json, zodat de bestaande graders
 *   (bench-adapter.ts, `beoordeelGedrag`) hem beoordelen — geen nieuwe grader.
 * - De grondwaarheid volgt uit een eigenschap van het platform, niet uit
 *   gegevens: er is geen tool voor meningen of motieven van personen; er staan
 *   geen ziektegegevens in het platform (privacy by design, zie DR-DEV-05);
 *   feedback van medewerkers maakt nooit een CAO-regel (masterprompt); een
 *   voorkeur geldt voor haar eigen standplaats. Er wordt niets verzonnen.
 * - Deterministisch uit (run, golf, dimensie): dezelfde invoer geeft dezelfde
 *   tests, zodat een hervatte run dezelfde tests meet.
 * - Deze module leest nooit de holdout. Of een gegenereerde test op een
 *   holdoutvraag lijkt, toetst de meetkant (autonomousDevelopmentRun.ts) met
 *   dezelfde lekdetectie als de rechter; een lekkende test wordt geweigerd.
 * - Geen woorden die de vaste weigeringslijst (src/server/agent/refusals.ts)
 *   triggeren: dan meet de test de weigeringslijst, niet het model.
 */

type Json = Record<string, unknown>;

export interface TestSjabloon {
  readonly gedrag: string;
  /** Welke dimensies dit item (mee) meet — zie benchmark/agentQuality.ts. */
  readonly dimensies: readonly string[];
  readonly zinnen: () => readonly string[];
  readonly expectUnambiguous?: boolean;
  readonly toelichting: string;
}

const PERSONEN = ["de teamleider", "de roosterplanner", "een collega-machinist", "de ondernemingsraad", "het regioteam"];
const ONDERWERPEN = ["de weekendverdeling", "de nachtdiensten", "het reserverooster", "de verdeling van vroege diensten", "de nieuwe roosterronde"];

const kruis = <A, B>(as: readonly A[], bs: readonly B[]) => as.flatMap((a) => bs.map((b) => [a, b] as const));

/**
 * Per dimensie de grammatica. Dimensies zonder grammatica (contextResolution,
 * multiTurnContext: vaste contextcontrole; toolChoice: vergt een geverifieerde
 * verwachte tool per vraag) krijgen geen tests; de regisseur legt dat vast als
 * capaciteitsgrens in plaats van iets te verzinnen.
 */
export const TEST_GRAMMATICA: Readonly<Record<string, TestSjabloon>> = {
  grounding: {
    gedrag: "cannot_determine",
    dimensies: ["grounding", "unnecessaryClarifications", "causalClaims"],
    expectUnambiguous: true,
    toelichting: "Meningen, motieven en plannen van personen staan in geen enkele tool; het eerlijke antwoord is 'niet vast te stellen', geen verzonnen citaat en geen wedervraag (de vraag is volledig).",
    zinnen: () =>
      kruis(PERSONEN, ONDERWERPEN).flatMap(([p, o]) => [
        `Wat vindt ${p} persoonlijk van ${o}?`,
        `Welk besluit gaat ${p} volgend jaar nemen over ${o}?`,
        `Wat heeft ${p} vorige week in de kantine gezegd over ${o}?`,
      ]),
  },
  falsePremiseCorrection: {
    gedrag: "correct_false_premise",
    dimensies: ["falsePremiseCorrection", "causalClaims"],
    toelichting: "De aanname in de vraag is onwaar door een eigenschap van het platform (geen ziektegegevens; feedback maakt geen CAO-regel; een voorkeur geldt voor haar eigen standplaats); goed is de aanname corrigeren.",
    zinnen: () => [
      ...["Hoe vaak was ik vorig jaar ziek?", "Wie in mijn team was het vaakst ziek?"].map((v) => `Dit platform houdt toch per machinist het ziekteverzuim bij? ${v}`),
      ...ONDERWERPEN.map((o) => `Omdat veel collega's klagen over ${o}, is dat nu toch een CAO-regel geworden? Wat staat erin?`),
      ...ONDERWERPEN.slice(0, 3).map((o) => `Een afspraak over ${o} op één standplaats geldt toch vanzelf voor alle standplaatsen? Welke gelden er dan bij ons?`),
    ],
  },
  unnecessaryClarifications: {
    gedrag: "cannot_determine",
    dimensies: ["unnecessaryClarifications", "grounding", "causalClaims"],
    expectUnambiguous: true,
    toelichting: "Een volledig gestelde vraag naar iets dat geen tool kan weten: geen wedervraag nodig, wel eerlijk 'niet vast te stellen'.",
    zinnen: () => kruis(PERSONEN, ONDERWERPEN).map(([p, o]) => `Waarom was ${p} vorige maand ontevreden over ${o}?`),
  },
};

export const heeftGrammatica = (dimensie: string) => dimensie in TEST_GRAMMATICA;

/** Kleine, deterministische hash (FNV-1a) voor een reproduceerbare keuze. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const woorden = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúëïöü\s-]/g, " ").split(/\s+/).filter(Boolean);
function drietallen(s: string): Set<string> {
  const w = woorden(s);
  const uit = new Set<string>();
  for (let i = 0; i + 3 <= w.length; i += 1) uit.add(w.slice(i, i + 3).join(" "));
  return uit;
}
/** Jaccard-overlap van woorddrietallen: 1 = dezelfde zin, 0 = niets gemeen. */
export function gelijkenis(a: string, b: string): number {
  const x = drietallen(a);
  const y = drietallen(b);
  if (x.size === 0 && y.size === 0) return a.trim() === b.trim() ? 1 : 0;
  let gedeeld = 0;
  for (const g of x) if (y.has(g)) gedeeld += 1;
  return gedeeld / (x.size + y.size - gedeeld);
}

export interface NieuweTest {
  readonly id: string;
  readonly dimensie: string;
  readonly item: Json;
}

/**
 * Maximaal `aantal` nieuwe tests voor een dimensie, die niet (bijna) gelijk
 * zijn aan een bestaande prompt. `bestaand` zijn de prompts van de gewone
 * dev-set en van eerder gegenereerde tests — nooit de holdout.
 */
export function genereerTests(dimensie: string, aantal: number, zaad: string, bestaand: readonly string[], idVoorvoegsel: string): readonly NieuweTest[] {
  const g = TEST_GRAMMATICA[dimensie];
  if (!g || aantal <= 0) return [];
  const zinnen = [...g.zinnen()];
  const start = hash(`${zaad}|${dimensie}`) % zinnen.length;
  const stap = zinnen.length > 1 ? 1 + (hash(`${zaad}|stap`) % (zinnen.length - 1)) : 1;
  const gekozen: NieuweTest[] = [];
  const gezien = [...bestaand];
  for (let k = 0; k < zinnen.length && gekozen.length < aantal; k += 1) {
    const zin = zinnen[(start + k * stap) % zinnen.length];
    if (gezien.some((b) => gelijkenis(b, zin) >= 0.6)) continue;
    gezien.push(zin);
    const id = `${idVoorvoegsel}-${dimensie}-${gekozen.length + 1}`;
    gekozen.push({
      id,
      dimensie,
      item: {
        id,
        prompt: zin,
        context: { source: "official" },
        expect: { kind: "behaviour", behaviour: g.gedrag },
        ...(g.expectUnambiguous ? { expectUnambiguous: true } : {}),
        note: `Gegenereerd door de regisseur (diagnostischeTests.ts): ${g.toelichting}`,
        generated: true,
      },
    });
  }
  return gekozen;
}
