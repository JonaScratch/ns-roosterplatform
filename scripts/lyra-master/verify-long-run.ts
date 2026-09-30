/**
 * Bewijs na een echte lange Development Run: liep de volledige cyclus
 * zelfstandig, met een echt model, en leerde hij van zichzelf?
 *
 *   npx tsx --conditions=react-server scripts/lyra-master/verify-long-run.ts --run <runId> [--uitvoer <map>]
 *
 * Leest het checkpoint (`DATA_DIR/long-runs/<runId>/checkpoint.json`) en het
 * logboek van de run, en schrijft
 * `docs/lyra-knowledge/long-runs/<runId>/LONG-RUN-VERIFICATION.json` plus een
 * kopie van het checkpoint (het origineel staat in de niet-getrackte
 * `demo-room/data`). Overschrijft nooit.
 *
 * De controles (allemaal verplicht voor PASS):
 *  1. minstens twee gemeten cycli;
 *  2. elke gemeten cyclus doorliep alle stappen (diagnose → hypothese →
 *     kandidaat → validator → experiment → benchmark → holdout → adversarial
 *     → rechter → besluit → leren), elk met status OK;
 *  3. een echt taalmodel deed de metingen (geen stub), volgens het logboek;
 *  4. de rechter is judge/2 (adversarial verplicht) en gaf per cyclus een oordeel;
 *  5. elke volgende cyclus steunde aantoonbaar op de les van de vorige, en
 *     probeerde nooit een strategie die voor diezelfde dimensie al verworpen was;
 *  6. de actieve productieversie en releasegeneratie zijn aan het eind gelijk
 *     aan de start (nooit autonome activatie);
 *  7. de run stopte om een geldige reden (budget, alles geprobeerd, handmatig)
 *     of loopt nog/is gepauzeerd — niet door herhaalde fouten; "alles
 *     geprobeerd" alleen als de laatste cyclus die globale uitputting zelf
 *     aantoonde (UITGEPUT);
 *  8. het checkpoint is canoniek: verkenningsbudget en een
 *     omgevingsvingerafdruk (model, code, release) zijn vastgelegd;
 *  9. lokale uitputting van één zwakte beëindigde de run niet (incident
 *     DR-UI-202609301449): na een lokaal uitgeputte zwakte volgde nog een
 *     cyclus, of de run stopte om een andere geldige reden.
 *
 * Werkt op elk run-id, ook op een run die vanuit de UI (kaartje of paneel)
 * is gestart: leest `DATA_DIR/long-runs/<runId>/checkpoint.json`, of anders
 * de canonieke kopie `docs/lyra-knowledge/long-runs/<runId>/checkpoint.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const VERPLICHTE_STADIA = ["DIAGNOSE", "HYPOTHESE", "KANDIDAAT", "VALIDATOR", "EXPERIMENT", "BENCHMARK", "HOLDOUT", "ADVERSARIAL", "RECHTER", "BESLUIT", "LEREN"] as const;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Controle {
  readonly naam: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface LangeRunVerificatie {
  readonly schema: "ns-lyra-long-run-verification/1";
  readonly runId: string;
  readonly status: "PASS" | "FAIL";
  readonly controles: readonly Controle[];
  readonly samenvatting: {
    readonly cycli: number;
    readonly volledigeCycli: number;
    readonly verdicts: Readonly<Record<string, number>>;
    readonly dimensies: readonly string[];
    readonly strategieen: readonly string[];
    readonly actieveMinuten: number;
    readonly stopReden: string | null;
  };
}

const gemeten = (c: Json) => c.beslissing !== "NOT_EXECUTED" && c.beslissing !== "UITGEPUT";
const volledig = (c: Json) => VERPLICHTE_STADIA.every((n) => (c.stadia ?? []).some((s: Json) => s.naam === n && s.status === "OK"));

/** Zuiver: geen bestanden, geen model — toetsbaar. */
export function controleerLangeRun(checkpoint: Json, logboek: readonly Json[]): LangeRunVerificatie {
  const cycli = (checkpoint.cycli ?? []) as Json[];
  const metMeting = cycli.filter(gemeten);
  const vol = metMeting.filter(volledig);
  const controles: Controle[] = [];
  const voeg = (naam: string, ok: boolean, detail: string) => controles.push({ naam, ok, detail });

  voeg("minstens twee gemeten cycli", metMeting.length >= 2, `${metMeting.length} gemeten van ${cycli.length}`);

  const onvolledig = metMeting.filter((c) => !volledig(c)).map((c) => {
    const ontbreekt = VERPLICHTE_STADIA.filter((n) => !(c.stadia ?? []).some((s: Json) => s.naam === n && s.status === "OK"));
    return `cyclus ${c.nr}: ${ontbreekt.join(", ")}`;
  });
  voeg("elke gemeten cyclus doorliep alle stappen", metMeting.length > 0 && onvolledig.length === 0, onvolledig.length === 0 ? `${vol.length} volledige cycli` : `onvolledig — ${onvolledig.join("; ")}`);

  const modellen = logboek
    .filter((e) => e.kind === "AGENT_EXECUTION_START")
    .map((e) => /model=([^ ]+) \(taalmodel: (ja|nee)\)/.exec(String(e.message)))
    .filter((m): m is RegExpExecArray => m !== null);
  const echt = modellen.filter((m) => m[2] === "ja" && !/stub/i.test(m[1]));
  const namen = [...new Set(modellen.map((m) => m[1]))];
  // De vingerafdruk per segment (canoniek checkpoint): welk eindpunt en welke
  // build. Een nep-eindpunt dat zich als qwen3:8b voordoet, is aan de
  // logregels niet te zien — hier wel, en een mens ziet het in het detail.
  const segmentModellen = ((checkpoint.omgevingen ?? []) as Json[]).map((o) => (o.omgeving?.model ?? null) as Json | null);
  const segmentenLokaal = segmentModellen.length === 0 || segmentModellen.every((m) => m && m.lokaal === true);
  const builds = [...new Set(segmentModellen.filter(Boolean).map((m) => `${m!.model ?? "?"} @ ollama ${typeof m!.ollamaVersie === "string" ? m!.ollamaVersie : "?"}${m!.modelDigest ? ` (${String(m!.modelDigest).slice(0, 12)})` : ""}`))];
  voeg(
    "een echt taalmodel deed de metingen",
    modellen.length > 0 && echt.length === modellen.length && segmentenLokaal,
    modellen.length === 0
      ? "geen modelaanroep in het logboek"
      : `${echt.length}/${modellen.length} items door ${namen.join(", ")}${builds.length > 0 ? `; eindpunt: ${builds.join(", ")}` : ""}${segmentenLokaal ? "" : " — een segment liep zonder lokaal model"}`,
  );

  const zonderRechter = vol.filter((c) => !c.verdict || !(c.stadia ?? []).some((s: Json) => s.naam === "RECHTER" && /^judge\/2:/.test(String(s.detail))));
  voeg(
    "onafhankelijke rechter (judge/2, met adversarial) gaf per cyclus een oordeel",
    vol.length > 0 && zonderRechter.length === 0,
    vol.length === 0 ? "geen volledige cyclus om te beoordelen" : zonderRechter.length === 0 ? `ja, in ${vol.length} cycli` : `ontbreekt bij cyclus ${zonderRechter.map((c) => c.nr).join(", ")}`,
  );

  const leerfouten: string[] = [];
  const verworpenPerDim = new Map<string, Set<string>>();
  let vorige: Json | null = null;
  for (const c of metMeting) {
    const dim = String(c.dimensie ?? "");
    const eerderVerworpen = verworpenPerDim.get(dim) ?? new Set<string>();
    if (c.strategie && eerderVerworpen.has(c.strategie)) leerfouten.push(`cyclus ${c.nr} probeerde ${dim}/${c.strategie} opnieuw na verwerping`);
    if (vorige?.lesId && !(c.geleerdVan ?? []).includes(vorige.lesId)) leerfouten.push(`cyclus ${c.nr} steunde niet op de les van cyclus ${vorige.nr}`);
    if (c.verdict === "REJECT" && c.strategie) verworpenPerDim.set(dim, new Set([...eerderVerworpen, c.strategie]));
    if (!c.lesId) leerfouten.push(`cyclus ${c.nr} liet geen les na`);
    vorige = c;
  }
  voeg(
    "elke cyclus leerde van de vorige",
    metMeting.length >= 2 && leerfouten.length === 0,
    metMeting.length < 2 ? "minder dan twee gemeten cycli: niets om te vergelijken" : leerfouten.length === 0 ? "elke volgende keuze steunde op de vorige les; geen verworpen strategie herhaald" : leerfouten.join("; "),
  );

  const p = checkpoint.productie as Json | null | undefined;
  const ongewijzigd = p && p.bijStart && p.laatst && p.bijStart.versionId === p.laatst.versionId && p.bijStart.generation === p.laatst.generation;
  voeg("productie onaangeroerd (geen autonome activatie)", Boolean(ongewijzigd), p ? `${p.bijStart?.versionId} (generatie ${p.bijStart?.generation}) → ${p.laatst?.versionId} (generatie ${p.laatst?.generation})` : "geen productiestand vastgelegd");

  const laatste = cycli[cycli.length - 1];
  const uitputtingBewezen = checkpoint.stopReden !== "ALLES_GEPROBEERD" || laatste?.beslissing === "UITGEPUT";
  const geldigeStop = [null, "BUDGET_OP", "ALLES_GEPROBEERD", "HANDMATIG_GESTOPT", "MAX_CYCLI"].includes(checkpoint.stopReden ?? null) && uitputtingBewezen;
  voeg(
    "geldige stopreden",
    geldigeStop,
    `${checkpoint.status}${checkpoint.stopReden ? ` · ${checkpoint.stopReden}` : ""}${uitputtingBewezen ? "" : " — ALLES_GEPROBEERD zonder dat de laatste cyclus globale uitputting aantoonde"}`,
  );

  const canoniek = Boolean(checkpoint.verkenning) && Array.isArray(checkpoint.omgevingen) && checkpoint.omgevingen.length > 0;
  voeg(
    "canoniek checkpoint (verkenningsbudget en omgevingsvingerafdruk)",
    canoniek,
    canoniek
      ? `${checkpoint.profiel}${checkpoint.budgetMinuten ? ` (${checkpoint.budgetMinuten} min)` : ""}, ${checkpoint.omgevingen.length} segment(en), commit ${String(checkpoint.omgevingen[0]?.omgeving?.commit ?? "onbekend").slice(0, 10)}`
      : "verkenningsbudget of omgevingsvingerafdruk ontbreekt — gestart buiten de canonieke motor?",
  );

  const uitgesloten = (checkpoint.uitgeslotenDimensies ?? []) as string[];
  const lokaalFout = uitgesloten.length > 0 && laatste && uitgesloten.includes(String(laatste.dimensie)) && !["BUDGET_OP", "HANDMATIG_GESTOPT", "MAX_CYCLI", "ALLES_GEPROBEERD", null].includes(checkpoint.stopReden ?? null);
  voeg(
    "lokale uitputting beëindigde de run niet",
    !lokaalFout,
    uitgesloten.length === 0 ? "geen zwakte lokaal uitgeput" : `lokaal uitgeput: ${uitgesloten.join(", ")}; ${lokaalFout ? "de run stopte daarop" : "de run ging door of stopte om een andere geldige reden"}`,
  );

  const verdicts: Record<string, number> = {};
  for (const c of metMeting) verdicts[c.verdict ?? "geen"] = (verdicts[c.verdict ?? "geen"] ?? 0) + 1;
  return {
    schema: "ns-lyra-long-run-verification/1",
    runId: String(checkpoint.runId),
    status: controles.every((c) => c.ok) ? "PASS" : "FAIL",
    controles,
    samenvatting: {
      cycli: cycli.length,
      volledigeCycli: vol.length,
      verdicts,
      dimensies: [...new Set(metMeting.map((c) => String(c.dimensie)))],
      strategieen: [...new Set(metMeting.map((c) => String(c.strategie)))],
      actieveMinuten: Math.round((Number(checkpoint.actieveMs ?? 0) / 60000) * 10) / 10,
      stopReden: checkpoint.stopReden ?? null,
    },
  };
}

