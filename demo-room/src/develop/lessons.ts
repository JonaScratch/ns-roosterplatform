import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../config";
import type { AgentQualityCategory } from "../types";

/**
 * Het leergeheugen van de ontwikkelcyclus: wat is geprobeerd, en wat vond de
 * rechter ervan.
 *
 * ## Waarom
 *
 * Zonder dit geheugen genereerde elke cyclus op dezelfde zwakte dezelfde
 * tekst onder een nieuw id: de tweede poging leerde niets van de eerste. Nu
 * leest de volgende cyclus dit bestand vóór zijn diagnose en hypothese:
 *
 * - een strategie die de rechter voor een dimensie verwierp, wordt voor die
 *   dimensie niet opnieuw geprobeerd;
 * - "meer bewijs nodig" betekent: dezelfde hypothese nog eens, met meer
 *   replicaten — niet een nieuwe tekst;
 * - een dimensie waarvan alle strategieën zijn verworpen, is uitgeput; de
 *   diagnose kiest dan de zwakste dimensie die nog niet is uitgeput;
 * - een behouden (KEEP) kandidaat maakt de dimensie "bediend": die wacht op
 *   een menselijk besluit, er komt geen tweede kandidaat bovenop.
 *
 * Append-only (`DATA_DIR/learning/lessons.jsonl`): een les wordt nooit
 * herschreven. Over runs heen: wat een eerdere run leerde, geldt ook voor de
 * volgende.
 */

export type Dimensie = Exclude<keyof AgentQualityCategory, "latencyMs">;

export interface Les {
  readonly id: string;
  readonly at: string;
  readonly runId: string;
  readonly dimensie: string;
  readonly strategie: string;
  readonly kandidaatId: string;
  /** Oordeel van de rechter, of VALIDATOR_REJECT als de kandidaat de meting niet haalde. */
  readonly verdict: "KEEP" | "REJECT" | "NEEDS_MORE_EVIDENCE" | "VALIDATOR_REJECT";
  readonly beslissing: string;
  readonly redenen: readonly string[];
  readonly deltaDoel: number | null;
  readonly adversarial: { readonly basis: number; readonly kandidaat: number } | null;
}

const bestand = () => path.join(DATA_DIR, "learning", "lessons.jsonl");

export function leesLessen(): readonly Les[] {
  if (!existsSync(bestand())) return [];
  return readFileSync(bestand(), "utf8")
    .split("\n")
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r) as Les);
}

export function voegLesToe(les: Omit<Les, "id" | "at">, at = new Date().toISOString()): Les {
  const volledig: Les = { id: randomUUID(), at, ...les };
  mkdirSync(path.dirname(bestand()), { recursive: true });
  appendFileSync(bestand(), `${JSON.stringify(volledig)}\n`, "utf8");
  return volledig;
}

export interface Keuze<T> {
  readonly waarde: T;
  readonly reden: string;
  /** Welke lessen deze keuze bepaalden — het bewijs dat de cyclus leerde. */
  readonly lesIds: readonly string[];
  /** Dimensies die vóór deze keuze zijn overgeslagen, en waarom (lokaal uitgeput, wacht op een mens, of in deze run uitgesloten). */
  readonly overgeslagen?: readonly { readonly dimensie: string; readonly reden: "UITGEPUT" | "WACHT_OP_MENS" | "RUN_UITGESLOTEN" }[];
}

/**
 * Wat de lange run (factory/longRun.ts) bovenop het leergeheugen afdwingt:
 * dimensies die in déze run lokaal uitgeput zijn verklaard, en paren
 * dimensie/strategie die in deze run al verworpen zijn. Normaal houdt het
 * leergeheugen dit zelf bij; dit is het vangnet als een les ontbrak.
 */
export interface RunUitsluitingen {
  readonly dimensies?: readonly string[];
  readonly paren?: readonly { readonly dimensie: string; readonly strategie: string }[];
}

/** Zo vaak mag een strategie "meer bewijs nodig" krijgen voordat ze als geprobeerd telt. */
export const MAX_ONBESLIST = 2;

const verworpen = (l: Les) => l.verdict === "REJECT" || l.verdict === "VALIDATOR_REJECT";

/** Welke strategieën zijn voor deze dimensie al afgewezen, en welke staan op "meer bewijs"? */
export function stand(dimensie: string, lessen: readonly Les[], strategieen: readonly string[], run: RunUitsluitingen = {}) {
  const hier = lessen.filter((l) => l.dimensie === dimensie);
  const afgewezen = new Set([...hier.filter(verworpen).map((l) => l.strategie), ...(run.paren ?? []).filter((p) => p.dimensie === dimensie).map((p) => p.strategie)]);
  // Twee keer "meer bewijs" zonder besluit is ook een antwoord: de winst is
  // te klein om van ruis te onderscheiden. Anders zou dezelfde hypothese
  // eindeloos herhaald worden.
  for (const st of strategieen) {
    if (hier.filter((l) => l.strategie === st && l.verdict === "NEEDS_MORE_EVIDENCE").length >= MAX_ONBESLIST) afgewezen.add(st);
  }
  const behouden = hier.some((l) => l.verdict === "KEEP");
  // De laatste les per strategie telt: "meer bewijs" gevolgd door een REJECT is verworpen.
  const laatstePerStrategie = new Map<string, Les>();
  for (const l of hier) laatstePerStrategie.set(l.strategie, l);
  const meerBewijs = strategieen.filter((s) => !afgewezen.has(s) && laatstePerStrategie.get(s)?.verdict === "NEEDS_MORE_EVIDENCE");
  const uitgeput = strategieen.every((s) => afgewezen.has(s));
  return { hier, afgewezen, behouden, meerBewijs, uitgeput };
}

