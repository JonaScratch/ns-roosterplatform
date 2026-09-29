import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classificeerGezagsClaims, ongedekteGezagsClaims, type ClaimToolResultaat } from "../../src/server/agent/claim-verification";
import { grendelVan, pasGrendelregelToe } from "../v106/grendel-regel";

/**
 * Item-niveau BEFORE→AFTER-vergelijking over replicate-metingen van de golden
 * suite — leest alleen bestaande, gehashte artefacten (niets opnieuw meten,
 * niets overschrijven; de uitvoer krijgt een eigen bestandsnaam per paar).
 *
 * Per item: oordelen per replicaat vóór en na, de overgangsklasse
 * (VERBETERD / GEREGRESSEERD / STABIEL_GOED / STABIEL_FOUT / INSTABIEL), en —
 * het belangrijkste voor de oorzaakanalyse — WELKE grendel het AFTER-antwoord
 * verving (claimverificatie, grounding, zonder-bron) of dat het model zelf
 * zo antwoordde. Voor geregresseerde items speelt het script bovendien de
 * HUIDIGE claimgrendel terug over de BEFORE-antwoorden (die liepen nog zonder
 * grendel), zodat zichtbaar is of de huidige code dezelfde antwoorden weer
 * zou doorlaten of nog steeds zou tegenhouden.
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/compare-before-after.ts \
 *     --before 20260927-205217 --after 20260929-151948 --replicates 3 [--suite golden|extension]
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const WORTEL = path.resolve(__dirname, "..", "..");
const BENCH = path.join(WORTEL, "docs", "v1.0.6", "benchmarks");

export type Overgang = "VERBETERD" | "GEREGRESSEERD" | "STABIEL_GOED" | "STABIEL_FOUT" | "INSTABIEL" | "ONBEOORDEELD";

function meerderheid(statussen: string[]): string {
  const tel = new Map<string, number>();
  for (const s of statussen) tel.set(s, (tel.get(s) ?? 0) + 1);
  return [...tel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ONBEKEND";
}

export function overgang(voor: string[], na: string[]): Overgang {
  const alleGelijk = (xs: string[]) => xs.every((x) => x === xs[0]);
  if (!alleGelijk(voor) || !alleGelijk(na)) {
    const v = meerderheid(voor);
    const n = meerderheid(na);
    if (v === n) return "INSTABIEL";
    return n === "GOED" ? "VERBETERD" : v === "GOED" ? "GEREGRESSEERD" : "INSTABIEL";
  }
  const [v, n] = [voor[0], na[0]];
  if (v === n) return v === "GOED" ? "STABIEL_GOED" : v === "FOUT" ? "STABIEL_FOUT" : "ONBEOORDEELD";
  if (n === "GOED") return "VERBETERD";
  if (v === "GOED") return "GEREGRESSEERD";
  return "INSTABIEL";
}

function lees(meting: string, bestand: string): Json | null {
  const p = path.join(BENCH, meting, bestand);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Json) : null;
}

function args(): { before: string; after: string; replicates: number; suite: "golden" | "extension" } {
  const a = process.argv.slice(2);
  const waarde = (naam: string) => {
    const i = a.indexOf(naam);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const before = waarde("--before");
  const after = waarde("--after");
  if (!before || !after) throw new Error("gebruik: --before <runId> --after <runId> [--replicates 3]");
  const suite = waarde("--suite") ?? "golden";
  if (suite !== "golden" && suite !== "extension") throw new Error("--suite is golden of extension");
  return { before, after, replicates: Number(waarde("--replicates") ?? 3), suite };
}

function main(): void {
  const { before, after, replicates, suite } = args();
  const [ruwBestand, cijferBestand] = suite === "golden" ? ["golden.json", "golden-grade.json"] : ["golden-extension.json", "golden-grade-extension.json"];
  const fase = (f: string, run: string) => Array.from({ length: replicates }, (_, i) => `${f}-${run}-r${i + 1}`);
  const voorMetingen = fase("before", before);
  const naMetingen = fase("after", after);

  const cijfers = (metingen: string[]) => metingen.map((m) => lees(m, cijferBestand));
  const ruw = (metingen: string[]) => metingen.map((m) => lees(m, ruwBestand));
  const [voorCijfers, naCijfers, voorRuw, naRuw] = [cijfers(voorMetingen), cijfers(naMetingen), ruw(voorMetingen), ruw(naMetingen)];
  const ontbrekend = [...voorMetingen, ...naMetingen].filter((_, i) => [...voorCijfers, ...naCijfers][i] === null);
  if (ontbrekend.length > 0) throw new Error(`ontbrekende metingen: ${ontbrekend.join(", ")}`);

  const ids: string[] = (naCijfers[0]!.items as Json[]).map((i) => i.id);
  const items = ids.map((id) => {
    const cijferVan = (g: Json | null) => (g!.items as Json[]).find((i) => i.id === id);
    const ruwVan = (r: Json | null) => (r!.results as Json[]).find((i) => i.id === id);
    const meta = cijferVan(naCijfers[0])!;
    const voor = voorCijfers.map((g) => cijferVan(g)?.status ?? "ONTBREEKT");
    const na = naCijfers.map((g) => cijferVan(g)?.status ?? "ONTBREEKT");
    // Grendelregel (grader-schema /2) achteraf over de /1-oordelen: alleen verlagend.
    const streng = (ruwe: (Json | null)[], cijfersLijst: (Json | null)[]) =>
      ruwe.map((r, i) => {
        const item = ruwVan(r);
        const beurten = (item?.turns ?? []) as Json[];
        const c = cijferVan(cijfersLijst[i]);
        return pasGrendelregelToe(String(item?.expect?.kind ?? ""), beurten[beurten.length - 1] ?? null, { status: c?.status ?? "ONTBREEKT", detail: c?.detail ?? "" }).status;
      });
    const voorStreng = streng(voorRuw, voorCijfers);
    const naStreng = streng(naRuw, naCijfers);
    const naBeurten = naRuw.map((r) => (ruwVan(r)?.turns ?? []) as Json[]);
    const grendels = naBeurten.map((beurten) => beurten.map((t) => grendelVan(String(t.text ?? ""), String(t.status ?? ""))).find((g) => g !== null) ?? null);
    // Huidige claimgrendel terugspelen over de (grendelloze) BEFORE-antwoorden.
    const replay = voorRuw.map((r) => {
      const beurten = (ruwVan(r)?.turns ?? []) as Json[];
      return beurten
        .filter((t) => t.status === "BEANTWOORD" && typeof t.text === "string")
        .map((t) => {
          const res: ClaimToolResultaat[] = ((t.tools ?? []) as string[]).map((tool) => ({ tool, ok: true, data: t.data }));
          return { claims: classificeerGezagsClaims(t.text, res).length, tegengehouden: ongedekteGezagsClaims(t.text, res).map((c) => `[${c.soort}] ${c.zin}`) };
        });
    });
    return {
      id,
      category: meta.category as string,
      holdout: Boolean(meta.holdout),
      voor,
      na,
      overgang: overgang(voor, na),
      voorStreng,
      naStreng,
      overgangStreng: overgang(voorStreng, naStreng),
      naGrendelPerReplicaat: grendels,
      naDetail: naCijfers.map((g) => cijferVan(g)?.detail ?? null),
      voorDetail: voorCijfers.map((g) => cijferVan(g)?.detail ?? null),
      huidigeClaimgrendelOpVoorAntwoorden: replay,
    };
  });

  const telling = (sleutel: Overgang) => items.filter((i) => i.overgang === sleutel).map((i) => i.id);
  const tellingStreng = (sleutel: Overgang) => items.filter((i) => i.overgangStreng === sleutel).map((i) => i.id);
  // Slagingspercentage per replicaat (GOED / alle items), zoals aggregate-replicates.ts.
  const pct = (kolom: "voor" | "na" | "voorStreng" | "naStreng", filter: (i: (typeof items)[number]) => boolean = () => true) => {
    const sel = items.filter(filter);
    const perRep = Array.from({ length: replicates }, (_, r) => (100 * sel.filter((i) => i[kolom][r] === "GOED").length) / Math.max(1, sel.length));
    const gesorteerd = [...perRep].sort((x, y) => x - y);
    return { meanPct: perRep.reduce((x, y) => x + y, 0) / replicates, medianPct: gesorteerd[Math.floor(replicates / 2)], worstPct: gesorteerd[0], perReplicaat: perRep };
  };
  const categorieen = [...new Set(items.map((i) => i.category))].sort();
  const scores = Object.fromEntries(
    (["voor", "na", "voorStreng", "naStreng"] as const).map((k) => [
      k,
      {
        overall: pct(k),
        dev: pct(k, (i) => !i.holdout),
        holdout: pct(k, (i) => i.holdout),
        perCategorie: Object.fromEntries(categorieen.map((c) => [c, pct(k, (i) => i.category === c).meanPct])),
      },
    ]),
  );
  const uit = {
    schema: "ns-lyra-master-before-after-comparison/1",
    suite,
    before,
    after,
    replicates,
    voorMetingen,
    naMetingen,
    gemaaktOp: new Date().toISOString(),
    scores,
    samenvattingStreng: {
      VERBETERD: tellingStreng("VERBETERD"),
      GEREGRESSEERD: tellingStreng("GEREGRESSEERD"),
      INSTABIEL: tellingStreng("INSTABIEL"),
      STABIEL_FOUT: tellingStreng("STABIEL_FOUT"),
      STABIEL_GOED: tellingStreng("STABIEL_GOED").length,
    },
    samenvatting: {
      VERBETERD: telling("VERBETERD"),
      GEREGRESSEERD: telling("GEREGRESSEERD"),
      INSTABIEL: telling("INSTABIEL"),
      STABIEL_FOUT: telling("STABIEL_FOUT"),
      STABIEL_GOED: telling("STABIEL_GOED").length,
      naVervangenDoorGrendel: items
        .filter((i) => i.naGrendelPerReplicaat.some((g) => g !== null))
        .map((i) => ({ id: i.id, grendels: i.naGrendelPerReplicaat })),
    },
    items,
  };
  const uitDir = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", "comparisons");
  mkdirSync(uitDir, { recursive: true });
  const uitPad = path.join(uitDir, `before-${before}__after-${after}${suite === "golden" ? "" : `.${suite}`}.json`);
  writeFileSync(uitPad, `${JSON.stringify(uit, null, 2)}\n`);
  const kort = (x: { meanPct: number; worstPct: number }) => `${x.meanPct.toFixed(1)}% (worst ${x.worstPct.toFixed(1)}%)`;
  console.log(`grader /1  voor ${kort(scores.voor.overall)}  na ${kort(scores.na.overall)}`);
  console.log(`streng /2  voor ${kort(scores.voorStreng.overall)}  na ${kort(scores.naStreng.overall)}`);
  console.log(JSON.stringify({ samenvatting: uit.samenvatting, samenvattingStreng: uit.samenvattingStreng }, null, 1).slice(0, 3000));
  console.log(`→ ${path.relative(WORTEL, uitPad)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) main();