async function main(): Promise<void> {
  const i = process.argv.indexOf("--run");
  const runId = i >= 0 ? process.argv[i + 1] : undefined;
  if (!runId) throw new Error("Geef --run <runId> (zie Development Runs → Lange runs, of 'demo-room long-run').");
  const { DATA_DIR, REPO_ROOT } = await import("../../demo-room/src/config");
  const { readRunEvents } = await import("../../demo-room/src/store/logbook");
  const veilig = runId.replace(/[^A-Za-z0-9._-]/g, "_");
  const werk = path.join(DATA_DIR, "long-runs", veilig, "checkpoint.json");
  const kopie = path.join(REPO_ROOT, "docs", "lyra-knowledge", "long-runs", veilig, "checkpoint.json");
  const bron = existsSync(werk) ? werk : kopie;
  if (!existsSync(bron)) throw new Error(`Geen checkpoint voor ${runId}: niet in ${werk} en niet in ${kopie}.`);
  const checkpoint = JSON.parse(readFileSync(bron, "utf8")) as Json;
  const verificatie = controleerLangeRun(checkpoint, readRunEvents(runId) as unknown as Json[]);

  const u = process.argv.indexOf("--uitvoer");
  const map = u >= 0 && process.argv[u + 1] ? path.resolve(process.argv[u + 1]) : path.join(REPO_ROOT, "docs", "lyra-knowledge", "long-runs", runId);
  mkdirSync(map, { recursive: true });
  const uit = path.join(map, "LONG-RUN-VERIFICATION.json");
  if (existsSync(uit)) throw new Error(`${uit} bestaat al en is bewijsmateriaal — niet overschreven.`);
  // De canonieke kopie is van dezelfde run (de motor houdt hem bij); de
  // verifier zet er de stand op het moment van verifiëren in. Het oordeel zelf
  // wordt nooit overschreven.
  writeFileSync(path.join(map, "checkpoint.json"), `${JSON.stringify(checkpoint, null, 2)}\n`);
  writeFileSync(uit, `${JSON.stringify({ ...verificatie, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx" });

  for (const c of verificatie.controles) console.log(`${c.ok ? "OK  " : "FOUT"}  ${c.naam} — ${c.detail}`);
  console.log(`\n${verificatie.status} — ${uit}`);
  process.exitCode = verificatie.status === "PASS" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
