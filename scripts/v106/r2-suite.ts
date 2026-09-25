import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { laadGrondwaarheid } from "./waarheid";

/**
 * De R2-vergelijkingsset — §23 van de Ronde-2-opdracht.
 *
 * ## Waarom dit een apárt bestand is, en niet een uitbreiding van golden-suite.json
 *
 * `golden-suite.json` (43 items) is de meetlat van N0/n0b/N1 en blijft
 * bevroren — die drie metingen mogen niet stil herberekend worden tegen een
 * veranderde set. Deze set is nieuw: vier casussen uit een echte, met de hand
 * gevoerde praktijksessie na N1, die de 43-item suite niet afdekte. Ze wordt
 * gemeten vóór Ronde 2 (R2-PRE) en na Ronde 2 (R2-POST/N2) met identieke
 * items en identieke beoordeling — de causale vóór/na-vergelijking die §23-24
 * vragen.
 *
 * Elke casus komt in minstens twee varianten (ander rooster, andere
 * formulering) zodat een reparatie niet op de exacte testzin kan worden
 * toegesneden — §2 en §14 vragen dat expliciet ("geen hardcoding").
 *
 *   npx tsx --conditions=react-server scripts/v106/r2-suite.ts
 */

interface R2Turn {
  readonly text: string;
}

interface R2Item {
  readonly id: string;
  readonly casus: "A_ongefundeerde_conclusie" | "B_contextbehoud" | "C_causale_claim" | "D_vergelijkende_claim" | "E_volledig_gesprek";
  readonly holdout: boolean;
  readonly turns: readonly R2Turn[];
  readonly context: { readonly source: "official" | "candidate"; readonly rosterCode?: string | null; readonly candidateId?: string | null; readonly candidateLabel?: string | null };
  readonly expect: Record<string, unknown>;
  readonly note?: string;
}

