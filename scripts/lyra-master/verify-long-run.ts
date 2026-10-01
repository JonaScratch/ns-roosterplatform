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
 * Voltooiing (eindcontrole 20260930 — "continually executes meaningful
 * learning/development cycles for the budgeted period"; §55). Een run die
 * 131,5 van 360 minuten draaide en stopte omdat de vaste ruimte op was, is
 * GEEN voltooide 6-uursrun, hoe geldig die lokale uitputting ook was:
 * 10. het actieve budget is benut: actieve minuten ≥ budget, met hooguit de
 *     natuurlijke overschrijding van de laatste cyclus; stopreden BUDGET_OP.
 *     Een handmatige stop, een crash/blocker, een capaciteitsgrens of
 *     uitputting vóór het budget is een eerlijke runstatus, nooit voltooiing;
 * 11. die tijd ging op aan betekenisvolle cycli (≥ 80% van de actieve tijd in
 *     volledig gemeten cycli);
 * 12. uitputting of stagnatie leidde tot verbreding van de zoekruimte, niet
 *     tot het einde;
 * 13. elke nieuwe hypothese is aantoonbaar nieuw (herkomst, les, en geen
 *     semantisch duplicaat van een eerdere of verworpen aanpak);
 * 14. geen verworpen aanpak werd semantisch herhaald (ook niet in een ander
 *     jasje);
 * 15. de lessen van golf N stuurden golf N+1.
 *
 * Werkt op elk run-id, ook op een run die vanuit de UI (kaartje of paneel)
 * is gestart: leest `DATA_DIR/long-runs/<runId>/checkpoint.json`, of anders
 * de canonieke kopie `docs/lyra-knowledge/long-runs/<runId>/checkpoint.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { semantischeSleutel } from "../../demo-room/src/develop/interventies";

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
    readonly budgetMinuten: number | null;
    readonly stopReden: string | null;
    readonly golven: number;
    readonly hypothesen: number;
    readonly gegenereerdeTests: number;
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
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
  // Integriteit van de stop; of de run daarmee VOLTOOID is, beslist "actief budget benut".
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

  // ── Voltooiing ────────────────────────────────────────────────────────────
  const actiefMin = Number(checkpoint.actieveMs ?? 0) / 60000;
  const budget = typeof checkpoint.budgetMinuten === "number" ? checkpoint.budgetMinuten : null;
  const langsteCyclusMin = Math.max(0, ...cycli.map((c) => Number(c.duurMs ?? 0) / 60000));
  const overschrijding = budget === null ? 0 : actiefMin - budget;
  const budgetBenut = budget !== null && checkpoint.stopReden === "BUDGET_OP" && actiefMin >= budget && overschrijding <= langsteCyclusMin + 1;
  voeg(
    "actief budget benut (voltooiing)",
    budgetBenut,
    budget === null
      ? `profiel ${checkpoint.profiel} heeft geen tijdbudget: een handmatige run is een eerlijke runstatus, geen voltooiing`
      : `${r1(actiefMin)} van ${budget} actieve min; ${checkpoint.status}${checkpoint.stopReden ? ` · ${checkpoint.stopReden}` : ""}${
          budgetBenut
            ? overschrijding > 0
              ? `; overschrijding ${r1(overschrijding)} min (≤ langste cyclus ${r1(langsteCyclusMin)} min: cyclusgrens)`
              : ""
            : actiefMin < budget
              ? ` — gestopt vóór het budget op was: geen voltooiing, hoe geldig de stopreden ook is`
              : checkpoint.stopReden !== "BUDGET_OP"
                ? " — stopreden is niet het budget"
                : ` — overschrijding ${r1(overschrijding)} min groter dan één cyclus`
        }`,
  );

  const cyclusMs = vol.reduce((n, c) => n + Number(c.duurMs ?? 0), 0);
  const aandeel = Number(checkpoint.actieveMs ?? 0) > 0 ? cyclusMs / Number(checkpoint.actieveMs) : 0;
  voeg("betekenisvolle cycli gedurende het budget", vol.length >= 2 && aandeel >= 0.8, `${vol.length} volledige cycli, samen ${Math.round(aandeel * 100)}% van de actieve tijd`);

  const zr = checkpoint.zoekruimte as Json | undefined;
  const golven = ((zr?.golven ?? []) as Json[]).slice().sort((a, b) => a.nr - b.nr);
  const hyps = (zr?.hypothesen ?? []) as Json[];
  const uitgeputteCycli = cycli.filter((c) => c.beslissing === "UITGEPUT");
  const verbredingFouten: string[] = [];
  if (!zr) verbredingFouten.push("geen zoekruimte in het checkpoint (motor zonder regisseur)");
  for (const c of uitgeputteCycli) {
    const g = golven.find((x) => x.naCyclus === c.nr);
    if (c === laatste) {
      // Laatste cyclus meldde uitputting: alleen goed als er daarna verbreed is
      // en de run om een andere reden stopte (budget op de cyclusgrens), of nog loopt.
      const verbreed = g && (g.hypothesen ?? []).length > 0;
      if (!verbreed || !["BUDGET_OP", null].includes(checkpoint.stopReden ?? null)) verbredingFouten.push(`cyclus ${c.nr}: uitputting was het einde van de run`);
      continue;
    }
    const verder = cycli.some((x) => x.nr > c.nr && gemeten(x));
    if (!verder) verbredingFouten.push(`cyclus ${c.nr}: na uitputting geen gemeten cyclus meer`);
    else if (g && (g.hypothesen ?? []).length === 0) verbredingFouten.push(`golf ${g.nr} na cyclus ${c.nr} leverde niets nieuws op en toch ging de run door`);
  }
  const uitbreidingen = golven.filter((g) => g.nr > 1);
  const stagnatie = uitbreidingen.filter((g) => g.aanleiding === "STAGNATIE").length;
  voeg(
    "uitputting en stagnatie leidden tot verbreding, niet tot het einde",
    verbredingFouten.length === 0,
    verbredingFouten.length > 0
      ? verbredingFouten.join("; ")
      : uitbreidingen.length === 0
        ? "geen uitputting of stagnatie binnen het budget"
        : `${uitbreidingen.length} verbreding(en): ${uitbreidingen.length - stagnatie} na uitputting, ${stagnatie} na stagnatie; ${new Set(golven.map((g) => g.aanpak)).size} aanpak(ken)`,
  );

  // Nieuwheid: elke hypothese uit een verbreding heeft herkomst en lessen, en
  // is semantisch nieuw t.o.v. alles wat vóór haar golf bestond of verworpen was.
  const nieuwFouten: string[] = [];
  const semVan = (h: Json) => String(h.semantisch ?? semantischeSleutel(String(h.strategie)));
  for (const g of uitbreidingen) {
    const eigen = hyps.filter((h) => h.golf === g.nr);
    for (const h of eigen) {
      const her = h.herkomst ?? {};
      if (!her.reden || !Array.isArray(her.lesIds) || her.lesIds.length === 0) nieuwFouten.push(`${h.id}: geen herkomst of les`);
      const eerder = hyps.filter((x) => x.dimensie === h.dimensie && (x.golf < g.nr || (x.golf === g.nr && x.id !== h.id)));
      if (eerder.some((x) => semVan(x) === semVan(h))) nieuwFouten.push(`${h.id}: semantisch duplicaat van een eerdere hypothese (${semVan(h)})`);
      const verworpenVoor = cycli.filter((c) => c.nr <= g.naCyclus && c.dimensie === h.dimensie && c.verdict === "REJECT" && c.strategie);
      if (verworpenVoor.some((c) => semantischeSleutel(String(c.strategie)) === semVan(h))) nieuwFouten.push(`${h.id}: herverpakte verworpen aanpak (${semVan(h)})`);
    }
  }
  const nieuweHyps = hyps.filter((h) => h.golf > 1).length;
  voeg(
    "nieuwe hypothesen zijn aantoonbaar nieuw (herkomst, les, geen semantisch duplicaat)",
    nieuwFouten.length === 0,
    nieuwFouten.length > 0 ? nieuwFouten.slice(0, 6).join("; ") : `${nieuweHyps} nieuwe hypothese(n) in ${uitbreidingen.length} golf/golven; ${uitbreidingen.reduce((n, g) => n + (g.geweigerd ?? []).length, 0)} voorstel(len) als niet nieuw geweigerd`,
  );

  const herhaald: string[] = [];
  const semVerworpen = new Map<string, Set<string>>();
  for (const c of metMeting) {
    const dim = String(c.dimensie ?? "");
    const sem = c.strategie ? String(c.semantisch ?? semantischeSleutel(String(c.strategie))) : null;
    const set = semVerworpen.get(dim) ?? new Set<string>();
    if (sem && set.has(sem)) herhaald.push(`cyclus ${c.nr}: ${dim}/${c.strategie} is semantisch een al verworpen aanpak`);
    if (sem && (c.verdict === "REJECT" || c.verdict === "VALIDATOR_REJECT")) semVerworpen.set(dim, new Set([...set, sem]));
  }
  voeg("geen verworpen aanpak semantisch herhaald", herhaald.length === 0, herhaald.length === 0 ? `${metMeting.length} gemeten cycli, ${[...semVerworpen.values()].reduce((n, s) => n + s.size, 0)} verworpen aanpakken nooit opnieuw` : herhaald.join("; "));

  const sturingFouten: string[] = [];
  for (const g of uitbreidingen) {
    if (!Array.isArray(g.lesIds) || g.lesIds.length === 0) {
      sturingFouten.push(`golf ${g.nr}: op geen enkele les gebouwd`);
      continue;
    }
    const vorigeGolf = golven.filter((x) => x.nr < g.nr).at(-1);
    const lessenVorige = metMeting.filter((c) => c.lesId && c.nr > (vorigeGolf?.naCyclus ?? 0) && c.nr <= g.naCyclus).map((c) => c.lesId);
    if (lessenVorige.length > 0 && !lessenVorige.some((id) => g.lesIds.includes(id))) sturingFouten.push(`golf ${g.nr}: gebruikt geen enkele les van golf ${vorigeGolf?.nr ?? "?"}`);
  }
  const naGolf = uitbreidingen.filter((g) => metMeting.some((c) => (c.golf ?? 1) === g.nr)).length;
  voeg(
    "lessen van golf N sturen golf N+1",
    sturingFouten.length === 0,
    sturingFouten.length > 0 ? sturingFouten.join("; ") : uitbreidingen.length === 0 ? "geen verbreding nodig geweest" : `${uitbreidingen.length} golf/golven op de lessen van de vorige gebouwd; in ${naGolf} daarvan ook gemeten`,
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
      budgetMinuten: budget,
      stopReden: checkpoint.stopReden ?? null,
      golven: golven.length,
      hypothesen: hyps.length,
      gegenereerdeTests: ((zr?.tests ?? []) as Json[]).length,
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