/**
 * De diagnose na het leren: de zwakste gemeten dimensie die nog niet
 * uitgeput of al bediend is. `null` = niets meer te proberen.
 */
export function kiesDoel(
  scores: Readonly<Partial<Record<string, number>>>,
  lessen: readonly Les[],
  strategieen: readonly string[],
  focus?: string,
  run: RunUitsluitingen = {},
): Keuze<string> | null {
  const kandidaten: [string, number | null][] = Object.entries(scores)
    .filter((e): e is [string, number] => typeof e[1] === "number")
    .sort((a, b) => a[1] - b[1]);
  // Een handmatige focus gaat vóór, ook als die dimensie niet gemeten is;
  // maar een uitgeputte focus wordt net zo overgeslagen als elke andere.
  if (focus) {
    const i = kandidaten.findIndex(([d]) => d === focus);
    const item: [string, number | null] = i >= 0 ? kandidaten.splice(i, 1)[0] : [focus, null];
    kandidaten.unshift(item);
  }
  const overgeslagen: string[] = [];
  const overgeslagenGestructureerd: { dimensie: string; reden: "UITGEPUT" | "WACHT_OP_MENS" | "RUN_UITGESLOTEN" }[] = [];
  const gebruikt: string[] = [];
  const runUit = new Set(run.dimensies ?? []);
  for (const [dim, score] of kandidaten) {
    const s = stand(dim, lessen, strategieen, run);
    gebruikt.push(...s.hier.map((l) => l.id));
    if (runUit.has(dim)) {
      overgeslagen.push(`${dim} (in deze run lokaal uitgeput)`);
      overgeslagenGestructureerd.push({ dimensie: dim, reden: "RUN_UITGESLOTEN" });
      continue;
    }
    if (s.uitgeput) {
      overgeslagen.push(`${dim} (alle strategieën verworpen)`);
      overgeslagenGestructureerd.push({ dimensie: dim, reden: "UITGEPUT" });
      continue;
    }
    if (s.behouden) {
      overgeslagen.push(`${dim} (behouden kandidaat wacht op een mens)`);
      overgeslagenGestructureerd.push({ dimensie: dim, reden: "WACHT_OP_MENS" });
      continue;
    }
    const scoreTekst = score === null ? "niet gemeten" : `${score.toFixed(1)}%`;
    const reden =
      dim === focus
        ? `${dim} (${scoreTekst}) is handmatig als focus gekozen${s.hier.length > 0 ? `; ${s.hier.length} eerdere poging(en) meegewogen` : ""}.`
        : overgeslagen.length > 0
          ? `${dim} (${scoreTekst}) is de zwakste dimensie die nog open staat; overgeslagen: ${overgeslagen.join(", ")}.`
          : `${dim} (${scoreTekst}) is de zwakste gemeten dimensie${s.hier.length > 0 ? `; ${s.hier.length} eerdere poging(en) meegewogen` : ""}.`;
    return { waarde: dim, reden, lesIds: gebruikt, overgeslagen: overgeslagenGestructureerd };
  }
  return null;
}

/**
 * De hypothese na het leren: eerst een strategie die "meer bewijs" vroeg
 * (dezelfde tekst, meer replicaten), anders de eerste die nog niet is
 * verworpen. `null` = uitgeput.
 */
export function kiesStrategie(dimensie: string, lessen: readonly Les[], strategieen: readonly string[], run: RunUitsluitingen = {}): (Keuze<string> & { readonly meerReplicaten: boolean }) | null {
  const s = stand(dimensie, lessen, strategieen, run);
  const ids = s.hier.map((l) => l.id);
  if (s.meerBewijs.length > 0) {
    return { waarde: s.meerBewijs[0], meerReplicaten: true, lesIds: ids, reden: `${s.meerBewijs[0]} vroeg om meer bewijs: zelfde hypothese, meer replicaten.` };
  }
  const volgende = strategieen.find((st) => !s.afgewezen.has(st) && !s.hier.some((l) => l.strategie === st));
  if (!volgende) return null;
  return {
    waarde: volgende,
    meerReplicaten: false,
    lesIds: ids,
    reden: s.afgewezen.size > 0 ? `${[...s.afgewezen].join(", ")} verworpen voor ${dimensie}; nu ${volgende}.` : `eerste poging op ${dimensie}: ${volgende}.`,
  };
}

/**
 * Hoeveel verkenningsruimte is er nog, over alle dimensies? Het leergeheugen
 * geldt over runs heen: strategieën die een eerdere run verwierp, blijven
 * geblokkeerd. Een lange run legt dit bij elke start vast, zodat vooraf
 * zichtbaar is of er genoeg open paren zijn voor het gekozen budget.
 */
export function verkenningsruimte(dimensies: readonly string[], lessen: readonly Les[], strategieen: readonly string[]) {
  const perDimensie = dimensies.map((d) => {
    const s = stand(d, lessen, strategieen);
    return { dimensie: d, open: strategieen.filter((st) => !s.afgewezen.has(st)).length, wachtOpMens: s.behouden };
  });
  const open = perDimensie.filter((p) => !p.wachtOpMens).reduce((n, p) => n + p.open, 0);
  return { open, totaal: dimensies.length * strategieen.length, perDimensie };
}