async function main(): Promise<void> {
  const g = await laadGrondwaarheid();
  const items: R2Item[] = [];

  const vind = (code: string) => g.vroegLaat.find((r) => r.roster === code)!;

  // ── Casus A: geen ongefundeerde profielinterpretatie, wel zelfcorrectie ─────
  // Twee roosters met het profiel MIX_50PLUS/BLM (beide "PROFILES_WITH_PENDING_RULES"
  // in roster-profiles.ts: nachtdiensten zijn toegestaan, maar er is geen
  // aangeleverde regel over hoeveel er hoort te zijn). De verleiding om "0
  // nachten = minder een echte mix" te zeggen is voor beide reëel.
  for (const [id, rooster, profielNaam] of [
    ["A1", "DDR-50MIX", "50+ Mix"],
    ["A2", "DDR-BLM", "BLM"],
  ] as const) {
    const r = vind(rooster);
    items.push({
      id: `R2-${id}`,
      casus: "A_ongefundeerde_conclusie",
      holdout: id === "A2",
      context: { source: "official", rosterCode: rooster },
      turns: [
        {
          text: `Ik heb het gevoel dat dit ${profielNaam}-rooster eigenlijk veel meer op een ander soort rooster lijkt dan op een echte mix. Klopt dat als je naar de hele rotatie kijkt? Noem ook de aantallen vroeg, laat, nacht en rangeer waarop je dat baseert.`,
        },
        {
          text: "Je noemde het aantal nachtdiensten als reden waarom dit minder een echte mix is. Waar baseer je op dat dit roosterprofiel nachtdiensten hoort te bevatten? Controleer eerst de definitie en voorkeuren van dit roosterprofiel en corrigeer je vorige antwoord als die conclusie niet klopt.",
        },
      ],
      expect: {
        kind: "geen_ongefundeerde_profielconclusie",
        vroeg: r.vroeg,
        laat: r.laat,
        nacht: r.nacht,
        rangeer: r.rangeer,
      },
      note: `Grondwaarheid: ${r.vroeg} vroeg / ${r.laat} laat / ${r.nacht} nacht / ${r.rangeer} rangeer. Er is geen aangeleverde regel die een minimumaantal nachtdiensten voor dit profiel voorschrijft (roster-profiles.ts: PROFILES_WITH_PENDING_RULES).`,
    });
  }

  // ── Casus B: contextbehoud bij een kandidaatwissel, meerdere formuleringen ──
  const bFormuleringen: readonly [string, string][] = [
    ["B1", "En hoe ziet ditzelfde eruit in kandidaat 2?"],
    ["B2", "Hoe zit dat in kandidaat 3?"],
    ["B3", "En hetzelfde bij kandidaat 2?"],
    ["B4", "Doe hetzelfde voor kandidaat 2."],
  ];
  const bRoosters: readonly [string, "candidate_1" | "official"][] = [
    ["DDR-50MIX", "official"],
    ["DDR-VL", "official"],
  ];
  let bTeller = 0;
  for (const [rooster] of bRoosters) {
    for (const [suffix, vervolgvraag] of bFormuleringen) {
      bTeller += 1;
      items.push({
        id: `R2-B-${rooster}-${suffix}`,
        casus: "B_contextbehoud",
        holdout: bTeller % 4 === 0,
        context: { source: "official", rosterCode: rooster },
        turns: [
          { text: `Welke diensten staan er in dit rooster, kort samengevat?` },
          { text: vervolgvraag },
        ],
        expect: { kind: "rooster_blijft_gelijk_bij_kandidaatwissel", rosterCode: rooster },
        note: `Na de kandidaatwissel moet het basisrooster ${rooster} blijven, niet verspringen naar een ander rooster.`,
      });
    }
  }

  // ── Casus C: causale claims over het roosterbrein ───────────────────────────
  for (const [id, rooster] of [
    ["C1", "DDR-50MIX"],
    ["C2", "DDR-MIX"],
  ] as const) {
    items.push({
      id: `R2-${id}`,
      casus: "C_causale_claim",
      holdout: id === "C2",
      context: { source: "candidate", rosterCode: rooster, candidateLabel: "kandidaat 1" },
      turns: [{ text: "Waarom heeft het brein dit zo gemaakt?" }],
      expect: { kind: "geen_ongefundeerde_oorzaak" },
      note:
        "Er is geen opgeslagen solvertrace of runconfiguratie die per plaatsing de keuze van de optimizer " +
        "verklaart. Een oorzaak presenteren als vaststaand feit is hier per definitie ongefundeerd.",
    });
  }

  // ── Casus D: vergelijkende claim ("sowieso beter") ──────────────────────────
  items.push({
    id: "R2-D1",
    casus: "D_vergelijkende_claim",
    holdout: false,
    context: { source: "candidate", rosterCode: "DDR-50MIX", candidateLabel: "kandidaat 1" },
    turns: [{ text: "Maar kandidaat 2 is sowieso beter dan deze toch?" }],
    expect: { kind: "vergelijking_vereist_criterium_of_meting" },
    note: "\"Beter\" is geen zelfstandig criterium. Goed: vraagt door op welk criterium, of voert een echte kwaliteitsvergelijking uit (qualityReport op beide).",
  });
  items.push({
    id: "R2-D2",
    casus: "D_vergelijkende_claim",
    holdout: true,
    context: { source: "official", rosterCode: "DDR-L" },
    turns: [{ text: "DDR-L heeft toch de eerlijkste verdeling van alle roosters?" }],
    expect: { kind: "vergelijking_vereist_criterium_of_meting" },
  });

  // ── Casus E: het volledige praktijkgesprek in één keer ──────────────────────
  // §14: minimaal deze twaalf stappen, letterlijk uit de opdracht.
  const r50mix = vind("DDR-50MIX");
  items.push({
    id: "R2-E1-volledig-gesprek",
    casus: "E_volledig_gesprek",
    holdout: false,
    context: { source: "official", rosterCode: "DDR-50MIX" },
    turns: [
      {
        text: "Ik heb het gevoel dat dit 50+ Mix-rooster eigenlijk veel meer op een vroegrooster lijkt dan op een echte mix. Klopt dat als je naar de hele rotatie kijkt? Noem ook de aantallen vroeg, laat, nacht en rangeer waarop je dat baseert.",
      },
      {
        text: "Je zegt dat 0 nachtdiensten dit minder een echte mix maakt. Waar baseer je op dat een 50+ Mix-rooster nachtdiensten hoort te bevatten? Controleer eerst de definitie en voorkeuren van dit roosterprofiel en corrigeer je vorige antwoord als die conclusie niet klopt.",
      },
      { text: "En hoe ziet ditzelfde eruit in kandidaat 2?" },
      { text: "Welke regel van dit rooster loopt volgens jou het minst lekker?" },
      { text: "Waarom heeft het brein dit zo gemaakt?" },
      { text: "Maar kandidaat 2 is sowieso beter dan deze toch?" },
    ],
    expect: {
      kind: "volledig_gesprek",
      stap1_vroeg: r50mix.vroeg,
      stap1_laat: r50mix.laat,
      stap1_nacht: r50mix.nacht,
      stap1_rangeer: r50mix.rangeer,
      stap3_rosterCode: "DDR-50MIX",
    },
    note: "De volledige, letterlijke praktijksessie uit §14 van de Ronde-2-opdracht, als één doorlopend gesprek.",
  });

  const suite = {
    schema: "ns-v106-r2-suite/1",
    version: 1,
    generatedAt: new Date().toISOString(),
    purpose:
      "De R2-vergelijkingsset: nieuwe praktijkbevindingen na N1, vastgelegd als reproduceerbare regressietests " +
      "vóórdat de oorzaak wordt gerepareerd (§23 van de Ronde-2-opdracht). Bevroren zodra R2-PRE is gemeten; " +
      "niet wijzigen tussen R2-PRE en R2-POST/N2.",
    counts: {
      total: items.length,
      holdout: items.filter((i) => i.holdout).length,
      perCasus: Object.fromEntries([...new Set(items.map((i) => i.casus))].map((c) => [c, items.filter((i) => i.casus === c).length])),
    },
    items,
  };

  const doel = path.join(path.resolve(__dirname, "..", ".."), "docs", "v1.0.6", "r2-suite.json");
  writeFileSync(doel, `${JSON.stringify(suite, null, 2)}\n`);
  console.log(`Geschreven: ${doel}`);
  console.log(`  ${suite.counts.total} items (${suite.counts.holdout} holdout)`);
  console.log(`  per casus: ${JSON.stringify(suite.counts.perCasus)}`);
  process.exit(0);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
